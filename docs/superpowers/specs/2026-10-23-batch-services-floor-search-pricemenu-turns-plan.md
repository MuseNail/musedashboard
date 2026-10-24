# Plan v2 — 5-item owner batch (2026-10-23)

Muse (`musedashboard`), branch `dev`. Rewritten from a 4-lens adversarial review
(data-safety / correctness / sequencing-ops / completeness). Each item = its OWN
commit; a final version-trio + changelog commit ships the batch.

Legend: **Tech** = engineer view · **Plain** = owner view.

Build order (low-risk → highest-touch): **5 → 4 → 3 → 2 → 1**.

---

## Item 5 — Turns: move "$ billed" under the tech name

**Plain:** Move each tech's "$ billed today" from the middle turn-count column to
right under their name/status, so money reads with the person.

**Tech:**
- `turns.js` live grid builder: remove `.turns-billed` span from `turnsCountCol`
  (L652); add it as a 3rd line in `techCol` (L572–577), under the status-chip row.
- Keep class `turns-billed` + inline color → the per-device hide-totals toggle
  (`#panel-turns.turns-hide-totals .turns-billed{display:none}`, styles.css:150)
  keeps working untouched. `billed` already computed at L548.
- **Note:** the HISTORY view (`renderTurnsHistoryView`, L1210) ALREADY renders
  `.turns-billed` inside its techCol — so this move makes live + history consistent;
  the history view needs NO edit. (My earlier "only at L652" was incomplete.)
- Layout: tighten the new line (`leading-none`, minimal `mt`) so name(~18) +
  chip(~16) + billed(~14) clears the 56px slot at 8+ techs. **Fallback if it clips
  at 8+:** shrink the billed line to 11px / drop its `mt`. Verify at 5 and 9 techs.

**Data/sync:** none. **Rollback:** `git revert` this item's commit.

---

## Item 4 — Price-menu editor: list column 40% default, drag to 60% max

**Plain:** The services list starts at 40% of the width and drags out to 60% max
(edit panel never below 40%). It will **not** shrink below 40% — you didn't ask for
narrower, and below 40% the "+ Service / + Subheader / + Section" bar clips.

**Tech:** `pricemenu-editor.js` (L197–246) + `test/wave1-helpers.test.js` (L9,38–42).
- **Fraction model.** New pure helper `_clampPmListFrac(frac)` → clamps to
  `[0.40, 0.60]`, default `0.40` (`PM_MIN_FRAC = PM_DEF_FRAC = 0.40`, `PM_MAX_FRAC
  = 0.60`). Store in a NEW device-local key `muse_pm_listcol_frac` (do not reinterpret
  the old px key `muse_pm_listcol_w` — a stored "300" would misread; old key left
  intact, harmless). **One-time:** existing users' custom width resets to 40% on
  first load — intended; call out in the changelog.
- `_applyPmListColW()` = read `.pm2-main` inner width (clientWidth − 14px gap);
  if width ≤ 0 keep the 300px CSS fallback and skip; else set `--pm-listcol-w =
  round(frac*innerW)px` AND reposition the resizer handle `left` from the SAME
  measurement (so var + handle never desync).
- **First-open fix (HIGH):** `renderPriceMenuEditor` runs via `settingsOpenLeaf`
  BEFORE the section is unhidden (settings.js:549 render → 553 unhide), so
  clientWidth is 0 on open and the default would wrongly show 300px. Apply the
  frac→px AFTER unhide: `settingsOpenLeaf` calls `window._applyPmListColW?.()` post-
  unhide for the `settings-pricemenu-section` leaf, plus a one-shot `rAF` re-apply
  guarded on width>0.
- **Resize/orientation (HIGH, was missing):** add a debounced `resize`/
  `orientationchange` listener (added once) that re-applies frac→px + handle,
  guarded to run only when the editor is visible and > 820px (the stacked
  breakpoint `styles.css:815` where the resizer is `display:none`).
- Drag handler: convert px delta → frac delta against the live `.pm2-main` width;
  clamp via `_clampPmListFrac`; persist frac on release.
- **Tests:** rename the import at `wave1-helpers.test.js:9`
  (`_clampPmListColW` → `_clampPmListFrac`) IN THE SAME edit as the 4 rewritten
  cases (fraction bounds), or the whole file fails to load. Run per-file
  `node --test-force-exit --test test/wave1-helpers.test.js`.

**Data/sync:** device-local localStorage only; no synced key touched.
**Rollback:** revert; old code reads the old px key, ignores the frac key.

---

## Item 3 — Global search also finds & opens Settings

**Plain:** The header search also matches Settings (e.g. "waiver", "turn rules").
Tap a result → jump into Settings and open that exact screen.

