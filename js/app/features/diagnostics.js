// ── diagnostics.js — Settings → Diagnostics (error log + bug-alert opt-in) ────
// The viewing end of the reporter (js/app/reporter.js): shows the errors the server
// captured (deduped, newest first) so the owner can see what failed even when they
// didn't notice it live, and lets a device opt in to a push the moment something breaks.
import { REPORT_PROXY, PUSH_PROXY, STATE_PROXY, VAPID_PUBLIC_KEY, APP_VERSION } from '../config.js';
import { showToast } from '../utils.js';
import { getState, cacheByteSize } from '../store.js';
import { idbAvailable } from '../idbcache.js';
import { DEVICE_ID } from '../sync.js';

const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _ago = ms => {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

// ── On-device storage gauge (Phase 0) ────────────────────────────────────────
// The device mirrors the whole app state to a local cache for instant/offline
// reload; that cache has a hard ceiling (~5 MB on an iPad in localStorage). This
// pure helper reports where we are against it, what's using the space, and — from
// the oldest record's age (records dominate growth) — a rough runway projection.
export function computeStorageStats(state, cacheBytes, nowMs, ceilingBytes) {
  // Sizes are JSON UTF-16 code-unit counts used as a byte proxy — the same unit on both
  // sides (the localStorage cache and the ceiling are metered the same way), so the ratio
  // is meaningful even if it isn't exact bytes. SLICE_KEYS mirror EXACTLY what store.js
  // saveCache() persists (no `audit` — the audit log is synced state but is NOT in the cache),
  // so the breakdown attributes real cache pressure and stays reconcilable with the headline.
  const B = o => { try { return JSON.stringify(o).length; } catch { return 0; } };
  const SLICE_KEYS = ['records', 'customers', 'config', 'configMeta', 'giftcards', 'queue', 'deletions', 'customerDeletions'];
  const slices = [];
  for (const k of SLICE_KEYS) {
    const v = state && state[k];
    if (v == null) continue;
    slices.push({ key: k, count: Array.isArray(v) ? v.length : null, bytes: B(v) });
  }
  slices.sort((a, b) => b.bytes - a.bytes);
  // Runway: age from the oldest record (records carry checkinTime; ignore future-dated ones),
  // then a CONSERVATIVE all-in growth rate = whole-cache / age. Using the full cache (not just
  // records) slightly over-counts fixed config, which biases the estimate SAFE — a warning
  // gauge must never over-state headroom. Needs a real span (≥2 records, ≥0.5 mo) to mean anything.
  const recs = (state && state.records) || [];
  let oldest = Infinity, n = 0;
  for (const r of recs) { const t = +new Date(r && r.checkinTime); if (Number.isFinite(t) && t > 0 && t <= nowMs) { n++; if (t < oldest) oldest = t; } }
  let ageMonths = null, growthPerMonth = null, monthsToCeiling = null;
  if (n >= 2 && oldest < Infinity) {
    ageMonths = (nowMs - oldest) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths >= 0.5 && cacheBytes > 0) {
      growthPerMonth = cacheBytes / ageMonths;
      if (growthPerMonth > 0 && ceilingBytes > 0) monthsToCeiling = Math.max(0, (ceilingBytes - cacheBytes) / growthPerMonth);
    }
  }
  return { cacheBytes, ceilingBytes, pctUsed: ceilingBytes > 0 ? cacheBytes / ceilingBytes : 0, slices, ageMonths, growthPerMonth, monthsToCeiling };
}

const _fmtMB = bytes => (bytes / 1048576).toFixed(2) + ' MB';

// localStorage fallback cap (~5 MB on iPad Safari). When the cache is in IndexedDB (Phase 2)
// the real ceiling is the browser's storage quota (navigator.storage.estimate().quota).
const _STORAGE_CEILING = 5 * 1024 * 1024;

