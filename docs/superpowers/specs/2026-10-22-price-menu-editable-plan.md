# Plan — Editable, tiered, searchable price menu (Wave 3 / roadmap #14) — PHASED

Date: 2026-10-22 · Repo: musedashboard (ports to TurnDesk) · Area: guide.js (menu) + settings.js (editor, Ph2) + a lookup surface (Ph3) · Pages-only (config-driven)

## Owner-approved scope + sequencing
A tiered, searchable, owner-editable price menu, built **phase by phase** (each a full rigorous-build + ship):
- **Phase 1 — foundation (ACTIVE):** data-drive the menu from `config.price_menu` (seeded = today's exact menu),
  with a **tiered model** — a service can have pick-one **variants** AND stackable **add-ons** — rendered
  indented under the service. No editor/search yet. Menu looks identical until tiers are added.
- **Phase 2 — Full editor:** Settings editor — edit/add/remove/reorder + **drag** sections, services, variants,
  add-ons across columns + both pages; footers; reset-to-default; live preview; a filter box to find a row.
- **Phase 3 — Desk price lookup:** a staff "how much is X?" search (type a service → price + its tiers).
- **Phase 4 — later (owner: "after"):** read-only searchable menu on the technician staff app.

Stays SEPARATE from the checkout `SERVICES` catalog (CLAUDE.md keeps those apart); this is display + lookup only.

## Grounded facts
- `guide.js openPriceMenu()` → `priceMenuDoc(logoUrl)` (guide.js:81-176): a fixed HTML string, 2 `.page`s
  ("Hand Services" / "Foot Services & Waxing"), each a `.cols` grid of 2 `.col`s; a col is `.sec` headings
  (some with a `.desc` sub-line), `.row`s (`.nm` · dotted `.dots` · `.pr`) with an optional following `.desc`;
  each page ends with a `.foot` (paragraphs; a `.cash` line; page 1 has a `.fix` line). CSS = `PRICE_MENU_STYLE`
  (guide.js:53-79). Prices are free text ("$38", "$56 / 46", "from $7"). Not catalog-driven (deliberate).
- Config writes: `dispatch('config.set', {key, value})`, synced + per-key stale-guarded. No new op/Worker change.

## PHASE 1 — data model + tiered render (the active build) — v2, post-review

> Review folded in: **(blocker)** store the default as DECODED text + escape once (raw source has `&amp;`/`&nbsp;`
> → escaping raw = `&amp;amp;` garbage); **(blocker)** a malformed `price_menu` must NOT blank the customer menu —
> validate + fall back + render defensively; **(major)** goal is VISUAL/render-equivalent, not byte-equivalent;
> escape `page.title` too and whitelist `foot.cls`; the section-desc `margin-top:0` quirk; **(major)** seed stable
> `id`s now (Phase 2 drag + Phase 3 search path need them; retrofitting persisted menus later is a real migration).

### Data model — `config.price_menu`
```
{ v: 1,
  pages: [ { title: 'Hand Services',
             cols: [ [ item, … ], [ item, … ] ],          // 2 columns (renderer tolerates ≠2)
             foot: [ { text: '…', cls: '' | 'cash' | 'fix' }, … ] }, … ] }
item = { id, t:'sec', label, desc? }
     | { id, t:'row', nm, pr, desc?,
         variants?: [ { id, nm, pr, desc? }, … ],   // pick-one priced options (Full set / Fill)
         addons?:   [ { id, nm, pr, desc? }, … ] }  // stackable extras (+ French tip $7)
```
- **Stored DECODED:** owner text holds real characters (`Pink & White`, a real U+00A0 where the source used
  `&nbsp;`), NEVER HTML entities. The renderer escapes once → `&amp;`; U+00A0 renders as a non-breaking space
  (visually identical, not byte-identical — that's fine, the goal is visual equivalence).
- **Stable `id`** on every sec/row/variant/addon (seeded in `DEFAULT_PRICE_MENU`). `normalizePriceMenu` backfills
  ids on read for any stored menu missing them, so Phase 2/3 never face a migration.
- `DEFAULT_PRICE_MENU` = today's content as decoded data (no variants/addons yet — existing rows, incl. free-text
  "$56 / 46", stay as-is). SEED + fallback. `v:1` for future shape migrations.

### Read path — hardened (guide.js)
- `normalizePriceMenu(stored)`: returns a valid menu or `DEFAULT_PRICE_MENU`. Rejects to default when `stored`
  isn't a well-formed `{pages:[…]}`; otherwise coerces per-node (skip `null`/unknown items, `String(x||'')`
  missing `nm/pr/label/title/text`, tolerate a `cols` not length 2, `foot`/`variants`/`addons` not arrays → []),
  and backfills missing `id`s. `priceMenuDoc` uses `normalizePriceMenu(getState().config.price_menu)`.
