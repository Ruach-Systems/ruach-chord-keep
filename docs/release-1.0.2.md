# Chord Library 1.0.2

Android build number: 3. Windows: x64, unsigned installer.

## Changes

- Background sync stays silent when there are no library changes. Upload acknowledgments, downloads of our own edits and revision-only changes no longer refresh the homepage.
- Changed songs, setlists and recent items update in place. New items are inserted and deleted items removed without rebuilding the page. Scroll position and keyboard focus are preserved during sorting and updates; existing rows do not replay entrance animations.
- Updates to other songs leave the open chord sheet untouched. Current-song changes patch its content while preserving scroll and chord formatting. Setlist changes keep song navigation and the back label current, including repeated songs.
- Background UI updates wait for editing, dialogs, undo windows and active setlist drags. Preferences refresh only when their values change. Actual update batches receive a polite screen-reader announcement.

## Validation and installation

Local validation: 18 shared-session tests, 21 JavaScript tests and all 11 browser DOM checks at both desktop and mobile widths passed. Windows Release and Android Debug builds passed with zero warnings/errors. The release workflow also runs Core/Supabase tests, builds both platforms, checks Windows installation/uninstall, and verifies package metadata and checksums before creating the draft.

Install the Windows setup executable or signed Android APK. Android build 3 uses the existing release signing identity for updates from release builds 1 and 2. Development APKs use a different signature. Keep existing local data when updating; export it before any uninstall.

No new database migration is required. This remains an unpublished draft for device testing. Physical Android WebView behavior and two-device cloud synchronization still require verification before publication. Distribution remains private while the source repository is private.
