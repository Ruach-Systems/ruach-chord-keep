using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;
using Microsoft.Data.Sqlite;

namespace ChordLibrary.Core;

public sealed partial class LocalLibraryStore
{
    private const int DatabaseVersion = 1;
    private enum ValueKind { Text, Integer, Boolean }
    private sealed record Field(string Name, string Column, ValueKind Kind = ValueKind.Text);
    private static readonly Field[] SongFields = [new("id", "id"), new("title", "title"), new("artist", "artist"),
        new("content", "content"), new("transposeSteps", "transpose_steps", ValueKind.Integer),
        new("twoColumn", "two_column", ValueKind.Boolean), new("createdAt", "created_at", ValueKind.Integer),
        new("updatedAt", "updated_at", ValueKind.Integer)];
    private static readonly Field[] SetlistFields = [new("id", "id"), new("name", "name"), new("description", "description"),
        new("createdAt", "created_at", ValueKind.Integer), new("updatedAt", "updated_at", ValueKind.Integer)];

    private static async Task<T> WithDatabaseStateAsync<T>(string path, bool write, Func<PersistedState, T> operation, CancellationToken ct)
    {
        try
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder
                { DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate, ForeignKeys = true, Pooling = false, DefaultTimeout = 10 }.ToString());
            ct.ThrowIfCancellationRequested();
            db.Open();
            await InitializeDatabaseAsync(db, path, ct).ConfigureAwait(false);
            using var transaction = db.BeginTransaction(deferred: !write);
            var state = ReadDatabase(db, transaction, ct);
            var before = write ? CloneState(state) : null;
            var result = operation(state);
            if (write)
            {
                ValidateState(state);
                WriteChanges(db, transaction, before!, state, ct);
            }
            ct.ThrowIfCancellationRequested();
            transaction.Commit();
            return result;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode is 11 or 26)
        {
            throw new LibraryValidationException("The local database could not be read. It has been preserved; restore a library backup to recover it.");
        }
        catch (JsonException)
        {
            throw new LibraryValidationException("The local database contains damaged JSON fields. It has been preserved.");
        }
    }

    private static async Task InitializeDatabaseAsync(SqliteConnection db, string path, CancellationToken ct)
    {
        var version = Convert.ToInt32(Scalar(db, null, "PRAGMA user_version"));
        if (version is not (0 or DatabaseVersion))
            throw new LibraryValidationException("This local database version is not supported. Use the app version that created it.");
        Execute(db, null, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
        if (version == 0)
        {
            using var transaction = db.BeginTransaction();
            // Another process may have completed migration while this connection waited for its write lock.
            version = Convert.ToInt32(Scalar(db, transaction, "PRAGMA user_version"));
            if (version == 0)
            {
                if (Convert.ToInt64(Scalar(db, transaction, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) != 0)
                    throw new LibraryValidationException("The local database has an unrecognized schema. It has been preserved.");
                Execute(db, transaction, Schema);
                var legacyPath = Path.ChangeExtension(path, ".json");
                var legacyExists = File.Exists(legacyPath);
                var legacy = await LoadLegacyAsync(legacyPath, ct).ConfigureAwait(false);
                ValidateState(legacy);
                WriteChanges(db, transaction, new PersistedState(), legacy, ct);
                Execute(db, transaction, "INSERT INTO profile_metadata(id, profile_hash, legacy_imported) VALUES(1,$hash,$imported)",
                    ("$hash", Path.GetFileNameWithoutExtension(path)), ("$imported", legacyExists ? 1 : 0));
                Execute(db, transaction, $"PRAGMA user_version={DatabaseVersion}");
                ct.ThrowIfCancellationRequested();
            }
            else if (version != DatabaseVersion)
                throw new LibraryValidationException("This local database version is not supported.");
            transaction.Commit();
        }
        var hash = Scalar(db, null, "SELECT profile_hash FROM profile_metadata WHERE id=1") as string;
        if (hash != Path.GetFileNameWithoutExtension(path))
            throw new LibraryValidationException("The local database belongs to a different profile. It has been preserved.");
    }

    private static PersistedState ReadDatabase(SqliteConnection db, SqliteTransaction transaction, CancellationToken ct)
    {
        var state = new PersistedState();
        var document = new LibraryDocument { Songs = ReadRecords(db, transaction, "songs", SongFields, ct),
            Setlists = ReadRecords(db, transaction, "setlists", SetlistFields, ct) };
        var setlists = document.Setlists.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        foreach (var setlist in document.Setlists) setlist["songIds"] = new JsonArray();
        using (var command = Command(db, transaction, "SELECT setlist_id, position, song_id FROM setlist_songs ORDER BY setlist_id, position"))
        using (var reader = command.ExecuteReader())
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                if (!setlists.TryGetValue(reader.GetString(0), out var setlist) || reader.GetInt64(1) != setlist["songIds"]!.AsArray().Count)
                    throw new LibraryValidationException("The local database contains damaged setlist order. It has been preserved.");
                setlist["songIds"]!.AsArray().Add(reader.GetString(2));
            }
        document.WriteTo(state.Snapshot);
        using (var command = Command(db, transaction, "SELECT key, value FROM preferences"))
        using (var reader = command.ExecuteReader())
            while (reader.Read()) state.Snapshot.Add(reader.GetString(0), reader.GetString(1));
        using (var command = Command(db, transaction, "SELECT collection, record_id, payload_json, deleted, expected_revision, local_version FROM pending_changes"))
        using (var reader = command.ExecuteReader())
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                var change = new PendingLibraryChange { Collection = reader.GetString(0), Id = reader.GetString(1),
                    Payload = ParseObject(reader.GetString(2)), Deleted = reader.GetInt64(3) != 0,
                    ExpectedRevision = reader.IsDBNull(4) ? null : reader.GetInt64(4), LocalVersion = reader.GetString(5) };
                state.PendingChanges.Add(Key(change.Collection, change.Id), change);
            }
        using (var command = Command(db, transaction, "SELECT collection, record_id, remote_revision, modified_at, deleted FROM remote_records"))
        using (var reader = command.ExecuteReader())
            while (reader.Read())
            {
                var key = Key(reader.GetString(0), reader.GetString(1));
                if (!reader.IsDBNull(2)) state.RemoteRevisions.Add(key, reader.GetInt64(2));
                if (!reader.IsDBNull(3)) state.RemoteModified.Add(key, reader.GetInt64(3));
                if (reader.GetInt64(4) != 0) state.RemoteDeleted.Add(key);
            }
        using (var command = Command(db, transaction, "SELECT collection, revision FROM download_checkpoints"))
        using (var reader = command.ExecuteReader())
            while (reader.Read()) state.DownloadCursors.Add(reader.GetString(0), reader.GetInt64(1));
        ValidateState(state);
        return state;
    }

    private static List<JsonObject> ReadRecords(SqliteConnection db, SqliteTransaction transaction, string table, Field[] fields, CancellationToken ct)
    {
        var result = new List<JsonObject>();
        using var command = Command(db, transaction, $"SELECT {string.Join(',', fields.Select(f => f.Column))},extra_json FROM {table} ORDER BY ordinal,id");
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            ct.ThrowIfCancellationRequested();
            var record = ParseObject(reader.GetString(fields.Length));
            for (var i = 0; i < fields.Length; i++)
                record[fields[i].Name] = fields[i].Kind switch {
                    ValueKind.Text => JsonValue.Create(reader.GetString(i)),
                    ValueKind.Boolean => JsonValue.Create(reader.GetInt64(i) != 0),
                    _ => JsonValue.Create(reader.GetInt64(i)) };
            result.Add(record);
            if (result.Count > LibraryValidation.MaximumRecordsPerCollection)
                throw new LibraryValidationException("The local database exceeds the supported collection limit.");
        }
        return result;
    }

    private static JsonObject ParseObject(string json) => JsonNode.Parse(json, documentOptions: LibraryValidation.JsonOptions) as JsonObject
        ?? throw new LibraryValidationException("The local database contains a damaged JSON field.");

    private static void ValidateState(PersistedState state)
    {
        state.Snapshot = NormalizeSnapshot(state.Snapshot);
        foreach (var (key, change) in state.PendingChanges)
        {
            if (change is null || change.Payload is null || key != Key(change.Collection, change.Id) || string.IsNullOrWhiteSpace(change.LocalVersion) || change.ExpectedRevision is <= 0)
                throw new LibraryValidationException("The local profile contains damaged pending changes.");
            ValidateRemote(change.Collection, change.Id, change.Payload, change.Deleted);
        }
        foreach (var key in state.RemoteRevisions.Keys.Union(state.RemoteModified.Keys).Union(state.RemoteDeleted)) SplitKey(key);
        if (state.RemoteRevisions.Values.Any(x => x <= 0) || state.DownloadCursors.Any(x => x.Key is not ("songs" or "setlists") || x.Value < 0)
            || state.RemoteModified.Values.Any(x => x < LibraryValidation.MinimumTimestampMilliseconds || x > LibraryValidation.MaximumTimestampMilliseconds))
            throw new LibraryValidationException("The local profile contains damaged synchronization metadata.");
        var size = state.Snapshot.Sum(x => (long)Encoding.UTF8.GetByteCount(x.Value));
        foreach (var (key, change) in state.PendingChanges)
            size += Encoding.UTF8.GetByteCount(change.Payload.ToJsonString(SerializerOptions)) + Encoding.UTF8.GetByteCount(key)
                + Encoding.UTF8.GetByteCount(change.LocalVersion) + 128L;
        foreach (var key in state.RemoteRevisions.Keys) size += Encoding.UTF8.GetByteCount(key) + 32L;
        foreach (var key in state.RemoteModified.Keys) size += Encoding.UTF8.GetByteCount(key) + 32L;
        foreach (var key in state.RemoteDeleted) size += Encoding.UTF8.GetByteCount(key) + 8L;
        if (size > LibraryValidation.MaximumImportBytes * 4L) throw new LibraryValidationException("The local profile exceeds the supported storage limit.");
    }

    private static PersistedState CloneState(PersistedState state) => new() {
        Snapshot = new(state.Snapshot, StringComparer.Ordinal),
        PendingChanges = state.PendingChanges.ToDictionary(x => x.Key, x => CloneChange(x.Value), StringComparer.Ordinal),
        RemoteRevisions = new(state.RemoteRevisions, StringComparer.Ordinal), RemoteModified = new(state.RemoteModified, StringComparer.Ordinal),
        DownloadCursors = new(state.DownloadCursors, StringComparer.Ordinal), RemoteDeleted = new(state.RemoteDeleted, StringComparer.Ordinal) };

    private static void WriteChanges(SqliteConnection db, SqliteTransaction transaction, PersistedState before, PersistedState after, CancellationToken ct)
    {
        var prior = LibraryDocument.FromSnapshot(before.Snapshot);
        var next = LibraryDocument.FromSnapshot(after.Snapshot);
        var priorReferences = SongReferences(prior);
        foreach (var id in SongReferences(next).Except(priorReferences))
            Execute(db, transaction, "INSERT OR IGNORE INTO song_references(id) VALUES($id)", ("$id", id));
        WriteRecords(db, transaction, "songs", SongFields, prior.Songs, next.Songs, ct);
        WriteRecords(db, transaction, "setlists", SetlistFields, prior.Setlists, next.Setlists, ct);
        var priorSetlists = prior.Setlists.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        foreach (var setlist in next.Setlists)
        {
            var id = LibraryValidation.Id(setlist);
            var oldIds = priorSetlists.TryGetValue(id, out var previous) ? previous["songIds"]!.AsArray() : new JsonArray();
            var newIds = setlist["songIds"]!.AsArray();
            if (JsonNode.DeepEquals(oldIds, newIds)) continue;
            Execute(db, transaction, "DELETE FROM setlist_songs WHERE setlist_id=$id AND position >= $count", ("$id", id), ("$count", newIds.Count));
            for (var i = 0; i < newIds.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                if (i < oldIds.Count && JsonNode.DeepEquals(oldIds[i], newIds[i])) continue;
                Execute(db, transaction, "INSERT INTO setlist_songs(setlist_id,position,song_id) VALUES($id,$position,$song) ON CONFLICT(setlist_id,position) DO UPDATE SET song_id=excluded.song_id",
                    ("$id", id), ("$position", i), ("$song", newIds[i]!.GetValue<string>()));
            }
        }
        foreach (var key in before.Snapshot.Keys.Union(after.Snapshot.Keys).Where(x => x is not (LibraryStorageKeys.Songs or LibraryStorageKeys.Setlists or LibraryStorageKeys.LegacyPlaylists)))
        {
            var exists = after.Snapshot.TryGetValue(key, out var value);
            if (!exists) Execute(db, transaction, "DELETE FROM preferences WHERE key=$key", ("$key", key));
            else if (!before.Snapshot.TryGetValue(key, out var old) || old != value)
                Execute(db, transaction, "INSERT INTO preferences(key,value) VALUES($key,$value) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("$key", key), ("$value", value));
        }
        foreach (var key in before.PendingChanges.Keys.Union(after.PendingChanges.Keys))
        {
            ct.ThrowIfCancellationRequested();
            var (collection, id) = SplitKey(key);
            if (!after.PendingChanges.TryGetValue(key, out var change))
                Execute(db, transaction, "DELETE FROM pending_changes WHERE collection=$collection AND record_id=$id", ("$collection", collection), ("$id", id));
            else if (!before.PendingChanges.TryGetValue(key, out var old) || old.LocalVersion != change.LocalVersion || old.ExpectedRevision != change.ExpectedRevision
                || old.Deleted != change.Deleted || !JsonNode.DeepEquals(old.Payload, change.Payload))
                Execute(db, transaction, "INSERT INTO pending_changes(collection,record_id,payload_json,deleted,expected_revision,local_version) VALUES($collection,$id,$payload,$deleted,$revision,$version) ON CONFLICT(collection,record_id) DO UPDATE SET payload_json=excluded.payload_json,deleted=excluded.deleted,expected_revision=excluded.expected_revision,local_version=excluded.local_version",
                    ("$collection", collection), ("$id", id), ("$payload", change.Payload.ToJsonString(SerializerOptions)), ("$deleted", change.Deleted ? 1 : 0),
                    ("$revision", change.ExpectedRevision), ("$version", change.LocalVersion));
        }
        foreach (var key in before.RemoteRevisions.Keys.Union(after.RemoteRevisions.Keys).Union(before.RemoteModified.Keys).Union(after.RemoteModified.Keys).Union(before.RemoteDeleted).Union(after.RemoteDeleted))
        {
            var (collection, id) = SplitKey(key);
            var revision = Optional(after.RemoteRevisions, key); var modified = Optional(after.RemoteModified, key); var deleted = after.RemoteDeleted.Contains(key);
            if (revision == Optional(before.RemoteRevisions, key) && modified == Optional(before.RemoteModified, key) && deleted == before.RemoteDeleted.Contains(key)) continue;
            if (revision is null && modified is null && !deleted)
                Execute(db, transaction, "DELETE FROM remote_records WHERE collection=$collection AND record_id=$id", ("$collection", collection), ("$id", id));
            else Execute(db, transaction, "INSERT INTO remote_records(collection,record_id,remote_revision,modified_at,deleted) VALUES($collection,$id,$revision,$modified,$deleted) ON CONFLICT(collection,record_id) DO UPDATE SET remote_revision=excluded.remote_revision,modified_at=excluded.modified_at,deleted=excluded.deleted",
                ("$collection", collection), ("$id", id), ("$revision", revision), ("$modified", modified), ("$deleted", deleted ? 1 : 0));
        }
        foreach (var key in before.DownloadCursors.Keys.Union(after.DownloadCursors.Keys))
        {
            if (!after.DownloadCursors.TryGetValue(key, out var revision)) Execute(db, transaction, "DELETE FROM download_checkpoints WHERE collection=$collection", ("$collection", key));
            else if (!before.DownloadCursors.TryGetValue(key, out var old) || old != revision)
                Execute(db, transaction, "INSERT INTO download_checkpoints(collection,revision) VALUES($collection,$revision) ON CONFLICT(collection) DO UPDATE SET revision=excluded.revision", ("$collection", key), ("$revision", revision));
        }
        if (!priorReferences.SetEquals(SongReferences(next)))
            Execute(db, transaction, "DELETE FROM song_references WHERE NOT EXISTS(SELECT 1 FROM songs WHERE songs.id=song_references.id) AND NOT EXISTS(SELECT 1 FROM setlist_songs WHERE setlist_songs.song_id=song_references.id)");
    }

    private static void WriteRecords(SqliteConnection db, SqliteTransaction transaction, string table, Field[] fields, List<JsonObject> prior, List<JsonObject> next, CancellationToken ct)
    {
        var before = prior.Select((record, ordinal) => (record, ordinal)).ToDictionary(x => LibraryValidation.Id(x.record), StringComparer.Ordinal);
        var nextIds = next.Select(LibraryValidation.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var id in before.Keys.Except(nextIds)) Execute(db, transaction, $"DELETE FROM {table} WHERE id=$id", ("$id", id));
        var columns = fields.Select(f => f.Column).Concat(["extra_json", "ordinal"]).ToArray();
        var sql = $"INSERT INTO {table}({string.Join(',', columns)}) VALUES({string.Join(',', columns.Select(x => '$' + x))}) ON CONFLICT(id) DO UPDATE SET {string.Join(',', columns.Skip(1).Select(x => x + "=excluded." + x))}";
        for (var i = 0; i < next.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var record = next[i];
            if (before.TryGetValue(LibraryValidation.Id(record), out var old) && old.ordinal == i && SameRecordColumns(table, old.record, record)) continue;
            var extra = (JsonObject)record.DeepClone();
            var values = new List<(string, object?)>();
            foreach (var field in fields)
            {
                values.Add(("$" + field.Column, field.Kind switch { ValueKind.Text => record[field.Name]!.GetValue<string>(),
                    ValueKind.Boolean => record[field.Name]!.GetValue<bool>() ? 1L : 0L, _ => LibraryValidation.ReadInteger(record, field.Name, 0) }));
                extra.Remove(field.Name);
            }
            if (table == "setlists") extra.Remove("songIds");
            values.Add(("$extra_json", extra.ToJsonString(SerializerOptions))); values.Add(("$ordinal", i));
            Execute(db, transaction, sql, values.ToArray());
        }
    }

    private static bool SameRecordColumns(string table, JsonObject before, JsonObject after)
    {
        if (table != "setlists") return JsonNode.DeepEquals(before, after);
        // Membership changes belong to setlist_songs, so an unchanged parent row stays untouched.
        return before.Select(x => x.Key).Union(after.Select(x => x.Key)).Where(x => x != "songIds")
            .All(key => before.ContainsKey(key) == after.ContainsKey(key) && JsonNode.DeepEquals(before[key], after[key]));
    }

    private static HashSet<string> SongReferences(LibraryDocument document) => document.Songs.Select(LibraryValidation.Id)
        .Concat(document.Setlists.SelectMany(x => x["songIds"]!.AsArray().Select(y => y!.GetValue<string>()))).ToHashSet(StringComparer.Ordinal);
    private static long? Optional(Dictionary<string, long> values, string key) => values.TryGetValue(key, out var value) ? value : null;
    private static (string Collection, string Id) SplitKey(string key)
    {
        var colon = key.IndexOf(':');
        if (colon < 0 || colon == key.Length - 1) throw new LibraryValidationException("Invalid library sync identity.");
        var collection = key[..colon]; var id = key[(colon + 1)..];
        Key(collection, id);
        if (id.Length > 1024) throw new LibraryValidationException("Invalid library sync identity.");
        return (collection, id);
    }
    private static SqliteCommand Command(SqliteConnection db, SqliteTransaction? transaction, string sql, params (string Name, object? Value)[] values)
    {
        var command = db.CreateCommand(); command.Transaction = transaction; command.CommandText = sql;
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }
    private static void Execute(SqliteConnection db, SqliteTransaction? transaction, string sql, params (string Name, object? Value)[] values)
    { using var command = Command(db, transaction, sql, values); command.ExecuteNonQuery(); }
    private static object? Scalar(SqliteConnection db, SqliteTransaction? transaction, string sql)
    { using var command = Command(db, transaction, sql); return command.ExecuteScalar(); }

    private const string Schema = """
        CREATE TABLE profile_metadata(id INTEGER PRIMARY KEY CHECK(id=1), profile_hash TEXT NOT NULL, legacy_imported INTEGER NOT NULL CHECK(legacy_imported IN(0,1)));
        CREATE TABLE song_references(id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE songs(id TEXT PRIMARY KEY NOT NULL REFERENCES song_references(id), title TEXT NOT NULL, artist TEXT NOT NULL, content TEXT NOT NULL,
            transpose_steps INTEGER NOT NULL CHECK(transpose_steps BETWEEN -11 AND 11), two_column INTEGER NOT NULL CHECK(two_column IN(0,1)),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), ordinal INTEGER NOT NULL CHECK(ordinal>=0));
        CREATE INDEX songs_title ON songs(title COLLATE NOCASE);
        CREATE INDEX songs_artist ON songs(artist COLLATE NOCASE);
        CREATE INDEX songs_updated ON songs(updated_at);
        CREATE TABLE setlists(id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL, extra_json TEXT NOT NULL CHECK(json_valid(extra_json)), ordinal INTEGER NOT NULL CHECK(ordinal>=0));
        CREATE INDEX setlists_name ON setlists(name COLLATE NOCASE);
        CREATE TABLE setlist_songs(setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0),
            song_id TEXT NOT NULL REFERENCES song_references(id), PRIMARY KEY(setlist_id,position));
        CREATE INDEX setlist_songs_song ON setlist_songs(song_id);
        CREATE TABLE preferences(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE pending_changes(collection TEXT NOT NULL CHECK(collection IN('songs','setlists')), record_id TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), deleted INTEGER NOT NULL CHECK(deleted IN(0,1)),
            expected_revision INTEGER CHECK(expected_revision>0), local_version TEXT NOT NULL, PRIMARY KEY(collection,record_id));
        CREATE TABLE remote_records(collection TEXT NOT NULL CHECK(collection IN('songs','setlists')), record_id TEXT NOT NULL,
            remote_revision INTEGER CHECK(remote_revision>0), modified_at INTEGER, deleted INTEGER NOT NULL CHECK(deleted IN(0,1)), PRIMARY KEY(collection,record_id));
        CREATE TABLE download_checkpoints(collection TEXT PRIMARY KEY CHECK(collection IN('songs','setlists')), revision INTEGER NOT NULL CHECK(revision>=0));
        """;
}
