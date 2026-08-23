Unicode true
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef APP_EXE
  !error "APP_EXE is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef WEBVIEW_BOOTSTRAPPER
  !error "WEBVIEW_BOOTSTRAPPER is required"
!endif
!ifndef APP_ICON
  !error "APP_ICON is required"
!endif

Name "FreeTalk"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\FreeTalk"
InstallDirRegKey HKCU "Software\FreeTalk" "InstallDir"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
BrandingText "FreeTalk 0.2.0"
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_WELCOMEPAGE_TITLE "Установка FreeTalk"
!define MUI_WELCOMEPAGE_TEXT "FreeTalk — приватные голосовые комнаты для небольших компаний.$\r$\n$\r$\nУстановщик проверит Microsoft Edge WebView2 Runtime."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

Section "FreeTalk" SecMain
  SetOutPath "$INSTDIR"
  File /oname=FreeTalk.exe "${APP_EXE}"
  File /oname=WebView2Bootstrapper.exe "${WEBVIEW_BOOTSTRAPPER}"

  DetailPrint "Проверка Microsoft Edge WebView2 Runtime..."
  SetRegView 64
  ReadRegStr $1 HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $1 == ""
    SetRegView 32
    ReadRegStr $1 HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $1 == ""
    ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  StrCpy $0 0
  ${If} $1 == ""
    DetailPrint "WebView2 Runtime не найден; запускается официальный bootstrapper Microsoft..."
    ExecWait '"$INSTDIR\WebView2Bootstrapper.exe" /silent /install' $0
  ${Else}
    DetailPrint "Найден WebView2 Runtime $1"
  ${EndIf}
  Delete "$INSTDIR\WebView2Bootstrapper.exe"
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Не удалось установить Microsoft Edge WebView2 Runtime (код $0). FreeTalk может не запуститься без WebView2. Повторите установку с подключением к интернету или установите WebView2 с сайта Microsoft."
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\FreeTalk" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "DisplayName" "FreeTalk"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "DisplayVersion" "0.2.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "Publisher" "FreeTalk contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "DisplayIcon" "$INSTDIR\FreeTalk.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\FreeTalk"
  CreateShortcut "$SMPROGRAMS\FreeTalk\FreeTalk.lnk" "$INSTDIR\FreeTalk.exe"
  CreateShortcut "$SMPROGRAMS\FreeTalk\Удалить FreeTalk.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\FreeTalk.exe"
  Delete "$INSTDIR\WebView2Bootstrapper.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\FreeTalk\FreeTalk.lnk"
  Delete "$SMPROGRAMS\FreeTalk\Удалить FreeTalk.lnk"
  RMDir "$SMPROGRAMS\FreeTalk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk"
  DeleteRegKey HKCU "Software\FreeTalk"
SectionEnd
