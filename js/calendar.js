// ── Google Calendar Integration ───────────────────
const GCAL_CLIENT_ID = '174518644579-5vgt7vvllm2ekpk0gb8l4sa4f3va9r9l.apps.googleusercontent.com';
const GCAL_SCOPES    = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
const GCAL_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const GTASK_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest';

let _calGapiLoaded  = false;
let _calGisLoaded   = false;
let _calTokenClient = null;
let _calDate        = new Date(); // currently viewed date
let _calCalendars   = []; // [{id, name, color, techId}]
let _calEvents      = {}; // { calId: [events] }
let _apptServices   = []; // selected services in new appt modal
let _apptEditId     = null; // event ID being edited

// Load Google API scripts once
function loadGCalScripts() {
  if (document.getElementById('gapi-script')) return;
  const s1 = document.createElement('script');
  s1.id = 'gapi-script';
  s1.src = 'https://apis.google.com/js/api.js';
  s1.onload = () => {
    gapi.load('client', async () => {
      await gapi.client.init({ discoveryDocs: [GCAL_DISCOVERY, GTASK_DISCOVERY] });
      _calGapiLoaded = true;
      _calTryReady();
    });
  };
  document.head.appendChild(s1);

  const s2 = document.createElement('script');
  s2.id = 'gis-script';
  s2.src = 'https://accounts.google.com/gsi/client';
  s2.onload = () => {
    _calTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GCAL_CLIENT_ID,
      scope: GCAL_SCOPES,
      callback: (resp) => {
        if (resp.error) { calSetStatus('Sign-in failed: ' + resp.error); return; }
        const expires = Date.now() + (resp.expires_in * 1000);
        localStorage.setItem('gcal_token', JSON.stringify({ token: resp.access_token, expires }));
        // Share token with other devices via Sheets
        saveTokenToSheets(resp.access_token, expires);
        gapi.client.setToken({ access_token: resp.access_token });
        document.getElementById('cal-signin-btn')?.classList.add('hidden');
        calSetStatus('');
        startCalSync();
        calLoadAndRender();
        loadTaskLists();
      },
    });
    _calGisLoaded = true;
    _calTryReady();
  };
  document.head.appendChild(s2);
}

function _calTryReady() {
  if (!_calGapiLoaded || !_calGisLoaded) return;
  // Try local token first
  const saved = localStorage.getItem('gcal_token');
  if (saved) {
    try {
      const { token, expires } = JSON.parse(saved);
      if (Date.now() < expires - 60000) {
        gapi.client.setToken({ access_token: token });
        document.getElementById('cal-signin-btn')?.classList.add('hidden');
        calSetStatus('');
        startCalSync();
        calLoadAndRender();
        loadTaskLists();
        return;
      }
    } catch(e) {}
  }
  // Try token from Sheets (shared from another device)
  calSetStatus('Checking for saved credentials…');
  loadTokenFromSheets().then(saved => {
    if (saved) {
      localStorage.setItem('gcal_token', JSON.stringify(saved));
      gapi.client.setToken({ access_token: saved.token });
      document.getElementById('cal-signin-btn')?.classList.add('hidden');
      calSetStatus('');
      startCalSync();
      calLoadAndRender();
      loadTaskLists();
    } else {
      // No valid token anywhere — show sign-in
      document.getElementById('cal-signin-btn')?.classList.remove('hidden');
      calSetStatus('Click "Connect Google Calendar" to get started');
    }
  });
}

function initCalendar() {
  _calDate = new Date();
  calUpdateDateLabel();
  loadGCalScripts();
}

function calSignIn(silent) {
  if (!_calTokenClient) { showToast('Still loading — try again in a moment'); return; }
  _calTokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
}

function calSignOut() {
  const token = gapi.client.getToken();
  if (token) google.accounts.oauth2.revoke(token.access_token, () => {});
  gapi.client.setToken(null);
  localStorage.removeItem('gcal_token');
  _calCalendars = [];
  _calEvents = {};
  document.getElementById('cal-grid').classList.add('hidden');
  document.getElementById('cal-loading').classList.remove('hidden');
  document.getElementById('cal-signin-btn')?.classList.remove('hidden');
  calSetStatus('Signed out. Click Connect to sign back in.');
}

function calSetStatus(msg) {
  const el = document.getElementById('cal-status-msg');
  const loading = document.getElementById('cal-loading');
  if (!el || !loading) return;
  if (msg) {
    el.textContent = msg;
    loading.classList.remove('hidden');
    document.getElementById('cal-grid').classList.add('hidden');
  } else {
    loading.classList.add('hidden');
  }
}

function calUpdateDateLabel() {
  const el = document.getElementById('cal-date-label');
  if (el) el.textContent = _calDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  calUpdateDateInput();
}

function calNavDay(delta) {
  _calDate = new Date(_calDate);
  _calDate.setDate(_calDate.getDate() + delta);
  calUpdateDateLabel();
  calLoadAndRender();
}

function calGoToday() {
  _calDate = new Date();
  calUpdateDateLabel();
  calLoadAndRender();
}

async function calLoadAndRender(silent) {
  if (!silent) calSetStatus('Loading calendars…');
  try {
    // 1. Get all calendars in the account
    const calListResp = await gapi.client.calendar.calendarList.list({ minAccessRole: 'owner' });
    const items = calListResp.result.items || [];

    // Filter out default/system calendars — keep only ones that look like tech names
    // System calendars: 'primary', contacts, holidays, etc.
    const systemNames = ['contacts', 'holiday', 'birthday', 'other calendar', 'united states'];
    _calCalendars = items.filter(c => {
      const name = (c.summary || '').toLowerCase();
      return !systemNames.some(s => name.includes(s)) && c.id !== 'primary';
    }).map(c => ({
      id: c.id,
      name: c.summary,
      color: c.backgroundColor || '#1a5252',
    }));

    // If no custom calendars found, include primary
    if (_calCalendars.length === 0) {
      const primary = items.find(c => c.id === 'primary' || c.primary);
      if (primary) _calCalendars = [{ id: primary.id, name: 'Primary', color: '#1a5252' }];
    }

    // 2. Load events for each calendar for the selected day
    const dayStart = new Date(_calDate);
    dayStart.setHours(0,0,0,0);
    const dayEnd   = new Date(_calDate);
    dayEnd.setHours(23,59,59,999);

    // Apply saved column order
    applyCalOrder();

    _calEvents = {};
    await Promise.all(_calCalendars.map(async cal => {      try {
        const evResp = await gapi.client.calendar.events.list({
          calendarId: cal.id,
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100,
        });
        _calEvents[cal.id] = evResp.result.items || [];
      } catch(e) { _calEvents[cal.id] = []; }
    }));

    // Preserve scroll position across re-renders (auto-sync should not jump to top)
    const gbBefore = document.getElementById('cal-grid-body');
    const savedScroll = gbBefore ? gbBefore.scrollTop : null;
    calRenderGrid();
    if (savedScroll !== null) {
      requestAnimationFrame(() => {
        const gbAfter = document.getElementById('cal-grid-body');
        if (gbAfter) gbAfter.scrollTop = savedScroll;
      });
    }
    renderCalSelectorList();
    calUpdateDateInput();
  } catch(err) {
    console.error('[Calendar]', err);
    if (err.status === 401) {
      localStorage.removeItem('gcal_token');
      // Try silent re-auth first, then prompt if that fails
      calSetStatus('Session expired — reconnecting…');
      calSignIn(true); // silent re-auth attempt
      document.getElementById('cal-signin-btn')?.classList.remove('hidden');
    } else {
      calSetStatus('Error loading calendar: ' + (err.result?.error?.message || err.message || 'Unknown error'));
    }
  }
}

