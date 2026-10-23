# Price Menu editor redesign — Option B (list + editor) — plan

**Status:** PLAN — awaiting adversarial review + owner sign-off. No code yet.
**Date:** 2026-10-22. Repo: `musedashboard`. File of record for the editor shipped in v5.71.

## Why
The current editor (Settings → Business → Price Menu) renders every service as a fully-expanded card
(name, price, description, variants editor, add-ons editor, a 5-control row) across 2 pages × 2 columns —
a dense "wall" with lots of wasted space. Owner: "too clunky, too much wasted space." Chosen direction
(from 3 mockups): **B — a list + editor panel (master-detail)**, with the **simpler** left list (grouped
by section only; the printed page/column handled behind the scenes).

## What changes — and what explicitly does NOT
- **Changes:** ONLY the editor's render + interaction in `js/app/features/pricemenu-editor.js`, plus
  `.pm2-*` styles in `css/styles.css`. The Settings section container (`#settings-pricemenu-section`) and
  nav entry are unchanged.
- **UNCHANGED (reused as-is):**
  - The data model `config.price_menu` (pages → cols[][] → items `sec|row`, variants/addons, foot lines).
  - The printed menu: `guide.js priceMenuToHtml / priceMenuDoc / openPriceMenuPreview` — the print layout
    (explicit 2 columns, 2 pages) is NOT changed. The editor keeps editing the same cols[][] structure.
  - Every pure mutator: `pmSetField, pmSetSubField, pmSetFoot, pmAddItem, pmRemoveItem, pmRemoveSection,
    pmMoveItem(up/down), pmRelocateItem, pmMoveTo, pmAddSub, pmRemoveSub, pmAddFoot, pmRemoveFoot, pmIsDirty,
    pmFind, _clone` — and their unit tests (`test/price-menu-editor.test.js`).
  - Save / Cancel / Reset / Preview / filter, the draft model (`_pmDraft`/`_pmBaseline`/`_rawCfg`), and the
    **unsaved-changes guard** (`pmEditorHasUnsaved`, `pmGuardLeave`, the chokepoints in main.js/settings.js,
    `#pm-unsaved-modal`). Save still dispatches `_clone(_pmDraft)`. All unchanged.

## New layout
**Toolbar** (top): filter search · Preview · Reset to default · Cancel · Save menu (Save enabled only when dirty).

