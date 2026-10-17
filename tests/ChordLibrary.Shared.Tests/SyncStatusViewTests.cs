using ChordLibrary.Shared;

namespace ChordLibrary.Shared.Tests;

public class SyncStatusViewTests
{
    [Theory]
    [InlineData(false, false, true, false, false, 4, false, "offline", "Saved on this device")]
    [InlineData(true, false, true, false, false, 2, true, "error", "Sign in again")]
    [InlineData(true, true, false, true, false, 2, true, "offline", "Offline")]
    [InlineData(true, true, true, true, false, 2, true, "syncing", "Syncing…")]
    [InlineData(true, true, true, false, true, 2, true, "error", "Needs attention")]
    [InlineData(true, true, true, false, true, 0, true, "error", "Needs attention")]
    [InlineData(true, true, true, false, false, 2, true, "pending", "Saved on this device · 2 pending")]
    [InlineData(true, true, true, false, false, 0, false, "pending", "Not checked yet")]
    [InlineData(true, true, true, false, false, 0, true, "idle", "Up to date at last check")]
    public void StatusNeverClaimsUnobservedCloudFreshness(bool account, bool signedIn, bool online, bool active, bool failed, int pending, bool checkedBefore, string kind, string title)
    {
        var view = SyncStatusView.Create(account, signedIn, online, active, failed, pending, checkedBefore ? DateTimeOffset.UtcNow : null);
        Assert.Equal(kind, view.Kind); Assert.Equal(title, view.Title);
    }
}
