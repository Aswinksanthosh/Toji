# Starts Jarvis with the graphics card's power limit lowered while it runs, then
# puts the old limit back when you stop it.
#
#   npm run start:cool                     70 W (change with JARVIS_GPU_WATTS)
#   npm run start:cool -- --writes         pass options through to Jarvis
#
# Only the two small nvidia-smi steps ask for administrator permission (a
# Windows prompt, at the start and at the end). Jarvis itself runs as you.
# NVIDIA power limits are for the whole card, so other programs are also held
# to it for as long as Jarvis is running.

param([Parameter(ValueFromRemainingArguments = $true)] $JarvisArgs)

$watts = 70
if ($env:JARVIS_GPU_WATTS) { $watts = [int]$env:JARVIS_GPU_WATTS }

function Get-Limit {
  $out = & nvidia-smi --query-gpu=power.limit --format=csv,noheader,nounits 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  return [int][math]::Round([double]($out | Select-Object -First 1))
}

function Set-Limit([int]$w) {
  try {
    $p = Start-Process -FilePath 'nvidia-smi' -ArgumentList @('-pl', "$w") -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    return ($p.ExitCode -eq 0)
  } catch {
    return $false
  }
}

$original = Get-Limit
$changed = $false

if ($null -eq $original) {
  Write-Host "nvidia-smi was not found, so no power limit can be set. Starting Jarvis normally."
} else {
  Write-Host ("Graphics power limit is {0} W. Lowering it to {1} W while Jarvis runs." -f $original, $watts)
  if (Set-Limit $watts) {
    $now = Get-Limit
    if ($now -eq $watts) {
      $changed = $true
      Write-Host ("Now limited to {0} W." -f $now)
    } else {
      Write-Host ("The card reports {0} W, not {1} W. Your laptop may not accept the change." -f $now, $watts)
      $changed = $true
    }
  } else {
    Write-Host "Could not change the limit (permission refused, or the laptop blocks it). Starting Jarvis normally."
  }
}

try {
  & npm.cmd start -- @JarvisArgs
}
finally {
  if ($changed -and $null -ne $original) {
    Write-Host ("Putting the graphics power limit back to {0} W." -f $original)
    if (-not (Set-Limit $original)) {
      Write-Host ("Could not restore it. Run this in an administrator PowerShell: nvidia-smi -pl {0}" -f $original)
    }
  }
}
