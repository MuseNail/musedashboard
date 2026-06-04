# Square → Helcim migration plan (musedashboard)

**Status:** IN PROGRESS — customers + catalog DONE; payments/auth/reconcile REMAIN · **Created:** 2026-06-03 · **Updated:** 2026-06-04 (prod v4.33) · **Decision:** in-repo replacement (NOT TurnDesk's multi-processor adapter — keep it a simple swap; see CLAUDE.md "Product line" box).

## ✅ PROGRESS (2026-06-04) — what's done vs what remains
**DONE (shipped v4.23–v4.27):**
- **Workstream C (catalog → local): COMPLETE.** Square catalog pull/push + the "push to Square" buttons removed (v4.23); catalog is `config.services/items/fees` only. Square **Bookings** + appointment-sync also removed.
- **Workstream B (customer directory → DO): mostly COMPLETE.** Customers are now a synced DO **`customer:<id>` entity** (`customer.upsert/delete/bulkUpsert/bulkDelete`, per-record stale guard + `custdeletion:` tombstones) with a dedicated **Customers tab** (search/add/edit/delete/dedup/CSV/import-from-Square). The one-time Square→DO import is built (owner ran it). `config.customer_notes` stays phone-keyed. **The Square customer DUAL-WRITE is intentionally KEPT** (check-in/pay + tab edits) so card charges stay linked — retire it at the Helcim cutover (Workstream E).

**REMAINING (Phase 4 — gated on the Helcim Smart Terminal hardware):**
- **A. Payments/Terminal → Helcim** (the core, structural poll→webhook change).
- **D. Reconcile + reports → Helcim** (generic `paymentIds` + `processor` on new records).
- **§13 full Worker auth** (the unauthenticated-backend cluster) — lands in the same Worker pass as the Helcim proxy/webhook.
- **Pay-path P0 consolidation** (do FIRST, hardware-independent): one "→ paid"/reopen path incl. the **cancelled-processor-transaction** + **reopen-leaves-record** cases (see `PRIORITIES.md`).
- **E. Retire Square:** stop the customer dual-write, remove `/square` proxy + `SQUARE_TOKEN` + the Square config UI; keep historical Square ids on old records.

**Hardware-independent first steps (can start anytime):** the **Helcim-API research pass** (below) + the **pay-path P0 consolidation**.

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

## ⚠️ Research needed before building (Helcim API specifics — verify, don't assume)
- Smart Terminal API: exact start-purchase request, the webhook payload shape + how to correlate it to our ticket (reference_id?), and whether a status-poll fallback exists.
- Refund API + idempotency model.
- Transaction-list/reporting API for reconcile (filtering by date/location).
- Whether tips are captured on the terminal or passed in the request (affects the tip flow).
- Customer/invoice API (only if we ever attach a customer to a transaction).

## What is NOT affected
Queue, turns/rotation, floor plan, check-in, scheduling, staff/payroll, cash drawer, gift-card balances, the Durable Object sync, Google Calendar, httpSMS. The swap is contained to the payment/customer/catalog/reconcile seams.
