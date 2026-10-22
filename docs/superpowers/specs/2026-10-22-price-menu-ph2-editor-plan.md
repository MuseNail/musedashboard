# Plan — Price menu Phase 2: the Settings editor — v2 (post-review)

Date: 2026-10-22 · Repo: musedashboard · Area: new `features/pricemenu-editor.js` + settings.js + index.html + guide.js (preview hook) · Pages-only. Builds on Phase 1 (committed, unshipped).

> **v2 note.** A 4-lens review found the feature right but the plan not buildable as written. Folded in, and
> the work is **re-split to de-risk** (all unshipped until the end):
> - **2a-core** — the editor itself (section wiring, render, text-edit, add/remove, ↑↓, Move-to, variants/add-ons,
>   footer, preview-of-draft, filter, Save/Cancel/Reset). + a `beforeunload` backstop while dirty.
> - **2a-guard** — the in-app click-out guard (its own slice: a **dedicated 3-button** Unsaved-changes modal +
>   chokepoint checks in `showDashPanel`, the back-gesture, and settings nav). Touches core navigation → built and
>   reviewed on its own, on the known-good 2a-core.
> - **2b** — pointer drag-and-drop.
> Blockers fixed: the 3-button guard can't reuse the 2-button `showWarnModal` → **new dedicated modal**; the real
> exits are `showDashPanel` (main.js:462, before its `closeAllModals`) + the back-gesture (`popstate`/`goTo`,
> main.js:101) + settings nav, NOT just settings nav. Majors fixed: escape every editor `<input value>`; a
> section move takes its **contiguous rows** with it; reorder **clamps** at the ends; **id-stamp pages + foot
> lines**; render **N pages/cols generically** (never assume/clobber 2×2 — CLAUDE.md data-integrity); derive
> page/column labels from the editable `p.title`; preview **reuses one named tab** and renders the **literal
> draft** (not the empty→default fallback) with an **overflow banner measured in the preview**.

## Goal
An owner-facing Settings editor for `config.price_menu`: edit section/service text + prices + descriptions,
add/remove sections and services, reorder + relocate across columns/pages, edit a service's variants (pick-one)
and add-ons (stackable), edit footers, with a live draft preview, a filter, Reset-to-default, Save/Cancel, and
(2a-guard) a "you have unsaved changes" prompt on click-out.

## Grounded facts
- Settings sections: a nav array of `{label, sub, content:'settings-X-section', render:'renderX', icon, adminOnly}`
  (settings.js ~L348-376); each needs a `<div id="settings-X-section" class="hidden …">` in index.html and a
  `renderX()` that fills it. `settingsOpenLeaf('<content>')` calls `window[item.render]?.()` (settings.js:461) —
  so the renderer + all `pm*` inline-onclick handlers must be window-glued. An incoming sync does NOT re-render
  Settings (`onStateChange` has no `panel-settings` case, main.js:665-673) → a dirty draft survives background syncs.
- Phase 1 (guide.js, exported): `normalizePriceMenu`, `priceMenuToHtml`, `DEFAULT_PRICE_MENU`, `openPriceMenu`.
  `priceMenuDoc` is NOT exported. Nodes carry stable `id`s; **pages + foot lines do NOT yet have ids** (add in 2a).
  `normalizePriceMenu` falls back to DEFAULT when the whole menu has no content (guide.js:218).
- `showWarnModal(title, body, onConfirm, confirmLabel)` is **2-button** (one action + Cancel) — can't do 3-way.
- Nav exits: `showDashPanel` (main.js:462, runs `closeAllModals()` first), back-gesture `popstate→goTo`
  (main.js:101), settings `settingsOpenLeaf`/`settingsBack`/`settingsNavRoot`, account-menu/logout, `beforeunload`.
- Config write: `dispatch('config.set', {key:'price_menu', value})` — synced, per-key stale-guarded, whole-key.

## Normalize additions (guide.js, additive, Phase 2)
- `normalizePriceMenu` also stamps a stable `id` on each **page** and each **foot line** (backfill if missing),
  so the editor keys EVERYTHING by id. Still idempotent; the Phase-1 default render is unaffected (ids aren't
  rendered). Keep the content-empty→DEFAULT fallback for the customer render; add an opt-out for preview (below).

