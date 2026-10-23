// ── Price-menu editor (Phase 2a) — Settings editor for config.price_menu ──────────────────────────
// Edits a DRAFT copy of the normalized menu by node id (never array index), so add/remove/reorder/move
// target the right node across pages → columns → items → variants/add-ons → footers. The mutators below
// are PURE (operate on the passed draft, no DOM/getState) and unit-tested; the render + handlers follow.
// A column is addressed as `<pageId>:<colIndex>` (columns carry no id of their own).

let _uc = 0;
const _uid = () => 'pm' + Date.now().toString(36) + (++_uc) + Math.random().toString(36).slice(2, 5);
const _OPT = { desc: 1 };   // optional keys removed when emptied (so a round-trip doesn't read as dirty)

// Locate any node by id → { arr, idx, node, kind: 'page'|'item'|'variants'|'addons'|'foot' }, or null.
export function pmFind(draft, id) {
  if (!draft || id == null) return null;
  for (const p of draft.pages || []) {
    if (p.id === id) return { arr: draft.pages, idx: draft.pages.indexOf(p), node: p, kind: 'page' };
    for (const col of p.cols || []) {
      for (let i = 0; i < col.length; i++) {
        const it = col[i];
        if (it.id === id) return { arr: col, idx: i, node: it, kind: 'item' };
        for (const which of ['variants', 'addons']) {
          const sub = it[which];
          if (Array.isArray(sub)) { const j = sub.findIndex(s => s && s.id === id); if (j >= 0) return { arr: sub, idx: j, node: sub[j], kind: which }; }
        }
      }
    }
    if (Array.isArray(p.foot)) { const k = p.foot.findIndex(f => f && f.id === id); if (k >= 0) return { arr: p.foot, idx: k, node: p.foot[k], kind: 'foot' }; }
  }
  return null;
}
function _col(draft, colId) {
  if (!draft) return null;
  const s = String(colId), i = s.lastIndexOf(':');
  const pageId = s.slice(0, i), ci = +s.slice(i + 1);
  const p = (draft.pages || []).find(x => x.id === pageId);
  return p && Array.isArray(p.cols[ci]) ? p.cols[ci] : null;
}

