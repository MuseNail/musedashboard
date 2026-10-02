# Implementation plan v2 — decouple tech price entry from completion

Grounded in the code; revised after a 4-lens adversarial review. Companion to
`2026-09-26-tech-price-decouple-design.md`. **Scope now includes a Worker/DO sync
hardening** (owner chose to fix the stale-patch gap in this change), so it is NOT
client-only — a `wrangler deploy` is required.

## Behavior (final)

- Saving a price never changes status (root fix).
- Tech app: ONE morphing action button, **draft-aware** (per the approved design §2):
  - `waiting` → **Start**
  - `inservice`, field shows a price that does NOT equal the saved cost (or nothing saved yet)
    → **Save price** (greyed until a valid price is in the field); saving keeps status in-service,
    stamps `techPriced=true`
  - `inservice`, field equals the saved cost (or service is comped) → **Complete**
  - `complete` (not awaiting) → **Reopen**
  - `complete` + `awaitingPrice` → **Save price** (violet; existing flow)
  - `paid`/`done` (can occur on one service of a multi-service party) → **no button** (`none`)
- `techPriced` = a tech set the current price; cleared when the front desk sets/edits/comps it.
- Front-desk cue "Price in ✓" (an annotation, not a 5th status pill): **queue card + staff card**
  full marker; **turns card** a compact ✓ glyph; **floor plan: none** (tech still reads busy via
  the green station tint). Shown only when `isTechPriced(a)`.
- Accepted behavior changes: (1) finishing from Waiting now takes Start then Complete (two taps);
  (2) a tech's "Today $"/History updates at Complete, not at price entry.

## Exact edits

### A. `js/app/features/status.js`
1. Add predicate:
   ```js
   export function isTechPriced(a) { return !!(a && a.techPriced && a.status === 'inservice'); }
   ```
   No change to `serviceLineStyle` (marker is additive, not a new state). `applyAssignmentStatus`
   keeps stamping `a.updatedAt` unconditionally — **load-bearing**: it lets a tech's Save-price win
   the merge against an older in-flight FD whole-entry save. Do not "optimize" it to stamp-on-change.

### B. `js/app/staff.js`
2. `updateAssignment` (line 548): after the `awaitingPrice` clear, stamp provenance:
   `if (priced != null && priced > 0) a.techPriced = true;`
3. New **pure, exported, draft-aware** helper + use it in `lineHtml` to render exactly ONE button:
   ```js
   // draftPrice = parsePrice(current field value) or null. Pure → unit-testable; the field value
   // is passed in, so no reliance on a live keystroke inside the helper.
   export function staffServiceAction(a, draftPrice) {
     const status = (a && a.status) || 'waiting';
     if (status === 'complete' && a && a.awaitingPrice) return { mode: 'saveprice', label: 'Save price', fn: 'staffSavePrice', style: 'violet' };
     if (status === 'paid' || status === 'done')        return { mode: 'none' };
     if (status === 'waiting')                          return { mode: 'start',  label: 'Start',  fn: 'staffStart',  style: 'primary' };
     if (status === 'inservice') {
       if (a && a.comped)                               return { mode: 'complete', label: 'Complete', fn: 'staffComplete', style: 'primary' };
       const saved = (a && a.cost) || 0;
       if (saved > 0 && draftPrice === saved)           return { mode: 'complete', label: 'Complete', fn: 'staffComplete', style: 'primary' };
       return { mode: 'saveprice', label: 'Save price', fn: 'staffSavePrice', style: 'primary' };   // disabled unless draftPrice>0 (UI)
     }
     if (status === 'complete')                         return { mode: 'reopen', label: 'Reopen', fn: 'staffReopen', style: 'outline' };
     return { mode: 'none' };
   }
   ```
   In `lineHtml` (388–397, 420): compute `fieldPrice = parsePrice((key in _priceDraft) ? _priceDraft[key] : a.cost)`,
   call the helper, render ONE button with `id="act-<key>"`, `data-mode`, and for `mode:'saveprice'`
   in the **in-service** case `disabled = !(fieldPrice>0)` (greyed via `opacity-40 pointer-events-none`).
   `mode:'none'` → render **no** button (preserves today's zero-button paid line). Remove the old
   `start`/`complete`/`reopen`/`savePrice` locals.
4. `staffPriceInput` (560): store draft, then **morph the in-service button** (label+fn+disabled)
   without re-rendering (no focus loss):
   ```js
   window.staffPriceInput = (entryId, serviceId, val) => {
     const key = entryId + ':' + serviceId; _priceDraft[key] = val;
     const b = document.getElementById('act-' + key); if (!b) return;
     const a = (queue().find(e => String(e.id) === String(entryId))?.assignments || [])
       .find(x => x.serviceId === serviceId && x.techId === myId);
     if (!a || a.status !== 'inservice' || a.comped) return;   // only the in-service, non-comped button morphs
     const act = staffServiceAction(a, parsePrice(val));
     b.textContent = act.label; b.dataset.mode = act.mode;
     b.setAttribute('onclick', `${act.fn}('${entryId}','${esc(serviceId)}')`);
     const dis = act.mode === 'saveprice' && !(parsePrice(val) > 0);
     b.disabled = dis; b.classList.toggle('opacity-40', dis); b.classList.toggle('pointer-events-none', dis);
   };
   ```
5. `staffSavePrice` (587): keep the service's CURRENT status (works for in-service "save early"
   AND awaiting-complete):
   ```js
   const a = (queue().find(e => String(e.id) === String(entryId))?.assignments || [])
     .find(x => x.serviceId === serviceId && x.techId === myId);
   const keep = (a && a.status) || 'inservice';
   updateAssignment(entryId, serviceId, keep, priced); delete _priceDraft[key]; showToast('Price saved ✓');
   ```
