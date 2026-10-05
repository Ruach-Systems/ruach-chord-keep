namespace ChordLibrary.Shared;

/// <summary>Connects a native Back action to the currently mounted library UI.</summary>
public sealed class AppBackNavigation
{
    private Func<Task<bool>>? handler;
    private int pending;

    public IDisposable Register(Func<Task<bool>> callback)
    {
        Interlocked.Exchange(ref handler, callback);
        return new Registration(this, callback);
    }

    public async Task<bool> RequestAsync()
    {
        // One press must finish before another can navigate or background the app.
        if (Interlocked.Exchange(ref pending, 1) != 0) return true;
        try
        {
            var callback = Volatile.Read(ref handler);
            return callback is null || await callback();
        }
        finally { Volatile.Write(ref pending, 0); }
    }

    private sealed class Registration(AppBackNavigation owner, Func<Task<bool>> callback) : IDisposable
    {
        public void Dispose()
        {
            Interlocked.CompareExchange(ref owner.handler, null, callback);
        }
    }
}