export function pmSetField(draft, id, field, val) {
  const f = pmFind(draft, id); if (!f) return false;
  if (_OPT[field] && (val == null || val === '')) delete f.node[field]; else f.node[field] = val;
  return true;
}
export function pmAddItem(draft, colId, kind, afterId) {
  const col = _col(draft, colId); if (!col) return null;
  const node = kind === 'sec' ? { id: _uid(), t: 'sec', label: '' } : { id: _uid(), t: 'row', nm: '', pr: '' };
  const idx = afterId ? col.findIndex(i => i.id === afterId) : -1;
  if (idx >= 0) col.splice(idx + 1, 0, node); else col.push(node);
  return node;
}
export function pmRemoveItem(draft, id) {
  const f = pmFind(draft, id); if (!f || f.kind !== 'item') return false;
  f.arr.splice(f.idx, 1); return true;
}
// Delete a SECTION together with its contiguous services (symmetric with how pmRelocateItem moves a section).
export function pmRemoveSection(draft, id) {
  const f = pmFind(draft, id); if (!f || f.kind !== 'item' || f.node.t !== 'sec') return 0;
  let n = 1; while (f.arr[f.idx + n] && f.arr[f.idx + n].t === 'row') n++;
  f.arr.splice(f.idx, n); return n;   // returns how many nodes were removed (heading + its rows)
}
export function pmMoveItem(draft, id, dir) {
  const f = pmFind(draft, id); if (!f) return false;
  const j = f.idx + (dir === 'up' ? -1 : 1);
  if (j < 0 || j >= f.arr.length) return false;   // clamp at the ends — never write arr[-1]
  const t = f.arr[f.idx]; f.arr[f.idx] = f.arr[j]; f.arr[j] = t;
  return true;
}
export function pmRelocateItem(draft, id, colId) {
  const f = pmFind(draft, id); if (!f || f.kind !== 'item') return false;
  const dst = _col(draft, colId); if (!dst || dst === f.arr) return dst === f.arr;   // same column → no-op success
  // A SECTION carries its contiguous following rows (up to the next section) as a group; a row moves alone.
  let n = 1;
  if (f.node.t === 'sec') { while (f.arr[f.idx + n] && f.arr[f.idx + n].t === 'row') n++; }
  const group = f.arr.splice(f.idx, n);
  dst.push(...group);
  return true;
}
// Generalized move (for drag-and-drop): relocate a node to targetColId, inserted BEFORE beforeId (or appended
// when beforeId is null). A section carries its contiguous rows. Dropping a section onto its own group is a no-op.
export function pmMoveTo(draft, id, targetColId, beforeId) {
  const f = pmFind(draft, id); if (!f || f.kind !== 'item') return false;
  const dst = _col(draft, targetColId); if (!dst) return false;
  let n = 1;
  if (f.node.t === 'sec') { while (f.arr[f.idx + n] && f.arr[f.idx + n].t === 'row') n++; }
  const groupIds = new Set(f.arr.slice(f.idx, f.idx + n).map(x => x.id));
  if (beforeId && groupIds.has(beforeId)) return false;   // dropping onto itself — no change
  const group = f.arr.splice(f.idx, n);                    // removed first → indices in dst are post-removal
  let insertIdx = dst.length;
  if (beforeId) { const bi = dst.findIndex(x => x.id === beforeId); if (bi >= 0) insertIdx = bi; }
  dst.splice(insertIdx, 0, ...group);
  return true;
}
// Document-order flattening of every item across pages → columns, each tagged with its page/column.
// Drives the Option-B section-grouped list render AND the model-based drag drop-resolution (the old
// drag read the .pm-col DOM, which no longer exists once columns are hidden).
export function pmFlatten(draft) {
  const out = [];
  for (const p of (draft && draft.pages) || []) {
    (p.cols || []).forEach((col, ci) => {
      for (const it of (col || [])) if (it && it.id) out.push({ id: it.id, kind: it.t, pageId: p.id, colIndex: ci, colId: p.id + ':' + ci });
    });
  }
  return out;
}
// Resolve a drag drop (dragged `id` dropped before/after the hovered `overId`) to { colId, beforeId, crossPage }
// for pmMoveTo — derived from the MODEL, not the DOM. `before` true = land before overId; false = after it
// (→ before the NEXT item in overId's column, or append when overId is last). crossPage true when the drop
// lands on a different printed page than the dragged item started on (the handler confirms those). Null =
// defined no-op (self-drop, unknown/sentinel over-id, missing input).
export function pmDropTarget(draft, id, overId, before) {
  if (!id || !overId || id === overId) return null;
  const flat = pmFlatten(draft);
  const over = flat.find(x => x.id === overId); if (!over) return null;
  const dragged = flat.find(x => x.id === id);
  let beforeId = overId;
  if (!before) {
    const colItems = flat.filter(x => x.colId === over.colId);
    const oi = colItems.findIndex(x => x.id === overId);
    beforeId = (oi >= 0 && oi + 1 < colItems.length) ? colItems[oi + 1].id : null;
  }
  return { colId: over.colId, beforeId, crossPage: !!(dragged && dragged.pageId !== over.pageId) };
}
export function pmAddSub(draft, rowId, which) {
  const f = pmFind(draft, rowId); if (!f || f.kind !== 'item' || f.node.t !== 'row') return null;
  if (which !== 'variants' && which !== 'addons') return null;
  if (!Array.isArray(f.node[which])) f.node[which] = [];
  const node = { id: _uid(), nm: '', pr: '' };
  f.node[which].push(node);
  return node;
}
export function pmRemoveSub(draft, subId) {
  const f = pmFind(draft, subId); if (!f || (f.kind !== 'variants' && f.kind !== 'addons')) return false;
  f.arr.splice(f.idx, 1);
  if (f.arr.length === 0) {   // drop the now-empty array from its owning row so it can't read as dirty
    for (const p of draft.pages || []) for (const col of p.cols || []) for (const it of col) {
      if (it[f.kind] === f.arr) { delete it[f.kind]; return true; }
    }
  }
  return true;
}
export function pmSetSubField(draft, subId, field, val) {
  const f = pmFind(draft, subId); if (!f || (f.kind !== 'variants' && f.kind !== 'addons')) return false;
  if (_OPT[field] && (val == null || val === '')) delete f.node[field]; else f.node[field] = val;
  return true;
}
export function pmAddFoot(draft, pageId) {
  const p = ((draft && draft.pages) || []).find(x => x.id === pageId); if (!p) return null;
  if (!Array.isArray(p.foot)) p.foot = [];
  const node = { id: _uid(), text: '', cls: '' };
  p.foot.push(node);
  return node;
}
export function pmRemoveFoot(draft, footId) {
  const f = pmFind(draft, footId); if (!f || f.kind !== 'foot') return false;
  f.arr.splice(f.idx, 1); return true;
}
export function pmSetFoot(draft, footId, field, val) {
  const f = pmFind(draft, footId); if (!f || f.kind !== 'foot') return false;
  f.node[field] = val; return true;
}
export function pmIsDirty(draft, baseline) { return JSON.stringify(draft) !== baseline; }

