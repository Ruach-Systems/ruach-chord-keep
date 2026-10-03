using System.Text.Json.Nodes;
using ChordLibrary.Core;

namespace ChordLibrary.Tests;

public class LibraryImportTests
{
    private readonly LibraryImportService _imports = new();

    [Theory]
    [InlineData("original-backup-v1.json")]
    [InlineData("original-backup-v2.json")]
    public void DocumentedOriginalBackupFixturesImportWithoutLoss(string filename)
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", filename));
        var result = _imports.Preview(json, new());
        Assert.Equal(2, result.SongsAdded);
        Assert.Equal(1, result.SetlistsAdded);
        Assert.Empty(result.Warnings);
        Assert.Equal("a7847086-8685-4bb2-83cb-af6fc8c5a5a3", result.Document.Setlists[0]["songIds"]![0]!.GetValue<string>());
        Assert.Contains("Example lyric line", result.Document.Songs[0]["content"]!.GetValue<string>());
        Assert.True(result.Document.Songs[0]["twoColumn"]!.GetValue<bool>());
    }

    [Fact]
    public void OriginalBackupRetainsLegacyIdsOrderTextAndUnknownFields()
    {
        var json = """
            {"version":1,"songs":[
              {"id":"id-1470332-abc","title":"First","artist":"Artist","content":"C  G\n  lyrics  ","transposeSteps":2,"twoColumn":true,"createdAt":15,"updatedAt":20,"future":{"a":[1,true]}},
              {"id":"second","title":"Second","content":"D/F#","createdAt":12,"updatedAt":18}
            ],"playlists":[{"id":"list-1","name":"Live","description":"Details","songIds":["second","id-1470332-abc"],"createdAt":20,"updatedAt":30}]}
            """;
        var result = _imports.Preview(json, new());
        Assert.Equal(2, result.SongsAdded);
        Assert.Equal(1, result.SetlistsAdded);
        var song = result.Document.Songs[0];
        Assert.Equal("id-1470332-abc", song["id"]!.GetValue<string>());
        Assert.Equal("C  G\n  lyrics  ", song["content"]!.GetValue<string>());
        Assert.True(song["future"]!["a"]![1]!.GetValue<bool>());
        Assert.Equal("second", result.Document.Setlists[0]["songIds"]![0]!.GetValue<string>());
        Assert.True(JsonNode.DeepEquals(song, _imports.Preview(_imports.Export(result.Document), new()).Document.Songs[0]));
    }

    [Fact]
    public void NewerDuplicateWinsAndEqualTimestampKeepsFirst()
    {
        var result = _imports.Preview("""
            {"songs":[
            {"id":"x","title":"Old","content":"C","updatedAt":2},
            {"id":"x","title":"Newest","content":"D","updatedAt":9},
            {"id":"x","title":"Tie","content":"E","updatedAt":9}]}
            """, new());
        Assert.Single(result.Document.Songs);
        Assert.Equal("Newest", result.Document.Songs[0]["title"]!.GetValue<string>());
        var second = _imports.Preview("""{"songs":[{"id":"x","title":"Same time","content":"F","updatedAt":9}]}""", result.Document);
        Assert.Equal(0, second.SongsUpdated);
        Assert.Equal("Newest", second.Document.Songs[0]["title"]!.GetValue<string>());
    }

    [Fact]
    public void CopyImportRemapsReferencesTogether()
    {
        var result = _imports.Preview("""
            {"version":2,"songs":[{"id":"legacy","title":"Song","content":"C"}],
            "setlists":[{"id":"list","name":"Set","songIds":["legacy","missing","legacy"]}]}
            """, new(), regenerateIds: true);
        var newId = result.Document.Songs[0]["id"]!.GetValue<string>();
        Assert.NotEqual("legacy", newId);
        Assert.NotEqual("list", result.Document.Setlists[0]["id"]!.GetValue<string>());
        var references = result.Document.Setlists[0]["songIds"]!.AsArray();
        Assert.Equal(newId, references[0]!.GetValue<string>());
        Assert.Equal("missing", references[1]!.GetValue<string>());
        Assert.Equal(newId, references[2]!.GetValue<string>());
        Assert.Contains(result.Warnings, x => x.Contains("no matching song"));
        Assert.Contains(result.Warnings, x => x.Contains("pending for cloud sync") && x.Contains("Supabase"));
    }

    [Fact]
    public void MissingMembershipsRemainOrderedUntilLaterSongImportResolvesWarning()
    {
        var first = _imports.Preview("""
            {"version":1,"songs":[{"id":"known","title":"Known","content":"C"}],
            "playlists":[{"id":"list","name":"Set","songIds":["known","missing","known","missing"]}]}
            """, new());
        Assert.Contains(first.Warnings, warning => warning.StartsWith("2 setlist") && warning.Contains("remove the unresolved references"));
        Assert.Equal(new[] { "known", "missing", "known", "missing" },
            first.Document.Setlists[0]["songIds"]!.AsArray().Select(x => x!.GetValue<string>()));
        var resolved = _imports.Preview("""
            {"version":2,"songs":[{"id":"missing","title":"Restored song","content":"D"}],"setlists":[]}
            """, first.Document);
        Assert.Empty(resolved.Warnings);
        Assert.Equal(2, resolved.Document.Songs.Count);
        Assert.True(JsonNode.DeepEquals(first.Document.Setlists[0], resolved.Document.Setlists[0]));
    }

    [Theory]
    [InlineData("{\"songs\":[{\"id\":\"a\",\"title\":\"Good\",\"content\":\"C\"},{\"id\":\"b\",\"content\":\"D\"}]}")]
    [InlineData("{\"songs\":[] , \"setlists\":[{\"id\":\"a\",\"name\":\"Set\",\"songIds\":[4]}]}")]
    [InlineData("{\"songs\":[{\"id\":\"a\",\"title\":\"Song\",\"content\":\"C\",\"updatedAt\":\"today\"}]}")]
    [InlineData("{\"songs\":[],\"version\":99}")]
    [InlineData("{\"songs\":[{\"id\":\"a\",\"title\":\"Song\",\"content\":\"C\",\"transposeSteps\":1.5}]}")]
    [InlineData("{\"songs\":[],\"setlists\":{}}")]
    [InlineData("{\"t\":\"cl-song\",\"v\":2,\"n\":\"Song\",\"c\":\"C\"}")]
    public void InvalidWholeImportIsRejected(string json) =>
        Assert.Throws<LibraryValidationException>(() => _imports.Preview(json, new()));

    [Fact]
    public void QrAndSingleSongImportsCreateFreshIdsAndExplainLossyQr()
    {
        var qr = _imports.Preview("""{"t":"cl-song","v":1,"n":"title","a":"Artist","c":"[VERSE]\nC|G"}""", new());
        Assert.True(qr.IsSingleSong);
        Assert.Equal("TITLE", qr.Document.Songs[0]["title"]!.GetValue<string>());
        Assert.Equal("[VERSE]\nC|G", qr.Document.Songs[0]["content"]!.GetValue<string>());
        Assert.Contains(qr.Warnings, x => x.Contains("removes lyrics"));
        var single = _imports.Preview("""{"version":1,"type":"single-song","song":{"id":"old","title":"Song","content":"A","custom":true}}""", new());
        Assert.NotEqual("old", single.Document.Songs[0]["id"]!.GetValue<string>());
        Assert.True(single.Document.Songs[0]["custom"]!.GetValue<bool>());
    }

    [Fact]
    public void ProgrammaticIntegerJsonValuesNormalizeLikeParsedJsonNumbers()
    {
        var song = new JsonObject
        {
            ["id"] = "example", ["title"] = "Example", ["content"] = "C G",
            ["createdAt"] = 1, ["updatedAt"] = (short)2, ["transposeSteps"] = 3m
        };
        var normalized = LibraryValidation.ValidateRecord(song, "songs");
        Assert.Equal(1L, normalized["createdAt"]!.GetValue<long>());
        Assert.Equal(2L, normalized["updatedAt"]!.GetValue<long>());
        Assert.Equal(3L, normalized["transposeSteps"]!.GetValue<long>());
        song["updatedAt"] = 2.5m;
        Assert.Throws<LibraryValidationException>(() => LibraryValidation.ValidateRecord(song, "songs"));
        song["updatedAt"] = "2";
        Assert.Throws<LibraryValidationException>(() => LibraryValidation.ValidateRecord(song, "songs"));
    }

    [Theory]
    [InlineData(-62135596800000L)]
    [InlineData(0L)]
    [InlineData(253402300799999L)]
    public void TimestampBoundariesRoundTripThroughOriginalJsonBackup(long timestamp)
    {
        var backup = new JsonObject
        {
            ["version"] = 2,
            ["songs"] = new JsonArray(new JsonObject
            {
                ["id"] = "song", ["title"] = "Song", ["content"] = "C G",
                ["createdAt"] = timestamp, ["updatedAt"] = timestamp
            }),
            ["setlists"] = new JsonArray(new JsonObject
            {
                ["id"] = "set", ["name"] = "Set", ["songIds"] = new JsonArray("song"),
                ["createdAt"] = timestamp, ["updatedAt"] = timestamp
            })
        };
        var imported = _imports.Preview(backup.ToJsonString(), new());
        var restored = _imports.Preview(_imports.Export(imported.Document), new()).Document;
        Assert.Equal(timestamp, restored.Songs[0]["createdAt"]!.GetValue<long>());
        Assert.Equal(timestamp, restored.Songs[0]["updatedAt"]!.GetValue<long>());
        Assert.Equal(timestamp, restored.Setlists[0]["createdAt"]!.GetValue<long>());
        Assert.Equal(timestamp, restored.Setlists[0]["updatedAt"]!.GetValue<long>());
    }

    [Theory]
    [InlineData("createdAt", -62135596800001L)]
    [InlineData("createdAt", 253402300800000L)]
    [InlineData("updatedAt", -62135596800001L)]
    [InlineData("updatedAt", 253402300800000L)]
    public void TimestampsOutsideTypedDatabaseRangeAreRejectedDuringPreview(string field, long timestamp)
    {
        var song = new JsonObject { ["id"] = "song", ["title"] = "Song", ["content"] = "C G", [field] = timestamp };
        var backup = new JsonObject { ["version"] = 1, ["songs"] = new JsonArray(song), ["playlists"] = new JsonArray() };
        var error = Assert.Throws<LibraryValidationException>(() => _imports.Preview(backup.ToJsonString(), new()));
        Assert.Contains("years 0001 through 9999", error.Message);
    }
}