function calRenderGrid() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const visible = _calCalendars.filter(c => !_calHidden.has(c.id));
  if (_calCalendars.length === 0) { calSetStatus('No technician calendars found.'); return; }
  if (visible.length === 0) {
    calSetStatus('All calendars hidden. Use Calendars filter.');
    document.getElementById('cal-loading').classList.remove('hidden');
    grid.classList.add('hidden'); return;
  }

  calSetStatus('');
  document.getElementById('cal-loading').classList.add('hidden');
  grid.classList.remove('hidden');

  const _calCfg = JSON.parse(localStorage.getItem('muse_cal_hours') || 'null');
  const START_HOUR = _calCfg?.start ?? 6;
  const END_HOUR   = _calCfg?.end   ?? 22;
  const SLOT_MINS  = _calSlotMins || 30;
  const SLOTS      = (END_HOUR - START_HOUR) * (60 / SLOT_MINS);
  const SLOT_H     = _calSlotH   || 52;
  const HEADER_H   = 48;
  const TIME_W     = 64;
  // All columns equal width — account for tasks panel if visible
  // Cache this computation: tasks panel width only changes on user action, not on 60s sync
  const tasksPanelEl = document.getElementById('cal-tasks-panel');
  const tasksPanelW = (!_tasksMinimized && tasksPanelEl?.style.display !== 'none') ? 280 : 44;
  const availW = window.innerWidth - TIME_W - tasksPanelW - 48;
  const COL_W  = Math.max(120, Math.floor(availW / visible.length));

  const now     = new Date();
  const isToday = now.toDateString() === _calDate.toDateString();
  const nowMin  = now.getHours() * 60 + now.getMinutes();

  // ── Sticky header row (outside scroll) ──
  let hdr = `<div id="cal-header-row" style="display:flex;flex-shrink:0;border-bottom:2px solid var(--md-outline-variant);background:var(--md-surface-container-lowest)">`;
  hdr += `<div style="width:${TIME_W}px;flex-shrink:0;height:${HEADER_H}px;border-right:2px solid var(--md-outline-variant)"></div>`;
  visible.forEach((cal, i) => {
    const isLast = i === visible.length - 1;
    hdr += `<div style="width:${COL_W}px;flex-shrink:0;height:${HEADER_H}px;background:${cal.color}18;
                         border-bottom:3px solid ${cal.color};border-right:${isLast?'none':'2px solid rgba(0,0,0,0.12)'};
                         display:flex;align-items:center;justify-content:center;gap:5px;padding:0 8px">
      <div style="width:10px;height:10px;border-radius:50%;background:${cal.color};flex-shrink:0"></div>
      <span style="font-size:13px;font-family:var(--font-headline);font-weight:700;color:var(--md-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cal.name}</span>
    </div>`;
  });
  hdr += `</div>`;

  // ── Scrollable body ──
  let body = `<div id="cal-grid-body" style="display:flex;flex:1;overflow:auto;min-width:${TIME_W + COL_W * visible.length}px">`;

  // Time column — labels only, no horizontal slot lines (those live in the tech columns)
  body += `<div style="width:${TIME_W}px;flex-shrink:0;position:sticky;left:0;z-index:3;background:var(--md-surface-container-lowest);border-right:2px solid var(--md-outline-variant)">`;
  for (let s = 0; s < SLOTS; s++) {
    const h = Math.floor((START_HOUR * 60 + s * SLOT_MINS) / 60);
    const m = (START_HOUR * 60 + s * SLOT_MINS) % 60;
    const isHour = m === 0;
    const label = isHour ? `${h>12?h-12:(h===0?12:h)} ${h>=12?'PM':'AM'}` : (SLOT_MINS<=15&&m===30?`${h>12?h-12:(h===0?12:h)}:30`:'');
    // No border-top on time column slots — horizontal lines only appear inside tech columns
    body += `<div style="height:${SLOT_H}px;display:flex;align-items:flex-start;padding:${isHour?'3px':'1px'} 8px 0">
      ${label?`<span style="font-size:10px;font-family:var(--font-body);font-weight:${isHour?'600':'400'};color:var(--md-on-surface-variant);white-space:nowrap;margin-top:-6px">${label}</span>`:''}
    </div>`;
  }
  body += '</div>';

  // Tech columns
  visible.forEach((cal, colIdx) => {
    const events = _calEvents[cal.id] || [];
    const isLast  = colIdx === visible.length - 1;
    const isFirst = colIdx === 0;
    // First column gets a left border to visually separate from the time gutter
    // Last column has no right border
    const leftBorder  = isFirst ? 'border-left:2px solid rgba(0,0,0,0.12);' : '';
    const rightBorder = isLast  ? '' : 'border-right:2px solid rgba(0,0,0,0.12);';
    body += `<div style="width:${COL_W}px;flex-shrink:0;position:relative;${leftBorder}${rightBorder}min-height:${SLOTS*SLOT_H}px">`;
    body += `<div style="position:relative;height:${SLOTS*SLOT_H}px">`;

    // Slot lines
    for (let s = 0; s < SLOTS; s++) {
      const isHour = s % (60/SLOT_MINS) === 0;
      const h = START_HOUR + Math.floor(s * SLOT_MINS / 60);
      const m = (s * SLOT_MINS) % 60;
      body += `<div style="position:absolute;left:0;right:0;top:${s*SLOT_H}px;height:${SLOT_H}px;
                            border-top:${isHour?'1.5px solid rgba(0,0,0,0.12)':'1px solid rgba(0,0,0,0.05)'};cursor:pointer"
        onclick="calSlotClick('${cal.id}',${h},${m})"></div>`;
    }

    // Current time line
    if (isToday) {
      const lineTop = ((nowMin - START_HOUR*60) / SLOT_MINS) * SLOT_H;
      if (lineTop >= 0 && lineTop <= SLOTS*SLOT_H) {
        body += `<div style="position:absolute;left:0;right:0;top:${lineTop}px;height:0;border-top:2px dashed #e53935;z-index:5;pointer-events:none">
          ${colIdx===0?`<div style="position:absolute;left:-3px;top:-5px;width:10px;height:10px;border-radius:50%;background:#e53935"></div>`:''}
        </div>`;
      }
    }

    // Events
    const SVC_GROUPS = [
      {ids:['fullset','fill','dip'],color:'#7b1fa2'},
      {ids:['pedicure','kidpedicure'],color:'#0277bd'},
      {ids:['manicure','polishchange','kidmani'],color:'#00695c'},
      {ids:['wax'],color:'#e65100'},
    ];
    events.forEach(ev => {
      if (!ev.start) return;
      const startDt = new Date(ev.start.dateTime||ev.start.date);
      const endDt   = new Date(ev.end?.dateTime||ev.end?.date||startDt.getTime()+3600000);
      const sMin = startDt.getHours()*60+startDt.getMinutes();
      const eMin = endDt.getHours()*60+endDt.getMinutes();
      const topMin = sMin - START_HOUR*60;
      const durMin = Math.max(eMin-sMin,15);
      if (topMin < 0 || topMin >= (END_HOUR-START_HOUR)*60) return;
      const top = (topMin/SLOT_MINS)*SLOT_H;
      const ht  = (durMin/SLOT_MINS)*SLOT_H;
      const timeStr = startDt.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      const title = ev.summary||'';
      const desc  = ev.description||'';
      const hasPhone = /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(desc);
      const knownSvcs = SERVICES.some(s=>title.toLowerCase().includes(s.label.toLowerCase())||desc.toLowerCase().includes(s.label.toLowerCase()));
      const isAppt = hasPhone||knownSvcs;
      const isPast = startDt < now;
      const fn = title.split(/[\s—–-]/)[0].toLowerCase();
      const qm = queue.find(q=>q.name&&q.name.toLowerCase().startsWith(fn)&&fn.length>1);
      const qs = qm?.status||null;
      let bg,border,tc='#1a1a1a',sl='';
      if (!isAppt){bg='#eceff1';border='#78909c';tc='#37474f';}
      else if(qs==='done'){bg='#f3f4f6';border='#9ca3af';tc='#6b7280';sl='✓ Done';}
      else if(qs==='inservice'){bg='#dcfce7';border='#16a34a';tc='#14532d';sl='● In Service';}
      else if(qs==='waiting'){bg='#dbeafe';border='#2563eb';tc='#1e3a8a';sl='● Checked In';}
      else if(isPast&&isAppt){bg='#fff7ed';border='#ea580c';tc='#7c2d12';sl='⚠ Not Checked In';}
      else{bg='#eff6ff';border='#3b82f6';tc='#1e3a8a';}
      const chips = SERVICES.filter(s=>title.toLowerCase().includes(s.label.toLowerCase())||desc.toLowerCase().includes(s.label.toLowerCase())).map(s=>{
        const g=SVC_GROUPS.find(x=>x.ids.some(id=>s.id.toLowerCase().includes(id)));
        return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g?.color||'#455a64'};margin-right:2px;flex-shrink:0"></span>`;
      }).join('');
      // Escape all chars unsafe in single-quoted onclick: backslash, quote, newline
      const _e = s => (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/\n/g,' ').replace(/\r/g,'');
      const safeId    = _e(ev.id);
      const safeCalId = _e(cal.id);
      const safeTitle = _e(title||'Event');
      const safeDesc  = _e(desc);
      body += `<div onclick="calEventClick(event,'${safeCalId}','${safeId}','${safeTitle}','${safeDesc}',${isAppt})"
        style="position:absolute;left:5px;right:5px;top:${top}px;height:${Math.max(ht,26)}px;
               background:${bg};border-left:3px solid ${border};border-radius:6px;
               padding:3px 6px;cursor:pointer;overflow:hidden;z-index:1;box-shadow:0 1px 3px rgba(0,0,0,0.12)">
        <div style="display:flex;align-items:center;gap:2px;overflow:hidden">${chips}
          <span style="font-size:11px;font-family:var(--font-body);font-weight:700;color:${tc};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">${title||'Event'}</span>
        </div>
        ${ht>30?`<div style="font-size:10px;color:${tc};opacity:0.75">${timeStr}</div>`:''}
        ${sl&&ht>44?`<div style="font-size:9px;font-weight:700;color:${border}">${sl}</div>`:''}
        ${ht>62&&desc&&!sl?`<div style="font-size:9px;color:${tc};opacity:0.6;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${desc.replace(/\n/g,' · ')}</div>`:''}
      </div>`;
    });
    body += '</div></div>';
  });
  body += '</div>';

  grid.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;min-height:0">${hdr}${body}</div>`;

  // Scroll to 1 hour before current time (or start of day if early morning)
  const gb = document.getElementById('cal-grid-body');
  if (gb) {
    const scrollToHour = Math.max(START_HOUR, now.getHours() - 1);
    gb.scrollTop = Math.max(0, (scrollToHour - START_HOUR) * (60 / SLOT_MINS) * SLOT_H - 10);
  }
}

// ── Calendar Hours Setting ────────────────────────
function saveCalHours() {
  const start = parseInt(document.getElementById('cal-hour-start')?.value || '6');
  const end   = parseInt(document.getElementById('cal-hour-end')?.value   || '22');
  localStorage.setItem('muse_cal_hours', JSON.stringify({ start, end }));
  if (document.getElementById('panel-calendar')?.classList.contains('active')) {
    calRenderGrid();
  }
  showToast('Calendar hours updated ✓');
}

function initCalHoursSelectors() {
  const cfg = JSON.parse(localStorage.getItem('muse_cal_hours') || 'null');
  if (!cfg) return;
  const startSel = document.getElementById('cal-hour-start');
  const endSel   = document.getElementById('cal-hour-end');
  if (startSel) startSel.value = String(cfg.start ?? 6);
  if (endSel)   endSel.value   = String(cfg.end   ?? 22);
}


// ── Silent calendar sync ─────────────────────────
// Reloads events in background without showing loading spinner
async function calSilentSync() {
  if (!gapi?.client?.getToken()?.access_token) return;
  try {
    setCalSyncIndicator('syncing');
    const dayStart = new Date(_calDate); dayStart.setHours(0,0,0,0);
    const dayEnd   = new Date(_calDate); dayEnd.setHours(23,59,59,999);

    const newEvents = {};
    await Promise.all(_calCalendars.map(async cal => {
      try {
        const evResp = await gapi.client.calendar.events.list({
          calendarId: cal.id,
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100,
        });
        newEvents[cal.id] = evResp.result.items || [];
      } catch(e) { newEvents[cal.id] = _calEvents[cal.id] || []; }
    }));
    _calEvents = newEvents;
    // Only re-render if calendar panel is visible — no loading flash
    if (document.getElementById('panel-calendar')?.classList.contains('active')) {
      calRenderGrid();
    }
    setCalSyncIndicator('ok');
  } catch(e) {
    setCalSyncIndicator('error');
  }
}
let _calSyncTimer  = null;
let _calHidden = new Set(JSON.parse(localStorage.getItem('gcal_hidden') || '[]'));
// Calendar zoom: slot height and minutes per slot (zoom in = smaller slots, zoom out = larger)
let _calSlotH   = 52; // px per slot
let _calSlotMins = 30; // minutes per slot: 15, 30, or 60
let _calPinchDist = null; // for pinch tracking

function calHandleWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return; // only zoom on ctrl+scroll
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1; // scroll down = zoom out
  calAdjustZoom(delta);
}

let _calTouchStartDist = null;
function calTouchStart(e) {
  if (e.touches.length === 2) {
    _calTouchStartDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}
function calTouchMove(e) {
  if (e.touches.length !== 2 || !_calTouchStartDist) return;
  const dist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  if (Math.abs(dist - _calTouchStartDist) > 20) {
    calAdjustZoom(dist > _calTouchStartDist ? 1 : -1);
    _calTouchStartDist = dist;
  }
}

function calAdjustZoom(direction) {
  // direction: +1 = zoom in (more detail), -1 = zoom out (more time visible)
  const levels = [
    { slotMins: 60, slotH: 80 },  // 1 hour slots — widest view
    { slotMins: 30, slotH: 52 },  // 30 min slots — default
    { slotMins: 15, slotH: 36 },  // 15 min slots — most detail
  ];
  const current = levels.findIndex(l => l.slotMins === _calSlotMins);
  const next = Math.max(0, Math.min(levels.length - 1, current + direction));
  if (next === current) return;
  _calSlotMins = levels[next].slotMins;
  _calSlotH    = levels[next].slotH;
  calRenderGridPreserveScroll();
}
const CAL_SYNC_INTERVAL = 60000; // sync calendar every 60 seconds when tab is open

function setCalSyncIndicator(state) {
  const dot  = document.getElementById('cal-sync-dot');
  const text = document.getElementById('cal-sync-text');
  const pill = document.getElementById('cal-sync-pill');
  if (!dot) return;
  if (pill) pill.style.display = 'flex';
  const states = {
    ok:      { bg: '#2a7a4f', label: 'Calendar' },
    syncing: { bg: '#f5c870', label: null        },
    error:   { bg: '#fa746f', label: 'Cal ✗'    },
    idle:    { bg: '#adb3b5', label: 'Calendar'  },
  };
  const s = states[state] || states.idle;
  dot.style.background = s.bg;
  if (text && s.label !== null) text.textContent = s.label;
}

function startCalSync() {
  if (_calSyncTimer) return;
  setCalSyncIndicator('ok');
  // Use silent sync (no loading flash) for background refreshes
  _calSyncTimer = setInterval(() => calSilentSync(), CAL_SYNC_INTERVAL);
}

async function calForceSync() {
  setCalSyncIndicator('syncing');
  try {
    await calSilentSync();
    setCalSyncIndicator('ok');
    showToast('Calendar synced ✓');
  } catch(e) {
    setCalSyncIndicator('error');
    showToast('Calendar sync failed');
  }
}

function calUpdateDateInput() {
  const inp = document.getElementById('cal-date-input');
  if (inp) inp.value = localDateStr(_calDate);
}

function calPickDate(val) {
  if (!val) return;
  _calDate = new Date(val + 'T12:00:00'); // noon avoids timezone issues
  calUpdateDateLabel();
  calUpdateDateInput();
  calLoadAndRender();
}

// Calendar selector dropdown
function toggleCalSelector() {
  const dd = document.getElementById('cal-selector-dropdown');
  if (!dd) return;
  const isHidden = dd.classList.contains('hidden');
  if (isHidden) {
    // Reset draft to current live state each time the dropdown opens
    _calSelectorDraft = {
      order:  _calCalendars.map(c => c.id),
      hidden: new Set(_calHidden),
    };
    renderCalSelectorList();
    dd.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', function closeDD(e) {
        if (!dd.contains(e.target)) {
          dd.classList.add('hidden');
          _calSelectorDraft = null; // discard draft on outside click
          document.removeEventListener('click', closeDD);
        }
      });
    }, 10);
  } else {
    dd.classList.add('hidden');
    _calSelectorDraft = null;
  }
}

