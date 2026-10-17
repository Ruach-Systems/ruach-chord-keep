using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace ChordLibrary.Core;

public sealed record SongHistoryEntry(long Version, string SongId, long SavedAt, JsonObject Song);
public sealed record LocalSyncStatus(int Pending, DateTimeOffset? LastChecked);

public sealed partial class LocalLibraryStore
{
    public const int SongHistoryLimit = 30;
    private const string HistorySchema = """
        CREATE TABLE IF NOT EXISTS song_history(version INTEGER PRIMARY KEY AUTOINCREMENT, song_id TEXT NOT NULL, saved_at INTEGER NOT NULL, payload_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS song_history_song ON song_history(song_id,version DESC);
        CREATE TABLE IF NOT EXISTS sync_status(id INTEGER PRIMARY KEY CHECK(id=1), last_checked INTEGER NOT NULL);
        """;

    private static void CaptureSongHistory(SqliteConnection db, SqliteTransaction tx,
        List<JsonObject> before, List<JsonObject> after, CancellationToken ct)
    {
        var next = after.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        foreach (var song in before)
        {
            ct.ThrowIfCancellationRequested();
            var id = LibraryValidation.Id(song);
            // Reading layout, transposition and timestamp-only acknowledgments are not editorial versions.
            if (next.TryGetValue(id, out var current) && new[] { "title", "artist", "content" }
                .All(field => JsonNode.DeepEquals(song[field], current[field]))) continue;
            Execute(db, tx, "INSERT INTO song_history(song_id,saved_at,payload_json) VALUES($id,$time,$payload)",
                ("$id", id), ("$time", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()), ("$payload", song.ToJsonString(SerializerOptions)));
            Execute(db, tx, "DELETE FROM song_history WHERE song_id=$id AND version NOT IN (SELECT version FROM song_history WHERE song_id=$id ORDER BY version DESC LIMIT 30)", ("$id", id));
        }
    }

    // History is queried separately: normal sync never reads the historical payloads.
    public Task<List<SongHistoryEntry>> ReadSongHistoryAsync(string profile, string songId, CancellationToken ct = default) =>
        WithHistoryDatabaseAsync(profile, false, (db, tx) =>
        {
            var entries = new List<SongHistoryEntry>();
            using var command = Command(db, tx, "SELECT version,saved_at,payload_json FROM song_history WHERE song_id=$id ORDER BY version DESC LIMIT 30", ("$id", songId));
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                entries.Add(new(reader.GetInt64(0), songId, reader.GetInt64(1), ParseObject(reader.GetString(2))));
            }
            return entries;
        }, ct);

    public Task RestoreSongHistoryAsync(string profile, string songId, long version, CancellationToken ct = default) =>
        WithHistoryDatabaseAsync(profile, true, (db, tx) =>
        {
            using var command = Command(db, tx, "SELECT payload_json FROM song_history WHERE song_id=$id AND version=$version", ("$id", songId), ("$version", version));
            var json = command.ExecuteScalar() as string ?? throw new InvalidOperationException("This version is no longer available on this device.");
            var saved = LibraryValidation.ValidateRecord(ParseObject(json), "songs");
            var state = ReadDatabase(db, tx, ct);
            var before = CloneState(state);
            var document = LibraryDocument.FromSnapshot(state.Snapshot);
            var current = document.Songs.FirstOrDefault(s => LibraryValidation.Id(s) == songId)
                ?? throw new InvalidOperationException("This song was removed. Close history and refresh your library.");
            // Restore editorial fields only, preserving current identity, layout and future metadata.
            foreach (var field in new[] { "title", "artist", "content" }) current[field] = saved[field]?.DeepClone();
            var newest = Math.Max(LibraryValidation.Modified(current), state.RemoteModified.GetValueOrDefault(Key("songs", songId)));
            current["updatedAt"] = Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), checked(newest + 1));
            QueueChange(state, "songs", songId, current, false);
            document.WriteTo(state.Snapshot);
            ValidateState(state);
            WriteChanges(db, tx, before, state, ct);
            return true;
        }, ct);

    public Task<LocalSyncStatus> ReadLocalSyncStatusAsync(string profile, CancellationToken ct = default) =>
        WithHistoryDatabaseAsync(profile, false, (db, tx) =>
        {
            var count = Convert.ToInt32(Scalar(db, tx, "SELECT COUNT(*) FROM pending_changes"));
            var checkedAt = Scalar(db, tx, "SELECT last_checked FROM sync_status WHERE id=1");
            return new LocalSyncStatus(count, checkedAt is long value ? DateTimeOffset.FromUnixTimeMilliseconds(value) : null);
        }, ct);

    public Task MarkCloudCheckedAsync(string profile, CancellationToken ct = default) =>
        WithHistoryDatabaseAsync(profile, true, (db, tx) =>
        {
            Execute(db, tx, "INSERT INTO sync_status(id,last_checked) VALUES(1,$time) ON CONFLICT(id) DO UPDATE SET last_checked=excluded.last_checked",
                ("$time", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            return true;
        }, ct);

    private async Task<T> WithHistoryDatabaseAsync<T>(string profile, bool write, Func<SqliteConnection, SqliteTransaction, T> operation, CancellationToken ct)
    {
        var path = ProfilePath(profile);
        var gate = Gates.GetOrAdd(path, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await Task.Run(async () =>
            {
                using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, ForeignKeys = true, Pooling = false, DefaultTimeout = 10 }.ToString());
                db.Open();
                await InitializeDatabaseAsync(db, path, ct).ConfigureAwait(false);
                using var tx = db.BeginTransaction(deferred: !write);
                var result = operation(db, tx);
                ct.ThrowIfCancellationRequested();
                tx.Commit();
                return result;
            }, ct).ConfigureAwait(false);
        }
        finally { gate.Release(); }
    }
}
