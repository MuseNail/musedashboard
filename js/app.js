// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // ── ?clearData=1 handler ──────────────────────────────────────────────────
  // Visit https://musenail.github.io/musedashboard/?clearData=1 on any device
  // to wipe stale transaction/queue data from localStorage before a fresh start.
  // Requires admin PIN to prevent accidental clears.
  // Preserves staff, services, config, photos, gift cards, and user accounts.
  if (new URLSearchParams(window.location.search).get('clearData') === '1') {
    document.body.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100vh;background:#e8ecee;font-family:Manrope,sans-serif;flex-direction:column;gap:16px;';
    document.body.innerHTML = `
      <div id="clear-gate" style="background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 4px 24px rgba(0,0,0,.10);text-align:center;max-width:420px;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:20px;font-weight:700;color:#1a5252;margin-bottom:8px;">Clear Device Data</div>
        <div style="font-size:14px;color:#555;margin-bottom:20px;">This will erase all local transaction and queue data from this device.<br><br>Enter the admin PIN to confirm.</div>
        <input id="clear-pin" type="password" inputmode="numeric" maxlength="6"
          placeholder="Admin PIN"
          style="width:100%;padding:12px 16px;border:2px solid #c2cacd;border-radius:10px;font-size:18px;text-align:center;letter-spacing:6px;outline:none;box-sizing:border-box;margin-bottom:12px;"
          autofocus />
        <div id="clear-pin-error" style="color:#e53e3e;font-size:13px;min-height:18px;margin-bottom:12px;"></div>
        <div style="display:flex;gap:10px;">
          <button onclick="window.location.replace(window.location.pathname)"
            style="flex:1;padding:12px;border:2px solid #c2cacd;border-radius:10px;background:#fff;font-size:14px;font-weight:600;color:#555;cursor:pointer;">
            Cancel
          </button>
          <button id="clear-confirm-btn"
            style="flex:1;padding:12px;border:none;border-radius:10px;background:#c53030;font-size:14px;font-weight:700;color:#fff;cursor:pointer;">
            Clear This Device
          </button>
        </div>
      </div>`;

    const KEYS_TO_CLEAR = [
      'muse_records', 'muse_live_queue', 'muse_live_queue_date',
      'muse_queue_archive', 'muse_turns_history',
      'muse_turns_break', 'muse_turns_off', 'muse_turns_order',
      'muse_deletion_log', 'muse_logo', 'muse_records_updated_at',
    ];

    function attemptClear() {
      const pin = document.getElementById('clear-pin').value.trim();
      const err = document.getElementById('clear-pin-error');
      // Accept STAFF_PIN (1234) or any front-desk manager PIN stored in localStorage
      const storedUsers = JSON.parse(localStorage.getItem('muse_fd_users') || '[]');
      const validPins   = [STAFF_PIN, ...storedUsers.filter(u => u.role === 'manager' || u.role === 'admin').map(u => String(u.pin || ''))];
      if (!validPins.includes(pin)) {
        err.textContent = 'Incorrect PIN. Try again.';
        document.getElementById('clear-pin').value = '';
        document.getElementById('clear-pin').focus();
        return;
      }
      // PIN correct — clear the keys
      const cleared = [];
      KEYS_TO_CLEAR.forEach(k => {
        if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); cleared.push(k); }
      });
      console.log('[ClearData] Cleared keys:', cleared);
      document.getElementById('clear-gate').innerHTML = `
        <div style="font-size:40px;margin-bottom:12px;">✓</div>
        <div style="font-size:20px;font-weight:700;color:#1a5252;margin-bottom:8px;">Device Cleared</div>
        <div style="font-size:14px;color:#555;margin-bottom:4px;">Removed ${cleared.length} stale data key${cleared.length !== 1 ? 's' : ''} from this device.</div>
        <div style="font-size:13px;color:#888;margin-bottom:20px;">Staff, services, and settings were preserved.</div>
        <div style="font-size:12px;color:#aaa;">Redirecting to the dashboard…</div>`;
      setTimeout(() => { window.location.replace(window.location.pathname); }, 2000);
    }

    document.getElementById('clear-confirm-btn').addEventListener('click', attemptClear);
    document.getElementById('clear-pin').addEventListener('keydown', e => { if (e.key === 'Enter') attemptClear(); });
    return; // stop the rest of DOMContentLoaded from running
  }
  // ── end clearData handler ─────────────────────────────────────────────────

  // Check if a newer version is deployed — fetches live file bypassing CDN cache.
  // If a newer version exists, reloads automatically. Must run first.
  await checkAppVersion();

  // 1. Load config from Sheets FIRST so STAFF/SERVICES are populated before any render.
  //    On a fresh/cleared device this is the only source of staff and service data.
  setSheetsIndicator('syncing');
  const { changed: configChanged } = await loadConfigFromSheets();
  if (configChanged) setLogo();

  // 2. Load queue from localStorage (instant offline fallback) then render
  queue = loadQueueFromStorage();
  renderQueue();

  // Start Sheets polling
  startSheetsPolling();

  // Try to load queue from Sheets — retry once if first attempt fails
  // Also load photos, records, and gift cards in parallel
  const [, , , result] = await Promise.all([
    loadPhotosFromSheets().then(() => applyPhotosToObjects()),
    // Records: try blob (App Config row 4) first — authoritative cross-device source.
    // On startup we always attempt to load if we have no local timestamp (fresh device),
    // or if the remote is newer. Falls back to Transaction Log if blob is empty.
    (async () => {
      const forceOnFresh = !_lastRecordsUpdate; // always load on first-ever startup
      let ok = await pullRecordsIfNewer(null, forceOnFresh);
      if (!ok) ok = await loadRecordsFromSheets();
      if (ok) {
        const activePanel = document.querySelector('.dash-panel.active');
        if (activePanel) {
          const id = activePanel.id;
          if (id === 'panel-reports')       runReport();
          if (id === 'panel-transactions')  renderTransactions();
        }
      }
    })(),
    loadGiftCardsFromSheets().then(ok => {
      if (ok) {
        const activePanel = document.querySelector('.dash-panel.active');
        if (activePanel && activePanel.id === 'panel-giftcards') renderGiftCards();
      }
    }),
    (async () => {
      let r = await loadQueueFromSheets();
      if (!r) {
        console.log('[Sync] First load failed, retrying in 3s…');
        await new Promise(res => setTimeout(res, 3000));
        r = await loadQueueFromSheets();
      }
      return r;
    })(),
  ]);

  if (result) {
    console.log('[Sync] Loaded from Sheets:', result.queue.length, 'entries, updatedAt:', result.updatedAt);
    if (result.queue.length > 0) {
      // Sheets has data — always use it on startup, it's the authority
      queue = result.queue.map(e => ({
        ...e,
        checkinTime: e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime),
      }));
      _lastSheetsUpdate = result.updatedAt;
      saveQueueToStorage();
      renderQueue();
      updateStats();
    } else {
      // Sheets is empty — keep local data as display but NEVER push it up automatically.
      // A device with stale/old local data must not overwrite Sheets.
      // The user can manually force-push by tapping the Sheets indicator if needed.
      console.log('[Sync] Sheets empty — showing local data, not auto-pushing');
    }
  } else {
    console.warn('[Sync] Could not load from Sheets — using localStorage fallback');
  }
  setSheetsIndicator(result ? 'ok' : 'error');
  startElapsedTimer();
  if (squareConfig) setTimeout(() => pushConfigToSheets(), 3000);

  updateLoggedInDisplay();

  // Confirm screen: tap anywhere to reset (works on iOS/Android)
  const confirmScreen = document.getElementById('screen-confirm');
  if (confirmScreen) {
    const resetToWelcome = () => { clearTimeout(window._confirmResetTimer); goTo('screen-welcome'); };
    confirmScreen.addEventListener('click', resetToWelcome);
    confirmScreen.addEventListener('touchend', e => { e.preventDefault(); resetToWelcome(); });
  }

  setLogo();
  startClock();
  renderGuestsContainer();
  renderQueue();
  updateDeskDate();
  if (squareConfig) {
    updateSyncLabel('ok', 'Square synced');
    loadSquareCustomers();
  } else {
    updateSyncLabel('pending', 'Square not connected');
    // Still try to populate autocomplete from local cache
    const cached = localStorage.getItem('muse_customers');
    if (cached && squareCustomers.length === 0) {
      try {
        const dir = JSON.parse(cached);
        squareCustomers = dir.map(c => ({
          id: c.squareId, given_name: c.firstName||'', family_name: c.lastName||'',
          phone: c.phone||'', display: [c.firstName,c.lastName].filter(Boolean).join(' '),
        })).filter(c => c.given_name);
      } catch(e) {}
    }
  }

  setTimeout(() => {
    if (!squareConfig && !sessionStorage.getItem('muse_setup_skipped')) showSetupWizard();
  }, 800);

  scheduleMidnightReset();

  // Ctrl+Z / Cmd+Z undo
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      performUndo();
    }
    // Enter in group assign modal triggers advance
    if (e.key === 'Enter') {
      const groupModal = document.getElementById('group-assign-modal');
      if (groupModal && !groupModal.classList.contains('hidden')) {
        e.preventDefault();
        saveGroupAndAdvance();
      }
    }
    // Esc closes any open modal without saving
    if (e.key === 'Escape') {
      const allModals = [
        ['tech-status-menu',    closeTechStatusMenu],
        ['group-assign-modal',  closeGroupAssignModal],
        ['assign-modal',        closeAssignModal],
        ['manual-modal',        closeManualAdd],
        ['warn-modal',          closeWarnModal],
        ['turns-assign-modal',  closeTurnsAssignModal],
        ['turns-tech-modal',    closeTurnsTechModal],
        ['split-merge-modal',   closeSplitMergeModal],
        ['edit-services-modal', closeEditServicesModal],
        ['service-modal',       closeServiceModal],
        ['staff-modal',         closeStaffModal],
        ['staff-photo-modal',   closeStaffPhotoModal],
        ['schedule-picker',     closeSchedulePicker],
        ['edit-checkin-modal',  closeEditCheckin],
        ['customer-dir-modal',  closeCustomerDir],
        ['edit-customer-modal', closeEditCustomer],
        ['photo-crop-modal',    closePhotoCrop],
        ['delete-txn-modal',    closeDeleteTxnModal],
        ['refund-modal',        closeRefundModal],
        ['gc-modal',            closeGcModal],
        ['square-modal',        () => { document.getElementById('square-modal').classList.add('hidden'); document.getElementById('square-modal').style.display=''; }],
        ['appt-modal',          closeApptModal],
        ['historical-modal',    closeHistoricalModal],
        ['numpad-modal',        () => { numpadConfirm(); }],
      ];
      for (const [id, fn] of allModals) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) { fn(); return; }
      }
      // Close calendar selector dropdown if open — discard draft
      const calDD = document.getElementById('cal-selector-dropdown');
      if (calDD && !calDD.classList.contains('hidden')) {
        _calSelectorDraft = null;
        calDD.classList.add('hidden');
        return;
      }
      // Screen-level Esc navigation
      const checkin = document.getElementById('screen-checkin');
      if (checkin && checkin.classList.contains('active')) { goTo('screen-welcome'); return; }
      const pinModal = document.getElementById('pin-modal');
      if (pinModal && !pinModal.classList.contains('hidden')) {
        pinModal.classList.add('hidden'); pinModal.style.display = '';
        return;
      }
    }
    // Enter in manual add modal submits the form
    if (e.key === 'Enter') {
      const manualModal = document.getElementById('manual-modal');
      if (manualModal && !manualModal.classList.contains('hidden')) {
        // Don't fire if focused on a select or multi-line input
        const tag = document.activeElement?.tagName;
        if (tag !== 'SELECT' && tag !== 'TEXTAREA') {
          e.preventDefault(); submitManualAdd(); return;
        }
      }
    }
  });

  registerServiceWorker();
});