## Sub-phase 2a-core (editor, no in-app nav guard)

### Module + Settings wiring
- New `js/app/features/pricemenu-editor.js` (module-per-feature; keeps settings.js lean). Exports the render +
  mutators + handlers; imported by main.js glue so inline `onclick` resolves.
- Settings nav entry (Business category, `icon:'receipt_long'`, **`adminOnly:true`** — it's pricing/branding, like
  Receipt/Waiver): `{label:'Price Menu', sub:'Edit the printed customer menu', content:'settings-pricemenu-section',
  render:'renderPriceMenuEditor', adminOnly:true, icon:'receipt_long'}`. Add `<div id="settings-pricemenu-section"
  class="hidden px-5 py-4">` to index.html (pattern at index.html ~971).

### Draft model + render boundary
- Module state: `_pmDraft` (deep clone of the normalized live menu) + `_pmBaseline` (JSON string at open/after
  save) + `_pmFilter`. **`renderPriceMenuEditor()` inits `_pmDraft` ONLY when null**, else it just paints — so a
  structural re-render never wipes in-progress edits (settings re-invokes the renderer on open; this guard makes
  "open fresh" vs "repaint" safe). Cancel/Discard/confirmed-leave set `_pmDraft = null`.
- **Text edits:** `oninput` mutates `_pmDraft` by id and does NOT re-render (caret-safe). **Structural edits**
  (add/remove/↑↓/Move-to, add/remove variant/add-on, footer add/remove) mutate then `renderPriceMenuEditor()`.
  The filter is re-applied after every render via `.hidden` toggling (never a re-render of the filter input).
- **Escape every value rendered into an `<input value="…">`/attribute with `escHtml`** (owner text is stored
  decoded; a `"` in a name/price/desc would break the input / inject). Inline onclick ids go through `escAttrJs`.

### Pure mutators (by id; find-by-id returns {arr, idx, node})
`pmFind(draft, id)` → the containing array + index + node (scans pages→cols→items→variants→addons→foot). Then:
`pmSetField(draft, id, field, val)` (deletes the key when val is '' for optional fields desc, to avoid false-dirty);
`pmAddItem(draft, pageId, colId, kind, afterId?)`; `pmRemoveItem(draft, id)`; `pmMoveItem(draft, id, dir)`
(**clamps at index 0 / last — no-op at the ends**); `pmRelocateItem(draft, id, pageId, colId)` — **moving a
`sec` takes its contiguous following rows (up to the next `sec`) as a group**; moving a `row` moves just it;
`pmAddSub/pmRemoveSub/pmSetSubField(draft, rowId, which, …)`; `pmAddFoot/pmRemoveFoot/pmSetFoot(draft, pageId, …)`.
All pure/by-id, no throw on a missing id.

### Editor UI (generic over N pages/cols — never hardcode 2×2)
Pages stacked (no switcher). Per page: a `title` input; a column-count-agnostic row of column panels; a footer
editor (lines: text input + cls select None/cash/fix, add/remove). Per column: ordered item cards —
- **section** card: `label` + optional `desc` inputs; ✕; ↑/↓; a **Move to ▾** menu whose targets are derived from
  each page's live `title` + "Left/Right" (so renaming a page relabels the menu); + Section / + Service inserts.
- **service** card: `nm`+`pr`+optional `desc`; collapsible **Variants** and **Add-ons** sub-lists (each
  `nm`+`pr`+`desc`, add/remove/↑↓); ✕; ↑/↓; Move to ▾.
A blank section label / blank row name gets a soft warning highlight (non-blocking).

### Preview of the DRAFT (guide.js)
- `priceMenuDoc(logoUrl, menuOverride, { allowEmpty })` — no override → Phase-1 path unchanged; override → render
  it. Export `openPriceMenuPreview(menu)`: builds the doc from `menu` (via `priceMenuToHtml`, escaped), **bypasses
  the content-empty→DEFAULT fallback** (preview shows the literal draft, even mid-build), and opens it in a
  **single reused tab** `window.open(url, 'muse-price-preview')` with the existing popup-blocked guard, called
  synchronously in the click handler. The preview doc includes a tiny script that flags any `.page` whose
  `scrollHeight > clientHeight` with a **"this page is too long to print on one sheet"** banner — accurate
  overflow detection using the real print fonts/metrics (replaces the unreliable editor line-count heuristic).

