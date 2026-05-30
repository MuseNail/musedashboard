// ── Square POS deep link, orders, appointments, bookings ────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, commitNumpad, ticketTotal } from '../utils.js';
import { SQUARE_PROXY } from '../config.js';
import { customerDirectory } from './square-customers.js';

const cfg     = () => getState().config;
const sqConfig = () => cfg().square_config || null;
const queue    = () => getState().queue;

// ── POS deep link (with a pre-launch confirm screen) ──────────────
// Square Point of Sale API (iOS web): square-commerce-v1://payment/create?data=<percent-encoded JSON>.
// Requires the public Application ID as client_id and an https callback_url — see Settings → Square.
let _pendingPay = null;
// R6 gift-card-as-recorded-tender (staging for the current pay session). These NEVER change
// the Square charge — the full ticket total always goes to Square; we only record which cards
// were used so the app's gift-card balances stay in sync. Committed when the ticket is paid.
let _payGc = [], _payTicketId = null, _gcPickerOpen = false, _payCash = 0, _payTip = 0;   // _payCash/_payTip in dollars (split-tender cash / card tip — tip is charged ON TOP of the bill, never part of ticketTotal)
const _gcBal = g => (g.amount || 0) - (window.gcTotalUsed ? window.gcTotalUsed(g) : 0);
const _payTotalDollars = () => (_pendingPay?.cents || 0) / 100;
const _payGiftDollars  = () => _payGc.reduce((s, t) => s + (t.amount || 0), 0);
// Cash actually applied to the ticket (anything beyond is change the front desk gives back).
const _payCashAppliedDollars = () => Math.max(0, Math.min(_payCash, _payTotalDollars() - _payGiftDollars()));
// Change owed back to the customer when they hand over more cash than the balance.
const _payChangeDollars = () => Math.max(0, _payCash - Math.max(0, _payTotalDollars() - _payGiftDollars()));
// What's charged on the Terminal after cash + gift cards are applied.
const _payCardDueDollars = () => Math.max(0, _payTotalDollars() - _payGiftDollars() - _payCash);
const _gcRoom = () => Math.max(0, _payTotalDollars() - _payCash - _payGiftDollars());
const _gcStagedFor = id => _payGc.filter(t => t.giftcardId === id).reduce((s, t) => s + (t.amount || 0), 0);

// A single entry's charge is computed from its parts via ticketTotal() (utils.js) — the one
// source of truth — so a possibly-stale entry.totalCost can't make the group total wrong.
function payLine(label, amt) {
  return `<div class="flex justify-between text-sm font-body"><span class="text-on-surface-variant">${label}</span><span class="${amt < 0 ? 'text-error' : 'text-on-surface'}">${amt < 0 ? '-' : ''}$${Math.abs(amt).toFixed(2)}</span></div>`;
}
function payCustomerBlock(e) {
  const lines = [];
  (e.assignments || []).forEach(a => { const s = cfg().services.find(x => x.id === a.serviceId); lines.push(payLine(s?.label || 'Service', a.cost || 0)); });
  (e.items || []).forEach(it => { const item = cfg().items.find(x => x.id === it.itemId); lines.push(payLine(`${item?.label || 'Item'} ×${it.qty || 1}`, (it.price || 0) * (it.qty || 0))); });
  (e.fees || []).forEach(f => { const fee = cfg().fees.find(x => x.id === f.feeId); lines.push(payLine(fee?.label || 'Fee', f.amount || 0)); });
  if (e.discount > 0) lines.push(payLine(`Discount${e.discountNote ? ' (' + e.discountNote + ')' : ''}`, -e.discount));
  if (e.tip > 0) lines.push(payLine('Tip', e.tip));   // informational only — never part of ticketTotal (the header total below)
  return `<div class="bg-surface-container rounded-xl px-4 py-3">
    <div class="flex justify-between items-center mb-1.5"><span class="font-headline font-bold text-on-surface">${e.name}</span><span class="font-headline font-bold text-primary">$${ticketTotal(e).toFixed(2)}</span></div>
    ${lines.join('') || '<div class="text-xs text-on-surface-variant italic">No charges</div>'}
  </div>`;
}

