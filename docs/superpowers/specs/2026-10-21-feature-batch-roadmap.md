# Feature batch roadmap (2026-10-21) — 17 items, desktop-first, all port to TurnDesk

Owner gave a 17-item list. Process: understand (done, grounded in 3 code explorations) → this
roadmap → rigorous-build per item/wave → ship to Muse → port to TurnDesk (same flow as the
v5.60/62/63 ports). **Desktop-first** ergonomics throughout. Sequencing: **quick wins first**.

Owner decisions (2026-10-21): comped fix = `ticketTotal` treats `comped` as $0 (root fix);
waiver = show the signer block (NOT a drawn signature pad); support tickets = adapt TurnDesk's
help-desk (td-v0.49, built/undeployed) into Muse.

---

## Wave 1 — quick wins (low risk, batch release)

1. **Tab order → Turns · Floor Plan · Queue.** Reorder the `floor` group's `panels` array in
   `js/app/main.js` (`NAV_GROUPS`, ~L414) to `[turns, floorplan, queue]`; move the static
   `active` class off `#panel-queue` to `#panel-turns` in index.html (~L323). Trivial.
2. **Floor-plan drag "transparent column" bug.** `floorplan.js` `initFloorDrag().startDrag`
   (~L512-526) clones a `.floor-bubble` that has Tailwind `h-full`; the clone is `position:fixed`
   with width pinned but **no height**, so it resolves `height:100%` against the viewport → a
   full-height transparent strip. Fix: set `height: rect.height+'px'` on the clone (+ solid bg).
   Verify dragging a SEATED customer. (Tray/tech bubbles are intrinsically sized → unaffected.)
3. **Turns: make the turn number more visible.** The per-slot number is an 11px span at
   `opacity:0.75` (turns.js ~L485; duplicated in history `rowFor` ~L946). Give the full-turn
   number a chip like the half/bonus pills (or bump size + drop opacity). Edit BOTH paths.
   Cosmetic — propose a treatment; offer a quick mockup if owner wants.
4. **Visit history: which tech did which service.** Data already stored: each record's
   `assignments[]` carry `{serviceId, techId, station, cost}`. `reports.js`
   `renderCustomerHistory` (~L150-166) renders two FLAT lists; change to per-assignment rows
   (`service · tech`), fallback to the flat `r.services` list for assignment-less/legacy records.
   Presentational only; no store change.
5. **Calendar: who created an appointment + when.** `calendar.js` `saveAppt` (~L1559-1566)
   already sets `createdAt`; add `createdBy: getActiveUser()?.name || null` on the NEW branch
   (preserve on edit, mirror the `createdAt` ternary; confirm `getActiveUser` import). Display a
   "Booked by X · date" line in the detail popup `calEventClick` (~L1068/1094). Old appts → "—".
6. **Turns: resizable tech column (min/max).** The tech col is a hard-coded `w-[155px]` flex
   child (turns.js ~L432; also history ~L922). Drive width from a CSS var on `#panel-turns`
   (`--turns-techcol-w`), add a drag handle on the tech/lane boundary, clamp (e.g. 120–260px),
   persist device-local (`localStorage muse_turns_techcol_w`, mirror `muse_turns_large`/
   `muse_turns_sep` pattern). Apply via `setProperty` (no full re-render — preserves lane scroll).

## Wave 2 — moderate features

7. **Comped-line re-pricing fix (ROOT).** `ticketTotal` (utils.js) must treat a line with
   `comped` (truthy) as $0 regardless of its `cost`. Audit every `ticketTotal` consumer
   (reports/pay-time/payroll) so the $0 flows through consistently; add a tech-app comp indicator
   so a tech can see a line is comped. TDD the `ticketTotal` change. Logged in PRIORITIES §0.
8. **Check-in from a customer lookup.** Add `checkInCustomer(doId)` → `showManualAdd()` pre-filled
   (reuse `fillFromCustomer` logic) from Customers tab rows, edit-customer modal, and global
   search. Going THROUGH the builder keeps the waiver/dup/appointment guards. square-customers.js
   + search.js + queue.js.
9. **Floor-plan: check in new customers.** v1 = a toolbar button → `goTo('screen-checkin','walkin')`
   (entry lands in the "Not seated" tray). Optional richer in-place seat-directly modal later.
   Decide at kickoff.