// ── Editor render + handlers ──────────────────────────────────────────────────────────────────────
import { normalizePriceMenu, DEFAULT_PRICE_MENU, openPriceMenuPreview } from './guide.js';
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { escHtml, escAttrJs, showToast } from '../utils.js';

let _pmDraft = null, _pmBaseline = '', _pmFilter = '', _pmOpenedFrom = '';
let _pmSel = null;             // selected node id (item | section | 'page:<id>' sentinel) | null
let _pmStack = 'list';         // narrow-screen master-detail: 'list' | 'detail'
const _clone = o => JSON.parse(JSON.stringify(o));
const _live = () => normalizePriceMenu(getState().config.price_menu);
// The RAW stored config (not re-normalized) — a stable baseline for the "changed on another device" check.
// (normalize mints random ids on every read, so comparing two normalize() results always differs.)
const _rawCfg = () => JSON.stringify(getState().config.price_menu ?? null);
// For the click-out guard (2a-guard): is the editor open with unsaved changes?
export function pmEditorHasUnsaved() { return !!_pmDraft && pmIsDirty(_pmDraft, _pmBaseline); }
export function pmEditorClearDraft() { _pmDraft = null; _pmBaseline = ''; _pmStack = 'list'; _setBeforeUnload(false); }

function _setBeforeUnload(on) {
  if (on) window.addEventListener('beforeunload', _pmBeforeUnload);
  else window.removeEventListener('beforeunload', _pmBeforeUnload);
}
function _pmBeforeUnload(e) { if (pmEditorHasUnsaved()) { e.preventDefault(); e.returnValue = ''; return ''; } }

export function renderPriceMenuEditor() {
  const host = document.getElementById('settings-pricemenu-section'); if (!host) return;
  if (!_pmDraft) { _pmDraft = _clone(_live()); _pmBaseline = JSON.stringify(_pmDraft); _pmOpenedFrom = _rawCfg(); }
  _pmResolveSel();
  host.innerHTML = _editorHtml(_pmDraft);
  _applyFilter();
  _syncDirtyUI();
  _pmInitDrag();
}
// Keep the selection valid after any render: a 'page:' sentinel for an existing page stays; a live item id
// stays; otherwise fall back to the first service (else first node, else null). Prevents the panel stranding
// on a deleted/reset id (pmFind → null → empty state would show instead of the expected item).
function _pmResolveSel() {
  if (_pmSel && String(_pmSel).startsWith('page:')) {
    const pid = _pmSel.slice(5);
    if ((_pmDraft.pages || []).some(p => p.id === pid)) return;
  } else if (_pmSel && pmFind(_pmDraft, _pmSel)) return;
  const flat = pmFlatten(_pmDraft);
  const firstRow = flat.find(x => x.kind === 'row') || flat[0];
  _pmSel = firstRow ? firstRow.id : null;
}
function _syncDirtyUI() {
  const dirty = pmEditorHasUnsaved();
  const save = document.getElementById('pm-save-btn'); if (save) { save.disabled = !dirty; save.style.opacity = dirty ? '1' : '0.5'; }
  _setBeforeUnload(dirty);
}
function _afterStructural() { renderPriceMenuEditor(); }      // re-render (reorder/add/remove/move)
function _afterText() { _syncDirtyUI(); }                     // no re-render — keep the caret

// Options for the "Prints in" select: every column of every page. Pages are NUMBERED (titles repeat / can be
// blank, so "Page 1 (Hand Services) · Left" disambiguates where the plain title would not).
function _moveOpts(draft, curColId) {
  return (draft.pages || []).map((p, pi) => (p.cols || []).map((c, ci) => {
    const cid = p.id + ':' + ci;
    const side = p.cols.length === 2 ? (ci === 0 ? 'Left' : 'Right') : ('Col ' + (ci + 1));
    const plabel = 'Page ' + (pi + 1) + (p.title ? ' (' + p.title + ')' : '');
    return '<option value="' + escHtml(cid) + '"' + (cid === curColId ? ' selected' : '') + '>' + escHtml(plabel + ' · ' + side) + '</option>';
  }).join('')).join('');
}

const _inp = (val, oninput, ph, extra) => '<input value="' + escHtml(val) + '" oninput="' + oninput + '" placeholder="' + escHtml(ph || '') + '" aria-label="' + escHtml(ph || 'field') + '" class="pm-f ' + (extra || '') + '" spellcheck="false">';
const _ctrlBtn = (on, icon, title) => '<button onclick="' + on + '" title="' + escHtml(title) + '" class="pm-ic"><span class="material-symbols-outlined" style="font-size:16px">' + icon + '</span></button>';
const _q = s => "'" + escAttrJs(s) + "'";

