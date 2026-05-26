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

## Shown but not yet decided (owner reviewing in-app mockups)

- **R5 — repeat-customer history badge on the queue card** (visit count + lifetime $ + usual tech). Mockup shown in-app 2026-05-26.
- **R6 — apply a gift card as tender at checkout** (tender row in the pay-confirm flow instead of hand-logging a redemption in the gift-card editor). Mockup shown in-app 2026-05-26. *Financial — confirm design before building.*