// calRenderGrid wrapper that preserves the current scroll position.
// Use for re-renders triggered by filter changes, auto-sync, column reorder —
// any case where the user didn't explicitly navigate to a new date.
function calRenderGridPreserveScroll() {
  const gb = document.getElementById('cal-grid-body');
  const saved = gb ? gb.scrollTop : null;
  calRenderGrid();
  if (saved !== null) {
    requestAnimationFrame(() => {
      const newGb = document.getElementById('cal-grid-body');
      if (newGb) newGb.scrollTop = saved;
    });
  }
}

function toggleCalCalendar(calId, show) {
  if (show) _calHidden.delete(calId); else _calHidden.add(calId);
  localStorage.setItem('gcal_hidden', JSON.stringify([..._calHidden]));
  renderCalSelectorList();
  calRenderGridPreserveScroll();
}

function calSelectAll(show) {
  if (show) _calHidden.clear(); else _calCalendars.forEach(c => _calHidden.add(c.id));
  localStorage.setItem('gcal_hidden', JSON.stringify([..._calHidden]));
  renderCalSelectorList();
  calRenderGridPreserveScroll();
}


// ── Cross-device token sharing via Sheets ──────────
// Store the token in App Config row so other devices can pick it up without signing in
async function saveTokenToSheets(token, expires) {
  try {
    await fetch(SHEETS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveConfig', config: { gcal_token: { token, expires } }, device: DEVICE_ID }),
    });
  } catch(e) { /* silent */ }
}

