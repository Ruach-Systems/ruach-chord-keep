namespace ChordLibrary.Native;

public partial class App : Application
{
	private readonly ChordLibrary.Shared.AppSyncSignals syncSignals;
    private readonly ChordLibrary.Shared.IAppPlatform platform;
    private readonly ChordLibrary.Shared.PerformanceLifecycle performanceLifecycle;
	public App(ChordLibrary.Shared.AppSyncSignals syncSignals, ChordLibrary.Shared.IAppPlatform platform, ChordLibrary.Shared.PerformanceLifecycle performanceLifecycle)
	{
		this.syncSignals = syncSignals;
        this.platform = platform;
        this.performanceLifecycle = performanceLifecycle;
		InitializeComponent();
		syncSignals.SetConnected(Connectivity.Current.NetworkAccess == NetworkAccess.Internet);
		Connectivity.Current.ConnectivityChanged += (_, state) =>
			syncSignals.SetConnected(state.NetworkAccess == NetworkAccess.Internet);
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		var window = new Window(new MainPage()) { Title = "ChordKeep" };
		window.Resumed += (_, _) => syncSignals.Resume();
		window.Activated += (_, _) => syncSignals.Resume();
        window.Activated += async (_, _) => await ((NativePlatform)platform).SetForegroundAsync(true);
        window.Deactivated += async (_, _) => { performanceLifecycle.Suspend(); await ((NativePlatform)platform).SetForegroundAsync(false); };
        window.Stopped += async (_, _) => { performanceLifecycle.Suspend(); await ((NativePlatform)platform).SetForegroundAsync(false); };
        window.Destroying += async (_, _) => await platform.SetPerformanceActiveAsync(false);
		return window;
	}
}
