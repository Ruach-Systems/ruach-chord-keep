using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core;

public sealed record ImportPreview(
    LibraryDocument Document,
    int SongsAdded,
    int SongsUpdated,
    int SetlistsAdded,
    int SetlistsUpdated,
    IReadOnlyList<string> Warnings,
    bool IsSingleSong);

/// <summary>Reads original version 1/2 backups, single-song files, and cl-song QR JSON.</summary>
public sealed class LibraryImportService
{
    public ImportPreview Preview(string json, LibraryDocument current, bool regenerateIds = false)
    {
        if (string.IsNullOrWhiteSpace(json)) throw new LibraryValidationException("Choose a nonempty JSON backup.");
        if (Encoding.UTF8.GetByteCount(json) > LibraryValidation.MaximumImportBytes)
            throw new LibraryValidationException("The import exceeds the 25 MB limit.");
        try
        {
            if (JsonNode.Parse(json.TrimStart('\uFEFF'), documentOptions: LibraryValidation.JsonOptions) is not JsonObject root)
                throw new LibraryValidationException("The backup must contain a JSON object.");
            return BuildPreview(root, current, regenerateIds);
        }
        catch (JsonException ex) { throw new LibraryValidationException($"The backup is not valid JSON: {ex.Message}"); }
        catch (ArgumentException ex) { throw new LibraryValidationException($"The backup contains invalid or duplicate fields: {ex.Message}"); }
        catch (InvalidOperationException ex) { throw new LibraryValidationException($"The backup contains an invalid value: {ex.Message}"); }
    }

    public string Export(LibraryDocument document) => new JsonObject
    {
        ["version"] = 2,
        ["exportedAt"] = DateTimeOffset.UtcNow.ToString("O"),
        ["songs"] = new JsonArray(document.Songs.Select(x => (JsonNode)x.DeepClone()).ToArray()),
        ["setlists"] = new JsonArray(document.Setlists.Select(x => (JsonNode)x.DeepClone()).ToArray())
    }.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

