# Guided phone setup. You choose the password in a hidden prompt, so it never
# appears on screen, in a command line, or in a chat. Saves the settings for
# your Windows user; every Jarvis launcher then turns the phone page on.

function Read-Plain($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ''
Write-Host 'Phone setup. Your password stays on this laptop, in your Windows user settings.'
$answer = Read-Host 'Let the phone CONTROL this laptop (open apps, type, click, change files)? y/n'
$control = $answer -match '^(y|yes)$'
$min = 8
if ($control) { $min = 12 }

do {
  $one = Read-Plain ("Choose a password (at least $min characters)")
  $two = Read-Plain 'Type it again'
  if ($one.Length -lt $min) { Write-Host "Too short: it needs at least $min characters." -ForegroundColor Yellow }
  elseif ($one -cne $two) { Write-Host 'The two did not match. Try again.' -ForegroundColor Yellow }
  else { break }
} while ($true)

[Environment]::SetEnvironmentVariable('JARVIS_PHONE_PASSWORD', $one, 'User')
if ($control) {
  [Environment]::SetEnvironmentVariable('JARVIS_PHONE_WRITES', '1', 'User')
} else {
  [Environment]::SetEnvironmentVariable('JARVIS_PHONE_WRITES', $null, 'User')
}

Write-Host ''
Write-Host 'Saved. Start Jarvis with any launcher and look for the "wifi phone page on" line.'
Write-Host 'Open one of these on your phone:'
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if ($tailscale) {
  $ip = (& tailscale ip -4 2>$null | Select-Object -First 1)
  if ($ip) { Write-Host "  http://${ip}:8788   (anywhere, with the Tailscale app switched on)" }
}
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -match 'Wi-Fi' } |
  ForEach-Object { Write-Host ("  http://{0}:8788   (home Wi-Fi only)" -f $_.IPAddress) }
if ($control) { Write-Host 'The phone page will show a warning banner while it can control the laptop.' }
