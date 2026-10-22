# Plan v3 — Comp redesign (Wave 2 #1) — CORRECTED model after owner clarification

Date: 2026-10-21 · Repo: musedashboard (ports to TurnDesk) · HIGH-RISK (money) · supersedes v1/v2.

## The model (owner-confirmed 2026-10-21)
A comped line keeps its real **price** (`a.cost`), entered in BOTH Assign & Price AND the tech app.
"Comp" means only **the customer pays $0** for it. The **tech still earns** (billed + commission on the
full price). The **business eats it** as a giveaway (not income). A new **"Comped" total** shows the
givaway in the Reports tab. (Old comps were saved at $0 — new behavior is forward-only; owner OK'd.)

So `a.cost` stays the service value. Split by purpose:
- **CUSTOMER-PAID / BUSINESS-INCOME → EXCLUDE comps** via `lineCharge(a) = (a&&a.comped) ? 0 : ((a&&a.cost)||0)`.
- **TECH-EARNINGS → INCLUDE comps** = raw `a.cost` (UNCHANGED; now nonzero on comps — exactly the new behavior).
- **NEW `compedAmount(a) = (a&&a.comped) ? (a.cost||0) : 0`** → the Comped total.
Both helpers live next to `ticketTotal` in utils.js, exported.

## 1. The pivot — `ticketTotal` (utils.js:17)
`svc` reduce uses `lineCharge`. This is the single source of every `totalCost` (buildCombinedRecords:93,
_saveAssignOneList:1891, receipt total, square-pos bill), so **every business metric that sums
`totalCost` auto-excludes comps**: totalIncome, avgTicket, grossIncome, shopKeeps, refundsTotal, daily
sales, paymentMix, PERF revenue, and all transaction-list/detail/history/export dollars. No edits there.

## 2. Explicit `lineCharge` — the raw-`a.cost` customer/business sums (~13 sites)
Per the categorization map (verified against source):
- reports.js: 539 (`svcTotal` headline), 621 (per-service revenue list), 738 (computeMetrics svcTotal),
  785 (PERF "Services"), 928/933 (per-service drilldown — note: its sibling per-TECH drilldown 881 stays raw).
- receipt.js:111 (`svcTot` → Subtotal, so it reconciles with the Total).
- reports-app.js:124 (phone per-service revenue).
- square-pos.js: 52 (`_payParts.svc`), 64 (`_entrySvc` → the % **fee base** 76/78, fixes the fee-on-comp
  overcharge), 148 (per-line checkout display → render "Comp", like receipt.js:99).
- queue.js live Assign/checkout bases: `updateGroupTotal` must **skip comp-checked rows** (read
  `.assign-comp`) at 1923/1937/1939 or the live Party Total over-charges now that comp rows hold a price;
  `_saveAssignOneList` memberSvc + fee/discount/anchor bases (1856/1872/1880/1882/1883) and the
  `e.totalCost` write (1891) use `lineCharge`. (Legacy dead twins 1447-1448 / 1329-1364 mirrored for consistency.)

## 3. TECH-EARNINGS — KEEP raw `a.cost` (NO change; now includes comps)
reports.js 570/746/881-883/1442/2006/2011/2951; reports-app.js 123/158-159; turns.js 433/960/973/1032
(+ exports); staff.js 79/307/488/494/562/564/573. These already sum `a.cost`; because comps now carry a
price, the tech is paid in full automatically. **Do not touch.** Turn classification (`classifyTurn`) also
untouched (out of scope).

## 4. Comp keeps its price (the behavior change — write paths)
- `_applyRowToAssignment` (queue.js:1048): always parse the price field regardless of `domComped`
  (`a.comped` becomes a pure flag; stop forcing cost=0). (Revisit line 1059 `if (domComped) a.techPriced=false`
  — a comp no longer changes the price, so keeping techPriced is defensible; decide at build.)
- `toggleCompRow` (queue.js:1264): keep the cost field enabled + its value; just reveal the reason picker
  and recompute the total.
- Cost-input render (queue.js:1635; legacy 1447): render the price even when comped, not disabled/greyed.

## 5. Tech app — let a comp be priced (staff.js)
- `staffServiceAction` (staff.js:132): drop the comped short-circuit so a comped in-service line falls
  through to Save-price → Complete (like any line).
- `staffPriceInput` (staff.js:613): remove `|| a.comped` so the keystroke button-morph works on a comp.
- `lineHtml` priceRow (443): already renders the input for non-waiting status; `priceVal` reads `a.cost`
  → the kept price shows. Keep a small "Comp" marker so the tech knows the customer isn't charged.
- `completeGateOk`/`staffComplete`: leave comp able to complete even with no typed price (don't block);
  the price is entered to earn on it, not forced. (Open question: auto-default a comp to the service base
  cost? — NOT in this plan unless owner wants it.)

## 6. New "Comped" total (Reports tab)
- Add a **"Comped"** card in index.html's "Revenue breakdown by type" grid (437-467), mirroring the
  Discounts card (`id="rpt-comped-total"`).
- Compute in `runReport` (reports.js:529): `compedTotal = Σ over filtered records Σ compedAmount(a)`;
  `set('rpt-comped-total', …)`. Mirror into `computeMetrics` (735) + a delta card, and reports-app (phone).
- Optional (nice): a drilldown "tap to see comped tickets" following `drillDownDiscounts`. Decide at build.

## Confirmed consequence (owner already OK)
Shop Keeps = totalIncome − commission: after the pivot, totalIncome drops (comp excluded) but commission
stays (tech paid) → Shop Keeps correctly drops by the comped commission (business gives the service away
AND pays the tech). This is exactly the intended "loss for the business, tech still paid."

## Out of scope
Turn classification; auto-defaulting a comp's price; floorplan.js:122 tile now shows a comp's price
(cosmetic — leave, or add a "Comp" marker; decide at build).

## Test plan (TDD)
- `lineCharge` / `compedAmount` truth tables; `ticketTotal` with a comped+cost line → customer total
  excludes it; a comped line → full `a.cost` still flows to payroll (assert via a payrollRange-shaped case
  or the pure sum); compedTotal sums comped costs; `staffServiceAction` lets a comped line be priced
  (Save-price → Complete). Full suite green; preview/boot; owner eyeballs on a device: comp a line, verify
  customer $0, tech paid, Reports "Comped" total, receipt shows "Comp".

## Rollback
Read-only on reports/customer side (no persisted rewrite). The write-path changes only stop zeroing a
comp's price going forward (old records unaffected). Revert the commit.

## Open questions for the owner
1. Confirm the Shop-Keeps consequence above (it's correct, just flagging).
2. A comp with NO price entered → the tech earns $0 on it (we don't force/auto-fill a price). OK, or should
   a comp default to the service's base price? (Recommend: don't auto-fill; the tech/FD enters it.)
3. The "Comped" total — just the number, or also tap-to-drilldown the comped tickets? (Recommend number
   now, drilldown later.)
