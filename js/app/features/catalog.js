// ── Services / Items / Fees CRUD + dashboard visibility ─────────────────────
// Canonical config-write pattern: read arrays from the store, write via
// dispatch('config.set', { key, value: newArray }) (immutable update). The store
// applies optimistically + the DO broadcasts to other devices. No Sheets, no globals.

import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, setSwitchVisual, escHtml } from '../utils.js';

const cfg = () => getState().config;

// ── Inline-editor pure cores (Item 1) ────────────────────────────────────────
// Save merges ONE row into the LIVE array read at save-time — never a whole-array snapshot taken when
// the row went dirty — so a service/item added or edited on ANOTHER device during the edit window is
// preserved, not clobbered (the per-key stale guard can't merge two whole-array writes). Immutable.
export function mergeCatalogRow(arr, id, fields) {
  const list = Array.isArray(arr) ? arr : [];
  const i = list.findIndex(x => x && x.id === id);
  if (i >= 0) return list.map((x, idx) => idx === i ? { ...x, ...fields } : x);
  return [...list, { id, ...fields }];
}
// Required name/abbr + dup-name (lifted from the retired modal saveService). Pure: returns an error
// string to toast, or null when valid.
export function validateServiceFields(fields, services, id) {
  const label = (fields.label || '').trim(), abbr = (fields.abbr || '').trim();
  if (!label) return 'Please enter a service name.';
  if (!abbr)  return 'Please enter an abbreviation.';
  const dup = (services || []).find(s => s.label.toLowerCase() === label.toLowerCase() && s.id !== id);
  if (dup) return `"${label}" already exists as a service.`;
  return null;
}
// Does a row's live draft differ from what's stored? Drives the per-row Save button + the leave guard.
// A new (not-yet-saved) row is always dirty. Numbers are compared numerically so 30 === "30".
export function catalogRowDirty(kind, draft, row) {
  if (!row) return true;
  const s = v => (v == null ? '' : String(v));
  const n = v => (v === '' || v == null ? '' : String(Number(v)));
  if (kind === 'service') {
    return s(draft.label) !== s(row.label) || s(draft.abbr) !== s(row.abbr)
      || n(draft.baseCost) !== n(row.baseCost) || s(draft.desc).trim() !== s(row.desc).trim();
  }
  return s(draft.label) !== s(row.label) || s(draft.abbr) !== s(row.abbr) || n(draft.price) !== n(row.price);
}

// ── Inline edit model (Item 1) — Services & Retail Items ──────────────────────
// Both lists edit inline: every field is editable at a click. At most ONE row is "dirty" at a time
// (`_editing`); its Save/Revert appear only once a field changes. Switching rows or leaving the
// Settings section with unsaved edits opens a 3-button Save / Discard / Keep-editing modal. Save
// re-reads the LIVE array and merges only this one row (mergeCatalogRow), so a concurrent edit to a
// different row on another device is never clobbered. This guard is the catalog's OWN — the live
// price-menu guard (pmGuardLeave/pm-unsaved-modal) is left completely untouched.
let _editing = null;               // { kind:'service'|'item', id, draft } | null
let _pendingProceed = null;        // nav/switch to run after the guard resolves

const _storeRowOf = (kind, id) => ((kind === 'service' ? cfg().services : cfg().items) || []).find(r => r && r.id === id) || null;
const _isEditing = (kind, id) => !!_editing && _editing.kind === kind && _editing.id === id;
const _rowDirty  = () => !!_editing && catalogRowDirty(_editing.kind, _editing.draft, _storeRowOf(_editing.kind, _editing.id));
export function catalogHasUnsaved() { return _rowDirty(); }

function _draftFromStore(kind, id) {
  const r = _storeRowOf(kind, id) || {};
  return kind === 'service'
    ? { label: r.label || '', abbr: r.abbr || '', baseCost: r.baseCost != null ? r.baseCost : '', desc: r.desc || '' }
    : { label: r.label || '', abbr: r.abbr || '', price: r.price != null ? r.price : '' };
}
function _startEdit(kind, id) { if (!_isEditing(kind, id)) _editing = { kind, id, draft: _draftFromStore(kind, id) }; }
// Run `fn` now if nothing is dirty; otherwise prompt (Save/Discard → then fn; Keep editing → cancel).
function _guardThen(fn) { if (_rowDirty()) _openCatalogGuard(fn); else fn(); }

