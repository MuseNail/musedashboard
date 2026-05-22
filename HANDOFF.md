# Muse Dashboard — New Session Handoff Prompt

Copy everything below this line and paste it as your first message in the new chat window.

---

## Context for this session

You are picking up development on **musedashboard** — a salon management PWA for Muse Nails & Spa. The app is live and in production use. This session continues from a previous context window that ran out of space.

**Please start by reading all project files in the order listed below.** The read order matters — architecture context and rules come first, then implementation files. After reading all files, confirm what you've read and await instructions.

---

## Step 1 — Read project docs (architecture, rules, history)

```
CLAUDE.md
README.md
ROADMAP.md
```

---

## Step 2 — Read all JS files in load order (this is the mandatory script load order in index.html)

```
js/utils.js
js/config.js
js/sync.js
js/photos.js
js/auth.js
js/catalog.js
js/square-customers.js
js/square-catalog.js
js/square-pos.js
js/staff.js
js/checkin.js
js/queue.js
js/turns.js
js/reports.js
js/giftcards.js
js/calendar.js
js/settings.js
js/app.js
```

---

## Step 3 — Read infrastructure and static files

```
index.html
css/styles.css
sw.js
manifest.json
cloudflare/worker.js
cloudflare/wrangler.toml
```

---

## Step 4 — Google Apps Script (NOT in the repo — read this embedded copy)

The Apps Script is deployed separately to Google Apps Script and is not stored in the GitHub repo. The current deployed version is **v1.10**. Here is the full source for your reference:

**Deployment URL:** `https://script.google.com/macros/s/AKfycby2OAUuwHNqBVovpt790C8oX_uP71QOYKdXGt_lZd3SgCdTMdgrSOlF4IA1MSZ0Ru6Y/exec`
**Google Sheet:** `https://docs.google.com/spreadsheets/d/1xApj58fLzjFecYtyokgmxe0PC5_W3vyBjRg2dHqvem8`

