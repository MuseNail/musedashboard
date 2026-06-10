// ── Bootstrap ────────────────────────────────────────────────────────────────
// Wires the modular app: attaches handler functions to window (so the existing
// inline onclick= markup keeps working), defines navigation, subscribes the
// store to re-render on remote changes, and runs startup.

import * as store from './store.js';
import * as sync from './sync.js';
import * as session from './session.js';
import { APP_VERSION } from './config.js';
import * as utils from './utils.js';
import * as auth from './features/auth.js';
import * as photos from './features/photos.js';
import * as catalog from './features/catalog.js';
import * as sqCust from './features/square-customers.js';
import * as sqCat from './features/square-catalog.js';
import * as sqPos from './features/square-pos.js';
import * as staff from './features/staff.js';
import * as checkin from './features/checkin.js';
import * as statusMod from './features/status.js';
import * as queue from './features/queue.js';
import * as turns from './features/turns.js';
import * as reports from './features/reports.js';
import * as giftcards from './features/giftcards.js';
import * as settings from './features/settings.js';
import * as calendar from './features/calendar.js';
import * as floorplan from './features/floorplan.js';
import * as appearance from './features/appearance.js';
import * as servicetime from './features/servicetime.js';
import * as chat from './features/chat.js';
import * as apptReminders from './features/appt-reminders.js';
import * as recovery from './features/recovery.js';
import * as audit from './features/audit.js';
import * as cashdrawer from './features/cashdrawer.js';
import * as sms from './features/sms.js';
import * as timeclock from './features/timeclock.js';
import * as fdSchedule from './features/fd-schedule.js';
import * as helcim from './features/helcim.js';
import * as quicksale from './features/quicksale.js';

// Expose every module's exports for inline onclick= handlers + cross-module glue.
[utils, auth, photos, catalog, sqCust, sqCat, sqPos, staff, checkin, statusMod, queue, turns, reports, giftcards, settings, calendar, floorplan, appearance, servicetime, chat, apptReminders, recovery, audit, cashdrawer, sms, timeclock, fdSchedule, helcim, quicksale]
  .forEach(ns => Object.assign(window, ns));
window.dispatch     = sync.dispatch;
window.calEventsFor = calendar.getCalEvents;

// ── Modal registry ────────────────────────────────
// Single source of truth for every dismissible modal/overlay + its close fn. Drives BOTH the
// Escape key (close the first open one) AND closeAllModals() on navigation (so a screen change
// never leaves an orphaned modal floating over the new screen / silently eating nav taps).
// `setup-wizard` is intentionally excluded (forced first-run setup); `pin-modal` is handled
// separately in the Esc handler.
const MODAL_CLOSERS = [
  ['tech-status-menu', turns.closeTechStatusMenu], ['group-assign-modal', queue.closeGroupAssignModal],
  ['manual-modal', queue.closeManualAdd], ['warn-modal', queue.closeWarnModal],
  ['turns-assign-modal', turns.closeTurnsAssignModal], ['turns-tech-modal', turns.closeTurnsTechModal],
  ['split-merge-modal', queue.closeSplitMergeModal], ['edit-services-modal', queue.closeEditServicesModal],
  ['service-modal', catalog.closeServiceModal], ['staff-modal', staff.closeStaffModal],
  ['staff-photo-modal', photos.closeStaffPhotoModal], ['schedule-picker', staff.closeSchedulePicker], ['week-fill-modal', staff.closeWeekFill],
  ['edit-checkin-modal', queue.closeEditCheckin], ['customer-dir-modal', sqCust.closeCustomerDir],
  ['edit-customer-modal', sqCust.closeEditCustomer], ['photo-crop-modal', photos.closePhotoCrop],
  ['delete-txn-modal', reports.closeDeleteTxnModal], ['refund-modal', reports.closeRefundModal],
  ['gc-modal', giftcards.closeGcModal], ['fduser-modal', auth.closeFdUserModal],
  ['appt-modal', calendar.closeApptModal], ['historical-modal', reports.closeHistoricalModal],
  ['square-confirm-modal', sqPos.closeSquareConfirm], ['admin-code-modal', auth.closeAdminCode],
  ['date-picker-modal', reports.closeDatePicker], ['compare-menu', reports.closeCompareMenu],
  ['day-picker-modal', reports.closeDayPicker], ['txn-merge-modal', reports.closeTxnMergeModal],
  ['rpt-drill-modal', reports.closeDrillDown], ['cash-register-modal', cashdrawer.closeCashRegister],
  ['square-modal', () => { const m = document.getElementById('square-modal'); m.classList.add('hidden'); m.style.display = ''; }],
  ['numpad-modal', utils.numpadConfirm],
];
// Generic force-hide on navigation (does NOT invoke each modal's close fn, so a programmatic/
// back nav isn't gated). User-initiated closes (Esc, backdrop tap, the X button) still run the
// per-modal logic, including the Edit Customer unsaved-changes guard.
function closeAllModals() {
  for (const [id] of MODAL_CLOSERS) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); el.style.display = ''; }
  }
}

