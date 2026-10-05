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

The preview binds only to `http://127.0.0.1:5288`. It uses the same Razor/JS/CSS and Core services, with a separate `.local/preview-library` folder. Native features (secure storage, file sharing, Android live QR scanning and image import and Google callbacks) belong to the MAUI host. Preview credentials exist only in its circuit memory; the preview is not intended for hosting.

Native Windows output is under `src/ChordLibrary.Native/bin/Debug/net10.0-windows10.0.19041.0/win-x64/`. The signed **development** Android APK is `src/ChordLibrary.Native/bin/Debug/net10.0-android/com.louiejeg.chordlibrary-Signed.apk`; this build is also copied to `artifacts/packages/ChordLibrary-Android-debug.apk`. Android assemblies are embedded so the APK does not depend on Visual Studio fast deployment. Android release publishing requires your own signing identity. Windows needs WebView2 and the MAUI Windows runtime dependencies.

## Supabase and existing data

The public connection you supplied for project `ykfmjwlouvbapzqlqczw` is bundled in `src/ChordLibrary.Shared/Assets/supabase-public.json`. It contains only the project URL and publishable key. Backend configuration is internal; Account & sync does not expose connection settings to users. Native refresh tokens are kept in MAUI SecureStorage; they never enter JavaScript, export files, or the library JSON.

The approved schema and Windows/Android redirect URLs are installed in your project; hosted access-isolation and conflict checks passed. The app offers Google sign-in only. Google provider enablement and the authorization redirect were verified on October 4, 2026; follow [Supabase setup](supabase/README.md) for provider settings. Email/password, signup confirmation and recovery controls are not exposed in the app. Each Supabase project and account has a separate durable local store; logging in never silently uploads guest data.

1. In the existing Firebase app, sign in and wait for sync, then choose **Export Data**.
2. In the native app, choose **Continue with Google** and sign in with your Google account.
3. Choose **Import Data**, select the full JSON backup, review the counts, and confirm.
4. Use **Account & sync → Sync now** and verify another signed-in device receives the library.

Version 1 `playlists`, version 2 `setlists`, legacy text IDs, ordered song references, chord text, timestamps, transpose settings and extra JSON fields are preserved. Imports merge by ID and newer update time. Invalid files fail before changing saved data. Single-song JSON and original QR payloads are also supported. On Android, Add song → QR code opens a live scanner with a Choose QR image option for files/screenshots, even when camera permission is denied. QR import is hidden on Windows and in the browser preview; QR sharing remains available. QR sharing intentionally contains chords with lyrics stripped, matching the source; full JSON is the lossless migration format.

Supabase uses relational PostgreSQL storage: `songs` and `setlists` have typed columns, and `setlist_songs` stores ordered memberships with foreign keys. Dates become `timestamptz` values. The old JSON shape is accepted by the importer and reconstructed for exports/API compatibility; complete Firestore-style documents are not the active database storage. See [data mapping](docs/data-compatibility.md#postgresql-storage-after-import).

Firebase credentials are not part of the old export. Existing users sign into Supabase again, then import their library. The repository contains no private user songs. No real user's library has been migrated just by building this app.

## Offline and conflicts

Changes are saved atomically to an account-specific file before cloud synchronization. Pending edits/deletions survive restarts and connection failures. Background sync runs every 25 seconds when the source editor is idle; Sync now is also available. Each account/project keeps separate song and setlist download checkpoints. After the initial download, only records with newer server revisions are fetched, including deletions. Existing profiles without checkpoints need one baseline download after upgrading; subsequent syncs are incremental, including after a restart. Upload acknowledgments never advance download checkpoints, so another device's intervening changes cannot be skipped.

The most recently updated song or setlist wins automatically, using its `updatedAt` Unix-millisecond timestamp for both edits and deletions. Equal timestamps keep the cloud version; there are no conflict prompts. Device clocks should be set automatically. A stale/equal local edit may fetch that one record to restore the cloud copy. Revision checks still protect against changes arriving during an upload, with bounded automatic retries and durable pending changes for the next sync. Active editor contents are not refreshed mid-edit. Sync updates the displayed library only when its contents or settings have changed. Songs, setlists and recent items are reconciled by ID: existing rows stay in place, changed text is patched, and additions/deletions affect only their rows. Background updates preserve scroll anchors and keyboard focus, do not replay entrance animations, and leave an unrelated open chord sheet untouched. Selected-song changes patch its content while retaining scroll; setlist changes keep navigation aligned. Refresh waits for edits, open dialogs, undo windows and active setlist drags. Empty syncs and upload acknowledgments are silent. A polite screen-reader status announces a batch of actual library changes.

Account changes clear prior drafts, hidden content, selections and undo actions. Source transposition, layout, search, setlist editing/reorder/navigation, auto-scroll, theme and notation are retained. See [feature parity](docs/feature-parity.md) and [backup compatibility](docs/data-compatibility.md) for deliberate fixes and platform differences.

## Validation

```powershell
./scripts/verify.ps1
```

Tests cover original export compatibility, atomic storage and account boundaries, multi-device conflict cases, real-shaped Supabase HTTP requests through fake handlers, token rotation, PKCE/recovery, pagination, chord/QR logic and JS persistence retries. Supabase SQL/RLS tests are in `supabase/tests/rls_and_revisions.sql` and must be run against an authorized development database.

See `docs/validation.md` for observed build, browser and hosted results. No store release or device testing should be inferred from compilation alone.
