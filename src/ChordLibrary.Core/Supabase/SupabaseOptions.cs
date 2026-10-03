using System.Text;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core.Supabase;

/// <summary>Only the public project URL and publishable (or legacy anon) key belong in app configuration.</summary>
public sealed record SupabaseOptions(string ProjectUrl, string PublishableKey)
{
    public Uri Validate()
    {
        if (!Uri.TryCreate(ProjectUrl.TrimEnd('/') + "/", UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttps && !(url.Scheme == Uri.UriSchemeHttp && url.IsLoopback))
            || !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query)
            || !string.IsNullOrEmpty(url.Fragment) || url.AbsolutePath != "/")
            throw new ArgumentException("Supabase needs an HTTPS project URL (HTTP is allowed only for local development).");
        if (string.IsNullOrWhiteSpace(PublishableKey) || PublishableKey.StartsWith("sb_secret_", StringComparison.Ordinal))
            throw new ArgumentException("Use a Supabase publishable key, never a secret or service-role key.");
        var parts = PublishableKey.Split('.');
        if (parts.Length == 3)
        {
            try
            {
                var part = parts[1].Replace('-', '+').Replace('_', '/');
                part = part.PadRight(part.Length + ((4 - part.Length % 4) % 4), '=');
                var payload = JsonNode.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(part)));
                if (payload?["role"]?.GetValue<string>() != "anon")
                    throw new ArgumentException("A legacy Supabase key must have the anon role; never embed privileged keys.");
            }
            catch (Exception ex) when (ex is FormatException or System.Text.Json.JsonException)
            {
                throw new ArgumentException("The legacy Supabase anonymous key is malformed.", ex);
            }
        }
        return url;
    }
}

/// <summary>Native hosts implement this with MAUI SecureStorage. Tokens must never be stored in the WebView or library export.</summary>
public interface ISecretStore
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken = default);
    Task SetAsync(string key, string value, CancellationToken cancellationToken = default);
    Task RemoveAsync(string key, CancellationToken cancellationToken = default);
}

public sealed record SupabaseUser(string Id, string? Email);

public sealed class AuthSession
{
    public required string AccessToken { get; init; }
    public required string RefreshToken { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required SupabaseUser User { get; init; }
    public override string ToString() => $"Session for {User.Id}, expires {ExpiresAt:O}";
}

public sealed record AuthResult(SupabaseUser? User, AuthSession? Session)
{
    public bool RequiresEmailConfirmation => Session is null;
}

public sealed class SupabaseException(string message, System.Net.HttpStatusCode statusCode, string? errorCode = null)
    : Exception(message)
{
    public System.Net.HttpStatusCode StatusCode { get; } = statusCode;
    public string? ErrorCode { get; } = errorCode;
}