// Commit the one editing row into the LIVE array. Returns false (and toasts) when invalid, so the
// caller can keep the user on the row instead of navigating away.
function _commitEditing() {
  if (!_editing) return true;
  const { kind, id, draft } = _editing;
  if (kind === 'service') {
    const err = validateServiceFields(draft, cfg().services, id);
    if (err) { showToast(err); return false; }
    const bc = parseFloat(draft.baseCost);
    // desc is ALWAYS written (empty string included) so clearing a description actually persists through
    // the merge spread; baseCost falls back to null on a non-numeric entry (no NaN written/synced).
    const fields = { label: draft.label.trim(), abbr: draft.abbr.trim(),
      baseCost: (draft.baseCost === '' || draft.baseCost == null || !Number.isFinite(bc)) ? null : bc,
      desc: (draft.desc || '').trim() };
    dispatch('config.set', { key: 'services', value: mergeCatalogRow(cfg().services, id, fields) });
    showToast('Service saved');
  } else {
    if (!(draft.label || '').trim()) { showToast('Please enter an item name.'); return false; }
    const pr = parseFloat(draft.price);
    const fields = { label: draft.label.trim(), abbr: (draft.abbr || '').trim(), price: Number.isFinite(pr) ? pr : 0 };
    dispatch('config.set', { key: 'items', value: mergeCatalogRow(cfg().items, id, fields) });
    showToast('Item saved');
  }
  _editing = null;
  return true;
}
function _renderCatalog() { renderServicesMerged(); renderSettingsItems(); }

// Per-row Save / Revert (window-glued for the inline buttons).
export function catalogSaveRow()   { if (_commitEditing()) _renderCatalog(); }
export function catalogRevertRow() { _editing = null; _renderCatalog(); }

// 3-button unsaved-changes guard modal (catalog's own; sibling of the price-menu one).
function _openCatalogGuard(onProceed) {
  const m = document.getElementById('catalog-unsaved-modal');
  if (!m) { if (onProceed) onProceed(); return; }   // no modal available → don't trap the user
  _pendingProceed = onProceed || null;
  m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => m.querySelector('button')?.focus(), 30);   // focus the primary (Save and continue) button
}
function _closeCatalogGuard() { const m = document.getElementById('catalog-unsaved-modal'); if (m) { m.classList.add('hidden'); m.style.display = ''; } }
export function catalogUnsavedSave() {
  if (!_commitEditing()) { _closeCatalogGuard(); _pendingProceed = null; _renderCatalog(); return; }   // invalid → stay on the row to fix
  const go = _pendingProceed; _pendingProceed = null; _closeCatalogGuard(); _renderCatalog();
  if (go) go();
}
export function catalogUnsavedDiscard() {
  const go = _pendingProceed; _pendingProceed = null; _editing = null; _closeCatalogGuard(); _renderCatalog();
  if (go) go();
}
export function catalogUnsavedStay() { _pendingProceed = null; _closeCatalogGuard(); }
// Core-nav chokepoints call this (parallel to pmGuardLeave). Inert unless a catalog row is dirty.
export function catalogGuardLeave(onLeave) {
  if (!_rowDirty()) { _editing = null; if (onLeave) onLeave(); return; }
  _openCatalogGuard(() => { if (onLeave) onLeave(); });
}

