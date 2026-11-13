# Steam from Jarvis (and from the phone page)

With writes mode on, Jarvis can open Steam and start a game by name:
"start Hades", "open Steam", "open Big Picture".

## Set up your games
Create `C:\Users\<you>\.jarvis\games.json` with the games you want, name -> Steam app id:
`{ "hades": 1145360, "portal 2": 620 }`
The app id is the number at the end of a game's Steam store address
(store.steampowered.com/app/**620**/). A bare number also works: "start 620".
Only ids and names from this file are ever launched, never a command line.

## What to know
- Steam must already be **logged in** (tick "Remember my password" once). Jarvis never
  handles your Steam password and cannot switch accounts for you.
- The Windows session must be signed in. A locked screen is fine, being signed out is not.
- Jarvis says the game is **starting**. He cannot see whether it reached the menu.
- Some games draw at full speed even in their menus, which heats the card. If you start a
  game remotely, do it shortly before you arrive, not hours early.
- Needs the laptop on and Jarvis running. Turning the laptop on from outside is a separate
  topic: see the backlog in `context.md`.
