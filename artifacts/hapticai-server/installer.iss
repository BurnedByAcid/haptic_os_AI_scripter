; HapticAI — Inno Setup 6 Installer Script
; Requires Inno Setup 6 (64-bit ISCC.exe — handles large PyTorch/CUDA bundles)
; Run: iscc /DVERSION=v01.01.12 installer.iss
;      iscc /DVERSION=v01.01.12 /DGPU_VARIANT=50series installer.iss
;      iscc /DVERSION=v01.01.12 /DGPU_VARIANT=cpu installer.iss
; Input:  dist\HapticAI\         (one-dir PyInstaller bundle)
; Output: dist\HapticAI-Setup.exe

; ── GPU variant selection ────────────────────────────────────────────────────
#ifndef GPU_VARIANT
  #define GPU_VARIANT "standard"
#endif

#if GPU_VARIANT == "50series"
  #define APP_FULL_NAME "HapticAI (Beta) — RTX 50 Series"
  #define APP_EXE       "HapticAI-50series.exe"
  #define APP_DIR       "HapticAI-50series"
  #define OUT_BASE      "HapticAI-Setup-50series"
#elif GPU_VARIANT == "cpu"
  #define APP_FULL_NAME "HapticAI (Beta) — CPU"
  #define APP_EXE       "HapticAI-CPU.exe"
  #define APP_DIR       "HapticAI-CPU"
  #define OUT_BASE      "HapticAI-Setup-CPU"
#else
  #define APP_FULL_NAME "HapticAI (Beta)"
  #define APP_EXE       "HapticAI.exe"
  #define APP_DIR       "HapticAI"
  #define OUT_BASE      "HapticAI-Setup"
#endif

#ifndef VERSION
  #define VERSION "v0.0.0"
#endif

; ── [Setup] ──────────────────────────────────────────────────────────────────
[Setup]
AppName={#APP_FULL_NAME}
AppVersion={#VERSION}
AppPublisher=HapticOS
AppPublisherURL=https://hapticos.org
AppSupportURL=https://hapticos.org
AppUpdatesURL=https://hapticos.org
DefaultDirName={autopf}\HapticAI
DefaultGroupName=HapticAI
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename={#OUT_BASE}
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=assets\branding\icon.ico
UninstallDisplayIcon={app}\{#APP_EXE}
UninstallDisplayName={#APP_FULL_NAME}

; ── [Languages] ─────────────────────────────────────────────────────────────
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── [Tasks] ──────────────────────────────────────────────────────────────────
[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; \
  GroupDescription: "Additional icons:"; Flags: unchecked

; ── [Files] ──────────────────────────────────────────────────────────────────
[Files]
Source: "dist\{#APP_DIR}\*"; DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; ── [Icons] ──────────────────────────────────────────────────────────────────
[Icons]
Name: "{group}\{#APP_FULL_NAME}";           Filename: "{app}\{#APP_EXE}"
Name: "{group}\Uninstall {#APP_FULL_NAME}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#APP_FULL_NAME}";   Filename: "{app}\{#APP_EXE}"; \
  Tasks: desktopicon

; ── [Run] ─────────────────────────────────────────────────────────────────────
[Run]
Filename: "{app}\{#APP_EXE}"; \
  Description: "Launch {#APP_FULL_NAME}"; \
  Flags: nowait postinstall skipifsilent
