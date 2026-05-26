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

## Saved for later (2026-05-26)

### Harden directory Square-sync against partial-pull data loss
`loadSquareCustomers` (square-customers.js) paginates and, on a non-OK page response, does `break` but **still overwrites `customerDirectory` + the `muse_customers` cache with the partial result** — so a rate-limit/500 mid-pagination silently truncates the directory. Manual customer notes live separately in `config.customer_notes` (keyed by Square ID, synced via the DO) and are NOT deleted, but dropped customers take their notes' *visibility* with them; an ID change (Square duplicates/recreated records) also orphans a note under the old ID. **Fix:** only replace the directory on a fully successful pull (all pages OK, cursor exhausted); on any page error, keep the existing directory + cache and toast "sync incomplete." Optionally refuse to replace if the new set is suspiciously smaller than the cached one.

### Orphaned-notes recovery check (optional)
A small read-only diagnostic: count `config.customer_notes` entries whose key (Square ID) no longer matches any current directory customer — surfaces notes orphaned by an ID change so they can be re-mapped. Note text also survives in the nightly Sheets backup + DO config.

---

## Done (shipped — kept for history)

- **R5 — repeat-customer history badge on the queue card** — SHIPPED v3.32.
- **R6 — record gift-card use at checkout** (record-only; keeps app balances in sync, never changes the Square charge) — SHIPPED v3.33.