### Save / Cancel / Reset (2a-core; the click-out guard is 2a-guard)
- **Dirty** = `JSON.stringify(_pmDraft) !== _pmBaseline` (a pure `pmIsDirty()` — testable).
- **Save:** re-read `getState().config.price_menu`; if it changed since open, confirm "changed on another device —
  save anyway?" (mirrors queue.js:973). Then `dispatch('config.set', {key:'price_menu', value:_pmDraft})`; toast;
  re-baseline. (A content-empty save can't blank the customer menu — Phase-1 reader falls back; the editor warns.)
- **Cancel:** if dirty, confirm discard; then `_pmDraft=null` + re-render (re-inits from live config).
- **Reset to default:** confirm → `_pmDraft = clone(normalized DEFAULT_PRICE_MENU)`; re-render.
- **`beforeunload` backstop:** registered only while dirty, torn down on save/discard/close (so it never blocks
  the version-badge hard-reload, main.js:681).

## Sub-phase 2a-guard (in-app click-out guard — its own build + review)
- A **dedicated** Unsaved-changes modal (new `#pm-unsaved-modal` in index.html) with **Save / Discard / Keep
  editing**. `pmGuardLeave(onLeave)`: not-open/clean → `onLeave()` now; dirty → show the modal (Save: save then
  onLeave; Discard: `_pmDraft=null` then onLeave; Keep editing: dismiss).
- Chokepoints (each a one-line early-return at the TOP, before side effects): `showDashPanel` (before its
  `closeAllModals`), the back-gesture handler (`popstate`/`goTo`, main.js:101), and settings
  `settingsOpenLeaf`/`settingsBack`/`settingsNavRoot`. Each: `if (window.pmGuardLeave && _pmEditorDirty) { guard,
  re-invoke via onLeave } else proceed`. Keyed off the editor being open+dirty so it's inert everywhere else.

## Sub-phase 2b — pointer drag-and-drop (mouse + touch) to relocate items, layered on 2a.

## Test plan (TDD)
- Unit (`test/price-menu-editor.test.js`): the pure mutators + `pmFind` + `pmIsDirty` + id-stamp of pages/foots
  — set/add/remove by id; reorder clamps at both ends (no-op, no `-1`); relocate a section carries its contiguous
  rows; relocate a row moves only it; sub add/remove/set by rowId+subId; foot ops by pageId; setField deletes an
  empty optional key (no false-dirty); pmFind returns {arr,idx} and no-throws on a missing id; a generic 3-column
  page survives a mutate (no data dropped). Preview: `priceMenuDoc(url, draft, {allowEmpty:true})` renders a
  blank-ish draft without the DEFAULT fallback.
- DOM/wiring → diff review + preview boot check (section renders, handlers window-glued, editing updates the draft,
  Save dispatches, preview reuses one tab). 2a-guard: a boot check that a dirty editor + `showDashPanel`/back pops
  the modal and Keep-editing stays.
- Full suite green. Owner eyeball per sub-phase.

## Rollback
Additive: a new module, one Settings section + container, a `menuOverride` param on `priceMenuDoc`, id-stamping
in normalize, and (2a-guard) a modal + chokepoint checks. No schema/op/Worker change → Pages-only. Revert per sub-phase.

## TurnDesk parity (noted)
TurnDesk already ships a Price Menu (td-v0.51/52). Phase-1/2's data-driven engine + editor must be **reconciled**
with TD's existing feature, not blindly duplicated, and the default swapped per-salon. Log on MUSE-PARITY-BACKLOG.

## Open questions for the owner
None blocking — the review's decisions are folded (dedicated 3-button guard modal; section-moves-with-rows;
generic N columns; preview reuses one tab + shows the literal draft with an accurate overflow banner; adminOnly).
I'll build **2a-core** first. Flag if you'd rather the Price Menu editor be available to front-desk (non-admin)
users too, or stay manager/admin-only (my default).
