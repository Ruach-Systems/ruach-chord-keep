namespace ChordLibrary.Shared;

public interface IAppPlatform
{
    string DataDirectory { get; }
    bool IsNative { get; }
    string AppVersion => string.Empty;
    bool SupportsQrImport => false;
    Task SetPerformanceActiveAsync(bool active) => Task.CompletedTask;
    string OAuthRedirectUri { get; }
    Task<string?> PickJsonAsync();
    Task ExportAsync(string filename, string json);
    Task<string?> ReadQrAsync(bool camera);
    Task<Uri> AuthenticateAsync(Uri authorizationUri, CancellationToken cancellationToken = default);
}
