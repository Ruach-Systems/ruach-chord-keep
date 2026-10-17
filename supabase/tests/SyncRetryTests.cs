using System.Net;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Supabase.Tests;

public sealed class SyncRetryTests
{
    [Theory]
    [InlineData(408)]
    [InlineData(429)]
    [InlineData(500)]
    [InlineData(502)]
    [InlineData(503)]
    [InlineData(504)]
    public async Task TemporaryErrorsHaveBoundedBackoff(int status)
    {
        var delays = new List<TimeSpan>(); var calls = 0;
        var retry = new SyncRequestRetry((delay, _) => { delays.Add(delay); return Task.CompletedTask; });
        await Assert.ThrowsAsync<SupabaseException>(() => retry.ExecuteAsync<int>(() =>
        { calls++; throw new SupabaseException("Temporary", (HttpStatusCode)status); }));
        Assert.Equal(3, calls);
        Assert.Equal(new[] { TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(3) }, delays);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(409)]
    public async Task PermanentErrorsAreNotRetried(int status)
    {
        var calls = 0;
        await Assert.ThrowsAsync<SupabaseException>(() => new SyncRequestRetry().ExecuteAsync<int>(() =>
        { calls++; throw new SupabaseException("Rejected", (HttpStatusCode)status); }));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task NetworkErrorAndTimeoutRecoverWithoutFurtherRequestsAfterSuccess()
    {
        var calls = 0;
        var retry = new SyncRequestRetry((_, _) => Task.CompletedTask);
        Assert.Equal(42, await retry.ExecuteAsync(() => ++calls switch
        {
            1 => Task.FromException<int>(new HttpRequestException("Offline")),
            2 => Task.FromException<int>(new TaskCanceledException("Timeout")),
            _ => Task.FromResult(42)
        }));
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task CancellationDuringBackoffStopsFurtherRequests()
    {
        using var cancellation = new CancellationTokenSource(); var calls = 0;
        var retry = new SyncRequestRetry((_, token) => { cancellation.Cancel(); return Task.FromCanceled(token); });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => retry.ExecuteAsync<int>(() =>
        { calls++; throw new HttpRequestException(); }, cancellation.Token));
        Assert.Equal(1, calls);
    }

    [Theory]
    [InlineData(10, 3)]
    [InlineData(60, 1)]
    public async Task RetryAfterIsHonoredWithoutUnboundedWait(int seconds, int expectedCalls)
    {
        var calls = 0; var delays = new List<TimeSpan>();
        var retry = new SyncRequestRetry((delay, _) => { delays.Add(delay); return Task.CompletedTask; });
        await Assert.ThrowsAsync<SupabaseException>(() => retry.ExecuteAsync<int>(() =>
        { calls++; throw new SupabaseException("Limited", HttpStatusCode.TooManyRequests) { RetryAfter = TimeSpan.FromSeconds(seconds) }; }));
        Assert.Equal(expectedCalls, calls);
        Assert.All(delays, delay => Assert.Equal(TimeSpan.FromSeconds(seconds), delay));
    }
}
