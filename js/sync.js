// ── Google Sheets Export ──────────────────────────
async function exportToSheets(entry) {
  try {
    const payload = {
      action:      'append',
      entryId:     String(entry.id),
      checkinTime: (entry.checkinTime instanceof Date ? entry.checkinTime : new Date(entry.checkinTime)).toISOString(),
      name:        entry.name,
      phone:       entry.phone || '',
      services:    entry.services.map(sid => SERVICES.find(s => s.id === sid)?.label || sid).join(', '),
      type:        entry.isAppointment ? 'Appointment' : 'Walk-In',
      status:      entry.status || 'waiting',
      staff:       '',
      stations:    '',
      detail:      '',
      total:       0,
      loggedBy:    activeUser ? activeUser.name : 'Customer',
    };
    await fetch(SHEETS_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    // Check-Ins tab: create/update the single row for this customer
    await sendCheckinRow(entry);
  } catch(e) {
    console.warn('Sheets export failed:', e);
  }
}

// Send/update the single Check-Ins row for this customer.
// Called on first check-in (arrival) and again whenever status changes.
// The Apps Script upserts by entryId so there's always exactly one row per customer.
async function sendCheckinRow(entry) {
  try {
    const checkinTime = (entry.checkinTime instanceof Date ? entry.checkinTime : new Date(entry.checkinTime)).toISOString();
    const isDone      = entry.status === 'done';
    const completedAt = isDone && !entry.completedAt
      ? new Date().toISOString()
      : isDone && entry.completedAt
        ? (entry.completedAt instanceof Date ? entry.completedAt.toISOString() : entry.completedAt)
        : null;

    if (isDone && !entry.completedAt) entry.completedAt = completedAt;

    const staff    = [...new Set(
      (entry.assignments||[]).filter(a=>a.techId)
        .map(a => STAFF.find(s=>s.id===a.techId)?.name)
        .filter(Boolean)
    )].join(', ');
    const stations = [...new Set(
      (entry.assignments||[]).filter(a=>a.station).map(a=>a.station)
    )].join(', ');

    // Compute component totals for separate columns in Sheets
    const svcTotal  = (entry.assignments||[]).reduce((s,a)=>s+(a.cost||0),0);
    const discount  = entry.discount || 0;
    const itemsWithLabels = (entry.items||[]).map(i => ({
      ...i, label: ITEMS.find(x=>x.id===i.itemId)?.label || i.itemId
    }));
    const feesWithLabels = (entry.fees||[]).map(f => ({
      ...f, label: FEES.find(x=>x.id===f.feeId)?.label || f.feeId
    }));

    await fetch(SHEETS_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'checkinRow',
        entryId:      String(entry.id),
        checkinTime,
        completedAt,
        name:         entry.name,
        phone:        entry.phone || '',
        services:     entry.services.map(sid => SERVICES.find(s=>s.id===sid)?.label || sid),
        type:         entry.isAppointment ? 'Appointment' : 'Walk-In',
        status:       entry.status || 'waiting',
        staff,
        stations,
        svcTotal,
        items:        itemsWithLabels,
        fees:         feesWithLabels,
        discount,
        discountNote: entry.discountNote || '',
        total:        entry.totalCost ? Number(entry.totalCost) : 0,
        loggedBy:     activeUser ? activeUser.name : '',
      }),
    });
  } catch(e) {
    console.warn('Check-in row failed:', e);
  }
}

function exportAllToSheets() {
  if (queue.length === 0) { showToast('No check-ins to export.'); return; }
  queue.forEach(e => exportToSheets(e));
  showToast(`Exporting ${queue.length} check-ins to Google Sheets…`);
}


