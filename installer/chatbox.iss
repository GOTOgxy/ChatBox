; ChatBox installer (Inno Setup 6), modeled on BindX's proven self-update flow.
; User-level install, no UAC. Silent upgrade (/VERYSILENT /SUPPRESSMSGBOXES /NORESTART)
; kills the running app, overwrites files, then relaunches the new version.

#ifndef MyAppVersion
  #define MyAppVersion "1.5.6"
#endif
#define MyAppName "ChatBox"
#define MyAppPublisher "GOTOgxy"
#define MyAppURL "https://github.com/GOTOgxy/ChatBox"
#define MyAppExeName "ChatBox.exe"

[Setup]
AppId=ChatBox
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\ChatBox
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=ChatBox-Setup-{#MyAppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
CloseApplications=false
RestartApplications=false

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RC: LongInt;
begin
  Exec('taskkill', '/IM {#MyAppExeName} /F /T', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Sleep(800);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  RC: LongInt;
begin
  if (CurStep = ssPostInstall) and WizardSilent then
    Exec(ExpandConstant('{app}\{#MyAppExeName}'), '', ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, RC);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ConfigDir: String;
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then begin
    ConfigDir := ExpandConstant('{userappdata}\{#MyAppName}');
    if DirExists(ConfigDir) then
      if MsgBox('是否同时删除 ChatBox 的配置与登录数据？' + #13#10 + ConfigDir, mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ConfigDir, True, True, True);
  end;
end;
