// ── Muse Staff — minimal technician app ─────────────────────────────────────
// A SEPARATE page (staff.html) that reuses the dashboard's Durable Object sync
// (store + sync) but shows ONLY the logged-in tech's assigned services. The tech
// can Start the service, enter a price, and mark it Complete — pushed back to the
// dashboard via the same queue.upsert mutation. The front desk still owns "Paid".
//
// It never renders the dashboard, reports, settings, or other customers. (UI-level
// separation only — the open transport still sends full state; true per-tech
// isolation is the server-auth item, intentionally out of scope here.)
import * as store from './store.js';
import * as sync from './sync.js';
import { showToast } from './utils.js';
import { deriveEntryStatus, isPaidStatus } from './features/status.js';

const cfg   = () => store.getState().config;
const queue = () => store.getState().queue;
const svc   = id => (cfg().services || []).find(s => s.id === id);

const MY_KEY = 'muse_staff_id';            // device-local: which tech is signed in on THIS device
let myId = localStorage.getItem(MY_KEY) || null;
const _priceDraft = {};                    // `${entryId}:${serviceId}` -> typed price (survives re-render)

// ── Pure helpers (exported for unit tests) ───────────────────────────────────
export function staffByPin(staffList, inactiveIds, pin) {
  const p = String(pin == null ? '' : pin).trim();
  if (!p) return null;
  const inactive = new Set(inactiveIds || []);
  return (staffList || []).find(s => s.pin && String(s.pin) === p && !inactive.has(s.id)) || null;
}
// Active (not-paid) assignments for this tech, flattened to { entry, assignment }.
export function myActiveAssignments(queueArr, techId) {
  const out = [];
  if (!techId) return out;
  (queueArr || []).forEach(e => {
    if (isPaidStatus(e.status)) return;
    (e.assignments || []).forEach(a => { if (a.techId && a.techId === techId) out.push({ entry: e, assignment: a }); });
  });
  return out;
}

const me = () => (cfg().staff || []).find(s => s.id === myId) || null;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function parsePrice(v) { if (v == null || String(v).trim() === '') return null; const n = parseFloat(v); return (isFinite(n) && n >= 0) ? n : null; }

const STATUS_CHIP = {
  waiting:   { bg:'#ffe0c2', fg:'#6d3200', label:'Waiting'    },
  inservice: { bg:'#c8e6c5', fg:'#1b5e20', label:'In Service' },
  complete:  { bg:'#cfe3ef', fg:'#0a3a52', label:'Complete'   },
  paid:      { bg:'#dde2e5', fg:'#555555', label:'Paid'        },
};
function statusChip(status) {
  const c = STATUS_CHIP[status] || STATUS_CHIP.waiting;
  return `<span class="text-[11px] font-body font-bold px-2 py-0.5 rounded-full" style="background:${c.bg};color:${c.fg}">${c.label}</span>`;
}

// ── Render ────────────────────────────────────────
function render() {
  const meStaff = me();
  if (!meStaff) return renderLogin();
  renderList(meStaff);
}

function renderLogin(errMsg) {
  document.getElementById('staff-login').classList.remove('hidden');
  document.getElementById('staff-main').classList.add('hidden');
  const connecting = !store.getState().connected && (cfg().staff || []).length === 0;
  const status = document.getElementById('staff-login-status');
  if (status) status.textContent = errMsg || (connecting ? 'Connecting…' : '');
}

function renderList(meStaff) {
  document.getElementById('staff-login').classList.add('hidden');
  document.getElementById('staff-main').classList.remove('hidden');
  document.getElementById('staff-tech-name').textContent = meStaff.name;
  const dot = document.getElementById('staff-conn');
  if (dot) dot.style.background = store.getState().connected ? '#2a7a4f' : '#e8730a';

  const rows = myActiveAssignments(queue(), myId);
  const listEl = document.getElementById('staff-list');
  if (rows.length === 0) {
    listEl.innerHTML = `<div class="text-center text-on-surface-variant font-body py-20 px-6">
      <span class="material-symbols-outlined" style="font-size:48px;opacity:0.4">event_available</span>
      <div class="mt-3 text-lg">No customers assigned to you right now.</div>
      <div class="text-sm mt-1 text-outline-variant">They'll appear here the moment the front desk assigns you.</div></div>`;
    return;
  }
  // Group the tech's service lines under each customer.
  const byEntry = new Map();
  rows.forEach(({ entry, assignment }) => {
    if (!byEntry.has(entry.id)) byEntry.set(entry.id, { entry, items: [] });
    byEntry.get(entry.id).items.push(assignment);
  });
  listEl.innerHTML = [...byEntry.values()].map(({ entry, items }) => cardHtml(entry, items)).join('');
}

