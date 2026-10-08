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

Release packaging and download verification are pending. Physical Android verification remains separate from browser and build checks. This release is prepared as an unpublished draft; publication and future releases require separate instructions.
