# Gift Cards page: make a cash (card/Zelle) sale count — unify through the pay flow

**Date:** 2026-11-05 · **App:** Muse (`musedashboard`) · **Process:** rigorous-build
**Status:** v2 — hardened after a 4-lens adversarial review (all lenses confirmed Option B fixes the leaks end-to-end; this revision resolves the edges they found).

---

## 0. Root cause
Two gift-card sale paths; only one is correct. **Quick Sale** routes through the Confirm Payment screen
(`openSquarePOS`) → a transaction with `tenders.{cash|card|zelle}` → counted by the cash drawer
(`shiftCashSales` sums `r.tenders.cash`), the cash/Zelle report columns, and the Helcim reconcile; the
card is created on **paid** by `queue.js:434 → gcCreateSalesFromTicket` (liability, not income). The
**Gift Cards page** (`saveGiftCard`) charges the processor directly and `giftcard.save`s — **no
transaction record** → cash invisible to the drawer/reports; a **card** charge shows in reconcile as
"In Helcim, not in the app"; **Zelle** is unrecorded. One bypass, three leaks.

## 1. Logic test — chosen approach
**Option B — unify: route a NEW card WITH a payment method through the same pay flow as Quick Sale.**
Rejected: A (re-implement tenders/record/reconcile inline — the very duplication that caused the bug)
and C (cash-only patch — leaves the card + Zelle leaks). The 4-lens review **confirmed** B fixes all
three leaks against the real code (the card-reconcile fix works because `_finalizeTerminalPaid` writes
the Helcim `transactionId` into the record's `squarePaymentIds`, which `helcimReconcile` matches on —
NOT the invoice ref; corrected from v1).

## 2. Design (hardened)

### 2a. `saveGiftCard` routing (giftcards.js) — one pure helper `giftSaleAction({editId, payMethod})`
- `editId` → **'edit'** → direct `giftcard.save` (unchanged).
- new + `payMethod==='none'` → **'record'** → direct `giftcard.save` (no money; this is the
  comp/giveaway/pre-existing-card path, and the ONLY way to record a card that already has redemptions).
- new + `payMethod∈{cash,card,zelle}` → **'pay'** → route through the pay flow (below).

### 2b. The 'pay' route
- **Guard first (review HIGH):** `if (!(amount > 0)) { showToast('Enter a gift card amount.'); return; }`
  BEFORE building/dispatching anything — otherwise a $0 entry strands in the live queue when
  `openSquarePOS` early-returns before cleanup.
