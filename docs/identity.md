# ChordKeep identity

The owner accepted **ChordKeep** on 7 October 2026. Use that exact spelling and capitalization for the app, launcher, installer, account dialog and future release titles. The product belongs to **RUACH**; the parent legal identity remains Ruach Software Development Services.

**Chord + keep** expresses preserving a personal collection of chord sheets. A keep is also a castle's fortified central building, giving the name a subtle connection to the approved **Royal Folio** crown, musical notes and open-page emblem. These are design interpretations, not claims about the software or its users. The product emblem is separate from RUACH's Living Breath identity.

The authoritative [identity record](../../ruach-brand-guide/products/chordkeep/README.md) and versioned kit live in the parent brand repository. The application's [ChordKeep kit 1.2](../branding/chordkeep/README.md) is its matching integration snapshot. The previous `branding/sovereign-strings/` kit is historical. The owner selected the refined Royal Folio concept on 7 October 2026; kit 1.2 supersedes the Sovereign Strings kit 1.1. The [branding review](branding-review/index.html) now displays the approved Royal Folio in the implemented RUACH UI and its approved reference.

## Upgrade compatibility

This is a presentation rename. Existing installations must retain their identity so upgrades can access the same songs, setlists, preferences and Google sign-in session:

| Contract | Retained value |
|---|---|
| Android / MAUI application ID | `com.louiejeg.chordlibrary` |
| Assembly, executable and solution | Existing `ChordLibrary.*` names and `ChordLibrary.slnx` |
| Android authentication callback | `chordlibrary://auth/callback` |
| Windows authentication callback | `http://127.0.0.1:54179/callback/` |
| Browser preference/storage keys | Existing `chord-library-*` keys |
| SQLite paths, account partitions, backup payloads | Existing implementation and formats |
| Android release signing key and alias | Existing release identity; never rotate for a name change |
| Windows installer AppId | `{D72F1DE3-93E7-4729-BC61-5CC89143D125}` |
| Windows upgrade installation folder / menu group | Setup explicitly reuses the previous installation folder and menu group |

The Windows shortcut and uninstall display name become ChordKeep; setup removes the old shortcut in the same menu group. Fresh installations default to `Ruach Systems/ChordKeep` and the `ChordKeep` menu group; upgrades reuse their previously selected paths. Future download filenames use `ChordKeep-<version>-windows-x64-setup.exe` and `ChordKeep-<version>-android.apk`. Existing released downloads keep their historical filenames.

The name change does not require reimporting data, a Supabase migration, a new OAuth project or domain purchase. Older backups remain supported. The approval covers the product identity, not trademark registration or a legal availability guarantee.

## Validation scope

The asset builder verifies geometry, color, safe zones, fonts, dimensions, catalogs, native file structures and ZIP integrity. The application uses the final kit's MAUI icon/background/foreground, splash and header/account branding. Windows and Android compilation and existing automated tests are run separately from asset checks. Physical Android launcher appearance and an upgrade of a signed production installation still require device testing.

Release generation remains manual and requires a new explicit user request. Finalizing this name does not create or publish an app release.

Previous kit 1.1 checks on 7 October 2026: Windows and Android Debug builds passed with zero warnings/errors; 101 .NET tests and 30 JavaScript tests passed; 366 asset export checks and all 19 direct Android icon-resource compiles passed. The final header/account branding was inspected in the shared UI at desktop and 390px phone width. The updated branding proposal also loaded its final artwork without broken images or horizontal overflow in the checked current/proposed, light/dark and desktop/320px/414px scenarios. These browser checks do not establish physical-device or production-installation upgrade validation.

Royal Folio kit 1.2 checks on 7 October 2026: 369 asset export checks passed, all 19 direct Android resources compiled, and all six vector PDF masters rendered without clipping. Windows and Android Debug builds passed with zero warnings/errors. All five generated MAUI Android foreground densities stay inside the 33dp safe radius. The branding review loaded its current artwork correctly; the earlier account previews were checked in dark at 414px and light at 320px without horizontal overflow. These are local build/export/browser checks, not physical-device or production upgrade validation. Existing functional tests were not rerun for this asset-only revision.

## Approved interface implementation

The owner authorized the RUACH UI proposal on 7 October 2026. The shared `wwwroot/css/brand.css` implements its light/dark palette, Inter and Manrope typography, spacing, radii and component styling in the Windows/Android hosts. Fonts and their OFL licenses are bundled locally. The [interactive reference](branding-review/index.html) uses this same production stylesheet.

Bracketed musical directions use a dedicated annotation foreground derived from the approved success green and theme text color: pale mint in dark mode and deeper green in light mode. Reader measurements on 7 October 2026 were 9.6:1 and 7.2:1 respectively. The status indicator's green is unchanged. The viewer border belongs to the scroll container, preventing corner clipping and retaining the frame while scrolling. Neutral dialog actions have visible outlines; added songs use an accessible check icon without an “Added” label.

Royal Folio retains the proposal placements: launcher, splash, homepage/setlist top bar and account dialog. The top-bar emblem disappears when viewing or editing a song/chord sheet, leaving room for the song title. The account dialog uses the theme-appropriate product wordmark, parent endorsement and Google sign-in control. User profile photos and functional song/setlist icons retain their existing roles. The existing package IDs, storage, authentication, incremental sync, editor interactions and navigation remain unchanged by the styling.

Implementation validation on 7 October 2026: Windows and Android Debug builds passed with zero warnings/errors; 29 shared-session tests, seven native tests and 30 JavaScript bridge tests passed. Existing browser suites passed for setlist ordering/add/remove (17 checks at 414px and 1280px), incremental sync/navigation (24 checks at 414px and 1280px), and chord-palette editing (11 checks at 320px and 1280px). All 42 reference combinations of seven screens, two themes and desktop/414px/320px layouts loaded their images and fonts without horizontal overflow, with the expected top-bar icon visibility; measurements are in [implemented-layout-checks.json](branding-review/implemented-layout-checks.json). The actual shared Razor account dialog was also inspected at desktop and 320px. These checks use local builds and browser previews; physical Android verification remains separate. No release was generated.
