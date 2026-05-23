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

// Expose every module's exports for inline onclick= handlers + cross-module glue.
[utils, auth, photos, catalog, sqCust, sqCat, sqPos, staff, checkin, statusMod, queue, turns, reports, giftcards, settings, calendar]
  .forEach(ns => Object.assign(window, ns));
window.dispatch     = sync.dispatch;
window.calEventsFor = calendar.getCalEvents;

// ── Navigation ────────────────────────────────────
function goTo(screenId, param) {
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
  ['queue','reports','transactions','services','staff','turns','settings','giftcards','calendar'].forEach(p => {
    document.getElementById(`panel-${p}`)?.classList.remove('active');
    document.getElementById(`nav-${p}`)?.classList.remove('active');
  });
  document.getElementById(`panel-${panel}`)?.classList.add('active');
  document.getElementById(`nav-${panel}`)?.classList.add('active');
  if (panel === 'services')     catalog.renderServicesList();
  if (panel === 'staff')        { staff.renderStaffList(); auth.renderFdUsersList(); showStaffListView(); }
  if (panel === 'reports')      reports.setReportRange('today');
  if (panel === 'transactions') reports.renderTransactions();
  if (panel === 'settings')     settings.renderSettingsPanel();
  if (panel === 'giftcards')    giftcards.renderGiftCards();
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

// Header pills / obsolete-button stubs (the DO syncs in real time, so manual
// "sync to sheets" actions are no-ops now).
window.forceSyncNow      = () => utils.showToast(store.getState().connected ? 'Live — in sync' : 'Reconnecting…');
window.exportAllToSheets = () => utils.showToast('Auto-synced to the cloud ✓');

// ── Store subscription → re-render the active panel on (remote) changes ───────
function updateSyncIndicator(state) {
  const dot = document.getElementById('sheets-sync-dot'), text = document.getElementById('sheets-sync-text');
  if (!dot) return;
  if (state.connected) { dot.style.background = state.pendingCount > 0 ? '#f5c870' : '#2a7a4f'; if (text) text.textContent = state.pendingCount > 0 ? `Sync ${state.pendingCount}` : 'Synced'; }
  else { dot.style.background = '#fa746f'; if (text) text.textContent = state.pendingCount > 0 ? `Offline ${state.pendingCount}` : 'Offline'; }
}
function onStateChange(state, changed) {
  updateSyncIndicator(state);
  if (changed === 'connection') return;
  if (changed === 'hydrate' || (changed && changed.startsWith('config'))) { photos.setLogo(); auth.updateLoggedInDisplay(); }
  const desk = document.getElementById('screen-desk');
  if (!desk || !desk.classList.contains('active')) return;
  const active = document.querySelector('.dash-panel.active'); if (!active) return;
  switch (active.id) {
    case 'panel-turns':        turns.renderTurns(); break;
    case 'panel-queue':        queue.renderQueue(); queue.updateStats(); break;
    case 'panel-reports':      reports.runReport(); break;
    case 'panel-transactions': reports.renderTransactions(); break;
    case 'panel-giftcards':    giftcards.renderGiftCards(); break;
    case 'panel-services':     catalog.renderServicesList(); break;
    case 'panel-staff':        staff.renderStaffList(); auth.renderFdUsersList(); break;
  }
}

// ── Version check (display + tap-to-reload; no auto-reload loop) ───────────────
async function checkAppVersion() {
  const badge = document.getElementById('app-version-badge');
  if (badge) { badge.textContent = APP_VERSION; badge.title = 'musedashboard ' + APP_VERSION; }
  try {
    const res = await fetch('/musedashboard/version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION && badge) {
      badge.textContent = data.version + ' ↻';
      badge.title = `Update ${data.version} available — tap to reload`;
      badge.style.cursor = 'pointer';
      badge.onclick = () => location.reload();
    }
  } catch (e) {}
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/musedashboard/sw.js').catch(e => console.warn('[SW] registration failed:', e));
}

// ── Daily 4 AM reset ──────────────────────────────
function scheduleMidnightReset() {
  const now = new Date();
  const reset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 5);
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  setTimeout(() => {
    turns.archiveTurnsForToday();                              // snapshots + clears turns_order
    store.getState().queue.slice().forEach(e => sync.dispatch('queue.remove', { id: e.id }));
    sync.dispatch('config.set', { key: 'turns_break', value: [] });
    queue.renderQueue(); queue.updateStats(); turns.renderTurns();
    utils.showToast("New day — yesterday's history saved");
    scheduleMidnightReset();
  }, reset - now);
}