```js
// Muse Nails & Spa — Google Apps Script
// Version: v1.10  App: musedashboard
// Worker: https://musedashboard.musenailandspa.workers.dev
// GitHub: https://musenail.github.io/musedashboard/
// Deployment URL: https://script.google.com/macros/s/AKfycby2OAUuwHNqBVovpt790C8oX_uP71QOYKdXGt_lZd3SgCdTMdgrSOlF4IA1MSZ0Ru6Y/exec
// Sheet: https://docs.google.com/spreadsheets/d/1xApj58fLzjFecYtyokgmxe0PC5_W3vyBjRg2dHqvem8

const TIMEZONE = 'America/Los_Angeles'; // Pacific Time

const SPREADSHEET_ID = '1xApj58fLzjFecYtyokgmxe0PC5_W3vyBjRg2dHqvem8';
const QUEUE_SHEET    = 'Live Queue';
const TXLOG_SHEET    = 'Transaction Log';
const CHECKIN_SHEET  = 'Check-Ins';

// Daily summary email recipient. Leave '' to send to the script owner's Gmail.
const MANAGER_EMAIL  = '';

const TXLOG_HEADERS = [
  'Timestamp','Name','Phone','Services','Type','Status',
  'Staff','Stations','Service Detail','Services Total',
  'Items','Items Total','Fees','Fees Total',
  'Discount','Discount Note','Total','Logged By',
  'Date','Time','Entry ID'
];

const CHECKIN_HEADERS = [
  'Entry ID','Name','Phone','Services','Type',
  'Checked In At','Completed At','Staff','Services Total',
  'Items','Items Total','Fees','Fees Total',
  'Discount','Discount Note','Total',
  'Duration (min)','Status','Logged By','Date'
];

// ── Router ────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;
    switch (data.action) {
      case 'saveQueue':     result = saveQueue(data);           break;
      case 'loadQueue':     result = loadQueue(data);           break;
      case 'clearQueue':    result = clearQueue(data);          break;
      case 'saveRecords':   result = saveRecordsBlob(data);     break;
      case 'loadRecordsBlob': result = loadRecordsBlob();       break;
      case 'append':        result = appendTxLog(data);         break;
      case 'update':        result = updateTxLog(data);         break;
      case 'checkinRow':    result = upsertCheckin(data);       break;
      case 'saveConfig':    result = saveConfig(data);          break;
      case 'saveGiftCards': result = saveGiftCards(data);       break;
      case 'loadRecords':   result = loadRecords();             break;
      case 'loadGiftCards': result = loadGiftCardsData();       break;
      case 'archiveDay':    result = archiveDay(data);          break;
      default:              result = appendTxLog(data);         break;
    }
    return jsonResponse(result);
  } catch(err) {
    logError('doPost', err);
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action || '';
    let result;
    switch (action) {
      case 'loadQueue':  result = loadQueue(e.parameter);  break;
      case 'loadConfig': result = loadConfig();            break;
      case 'ping':       result = { success: true, time: new Date().toISOString() }; break;
      default:           result = { success: true, status: 'Muse Sheets v10 running' };
    }
    return jsonResponse(result);
  } catch(err) {
    logError('doGet', err);
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Live Queue ────────────────────────────────────
// Key fix: use the CLIENT's date (sent in the request) not the server timezone.
// Apps Script may run in UTC which causes date mismatches in US timezones.

function getQueueSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(QUEUE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(QUEUE_SHEET);
    sheet.getRange(1,1,1,4).setValues([['Date','UpdatedAt','Device','QueueJSON']]);
    sheet.getRange(1,1,1,4).setBackground('#1a5252').setFontColor('#fff').setFontWeight('bold');
    sheet.setColumnWidth(4, 800);
  }
  return sheet;
}

function saveQueue(data) {
  const sheet   = getQueueSheet();
  const today   = data.clientDate || Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const now     = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  const device  = data.device || 'unknown';
  const payload = {
    queue:       data.queue || [],
    turnsOrder:  data.turnsOrder || null,
    deletedIds:  data.deletedIds || [],
  };
  const json    = JSON.stringify(payload);
  const lastRow = sheet.getLastRow();
  const rows    = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];

  for (let i = 0; i < rows.length; i++) {
    const cellVal = rows[i][0];
    const cellStr = cellVal instanceof Date
      ? Utilities.formatDate(cellVal, TIMEZONE, 'yyyy-MM-dd')
      : String(cellVal);
    if (cellStr === today) {
      sheet.getRange(i + 2, 1, 1, 4).setValues([[today, now, device, json]]);
      return { success: true, action: 'updated', count: (data.queue||[]).length, updatedAt: now };
    }
  }
  sheet.appendRow([today, now, device, json]);
  return { success: true, action: 'created', count: (data.queue||[]).length, updatedAt: now };
}

function loadQueue(params) {
  const sheet      = getQueueSheet();
  const clientDate = params && params.clientDate ? params.clientDate : null;
  const serverDate = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const lastRow    = sheet.getLastRow();
  if (lastRow < 2) return { success: true, queue: [], updatedAt: null };
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  const datesToTry = clientDate ? [clientDate, serverDate] : [serverDate];
  for (const dateStr of datesToTry) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const cellVal = rows[i][0];
      const cellStr = cellVal instanceof Date
        ? Utilities.formatDate(cellVal, TIMEZONE, 'yyyy-MM-dd')
        : String(cellVal);
      if (cellStr === dateStr) {
        try {
          const parsed = JSON.parse(rows[i][3] || '{}');
          const queue      = Array.isArray(parsed) ? parsed : (parsed.queue || []);
          const turnsOrder = Array.isArray(parsed) ? null  : (parsed.turnsOrder || null);
          const deletedIds = Array.isArray(parsed) ? []    : (parsed.deletedIds || []);
          return { success: true, queue, turnsOrder, deletedIds, updatedAt: rows[i][1], device: rows[i][2], matchedDate: cellStr };
        } catch(e) {
          logError('loadQueue parse', e);
          return { success: true, queue: [], updatedAt: null };
        }
      }
    }
  }
  return { success: true, queue: [], updatedAt: null };
}

function clearQueue(data) {
  const sheet      = getQueueSheet();
  const clientDate = data && data.clientDate ? data.clientDate : null;
  const serverDate = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const today      = clientDate || serverDate;
  const lastRow    = sheet.getLastRow();
  if (lastRow < 2) return { success: true };
  const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < rows.length; i++) {
    const cellVal = rows[i][0];
    const cellStr = cellVal instanceof Date
      ? Utilities.formatDate(cellVal, TIMEZONE, 'yyyy-MM-dd')
      : String(cellVal);
    if (cellStr === today) {
      sheet.getRange(i + 2, 3, 1, 2).setValues([['midnight-reset', '[]']]);
      return { success: true };
    }
  }
  return { success: true };
}

// ── Transaction Log ───────────────────────────────
function getTxLogSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(TXLOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TXLOG_SHEET);
    sheet.getRange(1,1,1,14).setValues([TXLOG_HEADERS]);
    sheet.getRange(1,1,1,14).setBackground('#1a5252').setFontColor('#fff').setFontWeight('bold');
  }
  return sheet;
}

function buildTxRow(data) {
  const now     = new Date();
  const checkin = data.checkinTime ? new Date(data.checkinTime) : now;
  const svcStr  = Array.isArray(data.services) ? data.services.join(', ') : (data.services || '');

  const items = Array.isArray(data.items) ? data.items : [];
  const itemsStr  = items.map(i => `${i.label||i.itemId} x${i.qty||1} @$${Number(i.price||0).toFixed(2)}`).join('; ');
  const itemsTotal = items.reduce((s,i) => s + (Number(i.price||0) * Number(i.qty||0)), 0);

  const fees = Array.isArray(data.fees) ? data.fees : [];
  const feesStr  = fees.map(f => `${f.label||f.feeId} $${Number(f.amount||0).toFixed(2)}`).join('; ');
  const feesTotal = fees.reduce((s,f) => s + Number(f.amount||0), 0);

  const discount     = Number(data.discount || 0);
  const discountNote = data.discountNote || '';
  const svcTotal = Number(data.svcTotal || (Number(data.total||0) - itemsTotal - feesTotal + discount));

  return [
    now.toLocaleString(),
    data.name      || '',
    data.phone     || '',
    svcStr,
    data.type      || (data.isAppointment ? 'Appointment' : 'Walk-In'),
    data.status    || 'waiting',
    data.staff     || '',
    data.stations  || '',
    data.detail    || '',
    svcTotal,
    itemsStr,
    itemsTotal,
    feesStr,
    feesTotal,
    discount,
    discountNote,
    Number(data.total) || 0,
    data.loggedBy  || '',
    Utilities.formatDate(checkin, TIMEZONE, 'M/d/yyyy'),
    Utilities.formatDate(checkin, TIMEZONE, 'h:mm a'),
    String(data.entryId || ''),
  ];
}

function appendTxLog(data) {
  const entryId = String(data.entryId || '');
  if (entryId) {
    const sheet = getTxLogSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 21, lastRow-1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === entryId) {
          sheet.getRange(i+2, 1, 1, 21).setValues([buildTxRow(data)]);
          return { success: true, action: 'updated' };
        }
      }
    }
  }
  getTxLogSheet().appendRow(buildTxRow(data));
  return { success: true, action: 'appended' };
}

function updateTxLog(data) {
  const sheet   = getTxLogSheet();
  const entryId = String(data.entryId || '');
  if (!entryId) return appendTxLog(data);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return appendTxLog(data);
  const ids = sheet.getRange(2, 21, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === entryId) {
      sheet.getRange(i + 2, 1, 1, 21).setValues([buildTxRow(data)]);
      return { success: true, action: 'updated' };
    }
  }
  return appendTxLog(data);
}

// ── Check-Ins (one row per customer) ─────────────
function getCheckinSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CHECKIN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CHECKIN_SHEET);
    sheet.getRange(1,1,1,CHECKIN_HEADERS.length).setValues([CHECKIN_HEADERS]);
    sheet.getRange(1,1,1,CHECKIN_HEADERS.length).setBackground('#2a7a4f').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function buildCheckinRow(data) {
  const checkin  = data.checkinTime ? new Date(data.checkinTime) : new Date();
  const complete = data.completedAt ? new Date(data.completedAt) : null;
  const svcStr   = Array.isArray(data.services) ? data.services.join(', ') : (data.services || '');
  const duration = complete ? Math.round((complete - checkin) / 60000) : '';

  const items = Array.isArray(data.items) ? data.items : [];
  const itemsStr   = items.map(i => `${i.label||i.itemId} x${i.qty||1} @$${Number(i.price||0).toFixed(2)}`).join('; ');
  const itemsTotal = items.reduce((s,i) => s + (Number(i.price||0) * Number(i.qty||0)), 0);

  const fees = Array.isArray(data.fees) ? data.fees : [];
  const feesStr   = fees.map(f => `${f.label||f.feeId} $${Number(f.amount||0).toFixed(2)}`).join('; ');
  const feesTotal = fees.reduce((s,f) => s + Number(f.amount||0), 0);

  const discount     = Number(data.discount || 0);
  const discountNote = data.discountNote || '';
  const svcTotal     = Number(data.svcTotal || (Number(data.total||0) - itemsTotal - feesTotal + discount));

  return [
    String(data.entryId || ''),
    data.name     || '',
    data.phone    || '',
    svcStr,
    data.type     || (data.isAppointment ? 'Appointment' : 'Walk-In'),
    Utilities.formatDate(checkin, TIMEZONE, 'M/d/yyyy h:mm a'),
    complete ? Utilities.formatDate(complete, TIMEZONE, 'M/d/yyyy h:mm a') : '',
    data.staff    || '',
    svcTotal,
    itemsStr,
    itemsTotal,
    feesStr,
    feesTotal,
    discount,
    discountNote,
    Number(data.total) || 0,
    duration,
    data.status   || 'waiting',
    data.loggedBy || '',
    Utilities.formatDate(checkin, TIMEZONE, 'M/d/yyyy'),
  ];
}

function upsertCheckin(data) {
  const sheet   = getCheckinSheet();
  const entryId = String(data.entryId || '');
  if (!entryId) return { success: false, error: 'Missing entryId' };
  const row     = buildCheckinRow(data);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === entryId) {
        sheet.getRange(i + 2, 1, 1, CHECKIN_HEADERS.length).setValues([row]);
        colorCheckinRow(sheet, i + 2, data.status);
        return { success: true, action: 'updated' };
      }
    }
  }
  sheet.appendRow(row);
  colorCheckinRow(sheet, sheet.getLastRow(), data.status);
  return { success: true, action: 'appended' };
}

function colorCheckinRow(sheet, rowNum, status) {
  const colors = { waiting: '#fff8e1', inservice: '#e3f2fd', done: '#e8f5e9', deleted: '#fce4ec' };
  sheet.getRange(rowNum, 1, 1, CHECKIN_HEADERS.length).setBackground(colors[status] || '#ffffff');
}

// ── App Config Sync ───────────────────────────────
const CONFIG_SHEET = 'App Config';

function getConfigSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET);
    sheet.getRange(1,1,1,3).setValues([['UpdatedAt','Device','ConfigJSON']]);
    sheet.getRange(1,1,1,3).setBackground('#37474f').setFontColor('#fff').setFontWeight('bold');
    sheet.setColumnWidth(3, 1000);
  }
  return sheet;
}

function saveConfig(data) {
  const sheet  = getConfigSheet();
  const now    = new Date().toISOString();
  const device = data.device || 'unknown';
  const json   = JSON.stringify(data.config || {});
  const isPhotos = data.config && data.config.muse_photos;
  const lastRow  = sheet.getLastRow();

  if (isPhotos) {
    if (lastRow >= 3) {
      sheet.getRange(3, 1, 1, 3).setValues([[now, device + '-photos', json]]);
    } else {
      while (sheet.getLastRow() < 2) sheet.appendRow([now, 'placeholder', '{}']);
      sheet.appendRow([now, device + '-photos', json]);
    }
  } else {
    if (lastRow >= 2) {
      sheet.getRange(2, 1, 1, 3).setValues([[now, device, json]]);
    } else {
      sheet.appendRow([now, device, json]);
    }
  }
  return { success: true, updatedAt: now };
}

function loadConfig() {
  const sheet   = getConfigSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, config: null };
  try {
    const row1   = sheet.getRange(2, 1, 1, 3).getValues()[0];
    const config = JSON.parse(row1[2] || '{}');
    if (lastRow >= 3) {
      const row2 = sheet.getRange(3, 1, 1, 3).getValues()[0];
      if (row2[1] && String(row2[1]).includes('photos')) {
        const photoData = JSON.parse(row2[2] || '{}');
        Object.assign(config, photoData);
      }
    }
    let recordsUpdatedAt = null;
    if (lastRow >= 4) {
      const row4 = sheet.getRange(4, 1, 1, 2).getValues()[0];
      if (row4[1] && String(row4[1]).includes('records')) {
        recordsUpdatedAt = String(row4[0] || '');
      }
    }
    return { success: true, config, updatedAt: row1[0], device: row1[1], recordsUpdatedAt };
  } catch(e) {
    return { success: true, config: null };
  }
}

// ── allRecords Blob Sync (row 4 of App Config) ────────────────────────────────
function saveRecordsBlob(data) {
  try {
    const sheet  = getConfigSheet();
    const now    = new Date().toISOString();
    const device = (data.device || 'unknown') + '-records';
    const records = data.records || [];
    const json   = JSON.stringify(records);
    const lastRow = sheet.getLastRow();

    while (sheet.getLastRow() < 3) {
      sheet.appendRow([now, 'placeholder', '{}']);
    }
    if (lastRow >= 4) {
      sheet.getRange(4, 1, 1, 3).setValues([[now, device, json]]);
    } else {
      sheet.appendRow([now, device, json]);
    }
    return { success: true, updatedAt: now, count: records.length };
  } catch(err) {
    logError('saveRecordsBlob', err);
    return { success: false, error: err.message };
  }
}

function loadRecordsBlob() {
  try {
    const sheet   = getConfigSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return { success: true, records: [], updatedAt: null };
    const row = sheet.getRange(4, 1, 1, 3).getValues()[0];
    if (!row[1] || !String(row[1]).includes('records')) {
      return { success: true, records: [], updatedAt: null };
    }
    const records   = JSON.parse(row[2] || '[]');
    const updatedAt = String(row[0] || '');
    return { success: true, records, updatedAt, count: records.length };
  } catch(err) {
    logError('loadRecordsBlob', err);
    return { success: false, error: err.message, records: [] };
  }
}

// ── Error Logging ─────────────────────────────────
function logError(context, err) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let log  = ss.getSheetByName('Errors');
    if (!log) {
      log = ss.insertSheet('Errors');
      log.appendRow(['Time','Context','Error']);
      log.getRange(1,1,1,3).setBackground('#c62828').setFontColor('#fff').setFontWeight('bold');
    }
    log.appendRow([new Date().toISOString(), context, err.message || String(err)]);
  } catch(e) { /* truly silent */ }
}

// ── Gift Cards Tab ─────────────────────────────────
const GC_SHEET   = 'Gift Cards';
const GC_HEADERS = [
  'Date Purchased','Serial No.','Purchase Amount','From','To','Phone',
  'Date Used','Amount Used','Balance','Notes','Last Updated'
];

function getGcSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(GC_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(GC_SHEET);
    sheet.getRange(1,1,1,GC_HEADERS.length).setValues([GC_HEADERS]);
    sheet.getRange(1,1,1,GC_HEADERS.length).setBackground('#1a5252').setFontColor('#fff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    [80,90,90,120,120,110,80,90,80,200,120].forEach((w,i) => sheet.setColumnWidth(i+1, w));
  }
  return sheet;
}

function saveGiftCards(data) {
  const sheet = getGcSheet();
  const cards = data.giftCards || [];
  if (cards.length === 0) return { success: true, action: 'empty' };

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const rows = cards.map(g => {
    const balance = (g.amount||0) - (g.amountUsed||0);
    return [
      g.datePurchased || '',
      g.serial        || '',
      g.amount        || 0,
      g.from          || '',
      g.to            || '',
      g.phone         || '',
      g.dateUsed      || '',
      g.amountUsed    || 0,
      balance,
      g.notes         || '',
      g.updatedAt     || '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, GC_HEADERS.length).setValues(rows);
    cards.forEach((g, i) => {
      const rowNum = i + 2;
      const isUsed = g.dateUsed || g.amountUsed > 0;
      const bg = isUsed ? '#e8f5e9' : '#fff8e1';
      sheet.getRange(rowNum, 1, 1, GC_HEADERS.length).setBackground(bg);
    });
  }

  return { success: true, action: 'saved', count: rows.length };
}

// ── Load Records from Check-Ins + Transaction Log ──
function loadRecords() {
  try {
    const byId = {};

    const ciSheet   = getCheckinSheet();
    const ciLastRow = ciSheet.getLastRow();
    if (ciLastRow >= 2) {
      const ciRows = ciSheet.getRange(2, 1, ciLastRow - 1, 13).getValues();
      ciRows.forEach(row => {
        const entryId = String(row[0] || '').trim();
        if (!entryId) return;
        const name      = String(row[1]  || '');
        const phone     = String(row[2]  || '');
        const svcStr    = String(row[3]  || '');
        const type      = String(row[4]  || '');
        const checkedIn = row[5] ? new Date(row[5]) : null;
        const status    = String(row[10] || 'done');
        const total     = Number(row[8]  || 0);
        const loggedBy  = String(row[11] || '');

        const services = svcStr ? svcStr.split(',').map(s => s.trim()).filter(Boolean) : [];
        let checkinTime = checkedIn && !isNaN(checkedIn) ? checkedIn.toISOString() : '';

        const assignments = total > 0 ? [{
          serviceId: '', status: status === 'done' ? 'done' : 'waiting',
          techId: '', cost: total, assignedAt: 0,
        }] : [];

        byId[entryId] = {
          id: entryId, name, phone, services, assignments,
          totalCost: total, checkinTime, status,
          isAppointment: type === 'Appointment', loggedBy,
          staffStr: String(row[7] || ''),
        };
      });
    }

    const txSheet   = getTxLogSheet();
    const txLastRow = txSheet.getLastRow();
    if (txLastRow >= 2) {
      const txRows = txSheet.getRange(2, 1, txLastRow - 1, 14).getValues();
      const txById = {};
      txRows.forEach(row => {
        const entryId = String(row[13] || '').trim();
        if (!entryId) return;
        txById[entryId] = row;
      });

      Object.entries(txById).forEach(([entryId, row]) => {
        const name     = String(row[1]  || '');
        const phone    = String(row[2]  || '');
        const svcStr   = String(row[3]  || '');
        const type     = String(row[4]  || '');
        const status   = String(row[5]  || 'done');
        const detail   = String(row[8]  || '');
        const total    = Number(row[9]  || 0);
        const loggedBy = String(row[10] || '');
        const dateStr  = String(row[11] || '');
        const timeStr  = String(row[12] || '');
        const timestamp= String(row[0]  || '');

        const services = svcStr ? svcStr.split(',').map(s => s.trim()).filter(Boolean) : [];

        let checkinTime = timestamp;
        if (dateStr && timeStr) {
          try {
            const d = new Date(dateStr + ' ' + timeStr);
            if (!isNaN(d.getTime())) checkinTime = d.toISOString();
          } catch(e) {}
        }

        const assignments = [];
        if (detail) {
          detail.split('|').forEach(part => {
            const p = part.trim();
            if (!p) return;
            const costMatch = p.match(/\$(\d+(?:\.\d+)?)/);
            const cost = costMatch ? Number(costMatch[1]) : 0;
            let serviceLabel = '', techName = '';
            const colonIdx = p.indexOf(':');
            if (colonIdx > -1) {
              serviceLabel = p.substring(0, colonIdx).trim();
              const afterColon = p.substring(colonIdx + 1).trim();
              const beforeDollar = afterColon.split('$')[0].trim();
              techName = beforeDollar.replace(/\s+[A-Z]\d+\s*$/i, '').trim();
            }
            assignments.push({
              serviceId: '', serviceLabel,
              techId: '', techName,
              status: status === 'done' ? 'done' : 'waiting',
              cost, assignedAt: 0,
            });
          });
        }
        if (assignments.length === 0 && total > 0) {
          assignments.push({ serviceId: '', techId: '', status: status === 'done' ? 'done' : 'waiting', cost: total, assignedAt: 0 });
        }

        if (byId[entryId]) {
          const existing = byId[entryId];
          if (assignments.length > 0) existing.assignments = assignments;
          if (status) existing.status = status;
          if (total > existing.totalCost) existing.totalCost = total;
          if (!existing.checkinTime && checkinTime) existing.checkinTime = checkinTime;
        } else {
          byId[entryId] = {
            id: entryId, name, phone, services, assignments,
            totalCost: total, checkinTime, status,
            isAppointment: type === 'Appointment', loggedBy,
            staffStr: String(row[6] || ''),
          };
        }
      });
    }

    const records = Object.values(byId);
    return { success: true, records: records, count: records.length };
  } catch(err) {
    logError('loadRecords', err);
    return { success: false, error: err.message, records: [] };
  }
}

// ── Load Gift Cards from Sheet ─────────────────────
function loadGiftCardsData() {
  try {
    const sheet   = getGcSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, giftCards: [] };

    const rows = sheet.getRange(2, 1, lastRow - 1, GC_HEADERS.length).getValues();

    const giftCards = rows
      .filter(row => row[2] > 0 || row[1])
      .map((row, i) => {
        const datePurchased = row[0] ? Utilities.formatDate(new Date(row[0]), TIMEZONE, 'yyyy-MM-dd') : '';
        const dateUsed      = row[6] ? Utilities.formatDate(new Date(row[6]), TIMEZONE, 'yyyy-MM-dd') : '';
        const updatedAt     = row[10] ? String(row[10]) : new Date().toISOString();
        return {
          id:            'gc-imported-' + (i + 1),
          datePurchased: datePurchased,
          serial:        String(row[1] || ''),
          amount:        Number(row[2] || 0),
          from:          String(row[3] || ''),
          to:            String(row[4] || ''),
          phone:         String(row[5] || ''),
          dateUsed:      dateUsed,
          amountUsed:    Number(row[7] || 0),
          notes:         String(row[9] || ''),
          createdAt:     updatedAt,
          updatedAt:     updatedAt,
        };
      });

    return { success: true, giftCards: giftCards, count: giftCards.length };
  } catch(err) {
    logError('loadGiftCardsData', err);
    return { success: false, error: err.message, giftCards: [] };
  }
}

// ── Daily Archive + Gmail Summary ─────────────────
// Called by the Cloudflare Cron Trigger at 4:05 AM Pacific via the Worker.
// Also serves as the permanent fix for Phase 0 Bug 1 (browser setTimeout unreliable).

function archiveDay(data) {
  try {
    const today = data.clientDate || Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const stats = getDayStats(today);
    sendDailySummary(today, stats);
    clearQueue({ clientDate: today });
    return { success: true, date: today, customers: stats.totalCustomers, revenue: stats.totalRevenue };
  } catch(e) {
    logError('archiveDay', e);
    return { success: false, error: e.message };
  }
}

function getDayStats(dateStr) {
  const ciSheet = getCheckinSheet();
  const lastRow = ciSheet.getLastRow();
  if (lastRow < 2) return { totalCustomers: 0, totalRevenue: 0, byTech: {} };

  // Convert YYYY-MM-DD to M/d/yyyy to match the Date column written by buildCheckinRow
  const targetDate = Utilities.formatDate(
    new Date(dateStr + 'T20:00:00Z'), TIMEZONE, 'M/d/yyyy'
  );

  const rows = ciSheet.getRange(2, 1, lastRow - 1, CHECKIN_HEADERS.length).getValues();
  let totalCustomers = 0, totalRevenue = 0;
  const byTech = {};

  rows.forEach(row => {
    if (String(row[19] || '') !== targetDate) return; // Date column (index 19)
    if (String(row[17] || '') !== 'done') return;     // Status column (index 17)
    totalCustomers++;
    const total = Number(row[15] || 0);               // Total column (index 15)
    totalRevenue += total;
    const staff = String(row[7] || '');               // Staff column (index 7)
    if (staff) {
      const techs = staff.split(',').map(s => s.trim()).filter(Boolean);
      const share = techs.length > 0 ? total / techs.length : 0;
      techs.forEach(tech => {
        if (!byTech[tech]) byTech[tech] = { customers: 0, revenue: 0 };
        byTech[tech].customers++;
        byTech[tech].revenue += share;
      });
    }
  });

  return { totalCustomers, totalRevenue, byTech };
}

function sendDailySummary(dateStr, stats) {
  try {
    const email = MANAGER_EMAIL || Session.getActiveUser().getEmail();
    if (!email) return;

    const dateLabel = Utilities.formatDate(
      new Date(dateStr + 'T20:00:00Z'), TIMEZONE, 'EEEE, MMMM d, yyyy'
    );

    let body = 'Daily Summary — ' + dateLabel + '\n\n';
    body += 'Customers served : ' + stats.totalCustomers + '\n';
    body += 'Total revenue    : $' + stats.totalRevenue.toFixed(2) + '\n';

    const techs = Object.entries(stats.byTech).sort((a, b) => b[1].revenue - a[1].revenue);
    if (techs.length > 0) {
      body += '\nBy technician:\n';
      techs.forEach(([name, d]) => {
        body += '  ' + name + ': ' + d.customers +
                ' customer' + (d.customers !== 1 ? 's' : '') +
                ', $' + d.revenue.toFixed(2) + '\n';
      });
    }

    body += '\n— Muse Dashboard';
    GmailApp.sendEmail(email, 'Muse Summary — ' + dateStr, body);
  } catch(e) {
    logError('sendDailySummary', e);
  }
}
```

