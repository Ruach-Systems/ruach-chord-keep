using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace ChordLibrary.Core.Supabase;

internal static class SupabaseHttp
{
    internal static async Task<JsonNode?> SendAsync(HttpClient http, SupabaseOptions options,
        HttpMethod method, string path, JsonNode? body, string? accessToken, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, new Uri(options.Validate(), path));
        request.Headers.Add("apikey", options.PublishableKey);
        if (!string.IsNullOrEmpty(accessToken))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        JsonNode? data = null;
        if (!string.IsNullOrWhiteSpace(text))
        {
            try { data = JsonNode.Parse(text); }
            catch (System.Text.Json.JsonException) when (!response.IsSuccessStatusCode) { }
        }
        if (!response.IsSuccessStatusCode)
        {
            // Do not include request data, URLs, tokens, or arbitrary upstream HTML in errors.
            var code = data?["error_code"]?.ToString() ?? data?["code"]?.ToString();
            var message = data?["msg"]?.ToString() ?? data?["message"]?.ToString()
                ?? data?["error_description"]?.ToString() ?? $"Supabase request failed ({(int)response.StatusCode}).";
            throw new SupabaseException(message, response.StatusCode, code);
        }
        return data;
    }
}
