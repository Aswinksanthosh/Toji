# Prompt Jarvis from your phone over home Wi-Fi

A small page on your laptop that your phone can open on the same Wi-Fi. Text only
(phone browsers only allow the microphone on secure pages), password protected,
and **read-only**: nothing sent from the phone can type, click, press keys or
change files. Works with the gemini and ollama brains. The laptop must be on with
Jarvis running.

It is a separate little server, so the main Jarvis connection stays reachable from
the laptop only.

## Setup
1. Pick a password of at least 8 characters that you use nowhere else, and save it
   (PowerShell, then open a new window):
   `[Environment]::SetEnvironmentVariable("JARVIS_PHONE_PASSWORD","your password here","User")`
2. Start Jarvis. The log shows `wifi phone page on ... On your phone, open: http://192.168.x.x:8788`.
3. The first time, Windows asks to allow Node.js through the firewall. Tick
   **Private networks** only, never Public.
4. On your phone (same Wi-Fi), open that address and enter the password.

## Safety
- Home and private networks only: requests from anywhere else are refused even if
  your router were set up wrongly.
- 5 wrong passwords lock that device out for 5 minutes. Logins last 12 hours.
- Answers are shown as plain text.
- Home Wi-Fi traffic here is not encrypted. Do not use it on a network you don't trust.

Change the port with `JARVIS_PHONE_PORT`. Turn it off by removing `JARVIS_PHONE_PASSWORD`.

## Over Tailscale (from anywhere, encrypted)
Install Tailscale on the laptop and the phone, sign in to the same account, and open
`http://<the laptop's 100.x.x.x address>:8788` on the phone with Tailscale switched on.
Allow it through Windows Firewall for Tailscale addresses only (Administrator PowerShell):
`New-NetFirewallRule -DisplayName "Jarvis phone page (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8788 -Action Allow -Profile Any -RemoteAddress 100.64.0.0/10`

## Letting the phone control the laptop (off by default)
Set `JARVIS_PHONE_WRITES=1` (and start Jarvis with writes, which Jarvis.cmd does). The
phone page can then open apps and sites, ask the Gemini app, type, click, press
shortcuts, lock, sleep and write files in the allowed folders. The same safety rules
apply as on the laptop: typing and clicking are refused while a terminal has focus,
and apps open from your list only. The page shows a warning banner while this is on.
A password of at least 12 characters is required. Telegram always stays read-only.
Anyone with your phone and password could do all of this, so lock your phone.