---

## Step 5 — Current project state (read this after all files)

**Version:** v1.72 (production)
**Status:** Live and in production use. Operational optimization mode.

### What was completed in the session before this one

**Square API fixes (v1.69–v1.71):**
- `js/square-customers.js` + `js/square-pos.js`: Changed `GET /v2/team-members` (invalid endpoint) to `POST /v2/team-members/search` with body `{ query: { filter: { status: 'ACTIVE' } }, limit: 200 }`
- `cloudflare/worker.js`: Added `headers.delete('origin')` and `headers.delete('referer')` in the Square proxy to prevent Square from rejecting browser-origin requests with "invalid cross-origin request". Deployed with `wrangler deploy`.
- `js/square-catalog.js`: Removed invalid `types=SERVICE` request (SERVICE is not a valid CatalogObjectType in Square API v2024-11-20). Now uses single `GET /v2/catalog/list?types=ITEM` request. Added classification logic: `null` product_type → SERVICES, `APPOINTMENTS_SERVICE` → SERVICES, explicit retail types (`REGULAR`, `FOOD_AND_BEV`, etc.) → ITEMS, fee/charge/surcharge names → FEES.

**Post-launch stabilization (v1.72):**
- `README.md`, `ROADMAP.md`, `CLAUDE.md` rewritten to reflect production status
- Deleted obsolete files: `split.ps1`, `split.js`, `icons/generate-icons.html`
- Version bumped to v1.72 in `js/config.js`, `version.json`, `sw.js`