export function openSquarePOS(entryId) {
  commitNumpad();   // flush a still-open numpad (a fee/cost typed but not ✓'d) before charging
  const entry = queue().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  // Group check-in → the whole party is on one ticket. To pay separately, split the
  // ticket in-app first (then each member is its own non-grouped entry).
  const party = entry.groupId ? queue().filter(e => e.groupId === entry.groupId) : [entry];
  const cents = Math.round(party.reduce((s, e) => s + ticketTotal(e), 0) * 100);
  if (cents <= 0) { showToast('No total — assign a price first.'); return; }
  // Persist each ticket to the server BEFORE charging, and recompute its total from
  // its parts (services + items + fees − discount) as we save — so the stored total
  // can never be short the fee that's charged. Fees/prices entered in the Assign &
  // Price modal are only in memory until this point (the modal defers the sync to its
  // Save button, which the Pay-in-Square flow skips).
  party.forEach(e => { e.totalCost = ticketTotal(e); dispatch('queue.upsert', { entry: e }); });
  const body = document.getElementById('square-confirm-body');
  if (body) body.innerHTML = party.map(payCustomerBlock).join('');
  const totalEl = document.getElementById('square-confirm-total');
  if (totalEl) totalEl.textContent = `$${(cents / 100).toFixed(2)}`;
  _pendingPay = { cents, ids: party.map(e => String(e.id)), names: party.map(e => e.name).filter(Boolean).join(', ').slice(0, 120) };
  // R6: tie recorded gift cards to the tapped entry; preload any already staged (e.g. Pay was
  // tapped earlier but the charge wasn't completed). Balances are only drawn down when paid.
  _payTicketId = String(entryId);
  _payGc = (entry.giftcardRedemptions || []).map(t => ({ giftcardId: t.giftcardId, serial: t.serial, who: t.who, amount: t.amount }));
  _gcPickerOpen = false; _payCash = 0; _payTip = 0;
  renderPayGc();
  const m = document.getElementById('square-confirm-modal');
  if (m) { m.classList.remove('hidden'); m.style.display = 'flex'; }
}

export function closeSquareConfirm() {
  _pendingPay = null;
  _payGc = []; _payTicketId = null; _gcPickerOpen = false; _payCash = 0; _payTip = 0;
  const gs = document.getElementById('square-gc-section'); if (gs) gs.innerHTML = '';
  const m = document.getElementById('square-confirm-modal');
  if (m) { m.classList.add('hidden'); m.style.display = ''; }
}

