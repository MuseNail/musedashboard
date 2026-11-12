# Book-next-appointment at checkout — plan v2 (2026-11-11)

> v2 rewritten after the 4-lens adversarial plan review. Key correction: there is **one**
> local finalize chokepoint, `_finalizeTerminalPaid`, not three. All cash/Zelle/gift/card/
> record-as-paid checkouts funnel through it (verified: square-pos.js:499 and :308). The
> legacy Square deep-link path (`proceedSquarePayment`) navigates away to the external Square
> app and marks paid on return in main.js — it is **out of scope** (Square is being retired).

## Goal

**Plain English:** When a sale is paid, offer to book that customer's next visit while
they're still at the desk. Tapping it jumps to the Calendar with a banner ("Booking next
visit for Maya Rodriguez"); the operator clicks an open slot and the New Appointment form
opens with the customer's **name + phone already filled** — they pick service, tech, time.
The banner stays until they save the booking or close it (customer changed their mind).
Owner can turn the prompt off in Settings.

**Technical:** A device-local "rebook mode" in a new `features/rebook.js` (pure helpers in
`rebook-util.js`, mirroring the `notif-util.js`/`notifications.js` split). **One** call —
`maybeOfferRebook(primary)` — at the top of `_finalizeTerminalPaid`, gated by synced
`config.rebook_prompt` (default ON) and by the ticket actually being a service visit. The
card enters rebook mode → navigates to Calendar → shows a banner. `calendar.js`'s existing
`showNewApptModal` autofills name/phone when rebook mode is active; a NEW-appointment save
clears it.

## Agreed design (owner)

- Placement = success card after each paid sale (+ Settings toggle).
- Pre-fill = **name + phone only** (service/tech/time chosen fresh).
- Flow = card → jump to Calendar + top banner → operator clicks a slot → New Appointment
  opens autofilled → banner persists until **save** (new appt) or **close (✕)**.

## Flow (corrected)

1. A sale finalizes in-app → `_finalizeTerminalPaid` runs (the ONE local chokepoint).
2. At its TOP, capture `const primary = queue().find(x => String(x.id) === String(partyIds[0]))`
   (name/phone survive the paid-flip). After the paid loop + toast, call
   `maybeOfferRebook(primary)`.
3. `maybeOfferRebook`: if `shouldOfferRebook(primary, cfg())` → show a small **non-blocking**
   success card (no full-screen backdrop, never blocks the next checkout): "Paid ✓ / Book
   {First}'s next visit while they're here?" + **[Book next appointment]** / **[Not now]**.
   A new sale's card replaces any existing one.
4. **Book next appointment** → `startRebook({name, phone})`: store `_pending`, remove card,
   `showDashPanel('calendar')`, `renderRebookBanner()`.
5. Banner (top of `#panel-calendar`, `aria-live="polite"`): "Booking next visit for **{name}**"
   + ✕ (`cancelRebook()` → clear + hide).
6. Operator clicks a slot. On a **tech** column `calSlotClick` first shows the New/Block
   chooser; "New appointment" → `showNewApptModal`. On the **Unassigned** column it opens the
   modal directly. Both routes reach `showNewApptModal`, which — when `_pending` is set —
   autofills name/phone AND shows an in-modal "Rebooking {name}" chip (so the autofill is
   obviously intentional, not a stale form).
7. `saveAppt` succeeds for a **NEW** appointment (`_apptEditId == null`) while `_pending` is
   set → `finishRebook()` (clear + hide banner). Editing an unrelated existing appt does NOT
   clear it.

## Files & exact changes

### NEW `js/app/rebook-util.js` (pure, node-safe — the unit test imports this)
- `splitName(full)` → `{ first, last }` (first token / rest; trims collapse; handles empty).
- `shouldOfferRebook(entry, cfg)` → boolean:
  `cfg.rebook_prompt !== false` (default ON) && `entry` truthy && `!entry.quickSale` &&
  non-empty trimmed `entry.name` && **has a service** (`(entry.services||[]).length > 0`).
  The service gate cleanly excludes Quick Sale, gift-card-page sales, and retail-only tickets
  (you rebook a service visit, not a gift-card purchase). *(Owner decision A below.)*