async function loadTokenFromSheets() {
  try {
    const res  = await fetch(`${SHEETS_PROXY}?action=loadConfig&_=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.config?.gcal_token) {
      const { token, expires } = data.config.gcal_token;
      if (Date.now() < expires - 60000) return { token, expires };
    }
  } catch(e) {}
  return null;
}

function calSlotClick(calId, hour, minute) {
  // Open new appointment modal pre-filled with time and tech
  const cal = _calCalendars.find(c => c.id === calId);
  showNewApptModal(calId, hour, minute, cal?.name);
}

function calEventClick(e, calId, eventId, title, desc, isAppt) {
  e.stopPropagation();
  const ev  = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  const cal      = _calCalendars.find(c => c.id === calId);
  const startDt  = new Date(ev.start.dateTime || ev.start.date);
  const phoneMatch = desc.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const phone    = phoneMatch ? phoneMatch[1] : '';
  const rawPhone = phone.replace(/\D/g, '');

  // Match to an existing queue entry — three levels, most to least reliable:
  // 1. calEventId — exact match, catches cross-device duplicates reliably
  // 2. Phone — matches on shared phone number
  // 3. Full name — only when neither side has phone, never first-name-only
  let queueMatch = queue.find(q => q.calEventId && q.calEventId === eventId);

  if (!queueMatch && rawPhone) {
    queueMatch = queue.find(q => {
      const qPhone = (q.phone || '').replace(/\D/g, '');
      return qPhone && qPhone === rawPhone;
    });
  }
  if (!queueMatch) {
    const fullName = title.trim().toLowerCase();
    if (fullName.length > 2) {
      queueMatch = queue.find(q =>
        q.name && q.name.trim().toLowerCase() === fullName && !(rawPhone && (q.phone||'').replace(/\D/g,''))
      );
    }
  }

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[85] flex items-center justify-center bg-on-surface/40 px-4';

  // Determine color hint
  let statusBadge = '';
  if (queueMatch?.status === 'done')      statusBadge = '<span style="color:#6b7280;font-size:11px;font-weight:700">✓ Completed</span>';
  else if (queueMatch?.status === 'inservice') statusBadge = '<span style="color:#16a34a;font-size:11px;font-weight:700">● In Service</span>';
  else if (queueMatch?.status === 'waiting')   statusBadge = '<span style="color:#2563eb;font-size:11px;font-weight:700">● Checked In</span>';
  else if (startDt < new Date() && isAppt)     statusBadge = '<span style="color:#ea580c;font-size:11px;font-weight:700">⚠ Not Checked In</span>';

  modal.innerHTML = `
    <div class="bg-surface-container-lowest rounded-2xl p-6 w-full max-w-sm shadow-2xl">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-headline font-bold text-on-surface text-lg">${title}</h3>
        <button onclick="this.closest('.fixed').remove()" class="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center">
          <span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px">close</span>
        </button>
      </div>
      <div class="space-y-1 text-sm font-body text-on-surface-variant mb-4">
        <p><span class="font-semibold text-on-surface">${cal?.name || ''}</span> · ${startDt.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</p>
        ${phone ? `<p>📞 ${phone}</p>` : ''}
        ${desc ? `<p class="text-xs opacity-75">${desc.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>` : ''}
        ${statusBadge ? `<div class="mt-1">${statusBadge}</div>` : ''}
      </div>
      <div class="space-y-2">
        ${isAppt ? `
        <button onclick="calQuickCheckin('${calId}','${eventId}'); this.closest('.fixed').remove()"
          class="${queueMatch ? 'hidden' : ''} w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined" style="font-size:16px">how_to_reg</span> Quick Check-In
        </button>
        ${queueMatch ? `
        <button onclick="this.closest('.fixed').remove(); showGroupAssignModal('${queueMatch.id}')"
          class="w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined" style="font-size:16px">assignment_ind</span> Assign & Price
        </button>` : ''}
        <button onclick="this.closest('.fixed').remove(); showEditApptModal('${calId}','${eventId}')"
          class="w-full border-2 border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors">
          Edit Appointment
        </button>` : `
        <button onclick="this.closest('.fixed').remove(); showConvertToApptModal('${calId}','${eventId}')"
          class="w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined" style="font-size:16px">event_available</span> Convert to Appointment
        </button>
        <button onclick="this.closest('.fixed').remove(); showEditApptModal('${calId}','${eventId}')"
          class="w-full border-2 border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors">
          Edit Event
        </button>`}
        ${isAppt && squareConfig ? `
        <button onclick="squarePushBooking('${calId}','${eventId}'); this.closest('.fixed').remove()"
          class="w-full border border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined" style="font-size:16px">point_of_sale</span> Sync to Square Bookings
        </button>` : ''}
        <button onclick="if(confirm('Cancel this appointment?')) { deleteAppt('${calId}','${eventId}'); this.closest('.fixed').remove(); }"
          class="w-full text-error py-2 rounded-xl font-headline font-semibold text-sm hover:bg-error/10 transition-colors">
          Cancel / Delete
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function showConvertToApptModal(calId, eventId) {
  const ev  = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  // Pre-fill the appointment modal with whatever we can glean from the event
  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const endDt   = new Date(ev.end?.dateTime || ev.end?.date || startDt.getTime() + 3600000);
  const durMins = Math.round((endDt - startDt) / 60000);
  const phone   = (ev.description||'').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/)?.[1] || '';
  const title   = ev.summary || '';

  _apptEditId = eventId;
  _apptLines  = [{ svcId: '', calId }];
  document.getElementById('appt-modal-title').textContent = 'Convert to Appointment';
  document.getElementById('appt-event-id').value  = eventId;
  document.getElementById('appt-cal-id').value    = calId;
  const convParts = title.split(' ');
  document.getElementById('appt-first').value     = convParts[0] || '';
  document.getElementById('appt-last').value      = convParts.slice(1).join(' ') || '';
  document.getElementById('appt-name').value      = title;
  document.getElementById('appt-phone').value     = phone;
  document.getElementById('appt-notes').value     = '';
  document.getElementById('appt-date').value      = localDateStr(startDt);
  document.getElementById('appt-time').value      = `${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}`;
  document.getElementById('appt-delete-btn').classList.remove('hidden');

  const durSel = document.getElementById('appt-duration');
  if (durSel) {
    const closest = [...durSel.options].reduce((a,b) => Math.abs(parseInt(b.value)-durMins) < Math.abs(parseInt(a.value)-durMins) ? b : a);
    durSel.value = closest.value;
  }
  renderApptServiceLines();
  document.getElementById('appt-modal').classList.remove('hidden');
  document.getElementById('appt-modal').style.display = 'flex';
}

function calQuickCheckin(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;

  // Guard: don't create a duplicate if this appointment is already in the queue
  // (can happen if another device checked in while this popup was open)
  const alreadyIn = queue.find(q => q.calEventId === eventId || (q.isAppointment && q.name === (ev.summary||'Guest') && q.status !== 'done'));
  if (alreadyIn) {
    showToast(`${ev.summary || 'Guest'} is already checked in`);
    return;
  }

  const cal   = _calCalendars.find(c => c.id === calId);
  const title = ev.summary || 'Guest';

  // Extract phone from description
  const phoneMatch = (ev.description || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const phone = phoneMatch ? phoneMatch[1].replace(/\D/g,'').replace(/(\d{3})(\d{3})(\d{4})/,'($1) $2-$3') : '';

  // Match services
  const svcs = SERVICES.filter(s =>
    title.toLowerCase().includes(s.label.toLowerCase()) ||
    (ev.description||'').toLowerCase().includes(s.label.toLowerCase())
  ).map(s => s.id);

  // Match tech
  const tech = STAFF.find(s => s.name.toLowerCase() === (cal?.name||'').toLowerCase());

  // Build a queue entry — store calEventId so duplicate detection works across devices
  const entry = {
    id:            Date.now() * 1000 + Math.floor(Math.random() * 1000),
    name:          title,
    phone:         phone,
    services:      svcs.length > 0 ? svcs : (SERVICES.length > 0 ? [SERVICES[0].id] : []),
    status:        'waiting',
    checkinTime:   new Date(),
    isAppointment: true,
    isNew:         true,
    skipSquare:    false,
    groupId:       null,
    calEventId:    eventId, // stored so other devices can detect this appointment is already checked in
    assignments:   tech ? [{ serviceId: svcs[0]||'', techId: tech.id, status:'waiting', cost:0, assignedAt: Date.now() }] : [],
  };

  queue.push(entry);
  saveQueueToStorage();
  pushQueueToSheets();
  exportToSheets(entry);
  // Sync customer to Square (same as kiosk + manual-add check-in paths).
  // No-op if no phone (guard in squareUpsertCustomer) or Square not configured.
  squareUpsertCustomer(entry);
  renderQueue();
  updateStats();
  renderTurns();
  showDashPanel('queue');
  showToast(`${title} added to queue from calendar ✓`);
}


// ── New / Edit Appointment Modal ───────────────────

// ── Appointment modal autocomplete (mirrors check-in acSearch) ──
function apptAcSearch(input, field) {
  if (field === 'phone') formatPhone(input);
  const val = input.value.trim().toLowerCase();
  const acId = field === 'phone' ? 'appt-ac-phone' : 'appt-ac-first';
  const acBox = document.getElementById(acId);
  if (!acBox) return;
  if (!val || val.length < 2) { acBox.classList.add('hidden'); acBox.innerHTML=''; return; }

  const matches = squareCustomers.filter(c => {
    const full  = ((c.given_name||'') + ' ' + (c.family_name||'')).toLowerCase();
    const phone = (c.phone_number||c.phone||'').replace(/\D/g,'');
    if (field === 'phone') return phone.includes(val.replace(/\D/g,'')) && val.replace(/\D/g,'').length >= 3;
    return full.startsWith(val) || (c.given_name||'').toLowerCase().startsWith(val);
  }).slice(0, 8);

  if (!matches.length) { acBox.classList.add('hidden'); return; }

  acBox.innerHTML = matches.map((c, i) => {
    const name  = [c.given_name, c.family_name].filter(Boolean).join(' ');
    const phone = c.phone_number || c.phone || '';
    return `<div class="autocomplete-item" data-ac-idx="${i}" onmousedown="apptAcFill('${name.replace(/'/g,"\\'")}','${phone.replace(/'/g,"\\'")}')">
      <span class="ac-name">${name}</span>
      ${phone ? `<span class="ac-phone">${phone}</span>` : ''}
    </div>`;
  }).join('');
  acBox.classList.remove('hidden');
  // Keyboard navigation
  const matchesCopy = matches;
  _attachAcKeyNav(input, acBox, (idx) => {
    const c = matchesCopy[idx];
    const name = [c.given_name, c.family_name].filter(Boolean).join(' ');
    apptAcFill(name, c.phone_number || c.phone || '');
  });
}

function apptAcFill(name, phone) {
  const parts = name.trim().split(' ');
  document.getElementById('appt-first').value = parts[0] || '';
  document.getElementById('appt-last').value  = parts.slice(1).join(' ') || '';
  document.getElementById('appt-phone').value = phone;
  document.getElementById('appt-name').value  = name;
  const phoneEl = document.getElementById('appt-phone');
  if (phoneEl) formatPhone(phoneEl);
  ['appt-ac-phone','appt-ac-first'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  });
}


// ── Appointment extra guests ───────────────────────
let _apptExtraGuests = []; // [{ first, last, phone }]

function apptAddGuest() {
  const idx = _apptExtraGuests.length;
  _apptExtraGuests.push({ first: '', last: '', phone: '' });
  renderApptExtraGuests();
}

function apptRemoveGuest(idx) {
  _apptExtraGuests.splice(idx, 1);
  renderApptExtraGuests();
}

function renderApptExtraGuests() {
  const container = document.getElementById('appt-extra-guests');
  if (!container) return;
  container.innerHTML = _apptExtraGuests.map((g, idx) => `
    <div class="border border-surface-container-high rounded-xl p-3 mb-2 bg-surface-container-low" data-appt-guest="${idx}">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] font-body font-semibold text-primary uppercase tracking-widest">Guest ${idx + 2}</span>
        <button type="button" onclick="apptRemoveGuest(${idx})" class="text-outline-variant hover:text-error transition-colors">
          <span class="material-symbols-outlined" style="font-size:16px">close</span>
        </button>
      </div>
      <div class="ac-input-wrap mb-2">
        <input type="tel" placeholder="Phone (optional)" autocomplete="off"
          id="appt-extra-phone-${idx}"
          oninput="apptExtraAcSearch(this,${idx},'phone')"
          class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant">
        <div id="appt-extra-ac-phone-${idx}" class="autocomplete-list hidden"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="ac-input-wrap">
          <input type="text" placeholder="First Name *" autocomplete="off"
            id="appt-extra-first-${idx}"
            oninput="apptExtraAcSearch(this,${idx},'first'); autoCapitalize(this)"
            class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant">
          <div id="appt-extra-ac-first-${idx}" class="autocomplete-list hidden"></div>
        </div>
        <input type="text" placeholder="Last Name"
          id="appt-extra-last-${idx}"
          oninput="autoCapitalize(this)"
          class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant">
      </div>
    </div>
  `).join('');
}

function apptExtraAcSearch(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const val = input.value.trim().toLowerCase();
  const acId = field === 'phone' ? `appt-extra-ac-phone-${idx}` : `appt-extra-ac-first-${idx}`;
  const acBox = document.getElementById(acId);
  if (!acBox) return;
  if (!val || val.length < 2) { acBox.classList.add('hidden'); acBox.innerHTML=''; return; }
  const matches = squareCustomers.filter(c => {
    const full  = ((c.given_name||'') + ' ' + (c.family_name||'')).toLowerCase();
    const phone = (c.phone_number||c.phone||'').replace(/\D/g,'');
    if (field === 'phone') return phone.includes(val.replace(/\D/g,'')) && val.replace(/\D/g,'').length >= 3;
    return full.startsWith(val) || (c.given_name||'').toLowerCase().startsWith(val);
  }).slice(0, 6);
  if (!matches.length) { acBox.classList.add('hidden'); return; }
  acBox.innerHTML = matches.map(c => {
    const name = [c.given_name, c.family_name].filter(Boolean).join(' ');
    const phone = c.phone_number || c.phone || '';
    return `<div class="autocomplete-item" onmousedown="apptExtraAcFill(${idx},'${name.replace(/'/g,"\\'")}','${phone.replace(/'/g,"\\'")}')">
      <span class="ac-name">${name}</span>
      ${phone ? `<span class="ac-phone">${phone}</span>` : ''}
    </div>`;
  }).join('');
  acBox.classList.remove('hidden');
}

function apptExtraAcFill(idx, name, phone) {
  const parts = name.trim().split(' ');
  const firstEl = document.getElementById(`appt-extra-first-${idx}`);
  const lastEl  = document.getElementById(`appt-extra-last-${idx}`);
  const phoneEl = document.getElementById(`appt-extra-phone-${idx}`);
  if (firstEl) firstEl.value = parts[0] || '';
  if (lastEl)  lastEl.value  = parts.slice(1).join(' ') || '';
  if (phoneEl) { phoneEl.value = phone; formatPhone(phoneEl); }
  [`appt-extra-ac-phone-${idx}`,`appt-extra-ac-first-${idx}`].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  });
}
// Each line: { svcId, calId } — one service + one tech per line
let _apptLines = []; // [{svcId, calId}]

function _buildTechOptions(selectedCalId) {
  return '<option value="">— Tech —</option>' +
    _calCalendars.map(c => `<option value="${c.id}" ${c.id === selectedCalId ? 'selected' : ''}>${c.name}</option>`).join('');
}

function _buildSvcOptions(selectedSvcId) {
  return '<option value="">— Service —</option>' +
    SERVICES.filter(s => isServiceVisibleOnDash(s.id))
      .map(s => `<option value="${s.id}" ${s.id === selectedSvcId ? 'selected' : ''}>${s.label}</option>`).join('');
}

function renderApptServiceLines() {
  const container = document.getElementById('appt-service-lines');
  if (!container) return;
  container.innerHTML = _apptLines.map((line, i) => `
    <div class="flex items-center gap-2" data-line="${i}">
      <select onchange="updateApptLine(${i},'svc',this.value)"
        class="flex-1 border-2 border-surface-container-high bg-transparent rounded-xl px-3 py-2 text-sm font-body focus:border-primary outline-none">
        ${_buildSvcOptions(line.svcId)}
      </select>
      <select onchange="updateApptLine(${i},'cal',this.value)"
        class="flex-1 border-2 border-surface-container-high bg-transparent rounded-xl px-3 py-2 text-sm font-body focus:border-primary outline-none">
        ${_buildTechOptions(line.calId)}
      </select>
      <button type="button" onclick="removeApptLine(${i})"
        class="w-8 h-8 rounded-xl text-outline hover:text-error hover:bg-error/10 flex items-center justify-center transition-colors flex-shrink-0">
        <span class="material-symbols-outlined" style="font-size:18px">remove</span>
      </button>
    </div>`).join('');
}

function addApptServiceLine(svcId, calId) {
  _apptLines.push({ svcId: svcId || '', calId: calId || '' });
  renderApptServiceLines();
}

function removeApptLine(i) {
  _apptLines.splice(i, 1);
  if (_apptLines.length === 0) addApptServiceLine();
  else renderApptServiceLines();
}

function updateApptLine(i, field, val) {
  if (field === 'svc') _apptLines[i].svcId = val;
  else _apptLines[i].calId = val;
}

function showNewApptModal(calId, hour, minute, techName) {
  _apptEditId     = null;
  _apptLines      = [];
  _apptExtraGuests = [];
  const eg = document.getElementById('appt-extra-guests');
  if (eg) eg.innerHTML = '';
  document.getElementById('appt-modal-title').textContent = 'New Appointment';
  document.getElementById('appt-event-id').value  = '';
  document.getElementById('appt-cal-id').value    = calId || '';
  document.getElementById('appt-name').value      = '';
  document.getElementById('appt-first').value     = '';
  document.getElementById('appt-last').value      = '';
  document.getElementById('appt-phone').value     = '';
  document.getElementById('appt-notes').value     = '';
  document.getElementById('appt-delete-btn').classList.add('hidden');

  const d = new Date(_calDate);
  document.getElementById('appt-date').value = localDateStr(d);
  document.getElementById('appt-time').value =
    `${String(hour ?? 9).padStart(2,'0')}:${String(minute ?? 0).padStart(2,'0')}`;

  // Start with one service line pre-filled with the clicked tech
  const matchedCal = _calCalendars.find(c => c.name === techName);
  addApptServiceLine('', matchedCal?.id || calId || '');

  document.getElementById('appt-modal').classList.remove('hidden');
  document.getElementById('appt-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('appt-phone').focus(), 100);
}

function showEditApptModal(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  _apptEditId = eventId;

  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const endDt   = new Date(ev.end?.dateTime   || ev.end?.date || startDt.getTime() + 3600000);
  const durMins = Math.round((endDt - startDt) / 60000);

  document.getElementById('appt-modal-title').textContent = 'Edit Appointment';
  document.getElementById('appt-event-id').value  = eventId;
  document.getElementById('appt-cal-id').value    = calId;
  const evNameParts = (ev.summary || '').split(' ');
  document.getElementById('appt-first').value     = evNameParts[0] || '';
  document.getElementById('appt-last').value      = evNameParts.slice(1).join(' ') || '';
  document.getElementById('appt-name').value      = ev.summary || '';
  document.getElementById('appt-notes').value     = (ev.description||'').replace(/\([^)]*\)\s*/g,'').replace(/\d{3}[\s.-]\d{3}[\s.-]\d{4}/g,'').trim();
  document.getElementById('appt-date').value      = localDateStr(startDt);
  document.getElementById('appt-time').value      = `${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}`;
  document.getElementById('appt-delete-btn').classList.remove('hidden');

  const durSel = document.getElementById('appt-duration');
  const closestOpt = [...durSel.options].reduce((a,b) =>
    Math.abs(parseInt(b.value)-durMins) < Math.abs(parseInt(a.value)-durMins) ? b : a);
  durSel.value = closestOpt.value;

  const phoneMatch = (ev.description||'').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  document.getElementById('appt-phone').value = phoneMatch ? phoneMatch[1] : '';

  // Parse service lines from description: "Pedicure (Lyn)\nFill (Lee)"
  _apptLines = [];
  const desc = ev.description || '';
  const linePattern = /(.+?)\s*\(([^)]+)\)/g;
  let match;
  while ((match = linePattern.exec(desc)) !== null) {
    const svcLabel = match[1].trim();
    const techName = match[2].trim();
    const svc = SERVICES.find(s => s.label.toLowerCase() === svcLabel.toLowerCase());
    const cal = _calCalendars.find(c => c.name.toLowerCase() === techName.toLowerCase()) ||
                _calCalendars.find(c => c.id === calId);
    if (svc || cal) _apptLines.push({ svcId: svc?.id || '', calId: cal?.id || calId });
  }
  if (_apptLines.length === 0) _apptLines.push({ svcId: '', calId });
  renderApptServiceLines();

  document.getElementById('appt-modal').classList.remove('hidden');
  document.getElementById('appt-modal').style.display = 'flex';
}

