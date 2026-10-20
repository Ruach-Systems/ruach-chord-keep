using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public sealed partial class LocalLibraryStoreTests
{
    [Fact]
    public async Task DisplayPatchStillUsesLatestUpdateWinsIncludingRemoteDeletion()
    {
        await Store.MergeSyncRemoteAsync("user:a", "songs", "a", Song("a", "Original", 10), false, 1, true);
        await Store.PatchSongDisplayAsync("user:a", "a", new(3));
        var local = (await Store.ReadDocumentAsync("user:a")).Songs[0];
        var timestamp = LibraryValidation.Modified(local);
        await Store.MergeSyncRemoteAsync("user:a", "songs", "a", Song("a", "Older", 20), false, 2, true);
        Assert.Equal("Original", (await Store.ReadDocumentAsync("user:a")).Songs[0]["title"]!.GetValue<string>());
        await Store.MergeSyncRemoteAsync("user:a", "songs", "a", Song("a", "Deleted", timestamp + 1), true, 3, true);
        Assert.Empty((await Store.ReadDocumentAsync("user:a")).Songs);
        Assert.Empty((await Store.ReadSyncStateAsync("user:a")).PendingChanges);
    }

    [Fact]
    public async Task RepeatedDisplayPatchIsNoOpAndConcurrentIndependentPatchesAreRetained()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "A", 10)] });
        await Task.WhenAll(
            Store.PatchSongDisplayAsync("guest", "a", new(2)),
            Store.PatchSongDisplayAsync("guest", "a", new(FontSize:20)),
            Store.PatchSongDisplayAsync("guest", "a", new(TwoColumn:true)));
        var song = (await Store.ReadDocumentAsync("guest")).Songs[0];
        Assert.Equal(2, song["transposeSteps"]!.GetValue<long>());
        Assert.Equal(20, song["fontSize"]!.GetValue<int>());
        Assert.True(song["twoColumn"]!.GetValue<bool>());
        await Store.PatchSongDisplayAsync("guest", "a", new(2, 20, true));
        Assert.Equal(LibraryValidation.Modified(song), LibraryValidation.Modified((await Store.ReadDocumentAsync("guest")).Songs[0]));
    }

    [Fact]
    public async Task DisplayPatchPreservesNewCloudEditorialFieldsAndQueuesNewerChange()
    {
        var cloud = Song("a", "New cloud title", DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeMilliseconds());
        cloud["content"] = "New cloud lyrics";
        cloud["future"] = "keep";
        await Store.MergeSyncRemoteAsync("user:a", "songs", "a", cloud, false, 4, true);
        Assert.True(await Store.PatchSongDisplayAsync("user:a", "a", new(2, 20, true)));
        var state = await Store.ReadSyncStateAsync("user:a");
        var pending = Assert.Single(state.PendingChanges);
        Assert.Equal("New cloud title", pending.Payload["title"]!.GetValue<string>());
        Assert.Equal("New cloud lyrics", pending.Payload["content"]!.GetValue<string>());
        Assert.Equal("keep", pending.Payload["future"]!.GetValue<string>());
        Assert.Equal(20, pending.Payload["fontSize"]!.GetValue<int>());
        Assert.True(LibraryValidation.Modified(pending.Payload) > LibraryValidation.Modified(cloud));
        Assert.Equal(4, pending.ExpectedRevision);
        Assert.Equal(4, state.DownloadCursors["songs"]);
        Assert.Empty(await Store.ReadSongHistoryAsync("user:a", "a"));
        Assert.False(await Store.PatchSongDisplayAsync("user:other", "a", new(1)));
        var reopened = new LocalLibraryStore(_directory);
        Assert.Equal(20, (await reopened.ReadDocumentAsync("user:a")).Songs[0]["fontSize"]!.GetValue<int>());
    }
    [Fact]
    public async Task DisplayPatchDoesNotResurrectDeletedSongs()
    {
        await Store.MergeSyncRemoteAsync("guest", "songs", "a", Song("a", "Before", 10), false, 1, true);
        await Store.MergeSyncRemoteAsync("guest", "songs", "a", Song("a", "Deleted", 20), true, 2, true);
        Assert.False(await Store.PatchSongDisplayAsync("guest", "a", new(2)));
        Assert.Empty((await Store.ReadDocumentAsync("guest")).Songs);
        Assert.Empty((await Store.ReadSyncStateAsync("guest")).PendingChanges);
    }
    [Fact]
    public async Task DisplayPatchesPreserveUnspecifiedSettingsAndRejectInvalidValues()
    {
        await Store.SaveDocumentAsync("guest", new() { Songs = [Song("a", "A", 10)] });
        await Store.PatchSongDisplayAsync("guest", "a", new(3, 22, true));
        await Store.PatchSongDisplayAsync("guest", "a", new(FontSize:18));
        var song = (await Store.ReadDocumentAsync("guest")).Songs[0];
        Assert.Equal(3, song["transposeSteps"]!.GetValue<long>());
        Assert.True(song["twoColumn"]!.GetValue<bool>());
        Assert.Equal(18, song["fontSize"]!.GetValue<int>());
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => Store.PatchSongDisplayAsync("guest", "a", new(99)));
    }
}
