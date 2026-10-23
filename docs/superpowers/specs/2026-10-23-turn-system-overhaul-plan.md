# Plan (v2, post-review) — Turn-counting system overhaul (2026-10-23) — PRIORITY batch

Four owner items reworking turn counting (high-risk fairness logic). **Pages-only** (turn logic + config are client-side; the DO only stores `config.set` values). Runs **before** the approved floor/customer/notes batch.

This v2 resolves the 4-lens adversarial review (correctness / fairness-ops / settings-data / ui-completeness). The biggest change from v1: **item A no longer uses a "provisional full" fallback** — see Item A.

## Scope of the safety invariant (corrected)
- **Item D (classification config) defaults reproduce TODAY exactly** — golden test on `classifyTurn` across the full cost sweep AND always-bonus (incl. cost 0). Nothing about classification changes until the owner toggles a setting.
- **Item A (count at done) is a deliberate owner-requested change, but opt-in per service:** a done/awaiting-price service counts early **only if it has an expected price** (or matches a by-service rule). Since no service has an expected price until the owner sets one, **the deploy itself changes nothing**; the owner opts a service in by giving it an expected price. No silent fairness change.

Owner decisions (AskUserQuestion, 2026-10-23): A = count done/awaiting-price via a per-service **expected price**, classification-only, never auto-filled. B = turn count in its own far-right column, money to its right when on. C = floor card shows bonus count. D = half/bonus each on/off; by cost and/or service (OR); thresholds + service lists; **precedence is a Settings dropdown** (default bonus>half>full); disabled category → full.

---

## Current behavior (ground truth)
- `classifyTurn(cost, serviceId)` (`turns.js:37-44`): **always-bonus service → `bonus` FIRST (before the cost<=0 gate)**; then `cost<=0` → `unpriced`; `≥fullMin($28)` → full; `≥halfMin($12)` → half; else bonus. So an unpriced always-bonus service already classifies `bonus` and shows in the `+Nb` tally today.
- `getTechTurns` (`turns.js:87-95`): full=1, half=0.5, bonus separate (NOT in `.total`), +skip=1 full. Grid counter (`turns.js:486-489`) mirrors it; `unpriced`→`'?'`, doesn't advance.
- Status (`status.js:7-41`): `waiting→inservice→complete→paid`. **"Done"=`a.status==='complete'`; "awaiting price"=`complete`+`a.awaitingPrice`.** Set by `markAwaitingPrice` (`queue.js:1245-1257`, sets `a.cost=0`,`complete`), cleared when priced (`queue.js:1065`, `staff.js:639`). Single trigger for item A = `a.status==='complete'`.
- **Comp** (v5.65 redesign): a comp KEEPS its real `a.cost` (tech still paid); only the customer's `lineCharge` is 0. So turn classification uses `a.cost` and a comp counts by its real price — **must use `a.cost`, never `lineCharge`** (verify in build; one awaiting-price→comp path may leave cost 0 — that path simply stays uncounted until priced, same as today).
- Config: `turn_config={fullMin,halfMin}` (`turns.js:28-33`, `saveTurnConfig` **overwrites the whole key with no merge**), `bonus_services=[]` (`turns.js:34-35`, in `store.js emptyConfig`). Settings UI `index.html:989-1016`, `settings.js:75-94`, seeded `settings.js:500-504`.
- Service `{id,label,abbr,baseCost}` (`catalog.js:110`). `baseCost` is a checkout placeholder AND seeds a back-dated historical record's real cost (`reports.js:3081`) → **not** purely "never auto-filled," so it can't be the classifier field.

---

## Item D (foundation) — configurable half/bonus classification

### Config model — extend `turn_config` (legacy-reproducing defaults)
`halfEnabled`(**true**), `bonusEnabled`(**true**), `halfByCost`(**true**), `halfByService`(**false**), `bonusByCost`(**true**), `bonusByService`(**true**), `fullMin`(28), `halfMin`(12), `precedence`(`'bonusFirst'`). Bonus-by-cost band = `0<amount<halfMin`. `getTurnConfig()` merges these defaults.
- New list `half_services=[]` → **add to `store.js emptyConfig()`** (so `hydrate` backfills it) + helpers `isHalfService`/`saveHalfServices` that read `(cfg().half_services||[])`. `bonus_services` stays the always-bonus list.
- **`saveTurnConfig` MUST merge** (`dispatch('config.set',{key:'turn_config',value:{...(cfg().turn_config||{}), ...patch}})`); **every** writer (incl. `saveTurnThresholds`, `settings.js:79`) passes a partial — no path may write a whole object that drops keys.

