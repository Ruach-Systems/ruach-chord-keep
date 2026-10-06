using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public sealed partial class LocalLibraryStoreTests
{
    private string ProfileFile(string profile, string extension) => Path.Combine(_directory,
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(profile))).ToLowerInvariant() + extension);
    private async Task<string> WriteLegacyAsync(string profile, JsonObject state)
    {
        Directory.CreateDirectory(_directory);
        var path = ProfileFile(profile, ".json");
        await File.WriteAllTextAsync(path, state.ToJsonString()); return path;
    }
    private SqliteConnection OpenDatabase(string profile = "guest")
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = ProfileFile(profile, ".sqlite3"), Pooling = false, ForeignKeys = true }.ToString());
        db.Open(); return db;
    }
    private static void Sql(SqliteConnection db, string sql)
    { using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private static object? Query(SqliteConnection db, string sql)
    { using var command = db.CreateCommand(); command.CommandText = sql; return command.ExecuteScalar(); }
    private static JsonObject SnapshotJson(IReadOnlyDictionary<string, string> snapshot)
    { var json = new JsonObject(); foreach (var (key, value) in snapshot) json[key] = value; return json; }

    [Fact]
    public async Task JsonUpgradePreservesRecordsExtrasOrderPreferencesAndAllSyncState()
    {
        const string profile = "user:alice";
        var song = Song("a", "Offline title", 200);
        song["artist"] = "Artist"; song["content"] = "  C | G\nLyrics\n\n";
        song["future"] = new JsonObject { ["tags"] = new JsonArray("worship", "practice") };
        var document = LibraryValidation.Validate(new LibraryDocument { Songs = [song], Setlists = [new JsonObject {
            ["id"] = "set", ["name"] = "Practice", ["songIds"] = new JsonArray("a", "missing", "a"), ["updatedAt"] = 201, ["color"] = "blue" }] });
        var snapshot = new Dictionary<string, string> { ["chord-library-theme"] = "light", ["chord-library-font-size"] = "18" };
        document.WriteTo(snapshot);
        var tombstone = LibraryValidation.ValidateRecord(new JsonObject { ["id"] = "gone", ["deleted"] = true, ["updatedAt"] = 300 }, "songs");
        var path = await WriteLegacyAsync(profile, new JsonObject {
            ["SchemaVersion"] = 1, ["Snapshot"] = SnapshotJson(snapshot),
            ["PendingChanges"] = new JsonObject {
                ["songs:a"] = new JsonObject { ["Collection"] = "songs", ["Id"] = "a", ["Payload"] = document.Songs[0].DeepClone(), ["Deleted"] = false, ["ExpectedRevision"] = 8, ["LocalVersion"] = "existing-edit-version" },
                ["songs:gone"] = new JsonObject { ["Collection"] = "songs", ["Id"] = "gone", ["Payload"] = tombstone, ["Deleted"] = true, ["ExpectedRevision"] = 7, ["LocalVersion"] = "existing-delete-version" } },
            ["RemoteRevisions"] = new JsonObject { ["songs:a"] = 8, ["songs:gone"] = 7, ["setlists:set"] = 11 },
            ["RemoteModified"] = new JsonObject { ["songs:a"] = 100, ["songs:gone"] = 150 },
            ["RemoteDeleted"] = new JsonArray("songs:gone"), ["DownloadCursors"] = new JsonObject { ["songs"] = 9, ["setlists"] = 11 }
        });
        var bytes = await File.ReadAllBytesAsync(path);
        await File.WriteAllTextAsync(path + ".bak", "original recovery copy");
        var state = await Store.ReadSyncStateAsync(profile);
        Assert.True(JsonNode.DeepEquals(document.Songs[0], (await Store.ReadDocumentAsync(profile)).Songs[0]));
        Assert.True(JsonNode.DeepEquals(document.Setlists[0], (await Store.ReadDocumentAsync(profile)).Setlists[0]));
        Assert.Equal("light", state.Snapshot["chord-library-theme"]);
        Assert.Equal("18", state.Snapshot["chord-library-font-size"]);
        Assert.Equal(9, state.DownloadCursors["songs"]); Assert.Equal(11, state.DownloadCursors["setlists"]);
        Assert.Equal(8, state.RemoteRevisions["songs:a"]); Assert.Equal(150, state.RemoteModified["songs:gone"]);
        Assert.Equal("existing-edit-version", state.PendingChanges.Single(x => x.Id == "a").LocalVersion);
        var deletion = state.PendingChanges.Single(x => x.Id == "gone");
        Assert.True(deletion.Deleted); Assert.Equal(7, deletion.ExpectedRevision);
        Assert.Equal("existing-delete-version", deletion.LocalVersion);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
        Assert.Equal("original recovery copy", await File.ReadAllTextAsync(path + ".bak"));
        using var db = OpenDatabase(profile);
        Assert.Equal(2L, Query(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN('songs_title','songs_artist')"));
        Assert.Equal("Offline title", Query(db, "SELECT title FROM songs WHERE id='a'"));
        Assert.Equal(3L, Query(db, "SELECT COUNT(*) FROM setlist_songs"));
        Assert.Equal(1L, Query(db, "SELECT legacy_imported FROM profile_metadata"));
        Assert.Equal(1L, Query(db, "SELECT deleted FROM remote_records WHERE record_id='gone'"));
        var extra = JsonNode.Parse((string)Query(db, "SELECT extra_json FROM songs WHERE id='a'")!)!.AsObject();
        Assert.False(extra.ContainsKey("title")); Assert.False(extra.ContainsKey("content")); Assert.True(extra.ContainsKey("future"));
        Assert.Null(Query(db, "PRAGMA foreign_key_check"));
    }

    [Fact]
    public async Task SuccessfulUpgradeIsNotReplayedAndLaterEditsSurviveRestart()
    {
        var legacy = await WriteLegacyAsync("guest", new JsonObject { ["SchemaVersion"] = 1, ["Snapshot"] = new JsonObject {
            [LibraryStorageKeys.Songs] = new JsonArray(Song("a", "Legacy")).ToJsonString(), [LibraryStorageKeys.Setlists] = "[]" } });
        await Store.ReadDocumentAsync("guest");
        await Store.ImportAsync("guest", Backup("a", "SQLite edit", 20));
        await File.WriteAllTextAsync(legacy, "old file changed after upgrade");
        Assert.Equal("SQLite edit", Assert.Single((await Store.ReadDocumentAsync("guest")).Songs)["title"]!.GetValue<string>());
        Assert.Single((await Store.ReadSyncStateAsync("guest")).PendingChanges);
    }

    [Fact]
    public async Task FailedLegacyUpgradeLeavesSourceIntactAndCanBeRetriedAfterRepair()
    {
        var path = await WriteLegacyAsync("guest", new JsonObject { ["SchemaVersion"] = 1,
            ["Snapshot"] = new JsonObject { [LibraryStorageKeys.Songs] = "broken" } });
        var bytes = await File.ReadAllBytesAsync(path);
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ReadDocumentAsync("guest"));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
        using (var db = OpenDatabase()) {
            Assert.Equal(0L, Query(db, "PRAGMA user_version"));
            Assert.Equal(0L, Query(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='profile_metadata'"));
        }
        await WriteLegacyAsync("guest", new JsonObject { ["SchemaVersion"] = 1, ["Snapshot"] = new JsonObject {
            [LibraryStorageKeys.Songs] = new JsonArray(Song("a", "Recovered")).ToJsonString() } });
        Assert.Equal("Recovered", Assert.Single((await Store.ReadDocumentAsync("guest")).Songs)["title"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DatabaseFailureRollsBackRecordsOutboxAndDownloadCheckpoint(bool remote)
    {
        await Store.MergeSyncRemoteAsync("guest", "songs", "a", Song("a", "Original"), false, 1, checkpoint: true);
        var before = await Store.ReadSyncStateAsync("guest");
        using (var db = OpenDatabase())
            Sql(db, remote ? "CREATE TRIGGER fail_write BEFORE INSERT ON remote_records BEGIN SELECT RAISE(ABORT,'simulated remote-state failure'); END;"
                : "CREATE TRIGGER fail_write BEFORE INSERT ON pending_changes BEGIN SELECT RAISE(ABORT,'simulated outbox failure'); END;");
        await Assert.ThrowsAsync<SqliteException>(() => remote
            ? Store.MergeSyncRemoteAsync("guest", "songs", "b", Song("b", "New cloud song"), false, 2, checkpoint: true)
            : Store.SaveDocumentAsync("guest", new LibraryDocument { Songs = [Song("a", "Local edit", 20)] }));
        var after = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(before.Snapshot, after.Snapshot); Assert.Empty(after.PendingChanges);
        Assert.Equal(before.DownloadCursors, after.DownloadCursors); Assert.Equal(before.RemoteRevisions, after.RemoteRevisions);
    }

    [Fact]
    public async Task UnsupportedLegacyVersionAndDamagedPendingStateNeverMarkMigrationComplete()
    {
        var path = await WriteLegacyAsync("guest", new JsonObject { ["SchemaVersion"] = 2 });
        var original = await File.ReadAllTextAsync(path);
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ReadDocumentAsync("guest"));
        Assert.Equal(original, await File.ReadAllTextAsync(path));
        await WriteLegacyAsync("guest", new JsonObject { ["SchemaVersion"] = 1,
            ["PendingChanges"] = new JsonObject { ["songs:a"] = null } });
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ReadDocumentAsync("guest"));
        using var db = OpenDatabase(); Assert.Equal(0L, Query(db, "PRAGMA user_version"));
    }

    [Fact]
    public async Task SavingOneEditWritesOnlyThatRecordAndItsPendingChange()
    {
        await Store.MergeSyncRemoteAsync("guest", "songs", "a", Song("a", "A"), false, 1, checkpoint: true);
        await Store.MergeSyncRemoteAsync("guest", "songs", "b", Song("b", "B"), false, 2, checkpoint: true);
        using (var db = OpenDatabase()) Sql(db, """
            CREATE TABLE write_audit(kind TEXT,record_id TEXT);
            CREATE TRIGGER audit_songs AFTER UPDATE ON songs BEGIN INSERT INTO write_audit VALUES('song',new.id); END;
            CREATE TRIGGER audit_outbox AFTER INSERT ON pending_changes BEGIN INSERT INTO write_audit VALUES('pending',new.record_id); END;
            """);
        var document = await Store.ReadDocumentAsync("guest"); document.Songs[0]["title"] = "Edited A";
        await Store.SaveDocumentAsync("guest", document);
        using (var db = OpenDatabase()) {
            Assert.Equal(1L, Query(db, "SELECT COUNT(*) FROM write_audit WHERE kind='song' AND record_id='a'"));
            Assert.Equal(1L, Query(db, "SELECT COUNT(*) FROM write_audit WHERE kind='pending' AND record_id='a'"));
            Assert.Equal(0L, Query(db, "SELECT COUNT(*) FROM write_audit WHERE record_id='b'"));
            Sql(db, "DELETE FROM write_audit;");
        }
        var pending = Assert.Single((await Store.ReadSyncStateAsync("guest")).PendingChanges);
        await Store.SaveDocumentAsync("guest", document);
        Assert.Equal(pending.LocalVersion, Assert.Single((await Store.ReadSyncStateAsync("guest")).PendingChanges).LocalVersion);
        using var unchanged = OpenDatabase(); Assert.Equal(0L, Query(unchanged, "SELECT COUNT(*) FROM write_audit"));
    }

    [Fact]
    public async Task SetlistReorderPreservesDuplicatesAndMissingReferencesThroughRestart()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "A")], Setlists = [new JsonObject {
            ["id"] = "set", ["name"] = "Set", ["songIds"] = new JsonArray("a", "missing", "a") }] });
        using (var db = OpenDatabase()) Sql(db, """
            CREATE TABLE write_audit(kind TEXT);
            CREATE TRIGGER audit_parent AFTER UPDATE ON setlists BEGIN INSERT INTO write_audit VALUES('parent'); END;
            CREATE TRIGGER audit_member AFTER UPDATE ON setlist_songs BEGIN INSERT INTO write_audit VALUES('member'); END;
            """);
        var document = await Store.ReadDocumentAsync("guest"); document.Setlists[0]["songIds"] = new JsonArray("missing", "a", "a");
        await Store.SaveDocumentAsync("guest", document);
        Assert.Equal("[\"missing\",\"a\",\"a\"]", Assert.Single((await Store.ReadDocumentAsync("guest")).Setlists)["songIds"]!.ToJsonString());
        using var verified = OpenDatabase(); Assert.Null(Query(verified, "PRAGMA foreign_key_check"));
        Assert.Equal("missing", Query(verified, "SELECT song_id FROM setlist_songs WHERE position=0"));
        Assert.Equal(2L, Query(verified, "SELECT COUNT(*) FROM write_audit WHERE kind='member'"));
        Assert.Equal(0L, Query(verified, "SELECT COUNT(*) FROM write_audit WHERE kind='parent'"));
    }

    [Fact]
    public async Task UnsupportedDatabaseVersionAndWrongProfileNeverResetData()
    {
        await Store.ImportAsync("guest", Backup("a", "Keep"));
        using (var db = OpenDatabase()) Sql(db, "PRAGMA user_version=99;");
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ReadDocumentAsync("guest"));
        using (var db = OpenDatabase()) {
            Assert.Equal("Keep", Query(db, "SELECT title FROM songs WHERE id='a'"));
            Sql(db, "PRAGMA user_version=1; UPDATE profile_metadata SET profile_hash='wrong-profile';");
        }
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ReadDocumentAsync("guest"));
        using var kept = OpenDatabase(); Assert.Equal("Keep", Query(kept, "SELECT title FROM songs WHERE id='a'"));
    }

    [Fact]
    public async Task CancelledMutationKeepsSavedRecordsAndPendingVersions()
    {
        await Store.ImportAsync("guest", Backup("a", "Keep"));
        var before = await Store.ReadSyncStateAsync("guest");
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Store.ImportAsync("guest", Backup("b", "Not saved"), ct: cancellation.Token));
        var after = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(before.Snapshot, after.Snapshot); Assert.Equal(before.PendingChanges[0].LocalVersion, after.PendingChanges[0].LocalVersion);
    }
}
