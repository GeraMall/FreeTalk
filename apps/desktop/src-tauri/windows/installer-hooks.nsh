; Keep upgrades from the legacy FreeTalk package on the same installation path.
; beta.169 renamed the product to Trlka, which changed NSIS' default directory
; from %LOCALAPPDATA%\FreeTalk to %LOCALAPPDATA%\Trlka. Without this bridge,
; the old shortcut keeps launching the untouched legacy executable.
!macro NSIS_HOOK_PREINSTALL
  StrCpy $9 ""
  ReadRegStr $9 HKCU "Software\FreeTalk contributors\FreeTalk" ""
  ${If} $9 == ""
    StrCpy $9 "$LOCALAPPDATA\FreeTalk"
  ${EndIf}

  ${If} ${FileExists} "$9\freetalk.exe"
    StrCpy $INSTDIR "$9"
    SetOutPath "$INSTDIR"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The Trlka registration written by the main installer is now authoritative.
  ; Remove only the legacy registration; the working shortcut may stay because
  ; it targets the executable that has just been replaced with the new version.
  ${If} $INSTDIR == "$LOCALAPPDATA\FreeTalk"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeTalk"
    DeleteRegKey HKCU "Software\FreeTalk contributors\FreeTalk"
  ${EndIf}
!macroend
