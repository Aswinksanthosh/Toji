# Starts Jarvis with the graphics card's top clock speed capped while it runs,
# then puts normal clocks back when you stop it.
#
#   npm run start:cool                     cap at 80% of the card's top speed
#                                          (change with JARVIS_GPU_PERCENT, or set an exact
#                                          speed with JARVIS_GPU_MAX_MHZ)
#   npm run start:cool -- --writes         pass options through to Jarvis
#
# Why clocks and not a power limit: many laptops refuse "nvidia-smi -pl" but
# still allow "-lgc". Lower top clock means lower power and heat.
#
# Only the two small nvidia-smi steps ask for administrator permission (a
# Windows prompt, at the start and at the end). Jarvis itself runs as you.
# The cap is for the whole card, so other programs are held to it for as long
# as Jarvis is running.

param([Parameter(ValueFromRemainingArguments = $true)] $JarvisArgs)

$percent = 80
if ($env:JARVIS_GPU_PERCENT) { $percent = [Math]::Min([Math]::Max([int]$env:JARVIS_GPU_PERCENT, 30), 100) }
$mhz = 0
if ($env:JARVIS_GPU_MAX_MHZ) { $mhz = [int]$env:JARVIS_GPU_MAX_MHZ }

# The card's top graphics speed, so a percentage means something.
function Get-MaxClock {
  $out = & nvidia-smi --query-gpu=clocks.max.graphics --format=csv,noheader,nounits 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  $n = 0
  if ([int]::TryParse(([string]($out | Select-Object -First 1)).Trim(), [ref]$n) -and $n -gt 0) { return $n }
  return $null
}

function Invoke-Elevated([string[]]$smiArgs) {
  try {
    $p = Start-Process -FilePath 'nvidia-smi' -ArgumentList $smiArgs -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    return ($p.ExitCode -eq 0)
  } catch {
    return $false
  }
}

$changed = $false

if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
  Write-Host "nvidia-smi was not found, so the graphics card cannot be capped. Starting Jarvis normally."
} else {
  if ($mhz -eq 0) {
    $max = Get-MaxClock
    if ($max) {
      $mhz = [int][Math]::Max([Math]::Round($max * $percent / 100), 500)
      Write-Host ("The card's top speed is {0} MHz. Capping it at {1}% = {2} MHz while Jarvis runs (click Yes on the Windows prompt)." -f $max, $percent, $mhz)
    } else {
      $mhz = 1500
      Write-Host "Could not read the card's top speed, so using a fixed cap of 1500 MHz (click Yes on the Windows prompt)."
    }
  } else {
    Write-Host ("Capping the graphics card at {0} MHz while Jarvis runs (click Yes on the Windows prompt)." -f $mhz)
  }
  if (Invoke-Elevated @('-lgc', "300,$mhz")) {
    $changed = $true
    Write-Host "Cap applied. To check it under load, in another window run:"
    Write-Host "  nvidia-smi --query-gpu=clocks.gr,power.draw --format=csv -l 2"
  } else {
    Write-Host "Could not apply the cap (permission refused, or the laptop blocks it). Starting Jarvis normally."
  }
}

try {
  & npm.cmd start -- @JarvisArgs
}
finally {
  if ($changed) {
    Write-Host "Restoring normal graphics clocks."
    if (-not (Invoke-Elevated @('-rgc'))) {
      Write-Host "Could not restore them. Run this in an administrator PowerShell: nvidia-smi -rgc"
    }
  }
}
