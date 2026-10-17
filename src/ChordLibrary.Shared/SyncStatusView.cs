namespace ChordLibrary.Shared;

/// <summary>A presentation of observed state, never a claim of continuous cloud freshness.</summary>
public sealed record SyncStatusView(string Kind, string Title, string Detail)
{
    public static SyncStatusView Create(bool account, bool signedIn, bool connected, bool syncing,
        bool failed, int pending, DateTimeOffset? lastChecked)
    {
        var saved = pending > 0 ? $"Saved on this device · {pending} pending" : "Your library is saved on this device.";
        if (!account) return new("offline", "Saved on this device", "Sign in with Google to sync across devices.");
        if (!signedIn) return new("error", "Sign in again", saved + " Sign in to resume syncing.");
        if (!connected) return new("offline", "Offline", saved + " Sync resumes when you reconnect.");
        if (syncing) return new("syncing", "Syncing…", saved);
        if (failed) return new("error", "Needs attention", saved + " Open Account & sync for details, or refresh to retry.");
        if (pending > 0) return new("pending", saved, "Waiting to sync. Refresh library to retry now.");
        if (lastChecked is null) return new("pending", "Not checked yet", "Refresh library to check for cloud updates.");
        return new("idle", "Up to date at last check", "No pending local changes. Cloud updates are checked on open, resume, reconnect or refresh.");
    }
}
