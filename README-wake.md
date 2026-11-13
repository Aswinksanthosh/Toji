# Turning a sleeping laptop on from your phone

A sleeping or off laptop cannot wake itself, and its own Jarvis page is asleep with it.
The wake-up signal (Wake-on-LAN) has to come from **another device on the same network**.
Try these in order, and stop at the first one that works.

## Step 1: maybe you do not need to wake it at all
Many Windows 11 laptops stay connected while "asleep" when plugged in (Modern Standby).
Plug the laptop in, put it to sleep, wait two minutes, then on your phone (mobile data,
Tailscale on) open its Jarvis address. If the page loads, you are done.

## Step 2: Wake-on-LAN
1. **Cable beats Wi-Fi.** Wake-on-LAN over Wi-Fi from sleep often does not work. A network
   cable at home is far more reliable.
2. **Check support** (Administrator PowerShell on the laptop):
   `Get-NetAdapterPowerManagement | Format-List Name,WakeOnMagicPacket,WakeOnPattern`
3. **Switch it on:** Device Manager, your network adapter, Power Management: tick
   "Allow this device to wake the computer" and "Only allow a magic packet". On the Advanced
   tab set "Wake on Magic Packet" to Enabled. In the BIOS, enable Wake on LAN if it has the
   option. Turn Fast Startup off if you want to wake it from fully off.
4. **Find its MAC address:** `Get-NetAdapter | Select-Object Name,MacAddress,Status`
5. **Name it** in `C:\Users\<you>\.jarvis\devices.json`:
   `{ "laptop-b": { "mac": "AA:BB:CC:DD:EE:FF", "broadcast": "10.0.0.255" } }`
   (`broadcast` is your network's address ending in .255; leave it out if unsure.)

## Step 3: who sends the signal?
Something on the same network that is **awake**: an always-on device (a router with a
Wake-on-LAN feature, a Raspberry Pi or an old PC) or the other laptop. On it run
`node scripts/wake.mjs laptop-b`, or, on a laptop running Jarvis in writes mode, say
"wake laptop-b" (the `wake_device` tool). From work, reach the always-on device through
Tailscale (install Tailscale on it too).

**Test it at home first:** sleep one laptop, send the signal from the other.

## Two laptops, two Steam accounts
Each laptop runs its own Jarvis and stays logged in to its own Steam account. Give the two
devices clear names in the Tailscale admin page, and keep one phone bookmark for each. To
play together, wake and start the game on both. Jarvis cannot switch Steam accounts for you
(that would need your password), so pick the laptop, not the account.

## Honest limits
- Jarvis can send the signal but cannot see whether the laptop woke. Wait up to 30 seconds.
- Some laptops, and most Wi-Fi adapters, cannot be woken from sleep over the network.
- Keep it plugged in. A battery-powered sleeping laptop is less likely to respond.