- Build the transient entry (mirror Quick Sale, **`quickSale:true` is mandatory** — it suppresses the
  default $2 fee via `_payApplyDefaultFees`, drives the cancel-cleanup in `closeSquareConfirm`, and
  excludes from Guests-Served):
  ```
  { id: newEntryId(), name: from || to || 'Gift Card', phone: '', services: [], assignments: [],
    items: [], fees: [], discount: 0,
    giftcardSales: [{ amount, serial, to, from, phone, notes }],
    status: 'waiting', quickSale: true, soldBy: getActiveUser()?.name || '',
    checkinTime: new Date().toISOString(), isNew: true, skipSquare: true }
  ```
  then `closeGcModal()` → `dispatch('queue.upsert',{entry})` → `window.openSquarePOS?.(String(entry.id))`
  (NOT a bare call — giftcards.js doesn't import it; match Quick Sale).
- **name = `from || to || 'Gift Card'`** (the buyer, review LOW) — not the recipient.
- Remove the direct-charge block (chargeOnHelcim / recordCashPayment / recordExternalPayment) + the
  direct `giftcard.save` for this case. Clean up imports **only if** unused elsewhere in the file.

### 2c. Notes passthrough — NO custom date (review MEDIUM, corrected from v1)
- Thread **notes** through: `giftcardSales[].notes` → `gcCreateSalesFromTicket` uses `s.notes || ''`.
- **Do NOT thread a custom datePurchased.** The sale is booked when it's rung up; `gcSold` buckets by
  `card.datePurchased` while the cash tender buckets by the record date (`now`) — a back-dated card
  would split the liability and its cash into different report periods (the opposite mismatch to the
  bug). Keep `datePurchased = today` (Quick-Sale behavior). In sale mode (payMethod≠none) **hide/disable
  the date field** so staff don't think it back-dates the sale; back-dating a historical sale is the
  historical-edit path, not this flow.
- **Redemptions are `[]`** for a routed sale (a new card isn't pre-used). Hide/disable the redemptions
  editor in sale mode; recording a pre-used card uses payMethod='none' (the 'record' path).

### 2d. Reverse-safety (review HIGH — fixes a latent data-loss bug that also affects Quick Sale TODAY)
- `gcReverseSalesForTicket` (giftcards.js:78-81) deletes the card **unconditionally** on reopen. A
  sold-then-**redeemed** card whose sale ticket is reopened is destroyed — ledger + balance gone, and
  redemptions drawn against it on other tickets dangle. Option B widens this to GC-page cards.
- **Fix:** guard the reverse — if `gcTotalUsed(card) > 0`, do NOT delete; keep the card (+ its
  balance) and surface a warning. Only an **unredeemed** sold card is removed on reverse. This protects
  both reopen and the refund path below. (This guard is correct regardless of Option B.)

### 2e. Button + wiring (review MEDIUM)
- `#gc-paymethod` gets an `onchange`; fold a label refresh into `updateGcTotals()`; set the label in
  `showAddGiftCard` + `showEditGiftCard`. The label comes from `giftSaleAction(...)`: 'pay' →
  **"Continue to Pay · $X"**, else **"Save Gift Card"**. Disable the button in 'pay' mode when amount≤0
  (mirror Quick Sale).

## 3. Decisions — LOCKED (owner, 2026-11-05)
- #1 UX (Confirm Payment screen for GC-page sales): **YES.**
- #2 Cash-drawer gate: **require an open drawer; FRONT DESK can open one** (so build must ensure the
  cash-register "open" flow is available to front-desk, not manager-only; blocked → open-drawer prompt).
- #3 Refund-void: **INCLUDE now** — on refund of a gift-card sale, void an UNREDEEMED card; a REDEEMED
  card is kept + flagged. Covers Quick Sale too.
- #4 Sale date = **today.** #5 Customer-directory write on sale: **keep.**

## 3-orig. Decisions for the owner (sign-off gate)
1. **UX:** OK that selling a card from the Gift Cards page now opens the Confirm Payment screen (same
   overlay as Quick Sale, one extra step)? (You said reworking is fine — confirming.)
2. **Cash‑drawer gate:** routing cash means a cash gift-card sale now requires an **open cash drawer**
   (non-admins are blocked until one is open — that's literally how the cash gets counted). Acceptable?
   Should front-desk staff be able to open the drawer themselves? (Today they can take cash with no
   drawer — and it's exactly why it wasn't counted.)
3. **Refund of a gift-card sale (HIGH, pre-existing — affects Quick Sale too):** today, refunding a
   gift-card sale returns the money but leaves the card **active and redeemable** (double loss).
   **Recommend** fixing it in this change: on refund, void an **unredeemed** card; for a **redeemed**
   card, keep it and flag (can't un-sell used value). Include it here, or track separately?
4. **Date:** a sold card is dated **today** (back-dating a past sale uses the historical-edit tool, not
   this screen). OK?
5. **Nice side effect:** a sale with a recipient name + phone now **adds them to the customer
   directory** (like Quick Sale). Keep it?

## 4. Data-safety
- Only additive data-model change: `giftcardSales[]` may carry `notes`. No schema rename, no migration;
  existing entries/records/cards untouched and read correctly.
- Cards created by the same idempotent hook (`gc-tkt-<ticketId>-<i>`); the reverse-safety guard (2d)
  prevents destroying a redeemed card.
- **Historical:** cards sold earlier via the old direct **card** path still show as "In Helcim, not in
  the app" for past date ranges (forward-only fix). Add a one-line owner note so legitimate historical
  "leaks" aren't alarming.
- **Mixed-version window:** only `notes` is new in the sale→card hop; if the paying device is still on
  old code it defaults notes→'' (brief, low-impact). No persisted risk. **Rollback:** revert giftcards.js
  (+ the small gcCreateSalesFromTicket change); a card sold under new code is a valid transaction+card.

## 5. TDD test plan
- **Pure:** `giftSaleAction({editId,payMethod})` → edit/record/pay for all combos; `gcCreateSalesFromTicket`
  honors `s.notes` (defaults ''); reverse-safety: a card with `gcTotalUsed>0` is NOT deleted, an unredeemed
  one is.
- **DO/reducer:** a paid entry with `giftcardSales` → record with `tenders.cash` (drawer counts it) + card
  created; `quickSale:true` → NO auto-fee; cancel removes the waiting entry.
- **Browser (pane):** sell a cash card from the Gift Cards page → Continue to Pay → pay cash → assert a
  transaction with `tenders.cash` exists + drawer expected rises + card created (notes carried, date=today).

## 6. Build sequence
1. `giftcards.js`: `giftSaleAction` helper; `gcCreateSalesFromTicket` notes passthrough; reverse-safety
   guard (`gcReverseSalesForTicket` + refund hook if decision #3 = include). (tests red→green)
2. `giftcards.js saveGiftCard`: 3-way routing; amount guard; entry build + `window.openSquarePOS`; remove
   direct-charge block; button-label + paymethod onchange; hide date/redemptions in sale mode.
3. (If #3 = include) refund hook: on refund of a record with `giftcardSales`, reverse via the guarded path.
4. Verify in the pane (cash path). Version trio + What's-New. 3-lens review → fixes → senior review → fixes.

## 7. Deploy
Client-only → Pages push, no Worker deploy. `git push` needs owner OK. **TD port owed** (parked).