async function _storageCard() {
  const idb = idbAvailable();
  let ceiling = _STORAGE_CEILING, usage = null, persisted = null, quotaKnown = !idb;   // localStorage: 5 MB IS the real cap
  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (idb && navigator.storage.estimate) { const est = await navigator.storage.estimate(); if (est && est.quota) { ceiling = est.quota; quotaKnown = true; } usage = (est && typeof est.usage === 'number') ? est.usage : null; }
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted().catch(() => null);
    }
  } catch (e) {}
  const cacheBytes = cacheByteSize();
  // In IDB with no reported quota, don't measure against the 5 MB localStorage cap (would false-alarm)
  // — pass 0 so no bar-% / runway warning is computed; the display shows "IndexedDB" instead.
  const st = computeStorageStats(getState(), cacheBytes, Date.now(), quotaKnown ? ceiling : 0);
  const pct = Math.min(100, Math.round(st.pctUsed * 100));
  const barColor = st.pctUsed >= 0.9 ? '#fa746f' : st.pctUsed >= 0.7 ? '#d4860a' : '#2a7a4f';
  const m = st.monthsToCeiling;
  const runway = !quotaKnown ? 'Plenty of room (IndexedDB).'
    : m == null ? 'Not enough history yet to project a runway.'
    : m >= 60 ? 'Years of headroom at the current pace.'
    : `~${m < 1 ? '<1 month' : Math.round(m) + ' month' + (Math.round(m) === 1 ? '' : 's')} of headroom at the current pace${st.growthPerMonth ? ` (+${_fmtMB(st.growthPerMonth)}/mo)` : ''}.`;
  const rows = st.slices.filter(s => s.bytes > 2).slice(0, 6).map(s =>
    `<div class="flex justify-between text-[11px] font-body"><span class="text-on-surface-variant">${_esc(s.key)}${s.count != null ? ` · ${s.count}` : ''}</span><span class="text-on-surface">${_fmtMB(s.bytes)}</span></div>`).join('');
  const warn = m != null && m < 6
    ? `<div class="text-[11px] font-body mt-2" style="color:${m < 3 ? '#fa746f' : '#d4860a'}">⚠️ Approaching the on-device cache limit — time to plan the storage upgrade.</div>` : '';
  return `<div class="bg-surface-container rounded-xl px-4 py-3 mb-4 border border-surface-container-high">
    <div class="flex items-center justify-between gap-2 mb-1">
      <div class="font-headline font-semibold text-on-surface text-sm">On-device storage</div>
      <div class="text-[11px] text-outline">${_fmtMB(st.cacheBytes)} / ${quotaKnown ? _fmtMB(ceiling) : 'IndexedDB'}</div>
    </div>
    <div class="h-2 rounded-full bg-surface-container-high overflow-hidden mb-2"><div style="width:${pct}%;background:${barColor};height:100%"></div></div>
    <div class="text-[11px] font-body text-on-surface-variant mb-2">${runway}</div>
    <div class="space-y-0.5">${rows}</div>
    ${warn}
    <div class="text-[10px] font-body text-outline mt-2">Backend: ${idb ? 'IndexedDB' : 'localStorage'}${persisted === true ? ' · persistent' : persisted === false ? ' · best-effort (install to Home Screen for durability)' : ''}${usage != null ? ` · ${_fmtMB(usage)} of ${_fmtMB(ceiling)} origin used` : ''}</div>
  </div>`;
}

