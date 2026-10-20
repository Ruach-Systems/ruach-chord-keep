# Performance mode

Use the floating **Start performance** screen/play icon on a song or setlist. Empty setlists cannot start; missing imported references are counted and skipped after confirmation. Duplicate entries retain their positions.

Performance mode hides library/editing controls and keeps a small control bar visible. Previous/Next, horizontal swipes and Left/Right navigate a setlist without wrapping. Standalone songs hide navigation. Play/Pause controls scrolling; Space also works when the sheet has focus. Scrolling pauses on manual input, song changes, opening Display settings, backgrounding and native window suspension. It stops at the bottom without advancing songs. Each setlist occurrence remembers its own scroll position.

**Display** provides transpose/reset, font size (10–24), columns and five scroll speeds. Speed is remembered on this device. Transpose, font size and columns are saved to the song and use existing latest-update-wins synchronization. The normal reader honors saved font size. Display-only edits do not add song-history versions.

Android Back and Escape close Display settings first, then exit. Tab stays inside the performance view. Screen-awake is requested only while a native session is foregrounded and released on backgrounding, exit and disposal. Returning does not restart scrolling. OS bars and the Windows frame remain available.

## Storage and sync boundaries

Entry flushes outstanding local writes, reads SQLite, and copies playable songs and setlist order into memory. It does not request cloud refresh or wait for the shared network-operation lock. It works offline. App restart returns to normal mode.

Existing event-driven sync continues into storage with no interval polling. UI snapshot delivery waits until exit, so cloud edits, removals and reorderings cannot change the performance. Exit displays the latest stored library and returns to the current song, its setlist, or Home if those were removed.

`LocalLibraryStore.PatchSongDisplayAsync` takes a `SongDisplayPatch` containing only changed fields. It reads the latest row under the SQLite transaction gate, preserves editorial content and unknown metadata, advances the existing LWW timestamp and queues an ordinary change. It never saves a frozen song payload. Deleted songs are not recreated; adjustments then apply only to the session, with a notice. Write failures appear in Display settings and again on exit if unresolved.

Font size uses existing extension storage (`extra_json` locally / `extra_fields` in the relational backend). No schema upgrade or hosted migration is required. Older clients preserve this metadata but may not use it.

## Validation

Run the Core, Shared, Native and Supabase test projects, then `node --test tests/bridge-tests.cjs tests/performance-tests.cjs`. Serve the repository on loopback and open `tests/ui-performance.html`, optionally with `?theme=light`. This fixture uses shipped markup/scripts and disposable data with a simulated native boundary.

Native acceptance: start a setlist on Android, let the ordinary screen timeout elapse, background/resume and verify scrolling stays paused, use Back to close settings and exit, navigate by touch in portrait/landscape, then confirm normal screen timeout returns. Verify screen-awake/release on Windows too. Record physical-device results separately from browser simulation.

Pedal configuration, fullscreen immersion, external displays and automatic song advancement are deferred.

The reader uses a bold 14px title without the artist. Icon-only Exit, Previous/Next (setlists), Play/Pause, and Display settings controls float vertically inside the full-width chord sheet, inset from its scrollbar. Content padding keeps chords clear of the buttons, and extra bottom space lets the final lines scroll above them. All controls retain accessible names, tooltips and 44px touch targets.

Display settings opens in a centered, dimmed-backdrop dialog with aligned rows, an inline transpose reset, a two-column switch, and a dedicated Close button. Floating actions hide while settings is open. Close, Escape and Android Back return focus to the settings icon; keyboard focus stays within the open settings panel. Short windows scroll the dialog vertically.

Performance chord sheets preserve original line breaks and never wrap long lines. Scroll horizontally to read long lines; when horizontal overflow exists, touch gestures pan the sheet rather than navigate songs. Previous/Next buttons and keyboard navigation remain available.
