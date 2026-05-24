// ── Google Calendar + Tasks ─────────────────────────────────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, localDateStr, formatPhone, byName } from '../utils.js';
import { customerDirectory, squareCustomers, squareUpsertCustomer } from './square-customers.js';
import { squarePushBooking } from './square-pos.js';

const GCAL_CLIENT_ID = '174518644579-5vgt7vvllm2ekpk0gb8l4sa4f3va9r9l.apps.googleusercontent.com';
const GCAL_SCOPES    = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
const GCAL_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const GTASK_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest';

const cfg = () => getState().config;
const queue = () => getState().queue;

let _calGapiLoaded = false, _calGisLoaded = false, _calTokenClient = null, _calRefreshTimer = null;
let _calDate = new Date(), _calCalendars = [], _calEvents = {};
let _apptEditId = null, _apptLines = [], _apptExtraGuests = [], _apptEditGroupId = '';
let _calSyncTimer = null, _calSelectorDraft = null, _calDragIdx = null;
let _calSlotH = 52, _calSlotMins = 30, _calTouchStartDist = null;
let _calHidden = new Set(JSON.parse(localStorage.getItem('gcal_hidden') || '[]'));
let _calOrder = JSON.parse(localStorage.getItem('gcal_order') || 'null');
const CAL_SYNC_INTERVAL = 60000;

// Exposed for square-pos.squarePushBooking (via window.calEventsFor in main.js).
export function getCalEvents(calId) { return _calEvents[calId] || []; }

// ── Script loading + auth ─────────────────────────
// Proactively refresh the Google token ~5 min before it expires (silent, no
// prompt) so the calendar stays connected — no 401, no manual reconnect.
function scheduleCalTokenRefresh(expires) {
  clearTimeout(_calRefreshTimer);
  const delay = Math.max(10000, expires - Date.now() - 5 * 60 * 1000);
  _calRefreshTimer = setTimeout(() => { if (_calTokenClient) _calTokenClient.requestAccessToken({ prompt: '' }); }, delay);
}
export function loadGCalScripts() {
  if (document.getElementById('gapi-script')) return;
  const s1 = document.createElement('script'); s1.id = 'gapi-script'; s1.src = 'https://apis.google.com/js/api.js';
  s1.onload = () => gapi.load('client', async () => { await gapi.client.init({ discoveryDocs: [GCAL_DISCOVERY, GTASK_DISCOVERY] }); _calGapiLoaded = true; _calTryReady(); });
  document.head.appendChild(s1);
  const s2 = document.createElement('script'); s2.id = 'gis-script'; s2.src = 'https://accounts.google.com/gsi/client';
  s2.onload = () => {
    _calTokenClient = google.accounts.oauth2.initTokenClient({ client_id: GCAL_CLIENT_ID, scope: GCAL_SCOPES, callback: (resp) => {
      if (resp.error) { calSetStatus('Sign-in failed: ' + resp.error); return; }
      const expires = Date.now() + (resp.expires_in * 1000);
      localStorage.setItem('gcal_token', JSON.stringify({ token: resp.access_token, expires }));
      dispatch('config.set', { key: 'gcal_token', value: { token: resp.access_token, expires } });
      gapi.client.setToken({ access_token: resp.access_token });
      scheduleCalTokenRefresh(expires);
      document.getElementById('cal-signin-btn')?.classList.add('hidden');
      calSetStatus(''); startCalSync(); calLoadAndRender(); loadTaskLists();
    } });
    _calGisLoaded = true; _calTryReady();
  };
  document.head.appendChild(s2);
}

function _useToken(saved) {
  gapi.client.setToken({ access_token: saved.token });
  scheduleCalTokenRefresh(saved.expires);
  document.getElementById('cal-signin-btn')?.classList.add('hidden');
  calSetStatus(''); startCalSync(); calLoadAndRender(); loadTaskLists();
}
function _calTryReady() {
  if (!_calGapiLoaded || !_calGisLoaded) return;
  const local = localStorage.getItem('gcal_token');
  if (local) { try { const s = JSON.parse(local); if (Date.now() < s.expires - 60000) { _useToken(s); return; } } catch (e) {} }
  // Token shared via the DO (another device signed in)
  const shared = cfg().gcal_token;
  if (shared && Date.now() < shared.expires - 60000) { localStorage.setItem('gcal_token', JSON.stringify(shared)); _useToken(shared); return; }
  document.getElementById('cal-signin-btn')?.classList.remove('hidden');
  calSetStatus('Click "Connect Google Calendar" to get started');
}

export function initCalendar() { _calDate = new Date(); calUpdateDateLabel(); loadGCalScripts(); }
export function calSignIn(silent) { if (!_calTokenClient) { showToast('Still loading — try again in a moment'); return; } _calTokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' }); }
export function calSignOut() {
  const token = gapi.client.getToken();
  if (token) google.accounts.oauth2.revoke(token.access_token, () => {});
  gapi.client.setToken(null); localStorage.removeItem('gcal_token');
  _calCalendars = []; _calEvents = {};
  document.getElementById('cal-grid').classList.add('hidden');
  document.getElementById('cal-loading').classList.remove('hidden');
  document.getElementById('cal-signin-btn')?.classList.remove('hidden');
  calSetStatus('Signed out. Click Connect to sign back in.');
}
function calSetStatus(msg) {
  const el = document.getElementById('cal-status-msg'), loading = document.getElementById('cal-loading');
  if (!el || !loading) return;
  if (msg) { el.textContent = msg; loading.classList.remove('hidden'); document.getElementById('cal-grid').classList.add('hidden'); }
  else loading.classList.add('hidden');
}

// ── Date nav ──────────────────────────────────────
function calUpdateDateLabel() { const el = document.getElementById('cal-date-label'); if (el) el.textContent = _calDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }); calUpdateDateInput(); }
function calUpdateDateInput() { const inp = document.getElementById('cal-date-input'); if (inp) inp.value = localDateStr(_calDate); }
export function calNavDay(delta) { _calDate = new Date(_calDate); _calDate.setDate(_calDate.getDate() + delta); calUpdateDateLabel(); calLoadAndRender(); }
export function calGoToday() { _calDate = new Date(); calUpdateDateLabel(); calLoadAndRender(); }
export function calPickDate(val) { if (!val) return; _calDate = new Date(val + 'T12:00:00'); calUpdateDateLabel(); calLoadAndRender(); }

export async function calLoadAndRender(silent) {
  if (!silent) calSetStatus('Loading calendars…');
  try {
    const calListResp = await gapi.client.calendar.calendarList.list({ minAccessRole: 'owner' });
    const items = calListResp.result.items || [];
    const systemNames = ['contacts','holiday','birthday','other calendar','united states'];
    _calCalendars = items.filter(c => { const name = (c.summary||'').toLowerCase(); return !systemNames.some(s => name.includes(s)) && c.id !== 'primary'; }).map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor || '#1a5252' }));
    if (_calCalendars.length === 0) { const p = items.find(c => c.id === 'primary' || c.primary); if (p) _calCalendars = [{ id: p.id, name: 'Primary', color: '#1a5252' }]; }
    const dayStart = new Date(_calDate); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(_calDate); dayEnd.setHours(23,59,59,999);
    applyCalOrder();
    _calEvents = {};
    await Promise.all(_calCalendars.map(async cal => { try { const r = await gapi.client.calendar.events.list({ calendarId: cal.id, timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 }); _calEvents[cal.id] = r.result.items || []; } catch (e) { _calEvents[cal.id] = []; } }));
    const gbBefore = document.getElementById('cal-grid-body'); const savedScroll = gbBefore ? gbBefore.scrollTop : null;
    calRenderGrid();
    if (savedScroll !== null) requestAnimationFrame(() => { const gb = document.getElementById('cal-grid-body'); if (gb) gb.scrollTop = savedScroll; });
    renderCalSelectorList(); calUpdateDateInput();
  } catch (err) {
    if (err.status === 401) { localStorage.removeItem('gcal_token'); calSetStatus('Session expired — reconnecting…'); calSignIn(true); document.getElementById('cal-signin-btn')?.classList.remove('hidden'); }
    else calSetStatus('Error loading calendar: ' + (err.result?.error?.message || err.message || 'Unknown error'));
  }
}

