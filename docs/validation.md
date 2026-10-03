# Validation — October 3, 2026

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
