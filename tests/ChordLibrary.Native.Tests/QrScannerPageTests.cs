using System.Reflection;
using ChordLibrary.Native;
using Microsoft.Maui;
using ZXing.Net.Maui.Controls;

namespace ChordLibrary.Native.Tests;

public sealed class QrScannerPageTests
{
    [Fact]
    public async Task RecognizedCodeDetachesPreviewBeforeReleasingNativeCamera()
    {
        var (page, camera, handler, preview) = CreateCameraSession();
        bool? attachedAtRelease = null;
        bool? detectingAtRelease = null;
        handler.OnDisconnect = () =>
        {
            attachedAtRelease = preview.Children.Contains(camera) || camera.Parent is not null;
            detectingAtRelease = camera.IsDetecting;
        };

        await Finish(page, "song payload");

        Assert.Equal("song payload", await page.Result);
        Assert.False(attachedAtRelease);
        Assert.False(detectingAtRelease);
        Assert.Equal(1, handler.DisconnectCount);
    }

    [Theory]
    [InlineData("detection")]
    [InlineData("disconnect")]
    public async Task CleanupFailureDoesNotLoseTheScanOrEscapeTheCallback(string failure)
    {
        var (page, camera, handler, preview) = CreateCameraSession();
        handler.ThrowOnDetectionChange = failure == "detection";
        handler.OnDisconnect = () =>
        {
            if (failure == "disconnect") throw new ObjectDisposedException("native camera");
        };

        await Finish(page, "song payload");

        Assert.Equal("song payload", await page.Result);
        Assert.DoesNotContain(camera, preview.Children);
        Assert.Equal(1, handler.DisconnectCount);
    }

    [Fact]
    public async Task DuplicateFramesAndCancelCompleteOnlyOnce()
    {
        var (page, _, handler, _) = CreateCameraSession();

        await Finish(page, "first code");
        await Finish(page, "second code");
        await Finish(page, null);

        Assert.Equal("first code", await page.Result);
        Assert.Equal(1, handler.DisconnectCount);
    }

    [Fact]
    public async Task CancelReturnsNoPayloadEvenWhenCameraReleaseFails()
    {
        var (page, _, handler, _) = CreateCameraSession();
        handler.OnDisconnect = () => throw new ObjectDisposedException("native camera");

        await Finish(page, null);

        Assert.Null(await page.Result);
        Assert.Equal(1, handler.DisconnectCount);
    }

    [Fact]
    public async Task BackgroundCleanupAndLaterCloseDoNotReleaseCameraTwice()
    {
        var (page, _, handler, _) = CreateCameraSession();
        Invoke(page, "WindowStopped", null, EventArgs.Empty);

        await Finish(page, null);

        Assert.Null(await page.Result);
        Assert.Equal(1, handler.DisconnectCount);
    }

    [Fact]
    public async Task ImagePickerStillReturnsCodeWhenCameraReleaseFails()
    {
        var (page, _, handler, _) = CreateCameraSession(() => Task.FromResult<string?>("image code"));
        handler.OnDisconnect = () => throw new ObjectDisposedException("native camera");

        await (Task)Invoke(page, "ChooseImageAsync")!;

        Assert.Equal("image code", await page.Result);
        Assert.Equal(1, handler.DisconnectCount);
    }

    private static (QrScannerPage Page, CameraBarcodeReaderView Camera, TestCameraHandler Handler, Grid Preview) CreateCameraSession(Func<Task<string?>>? pickImage = null)
    {
        var page = new QrScannerPage(pickImage ?? (() => Task.FromResult<string?>(null)));
        var preview = (Grid)Field("preview").GetValue(page)!;
        var camera = new CameraBarcodeReaderView { IsDetecting = true };
        var handler = new TestCameraHandler(camera);
        camera.Handler = handler;
        preview.Children.Add(camera);
        Field("camera").SetValue(page, camera);
        return (page, camera, handler, preview);
    }

    private static FieldInfo Field(string name) => typeof(QrScannerPage).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!;
    private static object? Invoke(QrScannerPage page, string name, params object?[] args) =>
        typeof(QrScannerPage).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(page, args);
    private static Task Finish(QrScannerPage page, string? payload) => (Task)Invoke(page, "FinishAsync", payload)!;

    private sealed class TestCameraHandler(CameraBarcodeReaderView view) : IViewHandler
    {
        public Action? OnDisconnect { get; set; }
        public bool ThrowOnDetectionChange { get; set; }
        public int DisconnectCount { get; private set; }
        public IView VirtualView => view;
        IElement IElementHandler.VirtualView => view;
        public object PlatformView { get; } = new();
        public object ContainerView => PlatformView;
        public bool HasContainer { get; set; }
        public IMauiContext? MauiContext => null;
        public void SetMauiContext(IMauiContext mauiContext) { }
        public void SetVirtualView(IElement element) { }
        public void UpdateValue(string property)
        {
            if (ThrowOnDetectionChange && property == nameof(CameraBarcodeReaderView.IsDetecting))
                throw new ObjectDisposedException("native camera");
        }
        public void Invoke(string command, object? args = null) { }
        public void DisconnectHandler() { DisconnectCount++; OnDisconnect?.Invoke(); }
        public void PlatformArrange(Rect frame) { }
        public Size GetDesiredSize(double widthConstraint, double heightConstraint) => Size.Zero;
    }
}
