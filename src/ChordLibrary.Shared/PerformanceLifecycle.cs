namespace ChordLibrary.Shared;

// Native window lifecycle is also delivered to the reader; WebView visibility alone
// is not a reliable signal on every Android version.
public sealed class PerformanceLifecycle
{
    public event Action? Suspended;
    public void Suspend() => Suspended?.Invoke();
}
