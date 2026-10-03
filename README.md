# Chord Library — .NET MAUI Blazor Hybrid

Windows and Android native app mirroring louieje-g/chordlibrary at commit `230ad36e863f3175438a92520b3a567d516c2afe`.

The original HTML, CSS, icons and chord-sheet interaction engine are retained in a shared Razor component. MAUI hosts it in BlazorWebView; C# provides durable offline storage, validated migration, Supabase authentication and conflict-aware synchronization. This is a native MAUI application with bundled assets, not a browser shortcut to the old website.

## Open or run

For installable packages, use **Actions → Release packages → Run workflow**. It creates a draft release with a Windows installer and signed Android APK. See [release setup and distribution](docs/releases.md) for signing, downloads and updates.

Open `ChordLibrary.slnx` in Visual Studio with the .NET MAUI workload. Select `ChordLibrary.Native` and Windows Machine or your Android device.

```powershell
# Windows
 dotnet build src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-windows10.0.19041.0
# Android debug APK
 dotnet build src/ChordLibrary.Native/ChordLibrary.Native.csproj -f net10.0-android
# Shared UI preview, local development only
 dotnet run --project src/ChordLibrary.Preview --no-launch-profile
```

The preview binds only to `http://127.0.0.1:5288`. It uses the same Razor/JS/CSS and Core services, with a separate `.local/preview-library` folder. Native features (secure storage, file sharing, QR photo capture and Google callbacks) belong to the MAUI host. Preview credentials exist only in its circuit memory; the preview is not intended for hosting.

Native Windows output is under `src/ChordLibrary.Native/bin/Debug/net10.0-windows10.0.19041.0/win-x64/`. The signed **development** Android APK is `src/ChordLibrary.Native/bin/Debug/net10.0-android/com.louiejeg.chordlibrary-Signed.apk`; this build is also copied to `artifacts/packages/ChordLibrary-Android-debug.apk`. Android assemblies are embedded so the APK does not depend on Visual Studio fast deployment. Android release publishing requires your own signing identity. Windows needs WebView2 and the MAUI Windows runtime dependencies.

## Supabase and existing data

The public connection you supplied for project `ykfmjwlouvbapzqlqczw` is bundled in `src/ChordLibrary.Shared/Assets/supabase-public.json`. It contains only the project URL and publishable key. Account & sync can override it on a device. Native refresh tokens are kept in MAUI SecureStorage; they never enter JavaScript, export files, or the library JSON.

The approved schema and Windows/Android redirect URLs are installed in your project; hosted access-isolation and conflict checks passed. Google sign-in still needs provider credentials in Supabase. Follow [Supabase setup](supabase/README.md) for provider settings and email delivery. Signup confirmation and password recovery accept copied default email links; emailed codes are also supported when configured. Each Supabase project and account has a separate durable local store; logging in never silently uploads guest data.

1. In the existing Firebase app, sign in and wait for sync, then choose **Export Data**.
2. In the native app, sign in to the desired Supabase account.
3. Choose **Import Data**, select the full JSON backup, review the counts, and confirm.
4. Use **Account & sync → Sync now** and verify another signed-in device receives the library.

Version 1 `playlists`, version 2 `setlists`, legacy text IDs, ordered song references, chord text, timestamps, transpose settings and extra JSON fields are preserved. Imports merge by ID and newer update time. Invalid files fail before changing saved data. Single-song JSON and original QR payloads are also supported. QR sharing intentionally contains chords with lyrics stripped, matching the source; full JSON is the lossless migration format.

Supabase uses relational PostgreSQL storage: `songs` and `setlists` have typed columns, and `setlist_songs` stores ordered memberships with foreign keys. Dates become `timestamptz` values. The old JSON shape is accepted by the importer and reconstructed for exports/API compatibility; complete Firestore-style documents are not the active database storage. See [data mapping](docs/data-compatibility.md#postgresql-storage-after-import).

Firebase credentials are not part of the old export. Existing users sign into Supabase again, then import their library. The repository contains no private user songs. No real user's library has been migrated just by building this app.

## Offline and conflicts

Changes are saved atomically to an account-specific file before cloud synchronization. Pending edits/deletions survive restarts and connection failures. Background sync runs every 25 seconds when the source editor is idle; Sync now is also available. Remote changes do not overwrite active edits. Conflicting device revisions are shown in Account & sync with **Keep this device** / **Use Supabase** choices.

Account changes clear prior drafts, hidden content, selections and undo actions. Source transposition, layout, search, setlist editing/reorder/navigation, auto-scroll, theme and notation are retained. See [feature parity](docs/feature-parity.md) and [backup compatibility](docs/data-compatibility.md) for deliberate fixes and platform differences.

## Validation

```powershell
./scripts/verify.ps1
```

Tests cover original export compatibility, atomic storage and account boundaries, multi-device conflict cases, real-shaped Supabase HTTP requests through fake handlers, token rotation, PKCE/recovery, pagination, chord/QR logic and JS persistence retries. Supabase SQL/RLS tests are in `supabase/tests/rls_and_revisions.sql` and must be run against an authorized development database.

See `docs/validation.md` for observed build, browser and hosted results. No store release or device testing should be inferred from compilation alone.
