# NL1 — Assign & Price notes panel "looks like the check-in" (3 sections)

**Batch 3, item 1.** Owner: "The assign and price modal notes section should look just like the
check in, with the sections." The dashboard check-in's per-guest box has THREE labeled sections —
**Customer note** (synced, phone-keyed) · **Last 3 visits** (read-only history) · **Note for this
visit** (→ entry.txnNote). The A&P modal's side notes panel (`#assign-notes-panel`, index.html
~1944) currently has only **Customer note** + **Today's visit** — it is MISSING the Last-3-visits
history box. NL1 adds that middle section so the A&P panel matches the check-in layout.

## Goal (plain English)
When you open Assign & Price on a customer, the Notes panel on the right now also shows their last
3 visits (date · services · tech · amount, plus any note from that visit) — the same history you
see at check-in — sitting between the always-on Customer note and Today's-visit note. Nothing about
pricing changes; it's purely the notes panel gaining the visit-history section it was missing.

## Scope (what changes / what does NOT)
- CHANGE: `#assign-notes-panel` gains a **Last 3 visits** read-only section between the Customer-note
  block and the Today's-visit block, matching the check-in box's section labels/look.
- NO change to: the Customer-note textarea (`assign-cust-note`, synced via saveAssignCustNote) or the
  Today's-visit textarea (`assign-txn-note` → entry.txnNote via saveAssignTxnNote) — both stay exactly
  as they are. No pricing/records/discount/gift-card logic touched. The A&P modal already shows the
  active guest's notes per tab (`groupAssignEntries[activeGroupTab]`); the history box follows the same
  active-guest selection.

## Design (reuse, don't duplicate)
- The check-in history is built by `_manualHistoryHtml(phone, name, records)` (queue.js ~578), which
  wraps the shared pure `lastVisitsCompact(records, phone, name, 3, svcLabel, techName)` over
  `buildCombinedRecords()` (reconciled totals — agrees with Reports/Edit Customer, never a stale
  `totalCost`). Reuse `lastVisitsCompact` directly for the A&P box (the markup differs slightly from
  the check-in box — a 300px vertical panel vs a 248px strip card — so render A&P-panel-appropriate
  rows, but from the SAME data source + the same date/amount/clamp-3 formatting).
- Add a `#assign-history` div in index.html's `#assign-notes-panel`, with the check-in section label
  style ("Last 3 visits", uppercase micro-label + icon `history`/`schedule`).
- Populate it wherever the panel loads the active guest's notes — the two call sites of
  `_setAssignCustNote(phone)` (queue.js ~1677 single-entry, ~1921 party[0]) and on tab switch. Add a
  small `_setAssignHistory(phone, name)` called right after `_setAssignCustNote` at each site (and in
  the tab-switch path if separate), so the history always reflects the active guest.
