# One-time setup of the graphics temperature cap. Run it from an ADMINISTRATOR PowerShell
# (or right-click Setup-Governor.cmd and choose Run as administrator).
# It makes a scheduled task that starts scripts\gpu-governor.ps1 hidden at every sign-in.
# Undo with: Setup-Governor.cmd remove
param([switch]$Remove)

$taskName = 'Jarvis GPU Governor'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'This needs administrator rights. Right-click Setup-Governor.cmd and choose Run as administrator.' -ForegroundColor Yellow
  exit 1
}

if ($Remove) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  & nvidia-smi -rgc 2>$null | Out-Null
  Write-Host 'Removed. Normal graphics clocks are back.'
  exit 0
}

$root = Split-Path $PSScriptRoot -Parent
$me = "$env:USERDOMAIN\$env:USERNAME"
$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\gpu-governor.ps1`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'Done. The graphics temperature cap is ready. Turn it on from the phone page: Gaming mode, or the GPU cap switch.'
Write-Host 'It only changes the card while the cap is on, and puts normal clocks back when it is off. To undo: Setup-Governor.cmd remove'
