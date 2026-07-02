# Claude — AI Coding Instructions for musedashboard

This file contains rules and context for AI coding assistants working on this project. Read it before making any changes.

---

## What This App Is

A salon management PWA for Muse Nails & Spa. It runs in a browser on an iPad at the front desk and on technician-facing devices.

The app is **live and in active operational use**. All planned phases (Split through Phase 7) are complete.

---

## ⚠️ Product line — this repo vs TurnDesk (read before any "make it a product" work)

> ### 🔄 CURRENT STATE (updated 2026-06-11) — HELCIM IS LIVE
> - **Helcim is the production card processor** (Smart Terminal, API mode, **webhook-driven**: Worker `/helcim/*` + HMAC-verified `/terminal/webhook` → DO broadcast; client `features/helcim.js` `chargeOnHelcim` with idempotent `tkt-<id>-<cents>` invoice refs, a fallback poll, and a missed-webhook detector). Square remains **selectable** (`config.payment_processor`) until the owner retires it. This was an in-repo **single-processor replacement** — do NOT build a multi-processor adapter layer here.
> - **The app is the source of truth** for the customer directory (synced DO `customer:<id>` entity + Customers tab; the Square customer **dual-write is intentionally KEPT** until Square is retired so old card charges stay linked) and the service/item/fees catalog. Appointments stay Google-backed; SMS stays httpSMS.
> - **TurnDesk is SUPERSEDED (2026-06-11):** the owner decided TurnDesk will be **completely replaced by the current version of Muse**. The old fork/snapshot is obsolete — do not resume or maintain it. All work focuses on this repo; any future productization restarts from the current Muse codebase when the owner calls it.
> - **§13 Worker auth is BUILT (v4.86, 2026-06-12) — PIN sign-in sessions, enforcement pending owner rollout.** Staff sign in from ANY device/browser with their existing PIN (4-digit kept, up to 8 supported): the DO's `POST /auth/login` checks the same `fd_users`/`staff` PINs the app already uses (per-IP escalating slow-downs, never a hard lockout; the `1234` fallback only while no fd_users exist) and mints a 30-day `sess:` token; Worker `appAuthOk` gates EVERY route once the `AUTH_ENFORCED` secret is `"true"` (exempt: `/auth/login|logout`, `/terminal/webhook` HMAC, `/gcal/callback`, `GET /photos/*`), validating via DO `/auth/check` + a ~60s isolate cache — so removing/deactivating a user kills their sessions within a minute. Clients send the token via the `js/app/apptoken.js` fetch wrapper (`?auth=` on the WebSocket + `/gcal/connect`); session = localStorage `muse_session`. No device provisioning exists. Rollout steps in `PRIORITIES.md` #2.
> - **The remaining pipeline lives in `PRIORITIES.md`** — top items: the Helcim **refund path**, the **§13 rollout** (above), and **retiring Square** when the owner calls it. Don't polish doomed Square code. Migration record + verified Helcim API findings: `HELCIM-MIGRATION.md`.

**This repo (`musedashboard`) is the STABLE, single-salon, live app — keep it that way.** A separate public/SaaS product — **TurnDesk** — was forked from this codebase in 2026-05 (own repo/Worker), paused 2026-06-03, and **superseded 2026-06-11**: the owner decided the future product will be built from the *current* Muse codebase, replacing TurnDesk entirely. The old fork is dead; its planning record (multi-tenant one-DO-per-salon, processor adapter layer, accounts/billing/onboarding) stays in `ROADMAP.md` + `TURNDESK-KICKOFF.md` as reference for that future productization.

- **Do NOT build SaaS/multi-tenant features in this repo** until the owner starts the productization — this repo stays the single-salon live app.