export function calRenderGrid() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const visible = _calCalendars.filter(c => !_calHidden.has(c.id));
  if (_calCalendars.length === 0) { calSetStatus('No technician calendars found.'); return; }
  if (visible.length === 0) { calSetStatus('All calendars hidden. Use Calendars filter.'); document.getElementById('cal-loading').classList.remove('hidden'); grid.classList.add('hidden'); return; }
  calSetStatus(''); document.getElementById('cal-loading').classList.add('hidden'); grid.classList.remove('hidden');

  const c = JSON.parse(localStorage.getItem('muse_cal_hours') || 'null');
  const START_HOUR = c?.start ?? 6, END_HOUR = c?.end ?? 22, SLOT_MINS = _calSlotMins || 30;
  const SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MINS), SLOT_H = _calSlotH || 52, HEADER_H = 48, TIME_W = 64;
  const tasksPanelEl = document.getElementById('cal-tasks-panel');
  const tasksPanelW = (!_tasksMinimized && tasksPanelEl?.style.display !== 'none') ? 280 : 44;
  const COL_W = Math.max(120, Math.floor((window.innerWidth - TIME_W - tasksPanelW - 48) / visible.length));
  const now = new Date(), isToday = now.toDateString() === _calDate.toDateString(), nowMin = now.getHours()*60 + now.getMinutes();

  let hdr = `<div id="cal-header-row" style="display:flex;flex-shrink:0;border-bottom:2px solid var(--md-outline-variant);background:var(--md-surface-container-lowest)"><div style="width:${TIME_W}px;flex-shrink:0;height:${HEADER_H}px;border-right:2px solid var(--md-outline-variant)"></div>`;
  visible.forEach((cal,i) => { const isLast = i === visible.length-1; hdr += `<div style="width:${COL_W}px;flex-shrink:0;height:${HEADER_H}px;background:${cal.color}18;border-bottom:3px solid ${cal.color};border-right:${isLast?'none':'2px solid rgba(0,0,0,0.12)'};display:flex;align-items:center;justify-content:center;gap:5px;padding:0 8px"><div style="width:10px;height:10px;border-radius:50%;background:${cal.color};flex-shrink:0"></div><span style="font-size:13px;font-family:var(--font-headline);font-weight:700;color:var(--md-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cal.name}</span></div>`; });
  hdr += `</div>`;

  let body = `<div id="cal-grid-body" style="display:flex;flex:1;overflow:auto;min-width:${TIME_W + COL_W*visible.length}px"><div style="width:${TIME_W}px;flex-shrink:0;position:sticky;left:0;z-index:3;background:var(--md-surface-container-lowest);border-right:2px solid var(--md-outline-variant)">`;
  for (let s = 0; s < SLOTS; s++) { const h = Math.floor((START_HOUR*60 + s*SLOT_MINS)/60), m = (START_HOUR*60 + s*SLOT_MINS)%60, isHour = m === 0; const label = isHour ? `${h>12?h-12:(h===0?12:h)} ${h>=12?'PM':'AM'}` : (SLOT_MINS<=15&&m===30?`${h>12?h-12:(h===0?12:h)}:30`:''); body += `<div style="height:${SLOT_H}px;display:flex;align-items:flex-start;padding:${isHour?'3px':'1px'} 8px 0">${label?`<span style="font-size:10px;font-family:var(--font-body);font-weight:${isHour?'600':'400'};color:var(--md-on-surface-variant);white-space:nowrap;margin-top:-6px">${label}</span>`:''}</div>`; }
  body += '</div>';

  const SVC_GROUPS = [{ids:['fullset','fill','dip'],color:'#7b1fa2'},{ids:['pedicure','kidpedicure'],color:'#0277bd'},{ids:['manicure','polishchange','kidmani'],color:'#00695c'},{ids:['wax'],color:'#e65100'}];
  visible.forEach((cal,colIdx) => {
    const events = _calEvents[cal.id] || [], isLast = colIdx === visible.length-1, isFirst = colIdx === 0;
    body += `<div style="width:${COL_W}px;flex-shrink:0;position:relative;${isFirst?'border-left:2px solid rgba(0,0,0,0.12);':''}${isLast?'':'border-right:2px solid rgba(0,0,0,0.12);'}min-height:${SLOTS*SLOT_H}px"><div style="position:relative;height:${SLOTS*SLOT_H}px">`;
    for (let s = 0; s < SLOTS; s++) { const isHour = s % (60/SLOT_MINS) === 0; const h = START_HOUR + Math.floor(s*SLOT_MINS/60), m = (s*SLOT_MINS)%60; body += `<div style="position:absolute;left:0;right:0;top:${s*SLOT_H}px;height:${SLOT_H}px;border-top:${isHour?'1.5px solid rgba(0,0,0,0.12)':'1px solid rgba(0,0,0,0.05)'};cursor:pointer" onclick="calSlotClick('${cal.id}',${h},${m})"></div>`; }
    if (isToday) { const lineTop = ((nowMin - START_HOUR*60)/SLOT_MINS)*SLOT_H; if (lineTop >= 0 && lineTop <= SLOTS*SLOT_H) body += `<div style="position:absolute;left:0;right:0;top:${lineTop}px;height:0;border-top:2px dashed #e53935;z-index:5;pointer-events:none">${colIdx===0?`<div style="position:absolute;left:-3px;top:-5px;width:10px;height:10px;border-radius:50%;background:#e53935"></div>`:''}</div>`; }
    // Group this column's events into bookings so a party checked in together (or
    // one guest with several services) renders as ONE bubble. Overlapping same-time
    // bubbles stacking on top of each other was the "piled-up / unreadable" bug.
    // Key = shared museGroupId, else the event's own id for a solo appointment.
    const bookings = new Map();
    events.forEach(ev => { if (!ev.start) return; const k = ev.extendedProperties?.private?.museGroupId || ('solo:' + ev.id); if (!bookings.has(k)) bookings.set(k, []); bookings.get(k).push(ev); });
    const _e = s => (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/\n/g,' ').replace(/\r/g,'');
    const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    bookings.forEach(evs => {
      const first = evs[0];
      const startDt = new Date(first.start.dateTime||first.start.date), endDt = new Date(first.end?.dateTime||first.end?.date||startDt.getTime()+3600000);
      const sMin = startDt.getHours()*60+startDt.getMinutes(), eMin = endDt.getHours()*60+endDt.getMinutes();
      const topMin = sMin - START_HOUR*60, durMin = Math.max(eMin-sMin,15);
      if (topMin < 0 || topMin >= (END_HOUR-START_HOUR)*60) return;
      const top = (topMin/SLOT_MINS)*SLOT_H, ht = (durMin/SLOT_MINS)*SLOT_H;
      const timeStr = startDt.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      const primaryEv = evs.find(e => (e.extendedProperties?.private||{}).musePrimary === '1') || first;
      const ppriv = primaryEv.extendedProperties?.private || {};
      const primaryName = ppriv.musePrimaryName || ppriv.museName || (primaryEv.summary||'').split(' — ')[0] || 'Guest';
      const primaryPhone = ppriv.musePrimaryPhone || _apptPhone(primaryEv);
      const notes = _apptNotes(first), confirmed = evs.some(e => (e.extendedProperties?.private||{}).museConfirmed === '1'), isPast = startDt < now;
      // Appointment-ness + a queue match from ANY event in the booking. Match a queue
      // entry only by the check-in link or exact phone — never by loose name prefix.
      let isAppt = false, qm = null;
      for (const ev of evs) {
        const ext = ev.extendedProperties?.private || {}, d = ev.description || '', t = ev.summary || '';
        if (!!ext.musePhone || /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(d) || cfg().services.some(s => t.toLowerCase().includes(s.label.toLowerCase())) || ext.museLines !== undefined) isAppt = true;
        if (!qm) { const evPhone = _apptPhone(ev).replace(/\D/g,''); qm = queue().find(x => x.calEventId && String(x.calEventId) === String(ev.id)) || (evPhone ? queue().find(x => (x.phone||'').replace(/\D/g,'') === evPhone) : null); }
      }
      const qs = qm?.status || null;
      // One row per service in THIS column: "FirstName — Service".
      const svcRows = [];
      evs.forEach(ev => {
        const ext = ev.extendedProperties?.private || {};
        const person = ext.museName || (ev.summary||'').split(' — ')[0] || '';
        const fn = (person.split(' ')[0] || person).trim();
        const lines = _parseApptLines(ev, cal.id).filter(l => !l.calId || l.calId === cal.id);
        if (lines.length === 0 && ext.museLines === undefined) { cfg().services.filter(s => (ev.summary||'').toLowerCase().includes(s.label.toLowerCase())).forEach(s => svcRows.push({ fn, label: s.label, svcId: s.id })); return; }
        lines.forEach(l => { const s = cfg().services.find(x => x.id === l.svcId); svcRows.push({ fn, label: s?.label || l.svcId || '', svcId: l.svcId || '' }); });
      });
      const dotColors = [...new Set(svcRows.map(r => (SVC_GROUPS.find(x => x.ids.some(id => (r.svcId||'').toLowerCase().includes(id)))||{}).color || '#455a64'))].slice(0,6);
      const chips = dotColors.map(c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:2px;flex-shrink:0"></span>`).join('');
      let bg, border, tc = '#1a1a1a';   // status is conveyed by the bubble's color
      if (!isAppt) { bg='#eceff1'; border='#78909c'; tc='#37474f'; }
      else if (qs==='paid' || qs==='done') { bg='#f3f4f6'; border='#9ca3af'; tc='#6b7280'; }
      else if (qs==='complete') { bg='#e0f2fe'; border='#0284c7'; tc='#0c4a6e'; }
      else if (qs==='inservice') { bg='#dcfce7'; border='#16a34a'; tc='#14532d'; }
      else if (qs==='waiting') { bg='#dbeafe'; border='#2563eb'; tc='#1e3a8a'; }
      else if (isPast && isAppt) { bg='#fff7ed'; border='#ea580c'; tc='#7c2d12'; }
      else { bg=cal.color+'1f'; border=cal.color; tc='#1a1a1a'; }   // upcoming appt → tinted by this tech's color
      const phoneLine = [timeStr, primaryPhone].filter(Boolean).join('  ·  ');
      const svcHtml = svcRows.map(r => `<div style="font-size:10px;color:${tc};opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35">${escHtml(r.fn)}${r.fn&&r.label?' — ':''}${escHtml(r.label)}</div>`).join('');
      body += `<div onclick="calEventClick(event,'${_e(cal.id)}','${_e(primaryEv.id)}','${_e(primaryName)}','${_e(notes)}',${isAppt})" style="position:absolute;left:5px;right:5px;top:${top}px;height:${Math.max(ht,26)}px;background:${bg};border-left:3px solid ${border};border-radius:6px;padding:3px 6px;cursor:pointer;overflow:hidden;z-index:1;box-shadow:0 1px 3px rgba(0,0,0,0.12)">`
        + `<div style="display:flex;align-items:center;gap:2px;overflow:hidden;line-height:1.25">${chips}${confirmed?'<span title="Confirmed" style="color:#16a34a;font-weight:800;flex-shrink:0">✓</span>':''}<span style="font-size:11px;font-family:var(--font-body);font-weight:700;color:${tc};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">${escHtml(primaryName)}</span></div>`
        + (ht>30?`<div style="font-size:10px;color:${tc};opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(phoneLine)}</div>`:'')
        + (ht>44?svcHtml:'')
        + (notes&&ht>44?`<div style="font-size:9px;color:${tc};opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📝 ${escHtml(notes.split('\n')[0])}</div>`:'')
        + `</div>`;
    });
    body += '</div></div>';
  });
  body += '</div>';
  grid.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;min-height:0">${hdr}${body}</div>`;
  const gb = document.getElementById('cal-grid-body');
  if (gb) { const scrollToHour = Math.max(START_HOUR, now.getHours()-1); gb.scrollTop = Math.max(0, (scrollToHour-START_HOUR)*(60/SLOT_MINS)*SLOT_H - 10); }
}
function calRenderGridPreserveScroll() { const gb = document.getElementById('cal-grid-body'); const saved = gb ? gb.scrollTop : null; calRenderGrid(); if (saved !== null) requestAnimationFrame(() => { const n = document.getElementById('cal-grid-body'); if (n) n.scrollTop = saved; }); }

