# Muse Dashboard — Roadmap

All planned phases (Split through Phase 7) are complete. The app is live and operational. This document preserves the build history and defines the post-launch development direction.

> ⭐ **Active work (2026-06): a system-wide code audit.** Production is **v4.15** (audit fixes v4.11–v4.15 shipped, incl. the `config.set` + `giftcard.save` stale-write guards, deployed to the Worker). The full audit record — every finding, what's fixed, what's deferred, and the decisions — is in **`AUDIT-2026-06.md`**; the live backlog (incl. the P0 "Paid" status policy) is in **`PRIORITIES.md`**.

---

## ⭐ TurnDesk — public SaaS productization (SEPARATE product, planned 2026-05-28)

This `musedashboard` repo stays the **stable single-salon app**. A separate public product — **TurnDesk** — is being forked from this codebase into its **own repo / Worker / Cloudflare account**. It is **built in its own repo & chat — not here.** The kickoff prompt to start it lives at repo root: **`TURNDESK-KICKOFF.md`**.

**Locked decisions:**
- **Name:** TurnDesk (working name). **Repo:** fresh clean GitHub repo (copy of this code, no history); base path rebased `/musedashboard/` → `/turndesk/` (sw.js precache, manifests).
- **Cloudflare:** **separate account under the same email login**; new Worker + **per-tenant Durable Object** + new R2/KV/secrets + own `workers.dev` URL. Salon app untouched and fully isolated.
- **Tenancy:** **multi-tenant, one Durable Object per salon** ("Option 3" — Cloudflare-idiomatic; one codebase/deploy, per-tenant data isolation, auto-provisioning; scales to thousands). Built in stages. Evolution of today's single `MuseSalonDO`, not a rewrite.
- **Payments:** **processor adapter layer from day one** — common interface implemented by `SquareAdapter` / `StripeAdapter` / `HelcimAdapter`; active processor chosen per-tenant. Migrate Square → adapter; build **Helcim first**; stub Stripe. (Helcim = interchange-plus rates + server-driven Smart Terminal / Payment Hardware API; see the kickoff doc for the integration facts.)

**Build sequence:** P0 fork+isolate+blank twin → P1 adapter + Helcim → P2 choose-your-processor → P3 multi-tenancy + accounts/auth → P4 Stripe billing + onboarding → P5 public polish (a11y, marketing, DR/SLA). Productization gaps, pricing, legal (gift-card law, PCI) detailed in the "Commercialization & SaaS Productization" section below.

---

## Phase Status

| Phase | Title | Status |
|---|---|---|
| Split | Extract single file → modules | ✅ Complete (v1.54) |
| 1 | localStorage Cleanup | ✅ Complete (v1.55) |
| 2 | Cloudflare R2 for Photos | ✅ Complete (v1.56) |
| 3 | Durable Objects WebSocket Sync | ✅ Complete (v1.57) |
| 4 | Workers KV for Fast Config Reads | ✅ Complete (v1.58) |
| 5 | Cron + Gmail Daily Archive | ✅ Complete (v1.59) |
| 6 | Square POS Deep Link + Catalog Push | ✅ Complete (v1.60) |
| 6b | Square Audit Fixes + Bookings Push | ✅ Complete (v1.61) |
| 7 | PWA Polish | ✅ Complete (v1.67) |

---

## Phase 0 — Known Bugs (Pre-Refactor)

Three bugs documented before the split. All resolved.

### Bug 1 — Turns history missing
`archiveTurnsForToday()` only fired inside a browser `setTimeout`. If the browser closed before 4 AM, the archive never happened.

**Status:** ✅ Fixed in Phase 5 — Cloudflare Cron fires at 4:05 AM PT regardless of browser state.

### Bug 2 — Turns order flash on save
Saving turns order wrote to localStorage, then triggered a config push. The 5-second queue poll briefly restored the old order before the push completed.

**Status:** ✅ Fixed in Phase 1 — localStorage is no longer the intermediary for config data.

### Bug 3 — `allRecords` never pruned
`muse_records` grew indefinitely toward the 5 MB localStorage limit.

