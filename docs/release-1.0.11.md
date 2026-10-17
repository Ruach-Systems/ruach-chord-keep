# ChordKeep 1.0.11

Windows x64 and Android update. Android build number: **12**.

## Changes

- Adds **More → Song history** to preview and restore up to 30 previous title, artist and chord-sheet versions per song on this device. Restoration creates a new saved edit and retains the replaced content. History starts with future saved changes and remains local to each account/device; it is not included in JSON exports or cloud synchronization.
- Shows pending changes, offline/syncing/attention states and the last successful cloud check in the account menu and Account & sync. “Up to date at last check” describes the last observation, rather than continuous monitoring.
- Batches incremental downloads and upload acknowledgments, committing downloaded records with their checkpoint. Retries temporary request failures a limited number of times and lets independent records sync when another record needs repair.
- Preserves latest-update-wins with cloud winning timestamp ties. Sync remains event-driven on open, resume, reconnect, saved edits and manual refresh; no interval polling is added.

## Upgrade compatibility

Install over the existing app and retain a JSON backup before upgrading. The Android application ID, release signing identity, Windows installer AppId and authentication callbacks remain unchanged. Windows remains unsigned; Android uses the existing release signing key.

Local SQLite schema 2 adds history and status tables transactionally, preserving songs, setlists, preferences, pending changes and download checkpoints. Legacy JSON upgrade remains supported. Older schema-1-only app builds cannot open an upgraded profile; use the updated app afterward. History cannot reconstruct edits made before this update and is not a replacement for backups.

## Validation and distribution

Local validation passed 217 .NET tests, 32 JavaScript tests and 110 desktop/mobile browser regression checks. Windows and Android validation builds passed with zero warnings/errors. Actual Blazor preview checks covered version selection/restoration, restart persistence, both themes and mobile layout, focus containment and keyboard dismissal using disposable data. Physical Android and live cross-device cloud acceptance remain separate.

Hosted package/install/signature and downloaded-asset verification results will be recorded after the requested release workflow completes. The workflow creates an unpublished draft; publication remains a separate action. Source access is required to download assets from this private repository.