6. `staffComplete` (567): honor comped so the Complete button is never a dead tap on a comp —
   `if ((effective == null || effective <= 0) && !existing?.comped) { showToast('Enter a price first'); return; }`
   (logic otherwise unchanged; Complete still refuses an unpriced, non-comped service).
7. `lineHtml` status area (406): when `isTechPriced` (status inservice && techPriced), render the
   "Price in ✓" marker beside the chip (annotation style, hue distinct from the 4 status colors —
   see F7).

### C. `js/app/features/queue.js`
8. `_applyRowToAssignment` (1040): clear provenance on FD price-affecting edits.
   - new-row branch (after 1049): `a.techPriced = false;`
   - changed-cost branch (1059): `{ a.cost = domCost; a.techPriced = false; changed = true; }`
   - comp-on branch (1057): `if (domComped !== snap.comped) { a.comped = domComped; if (domComped) a.techPriced = false; changed = true; }`
   - (A pure station/tech move leaves `techPriced` intact — the price VALUE is still the tech's.
     Document this intent in a comment.)
9. `markAwaitingPrice` (1241): it zeroes `a.cost` — also drop the stale provenance:
   `a.techPriced = false;` (before `setAssignmentStatus`). Prevents a "Price in ✓" on a $0 service
   after a later reopen.
10. `assignSummary` row (317): import `isTechPriced`; render the full "Price in ✓" marker next to
    the pill when `isTechPriced(a)`.

### D. `js/app/features/turns.js`
11. Service slot (568): import `isTechPriced`; when `isTechPriced(a)`, render a **compact ✓ glyph**
    (flex-shrink-0, no wide padding) — NOT the word chip (the 10px row has no room). Entry
    border/tint (keyed on `effectiveEntryStatus`) unchanged → an in-service tech-priced ticket
    stays green.

### E. `js/app/features/floorplan.js`
12. **No change.** `custLines` renders a dot + "· $cost" (no status pill) and is space-starved; the
    tech already reads busy via the green station tint. Documented decision: the floor shows no
    provenance marker.

### F. The marker (F6/F7)
13. One small helper/string, used by staff + queue (full) and turns (glyph). Hue **distinct from the
    four status colors** (In Service green / Done blue / Awaiting violet / Waiting amber) — render as
    an annotation (icon + short label / outline), not a filled status pill, so it never reads as a
    5th status. Exact treatment verified in the live preview during build.