// ── Navigation ────────────────────────────────────
// In-app back handling: the OS/browser back gesture used to reload the PWA
// (losing state). Instead we track screen history and return to the previous
// screen; back never unloads the page (we always keep a history entry to pop).
let _screenStack = [];
let _navBack = false;
function setupBackHandler() {
  history.pushState({ muse: true }, '');
  window.addEventListener('popstate', () => {
    const prev = _screenStack.pop();
    if (prev) { _navBack = true; goTo(prev); _navBack = false; }
    history.pushState({ muse: true }, '');
  });
}
function goTo(screenId, param) {
  closeAllModals();   // a screen change never leaves a modal orphaned over the new screen
  const prevScreen = document.querySelector('.screen.active')?.id;
  if (prevScreen && prevScreen !== screenId && !_navBack) {
    _screenStack.push(prevScreen);
    if (_screenStack.length > 30) _screenStack.shift();
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
  window.scrollTo(0, 0);
  if (screenId === 'screen-checkin') {
    session.ui.currentCheckinType = param === 'appointment' ? 'appointment' : 'walkin';
    checkin.renderGuestsContainer();
    const label = document.getElementById('checkin-type-label');
    if (label) label.innerHTML = param === 'appointment'
      ? '<span class="inline-flex items-center gap-1"><span class="material-symbols-outlined" style="font-size:14px;color:#785a1a">calendar_today</span> Appointment Check-In</span>'
      : 'Walk-In Check-In';
  }
  if (screenId === 'screen-desk') { utils.updateDeskDate(); settings.initCalHoursSelectors(); }
}
function showDashPanel(panel) {
  closeAllModals();
  ['queue','reports','transactions','payroll','turns','settings','giftcards','calendar','floorplan','customers'].forEach(p => {
    document.getElementById(`panel-${p}`)?.classList.remove('active');
    document.getElementById(`nav-${p}`)?.classList.remove('active');
  });
  document.getElementById(`panel-${panel}`)?.classList.add('active');
  document.getElementById(`nav-${panel}`)?.classList.add('active');
  // Re-render the panel being shown so it reflects the latest state. onStateChange only
  // re-renders the ACTIVE panel, so a queue change that landed while another tab was open
  // left the Queue panel stale (a check-in showed in Turns but not Queue until a refresh).
  if (panel === 'queue')        { queue.renderQueue(); queue.updateStats(); }
  if (panel === 'floorplan')    floorplan.renderFloorPlan();
  if (panel === 'reports')      reports.setReportRange('today');
  if (panel === 'transactions') reports.renderTransactions();
  if (panel === 'payroll')      reports.renderPayrollPage();
  if (panel === 'settings')     settings.renderSettingsPanel();
  if (panel === 'giftcards')    giftcards.renderGiftCards();
  if (panel === 'customers')    sqCust.renderCustomersTab();
  if (panel === 'calendar')     calendar.initCalendar();
  if (panel === 'turns') {
    const di = document.getElementById('turns-history-date'); if (di && !di.value) di.value = utils.todayStr();
    turns.renderTurns();
  }
}
function toggleStaffScheduleView() {
  const listView = document.getElementById('staff-list-view'), scheduleView = document.getElementById('staff-schedule-view'), btn = document.getElementById('schedule-view-btn');
  if (!listView || !scheduleView) return;
  const showingSchedule = !scheduleView.classList.contains('hidden');
  listView.classList.toggle('hidden', !showingSchedule);
  scheduleView.classList.toggle('hidden', showingSchedule);
  if (btn) { btn.style.background = showingSchedule ? '' : '#1a5252'; btn.style.color = showingSchedule ? '' : '#fff'; }
  if (!showingSchedule) staff.renderSchedule();
}
function showStaffListView() {
  document.getElementById('staff-list-view')?.classList.remove('hidden');
  document.getElementById('staff-schedule-view')?.classList.add('hidden');
  const btn = document.getElementById('schedule-view-btn'); if (btn) { btn.style.background = ''; btn.style.color = ''; }
}
Object.assign(window, { goTo, showDashPanel, toggleStaffScheduleView, showStaffListView });

// Let a mouse wheel scroll the top nav horizontally when it overflows a narrow desktop window
// (touch already pans it; the scrollbar is hidden via .no-scroll). justify-content:safe center
// keeps both ends reachable when it overflows.
(() => {
  const nav = document.getElementById('dash-nav');
  if (!nav) return;
  nav.addEventListener('wheel', (e) => {
    if (!e.deltaY || nav.scrollWidth <= nav.clientWidth) return;   // only hijack a vertical wheel when it actually overflows
    e.preventDefault();
    nav.scrollLeft += e.deltaY;
  }, { passive: false });
})();

// Live-sync status pill: tapping it forces a reconnect + fresh snapshot (catches up any
// changes missed while the socket was asleep), then reports state.
window.forceSyncNow = () => { sync.resync?.(); utils.showToast(store.getState().connected ? 'Live — syncing…' : 'Reconnecting…'); };

// ── Square auto-paid ──────────────────────────────
// The Square return tab writes muse_sq_paid on a successful charge; this (main)
// tab marks those customers Paid. Triggered by the storage event (return tab
// wrote it), regaining focus, and hydrate (covers a reopened app). IDs not yet in
// the hydrated queue are kept for a later pass; degrades to manual Mark Paid.
function applySquarePaidFlag() {
  let flag; try { flag = JSON.parse(localStorage.getItem('muse_sq_paid') || 'null'); } catch (e) { return; }
  if (!flag || !flag.ids || !flag.ids.length) return;
  if (Date.now() - (flag.at || 0) > 10 * 60 * 1000) { localStorage.removeItem('muse_sq_paid'); return; }
  const queue = store.getState().queue, remaining = [];
  flag.ids.forEach(id => {
    const e = queue.find(x => String(x.id) === String(id));
    if (!e) { remaining.push(id); return; }                 // not hydrated yet — retry on a later trigger
    if (!['paid', 'done'].includes(e.status)) window.updateStatus?.(String(id), 'paid');
  });
  if (remaining.length) localStorage.setItem('muse_sq_paid', JSON.stringify({ ids: remaining, at: flag.at }));
  else localStorage.removeItem('muse_sq_paid');
}
window.addEventListener('storage', e => { if (e.key === 'muse_sq_paid' && e.newValue) applySquarePaidFlag(); });
// NB: the day rollover is intentionally NOT triggered straight off visibilitychange — it would run
// on stale cached config before a resync lands (and could wrongly clear the roster). The resync
// fired on tab-visible pulls a fresh snapshot whose hydrate runs runDayRolloverIfNeeded with
// server-confirmed state (see onStateChange 'hydrate').
document.addEventListener('visibilitychange', () => { if (!document.hidden) { applySquarePaidFlag(); checkSquarePending(); checkAppVersion(); } });

// Installed-PWA fallback for the Square charge. On iOS a Home-Screen app is resumed
// after the Square hand-off WITHOUT the callback data, so the muse_sq_paid handoff
// above never fires (there's no return tab). But proceedSquarePayment stashed
// muse_sq_pending in this app's own storage right before launching Square, so on
// resume we ask the operator whether the charge went through — iOS gives us no way to
// know — and mark Paid on confirm. Handled once: the pending flag is cleared the moment
// we prompt, and we skip if the Safari return tab already wrote muse_sq_paid.
function checkSquarePending() {
  let pend; try { pend = JSON.parse(localStorage.getItem('muse_sq_pending') || 'null'); } catch (e) { return; }
  if (!pend || !pend.ids || !pend.ids.length) return;
  if (Date.now() - (pend.at || 0) > 8 * 60 * 1000) { localStorage.removeItem('muse_sq_pending'); return; }
  if (localStorage.getItem('muse_sq_paid')) return;   // Safari return tab is handling it
  localStorage.removeItem('muse_sq_pending');          // handle once
  const ids = pend.ids.map(String);
  const amt = pend.cents ? ` — $${(pend.cents / 100).toFixed(2)}` : '';
  const who = pend.names || 'this customer';
  const markPaid = () => {
    ids.forEach(id => { const e = store.getState().queue.find(x => String(x.id) === id); if (e && !['paid', 'done'].includes(e.status)) window.updateStatus?.(id, 'paid'); });
    utils.showToast('Marked paid');
  };
  if (window.showWarnModal) window.showWarnModal('Square payment complete?', `Mark ${who}${amt} as Paid? Tap Confirm if the charge went through in Square, or Cancel if it was canceled.`, markPaid);
}

// ── Store subscription → re-render the active panel on (remote) changes ───────
function updateSyncIndicator(state) {
  const dot = document.getElementById('conn-dot'), text = document.getElementById('conn-text');
  if (!dot) return;
  // A server-rejected/dead-lettered write is the most urgent state — surface it instead of a green "Synced".
  const failed = (sync.failedOps?.() || []).length;
  if (failed > 0) { dot.style.background = '#fa746f'; if (text) text.textContent = `Failed ${failed}`; dot.parentElement && (dot.parentElement.title = 'A change failed to save — open Settings → Data Recovery'); return; }
  if (state.connected) { dot.style.background = state.pendingCount > 0 ? '#f5c870' : '#2a7a4f'; if (text) text.textContent = state.pendingCount > 0 ? `Sync ${state.pendingCount}` : 'Synced'; }
  else { dot.style.background = '#fa746f'; if (text) text.textContent = state.pendingCount > 0 ? `Offline ${state.pendingCount}` : 'Offline'; }
}
function onStateChange(state, changed) {
  updateSyncIndicator(state);
  if (changed === 'connection') return;
  if (changed === 'hydrate') { applySquarePaidFlag(); runDayRolloverIfNeeded(); }   // apply pending Square auto-paid + roll over the day if needed, once the queue loads
  if (changed === 'hydrate' || (changed && changed.startsWith('config'))) {
    photos.setLogo(); auth.updateLoggedInDisplay(); chat.onChatSync(); timeclock.renderClockButton(); helcim.syncProcessorClass();
    // The customer directory is now a DO entity — it hydrates from the snapshot like records,
    // so no Square auto-pull on boot. (A one-time "Import from Square" seeds it; see the
    // Customers tab.) square-customers.js rebuilds its directory caches on every store change.
  }
  const desk = document.getElementById('screen-desk');
  if (!desk || !desk.classList.contains('active')) return;
  const active = document.querySelector('.dash-panel.active'); if (!active) return;
  switch (active.id) {
    case 'panel-turns':        turns.renderTurns(); break;
    case 'panel-floorplan':    floorplan.renderFloorPlan(); break;
    case 'panel-queue':        queue.renderQueue(); queue.updateStats(); break;
    case 'panel-reports':      reports.runReport(); break;
    case 'panel-transactions': reports.renderTransactions(); break;
    case 'panel-payroll':      reports.renderPayrollPage(); break;
    case 'panel-giftcards':    giftcards.renderGiftCards(); break;
  }
}

// ── Version check (display + tap for a HARD reload; no auto-reload loop) ───────
// The version badge is always a hard-reload button: on an installed iPad app a plain
// reload can keep serving the cached version, so tapping it unregisters the service
// worker + clears the cache and reloads to force the newest version. Data is untouched.
async function checkAppVersion() {
  const badge = document.getElementById('app-version-badge');
  if (!badge) return;
  badge.textContent = APP_VERSION;
  badge.title = 'Tap to reload to the latest version';
  badge.style.cursor = 'pointer';
  badge.onclick = promptHardReload;
  try {
    const res = await fetch('/musedashboard/version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      badge.textContent = data.version + ' ↻';
      badge.title = `Update ${data.version} available — tap to reload`;
    }
  } catch (e) {}
}
function promptHardReload() {
  const msg = 'This clears the app cache and reloads to get the newest version. It does NOT delete any data — your queue, customers, records, and settings are safe.';
  if (window.showWarnModal) window.showWarnModal('Reload to latest version?', msg, hardReload);
  else if (confirm('Reload to the latest version? No data is deleted.')) hardReload();
}
async function hardReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}
  location.reload();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/musedashboard/sw.js').catch(e => console.warn('[SW] registration failed:', e));
}

