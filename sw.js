// ── Service Worker (v2.72 — modular ES-module client) ───────────────────────
// CACHE_NAME must match APP_VERSION (js/app/config.js + version.json). Bump all
// three together on deploy so old caches purge on activation.
const CACHE_NAME = 'muse-v2.80';

const PRECACHE_URLS = [
  '/musedashboard/',
  '/musedashboard/index.html',
  '/musedashboard/staff.html',
  '/musedashboard/css/styles.css',
  '/musedashboard/manifest.json',
  '/musedashboard/manifest-staff.json',
  // App core
  '/musedashboard/js/app/main.js',
  '/musedashboard/js/app/staff.js',
  '/musedashboard/js/app/store.js',
  '/musedashboard/js/app/sync.js',
  '/musedashboard/js/app/config.js',
  '/musedashboard/js/app/session.js',
  '/musedashboard/js/app/utils.js',
  // Feature modules
  '/musedashboard/js/app/features/auth.js',
  '/musedashboard/js/app/features/photos.js',
  '/musedashboard/js/app/features/catalog.js',
  '/musedashboard/js/app/features/square-customers.js',
  '/musedashboard/js/app/features/square-catalog.js',
  '/musedashboard/js/app/features/square-pos.js',
  '/musedashboard/js/app/features/staff.js',
  '/musedashboard/js/app/features/checkin.js',
  '/musedashboard/js/app/features/status.js',
  '/musedashboard/js/app/features/queue.js',
  '/musedashboard/js/app/features/turns.js',
  '/musedashboard/js/app/features/reports.js',
  '/musedashboard/js/app/features/giftcards.js',
  '/musedashboard/js/app/features/settings.js',
  '/musedashboard/js/app/features/calendar.js',
  '/musedashboard/js/app/features/floorplan.js',
  '/musedashboard/js/app/features/appearance.js',
  '/musedashboard/js/app/features/servicetime.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Use individual puts so one missing file doesn't fail the whole install.
      .then(cache => Promise.all(PRECACHE_URLS.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // proxies/CDN → network
  if (!url.pathname.startsWith('/musedashboard/')) return;
  if (req.cache === 'no-store' || req.cache === 'no-cache') return;

  // Network-first for EVERYTHING same-origin (shell, JS modules, CSS, assets):
  // when online, always serve the freshly-deployed files so a version bump applies
  // on a single reload (no stale cached modules); fall back to cache only when
  // offline. Keeps the PWA offline-capable without ever serving stale code.
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch { return caches.match(req); }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch { return new Response('Offline', { status: 503 }); }
}

// ── Web Push (Muse Staff) ────────────────────────────────────────────────────
// Payload-less pushes: show a generic notification; the tech taps to open the app.
self.addEventListener('push', event => {
  let body = 'New customer assigned — tap to open';
  try { if (event.data) { const d = event.data.json(); if (d && d.body) body = d.body; } } catch {}
  event.waitUntil(self.registration.showNotification('Muse Staff', {
    body,
    icon: '/musedashboard/icons/icon-192.png',
    badge: '/musedashboard/icons/icon-192.png',
    tag: 'muse-assign',
    renotify: true,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.includes('/musedashboard/staff') && 'focus' in c) return c.focus(); }
      return clients.openWindow('/musedashboard/staff.html');
    })
  );
});
