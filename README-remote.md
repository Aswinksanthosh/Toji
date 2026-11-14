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

## Look of the page
Each laptop is a card. The agent reports the laptop's model name, and the card follows it: a model with "ROG" in its name gets a red ROG look with the badge ROG, one with "TUF" gets an orange TUF look with the badge TUF, anything else the plain blue look. To force a look, add `"theme": "rog"` or `"theme": "tuf"` to that laptop's entry in `devices.json`. Only colours and the words ROG and TUF are used, never the logos.
Inside each card, the Steam panel (Steam colours) shows who is signed in to Steam on that laptop (the display name from Steam's own `loginusers.vdf`, no passwords are read) and which game is running, with the Steam, Big Picture, Start game and Close game buttons. Each laptop lists its own games from its own `games.json`.

### Switching and moods
The page shows one laptop at a time. A switch bar at the bottom has one button per laptop (or swipe left and right). Each laptop has its own mood: ROG is soft and neon pink with rounded buttons, falling petals and an original drawn character with headphones; TUF is sharp and amber with chamfered buttons, hazard stripes, rising embers and an original drawn hooded figure. Games open from an animated drop-down, and Media, Apps, Coding and System fold open. With "reduce motion" turned on in the phone, the animations are off.

### Your own background pictures
Put a picture at `C:\Users\<you>\.jarvis\art\rog.jpg` and/or `tuf.jpg` on the laptop that runs the phone page (the one with the password). PNG, JPG and WEBP work, up to 3 MB. It replaces the drawn character behind that laptop's mood, and it is only sent to the phone after the password. Use art you are allowed to use; the built-in characters are original drawings made for this project.

## After you start a game
Starting a game from the page brings its window to the front 2 minutes later (it waits until the game has loaded). A new start replaces the timer. Change the wait with `JARVIS_GAME_FOCUS_SECONDS` (0 turns it off). The **Show game** button does it right now. It picks the biggest window of a program inside a `steamapps\common` folder.

## Modes and the graphics temperature cap
The MODE block on each laptop has three modes and a cap switch:
- **Power saving**: Windows power mode "best power efficiency", cap off.
- **Balanced**: Windows power mode "balanced", cap off.
- **Gaming**: Windows power mode "best performance" (and, only if you turned the remote's own cap on, the graphics temperature cap).
- **GPU temperature cap**: on its own, it keeps the card at or under the target by lowering its top clock when it is too hot and raising it again when it cools, never below 900 MHz. Set the target with `JARVIS_GPU_TARGET_C` (60 to 85, default 70).

**The cap is off by default.** If you already made a profile in Armoury Crate (for example Manual with a 70 C limit), use that and leave this off, so two programs never fight over the card. To turn the remote's cap on, set `JARVIS_REMOTE_CAP=1` (a user environment variable, then restart the remote). It needs a small background program with administrator rights (the same permission the `nvidia-smi -lgc` step needs). Set it up once per laptop: right-click `Setup-Governor.cmd`, choose **Run as administrator**. It adds a scheduled task that starts at every sign-in. Without it the page says so and the cap does nothing. Undo: `Setup-Governor.cmd remove`. The page remembers the cap state in `~/.jarvis/gpu-governor.json`, so the cap stays on across restarts until you switch it off. It works on NVIDIA cards (`nvidia-smi`).
The page shows the mode Jarvis last set; it does not notice changes made somewhere else.

To get your Armoury Crate profile while gaming, use Armoury Crate's own scenario profiles: link PUBG and Call of Duty to your Manual profile there, and it switches by itself when the game starts (also when the remote starts it). ASUS **Silent / Performance / Turbo / Manual** (the fan key, Armoury Crate) cannot be switched from here: ASUS only exposes it through its own driver, and there is no supported command. If you keep Armoury Crate in Manual mode, the Windows mode above sits on top of it. Programs such as G-Helper replace Armoury Crate and can do more on the laptop itself.

## Steam profile picture
Each laptop's Steam panel shows the profile picture of the Steam user signed in on that laptop (Steam keeps a copy in its `config\avatarcache` folder). To use another picture, put it at `C:\Users\<you>\.jarvis\art\avatar.png` (or jpg or webp, up to 1 MB) on that laptop. Otherwise the panel shows the first letter of the name.

## Games per laptop
Run on each laptop (adds PUBG and Call of Duty; `cod` is the Steam hub that holds Warzone and Modern Warfare, add more ids the same way):
`Set-Content "$HOME\.jarvis\games.json" '{ "pubg": 578080, "cod": 1938090 }'`
