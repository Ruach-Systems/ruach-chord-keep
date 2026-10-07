namespace ChordLibrary.Native;

public partial class App : Application
{
	private readonly ChordLibrary.Shared.AppSyncSignals syncSignals;
	public App(ChordLibrary.Shared.AppSyncSignals syncSignals)
	{
		this.syncSignals = syncSignals;
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
		return window;
	}
}
