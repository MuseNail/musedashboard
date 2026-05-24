// ── Floor Plan v2: free-positioned station canvas ───────────────────────────
// Each station is one physical seat → ONE customer. Manicure: 1 customer / 1 tech /
// up to 3 services. Pedicure: 1 customer / up to 3 techs / up to 4 services.
// The station shows that customer + their service·tech lines (sized to fit, no scroll).
// Layout is free-form (x/y/w/h per station) + per-station fill/outline/shape, saved
// additively in config.station_layout. Edit mode: move (incl. multi-select), resize,
// recolor, reshape. View mode: drag a customer onto a seat; tap a customer to open
// Assign & Price. Reuses the a.station field (set on all the customer's assignments).
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, todayStr, localDateStr, formatElapsed } from '../utils.js';
import { getAssignmentStatus, isPaidStatus, entryStatusSince } from './status.js';
import { getStations, stationDefs, stationType, stationLabel } from './queue.js';
import { getActiveTurnsOrder, getTechStatusColor } from './turns.js';

const cfg = () => getState().config;
const q   = () => getState().queue;
const svc = id => cfg().services.find(s => s.id === id);
const staffById = id => cfg().staff.find(s => s.id === id);

let floorEditMode = false;
const _selected = new Set();   // station ids selected in edit mode

const GAP = 10;
const DEF = { P: { w: 152, h: 116 }, M: { w: 108, h: 70 } };   // pedi larger (3 techs/4 svcs), mani compact (1 tech/3 svcs)
const ACCENT = { P: '#1a5c7a', M: '#785a1a' };

function containerW() { const g = document.getElementById('floorplan-grid'); return g && g.clientWidth ? g.clientWidth : 720; }

// Deterministic default layout: pedicure zone on top, manicure zone below.
function computedDefault(id) {
  const type = stationType(id), { w, h } = DEF[type], W = containerW();
  const list = stationDefs().filter(s => s.type === type).map(s => s.id);
  const idx = Math.max(0, list.indexOf(id));
  const perRow = Math.max(1, Math.floor((W + GAP) / (w + GAP)));
  const col = idx % perRow, row = Math.floor(idx / perRow);
  let y = row * (h + GAP);
  if (type === 'M') {
    const pCount = stationDefs().filter(s => s.type === 'P').length;
    const pPerRow = Math.max(1, Math.floor((W + GAP) / (DEF.P.w + GAP)));
    y += Math.ceil(pCount / pPerRow) * (DEF.P.h + GAP) + 26;
  }
  return { x: col * (w + GAP), y, w, h, fill: ACCENT[type], outline: ACCENT[type], shape: 'rounded' };
}
function layout() { return cfg().station_layout || {}; }
function layoutFor(id) { return { ...computedDefault(id), ...(layout()[id] || {}) }; }
function saveLayout(next) { dispatch('config.set', { key: 'station_layout', value: next }); }

// ── Live occupancy (one customer per station) ─────
function activeAssignments(e) { return (e.assignments || []).filter(a => !isPaidStatus(getAssignmentStatus(e, a))); }
function collectFloor() {
  const today = todayStr();
  const byStation = {};   // stationId -> entry
  const unplaced = [];
  q().forEach(e => {
    if (isPaidStatus(e.status)) return;   // paid customers leave the floor; complete stays (awaiting payment)
    if (localDateStr(new Date(e.checkinTime)) !== today) return;
    const active = activeAssignments(e);
    const stationIds = getStations();
    const at = active.find(a => a.station && stationIds.includes(a.station));
    // A customer's seat = a service's station, else the entry-level station set by dragging on the plan.
    const station = at ? at.station : (e.station && stationIds.includes(e.station) ? e.station : null);
    if (station) { if (!byStation[station]) byStation[station] = e; }
    else unplaced.push(e);   // ANY active customer not yet seated — including ones with no service/tech assigned
  });
  return { byStation, unplaced };
}
function entryInservice(e) { return activeAssignments(e).some(a => getAssignmentStatus(e, a) === 'inservice'); }
function custLines(e, stationId, fs = 1) {
  return activeAssignments(e).filter(a => a.station === stationId).map(a => {
    const s = a.serviceId ? svc(a.serviceId) : null, t = a.techId ? staffById(a.techId) : null;
    return `<div class="truncate" style="font-size:${Math.round(10 * fs)}px;color:#374151">${s ? s.label : 'Service'}${t ? ' · ' + t.name.split(' ')[0] : ''}${a.cost ? ' · $' + Number(a.cost).toFixed(0) : ''}</div>`;
  }).join('');
}

