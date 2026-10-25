# W2-4 — Preferred-tech flag (soft), set at check-in

**Batch 3, item 2.** A customer's EXPLICIT preferred technician — distinct from the existing
auto-derived "usually w/ <tech>" (reports.js `customerVisitSummary.usualTechId`, a most-frequent
count). Owner decisions (AskUserQuestion 2026-10-24):
- **Set ONLY at check-in** (no Edit-Customer picker). Stored on the customer so it persists + pre-fills next visit.
- **Badge + suggestion NUDGE** — the preferred tech is surfaced first in suggestions when that tech is available & can do the service.
- **Badge shown on all four:** Queue card, Assign & Price, Check-in, Turns board.

## Goal (plain English)
While checking a customer in, the front desk can pick that customer's preferred tech. It's saved to
the customer (so it comes back next time and shows wherever they appear as "⭐ Prefers Anna"), and the
turn suggestion will put Anna forward for them when she's free and can do the service — but it never
hard-assigns (that's W2-7) and never forces a tech who's off/on-break/can't-do-it.

## Data model
- Add optional `preferredTechId` to the customer entity (`customer:<id>`, square-customers.js
  `ensureCustomerInStore` ~742 / the `customer.upsert` dispatches ~760/764). Additive, synced, back-compat
  (absent = no preference). The `customer.upsert` op + store already carry arbitrary customer fields.
- Display/suggestion lookup: a new `preferredTechIdFor(phone)` in square-customers.js — resolve the
  customer by phone (`getState().customers.find(c => notePhoneKey(c.phone)===notePhoneKey(phone))`) →
  `preferredTechId` (mirrors `customerNote(phone)`). Plus `preferredTechBadgeHtml(phone)` → "⭐ Prefers
  <firstName>" or '' (resolves the tech via staffById; '' if the tech is inactive/removed).

## Build
1. **Check-in picker** (queue.js `renderManualGuestCard` ~499, per guest): a "Preferred tech · optional"
   `<select id="manual-preftech-<idx>">` ("— None —" + active staff). Pre-fill from the saved
   `preferredTechIdFor(phone)` when the guest's phone/customer is recognized — hook into the SAME place
   the customer note auto-loads on phone entry / autocomplete pick (fillFromCustomer / the phone-input
   path), with a touched guard so a live re-fill never stomps a manual pick.
2. **Save on submit** (queue.js `submitManualAdd` ~828 guest loop ~800-820 + `upsertPartyCustomers`
   ~941/949): read each guest's picker; thread the value into the customer save so `ensureCustomerInStore`
   writes `preferredTechId` onto the customer (set when a tech chosen; clear when "— None —" explicitly
   chosen; LEAVE unchanged when the picker was never touched, so an un-recognized quick check-in doesn't
   wipe a saved preference).
3. **Badges (display-only)** via `preferredTechBadgeHtml(entry.phone)`:
   - Queue card: queue.js `buildQueueRow` next to the returning-customer `visitBadge` (~304).
   - A&P: the guest-section header in `_renderAssignOneList` (~1847, near the name inputs).
   - Turns board: the waiting/active `buildCard` name row (turns.js ~901) and/or the tech-grid slot.
   - Check-in: the picker itself is the set+display; no separate badge needed on the form.
4. **Suggestion nudge** (turns.js `suggestTechsForEntry` ~295, which drives the on-card "→ Name?" hints):
   resolve the entry's `preferredTechIdFor(entry.phone)`; if that tech is in `eligibleBase` (not
   off/break, no active entry, dropHolders) AND `_techDoesService(tech, sid)` for a still-needed service,
   assign that service to the preferred tech FIRST (highest servicePrefRank), then run the normal
   rotation for the remaining services. Never force an ineligible preferred tech → silent fallback to
   fairness. Consider `suggestTechForService` too, but it has no customer context (service-only); the
   displayed per-card suggestions come from `suggestTechsForEntry`, so scope the nudge there. The raw
   turn COUNTS (`getTechTurns`) are untouched — only which tech is *suggested* shifts.