function closeApptModal() {
  document.getElementById('appt-modal').classList.add('hidden');
  document.getElementById('appt-modal').style.display = '';
  _apptEditId = null;
  _apptExtraGuests = [];
  const eg = document.getElementById('appt-extra-guests');
  if (eg) eg.innerHTML = '';
}

async function saveAppt() {
  const first   = document.getElementById('appt-first')?.value.trim() || '';
  const last    = document.getElementById('appt-last')?.value.trim()  || '';
  const name    = [first, last].filter(Boolean).join(' ') || document.getElementById('appt-name')?.value.trim() || '';
  const phone   = document.getElementById('appt-phone').value.trim();
  const dateVal = document.getElementById('appt-date').value;
  const timeVal = document.getElementById('appt-time').value;
  const durMins = parseInt(document.getElementById('appt-duration').value) || 60;
  const notes   = document.getElementById('appt-notes').value.trim();

  if (!name)    { showToast('Enter a customer name'); return; }
  if (!dateVal) { showToast('Select a date'); return; }

  // Read current line values from DOM
  document.querySelectorAll('#appt-service-lines [data-line]').forEach((row, i) => {
    const selects = row.querySelectorAll('select');
    if (_apptLines[i]) {
      _apptLines[i].svcId = selects[0]?.value || '';
      _apptLines[i].calId = selects[1]?.value || '';
    }
  });

  // Need at least one line with a tech
  const linesWithTech = _apptLines.filter(l => l.calId);
  if (linesWithTech.length === 0) { showToast('Select at least one technician'); return; }

  // Primary calendar = first line's tech
  const primaryCalId = linesWithTech[0].calId;

  const startDt = new Date(`${dateVal}T${timeVal || '09:00'}`);
  const endDt   = new Date(startDt.getTime() + durMins * 60000);

  // Build description: "Pedicure (Lyn)\nFill (Lee)\n(323) 555-1234\nnotes"
  const lineParts = _apptLines
    .filter(l => l.svcId || l.calId)
    .map(l => {
      const svcLabel  = SERVICES.find(s=>s.id===l.svcId)?.label || '';
      const techName  = _calCalendars.find(c=>c.id===l.calId)?.name || '';
      if (svcLabel && techName) return `${svcLabel} (${techName})`;
      if (svcLabel) return svcLabel;
      if (techName) return `(${techName})`;
      return '';
    }).filter(Boolean);

  const descParts = [...lineParts];
  if (phone) descParts.push(phone);
  if (notes) descParts.push(notes);

  // Build title: "Name — Pedicure, Fill"
  const svcTitles = _apptLines.filter(l=>l.svcId).map(l=>SERVICES.find(s=>s.id===l.svcId)?.label).filter(Boolean);
  const summary   = svcTitles.length > 0 ? `${name} — ${svcTitles.join(', ')}` : name;

  const eventBody = {
    summary,
    description: descParts.join('\n'),
    start: { dateTime: startDt.toISOString() },
    end:   { dateTime: endDt.toISOString()   },
  };

  try {
    showToast('Saving…');
    const apptCalId = _apptEditId
      ? document.getElementById('appt-cal-id').value
      : primaryCalId;

    if (_apptEditId) {
      await gapi.client.calendar.events.update({ calendarId: apptCalId, eventId: _apptEditId, resource: eventBody });
    } else {
      // Create one event per tech calendar for the primary guest
      const uniqueCals = [...new Set(linesWithTech.map(l=>l.calId))];
      await Promise.all(uniqueCals.map(cid =>
        gapi.client.calendar.events.insert({ calendarId: cid, resource: eventBody })
      ));

      // Create additional calendar events for extra guests (one per guest, on the primary tech's calendar)
      for (const g of _apptExtraGuests) {
        const gFirst = document.getElementById(`appt-extra-first-${_apptExtraGuests.indexOf(g)}`)?.value.trim() || g.first;
        const gLast  = document.getElementById(`appt-extra-last-${_apptExtraGuests.indexOf(g)}`)?.value.trim() || g.last;
        const gPhone = document.getElementById(`appt-extra-phone-${_apptExtraGuests.indexOf(g)}`)?.value.trim() || g.phone;
        const gName  = [gFirst, gLast].filter(Boolean).join(' ');
        if (!gFirst) continue;
        const gEventBody = {
          summary:     gName,
          description: [gPhone, notes].filter(Boolean).join('\n'),
          start: { dateTime: startDt.toISOString() },
          end:   { dateTime: endDt.toISOString() },
        };
        await gapi.client.calendar.events.insert({ calendarId: primaryCalId, resource: gEventBody });
      }
    }
    closeApptModal();
    await calLoadAndRender();
    showToast('Appointment saved ✓');
  } catch(err) {
    showToast('Save failed: ' + (err.result?.error?.message || 'Unknown error'));
  }
}


