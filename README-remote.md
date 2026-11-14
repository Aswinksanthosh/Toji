# Phone remote buttons (no AI)

A phone page with fixed buttons per device. The main row is always visible: Wake, Steam, Big Picture, Start game (that laptop's own `games.json`), Close game. Four folding sections hold the rest:

- **Media**: previous, play/pause, next, volume down, mute, volume up.
- **Apps**: Discord, Spotify, Epic.
- **Coding**: start or stop Ollama, start Jarvis (local), update Jarvis (`git pull`), and your own named buttons.
- **System**: status (graphics card temperature, battery, uptime), game mode (stops Jarvis and unloads the local models, never your other projects), screen off, lock, restart (comes back by itself), sleep.

Restart, lock, sleep, close game, game mode and the coding buttons ask "are you sure?". Sleep warns that the phone cannot wake the laptop. There is no shutdown button on purpose: a shut-down laptop cannot be turned on from the phone. Close game ends every process that runs from a `steamapps\common` folder.

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

## Your own buttons
Create `C:\Users\<you>\.jarvis\buttons.json` on a laptop. The page shows one button per entry (under Coding), and pressing it runs that command there:
`{ "my tests": { "command": "npm test", "cwd": "C:\\Users\\you\\project" }, "open code": { "command": "code ." , "cwd": "C:\\Users\\you\\project" } }`
You write this file yourself. The phone can only press a button by its name; it can never send a command. Jarvis's own file tools are not allowed to touch `~/.jarvis`, so the AI cannot add buttons either. Keep entries short (300 characters) and in one line.
