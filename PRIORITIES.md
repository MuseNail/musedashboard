# Live App Priorities (musedashboard)

The build pipeline for the live single-salon app, ordered by impact. Refreshed **2026-10-23 (prod `v5.84`)**. Resolved history is pruned — git log + `AUDIT-2026-06.md` + `ROADMAP.md` + `HELCIM-MIGRATION.md` are the record. Parked/unscheduled ideas live in `IDEABOARD.md`.

---

## ✅ Shipped since the last refresh (v5.59 → v5.84)
- **v5.60–v5.63:** tech-price-decouple (entry decoupled from completion) · phone-wake resync (zombie-OPEN heal + wake watchdog) · payroll "All techs" Total column.
- **v5.64–v5.72 (17-item feature batch, waves 1–3):** comp redesign (comp keeps price; customer $0, tech paid, "Comped" total) · editable tiered/searchable Price-Menu SYSTEM + editor redesign · in-app staff→manager Support tickets (admin inbox, push) · assorted quick wins.
- **v5.73 + v5.83:** Price-menu editor hotfixes (master-detail redesign; resizable list column + page-settings row above services + inline add buttons).
- **v5.78–v5.82 (turn + floor batch):** turn-system overhaul (configurable half/bonus "$X or less" cutoffs, count-at-done via Base cost, turn-count in its own resizable column) · suggestion fairness + skill-gating · floor waiting-bar/tech-timer/customer-breakdown/robust tech-notes (`staff.notePatch`) · floor technicians → resizable left column.
- **v5.84 (this batch, 2026-10-23):** turns next-up no-shift (inset bar) + billed $ stacked under the bonus · tech-status popup 3 columns (Available ✓ / Not Available ✗ / Notes) + vertical buttons beside the kept 175px avatar · **price-menu section move/delete now carries subheaders+rows** (orphan bug) · floor tech-column top-aligns + spreads to floor height (gap capped 40px) · reminders 700px + max-3-visible scroll (soonest first). Detail: `docs/superpowers/specs/2026-10-23-batch-turns-techbubble-pricemenu-floor-reminders-plan.md`.

### ⭐ Floor plan — bounds + non-overlap + named/saved plans (JOINT design session, owner-deferred 2026-10-23)
Three entangled items deferred TOGETHER because a **bounded/fixed floor** makes positions absolute and device-independent, which is the clean foundation for the other two:
- **#5 Dashed working-area bounds** — the floor is currently *unlimited* (auto-sizes to `maxRight+GAP`). Decide: fixed room rectangle (dashed border, can't place outside) vs. dashed outline of current extent.
- **#6 Station auto-push** — owner wants stations to shove neighbors aside to avoid overlap. Built-now was deferred because on the unbounded/per-device-reflowing canvas it would freeze pushed stations' computed-default x/y into synced `station_layout` at the editing device's width (iPad then shows desktop coords, only a full reset undoes). A bounded floor removes this landmine. Design notes in the v5.84 plan doc (enumerate all `getStations()` via `layoutFor`; geometry-mutators only; pre-commit snapshot + Undo; opt-in toggle).
- **Named / saved floor plans** (from the 17-item feature batch) — multiple saved layouts the owner can switch between.

