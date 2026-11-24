!macro customInit
  ${If} ${Silent}
    nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}"'
    Sleep 800
  ${Else}
    FindWindow $0 "" "${PRODUCT_NAME}"
    ${If} $0 != 0
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到 ${PRODUCT_NAME} 正在运行,点击「确定」将自动关闭并继续安装。" IDOK closeApp IDCANCEL abortInstall
      closeApp:
        nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}"'
        Sleep 800
      Goto done
      abortInstall:
        Abort
      done:
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInit
  MessageBox MB_YESNO|MB_ICONQUESTION "是否保留个人配置与登录态?$\n$\n「是」= 保留(重装后配置还在)$\n「否」= 彻底清理(删除全部个人数据)" IDYES keepData IDNO removeData
  removeData:
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Run\${PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.chatai.cookie_import"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.chatai.cookie_import"
  keepData:
!macroend
