; AIScripter Inno Setup installer script
[Setup]
AppName=AIScripter
AppVersion=1.0
AppPublisher=HapticOS
AppPublisherURL=https://hapticos.org
DefaultDirName={autopf}\AIScripter
DefaultGroupName=AIScripter
OutputBaseFilename=AIScripter-Setup
OutputDir=dist
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
SetupIconFile=
UninstallDisplayIcon={app}\AIScripter.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\stage\AIScripter.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\stage\engine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AIScripter"; Filename: "{app}\AIScripter.exe"
Name: "{group}\Uninstall AIScripter"; Filename: "{uninstallexe}"
Name: "{autodesktop}\AIScripter"; Filename: "{app}\AIScripter.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\AIScripter.exe"; Description: "Launch AIScripter"; Flags: nowait postinstall skipifsilent
