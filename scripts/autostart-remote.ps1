# Starts the phone remote buttons by themselves when you sign in to Windows. No AI, no browser,
# a hidden window, tiny use of CPU and memory. Run again to replace it; run with -Remove to undo.
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Jarvis Remote Buttons.lnk'

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link -Force; Write-Host 'Removed. The remote buttons no longer start at sign-in.' }
  else { Write-Host 'It was not set up.' }
  exit 0
}

$root = Split-Path $PSScriptRoot -Parent
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = 'powershell.exe'
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\remote.ps1`""
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'Jarvis phone remote buttons (no AI)'
$s.Save()
Write-Host "Done. The remote buttons will start by themselves at your next sign-in."
Write-Host "To see errors or test now, double-click Remote.cmd. To undo: Autostart-Remote.cmd remove"