**Status:** ✅ Fixed — records now live server-side in Sheets; localStorage holds only a local working copy with 90-day rolling window.

---

## Phase 1 — localStorage Cleanup ✅ Complete (v1.55)

**Goal:** Stop using localStorage as a data store for config and settings. All mutable app state loads from Google Sheets on startup and lives in JS memory for the session. Only the permanent durable keys (queue, records, device ID, calendar prefs) remain in localStorage.

### Variables moved to in-memory

| Variable | Removed localStorage key |
|---|---|
| `STAFF` | `muse_staff` |
| `SERVICES` | `muse_services` |
| `ITEMS` | `muse_items` |
| `FEES` | `muse_fees` |
| `FRONT_DESK_USERS` | `muse_fd_users` |
| `inactiveStaff` | `muse_inactive_staff` |
| `hiddenCheckinServices` | `muse_hidden_services` |
| `hiddenDashServices` | `muse_hidden_dash_services` |
| `giftCards` | `muse_gift_cards` |
| `scheduleData` | `muse_schedule` |
| `turnsTechOrder` | `muse_turns_order` |
| `turnsBreakStaff` | `muse_turns_break` |
| `turnsOffStaff` | `muse_turns_off` |
| `_turnConfig` | `muse_turn_config` |
| `_bonusServices` | `muse_bonus_services` |
| `_logoData` | `muse_logo` |
| `_photoCache` | `muse_photo_staff_{id}` / `muse_photo_fduser_{id}` |

**Exception:** `squareConfig` reads from `muse_sq_config` (permanent key — stays in localStorage).

---

## Phase 2 — Cloudflare R2 for Photos ✅ Complete (v1.56)

**Goal:** Move base64 staff photos and logo out of the Google Sheets config blob into Cloudflare R2 object storage.

**Why:** Photos bloated the config sync payload significantly. R2 gives proper binary storage with CDN URLs.

### What changed

- `cloudflare/worker.js` — new file: `/photos/{key}` R2 routes (PUT/GET/DELETE)
- `cloudflare/wrangler.toml` — new file: R2 bucket binding and secrets template
- `js/photos.js` — complete rewrite: `_uploadToR2` / `_deleteFromR2` helpers; photos stored as R2 objects, URLs synced via config blob
- `js/sync.js` — `pushConfigToSheets()` now includes `muse_photos` (URL dict, not base64)

---

## Phase 3 — Durable Objects WebSocket Sync ✅ Complete (v1.57)

**Goal:** Replace the 5s/15s polling model with push-based real-time sync. All connected devices see queue and config changes instantly.

### What changed

- `cloudflare/worker.js` — `MuseSalonDO` Durable Object class: stateless WebSocket broadcast hub; one instance per salon keyed by `idFromName('muse')`
- `/ws` route in worker proxies WebSocket upgrades to the DO
- `js/sync.js` — `connectWebSocket()` opens persistent WebSocket to the DO; queue/config writes broadcast to all peers instantly; automatic reconnect with exponential backoff; polling continues as fallback during disconnects

---

## Phase 4 — Workers KV for Fast Config Reads ✅ Complete (v1.58)

**Goal:** Eliminate the 2–8 second cold-start delay on Apps Script config reads.

### What changed

- `cloudflare/wrangler.toml` — `CONFIG_KV` KV namespace binding
- `cloudflare/worker.js` — KV fast path on `loadConfig` GET; KV write-through on `saveConfig` POST; Apps Script remains the durable source of truth

---

## Phase 5 — Cron + Gmail Daily Archive ✅ Complete (v1.59)

**Goal:** Automate end-of-day archiving at the infrastructure level, eliminating the fragile browser `setTimeout`.

### What changed

- `cloudflare/wrangler.toml` — `[triggers] crons = ["5 11 * * *"]` (11:05 AM UTC = 4:05 AM PDT)
- `cloudflare/worker.js` — `_runMidnightArchive(env)` and `scheduled()` handler
- `muse-sheets-script.gs` — `archiveDay`, `getDayStats`, `sendDailySummary`; Gmail daily summary sent via `GmailApp.sendEmail()`

---

## Phase 6 — Square POS Deep Link + Catalog Push ✅ Complete (v1.60)

