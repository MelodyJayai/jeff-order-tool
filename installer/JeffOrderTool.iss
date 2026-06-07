#ifndef MyAppVersion
#define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{7E64160D-F28E-4A5B-A5CC-CE93E50C3D22}
AppName=Jeff订单工具
AppVersion={#MyAppVersion}
AppPublisher=MelodyJay
AppPublisherURL=https://github.com/MelodyJayai/jeff-order-tool
AppSupportURL=https://github.com/MelodyJayai/jeff-order-tool/issues
AppUpdatesURL=https://github.com/MelodyJayai/jeff-order-tool/releases
DefaultDirName={localappdata}\Programs\JeffOrderTool
DefaultGroupName=Jeff订单工具
DisableProgramGroupPage=yes
OutputDir=..\release-installers
OutputBaseFilename=JeffOrderToolSetup-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Jeff订单工具
CloseApplications=no

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce

[Dirs]
Name: "{app}\data"; Flags: uninsneveruninstall
Name: "{app}\logs"; Flags: uninsneveruninstall

[Files]
Source: "..\release-package\JeffOrderTool\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*,logs\*,server.pid"

[Icons]
Name: "{autoprograms}\Jeff订单工具"; Filename: "{app}\打开Jeff订单工具.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Jeff订单工具"; Filename: "{app}\打开Jeff订单工具.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\关闭Jeff订单工具"; Filename: "{app}\SupportFiles\CloseJeffOrderTool.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\打开Jeff订单工具.exe"; Description: "打开 Jeff订单工具"; Flags: nowait postinstall skipifsilent

[Code]
procedure StopOldServer();
var
  PidFile: String;
  PidText: String;
  PidTextRaw: AnsiString;
  ResultCode: Integer;
begin
  PidFile := ExpandConstant('{app}\server.pid');

  if FileExists(PidFile) then
  begin
    if LoadStringFromFile(PidFile, PidTextRaw) then
    begin
      PidText := Trim(String(PidTextRaw));
      if PidText <> '' then
      begin
        Exec('taskkill.exe', '/PID ' + PidText + ' /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      end;
    end;

    DeleteFile(PidFile);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopOldServer();
  Result := '';
end;
