using ChordLibrary.Core.Supabase;
using ChordLibrary.Shared;
using Microsoft.JSInterop;
namespace ChordLibrary.Preview;
public sealed class PreviewPlatform(IJSRuntime js, IWebHostEnvironment environment) : IAppPlatform
{
    public string DataDirectory => Path.Combine(environment.ContentRootPath, ".local", "preview-library");
    public bool IsNative => false;
    public string OAuthRedirectUri => "http://127.0.0.1:54179/callback/";
    public Task<string?> PickJsonAsync() => throw new NotSupportedException("Use the browser import button.");
    public Task ExportAsync(string filename, string json) => js.InvokeVoidAsync("previewDownload",filename,json).AsTask();
    public Task<string?> ReadQrAsync(bool camera) => throw new NotSupportedException("Use the native app for QR image import or camera capture.");
    public Task<Uri> AuthenticateAsync(Uri uri, CancellationToken cancellationToken = default) => throw new NotSupportedException("Google sign-in is available in the native app.");
}
public sealed class PreviewSecretStore : ISecretStore
{
    private readonly Dictionary<string,string> values = [];
    public Task<string?> GetAsync(string key, CancellationToken cancellationToken = default) => Task.FromResult(values.GetValueOrDefault(key));
    public Task SetAsync(string key,string value,CancellationToken cancellationToken = default) { values[key]=value; return Task.CompletedTask; }
    public Task RemoveAsync(string key,CancellationToken cancellationToken = default) { values.Remove(key); return Task.CompletedTask; }
}
