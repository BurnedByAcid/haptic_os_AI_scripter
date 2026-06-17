; HapticAI — NSIS 3.x Installer Script
; Requires NSIS 3.x with MUI2, nsDialogs, LogicLib (all bundled with NSIS 3).
; Run: makensis /DVERSION=v01.01.12 installer.nsi
; Input:  dist\HapticAI.exe   (produced by PyInstaller)
; Output: dist\HapticAI-Setup.exe

Unicode True

; ── NSIS version guard ─────────────────────────────────────────────────────
!ifndef NSIS_VERSION
  !error "Build with NSIS 3.x or later."
!endif

; ── Includes ───────────────────────────────────────────────────────────────
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"       ; for GetSize (EstimatedSize)

; ── Compiler flags ─────────────────────────────────────────────────────────
SetCompressor /SOLID lzma     ; best compression ratio
SetDatablockOptimize on
CRCCheck force

; ── Metadata ───────────────────────────────────────────────────────────────
; GPU_VARIANT is passed in via /DGPU_VARIANT=50series or /DGPU_VARIANT=cpu.
; If not set, this builds the standard (CUDA 12.8 / RTX 30xx–40xx) installer.
!ifndef GPU_VARIANT
  !define GPU_VARIANT "standard"
!endif

!if "${GPU_VARIANT}" == "50series"
  !define APP_NAME      "HapticAI-50series"
  !define APP_FULL_NAME "HapticAI (Beta) — RTX 50 Series"
  !define APP_EXE       "HapticAI-50series.exe"
  !define OUTFILE       "dist\HapticAI-Setup-50series.exe"
  !define REG_KEY       "Software\HapticAI-50series"
  !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HapticAI-50series"
!else if "${GPU_VARIANT}" == "cpu"
  !define APP_NAME      "HapticAI-CPU"
  !define APP_FULL_NAME "HapticAI (Beta) — CPU"
  !define APP_EXE       "HapticAI-CPU.exe"
  !define OUTFILE       "dist\HapticAI-Setup-CPU.exe"
  !define REG_KEY       "Software\HapticAI-CPU"
  !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HapticAI-CPU"
!else
  !define APP_NAME      "HapticAI"
  !define APP_FULL_NAME "HapticAI (Beta)"
  !define APP_EXE       "HapticAI.exe"
  !define OUTFILE       "dist\HapticAI-Setup.exe"
  !define REG_KEY       "Software\HapticAI"
  !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HapticAI"
!endif

!define APP_PUBLISHER "HapticOS"
!define APP_URL       "https://hapticos.org"

; VERSION is passed in via /DVERSION=v01.01.12 from build_windows.bat
!ifndef VERSION
  !define VERSION "v0.0.0"
!endif

Name          "${APP_FULL_NAME}"
OutFile       "${OUTFILE}"
InstallDir    "$PROGRAMFILES64\HapticAI"
InstallDirRegKey HKLM "${REG_KEY}" "InstallDir"

; UAC — request admin for Program Files install
RequestExecutionLevel admin

; ── Windows 10 / 11 compatibility manifest ─────────────────────────────────
; Declares support for modern Windows versions so the OS uses the right
; visual styles, DPI awareness, and heap manager.
ManifestSupportedOS {8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}  ; Windows 10 / 11
ManifestDPIAware true

; ── Windows file-property version info ─────────────────────────────────────
; Shows up in Explorer → Properties → Details tab.
VIProductVersion  "1.0.0.0"
VIAddVersionKey   "ProductName"      "${APP_FULL_NAME}"
VIAddVersionKey   "ProductVersion"   "${VERSION}"
VIAddVersionKey   "CompanyName"      "${APP_PUBLISHER}"
VIAddVersionKey   "LegalCopyright"   "© 2025 ${APP_PUBLISHER}"
VIAddVersionKey   "FileDescription"  "${APP_FULL_NAME} Installer"
VIAddVersionKey   "FileVersion"      "${VERSION}"

; ── MUI2 appearance ────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON    "assets\branding\icon.ico"
!define MUI_UNICON  "assets\branding\icon.ico"

!define MUI_WELCOMEPAGE_TITLE "${APP_FULL_NAME}"
!define MUI_WELCOMEPAGE_TEXT  \
  "Welcome to the ${APP_FULL_NAME} setup wizard.$\r$\n$\r$\n\
HapticAI is an AI-powered haptic script generator that integrates with \
HapticOS. This wizard will install it on your computer and add a Start \
Menu shortcut.$\r$\n$\r$\nClick Next to continue."

!define MUI_FINISHPAGE_RUN           "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT      "Launch ${APP_FULL_NAME}"
!define MUI_FINISHPAGE_LINK          "Open HapticOS"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"

; ── Installer pages ────────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom  DesktopShortcutPage DesktopShortcutLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; ── Uninstaller pages ──────────────────────────────────────────────────────
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Desktop-shortcut custom page ───────────────────────────────────────────
Var DesktopCheckbox
Var CreateDesktopShortcut

Function DesktopShortcutPage
  !insertmacro MUI_HEADER_TEXT "Install Options" "Choose additional tasks."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u \
    "Select whether you would like a shortcut on the Desktop:"
  Pop $0

  ${NSD_CreateCheckbox} 0 30u 100% 12u "Create a Desktop shortcut"
  Pop $DesktopCheckbox
  ${NSD_SetState} $DesktopCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutLeave
  ${NSD_GetState} $DesktopCheckbox $CreateDesktopShortcut
FunctionEnd

; ── Install section ────────────────────────────────────────────────────────
Section "${APP_FULL_NAME}" SecMain
  SectionIn RO

  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "dist\${APP_NAME}\*.*"

  ; Compute installed size for Add/Remove Programs (in KB)
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2

  ; Registry: install location
  WriteRegStr HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "Version"    "${VERSION}"

  ; Registry: Add/Remove Programs — required values
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_FULL_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'

  ; Registry: Add/Remove Programs — recommended values
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLInfoAbout"    "${APP_URL}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "HelpLink"        "${APP_URL}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLUpdateInfo"   "${APP_URL}"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize"   $0
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"        1

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\HapticAI"
  CreateShortcut  "$SMPROGRAMS\HapticAI\${APP_FULL_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut  "$SMPROGRAMS\HapticAI\Uninstall.lnk"        "$INSTDIR\Uninstall.exe"

  ; Optional Desktop shortcut
  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\${APP_FULL_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}
SectionEnd

; ── Uninstall section ──────────────────────────────────────────────────────
Section "Uninstall"
  ; Stop the app if it's running (best-effort via HTTP shutdown)
  ExecWait '"$INSTDIR\${APP_EXE}" --shutdown' $0

  ; Remove all installed files (one-directory PyInstaller bundle)
  RMDir /r "$INSTDIR"

  ; Remove Start Menu shortcuts
  Delete "$SMPROGRAMS\HapticAI\${APP_FULL_NAME}.lnk"
  Delete "$SMPROGRAMS\HapticAI\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\HapticAI"

  ; Remove Desktop shortcut (if it was created)
  Delete "$DESKTOP\${APP_FULL_NAME}.lnk"

  ; Clean registry
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "${REG_KEY}"
SectionEnd
