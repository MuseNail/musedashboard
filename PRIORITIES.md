# Live App Priorities (musedashboard)

The build pipeline for the live single-salon app, ordered by impact. Cleaned 2026-06-11 (prod **v4.81**); resolved history was pruned — git log + `AUDIT-2026-06.md` + `ROADMAP.md` are the historical record. Parked/unscheduled ideas live in `IDEABOARD.md`.

---

## 1 — Helcim refund / void path
App refunds still assume Square payment ids. Build the Helcim path: Worker proxy for `POST /v2/payment/refund` + `POST /v2/payment/reverse` (idempotency-key required; `cardTransactionId` + ipAddress — verified API findings in `HELCIM-MIGRATION.md`), client refund flow routes by processor, and the refund **reverses gift-card redemptions** (closes the old audit §7 finding). New records already store the Helcim `transactionId` in `squarePaymentIds`.

## 2 — §13 Worker auth (the open backend)
The Worker has **no app auth**: `/state` (read+write), `/helcim/*` (except the HMAC'd webhook), `/gcal/token|connect`, `/photos`, `/sms` are callable by anyone with the URL. Owner chose a proper full fix over patches: **shared bearer token** held by clients + checked by the Worker, coordinated client+Worker deploy. `RESTORE_TOKEN` is already set (reset/restore closed). This is the biggest open security item — bundle with any next Worker change.

## 3 — Retire Square (owner calls the timing)
Helcim is live and default; Square is still selectable. When called: stop the Square customer **dual-write**, remove the `/square` proxy + `SQUARE_TOKEN`, the Square config UI + deep-link path, and the Square reconcile; keep historical Square ids on old records. (Don't fix bugs in this doomed code.)

## 4 — Owner live-verifications (quick)
- Merge the v4.72-era **duplicate customers in the Helcim dashboard**; confirm text-receipt phone prefill on a live charge (v4.76 `cellPhone` fix is deployed).
- v4.79–v4.81 on the floor: the green/blue status colors, the **calculator money fields** (plain-dollar entry is a habit change), per-person subtotals, the admin "record without charging" 2-step, the What's-New popup.
- The **webhook-miss detector** (v4.81) when a real unfinalized `tkt-` charge occurs.

## 5 — Growth features (from the 2026-06-11 competitor comparison)
What the mainstream salon platforms (Mangomint/Boulevard/Vagaro/Square) all have that we don't, in rough money-impact order. None scheduled — owner picks:
1. **Automated customer SMS appointment reminders/confirmations** — the biggest no-show lever; appointment data + Worker seam exist. **Blocked on the SMS gateway decision** (Samsung Fold sideload "generic failure"; options: Play-Store httpSMS / SMSGate / Twilio).
2. **Post-checkout review requests** (text a Google-review link on paid) — Fastboy's whole nail-salon pitch; cheap to add once SMS works.
3. **Card-on-file / deposits / no-show fees** — Helcim supports card-on-file; `customerCode` already rides purchases.
4. **Online self-booking** — the big one; overlaps the paused TurnDesk thesis.
- Cosmetic steals worth considering: per-tech calendar color-coding, rebook-shortcut chips on the paid screen, week view on the calendar, slide-in side panels vs stacked modals.

## 6 — Pay-path P0 residuals (mostly DONE — see history)
The 2026-06 P0 ("Paid" policy + safe reversal) is largely shipped: tickets with total>0 always route through the Pay screen (v4.55), reopen voids the record reversibly (v4.55), a cancelled charge unstages gift + restores fees (v4.55/v4.78), manual mark-paid is a gated 2-step with tenders (v4.81), and missed webhooks are auto-detected (v4.81). **Residual:** Helcim-side cancelled-charge audit trail (`terminalCancel` resolves not-paid — verify on hardware), and the reopen permission gate review.

## 7 — Deferred / low-priority (owner-acknowledged)
- **Permission-toggle wiring:** `canDo('viewReports'/'manageStaff'/'manageServices')` read config but are never called — wire gates at the nav + Settings leaves (check live `fd_users` roles first so nobody locks out).
- **Code debt from the v4.77 review:** collapse the `ASSIGN_ONELIST` dead tabbed layout + factor the duplicated party-consolidation money math + derive the queue/staff status maps from `serviceLineStyle` (palette lives in ~4 copies).
- Audit leftovers: §9 calendar edge cases (party-drop, saveAppt atomicity, stale-day race), §11 whole-object schedule/station_layout concurrency.
- **P3 integer-cents money model** — only if penny-drift becomes a real problem (design TurnDesk on cents instead).
- **SMS texting** (see #5.1) — parked until the owner picks a gateway direction.

---

## Standing rules (every session)
- Feature work on `dev`; hotfixes on `main`; **one version-trio bump at the end-of-day merge** (`js/app/config.js` + `version.json` + `sw.js`). Add a `WHATS_NEW` entry (main.js) for user-visible changes.
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` is the owner's job**.
- Verify in preview — but the preview's WebSocket can reach the **prod** DO when online: never dispatch test writes; an offline preview's dispatches stay local. Prod repair = raw `GET /state/snapshot` / `POST /state/mutate`.
- TurnDesk is **PAUSED** (`TURNDESK-KICKOFF.md` when resumed). Helcim was an in-repo single-processor replacement — keep it simple, no adapter layer.

_Last cleaned: 2026-06-11 (v4.81)._
