using System.Text.Json.Nodes;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Supabase.Tests;

public sealed partial class SupabaseClientTests
{
    [Theory]
    [InlineData("full_name", "avatar_url")]
    [InlineData("name", "picture")]
    public async Task GoogleProfileSurvivesSessionRestoreAndClearsOnSignOut(string nameKey, string photoKey)
    {
        var response = SessionResponse("profile", 3600);
        response["user"]!["user_metadata"] = new JsonObject
        {
            [nameKey] = "Example Singer", [photoKey] = "https://lh3.googleusercontent.com/example"
        };
        var secrets = new TestSecrets();
        using var http = new HttpClient(new Handler(_ => Task.FromResult(Json(response))));
        var auth = new SupabaseAuthClient(Options, http, secrets);
        await auth.SignInAsync("test@example.invalid", "test-password");
        Assert.Equal("Example Singer", auth.User!.DisplayName);
        var restored = new SupabaseAuthClient(Options, http, secrets);
        await restored.InitializeAsync();
        Assert.Equal("https://lh3.googleusercontent.com/example", restored.User!.AvatarUrl);
        await restored.SignOutAsync();
        Assert.Null(restored.User);
    }

    [Fact]
    public async Task NonStringProfileMetadataDoesNotPreventSignIn()
    {
        var response = SessionResponse("profile", 3600);
        response["user"]!["user_metadata"] = new JsonObject { ["full_name"] = new JsonObject(), ["avatar_url"] = 42 };
        using var http = new HttpClient(new Handler(_ => Task.FromResult(Json(response))));
        var auth = new SupabaseAuthClient(Options, http, new TestSecrets());
        await auth.SignInAsync("test@example.invalid", "test-password");
        Assert.Null(auth.User!.DisplayName);
        Assert.Null(auth.User.AvatarUrl);
    }
}
