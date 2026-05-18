; ============================================================
; Shiira Browser - Custom Dark Theme Installer
; Modern wizard-style installer with dark theming
; ============================================================

; Note: MUI2.nsh and icons are already included by electron-builder
; Only include additional NSIS libraries we need
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"

; ===== SHIIRA NIGHT THEME COLORS =====
; Background: #020308 (super dark)
; Text: #F2FBFF (cool white)  
; Accent: #28D7EF (Shiira cyan)
; ===================================

; Variables
Var IsUpdate
Var RelaunchAfterUpdate

; Note: MUI_ICON and MUI_UNICON are defined by electron-builder
; We only configure additional MUI settings here

; Custom branding (shown at bottom of installer)
BrandingText "Shiira Project (C) 2026"

; ===== CUSTOM MACROS =====

; Enable Windows 10/11 dark mode for installer window
!macro customInit
    ; Check if this is a silent update (auto-updater passes /S flag)
    ${GetParameters} $0
    ${GetOptions} $0 "/S" $1
    ${If} ${Errors}
        StrCpy $IsUpdate "0"
    ${Else}
        StrCpy $IsUpdate "1"
    ${EndIf}
    
    ; Check for relaunch flag
    ${GetOptions} $0 "/relaunch" $1
    ${If} ${Errors}
        StrCpy $RelaunchAfterUpdate "0"
    ${Else}
        StrCpy $RelaunchAfterUpdate "1"
    ${EndIf}
    
    ; Enable dark mode title bar on Windows 10+
    ${If} ${AtLeastWin10}
        System::Call 'dwmapi::DwmSetWindowAttribute(i $HWNDPARENT, i 20, *i 1, i 4)'
    ${EndIf}
!macroend

; After installation completes
!macro customInstall
    ; If this is a silent update with relaunch flag, start the app
    ${If} $RelaunchAfterUpdate == "1"
        ; Small delay to ensure files are written
        Sleep 1000
        Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${EndIf}
!macroend

; Custom uninstaller initialization
!macro customUnInit
    ; Enable dark mode for uninstaller too
    ${If} ${AtLeastWin10}
        System::Call 'dwmapi::DwmSetWindowAttribute(i $HWNDPARENT, i 20, *i 1, i 4)'
    ${EndIf}
!macroend

; ===== BULLET POINT FOR LISTS =====
!define BULLET "•"


