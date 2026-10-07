using System.Net;
using System.Text;
using ChordLibrary.Core.Supabase;
using ChordLibrary.Shared;
using SkiaSharp;
namespace ChordLibrary.Native;

public sealed class NativeSecretStore : ISecretStore
{
    public Task<string?> GetAsync(string key, CancellationToken cancellationToken = default) => SecureStorage.Default.GetAsync(key);
    public Task SetAsync(string key, string value, CancellationToken cancellationToken = default) => SecureStorage.Default.SetAsync(key, value);
    public Task RemoveAsync(string key, CancellationToken cancellationToken = default) { SecureStorage.Default.Remove(key); return Task.CompletedTask; }
}
public sealed class NativePlatform : IAppPlatform
{
    public string DataDirectory => Path.Combine(FileSystem.AppDataDirectory, "library");
    public bool IsNative => true;
#if WINDOWS
    public string OAuthRedirectUri => "http://127.0.0.1:54179/callback/";
#else
    public string OAuthRedirectUri => "chordlibrary://auth/callback";
#endif
    public async Task<string?> PickJsonAsync()
    {
        var file = await MainThread.InvokeOnMainThreadAsync(() => FilePicker.Default.PickAsync(new PickOptions { PickerTitle = "Import ChordKeep backup", FileTypes = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>> { [DevicePlatform.WinUI] = [".json"], [DevicePlatform.Android] = ["application/json", "text/plain", "application/octet-stream"] }) }));
        if (file is null) return null;
        await using var stream = await file.OpenReadAsync();
        using var reader = new StreamReader(stream, Encoding.UTF8, true);
        var buffer = new char[8192]; var text = new StringBuilder(); int count;
        while ((count = await reader.ReadAsync(buffer)) > 0) { if (text.Length + count > 20 * 1024 * 1024) throw new InvalidOperationException("The backup is larger than 20 MB. Split it into smaller backups first."); text.Append(buffer, 0, count); }
        return text.ToString();
    }
    public async Task ExportAsync(string filename, string json)
    {
        var name = Path.GetFileName(filename);
        foreach (var character in Path.GetInvalidFileNameChars()) name = name.Replace(character, '_');
        if (string.IsNullOrWhiteSpace(name)) name = "chordkeep-backup.json";
        var folder = Path.Combine(FileSystem.CacheDirectory, "exports"); Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, name); await File.WriteAllTextAsync(path, json, Encoding.UTF8);
        await MainThread.InvokeOnMainThreadAsync(() => Share.Default.RequestAsync(new ShareFileRequest("Export ChordKeep", new ShareFile(path, "application/json"))));
    }
    public bool SupportsQrImport => DeviceInfo.Platform == DevicePlatform.Android;
    private readonly SemaphoreSlim qrOperation = new(1, 1);

    public async Task<string?> ReadQrAsync(bool camera)
    {
        if (!SupportsQrImport) throw new NotSupportedException("QR import is available on Android.");
        if (!await qrOperation.WaitAsync(0)) return null;
        try
        {
#if ANDROID
            if (camera) return await MainThread.InvokeOnMainThreadAsync(async () =>
            {
                var root = Application.Current?.Windows.FirstOrDefault()?.Page
                    ?? throw new InvalidOperationException("The scanner cannot open yet. Try again.");
                var scanner = new QrScannerPage(PickQrImageAsync);
                await root.Navigation.PushModalAsync(scanner);
                return await scanner.Result;
            });
#endif
            return await PickQrImageAsync();
        }
        finally { qrOperation.Release(); }
    }

    private static async Task<string?> PickQrImageAsync()
    {
        var file = await MainThread.InvokeOnMainThreadAsync(() => FilePicker.Default.PickAsync(
            new PickOptions { PickerTitle = "Choose song QR image", FileTypes = FilePickerFileType.Images }));
        if (file is null) return null;
        // Decode away from the UI thread, including images supplied by cloud file providers.
        return await Task.Run(async () =>
        {
            await using var stream = await file.OpenReadAsync();
            using var codec = SKCodec.Create(stream) ?? throw new InvalidOperationException("The selected image could not be opened.");
            if ((long)codec.Info.Width * codec.Info.Height > 40_000_000)
                throw new InvalidOperationException("Use a smaller QR image (under 40 megapixels).");
            using var bitmap = SKBitmap.Decode(codec) ?? throw new InvalidOperationException("The selected image could not be read.");
            var reader = new ZXing.SkiaSharp.BarcodeReader
            {
                AutoRotate = true,
                Options = new ZXing.Common.DecodingOptions
                {
                    TryHarder = true, TryInverted = true, PossibleFormats = [ZXing.BarcodeFormat.QR_CODE]
                }
            };
            return reader.Decode(bitmap)?.Text
                ?? throw new InvalidOperationException("No QR code was found. Choose a clear image showing the whole code.");
        });
    }
    public async Task<Uri> AuthenticateAsync(Uri authorizationUri, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
#if WINDOWS
        var expected = new Uri(Query(authorizationUri)["redirect_to"]);
        var expectedState = Query(expected)["app_state"];
        using var listener = new HttpListener(); listener.Prefixes.Add(OAuthRedirectUri); listener.Start();
        if (!await MainThread.InvokeOnMainThreadAsync(() => Browser.Default.OpenAsync(authorizationUri, BrowserLaunchMode.External))) throw new InvalidOperationException("Could not open the browser. Try signing in with email.");
        while (true)
        {
            var context = await listener.GetContextAsync().WaitAsync(timeout.Token);
            var callback = context.Request.Url;
            var query = callback is null ? new Dictionary<string,string>() : Query(callback);
            var valid = callback is not null && callback.Authority == expected.Authority && callback.AbsolutePath == expected.AbsolutePath && query.GetValueOrDefault("app_state") == expectedState && (query.ContainsKey("code") || query.ContainsKey("error"));
            context.Response.StatusCode = valid ? 200 : 400;
            var content = Encoding.UTF8.GetBytes(valid ? "<!doctype html><html><body><h1>Return to ChordKeep</h1><p>The app is checking your sign-in. You may close this tab.</p></body></html>" : "Unrecognized sign-in callback.");
            context.Response.ContentType = "text/html; charset=utf-8"; context.Response.ContentLength64 = content.Length;
            await context.Response.OutputStream.WriteAsync(content,timeout.Token); context.Response.Close();
            if(valid) return callback!;
        }
#else
        var result = await MainThread.InvokeOnMainThreadAsync(() => WebAuthenticator.Default.AuthenticateAsync(new WebAuthenticatorOptions { Url = authorizationUri, CallbackUrl = new Uri(OAuthRedirectUri) }, timeout.Token));
        return new Uri(OAuthRedirectUri + "?" + string.Join("&", result.Properties.Select(pair => Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value))));
#endif
    }
    private static Dictionary<string,string> Query(Uri uri) => uri.Query.TrimStart('?').Split('&',StringSplitOptions.RemoveEmptyEntries).Select(part => part.Split('=',2)).ToDictionary(parts => Uri.UnescapeDataString(parts[0]), parts => parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "");
}
