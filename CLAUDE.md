# Claude — AI Coding Instructions for musedashboard

This file contains rules and context for AI coding assistants working on this project. Read it before making any changes.

---

## What This App Is

A salon management PWA for Muse Nails & Spa. It runs in a browser on an iPad at the front desk and on technician-facing devices.

The app is currently in **rebuild mode** — not deployed — while phases 2–7 are in progress. It will relaunch with fresh operational data. Historical transaction records, queue archives, and turn history are **intentionally not being migrated**. The app starts clean on relaunch.

Build priorities (in order): clean architecture, stable sync, good modularity, future scalability.

Treat all changes as production-quality — no placeholders, no half-finished implementations.

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
| App version bump | `js/config.js` (APP_VERSION) + `version.json` |
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

**Do not edit inline JS or CSS in `index.html`.** The `<style>` block and `<script>` block no longer exist in index.html — CSS is in `css/styles.css` and JS is in `js/*.js`.

---

## localStorage — Permanent Keys (Never Remove)

These keys are the durable data layer. They persist across reloads and are backed up to Sheets. Never delete, rename, or stop reading these keys without a migration plan.

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

All other localStorage keys were removed in Phase 1 (v1.55). Do not add new `localStorage.setItem` calls for config or settings — use the in-memory variable and call `pushConfigToSheets()` to persist.

---

## Config Sync — How It Works

All mutable settings (staff, services, items, fees, photos, etc.) live in JS memory for the session and are backed up to Google Sheets App Config row 2. **Do not use localStorage for config or settings** — Phase 1 removed that layer entirely.

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
- **`checkAppVersion`** (`app.js`) — triggers auto-reload on all connected devices; a bug here can cause reload loops
- **Version bump** — always bump both `js/config.js` (APP_VERSION) and `version.json` together; a mismatch causes infinite reload loops on connected devices

---

## Build Philosophy

- **Architecture first.** Clean architecture, stable sync, and good modularity take precedence over preserving existing patterns. Historical data migration is explicitly out of scope — the app relaunches fresh.
- **One phase at a time.** Complete and verify each phase before starting the next.
- **No backwards-compatibility shims.** If something is removed, remove it cleanly. No re-export aliases, no `_legacy` wrappers.
- **No premature abstraction.** Don't generalize for hypothetical future needs. Three similar functions is fine.
- **No comments explaining what the code does.** Only comment the WHY when it's non-obvious (a hidden constraint, a subtle invariant, a specific bug workaround).

---

## Fees Are Not Square Items

The `FEES` array is separate from `SERVICES` and `ITEMS`. Fees have their own UI, their own Sheets column, and their own records fields. They are tracked in the dashboard only. Do not merge fees into services or push fees to the Square catalog.

---

## Deployment Rules

1. The app is in rebuild mode and is not live. Do not push to `main` until phases 2–7 are complete. The app will relaunch with fresh operational data — no historical records are being imported.
2. When ready to deploy: bump `APP_VERSION` in `js/config.js` and `version.json`, then push to `main`.
3. GitHub Pages auto-deploys. All connected sessions auto-reload within 15 seconds via `checkAppVersion()`.
4. Never push a version where `APP_VERSION` and `version.json` disagree — this causes reload loops.

---

## Section Markers

Each JS section begins with a marker comment of the form:
```js
// ── Section Name ────────────────────────────────
```

These markers use Unicode box-drawing characters (U+2500 `─`). `split.ps1` uses them to route code to files. If you add a new major section to any JS file, follow this convention so the tooling can process it.

---

## Relevant Files

| File | Purpose |
|---|---|
| `ROADMAP.md` | Phase 1–7 plans and current status |
| `README.md` | Project overview and architecture |
| `split.ps1` | PowerShell script that extracted the original single-file app into modules (one-time use; committed for reference) |
| `muse-sheets-script.gs` | Google Apps Script — not in this repo, deployed separately |