// ── Permission-Gated UI ───────────────────────────
// Called on login/logout and after role permission changes.
// Re-renders any currently-visible panels that have role-conditional buttons
// so they reflect the new role without requiring a tab switch.
function updatePermissionGatedUI() {
  // Re-render active panels so delete/refund/edit buttons update immediately
  const txPanel  = document.getElementById('panel-transactions');
  const rptPanel = document.getElementById('panel-reports');
  if (txPanel?.classList.contains('active'))  renderTransactions();
  if (rptPanel?.classList.contains('active')) runReport();

  // Role permissions section in settings — admin-only
  const permSection = document.getElementById('settings-role-permissions');
  if (permSection) permSection.classList.toggle('hidden', activeUser?.role !== 'admin');
}


// ── Daily Midnight Reset ──────────────────────────
function scheduleMidnightReset() {
  const now    = new Date();
  // Reset at 4:00:05 AM local time — well past midnight, avoids DST edge cases,
  // and the salon is always closed by then
  const reset  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 5);
  // If 4am already passed today, schedule for 4am tomorrow
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  const msUntil = reset - now;
  const hrsUntil = (msUntil / 3600000).toFixed(1);
  console.log(`[Reset] Scheduled for 4:00 AM — in ${hrsUntil}h (${reset.toLocaleString()})`);
  setTimeout(() => {
    // Archive today's queue to history before clearing
    archiveTodayQueue();
    archiveTurnsForToday();

    // Save all today's entries as records so Reports tab can see them
    queue.forEach(e => {
      // Save even non-done entries so partial transactions appear in history
      const existing = allRecords.findIndex(r => String(r.id) === String(e.id));
      const snapshot = {
        id: String(e.id), name: e.name, phone: e.phone||'',
        services: e.services, assignments: e.assignments||[],
        items: e.items||[], fees: e.fees||[],
        totalCost: e.totalCost||0,
        checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
        completedAt: e.completedAt || null,
        status: e.status, isAppointment: e.isAppointment||false,
      };
      if (existing >= 0) allRecords[existing] = snapshot;
      else allRecords.push(snapshot);
    });
    localStorage.setItem('muse_records', JSON.stringify(allRecords));
    scheduleRecordsPush(); // push end-of-day records so other devices see the full history

    // Clear the live queue for the new day
    turnsBreakStaff = [];
    saveTurnsBreak();
    queue = [];
    localStorage.removeItem(QUEUE_STORAGE_KEY);
    localStorage.removeItem(QUEUE_DATE_KEY);
    clearSheetsQueue();
    renderQueue();
    updateStats();
    renderTurns();
    showToast('New day started — yesterday\'s history saved to Reports');
    scheduleMidnightReset();
  }, msUntil);
}