**Pending user action (not a code task):**
- User needs to run the "Clear All Records" button on each device (iPad, Android, each desktop browser profile) before starting real production transactions, to eliminate old test records from localStorage. Records in Sheets can be cleared manually from the Google Sheet directly.

### Architecture notes for this session

- **App Config tab in Sheets:** Row 2 = main config, Row 3 = photos, Row 4 = records blob
- **allRecords sync:** `pullRecordsIfNewer` skips pull if remote has 0 records (prevents accidental wipe). `pushRecordsToSheets` sends ALL allRecords. Old localStorage records survive Sheets pulls unless explicitly cleared.
- **localStorage is device-specific:** `muse_records` does NOT sync via Chrome profile across computers — each device has independent localStorage.
- **Worker changes:** require `wrangler deploy` from `cloudflare/` directory separately from git push.
- **Security note:** The Square access token must never be committed to the repo. It is stored as a Cloudflare Worker secret (`wrangler secret put SQUARE_TOKEN`).

### What to work on next

Await instructions from the user. They may want to:
- Continue with post-launch optimization (see Priority 1–3 in ROADMAP.md)
- Address items from the Remaining Technical Debt section in ROADMAP.md
- Build new features
- Fix bugs reported from production use

**After reading all files, confirm what you've read and wait for instructions.**
