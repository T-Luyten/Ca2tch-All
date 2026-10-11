# Creates a Ca2tchAll desktop shortcut (with icon) that runs start.bat.
# Right-click this file -> "Run with PowerShell". Re-run if you move the project folder.
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Ca2tchAll.lnk")
$Shortcut.TargetPath = "$ProjectDir\start.bat"
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.IconLocation = "$ProjectDir\Ca2tchAll.ico"
$Shortcut.Description = "Start Ca2tchAll"
$Shortcut.Save()
Write-Host "Desktop shortcut 'Ca2tchAll' created."