**Goal:** Tighter Square integration — payment handoff from the dashboard to Square POS, and bidirectional catalog sync.

### What changed

- `js/square-pos.js` — `openSquarePOS()`, `pushOrderToSquare()`, `squarePushBooking()`
- `js/square-catalog.js` — `squarePullServices()`, `squarePushService()`, `squarePushItem()`
- `js/square-customers.js` — `loadSquareCustomers()`, `squarePullStaff()`, `squareUpsertCustomer()`
- `js/queue.js` — "Pay in Square POS" button on done queue cards
- `js/catalog.js` — auto-push to Square catalog on `saveService()`

---

## Phase 6b — Square Audit Fixes + Bookings Push ✅ Complete (v1.61)

Six bugs in the Square integration fixed during audit. Square Bookings push added so calendar appointments trigger Square's native SMS reminders.

---

## Phase 7 — PWA Polish ✅ Complete (v1.67)

**Goal:** Make the app installable as a proper PWA on iPad, iPhone, and desktop with offline support and a native app feel.

### What changed

- `manifest.json` — app name, icons, `display: standalone`, theme color, `start_url`
- `sw.js` — service worker: precache all static assets on install, cache-first for JS/CSS, network-first for HTML and `version.json`, offline fallback
- `icons/icon-192.png` + `icons/icon-512.png` — PWA launcher icons (placeholder; replace with final salon logo)
- `index.html` — `apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color` meta tags; `<link rel="manifest">`; SW registration in `app.js`
- `js/giftcards.js` — `confirmClearAllRecords()` for pre-launch test data cleanup
- `js/reports.js` — refund records excluded from guest count; Refunds Issued tile added to summary

---

## Current Infrastructure (Post-All-Phases)

```
Browser (PWA — offline-capable, home-screen installable)
  ↕ WebSocket (real-time, instant push)
  Cloudflare Durable Object (MuseSalonDO — stateless broadcast hub)
  ↕ fetch
  Cloudflare Worker
    ├── /sheets → Workers KV (fast) → Apps Script → Google Sheets (source of truth)
    ├── /square → Square API (catalog, customers, appointments, POS)
    └── /photos → Cloudflare R2 (photos, logos)
  Cloudflare Cron → Apps Script (4:05 AM PT daily archive + Gmail summary)
```

---

## Next Development Baseline: v2.00

The v2.xx cycle begins when the first post-launch improvement is ready for deployment. The baseline is clean — no rebuild debt, no migration work. All future improvements should be:

- **Additive** — new fields, new features, extending existing systems
- **Safe** — no destructive migrations, no data resets without explicit approval
- **Incremental** — small, verifiable changes rather than large rewrites
- **Reversible** — rollback should be possible for any change

---

## Post-Launch Optimization Roadmap

### Priority 1 — Desktop Workflow Perfection

The desktop front-desk experience is the primary operational surface. Optimize here first.

- Improve queue action speed: reduce clicks for common operations (assign tech, mark done, collect payment)
- Improve keyboard workflows: tab order, keyboard shortcuts for frequent actions
- Improve multi-window usability for two-monitor setups
- Improve reporting workflow: faster date navigation, better export options
- Improve print layouts for daily summaries and queue snapshots
- Improve error messaging for all failure states
- Operational perfection before visual polish

### Priority 2 — UI/UX + Visual Polish

- Improve visual consistency across all panels and modals
- Improve spacing, typographic hierarchy, and information density
- Improve animations and transitions (subtle, purposeful, non-blocking)
- Improve branding alignment once final logo is in place
- Improve dark/light mode handling and contrast ratios
- Improve responsive scaling on non-standard display sizes

### Priority 3 — iPad/Android Tablet Optimization

- Optimize touch targets and gesture behavior for all interactive elements
- Improve kiosk mode on customer-facing check-in tablets
- Improve portrait/landscape layout adaptation
- Improve performance on lower-end tablet hardware
- Preserve full desktop functionality while adapting layouts for touch

---

## Remaining Technical Debt

These are known architectural limitations that are stable enough to leave in place for now, but should be addressed before scaling significantly.