// ── Auto-update existing Sheets row ──────────────
async function updateSheetsRow(entry) {
  try {
    const assignDetail = (entry.assignments || []).map(a => {
      const tech = STAFF.find(s => s.id === a.techId);
      const svc  = SERVICES.find(s => s.id === a.serviceId);
      const parts = [];
      if (svc)       parts.push(svc.label);
      if (tech)      parts.push(tech.name);
      if (a.station) parts.push(a.station);
      if (a.cost)    parts.push(`$${Number(a.cost).toFixed(2)}`);
      return parts.filter(Boolean).join(' ');
    }).filter(Boolean).join(' | ');

    const staffDetail = (entry.assignments || []).map(a => {
      const tech = STAFF.find(s => s.id === a.techId);
      const svc  = SERVICES.find(s => s.id === a.serviceId);
      if (!tech) return null;
      return `${svc?.label || ''}: ${tech.name}${a.cost ? ' $' + Number(a.cost).toFixed(2) : ''}`;
    }).filter(Boolean).join(', ');

    const payload = {
      action:      'update',
      entryId:     String(entry.id),
      checkinTime: (entry.checkinTime instanceof Date ? entry.checkinTime : new Date(entry.checkinTime)).toISOString(),
      name:        entry.name,
      phone:       entry.phone || '',
      services:    entry.services.map(sid => SERVICES.find(s => s.id === sid)?.label || sid).join(', '),
      type:        entry.isAppointment ? 'Appointment' : 'Walk-In',
      status:      entry.status,
      staff:       staffDetail,
      stations:    (entry.assignments || []).map(a => a.station).filter(Boolean).join(', '),
      detail:      assignDetail,
      total:       entry.totalCost ? Number(entry.totalCost) : 0,
      loggedBy:    activeUser ? activeUser.name : '',
    };

    // Route through our Cloudflare proxy to avoid CORS issues
    await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.warn('Sheets row update failed:', err));
    // NOTE: sendCheckinRow is NOT called here — it's called only from
    // exportToSheets (on arrival) and saveRecord (on completion) to avoid duplicates.
  } catch(e) { console.warn('Sheets update failed:', e); }
}


// ── Load historical records from Transaction Log in Sheets ──
// Deduplication is done server-side (Apps Script keeps latest row per Entry ID).
// On the client side we further merge with any existing local records,
// so records created today (not yet in Sheets) are never lost.
async function loadRecordsFromSheets() {
  try {
    const res  = await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'loadRecords' }),
    });
    const data = await res.json();
    if (!data.success || !data.records || data.records.length === 0) return false;

    // Build a name→id lookup from STAFF for resolving tech names in imported records
    const techByName = {};
    STAFF.forEach(s => { techByName[s.name.toLowerCase()] = s.id; });

    // Build a label→id lookup from SERVICES
    const svcByLabel = {};
    SERVICES.forEach(s => {
      if (s.label) svcByLabel[s.label.toLowerCase()] = s.id;
      if (s.abbr)  svcByLabel[s.abbr.toLowerCase()]  = s.id;
    });

    // Enrich assignments: resolve techId and serviceId from names where missing
    const enriched = data.records.map(r => {
      const assignments = (r.assignments || []).map(a => {
        let techId    = a.techId    || '';
        let serviceId = a.serviceId || '';
        // Try to resolve techId from name stored in detail label
        if (!techId && a.techName) {
          techId = techByName[a.techName.toLowerCase()] || '';
        }
        // Try to resolve serviceId from label
        if (!serviceId && a.serviceLabel) {
          serviceId = svcByLabel[a.serviceLabel.toLowerCase()] || '';
        }
        return { ...a, techId, serviceId };
      });

      // If all assignments still have no techId but Staff column exists on record,
      // try to split the staff string and assign proportional costs
      if (assignments.every(a => !a.techId) && r.staffStr) {
        const names = r.staffStr.split(',').map(n => n.trim()).filter(Boolean);
        if (names.length > 0 && assignments.length > 0) {
          const costEach = (r.totalCost || 0) / assignments.length;
          names.forEach((name, i) => {
            if (assignments[i]) {
              assignments[i].techId = techByName[name.toLowerCase()] || '';
              if (!assignments[i].cost || assignments[i].cost === 0) {
                assignments[i].cost = costEach;
              }
            }
          });
        }
      }

      // If still no assignments but totalCost > 0, build one from staff column
      if (assignments.length === 0 && r.totalCost > 0 && r.staffStr) {
        const names = r.staffStr.split(',').map(n => n.trim()).filter(Boolean);
        const costEach = r.totalCost / Math.max(names.length, 1);
        names.forEach(name => {
          assignments.push({
            serviceId: '', techId: techByName[name.toLowerCase()] || '',
            status: r.status === 'done' ? 'done' : 'waiting',
            cost: costEach, assignedAt: 0,
          });
        });
        // If no names, single assignment with total
        if (names.length === 0) {
          assignments.push({
            serviceId: '', techId: '', status: r.status === 'done' ? 'done' : 'waiting',
            cost: r.totalCost, assignedAt: 0,
          });
        }
      }

      return { ...r, assignments };
    });

    // Merge: Sheets records are authority for historical data.
    // BUT: locally deleted records must stay deleted even if Sheets has them as 'done'.
    const localDeletedIds = new Set(allRecords.filter(r => r.status === 'deleted').map(r => String(r.id)));

    const sheetsIds = new Set(enriched.map(r => String(r.id)));
    const localOnly = allRecords.filter(r => !sheetsIds.has(String(r.id)));

    // Re-apply deleted status to any Sheets records that were deleted locally
    const mergedEnriched = enriched.map(r =>
      localDeletedIds.has(String(r.id)) ? { ...r, status: 'deleted' } : r
    );

    allRecords = [...mergedEnriched, ...localOnly];
    localStorage.setItem('muse_records', JSON.stringify(allRecords));
    console.log('[Records] Loaded', enriched.length, 'from Sheets +', localOnly.length, 'local-only');
    return true;
  } catch(e) {
    console.warn('[Records] Failed to load from Sheets:', e);
    return false;
  }
}


