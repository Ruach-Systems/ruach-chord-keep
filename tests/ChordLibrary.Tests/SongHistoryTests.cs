using System.Text.Json.Nodes;
using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public sealed partial class LocalLibraryStoreTests
{
    [Fact]
    public async Task HistorySurvivesRestartAndIgnoresTimestampAndLayoutChanges()
    {
        var song = Song("a", "Original", 10);
        await Store.SaveDocumentAsync("guest", new() { Songs = [song] });
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "a"));
        song["updatedAt"] = 20; song["transposeSteps"] = 2; song["twoColumn"] = true;
        await Store.SaveDocumentAsync("guest", new() { Songs = [song] });
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "a"));
        song["title"] = "Edited"; song["content"] = "  Am|\nLyrics <script>\n"; song["updatedAt"] = 30;
        await Store.SaveDocumentAsync("guest", new() { Songs = [song] });
        var prior = Assert.Single(await new LocalLibraryStore(_directory).ReadSongHistoryAsync("guest", "a"));
        Assert.Equal("Original", prior.Song["title"]!.GetValue<string>());
        Assert.Empty(await Store.ReadSongHistoryAsync("user:other", "a"));
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "other"));
    }

    [Fact]
    public async Task RestoreQueuesNewEditPreservesLayoutAndSavesReplacedVersion()
    {
        await Store.MergeSyncRemoteAsync("user:a", "songs", "a", Song("a", "Original", 10), false, 1, true);
        var edited = Song("a", "Edited", DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeMilliseconds());
        edited["content"] = "Dm|"; edited["transposeSteps"] = 3; edited["future"] = "keep";
        await Store.SaveDocumentAsync("user:a", new() { Songs = [edited] });
        var version = Assert.Single(await Store.ReadSongHistoryAsync("user:a", "a"));
        await Store.RestoreSongHistoryAsync("user:a", "a", version.Version);
        var state = await Store.ReadSyncStateAsync("user:a");
        var pending = Assert.Single(state.PendingChanges);
        Assert.Equal("Original", pending.Payload["title"]!.GetValue<string>());
        Assert.True(LibraryValidation.Modified(pending.Payload) > LibraryValidation.Modified(edited));
        Assert.Equal(3, pending.Payload["transposeSteps"]!.GetValue<int>());
        Assert.Equal("keep", pending.Payload["future"]!.GetValue<string>());
        Assert.Equal(1, pending.ExpectedRevision);
        Assert.Equal(1, state.DownloadCursors["songs"]);
        Assert.Equal("Edited", (await Store.ReadSongHistoryAsync("user:a", "a"))[0].Song["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task CloudReplacementAndDeletionKeepPriorVersionButInvalidPageDoesNot()
    {
        await Store.MergeSyncBatchAsync("guest", [Row("a", 1, 10)]);
        var invalid = Row("bad", 3, 30); invalid.Payload["transposeSteps"] = 99;
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.MergeSyncBatchAsync("guest", [Row("a", 2, 20), invalid]));
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "a"));
        await Store.MergeSyncBatchAsync("guest", [Row("a", 2, 20)]);
        Assert.Single(await Store.ReadSongHistoryAsync("guest", "a"));
        await Store.MergeSyncBatchAsync("guest", [Row("a", 3, 30, true)]);
        var entries = await Store.ReadSongHistoryAsync("guest", "a");
        Assert.Equal(2, entries.Count);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.RestoreSongHistoryAsync("guest", "a", entries[0].Version));
        Assert.Empty((await Store.ReadDocumentAsync("guest")).Songs);
    }

    [Fact]
    public async Task HistoryRetentionIsBoundedAndWrongVersionCannotRestoreAnotherSong()
    {
        for (var i = 0; i < 36; i++)
            await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "Title " + i, i + 1), Song("b", "Other", 1)] });
        var entries = await Store.ReadSongHistoryAsync("guest", "a");
        Assert.Equal(LocalLibraryStore.SongHistoryLimit, entries.Count);
        Assert.Equal("Title 34", entries[0].Song["title"]!.GetValue<string>());
        Assert.Equal("Title 5", entries[^1].Song["title"]!.GetValue<string>());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.RestoreSongHistoryAsync("guest", "b", entries[0].Version));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.RestoreSongHistoryAsync("user:other", "a", entries[0].Version));
    }

    [Fact]
    public async Task VersionOneUpgradePreservesPendingRecordsCursorsAndDoesNotInventHistory()
    {
        await Store.MergeSyncBatchAsync("guest", [Row("a", 1)]);
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "Pending", 30)] });
        var before = await Store.ReadSyncStateAsync("guest");
        using (var db = OpenDatabase()) Sql(db, "DROP TABLE song_history; DROP TABLE sync_status; PRAGMA user_version=1;");
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "a"));
        var after = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(before.Snapshot, after.Snapshot);
        Assert.Equal(before.PendingChanges[0].LocalVersion, after.PendingChanges[0].LocalVersion);
        Assert.Equal(before.DownloadCursors, after.DownloadCursors);
        using var reopened = OpenDatabase(); Assert.Equal(2L, Query(reopened, "PRAGMA user_version"));
    }

    [Fact]
    public async Task StatusIsLocalProfileScopedAndNotInExportOrSnapshot()
    {
        await Store.SaveDocumentAsync("user:a", new() { Songs = [Song("a", "First", 10)] });
        Assert.Null((await Store.ReadLocalSyncStatusAsync("user:a")).LastChecked);
        await Store.MarkCloudCheckedAsync("user:a");
        var status = await new LocalLibraryStore(_directory).ReadLocalSyncStatusAsync("user:a");
        Assert.Equal(1, status.Pending); Assert.NotNull(status.LastChecked);
        Assert.Null((await Store.ReadLocalSyncStatusAsync("guest")).LastChecked);
        Assert.DoesNotContain((await Store.ReadSnapshotAsync("user:a")).Keys, key => key.Contains("history") || key.Contains("last_checked"));
    }

    [Fact]
    public async Task CanceledRestoreDoesNotChangeSongOrHistory()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "First", 1)] });
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "Second", 2)] });
        var version = Assert.Single(await Store.ReadSongHistoryAsync("guest", "a"));
        using var canceled = new CancellationTokenSource(); canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Store.RestoreSongHistoryAsync("guest", "a", version.Version, canceled.Token));
        Assert.Equal("Second", (await Store.ReadDocumentAsync("guest")).Songs[0]["title"]!.GetValue<string>());
        Assert.Single(await Store.ReadSongHistoryAsync("guest", "a"));
    }

    [Fact]
    public async Task FailedSongWriteRollsBackHistoryAndPendingQueueTogether()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "First", 1)] });
        var before = await Store.ReadSyncStateAsync("guest");
        using (var db = OpenDatabase()) Sql(db, "CREATE TRIGGER reject_song BEFORE UPDATE ON songs BEGIN SELECT RAISE(ABORT,'test write failure'); END;");
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() => Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "Second", 2)] }));
        Assert.Empty(await Store.ReadSongHistoryAsync("guest", "a"));
        var after = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(before.Snapshot, after.Snapshot);
        Assert.Equal(before.PendingChanges[0].LocalVersion, after.PendingChanges[0].LocalVersion);
    }

    [Fact]
    public async Task NewerImportedEditKeepsOldVersionAndRepeatedImportDoesNotDuplicateHistory()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "First", 1)] });
        const string import = """{"songs":[{"id":"a","title":"Imported","content":"Dm|","updatedAt":100}],"setlists":[]}""";
        await Store.ImportAsync("guest", import);
        await Store.ImportAsync("guest", import);
        Assert.Equal("First", Assert.Single(await Store.ReadSongHistoryAsync("guest", "a")).Song["title"]!.GetValue<string>());
    }
}