function archiveTodayQueue() {
  const today = todayStr();
  const existing = JSON.parse(localStorage.getItem('muse_queue_archive') || '{}');
  existing[today] = queue.map(e => ({
    ...e,
    checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
  }));
  const keys = Object.keys(existing).sort().slice(-90);
  const pruned = {};
  keys.forEach(k => pruned[k] = existing[k]);
  localStorage.setItem('muse_queue_archive', JSON.stringify(pruned));
  // NOTE: do NOT re-export to Sheets here — each entry was already written
  // to Sheets when it was checked in and when it was marked done.
}


// ── Navigation ───────────────────────────────────
let currentCheckinType = 'walkin'; // 'walkin' | 'appointment'

function goTo(screenId, param) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  window.scrollTo(0,0);

  if (screenId === 'screen-checkin') {
    currentCheckinType = param === 'appointment' ? 'appointment' : 'walkin';
    guestCount = 0;
    renderGuestsContainer();
    const label = document.getElementById('checkin-type-label');
    if (param === 'appointment') {
      label.innerHTML = '<span class="inline-flex items-center gap-1"><span class="material-symbols-outlined" style="font-size:14px;color:#785a1a">calendar_today</span> Appointment Check-In</span>';
    } else {
      label.textContent = 'Walk-In Check-In';
    }
  }
  if (screenId === 'screen-desk') { updateDeskDate(); initCalHoursSelectors(); }
}


