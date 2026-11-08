# Tamerlan Fitness

## Run on this Windows computer

1. Before switching from the old `file://` app, open Settings and download a JSON backup.
2. Install Node.js 22.13 or newer and copy `.env.example` to `.env`.
3. Before the first start, set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 12 characters in `.env`. Existing databases retain their administrator login.
4. If a bot token has been exposed, revoke it using BotFather and create a fresh one. Enter it locally using `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-telegram.ps1`; the prompt masks input and saves it to the ignored `.env` file without printing it. Never send bot tokens in chat or paste them into browser code.
5. Double-click `start.bat`, or run `npm start` in this folder. Open <http://127.0.0.1:8000>; do not open `index.html` directly.
6. Import the JSON backup from Settings to migrate the old app's data.

The server binds only to this computer (`127.0.0.1`). Keep this window and the computer connected to the internet for Telegram polling and reminders. The database is stored in `data/gym.sqlite3`; use the JSON backup in Settings before moving or replacing the database. `file://` and `http://127.0.0.1` have separate browser storage: export a backup before switching from the old app and import it after opening the server version. Data already stored for the localhost origin is imported into an empty database only after an administrator signs in.

The app is configured for one physical turnstile at the main entrance/exit door. Every approved card or staff-confirmed daily visit records entry and exit against that single door; older visit history is normalized to the main entrance/exit. Actual turnstile hardware still needs a compatible controller integration.

## Telegram setup

- Create a bot with BotFather, then run the secure local token setup script above. If you change or revoke a token, run the script with the new token and restart `start.bat`.
- Each member must open the bot, press **Start**, and share their own Telegram phone contact. The bot matches that verified contact to the phone number already registered by the administrator. Telegram does not let bots discover users or message them before they start the bot.
- `/start` greets the member and explains how to connect their phone and what subscription reminders the bot sends. `/help` describes the service and its limits: the bot sends reminders only; it does not create accounts, accept payments, or operate the turnstile.
- Reminders are sent at 09:00 Uzbekistan time when the subscription has 5 days left, 2 days left, ends that day, or expired the previous day. The server must be running; failed sends are retried.
- The bot receives only the member's name and subscription date/status needed for reminders. Passwords, photos, and addresses are not sent to Telegram.

The local server intentionally does not expose the database/API to other devices or the internet. Admin and member APIs use server-side sessions; administrator-only state writes require CSRF protection. Before public hosting or phone-browser access is enabled, configure HTTPS and review network access, backups, and account-recovery procedures. NFC turnstile hardware and payment gateways still require their own provider integrations.

## Deploy to Vercel

The GitHub repository contains application source only. `.env` and `data/` are excluded; never commit bot tokens, database files, member data, or administrator passwords. A public repository makes the source code visible, so use strong credentials and store all deployment secrets in Vercel Environment Variables.

Vercel requires a persistent PostgreSQL database; the local SQLite database is not used in production. Configure these Vercel Environment Variables before the first deployment:

- `DATABASE_URL`: PostgreSQL connection string from the Vercel/Neon database integration.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: administrator login for the new, empty production database. Use a unique password of at least 12 characters.
- `TELEGRAM_BOT_TOKEN`: bot token from BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: random value containing only letters, numbers, `_`, or `-`.
- `CRON_SECRET`: random value used to authorize the scheduled reminder endpoint.

Deploy the GitHub repository as a Vercel project. After the first deployment, set `PUBLIC_APP_URL` to its canonical HTTPS URL and redeploy. The app registers the Telegram webhook on its next request. The configured Vercel Cron runs each day at 09:00 Uzbekistan time and sends each due reminder once. Telegram requires members to start the bot and link their own phone contact before messages can be sent.

The production PostgreSQL database starts empty; sign in with the configured administrator credentials and initialize the club through the app. Do not upload the local SQLite database to GitHub. If member data needs to be moved later, use the app's JSON backup/export and import flow over HTTPS.

Do not run the local long-polling bot and the hosted webhook bot at the same time with the same Telegram token.
