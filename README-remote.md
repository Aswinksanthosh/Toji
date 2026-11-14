# Phone remote buttons (no AI)

A phone page with fixed buttons per device. The main row is always visible: Wake, Steam, Big Picture, Start game (that laptop's own `games.json`), Close game. Four folding sections hold the rest:

- **Media**: previous, play/pause, next, volume down, mute, volume up.
- **Open apps**: a drop-down and an Open button. Built in: Discord, Spotify, Epic Games, Claude and ASUS GlideX (the last two are found by name in the laptop's Start menu, so they must be installed on that laptop). Add your own, see below.
- **Coding**: start or stop Ollama, start Jarvis (local), and your own named buttons.
- **Update this app**: **Git pull** (just pulls the latest code into the Jarvis folder, fast-forward only) and **Update & restart** (pulls, runs `npm install` only if the dependency files changed, then restarts the remote by itself; reload the page after about 20 seconds). It never touches your other projects or Jarvis itself. The version (short commit) that is **running** on each laptop is shown under its name, so you can see whether both are the same. If newer files are on the laptop but not running yet (for example you pulled by hand), the page says so, and **Update & restart** then restarts it.
- **System**: status (graphics card temperature, battery, uptime), game mode (stops Jarvis and unloads the local models, never your other projects), (restart, sleep, turn off and cancel turn off moved to the **power icon**, see below).

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

## Modes (not on the page)
The Power saving, Balanced and Gaming section was removed from the page at the owner's request: performance profiles are set in Armoury Crate instead (link each game to a profile in its scenario profiles). The agent still understands the old `mode_*` and `cap_*` actions and the optional `Setup-Governor.cmd` cap exists, but nothing on the page uses them.

## Steam profile picture
Each laptop's Steam panel shows the profile picture of the Steam user signed in on that laptop (Steam keeps a copy in its `config\avatarcache` folder). To use another picture, put it at `C:\Users\<you>\.jarvis\art\avatar.png` (or jpg or webp, up to 1 MB) on that laptop. Otherwise the panel shows the first letter of the name.

## Games per laptop
Run on each laptop (adds PUBG and Call of Duty; `cod` is the Steam hub that holds Warzone and Modern Warfare, add more ids the same way):
`Set-Content "$HOME\.jarvis\games.json" '{ "pubg": 578080, "cod": 1938090 }'`

## More apps in the Open apps menu
Create `C:\Users\<you>\.jarvis\remote-apps.json` on a laptop: the button name, and the app's name exactly as the Start menu shows it:
`{ "vs code": "Visual Studio Code", "obs": "OBS Studio" }`
To see the exact names on a laptop, run: `Get-StartApps | Select-Object Name`. The phone only sends the button name; it can never open anything that is not in this file or the built-in list. Built-in names cannot be replaced.

## Game pictures
Each game in the Steam panel can have a picture: a banner above the drop-down and a small thumbnail in the list. On each laptop, put one image per game in `C:\Users\<you>\.jarvis\art\games\`, named after the game as it appears in `games.json`, for example `pubg.jpg` and `cod.jpg` (png, jpg or webp, up to 1.5 MB). Create the folder first: `New-Item -ItemType Directory -Force "$HOME\.jarvis\art\games"`. Games without a picture simply show their name. The pictures stay on the laptop and are sent to the phone only after the password. They are not part of this repository: game artwork belongs to its publisher, so keep it on your own machines.

### Choosing a game picture from the phone
Press **Change picture** in the corner of the game banner and choose a picture from your phone. (The game name inside the banner is the game drop-down: tap it to pick another game.) The page shrinks it to a sensible size and the remote saves it on the machine that serves the page (`~/.jarvis/art/games/`). It then shows for that game on both laptops and on every phone, because they all use the same remote. A picture saved on the hub wins over a file placed on a laptop. Only png, jpeg and webp pictures are accepted, checked by their content, up to 1.5 MB, only for games the remote already knows, and only after the password.

## Switching the Steam account
In each laptop's Steam panel, **Switch Steam account** lists the accounts Steam stays signed in to on that laptop. Pick one and confirm in the page's own box (no browser pop-up): Steam closes (any running game closes with it), is told which remembered account to use, and starts again, which takes about 30 seconds. Only accounts that are already remembered on that laptop are listed (sign in to the other account once on the laptop with "Remember my password" ticked). The remote never sees or stores a password and never reads one, and the phone can only send the account's public 17-digit Steam number, which must match a remembered account in that laptop's own `loginusers.vdf`. If Steam's saved sign-in for that account has expired, Steam shows its normal sign-in screen on the laptop.

## Turning a laptop off
**Turn off** (System) asks for the remote password again in a small box, even though you are already unlocked, and wrong tries count toward the same 5-try lockout as logging in. The laptop turns off after 15 seconds; **Cancel turn off** stops it (also stops a restart) during that time. Programs with unsaved work may ask to save, and the laptop waits for them. **A laptop that is turned off cannot be switched on again from the phone**: it needs its power button (or a smart plug and the BIOS "power on when AC attached" setting, if your laptop has it). For that reason Restart does not ask for the password but Turn off does.

## Hold to confirm
The risky buttons (Lock, Close game, Stop Ollama, Game mode, Restart, Sleep, Update & restart, and your own coding buttons) are **hold buttons**: they carry a small "hold" label, and you press and keep pressing for about a second while a bar fills. Let go early and nothing happens (the page just reminds you to keep holding); slide your finger off the button to cancel. It replaces the browser's "are you sure?" boxes. It also works with the keyboard (hold Enter or Space). **Turn off** is not a hold button: it asks for the password instead. Messages float over the page so they never move a button from under your finger.

## Hold and slide menus
Some buttons carry a small corner mark: **press and hold, slide to an option, let go to pick it.**
- **Power icon** (next to Wake): hold it and slide to Lock, Screen off, Cancel turn off, Restart, Sleep or Turn off. Let go anywhere else to cancel. Turn off still asks for the password.
- **Steam**: a quick tap opens Steam as before; hold and slide for Big Picture, Show game or Close game.
- A quick tap on the power icon opens the same menu so you can tap an option instead (works with a mouse too). Keyboard: Enter opens it, arrows move, Enter picks, Escape closes.
The page does not redraw while a menu, hold or drop-down is in use, so nothing moves under your finger.

## A separate remote address for each laptop
If each laptop serves its own remote page (see `Setup-Remote.cmd`: answer `y` to serving the page on that laptop), give each laptop in `devices.json` the optional address of its own page, `"page"`. The tab of a laptop whose page is at another address shows a small arrow and **opens that address** when tapped; the tab of the laptop you are already on just switches. Each address has its own sign-in (the browser remembers each one separately, so going back is instant). A laptop entry may be only a link (`"page"` and `"theme"`, no agent). `devices.json` on the ROG, for example:
`{ "big": { "agent": "http://127.0.0.1:8790" }, "second": { "agent": "http://<tuf tailscale address>:8790", "page": "http://<tuf tailscale address>:8791", "theme": "tuf" } }`
and on the TUF the other way round, with `"big"` carrying `"page"` and `"theme": "rog"`. Only plain `http://host:port` addresses are accepted.

If switching does not work: the account must be one Steam stays signed in to on that laptop (it is listed only then), and after the switch Steam may show its normal sign-in screen on the laptop if its saved sign-in expired. The switch runs in the background, step by step: it asks Steam to close (and forces it after 40 seconds), saves a copy of `config\loginusers.vdf` as `loginusers.vdf.jarvis-backup`, moves the `MostRecent` flag to the chosen account, sets Steam's `AutoLoginUser` and `RememberPassword` registry values, and starts Steam. **Every step is written to `C:\Users\<you>\.jarvis\steam-switch.log`** on that laptop, so if nothing changes, open that file: its last line shows where it stopped (login names and passwords are never written to it). To undo, close Steam and copy the backup over `loginusers.vdf`.

## Saving the password on a phone
The sign-in form has a **Name** box (already filled with `remote`) and a **Password** box. The name is not a secret and is never sent to the server (only the password is checked); it is there because iPhone's keychain (and some other password managers) only offers to save a password when the form has a username next to it. After you sign in, accept "Save password" in the browser. If the iPhone does not offer it, add it by hand: Settings, then Passwords, then the + button, with the website set to the remote's address (for example `<the remote address>`), the user name `remote`, and your remote password. Each laptop's own remote address is saved separately. The page itself never stores the password.
