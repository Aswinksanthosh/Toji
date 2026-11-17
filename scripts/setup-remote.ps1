# Guided setup for the phone remote buttons. Passwords are typed hidden.

function Read-Plain($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ''
$serve = Read-Host 'Serve the phone page on THIS device? y/n'
if ($serve -match '^(y|yes)$') {
  do {
    $one = Read-Plain 'Choose a PIN for the phone page (4 to 8 digits, or a 12+ character password; a simple one like 0000 is allowed but then only Tailscale can reach the page)'
    $two = Read-Plain 'Type it again'
    $okPin = ($one -match '^\d{4,8}$')
    if ($one.Length -lt 12 -and -not $okPin) { Write-Host 'Use 4 to 8 digits, or a password of 12 or more characters.' -ForegroundColor Yellow }
    elseif ($one -cne $two) { Write-Host 'They did not match.' -ForegroundColor Yellow }
    else { break }
  } while ($true)
  [Environment]::SetEnvironmentVariable('JARVIS_REMOTE_PASSWORD', $one, 'User')
}

Write-Host ''
Write-Host 'The agent token is a shared secret. Every laptop and the phone-page device must use the SAME one.'
$mode = Read-Host 'First device (make a new token) or another device (paste the token)? n/p'
if ($mode -match '^(p|paste)$') {
  $token = Read-Plain 'Paste the token'
} else {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-Host ''
  Write-Host 'Your new token (copy it to your other devices, then clear this screen):' -ForegroundColor Cyan
  Write-Host $token
}
if ($token.Length -lt 24) { Write-Host 'That token is too short (24+).' -ForegroundColor Red; exit 1 }
[Environment]::SetEnvironmentVariable('JARVIS_AGENT_TOKEN', $token, 'User')

Write-Host ''
Write-Host 'Saved. Next: list your devices in C:\Users\<you>\.jarvis\devices.json (see README-remote.md), then start Remote.cmd.'
