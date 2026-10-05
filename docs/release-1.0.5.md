# Chord Library 1.0.5

Android build number: 6. Windows: x64, unsigned installer. This full draft includes the Android fixes from the APK-only 1.0.3 and 1.0.4 drafts.

## Changes

- Android Back dismisses dialogs, menus and the drawer before returning to the previous song, setlist or homepage. Unsaved edits retain discard protection; the app minimizes only from the ready homepage.
- Android QR scanning detaches the camera preview before handler disposal and protects cleanup after recognition, cancellation, backgrounding and image selection.
- The account sync status dot stays visible over the Google profile photo in light and dark themes.
- Includes the existing incremental sync behavior: unchanged syncs leave the homepage alone, and changed items update in place while preserving scroll and focus.

## Build and verification

The [automated Release packages run](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37377033320) succeeded and created the draft. Both packages originate from tag `v1.0.5`, source `aa69a6e4a755a8b5e5aaa9dda6018f6feedfdd7a`.

- All 55 Core, 22 shared-session/navigation, 7 native scanner and 58 Supabase tests passed. All 23 JavaScript checks passed. Windows and Android verification builds reported zero warnings/errors.
- Windows silent installation, installed-file comparisons and uninstall passed on the hosted runner. The downloaded installer's product version is 1.0.5 and its Authenticode status is `NotSigned`, as requested.
- Android APK v2/v3 signature checks passed on the runner and after downloading the asset. Certificate SHA-256 `95831c04603c22a2ff37b9873949c9b3f973213ba6bb25f6ae4e4691df223fb8` matches the earlier release identity. Manifest checks confirm app ID `com.louiejeg.chordlibrary`, version 1.0.5/build 6, minimum API 24, target API 36, ARM64/x64 support and no debuggable flag.
- Downloaded all five draft assets and verified their SHA-256 values against both the manifest and GitHub asset digests. Metadata identifies the expected source commit, version, Android build and unsigned Windows state. APK app/bridge scripts and CSS match committed source after CRLF normalization.

| Download | Bytes | SHA-256 |
| --- | ---: | --- |
| `ChordLibrary-1.0.5-windows-x64-setup.exe` | 83,405,256 | `182c131d33900e7fd18b830b318e4f9fae76474bb6c677f3b5e45585a3cf81d6` |
| `ChordLibrary-1.0.5-android.apk` | 41,604,255 | `0e04a2df837c5cacac24ed42f70246f11fe38937b02bdf25c8b490e83c782c68` |

The other downloads are `SHA256SUMS.txt`, `release-info.json` and `WINDOWS-UNSIGNED.txt`.

## Installation and remaining checks

Run the Windows setup executable. Internet is required if WebView2 is missing. The unsigned installer can show a publisher/SmartScreen warning.

Install the Android APK over the existing signed release app; do not uninstall it. Build 6 retains its signing identity. Export local data before any uninstall needed to switch from a development APK with a different signature. Updates remain manual. No new database migration is required.

Physical Android Back/gesture and QR camera behavior, Google sign-in, import and two-device synchronization remain device acceptance checks. The automated results do not replace these checks.

The repository is private; download access requires a GitHub account with access to its drafts. [GitHub release downloads](https://github.com/Ruach-Systems/ruach-chord-library/releases). The release remains an unpublished draft.
