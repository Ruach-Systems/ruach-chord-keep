using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core.Supabase;

public sealed record RemoteDocument(string Collection, string Id, JsonObject Payload, bool Deleted, long Revision, DateTimeOffset ServerUpdatedAt);
public sealed record ApplyResult(bool Applied, RemoteDocument Document);

public sealed class SupabaseDataClient(SupabaseOptions options, HttpClient http, SupabaseAuthClient auth)
{
    public async IAsyncEnumerable<RemoteDocument> PullAsync(string collection, long afterRevision = 0,
        [EnumeratorCancellation] CancellationToken cancellationToken = default, string? expectedOwner = null)
    {
        ValidateCollection(collection);
        if (afterRevision < 0) throw new ArgumentOutOfRangeException(nameof(afterRevision));
        var session = await auth.GetSessionAsync(cancellationToken).ConfigureAwait(false);
        EnsureExpectedOwner(session, expectedOwner);
        var owner = session.User.Id;
        var cursor = afterRevision;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureAccount(owner);
            session = await auth.GetSessionAsync(cancellationToken).ConfigureAwait(false);
            EnsureAccount(owner);
            if (session.User.Id != owner) throw new InvalidOperationException("The account changed during sync.");
            var path = "rest/v1/library_documents?select=collection,id,payload,deleted,revision,server_updated_at&owner_id=eq."
                + Uri.EscapeDataString(owner) + "&collection=eq." + collection + "&revision=gt."
                + cursor.ToString(CultureInfo.InvariantCulture) + "&order=revision.asc&limit=500";
            var data = await SupabaseHttp.SendAsync(http, options, HttpMethod.Get, path, null, session.AccessToken, cancellationToken).ConfigureAwait(false);
            EnsureAccount(owner);
            var rows = data as JsonArray ?? throw new InvalidOperationException("Supabase returned an invalid library response.");
            if (rows.Count == 0) yield break;
            foreach (var row in rows)
            {
                var document = ParseDocument(row);
                if (document.Collection != collection) throw new InvalidOperationException("Supabase returned an unexpected library collection.");
                if (document.Revision <= cursor) throw new InvalidOperationException("Supabase returned an invalid sync revision order.");
                cursor = document.Revision;
                yield return document;
            }
            // Continue to an empty page even when the server's configured row cap is below 500.
        }
    }

    public async Task<RemoteDocument?> GetAsync(string collection, string id, CancellationToken cancellationToken = default,
        string? expectedOwner = null)
    {
        ValidateCollection(collection);
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        var session = await auth.GetSessionAsync(cancellationToken).ConfigureAwait(false);
        EnsureExpectedOwner(session, expectedOwner);
        var owner = session.User.Id;
        var path = "rest/v1/library_documents?select=collection,id,payload,deleted,revision,server_updated_at&owner_id=eq."
            + Uri.EscapeDataString(owner) + "&collection=eq." + collection + "&id=eq." + Uri.EscapeDataString(id) + "&limit=1";
        var response = await SupabaseHttp.SendAsync(http, options, HttpMethod.Get, path, null, session.AccessToken, cancellationToken).ConfigureAwait(false);
        EnsureAccount(owner);
        var rows = response as JsonArray ?? throw new InvalidOperationException("Supabase returned an invalid library response.");
        if (rows.Count == 0) return null;
        var document = ParseDocument(rows[0]);
        if (rows.Count != 1 || document.Collection != collection || document.Id != id)
            throw new InvalidOperationException("Supabase returned an unexpected library record.");
        return document;
    }

    public async Task<ApplyResult> ApplyAsync(string collection, string id, JsonObject payload, bool deleted,
        long? expectedRevision, CancellationToken cancellationToken = default, string? expectedOwner = null)
    {
        ValidateCollection(collection);
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(payload);
        if (expectedRevision < 1) throw new ArgumentOutOfRangeException(nameof(expectedRevision));
        if (payload["id"]?.GetValue<string>() != id) throw new ArgumentException("The payload ID must match the document ID.");
        var session = await auth.GetSessionAsync(cancellationToken).ConfigureAwait(false);
        EnsureExpectedOwner(session, expectedOwner);
        var owner = session.User.Id;
        EnsureAccount(owner);
        var body = new JsonObject
        {
            ["p_collection"] = collection, ["p_id"] = id, ["p_payload"] = payload.DeepClone(),
            ["p_deleted"] = deleted, ["p_expected_revision"] = expectedRevision
        };
        var data = await SupabaseHttp.SendAsync(http, options, HttpMethod.Post, "rest/v1/rpc/apply_library_document",
            body, session.AccessToken, cancellationToken).ConfigureAwait(false);
        EnsureAccount(owner);
        var result = data as JsonObject ?? throw new InvalidOperationException("Supabase returned an invalid save response.");
        var document = ParseDocument(result["document"]);
        if (document.Collection != collection || document.Id != id)
            throw new InvalidOperationException("Supabase returned an unexpected library record.");
        return new ApplyResult(result["applied"]!.GetValue<bool>(), document);
    }

    private void EnsureAccount(string owner)
    {
        if (!string.Equals(auth.User?.Id, owner, StringComparison.Ordinal))
            throw new InvalidOperationException("The account changed during sync. Retry from the current account.");
    }

    private static void EnsureExpectedOwner(AuthSession session, string? expectedOwner)
    {
        if (expectedOwner is not null && !string.Equals(session.User.Id, expectedOwner, StringComparison.Ordinal))
            throw new InvalidOperationException("The account changed before the sync request. No library data was sent.");
    }

    private static RemoteDocument ParseDocument(JsonNode? data) => new(
        data?["collection"]?.GetValue<string>() ?? throw new InvalidOperationException("Missing collection."),
        data["id"]!.GetValue<string>(), data["payload"]?.DeepClone() as JsonObject ?? throw new InvalidOperationException("Missing payload."),
        data["deleted"]!.GetValue<bool>(), data["revision"]!.GetValue<long>(),
        DateTimeOffset.Parse(data["server_updated_at"]!.GetValue<string>(), CultureInfo.InvariantCulture));

    private static void ValidateCollection(string collection)
    {
        if (collection is not ("songs" or "setlists")) throw new ArgumentException("Collection must be songs or setlists.");
    }
}