**Tech:** `settings.js` + `search.js`.
- **Extract one predicate** `settingsLeafVisible(it)` from the inline filter in
  `filterSettings` (L512–513) and reuse it in `filterSettings`, `settingsOpenCategory`
  (L533) AND the new `searchSettings` — so permission logic is genuinely one source
  of truth (today it's inlined, not reusable).
- Add exported `searchSettings(query)` → returns visible matching leaves
  `[{label, sub, cat, content, action, icon}]` using `settingsLeafVisible`.
- `search.js` `_gsSearch`: add a **Settings** group (icon `tune`, cap ~6) from
  `window.searchSettings?.(qstr)` in try/catch. Each row id wrapped in `escAttrJs`
  for parity with the other groups.
- `gsGo('setting', a)`:
  - content leaf → `showDashPanel('settings'); setTimeout(()=>settingsOpenLeaf(a),60)`
    (proven pattern, main.js:695). `settingsOpenLeaf` re-checks perms (defense in depth).
  - action leaf (only Customer Directory today, `action:'showCustomerDir'`) → run the
    action **directly, no settings hop** (avoids a visible flash to Settings then away).
- **Permission honesty:** `searchSettings` is the single enforcement point (action
  items carry no perm flag today and bypass `settingsOpenLeaf`); the plan states
  this plainly rather than claiming a 2nd check that doesn't exist on that path.

**Data/sync:** none (read-only nav). **Rollback:** revert; additive.

---

## Item 2 — Floor "Not seated" tray shows the full customer bubble

**Plain:** Waiting (not-seated) guests in the top strip show as a tiny name chip.
Make them the full card — name, time waiting, each service + whether it has a tech —
so you see everything at a glance.

**Tech:** `floorplan.js` tray block (L295–317), reusing `custLines(e, null, 1)` (L111).
- Each unplaced guest becomes a fixed-width (~155–165px, `flex-shrink:0`) mini-card
  in the SAME horizontal scroll row; **keep `data-entry-id` + `.fp-grip`** so
  drag-to-seat, the chevrons, and iPad `pan-x` are UNCHANGED.
- Content = header (group letter + 2-line name clamp + elapsed + note icon via
  `cardNotePreview`) + `custLines(e, null, 1)` (per-service dot + "?" avatar + service
  · Wait; teal if the guest already has an in-service assignment, else amber).
  `fs = 1` for tray cards (no `layoutFor().font`). `stationId` is unused inside
  `custLines`, so passing `null` is safe.
- **DECISION D (settled): DUPLICATE** the ~6-line header snippet into the tray; do
  NOT refactor `stationHtml`'s header (that's the live seated card — refactoring it
  for a secondary view risks regressing the main floor).
- **Height / no-jump (DECISION C+H — owner call):** each card is a fixed-height box
  with `overflow:hidden` (clip is mandatory — without it a 3-service guest expands
  the row and defeats no-jump). **Recommended:** fixed tray height ~**100px**, show
  up to **2 service lines** + a "**+N more**" chip when a waiting guest has 3+; the
  empty-state box matches that height so the grid never jumps.
  (Alternative the owner can pick: content-driven height that lets the floor
  auto-scale smaller — honors "show everything" literally but the tray/grid height
  shifts as guests seat/unseat.)