// ── Load gift cards from Gift Cards tab in Sheets ──
async function loadGiftCardsFromSheets() {
  try {
    const res  = await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'loadGiftCards' }),
    });
    const data = await res.json();
    if (!data.success || !data.giftCards || data.giftCards.length === 0) return false;

    // Merge: Sheets is authority for gift cards. Keep any local cards not yet synced.
    const sheetsIds = new Set(data.giftCards.map(g => String(g.id)));
    const localOnly = giftCards.filter(g => !sheetsIds.has(String(g.id)));
    giftCards = [...data.giftCards, ...localOnly];
    console.log('[GiftCards] Loaded', data.giftCards.length, 'from Sheets +', localOnly.length, 'local-only');
    return true;
  } catch(e) {
    console.warn('[GiftCards] Failed to load from Sheets:', e);
    return false;
  }
}



// ── Config Sync Core ────────────────────────────────────────────────────────────
async function pushConfigToSheets() {
  try {
    const config = {};
    if (STAFF.length)                         config.muse_staff                = STAFF;
    if (SERVICES.length)                      config.muse_services             = SERVICES;
    if (FRONT_DESK_USERS.length)              config.muse_fd_users             = FRONT_DESK_USERS;
    if (Object.keys(scheduleData).length)     config.muse_schedule             = scheduleData;
    if (Object.keys(_turnConfig).length)      config.muse_turn_config          = _turnConfig;
    if (_bonusServices.length)                config.muse_bonus_services       = _bonusServices;
    if (hiddenCheckinServices.length)         config.muse_hidden_services      = hiddenCheckinServices;
    if (hiddenDashServices.length)            config.muse_hidden_dash_services = hiddenDashServices;
    if (inactiveStaff.length)                 config.muse_inactive_staff       = inactiveStaff;
    if (_logoData)                            config.muse_logo                 = _logoData;
    if (turnsTechOrder.length)                config.muse_turns_order          = turnsTechOrder;
    if (ITEMS.length)                         config.muse_items                = ITEMS;
    if (FEES.length)                          config.muse_fees                 = FEES;
    const photos = getAllPhotos();
    if (Object.keys(photos).length)           config.muse_photos               = photos;
    await fetch(`${SHEETS_PROXY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveConfig', config, device: DEVICE_ID }),
    });
    // Broadcast to other connected devices so they apply the update instantly
    _wsSend({ type: 'config', config, device: DEVICE_ID });
  } catch(e) { console.warn('[Config] Push failed:', e); }
}

async function loadConfigFromSheets() {
  try {
    const res  = await fetch(`${SHEETS_PROXY}?action=loadConfig&_=${Date.now()}`);
    const data = await res.json();
    if (!data.success || !data.config) return { changed: false, recordsUpdatedAt: null, _raw: null };

    // Skip overwriting if this device wrote the config row, OR wrote within 10s (slow write safety net)
    const msSinceWrite = Date.now() - _configWriteTime;
    const wroteByUs = data.device && data.device === DEVICE_ID;
    if (wroteByUs || msSinceWrite < 10000) {
      console.log(`[Config] Skipping poll overwrite — ${wroteByUs ? 'our device wrote it' : `wrote ${Math.round(msSinceWrite/1000)}s ago`}`);
      return { changed: false, recordsUpdatedAt: data.recordsUpdatedAt || null, _raw: data };
    }

    const c = data.config;
    let changed = false;
    if (c.muse_staff?.length && JSON.stringify(c.muse_staff) !== JSON.stringify(STAFF))
      { STAFF = c.muse_staff; changed = true; }
    if (c.muse_services?.length && JSON.stringify(c.muse_services) !== JSON.stringify(SERVICES))
      { SERVICES = dedupByLabel(c.muse_services); changed = true; }
    if (c.muse_fd_users?.length && JSON.stringify(c.muse_fd_users) !== JSON.stringify(FRONT_DESK_USERS))
      { FRONT_DESK_USERS = c.muse_fd_users; changed = true; }
    if (c.muse_items?.length && JSON.stringify(c.muse_items) !== JSON.stringify(ITEMS))
      { ITEMS = dedupByLabel(c.muse_items); changed = true; }
    if (c.muse_fees?.length && JSON.stringify(c.muse_fees) !== JSON.stringify(FEES))
      { FEES = dedupByLabel(c.muse_fees); changed = true; }
    if (c.muse_schedule && JSON.stringify(c.muse_schedule) !== JSON.stringify(scheduleData))
      { scheduleData = c.muse_schedule; changed = true; }
    if (c.muse_turn_config && JSON.stringify(c.muse_turn_config) !== JSON.stringify(_turnConfig))
      { _turnConfig = c.muse_turn_config; changed = true; }
    if (c.muse_bonus_services && JSON.stringify(c.muse_bonus_services) !== JSON.stringify(_bonusServices))
      { _bonusServices = c.muse_bonus_services; changed = true; }
    if (c.muse_hidden_services && JSON.stringify(c.muse_hidden_services) !== JSON.stringify(hiddenCheckinServices))
      { hiddenCheckinServices = c.muse_hidden_services; changed = true; }
    if (c.muse_hidden_dash_services && JSON.stringify(c.muse_hidden_dash_services) !== JSON.stringify(hiddenDashServices))
      { hiddenDashServices = c.muse_hidden_dash_services; changed = true; }
    if (c.muse_inactive_staff && JSON.stringify(c.muse_inactive_staff) !== JSON.stringify(inactiveStaff))
      { inactiveStaff = c.muse_inactive_staff; changed = true; }
    if (c.muse_logo && c.muse_logo !== _logoData)
      { _logoData = c.muse_logo; changed = true; }
    if (Array.isArray(c.muse_turns_order) && JSON.stringify(c.muse_turns_order) !== JSON.stringify(turnsTechOrder))
      { turnsTechOrder = c.muse_turns_order; changed = true; }
    return { changed, recordsUpdatedAt: data.recordsUpdatedAt || null, _raw: data };
  } catch(e) { return { changed: false, recordsUpdatedAt: null, _raw: null }; }
}


// Sheets = source of truth. All devices poll every 10s.
// Writes are debounced 2s to avoid conflicts.

const SHEETS_PROXY  = 'https://musedashboard.musenailandspa.workers.dev/sheets';
const WS_URL        = 'wss://musedashboard.musenailandspa.workers.dev/ws';
const POLL_INTERVAL = 5000; // 5 seconds
const DEVICE_ID     = (() => {
  let id = localStorage.getItem('muse_device_id');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2,8); localStorage.setItem('muse_device_id', id); }
  return id;
})();

let _sheetsWriteTimer  = null;
let _lastSheetsUpdate  = null; // ISO string of last known Sheets queue update time
let _pollTimer         = null;
let _isSyncing         = false;

// ── WebSocket Real-Time Sync ──────────────────────────────────────────────────
// The Durable Object at /ws is a stateless broadcast hub. When any device writes
// queue or config to Sheets, it also sends the payload via WS so all other
// connected devices apply the update instantly without waiting for the next poll.
// Polling remains active as a durability fallback — WS is additive, not a replacement.

let _ws             = null;
let _wsConnected    = false;
let _wsReconnect    = null; // setTimeout handle for reconnect delay
let _wsPingInterval = null; // setInterval handle for keepalive pings

function _wsConnect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  try { _ws = new WebSocket(WS_URL); } catch(e) { _wsScheduleReconnect(); return; }

  _ws.onopen = () => {
    _wsConnected = true;
    console.log('[WS] Connected');
    // Keepalive ping every 20s — Cloudflare closes idle WS connections after ~100s
    _wsPingInterval = setInterval(() => { if (_wsConnected) _wsSend({ type: 'ping' }); }, 20000);
  };

  _ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    _wsHandleMessage(msg);
  };

  _ws.onclose = _ws.onerror = () => {
    _wsConnected = false;
    clearInterval(_wsPingInterval);
    _wsPingInterval = null;
    _wsScheduleReconnect();
    console.log('[WS] Disconnected — polling is active fallback');
  };
}

function _wsScheduleReconnect() {
  if (_wsReconnect) return;
  _wsReconnect = setTimeout(() => { _wsReconnect = null; _wsConnect(); }, 5000);
}

function _wsSend(msg) {
  if (!_wsConnected || !_ws) return false;
  try { _ws.send(JSON.stringify(msg)); return true; } catch { return false; }
}

function _wsHandleMessage(msg) {
  if (msg.type === 'pong') return;

  // Queue update from another device — apply immediately
  if (msg.type === 'queue' && msg.device !== DEVICE_ID) {
    const incoming = Array.isArray(msg.queue)
      ? msg.queue.map(e => ({ ...e, checkinTime: e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime) }))
      : [];

    // Never replace a non-empty local queue with an empty remote one mid-session
    if (incoming.length === 0 && queue.length > 0) return;

    // Apply cross-device deletions carried in the payload
    if (msg.deletedIds?.length) {
      msg.deletedIds.forEach(id => {
        const existing = allRecords.find(r => String(r.id) === String(id));
        if (existing && existing.status !== 'deleted') existing.status = 'deleted';
        else if (!existing) allRecords.push({ id: String(id), status: 'deleted', name: '', totalCost: 0, services: [], assignments: [] });
      });
      localStorage.setItem('muse_records', JSON.stringify(allRecords));
    }

    _lastSheetsUpdate = msg.updatedAt || new Date().toISOString();
    queue = incoming;

    if (msg.turnsOrder && Array.isArray(msg.turnsOrder) && JSON.stringify(msg.turnsOrder) !== JSON.stringify(turnsTechOrder)) {
      turnsTechOrder = msg.turnsOrder;
    }

    const today = todayStr();
    localStorage.setItem(QUEUE_DATE_KEY, today);
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializeQueue(queue)));
    requestAnimationFrame(() => { renderQueue(); updateStats(); renderTurns(); setSheetsIndicator('ok'); });
    console.log('[WS] Queue from', msg.device, '—', incoming.length, 'customers');
  }

  // Config update from another device — apply immediately
  if (msg.type === 'config' && msg.device !== DEVICE_ID) {
    const c = msg.config || {};
    let changed = false;
    if (c.muse_staff?.length && JSON.stringify(c.muse_staff) !== JSON.stringify(STAFF))
      { STAFF = c.muse_staff; changed = true; }
    if (c.muse_services?.length && JSON.stringify(c.muse_services) !== JSON.stringify(SERVICES))
      { SERVICES = dedupByLabel(c.muse_services); changed = true; }
    if (c.muse_fd_users?.length && JSON.stringify(c.muse_fd_users) !== JSON.stringify(FRONT_DESK_USERS))
      { FRONT_DESK_USERS = c.muse_fd_users; changed = true; }
    if (c.muse_items?.length && JSON.stringify(c.muse_items) !== JSON.stringify(ITEMS))
      { ITEMS = dedupByLabel(c.muse_items); changed = true; }
    if (c.muse_fees?.length && JSON.stringify(c.muse_fees) !== JSON.stringify(FEES))
      { FEES = dedupByLabel(c.muse_fees); changed = true; }
    if (c.muse_schedule && JSON.stringify(c.muse_schedule) !== JSON.stringify(scheduleData))
      { scheduleData = c.muse_schedule; changed = true; }
    if (c.muse_turn_config && JSON.stringify(c.muse_turn_config) !== JSON.stringify(_turnConfig))
      { _turnConfig = c.muse_turn_config; changed = true; }
    if (c.muse_bonus_services && JSON.stringify(c.muse_bonus_services) !== JSON.stringify(_bonusServices))
      { _bonusServices = c.muse_bonus_services; changed = true; }
    if (c.muse_hidden_services && JSON.stringify(c.muse_hidden_services) !== JSON.stringify(hiddenCheckinServices))
      { hiddenCheckinServices = c.muse_hidden_services; changed = true; }
    if (c.muse_hidden_dash_services && JSON.stringify(c.muse_hidden_dash_services) !== JSON.stringify(hiddenDashServices))
      { hiddenDashServices = c.muse_hidden_dash_services; changed = true; }
    if (c.muse_inactive_staff && JSON.stringify(c.muse_inactive_staff) !== JSON.stringify(inactiveStaff))
      { inactiveStaff = c.muse_inactive_staff; changed = true; }
    if (c.muse_logo && c.muse_logo !== _logoData)
      { _logoData = c.muse_logo; changed = true; }
    if (Array.isArray(c.muse_turns_order) && JSON.stringify(c.muse_turns_order) !== JSON.stringify(turnsTechOrder))
      { turnsTechOrder = c.muse_turns_order; changed = true; }
    if (changed) {
      setLogo();
      renderTurns();
      if (document.getElementById('settings-dash-service-visibility')?.offsetParent !== null) renderSettingsDashServiceVisibility();
      if (document.getElementById('settings-service-visibility')?.offsetParent !== null) renderSettingsServiceVisibility();
      if (document.getElementById('settings-active-staff')?.offsetParent !== null) renderSettingsActiveStaff();
    }
    console.log('[WS] Config from', msg.device);
  }
}


// ── allRecords cross-device sync ──────────────────
// _lastRecordsUpdate: ISO timestamp of the records blob this device last wrote or received.
// Used to skip the pull when the Sheets timestamp hasn't advanced.
let _lastRecordsUpdate = null;
let _recordsPushTimer  = null; // debounce handle for pushRecordsToSheets

// Debounce queue writes by 500ms — fast enough for near-instant cross-device sync
// without spamming Sheets on every keystroke or rapid tap sequence
function scheduleSheetsSave() {
  if (_sheetsWriteTimer) clearTimeout(_sheetsWriteTimer);
  _sheetsWriteTimer = setTimeout(pushQueueToSheets, 500);
}


// ── allRecords event-driven push ──────────────────
// Called after saveRecord() or confirmDeleteTransaction().
// Debounced 1s so back-to-back completions batch into a single write.
// Only fires when something actually changed — not on a timer.
function scheduleRecordsPush() {
  if (_recordsPushTimer) clearTimeout(_recordsPushTimer);
  _recordsPushTimer = setTimeout(pushRecordsToSheets, 1000);
}

async function pushRecordsToSheets() {
  try {
    const payload = allRecords.map(r => {
      const { photo, ...rest } = r;
      return rest;
    });
    const res  = await fetch(SHEETS_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'saveRecords', records: payload, device: DEVICE_ID }),
    });
    const data = await res.json();
    if (data.success) {
      _lastRecordsUpdate = data.updatedAt;
      localStorage.setItem('muse_records_updated_at', _lastRecordsUpdate);
    }
  } catch(e) {
    console.warn('[Records] Push failed:', e);
  }
}

// Pull allRecords from Sheets only if the server timestamp is newer than
// what this device last saw. Called from the 15s config poll.
// Pass force=true on startup to always load regardless of timestamp.
async function pullRecordsIfNewer(serverUpdatedAt, force) {
  if (!force) {
    if (!serverUpdatedAt) return false;
    // Skip if we already have this version or wrote it ourselves
    if (_lastRecordsUpdate && serverUpdatedAt <= _lastRecordsUpdate) return false;
  }
  try {
    const res  = await fetch(SHEETS_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'loadRecordsBlob' }),
    });
    const data = await res.json();
    if (!data.success || !data.records || data.records.length === 0) return false;

    _lastRecordsUpdate = data.updatedAt;
    localStorage.setItem('muse_records_updated_at', _lastRecordsUpdate);

    // Merge: re-apply any local deletions the remote may not know about yet,
    // and keep any local-only records (e.g. created between push cycles)
    const localDeletedIds = new Set(allRecords.filter(r => r.status === 'deleted').map(r => String(r.id)));
    const remoteIds       = new Set(data.records.map(r => String(r.id)));
    const localOnly       = allRecords.filter(r => !remoteIds.has(String(r.id)));

    const merged = data.records.map(r =>
      localDeletedIds.has(String(r.id)) ? { ...r, status: 'deleted' } : r
    );
    allRecords = [...merged, ...localOnly];
    localStorage.setItem('muse_records', JSON.stringify(allRecords));
    console.log('[Records] Pulled', data.records.length, 'records from Sheets (remote newer)');

    // Re-render panels that are currently visible
    const txPanel  = document.getElementById('panel-transactions');
    const rptPanel = document.getElementById('panel-reports');
    if (txPanel?.classList.contains('active'))  renderTransactions();
    if (rptPanel?.classList.contains('active')) runReport();
    return true;
  } catch(e) {
    console.warn('[Records] Pull failed:', e);
    return false;
  }
}

// Push full queue to Sheets — always include clientDate so server uses our timezone
async function pushQueueToSheets() {
  // Never push an empty queue on a fresh/cleared device that has never had data this session.
  // BUT if the queue was populated and then all entries were removed, we DO push the empty
  // state so other devices stop showing stale entries.
  if (queue.length === 0 && !_queueWasPopulated) {
    setSheetsIndicator('ok');
    return;
  }
  if (queue.length > 0) _queueWasPopulated = true;
  // Block polling while push is in flight to prevent race condition
  // where poll overwrites local queue before push completes
  _isSyncing = true;
  setSheetsIndicator('syncing');
  try {
    const now        = new Date().toISOString();
    const clientDate = todayStr(); // YYYY-MM-DD in local timezone
    const res = await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveQueue',
        device: DEVICE_ID,
        clientDate,
        turnsOrder: turnsTechOrder, // piggyback turns order on every queue push
        deletedIds: allRecords.filter(r => r.status === 'deleted').map(r => String(r.id)),
        queue: serializeQueue(queue),
      }),
    });
    const data = await res.json();
    if (data.success) {
      _lastSheetsUpdate = data.updatedAt || now;
      setSheetsIndicator('ok');
      // Broadcast to other connected devices — instant update, no poll lag
      _wsSend({
        type:       'queue',
        queue:      serializeQueue(queue),
        date:       clientDate,
        updatedAt:  _lastSheetsUpdate,
        device:     DEVICE_ID,
        turnsOrder: turnsTechOrder,
        deletedIds: allRecords.filter(r => r.status === 'deleted').map(r => String(r.id)),
      });
    } else throw new Error(data.error || 'Save failed');
  } catch(err) {
    setSheetsIndicator('error');
    console.warn('Sheets push failed:', err);
  } finally {
    _isSyncing = false;
  }
}

// Load queue from Sheets — used on startup and by poller
async function loadQueueFromSheets() {
  try {
    const clientDate = todayStr();
    // Use POST to bypass Cloudflare GET caching entirely
    const res  = await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'loadQueue', clientDate }),
    });
    const data = await res.json();
    if (data.success) {
      return {
        queue:      Array.isArray(data.queue) ? data.queue.map(e => ({ ...e, checkinTime: new Date(e.checkinTime) })) : [],
        updatedAt:  data.updatedAt,
        device:     data.device,
        turnsOrder: data.turnsOrder || null,
        deletedIds: data.deletedIds || [],
      };
    }
  } catch(e) { console.warn('Sheets load failed:', e); }
  return null;
}

// Poll Sheets for updates from other devices
async function pollSheets() {
  if (_isSyncing) return;
  _isSyncing = true;
  try {
    const result = await loadQueueFromSheets();
    if (!result) { return; }

    const sheetsTime = result.updatedAt ? new Date(result.updatedAt).getTime() : 0;
    const localTime  = _lastSheetsUpdate ? new Date(_lastSheetsUpdate).getTime() : 0;

    // Accept update if: timestamp is newer OR local queue is empty (fresh/cleared device)
    // sizeDiff alone is NOT sufficient — a stale remote with different count would overwrite newer local data
    const isNewer    = sheetsTime > localTime;
    const localEmpty = queue.length === 0;
    const needsSync  = isNewer || localEmpty;

    // SAFETY: never replace a non-empty queue with an empty one during polling
    // Apply deleted IDs from the queue payload — cross-device delete sync
    if (result.deletedIds && result.deletedIds.length > 0) {
      let deletionChanged = false;
      result.deletedIds.forEach(id => {
        const existing = allRecords.find(r => String(r.id) === String(id));
        if (existing && existing.status !== 'deleted') {
          existing.status = 'deleted';
          deletionChanged = true;
        } else if (!existing) {
          // Not in allRecords yet — add a deleted placeholder
          allRecords.push({ id: String(id), status: 'deleted', name: '', totalCost: 0, services: [], assignments: [] });
          deletionChanged = true;
        }
      });
      if (deletionChanged) {
        localStorage.setItem('muse_records', JSON.stringify(allRecords));
      }
    }

    if (needsSync && !(result.queue.length === 0 && queue.length > 0)) {
      console.log('[Sync] Poll update — Sheets:', result.queue.length, 'local:', queue.length, 'newer:', isNewer);
      _lastSheetsUpdate = result.updatedAt || new Date().toISOString();
      queue = result.queue.map(e => ({
        ...e,
        checkinTime: e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime),
      }));
      // Save to localStorage only — do NOT push back to Sheets (would cause ping-pong loop)
      const today = todayStr();
      localStorage.setItem(QUEUE_DATE_KEY, today);
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializeQueue(queue)));
      // Use RAF for smooth rendering — avoids janky repaints on iPad
      requestAnimationFrame(() => {
        renderQueue();
        updateStats();
        renderTurns();
        setSheetsIndicator('ok');
      });
    }

    // Sync turns order — it piggybacks on the queue payload for instant sync.
    // Skip if this device wrote the queue row — we already have the correct order locally.
    // Only apply if a DIFFERENT device wrote it (result.device !== DEVICE_ID).
    if (result.turnsOrder && Array.isArray(result.turnsOrder) && result.device !== DEVICE_ID) {
      const remote = JSON.stringify(result.turnsOrder);
      const local  = JSON.stringify(turnsTechOrder);
      if (remote !== local) {
        turnsTechOrder = result.turnsOrder;
        requestAnimationFrame(() => renderTurns());
        console.log('[Sync] Turns order updated from Sheets (device:', result.device, ')');
      }
    }
  } catch(e) {
    console.warn('[Sync] Poll failed:', e);
  } finally {
    // Always reset — prevents permanent lock if an exception is thrown mid-poll
    _isSyncing = false;
  }
}

// Start polling when the dashboard is open
async function forceSyncNow() {
  setSheetsIndicator('syncing');
  try {
    const result = await loadQueueFromSheets();
    if (result) {
      // Apply deletedIds so deleted transactions don't re-appear after manual sync
      if (result.deletedIds && result.deletedIds.length > 0) {
        let deletionChanged = false;
        result.deletedIds.forEach(id => {
          const existing = allRecords.find(r => String(r.id) === String(id));
          if (existing && existing.status !== 'deleted') {
            existing.status = 'deleted'; deletionChanged = true;
          } else if (!existing) {
            allRecords.push({ id: String(id), status: 'deleted', name: '', totalCost: 0, services: [], assignments: [] });
            deletionChanged = true;
          }
        });
        if (deletionChanged) localStorage.setItem('muse_records', JSON.stringify(allRecords));
      }
      // Always accept on manual sync — ignore timestamp checks
      queue = result.queue;
      _lastSheetsUpdate = result.updatedAt;
      saveQueueToStorage();
      renderQueue();
      updateStats();
      renderTurns();
      setSheetsIndicator('ok');
      showToast(`Synced — ${result.queue.length} customer${result.queue.length !== 1 ? 's' : ''} in queue`);
    } else {
      setSheetsIndicator('error');
      showToast('Sync failed — check connection');
    }
  } catch(e) {
    setSheetsIndicator('error');
    showToast('Sync error: ' + e.message);
    console.warn('[ForceSync] Error:', e);
  }
}

let _configPollTimer = null;
const CONFIG_POLL_INTERVAL = 15000; // 15 seconds — syncs logo, photos, staff, services across devices

function startSheetsPolling() {
  // Attempt real-time WebSocket sync; polling remains as the durability fallback
  _wsConnect();
  if (_pollTimer) return;
  _pollTimer = setInterval(pollSheets, POLL_INTERVAL);
  // Also poll config+photos every 15s so logo/photos/settings sync across devices
  if (!_configPollTimer) {
    _configPollTimer = setInterval(async () => {
      // loadConfigFromSheets now returns { changed, recordsUpdatedAt }
      const { changed, recordsUpdatedAt, _raw } = await loadConfigFromSheets();
      if (changed) {
        setLogo();
        if (document.getElementById('settings-dash-service-visibility')?.offsetParent !== null) renderSettingsDashServiceVisibility();
        if (document.getElementById('settings-service-visibility')?.offsetParent !== null) renderSettingsServiceVisibility();
        if (document.getElementById('settings-active-staff')?.offsetParent !== null) renderSettingsActiveStaff();
        renderTurns();
      }
      // Photos: pass pre-fetched config data to avoid a second loadConfig HTTP call
      await loadPhotosFromSheets(_raw).then(ok => { if (ok) { applyPhotosToObjects(); updateLoggedInDisplay(); renderStaffList(); } });

      // Pull allRecords if another device wrote a newer version.
      // recordsUpdatedAt comes free with the loadConfig response — no extra HTTP call.
      if (recordsUpdatedAt) await pullRecordsIfNewer(recordsUpdatedAt);
    }, CONFIG_POLL_INTERVAL);
  }
}

function stopSheetsPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// Visual indicator
function setSheetsIndicator(state) {
  const dot  = document.getElementById('sheets-sync-dot');
  const text = document.getElementById('sheets-sync-text');
  if (!dot && !text) return; // elements not in DOM (e.g. customer screen)
  const states = {
    ok:      { bg: '#2a7a4f', label: 'Sheets'   },
    syncing: { bg: '#f5c870', label: null        }, // null = don't change text, just dot color
    error:   { bg: '#fa746f', label: 'Sheets ✗' },
    idle:    { bg: '#adb3b5', label: 'Sheets'   },
  };
  const s = states[state] || states.idle;
  if (dot)  dot.style.background = s.bg;
  if (text && s.label !== null) text.textContent = s.label;
}

async function clearSheetsQueue() {
  try {
    const clientDate = todayStr();
    await fetch(SHEETS_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'clearQueue', clientDate }),
    });
  } catch(e) { /* silent */ }
}




