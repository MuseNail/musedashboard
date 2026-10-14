# Plan v2 — Fix stale board on phone wake (missed assignments)

Date: 2026-10-13 · Repo: musedashboard (carries to turndesk) · Area: `js/app/sync.js` (high-risk sync layer)
Status: revised after 4-lens adversarial review (wf_6bf7ef28-fc6). v1's `_lastRecv`-bump
approach was a confirmed regression and has been removed — see "What changed from v1".

## Goal (plain English)
A tech leaves the staff app open on their phone. The phone sleeps / the app is
backgrounded. A new customer is assigned at the front desk. When the tech picks
the phone back up, the board still shows the **old** state and never catches up —
only a manual refresh fixes it, so techs miss customers. We want the board to
catch up on its own within a second or two of the tech looking at it again, and
the live connection to actually come back (not quietly fall back to slow polling).

## Goal (technical)
Make the sync layer recover real-time delivery after an iOS background/freeze
cycle without a manual reload, by (a) handling the thaw events the app ignores
today, (b) adding a visible-only freshness watchdog + touch wake-trigger, and
(c) fixing `resync()` so it rebuilds a socket that is **silently dead but still
reports `OPEN`** — the actual iOS failure state — instead of trusting `readyState`.

## Root cause (confirmed from code + owner's observations)
Two compounding gaps:
1. **No thaw handler.** Recovery (`resync()`) is wired only to `focus`,
   `visibilitychange`, and `online` ([sync.js:131-132](../../../js/app/sync.js)).
   The app listens for the freeze (`pagehide` → `flushCache`) but has no handler
   for the restore. On iOS, returning to a backgrounded app restores it from the
   back/forward cache (fires `pageshow`) or thaws it in place (fires the Page
   Lifecycle `resume`); in both cases `focus`/`visibilitychange` frequently do
   **not** fire, so `resync()` is never called.
2. **`resync()` trusts a zombie socket.** Even when `resync()` *is* called, it
   only rebuilds the socket when `readyState !== OPEN` ([sync.js:144](../../../js/app/sync.js)).
   After an iOS sleep the socket commonly stays reported `OPEN` but is dead
   ("zombie-OPEN" — this is the existing 40s heartbeat's own stated rationale at
   [sync.js:178-185](../../../js/app/sync.js)). So in the dominant case `resync()`
   does nothing but a one-shot HTTP snapshot and the live socket is never rebuilt.

Owner-confirmed symptom ("stays wrong until manual refresh", mix of home-screen
PWA + Safari tab) is consistent with the zombie-OPEN path, which neither the
existing wake listeners nor `resync()` recover from.

## What changed from v1 (why)
- **REMOVED v1 "Change 4" (bump `_lastRecv` on every HTTP snapshot).** All four
  reviewers independently showed it starves the 40s heartbeat: `_lastRecv` is the
  heartbeat's *only* liveness input; bumping it on each ~30s watchdog snapshot
  keeps `now - _lastRecv` under the 40s cutoff forever, so a zombie socket is
  never recycled and the app degrades to a permanent HTTP poll. `_lastRecv` stays
  **WS-liveness only** (bumped solely by `ws.onmessage`/`ws.onopen`, as today).
- **Fix moved into `resync()` itself:** a wake-time resync now force-closes an
  `OPEN`-but-silent socket and reconnects, which *heals* real-time instead of
  masking it with polling. This also removes the need for the `_lastRecv` bump.

## Approach (all in `sync.js`; no Worker change; additive + reversible)
One shared staleness threshold `STALE_MS = 30000` (comfortably above the 20s ping
cadence → a healthy socket, pinged every 20s with each pong bumping `_lastRecv`,
is never >~20s silent, so 30s won't false-trip; and it sits under the 40s heartbeat
backstop). Two pure, exported, unit-tested decision functions:

```js
// Reconnect the WS? A socket silent past STALE_MS is dead even if it says OPEN
// (iOS zombie-OPEN). No socket / non-OPEN also reconnects (matches today).
function _shouldReconnect(now, lastRecv, isOpen) {
  return !isOpen || (now - lastRecv > STALE_MS);
}
// Run a wake resync now? Only while visible, signed-in, and actually stale.
function _shouldResync(now, lastRecv, visible, authNeeded) {
  return visible && !authNeeded && lastRecv > 0 && (now - lastRecv > STALE_MS);
}
```

### Change 1 — `resync()` heals a zombie-OPEN socket (the core correctness fix)
Replace `resync()`'s `if (!_ws || readyState !== OPEN)` teardown test with
`_shouldReconnect(now, _lastRecv, isOpenSocket)`. Now a wake resync tears down and
reconnects a socket that's been silent > `STALE_MS` even if it reports `OPEN`. The
new socket's `onopen` bumps `_lastRecv` fresh, so follow-up resyncs see a healthy
socket and don't churn. `httpSnapshot()` still runs for instant board catch-up
while the WS re-establishes. (`_lastRecv` is NOT bumped by the snapshot.)

### Change 2 — handle the thaw events (instant recovery on wake)
Add, alongside the existing `pagehide`→`flushCache`:
- `window.addEventListener('pageshow', e => { if (e.persisted) resync(); })`
  — bfcache restore only; `e.persisted` gate avoids tearing down the CONNECTING
  boot socket on a normal cold load.
