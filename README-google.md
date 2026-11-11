# Google Calendar and Gmail (read only)

One-time setup. Takes about 10 minutes. Nothing leaves your machine except calls to Google.

1. Go to https://console.cloud.google.com and create a project (any name).
2. **APIs & Services > Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services > OAuth consent screen**: choose **External**, fill the app name and your email, then under **Test users** add your own Google address.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Desktop app**. Download the JSON.
5. Save that file as `client.json` in `~/.jarvis/google/` (on Windows: `C:\Users\<you>\.jarvis\google\client.json`).
6. Run `npm run google:login`, sign in, and approve read-only access. Google may warn the app is unverified; that is expected for your own project, choose Continue.
7. Restart Jarvis. The log should say `google calendar and mail connected (read only)`.

Notes:
- While the consent screen is in **Testing** mode, Google expires the login after about 7 days. Run `npm run google:login` again when he says it has expired.
- Only read scopes are requested. He cannot send, create or delete anything.
- Turn it off with `JARVIS_DISABLE=google`.
