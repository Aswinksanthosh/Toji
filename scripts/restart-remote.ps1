# Restarts the phone remote: stops its scheduled task and any leftover copy, then starts the task again.
# The remote starts this through Windows (WMI) so it runs OUTSIDE the task. You can also run it by hand to see errors:
#   powershell -ExecutionPolicy Bypass -File scripts\restart-remote.ps1 -Root C:\path\to\Toji
param([string]$Root = (Split-Path $PSScriptRoot -Parent), [string]$Task = 'Jarvis Remote Buttons')
$log = Join-Path $env:USERPROFILE '.jarvis\restart.log'
function Note($m) {
  try { New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null; Add-Content -Path $log -Value ((Get-Date -Format s) + '  ' + $m) } catch {}
  Write-Host $m
}
Note ('helper started (root ' + $Root + ', task ' + $Task + ')')
Start-Sleep -Seconds 2
$t = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
Note ('task found: ' + [bool]$t)
if ($t) { try { Stop-ScheduledTask -TaskName $Task -ErrorAction Stop; Note 'task stopped' } catch { Note ('stop failed: ' + $_.Exception.Message) } }
$n = 0
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'remote\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
Note ('stopped ' + $n + ' leftover node process(es)')
Start-Sleep -Seconds 2
try {
  if ($t) { Start-ScheduledTask -TaskName $Task -ErrorAction Stop; Note 'task started' }
  else { Start-Process node -ArgumentList 'scripts\remote.mjs' -WorkingDirectory $Root -WindowStyle Hidden; Note 'started node directly' }
} catch { Note ('start failed: ' + $_.Exception.Message) }
