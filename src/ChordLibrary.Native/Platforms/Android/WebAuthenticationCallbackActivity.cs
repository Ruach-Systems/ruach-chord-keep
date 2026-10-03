using Android.App;
using Android.Content;
using Android.Content.PM;
namespace ChordLibrary.Native;
[Activity(NoHistory = true, LaunchMode = LaunchMode.SingleTop, Exported = true)]
[IntentFilter([Intent.ActionView], Categories = [Intent.CategoryDefault, Intent.CategoryBrowsable], DataScheme = "chordlibrary", DataHost = "auth", DataPath = "/callback")]
public sealed class WebAuthenticationCallbackActivity : Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity { }
