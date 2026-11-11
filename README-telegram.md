# Prompt Jarvis from your phone (Telegram)

Your laptop calls out to Telegram and asks for new messages, so nothing on your
laptop is opened to the internet. Only your own Telegram ID is answered. The
laptop must be on with Jarvis running. Works with the gemini and ollama brains.

Phone requests are always **read-only**: even if Jarvis was started with
`--writes`, nothing sent from the phone can press keys, create files, or ask the
Gemini app. It can answer, use memory, and read the allowed folders.

Telegram bot chats are not end-to-end encrypted. Don't send secrets.

## Setup (about 5 minutes)
1. In Telegram, open a chat with **@BotFather** (check the blue tick) and send `/newbot`.
2. Give it a name, then a username ending in `bot`. BotFather replies with a **token**. Keep it private.
3. On the laptop, in PowerShell, save it (put your real token in place of the placeholder):
   `[Environment]::SetEnvironmentVariable("JARVIS_TELEGRAM_TOKEN","PASTE_TOKEN_HERE","User")`
4. Open a new PowerShell and start Jarvis. The log should say `telegram bot on, but nobody is allowed yet`.
5. In Telegram, open your new bot and send `/start`. It replies with **your ID** (a number).
6. Save the ID: `[Environment]::SetEnvironmentVariable("JARVIS_TELEGRAM_ALLOWED","YOUR_ID","User")`
7. Restart Jarvis. The log should say `telegram bot on, answering 1 account(s), read-only`.
8. Message the bot anything.

Several people: `JARVIS_TELEGRAM_ALLOWED=111,222`.
Turn it off: remove `JARVIS_TELEGRAM_TOKEN`. If the token ever leaks, send `/revoke` to BotFather.
