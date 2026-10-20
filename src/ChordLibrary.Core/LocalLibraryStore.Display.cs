namespace ChordLibrary.Core;

public sealed record SongDisplayPatch(int? TransposeSteps = null, int? FontSize = null, bool? TwoColumn = null);

public sealed partial class LocalLibraryStore
{
    // Patch the current database row, never the frozen performance copy.
    public Task<bool> PatchSongDisplayAsync(string profile, string songId, SongDisplayPatch patch, CancellationToken ct = default)
    {
        if (patch.TransposeSteps is < -11 or > 11 || patch.FontSize is < 10 or > 24)
            throw new ArgumentOutOfRangeException(nameof(patch));
        return WithHistoryDatabaseAsync(profile, true, (db, tx) =>
        {
            var state = ReadDatabase(db, tx, ct);
            var before = CloneState(state);
            var document = LibraryDocument.FromSnapshot(state.Snapshot);
            var song = document.Songs.FirstOrDefault(s => LibraryValidation.Id(s) == songId);
            if (song is null) return false;
            var changed = false;
            void Set<T>(string key, T value)
            {
                var node = System.Text.Json.Nodes.JsonValue.Create(value);
                if (System.Text.Json.Nodes.JsonNode.DeepEquals(song[key], node)) return;
                song[key] = node; changed = true;
            }
            if (patch.TransposeSteps is { } transpose) Set("transposeSteps", transpose);
            if (patch.FontSize is { } font) Set("fontSize", font);
            if (patch.TwoColumn is { } columns) Set("twoColumn", columns);
            if (!changed) return true;
            var newest = Math.Max(LibraryValidation.Modified(song), state.RemoteModified.GetValueOrDefault(Key("songs", songId)));
            song["updatedAt"] = Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), checked(newest + 1));
            QueueChange(state, "songs", songId, song, false);
            document.WriteTo(state.Snapshot);
            ValidateState(state);
            WriteChanges(db, tx, before, state, ct);
            return true;
        }, ct);
    }
}