function _subList(rowId, which, list) {
  const label = which === 'variants' ? 'Variants (pick one)' : 'Add-ons (extra)';
  const rows = (list || []).map(s => '<div class="pm-sub" data-pm-card="' + escAttrJs(s.id) + '">'
    + _inp(s.nm, 'pmEditSub(' + _q(s.id) + ",'nm',this.value)", which === 'variants' ? 'e.g. Full set' : 'e.g. French tip', 'pm-sub-nm')
    + _inp(s.pr, 'pmEditSub(' + _q(s.id) + ",'pr',this.value)", '$', 'pm-sub-pr')
    + _ctrlBtn('pmSubUp(' + _q(s.id) + ')', 'keyboard_arrow_up', 'Move up') + _ctrlBtn('pmSubDn(' + _q(s.id) + ')', 'keyboard_arrow_down', 'Move down') + _ctrlBtn('pmDelSub(' + _q(s.id) + ')', 'close', 'Remove')
    + '</div>').join('');
  const fn = which === 'variants' ? 'pmAddVar' : 'pmAddAddon';
  return '<div class="pm-subwrap"><div class="pm-sublabel">' + label + '</div>' + rows + '<button onclick="' + fn + '(' + _q(rowId) + ')" class="pm-add-sub">+ ' + (which === 'variants' ? 'variant' : 'add-on') + '</button></div>';
}

const _secLbl = it => (it.label || '').trim() || '(unnamed section)';
const _rowLbl = it => (it.nm || '').trim() || '(unnamed service)';

// Left master list: section-grouped, document order, with a light page divider (columns hidden).
function _listHtml(draft) {
  let html = '';
  (draft.pages || []).forEach((p, pi) => {
    html += '<div class="pm2-pagediv">' + escHtml(p.title || ('Page ' + (pi + 1))) + '</div>';
    (p.cols || []).forEach(col => (col || []).forEach(it => {
      const on = it.id === _pmSel ? ' pm2-on' : '';
      const grip = '<span class="pm-drag material-symbols-outlined" title="Drag to reorder" aria-hidden="true" style="font-size:17px">drag_indicator</span>';
      if (it.t === 'sec') {
        const blank = !(it.label || '').trim();
        html += '<div class="pm2-item pm2-secrow' + on + (blank ? ' pm2-blank' : '') + '" data-pm-card="' + escAttrJs(it.id) + '" data-pm-text="' + escHtml((it.label || '').toLowerCase()) + '" onclick="pmSelect(' + _q(it.id) + ')" role="button" tabindex="0">'
          + grip + '<span class="pm2-nm">' + escHtml(_secLbl(it)) + '</span></div>';
      } else {
        const blank = !(it.nm || '').trim();
        html += '<div class="pm2-item pm2-row' + on + (blank ? ' pm2-blank' : '') + '" data-pm-card="' + escAttrJs(it.id) + '" data-pm-text="' + escHtml(((it.nm || '') + ' ' + (it.pr || '')).toLowerCase()) + '" onclick="pmSelect(' + _q(it.id) + ')" role="button" tabindex="0">'
          + grip + '<span class="pm2-nm">' + escHtml(_rowLbl(it)) + '</span><span class="pm2-pr">' + escHtml(it.pr || '') + '</span></div>';
      }
    }));
    const pon = ('page:' + p.id) === _pmSel ? ' pm2-on' : '';
    html += '<div class="pm2-item pm2-pageset' + pon + '" onclick="pmSelect(' + _q('page:' + p.id) + ')" role="button" tabindex="0"><span class="material-symbols-outlined" style="font-size:16px">tune</span> Page settings &amp; footer</div>';
  });
  html += '<div class="pm2-addrow"><button onclick="pmAdd(\'row\')" class="pm-add">+ Service</button><button onclick="pmAdd(\'sec\')" class="pm-add">+ Section</button></div>';
  return html;
}

const _backBtn = () => '<button onclick="pmBackToList()" class="pm2-back" title="Back to list" aria-label="Back to list"><span class="material-symbols-outlined" style="font-size:18px">arrow_back</span></button>';
const _panelEmpty = () => '<div class="pm2-empty">Select a service on the left to edit it.</div>';
const _footSelect = f => '<select onchange="pmEditFoot(' + _q(f.id) + ",'cls',this.value)\" class=\"pm-foot-cls\"><option value=\"\"" + (!f.cls ? ' selected' : '') + '>Normal</option><option value="cash"' + (f.cls === 'cash' ? ' selected' : '') + '>Discount</option><option value="fix"' + (f.cls === 'fix' ? ' selected' : '') + '>Fine print</option></select>';

