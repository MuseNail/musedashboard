# Gift-card SALE discounts — Implementation Plan (v3, post 4-lens review)

> Add a discount to gift-card SALES. Owner decisions: card loads FULL face value, customer pays less (promo); enter as **$ OR %**; scope = **Gift Cards page + Quick Sale**. Target **v6.22**, `dev`, client-only. Via **rigorous-build**. **Revised after a 4-lens plan review** — in-app money path verified SOUND; BackOffice descoped; export/metrics plumbing + a net-$0 guard + promo-cost visibility added.

## DECISIONS (settled with owner, 2026-11-21)
- **D1 = Leave BackOffice OUT.** The sync isn't live; a discounted gift sale needs a 3-leg model the current `gift_sold` push can't express, and there's a pre-existing BO double-count. **This feature does NOT touch `backoffice-sync.js`** (`gift_sold` keeps emitting full face). Log the proper BO fix (promo-expense leg + double-count) as a **separate BackOffice-repo task** (own_initiative follow-up).
- **D2 = Require net > 0 on the paid path** (discount **strictly < amount**); a genuinely free card uses the existing "add with no payment" (comp/record) path. Guard enforced in both sale UIs BEFORE the queue entry is dispatched.
- **D3 = Fix the receipt in v1.** Add `receipt.js` to scope: a gift sale prints a "Gift card sold $100" line + a "Discount −$10" line, and the printed **Total reflects what was paid** (fixes the pre-existing "Total $0" quirk).

## Goal / Plain English
Sell a **$100** gift card for **$90**: card worth full $100, you collect $90, the $10 is a real promo cost. Enterable as **$ off** or **% off**, from the Gift Cards page and Quick Sale. It reads correctly everywhere money is counted — payment screen, cash drawer, reconcile, "Total Money Collected" (screen, phone app, PDF, CSV, shareable link) — while the card and the "Gift Cards Sold" liability figure stay at full $100. The promo cost is visible as "Gift discounts given."

## Core model (additive, non-destructive) — VERIFIED by review
- The gift sale rides on `giftcardSales:[{amount,…}]`; its face is folded into `_pendingPay.cents` (square-pos.js:86/185). Netting there cascades automatically to the tender split (383-409 derives from `cents`) → drawer (`shiftCashSales` reads `tenders.cash`), reconcile-charged, Helcim/Square reconcile (read `tenders`), and on-screen grossIncome. **The gift discount is NEVER routed through `entry.discount`** (that clamps at 0 and is service income).
- **New `discount` (dollars) on each `giftcardSales[]` line** (0/absent = none); `%` converted to $ at entry. Persisted on the entry + record (saveRecord reports.js:49).
- **`giftCardFromSale` copies `saleDiscount` onto the ledger card** (write-once metadata; `card.amount` stays FULL face). Gives reports a ledger-side discount total that nets 1:1 against the ledger-side `gcSoldValue` (same filtered set). Verified consistent with the record-side reconcile netting (two sources, 1:1, no phantom mismatch — data-safety nit confirmed SOUND).
- Old data has no `discount`/`saleDiscount` → net==amount → byte-identical.

## Pure helpers — `js/app/giftcard-sale-util.js` (EXISTING file, extend; already in sw.js PRECACHE — NOT a new file)
- `giftLineNet(sale)` → `max(0, (+sale.amount||0) − (+sale.discount||0))`.
- `giftSalesNet(lines)` → Σ `giftLineNet`.
- `giftSalesDiscountTotal(lines)` → Σ `min(max(+discount||0,0), +amount||0)`.
- `resolveGiftDiscount(amount, mode, value)` → **coerce first** (`amount=+amount||0; value=+value||0`), then **round2 BOTH branches**: `'$'`→`round2(clamp(value,0,amount))`; `'%'`→`round2(clamp(amount*value/100,0,amount))`. (round2+coerce per review — keeps charge side and ledger `saleDiscount` byte-identical, no NaN.)
- `giftCardFromSale` (existing): add `saleDiscount: round2(clamp(+s.discount||0,0,+s.amount||0))`; **`amount` unchanged**.

## Edit sites — CUSTOMER-PAID / CASH side (net the discount)
**One invariant across these three (fee-toggle trap): if any is left on raw Σ amount the charge re-inflates.**
- `square-pos.js:86` `_payRecomputeBill`, `:185` `openSquarePOS` cents, `:155` `blockTotal` → gift part becomes `giftSalesNet(e.giftcardSales)`. (After editing, grep square-pos.js for `giftcardSales` + `.amount` to prove no raw sum remains.)
- `square-pos.js:152` pay-line → card at full `amount` + a visible **"Gift card discount −$X"** line (mirror :153).
- `quicksale.js` `_qsTotal` (~:103) → net the gift portion.
- `queue.js:2290` A&P `gcSaleTotal`/`partyTotal` → `giftSalesNet` (A&P sets no discount → net==gross; keeps it correct if one appears).
- `reports.js:1188` reconcile `recorded` → `totalCost + giftSalesNet(record.giftcardSales)` (necessary — else a false −$discount mismatch).
- `receipt.js` (~:115) **(D3)**: printed `total` → `ticketTotal(r) + giftSalesNet(r.giftcardSales)` (= amount actually paid, so Total matches the tender and the "Total $0" quirk is fixed); add a **"Gift card sold $AMOUNT"** line per sold card + a **"Discount −$X"** line when a gift discount applies. Keep tender rows as-is (already net via `_pendingPay.cents`).

