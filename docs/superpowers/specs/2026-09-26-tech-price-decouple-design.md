# Decouple price entry from completion (tech app) — design

**Date:** 2026-09-26
**Repo:** musedashboard (carry over to turndesk after Muse ships)
**Status:** approved behavior; pending written-spec sign-off

## Problem

Today a technician can only *persist* a price on an in-service service by tapping
**Complete** — the price input holds a draft until then. In practice techs type the
charge in early (before the service is actually finished), which forces them to hit
Complete, which flips `assignment.status` to `'complete'`. The instant a service is
`'complete'`, `getActiveTechEntries` stops counting the tech as busy and
`getTechStatusColor` shows them **Available** everywhere (turns board, floor plan,
"next walk-in" suggestion). Result: the front desk thinks a service is done and a
tech is free when the tech is still working.

**Plain English:** the same tap that saves the price also marks the tech free, so
pricing early makes a busy tech look available.

## Goal

1. Entering/saving a price must **never** change status. Price is just price.
2. The front desk must be able to tell that a **tech** (vs the front desk) entered a
   price on an in-progress service.
3. Completion becomes a deliberate, separate action — a single morphing action button
   in the tech app.

## Non-goals

- No change to how availability is computed (`getActiveTechEntries` /
  `getTechStatusColor`), to `ticketTotal`, to records, or to the `paid` transition.
- No new *stored* status. `techPriced` is a display/provenance flag, exactly like the
  existing `awaitingPrice` flag.
- The existing "Awaiting price" flow (front desk marks done, tech owes price later) is
  unchanged.

## Design

### 1. New flag: `assignment.techPriced` (boolean)

- Set `true` when a **tech** saves a price in the staff app.
- Set `false` when the **front desk** enters/edits the price in the Assign & Price
  modal (`_applyRowToAssignment`, `queue.js`).
- Display/provenance only. The stored `status` stays `'inservice'`. It is inert once
  the service is not in service (the cue is gated on `status === 'inservice'`).
- Rides on the existing `queue.assignmentPatch` op (staff app) and `queue.upsert`
  (front desk) — no store reducer change needed; the assignment object already carries
  arbitrary fields, and the §14 per-assignment field-merge (gated on
  `assignment.updatedAt`) already protects it across devices.

### 2. Staff app — single morphing action button (`js/app/staff.js`, `lineHtml`)

The row shows exactly **one** primary action button whose label/action depends on
state (plus the price input + calculator, unchanged):

| State | Button |
|---|---|
| `waiting` | **Start** (primary) — → `inservice`, status only |
| `inservice`, no saved price and no valid draft typed | **Save price** (greyed/disabled) |
| `inservice`, a valid price typed but not yet saved | **Save price** (primary, enabled) — persists `cost`, sets `techPriced=true`, **status stays `inservice`** |
| `inservice`, price already saved (and draft matches saved cost) | **Complete** (primary) — → `complete` (frees the tech, same as today) |
| `complete` (not awaiting) | **Reopen** (outline) — → `inservice` |
| `complete` + `awaitingPrice` (FD marked done first) | **Save price** (violet) — existing flow, unchanged; keeps status `complete`, clears `awaitingPrice` |

Rules for the in-service button choice:
- "Valid price typed" = `parsePrice(draft) != null && parsePrice(draft) > 0`.
- Show **Save price** whenever the current draft differs from the saved `cost` (or no
  price is saved yet); show **Complete** when a price is saved and the draft matches it.
  This lets a tech re-price (edit → button returns to Save price) and then complete.
- **Complete still requires a price** (a saved `cost > 0`, or comped) — no regression;
  since Complete only appears after a price is saved, this is naturally satisfied.

Removed from the tech row (vs today): the always-present **Complete** at `waiting`, and
the coupling where **Complete** was the only price-persist path at `inservice`.

`staffSavePrice` becomes the general "persist price, stay in service" action (not just
the awaiting-price case): it sets `a.cost`, `a.techPriced = true`, keeps `a.status`,
and dispatches `queue.assignmentPatch`. `staffComplete` becomes a pure status→`complete`
action (still gated on a price existing). `staffStart` unchanged.

### 3. "Price in ✓" cue

- **Tech card:** beside the green **In Service** pill, a small secondary tag
  `Price in ✓` once `techPriced` is set (status stays green — tech reads as busy).
- **Front desk (queue / turns / floor):** the same small `Price in ✓` marker beside the
  In Service pill, shown **only when `techPriced === true`** (an FD-entered price shows
  no marker — the FD already knows). The card stays In-Service green; availability is
  unchanged.
- Implemented as an additive marker next to the existing status pill, **not** a new
  `serviceLineStyle` state (so the base In-Service styling and availability reading are
  untouched). Predicate helper in `status.js`, e.g. `isTechPriced(a)` =
  `a.techPriced && getAssignmentStatus(a) === 'inservice'`, and an entry-level roll-up
  for cards that render at entry granularity.

### 4. Front desk completion (`queue.js`, `cycleServiceStatus`) — unchanged

With a tech-entered price present, advancing `inservice → complete` already finds a
price and completes in one tap. The only related change is `_applyRowToAssignment`
setting `techPriced = false` when the FD sets/edits the price.

## Data / migration / rollback

- Purely additive: a new optional `assignment.techPriced` boolean. Absent = falsy =
  today's behavior, so old data and older clients read fine (no migration needed).
- Rollback: reverting the client code leaves the harmless flag on some assignments; it
  is ignored by old code. No storage keys, DO schema, or records fields change.

## Risk assessment

- **Low.** No change to availability computation, `ticketTotal`, records, or the paid
  transition. Completion still runs through the same `setAssignmentStatus` /
  `applyAssignmentStatus` / `saveRecord` path — just triggered by a deliberate button.
- Behavioral change to watch: a tech now stays "busy" until a real Complete, so the
  front desk must complete promptly when the client checks out. This is the intended
  fix, not a regression.

## TurnDesk carry-over

The TD fork has the same `status.js` / `staff.js` patterns. After Muse ships and is
verified, port the identical change and log it in `turndesk/docs/MUSE-PORT-LOG.md`.

## Version / deployment

Client-only (no Worker change). Bump the trio together: `js/app/config.js`
(`APP_VERSION`), `version.json`, `sw.js` (`CACHE_NAME`). Feature branch on `dev`,
bump once at the `dev → main` step (per branch-workflow), ship via the `ship` skill
with owner OK.
