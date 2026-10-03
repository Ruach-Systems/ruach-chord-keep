param(
    [Parameter(Mandatory)][string] $Version,
    [Parameter(Mandatory)][int] $BuildNumber,
    [Parameter(Mandatory)][string] $KeystorePath,
    [string] $KeyAlias = 'ruach-chord-library'
)
. "$PSScriptRoot/release-common.ps1"
Assert-ReleaseVersion $Version $BuildNumber
if (!(Test-Path -LiteralPath $KeystorePath)) { throw 'Android signing keystore is missing.' }
if (!$env:ANDROID_STORE_PASSWORD -or !$env:ANDROID_KEY_PASSWORD) { throw 'Android signing password environment variables are missing.' }
$output = Get-ReleaseDirectory 'android' $Version
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # env: keeps passwords out of command-line arguments and build logs. APK only;
    # AAB signing uses a different password transport and is not part of this workflow.
    & dotnet publish src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-android -c Release `
        "-p:ApplicationDisplayVersion=$Version" "-p:ApplicationVersion=$BuildNumber" `
        -p:AndroidPackageFormats=apk -p:AndroidKeyStore=true "-p:AndroidSigningKeyStore=$KeystorePath" `
        "-p:AndroidSigningKeyAlias=$KeyAlias" -p:AndroidSigningStorePass=env:ANDROID_STORE_PASSWORD `
        -p:AndroidSigningKeyPass=env:ANDROID_KEY_PASSWORD -o "$output/publish" --nologo
    Assert-NativeSuccess 'Android publish'
    $apks = @(Get-ChildItem -LiteralPath "$output/publish" -Filter '*-Signed.apk')
    if ($apks.Count -ne 1) { throw "Expected one signed APK, found $($apks.Count)." }
    $sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, 'C:\Program Files (x86)\Android\android-sdk') |
        Where-Object { $_ -and (Test-Path -LiteralPath "$_/build-tools") } | Select-Object -First 1
    if (!$sdk) { throw 'Android SDK not found for signature verification.' }
    $signer = Get-ChildItem -Path "$sdk/build-tools/*/apksigner.bat" | Sort-Object FullName -Descending | Select-Object -First 1
    if (!$signer) { throw 'apksigner was not found.' }
    & $signer.FullName verify --verbose --print-certs $apks[0].FullName
    Assert-NativeSuccess 'APK signature verification'
    Copy-Item -LiteralPath $apks[0].FullName -Destination "$output/ChordLibrary-$Version-android.apk"
} finally { Pop-Location }
