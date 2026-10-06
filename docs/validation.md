# Validation

## Automated draft 1.0.6 — October 6, 2026

- [Release packages run 37416308010](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37416308010) succeeded and created an unpublished draft with the unsigned Windows x64 installer and signed Android APK. Tag `v1.0.6` points to `25bf1bfdd1b59b49ff12fdee3861a842729ee2b5`; Android build number is 7. It includes the event-driven sync and mobile editor refinements below.
- All 148 .NET tests and 25 JavaScript checks passed. Windows/Android validation builds had zero warnings/errors. Hosted Windows installation, installed-file comparison and uninstall passed; Android v2/v3 signature verification passed.
- Downloaded all five assets and verified SHA-256 checksums, GitHub asset digests, version/build/source metadata, Windows installer version/signature state, APK manifest/signing identity and bundled UI source. See [1.0.6 release notes](release-1.0.6.md) for hashes and remaining device acceptance checks. No hosted migration or publication was performed.
- Release generation is allowed only on an explicit user instruction for each release. The manually dispatched workflows and repository `AGENTS.md` retain that policy.

## Event-driven refresh and mobile editing refinements — October 6, 2026

- Replaced the native 25-second cloud timer with sync requests on startup, foreground/resume, restored connectivity, durable local saves/imports and explicit Refresh library. Requests coalesce and serialize, retaining one follow-up for changes saved during sync. Existing incremental checkpoints and latest-update-wins conflict behavior remain in use. Downloaded updates held behind editor/modal/undo/drag guards appear when the interaction finishes, without another cloud poll. Unchanged snapshots retain the displayed rows and sheet.
- Added an animated hamburger/X drawer toggle and a simpler consistent setlist icon. Drawer song search now matches only title and artist. Removed the automatic first-chord Key badge while preserving transposition. Both inline and popup quick-symbol controls avoid blurring an already-focused editor, retain selection and use native text insertion where available.
- All 28 shared Release tests passed, including scheduler serialization/coalescing/retry/disposal, reconnect signals, startup/manual incremental downloads and offline-edit upload on reconnection. All 25 Node checks passed, including durable-save ordering, manual refresh coalescing and deferred UI delivery. All 22 browser checks passed at both 414px and 1280px with the shipped assets and synthetic offline data. Quick-symbol checks verify insertion, caret and zero blur in both editors; they do not emulate an Android keyboard.
- Windows Release, Android Debug and browser-preview Release builds passed with zero warnings/errors. Mobile screenshots are saved under `artifacts/evidence/`. No Supabase migration or hosted data changes were required. These changes are included in draft 1.0.6 and require installation of its new package; they are not part of the older 1.0.5 draft.
- Physical Android keyboard Caps Lock, app foreground/reconnection triggers and two-device cloud behavior still require device acceptance checks. While the app remains foregrounded without local edits, another device's changes are received through Refresh library; no periodic polling or realtime subscription is active.

## Automated draft 1.0.5 — October 6, 2026

- [Release packages run 37377033320](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37377033320) succeeded and created an unpublished draft with the Windows x64 installer and signed Android APK. Tag `v1.0.5` points to source `aa69a6e4a755a8b5e5aaa9dda6018f6feedfdd7a`; Android build number is 6. The previous 1.0.3/1.0.4 Android fixes are included for both platforms where applicable.
- All 142 .NET tests and 23 JavaScript checks passed. Windows and Android validation builds reported zero warnings/errors. Hosted Windows installation, installed-file checks and uninstall passed; Android v2/v3 signature verification passed.
- Downloaded all five uploaded assets and verified checksums and GitHub digests, source/version/build metadata, unsigned Windows product version, APK manifest and matching release certificate. Bundled APK UI scripts and CSS match tagged source after CRLF normalization. See [1.0.5 release notes](release-1.0.5.md) for package hashes and installation instructions.
- No database migration or public/store publication was performed. Physical Android Back/gesture and QR scanning, Google sign-in, import and two-device synchronization remain device acceptance checks.

## Android Back navigation — October 6, 2026

