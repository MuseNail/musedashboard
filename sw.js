// ── Service Worker ────────────────────────────────
// Cache name must match APP_VERSION. Bump this whenever APP_VERSION changes
// in js/config.js so old caches are purged on the next activation.
const CACHE_NAME = 'muse-v1.66';

// Static assets to precache on install.
// All paths are absolute from the GitHub Pages origin.
const PRECACHE_URLS = [
  '/musedashboard/',
  '/musedashboard/index.html',
  '/musedashboard/css/styles.css',
  '/musedashboard/js/utils.js',
  '/musedashboard/js/config.js',
  '/musedashboard/js/sync.js',
  '/musedashboard/js/photos.js',
  '/musedashboard/js/auth.js',
  '/musedashboard/js/catalog.js',
  '/musedashboard/js/square-customers.js',
  '/musedashboard/js/square-catalog.js',
  '/musedashboard/js/square-pos.js',
  '/musedashboard/js/staff.js',
  '/musedashboard/js/checkin.js',
  '/musedashboard/js/queue.js',
  '/musedashboard/js/turns.js',
  '/musedashboard/js/reports.js',
  '/musedashboard/js/giftcards.js',
  '/musedashboard/js/calendar.js',
  '/musedashboard/js/settings.js',
  '/musedashboard/js/app.js',
];

// ── Install ───────────────────────────────────────
// Precache all static assets. skipWaiting() activates the new SW immediately
// instead of waiting for all existing tabs to close.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────
// Delete every cache that doesn't match CACHE_NAME. This purges old version
// caches automatically whenever the SW updates (i.e. on every version bump).
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests under our repo path.
  // Everything else (Cloudflare Workers proxies, Square, Google Fonts, Tailwind CDN)
  // goes straight to the network — don't cache external API calls.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/musedashboard/')) return;

  // Never intercept requests that explicitly bypass the cache (e.g. checkAppVersion()
  // fetches version.json with cache:'no-store'). Let those go to the network directly.
  if (req.cache === 'no-store' || req.cache === 'no-cache') return;

  // Network-first for HTML and version.json so version bumps propagate immediately.
  // Falls back to cache only when offline.
  if (
    url.pathname.endsWith('version.json') ||
    url.pathname === '/musedashboard/' ||
    url.pathname.endsWith('/index.html')
  ) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache-first for JS, CSS, and icons — these are versioned by CACHE_NAME.
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    // Refresh the cache entry while we're here
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch {
    return caches.match(req);
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
