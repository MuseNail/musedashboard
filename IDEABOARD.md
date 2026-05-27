# Muse Dashboard — Ideaboard

Parked ideas the owner wants to revisit later (not scheduled). See `ROADMAP.md` for the committed/strategic plan and the Lens-2 commercialization section.

---

## High priority (do when unblocked)

### R7 — In-app card payment (Square Path B: Orders + Terminal API)
**Status: HIGH PRIORITY — blocked on equipment.** Owner needs to acquire the Square Terminal hardware first.

Today payment deep-links to the Square app, and on the installed PWA the operator must manually confirm "did it go through?" (`main.js`), and line-item detail is discarded at the Square boundary. Path B charges itemized **in-app** via the Square Orders + Terminal API — no app switch, auto-confirmation, and line items preserved. This is the largest gap vs. an integrated POS (Square/Toast/Clover). See memory `[[square-payment-plan]]`.

---

## Parked (re-review later)

### R1 — Pre-fill the service price from `baseCost`
**Deferred by owner (2026-05-26).** Reason: **most customers don't pay the base price** — add-ons applied during the service change the price almost every time, so a pre-filled base price would usually be wrong and create more correction taps, not fewer.

If revisited: services already store `baseCost` (used today only as gray placeholder text in the Assign & Price cost field, `queue.js`, and as the auto-fill default in the historical-edit path, `reports.js`). Any future version should only pre-fill where a service is genuinely fixed-price, and make overriding effortless.

### R4 (full) — Unified "search name OR phone" check-in
**Deferred by owner (2026-05-26).** Partial piece already shipped: on the **check-in screen only**, the autocomplete list now masks all but the last 4 phone digits for privacy `(***) ***-1234` (`square-customers.js buildDropdown` `maskPhone`).

Full idea (parked): collapse the two near-duplicate check-in paths (kiosk + Manual Add) into one search-first box that matches name OR phone instantly and shows results before the full number is typed — like Vagaro/Boulevard. Touches the highest-traffic flow, so revisit deliberately.

---

## Green-lit — customer directory & notes (build next chat; Fix 3 at migration) — 2026-05-26

The owner reviewed the customer-directory/notes design and **green-lit Fixes 1–3** (Fix 4 recorded as very low priority). No code written yet.

### Fix 1 — atomic Square refresh (GREEN ✅, urgent, migration-independent)
`loadSquareCustomers` (square-customers.js) paginates and, on a non-OK page, does `break` but **still overwrites `customerDirectory` + `squareCustomers` + the `muse_customers` cache with the partial/empty result** — so a rate-limit/500 (or a failed first page) silently truncates or **blanks** the directory; dropped customers take their notes' visibility with them. **Fix:** replace the dir/cache ONLY on a fully successful pull (all pages OK + cursor exhausted); on any page error keep the existing dir/cache + toast "sync incomplete"; optionally refuse to replace if the new set is suspiciously smaller. Also let a failed auto-load retry (today main.js `_custAutoLoaded` is set true even on failure). Day-to-day: invisible on success; on failure you keep your last-good list (no waiting, never blocked).

### Fix 2 — stop clobbering Square's note field (GREEN ✅)
`squareUpsertCustomer` writes `note:"Last check-in: <date> | Services:…"` into the Square payload every check-in, overwriting Square's note box so it can never hold a real note. **Fix:** remove the auto-stamp from the payload (owner doesn't want it; the app already tracks visit history). ⚠️ The Stage-2 recovery "possible lost check-ins" detector parses that stamp — dropping it removes that signal going forward (outbox + failed-ops detectors still work); acceptable per owner. **Deferred (later):** also mirror the app-side note into Square's note box.

### Fix 3 — re-key notes by phone + orphan finder (GREEN ✅, do AT the migration)
`config.customer_notes` is keyed by Square customer ID, so a Square ID change (merge/recreate) orphans the note. **Fix:** key notes by phone (digits) instead of/alongside the Square ID — touches `customerNote`, `showCustomerNote`, `saveEditCustomer`, `fillFromCustomer` + a one-time migration re-keying existing notes (ID→phone via directory lookup). Add a read-only orphan-note diagnostic (count notes whose key matches no current customer). Data-shape change → do during the data migration.

### Fix 4 — leaner refresh (recorded, VERY LOW priority — likely skip)
Full customer pull every app load (once/session, not a timer). Could go incremental. Once Fix 1 lands, this barely matters.

### Explicit calendar ↔ staff mapping (owner is considering)
Today the day-off greying (v3.42) maps a Google calendar to a staff member by **exact name** (case-insensitive, trimmed) — so "John" (calendar) vs "Jon" (staff name, e.g. from Square) won't match and the column won't grey. More robust: a small picker in Settings to explicitly link each calendar to a staff member (and feed any other calendar↔staff features), removing the name-spelling dependency. Owner is thinking about whether it's worth it.

---

## Done (shipped — kept for history)

- **R5 — repeat-customer history badge on the queue card** — SHIPPED v3.32.
- **R6 — record gift-card use at checkout** (record-only; keeps app balances in sync, never changes the Square charge) — SHIPPED v3.33.
