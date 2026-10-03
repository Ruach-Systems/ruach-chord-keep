using System.Text.Json;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core;

public static class LibraryStorageKeys
{
    public const string Songs = "chord-library-songs";
    public const string Setlists = "chord-library-setlists";
    public const string LegacyPlaylists = "chord-library-playlists";
}

/// <summary>Original JSON records, including fields a newer source app may introduce.</summary>
public sealed class LibraryDocument
{
    public List<JsonObject> Songs { get; set; } = [];
    public List<JsonObject> Setlists { get; set; } = [];

    public LibraryDocument Clone() => new()
    {
        Songs = Songs.Select(x => (JsonObject)x.DeepClone()).ToList(),
        Setlists = Setlists.Select(x => (JsonObject)x.DeepClone()).ToList()
    };

    public static LibraryDocument FromSnapshot(IReadOnlyDictionary<string, string> snapshot)
    {
        var songs = snapshot.GetValueOrDefault(LibraryStorageKeys.Songs, "[]");
        var setlists = snapshot.GetValueOrDefault(LibraryStorageKeys.Setlists,
            snapshot.GetValueOrDefault(LibraryStorageKeys.LegacyPlaylists, "[]"));
        return LibraryValidation.Validate(new LibraryDocument
        {
            Songs = LibraryValidation.ParseRecords(songs, "songs"),
            Setlists = LibraryValidation.ParseRecords(setlists, "setlists")
        });
    }

    public void WriteTo(IDictionary<string, string> snapshot)
    {
        snapshot[LibraryStorageKeys.Songs] = JsonSerializer.Serialize(Songs);
        snapshot[LibraryStorageKeys.Setlists] = JsonSerializer.Serialize(Setlists);
        snapshot.Remove(LibraryStorageKeys.LegacyPlaylists);
    }
}

public sealed class LibraryValidationException(string message) : Exception(message);

public static class LibraryValidation
{
    public const int MaximumImportBytes = 25 * 1024 * 1024;
    public const int MaximumRecordsPerCollection = 10_000;
    public const int MaximumContentLength = 1_000_000;
    public const long MinimumTimestampMilliseconds = -62_135_596_800_000;
    public const long MaximumTimestampMilliseconds = 253_402_300_799_999;
    public static readonly JsonDocumentOptions JsonOptions = new() { MaxDepth = 64 };

    public static LibraryDocument Validate(LibraryDocument document)
    {
        if (document.Songs.Count > MaximumRecordsPerCollection || document.Setlists.Count > MaximumRecordsPerCollection)
            throw new LibraryValidationException("A library can contain up to 10,000 songs and 10,000 setlists.");
        return new LibraryDocument
        {
            Songs = document.Songs.Select(x => ValidateRecord(x, "songs")).ToList(),
            Setlists = document.Setlists.Select(x => ValidateRecord(x, "setlists")).ToList()
        };
    }

    public static JsonObject ValidateRecord(JsonObject raw, string collection)
    {
        if (collection is not ("songs" or "setlists"))
            throw new LibraryValidationException("Unknown library collection.");
        var record = (JsonObject)raw.DeepClone();
        RequireString(record, "id", 1024, true);
        var deleted = ReadBoolean(record, "deleted", false);
        if (collection == "songs")
        {
            RequireString(record, "title", 2000, !deleted);
            RequireString(record, "content", MaximumContentLength, !deleted);
            RequireString(record, "artist", 2000, false);
            var steps = ReadInteger(record, "transposeSteps", 0);
            if (steps is < -11 or > 11) throw new LibraryValidationException("Song transposition must be between -11 and 11.");
            record["transposeSteps"] = steps;
            record["twoColumn"] = ReadBoolean(record, "twoColumn", false);
        }
        else
        {
            RequireString(record, "name", 2000, !deleted);
            RequireString(record, "description", 100_000, false);
            if (!record.ContainsKey("songIds")) record["songIds"] = new JsonArray();
            if (record["songIds"] is not JsonArray ids || ids.Count > MaximumRecordsPerCollection)
                throw new LibraryValidationException("Setlist songIds must be an array with no more than 10,000 entries.");
            foreach (var id in ids)
                if (id is not JsonValue v || !v.TryGetValue<string>(out var text) || string.IsNullOrWhiteSpace(text) || text.Length > 1024)
                    throw new LibraryValidationException("Every setlist song reference must be a nonempty string ID.");
        }
        record["createdAt"] = ReadTimestamp(record, "createdAt", 0);
        record["updatedAt"] = ReadTimestamp(record, "updatedAt", ReadInteger(record, "createdAt", 0));
        return record;
    }

