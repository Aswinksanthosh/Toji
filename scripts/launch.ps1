# One-click launcher: gets everything Jarvis needs running, then opens it.
#
#   - checks Node.js, installs dependencies on the first run (and after updates)
#   - starts Ollama if it is not running, and downloads the model if missing
#   - opens Chrome on Jarvis as soon as it is ready
#   - runs Jarvis with the graphics clock cap (turn off with JARVIS_GPU_CAP=0)
#
# Double-click Jarvis.cmd in the project folder, or pass options through, e.g.
#   Jarvis.cmd --writes
#
# Settings (all optional, set as environment variables):
#   JARVIS_BRAIN          ollama (default here), gemini or claude
#   JARVIS_OLLAMA_MODEL   default qwen3:4b
#   JARVIS_GPU_CAP        0 to skip the graphics clock cap
#   JARVIS_GPU_MAX_MHZ    the cap, default 1500

param([Parameter(ValueFromRemainingArguments = $true)] $JarvisArgs)

Set-Location (Split-Path $PSScriptRoot -Parent)

function Say($text) { Write-Host "[launcher] $text" }
function Fail($text) {
  Write-Host "[launcher] $text" -ForegroundColor Red
  exit 1
}

# Settings saved with SetEnvironmentVariable(..., "User") are not seen by programs
# started from an already-running Explorer (a double-click). Read them from the
# saved values here, so a double-click behaves the same as a fresh PowerShell.
$saved = [Environment]::GetEnvironmentVariables('User')
foreach ($name in $saved.Keys) {
  if ($name -match '^(JARVIS_|GEMINI_API_KEY$|GOOGLE_API_KEY$)' -and -not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    [Environment]::SetEnvironmentVariable($name, [string]$saved[$name], 'Process')
  }
}

$url = 'http://localhost:5173'
$model = 'qwen3:4b'
if ($env:JARVIS_OLLAMA_MODEL) { $model = $env:JARVIS_OLLAMA_MODEL }
$useCap = $env:JARVIS_GPU_CAP -ne '0'

# 1. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js is not installed. Get it from https://nodejs.org and run this again.'
}

# 2. Dependencies: first run, or package.json changed since the last install.
$marker = 'node_modules\.package-lock.json'
$needInstall = (-not (Test-Path $marker)) -or ((Get-Item 'package.json').LastWriteTime -gt (Get-Item $marker).LastWriteTime)
if ($needInstall) {
  Say 'Installing dependencies. This takes a few minutes the first time.'
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
}

# 3. The brain. Local by default; set JARVIS_BRAIN to use another.
function Test-Ollama {
  try {
    Invoke-WebRequest 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

# Makes sure Ollama is running and the model is downloaded. When it is only
# needed for the phone page (not as the main brain), problems are warnings, not stops.
function Start-OllamaBrain([bool]$required) {
  $problem = {
    param($text)
    if ($required) { Fail $text } else { Say ("Phone page: " + $text); return $false }
  }
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    return (& $problem 'Ollama is not installed. Get it from https://ollama.com/download and run this again.')
  }
  if (-not (Test-Ollama)) {
    Say 'Starting Ollama.'
    Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 0; $i -lt 20 -and -not (Test-Ollama); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Ollama)) { return (& $problem 'Ollama did not start.') }
  }
  $installed = (& ollama list) -join "`n"
  if ($installed -notmatch [regex]::Escape($model)) {
    Say ("Downloading the model {0}. This only happens once." -f $model)
    & ollama pull $model
    if ($LASTEXITCODE -ne 0) { return (& $problem 'Could not download the model.') }
  }
  $env:JARVIS_OLLAMA_MODEL = $model
  return $true
}

$hasGeminiKey = [bool]($env:GEMINI_API_KEY -or $env:GOOGLE_API_KEY)

if ($env:JARVIS_BRAIN -eq 'gemini') {
  if (-not $hasGeminiKey) {
    Fail 'No Gemini key found. Create a free one at https://aistudio.google.com and save it as GEMINI_API_KEY.'
  }
  Say 'Using the Gemini brain (online).'
} elseif ($env:JARVIS_BRAIN -eq 'claude') {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Fail 'The Claude brain needs Claude Code installed and logged in: npm install -g @anthropic-ai/claude-code, then run claude once.'
  }
  Say 'Using the Claude brain (online, uses your Claude subscription).'
  # The phone page cannot use Claude. It uses Gemini if you have a key, otherwise
  # your free local model, which is started here.
  if ($env:JARVIS_PHONE_PASSWORD -and -not $hasGeminiKey) {
    Say 'No Gemini key, so the phone page will use your local model.'
    [void](Start-OllamaBrain $false)
  }
} else {
  $env:JARVIS_BRAIN = 'ollama'
  [void](Start-OllamaBrain $true)
  Say ("Local brain ready: {0}." -f $model)
}

# 4. Open Chrome once Jarvis answers. Chrome specifically, because the browser
# speech recognition Jarvis uses does not work in every browser.
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$opener = Start-Job -ArgumentList $url, $chrome -ScriptBlock {
  param($u, $c)
  for ($i = 0; $i -lt 90; $i++) {
    try {
      Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if ($c) { Start-Process $c -ArgumentList $u } else { Start-Process $u }
}

# 5. Run Jarvis, in the foreground. Closing this window stops everything.
# The graphics cap only matters for the local brain; the online brains use no GPU.
if ($env:JARVIS_BRAIN -ne 'ollama') { $useCap = $false }
Say 'Starting Jarvis. Press Ctrl-C in this window to stop.'
try {
  if ($useCap) {
    & "$PSScriptRoot\start-limited.ps1" @JarvisArgs
  } else {
    & npm.cmd start -- @JarvisArgs
  }
}
finally {
  Stop-Job $opener -ErrorAction SilentlyContinue
  Remove-Job $opener -Force -ErrorAction SilentlyContinue
}