## Edit sites — METRICS / EXPORTS (plumb `gcSoldDiscount`) — EXPANDED per review
- `reports.js` runReport (~:724) **and** `computeMetrics` (~:820-824): compute `gcSoldDiscount` by reducing `saleDiscount` over the **exact same** period-filtered `giftCards()` set used for `gcSoldValue`/`gcSold`; **net grossIncome by it in BOTH**; **computeMetrics must RETURN `gcSoldDiscount`** (phone Reports app via reports-app.js + any consumer stays consistent). Keep `gcSold`/`gcSoldValue` at FULL face (the liability KPI).
- `reports.js:747` `window._currentReportData`: **add `gcSoldDiscount`**.
- `reports.js:2657` (CSV `exportReportExcel`) **and** `:2693` (PDF/`buildReportHtml`, also the R2 shareable link): subtract `(d.gcSoldDiscount||0)` in the "Total Money Collected" recompute. (These do NOT flow from grossIncome — they recompute from `_currentReportData`.) Keep the "Gift Cards Sold" line at full face.
- **Promo-cost visibility (v1):** show **"Gift discounts given −$X"** (`gcSoldDiscount`) in the Reports gift-card section (screen) + CSV + PDF. (Optional: a discount column in the sold drill-down reports.js:1043-1053.)

## Edit sites — do NOT change (liability / income)
`giftCardFromSale.amount` · `gcCreateSalesFromTicket` (queue.js:435) · "Gift Cards Sold $" KPI/drill (full face) · `totalCost`/income sums · Gift Cards page value/balance totals · `tenders.gift`/`_payGiftDollars` (gift REDEEMED — unrelated). **`backoffice-sync.js` — UNTOUCHED (D1).** **`reconcileSquareData:1243` — NOT edited** (dead for this feature: app-sold cards carry no `squarePaymentIds`, so they never hit `giftCents`; they net via `tenders`/`recCents`. Helcim reconcile already reads `tenders.card` — no change).

## UI
- **Gift Cards modal** (`index.html` #gc-modal ~:1575): a **$ / %** discount toggle + value input + live **"Customer pays $X"** readout after `#gc-amount`, shown only when a real pay method is chosen (`updateGcTotals`). `saveGiftCard`: `discount = resolveGiftDiscount(amount, mode, value)`; **guard net > 0 (discount < amount) BEFORE `dispatch('queue.upsert')`** (D2); include `discount` on the sale line.
- **Quick Sale** (`index.html` ~:2162): same $ / % discount per gift card; `quicksale.js`: include `discount` on each `_qsGiftCards` line; net `_qsTotal`; same net>0 guard before dispatch.

## Test plan
- Unit (`test/giftcard-sale-util.test.js`): `giftLineNet`/`giftSalesNet`/`giftSalesDiscountTotal`/`resolveGiftDiscount` ($ & %, round2 both, coerce NaN/empty→0, clamp [0,amount], multi-line, missing-field net==amount), and `giftCardFromSale` sets `saleDiscount` while keeping `amount` full. A case for discount==amount per D2 handling.
- Integration (disconnected preview): $100 card at $10 off and 10% off, from the Gift Cards modal and Quick Sale → Confirm Payment total $90; on paid the ledger card = $100; the breakdown shows −$10; a cash sale lands $90 in the drawer; reconcile recorded==charged; on-screen + a generated CSV/PDF "Total Money Collected" reflect $90 while "Gift Cards Sold" shows $100; "Gift discounts given" shows $10; **toggling a fee mid-checkout keeps the charge net** (fee-toggle trap); the net-$0 case behaves per D2.
- Regression: full suite per-file; `node --check` all changed JS.

## Migration / rollback
Additive `discount` (sale line) + `saleDiscount` (ledger card); no schema/Worker change (store.js + worker.js store payloads opaquely; ride queue.upsert/record.save/giftcard.save). Rollback = revert; an in-flight unpaid discounted entry would be charged full by a not-yet-updated device (per-device mixed-version window). No stored card value or past record altered.

## Guardrails / invariants
- `git push`/`wrangler deploy` need explicit owner OK. Version trio together (v6.22). Reviewers READ-ONLY.
- **INVARIANT 1:** the discount NEVER reduces the card's loaded `amount` (underfunded card = lost customer money) — `giftCardFromSale.amount` untouched + unit test.
- **INVARIANT 2:** the cash side nets in ALL of payable, tenders(→drawer), reconcile recorded, grossIncome (screen + phone app + CSV + PDF + link) — a partial fix silently mis-states the books. (BackOffice intentionally excluded per D1 and tracked separately.)