### G. Sync hardening — the stale-patch gap (owner: fix now)
14. **Client** `js/app/store.js`, `queue.assignmentPatch` reducer (196–206): before
    `e.assignments[idx] = payload.assignment`, add the SAME conflict rule as `mergeNewerAssignments`:
    ```js
    const sa = e.assignments[idx], ia = payload.assignment;
    if (sa && typeof sa.updatedAt === 'number' && (typeof ia.updatedAt !== 'number' || ia.updatedAt < sa.updatedAt)) return; // stored is newer → drop stale patch
    ```
15. **DO/Worker** `cloudflare/worker.js`, `queue.assignmentPatch` (1238–1256): REPLACE the
    device-scoped guard (1250–1253) with the same `updatedAt` rule (keep stored when stamped and
    incoming is older or unstamped → `stale = true; break;`). This unifies assignmentPatch with the
    upsert path's `_mergeNewerAssignments` and rejects a stale patch from ANY device, while a
    genuinely newer tech action still always wins. Keep the existing `paid/done` guard and the
    "reassigned away → drop" guard. `entryPatch` is OUT OF SCOPE (visit-note only).
    - Rationale for safety: the upsert path already trusts cross-device `updatedAt`; this makes the
      two paths consistent. A tech action is only ever dropped when a strictly-newer write already
      superseded it (correct), not because it came from another device.
    - Deploy: `wrangler deploy` from `cloudflare/` (account info@musenailandspa.com), with owner OK.
      Deploy the Worker BEFORE the client ships so the server guard is in place first.

### H. Version trio (at dev→main)
`js/app/config.js` APP_VERSION, `version.json`, `sw.js` CACHE_NAME together, via `ship` with OK.

## Tests (TDD — write first). Windows: `node --test-force-exit --test test/<file>` per file.
- `status.test.js`: `isTechPriced` true ⇔ `techPriced && status==='inservice'`; false for
  complete/paid/waiting/flag-absent.
- `staff.test.js`: `staffServiceAction` for EVERY state — waiting→start; inservice no-saved-price→
  saveprice; inservice saved & field≠saved→saveprice; inservice saved & field===saved→complete;
  inservice comped→complete; complete→reopen; complete+awaiting→saveprice(violet); paid/done→none;
  default→none. Plus: a tech price>0 sets `techPriced`; reopen (no price) leaves it unset.
- `staff.test.js`: drive `staffComplete` on a **comped** assignment → completes (not a dead tap);
  on an unpriced non-comped → blocked.
- `store.test.js`: `queue.assignmentPatch` guard — newer patch applies; strictly-older patch
  dropped (keeps stored); equal applies; incoming-unstamped vs stored-stamped dropped;
  stored-unstamped applies; paid entry drops; reassigned-away drops. Plus the FD-clears-techPriced
  path via a queue.upsert carrying the cleared flag with a newer `updatedAt` winning the merge.
- (If feasible) a worker-side test mirroring the DO guard (see `test/worker-patch-guards.test.js`).

## Data / migration / rollback
- `techPriced`: additive optional boolean; absent = today's behavior; no storage-key/DO-schema/
  records change → no migration.
- Sync hardening changes only CONFLICT RESOLUTION (which of two writes wins), not storage shape.
  Rollback = revert the reducer/worker edits; behavior returns to cross-device-always-applies. A
  stray `techPriced` is ignored by old code. Worker rollback = redeploy the previous `worker.js`.
- Order of operations: deploy Worker guard first, then ship the client.

## Risk register (post-review)
- R-sync: the DO guard change alters a deliberately-chosen behavior (cross-device patches always
  applied). Mitigation: it mirrors the already-trusted upsert merge; thorough reducer tests above;
  Worker-first deploy; clear rollback. This is the highest-risk item — verify cross-device by hand
  in the live preview before shipping.
- Confirmed NON-issues (reviewers verified against code): `act-<entryId>:<serviceId>` id is valid
  and unique per rendered row; Start-with-a-typed-price jumping to Complete is intended; the
  always-stamp `updatedAt` is required.
- Surfaced + owner-accepted: two taps from Waiting; Today/History updates at Complete.

## TurnDesk carry-over
TD has equivalent `status.js`/`staff.js`/`store.js`/`worker.js`. Port the same edits (incl. the DO
guard) after Muse ships and verifies; log in `turndesk/docs/MUSE-PORT-LOG.md`.