// ── Calendar column reorder ───────────────────────
let _calOrder = JSON.parse(localStorage.getItem('gcal_order') || 'null');

function applyCalOrder() {
  if (!_calOrder || _calOrder.length === 0) return;
  const ordered = [];
  _calOrder.forEach(id => {
    const c = _calCalendars.find(x => x.id === id);
    if (c) ordered.push(c);
  });
  // Append any new calendars not in saved order
  _calCalendars.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
  _calCalendars = ordered;
}

function saveCalOrder() {
  _calOrder = _calCalendars.map(c => c.id);
  localStorage.setItem('gcal_order', JSON.stringify(_calOrder));
}

// Drag-to-reorder calendar columns via the selector dropdown
function renderCalSelectorList() {
  const list = document.getElementById('cal-selector-list');
  if (!list || _calCalendars.length === 0) return;

  // Initialize draft from current live state if not already open
  if (!_calSelectorDraft) {
    _calSelectorDraft = {
      order:  _calCalendars.map(c => c.id),
      hidden: new Set(_calHidden),
    };
  }

  // Build display order from draft
  const draftCals = _calSelectorDraft.order
    .map(id => _calCalendars.find(c => c.id === id))
    .filter(Boolean);

  list.innerHTML = draftCals.map((c, i) => {
    const isHidden = _calSelectorDraft.hidden.has(c.id);
    return `
    <div class="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-surface-container cursor-pointer select-none"
         draggable="true" data-cal-idx="${i}"
         ondragstart="calDraftDragStart(event,${i})"
         ondragover="calDraftDragOver(event)"
         ondrop="calDraftDrop(event,${i})">
      <span class="material-symbols-outlined" style="font-size:14px;flex-shrink:0;color:#6b7280;cursor:grab">drag_indicator</span>
      <div style="width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
      <span class="flex-grow text-sm font-body text-on-surface" onclick="calDraftToggle('${c.id}')">${c.name}</span>
      <div onclick="calDraftToggle('${c.id}')"
           style="width:20px;height:20px;border-radius:5px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;
                  border:2.5px solid ${isHidden?'#9ca3af':'#1a5252'};
                  background:${isHidden?'#ffffff':'#1a5252'}">
        ${!isHidden?'<span class="material-symbols-outlined" style="font-size:13px;color:#ffffff;font-variation-settings:\'FILL\' 1;line-height:1">check</span>':''}
      </div>
    </div>`;
  }).join('');

  // Count visible in draft
  const visCount = draftCals.filter(c => !_calSelectorDraft.hidden.has(c.id)).length;
  const lbl = document.getElementById('cal-selector-label');
  if (lbl) lbl.textContent = visCount === _calCalendars.length ? 'Calendars' : `${visCount}/${_calCalendars.length}`;
}