### Classifier (pure, TDD'd) — two functions used everywhere for consistency
`classifyAmount(amount, serviceId, cfg, {isBonusSvc, isHalfSvc})` → `'full'|'half'|'bonus'|'unpriced'`:
- `svcBonus = cfg.bonusEnabled && cfg.bonusByService && isBonusSvc`
- `svcHalf  = cfg.halfEnabled  && cfg.halfByService  && isHalfSvc`
- `costBonus = cfg.bonusEnabled && cfg.bonusByCost && amount>0 && amount<cfg.halfMin`
- `costHalf  = cfg.halfEnabled  && cfg.halfByCost  && amount>=cfg.halfMin && amount<cfg.fullMin`
- `costFull  = amount>=cfg.fullMin`
- **Unpriced gate (service rules bypass it — fixes always-bonus-$0):** if `amount<=0 && !svcBonus && !svcHalf` → `'unpriced'`.
- **Precedence (each mode precisely specified; TDD'd exhaustively):**
  - `bonusFirst` (default = today): `(svcBonus||costBonus) ? 'bonus' : (svcHalf||costHalf) ? 'half' : 'full'`.
  - `highestValue`: rank full>half>bonus — `(costFull || (amount>0 && !(svcHalf||costHalf) && !(svcBonus||costBonus))) ? 'full' : (svcHalf||costHalf) ? 'half' : (svcBonus||costBonus) ? 'bonus' : 'full'`. (Owner-chosen: cost can override an always-bonus tag — that's the point of this mode.)
  - `costWins`: if `amount>0`, classify by COST bands honoring method flags — `costFull?'full': (costHalf?'half': (costBonus?'bonus':'full'))`; if `amount<=0`, fall to service rules — `svcBonus?'bonus':svcHalf?'half':'unpriced'`.
- **Disabled category → full:** a disabled category never matches, so its candidates fall through to `'full'`. Both off ⇒ every priced/complete service = 1 full.

`classifyTurn(cost, serviceId)` = `classifyAmount(cost||0, serviceId, getTurnConfig(), {isBonusSvc:isAlwaysBonusService(serviceId), isHalfSvc:isHalfService(serviceId)})`. This is the canonical classifier for ALL priced callers — **live grid, history view (`turns.js:993-1064`), AND payroll/reports (`reports.js:575,886`) stay consistent by construction under any config.** Golden test: with default config, `classifyTurn` == legacy output for every cost band + always-bonus incl. cost 0.

### Settings UI — ONE render-leaf (resolves the extend-vs-render contradiction)
Convert `#turns-thresh-section` to a `render:'renderTurnsSettings'` leaf (`settings.js:351` nav gets `render:`; invoked at `settingsOpenLeaf`/`settings.js:469`). `renderTurnsSettings` owns ALL markup + seeding for the section; **delete the now-dead direct seeding at `settings.js:500-504`**; `index.html` keeps only an empty `<div id="turns-thresh-section">` container.
- Two mswitch toggles (Half, Bonus) + per-category **By cost**/**By service** checkboxes (both allowed); half-by-cost shows thresholds; half-by-service shows a new `#half-services-list` (clone `renderBonusServicesList`); bonus-by-service uses `#bonus-services-list`; bonus-by-cost shows an explanatory line.
- Precedence `<select>` (pattern `settings.js:188-192`). All write via merging `saveTurnConfig`/the service-list helpers, then re-render + toast.
- New inline handlers must be `export`ed so `main.js` `Object.assign(window,…)` attaches them (and `settingsOpenLeaf` resolves `window[item.render]`).

---

## Item A — count the turn at done/awaiting-price (expected-price-driven, NO provisional full)

`turnClassOf(a)` (status-aware; used by `getTechTurns` + the grid counter in place of raw `classifyTurn(a.cost)`):
- `amount = (a.cost>0) ? a.cost : ((a.status==='complete' && expectedPriceOf(a.serviceId)>0) ? expectedPriceOf(a.serviceId) : 0)`.
- return `classifyAmount(amount, a.serviceId, getTurnConfig(), {isBonusSvc, isHalfSvc})`.
- **Consequences (all intended):** a complete service with an expected price counts at that value; a complete service with **no** expected price and no cost and no service rule → `'unpriced'` → **not counted, exactly as today** (no provisional full); a priced service classifies by real cost (reclassifying away from the expected value); an always-bonus/half-by-service service still classifies by rule even unpriced (today's behavior preserved). Comp uses real `a.cost`.
- **Estimated cue:** when a turn number is derived from the expected price (not a real price yet), render it with a distinct "estimated" treatment (e.g. the grey `'?'`-style pill from `turns.js:258` carrying the number, or a `~`/°) so a number that may shift on pricing doesn't read as confirmed. Grid label: `'?'` only for `'unpriced'`; `'Bonus'` for bonus; estimated-styled number for expected-derived; solid number for priced.

### Expected-price source — REUSE `baseCost` (owner decision, 2026-10-23)
- `expectedPriceOf(id) = svc(id)?.baseCost`. **No new field, no editor/list changes.** The existing per-service Base cost doubles as the expected price for classifying an unpriced-complete turn.
- **Never written to `a.cost` by this feature** — it's read only inside `turnClassOf` for classification. (Owner accepted the noted caveat that `baseCost` already auto-seeds back-dated historical records at `reports.js:3081`; that pre-existing behavior is unchanged.)
- `baseCost`'s existing roles (checkout placeholder `queue.js:1448/1636`, historical seed) are untouched; this feature only *reads* it.

---

## Item B — Turns board: dedicated far-right turn-count column

- Row today (`turns.js:529`) = `${techCol}${rightSide}`, where `rightSide` (`turns.js:526-528`) wraps the scrolling `slotRow` (lane mode = a `flex:1` tinted box; divider mode = divider+slotRow).
- Change: append TWO new columns as **row-level `flex-shrink-0` siblings AFTER `${rightSide}`** (outside the `overflow-x-auto` scroll, outside the lane box — critical so they don't scroll or get hit by `.turns-slot-row .flex-shrink-0{width:130px}` at `styles.css:162`):
  - `turnsCountCol` (fixed width, e.g. 56px): the turn total (`3t`, half keeps the amber chip) + `+Nb` bonus beneath.
  - `moneyCol` (fixed width): the `billed` $, to the RIGHT of the turns column, shown only when totals are on — reuse the existing `.turns-billed`/`.turns-hide-totals` collapse (`styles.css:150`).
- Remove the inline `turnDisplay`/`billed` from `techCol` (`turns.js:458`); status chip stays in `techCol`. Add explicit widths + `.turns-large` overrides for the two new columns; verify the fixed left `techCol` (var `--turns-techcol-w`, up to 280px) + two right columns + scrolling slots fit on a 768px portrait iPad in large mode.
- **Scope note:** item B restyles the LIVE turns board only; the history/archived view (`turns.js:993-1064`) keeps its current layout (its COUNTS already stay consistent via the shared `classifyTurn`). Documented gap, not a drift.

---

## Item C — Floor plan: bonus-turn count on the tech card

- `renderFloorStaffRow` (`floorplan.js:192-201`): add a small secondary `+Nb` badge for `getTechTurns(id).bonus>0`, placed bottom-left of the 68px avatar (turnsBadge bottom-right, nextBadge top, grip top-left already present — bottom-left is free). **Match the existing hardcoded floor palette** (the floor card is intentionally light-only hardcoded hex, e.g. `#1a5252`; a token-based badge would visually diverge from its neighbors — reserve tokens for the Settings markup).
- Adjacency: same card as the queued batch's Item 2b (timer); separate commits, mind the shared markup.

---

## Tests (TDD)
- `test/turn-classify.test.js`: `classifyAmount` across every toggle/method/precedence combo; **golden: default config == legacy `classifyTurn`** over a cost sweep + always-bonus at cost 0; all three precedence modes incl. always-bonus-priced-as-full; disabled-category→full; method-flag respect under `costWins`.
- `turnClassOf`: in-service-unpriced→unpriced; complete+no-expected→unpriced (NOT full); complete+expected→classified at expected; priced→reclassified by cost; always-bonus unpriced→bonus; comp uses `a.cost`.
- **Integration parity:** `getTechTurns` over a realistic queue (priced + complete-unpriced + comped + always-bonus) with DEFAULT config yields byte-identical totals to today (proves no fairness change on deploy).
- Settings: `getTurnConfig` merge keeps existing keys; partial `saveTurnConfig` never drops keys; `half_services` helpers guarded; `expectedPriceOf`.
- Windows: `node --test-force-exit --test <file>` per file.

## Cross-cutting
- **Pages-only; no `wrangler deploy`.** Version trio bumped once at ship (+ What's-New). Build on `dev`; commits per item (D → A → B → C). Confirm trio STAGED (v5.72 incident). `store.js` is in scope (emptyConfig).
- **Back-compat/rollback:** additive (`turn_config` new keys default to legacy; `half_services` default `[]`; optional `expectedPrice`). Revert = drop commits; old code ignores new keys. **Fleet note (What's-New/owner):** after changing turn settings, reload all devices (`↻`) — a device on the old bundle counts by old rules until it reloads.
- **TD port (batch end):** whole turn-system overhaul joins the owed TurnDesk ports.

## Sign-off (owner, 2026-10-23) — ALL RESOLVED
1. **Item A semantics:** expected-price-only, NO provisional-full guess. A done/awaiting-price service counts early only if its `baseCost` (expected price) > 0; otherwise it counts when the real price is entered, exactly as today. ✓
2. **Expected-price source:** REUSE `baseCost` (no new field). ✓
3. **Item B column order:** turn count far-right, money column to its right when totals are on. ✓
4. Decided in-plan: defaults reproduce today (golden + integration parity test); disabled→full; precedence dropdown default bonus>half>full; estimated cue for expected-derived numbers; history view keeps its layout.

**GATE:** plan complete + approved on all open questions — **awaiting owner's explicit go before writing code** (owner asked to pause here).