// Delegated listeners on each list container (bound once; the container survives innerHTML re-renders).
// Also binds a one-time beforeunload warning. Bound lazily (never at import) so the module stays
// side-effect-free under the test harness.
let _catBeforeUnloadBound = false;
function _ensureCatalogListeners() {
  if (!_catBeforeUnloadBound && typeof window !== 'undefined' && window.addEventListener) {
    _catBeforeUnloadBound = true;
    window.addEventListener('beforeunload', e => { if (_rowDirty()) { e.preventDefault(); e.returnValue = ''; return ''; } });
  }
  ['services-merged-list', 'settings-items-list'].forEach(cid => {
    const el = document.getElementById(cid);
    if (!el || el._catBound) return;
    el._catBound = true;
    el.addEventListener('pointerdown', _catPointerDown, true);   // capture: intercept a click into another row while dirty
    el.addEventListener('focusin', _catFocusIn);
    el.addEventListener('input', _catInput);
    el.addEventListener('keydown', _catKeyDown);
  });
}
function _catRowOf(target) { const row = target.closest && target.closest('[data-cat-row]'); if (!row) return null; const [kind, id] = row.dataset.catRow.split(':'); return { row, kind, id }; }
function _catPointerDown(ev) {
  if (ev.target.closest && ev.target.closest('button')) return;   // let action buttons (Save/Revert/Delete/toggle) run their own guards
  const r = _catRowOf(ev.target); if (!r) return;
  if (_isEditing(r.kind, r.id) || !_rowDirty()) return;   // same row, or nothing dirty → allow
  ev.preventDefault(); ev.stopPropagation();              // different row + dirty → block the click, prompt first
  _openCatalogGuard(() => { _startEdit(r.kind, r.id); _renderCatalog(); });
}
// Enter saves the dirty row, Esc reverts it (plan item G keyboard/a11y). IME composition is left alone.
function _catKeyDown(ev) {
  if (!_rowDirty() || !ev.target.closest('[data-cat-row]')) return;
  if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); catalogSaveRow(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); catalogRevertRow(); }
}
function _catFocusIn(ev) {
  if (!ev.target.matches || !ev.target.matches('input,textarea')) return;
  const r = _catRowOf(ev.target); if (!r || _isEditing(r.kind, r.id)) return;
  if (_rowDirty()) { ev.target.blur(); _openCatalogGuard(() => { _startEdit(r.kind, r.id); _renderCatalog(); }); return; }   // keyboard Tab into another row
  _startEdit(r.kind, r.id);   // clean switch — values already shown from store, no re-render needed
}
function _catInput(ev) {
  const inp = ev.target, field = inp.dataset && inp.dataset.field; if (!field) return;
  const r = _catRowOf(inp); if (!r) return;
  _startEdit(r.kind, r.id);
  _editing.draft[field] = inp.value;
  r.row.classList.toggle('cat-dirty', _rowDirty());   // show/hide Save-Revert without a re-render (keeps the caret)
}
function _focusCatField(kind, id) {
  setTimeout(() => {
    const esc = (window.CSS && CSS.escape) ? CSS.escape(kind + ':' + id) : kind + ':' + id;
    document.querySelector(`[data-cat-row="${esc}"] input[data-field="label"]`)?.focus();
  }, 30);
}

// Save/Revert button pair + delete button, shared by both row renderers.
function _rowActions(deleteFn, id) {
  return `<div class="cat-save-wrap items-center gap-1.5 ml-auto">
      <button onclick="catalogSaveRow()" class="btn-primary" style="padding:4px 12px;font-size:13px">Save</button>
      <button onclick="catalogRevertRow()" class="text-xs font-body font-semibold text-on-surface-variant hover:text-on-surface px-2 py-1">Revert</button>
    </div>
    <button onclick="${deleteFn}('${id}')" title="Delete" class="cat-del w-9 h-9 rounded-full hover:bg-error/10 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors flex-shrink-0">
      <span class="material-symbols-outlined" style="font-size:18px">delete</span>
    </button>`;
}
// `attrs` carries extra HTML attributes (e.g. maxlength on abbr, inputmode="decimal" on the money fields
// so the iPad shows the numeric keypad — matching the retired modal / old items row).
const _fInput = (field, val, ph, cls, attrs) => `<input data-field="${field}" ${attrs || ''} value="${escHtml(val == null ? '' : String(val))}" placeholder="${escHtml(ph)}" aria-label="${escHtml(ph)}" class="bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none ${cls || ''}">`;

