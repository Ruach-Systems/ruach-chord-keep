# Chord Library feature parity

Source: [louieje-g/chordlibrary](https://github.com/louieje-g/chordlibrary), commit `230ad36e863f3175438a92520b3a567d516c2afe` (`230ad36`), inspected October 3, 2026. This document describes the implementation and its local evidence. It does not certify an existing Firebase database, a deployed Supabase project, or a completed user migration.

## Architecture and design

`ChordLibrary.Native` is a .NET 10 MAUI Blazor Hybrid app targeting Windows and Android. It hosts the shared Razor `LibraryShell` inside `BlazorWebView`. The shell embeds the original application's HTML and uses the original CSS and adapted JavaScript to preserve its design and interaction behavior. The viewer has not been rewritten as separate Razor components.

`ChordLibrary.Shared` contains that UI, the .NET account/import dialogs, and the JavaScript-to-.NET bridge. `ChordLibrary.Core` handles backup validation, durable profile storage, Supabase authentication and record synchronization. `ChordLibrary.Preview` is a local browser harness for the same shared UI; it is not the native application package.

The original stylesheet forms the basis of `src/ChordLibrary.Shared/wwwroot/css/style.css`, with native interaction and accessibility refinements. Additional `native.css` styles the account and import dialogs. The dark navy/blue palette, optional light theme, system typography, monospace chord sheets, compact header, floating actions, modal layout and responsive library panel remain based on the original assets.

## Implemented mirror

| Area | Preserved behavior |
| --- | --- |
| Home | Recent songs and setlists, counts, relative update times, direct opening and View all actions. |
| Library panel | Songs/Setlists tabs; collection counts; new-item actions; title/artist song search; name/description setlist search; recently/least-recently updated and alphabetical sorting; mobile overlay and persistent, collapsible tablet/desktop panel. An animated hamburger/X reflects the panel state. |
| Songs | Add, edit metadata, delete with confirmation and undo. New titles are trimmed and uppercased. Artist remains optional. Creating a song from a setlist appends it to that setlist. |
| Chord editing | Edit the original source text directly in the sheet, save/cancel, unsaved-change confirmation, plain-text paste, newline preservation, chord-character/pair helpers, Ctrl/Cmd+S, and Escape. Editing temporarily uses one column. |
| Transposition | Semitone controls bounded at -11/+11, per-song saved value, reset, slash-bass transposition, sharp/flat spelling, and accepting the displayed transposition as the new source with undo. |
| Sheet display | Chord and bracketed-section highlighting; original/sharp/flat notation; per-song two-column setting; global 10–24 px font size, default 14; independent sheet scrolling; back-to-top control; three auto-scroll speeds selected by long press. The source code's font bounds take precedence over its older README text. |
| Setlists | Create/edit/delete name and description; ordered song references; choose songs while preserving existing order; append newly selected songs; drag reorder; remove membership without deleting the song; count and update context. Deleting a song removes its setlist references. |
| Performance navigation | Previous/next controls, bounded left/right keyboard navigation, horizontal swipe navigation, song position and return to setlist. Editing disables song-to-song navigation. |
| Preferences and guidance | Dark/light theme, notation preference, stored font/sidebar choices, feature tour and accessibility labels/focus behavior inherited from the source UI. |
| Full backups | Export compatible version 2 JSON; import version 2 `setlists` and version 1 `playlists`; preview counts and warnings before committing; preserve IDs, chord text, timestamps, unknown record properties and setlist order; merge by ID only when the backup record is newer. |
| Single-song exchange | Export a single-song JSON file; load compatible single-song/plain-song/compact-QR content into the Add song form for review and saving. |
| QR sharing | Bundled QR generation and the original compact `cl-song` version 1 payload. The source's reduction of lyric-only lines remains intentional: QR is a chord-sharing format, not a lossless backup. |

## Intentional changes

| Original | Native implementation |
| --- | --- |
| Firebase Google authentication and Firestore collections | Google-only sign-in through Supabase native OAuth, with relational PostgreSQL songs, setlists and ordered membership tables. Backend connection settings are internal. Imported JSON is converted to typed columns and owner-scoped foreign keys. |
| Shared browser local storage | Relational SQLite databases with separate local and authenticated profiles. Existing JSON profiles migrate transactionally on first access while retaining their source files. Pending changes and deletion tombstones survive restarts. The JavaScript dictionary is a view of that storage, not the durable store. |
| Immediate browser backup merge | .NET validates the entire backup and shows an import preview before writing. Equal timestamps keep the existing record, as in the original. Invalid backups do not partially import. |
| Browser download and file-input controls | Native file pickers and the operating system share sheet for JSON files. The browser preview keeps browser equivalents for UI testing. |
| Live browser camera scanning with `BarcodeDetector` | Android uses a native ZXing.Net.Maui live camera scanner with automatic detection, plus a Choose QR image file picker decoded with ZXing/SkiaSharp. Choosing an image does not require camera permission. Camera resources are released on picker/close/background transitions. QR import is hidden on Windows and in the browser preview; QR sharing remains available. |
| Firebase last-modified conflict behavior | Incremental downloads with durable per-account/project checkpoints, automatic latest-update-wins resolution using `updatedAt` for edits and deletions, cloud wins ties, and revision-checked upload retries. No conflict confirmation dialog. |
| PWA service worker and web update banner | Packaged MAUI assets. The native app does not register the original service worker or load Firebase/CDN scripts. |
| Original broad chord-suffix regex | A bounded grammar for known qualities/extensions. The original treated the lyric `Amazing` as an A chord and could transpose it into `C#mazing`; the new implementation leaves that word intact while recognizing `mMaj7`, `m7b5`, `7sus4`, `add9`, `maj7#11` and slash basses. |
| Original shared-account UI state | Account changes reset selected records, private editor drafts, forms and undo callbacks. Theme/notation/font/sidebar values reload from the destination profile, with defaults for missing settings. |
| Song search also matches chord-sheet contents | Drawer song search matches only title and artist, ignoring lyrics and chords. |
| First chord shown as the detected key | Removed the inaccurate automatic Key badge. Chord transposition remains available. |
| Earlier native periodic cloud polling | Sync runs on startup, foreground/resume, restored connectivity, saved edits/imports and explicit Refresh library. There is no interval cloud poll. While the app stays active, use Refresh to receive another device's changes. |
| Quick-symbol controls refocus the editor | Primary pointer taps retain focus in both the inline chord editor and song popup, preserving the caret and avoiding an IME restart. Actual keyboard Caps Lock behavior requires Android device verification. |

Additional repairs escape imported values used in HTML attributes and remove the previous undo callback when offering another undo action. A keyboard event handled by the library tabs no longer also advances the song sheet. Background snapshot refresh is deferred while the source UI reports editing, a visible modal or an active undo window.

## Data migration boundaries

The original app's full export contains songs and setlists from the currently loaded library. It contains no Firebase authentication users, passwords, Google credentials, account mapping or browser preferences. An existing user signs in again through Supabase and imports their JSON backup into that selected account. A Supabase account is not inferred from an email field in the backup.

No actual user export was supplied with the repository. The included JSON fixtures are synthetic. No existing hosted user records have been copied by building this application. See [data compatibility and migration](data-compatibility.md) for supported formats, exact fields, limits and the migration procedure. Use full JSON, not QR, to preserve lyrics and all setlists.

## Local evidence and remaining verification

- The viewer markup, styles and logic derive from the inspected source commit, with the documented native refinements.
- `node --test tests/bridge-tests.cjs` passes 25 regression tests covering chord/notation behavior, transpose bounds, setlist keyboard navigation, QR compatibility, serialized native saving, failed-write retention and retry, account reset, settings refresh, background-refresh guards, deferred UI updates, manual refresh and import/export ordering.
- `node --check` passes for the adapted `app.js` and `native-bridge.js`.
- .NET import/storage/synchronization tests are under `tests/ChordLibrary.Tests`; their current execution and native/browser runtime results should be recorded in the project's main validation report. The JavaScript checks alone do not establish native runtime or cloud readiness.
- Windows/Android native file sharing, Android live QR/image scanning, Google OAuth, accessibility and device-specific behavior require runtime verification on the relevant targets. iOS and Mac Catalyst are not enabled build targets in this implementation.
- The approved Supabase schema and native redirects were installed in project `ykfmjwlouvbapzqlqczw`; hosted SQL checks verified isolation, denied direct writes, conflicts and tombstones. Google provider settings, live authentication, hosted cross-device synchronization and a real user's source export still require verification. See [validation](validation.md).