> ## ⚡ Development Posture (v2.00+) — SUPERSEDES the rules below where they conflict
>
> A deliberate strategic decision (v2.00) changed the operating constraints:
>
> - **Primary goal: build the most stable app and the most stable operational workflow.** Stability and correctness are now the top priority — above preserving the current architecture or data.
> - **Structural changes, big rewrites, and architecture resets are SANCTIONED** where they materially improve stability. The "additive-only / no rewrites / no build step / no ES modules" rules below are no longer hard constraints — treat them as *current-state description*, not prohibitions.
> - **The current production data is expendable.** A one-time clean migration or reset to reach the stable architecture is acceptable and pre-approved. (The *final* design must still be durable in daily operation — stability includes not losing customer/financial data during normal use.)
> - **Decision rule going forward:** when choosing between a band-aid that preserves the status quo and a structural change that makes the system fundamentally more stable, prefer the structural change. Still verify correctness rigorously and stage/validate big changes — stability demands it.
>
> The "Production Data Integrity — PERMANENT RULES" and "Architecture Rules" sections below describe the *outgoing* system. Follow them only until superseded by the v2.00 architecture work, and do not let them block sanctioned restructuring.

Treat all changes as production-quality — no placeholders, no half-finished implementations.

---

## Production Data Integrity — PERMANENT RULES  *(SUPERSEDED by Development Posture v2.00 — see top of file)*

> ⚠️ As of v2.00 these are **no longer non-negotiable**. Current data is expendable for a one-time clean migration, and structural changes are sanctioned. The rules below remain useful guidance for the *final* stable design (which must still be durable in daily operation), but they must not block the re-architecture.

The app is in active operational use. These rules are non-negotiable and take precedence over any desire for architectural cleanliness.

1. **Never remove or rename** persistent storage keys, R2 objects, Durable Object schemas, Sheets columns, or synced config structures without:
   - explicit approval from the user
   - a migration plan
   - a rollback strategy

2. **Never perform automatic data cleanup or data resets.** The "Clear All Records" button exists for intentional use by the operator — never trigger it automatically.

3. **Never remove backward compatibility** for persisted operational data unless a verified migration exists and has been approved.

4. **All future changes must preserve:**
   - Customer records and directory
   - Queue state and archive
   - Transaction records / reports / history
   - Appointments and calendar data
   - Staff data and schedules
   - Settings and config
   - Gift cards
   - Photos and logos
   - Audit and history data

5. **All future schema/storage changes must include:**
   - Migration planning (how existing data moves forward)
   - Rollback planning (how to revert without data loss)
   - Backup strategy (export before applying)
   - Failure recovery strategy

6. **Stability and data integrity take priority over aggressive refactoring.**

7. **Future improvements should favor:**
   - Additive enhancements (new fields, new optional features)
   - Safe migrations (readable by old code until migration is complete)
   - Reversible changes
   - Incremental evolution
   
   **NOT:** large rewrites, destructive cleanup, architecture resets.

---

## Architecture Rules

> **Updated for v3 (2026-05).** The app was re-architected from an 18-file single-global-scope monolith into native ES modules + a stateful Cloudflare Durable Object. The rules below describe the **current** system.

### No frontend build step
There is no npm, bundler, or transpiler for the client, and no intention to add one. All JS is plain ES2020+ that runs directly in the browser as native **ES modules** — no compile/bundle step. GitHub Pages serves the files as-is.

### No frameworks
Vanilla JS only. No React, Vue, Svelte, Alpine, or any other component framework. Tailwind CDN is already present for layout utilities — do not add more libraries.

### ES modules (v3)
The app is **native ES modules** under `js/app/`. `index.html` loads a single entry point — `<script type="module" src="js/app/main.js">`; the Muse Staff app loads `js/app/staff.js`. Modules `import`/`export` from each other — there is no shared global scope via ordered `<script src>` tags anymore.

**`window` glue:** so the existing inline `onclick=`/`oninput=` markup keeps working, `main.js` attaches every feature module's exports to `window` (`Object.assign(window, ns)` across all modules). Any function referenced by inline HTML must therefore be an `export` of one of those modules (or explicitly set on `window` in `main.js`). `store.js`, `sync.js`, `session.js`, and `config.js` are NOT auto-attached (except `window.dispatch` and `window.calEventsFor`).