// ── Sync ──────────────────────────────────────────
async function calSilentSync() {
  if (!gapi?.client?.getToken()?.access_token) return;
  try {
    setCalSyncIndicator('syncing');
    const dayStart = new Date(_calDate); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(_calDate); dayEnd.setHours(23,59,59,999);
    const newEvents = {};
    await Promise.all(_calCalendars.map(async cal => { try { const r = await gapi.client.calendar.events.list({ calendarId: cal.id, timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 }); newEvents[cal.id] = r.result.items || []; } catch (e) { newEvents[cal.id] = _calEvents[cal.id] || []; } }));
    _calEvents = newEvents;
    // Preserve the user's scroll position on a silent refresh — calRenderGrid()
    // re-scrolls to ~1hr-before-now, which yanked the view away mid-use.
    if (document.getElementById('panel-calendar')?.classList.contains('active')) calRenderGridPreserveScroll();
    setCalSyncIndicator('ok');
  } catch (e) { setCalSyncIndicator('error'); }
}
function startCalSync() { if (_calSyncTimer) return; setCalSyncIndicator('ok'); _calSyncTimer = setInterval(() => calSilentSync(), CAL_SYNC_INTERVAL); }
export async function calForceSync() { setCalSyncIndicator('syncing'); try { await calSilentSync(); setCalSyncIndicator('ok'); showToast('Calendar synced ✓'); } catch (e) { setCalSyncIndicator('error'); showToast('Calendar sync failed'); } }
function setCalSyncIndicator(state) {
  const dot = document.getElementById('cal-sync-dot'), text = document.getElementById('cal-sync-text'), pill = document.getElementById('cal-sync-pill');
  if (!dot) return; if (pill) pill.style.display = 'flex';
  const states = { ok:{bg:'#2a7a4f',label:'Calendar'}, syncing:{bg:'#f5c870',label:null}, error:{bg:'#fa746f',label:'Cal ✗'}, idle:{bg:'#adb3b5',label:'Calendar'} };
  const s = states[state] || states.idle; dot.style.background = s.bg; if (text && s.label !== null) text.textContent = s.label;
}

// ── Zoom (ctrl+wheel / pinch) ─────────────────────
export function calHandleWheel(e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); calAdjustZoom(e.deltaY > 0 ? -1 : 1); }
export function calTouchStart(e) { if (e.touches.length === 2) _calTouchStartDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
export function calTouchMove(e) { if (e.touches.length !== 2 || !_calTouchStartDist) return; const dist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); if (Math.abs(dist-_calTouchStartDist) > 20) { calAdjustZoom(dist > _calTouchStartDist ? 1 : -1); _calTouchStartDist = dist; } }
function calAdjustZoom(direction) {
  const levels = [{slotMins:60,slotH:80},{slotMins:30,slotH:52},{slotMins:15,slotH:36}];
  const cur = levels.findIndex(l => l.slotMins === _calSlotMins);
  const next = Math.max(0, Math.min(levels.length-1, cur+direction));
  if (next === cur) return; _calSlotMins = levels[next].slotMins; _calSlotH = levels[next].slotH; calRenderGridPreserveScroll();
}