// ── Daily rollover (self-healing, midnight boundary) ──────────────────────────
// Replaces the old fragile 4 AM `setTimeout` reset. The day boundary no longer affects data
// integrity (records are the source of truth — see buildCombinedRecords), so this is just
// board hygiene + new-day housekeeping. Runs on hydrate, on tab-visible, and on a timer
// armed to the next local midnight; idempotent, so running it repeatedly is safe.
function runDayRolloverIfNeeded() {
  const today = utils.todayStr();
  const st = store.getState();
  const recIds = new Set((st.records || []).filter(r => r.status !== 'deleted').map(r => String(r.id)));
  // Finished tickets from a previous day that are ALREADY saved as a record — safe to drop
  // from the live board (the record is the permanent copy). Computed BEFORE we clear, so the
  // archive below still sees them. Active or unrecorded entries are never auto-removed.
  const stale = (st.queue || []).filter(e =>
    (e.status === 'paid' || e.status === 'done') &&
    recIds.has(String(e.id)) &&
    utils.localDateStr(new Date(e.checkinTime)) < today);
  // New-day housekeeping — once per day GLOBALLY (gated on the SHARED, synced last_rollover_date,
  // not a per-device marker). This is the fix for "my selected technicians disappeared mid-day":
  // the housekeeping CLEARS the roster (rolloverTurns → setOrder([])), and that clear broadcasts to
  // every device. With the old per-device gate, any device first opened mid-day (its local marker
  // still on yesterday) would think it was a new day, run the clear, and wipe the roster everyone
  // was using. Reading the marker from synced config means a device that shows up mid-day sees
  // "already rolled over today" and leaves the roster alone. Only callers with FRESH server state
  // run this (hydrate + the midnight timer) — NOT the raw visibilitychange path, which can fire on
  // stale cached config before a resync lands.
  const globalLast = st.config?.last_rollover_date || '';
  const action = utils.rolloverAction(globalLast, today);
  let didRollover = false;
  if (action === 'seed') {
    // Marker absent (fresh DO, or upgrading from the per-device scheme): seed to today WITHOUT
    // clearing anything, so the upgrade itself can never wipe a live roster.
    sync.dispatch('config.set', { key: 'last_rollover_date', value: today });
  } else if (action === 'rollover') {
    sync.dispatch('config.set', { key: 'last_rollover_date', value: today });   // claim first (synced) so other devices skip
    try { turns.rolloverTurns(globalLast); } catch (e) {}                        // archive closed day + clear the rotation
    sync.dispatch('config.set', { key: 'turns_break', value: [] });
    sync.dispatch('config.set', { key: 'chat_log', value: [] });                 // staff chat starts fresh each day
    utils.showToast("New day — yesterday's history saved");
    didRollover = true;
  }
  // Safe board cleanup — runs every time (idempotent); also self-heals a stale entry that a
  // still-connected device re-pushed from its outbox after a clear.
  if (stale.length) {
    stale.forEach(e => sync.dispatch('queue.remove', { id: e.id }));
    window.logAudit?.('Day rollover', `Cleared ${stale.length} finished ticket(s) from a prior day`);
  }
  if (stale.length || didRollover) { queue.renderQueue(); queue.updateStats(); turns.renderTurns(); chat.renderChat(); chat.updateChatBadge(); }
}
// Arm a one-shot timer to the next local midnight (+30s); it re-arms itself after firing.
// Hydrate + visibilitychange are the real safety net (cover device sleep / clock changes);
// this timer only handles a device left open across midnight.
function armMidnightRollover() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  setTimeout(() => { runDayRolloverIfNeeded(); armMidnightRollover(); }, nextMidnight - now);
}

