# Chord Library 1.0.2

Android build number: 3. Windows: x64, unsigned installer.

## Changes

- Background sync stays silent when there are no library changes. Upload acknowledgments, downloads of our own edits and revision-only changes no longer refresh the homepage.
- Changed songs, setlists and recent items update in place. New items are inserted and deleted items removed without rebuilding the page. Scroll position and keyboard focus are preserved during sorting and updates; existing rows do not replay entrance animations.
- Updates to other songs leave the open chord sheet untouched. Current-song changes patch its content while preserving scroll and chord formatting. Setlist changes keep song navigation and the back label current, including repeated songs.
- Background UI updates wait for editing, dialogs, undo windows and active setlist drags. Preferences refresh only when their values change. Actual update batches receive a polite screen-reader announcement.

## Validation and installation

Local validation: all 55 Core, 58 Supabase, 18 shared-session and 21 JavaScript tests passed. All 11 browser DOM checks passed at both desktop and mobile widths. Windows Release and Android Debug builds passed with zero warnings/errors. The Windows installer passed installation, installed-file checks and uninstall. The Android APK passed signature verification with the same certificate as 1.0.1; its manifest reports version 1.0.2 and build 3. Both packages contain UI scripts matching the committed source. All five uploaded assets were downloaded again and matched their local hashes and GitHub SHA-256 digests. Release packages use the same scripts as the automated workflow.

This draft was built locally because a [GitHub Actions incident](https://www.githubstatus.com/incidents/3q1yb5m7ltvb) delayed hosted runners. The queued packaging run was canceled; hosted CI has not established a passing result for this release. Source: `56c386e447e2f5e5950d9eaeb953b955e7274743`, tag `v1.0.2`.

Install the Windows setup executable or signed Android APK. Android build 3 uses the existing release signing identity for updates from release builds 1 and 2. Development APKs use a different signature. Keep existing local data when updating; export it before any uninstall.

No new database migration is required. This remains an unpublished draft for device testing. Physical Android WebView behavior and two-device cloud synchronization still require verification before publication. Distribution remains private while the source repository is private.

Draft release: [Chord Library 1.0.2](https://github.com/Ruach-Systems/ruach-chord-keep/releases). It remains unpublished.