// ── Calendar selector (show/hide + reorder) ───────
export function toggleCalSelector() {
  const dd = document.getElementById('cal-selector-dropdown'); if (!dd) return;
  if (dd.classList.contains('hidden')) {
    _calSelectorDraft = { order: _calCalendars.map(c => c.id), hidden: new Set(_calHidden) };
    renderCalSelectorList(); dd.classList.remove('hidden');
    // Stop clicks INSIDE the dropdown from reaching the outside-click closer below.
    // (Toggling a row re-renders the list, detaching the clicked node, which would
    // otherwise fool `dd.contains(e.target)` into thinking the click was outside.)
    dd.onclick = (e) => e.stopPropagation();
    setTimeout(() => document.addEventListener('click', function closeDD(e) { if (!dd.contains(e.target)) { dd.classList.add('hidden'); _calSelectorDraft = null; document.removeEventListener('click', closeDD); } }), 10);
  } else { dd.classList.add('hidden'); _calSelectorDraft = null; }
}
function applyCalOrder() {
  if (!_calOrder || _calOrder.length === 0) return;
  const ordered = []; _calOrder.forEach(id => { const c = _calCalendars.find(x => x.id === id); if (c) ordered.push(c); });
  _calCalendars.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
  _calCalendars = ordered;
}
function saveCalOrder() { _calOrder = _calCalendars.map(c => c.id); localStorage.setItem('gcal_order', JSON.stringify(_calOrder)); }
export function renderCalSelectorList() {
  const list = document.getElementById('cal-selector-list');
  if (!list || _calCalendars.length === 0) return;
  if (!_calSelectorDraft) _calSelectorDraft = { order: _calCalendars.map(c => c.id), hidden: new Set(_calHidden) };
  const draftCals = _calSelectorDraft.order.map(id => _calCalendars.find(c => c.id === id)).filter(Boolean);
  list.innerHTML = draftCals.map((c,i) => { const isHidden = _calSelectorDraft.hidden.has(c.id); return `<div class="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-surface-container cursor-pointer select-none" data-cal-idx="${i}"><span onpointerdown="calReorderStart(event,${i})" class="material-symbols-outlined" style="font-size:14px;flex-shrink:0;color:#6b7280;cursor:grab;touch-action:none">drag_indicator</span><div style="width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0"></div><span class="flex-grow text-sm font-body text-on-surface" onclick="calDraftToggle('${c.id}')">${c.name}</span><div onclick="calDraftToggle('${c.id}')" style="width:20px;height:20px;border-radius:5px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;border:2.5px solid ${isHidden?'#9ca3af':'#1a5252'};background:${isHidden?'#fff':'#1a5252'}">${!isHidden?'<span class="material-symbols-outlined" style="font-size:13px;color:#fff;font-variation-settings:\'FILL\' 1;line-height:1">check</span>':''}</div></div>`; }).join('');
  const visCount = draftCals.filter(c => !_calSelectorDraft.hidden.has(c.id)).length;
  const lbl = document.getElementById('cal-selector-label'); if (lbl) lbl.textContent = visCount === _calCalendars.length ? 'Calendars' : `${visCount}/${_calCalendars.length}`;
}
export function calDraftToggle(calId) { if (!_calSelectorDraft) return; if (_calSelectorDraft.hidden.has(calId)) _calSelectorDraft.hidden.delete(calId); else _calSelectorDraft.hidden.add(calId); renderCalSelectorList(); }
export function calSelectorSave() {
  if (!_calSelectorDraft) return;
  const ordered = []; _calSelectorDraft.order.forEach(id => { const c = _calCalendars.find(x => x.id === id); if (c) ordered.push(c); });
  _calCalendars.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
  _calCalendars = ordered; saveCalOrder();
  _calHidden = new Set(_calSelectorDraft.hidden); localStorage.setItem('gcal_hidden', JSON.stringify([..._calHidden]));
  _calSelectorDraft = null;
  const dd = document.getElementById('cal-selector-dropdown'); if (dd) { dd.classList.add('hidden'); dd.style.display = ''; }
  renderCalSelectorList(); calRenderGridPreserveScroll();
}
export function calSelectorCancel() { _calSelectorDraft = null; const dd = document.getElementById('cal-selector-dropdown'); if (dd) { dd.classList.add('hidden'); dd.style.display = ''; } renderCalSelectorList(); }
export function calDraftSelectAll(show) { if (!_calSelectorDraft) return; if (show) _calSelectorDraft.hidden.clear(); else _calCalendars.forEach(c => _calSelectorDraft.hidden.add(c.id)); renderCalSelectorList(); }
// Pointer-based reorder (HTML5 drag-and-drop doesn't work on iOS touch).
function clearCalDropMarks() { document.querySelectorAll('#cal-selector-list [data-cal-idx]').forEach(r => { r.style.borderTop = ''; }); }
let _calReorderList = null;
function calRowAt(y) { const rows = _calReorderList ? [..._calReorderList.querySelectorAll('[data-cal-idx]')] : []; return rows.find(r => { const rc = r.getBoundingClientRect(); return y >= rc.top && y <= rc.bottom; }) || null; }
export function calReorderStart(e, i) {
  e.preventDefault(); e.stopPropagation();
  _calDragIdx = i; _calReorderList = document.getElementById('cal-selector-list');
  document.addEventListener('pointermove', calReorderMove);
  document.addEventListener('pointerup', calReorderEnd, { once: true });
}
function calReorderMove(e) {
  e.preventDefault(); clearCalDropMarks();
  const row = calRowAt(e.clientY);
  if (row && Number(row.dataset.calIdx) !== _calDragIdx) row.style.borderTop = '3px solid #1a5252';
}
function calReorderEnd(e) {
  document.removeEventListener('pointermove', calReorderMove);
  clearCalDropMarks();
  const row = calRowAt(e.clientY);
  if (row && _calSelectorDraft && _calDragIdx !== null) {
    const target = Number(row.dataset.calIdx);
    if (!isNaN(target) && target !== _calDragIdx) {
      const moved = _calSelectorDraft.order.splice(_calDragIdx, 1)[0];
      _calSelectorDraft.order.splice(target, 0, moved);
      renderCalSelectorList();
    }
  }
  _calDragIdx = null; _calReorderList = null;
}

