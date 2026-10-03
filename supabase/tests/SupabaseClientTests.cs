using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Supabase.Tests;

public sealed class SupabaseClientTests
{
    private const string UserId = "ac100000-0000-4000-8000-000000000001";
    private static readonly SupabaseOptions Options = new("https://example.supabase.co", "sb_publishable_test");

    [Fact]
    public void PrivilegedKeysAndInsecureHostsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => new SupabaseOptions("https://example.supabase.co", "sb_secret_never_embed").Validate());
        var jwt = "header." + Base64(Encoding.UTF8.GetBytes("{\"role\":\"service_role\"}")) + ".signature";
        Assert.Throws<ArgumentException>(() => new SupabaseOptions("https://example.supabase.co", jwt).Validate());
        Assert.Throws<ArgumentException>(() => new SupabaseOptions("http://example.com", "public").Validate());
        Assert.Throws<ArgumentException>(() => new SupabaseOptions("https://example.com/arbitrary-path", "public").Validate());
        Assert.Equal("http", new SupabaseOptions("http://127.0.0.1:54321", "public").Validate().Scheme);
    }

    [Fact]
    public async Task RotatingRefreshIsSerializedAndStoredWithoutLeakingInToString()
    {
        var refreshes = 0;
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.Query.Contains("refresh_token"))
            {
                Interlocked.Increment(ref refreshes);
                return Task.FromResult(Json(SessionResponse("rotated", 3600)));
            }
            return Task.FromResult(Json(SessionResponse("first", -10)));
        }));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await auth.SignInAsync("test@example.invalid", "test-password");
        var tokens = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => auth.GetAccessTokenAsync()));
        Assert.All(tokens, value => Assert.Equal("access-rotated", value));
        Assert.Equal(1, refreshes);
        Assert.Contains("refresh-rotated", secrets.Values.Values.Single());
        Assert.DoesNotContain("access-rotated", auth.Session!.ToString());
        var restored = new SupabaseAuthClient(Options, http, secrets);
        await restored.InitializeAsync();
        Assert.Equal(UserId, restored.User!.Id);
        Assert.Equal("access-rotated", await restored.GetAccessTokenAsync());
    }

    [Fact]
    public async Task TemporaryRefreshFailurePreservesSessionAndOfflineSignoutClearsIt()
    {
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(request => request.RequestUri!.Query.Contains("password")
            ? Task.FromResult(Json(SessionResponse("first", -10)))
            : throw new HttpRequestException("offline")));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await auth.SignInAsync("test@example.invalid", "test-password");
        await Assert.ThrowsAsync<HttpRequestException>(() => auth.GetAccessTokenAsync());
        Assert.NotNull(auth.Session);
        Assert.Single(secrets.Values);
        Assert.False(await auth.SignOutAsync());
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Fact]
    public async Task InvalidRefreshRemovesOnlyTheInvalidSession()
    {
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(request => Task.FromResult(request.RequestUri!.Query.Contains("password")
            ? Json(SessionResponse("first", -10))
            : Json(new JsonObject { ["error_code"] = "refresh_token_not_found", ["msg"] = "Refresh token not found" }, HttpStatusCode.BadRequest))));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await auth.SignInAsync("test@example.invalid", "test-password");
        await Assert.ThrowsAsync<SupabaseException>(() => auth.GetAccessTokenAsync());
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Fact]
    public async Task GooglePkceChecksCallbackAndUsesStoredVerifierOnlyOnce()
    {
        JsonObject? exchanged = null;
        using var http = new HttpClient(new Handler(async request =>
        {
            Assert.Contains("grant_type=pkce", request.RequestUri!.Query);
            exchanged = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            return Json(SessionResponse("google", 3600));
        }));
        var secrets = new TestSecrets();
        var auth = new SupabaseAuthClient(Options, http, secrets);
        var start = await auth.BeginGoogleSignInAsync(new Uri("chordlibrary://auth/callback"));
        var query = Query(start);
        var redirect = query["redirect_to"];
        await Assert.ThrowsAsync<InvalidOperationException>(() => auth.CompleteGoogleSignInAsync(new Uri("chordlibrary://auth/callback?app_state=wrong&code=abc")));
        var callback = new Uri(redirect + "&code=auth-code");
        await auth.CompleteGoogleSignInAsync(callback);
        Assert.Equal("auth-code", exchanged!["auth_code"]!.GetValue<string>());
        var verifier = exchanged["code_verifier"]!.GetValue<string>();
        Assert.Equal(query["code_challenge"], Base64(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))));
        Assert.DoesNotContain(verifier, start.AbsoluteUri);
        Assert.Equal("s256", query["code_challenge_method"]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => auth.CompleteGoogleSignInAsync(callback));
    }

    [Fact]
    public async Task SignupWithConfirmationDoesNotInventSession()
    {
        using var http = new HttpClient(new Handler(_ => Task.FromResult(Json(new JsonObject { ["id"] = UserId, ["email"] = "test@example.invalid" }))));
        var secrets = new TestSecrets();
        var auth = new SupabaseAuthClient(Options, http, secrets);
        var result = await auth.SignUpAsync("test@example.invalid", "test-password");
        Assert.True(result.RequiresEmailConfirmation);
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Fact]
    public async Task RecoveryCodeCreatesSessionAndUpdatesPasswordWithItsAccessToken()
    {
        var requests = new List<string>();
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(async request =>
        {
            requests.Add(request.RequestUri!.AbsolutePath);
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            if (request.RequestUri.AbsolutePath.EndsWith("/recover", StringComparison.Ordinal))
            {
                Assert.Equal("test@example.invalid", body["email"]!.GetValue<string>());
                Assert.Null(body["code_challenge"]);
                Assert.Equal("", request.RequestUri.Query);
                return Json(new JsonObject());
            }
            if (request.RequestUri.AbsolutePath.EndsWith("/verify", StringComparison.Ordinal))
            {
                Assert.Equal("test@example.invalid", body["email"]!.GetValue<string>());
                Assert.Equal("00123456", body["token"]!.GetValue<string>());
                Assert.Equal("recovery", body["type"]!.GetValue<string>());
                Assert.Null(request.Headers.Authorization);
                return Json(SessionResponse("recovery", 3600));
            }
            Assert.Equal(HttpMethod.Put, request.Method);
            Assert.Equal("access-recovery", request.Headers.Authorization?.Parameter);
            Assert.Equal("a-new-test-password", body["password"]!.GetValue<string>());
            return Json(new JsonObject { ["id"] = UserId });
        }));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await auth.RequestPasswordResetAsync(" test@example.invalid ", null);
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
        var session = await auth.VerifyRecoveryCodeAsync(" test@example.invalid ", " 00123456 ");
        Assert.Equal(UserId, session.User.Id);
        Assert.Contains("refresh-recovery", Assert.Single(secrets.Values).Value);
        await auth.UpdatePasswordAsync("a-new-test-password");
        Assert.Equal(["/auth/v1/recover", "/auth/v1/verify", "/auth/v1/user"], requests);
    }

    [Fact]
    public async Task InvalidRecoveryCodeDoesNotCreateSessionOrSendPasswordUpdate()
    {
        var requests = 0;
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(request =>
        {
            requests++;
            Assert.EndsWith("/verify", request.RequestUri!.AbsolutePath);
            return Task.FromResult(Json(new JsonObject { ["error_code"] = "otp_expired", ["msg"] = "Token has expired or is invalid" }, HttpStatusCode.Forbidden));
        }));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await Assert.ThrowsAsync<SupabaseException>(() => auth.VerifyRecoveryCodeAsync("test@example.invalid", "wrong"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => auth.UpdatePasswordAsync("new-password"));
        Assert.Equal(1, requests);
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Theory]
    [InlineData("recovery")]
    [InlineData("signup")]
    public async Task DefaultEmailLinkExchangesHashWithConfiguredProjectWithoutFollowingLink(string type)
    {
        var calls = 0;
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(async request =>
        {
            calls++;
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://example.supabase.co/auth/v1/verify", request.RequestUri!.AbsoluteUri);
            Assert.Null(request.Headers.Authorization);
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            Assert.Equal(2, body.Count);
            Assert.Equal("hashed-token_0123", body["token_hash"]!.GetValue<string>());
            Assert.Equal(type, body["type"]!.GetValue<string>());
            return Json(SessionResponse("email-link", 3600));
        }));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        var pasted = $" https://example.supabase.co/auth/v1/verify?token=hashed-token_0123&type={type}&redirect_to=http%3A%2F%2Flocalhost%3A3000 ";
        var session = type == "recovery" ? await auth.VerifyRecoveryLinkAsync(pasted) : await auth.VerifySignupLinkAsync(pasted);
        Assert.Equal(UserId, session.User.Id);
        Assert.Equal(1, calls);
        var saved = Assert.Single(secrets.Values).Value;
        Assert.Contains("refresh-email-link", saved);
        Assert.DoesNotContain("hashed-token_0123", saved);
        Assert.DoesNotContain("localhost", saved);
    }

    [Theory]
    [InlineData("https://foreign.supabase.co/auth/v1/verify?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co.evil.invalid/auth/v1/verify?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co:8443/auth/v1/verify?token=secret&type=recovery")]
    [InlineData("http://example.supabase.co/auth/v1/verify?token=secret&type=recovery")]
    [InlineData("https://person@example.supabase.co/auth/v1/verify?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify/?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co/auth/./v1/verify?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/%76erify?token=secret&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery#")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery#access_token=bad")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=signup")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=magiclink")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret")]
    [InlineData("https://example.supabase.co/auth/v1/verify?type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&%74oken=other&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery&redirect_to=https%3A%2F%2Fone.invalid&redirect_to=https%3A%2F%2Ftwo.invalid")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery&extra=yes")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=sec%GGret&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret%0A&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret%26extra&type=recovery")]
    [InlineData("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery&redirect_to=not-a-uri")]
    [InlineData("/auth/v1/verify?token=secret&type=recovery")]
    public async Task UnsafeOrMalformedRecoveryLinkIsRejectedBeforeAnyHttpRequest(string pasted)
    {
        var calls = 0;
        using var http = new HttpClient(new Handler(_ => { calls++; return Task.FromResult(Json(SessionResponse("unexpected", 3600))); }));
        var secrets = new TestSecrets();
        var auth = new SupabaseAuthClient(Options, http, secrets);
        var error = await Assert.ThrowsAsync<ArgumentException>(() => auth.VerifyRecoveryLinkAsync(pasted));
        Assert.DoesNotContain(pasted, error.Message);
        Assert.Equal(0, calls);
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Fact]
    public async Task SignupLinkRejectsRecoveryType()
    {
        using var http = new HttpClient(new Handler(_ => throw new InvalidOperationException("Must not send an HTTP request.")));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await Assert.ThrowsAsync<ArgumentException>(() => auth.VerifySignupLinkAsync("https://example.supabase.co/auth/v1/verify?token=secret&type=recovery"));
    }

    [Fact]
    public async Task DevelopmentRecoveryLinkMustMatchConfiguredLoopbackOrigin()
    {
        var calls = 0;
        using var http = new HttpClient(new Handler(request =>
        {
            calls++;
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("http://127.0.0.1:54321/auth/v1/verify", request.RequestUri!.AbsoluteUri);
            return Task.FromResult(Json(SessionResponse("local", 3600)));
        }));
        var auth = new SupabaseAuthClient(new SupabaseOptions("http://127.0.0.1:54321", "sb_publishable_test"), http, new TestSecrets());
        await Assert.ThrowsAsync<ArgumentException>(() => auth.VerifyRecoveryLinkAsync("http://localhost:54321/auth/v1/verify?token=secret&type=recovery"));
        await auth.VerifyRecoveryLinkAsync("http://127.0.0.1:54321/auth/v1/verify?token=secret&type=recovery");
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task ExpiredEmailLinkDoesNotCreateOrPersistSession()
    {
        using var http = new HttpClient(new Handler(_ => Task.FromResult(Json(new JsonObject
            { ["error_code"] = "otp_expired", ["msg"] = "Token has expired or is invalid" }, HttpStatusCode.Forbidden))));
        var secrets = new TestSecrets();
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await Assert.ThrowsAsync<SupabaseException>(() => auth.VerifyRecoveryLinkAsync("https://example.supabase.co/auth/v1/verify?token=used&type=recovery"));
        Assert.Null(auth.Session);
        Assert.Empty(secrets.Values);
    }

    [Fact]
    public async Task PullPaginatesBeyondThousandAndBelowServerCapWithoutDroppingTombstones()
    {
        var requests = 0;
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            requests++;
            Assert.Equal("access-first", request.Headers.Authorization?.Parameter);
            var query = Query(request.RequestUri);
            Assert.Equal("eq." + UserId, query["owner_id"]);
            var cursor = int.Parse(query["revision"][3..]);
            var rows = new JsonArray();
            for (var revision = cursor + 1; revision <= Math.Min(cursor + 200, 1201); revision++)
                rows.Add(Document("songs", "song-" + revision, revision, revision % 2 == 0));
            return Task.FromResult(Json(rows));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var remote = new SupabaseDataClient(Options, http, auth);
        var items = new List<RemoteDocument>();
        await foreach (var document in remote.PullAsync("songs")) items.Add(document);
        Assert.Equal(1201, items.Count);
        Assert.Equal(600, items.Count(item => item.Deleted));
        Assert.Equal(8, requests);
        Assert.Equal(1201, items[^1].Revision);
    }

    [Fact]
    public async Task ApplyPreservesUnknownJsonAndReturnsConflictWithoutOverwrite()
    {
        JsonObject? sent = null;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            sent = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            return Json(new JsonObject { ["applied"] = false, ["document"] = Document("songs", "legacy-id", 9) });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var remote = new SupabaseDataClient(Options, http, auth);
        var payload = new JsonObject { ["id"] = "legacy-id", ["title"] = "Local", ["unknown"] = new JsonObject { ["future"] = true } };
        var result = await remote.ApplyAsync("songs", "legacy-id", payload, false, null);
        Assert.False(result.Applied);
        Assert.Equal(9, result.Document.Revision);
        Assert.Null(sent!["p_expected_revision"]);
        Assert.True(sent["p_payload"]!["unknown"]!["future"]!.GetValue<bool>());
        Assert.False(sent.ContainsKey("owner_id"));
        Assert.False(sent.ContainsKey("p_owner_id"));
    }

    [Fact]
    public async Task SyncPreservesLocalConflictAndRejectsGuestOrOtherAccount()
    {
        using var directory = new TemporaryDirectory();
        var store = new LocalLibraryStore(directory.Path);
        var profile = "user:" + UserId;
        await store.SaveSnapshotAsync(profile, new Dictionary<string, string> { ["chord-library-songs"] = "[{\"id\":\"s1\",\"title\":\"Local\",\"content\":\"[C]Test\"}]" });
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            if (request.Method == HttpMethod.Post)
                return Task.FromResult(Json(new JsonObject { ["applied"] = false, ["document"] = Document("songs", "s1", 9) }));
            var query = Query(request.RequestUri);
            return Task.FromResult(Json(query["collection"] == "eq.songs" && query["revision"] == "gt.0"
                ? new JsonArray(Document("songs", "s1", 9)) : new JsonArray()));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(store, new SupabaseDataClient(Options, http, auth), auth);
        await Assert.ThrowsAsync<InvalidOperationException>(() => sync.SyncAsync("guest"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => sync.SyncAsync("user:somebody-else"));
        var result = await sync.SyncAsync(profile);
        Assert.Single(result.Conflicts);
        Assert.Equal(0, result.Uploaded);
        var state = await store.ReadSyncStateAsync(profile);
        Assert.Single(state.PendingChanges);
        Assert.Contains("Local", state.Snapshot["chord-library-songs"]);
        var reopened = new LocalLibraryStore(directory.Path);
        Assert.Single((await reopened.ReadSyncStateAsync(profile)).PendingChanges);
    }

    [Fact]
    public async Task FailedUploadRetainsPendingTombstone()
    {
        using var directory = new TemporaryDirectory();
        var store = new LocalLibraryStore(directory.Path);
        var profile = "user:" + UserId;
        await store.AcceptRemoteAsync(profile, "songs", "s1", Document("songs", "s1", 3)["payload"]!.AsObject(), false, 3);
        await store.SaveSnapshotAsync(profile, new Dictionary<string, string> { ["chord-library-songs"] = "[]" });
        using var http = new HttpClient(new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Task.FromResult(Json(SessionResponse("first", 3600)));
            if (request.Method == HttpMethod.Post) throw new HttpRequestException("offline");
            return Task.FromResult(Json(new JsonArray()));
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(store, new SupabaseDataClient(Options, http, auth), auth);
        await Assert.ThrowsAsync<HttpRequestException>(() => sync.SyncAsync(profile));
        var pending = Assert.Single((await store.ReadSyncStateAsync(profile)).PendingChanges);
        Assert.True(pending.Deleted);
        Assert.Equal(3, pending.ExpectedRevision);
    }

    [Theory]
    [InlineData("apply")]
    [InlineData("pull")]
    public async Task AccountSwitchWhileWaitingForSessionCannotSendPriorOwnersLibrary(string operation)
    {
        const string nextUser = "ac100000-0000-4000-8000-000000000002";
        var switchEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseSwitch = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var authCalls = 0;
        var libraryCalls = 0;
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/"))
            {
                if (++authCalls == 1) return Json(SessionResponse("first", 3600));
                switchEntered.SetResult();
                await releaseSwitch.Task;
                var next = SessionResponse("second", 3600);
                next["user"]!["id"] = nextUser;
                return Json(next);
            }
            libraryCalls++;
            return operation == "apply"
                ? Json(new JsonObject { ["applied"] = true, ["document"] = Document("songs", "private-song", 1) })
                : Json(new JsonArray());
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("first@example.invalid", "test-password");
        var remote = new SupabaseDataClient(Options, http, auth);

        // The caller has pinned the first owner, but a second sign-in now owns the auth gate.
        var switching = auth.SignInAsync("second@example.invalid", "test-password");
        await switchEntered.Task;
        Assert.Equal(UserId, auth.User!.Id);
        async Task MakeRequest()
        {
            if (operation == "apply")
                await remote.ApplyAsync("songs", "private-song", new JsonObject
                    { ["id"] = "private-song", ["title"] = "First account private data", ["content"] = "C G" },
                    false, null, expectedOwner: UserId);
            else await foreach (var _ in remote.PullAsync("songs", expectedOwner: UserId)) { }
        }
        var request = MakeRequest();
        Assert.False(request.IsCompleted);
        releaseSwitch.SetResult();
        await switching;

        await Assert.ThrowsAsync<InvalidOperationException>(() => request);
        Assert.Equal(nextUser, auth.User!.Id);
        Assert.Equal(0, libraryCalls);
    }

    [Fact]
    public async Task SyncUploadsReferencedSongsBeforeEarlierQueuedSetlists()
    {
        using var directory = new TemporaryDirectory();
        var store = new LocalLibraryStore(directory.Path);
        var profile = "user:" + UserId;
        await store.ImportAsync(profile, """
            {"songs":[],"setlists":[{"id":"set","name":"Practice","songIds":["later","later"]}]}
            """);
        await store.ImportAsync(profile, """
            {"songs":[{"id":"later","title":"Later imported song","content":"C G"}]}
            """);
        Assert.Equal("setlists", (await store.ReadSyncStateAsync(profile)).PendingChanges[0].Collection);
        var uploaded = new List<string>();
        var cloudSongs = new HashSet<string>(StringComparer.Ordinal);
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            var collection = body["p_collection"]!.GetValue<string>();
            var id = body["p_id"]!.GetValue<string>();
            if (collection == "songs") cloudSongs.Add(id);
            else Assert.All(body["p_payload"]!["songIds"]!.AsArray(), node => Assert.Contains(node!.GetValue<string>(), cloudSongs));
            uploaded.Add(collection + ":" + id);
            return Json(new JsonObject
            {
                ["applied"] = true,
                ["document"] = new JsonObject
                {
                    ["collection"] = collection, ["id"] = id, ["payload"] = body["p_payload"]!.DeepClone(),
                    ["deleted"] = body["p_deleted"]!.DeepClone(), ["revision"] = uploaded.Count,
                    ["server_updated_at"] = "2026-10-03T00:00:00Z"
                }
            });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(store, new SupabaseDataClient(Options, http, auth), auth);

        var result = await sync.SyncAsync(profile);

        Assert.Equal(new[] { "songs:later", "setlists:set" }, uploaded);
        Assert.Equal(2, result.Uploaded);
        Assert.Empty((await store.ReadSyncStateAsync(profile)).PendingChanges);
        Assert.Equal(2, (await store.ReadDocumentAsync(profile)).Setlists[0]["songIds"]!.AsArray().Count);
    }

    [Fact]
    public async Task MissingSongForeignKeyFailurePreservesPendingMembershipsAndLaterImportCanRetry()
    {
        using var directory = new TemporaryDirectory();
        var store = new LocalLibraryStore(directory.Path);
        var profile = "user:" + UserId;
        await store.ImportAsync(profile, """
            {"songs":[{"id":"known","title":"Known song","content":"C G"}],
            "setlists":[{"id":"set","name":"Practice","songIds":["known","missing","known"]}]}
            """);
        var cloudSongs = new HashSet<string>(StringComparer.Ordinal);
        var calls = new List<string>();
        using var http = new HttpClient(new Handler(async request =>
        {
            if (request.RequestUri!.AbsolutePath.Contains("/auth/")) return Json(SessionResponse("first", 3600));
            if (request.Method == HttpMethod.Get) return Json(new JsonArray());
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync())!.AsObject();
            var collection = body["p_collection"]!.GetValue<string>();
            var id = body["p_id"]!.GetValue<string>();
            calls.Add(collection + ":" + id);
            if (collection == "songs") cloudSongs.Add(id);
            else if (body["p_payload"]!["songIds"]!.AsArray().Any(node => !cloudSongs.Contains(node!.GetValue<string>())))
                return Json(new JsonObject { ["code"] = "23503", ["message"] = "The setlist references a missing song. Import or sync its songs first." }, HttpStatusCode.BadRequest);
            return Json(new JsonObject
            {
                ["applied"] = true,
                ["document"] = new JsonObject
                {
                    ["collection"] = collection, ["id"] = id, ["payload"] = body["p_payload"]!.DeepClone(),
                    ["deleted"] = body["p_deleted"]!.DeepClone(), ["revision"] = calls.Count,
                    ["server_updated_at"] = "2026-10-03T00:00:00Z"
                }
            });
        }));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        var sync = new LibrarySyncCoordinator(store, new SupabaseDataClient(Options, http, auth), auth);

        var error = await Assert.ThrowsAsync<SupabaseException>(() => sync.SyncAsync(profile));
        Assert.Equal("23503", error.ErrorCode);
        var pending = Assert.Single((await store.ReadSyncStateAsync(profile)).PendingChanges);
        Assert.Equal("setlists", pending.Collection);
        Assert.Null(pending.ExpectedRevision);
        Assert.Equal(new[] { "known", "missing", "known" }, pending.Payload["songIds"]!.AsArray().Select(x => x!.GetValue<string>()));

        await store.ImportAsync(profile, """
            {"songs":[{"id":"missing","title":"Restored song","content":"D A"}]}
            """);
        var result = await sync.SyncAsync(profile);
        Assert.Equal(new[] { "songs:known", "setlists:set", "songs:missing", "setlists:set" }, calls);
        Assert.Equal(2, result.Uploaded);
        Assert.Empty((await store.ReadSyncStateAsync(profile)).PendingChanges);
        Assert.Equal(new[] { "known", "missing", "known" },
            (await store.ReadDocumentAsync(profile)).Setlists[0]["songIds"]!.AsArray().Select(x => x!.GetValue<string>()));
    }

    private static JsonObject SessionResponse(string suffix, int expiresIn) => new()
    {
        ["access_token"] = "access-" + suffix, ["refresh_token"] = "refresh-" + suffix,
        ["expires_in"] = expiresIn, ["user"] = new JsonObject { ["id"] = UserId, ["email"] = "test@example.invalid" }
    };

    private static JsonObject Document(string collection, string id, int revision, bool deleted = false) => new()
    {
        ["collection"] = collection, ["id"] = id, ["payload"] = new JsonObject { ["id"] = id, ["title"] = "Remote", ["content"] = "[C]Song" },
        ["deleted"] = deleted, ["revision"] = revision, ["server_updated_at"] = "2026-10-03T00:00:00Z"
    };

    private static HttpResponseMessage Json(JsonNode body, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
    private static string Base64(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static Dictionary<string, string> Query(Uri uri) => uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(part => part.Split('=', 2)).ToDictionary(parts => Uri.UnescapeDataString(parts[0]), parts => Uri.UnescapeDataString(parts[1]));

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> action) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => action(request);
    }
    private sealed class TestSecrets : ISecretStore
    {
        public Dictionary<string, string> Values { get; } = [];
        public Task<string?> GetAsync(string key, CancellationToken cancellationToken = default) => Task.FromResult(Values.GetValueOrDefault(key));
        public Task SetAsync(string key, string value, CancellationToken cancellationToken = default) { Values[key] = value; return Task.CompletedTask; }
        public Task RemoveAsync(string key, CancellationToken cancellationToken = default) { Values.Remove(key); return Task.CompletedTask; }
    }
    private sealed class TemporaryDirectory : IDisposable
    {
        private static readonly string TestRoot = System.IO.Path.GetFullPath(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "chordlibrary-supabase-tests"));
        public string Path { get; } = System.IO.Path.Combine(TestRoot, Guid.NewGuid().ToString("N"));
        public void Dispose()
        {
            var resolved = System.IO.Path.GetFullPath(Path);
            if (!resolved.StartsWith(TestRoot + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Test cleanup escaped its temporary directory.");
            if (Directory.Exists(resolved)) Directory.Delete(resolved, true);
        }
    }
}
