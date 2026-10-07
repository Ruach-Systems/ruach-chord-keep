# ChordKeep branding review

Reviewed 7 October 2026. Baseline findings below describe commit `c612dcf7a8d3d7e1bef1b295183186af44569274`, draft 1.0.8. Subsequent requested contrast and product-icon changes are implemented in local source and described below; the full RUACH UI remains a review proposal.

**Latest status — contrast reverted:** The user subsequently requested reverting the production contrast change. Original light/dark colors, foregrounds, border treatments, busy-dialog opacity and account fallback were restored. Chord Flow and its header/account/native icon integration remain. The production contrast test files were removed with the reverted change; contrast measurements and screenshots below describe the earlier experiment, not the current production appearance. The full branding preview remains separate.

**Final identity update — 7 October 2026:** The owner accepted **ChordKeep** and subsequently selected the refined **Royal Folio** crown-and-musical-folio emblem. [Kit 1.2](../../branding/chordkeep/README.md) supersedes Chord Flow and Chord Book. The updated [interactive review](index.html) uses the final name and emblem in both app and proposed UI treatments; original app contrast remains the default. Earlier findings, screenshots and checks below are historical evidence, not the current identity or a new validation claim. See [identity and upgrade notes](../identity.md).

## Source of truth

The workspace `AGENTS.md` names `../ruach-brand-guide` as authoritative. Reviewed its README, eight-page Brand Guide PDF v1.3 dated 6 October 2026, README.txt handoff, brand-tokens.json/CSS, identity preview, design-sample inventory and MAUI snippet. Previous exports and project-specific branding notes do not override it.

Foundation: King / Citizen / Law / Territory / Love. The Kingdom is a heavenly government, with Jesus as King. The guide connects this foundation to responsible leadership, clear permissions, business-domain boundaries and service. It directs RUACH's conduct without requiring customers to adopt roles.

## Findings and proposed treatment

| Area | Current implementation and evidence | Assessment | Proposal |
| --- | --- | --- | --- |
| Palette | `src/ChordLibrary.Shared/wwwroot/css/style.css` root uses navy `#1a1a2e` / `#16213e` with blue `#4dabf7`; light theme uses blue `#0071e3` and gray `#f5f5f7`. | Outside the current RUACH palette. | Map existing semantic variables to the guide: Ivory/White/Graphite in light; Obsidian/Graphite in dark; Crimson `#B21F32` and Bright Crimson `#EF5967` for actions and chords. Aubergine remains a restrained supporting surface. |
| Naming | Shared header, native ApplicationTitle and WebView title say Chord Library. | Product purpose is clear, but parent relationship is absent. | Formal/window/listing name RUACH Chord Library. Keep the selected song title readable in working screens. Use the distinct product icon in desktop/mobile working headers, with fuller parent branding in sign-in/About. |
| Logo | No current Living Breath assets in the app resources/working markup. | Missing parent relationship. | Use the distinct Chord Library mark for the app. Copy the approved primary/on-dark parent SVG unchanged for sign-in/About: compact lockup at least 140px; tagline branding stays off chord sheets. |
| Native icon/splash | Native project uses `Resources/AppIcon/appicon.png` for both icon and splash, with `#1a1a2e`. | Existing artwork/theme is not integrated with guide 1.3. | Review a distinct product icon, then integrate adaptive foreground/background and Windows artwork. Use approved brand colors. Parent app icon is reserved for RUACH itself. |
| Typography | System sans stack plus SF Mono/Consolas/Monaco; bundled native resource is OpenSans-Regular. | Native fallback is permitted; missing brand/product hierarchy is the gap. Monospace is functional. | Bundled Inter for interface text, Manrope for brand/key headings. Keep monospace for chord alignment; allow native fallback, accessibility scaling and language coverage. |
| Spacing | Existing 4/8/16/24/32px tokens; setlist rows have 72px minimums, 8px gaps and 44px controls. | Much already aligns. | Retain useful geometry; complete 12/48/64px steps when needed. Preview uses 24px desktop content and 12px mobile content, with 16px phone sections. |
| Corners | Controls range from 6/7/8/11/12px; dialogs use 18/20px; some panels use 16px. | Consistency can improve; guide values are adaptable starting points. | Start with 8px controls, 12px cards and 16px panels. Keep circles for avatars/FABs and preserve full-screen mobile editor behavior. |
| Functional states | Bright green success and red danger; existing primary buttons use `--bg-primary` for label color. | A palette swap alone can produce unclear actions or wrong foregrounds. | Introduce an explicit on-primary pairing: White on light Crimson; Obsidian on dark Bright Crimson. Deep Green is reserved for success. Give destructive controls explicit wording/icons and a quieter outlined/tinted treatment, with the existing confirmation. |
| Icon language | Many controls use line SVGs; account fallback and Preferences still use emoji. | OS-dependent emoji style clashes with the otherwise consistent interface. | Continue the current line-icon language; use a neutral account glyph when no Google photo is available. Preserve the actual Google profile photo and visible status badge. |
| Google sign-in | `LibraryShell.razor` already provides Google-only sign-in without backend settings. | Behavior satisfies the requested account flow. | Retain Google-only auth. Brand the entry dialog, keep Google's recognizable provider mark, and retain local/account separation wording. Preview does not authenticate. |
| Interaction | Shipped drawer toggle, drag placement, confirmed removal, per-song addition, chord palette minimize/show and discard protection. | These recent UX changes are worth preserving. | Use existing markup/controllers rather than redesigning their logic. Respect reduced motion, focus, keyboard controls, text scaling and 44px primary touch targets. |