### Module layout
- **Core:** `js/app/main.js` (bootstrap, window glue, navigation, version check), `store.js` (in-memory state + `applyChange` op reducer), `sync.js` (WebSocket/HTTP sync + `dispatch` + offline outbox), `session.js`, `config.js` (`APP_VERSION`, constants), `utils.js`, `apptoken.js` (§13 PIN-login session: `serverLogin` + bearer fetch wrapper — import FIRST in every entry point).
- **Features:** `js/app/features/*.js` — auth, photos, catalog, square-customers, square-catalog, square-pos, staff, checkin, status, queue, turns, reports, giftcards, settings, calendar, floorplan, appearance, servicetime, chat, appt-reminders, recovery, audit, **cashdrawer** (cash register/drawer), **sms** (httpSMS texting), **timeclock** (front-desk clock in/out — per-user `fd_clock_<id>` punches, station-locked via `config.timeclock_device_id`, 15-min rounding, `fdPaidHours`), **fd-schedule** (front-desk weekly schedule WITH hours — `config.fd_schedule`).
- **Calendar auth (server-side, 2026-06):** Google Calendar OAuth is server-side — the Worker holds the refresh token (DO key `gcal:blob`) and mints access tokens via `/gcal/connect|callback|token|status|disconnect`; `calendar.js` loads only gapi and GETs `/gcal/token` (no browser GIS). Fixes the iPad "loses sync." `/gcal/token` is gated by the §13 app token once `APP_AUTH_TOKEN` is set (v4.86).
- **Front-desk time clock + payroll:** FD clock/schedule are config-key based (no Worker change). Clock punches → Payroll "Front Desk — Hourly" section (hours × `fd_user.hourlyRate`) + a manager timecard editor (reports.js `openTimecard`); FD users can sign into the **staff app** (staff.js `renderFdView`) for a read-only schedule + hours view.
- **Customer directory (v4.24+):** a first-class synced DO entity (`customer:<id>`), NOT Square/localStorage-only. `square-customers.js` now owns the DO-backed directory + the dedicated **Customers tab** (`nav-customers`/`panel-customers`) + autocomplete/add/edit/delete/dedup/CSV/import-from-Square; it rebuilds its `customerDirectory`/`squareCustomers` caches from `getState().customers` on every store change. `square-catalog.js` no longer syncs the catalog (Terminal pairing + team-member picker only).
- **`serviceLineStyle(status)` (`status.js`):** one source of truth for the per-service status visual (CSS dot + pill + bar/tint), reused by queue/turns/floor cards. **`store.rev`** (`store.js`): a monotonic data-revision counter for cheap memoization (e.g. `servicetime.js`). Per-station-type **`maxTechs`** lives on each `station_categories` entry (queue.js), edited in Settings → Stations.

### GitHub Pages only
No server-side logic in the front end, no dynamic routes, no build artifacts — all client output is static files GitHub Pages serves directly. Backend logic lives in the Cloudflare Worker / Durable Object (`cloudflare/worker.js`).

---

## Where to Make Changes

