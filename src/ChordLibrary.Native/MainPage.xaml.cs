namespace ChordLibrary.Native;

public partial class MainPage : ContentPage
{
	public MainPage()
	{
		InitializeComponent();
		// The Razor generator supplies Routes after XAML source generation.
		blazorWebView.RootComponents.Add(new() { Selector = "#app", ComponentType = typeof(Components.Routes) });
	}
}