- `document.addEventListener('resume', resync)` — Page Lifecycle freeze-in-place
  thaw, the path `pageshow` misses (notably on standalone PWAs).
Both funnel through the throttled `resync()`, so firing together with the existing
`focus`/`visibilitychange` is collapsed by the 1500ms `_resyncTimer`.

### Change 3 — visible-only freshness watchdog (the real workhorse)
One app-lifetime `setInterval` (5s) that no-ops while hidden and, when visible,
calls `resync()` if `_shouldResync(...)` is true. Because timers freeze while
backgrounded, it runs only while the tech is looking, and catches every case where
no wake event fired at all — recovering within ~5s. Gated on `!authNeeded` so an
expired/revoked-session phone (§13) doesn't become a 5s 401 loop.

### Change 4 — touch wake-trigger (near-instant on tap; owner-requested)
`window.addEventListener('touchstart', () => { if (_shouldResync(...)) resync(); }, { passive: true })`.
Same decision function, so it only acts when genuinely stale; `resync()`'s own
1500ms throttle covers rapid touches — no separate throttle needed. `passive:true`
so it can't regress scroll/drag on the checkout UI. Runs in all three apps (via
`start()`); harmless on the iPad (cheap, self-gated) and helps it recover after
sleep too.

### Change 5 — in-flight guard on `httpSnapshot()`
A `_snapshotInFlight` flag: skip a new snapshot fetch while one is still pending.
Prevents two overlapping snapshots from racing on `hydrate()` (whole-state replace)
on slow mobile networks. (Outbox is unaffected — `reapplyOutbox`/`replayOutbox`
run after each hydrate and only ack on server confirmation; reviewers confirmed no
outbox-clobber risk.)

### Supporting — local `_authNeeded` mirror
Track `let _authNeeded = false;` set in `notifyUnauthorized()` and cleared wherever
`setAuthNeeded(false)` already runs (`ws.onopen`, a 200 `httpSnapshot`) so
`_shouldResync` can read it without new store plumbing.

## What we deliberately DON'T change
- The 20s ping / 40s zombie heartbeat — stays as the backstop; now genuinely
  untouched (v1's `_lastRecv` bump is gone).
- The outbox / mutation path — not touched.
- The Worker / DO — no server change.
- `touchstart` is NOT cut (one reviewer suggested it as YAGNI; owner explicitly
  asked for it — kept, hardened).

## Files touched
- `js/app/sync.js` — the two pure fns (exported `_shouldReconnect`, `_shouldResync`),
  `resync()` teardown test, the thaw/`resume`/`touchstart` listeners + 5s watchdog
  interval, the `_snapshotInFlight` guard, the `_authNeeded` mirror. New block gets
  a `// ── … ──` section marker per CLAUDE.md.
- `test/wake-resync.test.js` (new) — `import './setup-globals.js'` FIRST (importing
  sync.js evaluates module side effects: `loadOutbox()`/`DEVICE_ID` read
  localStorage, apptoken.js installs a fetch wrapper — the shims are required).
  Covers both pure fns.

## Test plan
- **Unit** (`node --test-force-exit --test test/wake-resync.test.js`):
  - `_shouldReconnect`: no socket → true; non-OPEN → true; OPEN & fresh → false;
    OPEN & silent > `STALE_MS` → true (the zombie-heal case); boundary at exactly
    `STALE_MS`. Encodes "an HTTP snapshot must NOT reset WS-liveness" by construction
    (the fn never sees snapshots; `_lastRecv` is WS-only).
  - `_shouldResync`: hidden → false; `authNeeded` → false; `lastRecv==0` → false;
    fresh → false; visible + signed-in + stale → true; boundary.
- **Full suite** stays green (31 files, per-file on Windows).
- **Manual (required before "fixed"), on a real iPhone — both home-screen PWA and
  Safari tab:** open staff app → background it / let the screen sleep for a few
  minutes → assign a customer at the front desk → return to the app → confirm the
  board catches up with no manual refresh, AND that a subsequent assignment arrives
  live (proving the WS healed, not just one HTTP catch-up). Repeat triggering via a
  tap (touchstart path).

## Rollback
Purely additive / self-contained in `sync.js`. Revert the commit. No persisted-data
or schema change — nothing to migrate back.

## TurnDesk carryover
`turndesk/js/app/sync.js` is structurally identical (same `pagehide`-present /
`pageshow`-absent lines, same `resync`/heartbeat shape). Port all five changes
near-verbatim after Muse ships + real-device-verifies; log in
`turndesk/docs/MUSE-PORT-LOG.md`. No TD Worker change. Because the design heals the
WS (no steady-state polling), the extra fleet load the reviewers worried about is
transient, not sustained — safe for TD's many-salon fleet.

## Resolved review questions
- Clock skew: non-issue — `now` and `_lastRecv` are both local `Date.now()`.
- Double-resync on one wake: non-issue — the 1500ms `_resyncTimer` collapses bursts.
- Re-render after a silent resync: works — `hydrate()`→`notify()` is synchronous and
  staff.js subscribes/re-renders ([staff.js](../../../js/app/staff.js)).
- "Never false-fires" claim dropped: an occasional benign extra snapshot (dropped
  pong / GC pause pushing a healthy gap toward 30s) is acceptable and harmless.
