# Muse Nails & Spa — Dashboard

Salon management PWA for Muse Nails & Spa. Manages a live customer queue, technician turn rotation, check-in kiosk, appointments, transactions, gift cards, staff, and settings. Hosted on GitHub Pages with a Cloudflare Worker edge layer and Google Sheets as the durable data store.

**Live URL:** https://musenail.github.io/musedashboard
**Current version:** v1.73
**Status:** Production — operational optimization mode

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static, auto-deploy on push to `main`) |
| Edge / Proxy | Cloudflare Worker (`musedashboard.musenailandspa.workers.dev`) |
| Real-time sync | Cloudflare Durable Objects (WebSocket broadcast hub) |
| Config cache | Cloudflare Workers KV (sub-10ms config reads) |
| Photo storage | Cloudflare R2 (staff photos, business logo) |
| Scheduled tasks | Cloudflare Cron Triggers (4:05 AM PT daily archive) |
| Backend logic | Google Apps Script (`muse-sheets-script.gs`) |
| Data store | Google Sheets (source of truth for config, records, queue) |
| Square | Bidirectional catalog sync, customer directory, POS deep link, Bookings |
| Frontend | Vanilla JS (ES2020+), HTML5, Tailwind CSS (CDN) |
| Build tooling | None — no npm, no bundler, no transpiler |

---

## Architecture

```
Browser (PWA — index.html + js/*.js + sw.js)
  ↕ WebSocket (real-time)
  Cloudflare Durable Object (MuseSalonDO — stateless broadcast hub)
  ↕ fetch
  Cloudflare Worker
    ├── /sheets  → Workers KV cache → Google Apps Script → Google Sheets
    ├── /square  → Square API (catalog, customers, bookings, POS)
    └── /photos  → Cloudflare R2 (binary photo/logo storage)
```

All async calls from the browser go through the Cloudflare Worker (`SQUARE_PROXY` / `PHOTOS_PROXY` in `js/config.js`). Google Sheets remains the durable source of truth for config, records, and queue state. The Worker layers provide real-time push, fast cold starts, and binary storage on top.

### Sync model

- **Queue + config:** WebSocket push via Durable Object (instant); falls back to 5s/15s polling on disconnect
- **Config writes:** lock out incoming polls for 10 seconds (`_configWriteTime`) to prevent overwrite race
- **Config reads:** Workers KV serves sub-10ms; falls back to Apps Script on cache miss
- **Photos:** stored in R2 as binary objects; URLs synced via the config blob
- **Daily archive:** Cloudflare Cron fires at 4:05 AM PT; Apps Script computes day stats and clears the live queue

### Device identity

Each browser session generates a unique `DEVICE_ID` stored in `localStorage('muse_device_id')`. Used for conflict resolution when multiple devices write config simultaneously.

---

## Module Structure

All JS is split into 18 files loaded as plain `<script src>` tags (no ES modules, no bundler). Files share a single global scope. **Load order is a hard constraint** — see below.

```
css/
  styles.css              — all app CSS

js/                       — load order is top → bottom
  utils.js                — clock, date helpers, phone formatting, toast, dedup, _configWriteTime
  config.js               — APP_VERSION, global constants, global state (SERVICES, STAFF, FRONT_DESK_USERS, squareCustomers, …)
  sync.js                 — Sheets push/pull, loadConfigFromSheets, pushConfigToSheets, allRecords sync, WebSocket connection
  photos.js               — R2 photo upload/delete, staff photo crop, logo management
  auth.js                 — PIN modal, logged-in user display, front desk user CRUD
  catalog.js              — Services/Items/Fees CRUD, dashboard visibility toggles
  square-customers.js     — Square customer autocomplete, customer directory, staff import from Square
  square-catalog.js       — Square config modal, catalog pull/push (services + items)
  square-pos.js           — Square POS deep link, order creation, appointment booking push
  staff.js                — Staff CRUD, schedule management
  checkin.js              — Guest card builder, kiosk check-in flow
  queue.js                — Queue persistence, queue UI, all queue modals
  turns.js                — Turn rotation, drag-and-drop, tech status, undo stack
  reports.js              — Reports tab, drill-down, historical entry, record export
  giftcards.js            — Gift card UI, sort/filter, clear-records utility
  calendar.js             — Google Calendar integration, appointment modal, column management
  settings.js             — Settings panel, role permissions, first-time wizard
  app.js                  — DOMContentLoaded init, navigation, version check, midnight reset

sw.js                     — Service worker: precache + offline fallback; CACHE_NAME must match APP_VERSION
manifest.json             — PWA manifest (name, icons, display: standalone, theme color)
index.html                — Shell HTML only; references css/styles.css and all js/*.js
version.json              — { "version": "vX.XX" } — checked by all clients to detect new deploys
```

**Critical load-order constraint:** `utils.js` must load before `config.js` because it declares `_configWriteTime` and `dedupByLabel()` used at parse time. Everything else is function-body-only.

---

## Deployment Workflow

1. Edit files in `js/`, `css/`, or `index.html`
2. Bump `APP_VERSION` in `js/config.js`
3. Update `version.json` to match
4. Update `CACHE_NAME` in `sw.js` to match
5. Commit and push to `main`
6. GitHub Pages deploys automatically (usually < 60 seconds)
7. On next page load, each browser session detects the version change via `checkAppVersion()` and auto-reloads once. If the service worker cache hasn't updated yet, a `↻` badge appears — hard refresh (`Ctrl+Shift+R`) to force it

**For Cloudflare Worker changes** (files in `cloudflare/`):
```
cd cloudflare
wrangler deploy
```
Worker changes are independent of GitHub Pages deploys.

---

## Production Data Integrity

The app is in active operational use. These rules are permanent:

- **Never remove or rename** localStorage keys, R2 objects, Sheets columns, or config structures without an explicit migration plan
- **Never auto-reset** live data or perform automatic cleanup
- **All future changes** must preserve customer records, queue state, reports, appointments, staff, settings, gift cards, photos, and audit history
- **Favor additive changes** — new fields, new optional features — over rewrites or destructive cleanup

---

## Development Philosophy

- **No build step.** Everything the browser loads is exactly what's in the repo.
- **Vanilla JS only.** No frameworks, no libraries beyond Tailwind CDN.
- **Single global scope.** All 18 JS files share one scope via ordered `<script src>` tags.
- **Operational stability first.** The app is live. Data integrity and reliability take priority over architectural experimentation.
- **GitHub Pages constraints.** No server-side rendering, no redirects, no dynamic routes.

---

## Related Docs

- [`ROADMAP.md`](ROADMAP.md) — Completed phase history + post-launch optimization roadmap
- [`CLAUDE.md`](CLAUDE.md) — AI coding instructions, architecture rules, and production data integrity rules
