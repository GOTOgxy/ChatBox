!macro preInit
  ${If} ${Silent}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
  ${EndIf}
!macroend

!macro customInit
  ${If} ${Silent}
    nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Sleep 800
  ${Else}
    FindWindow $0 "" "${PRODUCT_NAME}"
    ${If} $0 != 0
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到 ${PRODUCT_NAME} 正在运行,点击「确定」将自动关闭并继续安装。" IDOK closeApp IDCANCEL abortInstall
      closeApp:
        nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
        Sleep 800
      Goto done
      abortInstall:
        Abort
      done:
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${Silent}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${EndIf}
!macroend

!macro customRemoveFiles
  CreateDirectory "$PLUGINSDIR\old-install"
  Push ""
  Call un.atomicRMDir
  Pop $R0
  ${if} $R0 != 0
    Push ""
    Call un.restoreFiles
    Pop $R0
    Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
  ${endif}
  SetOutPath $TEMP
  RMDir /r $INSTDIR
!macroend

!macro customUnInit
!macroend