function stationHtml(id, entry) {
  const L = layoutFor(id);
  const radius = L.shape === 'circle' ? '9999px' : L.shape === 'square' ? '4px' : '14px';
  const sel = _selected.has(id);
  const fs = L.font || 1;
  const live = !!entry && (entryInservice(entry) || entry.status === 'inservice');
  const complete = !!entry && !live && entry.status === 'complete';
  // Empty (or any station while editing the layout) shows the editor's custom color.
  // In the live view, an occupied seat MATCHES the customer's status:
  // GREEN in service, BLUE complete (ready to pay), ORANGE waiting.
  const accent = ACCENT[stationType(id)];
  let bg = (L.fill || accent) + '17', border = L.outline || accent;
  if (entry && !floorEditMode) {
    if (live) { bg = '#bfe6bd'; border = '#2a7a4f'; }
    else if (complete) { bg = '#cfe3ef'; border = '#1a5c7a'; }
    else { bg = '#ffe0c2'; border = '#e8730a'; }
  }
  let content;
  if (entry) {
    content = `<div class="${floorEditMode ? '' : 'floor-bubble cursor-pointer'} h-full w-full flex flex-col justify-center px-1.5 py-1 overflow-hidden" ${floorEditMode ? '' : `data-entry-id="${entry.id}"`}>
      <div class="flex items-start justify-between gap-1">
        <div class="font-semibold" style="font-size:${Math.round(11 * fs)}px;color:#1f2937;flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.15">${entry.name}</div>
        <span class="flex-shrink-0" style="font-size:${Math.round(9 * fs)}px;color:#52606d" data-checkin-ts="${entryStatusSince(entry)}">${formatElapsed(entryStatusSince(entry))}</span>
      </div>
      <div class="overflow-hidden leading-tight">${custLines(entry, id, fs)}</div></div>`;
  } else {
    content = `<div class="h-full w-full flex items-center justify-center" style="font-size:${Math.round(12 * fs)}px;font-weight:800;color:${border};opacity:0.55">${stationLabel(id)}</div>`;
  }
  return `<div class="floor-station absolute ${floorEditMode ? 'cursor-move' : ''}" data-station="${id}"
    style="left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px;box-sizing:border-box;border:2px solid ${border};border-radius:${radius};background:${bg};overflow:hidden;${sel ? 'outline:3px solid #1a5252;outline-offset:2px;' : ''}">
    ${entry ? `<div class="absolute" style="top:1px;left:5px;font-size:9px;font-weight:700;color:${border};opacity:0.65;pointer-events:none">${stationLabel(id)}</div>` : ''}
    ${content}
  </div>`;
}

