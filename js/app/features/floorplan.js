// ── Floor Plan: station grid, live assignment bubbles, drag-to-assign, layout editor ──
// Reads the same live assignments as the Turns grid, but arranged BY STATION
// (a.station) instead of by tech. The only new persisted data is the synced
// config key `station_layout` ({ stationId: {col,row} }); the station list and
// the a.station field are reused as-is. Additive — no schema change/migration.
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, todayStr, localDateStr } from '../utils.js';
import { getAssignmentStatus } from './status.js';
import { STATIONS } from './queue.js';

const cfg = () => getState().config;
const q   = () => getState().queue;
const svc = id => cfg().services.find(s => s.id === id);
const staffById = id => cfg().staff.find(s => s.id === id);

const GRID_COLS = 6;
const ROW_PX = 92, GAP_PX = 8;   // must match #floorplan-grid grid-auto-rows + gap
let floorEditMode = false;

// ── Layout (positions) ────────────────────────────
// Default auto-grid: pedicure zone (P1–P12) rows 1–2, manicure zone (M1–M15)
// rows 4–6, with row 3 left as a visual gap. config.station_layout overrides per station.
function defaultPos(stationId) {
  const list = STATIONS.filter(s => s[0] === stationId[0]);
  const idx = Math.max(0, list.indexOf(stationId));
  const baseRow = stationId[0] === 'P' ? 1 : 4;
  return { col: (idx % GRID_COLS) + 1, row: baseRow + Math.floor(idx / GRID_COLS) };
}
function layout() { return cfg().station_layout || {}; }
function posFor(id) { const p = layout()[id]; return (p && p.col && p.row) ? p : defaultPos(id); }
function saveLayout(next) { dispatch('config.set', { key: 'station_layout', value: next }); }

// ── Live assignments by station (today, active = not done) ──────────
function collectFloor() {
  const today = todayStr();
  const byStation = {};
  const unplaced = [];
  q().forEach(e => {
    if (e.status === 'done') return;
    if (localDateStr(new Date(e.checkinTime)) !== today) return;
    (e.assignments || []).forEach(a => {
      if (getAssignmentStatus(e, a) === 'done') return;
      const item = { entry: e, a };
      if (a.station && STATIONS.includes(a.station)) (byStation[a.station] ||= []).push(item);
      else unplaced.push(item);
    });
  });
  return { byStation, unplaced };
}

function bubbleHtml(item, draggable) {
  const { entry: e, a } = item;
  const tech = a.techId ? staffById(a.techId) : null;
  const s = a.serviceId ? svc(a.serviceId) : null;
  const inservice = getAssignmentStatus(e, a) === 'inservice';
  const bg = inservice ? '#c8e6c5' : '#ffe0b2';
  const fg = inservice ? '#1b5e20' : '#6d3200';
  const attrs = draggable ? `data-entry-id="${e.id}" data-svc="${a.serviceId || ''}"` : '';
  return `<div class="${draggable ? 'floor-bubble cursor-pointer' : ''} rounded-lg px-2 py-1 leading-tight" ${attrs} style="background:${bg};color:${fg};font-size:11px">
    <div class="font-semibold truncate">${e.name}</div>
    <div class="opacity-90 truncate" style="font-size:10px">${tech ? tech.name.split(' ')[0] : '—'}${s ? ' · ' + s.label : ''}${a.cost ? ' · $' + Number(a.cost).toFixed(0) : ''}</div>
  </div>`;
}

function stationCardHtml(stationId, items) {
  const p = posFor(stationId);
  const accent = stationId[0] === 'P' ? '#1a5c7a' : '#785a1a';
  const occupied = items.length > 0;
  const body = occupied
    ? items.map(it => bubbleHtml(it, !floorEditMode)).join('')
    : `<div class="text-[10px] text-outline-variant/70 flex-1 flex items-center justify-center">empty</div>`;
  return `<div class="floor-station rounded-xl border-2 flex flex-col overflow-hidden ${floorEditMode ? 'cursor-move' : ''}" data-station="${stationId}"
      style="grid-column:${p.col};grid-row:${p.row};border-color:${accent}${occupied ? '' : '40'};background:${accent}0d;min-height:0">
    <div class="px-1.5 pt-1"><span class="text-[10px] font-headline font-bold" style="color:${accent}">${stationId}</span></div>
    <div class="flex-1 flex flex-col gap-0.5 px-1 pb-1 overflow-y-auto" style="min-height:0">${body}</div>
  </div>`;
}

export function renderFloorPlan() {
  const grid = document.getElementById('floorplan-grid');
  if (!grid) return;
  const { byStation, unplaced } = collectFloor();

  const modeLabel = document.getElementById('floorplan-mode-label');
  if (modeLabel) modeLabel.textContent = floorEditMode ? 'Editing layout — drag stations to rearrange' : 'Live';
  const editBtn = document.getElementById('floorplan-edit-btn');
  if (editBtn) editBtn.innerHTML = floorEditMode
    ? '<span class="material-symbols-outlined" style="font-size:16px">check</span> Done'
    : '<span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit layout';
  document.getElementById('floorplan-reset-btn')?.classList.toggle('hidden', !floorEditMode);

  const tray = document.getElementById('floorplan-tray');
  if (tray) {
    if (floorEditMode || unplaced.length === 0) tray.innerHTML = '';
    else tray.innerHTML = `<div class="bg-surface-container rounded-xl p-2">
      <div class="text-[11px] font-body font-semibold text-on-surface-variant mb-1">Not at a station — drag onto the floor (${unplaced.length})</div>
      <div class="flex gap-1.5 flex-wrap">${unplaced.map(it => bubbleHtml(it, true)).join('')}</div></div>`;
  }

  grid.innerHTML = STATIONS.map(id => stationCardHtml(id, byStation[id] || [])).join('');
}

