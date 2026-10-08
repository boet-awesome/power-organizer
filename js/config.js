// config.js — the only two values you need to change if you run your own copy.
//
// Reminders that fire while the app is closed need a small push backend (see
// backend/README.md). Everything else in the app works without it.
//
// Running your own backend?
//   1. Deploy backend/ (instructions in backend/README.md).
//   2. Put its URL in BACKEND_URL and your VAPID *public* key in VAPID_PUBLIC_KEY.
//   3. Set ALLOWED_ORIGINS on the backend to the site that serves this app.

export const BACKEND_URL = 'https://power-organizer-boet.fly.dev';
export const VAPID_PUBLIC_KEY = 'BDsze3Ff-yKdWPoaqRw5dGcwYnqw70M8kBQbKNTFpxHW_ENogQDrY4i12H9NhNkF8jpjHH7-vFrKCiIkQeB5kg0';