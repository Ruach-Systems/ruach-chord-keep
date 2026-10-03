using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core;

public sealed class PendingLibraryChange
{
    public string Collection { get; set; } = "";
    public string Id { get; set; } = "";
    public JsonObject Payload { get; set; } = new();
    public bool Deleted { get; set; }
    public long? ExpectedRevision { get; set; }
    public string LocalVersion { get; set; } = Guid.NewGuid().ToString("N");
}

public sealed class LibrarySyncState
{
    public Dictionary<string, string> Snapshot { get; set; } = new(StringComparer.Ordinal);
    public List<PendingLibraryChange> PendingChanges { get; set; } = [];
    public Dictionary<string, long> RemoteRevisions { get; set; } = new(StringComparer.Ordinal);
}

/// <summary>Account-scoped durable storage. Every mutation is serialized and atomically replaces a complete profile.</summary>
public sealed class LocalLibraryStore
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new(StringComparer.OrdinalIgnoreCase);
    private static readonly JsonSerializerOptions SerializerOptions = new() { WriteIndented = false, MaxDepth = 80 };
    private readonly string _directory;
    private readonly LibraryImportService _imports = new();

    public LocalLibraryStore(string dataDirectory)
    {
        _directory = Path.GetFullPath(dataDirectory);
        Directory.CreateDirectory(_directory);
    }

    public Task<Dictionary<string, string>> ReadSnapshotAsync(string profileId, CancellationToken ct = default) =>
        WithStateAsync(profileId, false, state => new Dictionary<string, string>(state.Snapshot, StringComparer.Ordinal), ct);

    public Task<LibraryDocument> ReadDocumentAsync(string profileId, CancellationToken ct = default) =>
        WithStateAsync(profileId, false, state => LibraryDocument.FromSnapshot(state.Snapshot), ct);

    public Task<LibrarySyncState> ReadSyncStateAsync(string profileId, CancellationToken ct = default) =>
        WithStateAsync(profileId, false, state => new LibrarySyncState
        {
            Snapshot = new(state.Snapshot, StringComparer.Ordinal),
            PendingChanges = state.PendingChanges.Values.Select(CloneChange).ToList(),
            RemoteRevisions = new(state.RemoteRevisions, StringComparer.Ordinal)
        }, ct);

    public Task SaveSnapshotAsync(string profileId, IReadOnlyDictionary<string, string> snapshot, CancellationToken ct = default) =>
        WithStateAsync(profileId, true, state => { SetSnapshot(state, snapshot); return true; }, ct);

    /// <summary>
    /// Merges only client edits relative to the last snapshot that client actually saw. Remote records
    /// downloaded meanwhile survive, and a concurrent edit of the same record retains its old revision
    /// so synchronization reports a conflict rather than overwriting unseen cloud changes.
    /// </summary>
    public Task SaveClientSnapshotAsync(string profileId, IReadOnlyDictionary<string, string> baselineSnapshot,
        IReadOnlyDictionary<string, string> nextSnapshot, IReadOnlyDictionary<string, long> baselineRemoteRevisions,
        CancellationToken ct = default) => WithStateAsync(profileId, true, state =>
    {
        var baseline = NormalizeSnapshot(baselineSnapshot);
        var next = NormalizeSnapshot(nextSnapshot);
        if (baselineRemoteRevisions.Values.Any(revision => revision <= 0))
            throw new LibraryValidationException("Known remote revisions must be positive.");
        var baselineDocument = LibraryDocument.FromSnapshot(baseline);
        var nextDocument = LibraryDocument.FromSnapshot(next);
        var currentDocument = LibraryDocument.FromSnapshot(state.Snapshot);
        ApplyClientChanges(state, "songs", baselineDocument.Songs, nextDocument.Songs, currentDocument.Songs, baselineRemoteRevisions);
        ApplyClientChanges(state, "setlists", baselineDocument.Setlists, nextDocument.Setlists, currentDocument.Setlists, baselineRemoteRevisions);

        foreach (var key in baseline.Keys.Union(next.Keys, StringComparer.Ordinal))
        {
            if (key is LibraryStorageKeys.Songs or LibraryStorageKeys.Setlists or LibraryStorageKeys.LegacyPlaylists) continue;
            var wasPresent = baseline.TryGetValue(key, out var before);
            var isPresent = next.TryGetValue(key, out var after);
            if (wasPresent == isPresent && before == after) continue;
            if (isPresent) state.Snapshot[key] = after!; else state.Snapshot.Remove(key);
        }
        currentDocument.WriteTo(state.Snapshot);
        var nextSongIds = nextDocument.Songs.Select(LibraryValidation.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var removed in baselineDocument.Songs.Where(song => !nextSongIds.Contains(LibraryValidation.Id(song))))
            RemoveDeletedSongReferences(state, LibraryValidation.Id(removed));
        // Recheck the combined size, as both client and cloud may have added records independently.
        state.Snapshot = NormalizeSnapshot(state.Snapshot);
        return true;
    }, ct);

    public Task SaveDocumentAsync(string profileId, LibraryDocument document, CancellationToken ct = default) =>
        WithStateAsync(profileId, true, state =>
        {
            var snapshot = new Dictionary<string, string>(state.Snapshot, StringComparer.Ordinal);
            LibraryValidation.Validate(document).WriteTo(snapshot);
            SetSnapshot(state, snapshot);
            return true;
        }, ct);

    public Task<ImportPreview> PreviewImportAsync(string profileId, string json, bool regenerateIds = false, CancellationToken ct = default) =>
        WithStateAsync(profileId, false, state => _imports.Preview(json, LibraryDocument.FromSnapshot(state.Snapshot), regenerateIds), ct);

    /// <summary>Parses and validates the whole file before any mutation; a malformed record never partially imports.</summary>
    public Task<ImportPreview> ImportAsync(string profileId, string json, bool regenerateIds = false, CancellationToken ct = default) =>
        WithStateAsync(profileId, true, state =>
        {
            var preview = _imports.Preview(json, LibraryDocument.FromSnapshot(state.Snapshot), regenerateIds);
            var snapshot = new Dictionary<string, string>(state.Snapshot, StringComparer.Ordinal);
            preview.Document.WriteTo(snapshot);
            SetSnapshot(state, snapshot);
            return preview;
        }, ct);

    /// <summary>Remote changes only replace clean records. A dirty local version always remains available.</summary>
    public Task<bool> AcceptRemoteAsync(string profileId, string collection, string id, JsonObject payload,
        bool deleted, long revision, CancellationToken ct = default) => WithStateAsync(profileId, true, state =>
            ApplyRemote(state, collection, id, payload, deleted, revision), ct);

    /// <summary>Accepts a reviewed cloud conflict only while the local version is still the version shown to the user.</summary>
    public Task<bool> AcceptConflictRemoteAsync(string profileId, string collection, string id, string localVersion,
        JsonObject payload, bool deleted, long revision, CancellationToken ct = default) => WithStateAsync(profileId, true, state =>
    {
        var key = Key(collection, id);
        if (!state.PendingChanges.TryGetValue(key, out var pending) || pending.LocalVersion != localVersion
            || state.RemoteRevisions.GetValueOrDefault(key) > revision) return false;
        // Validate before removing the local change. Exceptions leave the profile file untouched.
        ValidateRemote(collection, id, payload, deleted);
        state.PendingChanges.Remove(key);
        return ApplyRemote(state, collection, id, payload, deleted, revision, force: true);
    }, ct);

    private static bool ApplyRemote(PersistedState state, string collection, string id, JsonObject payload,
        bool deleted, long revision, bool force = false)
    {
        if (revision <= 0) throw new LibraryValidationException("Remote revisions must be positive.");
        var item = ValidateRemote(collection, id, payload, deleted);
        var key = Key(collection, id);
        if (state.PendingChanges.ContainsKey(key)) return false;
        if (!force && state.RemoteRevisions.GetValueOrDefault(key) >= revision) return true;

        var document = LibraryDocument.FromSnapshot(state.Snapshot);
        var records = Records(document, collection);
        records.RemoveAll(x => LibraryValidation.Id(x) == id);
        if (!deleted) records.Add(item);
        state.RemoteRevisions[key] = revision;
        if (deleted) state.RemoteDeleted.Add(key); else state.RemoteDeleted.Remove(key);
        document.WriteTo(state.Snapshot);
        if (collection == "songs" && deleted) RemoveDeletedSongReferences(state, id);
        if (collection == "setlists" && !deleted)
        {
            foreach (var songKey in state.RemoteDeleted.Where(x => x.StartsWith("songs:", StringComparison.Ordinal)).ToArray())
                RemoveDeletedSongReferences(state, songKey[6..]);
        }
        return true;
    }

    /// <summary>An upload only clears the exact local version sent; later edits retain their pending state.</summary>
    public Task AcknowledgeAsync(string profileId, string collection, string id, string localVersion,
        long remoteRevision, CancellationToken ct = default) => WithStateAsync(profileId, true, state =>
    {
        if (remoteRevision <= 0) throw new LibraryValidationException("Remote revisions must be positive.");
        var key = Key(collection, id);
        state.RemoteRevisions[key] = Math.Max(state.RemoteRevisions.GetValueOrDefault(key), remoteRevision);
        if (state.PendingChanges.TryGetValue(key, out var pending))
        {
            if (pending.LocalVersion == localVersion)
            {
                if (pending.Deleted) state.RemoteDeleted.Add(key); else state.RemoteDeleted.Remove(key);
                state.PendingChanges.Remove(key);
            }
            else pending.ExpectedRevision = state.RemoteRevisions[key];
        }
        return true;
    }, ct);

    /// <summary>Explicitly keeps the local item after the user has reviewed a remote conflict.</summary>
    public Task RebasePendingAsync(string profileId, string collection, string id, long remoteRevision,
        CancellationToken ct = default, string? expectedLocalVersion = null) => WithStateAsync(profileId, true, state =>
    {
        var key = Key(collection, id);
        if (remoteRevision <= 0) throw new LibraryValidationException("Remote revisions must be positive.");
        if (state.PendingChanges.TryGetValue(key, out var pending))
        {
            if (expectedLocalVersion is not null && pending.LocalVersion != expectedLocalVersion)
                throw new InvalidOperationException("The local item changed after this conflict was shown. Sync again to review the latest versions.");
            pending.ExpectedRevision = remoteRevision;
            state.RemoteRevisions[key] = remoteRevision;
        }
        else if (expectedLocalVersion is not null)
            throw new InvalidOperationException("This conflict has already been resolved. Sync again to refresh.");
        return true;
    }, ct);

    private static void SetSnapshot(PersistedState state, IReadOnlyDictionary<string, string> supplied)
    {
        var next = NormalizeSnapshot(supplied);
        var previousDocument = LibraryDocument.FromSnapshot(state.Snapshot);
        var nextDocument = LibraryDocument.FromSnapshot(next);
        TrackChanges(state, "songs", previousDocument.Songs, nextDocument.Songs);
        TrackChanges(state, "setlists", previousDocument.Setlists, nextDocument.Setlists);
        state.Snapshot = next;
    }

    private static Dictionary<string, string> NormalizeSnapshot(IReadOnlyDictionary<string, string> supplied)
    {
        if (supplied.Count > 100) throw new LibraryValidationException("Too many app preferences.");
        var totalBytes = 0L;
        foreach (var (key, value) in supplied)
        {
            if (!key.StartsWith("chord-library-", StringComparison.Ordinal) || key.Length > 200 || value is null)
                throw new LibraryValidationException("The snapshot contains an invalid app storage key.");
            totalBytes += Encoding.UTF8.GetByteCount(value);
        }
        if (totalBytes > LibraryValidation.MaximumImportBytes)
            throw new LibraryValidationException("Local library data exceeds the 25 MB limit.");
        var next = new Dictionary<string, string>(supplied, StringComparer.Ordinal);
        var nextDocument = LibraryDocument.FromSnapshot(next);
        EnsureUnique(nextDocument.Songs);
        EnsureUnique(nextDocument.Setlists);
        if (nextDocument.Songs.Any(LibraryValidation.IsDeleted) || nextDocument.Setlists.Any(LibraryValidation.IsDeleted))
            throw new LibraryValidationException("Deleted records must not appear in the visible library.");
        nextDocument.WriteTo(next);
        return next;
    }

    private static void ApplyClientChanges(PersistedState state, string collection, List<JsonObject> baseline,
        List<JsonObject> next, List<JsonObject> current, IReadOnlyDictionary<string, long> baselineRevisions)
    {
        var before = baseline.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        var after = next.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        var latest = current.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        foreach (var id in before.Keys.Union(after.Keys, StringComparer.Ordinal))
        {
            before.TryGetValue(id, out var oldItem);
            after.TryGetValue(id, out var newItem);
            if (JsonNode.DeepEquals(oldItem, newItem)) continue;
            latest.TryGetValue(id, out var latestItem);
            if (JsonNode.DeepEquals(latestItem, newItem)) continue;
            var deleted = newItem is null;
            var payload = (JsonObject)(newItem ?? oldItem!).DeepClone();
            if (deleted)
            {
                latest.Remove(id);
                payload["deleted"] = true;
                payload["updatedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            }
            else latest[id] = payload;
            var key = Key(collection, id);
            var basis = state.PendingChanges.TryGetValue(key, out var pending) ? pending.ExpectedRevision
                : baselineRevisions.TryGetValue(key, out var revision) ? revision : (long?)null;
            state.PendingChanges[key] = new PendingLibraryChange
            {
                Collection = collection, Id = id, Payload = (JsonObject)payload.DeepClone(), Deleted = deleted,
                ExpectedRevision = basis, LocalVersion = Guid.NewGuid().ToString("N")
            };
        }
        current.Clear();
        current.AddRange(latest.Values);
    }

    private static void TrackChanges(PersistedState state, string collection, List<JsonObject> prior, List<JsonObject> next)
    {
        var previous = prior.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        var current = next.ToDictionary(LibraryValidation.Id, StringComparer.Ordinal);
        foreach (var (id, item) in current)
        {
            if (previous.TryGetValue(id, out var old) && JsonNode.DeepEquals(old, item)) continue;
            QueueChange(state, collection, id, item, false);
        }
        foreach (var (id, item) in previous)
        {
            if (current.ContainsKey(id)) continue;
            var tombstone = (JsonObject)item.DeepClone();
            tombstone["deleted"] = true;
            tombstone["updatedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            QueueChange(state, collection, id, tombstone, true);
        }
    }

    private static void QueueChange(PersistedState state, string collection, string id, JsonObject item, bool deleted)
    {
        var key = Key(collection, id);
        // Retain the revision on which the first unsynced change was based.
        var basis = state.PendingChanges.TryGetValue(key, out var prior) ? prior.ExpectedRevision
            : state.RemoteRevisions.TryGetValue(key, out var revision) ? revision : (long?)null;
        state.PendingChanges[key] = new PendingLibraryChange
        {
            Collection = collection, Id = id, Payload = (JsonObject)item.DeepClone(), Deleted = deleted,
            ExpectedRevision = basis, LocalVersion = Guid.NewGuid().ToString("N")
        };
    }

    private static void RemoveDeletedSongReferences(PersistedState state, string songId)
    {
        var document = LibraryDocument.FromSnapshot(state.Snapshot);
        var changed = false;
        foreach (var setlist in document.Setlists)
        {
            var ids = (JsonArray)setlist["songIds"]!;
            if (!ids.Any(x => x!.GetValue<string>() == songId)) continue;
            for (var i = ids.Count - 1; i >= 0; i--) if (ids[i]!.GetValue<string>() == songId) ids.RemoveAt(i);
            setlist["updatedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            QueueChange(state, "setlists", LibraryValidation.Id(setlist), setlist, false);
            changed = true;
        }
        if (changed) document.WriteTo(state.Snapshot);
    }

    private async Task<T> WithStateAsync<T>(string profileId, bool write, Func<PersistedState, T> operation, CancellationToken ct)
    {
        var path = ProfilePath(profileId);
        var gate = Gates.GetOrAdd(path, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var state = await LoadAsync(path, ct).ConfigureAwait(false);
            var result = operation(state);
            if (write)
            {
                // Downloads also change collection counts and aggregate size. Never write a profile
                // that the next read would reject; an over-limit merge leaves the prior file intact.
                state.Snapshot = NormalizeSnapshot(state.Snapshot);
                await PersistAsync(path, state, ct).ConfigureAwait(false);
            }
            return result;
        }
        finally { gate.Release(); }
    }

    private string ProfilePath(string profileId)
    {
        if (string.IsNullOrWhiteSpace(profileId) || profileId.Length > 512)
            throw new ArgumentException("A nonempty account profile identifier is required.", nameof(profileId));
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(profileId))).ToLowerInvariant();
        return Path.Combine(_directory, digest + ".json");
    }

    private static async Task<PersistedState> LoadAsync(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return new PersistedState();
        if (new FileInfo(path).Length > LibraryValidation.MaximumImportBytes * 4L)
            throw new LibraryValidationException("The local profile exceeds the supported storage limit.");
        try
        {
            var json = await File.ReadAllTextAsync(path, ct).ConfigureAwait(false);
            var state = JsonSerializer.Deserialize<PersistedState>(json, SerializerOptions)
                ?? throw new LibraryValidationException("The local profile is empty or damaged.");
            if (state.SchemaVersion != 1) throw new LibraryValidationException("This local profile version is not supported.");
            if (state.Snapshot is null || state.PendingChanges is null || state.RemoteRevisions is null || state.RemoteDeleted is null)
                throw new LibraryValidationException("The local profile is damaged.");
            var document = LibraryDocument.FromSnapshot(state.Snapshot);
            EnsureUnique(document.Songs);
            EnsureUnique(document.Setlists);
            return state;
        }
        catch (JsonException ex)
        {
            throw new LibraryValidationException($"Local data could not be read; the original file was preserved. {ex.Message}");
        }
    }

    private static async Task PersistAsync(string path, PersistedState state, CancellationToken ct)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(state, SerializerOptions);
            if (bytes.Length > LibraryValidation.MaximumImportBytes * 4L)
                throw new LibraryValidationException("The local profile exceeds the supported storage limit.");
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                64 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, ct).ConfigureAwait(false);
                await stream.FlushAsync(ct).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }
            ct.ThrowIfCancellationRequested();
            if (File.Exists(path)) File.Replace(temporary, path, path + ".bak");
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static JsonObject ValidateRemote(string collection, string id, JsonObject payload, bool deleted)
    {
        var copy = (JsonObject)payload.DeepClone();
        if (copy["id"] is not null && copy["id"]!.GetValue<string>() != id)
            throw new LibraryValidationException("Remote record ID does not match its payload.");
        copy["id"] = id;
        if (deleted) copy["deleted"] = true; else copy.Remove("deleted");
        return LibraryValidation.ValidateRecord(copy, collection);
    }

    private static void EnsureUnique(List<JsonObject> records)
    {
        if (records.Select(LibraryValidation.Id).Distinct(StringComparer.Ordinal).Count() != records.Count)
            throw new LibraryValidationException("The library contains duplicate IDs. Import a backup to merge duplicate records.");
    }

    private static List<JsonObject> Records(LibraryDocument document, string collection) => collection switch
    {
        "songs" => document.Songs,
        "setlists" => document.Setlists,
        _ => throw new LibraryValidationException("Unknown library collection.")
    };

    private static string Key(string collection, string id)
    {
        if (collection is not ("songs" or "setlists") || string.IsNullOrWhiteSpace(id))
            throw new LibraryValidationException("Invalid library record identity.");
        return collection + ":" + id;
    }

    private static PendingLibraryChange CloneChange(PendingLibraryChange change) => new()
    {
        Collection = change.Collection, Id = change.Id, Payload = (JsonObject)change.Payload.DeepClone(),
        Deleted = change.Deleted, ExpectedRevision = change.ExpectedRevision, LocalVersion = change.LocalVersion
    };

    private sealed class PersistedState
    {
        public int SchemaVersion { get; set; } = 1;
        public Dictionary<string, string> Snapshot { get; set; } = new(StringComparer.Ordinal)
        {
            [LibraryStorageKeys.Songs] = "[]", [LibraryStorageKeys.Setlists] = "[]"
        };
        public Dictionary<string, PendingLibraryChange> PendingChanges { get; set; } = new(StringComparer.Ordinal);
        public Dictionary<string, long> RemoteRevisions { get; set; } = new(StringComparer.Ordinal);
        public HashSet<string> RemoteDeleted { get; set; } = new(StringComparer.Ordinal);
    }
}
