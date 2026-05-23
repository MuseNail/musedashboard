// ── Gift cards + backup/restore utilities ───────────────────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, todayStr, localDateStr } from '../utils.js';
import { APP_NAME, APP_VERSION } from '../config.js';

const giftCards = () => getState().giftcards;

let _gcSortField = 'datePurchased', _gcSortDir = 'desc', _gcHideZero = false;

export function showAddGiftCard() {
  document.getElementById('gc-modal-title').textContent = 'New Gift Card';
  ['gc-edit-id','gc-serial','gc-amount','gc-phone','gc-from','gc-to','gc-date-used','gc-amount-used','gc-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('gc-date').value = todayStr();
  const m = document.getElementById('gc-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => document.getElementById('gc-serial').focus(), 100);
}
export function showEditGiftCard(id) {
  const gc = giftCards().find(g => g.id === id);
  if (!gc) return;
  document.getElementById('gc-modal-title').textContent = 'Edit Gift Card';
  document.getElementById('gc-edit-id').value = id;
  document.getElementById('gc-date').value = gc.datePurchased || '';
  document.getElementById('gc-serial').value = gc.serial || '';
  document.getElementById('gc-amount').value = gc.amount || '';
  document.getElementById('gc-phone').value = gc.phone || '';
  document.getElementById('gc-from').value = gc.from || '';
  document.getElementById('gc-to').value = gc.to || '';
  document.getElementById('gc-date-used').value = gc.dateUsed || '';
  document.getElementById('gc-amount-used').value = gc.amountUsed || '';
  document.getElementById('gc-notes').value = gc.notes || '';
  const m = document.getElementById('gc-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeGcModal() { const m = document.getElementById('gc-modal'); m.classList.add('hidden'); m.style.display = ''; }

export function saveGiftCard() {
  const editId = document.getElementById('gc-edit-id').value;
  const existing = editId ? giftCards().find(g => g.id === editId) : null;
  const card = {
    id: editId || 'gc-' + Date.now(),
    datePurchased: document.getElementById('gc-date').value,
    serial: document.getElementById('gc-serial').value.trim(),
    amount: parseFloat(document.getElementById('gc-amount').value) || 0,
    phone: document.getElementById('gc-phone').value.trim(),
    from: document.getElementById('gc-from').value.trim(),
    to: document.getElementById('gc-to').value.trim(),
    dateUsed: document.getElementById('gc-date-used').value,
    amountUsed: parseFloat(document.getElementById('gc-amount-used').value) || 0,
    notes: document.getElementById('gc-notes').value.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  dispatch('giftcard.save', { card });
  closeGcModal();
  renderGiftCards();
  showToast(editId ? 'Gift card updated ✓' : 'Gift card added ✓');
}
export function deleteGiftCard(id) {
  window.showWarnModal?.('Delete gift card?', 'This permanently removes this gift card record.', () => {
    dispatch('giftcard.delete', { id });
    renderGiftCards();
    showToast('Gift card deleted');
  });
}

export function setGcSort(field) {
  if (_gcSortField === field) _gcSortDir = _gcSortDir === 'asc' ? 'desc' : 'asc';
  else { _gcSortField = field; _gcSortDir = field === 'datePurchased' ? 'desc' : 'asc'; }
  renderGiftCards();
}
export function toggleGcHideZero() {
  _gcHideZero = !_gcHideZero;
  const btn = document.getElementById('gc-hide-zero-btn'); if (btn) btn.textContent = _gcHideZero ? 'Show $0' : 'Hide $0';
  renderGiftCards();
}

export function renderGiftCards() {
  const list = document.getElementById('gc-list'), empty = document.getElementById('gc-empty');
  if (!list) return;
  const q = (document.getElementById('gc-search')?.value || '').toLowerCase();
  let filtered = giftCards().filter(g => !q || (g.serial||'').toLowerCase().includes(q) || (g.from||'').toLowerCase().includes(q) || (g.to||'').toLowerCase().includes(q) || (g.phone||'').includes(q) || (g.notes||'').toLowerCase().includes(q));
  if (_gcHideZero) filtered = filtered.filter(g => ((g.amount||0) - (g.amountUsed||0)) > 0);
  filtered = [...filtered].sort((a,b) => {
    let av, bv;
    if (_gcSortField === 'amount') { av = a.amount||0; bv = b.amount||0; }
    else if (_gcSortField === 'balance') { av = (a.amount||0)-(a.amountUsed||0); bv = (b.amount||0)-(b.amountUsed||0); }
    else if (_gcSortField === 'serial') { av = a.serial||''; bv = b.serial||''; }
    else if (_gcSortField === 'status') { const order = { Active:0, Partial:1, Redeemed:2 }; const getS = g => { const bal = (g.amount||0)-(g.amountUsed||0); return bal<=0?'Redeemed':g.amountUsed>0?'Partial':'Active'; }; av = order[getS(a)]??3; bv = order[getS(b)]??3; }
    else { av = a.datePurchased||''; bv = b.datePurchased||''; }
    if (av < bv) return _gcSortDir === 'asc' ? -1 : 1;
    if (av > bv) return _gcSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalValue = giftCards().reduce((s,g)=>s+(g.amount||0),0);
  const totalUsed = giftCards().reduce((s,g)=>s+(g.amountUsed||0),0);
  const set = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('gc-total-sold', giftCards().length); set('gc-total-value', '$'+totalValue.toFixed(2)); set('gc-total-used', '$'+totalUsed.toFixed(2)); set('gc-total-balance', '$'+(totalValue-totalUsed).toFixed(2));

  if (filtered.length === 0) { list.innerHTML = ''; empty?.classList.remove('hidden'); document.getElementById('gc-headers')?.classList.add('hidden'); return; }
  empty?.classList.add('hidden'); document.getElementById('gc-headers')?.classList.remove('hidden');
  const formatDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null;
  list.innerHTML = filtered.map(g => {
    const balance = (g.amount||0) - (g.amountUsed||0);
    const isRedeemed = balance <= 0 && (g.dateUsed || g.amountUsed > 0);
    const isPartial = g.amountUsed > 0 && balance > 0;
    const sc = isRedeemed ? { bg:'rgba(200,230,197,0.2)', border:'#2a7a4f', label:'Redeemed', lc:'#2a7a4f' } : isPartial ? { bg:'rgba(255,224,178,0.2)', border:'#d4860a', label:'Partial', lc:'#a05000' } : { bg:'', border:'#c8d4d8', label:'Active', lc:'#1a5252' };
    return `<div class="rounded-xl border flex items-center gap-0 overflow-hidden" style="background:${sc.bg};border-color:${sc.border}">
      <div class="flex-shrink-0 flex items-center justify-center font-headline font-extrabold text-xl px-4 self-stretch" style="width:88px;background:${sc.border}22;border-right:1px solid ${sc.border}40;color:${sc.lc}">$${(g.amount||0).toFixed(0)}</div>
      <div class="flex-shrink-0 flex items-center justify-center px-3" style="width:96px"><span class="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style="background:${sc.border}20;color:${sc.lc}">${sc.label}</span></div>
      <div class="flex-shrink-0 text-xs font-body font-semibold text-on-surface px-2" style="width:90px">${g.serial ? '#'+g.serial : '—'}</div>
      <div class="flex-shrink-0 text-xs font-body text-on-surface-variant px-2" style="width:96px">${g.datePurchased ? formatDate(g.datePurchased) : '—'}</div>
      <div class="flex-shrink-0 text-xs font-body px-2 truncate" style="width:110px">${g.from ? `<span class="text-on-surface-variant">From: </span><span class="text-on-surface">${g.from}</span>` : '<span class="text-outline-variant">—</span>'}</div>
      <div class="flex-shrink-0 text-xs font-body px-2 truncate" style="width:110px">${g.to ? `<span class="text-on-surface-variant">To: </span><span class="text-on-surface">${g.to}</span>` : '<span class="text-outline-variant">—</span>'}</div>
      <div class="flex-shrink-0 text-xs font-body text-on-surface-variant px-2" style="width:110px">${g.phone || '—'}</div>
      <div class="flex-grow min-w-0 text-xs font-body text-on-surface-variant italic truncate px-2">${g.notes || ''}</div>
      <div class="flex-shrink-0 text-right px-3 py-3" style="width:90px"><div class="text-[10px] text-on-surface-variant leading-none mb-0.5">Balance</div><div class="text-base font-headline font-extrabold leading-none" style="color:${balance>0?'#1a5252':'#aaa'}">$${balance.toFixed(2)}</div>${g.amountUsed>0?`<div class="text-[10px] text-on-surface-variant mt-0.5">$${g.amountUsed.toFixed(2)} used</div>`:''}</div>
      <div class="flex-shrink-0 flex gap-1 px-2">
        <button onclick="showEditGiftCard('${g.id}')" title="Edit" class="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors active:scale-95"><span class="material-symbols-outlined" style="font-size:18px">edit</span></button>
        <button onclick="deleteGiftCard('${g.id}')" title="Delete" class="w-9 h-9 rounded-xl bg-surface-container hover:bg-error/15 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors active:scale-95"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
      </div></div>`;
  }).join('');
}

// ── Backup / restore / clear ──────────────────────
export function exportAllData() {
  const s = getState();
  const backup = { exportedAt: new Date().toISOString(), appVersion: APP_NAME + '-' + APP_VERSION, state: { config: s.config, queue: s.queue, records: s.records, giftcards: s.giftcards } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `muse-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(url);
  const now = new Date().toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
  localStorage.setItem('muse_last_backup', now);
  const lbl = document.getElementById('last-backup-label'); if (lbl) lbl.textContent = now;
  showToast('Backup downloaded ✓');
}

export function importAllData(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      const st = backup.state || backup.data;
      if (!st) { showToast('Invalid backup file.'); return; }
      if (!confirm(`Restore backup from ${backup.exportedAt?.slice(0,10) || 'unknown date'}?\n\nThis pushes the backup into the shared store for all devices.`)) return;
      if (st.config) Object.entries(st.config).forEach(([key, value]) => dispatch('config.set', { key, value }));
      (st.queue || []).forEach(entry => dispatch('queue.upsert', { entry }));
      (st.records || []).forEach(record => dispatch('record.save', { record }));
      (st.giftcards || []).forEach(card => dispatch('giftcard.save', { card }));
      showToast('Backup restored ✓');
      window.renderQueue?.(); window.renderTurns?.(); window.setLogo?.();
    } catch (err) { showToast('Failed to read backup file.'); console.error(err); }
  };
  reader.readAsText(file);
  input.value = '';
}

export function confirmClearAllRecords() {
  // Require an admin code first (destructive + irreversible), then the usual confirm.
  window.requireAdminCode?.(() => {
    window.showWarnModal?.('Clear All Records?', 'This permanently removes every transaction record. Export a backup first if you need this data.', () => {
      getState().records.forEach(r => { if (r.status !== 'deleted') dispatch('record.delete', { id: r.id, reason: 'bulk clear', by: 'admin' }); });
      localStorage.removeItem('muse_deletion_log');
      window.renderTransactions?.(); window.runReport?.();
      showToast('All records cleared ✓');
    });
  }, 'Clearing all records requires an admin PIN.');
}