10. **Tech notes/preferences in the bubble popup.** Shared `#tech-status-menu` (turns.js
    `showTechStatusMenu` ~L668; floorplan.js onUp ~L566) → add a `notes` textarea + `saveTechNotes`
    writing `config.staff` (add a `notes` field; `saveStaff` spreads `...staff[i]` so it survives
    edits). One impl = both surfaces. Watch the `{once:true}` auto-close (stopPropagation) + re-measure popup height.
11. **Tasks: front-desk-specific + manager-assign.** Tasks are a global synced `tasks[]` (no owner).
    Add `assignee` (pid, `fd:<id>`/`tech:<id>`, from chat's scheme); filter the list to the
    signed-in FD user for non-managers; managers get an assignee picker (from `chatPeople()`), gated
    `['admin','manager']` or a new `canDo('assignTasks')`. Replace the `prompt()` add with a real
    modal. Decide at kickoff: scope by individual vs role; where techs see assigned tasks.
12. **Waiver: show the signer block.** `waiver.js` `openSignedWaiver` (~L113) shows the agreement
    text/PDF; PDF mode shows NO signer identity. Add a signer/attestation block (signerDisplay,
    the ack sentence, acceptedAt, method, device/IP) for BOTH text and PDF modes. Data already on
    the waiver record. "Set up iPad" = Settings → "Make this device the kiosk" (`setThisKioskDevice`)
    — confirm whether owner needs help doing it vs. a new mode (it's existing).

## Wave 3 — substantial / new subsystems

13. **Multiple pre-saved named floor plans.** Today a single `config.station_layout`. Add
    `config.floor_layouts {active, list:[{id,name,layout}]}` + picker/save/rename/duplicate in the
    floor toolbar; "switch" copies the chosen layout into `station_layout` (keeps the existing
    read path `layout()`/`layoutFor()` untouched); migrate the current layout as the default entry.
    Seating is queue-derived (keys off station id) so it's layout-independent.
14. **Price menu editable in-app.** `guide.js` `priceMenuDoc()` is a hand-typed HTML doc (NOT
    catalog-driven, deliberately). Move content to synced `config.price_menu` + a Settings editor;
    `priceMenuDoc` renders from data. Preserve the typeset two-column layout. Owner-editable.
15. **Searchable help docs.** `guide.js` `FULL`/`QUICK` are print-only popups. Convert `FULL` into
    a structured topic array `[{id,title,keywords,body}]`, add an in-app searchable panel (new Help
    tab or Settings card), seed from `FULL` + the `WHATS_NEW` corpus. Likely some re-authoring into
    task-oriented "how do I…" recipes. Keep in code (owner's stated preference) unless owner wants editable.
16. **Support ticket system (adapt TurnDesk's help-desk).** Muse today = auto error telemetry only
    (`reporter.js` → `/report` → Settings→Diagnostics; no staff-initiated tickets, no replies).
    Plan: inspect TurnDesk's td-v0.49 help-desk (`__registry__` DO tickets + dev push, per memory),
    confirm fit, adapt into Muse — staff submit tickets (auto-attach context/breadcrumbs/version),
    dev replies, status. New per-record store (`ticket:<id>` like tasks) + two-way thread (reuse
    `chat.append` / `/push/notify`). Biggest build; its own full rigorous-build.
17. **Chat bug cleanup.** No literal TODOs; candidate spots: first-name-only `@mentions` (can fire
    wrong/both people), scroll-to-bottom timing, notification gating, empty-state string drift. The
    v5.57 empty-channel-freeze path (seen/markSeen) is DELICATE — don't regress it. **Needs the
    owner's actual symptoms to scope** — ask at kickoff.

---

## Notes
- Sync pattern for new persisted data (tasks already follow it; tickets/floor-layouts will):
  reducer case in `store.js` + stamp in `sync.js` + DO handler/snapshot in `worker.js` (per-record
  key prefix + tombstones, like `task:`/`taskdeletion:`). Config-blob features use `config.set`.
- Device-local UI prefs (resizable column) use `localStorage muse_*` (mirror `muse_cal_hours`/
  `muse_turns_*`).
- Every item: ship Muse → port to TurnDesk (structurally parallel repo).
