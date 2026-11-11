# Starts Jarvis with the graphics card's top clock speed capped while it runs,
# then puts normal clocks back when you stop it.
#
#   npm run start:cool                     cap at 1500 MHz (change with JARVIS_GPU_MAX_MHZ)
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

$mhz = 1500
if ($env:JARVIS_GPU_MAX_MHZ) { $mhz = [int]$env:JARVIS_GPU_MAX_MHZ }

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
  Write-Host ("Capping the graphics card at {0} MHz while Jarvis runs (click Yes on the Windows prompt)." -f $mhz)
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