// ── Services (inline: name / abbr / base / description + check-in & dashboard toggles + Save/Delete) ──
export function renderServicesMerged() {
  const list = document.getElementById('services-merged-list');
  if (!list) return;
  _ensureCatalogListeners();
  const svcs = cfg().services;
  const pendingNew = _editing && _editing.kind === 'service' && !svcs.some(s => s.id === _editing.id);
  if (!svcs.length && !pendingNew) { list.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-4 text-center">No services yet. Add one to get started.</p>'; return; }
  let html = svcs.map(s => _serviceRowHtml(s)).join('');
  if (pendingNew) html += _serviceRowHtml(null);
  list.innerHTML = html;
}
function _serviceRowHtml(s) {
  const id = s ? s.id : _editing.id;
  const editing = _isEditing('service', id);
  const v = editing ? _editing.draft : s;
  const dirty = editing && _rowDirty();
  const checkin = isServiceVisibleOnCheckin(id);
  const dash    = isServiceVisibleOnDash(id);
  const toggle = (on, label, fn, title) => `
    <button onclick="${fn}('${id}',this)" title="${title}" class="flex flex-col items-center gap-1 flex-shrink-0 px-1 py-1">
      <span class="text-[9px] font-body uppercase tracking-wider ${on ? 'text-primary' : 'text-outline-variant'}">${label}</span>
      <div class="mswitch relative w-14 h-7 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-surface-container-high'}"><div class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-0.5'}"></div></div>
    </button>`;
  return `
  <div class="cat-row${dirty ? ' cat-dirty' : ''} bg-surface-container-lowest rounded-xl px-4 py-3 border border-surface-container-high" data-cat-row="service:${id}">
    <div class="cat-fields flex items-center gap-2 flex-wrap">
      ${_fInput('label', v && v.label, 'Service name', 'flex-1 min-w-[140px] font-headline font-semibold')}
      ${_fInput('abbr', v && v.abbr, 'Abbr', 'w-16 text-center font-semibold', 'maxlength="4"')}
      <div class="flex items-center gap-1"><span class="text-sm text-on-surface-variant">$</span>${_fInput('baseCost', v && (v.baseCost != null && v.baseCost !== '' ? v.baseCost : ''), '0.00', 'w-20 text-right', 'inputmode="decimal"')}</div>
      ${_fInput('desc', v && v.desc, 'Description (optional)', 'flex-1 min-w-[180px]')}
    </div>
    <div class="cat-actions flex items-center gap-3 mt-2 flex-wrap">
      ${s ? toggle(checkin, 'Check-in', 'toggleCheckinService', 'Show on the customer check-in screen') : ''}
      ${s ? toggle(dash, 'Dashboard', 'toggleDashService', 'Show in Assign, Turns, Queue & Calendar') : ''}
      ${_rowActions('deleteService', id)}
    </div>
  </div>`;
}

export function showAddService() {
  _guardThen(() => { _editing = { kind: 'service', id: `svc-${Date.now()}`, draft: { label: '', abbr: '', baseCost: '', desc: '' } }; renderServicesMerged(); _focusCatField('service', _editing.id); });
}

export function deleteService(id) {
  const svc = cfg().services.find(s => s.id === id);
  if (!svc) { if (_isEditing('service', id)) { _editing = null; renderServicesMerged(); } return; }   // the pending new row
  if (!_isEditing('service', id) && _rowDirty()) { _openCatalogGuard(() => deleteService(id)); return; }   // a different row is dirty
  if (!confirm(`Remove "${svc.label}" from services?`)) return;
  if (_isEditing('service', id)) _editing = null;
  dispatch('config.set', { key: 'services', value: cfg().services.filter(s => s.id !== id) });
  renderServicesMerged();
  showToast(`"${svc.label}" removed`);
}

// ── Customer check-in service visibility (config.hidden_services) ─────────────
export function isServiceVisibleOnCheckin(id) { return !cfg().hidden_services.includes(id); }
export function toggleCheckinService(id, btn) {
  const hidden = cfg().hidden_services;
  const nowVisible = hidden.includes(id);   // currently hidden → toggling turns it on
  dispatch('config.set', { key: 'hidden_services', value: hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id] });
  if (btn) setSwitchVisual(btn, nowVisible); else renderServicesMerged();
}
export function toggleAllCheckinServices() {
  dispatch('config.set', { key: 'hidden_services', value: cfg().hidden_services.length === 0 ? cfg().services.map(s => s.id) : [] });
  renderServicesMerged();
}

// ── Dashboard service visibility (config.hidden_dash_services) ────────────────
export function isServiceVisibleOnDash(id) { return !cfg().hidden_dash_services.includes(id); }

export function toggleDashService(id, btn) {
  const hidden = cfg().hidden_dash_services;
  const nowVisible = hidden.includes(id);   // currently hidden → toggling turns it on
  const next = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
  dispatch('config.set', { key: 'hidden_dash_services', value: next });
  if (btn) setSwitchVisual(btn, nowVisible); else renderServicesMerged();
}

export function toggleAllDashServices() {
  const next = cfg().hidden_dash_services.length === 0 ? cfg().services.map(s => s.id) : [];
  dispatch('config.set', { key: 'hidden_dash_services', value: next });
  renderServicesMerged();
}