### Earlier shipped (v5.22 → v5.59)
- **v5.56–v5.59 (2026-09-09 → 24):** v5.56 TurnDesk back-ports (hide deactivated staff, staff contact + SSN-last-4, note previews); **v5.57 chat empty-channel freeze fix** (opening an empty conversation looped dispatch → froze the app); **v5.58 outbox OOM self-heal** (`coalesceConfigSets` — a flooded config.set outbox no longer OOMs the tab on boot); **v5.59 parity ports** (turns "Awaiting price" violet cue, Data Recovery restores gift cards + customers, turns long-name truncation + card-name escaping).
- **Receipt printing (RP327)** — v5.22 LIVE (80mm receipt + tech-ticket totals + re-routable review QR). *Owner hardware TODO remains: install the RP327 Windows driver, live-test a print + QR scan, paste the real Google review link in Settings.*
- **Check-in service waiver** — R1 + R1.1 LIVE (v5.46): every-visit e-sign, per-visit stamp, PDF/text versioned, non-broadcast `waiver:<id>` storage.
- **Calendar + Tasks — clean break from Google** — v5.47–v5.49 LIVE: app-native calendar/tasks, all Google/gcal/OAuth removed. (Dormant-for-rollback `GCAL_CLIENT_SECRET` + `gcal:blob` DO key still present — see #0.)
- **Calendar break time-blocks** — one-off (v5.50) + recurring (v5.51) LIVE.
- **Front-desk → kiosk waiver handoff** — v5.52 LIVE: "Send to kiosk", customer signs there, escape hatches record bypassed waivers.
- **Offline-resilience safeguards** — v5.53 duplicate check-in guard + v5.54 loud offline/unsynced banner (front desk + tech app). LIVE.
- **Workflow polish** — v5.55 LIVE: chat copy/paste + per-user synced read-state, 2-column Record-Payment + customer note + Zelle "doesn't add up" check, cash-drawer reports dropdown, uniform appointment pop-ups, station-first staff card.
- Earlier: §13 Worker auth ENFORCED; Helcim refund path (v4.97); bug reporter (v5.39).

---

## 0 — Loose ends to clear soon (low effort)
- **Refund-safety hotfix (v5.42 / Phase 3 "0-pre")** — restore-hardening + refund-idempotency committed on `main` (`8ce64d6`, `abca853`); **confirm whether it was ever deployed** (needs a `wrangler deploy`, owner OK). Residuals documented in `[[phase3-storage]]`.
- **Delete dormant Google creds** — after the clean-run window: `wrangler secret delete GCAL_CLIENT_SECRET` + drop the `gcal:blob` DO key.
- **Unify the self-kiosk inline waiver clause** with the shared `WAIVER_ACK_SINGLE` (waiver.js) — one-liner, but it's on-screen legal text → needs owner sign-off.
- **Sync-banner "wedged syncing"** — soften "syncing…" copy after ~60s of unchanged pending (rare; deferred).
- **Label consistency — "Done" everywhere (owner-requested 2026-10-23).** The finished-service status is shown as both **"Done"** (the pills via `serviceLineStyle`/`STATUS_CHIP`) and **"Complete"** (the Assign&Price modal per-service button `queue.js:~1427`, the turns report `_statusWord` `turns.js:~1131`, maybe others). Standardize all user-facing copy on **"Done"**; keep the internal status value `'complete'` unchanged (code/data), change only the displayed strings. Low effort, pure copy — grep `Complete`/`complete` for on-screen text across queue.js / turns.js / staff.js / index.html.
- **Revisit `STALE_MS` (phone-wake resync)** — the wake/liveness fix (`sync.js`, shipping next) treats a socket silent **30s** as dead (zombie-OPEN heal + visible watchdog). 30s was the owner's "for now" value (above the 20s ping, under the 40s heartbeat). After a few weeks on the techs' phones, retune if recovery feels slow (lower) or if we see needless reconnects/snapshots (raise). One constant in `sync.js`.
- ✅ **Comped line / overcharge — RESOLVED in v5.65 (comp redesign, 2026-10-21).** Owner's model: a comp KEEPS its price; the **customer pays $0** (`ticketTotal` honors `comped` via new `lineCharge` in `utils.js`), the **tech is still paid** in full (billed + commission on the raw cost), and the **business giveaway** shows as a new **"Comped"** total in Reports (`compedAmount`). Comp no longer wipes the price; the tech app shows a "Comp" chip. Spec: `docs/superpowers/specs/2026-10-21-comped-line-fix-plan.md`.

## 1 — Server-side cross-device duplicate guard (BACK BURNER)
The real fix for the offline-outage duplicate check-ins: a DO-side idempotency rule that rejects/flags a 2nd OPEN ticket for the same phone+day at the Worker (the client v5.53 guard only sees one device's board). Owner-parked pending recurrence. Design leaning "flag, don't block." Detail → `[[project-offline-safeguards]]`.
- **Flagged 2026-10-02 (from the tech-price-decouple build):** revisit `queue.assignmentPatch` cross-device conflict handling. The guard (client + DO) is deliberately **device-scoped** (rejects only a *same-device* stale replay) to avoid clock-skew data-loss; it does NOT catch a stale patch from a *different* device acting as the same tech (e.g. the same tech signed in on two phones). The realistic tech↔front-desk case is already safe (an FD upsert preserves the assignment's tech `updatedBy`, so the DO rejects the tech's stale replay). The proper root-cause fix is the op-id idempotency / DO-side guard above, not a naive cross-device `updatedAt` compare (which would reintroduce the clock-skew bug). Same applies to `queue.entryPatch`.

## 2 — Helcim void/reverse (refund is done)
Still missing: `POST /v2/payment/reverse` (same-day void) in client + Worker proxy (idempotency-key, `cardTransactionId` + ip — findings in `HELCIM-MIGRATION.md`). Lower urgency than refund.

## 3 — Retire Square (owner calls the timing)
Helcim is live + default; Square still selectable. When called: stop the Square customer **dual-write**, remove the `/square` proxy + `SQUARE_TOKEN`, the Square config UI + deep-link, and the Square reconcile; keep historical Square ids on old records. Don't fix bugs in this doomed code.

## 4 — Growth features (owner picks)
1. **Automated SMS appointment reminders/confirmations** — biggest no-show lever. **Blocked on the SMS gateway decision** (httpSMS / SMSGate / Twilio) → `[[project-sms-texting]]`.
2. **Texted post-checkout review requests** — needs SMS working (the receipt review-QR gives a paper path now).
3. **Card-on-file / deposits / no-show fees** — Helcim supports card-on-file; `customerCode` already rides purchases.
4. **Online self-booking** — the big one; overlaps the TurnDesk thesis.
- Cosmetic steals: per-tech calendar color-coding, rebook chips on the paid screen, calendar week view.

## 5 — Cosmetic consistency pass (APPROVED, deferred) — `COSMETIC-PHASE-A.md`
Pure polish on the teal/amber identity (no re-skin): unify the 3 teals → `--primary` token, fix dead `--md-*` refs, remove lingering `active:scale-95` bounces, systematize report-card tints, stop leaking raw `sq-` IDs in the Calendar list, one radius/elevation scale. Also the broader "sweep 639 hardcoded hex → tokens" (`[[project-ux-functional-audit]]`).

## 5.5 — Remaining from the 17-item feature batch + held items
- **Named / saved floor plans** → folded into the floor joint session above.
- **Searchable in-app help docs** — staff-facing help/guide (not yet built).
- **Chat-review held fixes** (`[[project-chat-review]]`): 1 real data-loss (stale offline daily-clear wipes chat — bump `cfgmeta:chat_log` on append) + 3 trust issues (dark-mode popovers, eager unread-clear on open, no 4 AM notice).
- **Support email notifications** for new support tickets.
- **Waiver revisit** (real TD waiver text; any Muse waiver copy tweaks).

## 6 — TurnDesk cross-pollination (standing rule)
- ⭐ **Muse→TurnDesk ports v5.64–v5.84 OWED** (at batch end): comp redesign, support tickets, editable price-menu system + editor, turn-system overhaul + refinements, floor left-column + v5.84 polish, price-menu section-move fix, reminders. Reverse record: `turndesk/docs/MUSE-PORT-LOG.md`.
- ✅ **2026-09-24 full parity round DONE** (both apps live): a complete bidirectional audit + ports. TurnDesk `td-v0.53` is current. Authoritative record: **`turndesk/docs/MUSE-PARITY-BACKLOG.md`** (Muse→TD) + `turndesk/docs/MUSE-PORT-LOG.md` (TD→Muse, all ported).
- ⚠️ **Deferred, must-do-before-TurnDesk-card-processing:** port Muse's Helcim refund-safety hardening into TurnDesk (its `confirmRefund` is naive — no processor-truth check / over-refund block / unrecorded-refund detection). Billing-launch gate item.
- Remaining TD follow-ups (pre-existing): swap real waiver text into TD's generic placeholder; rebase `security/phase2-rbac` onto main.

## 7 — Deferred / low-priority (owner-acknowledged)
- **Permission-toggle enforcement:** `canDo('viewReports'/'manageStaff'/'manageServices')` not fully enforced at nav/Settings leaves (check live `fd_users` roles first so nobody locks out).
- **Code debt:** collapse `ASSIGN_ONELIST` dead layout; factor duplicated party-consolidation money math; derive queue/staff status maps from `serviceLineStyle`.
- **Audit leftovers:** §9 calendar edge cases (party-drop, saveAppt atomicity, stale-day race), §11 whole-object schedule/station_layout concurrency.
- **P3 integer-cents money model** — only if penny-drift becomes real.
- **Chat history length** — currently daily 4 AM reset; owner may want a few days (one-line change in `chat.js`).

---

## Standing rules (every session)
- Feature work on `dev`; hotfixes on `main`; bump the version trio together (`js/app/config.js` + `version.json` + `sw.js`) and add a `WHATS_NEW` entry (main.js) for user-visible changes.
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` the owner OKs each time** (verify Cloudflare account = `info@musenailandspa.com`, worker `musedashboard`).
- ⚠️ **Worker deploy footgun:** the live worker has `chat.append`; any future `wrangler deploy` must come from a tree that still includes it (main's `worker.js` has it) or it reverts.
- Verify in preview — the preview's WebSocket can reach the **prod** DO when online: never dispatch test writes; an offline/not-signed-in preview's dispatches stay local. Prod read/repair = `GET /state/snapshot` / `POST /state/mutate`.
- TurnDesk is **SUPERSEDED** (future product rebuilds from current Muse). Helcim is an in-repo single-processor replacement — keep it simple, no adapter layer.

_Last refreshed: 2026-10-23 (v5.84)._
