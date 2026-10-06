using ChordLibrary.Shared;

namespace ChordLibrary.Shared.Tests;

public sealed class AppSyncSchedulerTests
{
    [Fact]
    public async Task RequestsDuringSyncCoalesceButRetainOneFollowUpForNewEdits()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0; var active = 0; var maximum = 0;
        await using var scheduler = new AppSyncScheduler(async () => {
            maximum = Math.Max(maximum, ++active);
            if (++calls == 1) { started.SetResult(); await release.Task; }
            active--;
        });
        var first = scheduler.RequestAsync();
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var following = Enumerable.Range(0, 20).Select(_ => scheduler.RequestAsync()).ToArray();
        Assert.All(following, task => Assert.Same(following[0], task));
        release.SetResult();
        await Task.WhenAll(following.Prepend(first)).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, calls); Assert.Equal(1, maximum);
    }

    [Fact]
    public async Task FailedRequestDoesNotPreventTheNextRefresh()
    {
        var calls = 0;
        await using var scheduler = new AppSyncScheduler(() => ++calls == 1
            ? Task.FromException(new IOException("Cloud unavailable")) : Task.CompletedTask);
        await Assert.ThrowsAsync<IOException>(() => scheduler.RequestAsync());
        await scheduler.RequestAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task DisposingCancelsQueuedRequestsAndWaitsForTheActiveBatch()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var scheduler = new AppSyncScheduler(async () => { calls++; started.SetResult(); await release.Task; });
        var first = scheduler.RequestAsync(); await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var queued = scheduler.RequestAsync();
        var disposal = scheduler.DisposeAsync().AsTask();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queued);
        Assert.False(disposal.IsCompleted);
        release.SetResult(); await first; await disposal;
        await scheduler.RequestAsync(); Assert.Equal(1, calls);
    }

    [Fact]
    public void OnlyRestoringConnectivityAndForegroundEventsRequestRefresh()
    {
        var signals = new AppSyncSignals(); var refreshes = 0; var changes = 0;
        signals.RefreshRequested += () => refreshes++;
        signals.ConnectionChanged += () => changes++;
        signals.SetConnected(true); Assert.Equal(0, refreshes);
        signals.SetConnected(false); signals.SetConnected(false);
        Assert.False(signals.IsConnected); Assert.Equal(0, refreshes); Assert.Equal(1, changes);
        signals.SetConnected(true); signals.SetConnected(true);
        Assert.True(signals.IsConnected); Assert.Equal(1, refreshes); Assert.Equal(2, changes);
        signals.Resume(); Assert.Equal(2, refreshes);
    }
}
