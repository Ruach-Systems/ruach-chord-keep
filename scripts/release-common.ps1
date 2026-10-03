$ErrorActionPreference = 'Stop'

function Assert-ReleaseVersion([string] $Version, [int] $BuildNumber) {
    if ($Version -cnotmatch '\A(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\z' -or
        @($Version.Split('.') | Where-Object { [int]$_ -gt 65535 }).Count -gt 0) {
        throw 'Version must be three numbers (for example 1.0.0), each at most 65535, without leading zeros.'
    }
    if ($BuildNumber -lt 1 -or $BuildNumber -gt 2100000000) { throw 'Build number must be between 1 and 2100000000.' }
}

function Assert-NativeSuccess([string] $Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Get-ReleaseDirectory([string] $Platform, [string] $Version) {
    $root = Split-Path -Parent $PSScriptRoot
    $path = Join-Path $root "artifacts/release/$Version/$Platform"
    # Never mix files from different publishes or silently overwrite a release.
    if (Test-Path -LiteralPath $path) { throw "Output already exists: $path. Use a clean checkout or a new version." }
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}
