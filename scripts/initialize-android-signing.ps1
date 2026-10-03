param(
    [string] $Repository = 'Ruach-Systems/ruach-chord-library',
    [string] $KeyTool = 'keytool',
    [switch] $UploadSecrets
)
. "$PSScriptRoot/release-common.ps1"
if (!$IsWindows) { throw 'This helper uses Windows DPAPI to protect the local password backup.' }
$root = Split-Path -Parent $PSScriptRoot
$backup = Join-Path $root '.local/release-signing'
$keyFile = Join-Path $backup 'chord-library-release.keystore'
$passwordFile = Join-Path $backup 'password.dpapi.xml'
$alias = 'ruach-chord-library'
if ((Test-Path $keyFile) -xor (Test-Path $passwordFile)) { throw 'Signing backup is incomplete. Restore the original files; do not generate a replacement key.' }
if (Test-Path $passwordFile) {
    $securePassword = Import-Clixml -LiteralPath $passwordFile
    $password = [System.Net.NetworkCredential]::new('', $securePassword).Password
} else {
    if ($UploadSecrets) {
        $secrets = gh secret list --repo $Repository --json name
        Assert-NativeSuccess 'Read repository secret names'
        if (@($secrets | ConvertFrom-Json | Where-Object name -like 'ANDROID_*').Count) {
            throw 'Android secrets already exist. Restore the original signing key rather than replacing it.'
        }
    }
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    # Restrict the backup to this Windows user and SYSTEM; Git ignores .local/.
    $acl = Get-Acl -LiteralPath $backup
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($identity in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $backup -AclObject $acl
    $password = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
    $env:CHORD_KEYTOOL_PASSWORD = $password
    try {
        & $KeyTool -genkeypair -keystore $keyFile -storetype PKCS12 -alias $alias -keyalg RSA -keysize 3072 -validity 10000 `
            -dname 'CN=Ruach Systems, OU=Chord Library' -storepass:env CHORD_KEYTOOL_PASSWORD -keypass:env CHORD_KEYTOOL_PASSWORD
        Assert-NativeSuccess 'Generate Android signing key'
        $securePassword | Export-Clixml -LiteralPath $passwordFile
    } finally { Remove-Item Env:CHORD_KEYTOOL_PASSWORD -ErrorAction SilentlyContinue }
}
try {
    if ($UploadSecrets) {
        $values = @{
            ANDROID_KEYSTORE_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyFile))
            ANDROID_STORE_PASSWORD = $password
            ANDROID_KEY_PASSWORD = $password
            ANDROID_KEY_ALIAS = $alias
        }
        foreach ($name in $values.Keys) {
            $values[$name] | gh secret set $name --repo $Repository
            Assert-NativeSuccess "Upload $name"
        }
        $values.Clear()
        Write-Output 'Android signing secrets configured on GitHub.'
    }
    Write-Output "Signing backup: $backup (password encrypted for this Windows user/machine)."
    Write-Output 'Preserve the keystore and move a recoverable password copy to your password manager before relying on this identity for distribution.'
} finally { $password = $null; $securePassword = $null }