export function toggleFloorEdit() { floorEditMode = !floorEditMode; renderFloorPlan(); }
export function resetFloorLayout() {
  const doReset = () => { saveLayout({}); renderFloorPlan(); showToast('Floor layout reset'); };
  if (window.showWarnModal) window.showWarnModal('Reset layout?', 'Restore the default station arrangement?', doReset);
  else doReset();
}

// ── Commit helpers ────────────────────────────────
function assignBubbleToStation(entryId, svcId, stationId) {
  const e = q().find(x => String(x.id) === String(entryId));
  if (!e) return;
  const a = (e.assignments || []).find(x => String(x.serviceId) === String(svcId));
  if (!a || a.station === stationId) return;
  a.station = stationId;
  dispatch('queue.upsert', { entry: e });
  renderFloorPlan();
  showToast(`Moved to ${stationId}`);
}
function swapStations(aId, bId) {
  const pa = posFor(aId), pb = posFor(bId);
  saveLayout({ ...layout(), [aId]: { col: pb.col, row: pb.row }, [bId]: { col: pa.col, row: pa.row } });
  renderFloorPlan();
}
function placeStationAt(stationId, x, y) {
  const grid = document.getElementById('floorplan-grid');
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  const col = Math.max(1, Math.min(GRID_COLS, Math.floor((x - rect.left) / (rect.width / GRID_COLS)) + 1));
  const row = Math.max(1, Math.floor((y - rect.top) / (ROW_PX + GAP_PX)) + 1);
  const cur = posFor(stationId);
  if (cur.col === col && cur.row === row) return;
  const occupant = STATIONS.find(s => s !== stationId && posFor(s).col === col && posFor(s).row === row);
  const next = { ...layout() };
  if (occupant) next[occupant] = { col: cur.col, row: cur.row };
  next[stationId] = { col, row };
  saveLayout(next);
  renderFloorPlan();
}

// ── Drag (pointer events; tap vs drag via movement threshold) ──────
(function initFloorDrag() {
  const THRESH = 6;
  let startX = 0, startY = 0, pending = null, dragging = false, clone = null;
  let mode = null, dragEntryId = null, dragSvc = null, dragStation = null;

  const closest = (el, sel) => { while (el && el !== document.body) { if (el.matches && el.matches(sel)) return el; el = el.parentElement; } return null; };

  function stationAt(x, y) {
    if (clone) clone.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (clone) clone.style.display = '';
    return closest(el, '.floor-station');
  }
  function clearTargets() { document.querySelectorAll('.floor-station').forEach(s => { s.style.outline = ''; }); }

  function onDown(e) {
    const panel = document.getElementById('panel-floorplan');
    if (!panel || !panel.classList.contains('active') || e.button) return;
    if (floorEditMode) {
      const st = closest(e.target, '.floor-station');
      if (!st) return;
      mode = 'station'; dragStation = st.dataset.station; pending = st;
    } else {
      const b = closest(e.target, '.floor-bubble');
      if (!b) return;
      mode = 'bubble'; dragEntryId = b.dataset.entryId; dragSvc = b.dataset.svc; pending = b;
    }
    startX = e.clientX; startY = e.clientY;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function startDrag() {
    dragging = true;
    const rect = pending.getBoundingClientRect();
    clone = pending.cloneNode(true);
    Object.assign(clone.style, { position: 'fixed', zIndex: '9999', pointerEvents: 'none', width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px', opacity: '0.9', transform: 'scale(1.03)', boxShadow: '0 6px 20px rgba(0,0,0,.25)' });
    document.body.appendChild(clone);
    pending.style.opacity = '0.4';
  }
  function onMove(e) {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > THRESH) startDrag();
      else return;
    }
    e.preventDefault();
    if (clone) { clone.style.left = (e.clientX - clone.offsetWidth / 2) + 'px'; clone.style.top = (e.clientY - clone.offsetHeight / 2) + 'px'; }
    clearTargets();
    const tgt = stationAt(e.clientX, e.clientY);
    if (tgt) tgt.style.outline = '3px solid #1a5252';
  }
  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const wasDragging = dragging;
    if (clone) { clone.remove(); clone = null; }
    if (pending) pending.style.opacity = '';
    clearTargets();
    dragging = false;
    if (!wasDragging) {
      if (mode === 'bubble' && dragEntryId) window.showGroupAssignModal?.(dragEntryId);
    } else {
      const tgt = stationAt(e.clientX, e.clientY);
      if (mode === 'bubble') { if (tgt) assignBubbleToStation(dragEntryId, dragSvc, tgt.dataset.station); }
      else if (mode === 'station') {
        if (tgt && tgt.dataset.station !== dragStation) swapStations(dragStation, tgt.dataset.station);
        else placeStationAt(dragStation, e.clientX, e.clientY);
      }
    }
    pending = null; mode = null; dragEntryId = dragSvc = dragStation = null;
  }
  document.addEventListener('pointerdown', onDown);
})();