// ── PWA install ───────────────────────────────────
let _pwaInstallEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _pwaInstallEvent = e; document.getElementById('pwa-install-banner')?.classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { _pwaInstallEvent = null; document.getElementById('pwa-install-banner')?.classList.add('hidden'); });
window.promptPwaInstall = () => { if (!_pwaInstallEvent) return; _pwaInstallEvent.prompt(); _pwaInstallEvent.userChoice.then(() => { _pwaInstallEvent = null; document.getElementById('pwa-install-banner')?.classList.add('hidden'); }); };

// ── Keyboard shortcuts ────────────────────────────
function wireKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const gm = document.getElementById('group-assign-modal');
      if (gm && !gm.classList.contains('hidden')) { e.preventDefault(); queue.saveGroupAssignments(); return; }
      const mm = document.getElementById('manual-modal');
      if (mm && !mm.classList.contains('hidden')) { const tag = document.activeElement?.tagName; if (tag !== 'SELECT' && tag !== 'TEXTAREA') { e.preventDefault(); queue.submitManualAdd(); return; } }
    }
    if (e.key === 'Escape') {
      for (const [id, fn] of MODAL_CLOSERS) { const el = document.getElementById(id); if (el && !el.classList.contains('hidden')) { fn(); return; } }
      const chatP = document.getElementById('chat-panel');
      if (chatP && !chatP.classList.contains('hidden')) { chat.closeChat(); return; }
      const calDD = document.getElementById('cal-selector-dropdown');
      if (calDD && !calDD.classList.contains('hidden')) { calendar.calSelectorCancel(); return; }
      const checkinScreen = document.getElementById('screen-checkin');
      if (checkinScreen && checkinScreen.classList.contains('active')) { goTo('screen-welcome'); return; }
      const pinModal = document.getElementById('pin-modal');
      if (pinModal && !pinModal.classList.contains('hidden')) { pinModal.classList.add('hidden'); pinModal.style.display = ''; }
    }
  });
}

