# Muse FD-Schedule Draft/Publish Reverse-Port — Implementation Plan (v2, post-review)

> Reverse-port of TurnDesk **td-v0.84** (front-desk schedule draft→publish + 2-week admin builder + staff rolling 4-week view + bounded "Repeat next 4 weeks") into **Muse** (`musedashboard`). Scope = FD-schedule ONLY; NOT the td-v0.85 settings redesign.
> Built via **rigorous-build**. Muse: feature on **`dev`**, version bump once at dev→main. Target **v6.20**. Client-only — no Worker/DO change.
> **Revised after a 4-lens adversarial plan review** (data-safety / correctness / sequencing / completeness). Review verdict: no blockers; sound to build once the findings below are folded in + 3 owner decisions settled.

## DECISIONS (settled with owner, 2026-11-21)
- **D1 = A — bounded model.** Owner does NOT use "Every week". Ship the bounded "Repeat next 4 weeks"; NO migration, NO weekly-pattern editor. Legacy `_repeats` fallback stays in `resolveFdShift` purely defensively (renders read-only if any stray pattern ever exists); there is no UI to author it, which is fine since it's unused.
- **D2 = A — wire the forgot-to-publish safety net into the v6.18 notification bell** (managers only, read-only check of `structuralChangeCount(fd_schedule, fd_schedule_draft) > 0`). In scope.
- **D3 = A — document single-editor assumption; no concurrency code.** Matches TurnDesk; the draft's shared-key last-write-wins is the same model `fd_schedule` has today.

## Goal
- **Draft → Publish:** manager edits a draft; staff keep seeing the last *published* schedule until Publish promotes it.
- **2-week admin builder** (two stacked week bands) with a **pay-period chip** (+ boundary markers for non-weekly salons). (The chip is **cosmetic** — payroll is driven entirely by the time clock + `reports.js`, which has zero `fd_schedule` references; confirmed in review.)
- **Staff rolling 4-week view** (this week + next 3) in the Muse Staff app, published-only.
- **"Repeat next 4 weeks"** (bounded) replaces the retroactive "Every week"; legacy `_repeats` still *renders* (read-only fallback).

**Plain English:** today the front-desk schedule changes live the instant you edit it, one week at a time. After this: you build the next week(s) as a *draft*, see a "3 unpublished changes" badge, then hit **Publish** when it's ready — staff only ever see the published version. You see two weeks at once; staff see the next month on their phone. The "repeat" button now fills the next 4 weeks instead of a forever-pattern (see D1).