- The library is rendered inside a single native page, so Android's default navigation did not traverse its song/setlist views. Added a MAUI Android lifecycle Back handler, a registered shared UI callback and JavaScript view history. The pinned [MAUI 10.0.20 activity implementation](https://github.com/dotnet/maui/blob/10.0.20/src/Core/src/Platform/Android/MauiAppCompatActivity.Lifecycle.cs) routes hardware Back and Android 13+ Back gestures through this lifecycle event.
- Back dismisses native account/import overlays and the top application dialog/menu/drawer first. Unsaved song/setlist forms and inline chords retain discard prompts. A setlist song returns to its parent setlist; standalone songs restore the prior song and scroll. Deleted historical screens are skipped and account changes clear history. Only an unhandled Back at the ready homepage moves Android's task into the background. Pending requests are serialized; UI errors are logged and do not grant permission to exit. Native QR modal Back stays with the scanner.
- All 22 shared tests passed in Release mode, including four new tests for loading/disposal, repeated presses, replacement components and failed-dispatch recovery. All 23 Node tests passed. All 17 real browser DOM checks passed at 414px and 1280px, including five navigation checks, the account badge check and the existing incremental-sync suite. `tests/ui-sync.html` reproduces these checks with offline synthetic data; assets receive per-run cache-busting to avoid testing stale browser files.
- The native account updater emits `idle` and `error`, while CSS only colored the earlier `synced` and `sync-error` names. Added matching styles and explicit stacking above the avatar, preserving the existing dot size/position. Verified colored, unclipped dots in light/dark themes for idle, syncing, error and offline states with a visible avatar. Button accessibility labels and tooltips use user-facing sync text.
- Android Debug compilation passed with zero warnings/errors. Physical phone button/gesture behavior, Account & sync/import overlays and native scanner routing remain device acceptance checks. Release packaging evidence is recorded after verification in [1.0.4 release notes](release-1.0.4.md).
- Windows Release and Android Release packaging passed with zero warnings/errors. Verified Android APK v2/v3 signatures using the existing release certificate, version 1.0.4/build 5, expected app ID/API levels/ABIs and no debuggable flag. APK app/bridge scripts and CSS match working-tree bytes and the tagged source after CRLF normalization. The local APK is 41,604,255 bytes, SHA-256 `0a4442a99bbdd14dd0b0c5b47b034e8fdd1c4e533d12e234ccfee24ebeee3f10`, from source `f19e143bf66899adeece172f54f7b75b12c16e04`.

## Android QR scanner cleanup fix — October 6, 2026

- Investigated the reported app exit immediately after recognizing a QR code. The scanner disconnected its handler before removing the preview from the layout. The pinned ZXing handler disposes Android's native `PreviewView` during disconnection, leaving a disposed view attached during removal. Camera cleanup also ran outside the completion method's exception handler and could escape an `async void` scan callback.
- Changed cleanup to stop detection, detach the preview, then disconnect the captured handler. Each cleanup operation is protected independently so an error cannot prevent the remaining release steps or discard a recognized result. Removed the unnecessary torch write during shutdown, protected scanner completion, and replaced asynchronous event lambdas with bounded task methods. Release logs use the `ChordLibrary.QR` tag and do not contain QR payloads.
- Added a platform-neutral native-page test project using the actual scanner source and real MAUI controls with a simulated native handler. All seven Release tests passed: detach-before-release, detection/disconnection failures, duplicate completion, cancellation, background cleanup and image-picker result return after a camera-release failure. The same tests against the previous source fail five cases, including the disposal order and escaped cleanup exceptions. `scripts/verify.ps1` now includes this suite.
- Published a local Android Release test APK, version `1.0.3` / build `4`, with no build warnings/errors. File: `artifacts/release/1.0.3/android/ChordLibrary-1.0.3-android.apk` (41,243,866 bytes; SHA-256 `21df2ff25fd19a16eba94f0bff39081e4497d66ab05e25de62466435b6a680dc`). APK v2/v3 signatures passed verification; the certificate SHA-256 `95831c04603c22a2ff37b9873949c9b3f973213ba6bb25f6ae4e4691df223fb8` matches the earlier release. Manifest checks confirm app ID `com.louiejeg.chordlibrary`, minimum API 24, target API 36, ARM64/x64 support and no debuggable flag. The user requested a phone-accessible download; draft 1.0.3 is prepared with [Android test release notes](release-1.0.3.md).
- No Android device is connected. These tests establish cleanup behavior, not physical camera or phone crash confirmation. The user still needs to install the patched APK and test recognition, repeated scanner use, cancellation, background/resume and QR image selection on the affected phone.

