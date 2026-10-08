# Power Organizer

A free, offline-first task, habit, goal, and focus planner that installs on iPhone and Android from one codebase. No account, no build step, no framework — plain JS modules + IndexedDB, so you can read every file.

**Free and open source (MIT).** Your data lives in your browser.

## Features

- **Tasks** with priorities, due dates, categories, recurrence, subtasks, and **dependencies** (blocked tasks can't be completed out of order)
- **Goals** with progress bars that roll up from linked tasks
- **Habits** with streaks
- **Focus timer** (start/pause/reset) with a completion notification
- **Hourly planner** and **calendar** day drill-down
- **Dashboard** with a 7-day completion trend
- **Optional AI features** (bring your own Gemini key — see below)
- Dark mode, offline indicator, install banner, backup export/import, undo on delete
- Shortcuts: `n` new task, `/` search

## Using the app

Open the app's URL (for example your GitHub Pages link), then:

- **Android (Chrome):** use the in-app *Install* banner, or ⋮ → *Add to Home screen*.
- **iPhone (Safari, iOS 16.4+):** Share → *Add to Home Screen*. Push notifications on iOS only work for apps added to the home screen.

Everything works offline except push reminders and AI.

## Privacy

- **Tasks, goals, habits** are stored only in your browser (IndexedDB). There are no accounts and no sync. Export a backup from Settings regularly — clearing browser data deletes everything.
- **Reminders** use a small push server. It receives only an anonymous device push address, a task number, and the reminder time — **never your task titles or descriptions**. Those are looked up on your device when the notification arrives. Reminder delivery is best-effort, not guaranteed.
- **AI features** are optional and use *your own* Google Gemini API key. The key is stored only in your browser, and requests go directly from your device to Google — not through this app's server. Weekly insights send only aggregate numbers; quick-add, task breakdown, and focus suggestions send the task text you're working on. Google may use free-tier inputs/outputs to improve its models (see Gemini's terms).

## AI features (optional)

Get a free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (no credit card), then paste it into **Settings → AI features**. The free tier has daily limits, which are enough for normal personal use.

- **✨ AI** next to Quick Capture — turns a loose note into title, priority, estimate, category, due date
- **✨ Break down with AI** — turns a task into a subtask checklist
- **Weekly insights** — short summary from your aggregate stats
- **What should I focus on?** — picks one open task and explains why

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Service workers and IndexedDB work on `http://localhost`. Anywhere else (including testing on a phone) you need HTTPS.

## Deploy your own copy

**Frontend** (static files, no build): publish this folder on GitHub Pages, Cloudflare Pages, Netlify, or Vercel. For GitHub Pages: repo → Settings → Pages → deploy from the `main` branch root.

**Push reminders (optional):** the app ships pointing at the author's push server. If you'd rather run your own — recommended for a fork you plan to share widely — follow [`backend/README.md`](backend/README.md), then edit the two values in [`js/config.js`](js/config.js). Without any backend, everything else still works; only closed-app reminders won't fire.

## File map

```
index.html              entry point + iOS/Android install metadata
manifest.json           PWA manifest
sw.js                   service worker: offline cache + push display
css/styles.css          design tokens, light/dark theming, components
js/config.js            backend URL + VAPID public key (edit for your own backend)
js/db.js                IndexedDB schema (Dexie)
js/logic.js             business logic (smart plan, blocked tasks, streaks, parsing)
js/charts.js            tiny dependency-free SVG chart
js/notifications.js     push subscription + reminder sync
js/ai.js                Gemini client (bring-your-own key, called from the browser)
js/app.js               router + all screens + event wiring
backend/                optional Node push-reminder server (+ Dockerfile, fly.toml)
```

Note: `js/db.js` loads Dexie from the esm.sh CDN, so the very first visit needs a connection; after that the service worker caches it.

## Limitations

- Single-device, single-browser data (no sync).
- The planner uses a prompt-based quick-add rather than drag-to-resize blocks.
- Push reminders are best-effort and can lapse if a push subscription expires; re-enable notifications in Settings if they stop.

## License

[MIT](LICENSE) — provided as is, without warranty.