    private static long ReadTimestamp(JsonObject record, string name, long fallback)
    {
        var milliseconds = ReadInteger(record, name, fallback);
        if (milliseconds is < MinimumTimestampMilliseconds or > MaximumTimestampMilliseconds)
            throw new LibraryValidationException($"{name} must be a Unix-millisecond timestamp within years 0001 through 9999.");
        return milliseconds;
    }

    public static string Id(JsonObject record) => record["id"]!.GetValue<string>();
    public static long Modified(JsonObject record) => ReadInteger(record, "updatedAt", ReadInteger(record, "createdAt", 0));
    public static bool IsDeleted(JsonObject record) => ReadBoolean(record, "deleted", false);

    internal static List<JsonObject> ParseRecords(string json, string collection)
    {
        if (System.Text.Encoding.UTF8.GetByteCount(json) > MaximumImportBytes)
            throw new LibraryValidationException("Library data exceeds the 25 MB limit.");
        try
        {
            if (JsonNode.Parse(json, documentOptions: JsonOptions) is not JsonArray array)
                throw new LibraryValidationException($"{collection} must be an array.");
            return ReadArray(array, collection);
        }
        catch (JsonException ex) { throw new LibraryValidationException($"Invalid {collection} JSON: {ex.Message}"); }
    }

    internal static List<JsonObject> ReadArray(JsonArray array, string collection)
    {
        if (array.Count > MaximumRecordsPerCollection)
            throw new LibraryValidationException($"The {collection} collection exceeds 10,000 records.");
        return array.Select((node, index) => node is JsonObject obj
            ? ValidateRecord(obj, collection)
            : throw new LibraryValidationException($"{collection} record {index + 1} must be an object.")).ToList();
    }

    private static void RequireString(JsonObject record, string name, int limit, bool required)
    {
        if (!record.ContainsKey(name) || record[name] is null)
        {
            if (required) throw new LibraryValidationException($"Record is missing {name}.");
            record[name] = "";
        }
        if (record[name] is not JsonValue value || !value.TryGetValue<string>(out var text))
            throw new LibraryValidationException($"{name} must be text.");
        if ((required && string.IsNullOrWhiteSpace(text)) || text.Length > limit)
            throw new LibraryValidationException($"{name} must be {(required ? "nonempty text" : "text")} of at most {limit:N0} characters.");
    }

    private static bool ReadBoolean(JsonObject record, string name, bool fallback)
    {
        if (!record.ContainsKey(name)) return fallback;
        if (record[name] is JsonValue value && value.TryGetValue<bool>(out var result)) return result;
        throw new LibraryValidationException($"{name} must be true or false.");
    }

    internal static long ReadInteger(JsonObject record, string name, long fallback)
    {
        if (!record.ContainsKey(name)) return fallback;
        if (record[name] is JsonValue value)
        {
            if (value.TryGetValue<long>(out var number) && number is >= -9_007_199_254_740_991 and <= 9_007_199_254_740_991)
                return number;
            if (value.TryGetValue<double>(out var real) && double.IsFinite(real) && real == Math.Truncate(real)
                && real is >= -9_007_199_254_740_991 and <= 9_007_199_254_740_991) return (long)real;
            // JsonValue created by C# retains its exact CLR numeric type (int, short, decimal, ...).
            // Read those through JSON's numeric representation without accepting numeric strings.
            if (value.GetValueKind() == JsonValueKind.Number)
            {
                var numeric = JsonSerializer.SerializeToElement(value);
                if (numeric.TryGetInt64(out number) && number is >= -9_007_199_254_740_991 and <= 9_007_199_254_740_991)
                    return number;
                if (numeric.TryGetDouble(out real) && double.IsFinite(real) && real == Math.Truncate(real)
                    && real is >= -9_007_199_254_740_991 and <= 9_007_199_254_740_991) return (long)real;
            }
        }
        throw new LibraryValidationException($"{name} must be an integer (timestamps use Unix milliseconds).");
    }
}
