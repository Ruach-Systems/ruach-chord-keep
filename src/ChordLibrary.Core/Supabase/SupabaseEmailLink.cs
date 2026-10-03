namespace ChordLibrary.Core.Supabase;

/// <summary>Parses only this project's default email verification URL; its redirect is never followed.</summary>
internal static class SupabaseEmailLink
{
    internal static string ReadTokenHash(string pastedLink, Uri project, string expectedType)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(pastedLink);
        var text = pastedLink.Trim();
        if (text.Length > 16_384 || text.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))
            || text.Contains('\\') || text.Contains('#') || !HasValidPercentEscapes(text)
            || !Uri.TryCreate(text, UriKind.Absolute, out var link)
            || (link.Scheme != Uri.UriSchemeHttps && !(link.Scheme == Uri.UriSchemeHttp && link.IsLoopback))
            || !string.IsNullOrEmpty(link.UserInfo) || !string.IsNullOrEmpty(link.Fragment)
            || !string.Equals(link.Scheme, project.Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(link.IdnHost, project.IdnHost, StringComparison.OrdinalIgnoreCase)
            || link.Port != project.Port || link.AbsolutePath != "/auth/v1/verify")
            throw InvalidLink();

        // Uri normalizes dot segments and some escaped paths. Require the pasted path itself to be exact.
        var authorityStart = text.IndexOf("://", StringComparison.Ordinal) + 3;
        var pathStart = text.IndexOf('/', authorityStart);
        var queryStart = text.IndexOf('?', authorityStart);
        if (pathStart < 0 || queryStart <= pathStart || text[pathStart..queryStart] != "/auth/v1/verify")
            throw InvalidLink();

        var query = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var parameter in text[(queryStart + 1)..].Split('&'))
        {
            var separator = parameter.IndexOf('=');
            if (separator <= 0 || separator == parameter.Length - 1) throw InvalidLink();
            var key = Uri.UnescapeDataString(parameter[..separator].Replace('+', ' '));
            var value = Uri.UnescapeDataString(parameter[(separator + 1)..].Replace('+', ' '));
            if (key is not ("token" or "type" or "redirect_to") || value.Any(char.IsControl)
                || !query.TryAdd(key, value)) throw InvalidLink();
        }
        if (!query.TryGetValue("type", out var type) || type != expectedType
            || !query.TryGetValue("token", out var token) || token.Length > 4096
            || !token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            throw InvalidLink();
        if (query.TryGetValue("redirect_to", out var redirect)
            && (redirect.Any(char.IsWhiteSpace) || !Uri.TryCreate(redirect, UriKind.Absolute, out _)))
            throw InvalidLink();
        return token;
    }

    private static bool HasValidPercentEscapes(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] != '%') continue;
            if (i + 2 >= text.Length || !Uri.IsHexDigit(text[i + 1]) || !Uri.IsHexDigit(text[i + 2])) return false;
            i += 2;
        }
        return true;
    }

    private static ArgumentException InvalidLink() => new(
        "Paste the original, unused verification link from this project's email. It must match the requested recovery or signup action.");
}
