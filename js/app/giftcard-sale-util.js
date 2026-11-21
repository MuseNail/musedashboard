// ── Gift-card SALE helpers (unified path) ─────────────────────────────────────
// Pure (no DOM / store / dispatch) → unit-testable. Used by features/giftcards.js and
// features/reports.js so a gift-card sale from the Gift Cards page goes through the SAME
// pay flow as Quick Sale (so cash lands in the drawer, card reconciles, Zelle is recorded),
// and so reversing a sale on reopen can never destroy a redeemed card.

const _round2 = n => Math.round((+n || 0) * 100) / 100;
const _clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── Gift-sale DISCOUNT (promo: card loads full face, customer pays amount − discount) ─────────
// A discount is stored in DOLLARS on each giftcardSales[] line; '%' is only an input convenience.
// Resolve a $/% input to a clamped, 2dp dollar discount. Coerces garbage/empty/NaN → 0 so a bad
// field can never poison the charge. The card's loaded value is NEVER reduced by this (see giftCardFromSale).
export function resolveGiftDiscount(amount, mode, value) {
  const amt = +amount || 0, val = +value || 0;
  if (amt <= 0) return 0;
  const raw = mode === '%' ? amt * val / 100 : val;
  return _round2(_clamp(raw, 0, amt));
}
// The customer-paid amount for ONE gift-sale line (= what they're charged for this card).
export function giftLineNet(sale) {
  return Math.max(0, (+(sale && sale.amount) || 0) - (+(sale && sale.discount) || 0));
}
// A ticket's discounted gift total (customer-paid side). Replaces the old raw Σ amount in the pay flow.
export function giftSalesNet(lines) {
  return (lines || []).reduce((s, g) => s + giftLineNet(g), 0);
}
// A ticket's total gift-discount (promo cost), each line clamped to its amount.
export function giftSalesDiscountTotal(lines) {
  return (lines || []).reduce((s, g) => s + _clamp(+(g && g.discount) || 0, 0, +(g && g.amount) || 0), 0);
}

// Which action the Gift Cards modal's primary button performs:
//   'edit'   — editing an existing card → direct save (no money)
//   'record' — a NEW card with NO payment → direct save (comp / giveaway / pre-existing; the only
//              path that may carry pre-entered redemptions)
//   'pay'    — a NEW card WITH a payment method → route through the Confirm Payment pay flow
export function giftSaleAction({ editId, payMethod } = {}) {
  if (editId) return 'edit';
  return (payMethod && payMethod !== 'none') ? 'pay' : 'record';
}

// Build the gift-card entity from one `giftcardSales` line (used by gcCreateSalesFromTicket on paid).
// Carries `notes`; the sale date is always the ring-up day (todayStr) so the gift liability and its
// collected cash land in the same report period (a back-dated date would split them — see plan).
// `createdAt` is added by the caller (kept out here to stay pure/deterministic).
export function giftCardFromSale(ticketId, s, i, todayStr) {
  const raw = String((s && s.serial) || '').trim();
  const serial = /^\d+$/.test(raw) ? raw.padStart(8, '0') : raw;   // 29 → 00000029
  return {
    id: `gc-tkt-${ticketId}-${i}`,
    datePurchased: todayStr,
    serial,
    amount: +(s && s.amount) || 0,   // FULL face value — the discount NEVER reduces the card's loaded value
    saleDiscount: _round2(_clamp(+(s && s.discount) || 0, 0, +(s && s.amount) || 0)),   // promo metadata only (books use it; value above stays full)
    phone: (s && s.phone) || '',
    from: (s && s.from) || '',
    to: (s && s.to) || '',
    notes: (s && s.notes) || '',
    redemptions: [],
    amountUsed: 0,
    dateUsed: '',
    saleTicketId: String(ticketId),
  };
}

// Split a sale's cards into those safe to VOID (unredeemed) vs those that must be KEPT (already
// redeemed — their value is spent, deleting them would lose the ledger + strand other tickets).
// `usedOf(card)` returns the total redeemed on that card.
export function partitionGiftReverse(cards, usedOf) {
  const voidIds = [], keepIds = [];
  for (const c of cards || []) {
    if (!c) continue;
    ((usedOf ? usedOf(c) : 0) > 0 ? keepIds : voidIds).push(c.id);
  }
  return { voidIds, keepIds };
}
