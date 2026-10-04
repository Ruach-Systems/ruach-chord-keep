using System.Text.Json.Nodes;
using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public sealed partial class LocalLibraryStoreTests
{
    [Theory]
    [InlineData(false, false, -1)]
    [InlineData(false, false, 0)]
    [InlineData(false, false, 1)]
    [InlineData(false, true, -1)]
    [InlineData(false, true, 0)]
    [InlineData(false, true, 1)]
    [InlineData(true, false, -1)]
    [InlineData(true, false, 0)]
    [InlineData(true, false, 1)]
    [InlineData(true, true, -1)]
    [InlineData(true, true, 0)]
    [InlineData(true, true, 1)]
    public async Task LatestTimestampWinsForEditsAndDeletions(bool localDeleted, bool remoteDeleted, int remoteOffset)
    {
        const string profile = "user:alice";
        await Store.AcceptRemoteAsync(profile, "songs", "a", Song("a", "Original", 1), false, 1);
        await Store.SaveDocumentAsync(profile, new() { Songs = localDeleted ? [] : [Song("a", "Local", 20)] });
        var local = Assert.Single((await Store.ReadSyncStateAsync(profile)).PendingChanges);
        var cloudTime = LibraryValidation.Modified(local.Payload) + remoteOffset;
        await Store.MergeSyncRemoteAsync(profile, "songs", "a", Song("a", "Cloud", cloudTime), remoteDeleted, 2, checkpoint: true);
        var reopened = new LocalLibraryStore(_directory);
        var state = await reopened.ReadSyncStateAsync(profile);
        Assert.Equal(2, state.DownloadCursors["songs"]);
        if (remoteOffset < 0)
        {
            var pending = Assert.Single(state.PendingChanges);
            Assert.Equal(local.LocalVersion, pending.LocalVersion);
            Assert.Equal(2, pending.ExpectedRevision);
            Assert.Equal(localDeleted, pending.Deleted);
        }
        else Assert.Empty(state.PendingChanges);
        var songs = (await reopened.ReadDocumentAsync(profile)).Songs;
        if (remoteOffset < 0 ? localDeleted : remoteDeleted) Assert.Empty(songs);
        else Assert.Equal(remoteOffset < 0 ? "Local" : "Cloud", Assert.Single(songs)["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task FailedRemoteValidationLeavesSnapshotAndCheckpointUnchanged()
    {
        await Store.MergeSyncRemoteAsync("user:alice", "songs", "a", Song("a", "First"), false, 1, checkpoint: true);
        var file = Assert.Single(Directory.GetFiles(_directory, "*.json"));
        var before = await File.ReadAllBytesAsync(file);
        var invalid = Song("b", "Invalid"); invalid["transposeSteps"] = 99;
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.MergeSyncRemoteAsync("user:alice", "songs", "b", invalid, false, 2, checkpoint: true));
        Assert.Equal(before, await File.ReadAllBytesAsync(file));
        Assert.Equal(1, (await Store.ReadSyncStateAsync("user:alice")).DownloadCursors["songs"]);
    }

    [Fact]
    public async Task LegacyProfilesStartWithoutCheckpointRatherThanGuessingFromUploadRevisions()
    {
        await Store.ImportAsync("user:alice", Backup("a", "Legacy"));
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        await Store.AcknowledgeAsync("user:alice", "songs", "a", pending.LocalVersion, 100);
        var file = Assert.Single(Directory.GetFiles(_directory, "*.json"));
        var json = JsonNode.Parse(await File.ReadAllTextAsync(file))!.AsObject();
        json.Remove("DownloadCursors"); json.Remove("RemoteModified");
        await File.WriteAllTextAsync(file, json.ToJsonString());
        var reopened = await Store.ReadSyncStateAsync("user:alice");
        Assert.Empty(reopened.DownloadCursors);
        Assert.Equal(100, reopened.RemoteRevisions["songs:a"]);
        Assert.Single((await Store.ReadDocumentAsync("user:alice")).Songs);
    }

    [Fact]
    public async Task NewerRestoredSongDoesNotLoseSetlistReferencesToAnOlderTombstone()
    {
        await Store.MergeSyncRemoteAsync("user:alice", "songs", "a", Song("a", "Deleted", 10), true, 1, checkpoint: true);
        await Store.ImportAsync("user:alice", Backup("a", "Restored", 30));
        await Store.MergeSyncRemoteAsync("user:alice", "songs", "a", Song("a", "Deleted", 20), true, 2, checkpoint: true);
        await Store.MergeSyncRemoteAsync("user:alice", "setlists", "set", new JsonObject
            { ["id"] = "set", ["name"] = "Set", ["songIds"] = new JsonArray("a"), ["updatedAt"] = 40 }, false, 3, checkpoint: true);
        Assert.Equal("a", Assert.Single((await Store.ReadDocumentAsync("user:alice")).Setlists)["songIds"]![0]!.GetValue<string>());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task HigherServerRevisionCannotReplaceNewerSavedEditOrDeletion(bool deleted)
    {
        await Store.MergeSyncRemoteAsync("user:alice", "songs", "a", Song("a", "Newer", 30), deleted, 1, checkpoint: true);
        await Store.MergeSyncRemoteAsync("user:alice", "songs", "a", Song("a", "Older", 20), false, 2, checkpoint: true);
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal(30, LibraryValidation.Modified(pending.Payload));
        Assert.Equal(deleted, pending.Deleted);
        Assert.Equal(2, pending.ExpectedRevision);
    }
}
