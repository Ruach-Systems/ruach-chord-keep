# Chord Library 1.0.4 — Android Back navigation and account status

Android build number: 5. This draft contains an Android APK only and includes the QR scanner cleanup fix from 1.0.3.

## Changes

- Android Back closes the current account/import dialog, application modal, menu or mobile drawer before navigating the library. Back during Google sign-in cancels the pending sign-in; an operation already saving data remains protected.
- Songs and setlists now keep navigation history. Back returns a setlist song to its setlist, then to the homepage. Opening another standalone song preserves the previous song and its scroll position. Swiping through songs within one setlist keeps the setlist as their parent.
- Back protects unsaved song/setlist forms and inline chord edits with a discard prompt. Canceling the prompt keeps the draft. Rapid Back presses are serialized; deleted screens and previous-account navigation are discarded.
- The app minimizes only when Back reaches the homepage. The native QR scanner retains its own Back handling and camera cleanup. Both hardware Back buttons and Android 13+ Back gestures use the MAUI lifecycle handler.
- The account status dot stays colored and visible over the Google profile photo in light and dark themes. Native `idle` and `error` states now have the missing styles. Tooltip and accessible button text describe sync status without exposing backend implementation names.

## Validation and installation

All 22 shared-session/navigation tests and 23 Node regression checks passed. All 17 real browser DOM checks passed at 414px and 1280px widths, covering navigation, scroll restoration, menus, drawers, dirty forms, inline edits, deleted history, account reset and status-dot appearance alongside sync behavior. Android Debug and Windows Release builds passed. Physical Android Back button/gesture and native dialog behavior still require testing on the affected phone.

Download `ChordLibrary-1.0.4-android.apk` from the draft assets and install it over the previous release APK. Do not uninstall the existing app. Test Back from a song, a setlist song, the drawer, Account & sync, import preview, a form with unsaved changes and the native QR scanner. At the homepage, Back should minimize the app.

The repository is private. Sign into an account with draft-release access on your phone to download the APK. This remains an unpublished draft for phone validation; no passing hosted CI or physical-device result is claimed.

[GitHub release downloads](https://github.com/Ruach-Systems/ruach-chord-library/releases)
