# Power Organizer — push backend (optional)

A tiny Express server that makes reminders fire while the app is closed, on Android and iPhone. It stores Web Push subscriptions and reminder *times*, checks once a minute, and sends a push. It **never receives task text** — the push carries only a task number, and the app's service worker looks up the title on the device. There is no AI route; the app calls Google Gemini directly from the browser.

Requires **Node 18+**. It needs a long-lived process (the once-a-minute loop), so it will not work as a serverless function. Good hosts: Fly.io (config included), Railway, Render, or any small VPS.

## 1. Generate VAPID keys (once)

```bash
cd backend
npm install
npx web-push generate-vapid-keys
```

Keep the private key secret.

## 2. Environment variables

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | from step 1 (required) |
| `VAPID_SUBJECT` | `mailto:you@example.com` — contact for push services |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to call the API, e.g. `https://yourname.github.io` (scheme + host only). **Set this in production.** |
| `DB_PATH` | optional path for the JSON database (defaults to `/data/db.json` on Fly, else `./db.json`) |
| `PORT` | defaults to 3000 (Docker/Fly use 8080) |

## 3. Deploy

**Fly.io** (uses `Dockerfile` + `fly.toml`): edit the `app` name in `fly.toml`, then follow the commands in its header comment. The 1 GB volume keeps reminders across restarts.

**Anywhere else:** point the host at this folder with start command `npm start` and set the variables above.

## 4. Connect the frontend

In `js/config.js`:

```js
export const BACKEND_URL = 'https://your-backend.example.com';
export const VAPID_PUBLIC_KEY = '<your public key>';
```

Redeploy the frontend, then test: install the app on your phone, enable notifications in Settings, add a task with a reminder a couple of minutes out, and close the app.

`GET /api/health` returns `{ "ok": true }` for uptime checks.

## Built-in protections

- Per-IP rate limits (general + stricter on write endpoints)
- CORS restricted to `ALLOWED_ORIGINS`
- 10 KB request body limit and strict field validation
- Caps on subscriptions, reminders per device, and how far ahead a reminder can be set
- Reminders are deleted after delivery; reminders more than 24 h overdue are dropped
- Reminders are keyed by device + task, so one user can't cancel another's

## Limitations

- Flat JSON file storage — fine for modest traffic; swap the lowdb adapter for a real database to scale.
- Reminder delivery is best-effort. Push subscriptions can expire; the server drops them on a 404/410 from the push service.
- No user accounts. Anyone who learns a device's push address could cancel or reschedule that device's reminders, but push addresses are long random URLs that only the device and this server see.
