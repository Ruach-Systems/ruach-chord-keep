$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/release-common.ps1"
foreach ($script in Get-ChildItem $PSScriptRoot -Filter '*.ps1') {
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$null, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "PowerShell parse errors in $($script.Name): $parseErrors" }
}
Assert-ReleaseVersion '1.0.0' 1
Assert-ReleaseVersion '65535.65535.65535' 2100000000
foreach ($invalid in @('v1.0.0', '1.0', '01.0.0', '65536.0.0', '1.0.0-beta', '../1.0.0', '1.0.0;whoami', "1.0.0`n")) {
    $rejected = $false
    try { Assert-ReleaseVersion $invalid 1 } catch { $rejected = $true }
    if (!$rejected) { throw "Unsafe/unsupported version accepted: $invalid" }
}
foreach ($invalid in @(0, -1, 2100000001)) {
    $rejected = $false
    try { Assert-ReleaseVersion '1.0.0' $invalid } catch { $rejected = $true }
    if (!$rejected) { throw "Invalid build number accepted: $invalid" }
}
Write-Output 'Release script syntax and version validation passed.'
