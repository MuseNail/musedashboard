# Next-session strategy + kickoff prompt (musedashboard)

**Created 2026-06-03 · Updated 2026-06-04.** Authoritative plan for the post-audit work. The phased strategy is below; the **copy-paste kickoff prompt** for a fresh chat is at the very bottom.

---

## ✅ STATUS (2026-06-04) — Phases 1–3 DONE; prod = v4.33 LIVE; next = Helcim migration

**Prod = v4.33 (all pushed). Worker deployed at Version `51b000b0-363c-411b-ab5e-b63deb9f5608`** (has all the new ops). **Every audit HIGH is closed.** `RESTORE_TOKEN` is set (§13 anonymous reset/restore closed).

- **Phase 1 ✅** (v4.20/v4.21) — §15 PWA-shell + §14 staff-app + §11 schedule/perf robustness.
- **Phase 2 ✅** (v4.22) — §12 client security (fd-user privilege-escalation gate + XSS, requireAdminCode fail-closed, dead-audit-dup removed, recovery dup-id). **Deferred (low pri):** the `viewReports`/`manageStaff`/`manageServices` permission-toggle *wiring* (owner daily-role mix); fallback-PIN/lockout (owner declined).
- **Phase 3 ✅** — **3a** (v4.23) catalog app-owned + Square catalog/Bookings removed · **3b** (v4.24 foundation + v4.25 tab + v4.26 bulk/freeze-fix + v4.27 pagination) customer directory → DO entity + dedicated **Customers tab** (Square dual-write KEPT until Helcim cutover) · **3c** (v4.28) staff-app assignment-clobber fix (`queue.assignmentPatch` + per-assignment merge) + status wins (revert-preserves-timer, audit reverts).
- **Extra UX shipped:** v4.29 per-service status dots/pills (queue/turns/floor); v4.30 floor-plan overhaul (all services on tiles + tech avatars + turn-count badges + smart tech-drag + per-station-type tech capacity in Settings); v4.31–v4.33 larger floor staff-row tech avatars + turn badges (dialed to 68px).

**NEXT — gearing up for the Square→Helcim MIGRATION (Phase 4).** See **`HELCIM-MIGRATION.md`** (the detailed, now-current plan). Customers + catalog are already off Square; what REMAINS: the Terminal pay swap (**poll→webhook**), the **pay-path P0** consolidation (incl. cancelled-processor-transaction + reopen-leaves-record — `PRIORITIES.md`), **§13 full Worker auth**, Helcim reconcile/reports, and retiring the Square customer dual-write. **Gated on the Helcim Smart Terminal hardware.** Hardware-independent first steps (can start anytime): a **Helcim-API research pass** + the **pay-path P0 consolidation** (one clean pay path = one swap point). Also available as interim/low-pri: owner-driven UI polish, the deferred Phase-2 permission-toggle wiring, §9 (calendar party-drop / saveAppt-atomicity / stale-day race) + §11 (whole-object schedule/station concurrency).

---

## Guiding methodology (owner-set 2026-06-03)
1. **Non-Square first.** Knock out fixes that have nothing to do with Square before touching the processor.
2. **App becomes the single source of truth BEFORE financial cutover.** Migrate the customer directory and the service/item/fees catalog into the app/DO while **Square keeps running** for payments.
3. **Financial / card processing is LAST.** The Helcim swap (payments, terminal, reconcile) + the Worker auth gate come at the end, after everything else is migrated and stable.
4. **Don't polish doomed Square code.** For audit bugs that live in Square code slated for deletion (e.g. `squarePushBooking` wrong-service, `square-catalog` sync, the Square reconcile, `product_type`), the deficiency is resolved by **removal** — do not spend effort fixing them.
5. All audit deficiencies are sequenced under this ordering (mapping in each phase).

