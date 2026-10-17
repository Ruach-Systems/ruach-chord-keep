using System.Net;

namespace ChordLibrary.Core.Supabase;

/// <summary>Bounded recovery for an active data request, never a background polling timer.</summary>
public sealed class SyncRequestRetry(Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    private readonly Func<TimeSpan, CancellationToken, Task> wait = delay ?? Task.Delay;

    public async Task<T> ExecuteAsync<T>(Func<Task<T>> request, CancellationToken cancellationToken = default)
    {
        for (var attempt = 0; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { return await request().ConfigureAwait(false); }
            catch (Exception error) when (attempt < 2 && !cancellationToken.IsCancellationRequested && IsTransient(error))
            {
                var backoff = TimeSpan.FromSeconds(attempt == 0 ? 1 : 3);
                if (error is SupabaseException { RetryAfter: { } requested })
                {
                    // Do not retry before the server permits it, or keep an active sync waiting indefinitely.
                    if (requested > TimeSpan.FromSeconds(30)) throw;
                    if (requested > backoff) backoff = requested;
                }
                await wait(backoff, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private static bool IsTransient(Exception error) => error switch
    {
        HttpRequestException => true,
        TaskCanceledException => true, // HttpClient timeout; caller cancellation is excluded above.
        SupabaseException e => e.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests
            or HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable
            or HttpStatusCode.GatewayTimeout,
        _ => false
    };
}
