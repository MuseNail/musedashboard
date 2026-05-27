// ── Lost check-in detection + recovery (Stage 2) ────────────────────────────
// A read-only diagnostic for the "a checked-in customer disappeared" glitch, plus
// one-tap recovery. Three signals, strongest first:
//   A. Pending writes still in the outbox (un-synced — definitely recoverable).
//   B. Failed writes the server rejected (dead-letter — definitely recoverable).
//   C. Square cross-reference: a customer whose Square "Last check-in: <date>" stamp
//      has no matching record/queue entry → a PROBABLE lost check-in (heuristic).
import { getState } from '../store.js';
import { dispatch, failedOps, outboxPending, clearFailedOp, DEVICE_ID } from '../sync.js';
import { customerDirectory } from './square-customers.js';
import { showToast, newEntryId } from '../utils.js';

const cfg = () => getState().config;
const q = () => getState().queue;
const records = () => getState().records || [];
const _digits = s => (s || '').replace(/\D/g, '');
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _dayKey = ms => new Date(ms).toLocaleDateString();

// Square's auto note: "Last check-in: M/D/YYYY | Services: A, B"
function _parseCheckinNote(note) {
  if (!note) return null;
  const m = note.match(/Last check-in:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i);
  if (!m) return null;
  const d = new Date(m[1]); if (isNaN(d)) return null;
  const svc = (note.match(/Services:\s*(.+)$/i) || [])[1] || '';
  return { dateStr: m[1], date: d, services: svc.trim() };
}

