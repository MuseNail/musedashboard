// ── Quick Sale — no-service retail / gift-card checkout ─────────────────────
// Sell retail items (and, in a later phase, gift cards) WITHOUT checking a customer in or
// assigning a service. Builds a transient no-service ticket and hands it to the same Confirm
// Payment screen as a normal sale — so the charge, the Square/Helcim toggle, split tender and
// the recorded transaction are all identical. Tagged quickSale so it's excluded from Guests Served.
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { getActiveUser } from '../session.js';
import { showToast, newEntryId } from '../utils.js';

const cfg = () => getState().config;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let _qsCart = [];   // [{ itemId, label, price, qty }]

export function openQuickSale() {
  _qsCart = [];
  const nm = document.getElementById('qs-name'); if (nm) nm.value = '';
  const sb = document.getElementById('qs-soldby'); if (sb) sb.textContent = getActiveUser()?.name || '—';
  renderQuickSale();
  const m = document.getElementById('quicksale-modal'); if (m) { m.classList.remove('hidden'); m.style.display = 'flex'; }
  setTimeout(() => document.getElementById('qs-name')?.focus(), 80);
}
export function closeQuickSale() { const m = document.getElementById('quicksale-modal'); if (m) { m.classList.add('hidden'); m.style.display = ''; } }

const _items = () => (cfg().items || []).filter(i => i && !i.hidden);
const _qsTotal = () => _qsCart.reduce((s, c) => s + (c.price || 0) * c.qty, 0);

export function qsAddItem(itemId) {
  const it = (cfg().items || []).find(i => i.id === itemId); if (!it) return;
  const ex = _qsCart.find(c => c.itemId === itemId);
  if (ex) ex.qty++; else _qsCart.push({ itemId, label: it.label, price: it.price || 0, qty: 1 });
  renderQuickSale();
}
export function qsSetQty(itemId, delta) {
  const c = _qsCart.find(x => x.itemId === itemId); if (!c) return;
  c.qty += delta;
  if (c.qty <= 0) _qsCart = _qsCart.filter(x => x.itemId !== itemId);
  renderQuickSale();
}

export function renderQuickSale() {
  const cat = document.getElementById('qs-catalog');
  if (cat) {
    const items = _items();
    cat.innerHTML = items.length
      ? items.map(i => `<button onclick="qsAddItem('${i.id}')" class="flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border border-surface-container-high bg-surface-container-lowest hover:border-primary/50 hover:bg-surface-container transition-colors text-left">
          <span class="font-body font-semibold text-on-surface text-sm leading-tight">${esc(i.label)}</span>
          <span class="font-headline font-bold text-primary text-sm">$${(i.price || 0).toFixed(2)}</span></button>`).join('')
      : '<div class="col-span-2 text-sm font-body text-on-surface-variant italic py-3">No retail items in your catalog yet — add them in Settings → Services, Items &amp; Fees.</div>';
  }
  const cartEl = document.getElementById('qs-cart');
  if (cartEl) {
    cartEl.innerHTML = _qsCart.length
      ? _qsCart.map(c => `<div class="flex items-center gap-2 py-1.5 border-b border-surface-container-high last:border-0">
          <span class="flex-1 min-w-0 truncate font-body text-on-surface text-sm">${esc(c.label)}</span>
          <span class="flex items-center gap-1.5 flex-shrink-0">
            <button onclick="qsSetQty('${c.itemId}',-1)" class="w-7 h-7 rounded-lg border border-surface-container-high flex items-center justify-center text-on-surface hover:bg-surface-container">−</button>
            <span class="w-6 text-center font-headline font-bold text-sm">${c.qty}</span>
            <button onclick="qsSetQty('${c.itemId}',1)" class="w-7 h-7 rounded-lg border border-surface-container-high flex items-center justify-center text-on-surface hover:bg-surface-container">+</button>
          </span>
          <span class="w-16 text-right font-headline font-bold text-on-surface text-sm flex-shrink-0">$${((c.price || 0) * c.qty).toFixed(2)}</span>
        </div>`).join('')
      : '<div class="text-sm font-body text-on-surface-variant italic py-3 text-center">Tap items above to add them to the sale.</div>';
  }
  const t = _qsTotal();
  const tot = document.getElementById('qs-total'); if (tot) tot.textContent = '$' + t.toFixed(2);
  const btn = document.getElementById('qs-checkout-btn');
  if (btn) { btn.disabled = !(t > 0); btn.style.opacity = t > 0 ? '' : '0.5'; btn.textContent = t > 0 ? `Continue to Pay · $${t.toFixed(2)}` : 'Add items to continue'; }
}

export function qsCheckout() {
  if (!_qsCart.length || _qsTotal() <= 0) { showToast('Add at least one item.'); return; }
  const name = (document.getElementById('qs-name')?.value || '').trim() || 'Quick Sale';
  const items = _qsCart.map(c => ({ itemId: c.itemId, label: c.label, price: c.price || 0, qty: c.qty }));
  const entry = {
    id: newEntryId(), name, phone: '', services: [], assignments: [], items, fees: [], discount: 0,
    status: 'waiting', quickSale: true, soldBy: getActiveUser()?.name || '',
    checkinTime: new Date().toISOString(), isNew: true, skipSquare: true,
  };
  dispatch('queue.upsert', { entry });
  closeQuickSale();
  window.openSquarePOS?.(String(entry.id));   // hand off to the standard Confirm Payment screen
}
