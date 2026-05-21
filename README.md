# Muse Nails & Spa — Dashboard

Salon management PWA for Muse Nails & Spa. Manages a live customer queue, technician turn rotation, check-in kiosk, appointments, transactions, gift cards, staff, and settings. Hosted on GitHub Pages with a Cloudflare Worker proxy and Google Sheets as the data store.

**Live URL:** https://musenail.github.io/musedashboard  
**Current version:** v1.56

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static, auto-deploy on push to `main`) |
| Proxy / Edge | Cloudflare Worker (`musedashboard.musenailandspa.workers.dev`) |
| Backend logic | Google Apps Script (`muse-sheets-script.gs`) |
| Data store | Google Sheets |
| Frontend | Vanilla JS, HTML5, Tailwind CSS (CDN) |
| Build tooling | None — no npm, no bundler, no transpiler |

---

## Architecture

```
Browser (index.html + js/*.js)
  → Cloudflare Worker  (CORS proxy, future: R2, Durable Objects, KV)
    → Google Apps Script  (doPost handler, all read/write logic)
      → Google Sheets  (live data store)
```

All async Sheets calls go through `SHEETS_PROXY` (the Cloudflare Worker URL defined in `js/config.js`). The Worker forwards requests to the Apps Script `doPost` endpoint.

### Sync model (current)

- Queue polling: every 5 seconds (`POLL_INTERVAL`)
- Config + photos + records polling: every 15 seconds (`CONFIG_POLL_INTERVAL`)
- Config writes lock out incoming polls for 10 seconds (`_configWriteTime`) to prevent a device from overwriting its own just-saved data

### Device identity

Each browser session generates a unique `DEVICE_ID` stored in `localStorage('muse_device_id')`. Used for conflict resolution when multiple devices write config simultaneously.

---

## Module Structure

All JS is split into 16 files loaded as plain `<script src>` tags (no ES modules). Files share a single global scope. **Load order matters** — see below.

```
css/
  styles.css            — all app CSS (extracted from the original <style> block)

js/                     — load order is top → bottom
  utils.js              — Clock, date helpers, phone formatting, toast, dedup, _configWriteTime
  config.js             — APP_VERSION, SHEETS_PROXY, global state vars (SERVICES, STAFF, FRONT_DESK_USERS, queue, squareCustomers, …)
  sync.js               — Sheets export/import, loadConfigFromSheets, pushConfigToSheets, allRecords sync, gift card loader
  photos.js             — Logo upload/crop, staff photo storage and crop
  auth.js               — PIN modal, logged-in user display, front desk user CRUD
  catalog.js            — Services/Items/Fees CRUD, dashboard visibility toggles
  square.js             — Square customer autocomplete, customer directory, appointments sync
  staff.js              — Staff CRUD, schedule calendar
  checkin.js            — Guest card builder, check-in submission (kiosk flow)
  queue.js              — Queue persistence, queue UI, all queue modals (add, edit, assign, merge, split…)
  turns.js              — Turn rotation, drag-and-drop, tech status, undo stack
  reports.js            — Reports tab, drill-down, Sheets export, historical entry
  giftcards.js          — Gift card UI, sort/filter
  calendar.js           — Google Calendar integration, appointment modal, column reorder
  settings.js           — Settings panel, staff/service visibility, first-time wizard, audit log
  app.js                — DOMContentLoaded init, navigation, version check, midnight reset

index.html              — Shell HTML only; references css/styles.css and all js/*.js files
version.json            — { "version": "vX.XX" } — checked by clients to detect deploys
```

**Critical load-order constraint:** `utils.js` must load before `config.js` and all later files because it declares `_configWriteTime`, `dedupByLabel()`, and other globals used throughout. `config.js` must load before `sync.js` because `loadConfigFromSheets()` in sync.js calls `dedupByLabel()` when applying remote config.

---

## Deployment Workflow

1. Edit files in `js/` or `css/` (do **not** edit the inline JS/CSS directly in `index.html`)
2. Bump `APP_VERSION` in `js/config.js` (e.g. `'v1.54'` → `'v1.55'`)
3. Update `version.json` to match: `{ "version": "v1.55" }`
4. Commit and push to `main`
5. GitHub Pages deploys automatically (usually < 60 seconds)
6. All connected browser sessions detect the version change via `checkAppVersion()` and auto-reload within 15 seconds

> The app is in **rebuild mode** and is not currently live. It will relaunch with fresh operational data — historical records, queue archives, and turn history are intentionally not being migrated. Do not push to `main` until all planned phases are complete.

---

## Development Philosophy

- **No build step.** Everything the browser loads is exactly what's in the repo. No transpilation, no bundling.
- **Vanilla JS only.** No frameworks, no libraries beyond Tailwind CDN.
- **Single global scope.** All 16 JS files share one scope via ordered `<script src>` tags. Variables declared in one file are accessible in all files loaded after it.
- **Architecture-first rebuild.** Each phase improves the foundation before the app relaunches. Historical data is not being migrated — the app starts clean. Priorities: clean architecture, stable sync, good modularity, future scalability.
- **GitHub Pages constraints.** No server-side rendering, no redirects, no dynamic routes. The app is a single HTML page with client-side logic only.

---

## Related Docs

- [`ROADMAP.md`](ROADMAP.md) — Phase 1–7 plans and current status
- [`CLAUDE.md`](CLAUDE.md) — AI coding instructions and project rules
