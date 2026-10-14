# Plan — Payroll "Total" column (sum across techs, read-only, override-aware)

Date: 2026-10-14 · Repo: musedashboard (carries to turndesk) · Area: `js/app/features/reports.js` `renderPayrollPage()` + `css/styles.css` (payroll money display)

## Goal (plain English)
On the Payroll tab's technician table (techs are columns, metrics are rows), add a
**Total** column pinned at the far left next to the row labels. For every row it shows
the whole-salon total across all technicians — total billed, commission, check, cash,
total paid, and each day. It is read-only (can't be right-click/edited) and always
reflects what's shown: if a tech's amount was manually overridden, the Total includes
the overridden value. It compares to last period (This / Δ / Last) just like the tech
columns. The front-desk section keeps its own separate Total row, unchanged.

## Owner-approved design (mockup signed off 2026-10-14)
- Sums **technicians only**; FD section untouched.
- **Pinned far left** (frozen) right after the 120px label column, so it stays visible
  while scrolling through techs.
- **Compares to last period** — Total group mirrors the per-tech `colsPer` structure
  (compare on: Billed|Comm|Δ|Last-Billed|Last-Comm = 5 cols; compare off: Billed|Comm = 2).
- **Light blue** highlight (NOT amber), bold, read-only, lock icon on the header.
- Every row gets a total, including the By-day rows. The Check # row has no total
  (check numbers aren't summable) — its Total cell is blank.

## Current code (grounded)
`renderPayrollPage()` builds `T = techs.map(...)` where each `x` carries: `c`/`p`
(current/prev `{billed, commission, refund, refundComm, daily}`), `cChk/pChk`,
`cDed/pDed`, `cCash/pCash`, `cTotal(=cChk+cCash)/pTotal`, `adj`. **Crucially, `T` is then
mutated in place by the lock-snapshot blocks** ([reports.js:1606-1622](../../../js/app/features/reports.js)) —
a locked period overwrites `x.c`, `x.cChk`, `x.cCash`, `x.cTotal`, etc. with the frozen
snapshot. Overrides (`payroll_adj`) are already folded into `cChk/cCash/cDed` earlier.
Rows are built from helpers `quad` (billed|comm), `ovCell` (editable check/ded/cash,
colspan 3+2), `span2` (total paid), `dquad` (daily), `refCells`. `colsPer = cmp ? 5 : 2`.
Header is `head1/head2/head3`. CSS: `.sticky-col` is `position:sticky;left:0;width:120px`.

## Approach

### 1. Pure, testable summation — `payrollColumnTotals(T)`
A new exported pure function that sums across the (already override-and-lock-resolved)
`T` rows and returns a totals object:
```
{ billed, comm, pBilled, pComm, refund, refundComm, pRefund, pRefundComm,
  chk, pChk, ded, pDed, cash, pCash, total, pTotal,
  daily: { [dayKey]: {billed, comm} }, pDaily: { [prevDayKey]: {billed, comm} } }
```
Summed from `x.c.billed`, `x.c.commission`, `x.p.*`, `x.cChk/pChk`, `x.cDed/pDed`,
`x.cCash/pCash`, `x.cTotal/pTotal`, and per-day `x.c.daily[day]` / `x.p.daily[prevDay]`.
Called **after** the lock-snapshot mutation so the totals match the displayed cells
exactly. Mirrors the repo's pure-fn convention (`_netComm`, `_decideCacheLoad`).
Unit-tested (the correctness-critical piece): overrides, lock snapshot, refunds, empty.

### 2. Read-only Total column-group, prepended to every row
Build Total cells with the SAME colspan structure as each row, inserted immediately
after the sticky label `<td>` and before `T.map(...)`:
- Total row → `billed|comm (|Δ|last-billed|last-comm)` from TOT (reuse `quad`-shaped markup).
- Refunds row (same conditional as today) → summed refund/refundComm.
- Check / Cash deduction / Cash → single value colspan `cmp?3:2` (This) + colspan 2 (Last),
  but as PLAIN read-only `<td>` (no `data-field`, no `oncontextmenu/ondblclick`).
- Check # → blank Total cell.
- Total paid → summed `total`/`pTotal`, bold.
- Day rows → summed per-day billed/comm.
Δ uses the existing `_pcmp(totBilled, totPrevBilled)`.

### 3. Pin + style (CSS in `css/styles.css`, per CLAUDE.md)
New classes for the Total column: `position:sticky` with cumulative `left` starting at
120px (label width). To make multi-column sticky offsets reliable, the Total sub-columns
get **fixed widths** (money ~68px, Δ ~30px) so declared `left` matches rendered width.
Light-blue fill (e.g. `#d9e9f6`, Total-paid row a touch deeper `#c7ddf1`), a 2px right
border to separate it from the first tech, bold. Header cells sticky too (higher z-index,
teal bg like other headers) with a lock glyph on the "Total" label. Reuse existing
`staff-sep`/`thislast-sep`/`arrow-col` spacing inside the group.

### 4. Header
Prepend to `head1` a `Total` `<th colspan="${colsPer}">` (sticky, lock icon); to `head2`
the This/Δ/Last sub-head; to `head3` the Billed/Comm(/Δ/Billed/Comm) labels — all sticky
at the cumulative lefts.

## Files touched
- `js/app/features/reports.js` — `payrollColumnTotals()` (exported), the Total column-group
  cells in each row of `rows[]`, and the three header rows. New `// ── … ──` not needed
  (stays within the existing Payroll section).
- `css/styles.css` — `.ptot*` sticky/width/color classes for the pinned Total column.
- `test/payroll-total.test.js` (new) — `import './setup-globals.js'` first; unit-test
  `payrollColumnTotals`.

## Test plan
- Unit: `payrollColumnTotals` — sums billed/comm/chk/ded/cash/total + daily across techs;
  reflects an overridden `cChk` (not the rule value); reflects a lock-snapshot-mutated row;
  includes refunds; empty `T` → all zeros; prev-period fields summed.
- Full suite stays green (per-file on Windows).
- **Preview verification** (browser-observable): open the app, Payroll tab, confirm the
  pinned light-blue Total column renders, stays frozen while scrolling techs horizontally,
  totals match a hand-sum, an override flows into the Total, compare on AND off both lay out
  correctly, and the lock snapshot still matches.

## Rollback
Additive display-only (no persisted data / schema change). Revert the commit.

## TurnDesk carryover
`turndesk/js/app/features/reports.js` payroll table is the same shape; port after Muse
ships + preview-verifies. Log in `turndesk/docs/MUSE-PORT-LOG.md`.

## Resolutions from adversarial review (wf_32e12986) — applied before build
- **Daily crash guard (blocker):** `payrollColumnTotals` default-guards every per-day lookup
  `(x.c.daily[day] || {billed:0,commission:0})` and iterates the SAME `curDays`/`prevDays`
  arrays with the SAME index pairing the render uses. Returns daily totals as ARRAYS aligned
  to `curDays`/`prevDays` (not a day-keyed map) so the index-paired render loop consumes them
  directly. (Takes `curDays`, `prevDays` as args.)
- **NaN coercion (high):** every summed term is `|| 0`-coerced (old lock snapshots can carry
  `undefined` deduction/total; one NaN would poison a whole column to `$NaN`).
- **Raw commission (med):** sum raw `x.c.commission`/`x.p.commission` (NOT `_netComm`) so the
  Total Comm matches the displayed per-tech Comm; refunds stay their own row.
- **Refunds (med):** stored NEGATIVE; sum raw and format the Total cell exactly like `refCells`
  (`sum ? '-$'+Math.abs(sum).toFixed(0) : '—'`); omit the aggregated refund-note tooltip.
- **cTotal direct (low):** Total-paid sums `x.cTotal`/`x.pTotal` directly (never chk+cash
  recomputed) so it matches `span2` even if a snapshot's total differs.
- **Sticky pin (blocker):** do NOT guess widths from per-tech sizing. Format the Total group in
  WHOLE DOLLARS (m0) and size the fixed sub-column widths for salon-scale SUMS (money 72px →
  fits up to ~$999,999, Δ 30px); compute each sticky cell's cumulative `left` in JS from those
  fixed widths (handles compare on/off). Fixed widths + whole-dollar content = no overflow =
  stable offsets. **Verify alignment in the live preview (compare on AND off, scrolling); if it
  drifts, fall back to reading `offsetLeft` from row 1 after layout.**
- **Every row gets a Total cell (med):** one Total variant per row shape, colspan summing to
  `colsPer`; the By-day SECTION spacer row gets an opaque sticky placeholder (colspan `colsPer`)
  and keeps its tech spanner at `T.length*colsPer`; Check # Total cell is blank-but-opaque.
- **z-index (med):** Total BODY cells `z:1` (opaque bg); all Total HEADER cells `z:3` with the
  teal header bg — mirrors the existing `.sticky-col` pattern.
- **Zebra override (high):** the light-blue fill needs nth-child-qualified selectors
  (`tbody tr:nth-child(even) .ptot, ...:nth-child(odd) .ptot`) or the zebra `background` wins and
  the cells aren't opaque. Keep the 2px right border as the primary separator. Hardcoded hex
  (consistent with this table's palette); do NOT tokenize.
- **CSS scope (low):** dedicated `.ptot*` classes only (no positional/nth selectors that bleed
  into the FD table). `payrollColumnTotals` is a pure non-mutating reduce (test asserts T
  unchanged) — important because `_payrollLiveT = T` is snapshotted by the Lock button.
- **Test scope (med, honest):** the pure fn only sums a given T, so the unit test covers the
  ARITHMETIC (sum/guard/coerce/raw-comm/refund-separate/cTotal-direct/daily-partial) on
  resolved-shape rows (incl. a row mimicking an override and one mimicking an old lock snapshot
  with undefined fields). Override/lock RESOLUTION is existing code; its end-to-end effect on the
  Total is confirmed in the preview check (override a tech → Total moves; view a locked period →
  Total matches).
- **Label (nit):** pinned column header = "All techs" + lock glyph (not "Total", which is already
  a row label). Whole-dollar formatting surfaced to owner.

## Open questions (resolved above; originals kept for the record)
1. **Multi-column sticky pin brittleness:** 5 frozen sub-columns need fixed widths that
   always fit the content (money up to ~$99,999, negative refunds, "—"). If a value
   overflows its fixed width the sticky `left` offsets drift. Are the chosen widths safe,
   or should we freeze fewer columns / a single combined Total cell when compare is on?
   How much horizontal space does a 120 + ~300px frozen block leave on the iPad?
2. **Summation source correctness:** does summing `x.*` AFTER the lock-snapshot mutation
   exactly match every displayed cell (check the refunds row, the `cTotal=cChk+cCash`
   identity, and that `cCash` already has deductions applied)?
3. **Compare-off path:** does the 2-col Total group line up with `colsPer=2` rows?
4. **Readability/contrast** of the light blue vs the zebra row backgrounds and the teal
   header; distinct enough from the `#1a5c7a` "Done" status blue used elsewhere?
5. Anything that double-counts or misses a row (Check # blank, By-day section spacer row,
   the bold Total-paid row)?
