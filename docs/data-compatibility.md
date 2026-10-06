# Chord Library data compatibility and migration

Inspected source: [louieje-g/chordlibrary](https://github.com/louieje-g/chordlibrary), commit `230ad36e863f3175438a92520b3a567d516c2afe`, on October 3, 2026. Findings below describe that source revision, not a verified production database.

## Moving an existing library

1. Open the original app and sign in to the Google account that owns the library. Let its Firebase sync complete. Check the expected songs and setlists are visible.
2. Use its full **Export data** action. Keep this original JSON file as your migration backup. A song QR is not a full backup.
3. Open the new app. Sign in to the intended Supabase account before importing if you want that account to own the library. The offline guest library is separate.
4. Import the full JSON backup and review the song/setlist counts and warnings. Version 1 `playlists` and version 2 `setlists` exports are both supported.
5. After import, compare song titles, chord-sheet text, setlist order, transpose settings, and two-column settings. Sync to Supabase, then verify the library from another installation signed into the same Supabase account.

Importing creates or updates library records. It does not delete unrelated existing records. Reimporting a full backup preserves IDs and updates matching records only when the imported `updatedAt` is newer. Equal timestamps retain the existing record. A repeated single-song import creates a separate song, matching the original app's add-song workflow.

No actual user backup or privileged Firestore export was supplied with the repository. No existing user records or identities have been migrated during implementation. Hosted schema setup is separate from a completed data migration: authentication, an actual source export, and cross-device verification are still needed. The supplied fixtures contain invented test data only.

## PostgreSQL storage after import

The old export format is a compatibility input, not the hosted database model. Import validates the file and merges it into the selected account's offline library; synchronization converts it to normalized PostgreSQL tables:

| Old export data | PostgreSQL destination |
| --- | --- |
| Song fields | Typed columns in `public.songs` |
| Playlist/setlist fields | Typed columns in `public.setlists` |
| Each ordered `songIds` entry | A separate `public.setlist_songs` membership row |
| Unix millisecond dates | `timestamp with time zone` columns |
| Current account | `owner_id` foreign key to `auth.users` |
| Unknown future properties | Optional `extra_fields` metadata; ordinary fields are not stored there |

Membership foreign keys include the owner, preventing links to another account's songs or setlists. Positions preserve the exact order, including repeated songs. Songs upload before setlists so their foreign keys exist. A missing song keeps the affected setlist pending with its local references intact until the song is imported/synced or the reference is removed.

The local offline library uses relational SQLite tables; import/export files remain JSON. Compatible snapshots are reconstructed for the existing sheet engine and sync protocol. The API's `library_documents` view reconstructs JSON from PostgreSQL rows rather than persisting document payloads. The earlier hosted database migration retains the former document table in a restricted archive schema as a recovery copy.

## Supported JSON formats

| Format | Shape | Import behavior |
| --- | --- | --- |
| Full current backup | `{ "version": 2, "exportedAt": "ISO timestamp", "songs": [], "setlists": [] }` | Preserve IDs, content, ordered references, timestamps and unknown record properties; merge newer records. |
| Full legacy backup | `{ "version": 1, "exportedAt": "ISO timestamp", "songs": [], "playlists": [] }` | Treat `playlists` as setlists with the same record schema. |
| Single-song file | `{ "version": 1, "type": "single-song", "exportedAt": "ISO timestamp", "song": { ... } }` | Create a fresh ID and timestamps; keep chord text and supplied record properties. |
| Song QR text | `{ "t": "cl-song", "v": 1, "n": "Title", "a": "Artist", "c": "Chord text" }` | Create a fresh song; warn that the original QR may already have removed lyrics. |
| Plain song object | `{ "title": "Title", "artist": "Artist", "content": "Chord text" }` | Create a fresh song. |

The current source's full export is defined in `js/app.js:1800–1816`; its single-song export is at `1822–1841`. It accepts legacy playlist backups at `2237–2240`. When both `setlists` and `playlists` are present, `setlists` takes precedence and the new importer reports that choice.

Examples: [version 1 backup](fixtures/original-backup-v1.json) and [version 2 backup](fixtures/original-backup-v2.json).

## Exact record contract

Songs contain:

```json
{
  "id": "id-1700000000000-example",
  "title": "EXAMPLE SONG",
  "artist": "Example Artist",
  "content": "KEY: C\n[VERSE]\nC  G  Am  F\nExample text",
  "transposeSteps": 0,
  "twoColumn": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000
}
```

Setlists contain:

```json
{
  "id": "example-setlist",
  "name": "Practice",
  "description": "Example only",
  "songIds": ["id-1700000000000-example"],
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000
}
```

- IDs are arbitrary nonempty strings. The original uses `crypto.randomUUID()` when available, otherwise `id-<epoch milliseconds>-<random text>` (`app.js:56–59`). Database/library IDs therefore must not be constrained to UUIDs.
- `createdAt` and `updatedAt` are JavaScript `Date.now()` numbers: Unix milliseconds, not Firestore Timestamp objects or ISO strings (`app.js:1289–1298`, `1451–1458`). `exportedAt` alone is an ISO timestamp.
- `songIds` order is the performance order. The importer preserves duplicate references and unresolved references, warning about unresolved entries rather than silently dropping them. Adding songs in the original preserves existing order and appends new selections (`app.js:1537–1552`).
- `content` is plain chord-sheet text. Whitespace, line breaks, brackets, slash chords, lyrics, and arbitrary Unicode text are retained. No text transposition or QR reduction is performed during a full-file import.
- Per-song `transposeSteps` and `twoColumn` are data, not global preferences (`app.js:1195–1197`, `2428–2479`). The original UI uses a transpose range of -11 to 11 semitones.
- Unknown record properties are retained as JSON. Absent optional artist/description/view fields get defaults. Missing timestamps default to zero, with missing `updatedAt` using `createdAt` when present.

The importer validates the complete file before writing any data. Limits are 25 MiB UTF-8 JSON, 10,000 songs and 10,000 setlists, 1,000,000 characters per chord sheet, 1,024 characters per ID, 2,000 characters per title/name/artist, and 10,000 references per setlist. Timestamps must be whole Unix milliseconds within UTC years 0001 through 9999, matching the relational schema. Invalid field types, unsupported versions, malformed records, invalid timestamps, and transposition outside -11 through 11 reject the import without partially saving it. Repeated IDs within one file select the newest timestamp and keep the first occurrence on ties. Deleted records in an import are skipped with a warning.

The Core import API also supports `regenerateIds: true` for explicitly copying a full backup into a library with fresh record IDs. It remaps all imported setlist references to their new song IDs together. Unresolved references remain unresolved and are reported.

## What the original export cannot include

The original full export reads the currently loaded local `songs` and `setlists` arrays. It contains no Firebase authentication users, passwords, refresh tokens, Google credentials, account-to-record mapping, browser preferences, queued offline operations, or cloud deletion tombstones. It is not a Firestore administrative export.

Firebase's current authentication path is Google popup sign-in (`sync-service.js:119–128`), with local auth persistence (`70–83`). Supabase users must authenticate again. A Supabase user UUID is a different identity from the original Firebase UID, even if the same Google email is used. Per-user import assigns the library to the authenticated Supabase account; this must not be inferred from a claimed email inside a JSON file. The new importer never trusts backup fields to select the destination account.

For a future administrator-wide migration, a separate trusted process would need an authorized Firestore export, Firebase-to-Supabase identity mapping, tombstone handling, and per-owner verification. That administrative migration is not implemented by the user-facing backup importer.

Browser-only preferences are stored under `chord-library-theme`, `chord-library-notation`, `chord-library-font-size`, sidebar/tour keys, and related keys (`app.js:20–35`). They are not in the original JSON backup and cannot be reconstructed from it. The new app stores its preferences with the local account profile; songs and setlists are the Supabase-synced collections.

## QR sharing is lossy

The original QR does not use gzip, Base64, or a reversible compression algorithm. It writes a compact JSON object with `t`, `v`, `n`, `a`, and `c` (`app.js:1945–1951`). Its `compressForQr` removes lyric-only lines and trailing lyric text while retaining recognized chords, section headings, and some separators (`1980–2009`). The import can preserve only text actually present in that QR. Use the full JSON export to preserve complete song lyrics and all setlists.

## Original Firebase storage and sync

- Current collections: `users/{firebaseUid}/songs` and `users/{firebaseUid}/setlists` (`sync-service.js:329–347`). Firestore document ID is authoritative on reads.
- Legacy collection: `users/{firebaseUid}/playlists`. The source copies newer records into `setlists` without deleting the old collection (`302–327`).
- Original sync is last-modified-wins using `updatedAt || createdAt || 0`. Equal timestamps keep local data (`354–416`).
- Deletions write the full original record with `deleted: true` and a fresh millisecond `updatedAt` (`449–478`). The visible local library filters those tombstones out.
- Original source syncs songs before setlists, then flushes queued offline writes (`237–272`). It uses collection reads rather than Firestore live snapshot subscriptions.
- Original sign-out does not clear or namespace the shared browser library (`131–141`, `590–611`). The new implementation keeps `guest` and each `user:<Supabase UUID>` in separate durable profiles. Signing in does not silently upload another profile's library. Transfer via an explicit export/import.
- The rules shown in `js/firebase-config.js:13–23` are suggested rules in a code comment. They are not proof of the rules deployed to the existing Firestore project.

## New local persistence and conflict behavior

`LocalLibraryStore` stores each profile in a separate SHA-256-named `.sqlite3` database in the same app data directory used by previous releases. Account databases remain under `library/projects/<project-hash>/`; the guest database remains in `library/`. Each database carries its profile hash and schema version. A mismatched profile or unsupported database version produces an error instead of silently loading or resetting it.

Songs and setlists use typed columns. `setlist_songs` stores each membership by position, retaining duplicate references and order. `song_references` supplies stable identities for temporarily missing songs, so valid older backups and incremental downloads can retain dangling references without inventing visible songs. Unknown future properties use per-record `extra_json`; the pending-upload table retains each operation's JSON payload for protocol compatibility. Preferences, remote revisions/tombstones and per-collection download checkpoints have separate tables. Titles, artists and membership references have indexes.

On first access to a profile, an existing JSON file is validated and migrated in one SQLite transaction together with its pending uploads, local versions, deletion history, preferences and download checkpoints. Only a committed migration marks the database initialized. Failed or cancelled migration leaves the source intact and can be retried after the source problem is resolved. Both the original `.json` and its existing `.bak` are retained unchanged. A successful migration is never replayed: subsequent writes use SQLite, even if the old JSON changes. The retained JSON is a pre-upgrade recovery copy, not a current backup. Use the app's JSON export for a current portable backup before downgrading or transferring devices.

Operations serialize per profile and use SQLite transactions, foreign keys, write-ahead logging and full synchronization. Database I/O runs on a background worker because Microsoft.Data.Sqlite's I/O methods execute synchronously. Each saved edit commits with its pending sync entry; each download commits with its record and checkpoint. Only changed rows are written. Corrupt databases/files are preserved and reported rather than silently replaced with an empty library. Sign-in credentials continue to use the platform secure store.

Pending edits and deletion tombstones survive restarts. Each pending record keeps its expected Supabase revision and a unique local version. Upload acknowledgments clear only the exact local version sent; edits made while a request is in flight remain pending. Competing edits/deletions resolve automatically by their latest update timestamp, with cloud winning ties and revision-checked retries protecting newer in-flight edits. Remote song deletions also remove setlist references and queue those repairs for sync.

The browser UI sends its complete local snapshot, so `SaveClientSnapshotAsync` compares that snapshot with the baseline the UI actually saw. Only changed records and preferences are applied to the newest saved state. Unrelated records downloaded during the edit survive, and a user edit of the same remotely changed record retains the old seen revision so the server reports a conflict. An unchanged stale UI record cannot resurrect a remote deletion.

Local import/storage tests cover the actual original formats, unknown properties, whitespace, arbitrary IDs, reference order, timestamp ties, missing references, malformed atomic failure, account isolation, concurrency, restarts, revision acknowledgments, tombstones, and stale conflict decisions. Hosted Supabase integration and a real user's export require separate verification.
