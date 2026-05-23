// ── Service Worker (v2.01 — modular ES-module client) ───────────────────────
// CACHE_NAME must match APP_VERSION (js/app/config.js + version.json). Bump all
// three together on deploy so old caches purge on activation.
const CACHE_NAME = 'muse-v2.01';

const PRECACHE_URLS = [
  '/musedashboard/',
  '/musedashboard/index.html',
  '/musedashboard/css/styles.css',
  '/musedashboard/manifest.json',
  // App core
  '/musedashboard/js/app/main.js',
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

  // Network-first for the shell + version stamp + the config module (carries
  // APP_VERSION), so deploys propagate immediately; fall back to cache offline.
  if (
    url.pathname.endsWith('version.json') ||
    url.pathname.endsWith('/js/app/config.js') ||
    url.pathname === '/musedashboard/' ||
    url.pathname.endsWith('/index.html')
  ) { event.respondWith(networkFirst(req)); return; }

  // Cache-first for the rest (versioned by CACHE_NAME, purged on activate).
  event.respondWith(cacheFirst(req));
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
