# Muse Dashboard — Roadmap

The app is undergoing an architecture-first rebuild. Phases are done in order. The app is not live during this window.

**Rebuild context:** Historical transaction records, queue archives, and turn history are intentionally not being migrated. The app will relaunch with fresh operational data. This decision removes migration complexity and lets the build prioritize clean architecture, stable sync, good modularity, and future scalability over backward compatibility with existing data.

---

## Phase Status

| Phase | Title | Status |
|---|---|---|
| 0 | Known bugs (pre-refactor) | Documented — 1 requires explicit fix, 2 resolve with Phase 1 |
| Split | Extract single file → modules | ✅ Complete (v1.54) |
| 1 | localStorage Cleanup | ✅ Complete (v1.55) |
| 2 | Cloudflare R2 for Photos | ✅ Complete (v1.56) |
| 3 | Durable Objects WebSocket Sync | ✅ Complete (v1.57) |
| 4 | Workers KV for Fast Config Reads | 🔄 Next |
| 5 | Cron Jobs + Twilio SMS + Gmail | Planned |
| 6 | Square POS Deep Link Integration | Planned |
| 7 | PWA Polish | Planned |

---

## Phase 0 — Known Bugs (Pre-Refactor)

Three bugs documented before the split. All are resolved or moot given the rebuild context.

### Bug 1 — Turns history missing
`archiveTurnsForToday()` only fires inside `scheduleMidnightReset()`, which uses a `setTimeout` that evaporates if the browser closes before 4 AM.

**Status:** Moot for historical data (not being migrated). Still present in code — the permanent fix is Phase 5 (Cloudflare Cron Trigger at 4:05 AM), which eliminates the browser `setTimeout` entirely.

### Bug 2 — Turns order flash on save
Saving turns order wrote to localStorage then triggered a config push. The 5-second queue poll briefly restored the old order before the push completed.

**Status:** ✅ Resolved in Phase 1 — localStorage is no longer the intermediary for config data.

### Bug 3 — `allRecords` never pruned
`muse_records` grew indefinitely toward the 5 MB localStorage limit as transactions accumulated.

**Status:** ✅ Resolved — records now live server-side, and historical records are not being migrated on relaunch.

---

## Phase 1 — localStorage Cleanup ✅ Complete (v1.55)

**Goal:** Stop using localStorage as a data store for config and settings. All mutable app state loads from Google Sheets on startup and lives in JS memory for the session. Only the permanent keys (queue, records, device ID, calendar prefs) remain in localStorage.

### Variables moved to in-memory

| Variable | Removed localStorage key | Declaration |
|---|---|---|
| `STAFF` | `muse_staff` | `let STAFF = []` |
| `SERVICES` | `muse_services` | `let SERVICES = []` |
| `ITEMS` | `muse_items` | `let ITEMS = []` |
| `FEES` | `muse_fees` | `let FEES = []` |
| `FRONT_DESK_USERS` | `muse_fd_users` | `let FRONT_DESK_USERS = [default admin]` |
| `inactiveStaff` | `muse_inactive_staff` | `let inactiveStaff = []` |
| `hiddenCheckinServices` | `muse_hidden_services` | `let hiddenCheckinServices = []` |
| `hiddenDashServices` | `muse_hidden_dash_services` | `let hiddenDashServices = []` |
| `giftCards` | `muse_gift_cards` | `let giftCards = []` |
| `scheduleData` | `muse_schedule` | `let scheduleData = {}` |
| `turnsTechOrder` | `muse_turns_order` | `let turnsTechOrder = []` |
| `turnsBreakStaff` | `muse_turns_break` | `let turnsBreakStaff = []` |
| `turnsOffStaff` | `muse_turns_off` | `let turnsOffStaff = []` |
| `_turnConfig` | `muse_turn_config` | `let _turnConfig = {}` |
| `_bonusServices` | `muse_bonus_services` | `let _bonusServices = []` |
| `_logoData` | `muse_logo` | `let _logoData = null` |
| `_photoCache` | `muse_photo_staff_{id}` / `muse_photo_fduser_{id}` | `const _photoCache = {}` |

**Exception:** `squareConfig` reads from `muse_sq_config` (permanent key — stays in localStorage).

### What changed in each file

