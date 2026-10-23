# Plan v2 (post-review) — 2026-10-23 batch: Turns + tech bubble, price-menu move fix, floor, reminders

Owner batch, dev branch, Pages-only. Rigorous-build. Revised after a 4-lens adversarial review (correctness / completeness / ops-safety / UX). Changes from v1 are marked **[rev]**.

**DEFERRED (owner-confirmed):** floor dashed working-area bounds (#5) **and auto-push (#6)** — joint session with *saved/named floor plans* (a bounded floor makes positions absolute/device-independent, removing the cross-device freeze landmine). Group 3 this batch = **only 3.2** (tech-column height/top).

---

## Group 1 — Turns board + tech bubble (UI, mockup-first)

### 1.1 Next-up highlight must not shift the row
- `turns.js:632` `rowAccent` uses `border-left:3px` (consumes layout). **Fix:** `box-shadow: inset 3px 0 0 <teal>` instead; keep background + radius.
- **[rev] Dark mode:** replace literal `#1a5252`/`#eef5f5` with theme tokens (e.g. `--primary` for the bar, a surface-container token for the wash) so it's legible in the dark base. Verify contrast in dark.

### 1.2 Billed $ under the bonus; remove far-right $ column
- Move `$${billed}` (computed `turns.js:539`) into `turnsCountCol` (`:641-643`) below `+Nb`, wrapped in `.turns-billed` so the Totals toggle (`styles.css:150`) still hides it. Delete `moneyCol` (`:644`) + its use (`:645`). Leave suggestion-card `.turns-billed` (`:1196`).
- **[rev]** Bump `TURNS_TOTALCOL_DEFAULT` (`turns.js:348`) 60 → ~72 so the half-turn amber pill (`turnDisplay`, `:558-559`) + a 4-digit `$1234` don't clip at default; right-align the $; verify at the 44px min too.
- **[rev] Dark mode:** the moved $ uses a token teal, not literal `#1a5252`.

### 1.3a Tech bubble → 3 columns
- `#tech-status-menu` content (`index.html:2248-2257`) 2-col → 3-col: **Services Available** (green ✓) | **Services NOT available** (red ✗) | **Notes/Preferences**.
- Available = `st.services` labels, else (empty ⇒ all) full catalog. Not-available = `cfg().services` minus `st.services`; empty `st.services` ⇒ empty (show "— none —"). Honor `_techDoesService` convention (`turns.js:189-193`).
- Add pure helper `_techServiceSplit(st, catalog)` → `{available, unavailable}`; unit-test it. New `#tsm-svc-no` column; rename "Services Today" → "Services Available". Fill both in `turns.js` (replace `:872-873`).
- **[rev]** Cap the two service columns' height with internal `overflow-y:auto` so a specialist's long exclusion list doesn't make the whole popup scroll.
- **Width:** bump popup `index.html:2237` width to the mockup's final (~600–640px) and the `496` positioning constant (`turns.js:879`) to match.

### 1.3b Status buttons vertical, right of icon+name
- Wrap header (`:2239-2242`) + buttons (`:2243-2247`) in a `flex` row: photo+name left, buttons as a vertical `flex flex-col gap-2` stack right.
- **[owner]** KEEP the large 175px avatar (`turns.js:862-868`) — do not shrink it.
- **[owner]** Buttons all the SAME width but only as wide as needed (content-width, ≈ widest label "On break"); the stack does NOT stretch to fill — align it to the start, leaving empty space to its right in the header row. (`align-items:flex-start` on the button column; buttons share one fixed/`fit-content` width.)
- Fix active-state (`:869-871`): highlight the current state of all three (add `turns_off` detection); dim the others.

**Group 1 ships as one version. Mockup first (Live-now vs Suggestion) — reflecting the [rev] avatar size, capped columns, and dark-mode tokens.**

---

## Group 2 — Price-menu move/remove fix (correctness, TDD) **[rev — rescoped]**

**Real bugs (all from the row-only span `while(arr[idx+n].t==='row')`):**
1. Section **move** orphans subheaders+rows — `pmRelocateItem:74`, `pmMoveTo:85`.
2. Section **delete** orphans the same — `pmRemoveSection:59`.
3. Subheaders don't carry their rows on **drag/"Prints in"** move (grouping only fires for `t==='sec'`).
4. **[rev] NEW:** `pmDel:474` has a 5th copy of the row-only span driving the delete-confirmation count ("removes the heading and its N services", `:477`) — once delete widens, this under-reports and under-counts a destructive action.

**[rev] DROPPED (was v1 bug #4 — misdiagnosis):** `pmMoveItem`/`pmSubUp`/`pmSubDn` reorder a service's **variants/add-ons** (flat `{id,nm,pr}` arrays via `_subList:276`), NOT subheaders. The adjacent swap is correct; subheaders have no up/down control. No `pmMoveItem` change. (This also protects the existing `test/price-menu-editor.test.js:61-70` plain-swap assertion.)

**Fix:** add pure `pmGroupSpan(arr, idx)` — `sec`→to next `sec` (covers subs+rows); `sub`→to next `sub`/`sec` (its rows); else 1. Use in `pmRelocateItem`, `pmMoveTo` (+ its `groupIds` set), `pmRemoveSection`, and `pmDel:474` (count `t==='row'` within the span for the message). Drag-drop self-drop guard still covers all widened members. Bare row still moves/reparents alone (intended).

**Tests — [rev] EXTEND the existing `test/price-menu-editor.test.js`** (don't add a parallel file; it already tests `pmMoveItem`/`pmRelocateItem`/`pmMoveTo`/`pmRemoveSection`). Add: `pmGroupSpan` cases; section move/delete with an interleaved subheader carries the whole block; `pmDel` count matches; **keep** the existing `pmMoveItem` plain-swap assertion green; lone-row regression.

**No persisted migration** (in-memory draft; save writes whole `price_menu`; existing `isStaleWrite`/`cfgmeta` + `_rawCfg` cross-device guard cover it — confirmed safe by review).

---

## Group 3 — Floor plan

### 3.1 (item 6) Auto-push — **DEFERRED (owner-confirmed)** to the bounded-floor/saved-plans session
A fixed/bounded floor makes station positions absolute and device-independent, which removes the cross-device freeze landmine the review surfaced and makes auto-push clean. Not built this batch. (Design notes preserved for that session: enumerate all `getStations()` via `layoutFor` — the map is sparse; gate resolve to geometry mutators only; pre-commit snapshot + Undo; opt-in toggle; tie-breaks + snap-vs-push precedence.)

### 3.2 (items 7+8) Tech column: match floor height + align tops **[rev — proceed now]**
- **[rev]** Compute `minStationY` alongside `maxRight/maxBottom` (`floorplan.js:321`; today only max is computed). Live mode only (column hidden in edit).
- **[rev]** Apply in a **post-pass after `s` is known** (after `:345`), NOT at the `renderFloorStaffRow` call (`:279`, which runs before extents): set `#floorplan-staff-row` `margin-top = minStationY*s`, `height = (maxBottom-minStationY)*s`, and distribute rows (`flex column` + justify) — **[rev]** cap the inter-row gap / top-align when techCount is low so 2–3 techs on a tall floor don't fling to opposite ends; crush-guard (fall back to natural stack+scroll) when many techs/short floor; reset these inline styles each render.
- **[rev]** Verify the `.fp-col-resizer` (`:203-227`, spans `#floorplan-body`) still spans/aligns after the column is offset+shortened.
- Verify in-browser at 2/4/7 techs and short/tall floors.

---

## Group 4 — Calendar reminders **[rev]**

### 4.1 (item 9) Wider — **~700px (owner-confirmed, "in between / 2×")**
`appt-reminders.js:60` `width:340px` → `width:700px` (keep `max-width:96vw` so it clamps on narrow iPad/phone). Optionally nudge font/padding up slightly for readability at the wider size. Accepts some empty space for a one-line reminder.

### 4.2 (item 10) Max 3 + scroll — **[rev]**
- Put `max-height` (measured from the **tallest** card variant — svc+tech is 4 lines, `:62-64` — so 3 full cards fit) + `overflow-y:auto` + `pointer-events:auto` on an **INNER wrapper sized to the cards**, keeping the host `#appt-reminder-banners` at `pointer-events:none` (so it never blocks the top nav).
- **[rev]** Order visible cards by **urgency** (soonest appointment / shortest lead `L` first) so the most time-critical is always visible, and show a **"+N more"** indicator when overflowing.
- No new persisted ack-state.

---

## Cross-cutting
- Trio bump per group ship; What's-New each; all three committed together. Build on `dev`; merge→main+push on owner OK. No Worker change. No schema migration (Group 2 in-memory; Group 3.2 render-only; Group 1/4 markup/render).
- **Decisions (resolved):** A) auto-push (#6) **deferred** with #5 + saved plans. B) reminder width **~700px**. C) Group-1 mockup signed off with 2 tweaks (keep 175px avatar; content-width same-width buttons). D) **Ship the whole batch together** — one trio bump + What's-New at the end, not per group.
- Build order (all on `dev`, one ship): **Group 2** (done) → **Group 1** → **Group 3.2** → **Group 4** → consolidated 3-lens + senior review → trio bump v5.84 → present for ship OK.
