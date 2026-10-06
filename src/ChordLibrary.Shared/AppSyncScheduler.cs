namespace ChordLibrary.Shared;

/// <summary>Coalesces event requests, retaining one follow-up batch for edits made during a sync.</summary>
public sealed class AppSyncScheduler(Func<Task> sync) : IAsyncDisposable
{
    private readonly object gate = new();
    private TaskCompletionSource? pending;
    private Task? worker;
    private bool disposed;

    public Task RequestAsync()
    {
        lock (gate)
        {
            if (disposed) return Task.CompletedTask;
            pending ??= new(TaskCreationOptions.RunContinuationsAsynchronously);
            var completion = pending.Task;
            worker ??= Task.Run(DrainAsync);
            return completion;
        }
    }

    private async Task DrainAsync()
    {
        while (true)
        {
            TaskCompletionSource batch;
            lock (gate)
            {
                if (pending is null) { worker = null; return; }
                batch = pending; pending = null;
            }
            try { await sync(); batch.TrySetResult(); }
            catch (OperationCanceledException) { batch.TrySetCanceled(); }
            catch (Exception error) { batch.TrySetException(error); }
        }
    }

    public async ValueTask DisposeAsync()
    {
        Task? active;
        lock (gate)
        {
            disposed = true;
            pending?.TrySetCanceled(); pending = null;
            active = worker;
        }
        if (active is not null) await active;
    }
}