- No DOM; no imports from DOM modules.

### NEW `js/app/features/rebook.js` (DOM)
- `import { getState } from '../store.js'` and `const cfg = () => getState().config;`
  (there is **no** exported `cfg` — every feature defines this locally; square-pos.js:12).
  `import { splitName, shouldOfferRebook } from '../rebook-util.js'`.
- Module state: `let _pending = null;` (`{ name, phone }`), device-local, NEVER synced.
- `export function rebookPending() { return _pending; }`
- `export function maybeOfferRebook(entry) {` — **GUARDRAIL comment:** *must only be called from
  the local `_finalizeTerminalPaid`; never from updateStatus / applyChange / onStateChange /
  any sync or webhook handler, or the card would pop on every device for every synced sale.*
  Guard `if (!shouldOfferRebook(entry, cfg())) return;` then `_showCard(entry.name, entry.phone||'')`.
- `_showCard(name, phone)`: remove any existing `#rebook-card`, build a non-blocking card
  (success tint, teal primary, "Not now" ghost, ✕; `role="region"`, `aria-label`; Escape =
  dismiss). Book → `startRebook`; Not now / ✕ / Escape → remove. No auto-dismiss, no backdrop.
- `export function startRebook({ name, phone }) { _pending = { name, phone }; document.getElementById('rebook-card')?.remove(); window.showDashPanel?.('calendar'); renderRebookBanner(); }`
- `export function cancelRebook() { _pending = null; renderRebookBanner(); }`
- `export function finishRebook() { if (_pending) { _pending = null; renderRebookBanner(); } }`
- `export function renderRebookBanner() {` toggle `#rebook-banner` hidden + set
  `#rebook-banner-name` from `_pending`. `}`
- All functions run on demand; no top-level `document` use.

### `js/app/features/square-pos.js` — ONE hook
- `import { maybeOfferRebook } from './rebook.js'`.
- `_finalizeTerminalPaid` (≈598): at the TOP, before the paid loop,
  `const _rbPrimary = queue().find(x => String(x.id) === String(partyIds[0])) || null;`
  (clone-safe: capture name/phone now). At the END, after the toast,
  `maybeOfferRebook(_rbPrimary);`.
- Do **NOT** touch `_markPaidCommit` (it calls `_finalizeTerminalPaid`) or
  `proceedSquarePayment` (navigates to the external Square app; out of scope).

### `js/app/features/calendar.js`
- `import { splitName } from '../rebook-util.js'`. Call `rebookPending()` via `window` (avoid
  any import coupling; no cycle exists since rebook.js never imports calendar.js — direct
  import would also be fine, decide in build).
- `showNewApptModal` (≈1500): after the field-clearing loop, add:
  `const rb = window.rebookPending?.(); if (rb) { const nm = splitName(rb.name); set appt-first=nm.first, appt-last=nm.last, appt-name=rb.name, appt-phone=rb.phone; show an in-modal "Rebooking {rb.name}" chip; } else { hide the chip; }`
- `saveAppt` success (≈1583): `if (_apptEditId == null) window.finishRebook?.();` — NEW appts
  only, so editing an unrelated appointment doesn't silently clear the rebook.
- `calLoadAndRender`: call `renderRebookBanner()` each render (covers initCalendar + the sync
  re-render + tab re-entry). Also call `window.renderRebookBanner?.()` from `showDashPanel`
  after activating `calendar` if calLoadAndRender is not guaranteed on a plain nav *(verify
  showDashPanel('calendar') behavior during build and wire whichever reliably fires)*.

### `index.html`
- Under `<div class="dash-panel" id="panel-calendar">` (line 851): a hidden banner
  `<div id="rebook-banner" class="hidden ..." aria-live="polite">` with `#rebook-banner-name`
  and an ✕ `onclick="cancelRebook()"` (aria-label "Cancel rebooking").
