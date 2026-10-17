using System.Net;
using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Supabase.Tests;

public sealed partial class SupabaseClientTests
{
    [Theory]
    [InlineData("23503")]
    [InlineData("23514")]
    [InlineData("22023")]
    [InlineData("23505")]
    public async Task RejectedRecordDoesNotBlockIndependentUploads(string code)
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId; var store = new LocalLibraryStore(directory.Path);
        await store.ImportAsync(profile, """{"songs":[],"setlists":[{"id":"bad","name":"Broken","songIds":["missing"]},{"id":"good","name":"Good","songIds":[]}]}""");
        var calls = new List<string>();
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!;
            var id = body["p_id"]!.GetValue<string>(); calls.Add(id);
            if (id == "bad") return Json(new JsonObject { ["code"] = code }, HttpStatusCode.BadRequest);
            var row = SyncRow("setlists", id, 1, 0); row["payload"] = body["p_payload"]!.DeepClone();
            return Json(new JsonObject { ["applied"] = true, ["document"] = row });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile);
        Assert.Equal(new[] { "bad", "good" }, calls);
        Assert.Equal(1, result.Uploaded); Assert.Equal(1, result.Remaining);
        Assert.Equal("bad", Assert.Single(result.Issues).Id);
        Assert.Equal("bad", Assert.Single((await new LocalLibraryStore(directory.Path).ReadSyncStateAsync(profile)).PendingChanges).Id);
    }

    [Fact]
    public async Task AcknowledgesSuccessfulUploadWhenLaterRequestFailsPermanently()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId; var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 10)["payload"]!.AsObject(), SyncRow("songs", "b", 0, 10)["payload"]!.AsObject()] });
        var calls = 0;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            if (++calls == 2) return Json(new JsonObject { ["code"] = "42501" }, HttpStatusCode.Forbidden);
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!;
            var row = SyncRow("songs", "a", 1, 10); row["payload"] = body["p_payload"]!.DeepClone();
            return Json(new JsonObject { ["applied"] = true, ["document"] = row });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets()); await auth.SignInAsync("test@example.invalid", "test-password");
        await Assert.ThrowsAsync<SupabaseException>(() => new LibrarySyncCoordinator(store, new(Options, http, auth), auth).SyncAsync(profile));
        Assert.Equal("b", Assert.Single((await store.ReadSyncStateAsync(profile)).PendingChanges).Id);
        Assert.Empty((await store.ReadSyncStateAsync(profile)).DownloadCursors);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task LostUploadResponseReplaysSameRequestAndAcknowledgesIt()
    {
        using var directory = new TemporaryDirectory();
        var profile = "user:" + UserId; var store = new LocalLibraryStore(directory.Path);
        await store.SaveDocumentAsync(profile, new() { Songs = [SyncRow("songs", "a", 0, 10)["payload"]!.AsObject()] });
        var sent = new List<string>(); JsonObject? committed = null;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            sent.Add(await request.Content!.ReadAsStringAsync());
            if (committed is null)
            {
                committed = SyncRow("songs", "a", 1, 10);
                committed["payload"] = JsonNode.Parse(sent[0])!["p_payload"]!.DeepClone();
                throw new HttpRequestException("Response lost after server committed");
            }
            return Json(new JsonObject { ["applied"] = true, ["document"] = committed.DeepClone() });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets()); await auth.SignInAsync("test@example.invalid", "test-password");
        var retry = new SyncRequestRetry((_, _) => Task.CompletedTask);
        var result = await new LibrarySyncCoordinator(store, new(Options, http, auth, retry), auth).SyncAsync(profile);
        Assert.Equal(2, sent.Count); Assert.Equal(sent[0], sent[1]);
        Assert.Equal(1, result.Uploaded); Assert.Equal(0, result.Remaining);
    }

    [Fact]
    public async Task SignOutDuringRetryPreventsAnotherDataRequest()
    {
        var dataCalls = 0;
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            dataCalls++; throw new HttpRequestException("Lost network");
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets()); await auth.SignInAsync("test@example.invalid", "test-password");
        var retry = new SyncRequestRetry(async (_, _) => { await auth.SignOutAsync(); });
        var client = new SupabaseDataClient(Options, http, auth, retry);
        await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetAsync("songs", "a"));
        Assert.Equal(1, dataCalls);
    }

    [Fact]
    public async Task InvalidDownloadedPageLeavesItsCheckpointUncommitted()
    {
        using var directory = new TemporaryDirectory(); var profile = "user:" + UserId;
        var bad = SyncRow("songs", "bad", 2, 10); bad["payload"]!["transposeSteps"] = 99;
        using var http = new HttpClient(new Handler(request => Task.FromResult(
            request.RequestUri!.AbsolutePath.Contains("/auth/") ? Json(SessionResponse("first", 3600))
            : Json(new JsonArray(SyncRow("songs", "good", 1, 10), bad.DeepClone())))));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets()); await auth.SignInAsync("test@example.invalid", "test-password");
        await Assert.ThrowsAsync<LibraryValidationException>(() => new LibrarySyncCoordinator(new(directory.Path), new(Options, http, auth), auth).SyncAsync(profile));
        var saved = await new LocalLibraryStore(directory.Path).ReadSyncStateAsync(profile);
        Assert.Empty(saved.DownloadCursors); Assert.Empty(LibraryDocument.FromSnapshot(saved.Snapshot).Songs);
    }
}