| Change type | File(s) to edit |
|---|---|
| App version bump | `js/app/config.js` (APP_VERSION) + `version.json` + `sw.js` (CACHE_NAME) — all three together |
| Global constants / `APP_VERSION` | `js/app/config.js` |
| In-memory app state + `applyChange` (op reducer) | `js/app/store.js` |
| Sync, WebSocket, `dispatch`, offline outbox | `js/app/sync.js` |
| §13 PIN sign-in sessions (login helper, fetch wrapper, session storage) | `js/app/apptoken.js` (+ login hooks in `features/auth.js`/`staff.js`/`reports-app.js`; Worker `appAuthOk` + DO `authLogin/authCheck` in `cloudflare/worker.js`) |
| Back Office sync (one-way daily-sales/payroll push to the books app) | `js/app/features/backoffice-sync.js` (Settings → Integrations card; `config.bo_sync` + device-local `muse_bo_token`; receiver lives in the BackOffice repo) |
| Session / active user | `js/app/session.js` |
| Utility fns, numpad, toast, `ticketTotal` | `js/app/utils.js` |
| App init, navigation, version check, window glue | `js/app/main.js` |
| Photos / logo | `js/app/features/photos.js` |
| Auth / PIN | `js/app/features/auth.js` |
| Services, Items, Fees CRUD | `js/app/features/catalog.js` |
| **Customers tab** + directory (DO `customer:<id>` entity), autocomplete, add/edit/delete, dedup, import-from-Square, phone-keyed notes | `js/app/features/square-customers.js` |
| Square config modal + Terminal pairing + SMS team-member picker (catalog sync REMOVED v4.23) | `js/app/features/square-catalog.js` |
| Pay/checkout flow (Confirm Payment, tenders, tips, gift redemption, mark-paid-without-charging) — routes the card step to the active processor | `js/app/features/square-pos.js` |
| Helcim terminal charge, processor toggle, customer-carry, missed-webhook detector | `js/app/features/helcim.js` (+ `cloudflare/worker.js` `/helcim/*`, `/terminal/webhook`) |
| Quick Sale (no-service retail/gift checkout) | `js/app/features/quicksale.js` |
| Global header search | `js/app/features/search.js` |
| Per-service status dot/pill (`serviceLineStyle`) shown on queue/turns/floor | `js/app/features/status.js` |
| Floor plan: all-services tiles, tech avatars, smart tech-drag, per-station-type tech capacity | `js/app/features/floorplan.js` (+ category `maxTechs`/`setStationCategoryMaxTechs` in `js/app/features/queue.js`) |
| Staff management | `js/app/features/staff.js` |
| Check-in kiosk | `js/app/features/checkin.js` |
| Status flow | `js/app/features/status.js` |
| Queue + Assign & Price modal | `js/app/features/queue.js` |
| Turns / rotation | `js/app/features/turns.js` |
| Reports, transactions, payroll, refunds, historical edit | `js/app/features/reports.js` |
| Gift cards | `js/app/features/giftcards.js` |
| Cash register / drawer (open/close count, cash in/out, reconcile, PDF) | `js/app/features/cashdrawer.js` |
| SMS texting via httpSMS (send + Settings test panel) | `js/app/features/sms.js` (+ `cloudflare/worker.js` `/sms/*`) |
| Reconciliation report (recorded vs charged) + Reports drill-downs | `js/app/features/reports.js` (`openReconcile`, `drillDown*`) |
| Stale-write guard (reject older-than-stored writes) | `js/app/store.js` (`isStaleWrite`/`upsertByIdGuarded`) + `cloudflare/worker.js` (DO `applyMutation`). Covers **records, queue, `config.set` (per-key, via `configMeta`/`cfgmeta:`), `giftcard.save`, AND `customer.upsert`/`customer.bulkUpsert`** (+ `custdeletion:` tombstones, v4.24/v4.26) — `dispatch` stamps a numeric `updatedAt`/`updatedBy`; unstamped/equal writes apply (back-compat). Plus the **§14 per-assignment field-merge** on `queue.upsert`/`queue.assignmentPatch` (v4.28): a whole-entry write keeps a stored assignment whose own `updatedAt` is newer (gated on `assignment.updatedAt`). |
| Assign&Price cross-device hard lock | `js/app/features/queue.js` (`edit_locks` config map) |
| Google Calendar / appointments | `js/app/features/calendar.js` |
| Floor plan | `js/app/features/floorplan.js` |
| Settings panel | `js/app/features/settings.js` |
| Muse Staff tech app | `js/app/staff.js` + `staff.html` |
| Styles | `css/styles.css` |
| HTML structure (dashboard / staff) | `index.html` / `staff.html` |
| Cloudflare Worker + Durable Object (proxy, R2, DO, KV, R2-snapshot backups, Push) | `cloudflare/worker.js` |

**Do not edit inline JS or CSS in `index.html`** beyond the existing Tailwind config `<script>` block — CSS lives in `css/styles.css`, all app logic in `js/app/**`.

---

## localStorage — Durable Keys (Never Remove without a migration plan)

The durable source of truth is the **Cloudflare Durable Object** (`MuseSalonDO`). The client mirrors DO state to `localStorage` for instant offline reload and queues writes in an outbox. Never delete/rename these without a migration plan and explicit approval.

