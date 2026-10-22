# Plan — Check-in from a customer lookup (Wave 2 #2)

Date: 2026-10-21 · Repo: musedashboard (ports to TurnDesk) · Area: customers/check-in · low-risk (reuses existing flows)

## Goal
When you look up a customer, add a **"Check in"** action that opens the normal manual check-in
builder **pre-filled** with that customer's phone + name — so you don't re-type them. It goes
THROUGH the existing builder (`showManualAdd`), so the waiver gate, duplicate-check-in guard, and
appointment guard all still apply, and the operator still picks the service(s).

## How it works today (grounded)
- Manual check-in builder: `queue.js showManualAdd()` opens `#manual-modal` with one guest card
  (fields `manual-phone-1` / `manual-first-1` / `manual-last-1`) and focuses the phone.
- `square-customers.js fillFromCustomer(customer, guestIdx, prefix, phoneId, firstId, lastId)` fills
  those fields from a `{phone, given_name, family_name}` object and (for `manual-*` ids) opens the
  on-file note panel. Stored customers use `{id, firstName, lastName, phone}` → adapt the shape.
- Lookup surfaces: the Customers tab table (`renderCustomersTab`, rows keyed by `c.squareId` = the DO
  id) and the edit-customer modal (hidden fields `edit-cust-first/last/phone`). Global header search
  rows are single-action (`go`) — deferred (see below).

## Changes (all in square-customers.js + index.html; reuse queue.js's showManualAdd)
1. **`checkInCustomer(doId)`** (new, exported → window): `getState().customers.find(c=>String(c.id)===String(doId))`;
   if found, close the edit-customer modal if open, `window.showManualAdd()`, then (after a tick for
   the builder to render) `fillFromCustomer({ id:c.id, phone:c.phone||'', given_name:c.firstName||'',
   family_name:c.lastName||'' }, 1, 'manual', 'manual-phone-1', 'manual-first-1', 'manual-last-1')`.
   Guard: a phone-less customer still works (fillFromCustomer tolerates '' — formats to '', note panel
   skipped). Toast if not found.
2. **`checkInFromEditCustomer()`** (new, exported → window): read the modal's `edit-cust-first/last/phone`
   fields, close the modal, `showManualAdd()`, `fillFromCustomer({...})`. (Reads fields so it works in
   "add" mode too, though primarily for an existing profile.)
3. **Customers tab row**: add a 7th column with a "Check in" button
   (`onclick="event.stopPropagation(); checkInCustomer('<squareId>')"` so it doesn't also open the
   profile). Update the `<thead>` (+1 `<th>`) and the empty-state `colspan` 6→7.
4. **Edit-customer modal footer** (index.html `#edit-customer-modal`): add a "Check in" button next to
   Save/Delete → `checkInFromEditCustomer()`.

## Deferred (note to owner)
Global header search customer rows are single-action; adding a check-in there means touching the shared
row template — easy follow-on, left out to keep this tight. The Customers tab + profile cover "looking up."

## Test plan
- Unit: `checkInCustomer` lookup/adapt is mostly DOM-wiring (hard to unit-test meaningfully); the pure
  bit is the shape adapter — trivial. Rely on the diff review + a preview boot check (helpers load, the
  handlers are on window).
- Full suite green. Owner eyeballs on a device: look up a customer → Check in → builder opens pre-filled
  with phone+name → pick a service → the waiver/dup guards still fire.

## Rollback
Additive (new handlers + a column + a button). Revert the commit. No data/schema change.