## Recommended direction

### Subsequent requested implementation

After this audit, the user requested stronger readability in the app and a distinct product logo. The local source now includes **Chord Flow** for the header, account dialog, Windows icon and Android adaptive/monochrome icon, plus its native splash. It uses its own musical geometry, not Living Breath. The full RUACH interface redesign below remains a proposal.

The now-reverted production contrast experiment retained the existing blue interface accent: brighter blue for dark-mode text/actions, deeper blue in light mode, explicit label colors for primary/destructive actions, brighter dark secondary text, stronger light secondary text, visible control outlines and non-faded busy-dialog text. Application ID, storage paths and authentication/sync behavior are unchanged. No release was generated.

Use **Solid / Standard** as the foundation. Clear opaque surfaces suit long chord reading, dense setlists and predictable native performance. The guide also permits Glass / Compact; they are alternatives, not required. Full branding belongs at sign-in/About; everyday screens stay focused on songs and setlists. Use the supplied Living Breath logo unchanged and keep it flat and opaque.

The proposed palette does not alter chord grammar, automatic sync, offline storage, imported song data, Google authentication or setlist membership. The preview loads the existing app controllers against disposable in-memory data; edits disappear when the preview reloads. No production storage or cloud APIs are connected.

## Current implementation — 7 October 2026

The owner subsequently approved the RUACH interface proposal and the refined ChordKeep Royal Folio identity. The app and interactive reference now load the same shared `css/brand.css`, with bundled Inter/Manrope fonts, theme-aware product wordmarks and the approved palette/spacing. Logo placements follow the proposal; the top-bar product icon is hidden when viewing or editing a song/chord sheet. The sections below preserve earlier review findings and superseded concepts, rather than describe the current implementation. Current validation is recorded in `../identity.md`.

## Product icon proposals

**Chord Flow — recommended:** two notes joined by a continuous curved beam. It relates to breath/movement through its own curved geometry and musical meaning. It does not copy, carve into or change Living Breath. The simpler silhouette is preferable at 24–32px.

**Chord Book:** a rounded songbook with an inset note. It communicates the library more directly, but its extra detail is less clear at small sizes.

Crimson/White is the default treatment; Obsidian/White is an alternative. Rounded previews are presentation masks only. Chord Flow has subsequently been integrated in local app source as requested above; Chord Book remains an alternative. Selection in the preview changes only that preview.

