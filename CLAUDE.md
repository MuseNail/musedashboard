# Claude — AI Coding Instructions for musedashboard

This file contains rules and context for AI coding assistants working on this project. Read it before making any changes.

---

## What This App Is

A salon management PWA for Muse Nails & Spa. It runs in a browser on an iPad at the front desk and on technician-facing devices.

The app is **live and in active operational use**. All planned phases (Split through Phase 7) are complete.

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
- **Core:** `js/app/main.js` (bootstrap, window glue, navigation, version check), `store.js` (in-memory state + `applyChange` op reducer), `sync.js` (WebSocket/HTTP sync + `dispatch` + offline outbox), `session.js`, `config.js` (`APP_VERSION`, constants), `utils.js`.
- **Features:** `js/app/features/*.js` — auth, photos, catalog, square-customers, square-catalog, square-pos, staff, checkin, status, queue, turns, reports, giftcards, settings, calendar, floorplan, appearance, servicetime.

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
| Session / active user | `js/app/session.js` |
| Utility fns, numpad, toast, `ticketTotal` | `js/app/utils.js` |
| App init, navigation, version check, window glue | `js/app/main.js` |
| Photos / logo | `js/app/features/photos.js` |
| Auth / PIN | `js/app/features/auth.js` |
| Services, Items, Fees CRUD | `js/app/features/catalog.js` |
| Square customers, directory, autocomplete, upsert | `js/app/features/square-customers.js` |
| Square config modal, catalog pull/push | `js/app/features/square-catalog.js` |
| Square POS deep link, orders, appointments, bookings | `js/app/features/square-pos.js` |
| Staff management | `js/app/features/staff.js` |
| Check-in kiosk | `js/app/features/checkin.js` |
| Status flow | `js/app/features/status.js` |
| Queue + Assign & Price modal | `js/app/features/queue.js` |
| Turns / rotation | `js/app/features/turns.js` |
| Reports, transactions, payroll, refunds, historical edit | `js/app/features/reports.js` |
| Gift cards | `js/app/features/giftcards.js` |
| Google Calendar / appointments | `js/app/features/calendar.js` |
| Floor plan | `js/app/features/floorplan.js` |
| Settings panel | `js/app/features/settings.js` |
| Muse Staff tech app | `js/app/staff.js` + `staff.html` |
| Styles | `css/styles.css` |
| HTML structure (dashboard / staff) | `index.html` / `staff.html` |
| Cloudflare Worker + Durable Object (proxy, R2, DO, KV, Cron, Push) | `cloudflare/worker.js` |

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

**Still device-local in localStorage (read + written directly):**
| Key | Purpose |
|---|---|
| `muse_turns_history` | Historical turns/rotation archives, 90-day rolling window |
| `muse_customers` | Customer directory cache |
| `muse_deletion_log` | Device-local audit trail of deleted record IDs (the cross-device delete itself rides the DO `record.delete` op + `deletion:` markers) |
| `muse_last_backup` | Timestamp of last manual backup |
| `muse_cal_hours` | Calendar display hours (device-local, not synced) |
| `gcal_token` / `gcal_hidden` / `gcal_order` | Google Calendar OAuth token + column prefs |

**Migrated OUT of localStorage into the Durable Object (v3) — do NOT reintroduce as localStorage keys:** `muse_live_queue`, `muse_live_queue_date`, `muse_queue_archive`, `muse_records`, `muse_sq_config`.

---

## Config & State Sync — How It Works (v3)

All mutable state (queue, records, gift cards, and config: staff/services/items/fees/photos/turns order/etc.) lives in memory in `store.js` and syncs through the Durable Object. **Do not use localStorage for config or settings.**

- **`dispatch(op, payload)`** (`sync.js`) is the single write path: it applies the change optimistically via `applyChange` (`store.js`), saves the cache, enqueues to the outbox, and sends to the DO over WebSocket (HTTP `/state` fallback). Ops: `config.set`, `queue.upsert`, `queue.remove`, `record.save`, `record.delete`, `giftcard.save`, `giftcard.delete`.
- **Save pattern for a config value:** `dispatch('config.set', { key, value })` — e.g. turns order = `dispatch('config.set', { key: 'turns_order', value: order })`. Mutate state only through `dispatch`/`applyChange`, never by writing localStorage.
- **Inbound:** the DO broadcasts changes; `sync.js` ignores echoes of this device's own ops (by `device` id) and applies the rest. A full snapshot hydrates `store.js` and replays the outbox.
- The Worker also persists each record/queue entry as its own DO key and runs the Square proxy, R2 photos, the daily Sheets backup cron, and Web Push.

---

## High-Risk Systems

Treat these with extra care — bugs here affect real financial data or break the app for all users:

- **`dispatch` / `applyChange` / DO sync** (`sync.js`, `store.js`, `cloudflare/worker.js`) — the write path for all state; a bug can corrupt settings or drop writes across every device
- **Records merge** (`store.js` `upsertById`, DO per-record keys) — transaction records are financial data; never truncate or blind-replace the array (always merge by id)
- **`muse_deletion_log` + DO `deletion:` markers** — cross-device delete sync; if broken, deleted records can reappear
- **Queue persistence** (`queue.js` + DO + `muse_state_cache`) — losing the queue during business hours is a critical failure
- **`ticketTotal`** (`utils.js`) — single source of truth for a ticket's money (services + items×qty + fees − discount); reports, pay-time, and payroll all derive from it (never trust a cached `totalCost`)
- **`checkAppVersion`** (`main.js`) — on version mismatch unregisters the SW (so the next load fetches fresh) and reloads once; a `sessionStorage` guard prevents reload loops. If the `↻` badge persists, hard refresh (`Ctrl+Shift+R`)
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

1. **Always bump all three version files together:** `js/config.js` (APP_VERSION), `version.json`, and `sw.js` (CACHE_NAME). A mismatch causes reload loops. A stale CACHE_NAME means users get stale cached files.
2. GitHub Pages auto-deploys on push to `main`. On next page load each session detects the new version via `checkAppVersion()`, unregisters the SW, and reloads once so all files come fresh from the network. If the `↻` badge appears after the auto-reload, hard refresh (`Ctrl+Shift+R`) is the reliable fallback. Known limitation: on some devices/browsers the first reload after a version bump may still serve stale files; hard refresh always resolves it.
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
| `ROADMAP.md` | Completed phase history + post-launch optimization roadmap |
| `README.md` | Project overview and architecture |
| `manifest.json` | PWA manifest (name, icons, display mode, theme color) |
| `sw.js` | Service worker — precache + offline fallback; CACHE_NAME must match APP_VERSION |
| `icons/` | PWA launcher icons (192px + 512px PNG) |
| `cloudflare/worker.js` | Cloudflare Worker — Square proxy, R2 photos, KV config cache, DO WebSocket, Cron |
| `cloudflare/wrangler.toml` | Worker configuration, bindings, cron schedule |
| `split.ps1` / `split.js` | One-time extraction scripts (original monolith → modules); committed for historical reference only |
| `muse-sheets-script.gs` | Google Apps Script — not in this repo, deployed separately |
