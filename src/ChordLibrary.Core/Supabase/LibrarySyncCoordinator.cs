namespace ChordLibrary.Core.Supabase;

public sealed record LibrarySyncConflict(PendingLibraryChange Local, RemoteDocument Remote);
public sealed record LibrarySyncResult(int Pulled, int Uploaded, IReadOnlyList<LibrarySyncConflict> Conflicts, int Remaining = 0);

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
            var initial = await store.ReadSyncStateAsync(profileId, cancellationToken).ConfigureAwait(false);
            foreach (var collection in CollectionsInDependencyOrder)
            {
                await foreach (var document in remote.PullAsync(collection, initial.DownloadCursors.GetValueOrDefault(collection),
                    cancellationToken: cancellationToken, expectedOwner: owner).ConfigureAwait(false))
                {
                    EnsureAccount(owner);
                    await store.MergeSyncRemoteAsync(profileId, document.Collection, document.Id, document.Payload,
                        document.Deleted, document.Revision, checkpoint: true, ct: cancellationToken).ConfigureAwait(false);
                    pulled++;
                }
            }

            var uploaded = 0;
            foreach (var collection in CollectionsInDependencyOrder)
            {
                // Song downloads or upload conflicts can repair setlist memberships. Read their queue
                // after songs finish, and always upload referenced songs before their setlists.
                var state = await store.ReadSyncStateAsync(profileId, cancellationToken).ConfigureAwait(false);
                foreach (var change in state.PendingChanges.Where(change => change.Collection == collection))
                {
                    PendingLibraryChange? pending = change;
                    var key = collection + ":" + change.Id;
                    if (pending.ExpectedRevision is not null && (!state.RemoteModified.TryGetValue(key, out var knownTime)
                        || LibraryValidation.Modified(pending.Payload) <= knownTime))
                    {
                        // An older/equal local timestamp can conflict even when the revision matches.
                        // Retrieve only this dirty record to restore/rebase against the saved cloud copy.
                        var current = await remote.GetAsync(collection, pending.Id, cancellationToken, expectedOwner: owner).ConfigureAwait(false);
                        EnsureAccount(owner);
                        if (current is not null)
                            pending = await store.MergeSyncRemoteAsync(profileId, current.Collection, current.Id, current.Payload,
                                current.Deleted, current.Revision, ct: cancellationToken).ConfigureAwait(false);
                    }
                    // Concurrent writers may race again. Bound this pass; the durable pending queue
                    // retries on the next sync without prompting or reporting it as fully synced.
                    for (var attempt = 0; pending is not null && attempt < 5; attempt++)
                    {
                        EnsureAccount(owner);
                        var result = await remote.ApplyAsync(pending.Collection, pending.Id, pending.Payload, pending.Deleted,
                            pending.ExpectedRevision, cancellationToken, expectedOwner: owner).ConfigureAwait(false);
                        EnsureAccount(owner);
                        if (result.Applied)
                        {
                            await store.AcknowledgeAsync(profileId, pending.Collection, pending.Id, pending.LocalVersion,
                                result.Document.Revision, cancellationToken, modifiedAt: LibraryValidation.Modified(pending.Payload)).ConfigureAwait(false);
                            uploaded++;
                            break;
                        }
                        pending = await store.MergeSyncRemoteAsync(profileId, result.Document.Collection, result.Document.Id,
                            result.Document.Payload, result.Document.Deleted, result.Document.Revision, ct: cancellationToken).ConfigureAwait(false);
                    }
                }
            }
            var remaining = await store.ReadSyncStateAsync(profileId, cancellationToken).ConfigureAwait(false);
            return new LibrarySyncResult(pulled, uploaded, [], remaining.PendingChanges.Count);
        }
        finally { _gate.Release(); }
    }

    private void EnsureAccount(string owner)
    {
        if (!string.Equals(auth.User?.Id, owner, StringComparison.Ordinal))
            throw new InvalidOperationException("The account changed during sync. Your local changes remain saved.");
    }
}