// Toggle visibility of a calendar in the draft (does not apply live)
function calDraftToggle(calId) {
  if (!_calSelectorDraft) return;
  if (_calSelectorDraft.hidden.has(calId)) _calSelectorDraft.hidden.delete(calId);
  else _calSelectorDraft.hidden.add(calId);
  renderCalSelectorList();
}

// Apply draft to live state and close dropdown
function calSelectorSave() {
  if (!_calSelectorDraft) return;
  // Apply order
  const ordered = [];
  _calSelectorDraft.order.forEach(id => {
    const c = _calCalendars.find(x => x.id === id);
    if (c) ordered.push(c);
  });
  _calCalendars.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
  _calCalendars = ordered;
  saveCalOrder();
  // Apply visibility
  _calHidden = new Set(_calSelectorDraft.hidden);
  localStorage.setItem('gcal_hidden', JSON.stringify([..._calHidden]));
  // Reset draft
  _calSelectorDraft = null;
  // Close dropdown
  const dd = document.getElementById('cal-selector-dropdown');
  if (dd) { dd.classList.add('hidden'); dd.style.display = ''; }
  renderCalSelectorList();
  calRenderGridPreserveScroll();
  const visCount = _calCalendars.filter(c => !_calHidden.has(c.id)).length;
  const lbl = document.getElementById('cal-selector-label');
  if (lbl) lbl.textContent = visCount === _calCalendars.length ? 'Calendars' : `${visCount}/${_calCalendars.length}`;
}

