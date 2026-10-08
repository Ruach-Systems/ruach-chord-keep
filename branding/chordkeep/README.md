# ChordKeep — Royal Folio

Version 1.2 · 7 October 2026

The owner-selected refined Royal Folio, rebuilt as clean filled vector contours: a three-point crown above two open pages with an integrated pair of musical notes. Every production export comes from the same geometry. The original AI concept images are preserved under `references/` as approval evidence; they are not used as native icon artwork.

Open `previews/index.html` for an asset gallery, or `previews/asset-preview.png` for the overview. Downloadable archive: `../../artifacts/branding/ChordKeep-Royal-Folio-v1.2.zip` relative to this kit directory (repository root: `artifacts/branding/`).

## Included artwork

| Folder | Contents |
| --- | --- |
| `assets/` | Transparent symbol SVG/PNG/PDF; outlined horizontal and stacked ChordKeep lockups; square app icons |
| `platforms/windows/` | Multi-resolution ICO; transparent-corner target-size PNGs for default/light/dark Windows contexts; scaled package tiles, StoreLogo and splash images |
| `platforms/android/` | Adaptive foreground/background vectors; API 33 monochrome layer; legacy and round launcher PNGs for six densities; 512px Google Play icon |
| `platforms/apple/` | Universal 1024px iOS/iPadOS app-icon catalog with light/dark/tinted appearances; alternative classic-size catalog; Icon Composer source layers |
| `platforms/macos/` | ICNS, iconset and Xcode catalog with 1x/2x resources |
| `platforms/web/` | SVG/ICO/PNG favicons, 180px touch icon, regular and maskable PWA icons, Safari monochrome symbol, manifest and head snippet |
| `platforms/linux/` | SVG and PNG icon-theme resources, desktop-entry template |
| `platforms/dotnet-maui/` | Icon foreground/background SVGs, splash SVG, project integration snippet |
| `source/` | Editable master SVG, canonical path geometry, deterministic builder and requirements |
| `fonts/` | Unmodified Manrope 800 font and its SIL Open Font License |
| `previews/` | Actual-export overview, color treatments and 100% pixel-size gallery |

Apple TV, watchOS, visionOS, and compiled Apple `.icon` bundles are outside this package. Icons for those uses need a separate platform-specific composition. Supplying Apple/web/Linux artwork does not add those runtime targets to the Windows/Android application.

## Identity rules

- This is **ChordKeep's product mark**, distinct from the RUACH Living Breath parent identity. It does not replace the parent mark or its tagline.
- Primary app icon: white symbol on Crimson `#B21F32`. Supporting treatments: Obsidian, Ivory and Royal Aubergine. Color values are in `colors.json` and come from the main `ruach-brand-guide`.
- Keep the crown, open pages, paired musical notes, proportions and negative spaces intact. Do not stretch, rotate, attach the crown to the pages or add score lines. No wordmark or tagline inside launcher tiles.
- Keep artwork flat and opaque. Transparent symbols have transparent surrounding space; the symbol itself is solid. No gradients, glows, shadows or simulated metallic effects.
- Leave at least one-quarter symbol-height clear space around standalone logos in layouts. This is additional layout space, not necessarily padding baked into the file. Platform icons use their supplied safe-zone layouts instead.
- Symbol detail is best at 32px or larger. 16–24px system/favicons are supplied as small-size fallbacks; do not expect all internal details to be equally distinct at 16px. The gallery shows the actual exports at native size.
- The PDF symbol masters and SVG lockups contain vector paths. Wordmarks are outlined Manrope 800; they render without installed fonts.

## .NET MAUI — existing Windows/Android app

Use the sources in `platforms/dotnet-maui/`:

1. Copy `appicon.svg` and `appiconfg.svg` into `Resources/AppIcon/`.
2. Copy `splash.svg` into `Resources/Splash/`.
3. Merge the **ItemGroups** from `project-snippet.xml` into the existing `.csproj`. Replace existing icon/splash entries to avoid duplicates; do not replace the whole project file.
4. Retain the Android-specific `ForegroundScale` update. It reduces the 64%-height foreground to 46dp within the Android 108dp layer. Windows and Apple use the regular 64%-height layout.
5. Build and inspect the generated native icon resources and test launcher/taskbar/splash appearance. MAUI generates the platform files: do not also install the direct Android/Windows resource packages under the same names.

The matching application snapshot now uses these icon and splash sources. Windows and Android build verification is recorded in the application identity notes. Store and physical-device appearance checks remain separate.

## Android direct integration

Merge `res/` into the Android project's resources and merge the icon attributes in `manifest-snippet.xml` into its existing `<application>`. Resource names use valid lowercase Android naming.

Adaptive foreground/background layers are 108×108dp. The full foreground silhouette fits inside the central 66dp safe circle. The v26 adaptive files supply foreground/background; v33 files add a monochrome layer for themed icons. Density PNGs are for pre-adaptive launchers. `layers/` PNGs and SVGs are editable alternatives, not extra resources to install simultaneously.