// Probable lost check-ins, scoped to a recent window so old "left-without-paying"
// visits (which legitimately have no record) don't flood the list.
function probableLostCheckins(windowDays = 7) {
  const cutoff = Date.now() - windowDays * 86400000;
  const have = new Set();   // `${phoneDigits}|${day}` we DO have a record or queue entry for
  records().forEach(r => { if (r.status === 'deleted') return; have.add(_digits(r.phone) + '|' + _dayKey(new Date(r.checkinTime).getTime())); });
  q().forEach(e => have.add(_digits(e.phone) + '|' + _dayKey(new Date(e.checkinTime).getTime())));
  const out = [];
  (customerDirectory || []).forEach(c => {
    const p = _parseCheckinNote(c.note);
    if (!p) return;
    const t = p.date.getTime();
    if (t < cutoff) return;
    if (!_digits(c.phone)) return;   // can't cross-reference without a phone
    if (have.has(_digits(c.phone) + '|' + _dayKey(t))) return;   // we have it → fine
    out.push({ squareId: c.squareId, name: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown', phone: c.phone, dateStr: p.dateStr, services: p.services });
  });
  return out.sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
}

function _entryName(op, payload) {
  if (op === 'queue.upsert') return payload?.entry?.name || '(queue entry)';
  if (op === 'record.save') return payload?.record?.name || '(transaction)';
  return op;
}

// ── Recovery actions ──────────────────────────────
export function recoveryRestoreFailed(mutationId) {
  const item = failedOps().find(x => x.mutationId === mutationId);
  if (!item) { showToast('Item no longer available'); return; }
  if (item.op === 'queue.upsert' && item.payload?.entry) {
    dispatch('queue.upsert', { entry: { ...item.payload.entry, id: newEntryId() } });
    showToast('Restored to queue ✓');
  } else if (item.op === 'record.save' && item.payload?.record) {
    dispatch('record.save', { record: { ...item.payload.record, id: newEntryId() } });
    showToast('Transaction restored ✓');
  } else { showToast('This item can’t be auto-restored'); return; }
  clearFailedOp(mutationId);
  renderRecoveryReport();
}
export function recoveryDismissFailed(mutationId) { clearFailedOp(mutationId); showToast('Dismissed'); renderRecoveryReport(); }

export function recoveryReaddCheckin(squareId) {
  const lost = probableLostCheckins(3650).find(x => x.squareId === squareId);   // wide window for the explicit re-add
  if (!lost) { showToast('No longer found'); return; }
  const svcIds = (lost.services || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(label => (cfg().services || []).find(sv => (sv.label || '').toLowerCase() === label.toLowerCase())?.id).filter(Boolean);
  const entry = { id: newEntryId(), name: lost.name, phone: lost.phone, services: svcIds, status: 'waiting', checkinTime: new Date().toISOString(), isNew: false, skipSquare: true };
  dispatch('queue.upsert', { entry });
  showToast(`${lost.name} re-added to the queue`);
  renderRecoveryReport();
}

// ── Render ────────────────────────────────────────
export function renderRecoveryReport() {
  const el = document.getElementById('recovery-content');
  if (!el) return;
  const dataOps = op => op === 'queue.upsert' || op === 'record.save';
  const pending = outboxPending().filter(m => dataOps(m.op));
  const failed = failedOps();
  const lost = probableLostCheckins();

  const section = (title, sub, body) => `<div class="mb-5">
    <div class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest mb-1">${title}</div>
    <p class="text-xs font-body text-on-surface-variant mb-2">${sub}</p>${body}</div>`;
  const none = msg => `<div class="text-sm font-body text-on-surface-variant py-2 opacity-70">${msg}</div>`;

  // A — pending (un-synced) writes
  const pendingHtml = pending.length ? pending.map(m => {
    const mine = m.device === DEVICE_ID;
    return `<div class="bg-surface-container rounded-xl px-4 py-2.5 mb-1.5 border border-surface-container-high flex items-center justify-between gap-2">
      <div class="min-w-0"><div class="font-headline font-semibold text-on-surface text-sm truncate">${_esc(_entryName(m.op, m.payload))}</div>
      <div class="text-[11px] font-body text-on-surface-variant">${m.op} · ${mine ? 'this device' : 'another device'}</div></div>
      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style="background:#f5c870;color:#3a2800">Syncing…</span>
    </div>`;
  }).join('') : none('Nothing waiting to sync — all writes are confirmed.');

  // B — failed (rejected) writes
  const failedHtml = failed.length ? failed.slice().reverse().map(f => {
    const when = f.at ? new Date(f.at).toLocaleString() : '—';
    const restorable = (f.op === 'queue.upsert' && f.payload?.entry) || (f.op === 'record.save' && f.payload?.record);
    return `<div class="bg-surface-container rounded-xl px-4 py-3 mb-1.5 border border-error/40">
      <div class="flex items-center justify-between gap-2 mb-1"><div class="min-w-0"><span class="font-headline font-semibold text-on-surface text-sm">${_esc(_entryName(f.op, f.payload))}</span></div><span class="text-[11px] text-outline flex-shrink-0">${when}</span></div>
      <div class="text-[11px] font-body text-on-surface-variant mb-2">${f.op} · ${_esc(f.error || 'rejected')}</div>
      <div class="flex gap-2">
        ${restorable ? `<button onclick="recoveryRestoreFailed('${_esc(f.mutationId)}')" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-body font-semibold">Restore to queue</button>` : ''}
        <button onclick="recoveryDismissFailed('${_esc(f.mutationId)}')" class="px-3 py-1.5 rounded-lg border border-surface-container-high text-on-surface-variant text-xs font-body font-semibold">Dismiss</button>
      </div></div>`;
  }).join('') : none('No failed writes recorded.');

  // C — probable lost check-ins (Square cross-reference)
  const lostHtml = lost.length ? lost.map(l => `<div class="bg-surface-container rounded-xl px-4 py-3 mb-1.5 border border-surface-container-high">
      <div class="flex items-center justify-between gap-2 mb-1"><span class="font-headline font-semibold text-on-surface text-sm truncate">${_esc(l.name)}</span><span class="text-[11px] text-outline flex-shrink-0">checked in ${_esc(l.dateStr)}</span></div>
      <div class="text-[11px] font-body text-on-surface-variant mb-2">${_esc(l.phone || 'no phone')}${l.services ? ' · ' + _esc(l.services) : ''}</div>
      <button onclick="recoveryReaddCheckin('${_esc(l.squareId)}')" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-body font-semibold">Re-add to queue</button>
    </div>`).join('') : none('None found in the last 7 days. (Square says a customer checked in, but we have no record — these are usually customers who left without paying.)');

  el.innerHTML =
    section('Waiting to sync', 'Writes from this device not yet confirmed by the server. These send automatically on reconnect.', pendingHtml) +
    section('Failed writes', 'Writes the server rejected. Restore re-adds the customer/transaction to the queue.', failedHtml) +
    section('Possible lost check-ins (last 7 days)', 'Square recorded a check-in but the app has no matching record. Re-add puts them back in the queue.', lostHtml);
}