## Draft 1.0.2 packages — October 6, 2026

- Created [unpublished draft 1.0.2](https://github.com/Ruach-Systems/ruach-chord-library/releases), release ID `404082300`, from tag `v1.0.2` / source `56c386e447e2f5e5950d9eaeb953b955e7274743`. Android build number 3; Windows x64 installer unsigned as requested.
- GitHub reported a [hosted-runner incident](https://www.githubstatus.com/incidents/3q1yb5m7ltvb). Canceled the queued packaging run `37370505860` and used the repository's local release scripts. At draft creation, verification run `37370505201` was still queued; no passing hosted CI result is claimed.
- All 55 Core, 58 Supabase, 18 shared-session and 21 JavaScript tests passed locally. Windows installation, installed-file checks and uninstall passed using an isolated temporary destination. The existing portable app was not replaced.
- The Android publish completed; the verification batch command encountered an invalid pre-existing `JAVA_HOME`. Recovered verification using installed Java 21 with a process-scoped override, restored the previous setting, then copied the verified signed APK. Its version name/code are `1.0.2` / `3`; certificate SHA-256 `95831c04603c22a2ff37b9873949c9b3f973213ba6bb25f6ae4e4691df223fb8` matches downloaded release 1.0.1.
- Confirmed bundled app, bridge, loader and view-update scripts match committed source in both Windows publish files and Android APK entries. Downloaded all five draft assets after upload and verified their bytes against local files and GitHub digests. Package metadata identifies the expected source commit, Android build number and unsigned Windows status. SHA256SUMS covers both packages, release-info and the unsigned-Windows notice.
- Remaining device/cloud checks are listed in the release notes. No new database migration was applied.

## Incremental UI reconciliation — October 6, 2026

- Snapshot differences select only affected collections and views. Keyed list reconciliation retains song/setlist/home-row DOM identity, including repeated songs in a setlist, and patches changed attributes/text. Current-song chord content is patched without replacing its whole container; unrelated changes never render that sheet.
- Scroll anchors and keyboard focus survive inserts and re-sorting, including the `insertBefore` fallback for WebViews without `moveBefore`. A focused deleted row transfers focus to a neighbor (or the empty list). Preferences refresh only when their stored values actually change. Active drags defer snapshot delivery, alongside existing editor/modal/undo guards. Screen-reader sync announcements use a separate polite status region; retained rows do not replay entrance animations.
- All 21 Node regression checks and all 18 shared-session tests passed. All 11 DOM checks passed at both 1280px and 414px widths, including the older-WebView movement fallback and preservation of chord whitespace. The browser fixture runs the shipped markup/scripts with synthetic offline data, checking zero no-change content mutations, untouched-row mutations/identity, inserts/sorts, search, focus/scroll, chord selection/content, duplicate rows, navigation, drag deferral, deletions and account resets.
- Reproduce DOM checks by serving the repository root and opening `tests/ui-sync.html`; use both the desktop and mobile buttons. This fixture never signs in or accesses Supabase. Responsive browser checks do not establish physical Android WebView or two-device cloud behavior.
- Windows Release and Android Debug builds passed with zero warnings/errors. `git diff --check` passed and no unmerged paths were found.
- These changes are included in unpublished draft 1.0.2, built from source commit `56c386e447e2f5e5950d9eaeb953b955e7274743`.

## Unchanged sync keeps the displayed page — October 5, 2026

- Ordinary snapshot delivery now compares the saved library with the view's existing baseline. Empty syncs, upload acknowledgments, downloads of our own unchanged edits, and changes only to server revisions do not call the JavaScript snapshot replacement that redraws the homepage. Comparison ignores JSON whitespace, property order and normalization of legacy defaults.
- Sync revisions still advance, and changes downloaded while the UI was busy remain deliverable on a later sync even if that later download is empty. Failed UI delivery retains the prior baseline for retry. Account sign-in/sign-out continue to force their required UI reset.
- All 18 shared-session regression checks passed, including six new checks for no-change intervals, upload echoes, deferred updates, unchanged payloads with newer revisions, failed delivery retries and forced resets.
- Windows Release and Android Debug builds passed with zero warnings/errors. `git diff --check` passed and no unmerged paths were found.
- The existing 1.0.1 draft release predates this fix. Device runtime behavior has not been tested with this change.

## Mobile drawer and Google account photo — October 4, 2026

- The mobile drawer and its backdrop now sit inside `.app-main`, below the header in normal layout. Native CSS overrides the original fixed viewport offset; desktop keeps its existing persistent drawer. A browser fixture using the shipped HTML/CSS verified a 360px mobile viewport with a 28px safe area and 72px header: header bottom, drawer top, and tab top were all 100px. At 1024px, the drawer also began at 100px and remained 280px wide. This is browser layout evidence, not an Android screenshot.
- Auth sessions preserve Google display name and avatar/picture metadata. The account icon uses HTTPS Google profile photos, shows the default icon until loading succeeds, and falls back if a photo is unavailable. Sign-out removes the photo. Existing saved sessions from older builds gain profile metadata on their next token refresh or sign-in.
- 58 Supabase, 12 shared-session and 15 JavaScript checks passed, including profile metadata variants, session restore, malformed metadata, image failure, URL filtering and sign-out cleanup.
- Final Windows Release and Android Debug builds, including the drawer, profile photo and QR changes, passed with zero warnings/errors. `git diff --check` passed and no unmerged paths were found. These changes are local and are not yet included in a published installer or GitHub release.

## Android QR import — October 4, 2026

- Replaced the photo-capture intent with an Android-only native live scanner using [ZXing.Net.Maui](https://github.com/Redth/ZXing.Net.Maui), pinned to 0.10.4. The scanner automatically reads QR codes into the existing song form; saving remains explicit. It also offers a system image file picker, including when camera permission is denied. No image is uploaded to a server.
- The camera is disconnected on close, background, and image-picker transitions; duplicate/late camera callbacks are ignored. Image decoding runs off the UI thread and supports rotated/inverted codes. Invalid images leave the scanner open with a useful message.
- QR import is hidden by default and enabled only by the Android platform capability. Windows and browser preview cannot invoke either QR import bridge operation. QR sharing remains available on desktop.
- All 14 JavaScript regression checks passed, including platform visibility/dispatch, compact QR payloads, cancellation, invalid QR data and scanner errors.
- No Android phone/emulator was connected (`adb devices` returned an empty list), so live camera and Android file-picker behavior remain unverified on hardware. The existing installer/draft release has not been replaced.

Device acceptance checks for this change:

1. Open Add song → QR code on Android, allow the camera, and point it at a shared song QR. Verify continuous preview with no shutter screen, automatic return to the populated song form, and correct title/artist/chords after saving. Repeat with a dense chord sheet and a rotated code.
2. Choose QR image and select a PNG/JPEG or screenshot from Files. Verify the same draft import; test an image without a QR and cancelling the picker, then scan again.
3. Deny camera permission and confirm image import still works. Enable permission in Android settings and return; verify scanning resumes.
4. Background/resume the scanner, close with Cancel and Android Back, and reopen. Verify the camera privacy indicator turns off after closing and each scan imports only once.
5. On Windows, verify Add song has no QR import button and an existing song can still display its sharing QR.

## Incremental sync — October 4, 2026

- Downloads now persist separate song/setlist checkpoints per account and project. Each checkpoint and its merged record are written atomically; interrupted downloads resume from the last committed record. Upload acknowledgments cannot skip intervening changes from other devices.
- Latest `updatedAt` wins automatically for edits and deletions, with the cloud version winning ties. Targeted reads handle stale local timestamps, revision checks retry concurrent writes, and repeated races leave work pending for the next automatic sync. The account dialog no longer offers conflict decisions.
- 134 automated checks passed: 55 Core, 55 Supabase transport/auth, 12 shared-session, and 12 JavaScript tests. New coverage includes no-change downloads, restart/resume, legacy profiles, account isolation, tombstones, failed validation, update/deletion ordering, edits during upload, and bounded retries.
- Windows Release and Android Debug builds passed with zero warnings/errors. These local outputs include the incremental sync and simplified account dialog; the earlier installer/draft release has not been replaced. The running Windows Debug process was left open with its existing build and data.
- Existing profiles without a checkpoint require one baseline download after upgrading. Subsequent syncs are incremental. No new hosted schema migration is required. These checks use synthetic data and do not replace live two-device validation.
- Google provider enablement and a redirect to Google's authorization endpoint with the configured callback were verified on October 4. The original release evidence below describes the earlier build.

## Original build — October 3, 2026

## Release automation validation

- Added push/PR verification and manually dispatched GitHub draft-release workflows. Workflow syntax passed actionlint 1.7.12; PowerShell parsing and valid/invalid release-version checks passed.
- [GitHub Verify run 37132373447](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37132373447) passed on a hosted Windows runner at commit `eb5f0e4`, including release-script validation, the existing test suites and both native platform builds.
- The package job in [Release packages run 37132171911](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37132171911) passed at commit `8eeb50c`, building both release packages and verifying the Android certificate against the local signing identity. Initial draft creation failed with GitHub HTTP 403 on the older workflow-changing commit. Version `v1.0.0` was tagged at that exact commit; the corrected draft workflow omits the stale target commit argument and uses the verified existing tag.
- [Draft recovery run 37134328351](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37134328351) passed after validating build provenance, tag/commit, release metadata and every artifact checksum. It created the private **draft** version `1.0.0` with a Windows installer, signed Android APK, metadata and checksums. The original failed run remains visible in history; no build failure was bypassed. The new early tag-preparation stage is linted; it has not yet been exercised by a fresh full release run.
- Published a local self-contained Windows x64 Release build and compiled the unsigned Inno Setup installer (83,412,938 bytes). Silent installation, installed executable/runtime/web-asset hash checks, uninstall registration and silent uninstallation passed. No release UI/authentication claim is inferred from these installation checks.
- Published a local Android Release APK (40,314,770 bytes). Android apksigner verified APK v2/v3 signatures with the permanent Ruach Systems key. Package metadata confirms `com.louiejeg.chordlibrary`, display version `1.0.0`, version code `1`, minimum API 24, target API 36, ARM64/x64 libraries and no debuggable flag. Shared JavaScript assets are present. Device runtime remains unverified.
- Android signing secrets were configured in the private GitHub repository. The local key/password backup is ignored by Git, with its password encrypted using Windows DPAPI. A portable external backup is still the owner's responsibility.
- The user selected unsigned Windows installers for initial distribution. Trusted Windows signing remains optional and has not been exercised with a production certificate.

See [release instructions](releases.md) for workflow controls, signing setup and the manual publication step.

Source inspected: `louieje-g/chordlibrary` commit `230ad36e863f3175438a92520b3a567d516c2afe`. The original checkout remains unmodified. This report distinguishes completed checks from release work still requiring credentials or devices.

## Automated checks

| Suite | Passed | Main coverage |
| --- | ---: | --- |
| Core | 38 | v1/v2 exports, playlists, lossless fields, limits, timestamp conversion bounds, atomic storage, tombstones, imports, stale edits and conflicts |
| Shared session | 12 | account/project separation, displayed snapshot merges, background refresh and revision handling |
| Supabase transport/auth | 46 | HTTP contracts, token rotation, PKCE, email links/codes, pagination, conflicts, account-change races and foreign-key dependency ordering |
| JavaScript | 12 | chord grammar, transpose bounds, QR, persistence retries, account reset and keyboard navigation |
| Total | 108 | No skipped tests |

Windows (`net10.0-windows10.0.19041.0`), Android (`net10.0-android`) and the local preview compile with zero warnings and errors. Android embeds all managed assemblies and includes the shared app script; APK contents were inspected for both arm64 and x64 assemblies. The copied 96,039,045-byte APK has SHA-256 `FC0DBA3A100F0722978A6770E404259DF7E73C6632EEFEEE0F5E442C6FE71D3A`. Outputs are development builds, not store releases. Run `scripts/verify.ps1` to repeat the checks.

## Observed UI behavior

- The Windows executable launched and rendered the native BlazorWebView, original library layout and new Account & sync dialog. This was a startup/render check; native file pickers, sharing, camera and authentication were not exercised.
- In the shared UI preview, created and edited a synthetic song, transposed it by two semitones and reloaded it successfully. Slash basses transpose while the lyric `Amazing` remains unchanged.
- Imported the synthetic original v1 export through the UI. The preview showed two songs and one playlist before committing; the resulting library contained the expected records.
- Opened the imported setlist in its saved order (second song, first song), confirmed saved transpose/two-column preferences, and navigated from position 1/2 to 2/2 with ArrowRight.
- Saved screenshots under ignored `artifacts/evidence`. The browser viewport override did not change the reported 826 px viewport, so phone-width browser validation is not claimed.
- No Android device/emulator was attached. Android package compilation succeeded; device runtime remains unverified.

## Hosted Supabase checks

With the user's setup approval, used the Chrome account for project `ykfmjwlouvbapzqlqczw` (Chord Library, Muzaki). The in-app browser's separate Supabase account was not used for these changes.

- Applied `supabase/migrations/001_library.sql` successfully: owner-scoped JSON documents, select RLS, denied direct writes and revision-checked write RPC.
- Then applied `002_relational_library.sql` to convert active storage to typed `songs`, `setlists` and ordered `setlist_songs` tables, with compound owner foreign keys. The old document table is archived privately; `library_documents` is a read-only view.
- Applied forward fix `003_account_delete_cascade.sql` after the hosted regression detected an account-deletion cascade ordering issue. It changes physical song/membership cleanup; ordinary app tombstones remain unchanged.
- Reran `002_relational_tests.sql` successfully against the live schema: physical table types, ordered joins/repeats, timestamp boundaries/defaults, unknown-only metadata, CAS/retries, invalid membership rollback, direct-write denial, RLS/view isolation, private archive restrictions, and deleting each fixture account without affecting the other. The final transaction statement rolled back its fixtures. Evidence: `artifacts/evidence/supabase-relational-tests-passed.jpg`.
- Saved redirects `http://127.0.0.1:54179/callback/*` and `chordlibrary://auth/callback*`.
- Ran the SQL security script in a rollback transaction. It passed owner isolation, anonymous/direct-write denial, idempotent retries, conflicts, insert-only collisions, preserved JSON and tombstones. Final counts were zero fixture users and zero fixture documents. Sequence values can advance despite transaction rollback.
- A public-key-only REST read returned HTTP 401 / PostgreSQL code `42501` (permission denied), confirming anonymous clients cannot read the table.
- Email auth and email confirmation are enabled. Google sign-in is disabled and requires valid provider credentials. Credentials must be configured in the dashboard, never embedded in the app.
- Recovery template editing is blocked by the dashboard's current plan/SMTP requirements. No plan or SMTP settings were changed. The app instead accepts the original default signup/recovery email link; optional emailed recovery codes also work if configured later.

## Remaining release checks

1. Configure Google OAuth credentials and verify Windows/Android callbacks with an actual sign-in.
2. Configure suitable email delivery for the intended users; verify real signup confirmation, recovery and expired/used links. [Supabase's default email service](https://supabase.com/docs/guides/auth/auth-smtp) has recipient/rate restrictions.
3. Verify two-device cloud synchronization, offline edits/deletes, conflicts, sign-out/relaunch, native pick/share and QR photo/image workflows on Windows and Android.
4. Import an actual user's complete Firebase JSON export into their authenticated Supabase account and compare songs, lyrics, transpose values and playlist order. No private export was supplied or migrated during this task. Firebase auth credentials are outside the export format.
5. Choose production signing identities and package/distribute release builds after device checks.

Hosted SQL checks used synthetic, transaction-only identities. They do not establish live authentication or end-to-end device synchronization readiness.