export function proceedSquarePayment() {
  if (!_pendingPay) return;
  const appId = sqConfig()?.applicationId;
  if (!appId) { showToast('Add your Square Application ID in Settings → Square first.'); return; }
  const data = {
    // callback_url must EXACTLY match the Web Callback URL registered in the Square
    // Developer Console (Point of Sale API). Pinned to the app scope.
    amount_money: { amount: _pendingPay.cents, currency_code: 'USD' },
    callback_url: location.origin + '/musedashboard/',
    client_id: appId,
    version: '1.3',
    notes: `Muse${_pendingPay.names ? ' · ' + _pendingPay.names : ''}`,
    options: { supported_tender_types: ['CREDIT_CARD', 'CASH', 'OTHER', 'SQUARE_GIFT_CARD', 'CARD_ON_FILE'] },
  };
  // Stash the party (+ names/amount) so we can mark them Paid on return. The Safari
  // return tab uses this to write muse_sq_paid; the installed PWA — which iOS resumes
  // WITHOUT the callback data — uses it for the confirm-on-resume prompt (see main.js).
  try { localStorage.setItem('muse_sq_pending', JSON.stringify({ ids: _pendingPay.ids || [], names: _pendingPay.names || '', cents: _pendingPay.cents || 0, at: Date.now() })); } catch (e) {}
  // R6: stash the recorded gift cards on the ticket so they're logged + drawn down when it's
  // marked Paid (on Square return). The full amount still goes to Square above — charge unchanged.
  if (_payTicketId) {
    const ge = queue().find(x => String(x.id) === _payTicketId);
    if (ge) { ge.giftcardRedemptions = _payGc.map(t => ({ giftcardId: t.giftcardId, serial: t.serial, who: t.who, amount: t.amount })); dispatch('queue.upsert', { entry: ge }); }
  }
  closeSquareConfirm();
  window.location.href = `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
}
export function openSquarePOSFromModal() {
  window.saveCurrentGroupTabInputs?.();
  const entryId = window.activeGroupEntryId?.();
  if (entryId) openSquarePOS(entryId);
}

// ── Square Terminal checkout (total-only, in-person) ─────────────────────────
// Charges the ticket TOTAL on the paired Square Terminal via the Terminal API (no
// itemized order), polls for the result, marks the ticket Paid, and stores the Square
// payment ids (unblocks exact refunds). Total-only by design: the customer's Square
// receipt is NOT itemized and prints from the Terminal itself; the app's Reports keep
// the full per-item breakdown. All calls go through SQUARE_PROXY (server-side token);
// polling, no webhook.
let _termCheckoutId = null, _termPollTimer = null;

function showTerminalModal(msg) {
  const t = document.getElementById('square-terminal-status'); if (t) t.textContent = msg;
  const m = document.getElementById('square-terminal-modal'); if (!m) return;
  m.classList.remove('hidden'); m.style.display = 'flex';
}
function hideTerminalModal() {
  clearTimeout(_termPollTimer); _termPollTimer = null; _termCheckoutId = null;
  const m = document.getElementById('square-terminal-modal'); if (m) { m.classList.add('hidden'); m.style.display = ''; }
}

export async function proceedTerminalPayment() {
  if (!_pendingPay) return;
  const sc = sqConfig();
  if (!sc?.locationId) { showToast('Add your Square Location ID in Settings → Square first.'); return; }
  const party = (_pendingPay.ids || []).map(id => queue().find(x => String(x.id) === String(id))).filter(Boolean);
  if (!party.length) { showToast('Ticket not found.'); return; }
  // Split tender: cash + gift cards reduce what's charged on the card.
  const total         = _pendingPay.cents;
  const giftCents      = Math.round(_payGiftDollars() * 100);
  const cashAppliedC   = Math.round(_payCashAppliedDollars() * 100);
  const cashReceivedC  = Math.round(_payCash * 100);
  const changeCents    = Math.round(_payChangeDollars() * 100);
  const cardCents      = Math.max(0, total - giftCents - cashAppliedC);
  const tipCents       = Math.round(_payTip * 100);   // card tip, charged ON TOP of the bill — never part of `total`
  const termCharge     = cardCents + tipCents;          // what actually goes on the Terminal
  if (termCharge > 0 && !sc.terminalDeviceId) { showToast('Pair your Square Terminal in Settings → Square first.'); return; }
  // Capture BEFORE closeSquareConfirm() — it nulls _pendingPay / _payTicketId / _payCash / _payTip.
  const payNames = _pendingPay.names || '', ticketId = _payTicketId, partyIds = party.map(e => String(e.id));
  const tenders  = { cash: cashAppliedC / 100, card: cardCents / 100, gift: giftCents / 100, cashReceived: cashReceivedC / 100, change: changeCents / 100 };
  // Stash recorded gift cards on the ticket so they're drawn down when marked Paid.
  if (ticketId) {
    const ge = queue().find(x => String(x.id) === ticketId);
    if (ge) { ge.giftcardRedemptions = _payGc.map(t => ({ giftcardId: t.giftcardId, serial: t.serial, who: t.who, amount: t.amount })); dispatch('queue.upsert', { entry: ge }); }
  }
  // Stable idempotency keys for THIS charge, persisted so a retry never double-charges.
  let pend; try { pend = JSON.parse(localStorage.getItem('muse_term_pending') || 'null'); } catch (e) {}
  if (!pend || pend.ticketId !== ticketId || (Date.now() - (pend.at || 0)) > 15 * 60 * 1000) {
    pend = { ticketId, checkoutKey: 'chk-' + ticketId + '-' + Date.now(), cashKey: 'cash-' + ticketId + '-' + Date.now(), at: Date.now() };
    try { localStorage.setItem('muse_term_pending', JSON.stringify(pend)); } catch (e) {}
  }
  closeSquareConfirm();
  try {
    // 1) Card portion + tip on the Terminal (the uncertain step) — do it FIRST.
    let cardPaymentId = null;
    if (termCharge > 0) {
      showTerminalModal(`Charging $${(termCharge / 100).toFixed(2)} on the Terminal — finish on the device…`);
      const coRes = await fetch(`${SQUARE_PROXY}/v2/terminals/checkouts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: pend.checkoutKey, checkout: {
          amount_money: { amount: termCharge, currency: 'USD' },   // card balance + tip — no itemized order
          device_options: { device_id: sc.terminalDeviceId },
          reference_id: String(ticketId || '').slice(0, 40),
          note: payNames.slice(0, 500),
        } }),
      });
      const coJson = await coRes.json();
      if (!coRes.ok) throw new Error(coJson.errors?.[0]?.detail || 'Could not start the Terminal checkout');
      _termCheckoutId = coJson.checkout?.id;
      const co = await _pollTerminalCheckout(_termCheckoutId);
      if (co.status === 'TIMEOUT')  { hideTerminalModal(); showToast('Terminal timed out — check the device, then try again.'); return; }
      if (co.status === 'CANCELED') { hideTerminalModal(); try { localStorage.removeItem('muse_term_pending'); } catch (e) {} showToast('Payment canceled on the Terminal.'); return; }
      cardPaymentId = (co.payment_ids || [])[0] || null;
    }
    // 2) Only AFTER the card succeeds, record the cash portion in Square.
    let cashPaymentId = null;
    if (cashAppliedC > 0) {
      showTerminalModal('Recording cash payment…');
      cashPaymentId = await recordCashPayment(cashAppliedC, cashReceivedC, sc.locationId, pend.cashKey);
    }
    _finalizeTerminalPaid(partyIds, tenders, [cardPaymentId, cashPaymentId].filter(Boolean), tipCents / 100);
  } catch (e) { hideTerminalModal(); showToast('Square: ' + (e.message || 'error')); }
}

