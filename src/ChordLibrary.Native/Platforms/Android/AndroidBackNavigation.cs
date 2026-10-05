using Android.App;
using ChordLibrary.Shared;
using Microsoft.Extensions.DependencyInjection;

namespace ChordLibrary.Native;

internal static class AndroidBackNavigation
{
    // MAUI routes both the hardware button and Android 13+ Back gestures here.
    public static bool Handle(Activity activity)
    {
        var page = Microsoft.Maui.Controls.Application.Current?.Windows.FirstOrDefault()?.Page;
        if (page is not MainPage) return false;
        // The native QR scanner has its own Back handling and camera cleanup.
        if (page.Navigation.ModalStack.LastOrDefault() is { } modal)
            return modal.SendBackButtonPressed();
        var navigation = IPlatformApplication.Current?.Services.GetService<AppBackNavigation>();
        if (navigation is not null) _ = NavigateAsync(activity, navigation);
        return true;
    }

    private static async Task NavigateAsync(Activity activity, AppBackNavigation navigation)
    {
        try
        {
            if (!await navigation.RequestAsync() && !activity.IsFinishing && !activity.IsDestroyed)
                activity.MoveTaskToBack(true);
        }
        catch (Exception ex)
        {
            // Failed UI dispatch must never be mistaken for permission to close the app.
            Android.Util.Log.Warn("ChordLibrary.Back", ex.ToString());
        }
    }
}
