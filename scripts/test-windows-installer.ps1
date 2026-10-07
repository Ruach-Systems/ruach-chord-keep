param([Parameter(Mandatory)][string] $Version)
. "$PSScriptRoot/release-common.ps1"
Assert-ReleaseVersion $Version 1
$root = Split-Path -Parent $PSScriptRoot
$package = Join-Path $root "artifacts/release/$Version/windows/ChordKeep-$Version-windows-x64-setup.exe"
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{D72F1DE3-93E7-4729-BC61-5CC89143D125}_is1'
if (Test-Path $uninstallKey) { throw 'ChordKeep is already installed for this user. Use a clean test account/runner.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("chordlibrary-install-test-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $testRoot 'app'
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $install = Start-Process -FilePath $package -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=`"$installDir`"", "/LOG=`"$testRoot/install.log`"") -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode). Log: $testRoot/install.log" }
    if (!(Test-Path $uninstallKey)) { throw 'Installer did not register an uninstall entry.' }
    foreach ($file in @('ChordLibrary.Native.exe','coreclr.dll','Microsoft.UI.Xaml.dll','wwwroot/index.html','wwwroot/_content/ChordLibrary.Shared/js/app.js')) {
        $installed = Join-Path $installDir $file
        $original = Join-Path $root "artifacts/release/$Version/windows/publish/$file"
        if (!(Test-Path -LiteralPath $installed)) { throw "Missing installed file: $file" }
        if ((Get-FileHash -LiteralPath $installed).Hash -ne (Get-FileHash -LiteralPath $original).Hash) { throw "Installed file differs: $file" }
    }
    Write-Output 'Windows silent installation and installed-file checks passed.'
} finally {
    $uninstaller = Join-Path $installDir 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$testRoot/uninstall.log`"") -WindowStyle Hidden -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode). Log: $testRoot/uninstall.log" }
        if (Test-Path $uninstallKey) { throw 'Uninstaller left its registration behind.' }
        if (Test-Path -LiteralPath (Join-Path $installDir 'ChordLibrary.Native.exe')) { throw 'Uninstaller left the application executable behind.' }
        Write-Output "Windows silent uninstall passed. Test logs: $testRoot"
    }
}