// Record the cash portion as a CASH payment in Square (so Square's totals include it).
// A failure here does NOT block marking the ticket Paid — the cash was physically received.
async function recordCashPayment(appliedCents, receivedCents, locationId, idemKey) {
  try {
    const r = await fetch(`${SQUARE_PROXY}/v2/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: idemKey,
        source_id: 'CASH',
        amount_money: { amount: appliedCents, currency: 'USD' },   // the sale amount paid in cash
        cash_details: { buyer_supplied_money: { amount: Math.max(receivedCents, appliedCents), currency: 'USD' } },   // cash handed over → Square computes change_back
        location_id: locationId,
      }),
    });
    const j = await r.json();
    if (!r.ok) { console.warn('[cash] Square record failed:', j.errors); return null; }
    return j.payment?.id || null;
  } catch (e) { console.warn('[cash] Square record error:', e); return null; }
}

// Poll the Terminal checkout to a terminal state. Resolves with the checkout object on
// COMPLETED/CANCELED, or { status:'TIMEOUT' } after 5 min.
function _pollTerminalCheckout(id) {
  return new Promise(resolve => {
    const started = Date.now();
    const tick = async () => {
      if (Date.now() - started > 5 * 60 * 1000) { resolve({ status: 'TIMEOUT' }); return; }
      let co = null;
      try { const r = await fetch(`${SQUARE_PROXY}/v2/terminals/checkouts/${id}`); const j = await r.json(); co = j.checkout || null; } catch (e) {}
      if (co?.status === 'COMPLETED' || co?.status === 'CANCELED') { resolve(co); return; }
      _termPollTimer = setTimeout(tick, 2000);   // PENDING / IN_PROGRESS / CANCEL_REQUESTED → keep waiting
    };
    tick();
  });
}

function _finalizeTerminalPaid(partyIds, tenders, paymentIds, tipDollars) {
  hideTerminalModal();
  partyIds.forEach((id, i) => {
    const ge = queue().find(x => String(x.id) === String(id));
    if (ge) {
      if (paymentIds.length) ge.squarePaymentIds = paymentIds;
      if (i === 0) { ge.tenders = tenders; if (tipDollars > 0) ge.tip = tipDollars; }   // group-level split + one tip, recorded on the primary ticket
      ge.totalCost = ticketTotal(ge);   // bill only — tip is NOT folded in
      dispatch('queue.upsert', { entry: ge });
    }
    window.updateStatus?.(String(id), 'paid');   // → saveRecord (records tenders/tip/squarePaymentIds) + gift-card draw-down + audit
  });
  try { localStorage.removeItem('muse_term_pending'); } catch (e) {}
  _pendingPay = null; _payGc = []; _payTicketId = null; _payCash = 0; _payTip = 0;
  showToast('Paid ✓');
}

export async function cancelTerminalCheckout() {
  const id = _termCheckoutId;
  if (!id) { hideTerminalModal(); return; }
  showTerminalModal('Canceling on the device…');
  // Don't clear the poll timer here — let the poll observe CANCELED and finish cleanly.
  try { await fetch(`${SQUARE_PROXY}/v2/terminals/checkouts/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {}
}

// Reprint a receipt for a PAST sale on the Square Terminal's built-in printer, using the
// stored Square payment id (Terminal Action API, type RECEIPT). Only works for sales paid
// through the Terminal flow (which captured a Square payment id).
export async function reprintTerminalReceipt(recordId) {
  const rec = (getState().records || []).find(r => String(r.id) === String(recordId))
           || (getState().queue || []).find(r => String(r.id) === String(recordId));
  const paymentId = rec?.squarePaymentIds?.[0];
  if (!paymentId) { showToast('No Square payment on file — receipts reprint only for Square Terminal sales.'); return; }
  const deviceId = sqConfig()?.terminalDeviceId;
  if (!deviceId) { showToast('Pair your Square Terminal in Settings → Square first.'); return; }
  try {
    showToast('Sending receipt to the Terminal…');
    const res = await fetch(`${SQUARE_PROXY}/v2/terminals/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: 'rcpt-' + recordId + '-' + Date.now(),
        action: { type: 'RECEIPT', device_id: deviceId, receipt_options: { payment_id: paymentId, is_duplicate: true, print_only: true } },
      }),
    });
    const j = await res.json();
    if (!res.ok) { showToast('Square: ' + (j.errors?.[0]?.detail || 'could not print the receipt')); return; }
    showToast('Receipt printing on the Terminal ✓');
  } catch (e) { showToast('Could not reach Square.'); }
}

// ── R6: gift-card "used" recorder inside the Confirm Payment modal ────────────────
// Pure bookkeeping: stage which cards were used + how much, shown under the ticket. The
// "Charge in Square" line stays the FULL ticket total; nothing here reduces it. Staged amounts
// are persisted onto the ticket on Proceed and committed to the card ledger when it's Paid.
function renderPayGc() {
  const host = document.getElementById('square-gc-section'); if (!host) return;
  const cards = getState().giftcards || [];
  const lines = _payGc.map(t => {
    const g = cards.find(x => x.id === t.giftcardId);
    const proj = g ? (_gcBal(g) - _gcStagedFor(t.giftcardId)) : 0;
    return `<div class="flex items-center justify-between bg-primary-container/15 border border-surface-container-high rounded-lg px-3 py-2 mb-1.5">
      <span class="text-sm font-body text-on-surface">Gift card #${t.serial || '—'}${t.who ? ' · ' + t.who : ''}</span>
      <span class="flex items-center gap-2"><span class="text-xs font-headline font-semibold text-on-surface-variant">$${(t.amount || 0).toFixed(2)} used · bal $${proj.toFixed(2)}</span>
      <button onclick="sqRemoveGiftcard('${t.giftcardId}')" title="Remove" class="text-outline hover:text-error flex items-center"><span class="material-symbols-outlined" style="font-size:16px">close</span></button></span>
    </div>`;
  }).join('');
  const room = _gcRoom();
  const addBtn = room > 0.001 ? `<button onclick="sqToggleGcPicker()" class="w-full border border-dashed border-primary text-primary rounded-lg py-2 text-xs font-body font-semibold hover:bg-primary/5">+ Apply gift card</button>` : '';
  const picker = _gcPickerOpen ? `<div class="border border-surface-container-high rounded-lg mt-2 overflow-hidden">
      <div class="px-3 py-2 bg-surface-container"><input id="sq-gc-search" oninput="filterGcPicker()" placeholder="Search serial / name…" class="w-full bg-transparent text-sm focus:outline-none text-on-surface"></div>
      <div id="sq-gc-rows" class="max-h-44 overflow-y-auto">${_gcPickerRows(room)}</div>
    </div>` : '';
  const cashRow = `<div class="flex items-center justify-between mb-3">
      <span class="text-sm font-body text-on-surface">Cash received</span>
      <span class="flex items-center gap-1"><span class="text-on-surface-variant text-sm">$</span>
      <input id="sq-cash-amt" type="text" inputmode="none" value="${_payCash > 0 ? _payCash.toFixed(2) : ''}" placeholder="0.00" onfocus="openNumpad(this,'Cash received','cost')" onclick="openNumpad(this,'Cash received','cost')" oninput="sqCashInput(this.value)" class="w-24 border border-surface-container-high rounded-lg px-2 py-1.5 text-sm text-right text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary"></span>
    </div>`;
  // Tip is charged ON TOP of the card on the Terminal (card-only). It is NOT part of the bill/
  // ticketTotal — it's added to the Terminal charge and tracked separately in Reports.
  const tipRow = `<div class="flex items-center justify-between mb-3">
      <span class="text-sm font-body text-on-surface">Tip <span class="text-on-surface-variant text-xs">(added to card)</span></span>
      <span class="flex items-center gap-1"><span class="text-on-surface-variant text-sm">$</span>
      <input id="sq-tip-amt" type="text" inputmode="none" value="${_payTip > 0 ? _payTip.toFixed(2) : ''}" placeholder="0.00" onfocus="openNumpad(this,'Tip','cost')" onclick="openNumpad(this,'Tip','cost')" oninput="sqTipInput(this.value)" class="w-24 border border-surface-container-high rounded-lg px-2 py-1.5 text-sm text-right text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary"></span>
    </div>`;
  const breakdown = `<div class="mt-3 pt-2 border-t border-surface-container-high text-xs font-body space-y-0.5">
      <div class="flex justify-between text-on-surface-variant"><span>Total</span><span>$${_payTotalDollars().toFixed(2)}</span></div>
      ${_payGiftDollars() > 0 ? `<div class="flex justify-between text-on-surface-variant"><span>Gift card</span><span>$${_payGiftDollars().toFixed(2)}</span></div>` : ''}
      <div id="sq-row-cashrcv" class="flex justify-between text-on-surface-variant" style="display:none"><span>Cash received</span><span id="sq-cash-rcv">$0.00</span></div>
      <div id="sq-row-change" class="flex justify-between items-center text-2xl font-headline font-extrabold text-on-surface mt-1.5" style="display:none"><span>Change due</span><span id="sq-change">$0.00</span></div>
      <div id="sq-row-cashpaid" class="flex justify-between text-on-surface" style="display:none"><span>Cash paid</span><span id="sq-cash-applied">$0.00</span></div>
      <div id="sq-row-tip" class="flex justify-between text-on-surface-variant" style="display:none"><span>Tip</span><span id="sq-tip">$0.00</span></div>
      <div class="flex justify-between items-center text-2xl font-headline font-extrabold text-on-surface mt-1.5"><span>Card on Terminal</span><span id="sq-card-due">$${(_payCardDueDollars() + _payTip).toFixed(2)}</span></div>
    </div>`;
  host.innerHTML = `<div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-2 mt-1">Split payment — optional</div>${cashRow}${tipRow}<div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-1">Gift card used (recorded; keeps balances in sync)</div>${lines}${addBtn}${picker}${breakdown}`;
  sqUpdatePayBreakdown();
}
export function sqCashInput(v) {
  const n = parseFloat(v);
  _payCash = isFinite(n) && n > 0 ? n : 0;
  sqUpdatePayBreakdown();
}
export function sqTipInput(v) {
  const n = parseFloat(v);
  _payTip = isFinite(n) && n > 0 ? n : 0;
  sqUpdatePayBreakdown();
}
// Live-patch the breakdown numbers + the action buttons as cash/tip are typed, WITHOUT
// re-rendering the section (which would yank the numpad's target input mid-entry).
export function sqUpdatePayBreakdown() {
  const cardDue = _payCardDueDollars(), applied = _payCashAppliedDollars(), change = _payChangeDollars(), cash = _payCash, tip = _payTip;
  const termCharge = cardDue + tip;   // tip rides on top of the card portion of the bill
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = '$' + v.toFixed(2); };
  set('sq-card-due', termCharge); set('sq-cash-applied', applied); set('sq-cash-rcv', cash); set('sq-change', change); set('sq-tip', tip);
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? 'flex' : 'none'; };
  show('sq-row-cashrcv', cash > 0); show('sq-row-cashpaid', cash > 0); show('sq-row-change', change > 0.0001); show('sq-row-tip', tip > 0.0001);
  const tb = document.getElementById('sq-terminal-btn');
  if (tb) tb.innerHTML = termCharge > 0
    ? `<span class="material-symbols-outlined" style="font-size:18px">contactless</span> Pay $${termCharge.toFixed(2)} on Terminal`
    : `<span class="material-symbols-outlined" style="font-size:18px">check</span> Record Payment`;
  // The legacy Square POS deep link charges the bill only (no cash split, no tip) — disable it
  // whenever a cash split or a tip is in play, since those are handled by the Terminal.
  const pb = document.getElementById('sq-pos-btn');
  if (pb) { const off = _payCash > 0 || _payTip > 0; pb.disabled = off; pb.style.opacity = off ? '0.4' : ''; pb.style.pointerEvents = off ? 'none' : ''; pb.title = off ? 'Cash/tip is handled by the Terminal' : ''; }
}
function _gcPickerRows(room) {
  const q = (document.getElementById('sq-gc-search')?.value || '').toLowerCase();
  const cards = (getState().giftcards || [])
    .map(g => ({ g, avail: _gcBal(g) - _gcStagedFor(g.id) }))
    .filter(({ avail }) => avail > 0.001)
    .filter(({ g }) => !q || (g.serial || '').toLowerCase().includes(q) || (g.to || '').toLowerCase().includes(q) || (g.from || '').toLowerCase().includes(q) || (g.phone || '').includes(q))
    .sort((a, b) => b.avail - a.avail).slice(0, 12);
  if (!cards.length) return `<div class="px-3 py-3 text-xs text-on-surface-variant italic">No gift cards with an available balance.</div>`;
  return cards.map(({ g, avail }) => {
    const who = g.to || g.from || '';
    const deflt = Math.min(avail, room).toFixed(2);
    return `<div class="flex items-center gap-2 px-3 py-2 border-t border-surface-container">
      <div class="flex-1 min-w-0"><div class="text-sm font-body font-semibold text-on-surface truncate">#${g.serial || '—'}${who ? ' · ' + who : ''}</div><div class="text-[11px] text-on-surface-variant">balance $${avail.toFixed(2)}</div></div>
      <input id="sqgc-amt-${g.id}" type="text" inputmode="decimal" value="${deflt}" class="w-20 border border-surface-container-high rounded-lg px-2 py-1 text-sm text-right text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary">
      <button onclick="sqApplyGiftcard('${g.id}')" class="bg-primary text-on-primary rounded-lg px-3 py-1.5 text-xs font-headline font-bold flex-shrink-0">Record</button>
    </div>`;
  }).join('');
}
export function filterGcPicker() { const host = document.getElementById('sq-gc-rows'); if (host) host.innerHTML = _gcPickerRows(_gcRoom()); }
export function sqToggleGcPicker() { _gcPickerOpen = !_gcPickerOpen; renderPayGc(); }
export function sqRemoveGiftcard(id) { _payGc = _payGc.filter(t => t.giftcardId !== id); renderPayGc(); }
export function sqApplyGiftcard(id) {
  const g = (getState().giftcards || []).find(x => x.id === id); if (!g) return;
  const want = parseFloat(document.getElementById('sqgc-amt-' + id)?.value) || 0;
  const amt = Math.min(want, _gcBal(g) - _gcStagedFor(id), _gcRoom());
  if (!(amt > 0.001)) { showToast('Nothing to record.'); return; }
  const ex = _payGc.find(t => t.giftcardId === id);
  if (ex) ex.amount = +(ex.amount + amt).toFixed(2);
  else _payGc.push({ giftcardId: id, serial: g.serial, who: g.to || g.from || '', amount: +amt.toFixed(2) });
  _gcPickerOpen = false; renderPayGc();
}

// ── Appointments → queue ──────────────────────────
export async function syncSquareAppointments() {
  if (!sqConfig()) { showToast('Square not configured.'); return; }
  showToast('Loading appointments…');
  try {
    const today = new Date();
    const start = new Date(today.setHours(0,0,0,0)).toISOString();
    const end   = new Date(today.setHours(23,59,59,999)).toISOString();
    const res   = await fetch(`${SQUARE_PROXY}/v2/bookings?location_id=${sqConfig().locationId}&start_at_min=${start}&start_at_max=${end}&limit=100`);
    const data  = await res.json();
    if (!data.bookings || data.bookings.length === 0) { showToast('No appointments today from Square.'); return; }
    let added = 0;
    for (const b of data.bookings) {
      if (b.status !== 'ACCEPTED' && b.status !== 'PENDING') continue;
      const entryId = 'appt-' + b.id;
      if (queue().find(e => String(e.id) === entryId)) continue;
      const variationId = b.appointment_segments?.[0]?.service_variation_id;
      const svc = cfg().services.find(s => s.squareVariationId === variationId) || cfg().services.find(s => s.squareItemId === variationId) || cfg().services[0];
      const custDir = b.customer_id ? customerDirectory.find(c => c.squareId === b.customer_id) : null;
      const name = custDir ? [custDir.firstName, custDir.lastName].filter(Boolean).join(' ') : (b.customer_note || 'Appointment');
      dispatch('queue.upsert', { entry: {
        id: entryId, name, phone: custDir?.phone || '', services: svc ? [svc.id] : [],
        status: 'waiting', isAppointment: true, checkinTime: new Date(b.start_at).toISOString(), assignments: [], groupId: null,
      } });
      added++;
    }
    window.renderQueue?.(); window.renderTurns?.();
    showToast(added > 0 ? `${added} appointment(s) added to queue ✓` : 'No new appointments to add.');
  } catch (e) { showToast('Appointments sync failed: ' + e.message); }
}

// ── Push a calendar appointment to Square Bookings (SMS reminders) ──────────────
export async function squarePushBooking(calId, eventId) {
  if (!sqConfig()) { showToast('Square not configured.'); return; }
  if (!sqConfig().bookingTeamMemberId) { showToast('Set a booking team member in Square settings first.'); showSquareModalGlue(); return; }

  const ev = (window.calEventsFor?.(calId) || []).find(x => x.id === eventId);
  if (!ev) { showToast('Event not found.'); return; }

  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const endDt   = new Date(ev.end?.dateTime || ev.end?.date || startDt.getTime() + 3600000);
  const durMins = Math.round((endDt - startDt) / 60000);

  const svc = cfg().services.find(s => (ev.summary||'').toLowerCase().includes(s.label.toLowerCase()) || (ev.description||'').toLowerCase().includes(s.label.toLowerCase()));
  if (!svc?.squareVariationId) { showToast(svc ? `Push "${svc.label}" to Square catalog first (Settings → Services).` : 'No matching service found — check service names match your catalog.'); return; }

  let variationVersion;
  try {
    const objRes = await fetch(`${SQUARE_PROXY}/v2/catalog/object/${svc.squareVariationId}`);
    if (!objRes.ok) { showToast('Could not fetch service version from Square.'); return; }
    variationVersion = (await objRes.json()).object?.version;
    if (!variationVersion) { showToast('Could not read service version from Square.'); return; }
  } catch (e) { showToast('Square catalog fetch failed: ' + e.message); return; }

  const phoneMatch = (ev.description || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const rawPhone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
  const custDir = rawPhone ? customerDirectory.find(c => { const cp = (c.phone||'').replace(/\D/g,'').replace(/^1(\d{10})$/,'$1'); return cp && (cp === rawPhone || cp === rawPhone.replace(/^1/,'')); }) : null;

  showToast('Creating Square booking…');
  try {
    const bookingBody = { idempotency_key: `muse-booking-${eventId}-${Date.now()}`, booking: {
      start_at: startDt.toISOString(), location_id: sqConfig().locationId, customer_note: ev.summary || '',
      ...(custDir?.squareId ? { customer_id: custDir.squareId } : {}),
      appointment_segments: [{ duration_minutes: durMins, service_variation_id: svc.squareVariationId, service_variation_version: variationVersion, team_member_id: sqConfig().bookingTeamMemberId }],
    } };
    const res = await fetch(`${SQUARE_PROXY}/v2/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bookingBody) });
    const data = await res.json();
    if (res.ok && data.booking?.id) showToast('Square booking created — SMS reminder will send ✓');
    else showToast('Square booking failed: ' + (data.errors?.[0]?.detail || data.errors?.[0]?.code || 'unknown'));
  } catch (e) { showToast('Could not reach Square. Check proxy.'); }
}

function showSquareModalGlue() { window.showSquareModal?.(); }