// Right detail panel: edits ONLY the selected node (service / section / page-settings), or an empty state.
function _panelHtml(draft) {
  const head = label => '<div class="pm2-phead">' + _backBtn() + '<span class="pm2-ptag">' + label + '</span></div>';
  if (_pmSel && String(_pmSel).startsWith('page:')) {
    const pid = _pmSel.slice(5), p = (draft.pages || []).find(x => x.id === pid);
    if (!p) return head('Page') + _panelEmpty();
    const feet = (p.foot || []).map(f => '<div class="pm2-foot" data-pm-card="' + escAttrJs(f.id) + '">'
      + _inp(f.text, 'pmEditFoot(' + _q(f.id) + ",'text',this.value)", 'Footer line', 'pm-foot-t') + _footSelect(f)
      + _ctrlBtn('pmDelFoot(' + _q(f.id) + ')', 'close', 'Remove') + '</div>').join('');
    return head('Page settings')
      + '<label class="pm2-lab">Page title</label>'
      + '<input value="' + escHtml(p.title || '') + '" onchange="pmEditPage(' + _q(p.id) + ',this.value)" placeholder="Page title" aria-label="Page title" class="pm-f" spellcheck="false">'
      + '<label class="pm2-lab">Footer lines</label>' + feet
      + '<button onclick="pmAddFootLine(' + _q(p.id) + ')" class="pm-add-sub">+ footer line</button>';
  }
  const f = _pmSel ? pmFind(draft, _pmSel) : null;
  if (!f || f.kind !== 'item') return _panelEmpty();
  const it = f.node;
  const fl = pmFlatten(draft).find(x => x.id === it.id);
  const printsIn = '<label class="pm2-lab">Prints in</label><select onchange="pmMove(' + _q(it.id) + ',this.value)" class="pm-move">' + _moveOpts(draft, fl ? fl.colId : '') + '</select>';
  const del = '<div class="pm2-pfoot">' + printsIn + '<button onclick="pmDel(' + _q(it.id) + ')" class="pm2-del"><span class="material-symbols-outlined" style="font-size:16px">delete</span> Delete</button></div>';
  if (it.t === 'sec') {
    return head('Section')
      + '<label class="pm2-lab">Heading</label>' + _inp(it.label, 'pmEdit(' + _q(it.id) + ",'label',this.value)", 'Section heading', 'pm-sec-nm')
      + '<label class="pm2-lab">Note (optional)</label>' + _inp(it.desc || '', 'pmEdit(' + _q(it.id) + ",'desc',this.value)", 'heading note', 'pm-desc')
      + del;
  }
  return head('Service')
    + '<div class="pm2-np">' + _inp(it.nm, 'pmEdit(' + _q(it.id) + ",'nm',this.value)", 'Service name', 'pm-row-nm') + _inp(it.pr, 'pmEdit(' + _q(it.id) + ",'pr',this.value)", '$', 'pm-row-pr') + '</div>'
    + '<label class="pm2-lab">Description (optional)</label>' + _inp(it.desc || '', 'pmEdit(' + _q(it.id) + ",'desc',this.value)", 'description', 'pm-desc')
    + _subList(it.id, 'variants', it.variants) + _subList(it.id, 'addons', it.addons)
    + del;
}

function _editorHtml(draft) {
  return '<div class="pm2-editor"><div class="pm2-bar">'
    + '<input id="pm-filter" value="' + escHtml(_pmFilter) + '" oninput="pmFilterInput(this.value)" placeholder="Filter services…" class="pm-f pm2-filter" spellcheck="false">'
    + '<div class="pm2-bar-btns">'
    + '<button onclick="pmPreview()" class="btn-secondary"><span class="material-symbols-outlined" style="font-size:16px">visibility</span> Preview</button>'
    + '<button onclick="pmReset()" class="btn-secondary" title="Restore the built-in default menu">Reset to default</button>'
    + '<button onclick="pmCancel()" class="btn-secondary">Cancel</button>'
    + '<button id="pm-save-btn" onclick="pmSave()" class="btn-primary" disabled>Save menu</button>'
    + '</div></div>'
    + '<p class="pm2-hint">Tap <strong>Preview</strong> to see the printed layout. Changes aren’t live until you tap <strong>Save</strong>.</p>'
    + '<div class="pm2-main" data-stack="' + _pmStack + '">'
    + '<div class="pm2-list">' + _listHtml(draft) + '</div>'
    + '<div class="pm2-panel">' + _panelHtml(draft) + '</div>'
    + '</div></div>';
}

