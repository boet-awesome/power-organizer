// notifications.js — Web Push wiring.
// Reminders are scheduled on the backend (see /backend) so they fire even if
// the app/browser is fully closed, which is the only reliable way to do this
// on iOS Safari (no local "fire at exact future time" API exists there).

import { BACKEND_URL, VAPID_PUBLIC_KEY } from './config.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export async function ensurePushPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  try {
    await fetch(`${BACKEND_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub })
    });
  } catch (e) {
    console.warn('Could not reach backend to register push subscription', e);
  }
  return sub;
}

async function currentEndpoint() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? sub.endpoint : null;
}

// Only the device endpoint, task ID and fire time go to the backend. Task text
// stays on this device: the service worker looks the title up locally when the
// push arrives. Returns true on success so the UI can warn if it failed.
export async function syncReminder(task) {
  try {
    const endpoint = await currentEndpoint();
    if (!endpoint || task.reminderAt == null) return false;
    const res = await fetch(`${BACKEND_URL}/api/schedule-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, taskId: task.id, at: task.reminderAt })
    });
    return res.ok;
  } catch (e) {
    console.warn('Could not sync reminder to backend', e);
    return false;
  }
}

export async function cancelReminder(taskId) {
  try {
    const endpoint = await currentEndpoint();
    if (!endpoint) return;
    await fetch(`${BACKEND_URL}/api/cancel-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, taskId })
    });
  } catch (e) {
    console.warn('Could not cancel reminder on backend', e);
  }
}
