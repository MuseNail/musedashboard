# Live App Priorities (musedashboard)

The build pipeline for the live single-salon app, ordered by impact. Refreshed **2026-06-19 (prod `v5.21`)**. Resolved history is pruned — git log + `AUDIT-2026-06.md` + `ROADMAP.md` + `HELCIM-MIGRATION.md` are the record. Parked/unscheduled ideas live in `IDEABOARD.md`.

---

## ✅ Shipped recently (2026-06)
- **Staff Chat (v5.15–v5.21)** — `js/app/features/chat.js`. A "Team" group + a front-desk-only **Front Desk** channel + private **1:1 DMs** + **@mentions**; on the dashboard (header chat button) and the **staff app** (bottom-right FAB). **Push to phones** on @mention / DM / any Front-Desk message, via the existing `/push/notify` fan-out (each person subscribes by pid `tech:<id>` / `fd:<id>` in the staff app). Server-side atomic append (`chat.append` op — no message clobber). Daily reset at 4 AM, capped ~300 messages, manager "Clear chat". **Worker deployed `ed35b954`** (adds `chat.append`; backward-compatible). Push requires the staff app **installed on the phone with notifications ON** (iOS: must be added to the Home Screen — web push won't fire in a Safari tab).
- **§13 Worker auth — LIVE** (`AUTH_ENFORCED="true"`). PIN sign-in mints a 30-day session; every route gated; deactivation revokes ≤60s. `RESTORE_TOKEN` set.
- **Helcim refund path — LIVE** (v4.97). Card refunds via Helcim (not Square). **Reverse/void not built** (see #2).

---

## 1 — Receipt printing (RP327) — app built, holding for hardware
**App side BUILT on `dev` (v5.09, commit `6855645`), not yet shipped** — owner holding for the Rongta **RP327** 80mm thermal printer (front-desk Windows PC). `js/app/features/receipt.js`: 80mm customer receipt (shop header + items + totals + tenders + thank-you) with a **Print** button on each Sales transaction, and an **80mm roll** option on the staff-receipts picker. Plus a **re-routable review QR** — the printed QR encodes a fixed Worker `GET /r` that 302s to `config.review_url` (owner edits in Settings → Business → Receipt & Reviews), so the link is changeable without reprinting.
**To ship when the printer arrives:** install the Windows driver (80mm × continuous); `git checkout dev`, `git merge main`, **rebump the trio to v5.22**; push `dev`→`main`; **`wrangler deploy`** the Worker for the `/r` route — ⚠️ that deploy MUST also include `chat.append` (it does once dev merges main; just confirm both are in `cloudflare/worker.js` first); owner pastes the real Google review link; live-test a receipt + scan the QR.

## 2 — Helcim void/reverse (refund is done)
Refund is live. Still missing: `POST /v2/payment/reverse` (same-day void) routing in the client + Worker proxy (idempotency-key, `cardTransactionId` + ipAddress — verified findings in `HELCIM-MIGRATION.md`). Lower urgency than refund.

## 2b — v5.42 refund-safety hotfix (Phase 3 0-pre) — accepted residuals + follow-ups
Built + committed on `main` (`8ce64d6` restore hardening, `abca853` refund idempotency + processor-truth), awaiting the off-hours deploy. ⚠️ Helcim fact (verified, devdocs): **idempotency keys expire after 5 minutes** — the deterministic key only dedups immediate retries; long-horizon double-refund protection = the `GET /helcim/refunds` truth check in `confirmRefund`. Known residuals (documented decisions, not bugs):
- **Two devices, same amount, within 5 min** → Helcim replays (money moves once) but a duplicate refund RECORD can save if sync lagged — books-only, delete one. Hardening candidate: store-level dedup on intersecting `squareRefundIds` per sale.
- **Unrecorded-refund recovery is same-modal-session only:** if the block toast fires and the operator closes the modal (or records a non-matching amount), the record-only refund saves unstamped and the block re-fires next time. In-UI recovery: delete the unstamped refund record, re-attempt the card refund (fresh block), then record toggle-OFF **at exactly the stated amount** in that same session. Hardening candidate: match against a fresh truth fetch at record time.
- **Restore truncates audit to the snapshot's 500-entry cap** (pre-existing snapshot design; restore used to keep ZERO) — revisit when Phase 3 Stage X/O defines audit archival.
- **PHASE3.md Stage-R amendment (when Stage R builds):** the refund ordinal has no long-horizon meaning under the 5-min TTL, so archiving old refund records can't create key hazards; the truth check is processor-side and archive-independent.
- **Rollback pairs:** a worker rollback also reverts 0-pre-b (shared deploy) and a v5.42 client against an old worker fail-closes card refunds — roll back worker + client together.

## 3 — Retire Square (owner calls the timing)
Helcim is live + default; Square is still selectable. When called: stop the Square customer **dual-write**, remove the `/square` proxy + `SQUARE_TOKEN`, the Square config UI + deep-link, and the Square reconcile; keep historical Square ids on old records. (Don't fix bugs in this doomed code.)

## 4 — Growth features (from the competitor comparison) — owner picks
1. **Automated SMS appointment reminders/confirmations** — biggest no-show lever. **Blocked on the SMS gateway decision** (Samsung Fold sideload "generic failure"; options: Play-Store httpSMS / SMSGate / Twilio).
2. **Post-checkout review requests by text** — overlaps the receipt review-QR (#1) which gives a paper path now; a texted link needs SMS working.
3. **Card-on-file / deposits / no-show fees** — Helcim supports card-on-file; `customerCode` already rides purchases.
4. **Online self-booking** — the big one; overlaps the (superseded) TurnDesk thesis.
- Cosmetic steals: per-tech calendar color-coding, rebook chips on the paid screen, calendar week view.

## 4b — Cosmetic consistency pass (APPROVED, deferred) — `COSMETIC-PHASE-A.md`
Owner approved the full Live-vs-Suggestion direction **2026-06-29**, wants to build it later. Pure
polish on the existing teal/amber identity (no re-skin). **Phase A** (the keystone): unify the 3
teals → `--primary` token (route the `#2a6868` selected/focus/sync + the bare `#1a5252` literals
through the var); fix the 11 dead `--md-*` fallback refs (reports date-picker/compare/perf chart);
remove the 34 lingering inline `active:scale-95` "bounce" buttons (finishes v5.35); converge the
button system **gradually**. **B** = systematize the report-card tints (keep colored, one rule per
metric family + dark variants, fix muddy-amber). **C** = stop leaking raw `sq-` IDs in the Calendar
appointment list. **D** = one radius/elevation scale. Full spec + exact selectors in
`COSMETIC-PHASE-A.md`.

## 5 — Deferred / low-priority (owner-acknowledged)
- **Permission-toggle wiring:** `canDo('viewReports'/'manageStaff'/'manageServices')` read config but aren't all enforced at the nav/Settings leaves (check live `fd_users` roles first so nobody locks out).
- **Code debt:** collapse the `ASSIGN_ONELIST` dead layout; factor duplicated party-consolidation money math; derive queue/staff status maps from `serviceLineStyle`.
- Audit leftovers: §9 calendar edge cases (party-drop, saveAppt atomicity, stale-day race), §11 whole-object schedule/station_layout concurrency.
- **P3 integer-cents money model** — only if penny-drift becomes real.
- **Chat history length** — currently daily (4 AM reset). Owner may want longer (a few days / a week) — one-line change in `chat.js dayStartTs`/filter.

## 8 — Receipt printing from the app (hardware ORDERED 2026-06-19)
The owner wants to print **receipts + custom layouts** (custom receipts, thank-you notes, and **tech-ticket totals from Reports**) on receipt-roll paper. Hardware decided & bought; app-side work not started.
- **Printer:** Rongta **RP327** (80mm / 72mm print width, 203 dpi, 250 mm/s, auto-cutter, USB+Serial+Ethernet, cash-drawer RJ11 kick, ESC/POS). ~$80. Amazon B0B76L4BP7.
- **Host:** the front desk's **always-on Windows PC** (the owner's primary device is now desktop + iPad, both always on/connected). Print happens from the **desktop browser via the Windows driver** — so **AirPrint is NOT needed** and no WebPRNT/ePOS integration is required.
- **Why this path:** a Windows desktop drives any thermal printer through its OS driver, so the app just renders an 80mm HTML view and prints it with `window.print()` — prints anything we can render (B/W, 80mm roll). This is the cheap, no-SDK route.
- **Prep checklist (next session):**
  1. **Driver:** install the Rongta RP327 Windows driver (rongtatech.com → driver-download) or its generic ESC/POS driver; add the printer (USB simplest, or Ethernet on the LAN); set default paper = 80mm × continuous, tune print density.
  2. **Confirm** a Windows test print + a Chrome/Edge web-page print land correctly at 80mm.
  3. **App side (Claude builds):** add an **80mm print view + `@media print`/`@page { size: 80mm auto; margin:0 }` stylesheet** to `css/styles.css`, and a small print helper that renders the chosen content into a print container and calls `window.print()`. First targets: (a) **tech-ticket totals from Reports**, (b) a **customer receipt** (reuse `ticketTotal`), (c) a **thank-you note**. Add a "Print" button where each lives.
  4. **Optional silent one-tap:** Chrome/Edge `--kiosk-printing` flag with the RP327 set default (skips the dialog), or **QZ Tray** for raw ESC/POS + the **cash-drawer kick** (the app already has a cash-drawer feature to tie into).
- **Constraints to remember:** black-and-white thermal only; 80mm continuous roll (receipt strip, not letter); print is desktop-driven (the iPad doesn't need to print directly — if it ever should, route through the desktop or revisit an AirPrint printer). Full handoff in memory `[[receipt-printer]]`.

---

## Standing rules (every session)
- Feature work on `dev`; hotfixes on `main`; bump the version trio together (`js/app/config.js` + `version.json` + `sw.js`) and add a `WHATS_NEW` entry (main.js) for user-visible changes.
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` the owner OKs each time** (verify the Cloudflare account = `info@musenailandspa.com`, worker `musedashboard`).
- ⚠️ **Worker deploy footgun:** the live worker (`ed35b954`) has `chat.append`; any future `wrangler deploy` must come from a tree that still includes it (main's `worker.js` has it) or it reverts.
- Verify in preview — the preview's WebSocket can reach the **prod** DO when online: never dispatch test writes; an offline/not-signed-in preview's dispatches stay local. Prod read/repair = `GET /state/snapshot` / `POST /state/mutate`.
- TurnDesk is **SUPERSEDED** (future product rebuilds from current Muse). Helcim is an in-repo single-processor replacement — keep it simple, no adapter layer.

_Last refreshed: 2026-06-19 (v5.21)._
