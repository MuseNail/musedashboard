# Phase 3 — Hot/Cold Archive: Build Plan (v2, post-adversarial-review)

**Scope: Muse only** (TurnDesk port comes after Muse runs a full live cycle). Grounded in live v5.41 code (four-lens
code survey) and hardened by a 5-lens adversarial plan review (4 blockers + many highs folded in below; the
"Review changes" section at the end lists what each round changed and what I rejected).

**Goal:** keep ~12 months of sales HOT (DO + device cache + snapshot); move older salon-local months to immutable,
checksummed R2 files; every report/history surface stitches hot+cold with byte-verified equality; hot copies are
deleted ONLY after the archive is independently read-back-verified AND a parity harness proves identical numbers,
with a tested one-click undo built before the first delete. Infinite browsable history, bounded server/device/
backup size, zero financial drift.

**Posture:** additive + staged. Every stage before X keeps BOTH copies present (fully recoverable). X (roll-off) is
the ONLY destructive step: per-month, gated on a fresh parity pass + a checklist of preconditions + your explicit
OK each batch, with the pull-back undo shipped and tested first.

---

## ⚠️ STRATEGIC DECISION FIRST — the timeline (this gates everything)

Muse has only ~4.5 months of sales (data starts ~2026-02). **Nothing is old enough to archive under a 12-month
hot window until ~2027-03**, and the first *destructive* roll-off wouldn't fire until ~2027-04. If we build the
whole machine against a 12-month write boundary, it produces **dead code that first activates unattended ~8 months
after we build it** — the worst possible time (familiarity decayed, no one primed to watch the first delete).

