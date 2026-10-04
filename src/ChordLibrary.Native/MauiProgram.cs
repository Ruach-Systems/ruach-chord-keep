using ChordLibrary.Core.Supabase;
using ChordLibrary.Shared;
using Microsoft.Extensions.Logging;
#if ANDROID
using ZXing.Net.Maui.Controls;
#endif
namespace ChordLibrary.Native;
public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder().UseMauiApp<App>();
#if ANDROID
        builder.UseBarcodeReader();
#endif
        builder.Services.AddMauiBlazorWebView();
        builder.Services.AddSingleton<IAppPlatform, NativePlatform>();
        builder.Services.AddSingleton<ISecretStore, NativeSecretStore>();
        builder.Services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(45) });
        builder.Services.AddSingleton(AppDefaults.Load());
        builder.Services.AddSingleton<AppSession>();
#if DEBUG
        builder.Services.AddBlazorWebViewDeveloperTools();
        builder.Logging.AddDebug();
#endif
        return builder.Build();
    }
}