`google-play-icon-512.png` is square, flat and opaque, with no baked corners; Google Play supplies its display mask. Store screenshots and listing copy are not part of an icon kit.

## Windows direct integration

`ChordKeep.ico` contains independently rendered 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256px PNG frames. Use it for Win32 executables, installers and shortcuts.

The `Square44x44Logo.targetsize-*` files use the same white-on-crimson tile with transparent corners in default, `altform-unplated` and `altform-lightunplated` variants. Scaled artwork is supplied at 100%, 125%, 150%, 200% and 400%; fractional pixel dimensions round upward. Merge the paths in `manifest-snippet.xml` into the existing package manifest. Windows resolves qualified filenames from the base resource path. Set the package Properties/Logo to `Assets\StoreLogo.png` when packaging manually.

## Apple integration

For current Xcode catalog workflows, import `platforms/apple/AppIcon.appiconset/` into `Assets.xcassets`. The default, dark and grayscale tinted masters are square 1024px RGB images without alpha or baked corner masks. The separate `legacy/AppIcon.appiconset` is an alternative for classic iPhone/iPad size slots; choose one catalog rather than combining both under the same name.

`composer-source/` supplies transparent foreground and solid background SVG/PNG layers for authoring in Icon Composer. These are source layers, not a compiled `.icon` document. Native Apple compilation and visual/store validation require Xcode on macOS.

For traditional macOS packaging use `platforms/macos/ChordKeep.icns`, or the supplied Xcode catalog. The iconset includes 16, 32, 128, 256 and 512pt entries at 1x and 2x. The macOS presentation has a centered rounded plate and transparent exterior; the iOS masters intentionally do not have those baked corners.

## Web/PWA and Linux

Copy the web files into an appropriate public directory, adapt `head-snippet.html` URLs and merge the starter manifest with the site's existing manifest. Maskable PWA icons keep the complete symbol inside the central circle with radius 40% of canvas width. Regular and maskable variants have separate `purpose` entries.

For Linux install `hicolor/` resources in the chosen icon-theme hierarchy, adapt the `.desktop.example` executable path and install it as a `.desktop` file. This kit does not contain a Linux application binary.

## Rebuild and validation

With Python 3.11+:

```powershell
python -m pip install -r source/requirements.txt
python source/build_assets.py
```

The kit is self-contained. `source/geometry.json` is the canonical editable geometry; `source/master.svg` is regenerated from it. The builder exports the files, writes `validation.json` and `inventory.json`, and creates the ZIP in the repository's ignored `artifacts/branding/` folder. It does not edit application code or any parent-brand resources.

Validation checks the three separate contours, small-size margins, uniform flat fills, dimensions, alpha/opacity, SVG/XML structure, catalog references, ICO frames, ICNS chunks, Android/PWA safe circles and ZIP integrity. Inventory records byte sizes and SHA-256 hashes. The preview uses actual SVG exports, not generated device mockups. Local checks do not constitute native device/store approval or application integration testing.

`validation-native.json` records the additional handoff checks: all Android `res/` files compiled with Android AAPT2 from the installed .NET Android SDK, and all six PDF masters rendered without clipping. This checks resource compilation, not linking or installation of an Android app. This optional report is retained during the portable export rebuild; repeat those tool-specific checks after modifying geometry.

## Platform references

- [Android adaptive icon layers and safe zones](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)
- [Google Play icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)
- [Windows icon construction and resource qualifiers](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)
- [.NET MAUI icons and Android foreground scaling](https://learn.microsoft.com/en-us/dotnet/maui/user-interface/images/app-icons?view=net-maui-10.0)
- [Apple app-icon asset catalogs](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)
- [PWA maskable safe zone](https://web.dev/articles/maskable-icon)

Main brand reference: workspace repository `ruach-brand-guide` version 1.3. This kit records the approved product-specific symbol separately and leaves that parent repository unchanged.

## Name finalization

The owner accepted **ChordKeep** on 7 October 2026. Use this exact capitalization. Chord + keep expresses preserving a personal collection of chord sheets; the architectural meaning of keep complements the Royal Folio emblem. These are naming interpretations. RUACH remains the parent brand. The previous Chord Library kit is historical provenance. Kit 1.1 finalized the ChordKeep wordmarks, platform display names and standalone filenames. Kit 1.2 replaces the previous Sovereign Strings emblem with the approved Royal Folio refinement. Superseded concept boards are excluded from this active kit; `references/approved-royal-folio.png` is the retained approval reference. This catalog cleanup leaves the approved artwork and kit version unchanged.

The authoritative copy lives in `ruach-brand-guide/products/chordkeep/identity-kit/`; the app retains a byte-identical integration snapshot. Rebuild this kit independently from the parent Living Breath kit. The builder creates an asset ZIP only, not an app release. The archive location is `artifacts/branding/` in the application repository, or next to `identity-kit/` in the parent catalog. Domain purchase and trademark registration are outside this identity change.
