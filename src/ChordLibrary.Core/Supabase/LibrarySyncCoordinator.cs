namespace ChordLibrary.Core.Supabase;

public sealed record LibrarySyncConflict(PendingLibraryChange Local, RemoteDocument Remote);
public sealed record LibrarySyncResult(int Pulled, int Uploaded, IReadOnlyList<LibrarySyncConflict> Conflicts);

/// <summary>Explicit account-scoped synchronization. Network errors never clear pending edits or tombstones.</summary>
public sealed class LibrarySyncCoordinator(LocalLibraryStore store, SupabaseDataClient remote, SupabaseAuthClient auth)
{
    // Setlist memberships reference song rows. Keep both download and upload passes in this order,
    // including when a setlist entered the local pending queue before its referenced song.
    private static readonly string[] CollectionsInDependencyOrder = ["songs", "setlists"];
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<LibrarySyncResult> SyncAsync(string profileId, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var session = await auth.GetSessionAsync(cancellationToken).ConfigureAwait(false);
            var owner = session.User.Id;
            if (!string.Equals(profileId, "user:" + owner, StringComparison.Ordinal))
                throw new InvalidOperationException("Only the signed-in account's local library can sync. Import guest data explicitly first.");
            var pulled = 0;
            foreach (var collection in CollectionsInDependencyOrder)
            {
                // Full keyset-paginated pulls are intentional: no unpersisted cursor can skip a failed local apply.
                await foreach (var document in remote.PullAsync(collection, cancellationToken: cancellationToken, expectedOwner: owner).ConfigureAwait(false))
                {
                    EnsureAccount(owner);
                    await store.AcceptRemoteAsync(profileId, document.Collection, document.Id, document.Payload,
                        document.Deleted, document.Revision, cancellationToken).ConfigureAwait(false);
                    pulled++;
                }
            }

            // Read after pulling, since downloaded deletions can create pending setlist reference repairs.
            var state = await store.ReadSyncStateAsync(profileId, cancellationToken).ConfigureAwait(false);
            var uploaded = 0;
            var conflicts = new List<LibrarySyncConflict>();
            foreach (var collection in CollectionsInDependencyOrder)
            foreach (var pending in state.PendingChanges.Where(change => change.Collection == collection))
            {
                EnsureAccount(owner);
                var result = await remote.ApplyAsync(pending.Collection, pending.Id, pending.Payload, pending.Deleted,
                    pending.ExpectedRevision, cancellationToken, expectedOwner: owner).ConfigureAwait(false);
                EnsureAccount(owner);
                if (result.Applied)
                {
                    await store.AcknowledgeAsync(profileId, pending.Collection, pending.Id, pending.LocalVersion,
                        result.Document.Revision, cancellationToken).ConfigureAwait(false);
                    uploaded++;
                }
                else conflicts.Add(new LibrarySyncConflict(pending, result.Document));
            }
            return new LibrarySyncResult(pulled, uploaded, conflicts);
        }
        finally { _gate.Release(); }
    }

    private void EnsureAccount(string owner)
    {
        if (!string.Equals(auth.User?.Id, owner, StringComparison.Ordinal))
            throw new InvalidOperationException("The account changed during sync. Your local changes remain saved.");
    }
}