**The fix (recommended): decouple the WRITE boundary from the ROLL-OFF boundary** via a config knob
`archive_write_months` (default 2 for now). The writer archives months older than ~2 months **in shadow** starting
day one — real files, real cold reads, a real parity signal on real data *now* — while the destructive roll-off
stays hard-gated at **13 months** (so no hot data is deleted until it's genuinely a year old, ~2027). We build and
*prove* the entire system this quarter; the only thing that waits for 2027 is the irreversible deletion.

**Your three options (Decision 0):**
- **(A) Build now in shadow mode** (recommended): stages 0→W→R→P→D ship and prove on real recent months; Stage X
  (delete) is built + dry-run-tested now but its live gate holds until data reaches 13 months.
- **(B) Defer the whole project** to ~Q4 2026 and revisit.
- **(C) Build the non-destructive stages now (0→W→R→P→D), stop before X**, revisit X in 2027.

Everything below assumes (A). Under (B)/(C) the same plan applies, just truncated/paused.

---

## Stage 0-pre — TWO standalone fixes that must NOT ride the Phase-3 train

These are pre-existing live issues; per branch discipline they ship as their own **main hotfixes** with their own
review + your OK, independent of whether Phase 3 is approved. **Owner directive (2026-07-13): deploy these
AFTER the salon closes (off-hours)** — 0-pre-a changes the live refund flow, so ship it when no sale can be
mid-refund.

- **0-pre-a — Refund idempotency (LIVE bug).** `confirmRefund` (reports.js:2724) builds the Helcim idempotency key
  from a COUNT of prior refund records; deleting a prior refund changes the count → a retry can mint a fresh key →
  **double card credit**. ⚠️ The naive "mint a new id at confirm" fix is WRONG — it destroys the retry-after-timeout
  dedup the count currently provides (a Helcim timeout retry runs *before* the refund record is saved; the key must
  stay identical). **Correct fix:** mint one refund id per **modal session** (in `initiateRefund`, alongside
  `_refundTxnRecord`), reuse it across confirm retries, key = `rf-<refundId>-<cents>`, and **re-mint when the amount
  field changes** (Helcim same-key/different-payload behavior is undefined — check `HELCIM-MIGRATION.md`). Tests:
  timeout-retry→same key; amount edited→new key; success-then-new-refund→new key.
- **0-pre-b — Restore hardening.** `restoreFromBackup` (worker.js:1552-1579) is not wrapped in
  `blockConcurrencyWhile` (a concurrent mutate can interleave the rebuild) and sets `meta:seq = snap.seq+1` which can
  **regress below live clients' seq**. Fix both now (`blockConcurrencyWhile` + `meta:seq = max(current, snap.seq)+1`)
  — they're DR-critical regardless of Phase 3, and Stage X's restore-reconcile builds on a hardened restore.

---

## Stage 0 — Phase-3 foundations (client + worker)
- **Salon timezone:** `config.salon_tz` (IANA, default `America/Los_Angeles`, Settings→Business, **fixed before the
  first archive write** — changing it later re-buckets month boundaries). Shared `monthOfTs(ts, tz)` helper
  (`Intl.DateTimeFormat('en-CA',{timeZone,year,month})` — confirmed available in Workers + browsers). **The reader
  and writer both bucket by `salon_tz`** — converge on one TZ authority so they can never disagree (today all
  bucketing is device-local `localDateStr`, utils.js:86).
- **Fleet version telemetry (requirement H):** the WS hello sends `{v: APP_VERSION, device: DEVICE_ID, app:
  'main'|'staff'|'reports'}` (today it's literally `{type:'hello'}`, sync.js:144) — shipped to **all three entry
  points** (main.js, staff.js, reports-app.js). The DO keeps a **per-device** map in storage `{deviceId:{v,app,
  lastSeen}}`, written **throttled** (only on version change or ≥1h since last stamp — never per-hello, to avoid
  reconnect-storm churn). Surfaced in Settings→Diagnostics (lists stale devices by entry point). This is the
  durable signal the Stage-X bake gate needs (in-memory socket counts are wiped by every deploy).

**Deploy:** client trio (dev→main, single bump) + worker; client-first is safe (old hello handler ignores extra
fields). **Rollback:** trivial/additive.

## Stage W — Archive writer (worker-only, writes copies, deletes NOTHING)
- **Layout:** one R2 object per salon-local month `archive/<YYYY-MM>.json`, envelope
  `{schemaVersion:1, month, tz, writtenAt, sourceSeq, count, checksum, recordsJson:"<serialized string>"}`.
  **Checksum = SHA-256 over the UTF-8 bytes of the exact `recordsJson` STRING** — the reader verifies the received
  string's bytes *before* `JSON.parse` (never re-serializes). Engine-independent (V8↔JSC byte-identical), covers the
  whole payload. `recordsJson` is the records array serialized once, sorted by id.
- **Canonical content:** the archived records are the **money-bearing content only** for checksum purposes — the
  writer's rollup + the checksum exclude volatile `updatedAt`/`updatedBy`. Records go in **with `status:'deleted'`
  rows present**; the writer's rollup applies the `combineRecords` exclusions (tombstones + `status==='deleted'`)
  **before** aggregating (so deleted sales never inflate customer/tech totals).
- **Index + rollup:** `archive/index.json` = `{months:{ym:{count,checksum,size,writtenAt,verifiedAt,sourceSeq,
  rolledOff}}, rollup:{...}}`. **The rollup lives ONLY in R2 index.json — NEVER in synced config** (a rollup grows
  O(customers) and would blow the DO 128 KiB per-value cap + bloat every snapshot/backup/device cache). Rollup shape
  is specified **against the three consumers** (not abstractly): `byPhone` AND `byName` maps, each
  `{visitsExclRefunds, visitsInclRefunds, grossSpent, netSpent, last, techCounts:{techId:count}}`, keyed with the
  same `_digits10` suffix-normalization the consumers use (reports.js:142/170-181, square-customers.js:317).
- **Guarded, incremental drift-chase (records stay mutable pre-Stage-D):** each alarm, for each written month whose
  **hot slice changed since last run** (tracked by a per-month source hash / max `updatedAt`), recompute — and
  **rewrite ONLY when hot is provably NEWER than the archive** (`hot sourceSeq > archive.sourceSeq`) AND content
  differs. **If hot is older (e.g. after a DR restore of an old snapshot), the archive is authoritative — do NOT
  rewrite** (this closes the blocker where a legitimate restore would corrupt good archives). Any rewrite
  **atomically resets that month's `verifiedAt` + parity flag** (a refreshed file must be re-verified + re-parity'd
  before it's roll-off-eligible). Re-verify one already-written month per alarm round-robin (bounds R2 subrequests).
- **verifiedAt = independent read-back:** set only after a fresh `GET` of the just-written object whose bytes
  re-checksum equal (never from in-memory state). **Never gate any decision on `list()`** (eventually consistent) —
  always `GET` the specific key.
- **Config boundary state:** `config.archive_state = {boundaryYm, writeYm, months:{ym:{writtenAt,verifiedAt,
  rolledOff, parityOk, parityAt}}}` — strictly **O(months)**, small, worker-maintained; the client's **sole
  authority** for the hot/cold boundary (never client-`now` math).
- **Trigger:** end of the 6h `alarm()` in its own try (like retention), gated on `ARCHIVE_ENABLED` (log-only→on).
  `archive/` is disjoint from `backups/` and photos; retention's pruner is prefix-guarded to `backups/` — add a test
  asserting it never touches `archive/`. Manual `POST /archive/write` (auth-gated) for the first run + tests.
- **Deploy:** the read routes `GET /archive/index` + `GET /archive/month/<ym>` ship **in this worker deploy**
  (auth-gated like /state/snapshot; apptoken.js adds the bearer token for free), so Stage R is a pure client release.
**Test (TDD):** TZ-boundary bucketing (23:30 local on the 1st); string-bytes checksum stable V8↔JSC (parity harness);
guarded drift (older-hot does NOT overwrite); incremental update; rollup exclusions (deleted row excluded); index
integrity; verifiedAt-from-readback; retention never touches archive/; log-only mode; archive_state size bound.

## Stage R — Reader (client-only, split into 3 shippable slices)
Both copies present → any reader bug is recoverable. The archive-month cache lives in a **SEPARATE IndexedDB DB
`muse_archive`** (leaving `muse_cache` at version 1 forever, so a client revert can't VersionError the hot cache).

- **R-a (behavior-neutral refactor + accessor):** extract `buildCombinedRecords`'s merge into a pure
  `combineRecords(records, queue, deletions, {isCold})`. **Cold rows TRUST their archived `totalCost`** (immutable,
  checksum-verified) — the `ticketTotal` re-derivation applies to HOT rows only (re-deriving cold rows would let a
  future `ticketTotal`/catalog change silently rewrite settled history). Existing `test/reports.test.js` stays green
  unchanged = proof of no hot-path behavior change. Accessor: `recordsForRange(fromMs,toMs)` (async) = hot combined +
  needed archive months (which months = **`config.archive_state` only**, never client-`now`); `findRecordAnywhere(id)`
  resolves the month via `monthOfTs(checkinTime, salon_tz)` with a ±1-month fallback, returns `combineRecords`-
  processed rows. Cold months fetched via `GET /archive/month`, **verified by string-bytes checksum**, cached in
  `muse_archive` **keyed by `ym+checksum`** (a drift rewrite naturally misses the cache → refetch; validate against
  `archive_state.months[ym].checksum` on each use). Range accessor fetches **both adjacent months** at each endpoint
  (TZ belt). A month neither hot nor in `archive_state` → render a "syncing" state, never silently drop.
- **R-b (async-at-entry conversions):** `await ensureRangeLoaded(from,to)` then render sync. **The full payroll
  chain is one unit:** `payrollRange`→`payrollGrid`→`payrollComputedRows`→`renderPayrollPage`+drills+exports —
  ⚠️ making `payrollRange` async cascades to ~6 sync consumers AND breaks `test/reports.test.js` (it calls
  `payrollComputedRows(0)` synchronously). **Chosen seam:** keep the compute functions SYNC, and have each ENTRY
  point `await ensureRangeLoaded(period)` before calling them (preserves the sync test surface; the plan's earlier
  "tests stay green unchanged" claim was FALSE for payroll and is corrected). Same pattern for `runReport` (covers
  ~14 drills/exports via `_currentReportData`), `computeMetrics`+compare, `renderTransactions`, the 3 reconcilers,
  queue/turns history day-nav, calendar `_pastRecordMatch`, reports-app. **`backoffice-sync.js` is in this set**
  (it calls `computeMetrics`/`payrollComputedRows` to push financials to Back Office — a money EGRESS path the
  original inventory MISSED): `await ensureRangeLoaded` in `buildBoDayRows`/`buildBoPayrollRow`, give its date input
  a min from `boundaryYm`. UI "includes archived months" marker on boundary-crossing ranges; loading state on first
  cold fetch.
- **R-c (rollup-backed sync consumers + UI):** `_custStatsByPhone`, `customerVisitSummary` (queue-badge hot path —
  hot-only until the rollup loads at boot, then updates), `renderCustomerHistory` header, `deleteStaff` hasHistory —
  all read the R2 rollup (fetched at boot, cached) merged with hot, using the consumer-matched fields above.
  Diagnostics gauge gains an archive panel.
- **Accepted windowing (surfaced to you):** service-time averages become 12-month; `healRecordTotals` hot-only;
  `myHistory` (staff, 30d ≪ hot) unchanged but gets a parity test vs `combineRecords`; audit.js derived events — see
  Decision 3.
**Deploy:** each slice = its own dev→main + trio bump + review + revert path (client-only; hot path untouched;
worker route already live from Stage W). ⚠️ Client revert = each device needs a manual ↻ to pick it up (no
auto-reload); mid-session devices keep the old build until then — stated honestly.
**Test (TDD):** stitch semantics (hot-wins, cold-trusts-total, tombstones-on-cold, deleted-in-archive); checksum
reject on corruption; cache keyed by ym+checksum → drift refetch; every converted consumer fixture; payroll-chain
fixtures + updated reports.test.js payroll tests; rollup consumer-output parity; schemaVersion migrate-on-read (v1
fixture); TZ-boundary record under a device whose TZ ≠ salon_tz.

## Stage D — Read-only boundary (client-first, then worker)
- **Client first** (hide Edit/Delete on pre-boundary rows — reports.js:2228/2280-2281; block the historical-edit
  modal; **block the txn MERGE flow** `_persistGroupOnRecord`/`mergeSelectedTxns` when any selected row is
  pre-boundary; `importAllData` skips a pre-boundary record **only when its archive month is verified-present in
  index.json**, otherwise imports it — skipping is a de-dup optimization, NEVER a data-dropping default in a DR
  restore; Clear-All wording states hot-window-only). **Then worker** (reject `record.save`/`record.delete` for a
  record whose salon-local month is `rolledOff` OR verified-archived-and-older-than-boundary, per
  `config.archive_state`; a month never becomes read-only before its archive is verified). Client-blocks/server-
  allows skew is harmless; the reverse dead-letters legit edits — hence client-first.
- **Reconcile past the boundary:** archived-range reconcilers show an explicit **read-only/informational banner**
  ("archived period — differences can't be corrected here") since edit/refund-correction is blocked — so operators
  aren't shown fixable-looking discrepancies they can't act on.
- **Refunds stay possible at ANY age** (grounding win): a refund is a self-contained NEW record (checkinTime=now,
  `refundOf` never dereferenced downstream) — `initiateRefund` reads the original via `findRecordAnywhere` and the
  0-pre-a idempotency fix removes the prior-count dependence. No pull-back needed for a refund.
**Test:** boundary reject (server+client, incl. outbox replay); refund-of-archived-sale end-to-end; merge-block;
import skip-only-if-verified; Clear-All wording; UI gating.

## Stage P — Parity proof (the go/no-go gate)
- **Ships as client code in the last R slice** (reuses the client's `combineRecords`/`ticketTotal` — a worker
  reimplementation would itself be drift risk). **Runs once per salon-day** on FD dashboard boot/first-resync
  (guarded by a config-stamped `lastParityRun` so multiple devices don't duplicate); writes result to
  `config.archive_state.months[ym].{parityOk,parityAt}`.
- **Compares CONSUMER OUTPUTS at the granularity where offsetting errors hide** (not aggregates): per-tech
  per-period payroll rows (billed/commission/refund/refundComm + daily map), per-month record **id-sets +
  per-record re-derived-or-trusted totals**, and per-customer consumer outputs (`customerVisitSummary`,
  `_custStatsByPhone` map, `renderCustomerHistory` header) hot-only vs rollup-backed. Plus the brief's seven trap
  fixtures: delete-after-archive, edit-after-archive, back-dated entry, unlocked payroll period, TZ-boundary record,
  refund-of-old-sale, restore-introduced overlap.
- Because of the **shadow write-boundary (Decision 0-A)**, this runs on **real recent months now** — the parity
  signal is live, not theoretical.
- **The flag X consumes must be FRESH (≤48h) AND earned after Stage D is live** (a parity proven pre-D was against
  still-mutable data; any archive rewrite resets it).

## Stage X — Roll-off (destructive; per-month; your OK each batch; ~2027 under Decision 0-A)
- **Undo FIRST:** `POST /archive/pullback/<ym>` restores a month's records from the archive back into hot — built +
  tested BEFORE any delete. **Spec:** `write-if-absent` per `record:` key (NEVER overwrite a live hot row; log any
  collision), re-establish needed `deletion:` tombstones, inside `state.blockConcurrencyWhile`, then `nextSeq()` +
  fresh `buildSnapshot` broadcast (convergence), clear `rolledOff` atomically.
- **Preconditions (auto-checked, gauge-surfaced):** month verified by a **fresh GET+checksum at delete time**; older
  than **13** salon-local months; parity flag fresh+post-D; fleet-bake satisfied (**no device < vR seen in 14 days
  across ALL three entry points, AND all open sockets ≥ vR**); Stage D live; **every payroll period overlapping the
  month is LOCKED** (belt so a stale pre-R client can't show zeros for an unlocked archived period —
  requirement L); **durable redundancy present** (see below).
- **Procedure, inside `blockConcurrencyWhile`, off-hours** (alarm outside salon hours in `salon_tz`, or manual-only
  at first): re-derive from hot → **any record newer than the archive ⇒ ABORT the whole month + re-archive** (never
  partial-delete — an orphan hot row in a read-only month breaks parity forever) → checksum match ⇒ delete that
  month's `record:` keys → mark `rolledOff` in index + archive_state → `nextSeq()` + snapshot broadcast → audit-log.
- **Durable archive redundancy (requirement G):** a rolled-off month must never be single-copy. Enable **R2 object
  versioning** on `archive/` (or keep a second checksummed replica), AND a **periodic re-verification pass** (round-
  robin on the alarm) that re-fetches+re-checksums every rolled-off month and raises an owner-visible alarm on
  mismatch while a rebuild from a retained backup is still possible.
- **Restore reconcile (F):** `restoreFromBackup` reads the **LIVE `archive/index.json`** (survives `deleteAll()` —
  it's R2, not DO storage) as the **sole authority** for rolled-off months — NOT the restored
  `config.archive_state` (which came from the old backup) — drops re-introduced hot `record:` keys for rolled-off
  months, and **re-derives `config.archive_state` from the live index** at the end of restore.
- **Rollout:** log-only ("would delete") → your OK → oldest single month live → observe a full day → your OK →
  remaining eligible months in batches (at steady state ~1 month/month; a one-time small backlog in 2027).
**Test (TDD):** abort-whole-month-if-any-newer; drift-abort; blockConcurrencyWhile interleave; broadcast
convergence; pullback write-if-absent round-trip + collision log; restore reconcile from LIVE index (restore a
pre-roll-off snapshot → no hot key survives for a rolled-off month); each precondition individually unmet ⇒ refuses;
periodic re-verify raises on corruption.

## Stage O — Tombstone GC + audit policy (optional, after X proven)
Drop a `deletion:` tombstone only when its id is in a rolled-off month's manifest **AND** the archived row carries
`status:'deleted'` (so a replayed `record.save` with a hot-window `checkinTime` can't resurrect it — Stage D's age
guard also rejects any id present in a rolled-off manifest). Audit log: Decision 3.

## Mixed-fleet risk table (accepted, documented)
A pre-R client after roll-off: unlocked archived payroll → **zeros** (mitigated by the lock-before-roll-off
precondition); custom report/txn ranges into archived months → empty (marker only helps new clients); reconcilers →
false "not in app" discrepancies; customer stats/badge/service-time → windowed; `exportAllData` → hot-window-only,
unlabeled; refund of archived sale → fails safe ("Record not found"). None corrupt data; (payroll) is belted, the
rest accepted + documented.

---

## Plain English
Sales history never disappears and never bloats the app. The iPad keeps ~a year loaded (fast/light); older months
live in tamper-evident monthly files in cloud storage that reports pull in seamlessly. Nothing is deleted from the
working copy until the archived copy is byte-verified, a proof-run shows every report/paycheck/customer-total
computes identically both ways, there's redundancy so a month is never single-copy, and there's a tested one-click
undo. And because the salon's data isn't a year old yet, we run it in a safe "shadow" mode now to prove the whole
thing works on real data, with the actual deletion locked until 2027.

## Decisions I need from you (sign-off)
0. **Timeline: (A) build+prove now in shadow mode / (B) defer to Q4 / (C) build non-destructive stages, stop before
   delete.** (Recommended: A.)
1. **Read-only past 12 months** — no Edit/Delete/merge on archived sales; **and no back-dating a brand-new entry
   into an archived month** (a forgotten old sale gets recorded in the hot window with a note). Refunds still work at
   any age. Confirm.
2. **Service-time averages become 12-month windowed** (floor-plan duration bubbles) — OK?
3. **Audit:** the `audit:` log stays a ~1000-event rolling window (documented); AND the separate *derived* delete/
   refund reconstruction (`audit.js` reads the server snapshot) windows to hot after roll-off unless we point it at
   the archive accessor — **your call: accept windowed derived-audit, or spend the async wiring to keep it full.**
4. **Clear-All clears the hot window only**; archives untouched (deleting archives = deliberately not built) — OK?
5. **Ship 0-pre-a (refund idempotency) + 0-pre-b (restore hardening) as immediate standalone main hotfixes now**,
   independent of Phase 3 approval — OK? (0-pre-a fixes a live double-credit risk.)

## Sizing (honest, under Decision 0-A)
0-pre-a/b ≈ 0.5 each (standalone) · 0 ≈ 1 · W ≈ 1.5 · R ≈ 3 slices × ~1 (the risk concentration; mitigated by the
behavior-neutral refactor first, slice boundaries, both-copies recoverability) · P ≈ 1 · D ≈ 0.5 · X ≈ 1 build +
operational care in 2027 · O ≈ 0.5. Each stage/slice = its own rigorous-build cycle (TDD → 3-lens → senior → your
deploy OK). No stage starts until the prior is verified live. Muse branch discipline: each stage on `dev`, single
trio bump at the `dev→main` merge, worker deploy where the worker changed (verify account =
info@musenailandspa.com); hotfixes (0-pre) land on `main` in parallel; never let `dev` span two stages.

## Requirement coverage
A→R · B→W/R(cold-trust) · C→W(guarded-drift)+X(13mo) · D→D · E→X(blockConcurrencyWhile) · F→X(restore reads live
index) · G→W(checksum/readback)+X(R2 versioning + periodic re-verify) · H→0(per-device telemetry, 3 entry points)+
X(gate) · I→D(import skip-if-verified/export/Clear-All) · J→0-pre-a(refund id) · K→W(consumer-matched rollup)+R-c ·
L→R-b(payroll via accessor)+X(lock precondition) · M→0(salon_tz, single authority)+W(bucketing)+R(both adjacent) ·
N→W(schemaVersion)+R(migrate-on-read) · O→O(guarded) · P→P(consumer-output granularity) · Q→resolved (Phase 2 live).

## What the review rounds changed (and what I rejected)
- **Blockers fixed:** refund-idempotency spec (mint-per-modal-session, not per-confirm); guarded drift-rewrite
  (restore can't corrupt archives); string-bytes checksum (no cross-engine false failures); [cache-forever→
  checksum-keyed cache].
- **Highs fixed:** separate IDB DB; per-device durable bake telemetry (3 entry points); consumer-matched rollup +
  consumer-output parity; cold-rows-trust-total (no history rewrite by ticketTotal); abort-whole-month (no orphan);
  durable archive redundancy; **backoffice-sync added to the inventory**; payroll async-cascade seam + corrected
  "tests stay green" claim; restore reconcile reads live R2 index; archive_state = sole boundary authority; timeline
  shadow-write-boundary.
- **Mediums fixed:** deploy order per stage; R split into slices; parity runner home/scheduler/freshness; writer
  rollup exclusions; Stage-D merge + reconcile gating; config 128KiB cap (rollup in R2 only); verifiedAt from
  read-back, never gate on list(); pullback spec; import-skip-only-if-verified; incremental rollup (subrequest
  budget); restore hardenings moved OUT of destructive X into 0-pre-b.
- **Rejected / deferred:** re-deriving cold totals (rejected — breaks immutability); putting the rollup in config
  (rejected — 128KiB cap); a worker-side parity runner (rejected — reimpl drift); bundling the refund fix into the
  Phase-3 train (rejected — it's a live hotfix); device-scoping `_mergeNewerAssignments` (out of scope, unchanged).
- **One lens (design-correctness) failed twice on infra limits; its concerns (async cascade, config transport,
  Intl-in-Worker, IDB version) were independently covered by the other lenses + my own two spot-checks
  (auth-gated route confirmed; Intl timeZone confirmed available in Workers).**
