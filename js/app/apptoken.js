// ── App auth token (§13 backend auth) ───────────────────────────────────────
// The Worker requires a shared bearer token on every route once its
// APP_AUTH_TOKEN secret is set. Each device holds the token in localStorage
// (device-local, NEVER synced state — synced config rides the very /state
// channel the token protects). Provisioning: paste it in Settings → Staff &
// Access → Device Access, or open any app page with #auth=<token> (captured
// below, stored, then stripped from the URL).
//
// Importing this module installs a fetch wrapper that adds
// `Authorization: Bearer <token>` to every request bound for the Worker, so
// feature code keeps calling fetch() plainly. Contexts that can't send headers
// (the WebSocket, the /gcal/connect navigation) append the token with withAuth().
// Import it FIRST in every entry point (main.js, staff.js, reports-app.js).

const KEY = 'muse_auth_token';

export function getAppToken() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setAppToken(token) {
  const t = String(token || '').trim();
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {}
}

// Append ?auth= for the WebSocket URL and top-level navigations (no headers possible there).
export function withAuth(url) {
  const t = getAppToken();
  return t ? url + (url.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(t) : url;
}

// ── Provisioning capture: #auth=<token> (or ?auth=) on any entry page ────────
// The hash form is preferred — a fragment never leaves the browser, so the token
// can't end up in GitHub Pages / proxy logs. Stored, then stripped from the URL
// so it isn't left in the address bar, history entry, or a screenshot.
(function captureFromUrl() {
  if (typeof location === 'undefined') return;
  const m = (location.hash + '&' + location.search).match(/[#?&]auth=([^&]+)/);
  if (!m) return;
  try { setAppToken(decodeURIComponent(m[1])); } catch { setAppToken(m[1]); }
  try {
    const clean = location.pathname
      + location.search.replace(/([?&])auth=[^&]*&?/, '$1').replace(/[?&]$/, '')
      + location.hash.replace(/([#&])auth=[^&]*&?/, '$1').replace(/[#&]$/, '');
    history.replaceState(null, '', clean);
  } catch {}
})();

// ── Fetch wrapper: attach the bearer token to Worker-bound requests ──────────
// Covers prod and the local `wrangler dev` origin (sync.js talks to :8787 when
// the page itself is served from localhost). Anything else passes through
// untouched. Defensive on purpose: a wrapper bug must never break fetch itself.
const WORKER_ORIGINS = [
  'https://musedashboard.musenailandspa.workers.dev',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
];

(function installFetchWrapper() {
  if (typeof window === 'undefined' || !window.fetch || window.fetch._museAuth) return;
  const origFetch = window.fetch.bind(window);
  const wrapped = (input, init) => {
    try {
      const token = getAppToken();
      const u = typeof input === 'string' ? input : (input && input.url) || '';
      if (token && WORKER_ORIGINS.some(o => u.startsWith(o))) {
        init = { ...(init || {}) };
        const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
        init.headers = headers;
      }
    } catch {}
    return origFetch(input, init);
  };
  wrapped._museAuth = true;
  window.fetch = wrapped;
})();