    private static ImportPreview BuildPreview(JsonObject root, LibraryDocument current, bool regenerateIds)
    {
        var warnings = new List<string>();
        var isSingle = !root.ContainsKey("songs");
        LibraryDocument incoming;
        if (!isSingle)
        {
            if (root["songs"] is not JsonArray songs) throw new LibraryValidationException("songs must be an array.");
            if (root["version"] is not null && LibraryValidation.ReadInteger(root, "version", 1) is not (1 or 2))
                throw new LibraryValidationException("This backup version is not supported. Export a version 1 or 2 backup.");
            var listNode = root.ContainsKey("setlists") ? root["setlists"] : root["playlists"];
            if (listNode is not null && listNode is not JsonArray)
                throw new LibraryValidationException("setlists or playlists must be an array.");
            incoming = new LibraryDocument
            {
                Songs = LibraryValidation.ReadArray(songs, "songs"),
                Setlists = listNode is JsonArray setlists ? LibraryValidation.ReadArray(setlists, "setlists") : []
            };
            if (root.ContainsKey("setlists") && root.ContainsKey("playlists"))
                warnings.Add("Both setlists and legacy playlists are present; setlists takes precedence, matching the original app.");
        }
        else
        {
            JsonObject song;
            if (root["type"]?.GetValue<string>() == "single-song")
            {
                if (root["song"] is not JsonObject wrapped) throw new LibraryValidationException("The single-song file is missing its song object.");
                song = (JsonObject)wrapped.DeepClone();
            }
            else if (root.ContainsKey("t"))
            {
                if (root["t"]?.GetValue<string>() != "cl-song" || LibraryValidation.ReadInteger(root, "v", 0) != 1)
                    throw new LibraryValidationException("This QR payload is not a supported cl-song version 1 song.");
                song = new JsonObject { ["title"] = root["n"]?.DeepClone(), ["artist"] = root["a"]?.DeepClone() ?? JsonValue.Create(""), ["content"] = root["c"]?.DeepClone() };
                warnings.Add("Original QR sharing removes lyrics. Only the chord text actually contained in the QR can be imported.");
            }
            else song = (JsonObject)root.DeepClone();
            song["id"] = Guid.NewGuid().ToString();
            song["createdAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            song["updatedAt"] = song["createdAt"]!.DeepClone();
            song["deleted"] = false;
            if (song["title"] is JsonValue title && title.TryGetValue<string>(out var text)) song["title"] = text.Trim().ToUpperInvariant();
            incoming = new LibraryDocument { Songs = [LibraryValidation.ValidateRecord(song, "songs")] };
        }

        incoming.Songs = Deduplicate(incoming.Songs, "song", warnings);
        incoming.Setlists = Deduplicate(incoming.Setlists, "setlist", warnings);
        if (regenerateIds && !isSingle)
        {
            var map = incoming.Songs.ToDictionary(LibraryValidation.Id, _ => Guid.NewGuid().ToString(), StringComparer.Ordinal);
            foreach (var song in incoming.Songs) song["id"] = map[LibraryValidation.Id(song)];
            foreach (var setlist in incoming.Setlists)
            {
                setlist["id"] = Guid.NewGuid().ToString();
                var refs = (JsonArray)setlist["songIds"]!;
                for (var i = 0; i < refs.Count; i++)
                    if (map.TryGetValue(refs[i]!.GetValue<string>(), out var mapped)) refs[i] = mapped;
            }
        }

        var merged = LibraryValidation.Validate(current);
        var songsResult = Merge(merged.Songs, incoming.Songs);
        var setlistsResult = Merge(merged.Setlists, incoming.Setlists);
        var knownSongs = merged.Songs.Select(LibraryValidation.Id).ToHashSet(StringComparer.Ordinal);
        var missing = merged.Setlists.Sum(s => ((JsonArray)s["songIds"]!).Count(id => !knownSongs.Contains(id!.GetValue<string>())));
        if (missing > 0) warnings.Add($"{missing} setlist song reference(s) have no matching song. References were preserved. Affected setlists remain pending for cloud sync while those songs are absent from Supabase, and can pause the remaining sync. Import or sync the missing songs, or remove the unresolved references.");
        LibraryValidation.Validate(merged);
        return new ImportPreview(merged, songsResult.Added, songsResult.Updated, setlistsResult.Added, setlistsResult.Updated, warnings, isSingle);
    }

    private static List<JsonObject> Deduplicate(List<JsonObject> records, string label, List<string> warnings)
    {
        var unique = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var duplicates = 0;
        var deleted = 0;
        foreach (var record in records)
        {
            if (LibraryValidation.IsDeleted(record)) { deleted++; continue; }
            var id = LibraryValidation.Id(record);
            if (!unique.TryGetValue(id, out var prior)) unique[id] = record;
            else
            {
                duplicates++;
                if (LibraryValidation.Modified(record) > LibraryValidation.Modified(prior)) unique[id] = record;
            }
        }
        if (duplicates > 0) warnings.Add($"Merged {duplicates} duplicate {label} ID(s), choosing the newest timestamp and keeping the first record on ties.");
        if (deleted > 0) warnings.Add($"Skipped {deleted} deleted {label} record(s).");
        return unique.Values.ToList();
    }

    private static (int Added, int Updated) Merge(List<JsonObject> target, IEnumerable<JsonObject> incoming)
    {
        var index = target.Select((item, i) => (Id: LibraryValidation.Id(item), Index: i)).ToDictionary(x => x.Id, x => x.Index, StringComparer.Ordinal);
        var added = 0;
        var updated = 0;
        foreach (var item in incoming)
        {
            var id = LibraryValidation.Id(item);
            if (!index.TryGetValue(id, out var i)) { index[id] = target.Count; target.Add((JsonObject)item.DeepClone()); added++; }
            else if (LibraryValidation.Modified(item) > LibraryValidation.Modified(target[i])) { target[i] = (JsonObject)item.DeepClone(); updated++; }
        }
        return (added, updated);
    }
}