// ── PWA install ───────────────────────────────────
let _pwaInstallEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _pwaInstallEvent = e; document.getElementById('pwa-install-banner')?.classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { _pwaInstallEvent = null; document.getElementById('pwa-install-banner')?.classList.add('hidden'); });
window.promptPwaInstall = () => { if (!_pwaInstallEvent) return; _pwaInstallEvent.prompt(); _pwaInstallEvent.userChoice.then(() => { _pwaInstallEvent = null; document.getElementById('pwa-install-banner')?.classList.add('hidden'); }); };

// ── Keyboard shortcuts ────────────────────────────
function wireKeyboard() {
  const closers = [
    ['tech-status-menu', turns.closeTechStatusMenu], ['group-assign-modal', queue.closeGroupAssignModal],
    ['manual-modal', queue.closeManualAdd], ['warn-modal', queue.closeWarnModal],
    ['turns-assign-modal', turns.closeTurnsAssignModal], ['turns-tech-modal', turns.closeTurnsTechModal],
    ['split-merge-modal', queue.closeSplitMergeModal], ['edit-services-modal', queue.closeEditServicesModal],
    ['service-modal', catalog.closeServiceModal], ['staff-modal', staff.closeStaffModal],
    ['staff-photo-modal', photos.closeStaffPhotoModal], ['schedule-picker', staff.closeSchedulePicker],
    ['edit-checkin-modal', queue.closeEditCheckin], ['customer-dir-modal', sqCust.closeCustomerDir],
    ['edit-customer-modal', sqCust.closeEditCustomer], ['photo-crop-modal', photos.closePhotoCrop],
    ['delete-txn-modal', reports.closeDeleteTxnModal], ['refund-modal', reports.closeRefundModal],
    ['gc-modal', giftcards.closeGcModal], ['fduser-modal', auth.closeFdUserModal],
    ['appt-modal', calendar.closeApptModal], ['historical-modal', reports.closeHistoricalModal],
    ['square-modal', () => { const m = document.getElementById('square-modal'); m.classList.add('hidden'); m.style.display = ''; }],
    ['numpad-modal', utils.numpadConfirm],
  ];
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const gm = document.getElementById('group-assign-modal');
      if (gm && !gm.classList.contains('hidden')) { e.preventDefault(); queue.saveGroupAndAdvance(); return; }
      const mm = document.getElementById('manual-modal');
      if (mm && !mm.classList.contains('hidden')) { const tag = document.activeElement?.tagName; if (tag !== 'SELECT' && tag !== 'TEXTAREA') { e.preventDefault(); queue.submitManualAdd(); return; } }
    }
    if (e.key === 'Escape') {
      for (const [id, fn] of closers) { const el = document.getElementById(id); if (el && !el.classList.contains('hidden')) { fn(); return; } }
      const calDD = document.getElementById('cal-selector-dropdown');
      if (calDD && !calDD.classList.contains('hidden')) { calendar.calSelectorCancel(); return; }
      const checkinScreen = document.getElementById('screen-checkin');
      if (checkinScreen && checkinScreen.classList.contains('active')) { goTo('screen-welcome'); return; }
      const pinModal = document.getElementById('pin-modal');
      if (pinModal && !pinModal.classList.contains('hidden')) { pinModal.classList.add('hidden'); pinModal.style.display = ''; }
    }
  });
}

// ── Boot ──────────────────────────────────────────
function boot() {
  sync.start();                       // connect to the DO, hydrate from cache + snapshot
  store.subscribe(onStateChange);

  utils.startClock();
  utils.updateDeskDate();
  utils.startElapsedTimer();
  checkin.renderGuestsContainer();
  photos.setLogo();
  queue.renderQueue();
  auth.updateLoggedInDisplay();
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
  scheduleMidnightReset();
  checkAppVersion();
  registerServiceWorker();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