### Global State Coupling
All 18 JS files share one global scope. Variables like `SERVICES`, `STAFF`, `queue`, and `allRecords` are read and mutated across files with no encapsulation. Any rename or restructure requires tracing all usages manually.

**Risk:** Low for current scale. Medium if the file count grows beyond ~25.
**Recommendation:** Leave as-is. The single-scope model is a deliberate architectural constraint, not an accident.

### Implicit Load-Order Dependencies
None in the current ES-module code — modules `import` what they need, so load order is resolved by the module graph. (Historical note: this previously claimed `config.js` calls `dedupByLabel` at parse time; that coupling does not exist.)

**Risk:** Low — only one parse-time dependency currently exists.
**Recommendation:** Document carefully; never add new parse-time cross-file calls without updating CLAUDE.md.

### Polling Fallback Still Active
The WebSocket Durable Object provides real-time push, but the 5s/15s Sheets polling loop continues to run as a fallback. During a WebSocket reconnect cycle, a poll could arrive and overwrite a mid-flight change.

**Risk:** Low frequency; `_configWriteTime` lock reduces the window.
**Recommendation:** Add poll suppression when a WebSocket write is in flight; consider disabling config polling entirely when WebSocket is stable.

### `allRecords` Full-Array Sync
The entire records array is fetched and written to Sheets on every sync. As records accumulate over months, this payload grows. No pagination exists.

**Risk:** Manageable for 1–2 years. Will become a bottleneck beyond ~50k records.
**Recommendation:** Add a cursor-based incremental sync when the payload approaches 200 KB; consider archiving records older than 90 days to a separate Sheets tab.

### No Concurrent Write Protection on Records
If two devices submit a transaction within the same Sheets write window, the second write overwrites the first. `muse_deletion_log` prevents ghost records but does not prevent concurrent create collisions.

**Risk:** Low at current transaction volume. Worth monitoring.
**Recommendation:** Add a write lock or merge strategy in `pushRecordsToSheets()`.

### Square Token Rotation is Manual
The Square API token is stored as a Cloudflare Worker secret. If it needs to be rotated, it requires a manual `wrangler secret put` + `wrangler deploy` cycle.

**Risk:** Operational inconvenience; no security risk if token is kept private.
**Recommendation:** Add a rotation reminder to the annual ops checklist.

### FEES Are Dashboard-Only
The `FEES` array is not synced to Square. Fee revenue tracked in reports will not appear in Square's sales reports, requiring manual reconciliation.

**Risk:** Accounting discrepancy if fees are material.
**Recommendation:** Document clearly in settings; evaluate pushing fees to Square as line items on orders in a future cycle.

### Durable Object Has No Persistent State
The `MuseSalonDO` WebSocket hub is stateless — it holds no queue or config data in memory. If the DO restarts, the next Sheets poll refreshes all clients, but there is a brief window where clients have divergent state.

**Risk:** Very low frequency; only affects the ~5 seconds between DO restart and next poll.
**Recommendation:** Leave as-is. The DO was intentionally designed stateless; Sheets is the source of truth.

> **Note (2026-05-26):** Sections above this line describe the *pre-v3* architecture (Sheets as source of truth, single global scope, polling). As of the v3 rewrite the app is **ES modules + a stateful Durable Object source of truth**; this historical roadmap has not been rewritten. See memory `[[v3-cycle-state]]` for the current architecture.

---

## Commercialization & SaaS Productization (Lens 2 — strategic plan, 2026-05-26)

Forward-looking plan for turning the app from "our shop's tool" into a paid monthly product. Captured from the Lens-2 strategy review. (Mirrored in memory `[[business-productization-plan]]`.)

### Readiness
- **~55–65%** to a sellable **single-tenant** product; **~30–40%** to true **multi-tenant SaaS**. The application is mature and battle-tested; the gap is the productization shell around it (accounts, billing, tenancy, legal).