// ── Square POS return handler ─────────────────────
// Square's mobile-web payment flow returns by opening callback_url in a NEW Safari
// tab — Apple's sandbox won't let an external app reuse an existing tab, so the tab
// itself is unavoidable (confirmed by Square). When we detect that return, show a
// tiny self-closing screen instead of booting a second live dashboard, and try to
// auto-close (best-effort; iOS usually blocks closing a non-script-opened tab).
function handleSquarePosReturn() {
  const fields = (s) => { const o = {}; try { new URLSearchParams(s).forEach((v, k) => { o[k] = v; }); } catch (e) {} return o; };
  const p = { ...fields(location.hash.replace(/^#/, '')), ...fields(location.search.replace(/^\?/, '')) };
  if (p.data) { try { Object.assign(p, JSON.parse(p.data)); } catch (e) {} }
  if (!['status', 'transaction_id', 'client_transaction_id', 'error_code'].some(k => k in p)) return false;

  const errored = p.status === 'error' || !!p.error_code;
  // On a successful charge, hand the stashed party off to the main tab to mark Paid.
  try {
    if (!errored) { const pend = JSON.parse(localStorage.getItem('muse_sq_pending') || 'null'); if (pend && pend.ids && pend.ids.length) localStorage.setItem('muse_sq_paid', JSON.stringify({ ids: pend.ids, at: Date.now() })); }
    localStorage.removeItem('muse_sq_pending');
  } catch (e) {}
  document.title = 'Muse — Payment';
  document.body.innerHTML = `
    <div style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#e8ecee;font-family:-apple-system,system-ui,sans-serif;">
      <div style="text-align:center;padding:32px;max-width:340px;">
        <div style="font-size:56px;line-height:1;margin-bottom:16px;">${errored ? '⚠️' : '✓'}</div>
        <div style="font-size:22px;font-weight:800;color:#1a5252;margin-bottom:8px;">${errored ? 'Payment not completed' : 'Payment complete'}</div>
        <div style="font-size:15px;color:#555;margin-bottom:24px;">You can close this tab and return to the Muse dashboard.</div>
        <button onclick="window.close()" style="background:#1a5252;color:#fff;border:none;padding:14px 28px;border-radius:14px;font-size:16px;font-weight:700;">Close tab</button>
      </div>
    </div>`;
  try { window.close(); } catch (e) {}
  setTimeout(() => { try { window.close(); } catch (e) {} }, 300);
  return true;
}

// ── Global error surface ──────────────────────────
// On a headless front-desk iPad nobody watches the console — an uncaught error/rejection
// would otherwise leave a frozen screen with no signal. Best-effort: log + a throttled toast.
let _lastErrToast = 0;
function _errToast() {
  const now = Date.now();
  if (now - _lastErrToast < 15000) return;   // don't spam if errors cascade
  _lastErrToast = now;
  try { utils.showToast('Something went wrong. If the screen seems stuck, tap the version badge to reload.'); } catch (e) {}
}
window.addEventListener('error', e => { try { console.warn('[error]', e?.error || e?.message); _errToast(); } catch (x) {} });
window.addEventListener('unhandledrejection', e => { try { console.warn('[unhandledrejection]', e?.reason); } catch (x) {} });

// ── Boot ──────────────────────────────────────────
function boot() {
  if (handleSquarePosReturn()) return; // don't boot a 2nd live app in the Square return tab
  setupBackHandler();                 // OS back returns to the previous screen, never reloads the PWA
  sync.start();                       // connect to the DO, hydrate from cache + snapshot
  store.subscribe(onStateChange);
  appearance.applyUserTheme();        // default light palette until a user logs in

  utils.startClock();
  utils.updateDeskDate();
  utils.startElapsedTimer();
  checkin.renderGuestsContainer();
  photos.setLogo();
  queue.renderQueue();
  auth.updateLoggedInDisplay();
  chat.onChatSync();   // baseline the chat unread badge from cache on load
  apptReminders.startApptReminders();   // appointment reminder banners (30s timer)
  updateSyncIndicator(store.getState());

  // Confirm screen: tap anywhere to return to welcome
  const confirmScreen = document.getElementById('screen-confirm');
  if (confirmScreen) {
    const reset = () => { clearTimeout(window._confirmResetTimer); goTo('screen-welcome'); };
    confirmScreen.addEventListener('click', reset);
    confirmScreen.addEventListener('touchend', e => { e.preventDefault(); reset(); });
  }

  // First-time Square setup wizard
  setTimeout(() => { if (!store.getState().config.square_config && !sessionStorage.getItem('muse_setup_skipped')) settings.showSetupWizard(); }, 1500);

  wireKeyboard();
  armMidnightRollover();
  checkAppVersion();
  registerServiceWorker();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
