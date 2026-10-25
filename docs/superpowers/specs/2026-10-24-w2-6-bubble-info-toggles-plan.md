# W2-6 — Per-user "Bubble info" toggles (Floor + Queue + Turns)

**Batch 2, item 2** (NL6 done). Owner item 6: let each user toggle OFF three bits of
customer-bubble clutter — **service time / technician / service** — across the Floor plan,
Queue, and Turns board. Stored **per-USER, synced** (follows the person across devices).
Owner decision (AskUserQuestion): the control is **a button on the board toolbar**.

## Goal (plain English)
A front-desk person can tap a small "Bubble info" button on the Turns / Floor / Queue toolbar
and uncheck "Service time", "Technician", and/or "Service" to hide those details from the
customer cards. Their choice is remembered for *them* and follows them to any device they sign
in on. Everyone else still sees their own setting. Default = everything shown (nothing changes
for anyone until they opt in).

## Scope decision (one shared pref, surfaced to owner)
ONE pref set applies to all three surfaces ("apply to Floor + Queue + Turns" read as a single
toggle group whose effect spans all three). NOT per-surface. Simplest, least surprising; the
same button on each toolbar opens the same popover. → surface this to the owner at ship.

## Storage (follows the chat_seen_<pid> / fd_clock_<id> precedent)
- Config key: **`bubble_prefs_<pid>`**, `pid = 'fd:' + getActiveUser().id` (dashboard user is
  always front-desk). Arbitrary per-user config keys already survive store merges (store.js
  note re fd_clock_<id>) — no emptyConfig() change, no migration, additive.
- Value: `{ time:bool, tech:bool, svc:bool }`, **true = HIDDEN**. Missing/empty = all shown
  (backward compatible). Written via `dispatch('config.set', { key, value })` → synced + LWW.
- No active user → key null → `getBubblePrefs()` returns all-shown (safe; auth is enforced so
  this is only the signed-out edge).

## New module: `js/app/features/bubble-prefs.js`
Exports (window-glued via main.js import + the Object.assign array):
- `bubblePrefsKey()` → `'bubble_prefs_fd:'+id` or null.
- `getBubblePrefs()` → `{ hideTime, hideTech, hideSvc }` (pure read of getState().config).
- `toggleBubblePref(which)` — flips `time|tech|svc`, dispatches config.set, refreshes the open
  popover checkboxes. (onStateChange re-renders the active floor-group panel on any `config`
  change — main.js:767/781-784 — so no manual panel re-render needed.)
- `bubbleInfoButtonHtml()` → the toolbar button markup (icon `visibility`, label "Bubble info";
  a filled dot when any bit is hidden so it's discoverable that something is off).
- `openBubbleInfoPopover(btnEl)` / `closeBubbleInfoPopover()` — a small anchored popover
  (3 checkboxes). Appended to body; positioned under the button; closes on outside-click/Esc;
  dark-mode aware (uses theme tokens, not hardcoded hex).
- Add to `sw.js` PRECACHE.

## Button placement (leverages NL6)
Inject the button next to the view-switcher in `renderDashSubnav` (main.js) **only when
`grp === 'floor'`** — so it lands in the exact same spot on all three panels (right of the
Turns·Floor·Queue switcher), guaranteed consistent. No per-toolbar edits.

## Render changes (conditionally omit each bit; keep status dot, price, station, pills)
Read `getBubblePrefs()` once at the top of each render fn.

1. **floorplan.js `custLines`** (the shared floor renderer — seated tiles + tray bubbles):
   rebuild the `main` text as a `parts.join(' · ')` array: push service label unless hideSvc;
   push `t.name.split(' ')[0]` unless hideTech; always push Comp/$; push "Wait" only if tech
   shown and no tech. Avatar `_techAvatar` only if `!hideTech`. `sti` sub-row only if `!hideTime`.
   Dot always.
2. **queue.js `buildQueueRow` `assignSummary`**: service `<span>` only if !hideSvc; `→ tech`
   span only if !hideTech; `tip` '' if hideTime (existing `${tip?'':'ml-auto'}` layout already
   handles the empty tip). Unassigned `serviceLabels` fallback div only if !hideSvc. Status
   pill + price + Price-in✓ unchanged.
3. **turns.js `renderTurnsQueue` `buildCard` serviceContent** (waiting + active tray cards):
   assigned branch — svc label only if !hideSvc; `→ tech` / `→ suggest?`+accept btn only if
   !hideTech. Unassigned branch — same. (No sti in these cards; hideTime is a no-op here.)
4. **turns.js tech-grid slot** (line ~720-726): rebuild line 723 as parts `[svcLabel?, station?,
   cost?].join(' · ')` (svcLabel only if !hideSvc; station/cost always); `sti` line only if
   !hideTime. Tech is the column header → no hideTech here.

Out of scope (noted): the floor **tech roster** card (floorplan.js ~285-299) is a tech-status
widget, not a customer bubble — left unchanged.

## Tests (node:test, pure cores)
`test/bubble-prefs.test.js`:
- `getBubblePrefs` returns all-shown for missing/empty key; reflects each flag; null-user safe.
- A pure `bubbleLineParts(bits, {hideSvc,hideTech,hideTime})` helper (extracted so the
  compositional label logic is unit-testable without the DOM) — verify: nothing hidden = full;
  hideSvc drops label but keeps tech+cost (no leading ' · '); hideTech drops tech + the "Wait"
  suffix; hideTime drops the timing bit; all-hidden = empty parts (dot-only line). This helper
  is used by custLines so the join logic is shared, not duplicated.

## Risk / rollback
Display-only. No financial/persisted-record path. The only new persisted state is an additive
per-user config key that defaults to "show all". Rollback = revert; an orphaned
`bubble_prefs_*` key is harmless (ignored by old code). No version-trio data concern.

## Review lenses to run (plan)
1. Correctness/data-safety grounded in store.js merge + dispatch (does an arbitrary config key
   really survive snapshot merge + outbox replay? any echo/LWW gotcha?).
2. Completeness/UX (did I miss a customer-bubble surface? popover ergonomics, dark mode, the
   accept-button-under-hideTech call, the shared-vs-per-surface decision).

---
## Plan review triage (2026-10-24, 2 lenses, grounded in code)
Accepted: B1(HIGH, popover→MODAL_CLOSERS + full-screen backdrop); A1/B2(button dot re-paint in
toggleBubblePref — onStateChange never rebuilds subnav); A2/A3/B5(bubbleLineParts = svc/tech/cost/Wait
only, push cost only when present, caller joins; hideTime gated at stiHtml call site, tested there);
A4(hideTech hides tech NAME/avatar only — @station stays, both queue branches); B3(hideTech hides
ASSIGNED tech only; suggestions + Accept btn ALWAYS shown — no workflow regression); A6(drop orphan
leading → under hideSvc on turns cards); B7(popover theme tokens + accent-color + ≥44px rows);
A5(sw.js PRECACHE + full trio bump at ship).
Documented out-of-scope (surface to owner): B4 Turns upcoming-appts strip + in-grid next-appt note,
and the floor tech roster = future-booking / tech-status widgets, not live customer bubbles.
B6 asymmetry: "Service time" is inert on Turns waiting/active cards (no per-service time there);
it affects Floor tiles, the Turns tech-grid slot, and Queue rows. B8: all-hidden still shows
name/elapsed/dot(+$) — confirmed usable, no change.
