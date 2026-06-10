# Square → Helcim migration plan (musedashboard)

**Status:** MOSTLY LIVE — **Helcim payments are IN PRODUCTION** (selectable processor, default per `config.payment_processor`); customers + catalog done; reconcile + customer-carry shipped · **Created:** 2026-06-03 · **Updated:** 2026-06-10 (prod v4.76) · **Decision:** in-repo replacement (NOT TurnDesk's multi-processor adapter — keep it a simple swap; see CLAUDE.md "Product line" box).

## ✅ PROGRESS (2026-06-10) — Helcim is LIVE; what's left
**SHIPPED v4.61–v4.76 (terminal `7C0X`, Worker deployed, secrets `HELCIM_API_TOKEN` + `HELCIM_WEBHOOK_VERIFIER` set):**
- **A. Payments/Terminal: LIVE.** Worker `POST /helcim/purchase` (dollars + unique `invoiceNumber` + optional `customerCode`), `GET /helcim/result`, `GET /helcim/ping`, **`POST /terminal/webhook`** (HMAC/Svix-verified; path can't contain "helcim") → DO `/helcim/finalize` broadcasts `helcim_result` over the existing WebSocket. Client `features/helcim.js` `chargeOnHelcim()` = webhook-driven + fallback poll + 3-min timeout + idempotency pre-check (deterministic ref `tkt-<id>-<cents>`). Tips: front-desk-entered in-app (terminal tip prompt OFF), full amount sent — as planned below. NO software-cancel: cancel ON the device → `terminalCancel` webhook. Processor toggle Square|Helcim in Settings → Payment Processing (admin/manager-only + confirm, v4.73). Cash/Zelle are app-only on Helcim.
- **D. Reconcile: SHIPPED (v4.72) + field shapes VERIFIED against a real production transaction.** Worker `GET /helcim/transactions?dateFrom=&dateTo=`; client `helcimReconcile()` matches APPROVED purchases to records by stored `transactionId` (kept in `squarePaymentIds`); the Transactions "Reconcile" button is processor-aware (`openProcessorReconcile()`). Confirmed real response: bare array of `{transactionId, dateCreated, status, type:"purchase", amount(dollars), cardType, invoiceNumber, customerCode}`.
- **Customer carry (v4.72 + v4.76 fix):** Worker `POST /helcim/customer` upserts by phone → `customerCode` rides the purchase so the terminal can text/email the receipt. ⚠️ v4.72 sent lowercase `cellphone` (Helcim ignored it → no phone saved + a duplicate customer per charge); **v4.76 fixed it to `cellPhone`** + stores/searches the dashed format. Owner to-do: **merge the v4.72-era duplicate customers in the Helcim dashboard** and verify text-receipt prefill on the next live charge.

**REMAINING:**
- **Helcim refund/void path** (`POST /v2/payment/refund` w/ idempotency-key — see findings below); app refunds currently assume Square payment ids.
- **§13 full Worker auth** — `/helcim/*` (except the HMAC'd webhook) + `/gcal/token|connect` are still unauthenticated.
- **Pay-path P0 consolidation** (one "→ paid"/reopen path; see `PRIORITIES.md`) — partially improved (v4.55 unstage-gift, v4.76 modal close) but the full consolidation remains.
- **E. Retire Square** (when the owner calls it): stop the customer dual-write, remove `/square` proxy + `SQUARE_TOKEN` + Square config UI; keep historical Square ids on old records.

## ✅ PROGRESS (2026-06-04) — customers + catalog (earlier phases)
**DONE (shipped v4.23–v4.27):**
- **Workstream C (catalog → local): COMPLETE.** Square catalog pull/push + the "push to Square" buttons removed (v4.23); catalog is `config.services/items/fees` only. Square **Bookings** + appointment-sync also removed.
- **Workstream B (customer directory → DO): mostly COMPLETE.** Customers are now a synced DO **`customer:<id>` entity** (`customer.upsert/delete/bulkUpsert/bulkDelete`, per-record stale guard + `custdeletion:` tombstones) with a dedicated **Customers tab** (search/add/edit/delete/dedup/CSV/import-from-Square). The one-time Square→DO import is built (owner ran it). `config.customer_notes` stays phone-keyed. **The Square customer DUAL-WRITE is intentionally KEPT** (check-in/pay + tab edits) so card charges stay linked — retire it at the Helcim cutover (Workstream E).

**REMAINING (Phase 4 — gated on the Helcim Smart Terminal hardware):**
- **A. Payments/Terminal → Helcim** (the core, structural poll→webhook change).
- **D. Reconcile + reports → Helcim** (generic `paymentIds` + `processor` on new records).
- **§13 full Worker auth** (the unauthenticated-backend cluster) — lands in the same Worker pass as the Helcim proxy/webhook.
- **Pay-path P0 consolidation** (do FIRST, hardware-independent): one "→ paid"/reopen path incl. the **cancelled-processor-transaction** + **reopen-leaves-record** cases (see `PRIORITIES.md`).
- **E. Retire Square:** stop the customer dual-write, remove `/square` proxy + `SQUARE_TOKEN` + the Square config UI; keep historical Square ids on old records.

**Hardware-independent first steps:** ~~the Helcim-API research pass~~ **✅ DONE 2026-06-08** (findings + proposed Worker design + open questions below) · the **pay-path P0 consolidation** (still to do) · ordering hardware = the **Helcim Smart Terminal** (API mode), then build payments + §13 Worker auth together.

## Scope (owner-confirmed 2026-06-03)
Remove **most** Square connections. The app becomes the **source of truth** for:
- **Customer directory** (move OFF Square into the Durable Object).
- **Service / Item / Fees catalog** (already app-managed in `config`; just drop the Square sync).

Unchanged because already independent:
- **Appointments** → Google Calendar (calendar.js). No Square Bookings.
- **SMS reminders** → httpSMS (sms.js / Worker `/sms`). Independent of Square.

New requirement:
- **Reconciliation + reports cross-referenced against Helcim** (the new merchant services), replacing the Square reconcile.

Net: Square is fully retired except possibly a one-time customer export during migration.

---

## Footprint (audit sweep 2026-06-03): ~852 "square/terminal" refs across 37 files; real code in ~10 files
| File | Square role | Migration action |
|---|---|---|
| `js/app/features/square-pos.js` (~627) | Terminal/POS pay flow, cash/Zelle/gift/tip split, gift-card-sale charge, `squarePushBooking`, `syncSquareAppointments` | **Rewrite** to Helcim Smart Terminal API (poll → webhook). Keep the split-tender + tip math (processor-agnostic). Delete bookings/appt-sync. |
| `cloudflare/worker.js` | `/square` proxy + `SQUARE_TOKEN` | Add Helcim proxy + `HELCIM_API_TOKEN` + **`/helcim/webhook`** receiver. Retire `/square`. (Do alongside the §13 full-auth work.) |
| `js/app/config.js` | `SQUARE_PROXY`, square_config shape | `HELCIM_PROXY`; new config shape (terminal device id, etc.). |
| `js/app/features/settings.js` (24) | Square config + terminal pairing UI | Replace with Helcim pairing/config UI. |
| `js/app/features/square-customers.js` (~627) | Square customer load/upsert/dedup/autocomplete | **Repurpose** to a DO-backed customer store (see Workstream B). Drop all Square API calls. |
| `js/app/features/square-catalog.js` (~288) | Square catalog pull/push | **Delete** (catalog is app-owned). |
| `js/app/features/reports.js` (93) | `fetchSquarePayments`, `reconcileSquareData`, Payment Mix, refund-to-Square | **Rebuild** reconcile against Helcim; keep Payment Mix math, re-point the source. |
| `js/app/features/giftcards.js` (14) | Gift-card SALE charged via `chargeOnTerminal` | Re-point to Helcim. (Card balances are app-owned → unaffected.) |
| `js/app/features/queue.js` (19), `main.js` (28), `calendar.js` (15) | Pay buttons, return-from-Square handling (`muse_sq_paid`/`muse_term_pending`), booking buttons | Re-point pay buttons; replace the Square-return handling with the Helcim webhook/finalize; remove booking buttons. |
| `catalog.js`, `checkin.js`, `floorplan.js` | `squareItemId`/`squareVariationId` refs, autocomplete | Drop Square id fields; autocomplete reads the DO customer store. |

---

## Workstreams

### A. Payments / Terminal → Helcim  *(the core, structural)*
- **Hardware:** Helcim **Smart Terminal** (API-drivable; NOT the $199 mobile reader), API mode ON, registered.
- **Worker:** `HELCIM_API_TOKEN` secret; a Helcim proxy/endpoints; **`/helcim/webhook`** to receive the terminal transaction result.
- **The structural change — poll → webhook:** today the client *waits inline* for the Square Terminal result; Helcim pushes the result to the Worker asynchronously. So the pay flow becomes "charge sent → awaiting webhook → finalize on webhook." Decide: **server-side finalize** (the Worker/DO marks the ticket paid + broadcasts on webhook) vs **client polls a Helcim status endpoint**. Webhook is Helcim's documented model.
- **Keep as-is (processor-agnostic):** the bill+tip collection math, the `tenders` map (cash/card/gift/zelle summing to the bill, tip separate — v4.11), cash-drawer gating, the card-tip→drawer Cash Out (v4.19).
- **Refunds:** rebuild `refundInSquare` → Helcim refund API.
- **Receipts:** Helcim terminal prints its own; the `reprintTerminalReceipt` Square path retires (or maps to Helcim if supported).

### B. Customer directory → app/DO source of truth  *(biggest NEW data-model piece)*
- Today: customers live in **Square**, cached device-local (`muse_customers`), notes app-owned phone-keyed (`config.customer_notes`). Autocomplete/upsert/dedup all hit the Square API.
- Target: a **first-class synced entity in the DO** (recommend `customer:<id>` keys + a `customer.upsert`/`customer.delete` op, mirroring records — per-record stale guard, scales; NOT one config blob, which would clobber).
- **One-time migration:** pull the full Square customer list once → seed the DO customer store → cut over. (Keep `config.customer_notes` phone-keyed for back-compat, or fold notes into the customer record — decide.)
- Re-point `square-customers.js` autocomplete/upsert/edit/dedup to the DO store; remove Square API calls.
- We likely do **NOT** sync customers to Helcim (app is source of truth) — at most pass a name/note on the Helcim transaction.

### C. Catalog → local only  *(low effort)*
- `config.services/items/fees` already exist and are edited in Settings. **Delete** `square-catalog.js` pull/push + the "push to Square" buttons; drop `squareItemId`/`squareVariationId` usage. Leave the fields harmless on old data or strip in a one-time cleanup.

### D. Reconcile + reports → Helcim  *(new)*
- Records going forward store a **generic** `paymentIds` + `processor:'helcim'` (leave old `squarePaymentIds` readable for history). 
- Worker: a Helcim **transaction-list** endpoint for reconcile + the webhook captures the payment id per sale.
- `reports.js`: rebuild `fetchSquarePayments`/`reconcileSquareData` against Helcim; keep Payment Mix ("Card incl. tips") + the reconcile identity, re-point the source. Reports must tolerate **both** processors during the transition (old Square sales + new Helcim sales).

### E. Retire Square
- Remove `square-catalog.js`, the Square parts of `square-customers.js`/`square-pos.js`, the `/square` Worker proxy + `SQUARE_TOKEN`, the Square config UI, bookings. Keep historical Square ids on old records.

---

## Data model & migration summary
- **NEW:** DO customer entity (`customer:<id>` + op) + one-time Square→DO customer export.
- **NEW:** generic `paymentIds` + `processor` on records (going forward); webhook-captured Helcim id.
- **UNCHANGED:** `tenders`/`tip` shape (so payroll/reports/cash-drawer keep working); gift-card balances (app-owned); queue/turns/floor/schedule/staff.
- **HISTORICAL:** old records keep `squarePaymentIds`/`squareOrderId`/`squareVariationId` — don't migrate; reprint/refund-to-processor only works on the matching processor.

## Dependencies / sequencing
1. **Stabilize first** (owner's stated gate): the app fully functional + the deferred audit/security items addressed enough.
2. **Pay-path P0 consolidation** — do BEFORE/WITH Workstream A: one clean pay path = one swap point (instead of the current divergent Terminal / POS-deep-link / quick-Mark-Paid paths).
3. **§13 full-auth + Worker** — the Helcim proxy/webhook/secret land in the same Worker pass as the auth work.
4. Then A (payments) + D (reconcile) together; B (customers) can run in parallel; C (catalog) + E (cleanup) last.

## ✅ Helcim API research findings (verified 2026-06-08, from devdocs.helcim.com)

**Base URL:** `https://api.helcim.com/v2`. **Auth:** single `api-token` request header (→ the Worker's `HELCIM_API_TOKEN` secret; token stays server-side, never in the client — same pattern as today's Square proxy). The API is now called the **"Payment Hardware API"** (was "Smart Terminal API"). Terminal must have **API mode ON** and be **registered/paired** (gives a **4-digit `deviceCode`**, e.g. `NBL7`).

### The core pay flow is POLL → WEBHOOK (the structural change)
1. **Start a purchase** — `POST /v2/devices/{deviceCode}/payment/purchase`
   - Headers: `api-token`. Body: `{ "currency": "USD", "transactionAmount": <number, dollars>, "invoiceNumber": "<our unique ref>", "customerCode": "<optional>" }`.
   - Returns **`202 Accepted`** = "queued on the device," NOT a result. The terminal then prompts the customer (tap / chip+PIN) **and shows the tip screen on-device**.
   - ⚠️ **No `tipAmount` and no `idempotency-key` in this endpoint's schema** (idempotency IS required on refund/reverse — see below). `transactionAmount` is **dollars** (e.g. `100.99`), not cents.
2. **Result comes back via webhook** (configured in Helcim → All Tools → Integrations → Webhooks; URL must be https and must NOT contain the word "helcim"). Two event types:
   - **`cardTransaction`** — payload is only `{ "id": "25764674", "type": "cardTransaction" }`. You must then **`GET /v2/card-transactions/{id}`** for the full object → `{ transactionId, dateCreated, type, amount, currency, cardType, approvalCode, cardToken, invoiceNumber, customerCode, status (APPROVED|DECLINED) }`.
   - **`terminalCancel`** — payload `{ "type":"terminalCancel", "data": { invoiceNumber, deviceCode, transactionAmount, currency, customerCode, cancelledAt } }` (fires when the customer cancels on the device before processing). **This cleanly covers the pay-path-P0 "cancelled-processor-transaction" case.**
   - **Webhook security:** HMAC-SHA256. Headers `webhook-id`, `webhook-timestamp`, `webhook-signature`. Sign `"${webhook-id}.${webhook-timestamp}.${rawBody}"` with the **base64-decoded `verifierToken`** (from webhook settings) as the key; base64 the result; it must match one of the space-delimited values in `webhook-signature`. (This is the Svix scheme.)
3. **Correlation = `invoiceNumber`** (our ticket ref). ⚠️ Caveat: if the `invoiceNumber` already exists in Helcim it LINKS to that invoice; if not, Helcim **auto-creates** an invoice with that number. → use a **unique** ref per charge (e.g. `T<ticketId>-<nonce>`) so reopen/re-charge doesn't collide.

### Tips: FRONT DESK enters the tip in-app — terminal tip prompt OFF  *(owner decision 2026-06-08)*
The Helcim terminal *can* prompt the customer for a tip on-device, but **we do NOT want that** — the **front desk types the tip in the app** (as today with Square). So:
- **Disable on-terminal tipping** in the Helcim terminal/POS tip settings (it's a toggle; confirm during setup — see learn.helcim.com/docs/enable-configure-tips).
- The app sends **`transactionAmount = card balance due + front-desk tip`** (the full amount to charge) — same as today's Square `termCharge`. No tip-derivation; the webhook's `amount` should simply equal what we requested.
- Payroll/tip attribution is unchanged from today (the app already owns the tip number in the `tenders`/`tip` shape). ⚠️ This **removes** the earlier "derive tip = charged − requested" idea and Open Q1 about a tip field — we just need to confirm the device-side tip prompt is disableable (near-certain; it's a setting).

### Refund / void
- **Refund** (after batch settlement; supports partial): `POST /v2/payment/refund`, headers `api-token` + **`idempotency-key`** (UUID-ish, 25–36 chars incl. `-`/`_`), body `{ "originalTransactionId": <int>, "amount": <number>, "ipAddress": "<str, required>", "ecommerce": <bool optional> }` → 200 `SuccessfulPaymentResponse`. (`originalTransactionId` = the Helcim `transactionId` we stored on the record.)
- **Reverse/void** (before settlement; full only, no amount): `POST /v2/payment/reverse`, headers `api-token` + `idempotency-key`, body `{ "cardTransactionId": <int>, "ipAddress": "<str>", "ecommerce": <bool> }`.
- → replaces `refundInSquare`. Note both need a customer `ipAddress` (the Worker can supply the request IP).

### Reconcile / reporting
- **List transactions:** `GET /v2/card-transactions/` with query params `dateFrom`, `dateTo`, `invoiceNumber`, `customerCode`, `cardToken`, `cardBatchId`, `search`, `limit` (max **1000**), `page`. Returns an array of transaction objects (incl. `transactionId`, `amount`, `status`, `invoiceNumber`, `dateCreated`, …).
- ⚠️ **`dateCreated` and the `dateFrom`/`dateTo` filters are Mountain Time** — must TZ-convert for reconcile matching against our local records.
- → replaces `fetchSquarePayments`/`reconcileSquareData`; match our records to Helcim by `invoiceNumber` (and store the Helcim `transactionId`). Reports must tolerate BOTH processors during the transition.

### Devices
- `GET /v2/devices/` (query `code`, `limit`, `page`, `offset`) to list/verify paired terminals. Device identified everywhere by the 4-digit `deviceCode`.

## ▶ Proposed Worker + flow design (server-side finalize — recommended)
Because the result is a webhook to the Worker, the cleanest model is **server-side finalize** (vs the client inline-poll Square uses today):
- **New Worker endpoints** (all in the §13 auth pass): `POST /helcim/purchase` (auth-gated proxy → start purchase), `POST /helcim/refund`, `GET /helcim/transactions` (reconcile), and **`POST /helcim/webhook`** (HMAC-verified, NO app auth — it's Helcim calling us).
- **Flow:** app computes split tenders (gift/cash/zelle subtracted) **and the front-desk tip**, as today → calls `/helcim/purchase` with **`transactionAmount = card balance + tip`** + a unique `invoiceNumber` → shows a "charging on terminal — finish on the device…" modal. The customer just taps/inserts their card (no tip step) → Helcim webhooks the Worker → Worker GETs the full txn (confirm `amount` == requested) and **the DO marks the ticket Paid (tenders + tip + `processor:'helcim'` + Helcim `transactionId`/`paymentIds`) and broadcasts** → every device updates; the initiating modal flips to Paid off the broadcast. `terminalCancel` → Worker broadcasts a cancel → modal clears.
- **Why this is better:** the Worker/DO is the single finalize point, which also resolves the pay-path-P0 "reopen-leaves-record" + "cancelled-transaction" cases. Keep a **fallback poll** (`GET /helcim/transactions?invoiceNumber=…`) for a missed/slow webhook.
- **Keep unchanged (processor-agnostic):** the `tenders` map + tip shape, cash-drawer gating, the card-tip→drawer Cash Out — payroll/reports/cash-drawer keep working.

## ❓ Open questions to confirm on real hardware / with Helcim support
1. **(Tip handling — owner wants FRONT-DESK-entered tips)** Confirm the **on-terminal tip prompt can be turned OFF** so the device charges exactly the `transactionAmount` we send (bill + front-desk tip) with no customer tip step. (Near-certain — it's a terminal/POS setting.)
2. Does the **`cardTransaction` webhook also fire on DECLINE** (status `DECLINED`) so we can show "declined, try again"? (And on a timeout/no-card?)
3. **Concurrency / cancel-from-software:** behavior if `/payment/purchase` is sent while the terminal is mid-transaction; is there an API to **cancel an in-progress prompt** (vs only the customer cancelling on-device)?
4. **`invoiceNumber`**: max length, and can we **suppress the auto-created invoice** (or is accumulating invoice objects fine)?
5. **Webhook delivery guarantees / retries** — confirm we should reconcile a missed webhook by polling `card-transactions?invoiceNumber=`.
6. **Account currency = USD** confirmed for the live account; receipts print from the terminal (is there a digital/emailed-receipt API if wanted?).

## Sources (verified 2026-06-08)
- Smart Terminal / Payment Hardware API overview & purchase: https://devdocs.helcim.com/docs/overview-of-payment-hardware-api · https://devdocs.helcim.com/reference/startpurchase.md
- Webhooks (payload + HMAC) & enabling: https://devdocs.helcim.com/docs/webhooks · https://devdocs.helcim.com/docs/enabling-webhooks-for-transactions
- Get / list card transactions: https://devdocs.helcim.com/reference/getcardtransaction.md · https://devdocs.helcim.com/reference/getcardtransactions.md
- Refund / reverse: https://devdocs.helcim.com/reference/refund.md · https://devdocs.helcim.com/reference/reverse.md
- Devices: https://devdocs.helcim.com/reference/getdevices · Tips on terminal: https://learn.helcim.com/docs/enable-configure-tips

## What is NOT affected
Queue, turns/rotation, floor plan, check-in, scheduling, staff/payroll, cash drawer, gift-card balances, the Durable Object sync, Google Calendar, httpSMS. The swap is contained to the payment/customer/catalog/reconcile seams.
