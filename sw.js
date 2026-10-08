const CACHE = 'power-organizer-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/logic.js',
  './js/notifications.js',
  './js/config.js',
  './js/ai.js',
  './js/charts.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Offline-first: serve from cache, fall back to network, update cache in background.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(cache => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Look a task up in the app's local IndexedDB (the push server only knows the
// task ID, never the text). Resolves to null if anything goes wrong.
function lookupTask(taskId) {
  return new Promise(resolve => {
    if (taskId == null) return resolve(null);
    let req;
    try { req = indexedDB.open('PowerOrganizerDB'); } catch (e) { return resolve(null); }
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const idb = req.result;
      try {
        const get = idb.transaction('tasks', 'readonly').objectStore('tasks').get(Number(taskId));
        get.onsuccess = () => { idb.close(); resolve(get.result || null); };
        get.onerror = () => { idb.close(); resolve(null); };
      } catch (e) { idb.close(); resolve(null); }
    };
  });
}

// Incoming Web Push from the backend reminder scheduler.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = {}; }
  event.waitUntil((async () => {
    const task = await lookupTask(data.taskId);
    // Browsers require every push to show a notification (userVisibleOnly), so we
    // always show one; the app cancels reminders server-side when a task is completed.
    const title = task?.title || 'Task reminder';
    const body = task ? (task.dueDate != null ? 'Your task is due soon.' : (task.description || '')) : 'You have a task due.';
    await self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.taskId != null ? `task-${data.taskId}` : undefined,
      data: { taskId: data.taskId }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const existing = list.find(c => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return clients.openWindow('./index.html');
    })
  );
});
