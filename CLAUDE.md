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

### No frontend build step
There is no npm, no bundler, no transpiler, and no intention to add one. Do not suggest or introduce any. All JS is plain ES2020+ that runs directly in the browser.

### No frameworks
Vanilla JS only. No React, Vue, Svelte, Alpine, or any other component framework. Tailwind CDN is already present for layout utilities — do not add more libraries.

### No ES modules
All 18 JS files share a single global scope via ordered `<script src>` tags. Do not add `type="module"` to any script tag, do not use `import`/`export`. Variables defined in one file are available in all files loaded after it.

### Load order is a hard constraint
The `<script>` tag order in `index.html` is:

```
utils.js → config.js → sync.js → photos.js → auth.js → catalog.js →
square-customers.js → square-catalog.js → square-pos.js →
staff.js → checkin.js → queue.js → turns.js → reports.js →
giftcards.js → calendar.js → settings.js → app.js
```

If you add a variable or function that must be available at parse time (not just inside a function body), it must be in a file that loads before the file that uses it. The only current parse-time dependency is `dedupByLabel` (utils.js) called in config.js.

### GitHub Pages only
No server-side logic, no dynamic routes, no build artifacts. All output must be static files that GitHub Pages can serve directly.

---

## Where to Make Changes

| Change type | File(s) to edit |
|---|---|
| App version bump | `js/config.js` (APP_VERSION) + `version.json` + `sw.js` (CACHE_NAME) |
| Global constants | `js/config.js` |
| Global state vars | `js/config.js` |
| Utility functions | `js/utils.js` |
| Sheets sync / config push-pull | `js/sync.js` |
| Photos / logo | `js/photos.js` |
| Auth / PIN | `js/auth.js` |
| Services, Items, Fees CRUD | `js/catalog.js` |
| Square customers, directory, upsert | `js/square-customers.js` |
| Square config modal, catalog pull/push | `js/square-catalog.js` |
| Square POS deep link, orders, appointments, bookings | `js/square-pos.js` |
| Staff management | `js/staff.js` |
| Check-in kiosk | `js/checkin.js` |
| Queue and queue modals | `js/queue.js` |
| Turns / rotation | `js/turns.js` |
| Reports | `js/reports.js` |
| Gift cards | `js/giftcards.js` |
| Google Calendar / appointments | `js/calendar.js` |
| Settings panel | `js/settings.js` |
| App init, navigation, version check | `js/app.js` |
| Styles | `css/styles.css` |
| HTML structure | `index.html` |
| Cloudflare Worker (proxy, R2, DO, KV, Cron) | `cloudflare/worker.js` |

**Do not edit inline JS or CSS in `index.html`.** The `<style>` block and `<script>` block no longer exist in index.html — CSS is in `css/styles.css` and JS is in `js/*.js`.

---

## localStorage — Permanent Keys (Never Remove)

These keys are the durable data layer. They persist across reloads and are backed up to Sheets. Never delete, rename, or stop reading these keys without a migration plan and explicit approval.

| Key | Purpose |
|---|---|
| `muse_device_id` | Unique ID per browser/device for sync conflict resolution |
| `muse_live_queue` | Today's customer queue (offline resilience) |
| `muse_live_queue_date` | Date stamp for the live queue |
| `muse_queue_archive` | Daily queue snapshots, 90-day rolling window |
| `muse_turns_history` | Historical turns/rotation archives, 90-day rolling window |
| `muse_records` | All transaction records (source of truth for Reports) |
| `muse_deletion_log` | Deleted record IDs for cross-device delete sync |
| `muse_customers` | Customer directory |
| `muse_sq_config` | Square API location ID |
| `muse_last_backup` | Timestamp of last manual backup |
| `muse_cal_hours` | Calendar display hours preference (device-local, not synced) |
| `gcal_token` | Google Calendar OAuth token |
| `gcal_hidden` | Hidden calendar columns preference |
| `gcal_order` | Calendar column order preference |

Do not add new `localStorage.setItem` calls for config or settings — use the in-memory variable and call `pushConfigToSheets()` to persist.

---

## Config Sync — How It Works

All mutable settings (staff, services, items, fees, photos, etc.) live in JS memory for the session and are backed up to Google Sheets App Config row 2. **Do not use localStorage for config or settings.**

- `pushConfigToSheets()` — reads the current in-memory vars (`STAFF`, `SERVICES`, `ITEMS`, `FEES`, `_logoData`, `turnsTechOrder`, etc.) and POSTs them to Sheets. Sets `_configWriteTime = Date.now()` as a lock so the next poll doesn't immediately overwrite a just-saved value.
- `loadConfigFromSheets()` — fetches config from Sheets and writes directly into the in-memory vars. Skips overwriting if `DEVICE_ID` matches the writer or if `_configWriteTime` is within 10 seconds (slow-write safety net). Returns `{ changed, recordsUpdatedAt, _raw }`.
- `_configWriteTime` — declared in `utils.js`, used in `sync.js`. Do not move it.
- `DEVICE_ID` — declared in `sync.js`. Used only inside function bodies (not at parse time).

**Save pattern for any config var:** mutate the in-memory var, set `_configWriteTime = Date.now()`, then `setTimeout(() => pushConfigToSheets(), N)`. Do not write to localStorage.

---

## High-Risk Systems

Treat these with extra care — bugs here affect real financial data or break the app for all users:

- **`pushConfigToSheets` / `loadConfigFromSheets`** (`sync.js`) — any bug can corrupt settings across all devices
- **`allRecords` sync** (`sync.js`) — transaction records are financial data; never truncate or overwrite without merge logic
- **`muse_deletion_log`** — cross-device delete sync; if broken, deleted records can reappear
- **Queue persistence** (`queue.js`) — losing the queue during business hours is a critical failure
- **`checkAppVersion`** (`app.js`) — on version mismatch: unregisters the SW (so next load fetches all files fresh), then calls `window.location.replace()`. A `sessionStorage` guard (`_pendingVersion`) prevents infinite loops if the unregister fails. If the `↻` badge appears after the auto-reload, hard refresh (`Ctrl+Shift+R`) is the reliable fallback.
- **Version bump** — always bump `js/config.js` (APP_VERSION), `version.json`, and `sw.js` (CACHE_NAME) together; a mismatch between config.js and version.json causes reload loops; a stale CACHE_NAME means the old SW cache is never purged

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