- **`js/config.js`** — STAFF, SERVICES, FRONT_DESK_USERS start as empty; save functions drop `localStorage.setItem`
- **`js/settings.js`** — ITEMS, FEES, inactiveStaff, hiddenCheckinServices, hiddenDashServices start as empty; save functions drop writes
- **`js/catalog.js`** — `saveHiddenDashServices()` no-op
- **`js/staff.js`** — scheduleData starts as `{}`; `saveScheduleData()` drops write
- **`js/turns.js`** — turnsTechOrder, turnsBreakStaff, turnsOffStaff start as `[]`; save functions no-ops; `renderTurns()` no longer re-reads localStorage; `saveTurnsAndSync()` drops 3 writes
- **`js/app.js`** — `_turnConfig`/`_bonusServices` declared; getTurnConfig/saveTurnConfig/isAlwaysBonusService/saveBonusServices rewritten; startup init block simplified; `checkAppVersion()` clears non-permanent keys on version mismatch; tech order functions drop writes
- **`js/photos.js`** — `_logoData`/`_photoCache` declared; all photo storage functions use the cache; logo functions use `_logoData`
- **`js/sync.js`** — `pushConfigToSheets()` reads in-memory vars; `loadConfigFromSheets()` writes in-memory vars; config poll block simplified; `loadGiftCardsFromSheets()` drops localStorage write; `pollSheets()` drops turns-order localStorage write
- **`js/giftcards.js`** — `giftCards = []`; `saveGiftCardsToStorage()` no-op; `deleteGiftCard()` calls `exportGiftCardsSheets()`; `exportAllData`/`importAllData` rewritten for in-memory vars; `renderBonusServicesList`/`toggleBonusService` use `_bonusServices`
- **`js/queue.js`** — `setLogo()` uses `_logoData`; Square catalog sync drops 3 localStorage writes
- **`js/reports.js`** — report print header uses `_logoData`

---

## Phase 2 — Cloudflare R2 for Photos and Report Exports ✅ Complete (v1.56)

**Goal:** Move base64 staff photos and logo out of the Google Sheets config blob into Cloudflare R2 object storage. Also enable report exports to be saved as R2 objects with shareable download links.

**Why:** Photos bloat the config sync payload significantly. R2 gives proper binary storage with a CDN URL per object.

### What changed

- `cloudflare/worker.js` — new file: complete worker with `/sheets`, `/square`, and `/photos` R2 routes
- `cloudflare/wrangler.toml` — new file: R2 bucket binding and secrets template
- `js/config.js` — added `PHOTOS_PROXY` constant
- `js/photos.js` — complete rewrite: `_uploadToR2`/`_deleteFromR2` helpers; `savePhotoToStorage()` now async (uploads to R2, returns URL); `removePhotoFromStorage()` deletes from R2; `pushPhotosToSheets()` removed; `restorePhotos()` bug fixed (was broken destructuring, now `Object.assign`); `getAllPhotos()` returns URL dict; logo flows through `savePhotoToStorage('logo','business',…)`
- `js/sync.js` — `pushConfigToSheets()` now includes `muse_photos` (URL dict, not base64)
- `js/reports.js` — `exportReportLink()` uploads HTML report to R2 and copies URL to clipboard
- `index.html` — "Copy Link" button added to report export row

### Deployment steps (one-time)

1. `wrangler r2 bucket create musedashboard-photos`
2. `wrangler secret put SHEETS_URL` (paste the Apps Script doPost URL)
3. `wrangler secret put SQUARE_TOKEN`
4. `wrangler deploy cloudflare/worker.js` from the repo root

---

## Phase 3 — Durable Objects for Real-Time WebSocket Sync

**Goal:** Replace the 5s/15s polling model with push-based real-time sync. All connected devices see queue and config changes instantly.

**Why:** Polling causes a visible lag when one device updates the queue and another sees it 5 seconds later. It also wastes bandwidth when nothing has changed.

### Changes needed

- Cloudflare Durable Object: one instance per salon (`MuseSalonDO`)
- DO holds live queue state in memory; broadcasts changes to all connected WebSocket clients
- `startSheetsPolling()` replaced by a WebSocket connection to the DO
- Queue writes: browser → DO (instant broadcast) → Sheets (durable backup, async)
- Config changes: browser → DO (broadcast) → Sheets (async)
- Fallback: if WebSocket disconnects, fall back to 5-second polling until reconnect
- Tech PWA (Phase 7): privacy-filtered Worker endpoint so techs see only their own assignments, not full customer data

