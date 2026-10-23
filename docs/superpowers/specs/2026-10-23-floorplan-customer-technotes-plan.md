# Plan (v2, post-review) — Floor plan / edit-customer / tech-notes batch (2026-10-23)

Four owner-approved changes. **Pages-only** (no Worker deploy). Version trio bumped once at ship; **four separate commits** so each item reverts cleanly.

Owner decisions (AskUserQuestion, 2026-10-23): waiting bar = constant single-row height + horizontal scroll; tech notes = widen, services left / notes right; edit-customer = full reconciling breakdown. Tech-card turn-order (#2a) + "turn number more visible" (#4) = **PARKED** (not this batch).

This v2 incorporates the 4-lens adversarial plan review (data-safety / correctness / sequencing-ops / completeness). Changes from v1 are marked **[review]**.

---

## Item 1 — Floor-plan waiting tray: constant height + horizontal scroll

**Plain English:** the grey "not seated" strip grows taller as waiting guests are added (bubbles wrap to new rows), shoving the floor grid down. Make it one constant height; extra guests scroll sideways.

**Where:** `js/app/features/floorplan.js:225-235` (both tray templates: empty 230-231, populated 232-234). `css/styles.css` for the scroll container + edge-fade.

**Change:**
1. Both inner boxes (`bg-surface-container rounded-xl p-2`) get the SAME fixed height so empty↔populated never jumps (today empty is one label line, populated is label + wrapping rows → the grid already jumps on 0→1).
2. Populated bubble row: `flex gap-1.5 flex-wrap` → `flex gap-1.5` with **`flex-nowrap`, an explicit row height, and `overflow-x:auto`**.
3. **[review] Each bubble gets `shrink-0` + `whitespace-nowrap` on the name** — without `shrink-0` the flex items compress to min-content and never overflow (no scrollbar; names crushed). This is required for the scroll to happen at all.
4. **[review] iPad reachability (was deferred — now solved):** bubbles are `touch-action:none` drag-to-seat (`styles.css:272-275`) and a pointerdown on one starts a seat-drag, so a finger-swipe on a bubble can't scroll. Set **`touch-action:pan-x` on the scroll CONTAINER** (bubbles keep `touch-action:none` for drag) so a swipe on the strip pans it; keep bubble drag-to-seat intact. Add an **edge fade** (right-side gradient) as the "more guests →" cue since overlay scrollbars are hidden until scrolled. **Verify on the iPad before ship**; if the swipe feels cramped (thin 6px gaps), add on-screen ‹ › scroll chevrons as the fallback affordance.
5. **[review]** Row height must budget the ~15px horizontal scrollbar; box height tuned in-browser (~66–78px starting point).
6. Desktop: trackpad / wheel / scrollbar all scroll it; optional wheel→horizontal translate if it reads naturally.

**Tests:** no logic; browser verification (0 / 1 / many guests → single constant-height row that scrolls; grid doesn't jump) + iPad touch check.
**Rollback:** revert the two templates + the CSS. Zero data impact.

---

## Item 2b — Floor-plan tech card: live current-customer service timer

**Plain English:** on the staff row under the floor, show — for a tech who's working — how long the current service has run and its average, the same "23m ▸ ~18m" badge the customer bubbles already use.

**Where:** `js/app/features/floorplan.js:173-204` (`renderFloorStaffRow`, card 197-201). Add `getActiveTechEntries` to the turns.js import at `floorplan.js:14`. `serviceTimeInfo` already imported (15); add `liveAssignmentMs`.

**Change:**
1. New pure helper `pickTechTimingAssignment(entries, techId)` → the tech's current in-service assignment, selecting the one with the greatest **`liveAssignmentMs(a)`** **[review: not earliest `svcStartedAt` — a paused/resumed service banks into `serviceMs`, so earliest-start ≠ longest-elapsed]**. Returns `null` when the tech isn't in service. Selector keyed on `a.status==='inservice'` **[review: aligns with `serviceTimeInfo.live`/`liveAssignmentMs`, which read `a.status`, so the picked assignment is guaranteed to render]**. Pure + injected → unit-testable.
2. Render a compact line under the status label reusing the Turns-grid precedent (`turns.js:510`): `<span style="font-size:10px;font-weight:700;color:${sti.color}">${sti.text}</span>` where `sti = serviceTimeInfo(a)`, only when `sti && sti.live`.
3. **[review] Reserve a fixed min-height for the status+timer area** so a card is the same height whether or not a timer shows — otherwise cards gain/lose a line as techs enter/leave service and the wrapped staff row reflows on every transition.

**Decision (my call, stated):** one timer line per tech (the longest-running in-service service); multi-simultaneous in-service is rare. Expandable later.

**Tests:** `test/floor-tech-timer.test.js` (new) — `pickTechTimingAssignment`: picks the in-service assignment, ignores waiting/complete, null when idle, picks greatest `liveAssignmentMs` when two in-service.
**Rollback:** revert card markup + import + helper. Zero data impact.

---

## Item 3 — Edit-customer visit history: reconciling breakdown

**Plain English:** show each past visit's full breakdown — every service with its price, plus items, fees, and any discount — that adds up to the visit total.

**Where:** `js/app/features/reports.js:142-154` (`_visitLines`, pure, tested) + `156-188` (`renderCustomerHistory`). `lineCharge`, `ticketTotal` already imported (6).

**Change:**
1. Extend `_visitLines` ADDITIVELY: each line gains `charge` (via injected `chargeOf(a)=lineCharge(a)`) and `comped` (`!!a.comped`); fallback service-only lines get `charge:null`. **[review] This breaks the 5 `assert.deepEqual` assertions in `test/wave1-helpers.test.js:30-46` (deepEqual rejects extra keys) — those assertions WILL be updated, not relied on to pass.**
2. New pure helper `_visitBreakdown(r, { svcLabel, techName, itemLabel, feeLabel, chargeOf })` → `{ serviceLines:[{service,tech,charge,comped}], items:[{label,qty,amount}], fees:[{label,amount}], discount, total }`.
   - **[review] Record shapes:** fees are `{feeId, amount, type}` (label via `cfg().fees.find(x=>x.id===f.feeId)?.label || f.label || 'Fee'`); items are `{itemId, price, qty}` (label via `cfg().items.find(x=>x.id===it.itemId)?.label || it.label || 'Item'`). **No `r.items[].name` / `r.fees[].label`** — the helper MUST inject `itemLabel`/`feeLabel` lookups.
   - **[review] item line `amount = (price||0)*(qty||0)`**, fee `amount = f.amount`, service `charge = lineCharge(a)` — matching `ticketTotal` exactly so lines reconcile.
   - `total` = **the record's already-reconciled `r.totalCost`** (see 3 below), NOT a freshly recomputed `ticketTotal`.
3. **[review — the big one] Use `r.totalCost`, do NOT recompute `ticketTotal(r)` here.** `renderCustomerHistory` runs on `buildCombinedRecords()`, which (`reports.js:91-95`) already sets `totalCost = ticketTotal(r)` for parts-bearing rows and **deliberately leaves part-less legacy/"Add Historical" rows at their stored `totalCost`**. Recomputing `ticketTotal` again would show **$0.00** (and drop from "total spent") for a legacy row that has a real stored total but no reconstructable parts. So: visit total AND the header "total spent" use `r.totalCost` as-is. This also makes the v1 "penny-drift / header switch" concern **moot** — removed.
4. **[review] Render the itemized breakdown ONLY when the record has reconstructable parts** (any assignment with a cost, or `items.length`, or `fees.length`). Records with no usable parts → the simple one-line render (date + total), same as refunds — so we never show priceless service lines under a non-zero total.
5. **Refunds** keep today's `-$abs(totalCost)` one-line render (no re-priced assignments).
6. **[review] Reconciliation caveat:** for parts-bearing rows the lines sum to `r.totalCost` by construction, EXCEPT `ticketTotal`'s `Math.max(0, …)` clamp — if a discount exceeds the subtotal (rare/legacy) the total shows `$0` while lines sum negative. Noted, not engineered around.

**Tests:** **[review] file is `test/wave1-helpers.test.js`** — update the 5 `_visitLines` assertions for the new fields; add `_visitBreakdown` tests (services+items+fees−discount vs total; comped line = $0; item `price×qty`; fee label lookup; no-parts → simple path; refund path).
**Rollback:** revert `_visitLines` + `renderCustomerHistory`. Read-only display; zero data impact. **[review] Confirmed blast radius = none:** the only caller of `_visitLines` is `renderCustomerHistory`; the returning-customer badge reads `r.assignments` directly.

---

## Item 4 — Tech-status popup: widened side-by-side + multiple editable notes

**Plain English:** wider popup, services left / notes right; notes as individual entries you add (Save/Add button), edit, and remove; no grey background; bigger so the full name shows; name moved below the photo.

**Where:** `index.html:2259-2282` (markup) + `js/app/features/turns.js:716-780` (`showTechStatusMenu`, `_tsmOutsideClick`, `closeTechStatusMenu`, note helpers). `css/styles.css` as needed. **[OWNER: robust version] A NEW Worker op is added** (`cloudflare/worker.js` + `js/app/sync.js` + `js/app/store.js`) — see below. Requires a `wrangler deploy` (deploy-first), and ports to TurnDesk.

**Data shape:**
- Source of truth: `st.notesList = [{ id, text }]`. `st.notes` (string) KEPT as a joined mirror (`arr.map(n=>n.text).join(' · ')`) for old-client back-compat. **[review] Confirmed the ONLY reader of staff `st.notes` is this popup** (every other `.notes` is appointment/giftcard), so the mirror fully covers back-compat.
- Read: `normalizeTechNotes(st)` → `Array.isArray(st.notesList)` ? it : (non-empty `st.notes` ? `[{id, text:st.notes}]` : `[]`).

**[OWNER DECISION: robust per-note merge op — resolves concurrency risk (a)]**
New op **`staff.notePatch { id, action, note }`** (`id` = staffId; `action` ∈ `add|edit|remove`; `note` = `{id, text}` for add/edit, `{id}` for remove) across all three layers, mirroring the `staff.patch`/`task.patch`/`queue.entryPatch` precedent:
- **`sync.js`** (dispatch): stamp `updatedBy = DEVICE_ID` (echo/debug parity); ships only `{ id, action, note, updatedBy }`.
- **`store.js`** (`applyChange` optimistic) AND **`worker.js`** (DO `applyMutation`, serial read-modify-write of `config:staff`): find the tech by `id`, `list = normalizeNotesList(cur)` (from `notesList`, else migrate the legacy `notes` string to one entry), then apply **by note id**:
  - `add`: append `note` iff no entry with that id (idempotent dedupe), soft-cap ~12;
  - `edit`: replace `.text` of the matching id (no-op if absent);
  - `remove`: drop the matching id (no-op if absent).
  Then set `arr[i] = { ...cur, notesList: list2, notes: list2.map(n=>n.text).join(' · ') }`. **Never replaces the whole list from another device** — two concurrent `add`s (different ids) both survive. Idempotent → outbox replay safe.
- **Guard / cfgmeta:** `staff.notePatch` does NOT bump `cfgmeta:staff` (notes stay the lower-stakes side that yields to a full profile `config.set`, consistent with `staff.patch`). So risk (a) is CLOSED; risks (b)/(c) below remain as pre-existing, accepted behavior.
- The DO owns the authoritative merge; the client applies the same logic optimistically so the open popup reflects it instantly.

**[review] Remaining accepted risks (documented, pre-existing by design):**
- (b) **Stale-device profile save reverts notes:** a `saveStaff` whole-array `config.set` (bumps `cfgmeta:staff`) from a device with a stale staff array can overwrite a freshly-added note — because notePatch deliberately yields to profile writes (same as today's string). Pre-existing; not introduced here.
- (c) **Rollout window:** until every device loads the new bundle (SW staleness → `↻` badge), an old client still uses the old whole-string save; the DO recomputes the mirror, but a mixed-version moment can drop a concurrent old-client edit. Shrinks as devices update.
- Migration/rollback: additive (`notesList` new; `notes` mirror preserved; new op). Revert client → reads the mirror string; revert Worker last (deploy-first, rollback-last) so the DO always understands any op a client can send.

**[review] TD port:** add `staff.notePatch` + the popup rework to the batch-end TurnDesk port list.

**UI change:**
1. **[review] Responsive width:** `width:min(480px, calc(100vw - 24px))`; left clamp `Math.max(8, Math.min(rect.left, innerWidth - width - 8))` (floor at 8 so it never pins off-screen); **services|notes collapse to stacked below ~520px**. Keep `max-height:calc(100vh-24px); overflow-y:auto`.
2. Header: photo on top, **name centered BELOW the photo**, drop `truncate`, allow wrap → full name always visible. (175px photo centered in the wider popup.)
3. Body: 2-column row — LEFT existing "Services Today" (`#tech-status-menu-services`), RIGHT "Notes" column.
4. Notes column: list of note rows (text + remove ✕; click-to-edit inline for managers) + an add box (input + **Add** button). **No grey background** — drop `bg-surface-container`; **[review] use design tokens** (`border-surface-container-high`, `text-on-surface*`) so it survives dark mode, not raw hex.
5. **[review] Repaint the open popup:** the popup is built imperatively with no store subscription, so add `renderTechNotesColumn(id)` that re-reads `normalizeTechNotes(staffById(id))` and repaints the notes column in place after each add/edit/remove (and on open) — otherwise a new note doesn't appear until reopen.
6. **[review] Draft safety on close:** replace the blob auto-save with a `flushTechNoteDraft()` that, on EVERY close path (`closeTechStatusMenu`, `setTechBreak`, `setTechOff`, outside-click), commits a non-empty add-box as a new note — so "type a note then tap Break" doesn't silently drop it. Remove the `onchange="saveTechNotes()"` glue (`index.html:2278`) and the `saveTechNotes` call in `closeTechStatusMenu`.
7. **[review] Remove-confirm:** a mis-tapped ✕ now deletes a whole note immediately — add a lightweight inline two-tap confirm (✕ → "Remove?" briefly) so it isn't a one-tap data-loss.
8. Permissions unchanged: only `canDo('manageStaff')` sees add/edit/remove.

**[review] Helpers (replace the string ones; update callers + tests in the same commit):**
- **Shared pure merge** `applyNotePatch(list, action, note)` → next list (add-idempotent / edit-by-id / remove-by-id, soft-cap ~12) — used by BOTH `store.js` applyChange and `worker.js` applyMutation so client and DO can't drift (same pattern as the other `*util.js` cores). Lives in a small importable module (e.g. `cloudflare/staff-notes-util.js`) imported by the Worker and mirrored/imported client-side.
- `normalizeNotesList(stOrNotes)` → `[{id,text}]` (array as-is; legacy string → one entry; empty → `[]`). `normalizeTechNotes(st)` is the UI alias.
- UI handlers `addTechNote/editTechNote/removeTechNote(staffId, …)` each `dispatch('staff.notePatch', { id, action, note })` (uid via `crypto.randomUUID?.()` or a counter fallback); per-note ~200 chars.
- **`test/tech-notes.test.js` imports `_withTechNotes` (7 tests)** — rewrite for the new model; update the three close-path callers (`closeTechStatusMenu`, `setTechBreak`, `setTechOff`) so `flushTechNoteDraft()` replaces `saveTechNotes()`, and remove the `onchange`/`window.saveTechNotes` glue together (no dangling reference to a deleted symbol).

**Tests:** rewritten `test/tech-notes.test.js` — `normalizeNotesList` (array / legacy string / empty), `applyNotePatch` (add dedupe-by-id / edit-by-id / remove-by-id / no-op on missing / cap), `notePatch` dispatch shape, mirror recompute. New DO-integration assertions (extend `test/worker-patch-guards.test.js` or a new `test/staff-notepatch.test.js`): two `add`s from different devices BOTH survive (the whole point of the robust op); legacy-string tech gets migrated on first op.
**Rollback:** revert markup + turns.js. Additive data; mirror intact.

---

## Cross-cutting
- **Worker:** Item 4 now adds the `staff.notePatch` op → a `wrangler deploy` IS required. **Deploy the Worker FIRST, then push Pages** (so the DO understands the op before any client sends it), verifying the account is `info@musenailandspa.com`. Needs explicit owner OK (per the commit/deploy rule). Items 1–3 are Pages-only.
- **Version:** bump `config.js` APP_VERSION + `version.json` + `sw.js` CACHE_NAME together at ship + What's-New entry (via `ship` skill, on explicit OK). **[review] Confirm all three trio files are STAGED, not just edited** (per the v5.72 incident).
- **Branch:** build on `dev`; bump once at `dev→main`. **[review] Separate commits per item** so single-item rollback is clean (item 4's client + Worker land together).
- **Order:** 1 → 2b → 3 → 4. (1–3 can ship without the Worker; 4 is deploy-first.)
- **TD port (batch end):** `staff.notePatch` op + popup rework join the owed TurnDesk ports.

## Status
- **RESOLVED (owner, 2026-10-23):** Item 4 uses the **robust Worker per-note merge op** (`staff.notePatch`), since it ports to TurnDesk. All other choices decided in-plan: one timer line per tech with reserved height; iPad pan+fade+verify (chevron fallback); draft-commit-on-close + remove-confirm; use `r.totalCost` so legacy rows don't zero; tokens not hex.
- **GATE:** plan complete — **awaiting owner approval before any code is written** (owner asked to pause here).
