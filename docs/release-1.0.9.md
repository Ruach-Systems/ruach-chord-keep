# ChordKeep 1.0.9

Windows x64 and Android update. Android build number: **10**.

## Changes

- Introduces the approved ChordKeep Royal Folio icon, splash screen and RUACH light/dark interface, with bundled Inter and Manrope fonts.
- Keeps the song title clear by omitting the product emblem from the top bar when viewing or editing a chord sheet.
- Improves dialog secondary-button visibility, Preferences icon alignment, account-menu hover/focus styling and import/export icons.
- Retains the chord-sheet border during scrolling and improves bracketed annotation readability in both themes.
- Displays a check icon for songs already added to a setlist.
- Makes mobile chord palettes shorter and scrollable in both editors, adapting to the visible viewport above the keyboard while preserving the draft and insertion point.
- Updates repository references to `Ruach-Systems/ruach-chord-keep`.

## Upgrade compatibility

The Android application ID, release signing key, Windows installer AppId, authentication callbacks and local storage identifiers remain unchanged. Install this update over the existing release installation. Windows setup reuses the existing installation directory and replaces the old Start-menu shortcut. Export a backup before upgrading; do not uninstall simply to change the app name.

The Windows installer remains unsigned by the owner's instruction. Android uses the existing release signing identity. Downloads are named `ChordKeep-1.0.9-windows-x64-setup.exe` and `ChordKeep-1.0.9-android.apk`.

## Validation and distribution

The manual release workflow runs the automated tests, builds both platforms, verifies Windows installation/uninstall and Android signing, and creates checksums and an unpublished draft. Its successful completion must be verified before using the packages.

Local browser validation for the mobile palette passed 13 checks at 320px, 414px and reduced-height 414×360, including simulated overlay keyboards in both editors. The desktop palette suite and 24 phone sync/navigation checks passed. Physical Android keyboard, launcher appearance and signed-installation upgrade validation remain separate from browser/build checks.

[GitHub releases and downloads](https://github.com/Ruach-Systems/ruach-chord-keep/releases). Repository access is required. Publishing this draft and future releases each require a separate instruction.
