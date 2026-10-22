# Plan — Check in from the Floor Plan (Wave 2 #3) — v2 (post-adversarial-review)

Date: 2026-10-22 · Repo: musedashboard (ports to TurnDesk) · Area: floor plan / check-in · **desktop-first** · low-risk (additive hooks; no change to validation/routing logic; reuses `seatCustomer` + `showManualAdd`)

> **v2 note.** A 4-lens adversarial review (sync-safety, correctness, sequencing, completeness) found the v1
> plan **not sound**. Three real blockers + several real minors, all adopted here:
> 1. **Stale target mis-seats an unrelated later check-in** — v1's "don't clear on close, rely on the
>    still-empty/still-waiting guard" was wrong (the guard can't tell *which* check-in a target was for).
>    **Fix:** clear on *every builder open* (top of `showManualAdd`) and arm *after* opening in the chair path.
> 2. **`onMove` would ghost-drag the empty tile** on any >THRESH drift (v1's "onMove does nothing" was false).
>    **Fix:** explicit `if (mode==='checkinStation') return;` at the very top of `onMove`.
> 3. **Auto-seat never fired on the live waiver+kiosk config** (every check-in detours to the kiosk, whose
>    confirm path doesn't reach the finalize hook). **Fix:** a *second* seat hook on the kiosk-confirmed branch.
> Plus minors: empty-station detection must use the DOM (not an out-of-scope `byStation`); guard that the
> target station still exists before seating; keep the toolbar button for keyboard/discoverability; add an
> explicit TurnDesk hook-point verification step.

## Goal
Start a walk-in check-in **without leaving the Floor Plan tab**, and tie it to the room: tap an **open
chair** → the normal check-in builder opens → the walk-in is **seated at that chair** once checked in. Plus a
toolbar **"+ Check in"** button for an unseated add. It routes through the existing `showManualAdd` builder,
so the **waiver gate, duplicate-check-in guard, and appointment guard all still apply** and the operator still
picks the service(s).

## Grounded facts (verified against the code)
- **Empty-station tap is a dead no-op today** — `onDown` live branch handles only `.floor-tech` and
  `.floor-bubble`; a no-bubble press hits `if (!b) return` (`floorplan.js:503`). ← the hook point.
- An **empty** station renders no `.floor-bubble`/`data-entry-id` (only a label div) — `floorplan.js:158-160`;
  an occupied tile's label/grip sit *outside* the `h-full w-full` `.floor-bubble` (`floorplan.js:150,163`).
  So "empty" ⇔ `!st.querySelector('.floor-bubble')` at pointer time. (`byStation` is NOT in scope in `onDown`.)
- `onMove` arms a drag for **every** non-marquee mode once movement >THRESH (`floorplan.js:539`), and
  `startDrag`'s else-branch clones `pending.closest('.floor-station')` (`floorplan.js:517-530`). An unguarded
  `checkinStation` would clone the empty tile and strand it at 40% opacity.
- `seatCustomer(entryId, stationId)` (`floorplan.js:353`) re-looks-up the entry by id in `q()`, guards
  already-paid and taken-by-another, sets `entry.station` + each active assignment's `station`, dispatches
  `queue.upsert`. It sets `a.station` **without** stamping `a.updatedAt` — identical to today's drag-to-seat,
  so the §14 per-assignment merge behaves exactly as the drag path does (no new risk).
- Check-in routing (`routeManualCheckin`, `queue.js:754-762`): **direct** (`finalizeManual`), **bypass/no-kiosk**
  (`finalizeManualBypass`) → both call **`afterManualFinalize(entries)`** (`queue.js:782`, which calls
  `closeManualAdd()` mid-body at 784). **Kiosk** (`sendManualToKiosk`, `queue.js:793`) reassigns deterministic
  ids and does NOT call `afterManualFinalize`; the desk resolves on kiosk-confirm in **`onDeskHandoffState`**
  `r==='confirmed'` (`queue.js:912`), where `_deskWaiting.entries[0].id === handoffEntryId(nonce,0)` = the real
  queue row's id. **Takeover** → `finalizeManualBypass` → `afterManualFinalize`.
- `collectManualEntries` can produce a **party**; `entries[0]` is the primary (`queue.js:652-653`) and is in the
  store before `afterManualFinalize` runs (`finalize*` does `entries.forEach(upsert)` first).
- Other `showManualAdd` callers that must NOT inherit a stale chair target: Queue/Turns **"Add"** buttons
  (`index.html:351,707`) and the v5.66 **check-in-from-lookup** (`square-customers.js`). Clearing at the top of
  `showManualAdd` covers all of them in one place.

## Design — two entry points, target consumed at the two real commit chokepoints

### floorplan.js
1. `let _pendingSeatStation = null;`
2. `export function floorClearPendingSeat() { _pendingSeatStation = null; }`
3. `export function floorCheckIn() { window.showManualAdd?.(); }`  — opens unseated (showManualAdd clears the
   target at its top; no chair is armed).
4. `export function floorCheckInAt(stationId) {` — authoritative occupancy re-check: if
   `collectFloor().byStation[stationId]` is now occupied (cross-device race), `showToast('That seat just filled')`
   + `window.showManualAdd?.()` **unseated** and return. Otherwise `window.showManualAdd?.()` **then**
   `_pendingSeatStation = stationId;` (arm *after* the open, so the open's clear doesn't wipe it). `}`
5. `export function floorSeatPending(entries) {` — **consume-once**: `const station = _pendingSeatStation;
   _pendingSeatStation = null;` then bail unless `station` set, `getStations().includes(station)` (station still
   exists), `collectFloor().byStation[station]` is empty, and `entries && entries[0]` is unpaid. Then
   `seatCustomer(entries[0].id, station)` (its own taken/paid guards remain the last line of defense). Only the
   **primary** is auto-seated; party extras stay in the tray. `}`
6. **Pointer wiring** (`initFloorDrag`):
   - `onDown` live `else`: `tech → bubble(if b) → else { const st = closest(e.target,'.floor-station'); if (st && !st.querySelector('.floor-bubble')) { mode='checkinStation'; dragStation=st.dataset.station; pending=st; } else return; }`
   - `onMove`: add `if (mode === 'checkinStation') return;` at the very top (after the marquee block, before the
     generic drag-arm at `:539`) so `startDrag` is never reached and `dragging` stays false.
   - `onUp` `!wasDragging` branch: `else if (mode === 'checkinStation' && dragStation) floorCheckInAt(dragStation);`
     (A >THRESH drift that never armed a drag still releases here and opens the builder — tap-or-swipe both mean
     "check in at this chair"; acceptable and documented.)
7. `renderFloorPlan`: toggle `#floorplan-checkin-btn` `.hidden` on `floorEditMode` (live-mode only).
8. `stationHtml` empty + live: add `cursor:pointer` and `title="Tap to check in a walk-in here"` to the wrapper,
   and a subtle hover **＋** hint over the label (CSS-only).
9. Window glue: `floorCheckIn`, `floorCheckInAt`, `floorSeatPending`, `floorClearPendingSeat` are exports →
   auto-attached by main.js (verify they land on `window`).

### queue.js (three one-line, optional-chained hooks — no logic change)
- `showManualAdd` top (`:566`): `window.floorClearPendingSeat?.();` — the single clear-on-open that defuses
  every stale-target case (cancel, cross-panel, cross-entry-point).
- `afterManualFinalize` (`:782`): `window.floorSeatPending?.(entries);` as the **first line** (before
  `closeManualAdd()`), covering direct / bypass / **takeover**.
- `onDeskHandoffState` `r==='confirmed'` (`:912`): add `window.floorSeatPending?.(entries);` — covers the live
  **kiosk** path (entries[0].id is the real row id).

### index.html
- Floor toolbar, left of **Edit layout**: `<button id="floorplan-checkin-btn" onclick="floorCheckIn()"
  class="btn-secondary"><span class="material-symbols-outlined" style="font-size:16px">person_add</span> Check in</button>`

## Why the stale-target bug is gone (walkthroughs)
- **Direct:** tap A → `showManualAdd` (clears) → arm A → submit → `afterManualFinalize` → `floorSeatPending`
  consumes A, seats primary. No reopen between arm and consume → no leak.
- **Cancel:** tap A → arm A → Cancel. Target lingers but is **harmless**: the next builder open (any entry point)
  clears it at `showManualAdd`'s top *before* any finalize can consume it.
- **Cross-panel / v5.66 lookup / Queue-Add:** each calls `showManualAdd` → clears A first → finalize sees null.
- **Kiosk happy path:** tap A → arm A → submit → kiosk (builder stays in waiting view, not reopened, A stays
  armed) → customer signs → `onDeskHandoffState` confirmed → `floorSeatPending` consumes A, seats primary.
- **Kiosk + operator starts another check-in mid-wait:** that open clears A → kiosk guest lands in tray
  (graceful degrade; rare). **Takeover:** `finalizeManualBypass` → `afterManualFinalize` → seats at A (correct).
- **Single-device kiosk** (`kioskId===DEVICE_ID`, `:798`): `_deskWaiting` is not set, so the desk hooks don't
  fire — covered instead by a third hook in `checkin.js kioskHandoffConfirm` (after the `queue.upsert`), which
  seats at the armed chair. On a SEPARATE kiosk device that hook is a no-op (its `_pendingSeatStation` is null),
  so multi-device still seats exactly once (at the desk, via `onDeskHandoffState`). [Added after senior review.]

## Test plan (TDD)
- Unit (`test/floor-checkin.test.js`), pure logic via a tiny harness that injects `_pendingSeatStation`,
  `getStations`, `collectFloor().byStation`, and a `seatCustomer` spy:
  - consume-once (2nd call no-ops); seats `entries[0]` only; no-op when target null / station occupied /
    station missing from `getStations()` / `entries[0]` already paid.
- DOM wiring (onDown/onMove/onUp branch, button, hidden-in-edit) → covered by diff review + a preview boot check
  that the four handlers are on `window` and `#floorplan-checkin-btn` exists; not unit-tested (pointer drag).
- Full suite green, per-file on Windows: `node --test-force-exit --test test/<file>.test.js`.
- Owner eyeballs (desktop): tap open chair → builder → pick service → seated at that chair; "+ Check in" →
  tray; waiver/dup/appt guards fire; party → primary seated, extras in tray; (if a kiosk is designated) chair
  tap → kiosk sign → seated at that chair on confirm.

## TurnDesk port
After Muse ships + owner verifies: re-confirm the hook points exist in TD (`afterManualFinalize`,
`onDeskHandoffState` confirmed branch, `showManualAdd`, `seatCustomer`, the floor pointer system) — TD's
queue/calendar has diverged — then mirror. Log in `turndesk/docs/MUSE-PARITY-BACKLOG.md`.

## Rollback
Additive: 1 button, 1 module var + 4 exports, 1 `onDown`/`onMove`/`onUp` branch each, 3 optional-chained
`window.*?.()` lines in queue.js, a cursor/title/hover hint. No storage/schema/Worker change → **Pages-only**.
Revert = one commit.

## Decisions for the owner
1. **Auto-seat on chair-tap — yes?** (Recommend **yes**; it's the desktop delight and now works on the direct
   *and* kiosk paths, consume-once + guarded.) If you'd rather it only *open* the builder and always use the
   tray, I'll drop the seat hooks and keep just the tap→builder + button.
2. **"+ Check in" button** — plain `btn-secondary` left of "Edit layout" (my default), or primary-colored since
   check-in is the common action?
3. FYI (no action): auto-seat inherits the exact merge behavior of today's drag-to-seat; and the rare
   single-device-kiosk config lands the guest in the tray rather than auto-seating.
