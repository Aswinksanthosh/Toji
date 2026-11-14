# Starts the phone remote buttons by themselves when you sign in to Windows, even when Windows
# starts in Xbox full screen mode (a scheduled task at sign-in does not wait for the desktop).
# No AI, no browser, a hidden window, tiny use of CPU and memory.
# Run again to replace it; run with -Remove to undo.
param([switch]$Remove)

$taskName = 'Jarvis Remote Buttons'
$link = Join-Path ([Environment]::GetFolderPath('Startup')) "$taskName.lnk"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $link) { Remove-Item $link -Force }
  Write-Host 'Removed. The remote buttons no longer start at sign-in.'
  exit 0
}

$root = Split-Path $PSScriptRoot -Parent
$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\remote.ps1`""
$me = "$env:USERDOMAIN\$env:USERNAME"

try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  # The task replaces the older Startup-folder shortcut, so it would not start twice.
  if (Test-Path $link) { Remove-Item $link -Force }
  Write-Host 'Done. The remote buttons will start by themselves at every sign-in, also in Xbox mode.'
}
catch {
  Write-Host "Could not make the scheduled task: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host 'Falling back to the Startup folder (starts only after the normal desktop loads).'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = 'powershell.exe'
  $s.Arguments = $psArgs
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7
  $s.Description = 'Jarvis phone remote buttons (no AI)'
  $s.Save()
  Write-Host 'Tip: right-click Autostart-Remote.cmd and Run as administrator to get the scheduled task.'
}
Write-Host 'To see errors or test now, double-click Remote.cmd. To undo: Autostart-Remote.cmd remove'
