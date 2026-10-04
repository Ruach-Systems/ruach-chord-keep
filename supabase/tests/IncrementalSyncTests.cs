using System.Net;
using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Supabase.Tests;

public sealed partial class SupabaseClientTests
{
    [Fact]
    public async Task DownloadCheckpointsSurviveRestartAndOnlyTransferChangedRows()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var rows = new List<JsonObject> { SyncRow("songs", "a", 1, 10), SyncRow("setlists", "set", 2, 10) };
        var requests = new List<(string Collection, long Cursor)>();
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            Assert.Equal(HttpMethod.Get, request.Method);
            var query = Query(request.RequestUri);
            var collection = query["collection"][3..];
            var cursor = long.Parse(query["revision"][3..]);
            requests.Add((collection, cursor));
            return Task.FromResult(Json(new JsonArray(rows.Where(r => r["collection"]!.GetValue<string>() == collection
                && r["revision"]!.GetValue<long>() > cursor).OrderBy(r => r["revision"]!.GetValue<long>())
                .Select(r => r.DeepClone()).ToArray())));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        LibrarySyncCoordinator Coordinator(LocalLibraryStore store) => new(store, new SupabaseDataClient(Options, http, auth), auth);
        Assert.Equal(2, (await Coordinator(new(directory.Path)).SyncAsync(profile)).Pulled);
        requests.Clear();
        var reopened = new LocalLibraryStore(directory.Path);
        Assert.Equal(0, (await Coordinator(reopened).SyncAsync(profile)).Pulled);
        Assert.Equal(new[] { ("songs", 1L), ("setlists", 2L) }, requests);
        rows[0] = SyncRow("songs", "a", 3, 30);
        rows[1] = SyncRow("setlists", "set", 4, 40, deleted: true);
        Assert.Equal(2, (await Coordinator(reopened).SyncAsync(profile)).Pulled);
        Assert.Empty((await reopened.ReadDocumentAsync(profile)).Setlists);
        Assert.Equal(30, LibraryValidation.Modified(Assert.Single((await reopened.ReadDocumentAsync(profile)).Songs)));
        Assert.Equal(0, (await Coordinator(new(directory.Path)).SyncAsync(profile)).Pulled);
        Assert.Empty((await reopened.ReadSyncStateAsync("user:other")).DownloadCursors);
    }

    [Fact]
    public async Task InterruptedDownloadResumesAfterLastDurablyAppliedRow()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var fail = true;
        var requests = new List<long>();
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            var query = Query(request.RequestUri);
            if (query["collection"] != "eq.songs") return Task.FromResult(Json(new JsonArray()));
            var cursor = long.Parse(query["revision"][3..]); requests.Add(cursor);
            if (cursor == 1 && fail) throw new HttpRequestException("Connection lost between pages");
            return Task.FromResult(Json(cursor < 2 ? new JsonArray(SyncRow("songs", "song-" + (cursor + 1), cursor + 1, 10)) : new JsonArray()));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(new(directory.Path), new(Options, http, auth), auth);
        await Assert.ThrowsAsync<HttpRequestException>(() => sync.SyncAsync(profile));
        var reopened = new LocalLibraryStore(directory.Path);
        Assert.Equal(1, (await reopened.ReadSyncStateAsync(profile)).DownloadCursors["songs"]);
        fail = false; requests.Clear();
        Assert.Equal(1, (await new LibrarySyncCoordinator(reopened, new(Options, http, auth), auth).SyncAsync(profile)).Pulled);
        Assert.Equal(new long[] { 1, 2 }, requests);
        Assert.Equal(2, (await reopened.ReadDocumentAsync(profile)).Songs.Count);
    }

    [Fact]
    public async Task UploadAcknowledgmentCannotSkipAnotherDevicesInterveningRevision()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "mine", 0, 20)["payload"]!.AsObject()] });
        var rows = new List<JsonObject>();
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Post)
            {
                rows.Add(SyncRow("songs", "other-device", 1, 10));
                rows.Add(SyncRow("songs", "mine", 2, 20));
                var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!;
                rows[1]["payload"] = body["p_payload"]!.DeepClone();
                return Json(new JsonObject { ["applied"] = true, ["document"] = rows[1].DeepClone() });
            }
            var query = Query(request.RequestUri);
            var cursor = long.Parse(query["revision"][3..]);
            return Json(new JsonArray(rows.Where(r => "eq." + r["collection"]!.GetValue<string>() == query["collection"]
                && r["revision"]!.GetValue<long>() > cursor).Select(r => r.DeepClone()).ToArray()));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(store, new(Options, http, auth), auth);
        Assert.Equal(1, (await sync.SyncAsync(profile)).Uploaded);
        Assert.Empty((await store.ReadSyncStateAsync(profile)).DownloadCursors);
        Assert.Equal(2, (await sync.SyncAsync(profile)).Pulled);
        Assert.Contains((await store.ReadDocumentAsync(profile)).Songs, s => LibraryValidation.Id(s) == "other-device");
    }

    [Theory]
    [InlineData(10, false)]
    [InlineData(20, false)]
    [InlineData(30, true)]
    public async Task UploadRaceResolvesLatestTimestampWithoutReview(long localTime, bool localWins)
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, localTime)["payload"]!.AsObject()] });
        var posts = 0;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!;
            if (++posts == 1) return Json(new JsonObject { ["applied"] = false, ["document"] = SyncRow("songs", "a", 2, 20) });
            Assert.Equal(2, body["p_expected_revision"]!.GetValue<long>());
            return Json(new JsonObject { ["applied"] = true, ["document"] = SyncRow("songs", "a", 3, localTime) });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile);
        Assert.Empty(result.Conflicts);
        Assert.Equal(0, result.Remaining);
        Assert.Equal(localWins ? 2 : 1, posts);
        Assert.Equal(localWins ? localTime : 20, LibraryValidation.Modified(Assert.Single((await store.ReadDocumentAsync(profile)).Songs)));
        Assert.Empty((await store.ReadSyncStateAsync(profile)).DownloadCursors);
    }

    [Fact]
    public async Task ContinuousUploadRacesKeepPendingChangesForAutomaticRetry()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 100)["payload"]!.AsObject()] });
        var posts = 0;
        using var http = new HttpClient(new Handler(request => Task.FromResult(Json(
            request.RequestUri!.AbsolutePath.Contains("/auth/") ? SessionResponse("first", 3600)
            : request.Method == HttpMethod.Get ? new JsonArray()
            : new JsonObject { ["applied"] = false, ["document"] = SyncRow("songs", "a", ++posts, 20) }))));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile);
        Assert.Equal(5, posts);
        Assert.Equal(1, result.Remaining);
        Assert.Empty(result.Conflicts);
        Assert.Equal(5, Assert.Single((await new LocalLibraryStore(directory.Path).ReadSyncStateAsync(profile)).PendingChanges).ExpectedRevision);
    }

    [Fact]
    public async Task OlderLocalEditCannotOverwriteCloudEvenWhenExpectedRevisionMatches()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var store = new LocalLibraryStore(directory.Path);
        var cloud = SyncRow("songs", "a", 1, 30);
        await store.MergeSyncRemoteAsync(profile, "songs", "a", cloud["payload"]!.AsObject(), false, 1, checkpoint: true);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 20)["payload"]!.AsObject()] });
        var recordReads = 0;
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            Assert.Equal(HttpMethod.Get, request.Method);
            var query = Query(request.RequestUri);
            if (query.ContainsKey("id"))
            {
                Assert.Equal("eq.a", query["id"]); Assert.Equal("eq." + UserId, query["owner_id"]);
                recordReads++;
                return Task.FromResult(Json(new JsonArray(cloud.DeepClone())));
            }
            return Task.FromResult(Json(new JsonArray()));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile);
        Assert.Equal(1, recordReads);
        Assert.Equal(0, result.Uploaded);
        Assert.Equal(0, result.Remaining);
        Assert.Equal(30, LibraryValidation.Modified(Assert.Single((await store.ReadDocumentAsync(profile)).Songs)));
    }

    [Fact]
    public async Task EditMadeDuringUploadIsComparedInsteadOfDiscardedByOlderResponse()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId;
        var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 10)["payload"]!.AsObject()] });
        var posts = 0;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            if (++posts == 1)
            {
                await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 30)["payload"]!.AsObject()] });
                return Json(new JsonObject { ["applied"] = false, ["document"] = SyncRow("songs", "a", 1, 20) });
            }
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!;
            Assert.Equal(30, body["p_payload"]!["updatedAt"]!.GetValue<long>());
            return Json(new JsonObject { ["applied"] = true, ["document"] = SyncRow("songs", "a", 2, 30) });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile);
        Assert.Equal(2, posts);
        Assert.Equal(0, result.Remaining);
        Assert.Equal(30, LibraryValidation.Modified(Assert.Single((await store.ReadDocumentAsync(profile)).Songs)));
    }

    private static JsonObject SyncRow(string collection, string id, long revision, long updatedAt, bool deleted = false) => new()
    {
        ["collection"] = collection, ["id"] = id, ["revision"] = revision, ["deleted"] = deleted,
        ["server_updated_at"] = "2026-10-04T00:00:00Z",
        ["payload"] = collection == "songs"
            ? new JsonObject { ["id"] = id, ["title"] = "Version " + updatedAt, ["content"] = "C G", ["updatedAt"] = updatedAt }
            : new JsonObject { ["id"] = id, ["name"] = "Set", ["songIds"] = new JsonArray(), ["updatedAt"] = updatedAt }
    };
}