// ── Items (inline: name / abbr / price + Save/Delete — same one-dirty-row model as Services) ──
export function renderSettingsItems() {
  const container = document.getElementById('settings-items-list');
  if (!container) return;
  _ensureCatalogListeners();
  const items = cfg().items;
  const pendingNew = _editing && _editing.kind === 'item' && !items.some(it => it.id === _editing.id);
  let html = items.map(it => _itemRowHtml(it)).join('');
  if (pendingNew) html += _itemRowHtml(null);
  container.innerHTML = html || '<p class="text-sm text-on-surface-variant py-2">No items yet.</p>';
}
function _itemRowHtml(it) {
  const id = it ? it.id : _editing.id;
  const editing = _isEditing('item', id);
  const v = editing ? _editing.draft : it;
  const dirty = editing && _rowDirty();
  return `
  <div class="cat-row${dirty ? ' cat-dirty' : ''} py-2 border-b border-surface-container-high last:border-0" data-cat-row="item:${id}">
    <div class="cat-fields flex items-center gap-2">
      ${_fInput('label', v && v.label, 'Item name', 'flex-1')}
      ${_fInput('abbr', v && v.abbr, 'Abbr', 'w-16 text-center font-semibold', 'maxlength="4"')}
      <div class="flex items-center gap-1"><span class="text-sm text-on-surface-variant">$</span>${_fInput('price', v && (v.price != null && v.price !== '' ? v.price : ''), '0.00', 'w-20 text-right', 'inputmode="decimal"')}</div>
      ${_rowActions('removeItem', id)}
    </div>
  </div>`;
}
export function addItemRow() {
  _guardThen(() => { _editing = { kind: 'item', id: 'item-' + Date.now(), draft: { label: '', abbr: '', price: '' } }; renderSettingsItems(); _focusCatField('item', _editing.id); });
}
export function removeItem(id) {
  const it = cfg().items.find(x => x && x.id === id);
  if (!it) { if (_isEditing('item', id)) { _editing = null; renderSettingsItems(); } return; }   // the pending new row
  if (!_isEditing('item', id) && _rowDirty()) { _openCatalogGuard(() => removeItem(id)); return; }
  if ((it.label || it.price) && !confirm(`Remove "${it.label || 'this item'}"?`)) return;
  if (_isEditing('item', id)) _editing = null;
  dispatch('config.set', { key: 'items', value: cfg().items.filter(x => x.id !== id) });
  renderSettingsItems();
}

// ── Fees ──────────────────────────────────────────
function setFees(fees) { dispatch('config.set', { key: 'fees', value: fees }); }

export function renderSettingsFees() {
  const container = document.getElementById('settings-fees-list');
  if (!container) return;
  container.innerHTML = cfg().fees.map((fee, i) => `
    <div class="flex items-center gap-2 py-2 border-b border-surface-container-high last:border-0">
      <input type="text" value="${fee.label}" placeholder="Fee name"
        onchange="updateFeeField(${i},'label',this.value)"
        class="flex-1 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none">
      <select onchange="updateFeeField(${i},'type',this.value)"
        class="bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none">
        <option value="flat"    ${fee.type==='flat'   ?'selected':''}>Flat $</option>
        <option value="percent" ${fee.type==='percent'?'selected':''}>Percent %</option>
      </select>
      <input type="text" inputmode="decimal" value="${fee.value || ''}" placeholder="0"
        onchange="updateFeeField(${i},'value',this.value)"
        class="w-16 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none text-right">
      <button onclick="removeFee(${i})" class="text-outline-variant hover:text-error transition-colors">
        <span class="material-symbols-outlined" style="font-size:16px">delete</span>
      </button>
    </div>`).join('') || '<p class="text-sm text-on-surface-variant py-2">No fees yet.</p>';
}

export function updateFeeField(i, field, value) {
  const fees = cfg().fees.map((f, idx) => idx === i ? { ...f, [field]: field === 'value' ? (parseFloat(value) || 0) : value } : f);
  setFees(fees);
}
export function addFeeRow() {
  setFees([...cfg().fees, { id: 'fee-' + Date.now(), label: '', type: 'flat', value: 0 }]);
  renderSettingsFees();
}
export function removeFee(i) {
  const f = cfg().fees[i];
  if (f && (f.label || f.value) && !confirm(`Remove "${f.label || 'this fee'}"?`)) return;
  setFees(cfg().fees.filter((_, idx) => idx !== i));
  renderSettingsFees();
}
