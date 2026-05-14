; HapticAI (Beta) — NSIS Installer Script
; Requires NSIS 3.x with MUI2 and nsDialogs plugins (included by default).
; Run: makensis installer.nsi   (from the hapticai-server directory)
; Input:  dist\HapticAI.exe   (produced by PyInstaller)
; Output: dist\HapticAI-Setup.exe

Unicode True
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

;------------------------------------------------------------------
; Basic metadata
;------------------------------------------------------------------
!define APP_NAME      "HapticAI (Beta)"
!define APP_EXE       "HapticAI.exe"
!define REG_KEY       "Software\HapticAI"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HapticAI"

Name          "${APP_NAME}"
OutFile       "dist\HapticAI-Setup.exe"
InstallDir    "$PROGRAMFILES64\HapticAI"
InstallDirRegKey HKLM "${REG_KEY}" "InstallDir"

RequestExecutionLevel admin

;------------------------------------------------------------------
; MUI appearance
;------------------------------------------------------------------
!define MUI_ABORTWARNING
!define MUI_ICON    "assets\branding\icon.ico"
!define MUI_UNICON  "assets\branding\icon.ico"

!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT  \
  "Welcome to the ${APP_NAME} setup wizard.$\r$\n$\r$\n\
HapticAI is an AI-powered haptic script generator. This wizard will \
install it on your computer and add a Start Menu shortcut.$\r$\n$\r$\n\
Click Next to continue."

!define MUI_FINISHPAGE_RUN          "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT     "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME   ""
!define MUI_FINISHPAGE_LINK         "Visit HapticOS"
!define MUI_FINISHPAGE_LINK_LOCATION "https://hapticos.replit.app"

;------------------------------------------------------------------
; Installer pages
;------------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom  DesktopShortcutPage DesktopShortcutLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

;------------------------------------------------------------------
; Uninstaller pages
;------------------------------------------------------------------
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

;------------------------------------------------------------------
; Desktop-shortcut custom page
;------------------------------------------------------------------
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

;------------------------------------------------------------------
; Install section
;------------------------------------------------------------------
Section "HapticAI" SecMain
  SectionIn RO

  SetOutPath "$INSTDIR"
  File "dist\${APP_EXE}"

  ; Registry: install location
  WriteRegStr HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"

  ; Registry: Add/Remove Programs entry
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"       "HapticAI"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "$%HAPTICAI_VERSION%"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLInfoAbout"    "https://hapticos.replit.app"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"        1

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\HapticAI"
  CreateShortcut  "$SMPROGRAMS\HapticAI\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut  "$SMPROGRAMS\HapticAI\Uninstall.lnk"   "$INSTDIR\Uninstall.exe"

  ; Optional Desktop shortcut
  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}
SectionEnd

;------------------------------------------------------------------
; Uninstall section
;------------------------------------------------------------------
Section "Uninstall"
  ; Remove the main exe and uninstaller
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Uninstall.exe"

  ; Leave the models/ folder — users may want to keep their downloaded models.
  ; Remove the install dir only if empty.
  RMDir "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\HapticAI\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\HapticAI\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\HapticAI"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Clean registry
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "${REG_KEY}"
SectionEnd