// ── Fleet: which devices run which build (Phase 3 Stage 0) ────────────────────
// Table shaping for the per-device version map the DO keeps from WS hellos. The
// archive roll-off gate reads the same signal ("no device below vR seen in 14
// days"), so the flags here mirror that horizon: behind-version and ≥14d-stale.
// "Behind" compares against the NEWEST build seen anywhere (fleet or viewer) —
// a viewer that is itself on a stale build must not paint every newer device amber.
const _vNum = s => { const m = /^v(\d+)\.(\d+)/.exec(String(s || '')); return m ? (+m[1]) * 1000 + (+m[2]) : -1; };
export function fleetLatest(devices, viewerVersion) {
  return [viewerVersion, ...(devices || []).map(d => d && d.v)]
    .reduce((a, b) => (_vNum(b) > _vNum(a) ? b : a), viewerVersion);
}
export function fleetRows(devices, viewerVersion, nowMs) {
  const latest = fleetLatest(devices, viewerVersion);
  return (devices || []).map(d => {
    const ageDays = d && d.lastSeen ? (nowMs - d.lastSeen) / 86400000 : null;
    return {
      device: String((d && d.device) || ''),
      app: (d && d.app) || '?',
      v: (d && d.v) || '?',
      lastSeen: (d && d.lastSeen) || 0,
      current: !!(d && d.v) && _vNum(d.v) >= 0 && _vNum(d.v) >= _vNum(latest),
      staleDays: ageDays == null ? null : Math.floor(ageDays),
      stale: ageDays != null && ageDays >= 14,
    };
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}

async function _fleetCard() {
  let devices = [];
  try {
    const r = await fetch(STATE_PROXY + '/fleet', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    devices = (await r.json()).devices || [];
  } catch (e) {
    // 404/426 = the server predates this feature (client shipped first) — say so
    // instead of looking like an outage.
    const pending = /^(404|426)$/.test((e && e.message) || '');
    return `<div class="bg-surface-container rounded-xl px-4 py-3 mb-4 border border-surface-container-high">
      <div class="font-headline font-semibold text-on-surface text-sm mb-1">Devices</div>
      <div class="text-[11px] font-body text-on-surface-variant">${pending ? 'Server update pending — the device list appears after the next server deploy.' : 'Couldn’t load the device list right now.'}</div>
    </div>`;
  }
  const rows = fleetRows(devices, APP_VERSION, Date.now());
  const latest = fleetLatest(devices, APP_VERSION);
  const body = rows.length ? rows.map(r => {
    const badge = r.current
      ? `<span class="text-[10px] font-body font-semibold" style="color:#2a7a4f">${_esc(r.v)}</span>`
      : `<span class="text-[10px] font-body font-semibold" style="color:#d4860a">${_esc(r.v)} · behind</span>`;
    return `<div class="flex items-center justify-between gap-2 text-[11px] font-body py-0.5">
      <span class="text-on-surface min-w-0 truncate">${_esc(r.device)}${r.device === DEVICE_ID ? ' <span class="text-outline">(this device)</span>' : ''} · ${_esc(r.app)}</span>
      <span class="flex-shrink-0">${badge} <span class="${r.stale ? 'text-error' : 'text-outline'}">${_ago(r.lastSeen)}</span></span>
    </div>`;
  }).join('') : '<div class="text-[11px] font-body text-on-surface-variant">No devices reported yet — they appear as each one reconnects.</div>';
  return `<div class="bg-surface-container rounded-xl px-4 py-3 mb-4 border border-surface-container-high">
    <div class="flex items-center justify-between gap-2 mb-1">
      <div class="font-headline font-semibold text-on-surface text-sm">Devices</div>
      <div class="text-[11px] text-outline">latest ${_esc(latest)}</div>
    </div>
    <div class="space-y-0.5">${body}</div>
    <div class="text-[10px] font-body text-outline mt-2">Updated when each device connects (at most hourly). Amber = older build — tap the ↻ badge on that device.</div>
  </div>`;
}

function urlB64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const _alertsOn = () => { try { return localStorage.getItem('muse_error_alerts') === '1'; } catch (e) { return false; } };

// ── Bug-alert push opt-in (this device) ───────────────────────────────────────
// Registers the device's push subscription under the shared 'errors' id, which the
// Worker's /report handler pushes to on a new/serious error. Uses the same push
// machinery as chat/assignments; unsubscribing only drops the 'errors' link.
export async function enableBugAlerts() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { showToast('This device can’t receive push notifications'); return; }
    if (Notification.permission === 'denied') { showToast('Notifications are blocked — turn them on in the browser/site settings, then try again'); return; }
    let perm = Notification.permission;
    if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (e) {} }
    if (perm !== 'granted') { showToast('Notifications not turned on'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC_KEY) });
    const r = await fetch(PUSH_PROXY + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ techId: 'errors', subscription: sub.toJSON() }) });
    if (r.ok) { try { localStorage.setItem('muse_error_alerts', '1'); } catch (e) {} showToast('Bug alerts on for this device ✓'); renderDiagnostics(); }
    else showToast('Allowed, but couldn’t reach the server — try again');
  } catch (e) { showToast('Couldn’t turn on bug alerts — try again'); }
}
export async function disableBugAlerts() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await fetch(PUSH_PROXY + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ techId: 'errors', endpoint: sub.endpoint }) });
  } catch (e) {}
  try { localStorage.removeItem('muse_error_alerts'); } catch (e) {}
  showToast('Bug alerts off for this device'); renderDiagnostics();
}