- In the `#appt-modal` header area: a hidden "Rebooking {name}" chip (`#appt-rebook-chip`).

### `js/app/features/settings.js`
- Toggle (near Calendar/front-desk options): "Offer to book the next appointment after each
  sale" → `dispatch('config.set', { key: 'rebook_prompt', value: boolean })`; checked unless
  `config.rebook_prompt === false`.

### `js/app/main.js`
- `import * as rebook from './features/rebook.js'`; add `rebook` to the window-glue
  `Object.assign` list (so inline `onclick="cancelRebook()"` and `window.rebookPending/
  finishRebook/renderRebookBanner` resolve — feature modules are auto-attached; store/sync are not).

### Version trio + What's New
- `js/app/config.js` APP_VERSION, `version.json`, `sw.js` CACHE_NAME → **v6.19** *(owner
  decision C)*. Add `rebook-util.js` + `features/rebook.js` to `sw.js` PRECACHE_URLS. Add a
  plain-English `WHATS_NEW` entry.

## Scope (explicit)

- **Staff app (`staff.js`) and the check-in kiosk have no checkout** → no change, no prompt.
- Legacy **Square deep-link** path is out of scope (navigates away; Square being retired).
- **Group/party checkout:** the card names the primary (`partyIds[0]`, first checked-in) and
  rebooks that guest only — documented v1 limitation, not per-guest.
- **Walk-in with no phone:** allowed; autofills name, phone blank (operator can add one).

## Data safety / migration / rollback

- Additive only. New synced key `rebook_prompt` has the existing per-key stale-write guard
  (store.js configMeta/`cfgmeta:`); old code ignores unknown keys; default-ON via `!== false`;
  rollback = revert files (key goes inert). No storage/record/queue/schema change. Reads only
  `name`/`phone`/`services` off the ticket; never writes the financial record. Appointment
  write uses the unchanged `saveAppt` path. **No money logic touched** — `_finalizeTerminalPaid`
  gains one capture at the top and one call at the end; the paid loop is untouched.
- **Cross-device safety (confirmed by review):** every synced/webhook paid transition marks
  paid via `updateStatus`/`applyChange` (helcim.js:244, main.js), NOT `_finalizeTerminalPaid`,
  so the card fires only on the checkout device. The guardrail comment protects this invariant.

## Test plan (TDD)

Unit (`test/rebook.test.js`, `import './setup-globals.js'` first):
- `splitName`: "Maya Rodriguez"→{Maya,Rodriguez}; "Cher"→{Cher,""}; ""→{"",""};
  "  Ana  Maria Lopez "→{Ana,"Maria Lopez"}.
- `shouldOfferRebook`: ON by default; OFF when `rebook_prompt===false`; false for quickSale;
  false for empty/whitespace name; **false when no service** (gift-card/retail); false for null;
  true for a normal named service ticket.
Browser (disconnected preview): finalize a mock cash sale → card → Book → calendar + banner →
slot click → modal autofilled + "Rebooking" chip → save → banner gone; Not now / ✕ / Escape
dismiss; editing another appt leaves the banner; Settings toggle off → no card; a gift-card/
quick sale → no card.

## Owner decisions

- **A — Which sales prompt?** Recommend **service visits only** (the `services.length` gate —
  excludes gift-card, retail, and Quick Sale automatically). Alternative: every non-quick sale
  (gift-card buyers get offered too).
- **B — Already-booked heads-up?** If the customer already has a FUTURE appointment, should the
  banner show an advisory ("Maya already has an appt Tue Nov 18, 2:00 PM")? The existing
  check-in guard is today-only; nothing warns on a future rebook. Recommend **not in v1** (keep
  it tight); easy to add later.
- **C — Version.** Ship as **v6.19** (push v6.18 first, or both together), vs fold into v6.18.
  Recommend its own v6.19.
