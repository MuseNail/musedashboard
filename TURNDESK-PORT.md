# TurnDesk Port Tracker

Changes made to **musedashboard** (the stable single-salon app) that must be **ported to TurnDesk**
(the multi-tenant SaaS fork in `C:\Users\cpach\Documents\GitHub\turndesk`), plus the financial-audit
findings TurnDesk must address natively.

> TurnDesk was forked at an earlier point (P0: namespaced `turndesk_*` keys, `TurnDeskDO`, etc.).
> Every musedashboard change committed **after** that fork needs to be replayed on TurnDesk.
> See `ROADMAP.md` (TurnDesk section) + `TURNDESK-KICKOFF.md` for the fork plan.

Legend: ☐ not ported · ☑ ported to TurnDesk

---

## 1. Feature / fix commits to replay on TurnDesk

These are straight ports (same code, adjusted for TurnDesk's namespacing / multi-tenant shape).

| ☐ | Ver | Commit | What | Files |
|---|---|---|---|---|
| ☐ | v3.90 | `fedf41d` | Tappable Payment Mix + Refunds **drill-downs** (card/cash/gift/other/refunds) | `reports.js`, `index.html` |
| ☐ | v3.91 | `e36c470` | Inline **price calculator** in the Muse Staff app | `staff.js`, `staff.html` |
| ☐ | v3.92 | `b63fee2` | Muse Staff **"update available" banner** (iOS PWA staleness) | `staff.js` |
| ☐ | v3.93 | `088a5df` | Fix Google **Calendar write auth** failures on desktop (on-demand token refresh, focus keep-alive) | `calendar.js` |
| ☐ | v3.94/95 | `6434fe9`,`e0d4a65` | In-app **SMS delivery-status readout** (`/sms/message/{id}` + poll) | `sms.js`, `worker.js` |
| ☐ | v3.96 | `3297941` | Fix **"stays disconnected after tabbing back"** — zombie CONNECTING socket; deterministic reconnect | `sync.js` |
| ☐ | v3.97 | `572858a` | **Zelle** as a tracked tender (checkout field + Square external payment + Payment Mix box/drill-down + reconciliation) | `square-pos.js`, `reports.js`, `index.html` |
| ☐ | v3.98 | `9735110` | Remove **stale Google Sheets** code (deleted `.gs`, renamed `sheets-sync` → `conn` indicator) | `index.html`, `main.js`, `styles.css`, `worker.js` |
| ☐ | v4.00 | `276e616` | **Roster-wipe fix** — day rollover gated GLOBALLY (synced `last_rollover_date`) not per-device, so a device opened mid-day can't re-clear the turns roster. `utils.rolloverAction()` + test. | `main.js`, `store.js`, `utils.js` |
| ☐ | v4.01 | `e158883` | **Square Settlement Reconciliation** (pull Square actuals, match by payment id) + **"Party of N — " note** for multi-customer tickets. `reconcileSquareData()` pure + test. | `reports.js`, `square-pos.js`, `index.html` |
| ☐ | v4.02 | `220f778` | **Customer dedup/cleanup** (findDuplicateGroups by phone+name, merge=delete-extras, no-phone list) + **shared-phone overwrite prevention** (`upsertPartyCustomers`). Pure + tests. | `square-customers.js`, `queue.js`, `checkin.js`, `index.html` |
| ☐ | v4.03 | `55000b3` | Transaction **"Paid by" chips** (Card/Cash/Gift/Zelle incl. splits) | `reports.js` |
| ☐ | v4.04 | `e26cadd` | **Refunds total** in the Transactions bar | `reports.js`, `index.html` |
| ☐ | v4.05–v4.06 | `58494f4`,`54e6f59` | **Refund → Square** (opt-in toggle, default OFF; card+cash+Zelle, card-first, idempotent) + reconciliation app-total = card+cash+Zelle+tips | `reports.js`, `index.html` |
| ☐ | v4.07 | `7169d52` | **Tap a transaction → full breakdown** (`showTxnDetail`) | `reports.js` |
| ☐ | v4.08 | `c3d27d7` | **Charge gift-card SALES through Square** (Card/Cash/Zelle/No-charge); reusable `chargeOnTerminal`; reconcile counts gift sales | `giftcards.js`, `square-pos.js`, `reports.js`, `index.html` |

> Earlier-than-v3.90 changes (v3.85 httpSMS, v3.86 off-registry gift cards, v3.87 reconciliation, v3.88
> stale-write guard, v3.89 Assign&Price lock) may also post-date the fork — verify against TurnDesk's
> fork point and replay any that are missing.

---

## 2. Financial-audit fixes (v3.99) — port these AND keep the invariant

Audited 2026-06-01 (5-agent parallel review of the whole money path). Fixes shipped in musedashboard
`b71cf92`, `9a02618`, `64d0c4f`:

| ☐ | # | Fix | Where | Notes for TurnDesk |
|---|---|---|---|---|
| ☐ | 1 | **Payment Mix no longer double-counts parties.** A party's tender is recorded on the PRIMARY member only; tenderless secondary members were wrongly counted in `otherMix`. New shared `paymentMix()`/`isOtherTender()`/`tenderedGroupIds()`. | `reports.js` | Invariant: `card+cash+gift+zelle+other === totalIncome + tips`. Used by runReport + computeMetrics + drillDownPay('other'). |
| ☐ | 2 | **Gift-card outstanding liability** uses `gcTotalUsed(g)` (redemption sum) not cached `g.amountUsed`, floored at 0. | `reports.js` | The legally-significant liability number must derive from the redemption ledger. |
| ☐ | 3 | **Gift-card over-redemption guard.** `gcSyncTicket` hard-clamps each draw to remaining balance; `saveGiftCard` rejects edits exceeding card value; list shows red "Overdrawn". | `giftcards.js` | TurnDesk should ALSO enforce this server-side (see §3). |
| ☐ | 4 | **Terminal idempotency keys are deterministic** (ticket+cents) so a retry can't double-charge. Reset `_payZelle` on finalize. | `square-pos.js` | Keep deterministic keys in the processor adapter. |
| ☐ | 5 | **Deletion resurrection guard.** `record.save` (client + DO) refuses to revive a deleted id. + unit test. | `store.js`, `worker.js`, `test/store.test.js` | Critical financial-integrity invariant. |

---

## 3. Open audit items — TurnDesk must address NATIVELY (do NOT build in musedashboard)

These are the productization blockers. Severity is for a **public multi-tenant product**.

### CRITICAL (security / money movement)
- ☐ **No auth on `/square` proxy or `/state` mutations.** Anyone with the Worker URL can move money / read any salon's data. Require a signed session token validated server-side on every `/square`, `/state`, `/sms`, `/push` request.
- ☐ **Tenant chosen by `?salon=` URL param** (`worker.js` `salonId = url.searchParams.get('salon')`). Attacker-controllable cross-tenant access. Derive `salonId` from the authenticated token, never the URL.
- ☐ **No server-side validation that recorded tenders == amount charged.** All split-tender/total math is client-side; the DO persists whatever arrives. Move order/total authority server-side or add a post-charge reconcile job (compare `squarePaymentIds` amounts to recorded `tenders`).

### HIGH (correctness / scale / legal)
- ☐ **No sales tax anywhere** (zero `tax` references). Per-tenant tax rate(s), taxable flags on services/items/fees, a tax line through `ticketTotal` → records → reports → exports. **Hard blocker.**
- ☐ **Money is floats, not integer cents** — structural penny-drift. Standardize on integer minor units internally; format at the edges; one `parseMoney`/`formatMoney` (with per-tenant currency, not hardcoded USD/`$`).
- ☐ **Single Square account / no processor abstraction.** TurnDesk needs the locked **PaymentAdapter** seam (Square / Stripe / **Helcim**) with per-tenant credentials resolved by `salonId`.
- ☐ **Reports compute client-side over the full records array** — won't scale to multi-year / multi-location. Server-side (DO/Worker) pre-aggregated daily rollups; add a **location dimension** for multi-location rollups (the "Multi" pricing tier).
- ☐ **Gift-card law:** no expiration policy, no liability aging, no breakage/escheatment workflow. Real exposure (CARD Act + state unclaimed-property). Add per-tenant policy + aging/breakage reports. Enforce serial uniqueness.
- ☐ **Unbounded records growth** — full snapshot on every connect; client holds the whole array + mirrors to localStorage (quota risk). Archive closed-period records; paginate by date range.

### MEDIUM / hardening
- ☐ **Terminal RESUME-after-reload** — if the device reloads mid-charge, the card may be charged but the sale never recorded (the Terminal path has no resume; only the legacy deep-link does). Persist `_termCheckoutId`, reconcile on hydrate. *(Also worth doing in musedashboard once live-tested.)*
- ☐ **Partial cash/Zelle Square-record failures** only `console.warn` — surface to the operator + flag the record for reconciliation.
- ☐ **Clock-skew defeats the stale-write guard** (compares client `Date.now()` across devices). Stamp version/`updatedAt` server-side in the DO; client time only as a tiebreaker.
- ☐ **`mutationId`** uses a reload-resettable counter + wall-clock → rare collision → dropped write. Use `crypto.randomUUID()`.
- ☐ **Outbox HTTP-fallback** writes aren't retried if the POST fails and the WS never returns — add a periodic flush.
- ☐ **`config.set` is unguarded** — concurrent edits to array-valued config (staff/services/fees) last-writer-wins the whole array. Per-element ops or version check.
- ☐ **`giftcard.save` has no stale-write guard** — a restore clobbers newer redemptions (gift cards use ISO-string timestamps, not the numeric guard).
- ☐ **Cash drawer:** `shiftCashSales` keys off `checkinTime` not payment time (stamp `paidAt`); concurrent drawer edits drop movements (config last-writer-wins); single register only; "Unknown" attribution under unauth sessions.
- ☐ **Audit log** is best-effort/fire-and-forget and prunable — for chargeback/dispute defense it should be server-side, atomic with the mutation, append-only/immutable.
- ☐ **`exportReportLink`** PUTs report HTML (customer names/phones) to an R2 URL with no auth — PII exposure; gate it.

### LOW / cleanup (also applies to musedashboard)
- ☐ Duplicate total formula in ~4 places — collapse onto `ticketTotal`.
- ☐ Legacy `proceedSquarePayment` deep-link still wired, records no tenders (lands in "Other") — retire or feature-gate.
- ☐ Legacy verbatim relay in the DO (`{type:queue|config}` rebroadcast, "Remove after cutover").
- ☐ Payroll math built 3× (`renderPayrollPage`/`payrollGrid`/`payrollExportRows`); dead `_refCells`; dead `--md-*` CSS var in reports.js.
- ☐ Reconciliation labeled "charged" but is bill-vs-bill (excludes tips) — relabel.
- ☐ Avg Ticket numerator includes refunds but denominator excludes them.
- ☐ Delta math (`setDelta`/`_pcmp`) divide-by/sign issues on zero or negative prior.

---

_Last updated: 2026-06-01 (musedashboard @ v3.99)._