**v3 sync layer:**
| Key | Purpose |
|---|---|
| `muse_state_cache` | Mirror of the last DO snapshot — restores state instantly on reload before the WebSocket reconnects |
| `muse_outbox` | Offline outbox of pending `dispatch` ops; replayed on reconnect (durable across reloads) |
| `muse_device_id` | Unique ID per browser/device for sync echo-suppression / conflict resolution |
| `muse_failed_ops` | Dead-letter log (last 200) of writes the server REJECTED — holds recoverable customer/financial writes; surfaced in Settings → Data Recovery. Do NOT clear blindly |

**Still device-local in localStorage (read + written directly):**
| Key | Purpose |
|---|---|
| `muse_turns_history` | Historical turns/rotation archives, 90-day rolling window |
| `muse_customers` | Customer directory cache |
| `muse_deletion_log` | Device-local audit trail of deleted record IDs (the cross-device delete itself rides the DO `record.delete` op + `deletion:` markers) |
| `muse_last_backup` | Timestamp of last manual backup |
| `muse_cal_hours` | Calendar display hours (device-local, not synced) |
| `gcal_token` / `gcal_hidden` / `gcal_order` | Google Calendar OAuth token + column prefs |
| `muse_session` | §13 server sign-in for THIS browser ({token, user, expires}, ~30 days) — minted by `/auth/login` on PIN entry, never synced |

**Migrated OUT of localStorage into the Durable Object (v3) — do NOT reintroduce as localStorage keys:** `muse_live_queue`, `muse_live_queue_date`, `muse_queue_archive`, `muse_records`, `muse_sq_config`.

---

## Config & State Sync — How It Works (v3)

All mutable state (queue, records, gift cards, and config: staff/services/items/fees/photos/turns order/etc.) lives in memory in `store.js` and syncs through the Durable Object. **Do not use localStorage for config or settings.**

- **`dispatch(op, payload)`** (`sync.js`) is the single write path: it applies the change optimistically via `applyChange` (`store.js`), saves the cache, enqueues to the outbox, and sends to the DO over WebSocket (HTTP `/state` fallback). Ops: `config.set`, `queue.upsert`, `queue.assignmentPatch` (v4.28 — per-assignment merge, used by the staff app), `queue.entryPatch` (v5.36 — entry-level field merge, e.g. the staff app's visit note; patches ONLY the given fields onto the stored entry so it can't clobber a concurrent front-desk fees/items/discount edit), `queue.remove`, `record.save`, `record.delete`, `giftcard.save`, `giftcard.delete`, `customer.upsert`, `customer.delete`, `customer.bulkUpsert`/`customer.bulkDelete` (v4.24/v4.26 — chunked imports/cleanup). The synced state arrays are `queue`, `records`, `giftcards`, **`customers`** (+ `deletions`/`customerDeletions` tombstones).
- **Save pattern for a config value:** `dispatch('config.set', { key, value })` — e.g. turns order = `dispatch('config.set', { key: 'turns_order', value: order })`. Mutate state only through `dispatch`/`applyChange`, never by writing localStorage.
- **Inbound:** the DO broadcasts changes; `sync.js` ignores echoes of this device's own ops (by `device` id) and applies the rest. A full snapshot hydrates `store.js` and replays the outbox.
- The Worker also persists each record/queue entry as its own DO key and runs the Helcim proxy + webhook, the Square proxy (legacy), `/gcal/*`, R2 photos, periodic R2 state-snapshot backups (the DO `alarm()`), and Web Push.

---

## High-Risk Systems

Treat these with extra care — bugs here affect real financial data or break the app for all users:

- **`dispatch` / `applyChange` / DO sync** (`sync.js`, `store.js`, `cloudflare/worker.js`) — the write path for all state; a bug can corrupt settings or drop writes across every device
- **Records merge** (`store.js` `upsertById`, DO per-record keys) — transaction records are financial data; never truncate or blind-replace the array (always merge by id)
- **`muse_deletion_log` + DO `deletion:` markers** — cross-device delete sync; if broken, deleted records can reappear
- **Queue persistence** (`queue.js` + DO + `muse_state_cache`) — losing the queue during business hours is a critical failure
- **`ticketTotal`** (`utils.js`) — single source of truth for a ticket's money (services + items×qty + fees − discount); reports, pay-time, and payroll all derive from it (never trust a cached `totalCost`)
- **`checkAppVersion`** (`main.js`) — on version mismatch it appends a `↻` to the version badge, which is a **manual** hard-reload button (tap → unregister SW + clear caches + `location.reload()`). There is **no auto-reload and no `sessionStorage` guard** (a reload loop is impossible by design). Re-checked at boot and on tab-focus. If the `↻` persists after tapping it, hard refresh (`Ctrl+Shift+R`)
- **Version bump** — always bump `js/app/config.js` (APP_VERSION), `version.json`, and `sw.js` (CACHE_NAME) together; a config.js/version.json mismatch causes reload loops; a stale CACHE_NAME means the old SW cache is never purged

---

## Development Philosophy

- **Data integrity first.** The app is live. No change is worth corrupting customer or financial data.
- **Additive by default.** Add new fields and features rather than reworking existing structures.
- **No premature abstraction.** Don't generalize for hypothetical future needs. Three similar functions is fine.
- **No comments explaining what the code does.** Only comment the WHY when it's non-obvious (a hidden constraint, a subtle invariant, a specific bug workaround).
- **One verifiable change at a time.** Verify each change against the live app before moving to the next.

---

## Fees Are Not Square Items

The `FEES` array is separate from `SERVICES` and `ITEMS`. Fees have their own UI, their own Sheets column, and their own records fields. They are tracked in the dashboard only. Do not merge fees into services or push fees to the Square catalog.

---

## Deployment Rules

1. **Always bump all three version files together:** `js/app/config.js` (APP_VERSION), `version.json`, and `sw.js` (CACHE_NAME). A mismatch causes a persistent `↻` badge. A stale CACHE_NAME means users get stale cached files.
2. GitHub Pages auto-deploys on push to `main`. On next page load (and on tab-focus) each session detects the new version via `checkAppVersion()` and shows the `↻` badge; **tapping the badge** unregisters the SW, clears caches, and reloads so all files come fresh from the network (there is no auto-reload). If the `↻` persists after tapping it, hard refresh (`Ctrl+Shift+R`) is the reliable fallback. Known limitation: on some devices/browsers the first reload after a version bump may still serve stale files; hard refresh always resolves it.
3. **Cloudflare Worker changes** require a separate `wrangler deploy` from the `cloudflare/` directory — they are not deployed by GitHub Pages.
4. Never push a breaking change without a tested rollback path.

---

## Section Markers

Each JS section begins with a marker comment of the form:
```js
// ── Section Name ────────────────────────────────
```

These markers use Unicode box-drawing characters (U+2500 `─`). If you add a new major section to any JS file, follow this convention.

---

## Relevant Files

| File | Purpose |
|---|---|
| `PRIORITIES.md` | ⭐ **The live pipeline/backlog — read this for "what's next."** |
| `HELCIM-MIGRATION.md` | Square→Helcim migration record (LIVE since v4.61–v4.81) + **verified Helcim API findings** (needed for the refund path) |
| `AUDIT-2026-06.md` | System-wide code audit (historical) — COMPLETE §1–§15, all HIGHs closed (v4.11–v4.33); the remaining deferred items are mirrored in `PRIORITIES.md` |
| `IDEABOARD.md` | Parked ideas (unscheduled) |
| `ROADMAP.md` | Completed phase history + the TurnDesk (paused) plan |
| `README.md` | Project overview and architecture |
| `manifest.json` | PWA manifest (name, icons, display mode, theme color) |
| `sw.js` | Service worker — precache + offline fallback; CACHE_NAME must match APP_VERSION |
| `icons/` | PWA launcher icons (192px + 512px PNG) |
| `cloudflare/worker.js` | Cloudflare Worker — DO sync, Helcim proxy + webhook, Square proxy (legacy), `/gcal/*`, R2 photos, `/sms`, R2-snapshot backups |
| `cloudflare/wrangler.toml` | Worker configuration + bindings |