function cardHtml(entry, assignments) {
  return `<div class="bg-surface-container-lowest rounded-2xl border border-surface-container-high p-4 mb-3 shadow-sm">
    <div class="font-headline font-bold text-lg text-on-surface mb-3">${esc(entry.name || 'Guest')}</div>
    <div class="space-y-3">${assignments.map(a => lineHtml(entry, a)).join('')}</div>
  </div>`;
}

function lineHtml(entry, a) {
  const s = svc(a.serviceId);
  const label = s ? s.label : 'Service';
  const status = a.status || 'waiting';
  const key = entry.id + ':' + a.serviceId;
  const priceVal = (key in _priceDraft) ? _priceDraft[key] : (a.cost ? a.cost : '');
  const placeholder = (s && s.baseCost != null) ? Number(s.baseCost).toFixed(2) : '0.00';
  const btn = (txt, fn, primary) => `<button onclick="${fn}('${entry.id}','${esc(a.serviceId)}')"
    class="px-4 py-2 rounded-xl font-headline font-bold text-sm transition-all active:scale-95 ${primary
      ? 'bg-primary hover:bg-primary-dim text-on-primary'
      : 'border-2 border-primary text-primary hover:bg-primary/10'}">${txt}</button>`;
  const start    = status === 'waiting' ? btn('Start', 'staffStart', false) : '';
  const complete = (status === 'waiting' || status === 'inservice') ? btn('Complete', 'staffComplete', true) : '';
  const reopen   = status === 'complete' ? btn('Reopen', 'staffReopen', false) : '';
  return `<div class="border-t border-surface-container-high pt-3 first:border-t-0 first:pt-0">
    <div class="flex items-center justify-between mb-2">
      <span class="font-headline font-semibold text-on-surface">${esc(label)}</span>${statusChip(status)}
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="flex items-center gap-1">
        <span class="text-on-surface-variant font-headline text-lg">$</span>
        <input type="text" inputmode="decimal" value="${priceVal}" placeholder="${placeholder}"
          oninput="staffPriceInput('${entry.id}','${esc(a.serviceId)}',this.value)"
          class="w-28 bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-lg font-body text-right focus:outline-none focus:border-primary">
      </div>
      <div class="flex-1"></div>
      ${start}${reopen}${complete}
    </div>
  </div>`;
}

// ── Actions ───────────────────────────────────────
function updateAssignment(entryId, serviceId, mut) {
  const src = queue().find(e => String(e.id) === String(entryId));
  if (!src) return;
  const entry = JSON.parse(JSON.stringify(src));   // clone so the optimistic dispatch is the only writer
  const a = (entry.assignments || []).find(x => x.serviceId === serviceId && x.techId === myId);
  if (!a) { showToast('That service is no longer assigned to you'); return; }
  mut(a);
  entry.status = deriveEntryStatus(entry);
  sync.dispatch('queue.upsert', { entry });        // optimistic local apply → subscribe re-renders
}

window.staffPriceInput = (entryId, serviceId, val) => { _priceDraft[entryId + ':' + serviceId] = val; };

window.staffStart = (entryId, serviceId) => {
  const priced = parsePrice(_priceDraft[entryId + ':' + serviceId]);
  updateAssignment(entryId, serviceId, a => { a.status = 'inservice'; if (priced != null) a.cost = priced; });
  showToast('Started');
};
window.staffComplete = (entryId, serviceId) => {
  const key = entryId + ':' + serviceId;
  const priced = parsePrice(_priceDraft[key]);
  updateAssignment(entryId, serviceId, a => { a.status = 'complete'; if (priced != null) a.cost = priced; });
  delete _priceDraft[key];
  showToast('Sent to front desk ✓');
};
window.staffReopen = (entryId, serviceId) => {
  updateAssignment(entryId, serviceId, a => { a.status = 'inservice'; });
  showToast('Reopened');
};

window.staffPinSubmit = () => {
  const input = document.getElementById('staff-pin-entry');
  const pin = (input?.value || '').trim();
  if ((cfg().staff || []).length === 0) { renderLogin('Connecting… try again in a moment'); return; }
  const match = staffByPin(cfg().staff, cfg().inactive_staff, pin);
  if (!match) { if (input) input.value = ''; renderLogin('Incorrect PIN'); return; }
  myId = match.id; localStorage.setItem(MY_KEY, myId);
  if (input) input.value = '';
  render();
};
window.staffPinKey = (ev) => { if (ev.key === 'Enter') window.staffPinSubmit(); };
window.staffSwitch = () => { localStorage.removeItem(MY_KEY); myId = null; render(); };

// ── Boot ──────────────────────────────────────────
function boot() {
  sync.start();
  store.subscribe(() => render());
  render();   // instant render from cached state; subscribe re-renders on hydrate
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/musedashboard/sw.js').catch(() => {});
}
// Only boot inside the real page (the login shell exists); skipped when imported
// by the Node test runner (the global shim's getElementById returns null).
if (typeof document !== 'undefined' && document.getElementById && document.getElementById('staff-login')) boot();
