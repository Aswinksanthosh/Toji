# Phone remote buttons (no AI)

A phone page with fixed buttons per device: Wake, Steam, Big Picture, Start game, Lock, Sleep.

- **Agent**: runs on each laptop. Only does those few actions, only with the shared token.
- **Hub**: serves the page, sends Wake-on-LAN, passes the other buttons to the laptop's agent.

## Setup
1. Run `Setup-Remote.cmd` on each device. On the first, make a token; on the others paste the same token.
   Say `y` to serve the phone page on the device that will be awake (a laptop or an always-on device).
2. List devices in `C:\Users\<you>\.jarvis\devices.json`:
   `{ "laptop-a": { "mac": "AA:BB:CC:DD:EE:01", "agent": "http://100.x.x.x:8790" } }`
   (`agent` = the laptop's Tailscale address, port 8790.)
3. List games in `C:\Users\<you>\.jarvis\games.json`: `{ "hades": 1145360 }`
4. Start `Remote.cmd`. Open the address it prints on your phone.

Wake needs the hub to be on the same network as the sleeping laptop. See `README-wake.md`.
Private networks and Tailscale only. Password page, 5-try lockout.

## One laptop, always on
Keep the laptop awake with the screen off (plugged in, lid does nothing; a sleeping laptop cannot be reached). On it, run `Setup-Remote.cmd` (say `y` to serve the page), and list it in `devices.json` with only its own agent address, no MAC needed:
`{ "laptop": { "agent": "http://127.0.0.1:8790" } }`
Then run `Autostart-Remote.cmd` once: the buttons start hidden at every sign-in through a scheduled task, also when Windows boots into Xbox full screen mode (about 50 MB of memory, no AI, no browser). If the task cannot be made, it falls back to the Startup folder, which only runs after the normal desktop loads. `Autostart-Remote.cmd remove` undoes it. The page needs the laptop signed in.