// ── Dashboard Panel Switching ─────────────────────
function showDashPanel(panel) {
  ['queue','reports','transactions','services','staff','turns','settings','giftcards','calendar'].forEach(p => {
    document.getElementById(`panel-${p}`)?.classList.remove('active');
    document.getElementById(`nav-${p}`)?.classList.remove('active');
  });
  document.getElementById(`panel-${panel}`)?.classList.add('active');
  document.getElementById(`nav-${panel}`)?.classList.add('active');
  if (panel === 'services')      renderServicesList();
  if (panel === 'staff')         { renderStaffList(); renderFdUsersList(); showStaffListView(); }
  if (panel === 'reports') {
    // If allRecords is empty, try loading from Sheets first
    if (allRecords.length === 0) {
      loadRecordsFromSheets().then(() => setReportRange('today'));
    } else {
      setReportRange('today');
    }
  }
  if (panel === 'transactions') {
    if (allRecords.length === 0) {
      loadRecordsFromSheets().then(() => renderTransactions());
    } else {
      renderTransactions();
    }
  }
  if (panel === 'settings')      renderSettingsPanel();
  if (panel === 'giftcards') {
    if (giftCards.length === 0) {
      loadGiftCardsFromSheets().then(() => renderGiftCards());
    } else {
      renderGiftCards();
    }
  }
  if (panel === 'calendar') {
    initCalendar();
  }
  if (panel === 'turns') {
    const di = document.getElementById('turns-history-date');
    if (di && !di.value) di.value = todayStr();
    const bc = document.getElementById('turns-break-count');
    if (bc) bc.textContent = turnsBreakStaff.length;
    renderTurns();
  }
}

