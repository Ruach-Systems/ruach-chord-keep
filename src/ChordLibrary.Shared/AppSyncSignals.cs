namespace ChordLibrary.Shared;

/// <summary>Native connectivity and foreground events, independent of the mounted WebView.</summary>
public sealed class AppSyncSignals
{
    private int connected = 1;
    public bool IsConnected => Volatile.Read(ref connected) == 1;
    public event Action? RefreshRequested;
    public event Action? ConnectionChanged;

    public void SetConnected(bool value)
    {
        if (Interlocked.Exchange(ref connected, value ? 1 : 0) == (value ? 1 : 0)) return;
        ConnectionChanged?.Invoke();
        if (value) RefreshRequested?.Invoke();
    }

    public void Resume() => RefreshRequested?.Invoke();
}
