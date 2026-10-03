$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    foreach ($project in @('tests/ChordLibrary.Tests/ChordLibrary.Tests.csproj','tests/ChordLibrary.Shared.Tests/ChordLibrary.Shared.Tests.csproj','supabase/tests/ChordLibrary.Supabase.Tests.csproj')) {
        & dotnet test $project --nologo -v minimal
        if ($LASTEXITCODE -ne 0) { throw "Tests failed: $project" }
    }
    & node --test tests/bridge-tests.cjs
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
    & dotnet build src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-windows10.0.19041.0 --nologo -v minimal
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
    & dotnet build src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-android --nologo -v minimal
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    & git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }
} finally { Pop-Location }
