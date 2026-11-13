# Starts the phone remote buttons. Reads your saved settings first, so a double-click works.
Set-Location (Split-Path $PSScriptRoot -Parent)
$saved = [Environment]::GetEnvironmentVariables('User')
foreach ($name in $saved.Keys) {
  if ($name -match '^JARVIS_' -and -not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    [Environment]::SetEnvironmentVariable($name, [string]$saved[$name], 'Process')
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed. Get it from https://nodejs.org' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path 'node_modules')) { & npm.cmd install }
& node scripts\remote.mjs
