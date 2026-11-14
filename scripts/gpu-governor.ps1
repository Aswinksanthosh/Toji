# Keeps the graphics card at or under a temperature (default 70 C) by lowering its top clock
# speed when it gets too hot and raising it again when it cools. It runs in the background,
# started at sign-in by Setup-Governor.cmd, and needs administrator rights only because
# "nvidia-smi -lgc" does (the same step the Jarvis graphics cap uses).
#
# It does nothing until the phone page turns the cap on. The page writes
# ~/.jarvis/gpu-governor.json: { "enabled": true, "target": 70 }.
# When the cap is off, the normal clocks are put back.

$ErrorActionPreference = 'SilentlyContinue'
$file = Join-Path $env:USERPROFILE '.jarvis\gpu-governor.json'
$smi = (Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source
if (-not $smi) { $smi = Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe' }
if (-not (Test-Path $smi)) { $smi = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe' }
if (-not (Test-Path $smi)) { exit 1 }

function Query([string]$field) {
  $out = & $smi "--query-gpu=$field" --format=csv,noheader,nounits 2>$null | Select-Object -First 1
  $n = 0
  if ([int]::TryParse(([string]$out).Trim(), [ref]$n)) { return $n }
  return $null
}

$hwMax = Query 'clocks.max.graphics'
if (-not $hwMax -or $hwMax -lt 600) { exit 1 }
$floor = 900          # never ask for less than this, so games stay playable
$cap = $hwMax
$applied = $null

try {
  while ($true) {
    $enabled = $false
    $target = 70
    try {
      $cfg = Get-Content $file -Raw | ConvertFrom-Json
      $enabled = ($cfg.enabled -eq $true)
      $target = [Math]::Min([Math]::Max([int]$cfg.target, 60), 85)
    } catch { }

    if ($enabled) {
      $t = Query 'temperature.gpu'
      if ($t -ne $null) {
        if ($t -ge $target) { $cap = [Math]::Max($floor, $cap - 105) }
        elseif ($t -le ($target - 4)) { $cap = [Math]::Min($hwMax, $cap + 45) }
      }
      if ($cap -ne $applied) {
        & $smi -lgc "300,$cap" | Out-Null
        $applied = $cap
      }
      Start-Sleep -Seconds 3
    } else {
      if ($applied -ne $null) {
        & $smi -rgc | Out-Null
        $applied = $null
        $cap = $hwMax
      }
      Start-Sleep -Seconds 5
    }
  }
}
finally {
  & $smi -rgc | Out-Null
}