// ── Event click + quick check-in ─────────────────
export function calSlotClick(calId, hour, minute) { showNewApptModal(calId, hour, minute, _calCalendars.find(c => c.id === calId)?.name); }
export function calEventClick(e, calId, eventId, title, desc, isAppt) {
  e.stopPropagation();
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  const cal = _calCalendars.find(c => c.id === calId);
  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const phone = _apptPhone(ev), rawPhone = phone.replace(/\D/g, ''), notes = _apptNotes(ev);
  const confirmed = ev.extendedProperties?.private?.museConfirmed === '1';
  let queueMatch = queue().find(x => x.calEventId && x.calEventId === eventId);
  if (!queueMatch && rawPhone) queueMatch = queue().find(x => { const p = (x.phone||'').replace(/\D/g,''); return p && p === rawPhone; });
  if (!queueMatch) { const fullName = title.trim().toLowerCase(); if (fullName.length > 2) queueMatch = queue().find(x => x.name && x.name.trim().toLowerCase() === fullName && !(rawPhone && (x.phone||'').replace(/\D/g,''))); }
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[85] flex items-center justify-center bg-on-surface/40 px-4';
  let statusBadge = '';
  if (['complete','paid','done'].includes(queueMatch?.status)) statusBadge = '<span style="color:#6b7280;font-size:11px;font-weight:700">✓ Completed</span>';
  else if (queueMatch?.status === 'inservice') statusBadge = '<span style="color:#16a34a;font-size:11px;font-weight:700">● In Service</span>';
  else if (queueMatch?.status === 'waiting') statusBadge = '<span style="color:#2563eb;font-size:11px;font-weight:700">● Checked In</span>';
  else if (startDt < new Date() && isAppt) statusBadge = '<span style="color:#ea580c;font-size:11px;font-weight:700">⚠ Not Checked In</span>';
  const confirmBadge = confirmed ? '<span style="color:#16a34a;font-size:11px;font-weight:700">✓ Confirmed</span>' : '';
  modal.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl p-6 w-full max-w-sm shadow-2xl">
    <div class="flex items-center justify-between mb-3"><h3 class="font-headline font-bold text-on-surface text-lg">${title}</h3><button onclick="this.closest('.fixed').remove()" class="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center"><span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px">close</span></button></div>
    <div class="space-y-1 text-sm font-body text-on-surface-variant mb-4"><p><span class="font-semibold text-on-surface">${cal?.name||''}</span> · ${startDt.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</p>${phone?`<p>📞 ${phone}</p>`:''}${notes?`<p class="text-xs opacity-75">${notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`:''}${(statusBadge||confirmBadge)?`<div class="mt-1 flex items-center gap-2 flex-wrap">${statusBadge}${confirmBadge}</div>`:''}</div>
    <div class="space-y-2">
      ${isAppt ? `<button onclick="calQuickCheckin('${calId}','${eventId}'); this.closest('.fixed').remove()" class="${queueMatch?'hidden':''} w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:16px">how_to_reg</span> Quick Check-In</button>
      ${queueMatch?`<button onclick="this.closest('.fixed').remove(); showGroupAssignModal('${queueMatch.id}')" class="w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:16px">assignment_ind</span> Assign & Price</button>`:''}
      <button onclick="calToggleConfirmed('${calId}','${eventId}'); this.closest('.fixed').remove()" class="w-full ${confirmed?'bg-secondary-container text-on-secondary-container':'border-2 border-primary text-primary hover:bg-primary/10'} py-2.5 rounded-xl font-headline font-bold text-sm transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:16px">${confirmed?'event_available':'check_circle'}</span> ${confirmed?'Confirmed — tap to undo':'Mark Confirmed'}</button>
      <button onclick="this.closest('.fixed').remove(); showEditApptModal('${calId}','${eventId}')" class="w-full border-2 border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors">Edit Appointment</button>` : `
      <button onclick="this.closest('.fixed').remove(); showConvertToApptModal('${calId}','${eventId}')" class="w-full bg-primary text-on-primary py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-primary-dim transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:16px">event_available</span> Convert to Appointment</button>
      <button onclick="this.closest('.fixed').remove(); showEditApptModal('${calId}','${eventId}')" class="w-full border-2 border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors">Edit Event</button>`}
      ${isAppt && cfg().square_config ? `<button onclick="squarePushBooking('${calId}','${eventId}'); this.closest('.fixed').remove()" class="w-full border border-outline-variant text-on-surface py-2.5 rounded-xl font-headline font-semibold text-sm hover:bg-surface-container transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:16px">point_of_sale</span> Sync to Square Bookings</button>` : ''}
      <button onclick="if(confirm('Cancel this appointment?')) { deleteAppt('${calId}','${eventId}'); this.closest('.fixed').remove(); }" class="w-full text-error py-2 rounded-xl font-headline font-semibold text-sm hover:bg-error/10 transition-colors">Cancel / Delete</button>
    </div></div>`;
  document.body.appendChild(modal);
}

// Toggle the "confirmed" flag on an appointment (stored in extendedProperties so it
// syncs through Google Calendar; shown as a ✓ on the bubble + popup).
export async function calToggleConfirmed(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  const nowConfirmed = ev.extendedProperties?.private?.museConfirmed === '1';
  try {
    showToast('Saving…');
    await gapi.client.calendar.events.patch({ calendarId: calId, eventId, resource: { extendedProperties: { private: { museConfirmed: nowConfirmed ? null : '1' } } } });
    showToast(nowConfirmed ? 'Marked unconfirmed' : 'Appointment confirmed ✓');
    await calLoadAndRender(true);
  } catch (err) { showToast('Update failed: ' + (err.result?.error?.message || 'Unknown error')); }
}

// Build a queue entry from one calendar event (returns null if that person is
// already checked in). queueGroupId links party members in the queue.
function _buildCheckinEntry(ev, fallbackCalId, queueGroupId) {
  const title = ev.extendedProperties?.private?.museName || (ev.summary||'').split(' — ')[0] || 'Guest';
  const already = queue().find(x => x.calEventId === ev.id || (x.isAppointment && x.name === title && x.status !== 'paid' && x.status !== 'done'));
  if (already) return null;
  const rawP = _apptPhone(ev).replace(/\D/g,'');
  const phone = rawP ? rawP.replace(/^1?(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3') : '';
  const lines = _parseApptLines(ev, fallbackCalId);   // [{ svcId, calId }] — per-service tech is the line's calendar
  let svcs = lines.map(l => l.svcId).filter(Boolean);
  if (svcs.length === 0) svcs = cfg().services.filter(s => title.toLowerCase().includes(s.label.toLowerCase())).map(s => s.id);
  // Map a service line's calendar → the staff member (calendars are named per tech).
  const techForCal = cid => { const nm = (_calCalendars.find(c => c.id === cid)?.name || '').trim().toLowerCase(); return nm ? cfg().staff.find(s => (s.name||'').trim().toLowerCase() === nm) : null; };
  const now = Date.now();
  // Preserve EVERY booked service + its assigned tech (was: only svcs[0] with the event-calendar tech).
  let assignments = lines.filter(l => l.svcId).map(l => { const t = techForCal(l.calId || fallbackCalId); return { serviceId: l.svcId, techId: t?.id || '', station: '', status: 'waiting', cost: 0, assignedAt: now }; });
  if (assignments.length === 0 && svcs.length) { const t = techForCal(fallbackCalId); assignments = svcs.map(sid => ({ serviceId: sid, techId: t?.id || '', station: '', status: 'waiting', cost: 0, assignedAt: now })); }
  return { id: Date.now()*1000 + Math.floor(Math.random()*1000), name: title, phone, services: svcs.length > 0 ? svcs : (cfg().services.length > 0 ? [cfg().services[0].id] : []), status: 'waiting', checkinTime: new Date().toISOString(), isAppointment: true, isNew: true, skipSquare: false, groupId: queueGroupId, calEventId: ev.id, assignments };
}
export function calQuickCheckin(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) return;
  const groupId = ev.extendedProperties?.private?.museGroupId || '';
  // Gather the whole party: every event sharing the group id (across calendars),
  // deduped to one per person; a solo/legacy event is just itself.
  let party;   // [{ ev, calId }]
  if (groupId) {
    const seen = new Set(); party = [];
    Object.entries(_calEvents).forEach(([cid, list]) => (list||[]).forEach(e => {
      if ((e.extendedProperties?.private?.museGroupId||'') !== groupId) return;
      const nm = e.extendedProperties?.private?.museName || (e.summary||'').split(' — ')[0] || 'Guest';
      if (seen.has(nm)) return; seen.add(nm); party.push({ ev: e, calId: cid });
    }));
  } else {
    party = [{ ev, calId }];
  }
  const queueGroupId = party.length > 1 ? 'grp_' + Date.now().toString(36) : null;
  let added = 0, firstName = '';
  party.forEach(({ ev: pe, calId: pcid }) => {
    const entry = _buildCheckinEntry(pe, pcid, queueGroupId);
    if (!entry) return;
    dispatch('queue.upsert', { entry });
    squareUpsertCustomer(entry);
    added++; if (!firstName) firstName = entry.name;
  });
  if (added === 0) { showToast('Already checked in'); return; }
  window.renderQueue?.(); window.updateStats?.(); window.renderTurns?.(); window.showDashPanel?.('queue');
  showToast(added > 1 ? `${added} guests added to queue from calendar ✓` : `${firstName} added to queue from calendar ✓`);
}

// ── Appointment modal ─────────────────────────────
export function apptAcSearch(input, field) {
  if (field === 'phone') formatPhone(input);
  const val = input.value.trim().toLowerCase();
  const acBox = document.getElementById(field === 'phone' ? 'appt-ac-phone' : 'appt-ac-first');
  if (!acBox) return;
  if (!val || val.length < 2) { acBox.classList.add('hidden'); acBox.innerHTML = ''; return; }
  const matches = squareCustomers.filter(c => { const full = ((c.given_name||'')+' '+(c.family_name||'')).toLowerCase(); const phone = (c.phone_number||c.phone||'').replace(/\D/g,''); if (field === 'phone') return phone.includes(val.replace(/\D/g,'')) && val.replace(/\D/g,'').length >= 3; return full.startsWith(val) || (c.given_name||'').toLowerCase().startsWith(val); }).slice(0, 8);
  if (!matches.length) { acBox.classList.add('hidden'); return; }
  acBox.innerHTML = matches.map(c => { const name = [c.given_name,c.family_name].filter(Boolean).join(' '), phone = c.phone_number||c.phone||''; return `<div class="autocomplete-item" onmousedown="apptAcFill('${name.replace(/'/g,"\\'")}','${phone.replace(/'/g,"\\'")}')"><span class="ac-name">${name}</span>${phone?`<span class="ac-phone">${phone}</span>`:''}</div>`; }).join('');
  acBox.classList.remove('hidden');
}
export function apptAcFill(name, phone) {
  const parts = name.trim().split(' ');
  document.getElementById('appt-first').value = parts[0] || '';
  document.getElementById('appt-last').value = parts.slice(1).join(' ') || '';
  document.getElementById('appt-phone').value = phone;
  document.getElementById('appt-name').value = name;
  const p = document.getElementById('appt-phone'); if (p) formatPhone(p);
  ['appt-ac-phone','appt-ac-first'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } });
}
// Each guest carries their OWN service lines so multi-customer bookings can assign
// a specific service+tech per person (not one shared list for the whole booking).
export function apptAddGuest() { _syncApptGuestsFromDom(); _apptExtraGuests.push({ first:'', last:'', phone:'', lines:[{ svcId:'', calId:'' }] }); renderApptExtraGuests(); }
export function apptRemoveGuest(idx) { _syncApptGuestsFromDom(); _apptExtraGuests.splice(idx,1); renderApptExtraGuests(); }
export function apptGuestAddLine(gi) { _syncApptGuestsFromDom(); if (!_apptExtraGuests[gi]) return; (_apptExtraGuests[gi].lines = _apptExtraGuests[gi].lines || []).push({ svcId:'', calId:'' }); renderApptExtraGuests(); }
export function apptGuestRemoveLine(gi, li) { _syncApptGuestsFromDom(); _apptExtraGuests[gi]?.lines?.splice(li,1); renderApptExtraGuests(); }
export function apptGuestUpdateLine(gi, li, field, val) { const l = _apptExtraGuests[gi]?.lines?.[li]; if (!l) return; if (field === 'svc') l.svcId = val; else l.calId = val; }
// Name/phone live in the DOM; pull them into the model before any re-render so
// typing guest 1 then adding guest 2 doesn't wipe guest 1 (service lines stay in
// the model already, kept current by the onchange handlers above).
function _syncApptGuestsFromDom() {
  _apptExtraGuests.forEach((g,idx) => {
    const f = document.getElementById(`appt-extra-first-${idx}`); if (f) g.first = f.value.trim();
    const l = document.getElementById(`appt-extra-last-${idx}`);  if (l) g.last  = l.value.trim();
    const p = document.getElementById(`appt-extra-phone-${idx}`); if (p) g.phone = p.value.trim();
  });
}
function _guestLinesHtml(gi) {
  const rows = (_apptExtraGuests[gi].lines || []).map((line,li) => `<div class="flex items-center gap-2">
    <select onchange="apptGuestUpdateLine(${gi},${li},'svc',this.value)" class="flex-1 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body focus:border-primary outline-none">${_buildSvcOptions(line.svcId)}</select>
    <select onchange="apptGuestUpdateLine(${gi},${li},'cal',this.value)" class="flex-1 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body focus:border-primary outline-none">${_buildTechOptions(line.calId)}</select>
    <button type="button" onclick="apptGuestRemoveLine(${gi},${li})" class="w-7 h-7 rounded-lg text-outline hover:text-error flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined" style="font-size:15px">remove</span></button>
  </div>`).join('');
  return `<div class="mt-2"><div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-1">Services &amp; Technicians</div>
    <div class="space-y-1.5">${rows}</div>
    <button type="button" onclick="apptGuestAddLine(${gi})" class="flex items-center gap-1 text-[11px] font-body font-semibold text-primary hover:text-primary-dim mt-1.5"><span class="material-symbols-outlined" style="font-size:13px">add</span> Add service</button></div>`;
}
function renderApptExtraGuests() {
  const container = document.getElementById('appt-extra-guests'); if (!container) return;
  container.innerHTML = _apptExtraGuests.map((g,idx) => `<div class="border border-surface-container-high rounded-xl p-3 mb-2 bg-surface-container-low" data-appt-guest="${idx}"><div class="flex items-center justify-between mb-2"><span class="text-[11px] font-body font-semibold text-primary uppercase tracking-widest">Guest ${idx+2}</span><button type="button" onclick="apptRemoveGuest(${idx})" class="text-outline-variant hover:text-error transition-colors"><span class="material-symbols-outlined" style="font-size:16px">close</span></button></div><div class="ac-input-wrap mb-2"><input type="tel" placeholder="Phone (optional)" autocomplete="off" value="${(g.phone||'').replace(/"/g,'&quot;')}" id="appt-extra-phone-${idx}" oninput="apptExtraAcSearch(this,${idx},'phone')" class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant"><div id="appt-extra-ac-phone-${idx}" class="autocomplete-list hidden"></div></div><div class="grid grid-cols-2 gap-2"><div class="ac-input-wrap"><input type="text" placeholder="First Name *" autocomplete="off" value="${(g.first||'').replace(/"/g,'&quot;')}" id="appt-extra-first-${idx}" oninput="apptExtraAcSearch(this,${idx},'first'); autoCapitalize(this)" class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant"><div id="appt-extra-ac-first-${idx}" class="autocomplete-list hidden"></div></div><input type="text" placeholder="Last Name" value="${(g.last||'').replace(/"/g,'&quot;')}" id="appt-extra-last-${idx}" oninput="autoCapitalize(this)" class="w-full bg-transparent border-b border-surface-container-high py-1.5 text-sm font-headline focus:border-primary transition-colors outline-none placeholder:text-outline-variant"></div>${_guestLinesHtml(idx)}</div>`).join('');
}
export function apptExtraAcSearch(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const val = input.value.trim().toLowerCase();
  const acBox = document.getElementById(field === 'phone' ? `appt-extra-ac-phone-${idx}` : `appt-extra-ac-first-${idx}`);
  if (!acBox) return;
  if (!val || val.length < 2) { acBox.classList.add('hidden'); acBox.innerHTML = ''; return; }
  const matches = squareCustomers.filter(c => { const full = ((c.given_name||'')+' '+(c.family_name||'')).toLowerCase(); const phone = (c.phone_number||c.phone||'').replace(/\D/g,''); if (field === 'phone') return phone.includes(val.replace(/\D/g,'')) && val.replace(/\D/g,'').length >= 3; return full.startsWith(val) || (c.given_name||'').toLowerCase().startsWith(val); }).slice(0, 6);
  if (!matches.length) { acBox.classList.add('hidden'); return; }
  acBox.innerHTML = matches.map(c => { const name = [c.given_name,c.family_name].filter(Boolean).join(' '), phone = c.phone_number||c.phone||''; return `<div class="autocomplete-item" onmousedown="apptExtraAcFill(${idx},'${name.replace(/'/g,"\\'")}','${phone.replace(/'/g,"\\'")}')"><span class="ac-name">${name}</span>${phone?`<span class="ac-phone">${phone}</span>`:''}</div>`; }).join('');
  acBox.classList.remove('hidden');
}
export function apptExtraAcFill(idx, name, phone) {
  const parts = name.trim().split(' ');
  const f = document.getElementById(`appt-extra-first-${idx}`), l = document.getElementById(`appt-extra-last-${idx}`), p = document.getElementById(`appt-extra-phone-${idx}`);
  if (f) f.value = parts[0] || ''; if (l) l.value = parts.slice(1).join(' ') || ''; if (p) { p.value = phone; formatPhone(p); }
  [`appt-extra-ac-phone-${idx}`,`appt-extra-ac-first-${idx}`].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } });
}
function _buildTechOptions(sel) { return '<option value="">— Tech —</option>' + [..._calCalendars].sort(byName).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}</option>`).join(''); }
function _buildSvcOptions(sel) { return '<option value="">— Service —</option>' + cfg().services.filter(s => !cfg().hidden_dash_services.includes(s.id)).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.label}</option>`).join(''); }

