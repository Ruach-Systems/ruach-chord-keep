using ChordLibrary.Core.Supabase;
using ChordLibrary.Shared;
using Microsoft.Extensions.Logging;
namespace ChordLibrary.Native;
public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder().UseMauiApp<App>();
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
