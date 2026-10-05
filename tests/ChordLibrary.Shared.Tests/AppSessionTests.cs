using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;
using ChordLibrary.Shared;

namespace ChordLibrary.Shared.Tests;

/// <summary>Exercises UI baselines through the real auth, sync, store and AppSession classes, without network access.</summary>
public sealed class AppSessionTests : IDisposable
{
    private const string Alpha = "https://alpha.supabase.co";
    private const string Beta = "https://beta.supabase.co";
    private const string PublicKey = "sb_publishable_test";
    private const string Owner = "70f74e35-b499-4126-b3b7-2c49c748212d";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "chordlibrary-session-tests-" + Guid.NewGuid().ToString("N"));
    private readonly MemorySecrets secrets = new();
    private readonly FakeSupabase server = new();
    private readonly HttpClient http;
    private readonly TestPlatform platform;

    public AppSessionTests()
    {
        http = new HttpClient(server);
        platform = new TestPlatform(directory);
    }

    [Fact]
    public async Task OldUiSavePreservesUnseenCloudAdditionAndUnrelatedEdit()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First A"), 1);
        server.Put(Alpha, "songs", Song("b", "First B"), 2);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("b", "Cloud B"), 3);
        server.Put(Alpha, "songs", Song("c", "Cloud C"), 4);
        await app.SyncAsync();

        await app.SaveAsync(Edit(ui, "a", "User A"));

        var current = await app.Store.ReadDocumentAsync(app.ProfileId);
        Assert.Equal(3, current.Songs.Count);
        Assert.Equal("User A", Title(current, "a"));
        Assert.Equal("Cloud B", Title(current, "b"));
        Assert.Equal("Cloud C", Title(current, "c"));
        var pending = Assert.Single((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges);
        Assert.Equal("a", pending.Id);
        Assert.Equal(1, pending.ExpectedRevision);
    }

    [Fact]
    public async Task NewerLocalEditAutomaticallyWinsAgainstUnseenCloudVersion()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "Cloud changed"), 2);
        await app.SyncAsync();
        await app.SaveAsync(Edit(ui, "a", "User changed"));

        var result = await app.SyncAsync();

        Assert.Empty(result.Conflicts);
        Assert.Equal(1, result.Uploaded);
        Assert.Equal(0, result.Remaining);
        Assert.Equal("User changed", Title(await app.Store.ReadDocumentAsync(app.ProfileId), "a"));
        Assert.Equal("User changed", server.Get(Alpha, "songs", "a")["payload"]!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task FailedDeliveryDoesNotAdvanceUiRevisionBaseline()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "Seen first"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "Never delivered"), 2);
        await app.SyncAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => app.DeliverSnapshotAsync(snapshot =>
        {
            Assert.Equal("Never delivered", Title(LibraryDocument.FromSnapshot(snapshot), "a"));
            throw new InvalidOperationException("Simulated disconnected WebView.");
        }));

        await app.SaveAsync(Edit(ui, "a", "User edits first"));

        var pending = Assert.Single((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges);
        Assert.Equal(1, pending.ExpectedRevision);
        Assert.Equal("User edits first", pending.Payload["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task SuccessfulDeliveryUsesCapturedRevisionEvenIfRemoteApplyRunsDuringDelivery()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First"), 1);
        await app.SyncAsync();
        await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "Delivered second"), 2);
        await app.SyncAsync();
        Dictionary<string, string>? delivered = null;
        await app.DeliverSnapshotAsync(async snapshot =>
        {
            delivered = new(snapshot);
            server.Put(Alpha, "songs", Song("a", "Undelivered third"), 3);
            // Model the store write of a download already in flight. The full SyncAsync completion
            // waits for delivery's view gate, so it must not be synchronously awaited by this callback.
            await app.Store.AcceptRemoteAsync(app.ProfileId, "songs", "a", Song("a", "Undelivered third"), false, 3);
        });

        await app.SaveAsync(Edit(delivered!, "a", "User edits second"));

        var pending = Assert.Single((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges);
        Assert.Equal(2, pending.ExpectedRevision);
        Assert.Equal("User edits second", pending.Payload["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task SameUserUuidInDifferentSupabaseProjectsHasSeparateLibraries()
    {
        await SeedStoredSessionAsync(Alpha);
        await SeedStoredSessionAsync(Beta);
        var app = new AppSession(platform, secrets, http);
        await app.ConfigureAsync(Alpha, PublicKey);
        var profile = app.ProfileId;
        await app.ReadInitialAsync();
        await app.Store.ImportAsync(profile, Backup("same-song", "Alpha library"));
        await app.Auth!.SignOutAsync();
        app.SelectAccount();
        await app.ConfigureAsync(Beta, PublicKey);
        Assert.Equal(profile, app.ProfileId);
        Assert.Empty((await app.Store.ReadDocumentAsync(profile)).Songs);
        await app.Store.ImportAsync(profile, Backup("same-song", "Beta library"));
        await app.Auth!.SignOutAsync();
        app.SelectAccount();

        await SeedStoredSessionAsync(Alpha);
        await app.ConfigureAsync(Alpha, PublicKey);
        Assert.Equal("Alpha library", Title(await app.Store.ReadDocumentAsync(profile), "same-song"));
        var reopened = new AppSession(platform, secrets, http);
        await reopened.InitializeAsync();
        Assert.True(reopened.SignedIn);
        Assert.Equal("Alpha library", Title(await reopened.Store.ReadDocumentAsync(reopened.ProfileId), "same-song"));
    }

    [Fact]
    public async Task GuestLibraryTransfersOnlyThroughExplicitImportAndRemainsIntact()
    {
        var app = new AppSession(platform, secrets, http);
        await app.Store.ImportAsync("guest", """
            {"version":1,"songs":[{"id":"guest-song","title":"Guest song","content":"C  G\nText","updatedAt":5}],
            "playlists":[{"id":"guest-list","name":"Practice","songIds":["guest-song"],"updatedAt":5}]}
            """);
        await SeedStoredSessionAsync(Alpha);
        await app.ConfigureAsync(Alpha, PublicKey);
        Assert.Empty((await app.Store.ReadDocumentAsync(app.ProfileId)).Songs);
        Assert.Empty((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges);

        var guest = await app.ReadGuestAsync();
        var exported = new LibraryImportService().Export(guest);
        var preview = await app.Store.PreviewImportAsync(app.ProfileId, exported);
        Assert.Equal(1, preview.SongsAdded);
        Assert.Equal(1, preview.SetlistsAdded);
        Assert.Empty((await app.Store.ReadDocumentAsync(app.ProfileId)).Songs);
        await app.Store.ImportAsync(app.ProfileId, exported);

        var imported = await app.Store.ReadDocumentAsync(app.ProfileId);
        Assert.Equal("Guest song", Title(imported, "guest-song"));
        Assert.Equal("guest-song", imported.Setlists[0]["songIds"]![0]!.GetValue<string>());
        Assert.Single((await app.ReadGuestAsync()).Songs);
        await app.Auth!.SignOutAsync();
        app.SelectAccount();
        Assert.Equal("guest", app.ProfileId);
        Assert.Equal("Guest song", Title(await app.Store.ReadDocumentAsync("guest"), "guest-song"));
    }

    [Fact]
    public async Task StaleClientSaveAfterAccountSwitchCannotCopyGuestData()
    {
        var app = new AppSession(platform, secrets, http);
        await app.Store.ImportAsync("guest", Backup("guest-song", "Guest private song"));
        var oldUi = await app.ReadInitialAsync();
        await SeedStoredSessionAsync(Alpha);
        await app.ConfigureAsync(Alpha, PublicKey);

        await Assert.ThrowsAsync<InvalidOperationException>(() => app.SaveAsync(Edit(oldUi, "guest-song", "Late guest edit")));
        Assert.Empty((await app.Store.ReadDocumentAsync(app.ProfileId)).Songs);
        Assert.Equal("Guest private song", Title(await app.ReadGuestAsync(), "guest-song"));
    }

    [Fact]
    public async Task FailedSaveDoesNotDiscardNextValidUserEdit()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        var invalid = new Dictionary<string, string>(ui) { [LibraryStorageKeys.Songs] = "broken json" };
        await Assert.ThrowsAsync<LibraryValidationException>(() => app.SaveAsync(invalid));
        await app.SaveAsync(Edit(ui, "a", "Valid next edit"));
        Assert.Equal("Valid next edit", Title(await app.Store.ReadDocumentAsync(app.ProfileId), "a"));
    }

    [Fact]
    public async Task OwnAcknowledgedUploadAdvancesRevisionWithoutRequiringUiRefresh()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        var firstEdit = Edit(ui, "a", "First local edit");
        await app.SaveAsync(firstEdit);
        var firstUpload = await app.SyncAsync();
        Assert.Equal(1, firstUpload.Uploaded);
        Assert.Empty(firstUpload.Conflicts);
        var acknowledged = server.Get(Alpha, "songs", "a")["revision"]!.GetValue<long>();

        // The WebView has not accepted a replacement snapshot since the upload.
        await app.SaveAsync(Edit(firstEdit, "a", "Second local edit"));
        var pending = Assert.Single((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges);
        Assert.Equal(acknowledged, pending.ExpectedRevision);
        var secondUpload = await app.SyncAsync();
        Assert.Equal(1, secondUpload.Uploaded);
        Assert.Empty(secondUpload.Conflicts);
        Assert.Equal("Second local edit", server.Get(Alpha, "songs", "a")["payload"]!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task AccountSwitchDuringDeliveryCannotLabelOldSnapshotAsNewAccount()
    {
        var app = new AppSession(platform, secrets, http);
        await app.Store.ImportAsync("guest", Backup("guest-song", "Guest private song"));
        await app.ReadInitialAsync();
        await SeedStoredSessionAsync(Alpha);
        Dictionary<string, string>? delivered = null;
        await app.DeliverSnapshotAsync(async snapshot =>
        {
            delivered = new(snapshot);
            await app.ConfigureAsync(Alpha, PublicKey);
        });

        await Assert.ThrowsAsync<InvalidOperationException>(() => app.SaveAsync(Edit(delivered!, "guest-song", "Late guest edit")));
        Assert.Empty((await app.Store.ReadDocumentAsync(app.ProfileId)).Songs);
        Assert.Equal("Guest private song", Title(await app.ReadGuestAsync(), "guest-song"));
    }

    [Fact]
    public async Task BundledProjectDefaultsConnectWhenUserHasNoSavedConfiguration()
    {
        await SeedStoredSessionAsync(Alpha);
        var app = new AppSession(platform, secrets, http, new SupabaseOptions(Alpha, PublicKey));
        await app.InitializeAsync();
        Assert.Equal(Alpha, app.Options!.ProjectUrl);
        Assert.True(app.SignedIn);
        Assert.Equal("user:" + Owner, app.ProfileId);
        Assert.False(File.Exists(Path.Combine(directory, "supabase-public.json")));
    }

    [Fact]
    public async Task SavedUserProjectConfigurationTakesPrecedenceOverBundledDefault()
    {
        await SeedStoredSessionAsync(Alpha);
        await SeedStoredSessionAsync(Beta);
        var original = new AppSession(platform, secrets, http);
        await original.ConfigureAsync(Beta, PublicKey);
        await original.Store.ImportAsync(original.ProfileId, Backup("b", "Saved Beta library"));
        var reopened = new AppSession(platform, secrets, http, new SupabaseOptions(Alpha, PublicKey));
        await reopened.InitializeAsync();
        Assert.Equal(Beta, reopened.Options!.ProjectUrl);
        Assert.Equal("Saved Beta library", Title(await reopened.Store.ReadDocumentAsync(reopened.ProfileId), "b"));
    }

    private async Task<AppSession> SignedAppAsync()
    {
        await SeedStoredSessionAsync(Alpha);
        var app = new AppSession(platform, secrets, http);
        await app.ConfigureAsync(Alpha, PublicKey);
        Assert.True(app.SignedIn);
        return app;
    }

    [Fact]
    public async Task UnchangedPeriodicSyncDoesNotDeliverUiSnapshots()
    {
        var app = await SignedAppAsync();
        await app.ReadInitialAsync();
        var deliveries = 0;
        for (var tick = 0; tick < 3; tick++)
        {
            var result = await app.SyncAsync();
            Assert.Equal(0, result.Pulled);
            Assert.Equal(0, result.Uploaded);
            await app.DeliverSnapshotAsync(_ => { deliveries++; return Task.CompletedTask; }, onlyIfChanged: true);
        }
        Assert.Equal(0, deliveries);
    }

    [Fact]
    public async Task UploadAcknowledgmentAndItsDownloadEchoDoNotRedrawLocalEdits()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "First"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        var edited = Edit(ui, "a", "Already displayed local edit");
        // The browser can serialize a legacy record without defaults, with different whitespace
        // and property order. Normalizing it in the native store is not a new visible cloud edit.
        var raw = JsonNode.Parse(edited[LibraryStorageKeys.Songs])![0]!.AsObject();
        raw.Remove("twoColumn");
        raw.Remove("transposeSteps");
        var reordered = new JsonObject(raw.Reverse().Select(pair =>
            new KeyValuePair<string, JsonNode?>(pair.Key, pair.Value?.DeepClone())));
        edited[LibraryStorageKeys.Songs] = new JsonArray(reordered).ToJsonString(new() { WriteIndented = true });
        await app.SaveAsync(edited);
        Assert.Equal(1, (await app.SyncAsync()).Uploaded);
        var deliveries = 0;
        await app.DeliverSnapshotAsync(_ => { deliveries++; return Task.CompletedTask; }, onlyIfChanged: true);
        Assert.Equal(1, (await app.SyncAsync()).Pulled);
        await app.DeliverSnapshotAsync(_ => { deliveries++; return Task.CompletedTask; }, onlyIfChanged: true);
        Assert.Equal(0, deliveries);
    }

    [Fact]
    public async Task DeferredRemoteUpdateStillArrivesAfterANoChangeSyncAndOnlyOnce()
    {
        var app = await SignedAppAsync();
        await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "Downloaded while editor was busy"), 1);
        Assert.Equal(1, (await app.SyncAsync()).Pulled);
        // No delivery occurred because the UI was busy. A subsequent empty download must not
        // hide the unseen change simply because its sync result reports zero downloaded records.
        Assert.Equal(0, (await app.SyncAsync()).Pulled);
        var deliveries = 0;
        await app.DeliverSnapshotAsync(snapshot =>
        {
            deliveries++;
            Assert.Equal("Downloaded while editor was busy", Title(LibraryDocument.FromSnapshot(snapshot), "a"));
            return Task.CompletedTask;
        }, onlyIfChanged: true);
        await app.SyncAsync();
        await app.DeliverSnapshotAsync(_ => { deliveries++; return Task.CompletedTask; }, onlyIfChanged: true);
        Assert.Equal(1, deliveries);
    }

    [Fact]
    public async Task SamePayloadWithNewRevisionSkipsRedrawAndKeepsNextEditRevisionCurrent()
    {
        var app = await SignedAppAsync();
        server.Put(Alpha, "songs", Song("a", "Same title"), 1);
        await app.SyncAsync();
        var ui = await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "Same title"), 9);
        Assert.Equal(1, (await app.SyncAsync()).Pulled);
        await app.DeliverSnapshotAsync(_ => throw new InvalidOperationException("Unchanged UI should not redraw."), onlyIfChanged: true);
        await app.SaveAsync(Edit(ui, "a", "Next local edit"));
        Assert.Equal(9, Assert.Single((await app.Store.ReadSyncStateAsync(app.ProfileId)).PendingChanges).ExpectedRevision);
    }

    [Fact]
    public async Task FailedConditionalDeliveryRetriesTheUnseenSnapshot()
    {
        var app = await SignedAppAsync();
        await app.ReadInitialAsync();
        server.Put(Alpha, "songs", Song("a", "New cloud song"), 1);
        await app.SyncAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => app.DeliverSnapshotAsync(
            _ => throw new InvalidOperationException("WebView unavailable."), onlyIfChanged: true));
        await app.SyncAsync();
        var delivered = false;
        await app.DeliverSnapshotAsync(_ => { delivered = true; return Task.CompletedTask; }, onlyIfChanged: true);
        Assert.True(delivered);
    }

    [Fact]
    public async Task ForcedResetStillDeliversAnIdenticalSnapshot()
    {
        var app = await SignedAppAsync();
        await app.ReadInitialAsync();
        var delivered = false;
        await app.DeliverSnapshotAsync(_ => { delivered = true; return Task.CompletedTask; });
        Assert.True(delivered);
    }

    private async Task SeedStoredSessionAsync(string project)
    {
        var auth = new SupabaseAuthClient(new SupabaseOptions(project, PublicKey), http, secrets);
        await auth.SignInAsync("example@example.test", "test-password");
    }

    private static Dictionary<string, string> Edit(Dictionary<string, string> snapshot, string id, string title)
    {
        var result = new Dictionary<string, string>(snapshot);
        var document = LibraryDocument.FromSnapshot(result);
        var song = document.Songs.Single(x => LibraryValidation.Id(x) == id);
        song["title"] = title;
        song["updatedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        document.WriteTo(result);
        return result;
    }

    private static JsonObject Song(string id, string title) => new()
    {
        ["id"] = id, ["title"] = title, ["content"] = "C G", ["updatedAt"] = 1L
    };
    private static string Backup(string id, string title) => new JsonObject
    {
        ["version"] = 2, ["songs"] = new JsonArray(Song(id, title)), ["setlists"] = new JsonArray()
    }.ToJsonString();
    private static string Title(LibraryDocument document, string id) =>
        document.Songs.Single(x => LibraryValidation.Id(x) == id)["title"]!.GetValue<string>();

    public void Dispose()
    {
        http.Dispose();
        if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
    }

    private sealed class TestPlatform(string directory) : IAppPlatform
    {
        public string DataDirectory => directory;
        public bool IsNative => false;
        public string OAuthRedirectUri => "chordlibrary://auth/callback";
        public Task<string?> PickJsonAsync() => Task.FromResult<string?>(null);
        public Task ExportAsync(string filename, string json) => Task.CompletedTask;
        public Task<string?> ReadQrAsync(bool camera) => Task.FromResult<string?>(null);
        public Task<Uri> AuthenticateAsync(Uri authorizationUri, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class MemorySecrets : ISecretStore
    {
        private readonly Dictionary<string, string> values = [];
        public Task<string?> GetAsync(string key, CancellationToken cancellationToken = default) => Task.FromResult(values.GetValueOrDefault(key));
        public Task SetAsync(string key, string value, CancellationToken cancellationToken = default) { values[key] = value; return Task.CompletedTask; }
        public Task RemoveAsync(string key, CancellationToken cancellationToken = default) { values.Remove(key); return Task.CompletedTask; }
    }

    private sealed class FakeSupabase : HttpMessageHandler
    {
        private readonly Dictionary<string, JsonObject> records = [];
        public void Put(string project, string collection, JsonObject payload, long revision) =>
            records[Key(new Uri(project).Host, collection, LibraryValidation.Id(payload))] = Document(collection, payload, revision, false);
        public JsonObject Get(string project, string collection, string id) => records[Key(new Uri(project).Host, collection, id)];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = request.RequestUri!;
            if (uri.AbsolutePath == "/auth/v1/token") return Json(new JsonObject
            {
                ["access_token"] = "fake-token", ["refresh_token"] = "fake-refresh",
                ["expires_at"] = DateTimeOffset.UtcNow.AddHours(2).ToUnixTimeSeconds(),
                ["user"] = new JsonObject { ["id"] = Owner, ["email"] = "example@example.test" }
            });
            if (uri.AbsolutePath == "/auth/v1/logout") return new HttpResponseMessage(HttpStatusCode.NoContent);
            if (uri.AbsolutePath == "/rest/v1/library_documents")
            {
                var query = uri.Query.TrimStart('?').Split('&').Select(x => x.Split('=', 2))
                    .ToDictionary(x => x[0], x => Uri.UnescapeDataString(x[1]));
                var collection = query["collection"][3..];
                var afterRevision = long.Parse(query["revision"][3..]);
                var rows = records.Where(x => x.Key.StartsWith(uri.Host + "/" + collection + "/", StringComparison.Ordinal))
                    .Select(x => x.Value).Where(x => x["revision"]!.GetValue<long>() > afterRevision)
                    .OrderBy(x => x["revision"]!.GetValue<long>()).Take(500).Select(x => (JsonNode)x.DeepClone()).ToArray();
                return Json(new JsonArray(rows));
            }
            if (uri.AbsolutePath == "/rest/v1/rpc/apply_library_document")
            {
                var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!.AsObject();
                var collection = body["p_collection"]!.GetValue<string>();
                var id = body["p_id"]!.GetValue<string>();
                var key = Key(uri.Host, collection, id);
                var expected = body["p_expected_revision"]?.GetValue<long>();
                records.TryGetValue(key, out var current);
                var applied = current is null ? expected is null : expected == current["revision"]!.GetValue<long>();
                if (applied)
                {
                    var revision = records.Values.Select(x => x["revision"]!.GetValue<long>()).DefaultIfEmpty().Max() + 1;
                    current = Document(collection, body["p_payload"]!.AsObject(), revision, body["p_deleted"]!.GetValue<bool>());
                    records[key] = current;
                }
                if (current is null) throw new InvalidOperationException("Unexpected test fixture update of missing document.");
                return Json(new JsonObject { ["applied"] = applied, ["document"] = current.DeepClone() });
            }
            throw new InvalidOperationException("Unexpected HTTP request in test: " + uri.AbsolutePath);
        }

        private static string Key(string host, string collection, string id) => host + "/" + collection + "/" + id;
        private static JsonObject Document(string collection, JsonObject payload, long revision, bool deleted) => new()
        {
            ["collection"] = collection, ["id"] = LibraryValidation.Id(payload), ["payload"] = payload.DeepClone(),
            ["deleted"] = deleted, ["revision"] = revision, ["server_updated_at"] = "2026-10-03T00:00:00Z"
        };
        private static HttpResponseMessage Json(JsonNode value) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(value.ToJsonString(), Encoding.UTF8, "application/json")
        };
    }
}