## Decisions to confirm at sign-off
1. Un-touched picker on a quick check-in = LEAVE a saved preference as-is (don't clear). "— None —"
   chosen explicitly = clear. A tech chosen = set. [recommended]
2. The nudge only fires when the preferred tech is genuinely eligible (available, not holding, can do
   it); otherwise normal fairness — so a preferred customer never freezes the board or jumps an
   off/busy tech. Raw turn counts unchanged (fairness accounting intact).
3. Badge text "⭐ Prefers <first name>"; hidden if the preferred tech is inactive/removed.

## Risk / rollback
Additive customer field + display badges + a suggestion reorder (no hard assignment, no turn-count
change, no financial/records path). Rollback = revert. The only persisted change is the additive
`preferredTechId`; absent = today's behavior.

## Tests (pure cores)
- `preferredTechIdFor` resolves by phone, null when absent/no-phone.
- The nudge decision as a pure core (given preferredTechId + eligible set + canDo → that tech picked
  for the preferred service, else fallback) — extract so it's unit-testable without the DOM/turn state.
- The set/clear/leave semantics (touched + value → write | clear | leave).

## Review lenses (plan)
1. Correctness/data-safety: the customer-save threading (don't wipe a saved pref on a shared-phone or
   un-touched quick check-in; shared-phone party dedupe like upsertPartyCustomers); pre-fill/touched
   guard; staffById null (removed tech) everywhere.
2. Suggestion-engine correctness + fairness: does nudging suggestTechsForEntry break the per-customer
   "one tech per service" / bonus-specialist logic or the fewest-turns invariant; is scoping the nudge
   out of suggestTechForService right; any double-count or display/next-up inconsistency.

---
## Plan-review triage (2 lenses) — 4 HIGH; plan hardened
**HIGH-1 (customer.upsert is WHOLE-OBJECT REPLACE):** store.js `upsertByIdGuarded` does `arr[i]=item`; DO does `put`.
Edit-Customer save (sq-cust:665), import-from-Square (~119), CSV import all rebuild the customer from scratch →
would WIPE `preferredTechId` (and ANY additive field). REQUIRED FIX (broadens W2-4, good hygiene): spread
`...(existing||{})` into those rebuilt objects so unknown/additive fields survive. Audit every customer.upsert/
bulkUpsert producer.
**HIGH-2 (shared-phone party):** `preferredTechId` is phone-keyed (cust-<pk>); a same-contact guest shares ONE
record. A per-guest picker on guest 2 is dropped by upsertPartyCustomers' phone-dedupe, and its badge would resolve
the PRIMARY's pref. FIX: render the picker READ-ONLY "shared with primary" for same-contact guests (idx>1 +
manual-same checked), one pref per distinct phone — mirrors the notes-box dupe handling. DOCUMENT: a shared-phone
party can't hold distinct per-person preferences.
**HIGH-3 (kiosk handoff):** on waiver+kiosk, upsertPartyCustomers runs LATER in kioskHandoffConfirm (checkin.js:402),
DOM gone. The picker value MUST ride on the ENTRY (serialized through kiosk_handoff), not read from the DOM at upsert.
FIX (resolves the lens-A "don't stash on entry" tension): stamp a JSON-safe TRI-STATE resolved value on the entry in
collectManualEntries — `entry.preferredTechId = <id>` (set) | `null` (clear, "— None —" touched) | ABSENT (leave,
untouched). ensureCustomerInStore reads `('preferredTechId' in entry)` from the entry, never the DOM. It's a benign
customer attribute (not a transient flag), harmless if it rides onto a record; reports ignore it.
**HIGH-4 (nudge breaks invariants):** in suggestTechsForEntry — servicePrefRank ranks REGULAR only; a limited-bonus
specialist preferred tech can do no regular svc; pre-assigning them to a regular line adds them to `used` so their
only-they-can-do BONUS svc then gets no suggestion; and the later pass double-assigns unless the pre-picked svc is
removed from `need`. FIX: compute `need` first; `preferredService` = highest-pref sid in need where
`canDo(preferred,sid)` AND preferred ∈ eligibleBase; if preferred is a limited-bonus specialist needed for a bonus
svc only they can do, skip the nudge (fall back) or hand them the bonus; set out[preferredService], used.add,
EXCLUDE from the bonus/regular passes. Extract a PURE `nudgeDecision(...)` core + unit test.
**MED:** picker lives in the per-guest notes-strip box (manualGuestBoxHtml) so updateManualGuestBox drives its
pre-fill + touched guard on phone-recognition (card placement wouldn't). ensureCustomerInStore tri-state in BOTH
branches (existing patch + new-customer 764). Queue badge rendered OUTSIDE the visitNum>=2 gate (new customers too).
Deconflict: when explicit pref set, SUPPRESS the auto "usually w/ <tech>" (show only ⭐) — OWNER DECISION #3.
**LOW:** removed/inactive tech → badge '' + nudge gated + untouched pre-fill of an inactive id must NOT flip the
stored value (leave). preferredTechIdFor prefers a same-phone match that HAS preferredTechId (dup customers). Counts
untouched (acceptSuggestion assigns identically; getTechTurns never mutated by suggestion code). Next-up badge is a
separate fewest-turns calc — nudge does NOT move it; the turns-card "⭐ Prefers X" is a standalone tag. suggestTech-
ForService is DEAD CODE (zero consumers) — don't touch.
