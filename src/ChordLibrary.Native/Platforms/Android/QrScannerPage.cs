using ZXing.Net.Maui;
using ZXing.Net.Maui.Controls;

namespace ChordLibrary.Native;

/// <summary>A live camera session; the file picker remains available without camera permission.</summary>
public sealed class QrScannerPage : ContentPage
{
    private readonly TaskCompletionSource<string?> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Func<Task<string?>> pickImage;
    private readonly Grid preview = new() { BackgroundColor = Colors.Black, MinimumHeightRequest = 120 };
    private readonly Label status = new() { TextColor = Colors.White, Text = "Starting camera…" };
    private readonly Button imageButton = new() { Text = "Choose QR image", BackgroundColor = Color.FromArgb("#EF5967"), TextColor = Colors.Black };
    private CameraBarcodeReaderView? camera;
    private Window? ownerWindow;
    private bool visible, suspended, picking, starting, finished;
    private bool permissionRequested;

    public Task<string?> Result => completion.Task;

    public QrScannerPage(Func<Task<string?>> pickImage)
    {
        this.pickImage = pickImage;
        Title = "Scan song QR";
        SafeAreaEdges = new SafeAreaEdges(SafeAreaRegions.Container);
        BackgroundColor = Color.FromArgb("#141821");
        var close = new Button { Text = "Cancel", TextColor = Colors.White, BackgroundColor = Color.FromArgb("#292530") };
        close.Clicked += (_, _) => _ = FinishAsync(null);
        imageButton.Clicked += (_, _) => _ = ChooseImageAsync();
        var layout = new Grid
        {
            Padding = new Thickness(20), RowSpacing = 12,
            RowDefinitions = [new(GridLength.Auto), new(GridLength.Star), new(GridLength.Auto), new(GridLength.Auto), new(GridLength.Auto)]
        };
        layout.Add(new Label { Text = "Scan song QR", TextColor = Colors.White, FontSize = 24, FontAttributes = FontAttributes.Bold }, 0, 0);
        layout.Add(preview, 0, 1);
        layout.Add(status, 0, 2);
        layout.Add(imageButton, 0, 3);
        layout.Add(close, 0, 4);
        Content = layout;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        visible = true;
        ownerWindow = Window;
        if (ownerWindow is not null)
        {
            ownerWindow.Stopped += WindowStopped;
            ownerWindow.Resumed += WindowResumed;
        }
        _ = StartCameraAsync();
    }

    protected override void OnDisappearing()
    {
        visible = false;
        StopCamera();
        if (ownerWindow is not null)
        {
            ownerWindow.Stopped -= WindowStopped;
            ownerWindow.Resumed -= WindowResumed;
            ownerWindow = null;
        }
        base.OnDisappearing();
    }

    protected override bool OnBackButtonPressed()
    {
        _ = FinishAsync(null);
        return true;
    }

    private void WindowStopped(object? sender, EventArgs e) { suspended = true; StopCamera(); }
    private void WindowResumed(object? sender, EventArgs e) { suspended = false; _ = StartCameraAsync(); }

    private async Task StartCameraAsync()
    {
        if (finished || picking || starting || !visible || suspended || camera is not null) return;
        starting = true;
        try
        {
            var permission = await Permissions.CheckStatusAsync<Permissions.Camera>();
            if (permission != PermissionStatus.Granted && !permissionRequested)
            {
                permissionRequested = true;
                permission = await Permissions.RequestAsync<Permissions.Camera>();
            }
            if (finished || picking || !visible || suspended) return;
            if (permission != PermissionStatus.Granted)
            {
                status.Text = "Camera permission is off. Choose a QR image, or enable camera access in Android settings.";
                return;
            }
            camera = new CameraBarcodeReaderView
            {
                CameraLocation = CameraLocation.Rear,
                IsDetecting = true,
                Options = new BarcodeReaderOptions
                {
                    Formats = BarcodeFormat.QrCode, AutoRotate = true, Multiple = false, TryHarder = true,
                    // Dense chord sheets need more detail than the default low-resolution preview.
                    CameraResolutionSelector = resolutions => resolutions
                        .OrderBy(size => Math.Abs((long)size.Width * size.Height - 1920L * 1080)).First()
                }
            };
            camera.BarcodesDetected += BarcodesDetected;
            preview.Children.Add(camera);
            status.Text = "Point the camera at the whole QR code. It scans automatically. You can also choose an image below.";
        }
        catch (Exception ex)
        {
            LogCameraError("start", ex);
            StopCamera();
            status.Text = "The camera could not start. You can still choose a QR image below.";
        }
        finally { starting = false; }
    }

    private void BarcodesDetected(object? sender, BarcodeDetectionEventArgs e)
    {
        var text = e.Results.FirstOrDefault(result => !string.IsNullOrWhiteSpace(result.Value))?.Value;
        if (text is null) return;
        MainThread.BeginInvokeOnMainThread(() =>
        {
            // Ignore frames queued before a picker, close, or background transition.
            if (!finished && !picking && visible && !suspended && ReferenceEquals(sender, camera))
                _ = FinishAsync(text);
        });
    }

    private async Task ChooseImageAsync()
    {
        if (finished || picking) return;
        picking = true;
        imageButton.IsEnabled = false;
        string? error = null;
        try
        {
            StopCamera();
            var text = await pickImage();
            if (!finished && text is not null) await FinishAsync(text);
        }
        catch (Exception ex) { error = ex.Message; }
        finally
        {
            picking = false;
            imageButton.IsEnabled = true;
            if (!finished)
            {
                await StartCameraAsync();
                if (error is not null) status.Text = error;
            }
        }
    }

    private void StopCamera()
    {
        var previous = camera;
        camera = null;
        if (previous is null) return;
        previous.BarcodesDetected -= BarcodesDetected;
        // ZXing disposes the native PreviewView in DisconnectHandler. Detach it first:
        // removing a disposed, still-parented Android view can throw during the UI transition.
        var handler = previous.Handler;
        TryCameraCleanup("disable detection", () => previous.IsDetecting = false);
        TryCameraCleanup("detach preview", () => preview.Children.Remove(previous));
        // Detection alone leaves CameraX running. Release it even if another cleanup step fails.
        TryCameraCleanup("release camera", () => handler?.DisconnectHandler());
    }

    private async Task FinishAsync(string? text)
    {
        if (finished) return;
        finished = true;
        try
        {
            StopCamera();
            if (Navigation.ModalStack.LastOrDefault() == this) await Navigation.PopModalAsync();
            completion.TrySetResult(text);
        }
        catch (Exception ex)
        {
            LogCameraError("close scanner", ex);
            completion.TrySetException(new InvalidOperationException("The scanner could not close. Please try again.", ex));
        }
    }

    private static void TryCameraCleanup(string operation, Action cleanup)
    {
        try { cleanup(); }
        catch (Exception ex) { LogCameraError(operation, ex); }
    }

    private static void LogCameraError(string operation, Exception error)
    {
        // Keep diagnostics in release builds; never log the scanned song or QR payload.
#if ANDROID
        Android.Util.Log.Warn("ChordLibrary.QR", $"{operation}: {error}");
#else
        System.Diagnostics.Trace.TraceWarning($"QR scanner {operation}: {error}");
#endif
    }
}