- No-phone / no-name → the same empty-state the check-in box uses ("Add a phone number to see visit
  history" / "No visits on record yet").

## Files
- `index.html` — add the Last-3-visits section markup to `#assign-notes-panel` (between ~1955 and ~1956).
- `js/app/features/queue.js` — add `_setAssignHistory(phone, name)` (reusing lastVisitsCompact), call it
  at the `_setAssignCustNote` sites + the active-tab-switch path. Possibly refactor the per-visit row
  renderer so check-in's `_manualHistoryHtml` and the A&P box share ONE row formatter (only if it stays
  clean — otherwise keep A&P's row render local and share just `lastVisitsCompact`).

## Tests
`lastVisitsCompact` is already pure and (per the batch history) tested. NL1 adds no new pure logic —
it reuses it. If I extract a shared row formatter, add a focused test for it; otherwise the existing
`lastVisitsCompact` coverage + a live check is sufficient. Verify in the browser: open A&P on a
customer with past visits → the 3 visits show, match Reports; a no-history customer → empty state;
switching party tabs updates the history to the active guest.

## Risk / rollback
Display-only, read-only history box. No persisted-data or pricing path touched. Rollback = revert the
index.html section + the `_setAssignHistory` calls. No version-trio data concern (still a normal bump).

## Open question for the owner (confirm at sign-off)
The A&P panel is 300px wide and already fairly tall (Customer note 138px + Today's-visit note). Adding
a 3rd section makes it taller. Options: (a) fixed-height scroll for the history box (like check-in's
124px box) so the panel height stays controlled [recommended]; (b) let the panel grow. Default: (a).

## Review lenses (plan)
1. Correctness/reuse — does reusing lastVisitsCompact + the active-tab wiring cover all A&P open paths
   (single entry, party, tab switch, quick-sale?) without a stale/empty history box?
2. Completeness/UX — layout fit at 300px, the party/tab case, the no-phone empty state, and whether
   any other A&P entry path (e.g. the second render path in queue.js ~1798) also needs the call.

---
## REVISED after plan-review (2 lenses) — the first draft targeted DEAD code

**Root correction (HIGH, both lenses):** the live A&P modal is `_renderAssignOneList`
(`ASSIGN_ONELIST=true`, queue.js:1526). The tabbed path (1531–1678, incl. `_setAssignCustNote` at
1677, `renderGroupAssignTabs` 1329, `switchGroupTab` 1352) is **dead code** in production. There is
ONE live notes-load site: queue.js:1920–1921, hardwired to **`party[0]`** — so today the A&P side
panel already shows only the FIRST guest's customer note + today's-visit note, even for a 2–3 person
party. The "per-tab / tab-switch / active-guest" wiring in the first draft does not exist live.

**Corrected design (minimal, reuse-only):**
- index.html `#assign-notes-panel`: insert a **Last 3 visits** section (its own `flex-shrink-0`
  `border-b` block) between the Customer-note block (~1955) and the Today's-visit block (~1956).
  Container `#assign-history` gets an EXPLICIT height (~124px) + `overflow-y-auto` — REQUIRED, not
  optional: `_manualHistoryHtml`'s empty states use `h-full`, which collapses to 0 without a
  definite-height parent (MEDIUM).
- queue.js: `_setAssignHistory(phone, name)` = `document.getElementById('assign-history').innerHTML
  = _manualHistoryHtml(phone, name)`. `_manualHistoryHtml` is module-local (578) → call it DIRECTLY.
  No new row renderer, no shared-formatter extraction, no new unit test — reuse guarantees escaping,
  clamp-3, both empty states, and the exact date/amount formatting that matches check-in + Reports
  (MEDIUM). Let it call `buildCombinedRecords()` itself (one box, one call — no cached hand-off; LOW).
- Call site: add `_setAssignHistory(party[0].phone, party[0].name)` right after queue.js:1921 (pass
  BOTH phone + name — lastVisitsCompact matches by name when no phone; party[0] non-null; LOW). Also
  add after the kept-but-dead 1677 for the `ASSIGN_ONELIST=false` alternate layout parity (harmless).

**Owner decisions surfaced (sign-off gate):**
1. ⭐ PARTY CASE: the A&P side panel is first-guest-only today (pre-existing). Option **A** = add the
   history box to the side panel, first-guest-only (small, consistent with today; for the common
   single-guest check-in it's identical to check-in). Option **B** = render a per-guest history inside
   each guest's section of the one-list (guestSections ~1825) to truly match check-in's per-guest boxes
   (bigger; and really wants the cust-note/txn-note made per-guest too). → ASK.
2. LABELS: check-in reads Customer note / Last 3 visits / Note for this visit · optional; A&P reads
   "Customer note · always" / "Today's visit". Align A&P's two labels for parity, or keep as-is? (minor)

Dropped from the first draft: the tabbed/tab-switch/activeGroupTab edits (dead code); the
new-row-renderer + its test (reuse `_manualHistoryHtml`); "option b (panel grows)" (collapses the
empty state — fixed height required).

---
## OWNER DECISION (2026-10-24): Option B (per-guest, truly like check-in) + MATCH check-in wording

Each guest in the A&P one-list gets their OWN 3-section notes box (Customer note / Last 3 visits /
Note for this visit · optional), bound to that guest's entry — not the single first-guest side panel.

### Build plan (Option B)
1. **Per-guest box inside each guest section** (`_renderAssignOneList` guestSections, queue.js ~1830,
   appended AFTER the service `rows`, before the section's closing div). Built by a new
   `_assignGuestNotesHtml(e)` with A&P-specific ids keyed by ENTRY id:
   - `Customer note` — `<textarea id="ga-custnote-${e.id}">` value = `customerNote(e.phone)` (the saved,
     synced, phone-keyed note), `data-loaded="1"` when a phone key exists (so an empty flush is safe —
     mirrors fillManualCustNote). oninput → `assignGuestCustNoteInput('${e.id}')`. Disabled + hint when
     no phone (like _setAssignCustNote).
   - `Last 3 visits` — `<div id="ga-history-${e.id}" style="height:120px;overflow-y:auto">` populated by
     `_manualHistoryHtml(e.phone, e.name)` (DIRECT reuse — escaping + empty states + formatting for free).
   - `Note for this visit · optional` — `<textarea id="ga-visitnote-${e.id}">` value = `e.txnNote||''`,
     oninput → `assignGuestVisitNoteInput('${e.id}')` → sets that entry's `.txnNote` locally (matches the
     existing saveAssignTxnNote pattern — persisted on the next queue.upsert at pay/save; NOT a new sync op).
   - Section micro-labels use the check-in `lab` style (uppercase, tracking-widest) and EXACT check-in
     wording (owner: match it).
2. **Per-entry persist handlers** (queue.js, mirroring square-customers `_persistManualCustNote` +
   `_manualNoteShouldSkip`): `assignGuestCustNoteInput(entryId)` marks `touched` + debounced (600ms)
   persist to `config.customer_notes` (guarded by `_manualNoteShouldSkip(val, loaded, touched)` so a
   never-loaded empty box can't delete a saved note); `assignGuestVisitNoteInput(entryId)` sets
   `entry.txnNote`. Flush pending cust-note saves on modal close (reuse/extend the existing flush on
   closeGroupAssignModal). Window-glue both (inline oninput).
3. **Retire the side panel** in the live path: in `_renderAssignOneList`, hide `#assign-notes-panel`
   (`display:none`) and DROP the two party[0] note-load lines (queue.js 1920-1921). Leave the panel
   markup + its handlers (saveAssignCustNote/saveAssignTxnNote/_setAssignCustNote) in place for the
   intentionally-kept dead tabbed layout (ASSIGN_ONELIST=false) — don't delete, just stop using it live.
   The shell already widens to 58rem (1801); with the side panel hidden the modal is just the content.
4. **Match-wording** applies to the new per-guest box labels; the old side-panel labels are now hidden
   live, so no index.html label edit is needed for the live UI (the box carries the check-in wording).

### Data-safety
Customer note = synced phone-keyed config.customer_notes via the SAME guarded persist as check-in
(`_manualNoteShouldSkip`) — the one real risk (deleting a saved note) is mitigated exactly as check-in
does it. Visit note = local entry.txnNote (existing pattern). No financial path. Rollback = revert.

### Tests
`_manualNoteShouldSkip` is already pure + tested. Add a focused test only if I introduce new pure logic
(none expected — the A&P persist reuses the same guard). Live-verify: single guest shows their box;
a party of 2-3 shows one box per guest with each guest's own saved note + own last-3-visits + own visit
note; typing a note on guest 2 saves to guest 2's phone (not guest 1); an empty never-touched box does
NOT wipe a saved note; the old side panel is gone in the live layout.

### Re-review
Design changed materially from the first draft → re-run a focused 2-lens plan review on THIS Option-B
plan (note-wipe guard correctness, the side-panel retire not breaking pay/close, per-entry wiring,
party layout) before coding.

---
## FINAL design after Option-B plan-review (caught 3 HIGH data-loss bugs — all folded in)
The one-list rebuilds `#group-assign-content.innerHTML` on EVERY interaction, so notes CANNOT live on a
debounce+close-flush alone. Persistence rides `_saveAssignOneList` (runs before every re-render via
`saveCurrentGroupTabInputs`, + on close + at checkout) plus a debounce for the nav-force-hide case.

RENDER (`_renderAssignOneList`):
- `const recs = buildCombinedRecords()` ONCE; pass as 3rd arg to every `_manualHistoryHtml(e.phone,e.name,recs)` (perf).
- Per-guest notes box appended after the service rows in each `[data-assign-entry]` section: 3 sections,
  check-in `lab` micro-label style + EXACT check-in wording (Customer note / Last 3 visits / Note for this visit · optional).
  - Customer note: track seen `notePhoneKey`s across the party — FIRST occurrence = editable
    `<textarea class="ga-custnote" data-eid data-loaded oninput="assignGuestCustNoteInput('<id>')">escHtml(customerNote(e.phone))</textarea>`;
    a LATER duplicate phone = READ-ONLY shared view (`_custNoteSharedHtml`-style, no `.ga-custnote`) so two boxes never collide (same-contact case).
  - Last 3 visits: `<div id="ga-hist-<id>" style="height:120px;overflow-y:auto">_manualHistoryHtml(...)</div>`.
  - Note for this visit: `<textarea class="ga-visitnote" oninput="assignGuestVisitNoteInput('<id>')">escHtml(e.txnNote||'')</textarea>`.
- Hide `#assign-notes-panel` (display:none) in the one-list path; DROP the party[0] LOAD lines 1920-1921.

PERSIST (queue.js, exported for inline handlers):
- `assignGuestVisitNoteInput(id)`: `entry.txnNote = textarea.value` immediately.
- `assignGuestCustNoteInput(id)`: mark that box `data-touched="1"`; reset a single 600ms timer → `_flushAssignGuestCustNotes()`.
- `_flushAssignGuestCustNotes()`: clear timer; build `notes={...cfg().customer_notes}`; for EACH `.ga-custnote[data-touched="1"]`
  read key = `notePhoneKey(live .ga-phone in its section)||dataset.phoneKey`, skip no-key; set/delete notes[key]=val.trim();
  dispatch ONCE only if `notes` actually changed (no write-amplification). GATE = `touched` ONLY (NOT loaded) — an untouched box
  must never write, so it can't clobber an Edit-Customer change (person_edit, 1839) or a cross-device sync echo (HIGH #3).
- `_saveAssignOneList`: DELETE line 1997 (`party[0].txnNote = #assign-txn-note.value` — wipes guest-1 now that the panel is empty);
  in the per-guest loop capture `entry.txnNote = sec.querySelector('.ga-visitnote')?.value ?? entry.txnNote` for ALL guests;
  call `_flushAssignGuestCustNotes()` (synchronous) so cust notes persist BEFORE the caller rebuilds the DOM.
- ids: `getElementById('ga-...-'+e.id)`; interpolate `'${e.id}'` raw (entry.id is hyphen-safe, matches openCustomerFromAssign 1839).

KEPT dead (ASSIGN_ONELIST=false) tabbed layout untouched: #assign-notes-panel markup + saveAssignTxnNote/_setAssignCustNote
stay; only the LIVE one-list path stops using them.

KNOWN-minor to surface to owner: the A&P box refreshes the note/history on a full re-render (catalog tap / save), not live
as you RE-type a guest's phone inline (check-in does live) — because in A&P the guest is already checked in with a phone;
persistence still reads the LIVE .ga-phone at save so a changed phone is keyed correctly. Visit note = local entry.txnNote
(persisted on the next queue.upsert at pay/save, matching today's behavior).

Tests: reuse `_manualNoteShouldSkip` is superseded by touched-only gate here; add a focused pure test for the
"dispatch only if changed" + "skip untouched" decision if I extract it; otherwise live-verify the party scenarios.
