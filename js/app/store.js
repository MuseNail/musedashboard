// ── Single State Store ──────────────────────────────────────────────────────
// The one in-memory home for all app state. Hydrated from the Durable Object,
// mutated only via applyChange() (called by the optimistic local path AND by
// remote `change` broadcasts), and observed by feature modules via subscribe().
//
// No global mutable scope: feature modules import { getState, subscribe } and
// dispatch writes through sync.js (which calls applyChange + sends the mutation).

const CACHE_KEY = 'muse_state_cache';

// Canonical config field names (clean slate — not the old muse_* Sheets keys).
function emptyConfig() {
  return {
    staff: [], services: [], items: [], fees: [], fd_users: [],
    schedule: {}, turn_config: {}, bonus_services: [],
    hidden_services: [], hidden_dash_services: [], inactive_staff: [],
    logo: null, turns_order: [], turns_break: [], turns_off: [],
    role_permissions: {}, photos: {}, square_config: null, station_layout: {}, stations: [], station_categories: [], customer_notes: {},
    unassigned_cal_id: '', pay_period: { type: 'weekly', startDate: '' }, payroll_checks: {},
    chat_log: [],   // staff chat messages [{id,uid,name,text,ts}] (capped); rides config sync
    appt_reminder_leads: [30],   // minutes-before to show appointment reminder banners
    cal_autohide_offduty: false, // opt-in: hide off-duty staff calendars by default each day
    svc_time_reset: {},  // per-tech service-time benchmark cutoff { [techId]: ms } — ignore visits before this
    cash_drawer: null,         // the current OPEN cash-drawer shift (or null); see features/cashdrawer.js
    cash_drawer_history: [],   // closed drawer shifts (rolling cap), each with its reconciliation
    edit_locks: {},            // cross-device Assign&Price hard lock { [lockKey]: {device,name,at} }; see queue.js
    last_rollover_date: '',    // SHARED day-rollover marker (localDateStr). Gates the once-per-day housekeeping globally so a device first opened mid-day can't re-clear the roster — see main.js runDayRolloverIfNeeded
  };
}

const state = {
  config:    emptyConfig(),
  queue:     [],
  records:   [],
  giftcards: [],
  deletions: [],   // array of deleted record ids (strings)
  audit:     [],   // universal activity log (newest first, capped) — synced via the DO
  seq:       0,
  // connection / sync status (set by sync.js, observed by the UI indicator)
  connected:    false,
  pendingCount: 0, // outbox length
};

const subscribers = new Set();

export function getState() { return state; }

// Subscribe to any state change. fn(state, changedOp). Returns an unsubscribe fn.
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(changed) {
  for (const fn of subscribers) {
    try { fn(state, changed); } catch (e) { console.error('[store] subscriber error', e); }
  }
}

// ── id helpers ────────────────────────────────────────────────────────────────
function upsertById(arr, item) {
  const i = arr.findIndex(x => String(x.id) === String(item.id));
  if (i >= 0) arr[i] = item; else arr.push(item);
}
// Stale-write guard: an incoming write is REJECTED only when the copy we already hold is
// strictly NEWER (by updatedAt). This stops a lingering stale device copy (e.g. an old outbox
// op from before a fee was added) from clobbering a good record. Writes without a timestamp on
// either side always apply (legacy data isn't guarded). Returns true if applied.
export function isStaleWrite(prev, next) {
  return !!(prev && next && typeof prev.updatedAt === 'number' && typeof next.updatedAt === 'number' && prev.updatedAt > next.updatedAt);
}
function upsertByIdGuarded(arr, item) {
  const i = arr.findIndex(x => String(x.id) === String(item.id));
  if (i < 0) { arr.push(item); return true; }
  if (isStaleWrite(arr[i], item)) return false;   // keep the newer copy
  arr[i] = item;
  return true;
}
function removeById(arr, id) {
  const i = arr.findIndex(x => String(x.id) === String(id));
  if (i >= 0) arr.splice(i, 1);
}

// ── Hydrate from a full DO snapshot ─────────────────────────────────────────────
export function hydrate(snap) {
  const incoming = (snap && snap.state) || {};
  const cfg = incoming.config || {};
  const merged = emptyConfig();
  for (const k of Object.keys(merged)) {
    if (cfg[k] !== undefined && cfg[k] !== null) merged[k] = cfg[k];
  }
  state.config    = merged;
  state.queue     = Array.isArray(incoming.queue)     ? incoming.queue     : [];
  state.records   = Array.isArray(incoming.records)   ? incoming.records   : [];
  state.giftcards = Array.isArray(incoming.giftcards) ? incoming.giftcards : [];
  state.deletions = Array.isArray(incoming.deletions) ? incoming.deletions.map(d => String(d.id ?? d)) : [];
  state.audit     = Array.isArray(incoming.audit) ? incoming.audit : [];
  state.seq       = snap && snap.seq ? snap.seq : 0;
  saveCache();
  notify('hydrate');
}

// ── Apply a single change ────────────────────────────────────────────────────
// Used by both the optimistic local dispatch and remote `change` broadcasts.
// Pure state mutation + notify; never performs I/O.
export function applyChange(op, payload, seq) {
  switch (op) {
    case 'config.set':    state.config[payload.key] = payload.value; break;
    case 'queue.upsert':  if (!upsertByIdGuarded(state.queue, payload.entry)) return; break;   // stale → ignore (keep newer)
    case 'queue.remove':  removeById(state.queue, payload.id); break;
    case 'record.save':
      // Never revive a deleted transaction: a stale paid queue copy on another device can re-fire
      // saveRecord with a fresh updatedAt that would pass the stale-write guard and un-delete the
      // record at the storage layer (invisible in the dashboard, but a backup restore brings it back).
      if (state.deletions.includes(String(payload.record && payload.record.id))) return;
      if (!upsertByIdGuarded(state.records, payload.record)) return;   // stale → ignore (keep newer)
      break;
    case 'record.delete': {
      const r = state.records.find(x => String(x.id) === String(payload.id));
      if (r) r.status = 'deleted';
      if (!state.deletions.includes(String(payload.id))) state.deletions.push(String(payload.id));
      break;
    }
    case 'giftcard.save':   upsertById(state.giftcards, payload.card); break;
    case 'giftcard.delete': removeById(state.giftcards, payload.id); break;
    case 'audit.log':       if (payload && payload.event) { state.audit.unshift(payload.event); if (state.audit.length > 500) state.audit.length = 500; } break;
    default: console.warn('[store] unknown op', op); return;
  }
  if (typeof seq === 'number' && seq > state.seq) state.seq = seq;
  saveCache();
  notify(op);
}

// ── Connection status (set by sync.js) ──────────────────────────────────────────
export function setConnection(connected, pendingCount) {
  state.connected = connected;
  if (typeof pendingCount === 'number') state.pendingCount = pendingCount;
  notify('connection');
}

// ── Offline cache (instant render on reload before the DO snapshot arrives) ─────
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      config: state.config, queue: state.queue, records: state.records,
      giftcards: state.giftcards, deletions: state.deletions, seq: state.seq,
    }));
  } catch (e) { /* quota / unavailable — non-fatal */ }
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    hydrate({ state: JSON.parse(raw), seq: JSON.parse(raw).seq });
    return true;
  } catch (e) { return false; }
}
