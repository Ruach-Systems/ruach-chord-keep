# Chord Library 1.0.6

Android build number: 7. Windows: x64, unsigned installer.

## Changes

- Sync checks for updates immediately on startup, returning to the app and reconnection. Saved local edits/imports request sync, and the header now offers Refresh library with progress. Periodic cloud polling is removed; use Refresh to receive another device's changes while the app remains active.
- Incremental cloud downloads and automatic latest-update-wins behavior remain in place. Downloaded updates wait for active editing/dialog/undo/drag interactions to finish, then update affected items without another cloud poll or a full page redraw.
- The drawer toggle animates between hamburger and X. Setlist icons are simpler and consistent. Drawer song search matches only title and artist, excluding lyrics/chords.
- Removed the inaccurate automatic Key badge. Transposition remains available.
- Both inline and song-popup quick-symbol controls retain editor focus and caret, avoiding the keyboard refocus that can reset mobile Caps Lock.
- Retains the earlier Android QR cleanup, Back navigation and account-status indicator fixes.

## Build and verification

The [Release packages run 37416308010](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37416308010) succeeded and created an unpublished draft. Both packages originate from tag `v1.0.6`, source `25bf1bfdd1b59b49ff12fdee3861a842729ee2b5`, containing application changes from `50acc52` and the explicit release-instruction policy.

- All 148 .NET tests passed: 55 Core, 28 shared-session/navigation/sync, 7 native scanner and 58 Supabase tests. All 25 JavaScript checks passed. Windows and Android validation builds reported zero warnings/errors.
- Windows silent installation, installed-file comparisons and uninstall passed on the hosted runner. The downloaded installer's product version is 1.0.6; its Authenticode status is `NotSigned`, as requested.
- Android APK v2/v3 signature verification passed on the runner and after download. Certificate SHA-256 `95831c04603c22a2ff37b9873949c9b3f973213ba6bb25f6ae4e4691df223fb8` matches the previous release identity. Manifest checks confirm app ID `com.louiejeg.chordlibrary`, version 1.0.6/build 7, minimum API 24, target API 36, ARM64/x64 support and no debuggable flag.
- Downloaded all five draft assets and verified their SHA-256 values against the manifest and GitHub asset digests. Build metadata identifies the expected source commit, version, Android build and unsigned Windows state. Bundled APK app/bridge scripts and CSS match the tagged source after CRLF normalization.

| Download | Bytes | SHA-256 |
| --- | ---: | --- |
| `ChordLibrary-1.0.6-windows-x64-setup.exe` | 83,417,139 | `756741b3612a80f05793a852f010900819ebfdbb01d1887e749dd0affeb54479` |
| `ChordLibrary-1.0.6-android.apk` | 41,637,023 | `ff56f29f4af2ec3b9fd2fc0cba61ddbcb97963f8e98ea7750872f00c2c895f5b` |

Other assets: `SHA256SUMS.txt`, `release-info.json` and `WINDOWS-UNSIGNED.txt`.

## Installation and remaining checks

Run the Windows setup executable. Internet is required if WebView2 is missing. The unsigned installer can show a publisher/SmartScreen warning.

Install the Android APK over the existing signed release app; do not uninstall it. Build 7 uses the existing release signing identity. Export local data before any uninstall needed to switch from a development APK with a different signature. No new database migration is required.

Physical Android Caps Lock with quick-symbol taps, app foreground/reconnection triggers, QR camera and Back/gesture behavior, Google sign-in, real-data import and two-device synchronization remain device acceptance checks. Automated checks do not replace them.

The repository is private; download access requires a GitHub account with access to its drafts. [GitHub release downloads](https://github.com/Ruach-Systems/ruach-chord-library/releases). Keep this release an unpublished draft. Future release generation requires a new explicit user instruction.
