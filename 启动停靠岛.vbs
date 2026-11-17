Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

appName = ChrW(&H505C) & ChrW(&H9760) & ChrW(&H5C9B)
exeName = appName & ".exe"
packagedExe = dir & "\release\" & appName & "\" & exeName
devExe = dir & "\node_modules\electron\dist\electron.exe"

Sub VisitMatchingProcesses(shouldTerminate, foundFlag)
  Dim svc, procs, p, cmd
  foundFlag = False
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = svc.ExecQuery("SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE Name = '" & exeName & "' OR Name = 'electron.exe'")
  For Each p In procs
    cmd = "" & p.CommandLine
    If LCase(p.Name) = LCase(exeName) Or InStr(1, cmd, dir, 1) > 0 Then
      foundFlag = True
      If shouldTerminate Then
        On Error Resume Next
        p.Terminate()
        On Error GoTo 0
      End If
    End If
  Next
End Sub

Sub RestartOldInstance()
  Dim running, i
  VisitMatchingProcesses False, running
  If Not running Then Exit Sub

  If fso.FileExists(packagedExe) Then
    sh.Run """" & packagedExe & """ --quit", 0, True
  ElseIf fso.FileExists(devExe) Then
    sh.Run """" & devExe & """ . --quit", 0, True
  End If

  For i = 1 To 12
    VisitMatchingProcesses False, running
    If Not running Then Exit Sub
    WScript.Sleep 100
  Next

  VisitMatchingProcesses True, running
  WScript.Sleep 150
End Sub

RestartOldInstance()

If fso.FileExists(packagedExe) Then
  sh.Run """" & packagedExe & """", 1, False
ElseIf fso.FileExists(devExe) Then
  If Not fso.FileExists(dir & "\out\main\index.js") Then
    sh.Run "cmd /c npm.cmd run build", 0, True
  End If
  sh.Run """" & devExe & """ .", 0, False
Else
  MsgBox "Missing app binary. Please run: npm run package", 48, "Pocket Isle"
End If
