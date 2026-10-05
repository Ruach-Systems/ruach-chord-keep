using ChordLibrary.Shared;

namespace ChordLibrary.Shared.Tests;

public sealed class AppBackNavigationTests
{
    [Fact]
    public async Task LoadingOrDisposedUiDoesNotAllowNativeExit()
    {
        var navigation = new AppBackNavigation();
        Assert.True(await navigation.RequestAsync());
        var registration = navigation.Register(() => Task.FromResult(false));
        Assert.False(await navigation.RequestAsync());
        registration.Dispose();
        Assert.True(await navigation.RequestAsync());
    }

    [Fact]
    public async Task RapidBackPressDoesNotNavigateTwice()
    {
        var navigation = new AppBackNavigation();
        var completion = new TaskCompletionSource<bool>();
        var calls = 0;
        using var registration = navigation.Register(() => { calls++; return completion.Task; });
        var first = navigation.RequestAsync();
        Assert.True(await navigation.RequestAsync());
        completion.SetResult(false);
        Assert.False(await first);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task DisposingOldComponentKeepsReplacementHandler()
    {
        var navigation = new AppBackNavigation();
        var old = navigation.Register(() => Task.FromResult(true));
        using var current = navigation.Register(() => Task.FromResult(false));
        old.Dispose();
        Assert.False(await navigation.RequestAsync());
    }

    [Fact]
    public async Task FailedDispatchDoesNotBlockLaterBackPresses()
    {
        var navigation = new AppBackNavigation();
        var calls = 0;
        using var registration = navigation.Register(() => ++calls == 1
            ? Task.FromException<bool>(new InvalidOperationException("UI unavailable")) : Task.FromResult(true));
        await Assert.ThrowsAsync<InvalidOperationException>(navigation.RequestAsync);
        Assert.True(await navigation.RequestAsync());
        Assert.Equal(2, calls);
    }
}
