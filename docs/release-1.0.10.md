# ChordKeep 1.0.10

Windows x64 and Android update. Android build number: **11**.

## Changes

- Shows the installed app version below Account & sync in the account menu.
- Improves success, error and information toast readability in both themes with opaque tinted surfaces and theme text colors. Corrects the Undo button's foreground color.
- Restores the More and Home buttons immediately when a newly added song opens, using the same reader controls as songs selected from the library.
- Removes superseded logo concept boards from the active Royal Folio identity kit, preserving the approved artwork and matching the RUACH parent catalog.

## Upgrade compatibility

The Android application ID, release signing identity, Windows installer AppId, authentication callbacks and local storage identifiers remain unchanged. Install over the existing app; do not uninstall to upgrade. Export a backup before upgrading.

The Windows installer remains unsigned as requested. Android uses the existing release signing identity. Download names are `ChordKeep-1.0.10-windows-x64-setup.exe` and `ChordKeep-1.0.10-android.apk`.

## Validation and distribution

Phone-width and desktop browser suites passed all 14 checks, including creating a song from Home, opening More and returning Home. Success, error, information and neutral toast text contrast exceeded 11:1 in both themes; Undo exceeded 5:1. Windows Debug builds and JavaScript syntax/whitespace checks passed. Android compilation of the version-label change passed with no warnings or errors.

[Hosted Verify run 37800322785](https://github.com/Ruach-Systems/ruach-chord-keep/actions/runs/37800322785) passed all 159 .NET tests, 30 JavaScript tests and both native builds with zero warnings or errors.

[Release packages run 37800353956](https://github.com/Ruach-Systems/ruach-chord-keep/actions/runs/37800353956) succeeded at source commit `bdae9a1311f151e22edaf5e7858c5282d5d52c3b`, tag `v1.0.10`. Windows silent installation, installed-file checks and uninstall passed. Android APK signature schemes v2/v3 passed.

All five uploaded assets were downloaded and checked against the SHA-256 manifest. Source/version/build metadata matched; Windows setup was unsigned as requested. The APK retains application ID `com.louiejeg.chordlibrary`, version `1.0.10`, build number `11`, label `ChordKeep` and the existing release signing certificate.

[Download the 1.0.10 draft](https://github.com/Ruach-Systems/ruach-chord-keep/releases/tag/untagged-82f60d5de45c7ce57d4b). Repository access is required. Physical Android verification remains separate from browser and build checks. This release remains an unpublished draft; publication and future releases require separate instructions.