// Filter the LEFT list, grouping-aware: hide non-matching services, but keep a section header visible when it
// (or any service under it) matches — so matched rows never float under a hidden heading. Page dividers +
// the Page-settings sentinel aren't [data-pm-text] rows, so they're left alone.
function _applyFilter() {
  const q = (_pmFilter || '').trim().toLowerCase();
  const list = document.querySelector('#settings-pricemenu-section .pm2-list'); if (!list) return;
  const items = [...list.querySelectorAll('.pm2-item[data-pm-text]')];
  // Structural rows (page dividers + the "Page settings" sentinel) aren't search results — hide them while
  // filtering so matches aren't scattered among empty page scaffolding; show them again when the box is cleared.
  const structural = [...list.querySelectorAll('.pm2-pagediv, .pm2-pageset')];
  if (!q) { items.forEach(el => el.classList.remove('hidden')); structural.forEach(el => el.classList.remove('hidden')); return; }
  structural.forEach(el => el.classList.add('hidden'));
  let sec = null, secMatch = false, secHit = false;
  const flush = () => { if (sec) sec.classList.toggle('hidden', !(secMatch || secHit)); };
  items.forEach(el => {
    const match = (el.getAttribute('data-pm-text') || '').includes(q);
    if (el.classList.contains('pm2-secrow')) { flush(); sec = el; secMatch = match; secHit = false; }
    else { el.classList.toggle('hidden', !match); if (match) secHit = true; }
  });
  flush();
}

// Inline handlers (window-glued via main.js)
export function pmSelect(id) { _pmSel = id; _pmStack = 'detail'; _afterStructural(); }
export function pmBackToList() { _pmStack = 'list'; _afterStructural(); }
export function pmEdit(id, field, v) {
  pmSetField(_pmDraft, id, field, v); _afterText();
  // Live-sync the selected list row's name/price WITHOUT a re-render (keeps the panel input's caret).
  if (id === _pmSel && (field === 'nm' || field === 'pr' || field === 'label')) {
    const esc = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
    const row = document.querySelector('#settings-pricemenu-section .pm2-item[data-pm-card="' + esc + '"]');
    if (row) {
      if (field === 'pr') { const pr = row.querySelector('.pm2-pr'); if (pr) pr.textContent = v || ''; }
      else { const nm = row.querySelector('.pm2-nm'); if (nm) nm.textContent = (v || '').trim() || (field === 'label' ? '(unnamed section)' : '(unnamed service)'); row.classList.toggle('pm2-blank', !(v || '').trim()); }
    }
  }
}
export function pmEditSub(id, field, v) { pmSetSubField(_pmDraft, id, field, v); _afterText(); }
export function pmEditFoot(id, field, v) { pmSetFoot(_pmDraft, id, field, v); _afterText(); }
export function pmEditPage(id, v) { pmSetField(_pmDraft, id, 'title', v); _afterStructural(); }   // re-render: list divider + Prints-in labels
export function pmFilterInput(v) { _pmFilter = v; _applyFilter(); }
// Add a new service/section into the selected item's column (right after it), else the end of page 1's first column; auto-select it.
export function pmAdd(kind) {
  let colId = null, afterId = null;
  const fl = _pmSel ? pmFlatten(_pmDraft).find(x => x.id === _pmSel) : null;
  if (fl) { colId = fl.colId; afterId = _pmSel; }
  else { const p0 = (_pmDraft.pages || [])[0]; if (p0) colId = p0.id + ':0'; }
  if (!colId) return;
  const node = pmAddItem(_pmDraft, colId, kind, afterId);
  if (node) { _pmSel = node.id; _pmStack = 'detail'; }
  _afterStructural();
}
export function pmDel(id) {
  const f = pmFind(_pmDraft, id); if (!f || f.kind !== 'item') return;
  // Choose the next selection (the previous row/section) BEFORE removing, so the panel never strands.
  const flat = pmFlatten(_pmDraft); const i = flat.findIndex(x => x.id === id);
  const prev = i > 0 ? flat[i - 1].id : null;
  if (f.node.t === 'sec') {
    let n = 1; while (f.arr[f.idx + n] && f.arr[f.idx + n].t === 'row') n++;
    const svc = n - 1;
    const go = () => { _pmSel = prev; pmRemoveSection(_pmDraft, id); _afterStructural(); };
    if (svc > 0) window.showWarnModal?.('Delete this section?', 'This removes the heading and its ' + svc + ' service' + (svc !== 1 ? 's' : '') + ' below it. Nothing is saved until you tap Save.', go, 'Delete section');
    else go();
    return;
  }
  window.showWarnModal?.('Delete this service?', 'Remove “' + _rowLbl(f.node) + '” from the menu? Nothing is saved until you tap Save.', () => { _pmSel = prev; pmRemoveItem(_pmDraft, id); _afterStructural(); }, 'Delete');
}
export function pmMove(id, colId) { pmRelocateItem(_pmDraft, id, colId); _afterStructural(); }   // "Prints in" — appends to the chosen column
export function pmAddVar(rowId) { pmAddSub(_pmDraft, rowId, 'variants'); _afterStructural(); }
export function pmAddAddon(rowId) { pmAddSub(_pmDraft, rowId, 'addons'); _afterStructural(); }
export function pmDelSub(id) { pmRemoveSub(_pmDraft, id); _afterStructural(); }
export function pmSubUp(id) { pmMoveItem(_pmDraft, id, 'up'); _afterStructural(); }
export function pmSubDn(id) { pmMoveItem(_pmDraft, id, 'down'); _afterStructural(); }
export function pmAddFootLine(pageId) { pmAddFoot(_pmDraft, pageId); _afterStructural(); }
export function pmDelFoot(id) { pmRemoveFoot(_pmDraft, id); _afterStructural(); }
export function pmPreview() { openPriceMenuPreview(_pmDraft); }
export function pmSave() {
  if (!_pmDraft) return;
  // Dispatch a CLONE — never the draft itself, or the live config would alias _pmDraft and later edits
  // would mutate the customer menu with no Save.
  const doSave = () => { dispatch('config.set', { key: 'price_menu', value: _clone(_pmDraft) }); _pmBaseline = JSON.stringify(_pmDraft); _pmOpenedFrom = _rawCfg(); _syncDirtyUI(); showToast('Price menu saved'); };
  if (_rawCfg() !== _pmOpenedFrom) window.showWarnModal?.('Changed on another device', 'The price menu was changed on another device since you opened the editor. Save your version anyway (overwrites theirs)?', doSave, 'Save anyway');
  else doSave();
}
export function pmCancel() {
  const leave = () => { pmEditorClearDraft(); renderPriceMenuEditor(); };
  if (pmEditorHasUnsaved()) window.showWarnModal?.('Discard changes?', 'Your unsaved edits to the price menu will be lost.', leave, 'Discard');
  else leave();
}
export function pmReset() {
  window.showWarnModal?.('Reset to the default menu?', 'This replaces your draft with the built-in default menu (not your last saved version). Nothing is saved until you tap Save.', () => { _pmDraft = _clone(normalizePriceMenu(DEFAULT_PRICE_MENU)); renderPriceMenuEditor(); }, 'Reset');
}

