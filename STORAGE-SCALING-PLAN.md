# Storage & Scaling Plan — Muse (+ TurnDesk parity) — v2 (post-review)

**Status:** DRAFT for owner final review. Not started. A 5-lens adversarial review (against the real code) ran on v1; this v2 folds in its findings. Verdict: **Phases 0, 1, 2, 4 are sound** (fixes folded in below); **Phase 3 (archive) had blocker-class data-loss defects and is re-scoped to a separate, not-yet-buildable design brief.** Each deploy/push and each destructive go-live still needs explicit OK.

**Goal:** infinite browsable history + lean device/server/backups, data-integrity first (additive, staged, nothing destroyed until proven copied and read-back-verified, rollback at every step).

---

## Measured baseline (Muse, 2026-07, ~4.5 months post-launch)

| Slice | Count | Size | Behavior |
|---|---|---|---|
| **records** (sales) | 1,742 | **1.50 MB** | grows ~linearly; 77% of cache; the driver |
| customers | 1,303 | 0.28 MB | grows slowly; **always hot** (but see Phase 3 note: lifetime stats derive from records) |
| config | — | 0.11 MB | ~fixed |
| queue/giftcards/deletions/misc | — | ~0.05 MB | mostly bounded (tombstones grow — see below) |
| **Total device cache** | | **1.94 MB** | localStorage |

- ~**400 sales/month (~13–15/day)**, ~880 B/record, growth ~**0.38 MB/month** (records-dominated).
- Device ceiling ~**5 MB** (iPad localStorage); runway ~**8 months**. **Soft** failure (`store.js:280` try/catch): past the cap the device stops caching → slower reloads + no offline; app still works online.
- **DO is SQLite-backed;** `buildSnapshot` (worker.js:1387) materializes ALL `record:`/`customer:` rows into memory on every 6h backup AND every new-device/reconnect snapshot — so the *server-side* cost (snapshot memory, reconnect payload, first-load download) also grows with total history. Small for a long time at single-salon volume; this is what the archive (Phase 3) eventually bounds.

---

## STRATEGY (changed after review)

The archive (Phase 3) is the only thing that bounds the *server-side* growth and enables truly infinite history — but the review shows it's a large refactor of the financial reporting core with ~20 data-integrity edge cases, any of which miscounts money if wrong. It is **not needed for years**: Phase 2 (IndexedDB) removes the near-term *device* wall for years/decades, and server-side growth is small at Muse's volume.

**So: build the safe, high-value set now (0 → 1 → 2 → 4), which removes all near-term pressure and ships the reliability fixes. Defer the archive (Phase 3) to its own carefully-designed project, triggered by the Phase 0 gauge (or TurnDesk scale), using the design brief below.** Rushing the archive is the one path that could corrupt financial history — so we don't.

---

## BUILD-NOW SET

### Phase 0 — Storage gauge (client, tiny, first)
Settings → Diagnostics: live cache size + per-slice breakdown + runway projection, read-only.
**Review fixes:** read the **active backend** (localStorage now; after Phase 2, `navigator.storage.estimate()` for IndexedDB) so the ceiling/projection stays truthful across phases; show the `persist()` grant state. Later surfaces roll-off status (Phase 3).
**Test:** size/breakdown/projection math on fixtures. **Deploy:** client trio + Pages. **Rollback:** trivial.

### Phase 1 — Backup retention prune (worker-only)
Tiered GFS on the 6h alarm: 6h×1wk, daily×1mo, monthly×1yr, yearly×7yr → ~70 files. Representative = end-of-period. Recompute keep-set each run (union of buckets, delete orphans) — stateless/self-healing.
**Review fixes:**
- Bucket by R2 **`object.uploaded`** (already returned by `listBackups`), NOT by parsing the mangled ISO key.
- **Exempt DR safety snapshots** — `restoreFromBackup`/`factoryReset` write an at-that-instant `backupNow()` (worker.js:1490/1511); tag these (own `backups/safety-` prefix or R2 customMetadata) and always keep the newest few, exempt from bucketing — else the pruner deletes the exact "undo a bad restore" point.
- **R2 bulk delete** (`bucket.delete([...])`, ≤1000/call), bounded per run (first cleanup ~500→70).
- Guardrails: prefix-guarded to `backups/`, hard floor (newest ~8), **log-only first**, log every deletion.
**TurnDesk:** scope list+delete to the **per-salon** backup prefix; reconcile with (do not stack on) TurnDesk's existing retention; verify `archive/<salon>/` is disjoint from photos/backups.
**Test (TDD):** synthetic timestamps over 8y → exact ~70 survivors; safety-snapshot exemption; floor; bulk-delete batching. **Deploy:** wrangler (OK) log-only → wrangler (OK) live. **Rollback:** revert worker.js.