// Display-only row of today's staff (active rotation) with their status color code,
// centered under the floor. Reuses the turns-grid colors so it matches.
function renderFloorStaffRow() {
  const el = document.getElementById('floorplan-staff-row'); if (!el) return;
  const ids = getActiveTurnsOrder();
  if (!ids.length) { el.innerHTML = ''; return; }
  const bubbles = ids.map(id => {
    const st = staffById(id); if (!st) return '';
    const c = getTechStatusColor(id);
    return `<div class="flex flex-col items-center gap-1" style="width:64px">
      <div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:${c.bg};color:${c.text};font-family:var(--font-headline);font-weight:700;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.18)">${(st.name||'?').charAt(0).toUpperCase()}</div>
      <span style="font-size:11px;font-weight:600;color:var(--md-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px">${st.name.split(' ')[0]}</span>
      <span style="font-size:9px;font-weight:700;color:${c.bg === '#f3f4f6' ? '#9ca3af' : c.bg}">${c.label}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="flex flex-wrap items-start justify-center gap-3 pt-3 border-t border-surface-container-high">${bubbles}</div>`;
}

export function renderFloorPlan() {
  const grid = document.getElementById('floorplan-grid');
  if (!grid) return;
  const { byStation, unplaced } = collectFloor();
  renderFloorStaffRow();

  const modeLabel = document.getElementById('floorplan-mode-label');
  if (modeLabel) modeLabel.textContent = floorEditMode ? 'Editing layout — drag to move, tap to select, then style below' : 'Live';
  const editBtn = document.getElementById('floorplan-edit-btn');
  if (editBtn) editBtn.innerHTML = floorEditMode
    ? '<span class="material-symbols-outlined" style="font-size:16px">check</span> Done'
    : '<span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit layout';
  document.getElementById('floorplan-reset-btn')?.classList.toggle('hidden', !floorEditMode);
  renderFloorProps();

  const tray = document.getElementById('floorplan-tray');
  if (tray) {
    if (floorEditMode || unplaced.length === 0) tray.innerHTML = '';
    else tray.innerHTML = `<div class="bg-surface-container rounded-xl p-2">
      <div class="text-[11px] font-body font-semibold text-on-surface-variant mb-1">Not seated — drag onto a station (${unplaced.length})</div>
      <div class="flex gap-1.5 flex-wrap">${unplaced.map(e => `<div class="floor-bubble cursor-pointer rounded-lg px-2 py-1" data-entry-id="${e.id}" style="background:${entryInservice(e) ? '#c8e6c5' : '#ffe0b2'};color:#1f2937;font-size:11px"><span class="font-semibold">${e.name}</span></div>`).join('')}</div></div>`;
  }

  grid.style.position = 'relative';
  let maxRight = 0, maxBottom = 0;
  const stationIds = getStations();
  stationIds.forEach(id => { const L = layoutFor(id); maxRight = Math.max(maxRight, L.x + L.w); maxBottom = Math.max(maxBottom, L.y + L.h); });
  const cw = maxRight + GAP, ch = maxBottom + GAP;
  const stationsHtml = stationIds.map(id => stationHtml(id, byStation[id] || null)).join('');
  if (floorEditMode) {
    // Full size while arranging (drag stays precise); the editor may scroll.
    grid.style.overflow = 'auto';
    grid.style.height = ch + 'px';
    grid.innerHTML = `<div id="floorplan-canvas" style="position:relative;width:${cw}px;height:${ch}px">${stationsHtml}</div>`;
  } else {
    // Live view: scale the whole canvas to fit the screen — no horizontal scroll —
    // and center it horizontally (transform-origin is top-left, so shift by the
    // leftover width). Keeps the iPad look; just stops it hugging the left on desktop.
    const availW = grid.clientWidth || 720;
    const availH = Math.max(280, window.innerHeight - grid.getBoundingClientRect().top - 16);
    const s = Math.min(1, availW / cw, availH / ch);
    const offsetX = Math.max(0, (availW - cw * s) / 2);
    grid.style.overflow = 'hidden';
    grid.style.height = (ch * s) + 'px';
    grid.innerHTML = `<div id="floorplan-canvas" style="position:relative;width:${cw}px;height:${ch}px;transform-origin:top left;transform:translateX(${offsetX}px) scale(${s})">${stationsHtml}</div>`;
  }
}

// ── Edit-mode properties panel ────────────────────
function renderFloorProps() {
  const el = document.getElementById('floorplan-props');
  if (!el) return;
  if (!floorEditMode || _selected.size === 0) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const ids = [..._selected];
  const ref = layoutFor(ids[0]);
  // Show the reference (first-selected) dimensions as exact numbers so two seats
  // can be compared at a glance; flag "mixed" when the selection isn't uniform.
  const dims = ids.map(id => layoutFor(id));
  const sameW = dims.every(d => Math.round(d.w) === Math.round(ref.w));
  const sameH = dims.every(d => Math.round(d.h) === Math.round(ref.h));
  const sameShape = dims.every(d => d.shape === ref.shape);
  const numCls = 'w-12 text-center border border-surface-container-high rounded bg-transparent py-0.5 text-xs font-body';
  el.innerHTML = `
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <span class="text-xs font-headline font-bold text-on-surface">${ids.length} selected</span>
      <button onclick="fpClearSelection()" class="text-xs text-primary underline">clear</button>
      ${ids.length >= 2 ? `<button onclick="fpMatchSize()" class="fp-step" style="width:auto;padding:0 10px" title="Make every selected station the same width, height & shape as the first one">Match size</button>` : ''}
    </div>
    <div class="flex items-center gap-3 flex-wrap text-xs font-body">
      <label class="flex items-center gap-1">Fill <input type="color" value="${ref.fill}" onchange="fpSetProp('fill',this.value)" class="w-7 h-7 rounded border border-surface-container-high bg-transparent"></label>
      <label class="flex items-center gap-1">Outline <input type="color" value="${ref.outline}" onchange="fpSetProp('outline',this.value)" class="w-7 h-7 rounded border border-surface-container-high bg-transparent"></label>
      <span class="flex items-center gap-1">W <button onclick="fpResize('w',-12)" class="fp-step">−</button><input type="number" value="${Math.round(ref.w)}" onchange="fpSetSize('w',this.value)" class="${numCls}"><button onclick="fpResize('w',12)" class="fp-step">+</button>${sameW?'':'<span class="text-[10px] text-outline">mixed</span>'}</span>
      <span class="flex items-center gap-1">H <button onclick="fpResize('h',-10)" class="fp-step">−</button><input type="number" value="${Math.round(ref.h)}" onchange="fpSetSize('h',this.value)" class="${numCls}"><button onclick="fpResize('h',10)" class="fp-step">+</button>${sameH?'':'<span class="text-[10px] text-outline">mixed</span>'}</span>
      <span class="flex items-center gap-1">Shape
        <button onclick="fpSetProp('shape','rounded')" class="fp-step ${sameShape&&ref.shape==='rounded'?'fp-on':''}">▢</button>
        <button onclick="fpSetProp('shape','square')" class="fp-step ${sameShape&&ref.shape==='square'?'fp-on':''}">◻</button>
        <button onclick="fpSetProp('shape','circle')" class="fp-step ${sameShape&&ref.shape==='circle'?'fp-on':''}">◯</button>
        ${sameShape?'':'<span class="text-[10px] text-outline">mixed</span>'}
      </span>
      <span class="flex items-center gap-1">Text <button onclick="fpTextSize(-0.1)" class="fp-step" style="font-size:11px">A−</button><button onclick="fpTextSize(0.1)" class="fp-step" style="font-size:15px">A+</button></span>
    </div>`;
}
function applyToSelected(mut) {
  const next = { ...layout() };
  _selected.forEach(id => { next[id] = { ...layoutFor(id), ...mut(layoutFor(id)) }; });
  saveLayout(next);
  renderFloorPlan();
}
export function fpSetProp(prop, val) { applyToSelected(() => ({ [prop]: val })); }
export function fpResize(dim, delta) { applyToSelected(L => ({ [dim]: Math.max(48, (L[dim] || 0) + delta) })); }
export function fpSetSize(dim, val) { const n = parseInt(val, 10); if (!Number.isFinite(n)) return; applyToSelected(() => ({ [dim]: Math.max(48, n) })); }
// One click: make every selected station match the first-selected one's size & shape.
export function fpMatchSize() {
  const ids = [..._selected]; if (ids.length < 2) return;
  const ref = layoutFor(ids[0]);
  applyToSelected(() => ({ w: ref.w, h: ref.h, shape: ref.shape }));
}
export function fpTextSize(delta) { applyToSelected(L => ({ font: Math.min(1.8, Math.max(0.7, Math.round(((L.font || 1) + delta) * 100) / 100)) })); }
export function fpClearSelection() { _selected.clear(); renderFloorPlan(); }

export function toggleFloorEdit() { floorEditMode = !floorEditMode; _selected.clear(); renderFloorPlan(); }
export function resetFloorLayout() {
  const doReset = () => { _selected.clear(); saveLayout({}); renderFloorPlan(); showToast('Floor layout reset'); };
  if (window.showWarnModal) window.showWarnModal('Reset layout?', 'Restore the default station arrangement, sizes, and colors?', doReset);
  else doReset();
}

// ── Commit: seat a customer (one per station) ─────
function seatCustomer(entryId, stationId) {
  const e = q().find(x => String(x.id) === String(entryId));
  if (!e) return;
  const occupant = collectFloor().byStation[stationId];
  if (occupant && String(occupant.id) !== String(e.id)) { showToast(`${stationId} is taken by ${occupant.name}`); return; }
  e.station = stationId;                                    // seat the customer — works with OR without an assigned tech
  activeAssignments(e).forEach(a => { a.station = stationId; });   // keep per-service station in sync (no-op if none yet)
  dispatch('queue.upsert', { entry: e });
  renderFloorPlan();
  showToast(`Seated ${e.name.split(' ')[0]} at ${stationId}`);
}

// ── Alignment snapping (snap a dragged station's edges/centers to others) ─────
function snapMove(primaryId, base, rawDx, rawDy, selectedSet) {
  const L = layoutFor(primaryId);
  const px = base.x + rawDx, py = base.y + rawDy;
  const myV = [px, px + L.w / 2, px + L.w];   // left, centerX, right
  const myH = [py, py + L.h / 2, py + L.h];   // top, centerY, bottom
  const TH = 7;
  let bdx = Infinity, bdy = Infinity, guideX = null, guideY = null;
  getStations().forEach(id => {
    if (selectedSet.has(id)) return;
    const o = layoutFor(id);
    const oV = [o.x, o.x + o.w / 2, o.x + o.w];
    const oH = [o.y, o.y + o.h / 2, o.y + o.h];
    myV.forEach(m => oV.forEach(ov => { const d = ov - m; if (Math.abs(d) <= TH && Math.abs(d) < Math.abs(bdx)) { bdx = d; guideX = ov; } }));
    myH.forEach(m => oH.forEach(oh => { const d = oh - m; if (Math.abs(d) <= TH && Math.abs(d) < Math.abs(bdy)) { bdy = d; guideY = oh; } }));
  });
  return { dx: rawDx + (bdx === Infinity ? 0 : bdx), dy: rawDy + (bdy === Infinity ? 0 : bdy), guideX: bdx === Infinity ? null : guideX, guideY: bdy === Infinity ? null : guideY };
}
function fpGuide(axis, pos) {
  const grid = document.getElementById('floorplan-canvas') || document.getElementById('floorplan-grid'); if (!grid) return;
  const gid = axis === 'v' ? 'fp-guide-v' : 'fp-guide-h';
  let g = document.getElementById(gid);
  if (pos === null) { if (g) g.style.display = 'none'; return; }
  if (!g) {
    g = document.createElement('div'); g.id = gid;
    g.style.cssText = axis === 'v'
      ? 'position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #1a5252;pointer-events:none;z-index:50'
      : 'position:absolute;left:0;right:0;height:0;border-top:1px dashed #1a5252;pointer-events:none;z-index:50';
    grid.appendChild(g);
  }
  g.style.display = ''; if (axis === 'v') g.style.left = pos + 'px'; else g.style.top = pos + 'px';
}
function clearGuides() { fpGuide('v', null); fpGuide('h', null); }

// ── Drag (pointer events) ─────────────────────────
(function initFloorDrag() {
  const THRESH = 6;
  let startX = 0, startY = 0, pending = null, dragging = false, clone = null;
  let mode = null, dragEntryId = null, dragStation = null, moveStart = null, moveDelta = null;
  const closest = (el, sel) => { while (el && el !== document.body) { if (el.matches && el.matches(sel)) return el; el = el.parentElement; } return null; };
  function stationAt(x, y) { if (clone) clone.style.display = 'none'; const el = document.elementFromPoint(x, y); if (clone) clone.style.display = ''; return closest(el, '.floor-station'); }

  function onDown(e) {
    const panel = document.getElementById('panel-floorplan');
    if (!panel || !panel.classList.contains('active') || e.button) return;
    if (floorEditMode) {
      const st = closest(e.target, '.floor-station'); if (!st) return;
      mode = 'station'; dragStation = st.dataset.station; pending = st;
    } else {
      const b = closest(e.target, '.floor-bubble'); if (!b) return;
      mode = 'bubble'; dragEntryId = b.dataset.entryId; pending = b;
    }
    startX = e.clientX; startY = e.clientY;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function startDrag() {
    dragging = true;
    if (mode === 'station') {
      if (!_selected.has(dragStation)) { _selected.clear(); _selected.add(dragStation); renderFloorPlan(); }
      moveStart = {}; _selected.forEach(id => { const L = layoutFor(id); moveStart[id] = { x: L.x, y: L.y }; });
    } else {
      const rect = pending.getBoundingClientRect();
      clone = pending.cloneNode(true);
      Object.assign(clone.style, { position: 'fixed', zIndex: '9999', pointerEvents: 'none', width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px', opacity: '0.9', transform: 'scale(1.03)', boxShadow: '0 6px 20px rgba(0,0,0,.25)' });
      document.body.appendChild(clone);
      pending.style.opacity = '0.4';
    }
  }
  function onMove(e) {
    if (!dragging) { if (Math.hypot(e.clientX - startX, e.clientY - startY) > THRESH) startDrag(); else return; }
    e.preventDefault();
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (mode === 'station') {
      const snap = snapMove(dragStation, moveStart[dragStation], dx, dy, _selected);
      moveDelta = { dx: snap.dx, dy: snap.dy };
      _selected.forEach(id => { const el = document.querySelector(`.floor-station[data-station="${id}"]`); if (el && moveStart[id]) { el.style.left = (moveStart[id].x + snap.dx) + 'px'; el.style.top = Math.max(0, moveStart[id].y + snap.dy) + 'px'; } });
      fpGuide('v', snap.guideX); fpGuide('h', snap.guideY);
    } else if (clone) {
      clone.style.left = (e.clientX - clone.offsetWidth / 2) + 'px'; clone.style.top = (e.clientY - clone.offsetHeight / 2) + 'px';
      document.querySelectorAll('.floor-station').forEach(s => { s.style.boxShadow = ''; });
      const tgt = stationAt(e.clientX, e.clientY); if (tgt) tgt.style.boxShadow = 'inset 0 0 0 3px #1a5252';
    }
  }
  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const wasDragging = dragging; dragging = false;
    if (clone) { clone.remove(); clone = null; }
    if (pending && mode === 'bubble') pending.style.opacity = '';
    document.querySelectorAll('.floor-station').forEach(s => { s.style.boxShadow = ''; });
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!wasDragging) {
      if (mode === 'bubble' && dragEntryId) window.showGroupAssignModal?.(dragEntryId);
      else if (mode === 'station' && dragStation) { if (_selected.has(dragStation)) _selected.delete(dragStation); else _selected.add(dragStation); renderFloorPlan(); }
    } else if (mode === 'bubble') {
      const tgt = stationAt(e.clientX, e.clientY); if (tgt) seatCustomer(dragEntryId, tgt.dataset.station); else renderFloorPlan();
    } else if (mode === 'station' && moveStart) {
      const d = moveDelta || { dx, dy };
      const next = { ...layout() };
      _selected.forEach(id => { const s = moveStart[id]; if (s) next[id] = { ...layoutFor(id), x: s.x + d.dx, y: Math.max(0, s.y + d.dy) }; });
      saveLayout(next); renderFloorPlan();
    }
    clearGuides();
    pending = null; mode = null; dragEntryId = dragStation = null; moveStart = null; moveDelta = null;
  }
  document.addEventListener('pointerdown', onDown);
})();
