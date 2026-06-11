# Muse Dashboard — Ideaboard

Parked ideas the owner wants to revisit later (not scheduled). The active pipeline is `PRIORITIES.md`. Cleaned 2026-06-11 — shipped/obsolete entries pruned (R5/R6 shipped long ago; R7 Square Path B and the Square-customer-loading fixes became moot when Helcim went live and customers moved into the Durable Object).

---

## Owner-flagged "revisit later" (from the 2026-06-10 UX audit)

### B6 — Checkout screen redesign
Owner rejected the tip-presets/card-first proposal but wants the checkout looked at again later. **Hard constraints learned:** tips are CUSTOMER-CHOSEN dollar amounts — manual entry every time, never percentage presets; no customer-facing display planned.

### B7 — Collapse the kiosk Walk-In vs Pre-Booked buttons into one Check In
**Constraint:** the `isAppointment` flag is load-bearing — the owner wants walk-in vs appointment counts in reports, so any single-button design must still capture it. Kiosk polish is LOW priority (front desk mostly drives the kiosk).

---

## Parked (re-review deliberately)

### R1 — Pre-fill the service price from `baseCost`
**Deferred (2026-05-26):** most customers don't pay base price (add-ons change it almost every time), so pre-fill would create more correction taps. If revisited, only pre-fill genuinely fixed-price services.

### R4 — Unified "search name OR phone" check-in
Collapse the two near-duplicate check-in paths (kiosk + Manual Add) into one search-first box (like Vagaro/Boulevard). Touches the highest-traffic flow — revisit deliberately. (The privacy piece shipped: kiosk autocomplete masks phones.)

### Explicit calendar ↔ staff mapping
Day-off greying maps a Google calendar to a staff member by **exact name match** — "John" vs "Jon" silently fails. A small Settings picker linking each calendar to a staff member would remove the spelling dependency. Owner is considering.

### Settings "What's new" link
The version badge already reopens the changelog popup (`window.showWhatsNew()`, v4.81); a labeled link in Settings would make it more discoverable. Tiny.

---

## Growth candidates
The bigger competitive features (automated SMS reminders, review requests, card-on-file/deposits, online booking) are tracked in `PRIORITIES.md` §5 — they're pipeline candidates, not parked.
