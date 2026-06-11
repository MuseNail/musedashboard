# Live App Priorities (musedashboard)

Build backlog for the **live single-salon app** (distinct from `TURNDESK-PORT.md`, which tracks the
public-product fork). Ordered by impact.

> ## 🔥 CURRENT (2026-06-11, prod = **v4.78 pushed/live**; `dev` carries a built+verified batch awaiting end-of-day merge → v4.79)
> 1. ✅ **`dev` batch BUILT & verified in preview (NOT version-bumped, NOT merged):** **A** status palette swap (In Service teal→**green #2a7a4f**, Done green→**blue #1a5c7a**) app-wide — `serviceLineStyle`/staff `STATUS_CHIP`/`.badge-*`/queue `statusBtnStyle`/turns border+tint+slots+**status-colored consistent active-list avatars (#6/#7)**/floor tints · **B** Add Historical customer **autofill** (`histAcSearch`/`fillHistCustomer` reuse `filterCustomers`) · **reconcile Fee Saver line** (Helcim view now shows recorded-card + surcharge + not-yet-recorded = Helcim gross, with a "surcharge isn't salon revenue" note) · **C** payment **method on historical** (#3.2 — method selector + optional ref → writes `tenders`) + **admin "Already paid — record without charging"** on the Pay screen (#5 — manager/admin-gated, 2-step warning→form, reuses `_finalizeTerminalPaid`) · **D** **webhook-miss detector** (`checkUnfinalizedCharges` in helcim.js, on hydrate+focus throttled 1/min — matches `tkt-<id>-<cents>` APPROVED charges to unpaid tickets → one-tap finalize, never re-charges). Also added a **`.gitignore`** (wrangler cache / tail logs / review scratch). **NEXT: end-of-day merge dev→main as v4.79 (trio bump → push w/ owner OK).**
> 2. **Helcim follow-ups:** owner merges the v4.72-era duplicate customers in the Helcim dashboard; verify text-receipt phone prefill on a live charge; then the **refund path + §13 Worker auth**.
> 3. **Revisit-later (owner-flagged in the UX audit):** B6 checkout layout (tips stay MANUAL $ entry — never presets) · B7 kiosk single-button check-in (keep `isAppointment` accurate). Details in memory `ux-audit-decisions`.
> 4. **Reconcile note (verified 2026-06-11):** Jun 10 app-card $1004 + Fee Saver $16.32 surcharge + Jeanie $46.35 (manual, recorded via Add Historical) = Helcim $1065.32 — reconciles to the penny; the app books the bill, Helcim's gross includes the customer-paid surcharge. No money missing.

> ## ⭐ MASTER PLAN = `NEXT-SESSION-KICKOFF.md` (post-audit phased strategy, 2026-06-03)
> **STATUS 2026-06-10 (prod v4.76): Phases 1–3 DONE; Phase 4 (Helcim) is LIVE in production** — payments (webhook-driven Terminal flow), reconcile, and customer-carry all shipped; `HELCIM-MIGRATION.md` has the current state. Remaining from Phase 4: the Helcim **refund path**, **§13 full Worker auth** (gate `/helcim/*` + `/gcal/token`), the **pay-path P0 consolidation** below, and **retiring Square** when the owner calls it.

---

## ⭐ P0 (NEW, owner-requested 2026-06-03) — "Paid" status policy + safe reversal

Decide and implement the rules around marking a ticket **Paid**, then make mistakes recoverable:

1. **Should staff be able to mark a ticket Paid manually at all?** Today there are two "→ paid"
   paths: the full **Pay screen** (records tenders + gift draw-down + audit) and a quick
   **"Mark Paid ✓"** status button (`_blockDirectPaid` blocks front-desk users without the
   `markPaidDirect` permission when Square is configured + total>0, but admins/managers and
   $0/no-Square tickets pass straight through). Decide: who (which roles) may mark paid manually,
   under what conditions, and whether the quick button should exist at all or always route through
   the Pay screen.
2. **The two paths diverge** (the §5/§8 "divergent pay paths" finding): the quick path skips
   gift-card draw-down, the payment audit entry, and tender recording — so cash/gift sales done that
   way are invisible to the drawer and reports. The fix is to **funnel every "→ paid" (and reopen)
   through ONE path** that always does tenders + gift sync + audit.
3. **Safe reversal of a mistake:** define and harden the "un-pay"/reopen flow so it always
   (a) reverses gift-card redemptions (`gcReverseTicket`), (b) leaves a clear audit trail, (c) can't
   double-charge or strand money, and (d) is permission-gated. Today reopen via the modal status-cycle
   bypasses gift reversal (§5), and refund doesn't reverse gift redemptions (§7) — both must be closed
   as part of this. **NB (audit §7):** reopening a PAID ticket reverses gift cards but does NOT remove
   the already-saved transaction record, so the sale keeps counting in Reports until it's re-paid — the
   safe-reversal must void/zero (or non-count) the record on reopen.
4. **⭐ Cancelled processor transaction (owner-flagged 2026-06-04):** define what happens when a
   processor charge is STARTED then CANCELLED before payment is taken — e.g. front desk taps Pay on the
   Square/Helcim terminal, then cancels (needs to make adjustments, or the customer needs more time).
   The ticket must **NOT** be marked Paid and must **NOT** count in Reports — it should cleanly return
   to its prior status (in-service/complete) with no record written, no tenders recorded, and any
   staged gift draw-down un-staged. Audit the current Square Terminal flow for this (the `muse_term_pending`
   handling + the "→ paid" return path) and make the cancel/back path a first-class, no-op-on-finances
   case. Carries straight into the Helcim **poll→webhook** rewrite (a webhook "declined/cancelled"
   result must finalize to NOT-paid). Pairs with #2 (one pay path) so cancel is handled in one place.

This is a policy decision + a structural consolidation; do it as its own change (good candidate to
pair with the §10 Square pay-flow audit). Related audit findings: §5 (gift draw-down skip, reopen
bypass), §7 (refund no-reverse), §8 (A3, A4).

---

## ✅ RESOLVED — Roster wipe / "losing sync" (v4.00, `276e616`)

Selected technicians disappeared mid-day, multiple times. Root cause: the daily rollover clears the
turns roster and broadcasts that clear to all devices, but it was gated by a **per-device** marker —
so any device first opened mid-day (its local marker still on yesterday) ran the clear and wiped the
shared roster. Fixed by gating the once-per-day housekeeping on a **shared synced marker**
(`config.last_rollover_date`) so it fires once globally; a mid-day device sees "already done today"
and leaves the roster alone. (`utils.rolloverAction()` + unit test.)

---

## ✅ P0 BUILT — Square Settlement Reconciliation (v4.01, `e158883`) — pending live verification

"Reconcile w/ Square" button in Reports pulls Square's actual payments (List Payments) for the date
range and matches them to records by `squarePaymentId`: shows Square-collected vs App-billed +
Matched N/total, then "In Square, not in app" and "In app, not matched to Square". Pure
`reconcileSquareData()` + unit test; validated against 4 real days (109/147 matched; gaps = records
with no payment id + a couple double-charges). Also: multi-customer Square note now prefixed
"Party of N — ". ⚠️ Live Square pull needs owner verification (preview can't reach Square).

---

## ⏳ AWAITING OWNER LIVE-TEST — shipped, real-money paths (preview can't reach Square/Terminal)

These are built + pushed (v3.97→v4.09) but only the owner can confirm them on real hardware:
1. **Reconcile w/ Square** on a real day → totals tie to the deposit, refunds netted.
2. **Refund → Square** (opt-in toggle, default OFF) — refund a $1–2 card sale with it ON → money
   returns to the card.
3. **Gift-card sale charged through Square** — sell a $1–2 gift card "Pay by Card" → Terminal charges.
4. **Customer "Clean up"** — merge a duplicate → confirm it's removed from Square too.

Audit takeaways (2026-05-29..06-01): tax & tips were $0 (not the cause). Mismatch drivers = (1)
"no-tender" app records marked paid without a captured Square payment id, (2) a few double-records
(Tea Wolf $66 ×2 on 5/31; Bree Zeitz $46 charged+refunded 6/01), (3) the 5/29 deep-link era had no
payment ids at all.

---

## P0 — Reconcile app totals vs the ACTUALLY-charged transactions (original notes)

**Problem (owner, 2026-06-01):** report totals very often don't match Square.

**Why they diverge** (from the 2026-06-01 financial audit):
- The app records what it *thinks* was charged (client-computed `tenders`), not what the processor
  *actually* charged.
- Cash/Zelle "record in Square" calls can **silently fail** (console.warn only) → Square ends up short.
- The legacy **"Square POS" deep-link** path records **no tenders** → those real card sales show up
  as "Other / Untracked" in the app.
- **Charged-but-unrecorded** (the Terminal reload gap, P1) → Square has money the app never recorded.
- **Tips** are tracked separately from the bill; Square's *deposit* includes tips → comparing the
  app's "billed" to Square's gross will never match.
- **Refunds / voids done directly in Square** (not through the app) aren't reflected.

**Note:** the existing "Reconciliation" report (v3.87) only compares the app's recorded total to the
app's *own* recorded tenders — it does **not** compare to Square's actual charges. That's the gap.

**Plan — a "Settlement Reconciliation" that compares app records to the processor's ACTUALS:**
- **While on Square:** auto-pull payments (`GET /square/v2/payments` by date + location), match to app
  records by the stored `squarePaymentIds`, and flag both directions:
  - in Square, not in app → *charged but unrecorded*
  - in app, not in Square → *recorded but not charged* (or recorded with the wrong amount/tender)
- Show the **true charged total** (= the deposit) next to the app's recorded total, with the
  unmatched list to fix.
- Build the reconciliation UI **processor-agnostic** so it can also ingest a **CSV export** from any
  processor (Square or GoDaddy) — see P2.

---

## P1 — Terminal resume-after-reload (charged-but-unrecorded)

If the iPad reloads/crashes mid-charge, the in-memory Square checkout id + polling loop are lost; the
card may have been charged but the ticket is never marked Paid and no record is written. v3.99 made
the idempotency keys deterministic (no double-charge on a manual retry), but the **missed-record half
remains**. Proper fix: persist the checkout id, and on startup look up the real Square status and
finish/resume/clear. **Must be tested live on a real Terminal** (preview can't reach Square) — that's
why it wasn't shipped blind.

---

## P2 — Processor-agnostic payment recording (likely **Helcim**; GoDaddy on hold)

**2026-06-01: GoDaddy on hold — owner leaning toward Helcim.** Helcim has a real API + virtual
terminal, so it could be more than manual-entry (unlike the GoDaddy assumption). Ties into TurnDesk's
locked processor-adapter (Square/Stripe/**Helcim**). Revisit the build shape once the processor is
decided.

Owner may otherwise switch to a standalone terminal with amounts typed in **manually** — no API charge.
In that model the **app is the system of record**:
- App computes the total → operator records the **tender type + actual amount keyed** (+ optional
  confirmation/transaction # for audit).
- Reconcile by comparing the app's daily total (by tender) to GoDaddy's **batch/settlement report**
  (manual eyeball, or CSV import — same reconciliation UI as P0).
- Disable the Square-Terminal auto-charge path; keep the manual "Record Payment" flow.

The same processor-agnostic layer serves **both**: Square (auto-pull) and GoDaddy (CSV/manual). This
is the live-app-sized version of TurnDesk's "payment adapter."

---

## P3 — Money as integer cents (low priority for live app)

All money is stored as float dollars; exact only because checkout rounds to cents at the Square edge.
Causes minor penny-drift in comparisons/reconciliation. **Low risk for one salon** — a retrofit would
mean migrating existing float data for little daily benefit. Design **TurnDesk** on integer cents from
the start instead; only revisit the live app if drift becomes a real problem.

---

## ⏸ PARKED — SMS texting (httpSMS) — blocked on the phone, owner decision needed

Send pipe works (Worker → httpSMS accepts, returns a msg id) and the in-app delivery-status readout is
live, but the **Samsung Fold returns "generic failure"** when it tries to send — likely Android 14/15
blocking SMS from a **sideloaded** app. Ruled out: permission, SIM, plan/carrier, cloud pipe. Owner to
pick a direction: Play-Store httpSMS / App-info → "Allow restricted settings" first, else a non-Samsung
Android gateway, **SMSGate** (capcom6), or **Twilio**. See memory [[sms-texting]].

---

## Open audit items (mostly TurnDesk-bound)

From the 2026-06-01 financial/security audit, not yet addressed: unauthenticated `/square` + `/state`
endpoints (& `?salon=`), no sales-tax handling, client-side reports scaling, and **gift-card law** (real
legal exposure). Most belong on the TurnDesk fork (`TURNDESK-PORT.md`); revisit for the live app only if
one becomes an operational problem.

---

## Recently shipped (not previously on this list)

- **v4.10 (`8ad6a93`, client-only):** quick-date presets on the Turns + Queue history pickers; smooth
  **in-place pill toggles** via shared `utils.setSwitchVisual()` (fixed the "weird bounce" / dropped taps).
- **v4.11–v4.15 — the 2026-06 system audit fixes** (see **`AUDIT-2026-06.md`** for the full record):
  tip-forced-onto-card; numpad `00` overflow; `saveRecord`→`ticketTotal`; historical discount cap;
  Square push error toast + stable idempotency; observability (dead-letter toast, "Failed N" pill,
  global error handler); **`config.set` stale-write guard** (the roster-wipe root cause); §7 reports
  hotfixes (historical double-count, partial-refund recording, DST-safe pay period); §8 cash-refund
  drawer Cash-Out; gift-card ticketId carry-through + **`giftcard.save` guard**. (v4.13 + v4.15 included
  Worker changes — deployed.)

> ⭐ **The active system-wide audit (§1–§8 done, §9 next) and ALL open findings live in `AUDIT-2026-06.md`.**
> The P0 above ("Paid" status policy + safe reversal) came out of it.

---

_Last updated: 2026-06-03 (musedashboard @ v4.15). Audit record: `AUDIT-2026-06.md`._
