# Muse Nails & Spa — Dashboard

Salon management PWA for Muse Nails & Spa. Manages a live customer queue, technician turn rotation, check-in kiosk, floor plan, appointments, transactions, payroll, gift cards, customers, staff, and settings. Hosted on GitHub Pages with a Cloudflare Worker + **Durable Object** as the durable, real-time-synced data store.

**Live URL:** https://musenail.github.io/musedashboard
**Status:** Production — operational. **Helcim is the live card processor** (Smart Terminal, webhook-driven; Square remains selectable until retired). The app is the source of truth for the customer directory and the service/item/fees catalog. Appointments are Google-Calendar-backed (server-side OAuth in the Worker). Current version: see `version.json`.

Pipeline/backlog: **`PRIORITIES.md`** · Helcim migration record + API findings: **`HELCIM-MIGRATION.md`** · 2026-06 audit record: **`AUDIT-2026-06.md`** · history: **`ROADMAP.md`** · parked ideas: **`IDEABOARD.md`**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static, auto-deploy on push to `main`) |
| Edge / backend | Cloudflare Worker (`musedashboard.musenailandspa.workers.dev`) |
| Data store + sync | Cloudflare Durable Object (`MuseSalonDO`) — source of truth, WebSocket broadcast |
| Photo storage | Cloudflare R2 (staff photos, logo) + periodic R2 state-snapshot backups |
| Card payments | **Helcim Smart Terminal API** (webhook-driven) · Square Terminal (legacy, selectable) |
| Appointments | Google Calendar (Worker-held refresh token, `/gcal/*`) |
| SMS | httpSMS gateway via Worker `/sms/*` (currently blocked on the phone) |
| Frontend | Vanilla JS (native ES modules, ES2020+), Tailwind CSS (CDN) |
| Build tooling | None — no npm, no bundler, no transpiler |

---

## Architecture

```
Browser PWA (index.html → js/app/main.js · staff.html → js/app/staff.js)
  ↕ WebSocket (real-time sync) + HTTP /state fallback
Cloudflare Durable Object (MuseSalonDO — source of truth: queue, records,
  config, customers, gift cards; per-key storage + stale-write guards)
Cloudflare Worker routes:
  /state    → DO snapshot/mutate (sync layer)
  /helcim/* → Helcim API proxy (purchase, result, transactions, customer)
  /terminal/webhook → Helcim result webhook (HMAC-verified) → DO finalize
  /square/* → Square API proxy (legacy, until retired)
  /gcal/*   → Google Calendar OAuth (Worker holds the refresh token)
  /photos   → R2 binary storage
  /sms/*    → httpSMS gateway
```

- **Write path:** every mutation goes through `dispatch(op, payload)` (`js/app/sync.js`) → optimistic local apply → offline outbox → DO over WebSocket. The DO broadcasts to all devices; per-key/per-record stale-write guards resolve conflicts.
- **Client mirror:** `localStorage muse_state_cache` restores state instantly on reload; `muse_outbox` replays queued writes on reconnect.
- **Module layout:** core in `js/app/` (`main.js`, `store.js`, `sync.js`, `session.js`, `config.js`, `utils.js`), features in `js/app/features/*.js`. Inline `onclick=` markup works because `main.js` attaches feature exports to `window`.

See `CLAUDE.md` for the full module map, write-path rules, and high-risk systems.

---

## Deployment

1. Edit client files → bump the **version trio together**: `js/app/config.js` (`APP_VERSION`) + `version.json` + `sw.js` (`CACHE_NAME`).
2. Commit and push to `main` → GitHub Pages deploys (< 60s).
3. Devices show a `↻` badge on next load/focus; tapping it clears the SW cache and reloads. A one-time **What's New** popup summarizes the update.
4. **Worker changes** deploy separately: `cd cloudflare && wrangler deploy` (owner-run).

---

## Production Data Integrity

The app is in active operational use:

- **Never remove or rename** DO keys, localStorage keys, or R2 objects without a migration plan.
- **Never auto-reset** live data.
- All changes must preserve customer records, queue state, transactions, appointments, staff, settings, gift cards, photos, and audit history.
- Favor additive changes; verify against the live app one change at a time.
