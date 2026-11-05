// ── Gift-card SALE helpers (unified path) ─────────────────────────────────────
// Pure (no DOM / store / dispatch) → unit-testable. Used by features/giftcards.js and
// features/reports.js so a gift-card sale from the Gift Cards page goes through the SAME
// pay flow as Quick Sale (so cash lands in the drawer, card reconciles, Zelle is recorded),
// and so reversing a sale on reopen can never destroy a redeemed card.

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
    amount: +(s && s.amount) || 0,
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
