# W2-7 — Assign tech + station at check-in (per service)

**Batch 3, item 3 (LAST).** A HARD assignment at check-in, distinct from W2-4's soft preferred flag.
Owner decisions (AskUserQuestion 2026-10-24):
- **PER SERVICE** — a tech + station picker for each selected service line (not per-guest).
- **On every guest, always** — available for any check-in (walk-in or appointment), not appt-gated.
- **Independent of the preferred flag** — the assign-tech starts BLANK, never auto-filled from ⭐ preferred.

## Goal (plain English)
When you check someone in, under each service you pick for them you can also choose a tech and a
station. That service arrives already assigned to that tech/seat (status stays "Waiting" until you
start them — same as today's appointment pre-assign). Leave it blank and it's unassigned, exactly as
now. Because it's a real assignment, it counts a turn at assign-time, just like assigning in Assign &
Price does. It's separate from the ⭐ preferred tech (which only suggests) — this one actually assigns.

## What exists (build on / replace)
- Check-in guest card Services grid (`serviceButtonsHtml`, queue.js:496; toggled by
  `onclick="this.classList.toggle('selected')"` — a pure visual toggle, no handler).
- The "Appointment" checkbox (`manual-is-appointment`) shows ONE party-wide "Technician" picker
  (`manual-appt-tech`, index.html:1628) → `collectManualEntries` (855) pre-assigns that one tech to ALL
  services of ALL guests, station:'' . This party-wide picker is SUPERSEDED by the per-service assigner.
- `stationDefs()` (queue.js:47) → [{id,label}]; `activeStaff()`/`byName` for tech options (same as the
  A&P `stationOptions`/`techOptions`).

## Build
1. **Service toggle → handler** (`serviceButtonsHtml` → add `idx`; onclick `toggleManualService(this, idx)`):
   toggle `.selected` AND re-render the per-service assign rows for that guest.
2. **Per-service assign rows** — a container `<div id="manual-assign-${idx}">` after the Services grid.
   `renderManualAssignRows(idx)`: for each `.service-btn.selected` in that guest, render a compact row:
   `<service label> : [tech <select>] [station <select>]`, ids `manual-asn-tech-${idx}-${sid}` /
   `manual-asn-stn-${idx}-${sid}`. Tech select = "— Unassigned —" + active staff; station = "— No seat —"
   + stationDefs. ⚠️ PRESERVE existing picks across a re-render (toggling another service must not reset
   rows already filled): read current values into a map before re-rendering, restore matching rows. Rows
   for DESELECTED services disappear (their pick is dropped — the service isn't being added).
3. **Build assignments on submit** (`collectManualEntries`, queue.js:843-855): for each guest, for each
   selected service read its tech+station; build `entry.assignments = services.map(sid => ({ serviceId: sid,
   techId: <pick|''>, station: <pick|''>, status: 'waiting', cost: 0, ...(techId ? { assignedAt: Date.now() } : {}) }))`.
   Only set assignedAt when a tech is chosen (so turn-counting + the A&P "assigned" state are correct; an
   unassigned service has no assignment-with-tech). REPLACE the `apptTechId` branch (855) with this.
4. **Appointment picker** (index.html:1628 `manual-appt-tech-wrap` + `toggleManualApptTech` queue.js:~780):
   the party-wide tech picker is removed/hidden; the "Appointment" checkbox stays (sets `isAppointment`).
   `apptTechId` read goes away. Confirm no other reader of `manual-appt-tech`. [OWNER DECISION — surface it]
5. **Kiosk hand-off:** `entry.assignments` already rides the entry through the kiosk serialization (the
   appt pre-assign relies on this today), so per-service assignments survive the waiver/kiosk route.
6. **Reset on open:** `showManualAdd` / `addManualGuest` start with no assign rows (empty selection);
   `removeManualGuest` drops the guest's rows.

## Interactions / correctness
- Turn count: a tech-assigned service at check-in counts a turn at assign-time (countOnAssign default ON),
  identical to the current appointment pre-assign — intended.
- A&P consistency: an entry that arrives with assignments (techId+station) opens in A&P already populated;
  `_renderAssignOneList` reads entry.assignments — so the picks show there. Verify no double-create.
- Same-contact guest: has their OWN services + their own assign rows (unlike the single shared note); a
  party member can be assigned independently. (The assign rows are per guest, keyed by idx.)
- `_techDoesService` is NOT enforced at check-in (the front desk may deliberately assign anyone) — but
  consider a soft note if the chosen tech can't do it (optional; the A&P flow warns later).

## Risk / rollback
Touches the check-in assignment build (creates assignments with techId/station) — a queue-state path,
not financial/records. The assignment shape matches the existing appt pre-assign + A&P
`_applyRowToAssignment` output. Rollback = revert. No persisted-schema change (assignments already carry
techId/station/assignedAt). Version-trio bump as usual.

## Tests (pure cores)
- A pure `buildCheckinAssignments(services, picksByService)` → the assignments array (techId/station/
  assignedAt-only-when-tech), tested for: unassigned (no tech, no assignedAt), tech-only, tech+station,
  a mix across services, and that a deselected service contributes nothing.

## Review lenses (plan)
1. Correctness: the preserve-picks-across-re-render logic; assignedAt only when tech set; the
   collectManualEntries replacement not breaking the non-assigned path or the appt flow; every reader of
   manual-appt-tech / apptTechId found and handled; the kiosk hand-off carrying assignments.
2. UX/consistency: per-service rows on a busy multi-service party (layout/scroll); station options
   (all stations vs filtered); turn-count + floor/turns reflecting the pre-assignment; does removing the
   party-wide appt picker lose any appointment behavior (reminders, the appt badge, calendar match)?

---
## Plan-review triage (2 lenses) — 1 HIGH + refinements; plan hardened
**HIGH (both lenses) — never build an all-blank assignments array.** Today a plain walk-in has NO
assignments array; updateStatus (queue.js:411-421) branches on it, and status.js deriveEntryStatus reads
it. An array of techId:'' assignments would (a) leave an unassigned walk-in STUCK in Waiting (the In
Service button can't advance it — no assignment has a tech → deriveEntryStatus recomputes 'waiting') and
(b) widen the blast radius for every walk-in. FIX: emit an assignment row ONLY for a service where a TECH
was chosen; a service with no tech contributes nothing (keeps today's shape; A&P creates it later). Set
`entry.assignments` only when the result is non-empty. Pure core signals the all-unassigned case.
**Station gated on tech (LOW+HIGH):** a station without a tech can't seat (floorplan keys on techId &&
station). So the station <select> is DISABLED until that row's tech is set; a station-only pick is
impossible → no useless/lost picks.
**Incremental rows, not full re-render (MED, better than the draft):** `toggleManualService` ADDS the one
new row on select / REMOVES just that service's row on deselect, leaving sibling rows (and their picks)
untouched. Eliminates the save/restore map entirely + can't clobber an open select. Re-select of a
toggled-off service starts BLANK (its row was removed). Use getElementById for the `-${sid}` ids.
**Appt picker (MED):** lowest-risk — `display:none` on #manual-appt-tech-wrap, KEEP toggleManualApptTech
(it is null-tolerant → harmless no-op so the checkbox onchange never throws), delete only the apptTechId
read + the line-855 build. Appointment checkbox stays (sets isAppointment).
**Tech options (MED):** mirror A&P `techOptions` — CHECKED-IN techs (turns_order) first, append an
off-rotation tech only if already chosen — NOT bare activeStaff(). Keeps turn-count consistency (assigning
counts a turn at assign-time; don't book one for a tech not on the floor unless deliberately picked).
**Station occupancy (MED):** label a station already held by a non-paid entry as "<label> (occupied)" in
the <select> (compute from q()); FD can still override, but no silent double-book. (No hard block.)
**seatCustomer floor-chair overwrite (MED):** floor-chair check-in (floorSeatPending → seatCustomer)
blanket-overwrites a.station. FIX: `if (!a.station) a.station = stationId` so per-service stations chosen
at check-in aren't silently replaced by the one tapped chair.
**assignedAt (MED wording + LOW ordering):** turn-COUNTING gates on techId, NOT assignedAt (keep
assignedAt-only-when-tech for turn-board SORT order; offset `Date.now()+index` so same-submission
assignments sort stably). Test the real invariant: unassigned → techId '' (never counted); teched →
techId set + assignedAt present.

### Pure core (revised)
`buildCheckinAssignments(selectedServiceIds, picks, nowBase)` where picks[sid] = {techId, station};
returns an array with ONE assignment per service that HAS a techId: {serviceId, techId, station:
(techId ? station||'' : ''), status:'waiting', cost:0, assignedAt: nowBase+index}. Services without a
techId are omitted. Returns [] when none → caller leaves entry.assignments undefined.
