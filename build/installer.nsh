!macro customInstall
  ; Check if VC++ 2015-2022 Redistributable is installed (x64)
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} $0 != 1
    DetailPrint "Installing Visual C++ Redistributable..."
    File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
    DetailPrint "VC++ Redistributable installed (exit code: $1)"
  ${Else}
    DetailPrint "Visual C++ Redistributable already installed"
  ${EndIf}
!macroend
