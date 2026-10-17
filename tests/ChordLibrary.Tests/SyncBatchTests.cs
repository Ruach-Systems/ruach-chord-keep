using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Tests;

public sealed partial class LocalLibraryStoreTests
{
    private static RemoteDocument Row(string id, long revision, long time = 10, bool deleted = false) =>
        new("songs", id, Song(id, "Cloud " + revision, time), deleted, revision, DateTimeOffset.UtcNow);

    [Fact]
    public async Task InvalidPageRollsBackEarlierRowsAndCheckpoint()
    {
        await Store.MergeSyncBatchAsync("guest", [Row("a", 1)]);
        var invalid = Row("bad", 3); invalid.Payload["transposeSteps"] = 99;
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.MergeSyncBatchAsync("guest", [Row("b", 2), invalid]));
        var reopened = new LocalLibraryStore(_directory);
        Assert.Equal("a", LibraryValidation.Id(Assert.Single((await reopened.ReadDocumentAsync("guest")).Songs)));
        Assert.Equal(1, (await reopened.ReadSyncStateAsync("guest")).DownloadCursors["songs"]);
    }

    [Fact]
    public async Task BatchSeesEarlierRowsAndPreservesLatestUpdateOnRepeatedId()
    {
        await Store.MergeSyncBatchAsync("guest", [Row("a", 1, 30), Row("a", 2, 20), Row("b", 3)]);
        var state = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(3, state.DownloadCursors["songs"]);
        Assert.Equal(30, LibraryValidation.Modified((await Store.ReadDocumentAsync("guest")).Songs.Single(s => LibraryValidation.Id(s) == "a")));
        Assert.Equal(2, Assert.Single(state.PendingChanges).ExpectedRevision);
    }

    [Fact]
    public async Task BatchedDeletionRepairsSetlistsAndPreservesUnknownFields()
    {
        await Store.MergeSyncBatchAsync("guest", [Row("a", 1), Row("b", 2)]);
        await Store.MergeSyncRemoteAsync("guest", "setlists", "list", new JsonObject
        { ["id"] = "list", ["name"] = "Practice", ["songIds"] = new JsonArray("a", "b", "a"), ["extra"] = "keep" }, false, 3);
        await Store.MergeSyncBatchAsync("guest", [Row("a", 4, 20, true), Row("b", 5, 20)]);
        var list = Assert.Single((await Store.ReadDocumentAsync("guest")).Setlists);
        Assert.Equal("[\"b\"]", list["songIds"]!.ToJsonString());
        Assert.Equal("keep", list["extra"]!.GetValue<string>());
        Assert.Equal("setlists", Assert.Single((await Store.ReadSyncStateAsync("guest")).PendingChanges).Collection);
    }

    [Fact]
    public async Task BadRevisionOrderAndOversizedPagesAreRejected()
    {
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.MergeSyncBatchAsync("guest", [Row("a", 2), Row("b", 1)]));
        await Assert.ThrowsAsync<ArgumentException>(() => Store.MergeSyncBatchAsync("guest", Enumerable.Range(1, 501).Select(i => Row("s" + i, i)).ToArray()));
        Assert.Empty((await Store.ReadSyncStateAsync("guest")).DownloadCursors);
    }

    [Fact]
    public async Task CanceledPageDoesNotAdvanceCheckpoint()
    {
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Store.MergeSyncBatchAsync("guest", [Row("a", 1)], cancellation.Token));
        Assert.Empty((await Store.ReadSyncStateAsync("guest")).DownloadCursors);
    }

    [Fact]
    public async Task DelayedAcknowledgmentsPreserveConcurrentEditAndDoNotAdvanceDownloadCursor()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "First", 10), Song("b", "Second", 10)] });
        var sent = (await Store.ReadSyncStateAsync("guest")).PendingChanges;
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "Edited during upload", 20), Song("b", "Second", 10)] });
        await Store.AcknowledgeBatchAsync("guest", sent.Select((s, i) =>
            new LocalLibraryStore.SyncAcknowledgment(s.Collection, s.Id, s.LocalVersion, i + 1, 10)).ToArray());
        var reopened = await new LocalLibraryStore(_directory).ReadSyncStateAsync("guest");
        Assert.Empty(reopened.DownloadCursors);
        var pending = Assert.Single(reopened.PendingChanges);
        Assert.Equal("a", pending.Id); Assert.Equal(1, pending.ExpectedRevision);
        Assert.Equal("Edited during upload", pending.Payload["title"]!.GetValue<string>());
    }
}