**Below, two panes** (`.pm2-main`):
- **Left list** (`.pm2-list`) — the whole menu in document order, grouped by SECTION only:
  - For each page, in order: its section headers (bold, with a grip) and under each, its service rows
    (name + price only, with a grip). NO "Page"/"Left column"/"Right column" labels (owner's call).
  - A subtle **"Page settings · <title>"** entry at the end of each page's items (one per page) — selecting it
    opens the page's title + footer-lines editor in the panel (preserves page-title + footer editing, which
    the hidden-column list would otherwise drop).
  - Section names can repeat across pages (e.g. "Color Changes" on both pages); document order + the panel's
    "Prints in" line disambiguate. Accepted (simpler, matches owner's intent).
  - "+ Section" / "+ Service" affordance (see Add behavior).
  - The selected item row is highlighted (teal). Clicking a row selects it → panel shows its editor.
  - Drag a row/section by its grip to reorder (reuses the existing pointer-drag infra).
- **Right panel** (`.pm2-panel`) — edits ONLY the selected item:
  - **Service row:** name, price, description, Variants (pick one) list, Add-ons list, a **"Prints in"**
    page·column `<select>`, and Delete. (Variants/addons reuse pmAddSub/pmRemoveSub/pmSetSubField.)
  - **Section:** heading, optional note, "Prints in", Delete (removes the section + its contiguous rows,
    with a confirm — reuses pmRemoveSection).
  - **Page settings:** page title (pmSetField on the page / pmEditPage) + footer lines editor (pmAddFoot/
    pmSetFoot/pmRemoveFoot, with the Normal/Discount/Fine-print class select).
  - **Nothing selected:** empty state "Select a service on the left to edit it."

## New UI state (render-only, not persisted)
- `_pmSel` = selected node id (row | sec | `page:<id>` sentinel for Page settings) | null.
- `_pmStack` (narrow screens) = 'list' | 'detail' — on a narrow iPad the panes stack: list full-width;
  tapping a row switches to the detail panel with a "‹ Back to list". CSS media query + this flag.
- Selecting/first-render: default `_pmSel` to the first service, so the panel isn't empty on open (desktop);
  on narrow, open to the list.

## "Prints in" + drag → column/page (the one genuinely new bit of logic)
Columns are hidden in the list, but the data keeps explicit `cols[0]`/`cols[1]`. Two ways to set them:
1. **"Prints in" select** in the panel → page + column; moving reuses `pmMoveTo(draft, id, targetColId, beforeId)`
   (append to the target column).
2. **Drag** in the flattened list → map the drop position to a `(colId, beforeId)` and call the same `pmMoveTo`.
- **New pure helper `pmFlatten(draft)`** → ordered array of `{ id, kind, pageId, colIndex, colId }` for every
  item in document order (page→col0→col1). Drives the list render AND the drag drop-target mapping. Unit-tested.
- **New pure helper `pmDropTarget(draft, overId, before)`** → returns `{ colId, beforeId }` for a drop above/below
  `overId`, so drag reorder/cross-column reuse pmMoveTo. Unit-tested (incl. drop at a section header = into that
  section's column before its first row; drop at end of a page).

## Add behavior
- "+ Service" / "+ Section": new item is added into the column of the current selection (or page 1 / col 0 when
  nothing is selected), after the selection, via `pmAddItem`/`pmAddAfter`; then auto-select it so the panel opens
  for immediate naming. Owner can relocate via "Prints in". (No per-column add buttons — columns are hidden.)

## Caret-safe live editing
Panel text edits use `oninput` → mutate the draft WITHOUT a full re-render (the existing `_afterText` pattern,
caret-safe). To keep the left list's name/price in sync as you type, do a **targeted DOM update** of just the
selected list row's name/price text (no re-render, no caret loss). Structural edits (add/remove/move/reorder,
select change) re-render both panes (the existing `_afterStructural`).

## Filter
The toolbar filter hides non-matching rows in the LEFT list (reuse the `data-pm-text` + `.hidden` toggle). If the
currently-selected item is filtered out, the panel still shows it (selection is independent of the list filter).

## Tests
- Keep all existing `test/price-menu-editor.test.js` (mutators unchanged) + `test/price-menu.test.js` (print).
- Add pure-helper tests: `pmFlatten` (order across pages/cols; ids/colIds correct) and `pmDropTarget`
  (reorder within a column; move across the hidden column boundary; drop on a section header; drop at page end;
  self-drop no-op).
- Manual browser verify (preview): open editor, select a service, edit name/price (list updates, caret kept),
  add/delete a service + section, drag to reorder + across columns, "Prints in" move, Preview matches, Save
  enables only when dirty, the unsaved-guard still fires on nav-away, responsive stack on a narrow window.

## Risk / rollback
- No data-model, Worker, or print change → no migration, no deploy. Pure client render swap. Rollback = revert the
  one commit. Blast radius: the editor UI only; the printed customer menu and saved data are untouched.
- Main risks (all UI): the drag→column mapping (mitigated by the tested `pmFlatten`/`pmDropTarget` helpers), and
  keeping the Save/guard wiring intact (mitigated by reusing them unchanged). Ship = version trio + What's-New,
  Pages-only (no Worker).

---

## Revisions from the adversarial review (v2 — APPLIED; this section is authoritative where it overlaps above)

### Correctness / reuse corrections
- **Drag is a REWRITE of the drop-resolution, not a reuse.** The pointerdown/ghost/pointer-capture machinery
  (`_pmInitDrag`/`_pmDragDown`/`_pmStartDrag`, keyed off `.pm-drag`→`.pm-card`→`dataset.pmCard`) IS reused. But
  `_pmDropSpec` (finds the target via `.pm-col` DOM), `_pmNextCard` (DOM-sibling beforeId), and the `.pm-col`
  highlight + drop branch in `_pmDragMove`/`_pmDragUp` are column-DOM-coupled and must be **rewritten** to derive
  `{colId, beforeId}` from the MODEL via `pmFlatten`/`pmDropTarget` (keyed off the hovered row's `data-pm-card`).
  Without this, drag is a no-op in a column-less list.
- **`pmFlatten` is mandatory (not a convenience):** `pmFind` returns no pageId/colId, so the "Prints in" select
  (needs the item's current colId to mark selected) and "+ Service after selection" (needs the colId for
  `pmAddItem(draft, colId, kind, afterId)`) both read `{id, colId}` from `pmFlatten`. `_moveOpts` is reused to
  build the "Prints in" options.
- **`_pmSel` re-resolves after every destructive/replacing op** (delete, reset, cancel, cross-device reload):
  fall back to the deleted node's neighbor → else the section header → else first service → else empty state. The
  panel renders defensively (`pmFind` null → empty state, never throws).
- Doc fixes: the pure mutator is `pmAddItem` (`pmAddAfter` is its window handler). Page-title field keeps
  `onchange` (not oninput) to avoid a caret trap.

### UX / completeness corrections
- **Keep a non-draggable PAGE divider in the list** (e.g. "— Foot Services —") so the two pages are visually
  separated, and a **greyed page hint** on rows where helpful. COLUMNS stay unlabeled (owner's call), but PAGES
  do not — because the default menu has duplicate section names ("Color Changes", "Little Ones") AND duplicate
  service names at different prices ("French Tip" $7 hand / $5 foot) split across the two pages; a fully label-free
  list makes them indistinguishable and invites wrong-item edits. ⭐ This is the one deliberate deviation from
  "hide everything" — called out for owner sign-off.
- **A cross-PAGE drag asks to confirm** (moving an item to the other printed page is a bigger deal than a reorder);
  within-page reorder/column-move is silent. `pmDropTarget` never relocates across pages without the confirm.
- **Service delete now confirms too** (reuses `showWarnModal`) — in master-detail the panel's single Delete button
  has a bigger blast radius than the old icon; section delete already confirms.
- **Filter keeps the parent section header visible** for any matched row (and a matched section shows its rows);
  the Page-divider and "Page settings" sentinel are excluded from the filter so they never strand.
- **Save is reachable on a narrow iPad in BOTH stacked views:** the toolbar (at least Save + Back) is sticky
  across the list and the detail view — you can save without going Back.
- **Keep the variant/add-on up/down arrows** in the panel (`pmSubUp`/`pmSubDn`) — order matters for a "pick one"
  variant list. (The list's own per-row up/down arrows ARE dropped in favor of drag + "Prints in"; accepted — a
  deliberate simplification, drag is the reorder path on the iPad.)
- **Keep a blank-row cue** (`pm-blank`-style) on an unnamed new service/section in the list so half-built rows
  aren't lost.
- **Number the pages in "Prints in"** labels ("Page 1 (Hand Services) · Left") so the control the design leans on
  to disambiguate isn't itself ambiguous when titles repeat or are blank.
- **One-line helper text:** "This prints as a 2-column menu — tap Preview to see the layout," so the hidden-column
  model is discoverable.

### Tests added
- `pmFlatten`: document order across pages/cols, correct `{id, kind, pageId, colIndex, colId}`.
- `pmDropTarget`: reorder within a column; move across the hidden column boundary; drop on a section header (→
  into that section's column before its first row); drop at page end; **drop on a zero-row section, on the
  Page-settings sentinel, and self-drop = defined no-op**; a cross-page target is flagged (so the handler can
  confirm).

## Open question for the owner (sign-off)
1. **The page divider (the one deviation):** OK to show a thin non-draggable page separator + a greyed page hint,
   while keeping the Left/Right *column* labels hidden? (Strongly recommend yes — without it, the duplicate
   "Color Changes"/"French Tip" across pages are genuinely indistinguishable and easy to mis-edit.)
2. **Default selection on open:** first service selected (desktop) so the panel isn't empty; list view on narrow.
   (Recommend this.)
