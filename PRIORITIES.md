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

## 3 — Retire Square (owner calls the timing)
Helcim is live + default; Square is still selectable. When called: stop the Square customer **dual-write**, remove the `/square` proxy + `SQUARE_TOKEN`, the Square config UI + deep-link, and the Square reconcile; keep historical Square ids on old records. (Don't fix bugs in this doomed code.)

## 4 — Growth features (from the competitor comparison) — owner picks
1. **Automated SMS appointment reminders/confirmations** — biggest no-show lever. **Blocked on the SMS gateway decision** (Samsung Fold sideload "generic failure"; options: Play-Store httpSMS / SMSGate / Twilio).
2. **Post-checkout review requests by text** — overlaps the receipt review-QR (#1) which gives a paper path now; a texted link needs SMS working.
3. **Card-on-file / deposits / no-show fees** — Helcim supports card-on-file; `customerCode` already rides purchases.
4. **Online self-booking** — the big one; overlaps the (superseded) TurnDesk thesis.
- Cosmetic steals: per-tech calendar color-coding, rebook chips on the paid screen, calendar week view.

## 5 — Deferred / low-priority (owner-acknowledged)
- **Permission-toggle wiring:** `canDo('viewReports'/'manageStaff'/'manageServices')` read config but aren't all enforced at the nav/Settings leaves (check live `fd_users` roles first so nobody locks out).
- **Code debt:** collapse the `ASSIGN_ONELIST` dead layout; factor duplicated party-consolidation money math; derive queue/staff status maps from `serviceLineStyle`.
- Audit leftovers: §9 calendar edge cases (party-drop, saveAppt atomicity, stale-day race), §11 whole-object schedule/station_layout concurrency.
- **P3 integer-cents money model** — only if penny-drift becomes real.
- **Chat history length** — currently daily (4 AM reset). Owner may want longer (a few days / a week) — one-line change in `chat.js dayStartTs`/filter.

---

## Standing rules (every session)
- Feature work on `dev`; hotfixes on `main`; bump the version trio together (`js/app/config.js` + `version.json` + `sw.js`) and add a `WHATS_NEW` entry (main.js) for user-visible changes.
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` the owner OKs each time** (verify the Cloudflare account = `info@musenailandspa.com`, worker `musedashboard`).
- ⚠️ **Worker deploy footgun:** the live worker (`ed35b954`) has `chat.append`; any future `wrangler deploy` must come from a tree that still includes it (main's `worker.js` has it) or it reverts.
- Verify in preview — the preview's WebSocket can reach the **prod** DO when online: never dispatch test writes; an offline/not-signed-in preview's dispatches stay local. Prod read/repair = `GET /state/snapshot` / `POST /state/mutate`.
- TurnDesk is **SUPERSEDED** (future product rebuilds from current Muse). Helcim is an in-repo single-processor replacement — keep it simple, no adapter layer.

_Last refreshed: 2026-06-19 (v5.21)._