## Architecture (data-safety core)
- **Published = `config.fd_schedule`** — shape **UNCHANGED** (Muse `getFdShift` fd-schedule.js:31-38 is byte-identical to the schema TD's `resolveFdShift` mirrors). Staff read this, and ONLY this.
- **New key `config.fd_schedule_draft`** — holds edits until Publish copies it to `fd_schedule`. Verified in review: it rides the existing per-key stale-write guard cleanly (a brand-new key has no `cfgmeta` → the write always applies and self-stamps, store.js:177-187), and the DO persists/snapshots arbitrary config keys generically (worker.js:1536-1554) → **no Worker change**.
- **Emptiness is null/undefined/empty-object safe.** Clearing stores `null` (`config.set` can't delete). NOTE: `hydrate` drops null-valued keys (store.js:150-152), so after a resync the key reads `undefined`, not `null`. Every reader must treat **`null` AND `undefined` AND `{}`** as "no draft" — never test `=== null` or `'fd_schedule_draft' in cfg()`. (The ported code already does this; this note is to keep it that way.)
- **New pure, node-safe module `js/app/fd-schedule-util.js`** (verbatim port): `resolveFdShift`, `repeatForwardDates`, `cellChangeKind`, `structuralChangeCount`, `hasUnpublishedChanges`, `payPeriodForDate`, `weekBandTitle`, `payPeriodBoundariesInRange`, `SCHED_NONE`.

### Concurrency / cross-device model (was missing — added per review)
`fd_schedule_draft` is a single SHARED synced key, not per-device — so a draft is visible/editable on every admin device at once, and Publish/Discard broadcasts to all. For a single salon with effectively one manager editing the schedule this is fine and is the same last-write-wins model `fd_schedule` already has. See **D3** for whether to harden it.

### Why the migration is non-destructive
Existing `config.fd_schedule` is read UNCHANGED by `resolveFdShift` (same per-date map, `SCHED_NONE`, legacy `_repeats` fallback). First load after deploy: no `fd_schedule_draft` key → `_draftSched()` returns a deep clone of published → grid renders identically. No data moves. Confirmed in review: **nothing outside `staff.js`/`fd-schedule.js` reads the schedule** (reports/payroll included).

### Rollout + rollback (expanded per review)
- **Mixed-version window:** during rollout, v6.19 devices still edit `fd_schedule` live while v6.20 devices edit a draft cloned from a (possibly stale) baseline; a later Publish could revert a v6.19 live edit (whoever's `updatedAt` is newer wins). **Mitigation:** after deploy, Publish once from a v6.20 device to set the baseline, and edit the FD schedule from one device until all devices show v6.20 (tap the ↻ badge to update).
- **Rollback:** revert the feature commits on `dev` before the dev→main merge. A leftover `fd_schedule_draft` key is inert (old `getFdShift` never reads it). No published data touched either direction.

## Files
| File | Change |
|---|---|
| `js/app/fd-schedule-util.js` | **NEW** — verbatim port of TD util (node-safe pure helpers) |
| `test/fd-schedule-util.test.js` | **NEW** — port TD's unit tests |
| `test/fd-schedule-render.test.js` | **NEW** — port TD's DOM/render tests (draft diff, read-only published preview regression, pill/toggle) ← **added per review** |
| `js/app/features/fd-schedule.js` | Rewrite: draft/publish + 2-week bands + structural-diff highlight + bounded repeat |
| `js/app/staff.js` | `renderFdView`: port the WHOLE header region (~275-292) — single-week→4-week cards: rename `ws`→`baseWs`, drop dead `we`, add `monthEnd`, swap `schedLabel` to TD's offset-aware form, `import { weekBandTitle }` ← **scope corrected per review** |
| `index.html` | Add `#fd-sched-draftbar`, `#fd-sched-payperiod`, "Changed (draft)" legend; relabel `#fd-mode-every` (index.html:1961) "Every week" → "Repeat next 4 weeks"; decide the now-mostly-dead "Repeats weekly" legend chip (index.html:1375) |
| `css/styles.css` | Add `.fd-cell-changed`/`.fd-cell-old` (+ `html[data-appearance="dark"]` variant) — confirm Muse uses `data-appearance="dark"` |
| `js/app/config.js` + `version.json` + `sw.js` | Version trio v6.19 → **v6.20**; add `/musedashboard/js/app/fd-schedule-util.js` to `sw.js` PRECACHE |
| `js/app/main.js` | WHATS_NEW v6.20 entry — copy MUST state the weekly auto-repeat is now a bounded 4-week stamp (per review). `fdSchedule` already in the window-glue spread (main.js:56). |
| `js/app/features/notifications.js` + `notif-util.js` | Add an "unpublished FD schedule" bell item (read-only, managers only) — per D2=A |

## Settled source (read + confirmed)
- TD `js/app/fd-schedule-util.js` — port verbatim (self-contained, repo-agnostic). `payPeriodForDate` == Muse `reports.js payPeriodDates` (payroll source) EXACTLY, so the chip agrees with payroll; `staff.js _fdPayPeriodAt` agrees on the from/to dates with a cosmetic +999ms on the bimonthly end only (immaterial). (COMP-4: add one test asserting util==reports.js for the same config+date so they can't drift.)
- TD `js/app/features/fd-schedule.js` — port near-verbatim; external deps all confirmed present in Muse (`cfg().pay_period` {type,startDate}; `window.showWarnModal(title,body,onConfirm,confirmLabel)` from queue.js:2457; `localDateStr` local-no-UTC).
- TD CSS (3 rules + dark variant), index.html additions, staff 4-week `_staffWeekCard` loop — all captured.

## Task order (TDD per rigorous-build / ship)
1. **`fd-schedule-util.js` + BOTH test files** — port util + `test/fd-schedule-util.test.js` + `test/fd-schedule-render.test.js` + the new util-vs-reports equality test; `node --test-force-exit --test <file>` each, RED→GREEN. **`git add` the new files explicitly.**
2. **`features/fd-schedule.js`** — draft layer, publish/discard, 2-week bands, structural-diff highlight, bounded repeat. `node --check`. (Single-editor per D3=A — no compare-and-clear. No `_repeats` migration per D1=A.)
3. **`index.html` + `css/styles.css`** — draftbar/payperiod hooks, legend, repeat relabel, diff CSS. (Legend: keep "Repeats weekly" chip only if any legacy pattern could still render; otherwise drop it — decide at build by checking the rendered grid.)
4. **`staff.js`** — 4-week rolling cards (published only), full header-region port.
5. **Notification-bell "unpublished FD schedule" item** (per D2=A) — managers only, read-only.
6. **Version trio v6.20 + PRECACHE + WHATS_NEW.** Full suite per-file (report counts); `node --check` changed JS. **Pre-merge: `git ls-files --error-unmatch` the 3 new files + the trio, and a clean `git status`, before dev→main.**
7. **Browser-verify** (disconnected preview — dispatches stay local): edit → amber highlight + pill count; Draft/"What staff see" toggle (published read-only; clicking a cell in preview flips back to draft — the 955b846 regression); Publish moves draft→published & clears pill; Discard reverts; "Repeat next 4 weeks" stamps 4 weeks incl. beyond the visible window; **legacy-`_repeats` salon**: first repeat-stamp correctly shows N structural changes on visually-identical cells (expected, not a bug) and week-5+ behavior is understood; staff view shows 4 weeks and is byte-identical with a pending draft. (PRECACHE path + true cold-offline load are NOT exercised by the disconnected preview — confirm the precache string matches the served path after deploy.)

## Test plan
- Unit: port TD's `fd-schedule-util.test.js` (resolve incl. SCHED_NONE no-fall-through + legacy fallback; repeatForwardDates rollover; cellChangeKind; structuralChangeCount null/empty/far-window/repeat-over-legacy; payPeriodForDate per type; payPeriodBoundariesInRange; weekBandTitle) + `fd-schedule-render.test.js` (DOM: 2 bands, amber diff in draft only, no-draft no-highlight, pill count, read-only published preview) + 1 new test: util `payPeriodForDate` == reports.js `payPeriodDates` for the same config+date.
- Manual: the browser-verify loop above on a disconnected preview.
- Regression: full Muse suite per-file, all green, report counts.

## Guardrails
- `git push` / `wrangler deploy` NOT in scope — owner's explicit OK each time (client-only → no Worker deploy).
- **Stage the NEW files explicitly** (`git add js/app/fd-schedule-util.js test/fd-schedule-util.test.js test/fd-schedule-render.test.js`); never `git commit -a` for this change. Pre-merge verify all new files AND the version trio are committed (`git ls-files --error-unmatch …` + clean `git status`) — the version-trio-unstaged incident, extended to new source files, would 404 the module and blank the app.
- Version trio moves together, all three COMMITTED.
- Reviewers READ-ONLY; main agent makes every edit.
