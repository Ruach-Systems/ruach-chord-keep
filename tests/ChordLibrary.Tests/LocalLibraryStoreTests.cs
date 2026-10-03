using System.Text.Json.Nodes;
using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public sealed class LocalLibraryStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "chordlibrary-tests-" + Guid.NewGuid().ToString("N"));
    private LocalLibraryStore Store => new(_directory);

    [Fact]
    public async Task ProfilesRemainSeparateAndDataSurvivesNewStoreInstance()
    {
        await Store.ImportAsync("guest", Backup("guest-song", "Guest"));
        await Store.ImportAsync("user:alice", Backup("same-id", "Alice"));
        await Store.ImportAsync("user:bob", Backup("same-id", "Bob"));
        Assert.Equal("Guest", (await Store.ReadDocumentAsync("guest")).Songs[0]["title"]!.GetValue<string>());
        Assert.Equal("Alice", (await Store.ReadDocumentAsync("user:alice")).Songs[0]["title"]!.GetValue<string>());
        Assert.Equal("Bob", (await Store.ReadDocumentAsync("user:bob")).Songs[0]["title"]!.GetValue<string>());
        Assert.Empty((await Store.ReadDocumentAsync("user:new")).Songs);
    }

    [Fact]
    public async Task MalformedImportDoesNotPartiallyWriteOrChangePendingState()
    {
        await Store.ImportAsync("guest", Backup("original", "Kept"));
        var before = await Store.ReadSyncStateAsync("guest");
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ImportAsync("guest", """
            {"songs":[{"id":"new","title":"New","content":"G"},{"id":"broken","content":"D"}]}
            """));
        var after = await Store.ReadSyncStateAsync("guest");
        Assert.Equal(before.Snapshot, after.Snapshot);
        Assert.Equal(before.PendingChanges[0].LocalVersion, after.PendingChanges[0].LocalVersion);
        Assert.Single((await Store.ReadDocumentAsync("guest")).Songs);
    }

    [Fact]
    public async Task ConcurrentImportsSerializeWithoutDroppingRecords()
    {
        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => Store.ImportAsync("guest", Backup("id-" + i, "Song " + i))));
        Assert.Equal(20, (await Store.ReadDocumentAsync("guest")).Songs.Count);
        Assert.Equal(20, (await Store.ReadSyncStateAsync("guest")).PendingChanges.Count);
        Assert.Empty(Directory.GetFiles(_directory, "*.tmp"));
    }

    [Fact]
    public async Task AcknowledgingOlderUploadKeepsNewerLocalEditAndAdvancesRevision()
    {
        await Store.ImportAsync("user:alice", Backup("a", "First"));
        var inFlight = (await Store.ReadSyncStateAsync("user:alice")).PendingChanges.Single();
        await Store.ImportAsync("user:alice", Backup("a", "Second", 10));
        await Store.AcknowledgeAsync("user:alice", "songs", "a", inFlight.LocalVersion, 55);
        var pending = (await Store.ReadSyncStateAsync("user:alice")).PendingChanges.Single();
        Assert.Equal("Second", pending.Payload["title"]!.GetValue<string>());
        Assert.Equal(55, pending.ExpectedRevision);
        Assert.NotEqual(inFlight.LocalVersion, pending.LocalVersion);
        await Store.AcknowledgeAsync("user:alice", "songs", "a", pending.LocalVersion, 56);
        Assert.Empty((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
    }

    [Fact]
    public async Task RemoteConflictsPreservePendingLocalPayload()
    {
        await Store.ImportAsync("user:alice", Backup("a", "Local"));
        var accepted = await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Cloud"), false, 50);
        Assert.False(accepted);
        Assert.Equal("Local", (await Store.ReadDocumentAsync("user:alice")).Songs[0]["title"]!.GetValue<string>());
        Assert.Null((await Store.ReadSyncStateAsync("user:alice")).PendingChanges.Single().ExpectedRevision);
    }

    [Fact]
    public async Task RemoteTombstoneRemovesSongAndReferencesAndQueuesSetlistUpdate()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Cloud"), false, 1);
        await Store.AcceptRemoteAsync("user:alice", "setlists", "set", JsonNode.Parse("""
            {"id":"set","name":"Set","songIds":["a","missing","a"],"updatedAt":1}
            """)!.AsObject(), false, 2);
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", new JsonObject { ["id"] = "a" }, true, 3);
        var document = await Store.ReadDocumentAsync("user:alice");
        Assert.Empty(document.Songs);
        Assert.Equal("missing", Assert.Single(document.Setlists[0]["songIds"]!.AsArray())!.GetValue<string>());
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal("setlists", pending.Collection);
        Assert.Equal(2, pending.ExpectedRevision);
    }

    [Fact]
    public async Task LocalDeletionPersistsTombstoneAcrossRestart()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Cloud"), false, 1);
        await Store.SaveDocumentAsync("user:alice", new());
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.True(pending.Deleted);
        Assert.Equal(1, pending.ExpectedRevision);
        Assert.Equal("a", pending.Id);
        Assert.Empty((await Store.ReadDocumentAsync("user:alice")).Songs);
    }

    [Fact]
    public async Task CorruptProfileIsPreservedAndNeverSilentlyReset()
    {
        await Store.ImportAsync("guest", Backup("a", "Keep"));
        var file = Assert.Single(Directory.GetFiles(_directory, "*.json"));
        await File.WriteAllTextAsync(file, "broken");
        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.ImportAsync("guest", Backup("b", "New")));
        Assert.Equal("broken", await File.ReadAllTextAsync(file));
    }

    [Fact]
    public async Task ReviewedCloudConflictCanReplaceExactLocalVersion()
    {
        await Store.ImportAsync("user:alice", Backup("a", "Local"));
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        var resolved = await Store.AcceptConflictRemoteAsync("user:alice", "songs", "a", pending.LocalVersion,
            Song("a", "Cloud"), false, 15);
        Assert.True(resolved);
        Assert.Empty((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal("Cloud", (await Store.ReadDocumentAsync("user:alice")).Songs[0]["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task StaleConflictDecisionsCannotDiscardNewerLocalEdit()
    {
        await Store.ImportAsync("user:alice", Backup("a", "Original local"));
        var shown = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        await Store.ImportAsync("user:alice", Backup("a", "New local edit", 2));
        Assert.False(await Store.AcceptConflictRemoteAsync("user:alice", "songs", "a", shown.LocalVersion,
            Song("a", "Cloud"), false, 15));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store.RebasePendingAsync("user:alice", "songs", "a", 15,
            expectedLocalVersion: shown.LocalVersion));
        Assert.Equal("New local edit", (await Store.ReadDocumentAsync("user:alice")).Songs[0]["title"]!.GetValue<string>());
        Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
    }

    [Fact]
    public async Task KeepLocalConflictRebasesWithoutChangingPayload()
    {
        await Store.ImportAsync("user:alice", Backup("a", "Keep this device"));
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        await Store.RebasePendingAsync("user:alice", "songs", "a", 15, expectedLocalVersion: pending.LocalVersion);
        var rebased = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal(15, rebased.ExpectedRevision);
        Assert.Equal(pending.LocalVersion, rebased.LocalVersion);
        Assert.True(JsonNode.DeepEquals(pending.Payload, rebased.Payload));
    }

    [Fact]
    public async Task ClientSnapshotPreservesRemoteAdditionsAndUnrelatedUpdatesReceivedAfterBaseline()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Original A"), false, 1);
        await Store.AcceptRemoteAsync("user:alice", "songs", "b", Song("b", "Original B"), false, 2);
        var baseline = await Store.ReadSyncStateAsync("user:alice");
        await Store.AcceptRemoteAsync("user:alice", "songs", "b", Song("b", "New cloud B", 3), false, 3);
        await Store.AcceptRemoteAsync("user:alice", "songs", "c", Song("c", "New cloud C", 4), false, 4);
        var next = new Dictionary<string, string>(baseline.Snapshot);
        var ui = LibraryDocument.FromSnapshot(next);
        ui.Songs.Single(x => LibraryValidation.Id(x) == "a")["title"] = "User edit A";
        ui.WriteTo(next);
        next["chord-library-theme"] = "light";
        await Store.SaveClientSnapshotAsync("user:alice", baseline.Snapshot, next, baseline.RemoteRevisions);
        var current = await Store.ReadDocumentAsync("user:alice");
        Assert.Equal(3, current.Songs.Count);
        Assert.Equal("User edit A", current.Songs.Single(x => LibraryValidation.Id(x) == "a")["title"]!.GetValue<string>());
        Assert.Equal("New cloud B", current.Songs.Single(x => LibraryValidation.Id(x) == "b")["title"]!.GetValue<string>());
        Assert.Equal("New cloud C", current.Songs.Single(x => LibraryValidation.Id(x) == "c")["title"]!.GetValue<string>());
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal("a", pending.Id);
        Assert.Equal(1, pending.ExpectedRevision);
    }

    [Fact]
    public async Task ConcurrentSameRecordClientEditUsesSeenRevisionToForceCloudConflict()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Original"), false, 1);
        var baseline = await Store.ReadSyncStateAsync("user:alice");
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Unseen cloud edit", 5), false, 5);
        var next = new Dictionary<string, string>(baseline.Snapshot);
        var ui = LibraryDocument.FromSnapshot(next);
        ui.Songs[0]["title"] = "User edit";
        ui.WriteTo(next);
        await Store.SaveClientSnapshotAsync("user:alice", baseline.Snapshot, next, baseline.RemoteRevisions);
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.Equal(1, pending.ExpectedRevision);
        Assert.Equal("User edit", pending.Payload["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task UnchangedClientSnapshotCannotRestoreRemoteDeletion()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Original"), false, 1);
        var baseline = await Store.ReadSyncStateAsync("user:alice");
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", new JsonObject { ["id"] = "a" }, true, 2);
        var next = new Dictionary<string, string>(baseline.Snapshot) { ["chord-library-font-size"] = "18" };
        await Store.SaveClientSnapshotAsync("user:alice", baseline.Snapshot, next, baseline.RemoteRevisions);
        Assert.Empty((await Store.ReadDocumentAsync("user:alice")).Songs);
        Assert.Empty((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
    }

    [Fact]
    public async Task ClientDeleteOfUnseenCloudUpdateUsesSeenRevisionAndPreservesOtherSongs()
    {
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Original"), false, 1);
        var baseline = await Store.ReadSyncStateAsync("user:alice");
        await Store.AcceptRemoteAsync("user:alice", "songs", "a", Song("a", "Cloud changed", 5), false, 5);
        await Store.AcceptRemoteAsync("user:alice", "songs", "b", Song("b", "Cloud addition", 6), false, 6);
        var next = new Dictionary<string, string>(baseline.Snapshot) { [LibraryStorageKeys.Songs] = "[]" };
        await Store.SaveClientSnapshotAsync("user:alice", baseline.Snapshot, next, baseline.RemoteRevisions);
        Assert.Equal("b", Assert.Single((await Store.ReadDocumentAsync("user:alice")).Songs)["id"]!.GetValue<string>());
        var pending = Assert.Single((await Store.ReadSyncStateAsync("user:alice")).PendingChanges);
        Assert.True(pending.Deleted);
        Assert.Equal(1, pending.ExpectedRevision);
    }

    [Fact]
    public async Task RemoteCollectionOverflowLeavesPriorLibraryReadableAndUnchanged()
    {
        var library = new LibraryDocument
        {
            Songs = Enumerable.Range(0, LibraryValidation.MaximumRecordsPerCollection)
                .Select(i => Song("song-" + i, "Song " + i)).ToList()
        };
        await Store.SaveDocumentAsync("user:alice", library);
        var file = Assert.Single(Directory.GetFiles(_directory, "*.json"));
        var before = await File.ReadAllBytesAsync(file);

        await Assert.ThrowsAsync<LibraryValidationException>(() => Store.AcceptRemoteAsync("user:alice", "songs",
            "one-too-many", Song("one-too-many", "Remote addition"), false, 1));

        Assert.Equal(before, await File.ReadAllBytesAsync(file));
        Assert.Equal(LibraryValidation.MaximumRecordsPerCollection, (await Store.ReadDocumentAsync("user:alice")).Songs.Count);
        Assert.False((await Store.ReadSyncStateAsync("user:alice")).RemoteRevisions.ContainsKey("songs:one-too-many"));
    }

    private static string Backup(string id, string title, long timestamp = 1) =>
        new JsonObject { ["version"] = 2, ["songs"] = new JsonArray(Song(id, title, timestamp)), ["setlists"] = new JsonArray() }.ToJsonString();
    private static JsonObject Song(string id, string title, long timestamp = 1) =>
        new() { ["id"] = id, ["title"] = title, ["content"] = "C G", ["updatedAt"] = timestamp };

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