// ── Unsaved-changes click-out guard (2a-guard) ──────────────────────────────────────────────────────
// Core-nav chokepoints (main.js showDashPanel/goTo, settings.js leaf nav) call pmGuardLeave(onLeave) at
// their top. Inert unless the editor is open+dirty; otherwise a dedicated 3-button modal (Save/Discard/
// Keep editing). Save/Discard clear the draft and then run onLeave; Keep editing dismisses.
let _pmPendingLeave = null;
function _pmCloseUnsaved() { const m = document.getElementById('pm-unsaved-modal'); if (m) { m.classList.add('hidden'); m.style.display = ''; } }
export function pmGuardLeave(onLeave) {
  // Clean leave (or editor not open): clear the draft too, so a reopen re-reads live config (picks up a
  // change made on another device meanwhile) instead of reusing a stale clean draft.
  if (!pmEditorHasUnsaved()) { pmEditorClearDraft(); if (onLeave) onLeave(); return; }
  const m = document.getElementById('pm-unsaved-modal');
  if (!m) { if (onLeave) onLeave(); return; }   // no modal available → don't trap the user
  _pmPendingLeave = onLeave || null;
  m.classList.remove('hidden'); m.style.display = 'flex';
}
export function pmUnsavedSave() {
  const go = _pmPendingLeave; _pmPendingLeave = null; _pmCloseUnsaved();
  if (_pmDraft) { dispatch('config.set', { key: 'price_menu', value: _clone(_pmDraft) }); showToast('Price menu saved'); }
  pmEditorClearDraft();
  if (go) go();
}
export function pmUnsavedDiscard() {
  const go = _pmPendingLeave; _pmPendingLeave = null; _pmCloseUnsaved();
  pmEditorClearDraft();
  if (go) go();
}
export function pmUnsavedStay() { _pmPendingLeave = null; _pmCloseUnsaved(); }

