#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PublishDir
  #error PublishDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef WebViewBootstrapper
  #error WebViewBootstrapper is required
#endif

[Setup]
AppId={{D72F1DE3-93E7-4729-BC61-5CC89143D125}
AppName=Chord Library
AppVersion={#AppVersion}
AppPublisher=Ruach Systems
AppPublisherURL=https://github.com/Ruach-Systems/ruach-chord-library
DefaultDirName={localappdata}\Programs\Ruach Systems\Chord Library
DefaultGroupName=Chord Library
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=ChordLibrary-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
UninstallDisplayIcon={app}\ChordLibrary.Native.exe

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewBootstrapper}"; Flags: dontcopy

[Icons]
Name: "{group}\Chord Library"; Filename: "{app}\ChordLibrary.Native.exe"

[Run]
Filename: "{app}\ChordLibrary.Native.exe"; Description: "Open Chord Library"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
  if not Result then
    Result := (RegQueryStringValue(HKCU, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then exit;
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE,
      ewWaitUntilTerminated, ExitCode) then
  begin
    Result := 'Could not start Microsoft WebView2 setup. Install the WebView2 Runtime and retry.';
    exit;
  end;
  if not HasWebView2 then
    Result := 'Microsoft WebView2 is required. Connect to the internet, install the WebView2 Runtime, then retry. Setup exit code: ' + IntToStr(ExitCode);
end;