function toggleStaffScheduleView() {
  const listView     = document.getElementById('staff-list-view');
  const scheduleView = document.getElementById('staff-schedule-view');
  const btn          = document.getElementById('schedule-view-btn');
  if (!listView || !scheduleView) return;
  const showingSchedule = !scheduleView.classList.contains('hidden');
  listView.classList.toggle('hidden', !showingSchedule);
  scheduleView.classList.toggle('hidden', showingSchedule);
  btn.style.background = showingSchedule ? '' : '#1a5252';
  btn.style.color = showingSchedule ? '' : '#ffffff';
  if (!showingSchedule) renderSchedule();
}

function showStaffListView() {
  document.getElementById('staff-list-view')?.classList.remove('hidden');
  document.getElementById('staff-schedule-view')?.classList.add('hidden');
  const btn = document.getElementById('schedule-view-btn');
  if (btn) { btn.style.background = ''; btn.style.color = ''; }
}


// ── App Version & Data Preservation ──────────────
// localStorage is tied to the domain (musenail.github.io/musedashboard)
// so all data automatically persists across app updates — no action needed.
// This version stamp lets us detect future migrations if data schema changes.
// APP_VERSION defined at top of script block


// ── Version freshness check ───────────────────────────────────────────────
// Fetches version.json (a tiny separate file in the repo) with no-store cache.
// Browsers don't aggressively cache separate files the way they cache index.html,
// and no-store ensures GitHub's CDN always serves the fresh copy.
// If the version in version.json differs from what's running, reloads immediately.
// You must update version.json alongside index.html on every deploy.
async function checkAppVersion() {
  // Always show the running version immediately — even before the fetch completes
  const badge = document.getElementById('app-version-badge');
  if (badge) { badge.textContent = APP_VERSION; badge.title = 'musedashboard ' + APP_VERSION; }
  try {
    const res = await fetch('/musedashboard/version.json?_=' + Date.now(), {
      cache: 'no-store',
      headers: { 'pragma': 'no-cache', 'cache-control': 'no-cache' }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      // sessionStorage guard — secondary safety net against any residual loop
      const alreadyTriedFor = sessionStorage.getItem('_pendingVersion');
      if (alreadyTriedFor === data.version) {
        if (badge) { badge.textContent = APP_VERSION + ' ↻'; badge.title = `Update to ${data.version} pending — hard refresh (Ctrl+Shift+R) to apply`; }
        return;
      }
      console.log(`[Version] Running ${APP_VERSION}, live is ${data.version} — reloading`);
      sessionStorage.setItem('_pendingVersion', data.version);
      // Evict only config.js from all SW caches. config.js carries APP_VERSION —
      // if served stale from cache it causes a mismatch on every soft reload (loop).
      // Deleting just this one entry avoids the 15s stutter from wiping all caches.
      // From v1.76 onward sw.js serves config.js network-first, making this a no-op
      // for future updates; it handles only the current SW-to-SW transition.
      try {
        const configUrl = location.origin + '/musedashboard/js/config.js';
        for (const key of await caches.keys()) {
          const c = await caches.open(key);
          await c.delete(configUrl);
        }
      } catch(e) {}
      const PERMANENT_KEYS = new Set([
        'muse_device_id','muse_live_queue','muse_live_queue_date','muse_queue_archive',
        'muse_turns_history','muse_records','muse_deletion_log','muse_customers',
        'muse_sq_config','muse_last_backup','muse_cal_hours','muse_records_updated_at',
        'gcal_token','gcal_hidden','gcal_order',
      ]);
      Object.keys(localStorage).forEach(k => { if (!PERMANENT_KEYS.has(k)) localStorage.removeItem(k); });
      window.location.replace(window.location.pathname);
    } else {
      // Versions match — clear any stale reload guard from a previous update cycle
      sessionStorage.removeItem('_pendingVersion');
    }
  } catch(e) {
    // Offline or fetch failed — silently continue with current version
  }
}


// Turn config and bonus services — in-memory; loaded from Sheets on startup
let _turnConfig    = {};
let _bonusServices = [];

function getTurnConfig() {
  const defaults = { fullMin: 28, halfMin: 12 };
  return Object.keys(_turnConfig).length ? { ...defaults, ..._turnConfig } : defaults;
}
function saveTurnConfig(cfg) {
  _turnConfig = cfg;
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}

// Check if a serviceId is flagged as always-bonus
function isAlwaysBonusService(serviceId) { return _bonusServices.includes(serviceId); }
function saveBonusServices(ids) {
  _bonusServices = ids;
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}

// Classify a cost+serviceId into turn type using current config
function classifyTurn(cost, serviceId) {
  if (isAlwaysBonusService(serviceId)) return 'bonus';
  const cfg = getTurnConfig();
  if (!cost || cost <= 0) return 'unpriced';
  if (cost >= cfg.fullMin) return 'full';
  if (cost >= cfg.halfMin) return 'half';
  return 'bonus';
}

function getTechTurns(techId) {
  const assignments = getTechAllAssignments(techId);
  let full = 0, half = 0, bonus = 0;
  assignments.forEach(({ assignment: a }) => {
    const type = classifyTurn(a.cost || 0, a.serviceId || '');
    if (type === 'full')  full++;
    else if (type === 'half')  half += 0.5;
    else if (type === 'bonus') bonus++;
  });
  return { full, half, bonus, total: full + half };
}


function loadTurnsHistory(dateStr) {
  const today = todayStr();
  if (!dateStr || dateStr === today) { clearTurnsHistory(); return; }
  turnsViewingHistory = dateStr;
  document.getElementById('turns-today-btn')?.classList.remove('hidden');
  document.getElementById('turns-date-label').textContent =
    new Date(dateStr+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  renderTurnsTechGrid();
  renderTurnsQueue();
}

function clearTurnsHistory() {
  turnsViewingHistory = null;
  const today = todayStr();
  const dateInput = document.getElementById('turns-history-date');
  if (dateInput) dateInput.value = today;
  document.getElementById('turns-today-btn')?.classList.add('hidden');
  document.getElementById('turns-date-label').textContent =
    new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  renderTurns();
}

function renderTurnsHistoryView() {
  const grid = document.getElementById('turns-tech-grid');
  const hist = turnsHistory[turnsViewingHistory];
  if (!hist) {
    grid.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-8 text-center">No turns data for this date.</div>';
    return;
  }
  const order = hist.order || [];
  const snap  = hist.snapshot || [];
  grid.innerHTML = `
    <div class="bg-secondary-container/30 rounded-xl px-4 py-2 mb-3 text-sm font-body text-on-surface-variant flex items-center gap-2">
      <span class="material-symbols-outlined" style="font-size:16px">history</span> Viewing history — read only
    </div>
    ${order.map(staffId => {
      const st = STAFF.find(s=>s.id===staffId);
      if (!st) return '';
      const staffEntries = snap.filter(e=>(e.assignments||[]).some(a=>a.techId===staffId));
      return `
        <div class="flex items-center border-b border-surface-container-high py-3 gap-3 opacity-80">
          <div class="w-40 flex-shrink-0 font-headline font-semibold text-on-surface text-sm">${st.name}</div>
          <div class="flex gap-2 flex-wrap">
            ${staffEntries.map(e=>{
              const a=(e.assignments||[]).find(x=>x.techId===staffId);
              return `<div class="px-3 py-2 bg-surface-container rounded-lg text-xs font-body"><div class="font-semibold">${e.name.split(' ')[0]}</div><div class="text-on-surface-variant">${SERVICES.find(s=>s.id===a?.serviceId)?.label||''} ${a?.cost?'$'+a.cost:''}</div></div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}

// Tech selector modal
function showTurnsTechSelector() {
  const list = document.getElementById('turns-tech-selector-list');
  const currentOrder = getActiveTurnsOrder();
  // Only show active staff (respects Settings → Active Staff toggles)
  const activeOnly = STAFF.filter(s => isStaffActive(s.id));

  if (activeOnly.length === 0) {
    list.innerHTML = `<div class="text-sm font-body text-on-surface-variant py-6 text-center">
      No staff found. Add staff in <strong>Settings → Staff Management</strong> first.
    </div>`;
    document.getElementById('turns-tech-modal').classList.remove('hidden');
    document.getElementById('turns-tech-modal').style.display = 'flex';
    return;
  }

  const remaining = activeOnly.filter(s => !currentOrder.includes(s.id));
  const allForDisplay = [...currentOrder.map(id=>activeOnly.find(s=>s.id===id)).filter(Boolean), ...remaining];

  list.innerHTML = allForDisplay.map(st => {
    const inOrder = currentOrder.includes(st.id);
    const orderIdx = currentOrder.indexOf(st.id);
    const photo = st.photo
      ? `<img src="${st.photo}" class="w-9 h-9 rounded-full object-cover flex-shrink-0">`
      : `<div class="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-xs font-headline font-bold text-on-surface">${st.name.charAt(0)}</span></div>`;
    return `
      <div class="flex items-center gap-3 p-3 rounded-xl mb-1 cursor-pointer select-none tech-order-item
        ${inOrder ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container border border-transparent'}"
        data-staff-id="${st.id}" data-in-order="${inOrder}" onclick="toggleTurnsTechOrder('${st.id}')">
        <span class="material-symbols-outlined text-outline-variant cursor-grab tech-drag-handle" style="font-size:20px" onpointerdown="startTechReorder(event)">drag_indicator</span>
        ${photo}
        <div class="flex-grow">
          <div class="font-headline font-semibold text-on-surface text-sm">${st.name}</div>
          ${inOrder ? `<div class="text-[11px] font-body text-primary">Turn order: #${orderIdx+1}</div>` : '<div class="text-[11px] font-body text-on-surface-variant">Not in today\'s rotation</div>'}
        </div>
        <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${inOrder ? 'bg-primary border-primary' : 'border-outline-variant'}">
          ${inOrder ? '<span class="material-symbols-outlined text-on-primary" style="font-size:14px;font-variation-settings:\'FILL\' 1">check</span>' : ''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('turns-tech-modal').classList.remove('hidden');
  document.getElementById('turns-tech-modal').style.display = 'flex';
}

// Drag-to-reorder in the tech selector
let _reorderDragging = null;
let _reorderClone = null;
let _reorderList = null;

function startTechReorder(e) {
  e.stopPropagation(); // prevent the onclick toggle from firing
  const item = e.currentTarget.closest('.tech-order-item');
  if (!item) return;

  _reorderDragging = item;
  _reorderList = item.parentNode;
  const rect = item.getBoundingClientRect();

  _reorderClone = item.cloneNode(true);
  _reorderClone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.85;pointer-events:none;z-index:9999;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.2);`;
  document.body.appendChild(_reorderClone);
  item.style.opacity = '0.3';

  document.addEventListener('pointermove', onTechReorderMove);
  document.addEventListener('pointerup', onTechReorderEnd, { once: true });
  e.preventDefault();
}

function onTechReorderMove(e) {
  if (!_reorderClone) return;
  _reorderClone.style.top = (e.clientY - 25) + 'px';

  // Find which item we're hovering over
  const items = [..._reorderList.querySelectorAll('.tech-order-item')];
  items.forEach(item => item.style.borderTop = '');
  const hovered = items.find(item => {
    if (item === _reorderDragging) return false;
    const r = item.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (hovered) hovered.style.borderTop = '2px solid #1a5252';
}

function onTechReorderEnd(e) {
  document.removeEventListener('pointermove', onTechReorderMove);
  if (_reorderClone) { _reorderClone.remove(); _reorderClone = null; }
  if (!_reorderDragging) return;

  _reorderDragging.style.opacity = '';
  const items = [..._reorderList.querySelectorAll('.tech-order-item')];
  items.forEach(item => item.style.borderTop = '');

  // Find insertion point
  const hovered = items.find(item => {
    if (item === _reorderDragging) return false;
    const r = item.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom;
  });

  if (hovered && hovered !== _reorderDragging) {
    _reorderList.insertBefore(_reorderDragging, hovered);
    // Rebuild turnsTechOrder from DOM order — only include those in order
    turnsTechOrder = [..._reorderList.querySelectorAll('.tech-order-item[data-in-order="true"]')]
      .map(el => el.dataset.staffId);
    // Re-render to update order numbers
    showTurnsTechSelector();
  }

  _reorderDragging = null;
  _reorderList = null;
}

function checkAllTechs() {
  turnsTechOrder = STAFF.map(s => s.id);
  showTurnsTechSelector();
}

function uncheckAllTechs() {
  turnsTechOrder = [];
  showTurnsTechSelector();
}

function toggleTurnsTechOrder(staffId) {
  if (turnsTechOrder.includes(staffId)) {
    turnsTechOrder = turnsTechOrder.filter(id => id !== staffId);
  } else {
    turnsTechOrder.push(staffId);
  }
  showTurnsTechSelector();
}

function saveTurnsTechOrder() {
  closeTurnsTechModal();
  renderTurns();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
  showToast(turnsTechOrder.length + ' technician' + (turnsTechOrder.length !== 1 ? 's' : '') + ' in today\'s rotation');
}

function saveTurnsTechOrderToStorage() { /* in-memory — order is pushed via pushConfigToSheets() */ }

function closeTurnsTechModal() {
  document.getElementById('turns-tech-modal').classList.add('hidden');
  document.getElementById('turns-tech-modal').style.display = '';
}


// ── PWA Service Worker & Install Prompt ───────────
// Register service worker for offline caching and installability.
// Must run after DOMContentLoaded — it's called at the bottom of the init block.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/musedashboard/sw.js')
    .then(reg => console.log('[SW] Registered, scope:', reg.scope))
    .catch(e  => console.warn('[SW] Registration failed:', e));
}

// Capture the beforeinstallprompt event (Chrome/Android — iOS handles install
// differently: long-press share → Add to Home Screen).
let _pwaInstallEvent = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallEvent = e;
  // Reveal the install banner in Settings
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  _pwaInstallEvent = null;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.classList.add('hidden');
  showToast('App installed ✓ — open from home screen for full-screen mode');
});

function promptPwaInstall() {
  if (!_pwaInstallEvent) return;
  _pwaInstallEvent.prompt();
  _pwaInstallEvent.userChoice.then(result => {
    if (result.outcome !== 'accepted') return;
    _pwaInstallEvent = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.add('hidden');
  });
}











