param(
    [Parameter(Mandatory)][string] $Version,
    [Parameter(Mandatory)][int] $BuildNumber,
    [switch] $AllowUnsigned
)
. "$PSScriptRoot/release-common.ps1"
Assert-ReleaseVersion $Version $BuildNumber
$hasCertificate = !!$env:WINDOWS_CERTIFICATE_BASE64
if (!$hasCertificate -and !$AllowUnsigned) { throw 'Set Windows certificate secrets or explicitly allow an unsigned installer.' }
if ($hasCertificate -and !$env:WINDOWS_CERTIFICATE_PASSWORD) { throw 'Windows certificate password is missing.' }
$output = Get-ReleaseDirectory 'windows' $Version
$root = Split-Path -Parent $PSScriptRoot
$certificate = $null
Push-Location $root
try {
    & dotnet publish src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-windows10.0.19041.0 -c Release `
        -p:RuntimeIdentifierOverride=win-x64 -p:WindowsPackageType=None -p:WindowsAppSDKSelfContained=true `
        -p:SelfContained=true -p:PublishTrimmed=false "-p:ApplicationDisplayVersion=$Version" `
        "-p:ApplicationVersion=$BuildNumber" -o "$output/publish" --nologo
    Assert-NativeSuccess 'Windows publish'
    foreach ($required in @('ChordLibrary.Native.exe', 'coreclr.dll', 'Microsoft.UI.Xaml.dll', 'wwwroot/index.html')) {
        if (!(Test-Path -LiteralPath "$output/publish/$required")) { throw "Missing published dependency: $required" }
    }
    $toolsDir = Join-Path $output 'tools'
    New-Item -ItemType Directory -Path $toolsDir | Out-Null
    # Pin the installer compiler and verify the upstream release asset checksum.
    $compilerSetup = Join-Path $toolsDir 'innosetup.exe'
    Invoke-WebRequest 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe' -OutFile $compilerSetup
    if ((Get-FileHash $compilerSetup -Algorithm SHA256).Hash -ne '0362A383ED217D4C4239B5933866DD96D3EB2102737DA92F80F6057A4B40DF2F') { throw 'Inno Setup checksum mismatch.' }
    $compilerDir = Join-Path $toolsDir 'inno'
    $install = Start-Process -FilePath $compilerSetup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',"/DIR=`"$compilerDir`"") -Wait -PassThru -WindowStyle Hidden
    if ($install.ExitCode -ne 0) { throw 'Could not install the pinned Inno Setup compiler.' }
    $webView = Join-Path $toolsDir 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webView
    $signature = Get-AuthenticodeSignature -LiteralPath $webView
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'WebView2 bootstrapper signature verification failed.' }

    if ($hasCertificate) {
        $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
            [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64), $password,
            [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
        if (!$certificate.HasPrivateKey) { throw 'Windows certificate has no private key.' }
        $signed = Set-AuthenticodeSignature -LiteralPath "$output/publish/ChordLibrary.Native.exe" -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
        if ($signed.Status -ne 'Valid') { throw "Windows application signing failed: $($signed.Status)" }
    }
    & "$compilerDir/ISCC.exe" "/DAppVersion=$Version" "/DPublishDir=$output/publish" "/DOutputDir=$output" "/DWebViewBootstrapper=$webView" packaging/windows/ChordLibrary.iss
    Assert-NativeSuccess 'Windows installer compilation'
    $installer = "$output/ChordLibrary-$Version-windows-x64-setup.exe"
    if ($hasCertificate) {
        $signed = Set-AuthenticodeSignature -LiteralPath $installer -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
        if ($signed.Status -ne 'Valid') { throw "Installer signing failed: $($signed.Status)" }
    } else {
        Write-Warning 'Windows installer is unsigned. Windows can show an unknown-publisher warning.'
        'Windows installer is unsigned; its publisher identity has not been verified by a trusted signing certificate.' |
            Set-Content "$output/WINDOWS-UNSIGNED.txt"
    }
} finally {
    if ($certificate) { $certificate.Dispose() }
    Pop-Location
}
