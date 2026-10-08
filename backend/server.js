// server.js — reminder-push backend for Power Organizer.
//
// What it does: stores Web Push subscriptions + scheduled reminder times, and
// once a minute sends a push for any reminder that is due.
// What it deliberately does NOT do: it never sees task titles or descriptions
// (the app looks those up locally when the push arrives), and it has no AI
// route — the app calls Google Gemini directly from the browser with the
// user's own key.
//
// Storage is a flat JSON file (lowdb): zero setup, fine for modest traffic.

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import webpush from 'web-push';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH wins; on Fly.io we use the persistent volume at /data; otherwise a
// local file next to this script.
const dbPath = process.env.DB_PATH || (process.env.FLY_APP_NAME ? '/data/db.json' : path.join(__dirname, 'db.json'));
const db = new Low(new JSONFile(dbPath), { subscriptions: [], reminders: [] });
await db.read();
db.data ||= { subscriptions: [], reminders: [] };
db.data.subscriptions ||= [];
db.data.reminders ||= [];

// ---------- Config ----------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com';
// Comma-separated list of origins allowed to call this API, e.g.
//   ALLOWED_ORIGINS=https://yourname.github.io
// (origin = scheme + host only, no path). Unset = allow any origin (dev only).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Safety caps so a flood can't grow the database without bound.
const MAX_SUBSCRIPTIONS = 20000;
const MAX_REMINDERS_PER_DEVICE = 200;
const MAX_REMINDER_HORIZON_MS = 366 * 24 * 60 * 60 * 1000; // schedule at most ~1 year ahead
const STALE_GRACE_MS = 24 * 60 * 60 * 1000;                // don't deliver reminders >24h late

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars. Run `npx web-push generate-vapid-keys` and set them.');
  process.exit(1);
}
if (!ALLOWED_ORIGINS.length) {
  console.warn('ALLOWED_ORIGINS is not set — accepting requests from any origin. Set it in production.');
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const app = express();
app.set('trust proxy', 1); // Fly.io / Render sit behind one proxy; needed for per-IP rate limits

app.use(cors({
  origin(origin, cb) {
    // No Origin header = non-browser client (curl, health checks): allow.
    if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '10kb' }));

// Generic limiter for everything, plus a tighter one for the write endpoints.
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });

// ---------- Validation helpers ----------
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isValidSubscription = s =>
  s && isStr(s.endpoint, 1000) && /^https:\/\//.test(s.endpoint) &&
  s.keys && isStr(s.keys.p256dh, 200) && isStr(s.keys.auth, 100);
const isValidTaskId = id => (typeof id === 'number' && Number.isFinite(id)) || isStr(id, 64);

// ---------- Routes ----------
// Register (or update) a browser's push subscription.
app.post('/api/subscribe', writeLimiter, async (req, res) => {
  const { subscription } = req.body || {};
  if (!isValidSubscription(subscription)) return res.status(400).json({ error: 'invalid subscription' });
  const existing = db.data.subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (existing) {
    existing.keys = subscription.keys;
  } else {
    if (db.data.subscriptions.length >= MAX_SUBSCRIPTIONS) return res.status(503).json({ error: 'server is full' });
    db.data.subscriptions.push({ endpoint: subscription.endpoint, keys: subscription.keys });
  }
  await db.write();
  res.json({ ok: true });
});

// Schedule (or reschedule) a reminder. Reminders are keyed by device + task,
// because task IDs are local to each user's browser and would otherwise collide.
app.post('/api/schedule-reminder', writeLimiter, async (req, res) => {
  const { endpoint, taskId, at } = req.body || {};
  if (!isStr(endpoint, 1000) || !isValidTaskId(taskId) || typeof at !== 'number' || !Number.isFinite(at)) {
    return res.status(400).json({ error: 'invalid fields' });
  }
  const now = Date.now();
  if (at > now + MAX_REMINDER_HORIZON_MS) return res.status(400).json({ error: 'reminder too far in the future' });
  if (!db.data.subscriptions.some(s => s.endpoint === endpoint)) return res.status(400).json({ error: 'unknown subscription' });

  db.data.reminders = db.data.reminders.filter(r => !(r.endpoint === endpoint && r.taskId === taskId));
  if (db.data.reminders.filter(r => r.endpoint === endpoint).length >= MAX_REMINDERS_PER_DEVICE) {
    return res.status(429).json({ error: 'too many reminders for this device' });
  }
  db.data.reminders.push({ endpoint, taskId, at });
  await db.write();
  res.json({ ok: true });
});

// Cancel one reminder (task completed, deleted, or edited).
app.post('/api/cancel-reminder', writeLimiter, async (req, res) => {
  const { endpoint, taskId } = req.body || {};
  if (!isStr(endpoint, 1000) || !isValidTaskId(taskId)) return res.status(400).json({ error: 'invalid fields' });
  db.data.reminders = db.data.reminders.filter(r => !(r.endpoint === endpoint && r.taskId === taskId));
  await db.write();
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- Delivery loop ----------
// Every minute: push anything due, then delete it. Reminders that are more than
// 24h overdue (e.g. server was down) are dropped instead of arriving absurdly late.
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const due = db.data.reminders.filter(r => r.at <= now);
    if (!due.length) return;

    for (const reminder of due) {
      if (now - reminder.at > STALE_GRACE_MS) continue;
      const sub = db.data.subscriptions.find(s => s.endpoint === reminder.endpoint);
      if (!sub) continue;
      try {
        // Payload carries only the task ID. The service worker looks up the
        // title on the device, so task text never reaches this server.
        await webpush.sendNotification(sub, JSON.stringify({ taskId: reminder.taskId }));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.data.subscriptions = db.data.subscriptions.filter(s => s.endpoint !== sub.endpoint);
          db.data.reminders = db.data.reminders.filter(r => r.endpoint !== sub.endpoint);
        } else {
          console.error('push send failed', err.statusCode || '', err.message);
        }
      }
    }

    // Drop everything we just handled (sent, stale, or orphaned).
    db.data.reminders = db.data.reminders.filter(r => r.at > now);
    await db.write();
  } finally {
    ticking = false;
  }
}
setInterval(tick, 60 * 1000);

// Error handler (e.g. CORS rejection, malformed JSON) — never leak stack traces.
app.use((err, _req, res, _next) => {
  const status = err.status || (err.message === 'Origin not allowed' ? 403 : 400);
  res.status(status).json({ error: status === 403 ? 'Origin not allowed' : 'Bad request' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Reminder backend listening on :${port}`));
