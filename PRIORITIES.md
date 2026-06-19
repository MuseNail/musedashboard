# Live App Priorities (musedashboard)

The build pipeline for the live single-salon app, ordered by impact. Cleaned 2026-06-11 (prod **v4.81**); resolved history was pruned — git log + `AUDIT-2026-06.md` + `ROADMAP.md` are the historical record. Parked/unscheduled ideas live in `IDEABOARD.md`.

---

## 1 — Helcim refund / void path
App refunds still assume Square payment ids. Build the Helcim path: Worker proxy for `POST /v2/payment/refund` + `POST /v2/payment/reverse` (idempotency-key required; `cardTransactionId` + ipAddress — verified API findings in `HELCIM-MIGRATION.md`), client refund flow routes by processor, and the refund **reverses gift-card redemptions** (closes the old audit §7 finding). New records already store the Helcim `transactionId` in `squarePaymentIds`.

## 2 — §13 Worker auth — ✅ BUILT v4.86 (2026-06-12, reworked to PIN sign-in same day), awaiting owner rollout
**PIN sign-in sessions** (owner rejected per-device access codes — staff use ANY device/browser with their existing PIN). The DO's `POST /auth/login` checks the same `fd_users`/`staff` PINs the app already uses (4-digit kept, 6 fine, up to 8) and mints a 30-day browser session; the Worker gates **every route** while the `AUTH_ENFORCED` secret is `"true"` (exempt: `/auth/login|logout`, `/terminal/webhook` HMAC, `/gcal/callback`, `GET /photos/*` — photo **writes** are gated; the report share-link uses an unguessable key). Wrong PINs hit escalating per-IP slow-downs (3 free, then 5→60s — never a hard lockout); removing/deactivating a person revokes their sessions within ~a minute (verified). Fresh browsers sign in straight against the server (dashboard, staff app, reports app all verified); signed-in browsers keep working offline.
**Owner rollout (each step independently safe):**
1. `wrangler deploy` from `cloudflare/` — behavior unchanged while `AUTH_ENFORCED` is unset (verified); logins already mint sessions.
2. Approve the v4.86 push; staff keep signing in with PINs as usual — browsers collect sessions automatically.
3. Make sure every tech has a Staff-App PIN (Settings → Technicians) — techs without one can't sign in once enforced.
4. `wrangler secret put AUTH_ENFORCED` (value `true`) → enforcement live. Rollback = delete the secret (instant, no redeploy).
**Unblocked Back Office M11** (shipped — see `BACKOFFICE-KICKOFF.md`). Owner-approved sequence **§13 → M11+M12 → M13** is fully built.

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
- Feature work on `dev`; hotfixes on `main`; **one version-trio bump at the end-of-day merge** (`js/app/config.js` + `version.json` + `sw.js`). Add a `WHATS_NEW` entry (main.js) for user-visible changes.
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` is the owner's job**.
- Verify in preview — but the preview's WebSocket can reach the **prod** DO when online: never dispatch test writes; an offline preview's dispatches stay local. Prod repair = raw `GET /state/snapshot` / `POST /state/mutate`.
- TurnDesk is **PAUSED** (`TURNDESK-KICKOFF.md` when resumed). Helcim was an in-repo single-processor replacement — keep it simple, no adapter layer.

_Last cleaned: 2026-06-11 (v4.81)._