// Discard draft without applying
function calSelectorCancel() {
  _calSelectorDraft = null;
  const dd = document.getElementById('cal-selector-dropdown');
  if (dd) { dd.classList.add('hidden'); dd.style.display = ''; }
  renderCalSelectorList();
}

// Select/deselect all in the draft
function calDraftSelectAll(show) {
  if (!_calSelectorDraft) return;
  if (show) _calSelectorDraft.hidden.clear();
  else _calCalendars.forEach(c => _calSelectorDraft.hidden.add(c.id));
  renderCalSelectorList();
}
// Drag handlers for the draft (reorder within draft only)
function calDraftDragStart(e, i) { _calDragIdx = i; e.dataTransfer.effectAllowed = 'move'; }
function calDraftDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function calDraftDrop(e, targetIdx) {
  e.preventDefault();
  if (_calDragIdx === null || _calDragIdx === targetIdx || !_calSelectorDraft) return;
  const moved = _calSelectorDraft.order.splice(_calDragIdx, 1)[0];
  _calSelectorDraft.order.splice(targetIdx, 0, moved);
  _calDragIdx = null;
  renderCalSelectorList();
}

async function deleteAppt(calIdParam, eventIdParam) {
  const calId   = calIdParam   || document.getElementById('appt-cal-id')?.value;
  const eventId = eventIdParam || document.getElementById('appt-event-id')?.value;
  if (!calId || !eventId) return;
  // Only show confirm when called from the edit modal (no direct params passed).
  // Calendar popup already shows its own confirm inline before calling this.
  if (!calIdParam && !confirm('Cancel this appointment?')) return;
  try {
    await gapi.client.calendar.events.delete({ calendarId: calId, eventId: eventId });
    if (!calIdParam) closeApptModal();
    await calLoadAndRender();
    showToast('Appointment cancelled');
  } catch(err) {
    showToast('Delete failed: ' + (err.result?.error?.message || 'Unknown error'));
  }
}


