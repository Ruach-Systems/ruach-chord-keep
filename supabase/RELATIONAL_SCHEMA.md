# Relational PostgreSQL library storage

Apply `migrations/002_relational_library.sql` after the previously installed `001_library.sql`, then apply `003_account_delete_cascade.sql`. These are forward migrations, not replacements for applied migrations or automatic app-startup operations. Migration 003 corrects a physical account-deletion failure discovered by the hosted relational regression suite after 002 was applied; it changes only the song membership foreign key's deletion action.

The public storage consists of three actual PostgreSQL tables:

| Table | Stored data |
| --- | --- |
| `songs` | Owner UUID, legacy text song ID, title, artist, chord/lyric content, smallint transpose steps, boolean column preference, timestamp creation/update dates, server revision, tombstone and optional unknown extension fields. |
| `setlists` | Owner UUID, legacy text setlist ID, name, description, timestamp creation/update dates, server revision, tombstone and optional unknown extension fields. |
| `setlist_songs` | Owner UUID, setlist ID, song ID and zero-based integer position. Compound foreign keys require both referenced records to belong to the same owner. Repeating a song at different positions is allowed. |

There is no persisted `payload` column in these tables. The small optional `extra_fields` JSONB object is reserved for properties unknown to this version; database constraints prevent known attributes from being stored there instead of their typed columns.

The `library_documents` name is retained only as a **read-only compatibility view** that constructs the existing C# transport response from these relations. It has `security_invoker=true`, and SELECT access on the underlying tables is protected by the authenticated user's RLS policies. Using JSON for import/export or the REST response does not turn the relational tables into a document database.

`apply_library_document` remains the revision-checked compatibility RPC. It derives ownership from `auth.uid()`, validates and normalizes the incoming DTO, writes typed columns, and replaces ordered membership in the same database transaction. Clients have no direct INSERT/UPDATE/DELETE grants on the tables or view. Per-owner transaction locking, server revisions, insert-only semantics, and idempotent retries remain intact.

The migration moves the original 001 table to `chordlibrary_private.library_documents_001`, removes its client grants and read policy, and denies client access to the private schema. It then converts every active record and song tombstone into the relational tables while preserving owners, IDs, revisions and server update times. Original records remain in the private archive. A malformed required field, timestamp or missing active setlist reference aborts the migration transaction; it does not silently discard that data.

Unix milliseconds are converted through integer day/millisecond arithmetic in UTC and returned as integer milliseconds by the view. The supported range is years 0001 through 9999, inclusive of the final millisecond of 9999. Fractional or out-of-range values fail clearly rather than being rounded. Optional DTO fields use the same defaults as the native importer, and omitted `deleted` and explicit `deleted:false` normalize identically.

An active setlist that references a song not yet uploaded for the same owner fails with SQLSTATE `23503` and an explanation. The native sync uploads songs first and leaves rejected setlists pending until the missing songs are imported/synced or the references removed. Song tombstones remain real rows, allowing existing foreign keys to stay valid until the native client explicitly repairs a list. Deleting a setlist removes its membership rows and canonicalizes `songIds` to an empty array, so an unsynced missing reference cannot permanently block deletion. The original 001 archive retains any prior deleted-list reference data.

Migration 003 gives the `(owner_id,song_id)` foreign key `ON DELETE CASCADE`, matching the cleanup relationship between a song and its junction rows. This makes physical `auth.users` deletion independent of whether PostgreSQL processes song or setlist cascades first; another owner's same text song ID is unaffected. Client privileges and RLS do not change. Ordinary app song deletion is an UPDATE to a tombstone, so it does not trigger this cascade and still preserves active memberships until an explicit setlist revision repairs them.

PostgreSQL documents that [`ON DELETE CASCADE` deletes referencing rows](https://www.postgresql.org/docs/17/sql-createtable.html), whereas the deferrability setting controls constraint checking rather than making an immediate `NO ACTION` relationship perform cleanup.

Physical song deletion is for administrative/account cleanup, not ordinary library editing. An administrator who physically deletes an individual song also removes its junction rows; that operation does not generate song tombstones or advance affected setlist revisions, so existing offline clients cannot treat it as a normal synchronized edit. Use the authenticated revision-checked RPC and soft-delete workflow for user-visible library changes. Do not routinely purge tombstones or use hard deletes to resolve sync conflicts.

Run `tests/002_relational_tests.sql` after all three migrations. It checks physical tables/types, relational joins, ordering and repeated songs, exact timestamp/default/extension round-trips, revisions and conflicts, missing-reference transaction rollback, compound tenant foreign keys, tombstones, RLS through tables and view, denied direct writes, private archive isolation and account-deletion cascades. It deletes fixture accounts separately and verifies that deleting one leaves the other account's records intact. Its final statement rolls back all fixture users and records. Hosted execution and its evidence are the root task's responsibility.