Chord Flow now uses separate MAUI background/foreground layers. MAUI generates Android adaptive foreground/background/monochrome and Windows ICO/target-size artwork without duplicate direct Android resources. Windows 16/32px and Android generated renders were inspected. Actual launcher/taskbar appearance on physical devices remains to be checked.

## Preview

Serve the repository root, then open `docs/branding-review/index.html`. The preview supports current/proposed appearance, light/dark themes, desktop/mobile layout, home/chord/edit/setlist/new-song/account/drawer screens, and choosing the concept shown in the mobile header. Native sign-in is represented by a review-only dialog. No real Google authentication, camera, SQLite writes, imports or Supabase calls occur.

Assets: unchanged approved compact lockups plus bundled Inter/Manrope and their OFL licenses, copied from the authoritative guide. The additional `chord-flow-*` and `chord-book-*` files are explicitly proposed product artwork.

## Implementation sequence after review

1. Agree on the UI direction and product icon; retain the parent identity unchanged.
2. Integrate shared semantic color/foreground, font and geometry tokens and approved compact/entry logos.
3. Integrate approved native product icon/splash; keep application ID, data location and Android signing identity unchanged.
4. Validate light/dark contrast, 320/414px layouts, desktop layout, font scaling, focus/reduced motion, editing alignment, drawer geometry, setlist sorting, Google-avatar badge and branded dialogs.
5. Compile Windows/Android and perform native keyboard/touch/launcher checks. Generate a release only on a new explicit instruction.

## Preview validation (before the production contrast revert)

- After the readability update, 84 combinations (production appearance and RUACH proposal, seven screens, two themes, three widths) passed 3,690 rendered-text contrast samples with no horizontal overflow. Computed foregrounds were tested against alpha-composited backgrounds at 4.5:1 for normal text / 3:1 for large text. This is not a full accessibility audit. Detailed results: `rendered-contrast-checks.json`; reusable read-only DOM probe: `tests/ui-contrast-probe.js`. The preview's `?testing=true` mode disables entrance animations for stable measurements.
- The repeatable `tests/ui-contrast.html` harness passed all 42 production-theme scenarios. The existing chord-palette suite passed all 11 checks at 320px, including insertion, selection, form switching, save, minimize/restore and light/dark layout. Narrow-screen removal confirmation and Add songs dialogs also passed rendered-text contrast checks.
- Final Windows and Android development builds passed with zero warnings/errors. MAUI generated Windows ICO/target-size artwork and Android adaptive/round/monochrome resources; the new shared logo was included in the static-web-assets manifests. Physical-device launcher/keyboard verification is still pending. No release workflow or distributable handoff was started.
- The proposed dark chord sheet uses Obsidian so Bright Crimson clears normal-text contrast; dark labels on tinted setlist/tab controls use Ivory. The original Bright Crimson/Graphite text pairing measured below 4.5:1. Criteria: [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

- All 42 combinations of seven screens, two themes and three layouts passed DOM/layout checks. Actual content widths were 320px, 414px and 1159px. Checks covered horizontal overflow, loaded logo/icon resources, transparent inline editing, matched text/highlight gutters and 44px header controls. Detailed measurements are in `layout-checks.json`.
- Verified Minor 7 chord insertion with its trailing bar, minimizing/restoring the palette without changing the draft, switching the product icon in the mobile header, canceling a setlist removal with all four rows retained, immediate addition of the remaining song, and duplicate-add blocking.
- Verified that the proposed Google action reports that authentication is unavailable in this design preview, Escape dismisses its dialog, and the Current view retains the existing Account & sync wording.
- Inspected desktop, mobile editor, drawer and sign-in views visually. Parent logo and font files were copied from the approved source. JavaScript syntax checks and `git diff --check` passed. No native build or device test is claimed for these review-only files.
- Browser automation emitted observer errors during rapid frame navigation; no shipped application script in this preview contains a MutationObserver. The preview additionally ignores image-decode errors from an already replaced frame. The layout and interaction results above are separate evidence, rather than a claim that every browser runtime log is empty.