### The decision that forks the roadmap
**Sell multi-tenant SaaS to many salons, or license single-tenant instances to a few?**
- **Multi-tenant SaaS** — one codebase, many salons, self-serve signup, we operate it. Bigger market, more new build. **Recommended.**
- **Single-tenant licenses** — clone-per-customer, we set each up. Lower lift, doesn't scale past ~dozens.
- **Architectural tailwind:** the Cloudflare Durable Object model is naturally multi-tenant — one DO instance per salon (keyed by tenant id) gives built-in data isolation, the hardest part of most SaaS. We are closer than a typical solo app.

### Engineering gaps to commercial-ready (priority order)
1. **Real auth + accounts** — biggest gap (PIN-only today, origin-gate OFF). Email/OAuth login, tenant membership, roles, session tokens. *HIGH*
2. **Multi-tenancy + provisioning** — signup spins up a salon's DO + config; zero cross-tenant leakage. *HIGH (DO helps)*
3. **Subscription billing** — Stripe: plans, trials, dunning, lock-on-decline. *MED*
4. **Onboarding / admin console** — self-serve setup of staff/services/hours; an operator-side tenant admin. *MED*
5. **Backups / DR + SLA** — per-tenant export + point-in-time restore + status page. *MED*
6. **Observability + support** — error tracking, audit logs, a support channel. *MED*
7. **Accessibility (WCAG/ADA)** — touch-first and largely keyboard-free; needs an audit (commercial software draws ADA demand letters). *MED*

### Legal (engage counsel to paper these — not legal advice)
- **PCI: strong posture** — card data never touches the app (Square takes the charge), keeping us at the lightest PCI scope. Document it (compliance + sales point). Holds under Square Path B / Terminal API.
- **⚠️ Gift-card law = the real exposure** — federal CARD Act (≥5-yr expiration floor, dormancy-fee limits) + state unclaimed-property/escheatment rules + small-balance cash-out (e.g. CA <$10). Our model tracks issue date + redemptions and does **not** force expiry — good foundation. **Do not add auto-expiry;** add a balance/liability report. The compliance duty is the salon's, but the app must not make them non-compliant.
- **Data privacy** — we store PII (names/phones/visit history) and staff wage/commission data. Need Terms of Service, Privacy Policy, and a Data Processing Agreement (we = processor, salon = controller). CCPA/CPRA at CA thresholds; GDPR only with EU customers. Add retention + delete-on-request (extend the existing deletion log).
- **Square Developer Agreement** — reselling an app built on Square APIs is allowed but governed; review before launch (possible app registration).
- **Corporate** — LLC, E&O / cyber-liability insurance, SaaS sales-tax (taxable in some states).

### Market fit & positioning
- **Buyer:** independent and small-chain **nail salons & spas** — underserved by heavyweight Mindbody/Zenoti and frustrated by generic Square (no turn rotation, clumsy parties).
- **Wedge / moat:** the **turns/rotation engine** + walk-in/party flow + derived totals. Win the walk-in/rotation segment the big players ignore; do not try to out-feature Boulevard on CRM.
- **Price anchors (per month):** Square Appointments $0–69/seat · Fresha free + commission · Vagaro ~$24–85 · GlossGenius ~$24–148 · Boulevard ~$175+ · Mangomint ~$165+ · Mindbody $$$.

### Pricing model (recommended)
Payments are offloaded to Square, so there is **no processing margin** — the product must be **subscription-only**, priced **per location** (not per seat; per-seat punishes the multi-tech rotation feature that is the core value).

| Tier | ~Price / location / mo | Includes |
|---|---|---|
| Starter | $39–49 | queue, turns, check-in, basic reports |
| Pro | $79–99 | + gift cards, payroll/commission, customer history, Square POS |
| Multi-location | $149+ / custom | chains, cross-location reporting |

Annual ≈ 2 months free. 14–30 day free trial. Lands below Boulevard/Mangomint, above bare Square.

### Staged go-to-market
1. **Validate (now)** — 2–3 pilot salons on managed single-tenant instances; charge a small real fee to prove willingness to pay before building SaaS plumbing.
2. **Productize** — auth → multi-tenancy/provisioning → Stripe billing → onboarding.
3. **Paper it** — ToS / Privacy / DPA + gift-card and PCI documentation before public signups.
4. **Launch niche-first** — nail-salon-focused; lead with turns + walk-in flow.