### Phase 2 — Device cache localStorage → IndexedDB (client)
Move the big state mirror to IndexedDB (GBs); keep outbox/device-id/session in localStorage. Removes the ~8-month device wall for years.
**Review fixes (these are the correctness core, not optional):**
- **Async boot:** make `boot()` await the cache load before first render in **all three** entry points (main.js, staff.js, reports-app.js) — `loadCache()` is called sync inside `sync.start()` (sync.js:89) and each entry renders on the next lines; a naive async read paints an empty board. (Or accept a blank-then-fill flash AND audit every post-start sync state read to confirm it only renders, never decides.)
- **`reapplyOutbox()` after `loadCache()`** at boot — today only the snapshot paths reapply the outbox; async cache means a pending offline write can vanish on reload without this.
- **Seq-guard the cache hydrate** — ignore a cache hydrate if a snapshot with `>=` seq already hydrated (a slow async cache read must not clobber fresher server state).
- **Single-writer + debounce** the now-async `saveCache` (coalesce bursts to one write, drop a write older than a committed `store.rev`), flush on `visibilitychange`/`pagehide` (localStorage `setItem` was sync+atomic; IDB isn't).
- **`navigator.storage.persist()`** + surface the grant in the gauge; document that only Home-Screen-installed PWAs are ITP-exempt (7-day eviction otherwise) → recommend Home-Screen install on every front-desk device.
- One-time migration inside a single IDB transaction + `migrated` marker (multi-tab safe, never overwrites newer IDB with stale localStorage); after migrating, **clear or keep-in-sync** the old localStorage cache so it can't resurrect stale state. Keep the `muse_state_cache` presence signal for the What's-New heuristic (or repoint it to `muse_device_id`).
- Fallback to localStorage if IDB unavailable (private mode) — but note this fallback can't hold Phase 3's larger window (no-IDB devices become online-only under Phase 3).
- Repoint the Phase 0 gauge to IDB.
**Test:** round-trip; one-time migration (+multi-tab race); fallback path; **burst/out-of-order write**; seq-guarded hydrate; crash-mid-write vs outbox; private-mode. **Deploy:** client trio + Pages (OK). **Rollback:** client revert (localStorage fallback intact).

### Phase 4 — Device-scoped stale-write guard (client + worker)
The correct version of the withheld guard: reject only a **same-device** stale replay (via `updatedBy`), never a cross-device action → no clock-skew data loss. Stamp `updatedBy` on assignments (`status.js applyAssignmentStatus` + `queue.js`) and entry patches (`sync.js`); DO guard rejects only when incoming `updatedBy` == stored `updatedBy` AND older.
**Test (TDD):** same-device stale replay rejected; cross-device always applies; unstamped back-compat; FD-assign-then-tech-start never dropped. **Deploy:** client + worker, order-independent, back-compat. **Rollback:** additive revert. Order-independent — can ship anytime in the sequence.

---

## DEFERRED — Phase 3: Hot/cold archive (design brief, NOT yet buildable)

The archive is the durable answer for infinite history + lean server, but the review found it needs its own full spec. **Do not build until each item below is designed and the parity harness passes.** Requirements captured from the review so nothing is lost:

**A. Async reporting core (the biggest work item).** Every history consumer reads `getState().records` **synchronously** through `buildCombinedRecords` (reports.js:67) — ~53 call sites across 11 files: `computeMetrics`, `runReport`, all three reconcilers (`openReconcile`/Square/Helcim), `payrollRange`, `renderTransactions`, `_custStatsByPhone`, `renderCustomerHistory`, `initiateRefund`, **staff.js `myHistory`**, and **giftcards.js export/import/clear**. Required: a single **async, date-scoped accessor** (`recordsForRange(from,to)`) that preloads+caches needed archive months and merges with hot; keep archived rows OUT of `state.records` (a separate session cache keyed by month) because `hydrate()` (store.js:137) replaces `state.records` wholesale on every snapshot. Enumerate + convert every call site.

**B. Stitch semantics.** Merge-by-id, **HOT WINS** on id collision; **re-apply the hot `deletions`/`customerDeletions` tombstone set to archived rows** and honor `status==='deleted'` inside archives (else a sale deleted after archiving reappears in all-time totals).

**C. Archive timing (fixes the inverted overlap).** Write/refresh the archive **at roll-off time (~13 months), not at month-close** — a record stays mutable for the whole hot window, so a month-close "immutable" file goes stale. The archive boundary must coincide with a **server-enforced read-only** boundary. Archive is always written+verified strictly BEFORE the hot copy is deleted (≥1-month both-present overlap).

**D. Read-only enforcement (server-side).** Reject `record.save`/`record.delete` for records older than the hot boundary in `applyMutation` (not UI-only — a stale offline outbox replay or the staff app can still write). Reflect in UI (disable refund/edit/delete on pre-window rows).

**E. Roll-off safety.** Run inside `state.blockConcurrencyWhile` (no interleave); re-derive+verify the archive from current hot immediately before delete; **skip (don't delete)** any hot record newer than the archived copy; **broadcast a fresh snapshot + advance `meta:seq`** so live clients converge (like restore does); run off-hours; record success/failure surfaced in the gauge.

**F. Restore × archive.** A DR restore of a pre-roll-off snapshot re-introduces archived months → dedupe-by-id (hot wins) + a **restore-time reconcile** that drops hot copies whose month is verified-archived. Per-salon prefix isolation (a restore must never cross-attach another salon's `archive/<slug>/`).

**G. Integrity + redundancy.** "Backed up once" is not a recovery story. Per-month **manifest** (id list + checksum + count), **periodic re-verification** in the alarm with an owner-visible alarm on mismatch; retain the last pre-roll-off backup that still covers each month until its archive is independently verified; consider R2 versioning/replication.

**H. Mixed-fleet rollout.** Gate roll-off on a **minimum client version** (DO records min client version seen on the WS hello); N-day bake after the reader ships. No auto-reload (manual ↻), so an iPad left open for days runs an old build → don't shrink the shared snapshot until all live sockets are on the reader build.

**I. Client backups (giftcards.js).** `exportAllData` must include/reference archives or be clearly labeled "current window only"; `importAllData` must refuse to resurrect pre-boundary records; define Clear-All vs `archive/` files.

**J. Refund of an old sale.** `initiateRefund` needs the original in hot (amount, `squarePaymentIds`). Define: pull-month-back-into-hot → refund → re-archive, OR snapshot the needed fields into the refund record at creation; robust idempotency when prior refunds have aged out.

**K. Customer lifetime stats.** Customers stay hot, but visits/last-visit/total-spent derive from records (`_custStatsByPhone`, square-customers.js:317) that DO archive → they'd silently window. Either feed the archive accessor OR maintain a rolled-up per-customer lifetime aggregate on the customer entity, updated at archive time.

**L. Unlocked historical payroll.** Only LOCKED periods snapshot into config; unlocked periods recompute from hot records → an aged-out unlocked period shows zeros. Require lock-before-roll-off OR route payroll through the accessor.

**M. Timezone / month bucketing.** Records are day-bucketed client-side in **salon-local** time (`localDateStr(new Date(checkinTime))`); a server-side UTC archive writer would misfile boundary records. Bucket by salon-local month (pass a fixed salon TZ) and/or have the reader fetch the adjacent month + re-filter by date.

**N. Archive schema versioning.** Stamp `schemaVersion` in each file; migrate-on-read to current record shape before stitching (record shape evolves over years); test reading a vN archive.

**O. Tombstone GC + audit log.** Once a deleted record's month archives and the reader honors deletions, the hot tombstone can be dropped (bounds the snapshot). Decide audit-log policy explicitly: own archive stream OR tell the owner it's a ~1000-event rolling cap (it never archives today).

**P. Parity harness (the gate before any roll-off).** Compute historical ranges from hot vs. archives and assert identical — and it MUST include: delete-after-archive, edit-after-archive, back-dated entry, unlocked payroll period, timezone-boundary record, refund-of-old-sale, restore-introduced overlap.

**Q. Hot-window knob.** 12 months needs Phase 2 (IndexedDB) for the device; a ~6-month window (~2.4 MB) fits localStorage and would let the archive ship without Phase 2 — but the hard part (A–P) is independent of window length. With Phase 2 shipped, 12 months is comfortable.

---

## Cross-cutting rules
- Every phase: additive, TDD, staged; destructive steps get log-only/dry-run; rollback defined; nothing removed until proven copied + read-back-verified.
- **Autopilot boundaries:** I build/test/self-review each phase; I **pause for explicit OK** before each `git push`, each `wrangler deploy`, and each destructive go-live.
- Deploy discipline: worker → wrangler (verify account = info@musenailandspa.com); client → version trio (`config.js`+`version.json`+`sw.js`) + Pages; Muse on `main`.

## Decisions I need from you (final review)
1. **Confirm the re-scope:** ship 0 → 1 → 2 → 4 now; treat Phase 3 (archive) as a separate future project I'll spec fully before building. (Recommended — it's the data-safe path and buys years of runway.)
2. **Phase 4 timing:** fold the device-scoped guard in now (recommended), or after the storage phases?
3. When we *do* take on the archive: **read-only-beyond-hot-window** as the policy (edit/refund/delete only within the hot window; refunds of older sales handled explicitly) — OK in principle?