// ── Appointment metadata (structured in extendedProperties; description = notes) ─
// New events store service lines + phone in extendedProperties.private so the
// description is purely the user's notes. Old events fall back to parsing the
// legacy "Service (Tech)\nphone\nnotes" description.
function _apptPhone(ev) {
  const ext = ev?.extendedProperties?.private || {};
  if (ext.musePhone) return ext.musePhone;
  const m = (ev?.description || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return m ? m[1] : '';
}
function _apptNotes(ev) {
  const ext = ev?.extendedProperties?.private || {};
  if (ext.museLines !== undefined) return ev?.description || '';   // new format: description IS the notes
  return (ev?.description || '').replace(/\([^)]*\)\s*/g, '').replace(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/g, '').trim();
}
function _parseApptLines(ev, calId) {
  const ext = ev?.extendedProperties?.private || {};
  if (ext.museLines !== undefined) { try { return JSON.parse(ext.museLines) || []; } catch { return []; } }
  const lines = [], desc = ev?.description || '', re = /(.+?)\s*\(([^)]+)\)/g; let m;
  while ((m = re.exec(desc)) !== null) {
    const svcLabel = m[1].trim(), techName = m[2].trim();
    const s = cfg().services.find(x => x.label.toLowerCase() === svcLabel.toLowerCase());
    const cal = _calCalendars.find(x => x.name.toLowerCase() === techName.toLowerCase()) || _calCalendars.find(x => x.id === calId);
    if (s || cal) lines.push({ svcId: s?.id || '', calId: cal?.id || calId });
  }
  return lines;
}
export function renderApptServiceLines() {
  const container = document.getElementById('appt-service-lines'); if (!container) return;
  container.innerHTML = _apptLines.map((line,i) => `<div class="flex items-center gap-2" data-line="${i}"><select onchange="updateApptLine(${i},'svc',this.value)" class="flex-1 border-2 border-surface-container-high bg-transparent rounded-xl px-3 py-2 text-sm font-body focus:border-primary outline-none">${_buildSvcOptions(line.svcId)}</select><select onchange="updateApptLine(${i},'cal',this.value)" class="flex-1 border-2 border-surface-container-high bg-transparent rounded-xl px-3 py-2 text-sm font-body focus:border-primary outline-none">${_buildTechOptions(line.calId)}</select><button type="button" onclick="removeApptLine(${i})" class="w-8 h-8 rounded-xl text-outline hover:text-error hover:bg-error/10 flex items-center justify-center transition-colors flex-shrink-0"><span class="material-symbols-outlined" style="font-size:18px">remove</span></button></div>`).join('');
}
export function addApptServiceLine(svcId, calId) { _apptLines.push({ svcId: svcId || '', calId: calId || '' }); renderApptServiceLines(); }
export function removeApptLine(i) { _apptLines.splice(i,1); if (_apptLines.length === 0) addApptServiceLine(); else renderApptServiceLines(); }
export function updateApptLine(i, field, val) { if (field === 'svc') _apptLines[i].svcId = val; else _apptLines[i].calId = val; }