export async function clearDiagnostics() {
  if (!window.confirm('Clear the whole error log? This only clears the saved reports — it does not affect any data.')) return;
  try {
    const r = await fetch(REPORT_PROXY + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    showToast(r.ok ? 'Error log cleared' : 'Couldn’t clear — try again');
  } catch (e) { showToast('Couldn’t clear — try again'); }
  renderDiagnostics();
}

export function toggleDiagStack(fp) {
  try { const d = document.getElementById('diagstack-' + fp); if (d) d.classList.toggle('hidden'); } catch (e) {}
}

// ── Render ────────────────────────────────────────────────────────────────────
export async function renderDiagnostics() {
  const el = document.getElementById('diagnostics-content');
  if (!el) return;
  el.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-3 opacity-70">Loading…</div>';

  // Local storage gauge — computed from device state, so it renders even when the
  // error-log fetch below fails (offline is exactly when the cache picture matters).
  let sc = ''; try { sc = await _storageCard(); } catch (e) { /* gauge must never break the error log below */ }
  let fc = ''; try { fc = await _fleetCard(); } catch (e) { /* fleet card must never break the error log below */ }
  const cards = sc + fc;

  let errors = [];
  try {
    const r = await fetch(REPORT_PROXY, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    errors = (await r.json()).errors || [];
  } catch (e) {
    el.innerHTML = cards + '<div class="text-sm font-body text-error py-3">Couldn’t load the error log (offline, or the server is unreachable). Try again in a moment.</div>';
    return;
  }

  const on = _alertsOn();
  const alertCard = `<div class="bg-surface-container rounded-xl px-4 py-3 mb-4 border border-surface-container-high flex items-center justify-between gap-3">
    <div class="min-w-0">
      <div class="font-headline font-semibold text-on-surface text-sm">Bug alerts on this device</div>
      <div class="text-[11px] font-body text-on-surface-variant mt-0.5">${on ? 'On — you’ll get a push here when something new or serious fails.' : 'Get a push notification the moment something fails (deduped so one bug can’t spam you).'}</div>
    </div>
    ${on
      ? `<button onclick="disableBugAlerts()" class="flex-shrink-0 px-3 py-1.5 rounded-lg border border-surface-container-high text-on-surface-variant text-xs font-body font-semibold">Turn off</button>`
      : `<button onclick="enableBugAlerts()" class="flex-shrink-0 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-body font-semibold flex items-center gap-1"><span class="material-symbols-outlined" style="font-size:15px">notifications_active</span> Turn on</button>`}
  </div>`;

  const header = `<div class="flex items-center justify-between gap-2 mb-3">
    <div class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest">Recent failures ${errors.length ? `· ${errors.length}` : ''}</div>
    <div class="flex gap-2">
      <button onclick="renderDiagnostics()" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-body font-semibold"><span class="material-symbols-outlined" style="font-size:15px">refresh</span> Refresh</button>
      ${errors.length ? `<button onclick="clearDiagnostics()" class="px-3 py-1.5 rounded-lg border border-surface-container-high text-on-surface-variant text-xs font-body font-semibold">Clear</button>` : ''}
    </div>
  </div>`;

  if (!errors.length) {
    el.innerHTML = cards + alertCard + header + '<div class="text-sm font-body text-on-surface-variant py-3 opacity-70">No errors logged. 🎉 If something misbehaves, it will show up here (and push you if alerts are on).</div>';
    return;
  }

  const list = errors.map(e => {
    const fp = _esc(e.fingerprint || Math.random().toString(36).slice(2));
    const times = e.count > 1 ? `${e.count}×` : '1×';
    const border = e.serious ? 'border-error/50' : 'border-surface-container-high';
    const crumbs = (e.breadcrumbs || []).length ? `<div class="text-[10px] font-mono text-on-surface-variant mt-2 whitespace-pre-wrap opacity-80">${_esc((e.breadcrumbs || []).join('\n'))}</div>` : '';
    return `<div class="bg-surface-container rounded-xl px-4 py-3 mb-1.5 border ${border}">
      <div class="flex items-center justify-between gap-2 mb-1">
        <div class="min-w-0"><span class="font-headline font-semibold text-on-surface text-sm break-words">${e.serious ? '⚠️ ' : ''}${_esc(e.context || 'error')}</span></div>
        <span class="text-[11px] text-outline flex-shrink-0 whitespace-nowrap">${times} · ${_ago(e.lastAt)}</span>
      </div>
      <div class="text-xs font-body text-on-surface mb-1 break-words">${_esc(e.message || '')}</div>
      <div class="text-[11px] font-body text-on-surface-variant">${_esc(e.version || '')}${e.view ? ' · ' + _esc(e.view) : ''}${e.user ? ' · ' + _esc(e.user) : ''}${e.online === false ? ' · offline' : ''}</div>
      ${(e.stack || crumbs) ? `<button onclick="toggleDiagStack('${fp}')" class="text-[11px] font-body text-primary font-semibold mt-1.5">Details ▾</button>
      <div id="diagstack-${fp}" class="hidden mt-1">
        ${e.stack ? `<pre class="text-[10px] font-mono text-on-surface-variant whitespace-pre-wrap break-words max-h-48 overflow-auto bg-surface-container-lowest rounded-lg p-2 border border-surface-container-high">${_esc(e.stack)}</pre>` : ''}
        ${crumbs}
        <div class="text-[10px] font-body text-outline mt-1">${_esc(e.device || '')}${e.ua ? ' · ' + _esc(e.ua) : ''}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = cards + alertCard + header + list;
}