---

## Phase 4 — Workers KV for Fast Config Reads

**Goal:** Cold-start Google Apps Script reads take 2–8 seconds. Move config reads to Cloudflare Workers KV for sub-10 ms response times.

**Why:** The slowest part of app startup is waiting for Apps Script to wake up and return config. KV is always warm.

### Changes needed

- KV namespace bound to the Worker
- On every `pushConfigToSheets()`, Worker also writes config to KV (fire-and-forget)
- `loadConfigFromSheets()` reads from KV first; falls back to Apps Script on KV miss
- Apps Script remains the durable source of truth; KV is a fast read cache

---

## Phase 5 — Cron Jobs + Twilio SMS + Gmail API

**Goal:** Automate end-of-day archiving (fixing Phase 0 Bug 1 at the infrastructure level), appointment reminders, and daily summary emails.

### Components

**Cloudflare Workers Cron Trigger**
- Fires at 4:05 AM daily
- Calls Apps Script to archive the day's queue and turns to history sheets
- Eliminates the fragile browser `setTimeout` entirely (permanent fix for Phase 0 Bug 1)

**Twilio SMS**
- Appointment reminder: text fires X hours before the scheduled appointment time
- Optional: "your tech is ready" notification when customer reaches the front of the queue
- Requires Twilio `account_sid`, `auth_token`, and a Twilio phone number

**Gmail API**
- Daily summary email to manager: total customers, revenue, tech breakdown
- Sent via Google Apps Script's `GmailApp.sendEmail()` — no extra credentials needed beyond the existing Apps Script deployment

---

## Phase 6 — Square POS Deep Link Integration

**Goal:** Tighter integration with Square so completed transactions can open directly in Square POS for payment, and the Square catalog stays in sync with `SERVICES` and `ITEMS`.

**Current state:** Square sync already pulls catalog items and staff from Square. `squareConfig` holds `locationId`. A proxy exists at `SQUARE_PROXY`.

### Changes needed

- Square Developer Portal: create an app, get `client_id`
- Deep link format: `squareup://pos/take-payment?…` (Square SDK URL scheme)
- On "Mark Done": offer an "Open in Square" button that pre-fills amount and line items
- Catalog sync: push `SERVICES` and `ITEMS` changes back to Square catalog (currently one-way pull only)
- **Fees stay app-only** — fees are not sent to Square. They are tracked in the dashboard's records only, not as Square catalog items.

---

## Phase 7 — PWA Polish

**Goal:** Make the app installable as a proper PWA on iPad and iPhone home screens, with offline support and a native app feel.

### Changes needed

- `manifest.json`: app name, icons (multiple sizes), `display: standalone`, theme color
- Service worker: cache `index.html`, `version.json`, and all `js/` and `css/` files for offline load
- Install prompt: detect `beforeinstallprompt` event, show a subtle "Add to Home Screen" banner
- iOS meta tags: `apple-mobile-web-app-capable`, `apple-touch-icon`
- Splash screens for iPad and iPhone launch
- Tech PWA endpoint (see Phase 3): privacy-filtered view showing only assigned customers

---

## Infrastructure Direction Summary

The long-term stack evolution:

```
Current (v1.56)
  GitHub Pages → Cloudflare Worker (proxy + R2) → Apps Script → Sheets
  (config/settings in JS memory; photos/reports in R2; Sheets is source of truth for config)

After Phase 1 ✅
  Same infra — localStorage eliminated as config store

After Phase 2 ✅
  + Cloudflare R2 (photo/report storage; URLs synced via config blob)

After Phase 3
  + Cloudflare Durable Objects (real-time WebSocket hub, replaces polling)

After Phase 4
  + Cloudflare Workers KV (fast config read cache)

After Phase 5
  + Cloudflare Cron Triggers (midnight archival)
  + Twilio (SMS reminders)

After Phase 6
  + Square API two-way sync

After Phase 7
  + Service Worker (offline support, PWA install)
```

Apps Script and Sheets remain the durable source of truth throughout all phases. Cloudflare infrastructure layers on top as a faster, push-capable edge tier. The app relaunches with a clean Sheets state — no historical data is imported.