- a11y: tray card stays a focusable drag affordance (as today's chip).

**Data/sync:** none. **Rollback:** revert the tray block.

---

## Item 1 — Services inline-editable + Save button + unsaved guard (BIGGEST)

**Plain:** Services edit inline like Retail Items (every field editable in one
click, no popup) + a new **Description** field. Both Services AND Retail Items get a
safety net: change anything → a **Save** button appears; try to click away / edit a
different row with unsaved changes → a popup asks **Save / Discard / Keep editing**.

> This item is materially bigger & riskier than 2–5 (touches the config write path,
> index.html, the modal-closer registry, and two renderers). Recommend building &
> committing it LAST and on its own. Could be split further if desired.

**Tech:** `catalog.js`, `index.html`, `css/styles.css`, `main.js` (modal registry).

**A. One-editing-row dirty model (own guard; NOT shared with price-menu).**
- Module state `_editing = { kind:'service'|'item', id, draft }` — at most ONE dirty
  row at a time.
- **Render-from-draft rule (HIGH):** every render of the list MUST render the
  currently-dirty row's inputs FROM `_editing.draft`, never from stored config — so a
  local re-render (a visibility toggle, Add, Delete of another row, toggle-all) can't
  silently wipe typed text.
- Editing a field updates `draft` + flips the row dirty → reveal that row's **Save**
  (✓) + **Revert** (✗). Wiring: a delegated `focusin` + `pointerdown`-capture
  listener on the list container (added once), NOT per-input inline handlers — the
  handler calls `requestEdit(kind,id)`.
- `requestEdit(kind,id)`: if a DIFFERENT row is dirty → open the **3-button**
  unsaved modal (Save / Discard / Keep editing). Keep-editing cancels the focus move.
- **Save (HIGH — live-merge, no snapshot):** read LIVE `cfg().services` / `cfg().items`,
  map/splice in ONLY the dirty row's fields (new row → append to the LIVE array),
  validate, `dispatch('config.set',{key,value})`, clear `_editing`, re-render, toast.
  This mirrors the existing safe `saveService` pattern (catalog.js:101–108) and makes
  a concurrent other-device edit of a DIFFERENT row impossible to clobber. (We do NOT
  add pmSave's "changed on another device" modal — unnecessary once we live-merge the
  single row; a same-row concurrent edit is last-writer at row granularity, which is
  fine. Owner may request the extra warn if they want it.)
- **Add / Delete route through the guard (HIGH):** "Add service/item" and deleting a
  row first check `requestEdit` (if another row dirty → prompt). Add appends a blank
  row that becomes `_editing`. Delete keeps its confirm; deleting a clean row is
  instant; deleting the dirty row clears `_editing`.
- **Visibility toggles stay INSTANT-save** (DECISION E) — they dispatch immediately
  with their switch animation and are NOT part of the dirty model; but a toggle's
  re-render still honors the render-from-draft rule for the dirty row.

**B. Leave-the-section guard (own, parallel to pmGuardLeave).**
- Add `catalogHasUnsaved()` + `catalogGuardLeave(onLeave)` + a dedicated 3-button
  catalog-unsaved modal (sibling of `pm-unsaved-modal`; do NOT touch pm's markup/fns).
- Call `catalogGuardLeave` at the SAME chokepoints, enumerated fully:
  `goTo` (main.js:113), `showDashPanel` (main.js:524), `settingsNavRoot`,
  `settingsOpenCategory`, `settingsOpenLeaf`, `settingsBack`, AND **`filterSettings`**
  (the settings search box switches views with no guard today — must add one).
- `beforeunload` while a catalog row is dirty.

**C. Description field.** Additive `desc` string on each service object; stored via
the normal `services` array write; round-trip-safe (old `{...svc}` spread preserves
unknown keys). **Editor-only** this batch (DECISION G) — not surfaced on Assign/
dashboard (separate ask).

**D. Row layout (iPad-safe).** Two-tier row: line 1 = Name / Abbr / $Base /
Description inputs; line 2 = [Check-in toggle] [Dashboard toggle] + Save/Revert +
Delete. Verified at iPad portrait (768px) and phone. Retail Items get the same
Save/Revert/guard but no new field.

**E. Retail Items index→id migration.** Items are index-keyed today
(`updateItemField(i)`, `removeItem(i)`, inline `${i}`). Re-key all item handlers +
inline markup to `it.id` (items already carry `id:'item-'+ts`) so the id-based dirty
model is stable across add/delete index shifts.

**F. Retire the service-modal (enumerated).**
- Remove `index.html:1175` Add-service button (rewire to the inline add) + the modal
  markup (`index.html:1674–1702`).
- `main.js:71` registers `['service-modal', catalog.closeServiceModal]` in the
  modal-closer registry — remove that entry (or keep `closeServiceModal` as a no-op
  stub) so Esc/close can't call `undefined`.
- Extract `saveService`'s validation (required name/abbr L99–100, dup-name L102) into
  a PURE helper the inline Save calls; do NOT call the DOM-coupled `saveService`.
- **Do NOT touch** `queue.js:2023 showEditServicesModal` — that's the ticket's
  edit-services modal, unrelated.

**G. a11y:** Enter = Save, Esc = Revert, logical tab order across the new inputs.

**H. Tests:** pure draft-reducer helper (apply-field, is-dirty, commit-merge) keyed
by id, with unit tests (mirrors the price-menu's pure mutators + tests).

**Data/sync:** additive `desc`; whole-array `config.set{key:'services'|'items'}` op
shape unchanged → no store.js/worker.js change; per-key stale guard already covers
these keys for offline replays; the live-merge-single-row rule covers the concurrent
case. No migration. **Rollback:** revert this item's commit; a stored `desc` is inert
to old code.

---

## Cross-cutting (ops)
- **One commit per item** (no version bump), then a **final trio-bump + changelog**
  commit via the `ship` skill: `config.js` APP_VERSION + `version.json` + `sw.js`
  CACHE_NAME **all three together** (the known trio-mismatch loop otherwise — see
  incident). Per-item rollback = `git revert <that item's sha>`.
- No Worker/DO change in any item; **no `wrangler deploy`** (verified: no
  /gcal /sms /helcim /terminal touch).
- TD port (v5.64–current) owed at batch end — not part of this build.
- Verification: run the app (preview) for items 2 & 5 (visual), 1 & 3 (interaction),
  4 (resize). Per-file `node --test-force-exit --test <file>` on Windows (globs hang).

## Decisions for owner sign-off
- **A — Item 4 min:** floor at 40% (= default, widen-only). Confirm you don't want a
  narrower-than-40% option. *(rec: 40% floor)*
- **C/H — Item 2 tray:** fixed ~100px height, 2 service lines + "+N more" for 3+
  (no grid jump) — OR content-driven height (shows all lines, floor scales smaller).
  *(rec: fixed + "+N more")*
- **E — Item 1:** visibility toggles stay instant-save. *(rec: yes)*
- **G — Item 1:** Description editor-only this batch. *(rec: yes)*
- **Scope/sequencing:** build all 5 now (item 1 last, on its own commit) — or ship
  2–5 first and treat item 1 as a separate follow-up build? *(rec: all 5, item 1 last)*