- `priceMenuDoc` wraps the build in try/catch → on ANY throw, render `DEFAULT_PRICE_MENU` (never a blank tab).
  Rationale: Phase 2 is the writer and ships later; for the whole window (and any bad/stale/partial sync write)
  the Phase-1 reader is the last defense, and the sink is `document.write` into a customer-facing tab. (v2.00
  stability-first; this config syncs cross-device.)

### Render (guide.js)
- Extract `DEFAULT_PRICE_MENU`; rewrite `priceMenuDoc` to build from the model via a **pure**
  `priceMenuToHtml(menu, logoTag, esc)` (no `getState` inside — menu passed in), **render/DOM-equivalent** to
  today for the default, plus:
  - **variants:** indented `.subrow` sub-lines under the parent (lighter `.nm`/`.pr`), with a small "choose one" cue.
  - **add-ons:** indented `.addon` `+ name … price` lines under the parent (after variants).
- `esc` = the repo's existing `escHtml` (escapes `& < > "`). Escape EVERY interpolated owner field: `page.title`,
  `label`, section/row `desc`, `nm`, `pr`, and variant/addon `nm/pr/desc`, and `foot.text`. The logo `alt` becomes
  `Muse Nails &amp; Spa` (valid markup). `foot.cls` is **whitelisted** to `{'', 'cash', 'fix'}` (not escaped) and a
  plain paragraph emits NO `class` attr (`cls ? ' class="'+cls+'"' : ''`) so the default stays class-for-class.
- CSS (`PRICE_MENU_STYLE`): add `.subrow`/`.addon` (indented, smaller, same colors, print-safe) AND a
  `.sec + .desc{margin-top:0}` rule so section sub-lines keep their tight top margin — then DROP the inline
  `style="margin-top:0"` the source had on those two descs (renderer emits a sec's desc right after the `.sec`,
  so the adjacent-sibling rule matches; row descs follow a `.row`, so they're unaffected).
- `openPriceMenu` is UNTOUCHED (keeps the popup-blocked guard + the `new URL('assets/…')` logo resolution).

### Overflow note (not fixed in Phase 1 — flagged for Phase 2)
`.page` is a hard `height:11in; overflow:hidden` (guide.js:61). Phase 1 ships safe (the default has no tiers), but
once the owner adds variants/add-ons in Phase 2 the extra lines could silently clip past 11in. Phase 2's editor
must handle this (warn on overflow / allow the on-screen page to grow / paginate). Recorded so it isn't a surprise.

### Phase-1 test plan (TDD)
- Unit (`test/price-menu.test.js`, exports `priceMenuToHtml`/`normalizePriceMenu`/`DEFAULT_PRICE_MENU`): a section
  (with/without desc), a row (with/without desc), a row with variants → `.subrow`s, a row with add-ons →
  `+`-lines, a row with both; escaping of `<`/`&`/`"` (NOT `'` — escHtml doesn't, and double-quoted attrs only) in
  every field incl. `page.title`; `foot.cls` whitelist drops a bad class; a plain foot `<p>` has no `class`;
  **malformed input** (`{}`, `pages` not array, `cols` length 1, a `null` item, a row missing `nm/pr`) →
  `normalizePriceMenu` returns a safe menu and `priceMenuToHtml` does NOT throw; `normalizePriceMenu` backfills a
  missing `id`; and a structural check that the DEFAULT renders the expected pieces (`.page`×2, `.sec`, `.row`,
  `.foot`, `.cash`, page-1 `.fix`).
- DOM/boot: `openPriceMenu` still opens; the default menu is visually unchanged (owner eyeball). I'll also demo a
  TIERED sample in the dev preview (variants + add-ons) to prove the render path — WITHOUT shipping tiers in the
  default — so the new render code is exercised in situ, not dead.
- Full suite green, per-file on Windows.

### Phase-1 rollback
Additive: one config key (`price_menu`, unset = today's menu), a data-driven `priceMenuDoc`, new sub-row CSS.
No schema/op/Worker change → Pages-only. Revert = one commit.

## Deferred to later phases (noted, not built in Phase 1)
- **Phase 2** editor shape (approved mockup: per-column item lists, inline inputs, ↑↓ + drag, +Section/+Service,
  nested variant/add-on editors, footer editor, preview, reset, filter). Writes `config.set price_menu`.
- **Phase 3** desk lookup: flatten the menu (rows + variants + add-ons) into searchable entries {label, price,
  path}; a search UI (likely in/near the global header search) answering "how much is X?".
- **Phase 4** staff-app read-only searchable menu.

## Open questions for the owner (Phase 1)
1. **Variant vs add-on render** — variants as indented "pick one" sub-lines; add-ons as indented "+ name  price"
   lines beneath them. OK, or do you picture them differently on the printed page? (We can tune in Phase 2 with
   the live preview, so this isn't blocking.)
2. Confirm Phase 1 ships with the menu **looking identical** to today (tiers only appear once you add them in
   Phase 2) — i.e. Phase 1 is plumbing you won't visibly see yet. OK to ship an invisible foundation, or would
   you rather I fold a first visible tier or two into the default so you can see it working?
