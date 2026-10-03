using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core.Supabase;

/// <summary>GoTrue authentication with native secret storage, refresh rotation and PKCE.</summary>
public sealed class SupabaseAuthClient
{
    private readonly SupabaseOptions _options;
    private readonly HttpClient _http;
    private readonly ISecretStore _secrets;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _sessionKey;
    private readonly string _pkceKey;
    private bool _initialized;

    public SupabaseAuthClient(SupabaseOptions options, HttpClient http, ISecretStore secrets)
    {
        _options = options;
        _http = http;
        _secrets = secrets;
        var project = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(options.Validate().AbsoluteUri)))[..24];
        _sessionKey = $"chordlibrary.supabase.{project}.session";
        _pkceKey = $"chordlibrary.supabase.{project}.pkce";
    }

    public AuthSession? Session { get; private set; }
    public SupabaseUser? User => Session?.User;
    public event EventHandler? SessionChanged;

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { await InitializeCoreAsync(cancellationToken).ConfigureAwait(false); }
        finally { _gate.Release(); }
    }

    private async Task InitializeCoreAsync(CancellationToken cancellationToken)
    {
        if (_initialized) return;
        var stored = await _secrets.GetAsync(_sessionKey, cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(stored))
        {
            try
            {
                var session = JsonSerializer.Deserialize<AuthSession>(stored);
                if (session is not null && Guid.TryParse(session.User?.Id, out _)
                    && !string.IsNullOrWhiteSpace(session.RefreshToken) && !string.IsNullOrWhiteSpace(session.AccessToken))
                    Session = session;
                else await _secrets.RemoveAsync(_sessionKey, cancellationToken).ConfigureAwait(false);
            }
            catch (JsonException) { await _secrets.RemoveAsync(_sessionKey, cancellationToken).ConfigureAwait(false); }
        }
        _initialized = true;
    }

    public async Task<AuthSession> SignInAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        ValidateCredentials(email, password);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var data = await SendAsync(HttpMethod.Post, "token?grant_type=password",
                new JsonObject { ["email"] = email.Trim(), ["password"] = password }, null, cancellationToken).ConfigureAwait(false);
            var session = ParseSession(data);
            await SaveSessionAsync(session, cancellationToken).ConfigureAwait(false);
            return session;
        }
        finally { _gate.Release(); }
    }

    public async Task<AuthResult> SignUpAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        ValidateCredentials(email, password);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var data = await SendAsync(HttpMethod.Post, "signup",
                new JsonObject { ["email"] = email.Trim(), ["password"] = password }, null, cancellationToken).ConfigureAwait(false);
            if (data?["access_token"] is not null)
            {
                var session = ParseSession(data);
                await SaveSessionAsync(session, cancellationToken).ConfigureAwait(false);
                return new AuthResult(session.User, session);
            }
            return new AuthResult(ParseUser(data?["user"] ?? data), null);
        }
        finally { _gate.Release(); }
    }

    public async Task RequestPasswordResetAsync(string email, Uri? redirectUri = null, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        var path = "recover";
        var body = new JsonObject { ["email"] = email.Trim() };
        if (redirectUri is not null)
        {
            var pending = await CreatePkceAsync(redirectUri, cancellationToken).ConfigureAwait(false);
            body["code_challenge"] = Challenge(pending.Verifier);
            body["code_challenge_method"] = "s256";
            path += "?redirect_to=" + Uri.EscapeDataString(pending.RedirectUri);
        }
        await SendAsync(HttpMethod.Post, path, body, null, cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdatePasswordAsync(string newPassword, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(newPassword);
        var token = await GetAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        await SendAsync(HttpMethod.Put, "user", new JsonObject { ["password"] = newPassword }, token, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Verifies the emailed recovery OTP without a browser callback and establishes a session.
    /// Configure the Supabase Reset password email template to include {{ .Token }}.
    /// The host must select this account before calling UpdatePasswordAsync, including when that call fails.
    /// </summary>
    public async Task<AuthSession> VerifyRecoveryCodeAsync(string email, string code, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(code);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var data = await SendAsync(HttpMethod.Post, "verify", new JsonObject
            {
                ["email"] = email.Trim(), ["token"] = code.Trim(), ["type"] = "recovery"
            }, null, cancellationToken).ConfigureAwait(false);
            var session = ParseSession(data);
            await SaveSessionAsync(session, cancellationToken).ConfigureAwait(false);
            return session;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Exchanges an unvisited default Supabase recovery email link without navigating to it.</summary>
    public Task<AuthSession> VerifyRecoveryLinkAsync(string pastedLink, CancellationToken cancellationToken = default)
        => VerifyEmailLinkAsync(pastedLink, "recovery", cancellationToken);

    /// <summary>Exchanges an unvisited default Supabase signup email link without following its redirect.</summary>
    public Task<AuthSession> VerifySignupLinkAsync(string pastedLink, CancellationToken cancellationToken = default)
        => VerifyEmailLinkAsync(pastedLink, "signup", cancellationToken);

    private async Task<AuthSession> VerifyEmailLinkAsync(string pastedLink, string expectedType, CancellationToken cancellationToken)
    {
        // Parse and validate before any network request. Never GET, log, or persist the pasted link.
        var tokenHash = SupabaseEmailLink.ReadTokenHash(pastedLink, _options.Validate(), expectedType);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var data = await SendAsync(HttpMethod.Post, "verify", new JsonObject
            {
                ["token_hash"] = tokenHash, ["type"] = expectedType
            }, null, cancellationToken).ConfigureAwait(false);
            var session = ParseSession(data);
            await SaveSessionAsync(session, cancellationToken).ConfigureAwait(false);
            return session;
        }
        finally { _gate.Release(); }
    }

    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
        => (await GetSessionAsync(cancellationToken).ConfigureAwait(false)).AccessToken;

    /// <summary>Returns tokens and their owner as one immutable session snapshot.</summary>
    public async Task<AuthSession> GetSessionAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await InitializeCoreAsync(cancellationToken).ConfigureAwait(false);
            var session = Session ?? throw new InvalidOperationException("Sign in to sync this library.");
            if (session.ExpiresAt > DateTimeOffset.UtcNow.AddSeconds(60)) return session;
            try
            {
                var data = await SendAsync(HttpMethod.Post, "token?grant_type=refresh_token",
                    new JsonObject { ["refresh_token"] = session.RefreshToken }, null, cancellationToken).ConfigureAwait(false);
                var refreshed = ParseSession(data);
                if (refreshed.User.Id != session.User.Id) throw new InvalidOperationException("The refreshed account did not match the local session.");
                await SaveSessionAsync(refreshed, cancellationToken).ConfigureAwait(false);
                return refreshed;
            }
            catch (SupabaseException ex) when (ex.ErrorCode is "refresh_token_not_found" or "refresh_token_already_used" or "session_not_found" or "user_not_found")
            {
                await ClearSessionAsync(CancellationToken.None).ConfigureAwait(false);
                throw;
            }
            // Network outages, rate limits and server errors keep the local session and offline library intact.
        }
        finally { _gate.Release(); }
    }

    /// <summary>Always clears local credentials. Returns false if server revocation could not be confirmed.</summary>
    public async Task<bool> SignOutAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await InitializeCoreAsync(cancellationToken).ConfigureAwait(false);
            var revoked = Session is null;
            try
            {
                if (Session is not null)
                {
                    await SendAsync(HttpMethod.Post, "logout?scope=local", null, Session.AccessToken, cancellationToken).ConfigureAwait(false);
                    revoked = true;
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or SupabaseException or OperationCanceledException) { }
            finally
            {
                await ClearSessionAsync(CancellationToken.None).ConfigureAwait(false);
                await _secrets.RemoveAsync(_pkceKey, CancellationToken.None).ConfigureAwait(false);
            }
            return revoked;
        }
        finally { _gate.Release(); }
    }

    public async Task<Uri> BeginGoogleSignInAsync(Uri redirectUri, CancellationToken cancellationToken = default)
    {
        var pending = await CreatePkceAsync(redirectUri, cancellationToken).ConfigureAwait(false);
        return new Uri(_options.Validate(), "auth/v1/authorize?provider=google&redirect_to="
            + Uri.EscapeDataString(pending.RedirectUri) + "&code_challenge=" + Challenge(pending.Verifier)
            + "&code_challenge_method=s256");
    }

    public Task<AuthSession> CompleteGoogleSignInAsync(Uri callbackUri, CancellationToken cancellationToken = default)
        => CompletePkceAsync(callbackUri, cancellationToken);

    /// <summary>Handles the callback for Google sign-in or a recovery flow started on this device.</summary>
    public async Task<AuthSession> CompletePkceAsync(Uri callbackUri, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var stored = await _secrets.GetAsync(_pkceKey, cancellationToken).ConfigureAwait(false);
            var pending = stored is null ? null : JsonSerializer.Deserialize<PendingPkce>(stored);
            if (pending is null || pending.CreatedAt < DateTimeOffset.UtcNow.AddMinutes(-30))
                throw new InvalidOperationException("Start sign-in again on this device; the pending sign-in has expired.");
            var expected = new Uri(pending.RedirectUri);
            if (!callbackUri.IsAbsoluteUri || callbackUri.Scheme != expected.Scheme || callbackUri.Authority != expected.Authority
                || callbackUri.AbsolutePath != expected.AbsolutePath)
                throw new InvalidOperationException("This authentication callback does not match the app redirect.");
            var query = ParseQuery(callbackUri.Query);
            if (!query.TryGetValue("app_state", out var state) || !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(state), Encoding.UTF8.GetBytes(pending.State)))
                throw new InvalidOperationException("This authentication callback does not match the pending sign-in.");
            if (query.TryGetValue("error", out _)) throw new InvalidOperationException("Sign-in was cancelled or could not be completed. Try again.");
            if (!query.TryGetValue("code", out var code) || string.IsNullOrWhiteSpace(code))
                throw new InvalidOperationException("The authentication callback did not contain an authorization code.");
            var data = await SendAsync(HttpMethod.Post, "token?grant_type=pkce",
                new JsonObject { ["auth_code"] = code, ["code_verifier"] = pending.Verifier }, null, cancellationToken).ConfigureAwait(false);
            var session = ParseSession(data);
            await SaveSessionAsync(session, cancellationToken).ConfigureAwait(false);
            await _secrets.RemoveAsync(_pkceKey, cancellationToken).ConfigureAwait(false);
            return session;
        }
        finally { _gate.Release(); }
    }

    private async Task<PendingPkce> CreatePkceAsync(Uri redirectUri, CancellationToken cancellationToken)
    {
        if (!redirectUri.IsAbsoluteUri || !string.IsNullOrEmpty(redirectUri.Fragment) || !string.IsNullOrEmpty(redirectUri.Query))
            throw new ArgumentException("Use an absolute app redirect URI without a query or fragment.");
        var state = Base64Url(RandomNumberGenerator.GetBytes(32));
        var pending = new PendingPkce(Base64Url(RandomNumberGenerator.GetBytes(32)), state,
            redirectUri.AbsoluteUri + "?app_state=" + state, DateTimeOffset.UtcNow);
        await _secrets.SetAsync(_pkceKey, JsonSerializer.Serialize(pending), cancellationToken).ConfigureAwait(false);
        return pending;
    }

    private async Task SaveSessionAsync(AuthSession session, CancellationToken cancellationToken)
    {
        await _secrets.SetAsync(_sessionKey, JsonSerializer.Serialize(session), cancellationToken).ConfigureAwait(false);
        Session = session;
        _initialized = true;
        SessionChanged?.Invoke(this, EventArgs.Empty);
    }

    private async Task ClearSessionAsync(CancellationToken cancellationToken)
    {
        await _secrets.RemoveAsync(_sessionKey, cancellationToken).ConfigureAwait(false);
        Session = null;
        _initialized = true;
        SessionChanged?.Invoke(this, EventArgs.Empty);
    }

    private Task<JsonNode?> SendAsync(HttpMethod method, string path, JsonNode? body, string? token, CancellationToken cancellationToken)
        => SupabaseHttp.SendAsync(_http, _options, method, "auth/v1/" + path, body, token, cancellationToken);

    private static AuthSession ParseSession(JsonNode? data)
    {
        var user = ParseUser(data?["user"]) ?? throw new InvalidOperationException("Supabase did not return a valid account.");
        var accessToken = data?["access_token"]?.GetValue<string>();
        var refreshToken = data?["refresh_token"]?.GetValue<string>();
        if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(refreshToken))
            throw new InvalidOperationException("Supabase did not return a complete session.");
        var expiresAt = data?["expires_at"]?.GetValue<long>();
        return new AuthSession
        {
            AccessToken = accessToken, RefreshToken = refreshToken, User = user,
            ExpiresAt = expiresAt.HasValue ? DateTimeOffset.FromUnixTimeSeconds(expiresAt.Value)
                : DateTimeOffset.UtcNow.AddSeconds(data?["expires_in"]?.GetValue<long>() ?? 3600)
        };
    }

    private static SupabaseUser? ParseUser(JsonNode? user)
    {
        var id = user?["id"]?.GetValue<string>();
        return Guid.TryParse(id, out _) ? new SupabaseUser(id!, user?["email"]?.GetValue<string>()) : null;
    }

    private static Dictionary<string, string> ParseQuery(string query) => query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(part => part.Split('=', 2)).GroupBy(parts => Uri.UnescapeDataString(parts[0]), StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.Count() == 1 && group.First().Length == 2
            ? Uri.UnescapeDataString(group.First()[1].Replace('+', ' ')) : "", StringComparer.Ordinal);

    private static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Challenge(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
    private static void ValidateCredentials(string email, string password)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
    }

    private sealed record PendingPkce(string Verifier, string State, string RedirectUri, DateTimeOffset CreatedAt);
}