export function showNewApptModal(calId, hour, minute, techName) {
  _apptEditId = null; _apptLines = []; _apptExtraGuests = []; _apptEditGroupId = '';
  const eg = document.getElementById('appt-extra-guests'); if (eg) eg.innerHTML = '';
  document.getElementById('appt-modal-title').textContent = 'New Appointment';
  document.getElementById('appt-event-id').value = '';
  document.getElementById('appt-cal-id').value = calId || '';
  ['appt-name','appt-first','appt-last','appt-phone','appt-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('appt-delete-btn').classList.add('hidden');
  document.getElementById('appt-date').value = localDateStr(new Date(_calDate));
  document.getElementById('appt-time').value = `${String(hour ?? 9).padStart(2,'0')}:${String(minute ?? 0).padStart(2,'0')}`;
  const matchedCal = _calCalendars.find(c => c.name === techName);
  addApptServiceLine('', matchedCal?.id || calId || '');
  const m = document.getElementById('appt-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => document.getElementById('appt-phone').focus(), 100);
}
export function showConvertToApptModal(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId); if (!ev) return;
  const startDt = new Date(ev.start.dateTime || ev.start.date), endDt = new Date(ev.end?.dateTime || ev.end?.date || startDt.getTime()+3600000);
  const durMins = Math.round((endDt-startDt)/60000);
  const phone = _apptPhone(ev), title = ev.summary || '';
  _apptEditId = eventId; _apptLines = [{ svcId:'', calId }]; _apptExtraGuests = []; _apptEditGroupId = ev.extendedProperties?.private?.museGroupId || '';
  document.getElementById('appt-modal-title').textContent = 'Convert to Appointment';
  document.getElementById('appt-event-id').value = eventId; document.getElementById('appt-cal-id').value = calId;
  const parts = title.split(' ');
  document.getElementById('appt-first').value = parts[0] || ''; document.getElementById('appt-last').value = parts.slice(1).join(' ') || '';
  document.getElementById('appt-name').value = title; document.getElementById('appt-phone').value = phone; document.getElementById('appt-notes').value = '';
  document.getElementById('appt-date').value = localDateStr(startDt);
  document.getElementById('appt-time').value = `${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}`;
  document.getElementById('appt-delete-btn').classList.remove('hidden');
  const durSel = document.getElementById('appt-duration'); if (durSel) durSel.value = [...durSel.options].reduce((a,b)=>Math.abs(parseInt(b.value)-durMins)<Math.abs(parseInt(a.value)-durMins)?b:a).value;
  renderApptServiceLines();
  const m = document.getElementById('appt-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function showEditApptModal(calId, eventId) {
  const ev = (_calEvents[calId] || []).find(x => x.id === eventId); if (!ev) return;
  _apptEditId = eventId; _apptExtraGuests = []; _apptEditGroupId = ev.extendedProperties?.private?.museGroupId || '';
  const startDt = new Date(ev.start.dateTime || ev.start.date), endDt = new Date(ev.end?.dateTime || ev.end?.date || startDt.getTime()+3600000);
  const durMins = Math.round((endDt-startDt)/60000);
  document.getElementById('appt-modal-title').textContent = 'Edit Appointment';
  document.getElementById('appt-event-id').value = eventId; document.getElementById('appt-cal-id').value = calId;
  // Use the stored clean name; fall back to summary up to the " — services" separator (never the services text).
  const cleanName = ev.extendedProperties?.private?.museName || (ev.summary||'').split(' — ')[0] || '';
  const parts = cleanName.split(' ');
  document.getElementById('appt-first').value = parts[0] || ''; document.getElementById('appt-last').value = parts.slice(1).join(' ') || '';
  document.getElementById('appt-name').value = cleanName;
  document.getElementById('appt-notes').value = _apptNotes(ev);
  document.getElementById('appt-date').value = localDateStr(startDt);
  document.getElementById('appt-time').value = `${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}`;
  document.getElementById('appt-delete-btn').classList.remove('hidden');
  const durSel = document.getElementById('appt-duration'); durSel.value = [...durSel.options].reduce((a,b)=>Math.abs(parseInt(b.value)-durMins)<Math.abs(parseInt(a.value)-durMins)?b:a).value;
  document.getElementById('appt-phone').value = _apptPhone(ev);
  _apptLines = _parseApptLines(ev, calId);
  if (_apptLines.length === 0) _apptLines.push({ svcId:'', calId });
  renderApptServiceLines();
  const m = document.getElementById('appt-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeApptModal() { const m = document.getElementById('appt-modal'); m.classList.add('hidden'); m.style.display = ''; _apptEditId = null; _apptExtraGuests = []; _apptEditGroupId = ''; const eg = document.getElementById('appt-extra-guests'); if (eg) eg.innerHTML = ''; }

// Build one person's event body. museLines/museName/musePhone (per person) + a
// shared museGroupId link everyone in the booking so quick check-in can pull the
// whole party in as one group.
function _apptEventBody(person, startDt, endDt, notes, groupId, primary) {
  const svcTitles = person.lines.filter(l => l.svcId).map(l => cfg().services.find(s=>s.id===l.svcId)?.label).filter(Boolean);
  const summary = svcTitles.length > 0 ? `${person.name} — ${svcTitles.join(', ')}` : person.name;
  const museLines = person.lines.filter(l => l.svcId || l.calId).map(l => ({ svcId: l.svcId || '', calId: l.calId || '' }));
  const priv = { museLines: JSON.stringify(museLines), musePhone: person.phone || '', museName: person.name };
  if (groupId) priv.museGroupId = groupId;
  // Every event in a booking carries the primary's name/phone so the calendar can
  // render the whole party as one bubble labelled by the primary guest.
  if (primary) { priv.musePrimaryName = primary.name; priv.musePrimaryPhone = primary.phone || ''; if (primary.isPrimary) priv.musePrimary = '1'; }
  return { summary, description: notes, start: { dateTime: startDt.toISOString() }, end: { dateTime: endDt.toISOString() }, extendedProperties: { private: priv } };
}

export async function saveAppt() {
  const first = document.getElementById('appt-first')?.value.trim() || '', last = document.getElementById('appt-last')?.value.trim() || '';
  const name = [first,last].filter(Boolean).join(' ') || document.getElementById('appt-name')?.value.trim() || '';
  const phone = document.getElementById('appt-phone').value.trim(), dateVal = document.getElementById('appt-date').value, timeVal = document.getElementById('appt-time').value;
  const durMins = parseInt(document.getElementById('appt-duration').value) || 60, notes = document.getElementById('appt-notes').value.trim();
  if (!name) { showToast('Enter a customer name'); return; }
  if (!dateVal) { showToast('Select a date'); return; }
  document.querySelectorAll('#appt-service-lines [data-line]').forEach((row,i) => { const sels = row.querySelectorAll('select'); if (_apptLines[i]) { _apptLines[i].svcId = sels[0]?.value || ''; _apptLines[i].calId = sels[1]?.value || ''; } });
  _syncApptGuestsFromDom();
  const primaryLinesWithTech = _apptLines.filter(l => l.calId);
  if (primaryLinesWithTech.length === 0) { showToast('Select at least one technician'); return; }
  const startDt = new Date(`${dateVal}T${timeVal || '09:00'}`), endDt = new Date(startDt.getTime() + durMins*60000);

  // People in this booking: primary + each named guest, each with their OWN lines.
  const people = [{ name, phone, lines: _apptLines.slice() }];
  _apptExtraGuests.forEach(g => {
    const gName = [g.first, g.last].filter(Boolean).join(' ').trim();
    if (gName) people.push({ name: gName, phone: (g.phone||'').trim(), lines: (g.lines||[]).slice() });
  });

  // Shared group id: reuse the edited event's, else mint one when it's a party.
  let groupId = _apptEditGroupId || '';
  if (people.length > 1 && !groupId) groupId = 'apptgrp_' + Date.now().toString(36);
  // Where a guest with no chosen tech lands = the primary's first tech calendar.
  const bookingPrimaryCal = primaryLinesWithTech[0].calId;

  try {
    showToast('Saving…');
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const body = _apptEventBody(p, startDt, endDt, notes, groupId, { name: people[0].name, phone: people[0].phone, isPrimary: i === 0 });
      const cals = [...new Set(p.lines.filter(l => l.calId).map(l => l.calId))];
      if (i === 0 && _apptEditId) {
        // Primary on edit: update/move the existing event, then insert any extra calendars.
        const oldCalId = document.getElementById('appt-cal-id').value;
        const newPrimary = cals[0] || oldCalId;
        if (oldCalId && oldCalId !== newPrimary) {
          await gapi.client.calendar.events.insert({ calendarId: newPrimary, resource: body });
          try { await gapi.client.calendar.events.delete({ calendarId: oldCalId, eventId: _apptEditId }); } catch {}
        } else {
          await gapi.client.calendar.events.update({ calendarId: oldCalId, eventId: _apptEditId, resource: body });
        }
        for (const cid of cals) { if (cid !== newPrimary && cid !== oldCalId) await gapi.client.calendar.events.insert({ calendarId: cid, resource: body }); }
      } else {
        const finalCals = cals.length ? cals : (bookingPrimaryCal ? [bookingPrimaryCal] : []);
        for (const cid of finalCals) await gapi.client.calendar.events.insert({ calendarId: cid, resource: body });
      }
      if (p.phone) squareUpsertCustomer({ name: p.name, phone: p.phone });   // add/refresh each booked customer in Square
    }
    closeApptModal(); await calLoadAndRender(true);
    showToast(people.length > 1 ? `Appointment saved for ${people.length} guests ✓` : 'Appointment saved ✓');
  } catch (err) { showToast('Save failed: ' + (err.result?.error?.message || 'Unknown error')); }
}
export async function deleteAppt(calIdParam, eventIdParam) {
  const calId = calIdParam || document.getElementById('appt-cal-id')?.value, eventId = eventIdParam || document.getElementById('appt-event-id')?.value;
  if (!calId || !eventId) return;
  if (!calIdParam && !confirm('Cancel this appointment?')) return;
  try { await gapi.client.calendar.events.delete({ calendarId: calId, eventId }); if (!calIdParam) closeApptModal(); await calLoadAndRender(true); showToast('Appointment cancelled'); }
  catch (err) { showToast('Delete failed: ' + (err.result?.error?.message || 'Unknown error')); }
}

// ── Google Tasks ──────────────────────────────────
let _taskLists = [], _currentListId = null, _tasksMinimized = false;
export async function loadTaskLists() {
  try {
    const res = await gapi.client.tasks.tasklists.list({ maxResults: 20 });
    _taskLists = res.result.items || [];
    const sel = document.getElementById('tasks-list-select'); if (!sel) return;
    sel.innerHTML = _taskLists.map(l => `<option value="${l.id}">${l.title}</option>`).join('');
    if (_taskLists.length > 0) { _currentListId = _taskLists[0].id; loadTasksForList(_currentListId); }
    const panel = document.getElementById('cal-tasks-panel'); if (panel) { panel.classList.remove('hidden'); panel.style.display = 'flex'; }
  } catch (e) { console.warn('[Tasks] loadTaskLists failed:', e); }
}
export async function loadTasksForList(listId) {
  if (!listId) return;
  _currentListId = listId;
  const container = document.getElementById('tasks-list'); if (!container) return;
  container.innerHTML = '<div class="text-xs text-on-surface-variant text-center py-4">Loading…</div>';
  try { const res = await gapi.client.tasks.tasks.list({ tasklist: listId, showCompleted: true, showHidden: false, maxResults: 100 }); renderTasks((res.result.items || []).sort((a,b)=>(a.status==='completed'?1:0)-(b.status==='completed'?1:0))); }
  catch (e) { container.innerHTML = '<div class="text-xs text-error text-center py-4">Failed to load tasks</div>'; }
}
function renderTasks(tasks) {
  const container = document.getElementById('tasks-list'); if (!container) return;
  if (!tasks.length) { container.innerHTML = '<div class="text-xs text-on-surface-variant text-center py-6 opacity-60">No tasks — all caught up!</div>'; return; }
  container.innerHTML = tasks.map(t => { const done = t.status === 'completed', due = t.due ? new Date(t.due) : null, dueStr = due ? due.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '', overdue = due && due < new Date() && !done, lid = _currentListId;
    return `<div class="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container transition-colors group"><button onclick="toggleTask('${lid}','${t.id}','${done?'needsAction':'completed'}')" class="flex-shrink-0 transition-colors mt-0.5" style="width:16px;height:16px;min-width:16px;min-height:16px;aspect-ratio:1/1;border-radius:50%;border:2px solid ${done?'#1a5252':'#9ca3af'};background:${done?'#1a5252':'#fff'};display:flex;align-items:center;justify-content:center;padding:0;box-sizing:border-box">${done?'<span class="material-symbols-outlined text-on-primary" style="font-size:9px;line-height:1;font-variation-settings:\'FILL\' 1">check</span>':''}</button><div class="flex-1 min-w-0" style="line-height:1.3"><div class="text-xs font-body ${done?'line-through text-on-surface-variant opacity-50':'text-on-surface font-medium'}">${t.title||'(no title)'}</div>${t.notes?`<div class="text-[10px] text-on-surface-variant truncate">${t.notes}</div>`:''}${dueStr?`<div class="text-[10px] font-semibold ${overdue?'text-error':'text-on-surface-variant'}">${overdue?'⚠ ':''}${dueStr}</div>`:''}</div><button onclick="deleteTask('${lid}','${t.id}')" class="opacity-0 group-hover:opacity-100 flex-shrink-0 text-outline-variant hover:text-error transition-all mt-0.5"><span class="material-symbols-outlined" style="font-size:12px">close</span></button></div>`;
  }).join('');
}
export function toggleTasksPanel() {
  _tasksMinimized = !_tasksMinimized;
  const panel = document.getElementById('cal-tasks-panel'), btn = document.getElementById('tasks-minimize-btn'), body = document.getElementById('tasks-list'), selWrap = document.getElementById('tasks-list-select')?.parentElement;
  if (panel) { panel.style.width = _tasksMinimized ? '40px' : '260px'; panel.style.overflow = 'hidden'; if (body) body.style.display = _tasksMinimized ? 'none' : ''; if (selWrap) selWrap.style.display = _tasksMinimized ? 'none' : ''; const titleEl = panel.querySelector('.font-headline.font-bold.text-on-surface.text-sm'); if (titleEl) titleEl.style.display = _tasksMinimized ? 'none' : ''; const iconEl = panel.querySelector('.material-symbols-outlined.text-primary'); if (iconEl) iconEl.style.display = _tasksMinimized ? 'none' : ''; const addBtn = panel.querySelector('button[title="Add task"]'); if (addBtn) addBtn.style.display = _tasksMinimized ? 'none' : ''; }
  if (btn) { btn.querySelector('.material-symbols-outlined').textContent = _tasksMinimized ? 'chevron_left' : 'chevron_right'; btn.title = _tasksMinimized ? 'Show Tasks' : 'Hide Tasks'; }
}
export async function toggleTask(listId, taskId, newStatus) { try { await gapi.client.tasks.tasks.patch({ tasklist: listId, task: taskId, resource: { status: newStatus, completed: newStatus==='completed' ? new Date().toISOString() : null } }); loadTasksForList(listId); } catch (e) { showToast('Could not update task'); } }
export async function deleteTask(listId, taskId) { try { await gapi.client.tasks.tasks.delete({ tasklist: listId, task: taskId }); loadTasksForList(listId); } catch (e) { showToast('Could not delete task'); } }
export function showAddTaskModal() { const title = prompt('New task title:'); if (!title?.trim() || !_currentListId) return; gapi.client.tasks.tasks.insert({ tasklist: _currentListId, resource: { title: title.trim() } }).then(() => loadTasksForList(_currentListId)).catch(() => showToast('Could not add task')); }