## Locked decisions (2026-06-03)
- Quick-wins batch = **robustness/ergonomic ONLY** (§11/§14/§15 non-security). All §12 auth/security → its own later pass (Phase 2).
- Skip fixing doomed Square code (principle #4).
- Worker auth (§13: open `/state` read+write, `/photos`) is **bundled with Helcim in the last phase** — owner accepts that exposure during the migration (`RESTORE_TOKEN` is already set, which closed the remote-wipe).
- Kickoff = whole plan; the fresh chat **starts with Phase 1 (quick wins)**. Helcim is gated on hardware (Smart Terminal) + a short Helcim-API research pass.

---

## The phases

### Phase 1 — Quick wins (client-only, NON-Square) ← START HERE
Robustness/ergonomic fixes from the audit's deferred list. Ship in small batches, each with the version-file trio bump (`js/app/config.js` + `version.json` + `sw.js`). All client-only, no Worker deploy.
- **§15 (PWA shell):** SW `networkFirst` cache-error guard (only `cache.put` on `res.ok && type==='basic' && !redirected`) + offline navigation fallback to index.html; fix the stale `v2.72` SW header comment; add a maskable 192 icon + `referrer-policy` meta; (decide on relaxing `user-scalable=no` — kiosk a11y tradeoff).
- **§14 (Muse Staff app):** require a price before Complete (no $0 service); preserve focus/caret when a sync re-renders mid price-entry; unsubscribe push on logout; esc the logo in the staff PDF.
- **§11 (deferred):** schedule "Clear" one-off-blank sentinel (so clearing a repeat-driven day actually sticks) + picker note; `copyLastWeekSchedule` `_repeats` awareness; `avgServiceTime` per-render memoization (perf on the 10s floor re-render); repeat-toggle-resets-to-OFF.
- **Excludes** anything Square-touching and anything in §12 (security).

### Phase 2 — Client security hardening (§12, NON-Square, client-only)
The dedicated security pass (kept out of quick wins). Client-only, no Square, no backend. *(Movable — can run before or after Phase 3; it is non-financial.)*
- Front-desk-user **privilege-escalation gate** (`adminOnly` on the leaf + role-bail in the fd_user CRUD fns).
- **fd_user name XSS** (escape in the list/PIN-viewer/logged-in display).
- `requireAdminCode` **fail-closed**.
- **Activity-Log XSS** (escape delete-reason/name; or remove the dead `settings.js loadAuditLog` dup).
- Recovery **dup-id** (preserve original record id on restore).
- **Policy items (owner to decide):** replace the hardcoded `1234` fallback PIN, add a PIN attempt lockout, enforce the `viewReports`/`manageStaff`/`manageServices` toggles.

### Phase 3 — App as the single source of truth (data migration; Square still runs payments)
Make the app authoritative for customers + catalog. One DO/Worker deploy for the data-model changes.
- **3a. Catalog → local only (client-only):** delete `square-catalog.js` pull/push + the "push to Square" buttons + the `squareItemId`/`squareVariationId` plumbing. (Square Terminal is total-only, so payments are unaffected.)
- **3b. Customer directory → DO entity (DO/Worker + client):** new `customer:<id>` keys + a `customer.upsert`/`customer.delete` op (per-record stale guard, like records — NOT one config blob); **one-time export** of the current Square customers into the DO; re-point `square-customers.js` autocomplete/upsert/edit/dedup (and the phone-keyed `customer_notes`) to the DO. **Keep dual-writing customers to Square** (the existing upsert) until the Helcim cutover so Square card charges stay customer-linked; stop at cutover. Folds in the §10 note-orphan/merge concern.
- **3c. §14 assignment clobber → DO per-assignment field-merge (DO/Worker):** make `queue.upsert` from the staff app merge only the changed assignment so a concurrent front-desk fee/item/discount isn't dropped. (Same Worker deploy as 3b.)

### Phase 4 — Financial / card processing LAST (Helcim) — gated on hardware
Acquire + pair the **Helcim Smart Terminal** first; do a short Helcim-API research pass (Smart Terminal request + **webhook** payload/correlation, refunds, transaction-list for reconcile, tip handling). Full detail in `HELCIM-MIGRATION.md`.
- **4a. Pay-path P0 consolidation** (PRIORITIES.md P0): funnel every "→ paid" + reopen through ONE path (tenders + gift draw-down + audit + safe reversal). Do this FIRST in-phase = one clean swap point. Closes §5/§7/§8 gift A3/A4.
- **4b. Worker (final deploy):** shared-token auth gate on all sensitive endpoints (the bundled §13 fix) + Helcim proxy + `/helcim/webhook` + `HELCIM_API_TOKEN`; retire `/square` + `SQUARE_TOKEN`.
- **4c. Client pay flow → Helcim:** the structural **poll → webhook** change (charge sent → await webhook → finalize); refunds; gift-card-sale charge.
- **4d. Reconcile + reports → Helcim:** generic `paymentIds` + `processor` on new records; reports tolerate BOTH old Square + new Helcim sales; rebuild reconcile against Helcim.
- **4e. Cutover + retire Square:** stop the Square customer dual-write; remove the Square config UI/bookings; keep historical Square ids on old records. (Decide parallel-run vs big-bang at this phase.)
- Optional: integer-cents money model (P3) — natural to fold in here since the money path is being rewritten.

## Audit-deficiency → phase map (quick reference)
- §11 deferred → Phase 1 · §14 client items → Phase 1 · §15 → Phase 1
- §12 (all) → Phase 2
- §14 clobber (DO merge) → Phase 3c · §10 note-orphan → Phase 3b · catalog/customer Square removal → Phase 3
- §13 backend auth → Phase 4b · pay-path P0 + gift A3/A4 + §7 refund-reverse → Phase 4a · §10 doomed-Square bugs → **skipped (removed in Phase 3/4)**

## Standing rules (carry into every session)
- Commit freely; **`git push` needs explicit owner OK each time**; **`wrangler deploy` is the owner's job** (walk them through it step by step).
- Bump the **version trio together** on any client change (`js/app/config.js` APP_VERSION + `version.json` + `sw.js` CACHE_NAME).
- Verify pure logic in isolation; the preview's WebSocket reaches the **prod** DO, so never dispatch test writes that hit production.
- Audit method = one multi-agent Workflow per slice (lenses → adversarial verify). Workflow scripts: avoid literal `Date.now()`/`new Date(`/`Math.random()` and stray backticks inside the CONTEXT template (deterministic-scan + parse gotchas).
- TurnDesk is PAUSED; Helcim is an in-repo single-processor replacement (no multi-processor abstraction).

---

## 📋 COPY-PASTE KICKOFF PROMPT (paste into a fresh chat)

> We're continuing on the **musedashboard** salon PWA. Phases 1–3 of the post-audit plan are DONE and **prod = v4.33 LIVE; every audit HIGH is closed.** **Read first, in order:** `CLAUDE.md` (architecture + rules + the Helcim/TurnDesk direction box), `NEXT-SESSION-KICKOFF.md` (the ✅ STATUS block at the top = current state + what's next), `HELCIM-MIGRATION.md` (the Square→Helcim plan — the teed-up next project), `AUDIT-2026-06.md` (findings + what shipped v4.11–v4.33 + what's still deferred). Auto-loaded memory has a "START HERE / LATEST" block.
>
> **Current state:** customers are OFF Square — a synced Durable-Object entity (`customer:<id>`) with a dedicated **Customers tab** (Square customer dual-write is KEPT until the Helcim cutover); catalog is app-owned (Square catalog sync + Bookings removed); per-service status dots/pills on queue/turns/floor; floor-plan shows all services + tech avatars + turn badges + smart tech-drag + per-station-type tech capacity (Settings → Stations). Worker deployed at Version `51b000b0-…`; `RESTORE_TOKEN` is set.
>
> **THIS chat is gearing up for the Square→Helcim migration (Phase 4)** — read **`HELCIM-MIGRATION.md`** (the current plan). Customers + catalog are already off Square; what remains = the Terminal pay swap (**poll→webhook**), the pay-path **P0** consolidation (incl. cancelled-processor-transaction + reopen-leaves-record), the **§13** full Worker auth, Helcim reconcile, and retiring the Square customer dual-write. The live Terminal swap is **gated on the Smart Terminal hardware**, but two things can start NOW without it: (a) a **Helcim-API research pass** (Smart Terminal start-purchase + webhook payload/correlation, refunds, transaction-list for reconcile, tip handling), and (b) the **pay-path P0 consolidation** (funnel every "→ paid" + reopen through ONE path = one clean swap point). Keep it a SIMPLE single-processor swap — no multi-processor abstraction.
>
> **Standing rules:** commit freely but **`git push` needs my explicit OK each time**; **`wrangler deploy` is mine** (walk me through it step by step; Worker lands the Helcim proxy + `/helcim/webhook` + `HELCIM_API_TOKEN`); **bump the version trio together** on any client change (`js/app/config.js` APP_VERSION + `version.json` + `sw.js` CACHE_NAME); verify logic in isolation (the preview's WebSocket hits the **prod** DO — never dispatch test writes, and note reaching the dashboard needs a PIN login that writes an audit entry); for any UI change, mock it up in `mockups/` first.
>
> Ask me what to tackle first (likely the Helcim-API research pass or the pay-path P0) and confirm the plan before coding. Owner-driven UI polish + the deferred Phase-2/§9/§11 items are also fair game if I point you there.