// ── Pointer drag-and-drop (2b) — mouse + touch; drag a card to another column/position ─────────────
// Delegated pointerdown on the persistent host (set up once); drag starts from a card's grip (.pm-drag).
// A floating ghost follows the pointer; the hovered column is outlined and the card under the pointer gets
// an insert-before line. On drop, pmMoveTo relocates the node (a section carries its rows) and re-renders.
let _dragInit = false, _dragId = null, _dragEl = null, _ghost = null, _dragStart = null, _dragging = false;
function _pmInitDrag() {
  if (_dragInit) return;
  const host = document.getElementById('settings-pricemenu-section'); if (!host) return;
  _dragInit = true;
  host.addEventListener('pointerdown', _pmDragDown);
  // Keyboard: the list rows are role=button/tabindex=0; Enter or Space activates the row's select.
  host.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest && e.target.closest('#settings-pricemenu-section .pm2-item');
    if (row) { e.preventDefault(); row.click(); }
  });
}
function _pmDragDown(e) {
  if (e.button) return;
  const grip = e.target.closest && e.target.closest('.pm-drag'); if (!grip) return;
  const card = grip.closest('.pm2-item'); if (!card || !card.dataset.pmCard) return;
  e.preventDefault(); e.stopPropagation();   // a grip press is a drag, not a row-select
  try { grip.setPointerCapture(e.pointerId); } catch {}   // guarantees pointerup even if released outside the window
  _dragId = card.dataset.pmCard; _dragEl = card; _dragStart = { x: e.clientX, y: e.clientY }; _dragging = false;
  document.addEventListener('pointermove', _pmDragMove);
  document.addEventListener('pointerup', _pmDragUp);
  document.addEventListener('pointercancel', _pmDragUp);
}
function _pmStartDrag() {
  _dragging = true;
  const r = _dragEl.getBoundingClientRect();
  _ghost = _dragEl.cloneNode(true);
  Object.assign(_ghost.style, { position: 'fixed', zIndex: '2147483500', pointerEvents: 'none', width: r.width + 'px', margin: '0', opacity: '0.9', left: (_dragStart.x + 10) + 'px', top: (_dragStart.y + 10) + 'px', boxShadow: '0 10px 28px rgba(0,0,0,.28)', borderRadius: '8px', background: 'var(--surface-container-lowest,#fff)' });
  document.body.appendChild(_ghost);
  _dragEl.style.opacity = '0.4';
}
function _pmClearMarks() {
  const host = document.getElementById('settings-pricemenu-section'); if (!host) return;
  host.querySelectorAll('.pm2-dropline, .pm2-dropline-after').forEach(c => c.classList.remove('pm2-dropline', 'pm2-dropline-after'));
}
// Resolve the row under the pointer (ghost hidden so it doesn't occlude): the hovered list row (if it's a real
// draggable item, excluding the dragged one), whether the drop is a before (top half) or after (bottom half),
// and that row's id. The MODEL (pmDropTarget) turns {overId, before} into {colId, beforeId} — no column DOM.
function _pmDropSpec(x, y) {
  if (_ghost) _ghost.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  if (_ghost) _ghost.style.display = '';
  const rawRow = el && el.closest && el.closest('#settings-pricemenu-section .pm2-item[data-pm-card]');
  let before = true, overId = null;
  if (rawRow && rawRow !== _dragEl) {
    const r = rawRow.getBoundingClientRect();
    before = y < r.top + r.height / 2;
    overId = rawRow.dataset.pmCard;
  }
  return { rawRow, before, overId };
}
function _pmDragMove(e) {
  if (!_dragging) { if (Math.hypot(e.clientX - _dragStart.x, e.clientY - _dragStart.y) < 6) return; _pmStartDrag(); }
  e.preventDefault();
  _ghost.style.left = (e.clientX + 10) + 'px'; _ghost.style.top = (e.clientY + 10) + 'px';
  _pmClearMarks();
  const s = _pmDropSpec(e.clientX, e.clientY);
  if (s.rawRow && s.overId) s.rawRow.classList.add(s.before ? 'pm2-dropline' : 'pm2-dropline-after');   // line matches where it lands
}
function _pmDragUp(e) {
  document.removeEventListener('pointermove', _pmDragMove);
  document.removeEventListener('pointerup', _pmDragUp);
  document.removeEventListener('pointercancel', _pmDragUp);
  const wasDragging = _dragging; _dragging = false;
  const dragId = _dragId;
  if (_ghost) { _ghost.remove(); _ghost = null; }
  if (_dragEl) _dragEl.style.opacity = '';
  if (wasDragging && e.type !== 'pointercancel') {
    const s = _pmDropSpec(e.clientX, e.clientY);
    const t = (s.overId && s.rawRow !== _dragEl) ? pmDropTarget(_pmDraft, dragId, s.overId, s.before) : null;
    if (t) {
      _pmClearMarks();
      const apply = () => { if (pmMoveTo(_pmDraft, dragId, t.colId, t.beforeId)) _pmSel = dragId; _afterStructural(); };
      // Moving to the OTHER printed page is a bigger deal than a reorder → confirm it; a within-page move is silent.
      if (t.crossPage) window.showWarnModal?.('Move to the other page?', 'This changes which printed page the item appears on. Nothing is saved until you tap Save.', apply, 'Move it');
      else apply();
      _dragId = _dragEl = _dragStart = null; return;
    }
  }
  _pmClearMarks();
  _dragId = _dragEl = _dragStart = null;
}
