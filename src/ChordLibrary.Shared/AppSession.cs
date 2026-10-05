using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChordLibrary.Core;
using ChordLibrary.Core.Supabase;
namespace ChordLibrary.Shared;

public sealed class AppSession(IAppPlatform platform, ISecretStore secrets, HttpClient http, SupabaseOptions? defaultOptions = null)
{
    private readonly LocalLibraryStore guestStore = new(platform.DataDirectory);
    private LocalLibraryStore? accountStore;
    private readonly SemaphoreSlim viewGate = new(1, 1);
    private Dictionary<string,string> baseline = [];
    private Dictionary<string,long> revisions = [];
    private string? accountEmail;
    private LocalLibraryStore? baselineStore;
    private string? baselineProfile;
    public LocalLibraryStore Store => HasAccountLibrary ? accountStore! : guestStore;
    public string ProfileId { get; private set; } = "guest";
    public bool HasAccountLibrary => ProfileId != "guest";
    public SupabaseOptions? Options { get; private set; }
    public SupabaseAuthClient? Auth { get; private set; }
    public LibrarySyncCoordinator? Sync { get; private set; }
    public bool SignedIn => Auth?.User is not null;
    public string? Email => Auth?.User?.Email ?? accountEmail;
    public string? DisplayName => Auth?.User?.DisplayName;
    public string? AvatarUrl => Auth?.User?.AvatarUrl;
    private bool initialized;
    private string ConfigPath => Path.Combine(platform.DataDirectory, "supabase-public.json");
    public async Task InitializeAsync()
    {
        if (initialized) return;
        if (File.Exists(ConfigPath))
        {
            var options = JsonSerializer.Deserialize<SupabaseOptions>(await File.ReadAllTextAsync(ConfigPath));
            if (options is not null) await ConnectAsync(options);
        }
        else if (defaultOptions is not null) await ConnectAsync(defaultOptions);
        initialized = true;
    }
    public async Task ConfigureAsync(string url, string key)
    {
        if (HasAccountLibrary) throw new InvalidOperationException("Sign out before changing the Supabase project.");
        var options = new SupabaseOptions(url.Trim().TrimEnd('/'), key.Trim()); options.Validate();
        await ConnectAsync(options);
        Directory.CreateDirectory(platform.DataDirectory);
        var temp = ConfigPath + ".tmp"; await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(options)); File.Move(temp, ConfigPath, true);
    }
    private async Task ConnectAsync(SupabaseOptions options)
    {
        var auth = new SupabaseAuthClient(options, http, secrets); await auth.InitializeAsync();
        var project = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(options.Validate().AbsoluteUri)));
        accountStore = new LocalLibraryStore(Path.Combine(platform.DataDirectory, "projects", project));
        Options = options; Auth = auth;
        Sync = new LibrarySyncCoordinator(accountStore, new SupabaseDataClient(options, http, auth), auth); SelectAccount();
    }
    public void SelectAccount() { ProfileId = Auth?.User is { } user ? "user:" + user.Id : "guest"; accountEmail = Auth?.User?.Email; }
    public async Task<Dictionary<string,string>> ReadInitialAsync()
    {
        var store = Store; var profile = ProfileId;
        var state = await store.ReadSyncStateAsync(profile); baseline = new(state.Snapshot); revisions = new(state.RemoteRevisions); baselineStore = store; baselineProfile = profile; return state.Snapshot;
    }
    public async Task DeliverSnapshotAsync(Func<Dictionary<string,string>,Task> deliver, bool onlyIfChanged = false)
    {
        await viewGate.WaitAsync();
        try {
            var store = Store; var profile = ProfileId;
            var state = await store.ReadSyncStateAsync(profile);
            // Upload acknowledgments and downloads of our own writes can advance sync metadata
            // without changing what the WebView displays. Avoid resetting its DOM and scroll.
            // Compare the saved view as well as this sync's changes so deferred updates still arrive.
            var sameView = ReferenceEquals(baselineStore, store) && baselineProfile == profile
                && SnapshotsEqual(baseline, state.Snapshot);
            if (!onlyIfChanged || !sameView) await deliver(state.Snapshot);
            baseline = new(state.Snapshot); revisions = new(state.RemoteRevisions); baselineStore = store; baselineProfile = profile;
        }
        finally { viewGate.Release(); }
    }
    private static bool SnapshotsEqual(IReadOnlyDictionary<string,string> seen, IReadOnlyDictionary<string,string> current)
    {
        if (seen.Count == current.Count && seen.All(pair => current.TryGetValue(pair.Key, out var value) && value == pair.Value)) return true;
        foreach (var key in seen.Keys.Union(current.Keys, StringComparer.Ordinal))
        {
            if (key is LibraryStorageKeys.Songs or LibraryStorageKeys.Setlists or LibraryStorageKeys.LegacyPlaylists) continue;
            if (seen.TryGetValue(key, out var before) != current.TryGetValue(key, out var after) || before != after) return false;
        }
        // Ignore JSON formatting, object property order and normalization of legacy defaults.
        // Array order, record values and settings changes must still be delivered.
        var beforeDocument = LibraryDocument.FromSnapshot(seen);
        var afterDocument = LibraryDocument.FromSnapshot(current);
        return RecordsEqual(beforeDocument.Songs, afterDocument.Songs)
            && RecordsEqual(beforeDocument.Setlists, afterDocument.Setlists);
    }
    private static bool RecordsEqual(IReadOnlyList<JsonObject> before, IReadOnlyList<JsonObject> after) =>
        before.Count == after.Count && before.Zip(after).All(pair => JsonNode.DeepEquals(pair.First, pair.Second));
    public async Task SaveAsync(Dictionary<string,string> snapshot)
    {
        await viewGate.WaitAsync();
        try {
            var store = Store; var profile = ProfileId;
            if (!ReferenceEquals(store,baselineStore) || profile != baselineProfile) throw new InvalidOperationException("The active library changed. Reload the current account before saving.");
            await store.SaveClientSnapshotAsync(profile,baseline,snapshot,revisions); baseline = new(snapshot);
        }
        finally { viewGate.Release(); }
    }
    public Task<LibraryDocument> ReadGuestAsync() => guestStore.ReadDocumentAsync("guest");
    public async Task<LibrarySyncResult> SyncAsync(CancellationToken cancellationToken = default)
    {
        var store = Store; var profile = ProfileId;
        var coordinator = Sync ?? throw new InvalidOperationException("Connect a Supabase project first.");
        var result = await coordinator.SyncAsync(profile, cancellationToken);
        await viewGate.WaitAsync(cancellationToken);
        try
        {
            if (!ReferenceEquals(Store, store) || ProfileId != profile
                || !ReferenceEquals(baselineStore, store) || baselineProfile != profile) return result;
            var state = await store.ReadSyncStateAsync(profile, cancellationToken);
            var seen = LibraryDocument.FromSnapshot(baseline);
            var current = LibraryDocument.FromSnapshot(state.Snapshot);
            var dirty = state.PendingChanges.Select(change => change.Collection + ":" + change.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var (collection, seenRecords, currentRecords) in new[]
                { ("songs", seen.Songs, current.Songs), ("setlists", seen.Setlists, current.Setlists) })
            {
                var latest = currentRecords.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
                foreach (var record in seenRecords)
                {
                    var id = LibraryValidation.Id(record); var key = collection + ":" + id;
                    // An acknowledged upload can advance the revision without a UI refresh only
                    // when the UI already displays exactly that payload. Unseen edits stay conflicts.
                    if (!dirty.Contains(key) && latest.TryGetValue(id, out var saved)
                        && System.Text.Json.Nodes.JsonNode.DeepEquals(record, saved)
                        && state.RemoteRevisions.TryGetValue(key, out var revision)) revisions[key] = revision;
                }
            }
            return result;
        }
        finally { viewGate.Release(); }
    }
}
