# Plan — Tech notes / preferences in the tech-status popup (Wave 2 #4 / roadmap #10) — v2 (post-review)

Date: 2026-10-22 · Repo: musedashboard (ports to TurnDesk) · Area: turns / tech-status menu · desktop-first

> **v2 note.** A 3-lens adversarial review found the close-logic refactor and DOM timing SOUND, but flagged
> two majors + several minors, all folded in:
> - **[MAJOR — needs an OWNER decision] whole-array `config.staff` write can clobber a concurrent payroll edit.**
>   `config.staff` is one stale-guarded key with NO field-level merge; two fresh concurrent writes = last wins.
>   A note saved from the busy Turns/Floor popup, concurrent with a manager editing that tech's `commission`/
>   `checkValue` in Settings, could silently revert the payroll edit. Same *mechanism* as today's profile editor,
>   but this adds a second, more casual, more frequent writer on the two busiest surfaces → the collision surface
>   genuinely widens, and the victim is financial data (CLAUDE.md). **Decision A vs B below.**
> - **[MAJOR — cheap fix, applied] iPad keyboard occlusion / no overflow cap.** Muse's `#tech-status-menu` has no
>   `max-height`/`overflow` (TurnDesk's already does); a taller popup + the iOS keyboard can hide the textarea on
>   a landscape iPad. Fix: add `max-height:calc(100vh - 24px);overflow-y:auto` to the popup (adopt TD's), and make
>   the eyeball an explicit landscape-iPad-with-keyboard test.
> - Minors folded: the `contains()` guard means an in-popup *dead-space* click no longer dismisses (eyeball it);
>   Floor-Plan open passes a **no-op** `stopPropagation` (floorplan.js:615) so its open-robustness rests on the
>   10 ms defer, not a real click-stop (pre-existing; include a Floor-Plan open in the boot check); harden
>   `saveTechNotes` to read the tech id from the textarea's `dataset` (set at populate) so a save never depends on
>   `_techStatusMenuId` still being set; any FUTURE display of notes must use `textContent`/`esc()` (never the
>   unescaped `innerHTML` pattern at giftcards.js:290); `_withTechNotes` must be `export`ed and the test imports
>   `./setup-globals.js` first.

## Goal
Add an editable **Notes / Preferences** field to the shared tech-status popup (`#tech-status-menu`), which
opens from BOTH the Turns grid and the Floor Plan (tech avatar tap). Front desk / managers jot a tech's
standing preferences or a note ("prefers pedis", "leaves at 5", "no fumes"). Saved on the staff record so it
persists and shows everywhere the popup opens. One implementation covers both surfaces.

## Grounded facts
- **Shared popup** `#tech-status-menu` (index.html:2230-2247): header (photo/name/close), Available/Break/Off
  row, and a "Services Today" section. Rendered/positioned by **`turns.js showTechStatusMenu(event, staffId)`**
  (L716): sets name/photo/services, measures `menu.offsetHeight` (L740) to decide flip-above, then arms the
  auto-close.
- **Auto-close (the gotcha):** L743 `setTimeout(() => document.addEventListener('click', closeTechStatusMenu,
  { once:true }), 10)`. ANY click that bubbles to `document` closes the popup. A textarea click/focus would
  bubble → close. (Opening the menu itself calls `event.stopPropagation()` at L717, so avatar clicks don't leak.)
- **Both surfaces call the same fn:** floorplan.js onUp → `window.showTechStatusMenu?.(...)`. So editing one
  function updates both. No floorplan change.
- **Persistence:** `config.staff` is the synced source. `staff.js saveStaff` edit path spreads `...staff[i]`
  (L234), so a `notes` field written elsewhere SURVIVES a later profile edit. config.staff writes are per-key
  stale-guarded; a whole-array write is last-writer-wins on the array — identical to today's `saveStaff`/profile
  edits (no NEW risk; note edits are infrequent).
- turns.js already imports `dispatch`, has `cfg()`/`staffById`/`canDo`, and writes config via helpers
  (`setBreak`/`setOff`). `_techStatusMenuId` holds the open tech's id.

## The write-path decision (A vs B) — OWNER CALL
- **A — Pages-only, whole-array write (accept the risk).** `saveTechNotes` dispatches the full `config.staff`
  array (built from the freshest `cfg().staff` via `_withTechNotes`). Simplest, no Worker/deploy. Risk: a rare
  truly-concurrent note-save vs profile/payroll edit reverts one of them (sub-second window; sequential edits are
  safe because sync propagates between them). This is the SAME clobber class the profile editor already has.
- **B — field-merge op (the robust fix, needs a Worker deploy).** Mirror `queue.entryPatch`/`assignmentPatch`:
  a new `staff.patch {id, fields:{notes}}` op that the DO merges onto the stored staff entry by id (store.js
  `applyChange` + DO `applyMutation` + a per-entry stale stamp). Ships only `{id, notes}`, so it can NEVER
  clobber a concurrent payroll edit to the same tech. Costs a `cloudflare/worker.js` change + `wrangler deploy`
  (so no longer "Pages-only") and a bit more code.
- **Recommendation:** if a note-save reverting a commission is unacceptable (it touches payroll), do **B**.
  If you'd rather keep it Pages-only and accept the narrow window for a low-stakes convenience field, **A** is
  fine and matches the status quo. Everything else in this plan is identical either way except the one write line.

## Design (shared by A and B except the single write line)

### index.html (`#tech-status-menu`) — add a Notes section below Services + an overflow cap
- Add to the `#tech-status-menu` wrapper style (index.html:2230): `max-height:calc(100vh - 24px);overflow-y:auto`
  (matches TurnDesk's popup; keeps the taller popup + iOS keyboard usable on a landscape iPad).
- Notes section below Services:
```html
<div class="border-t border-surface-container-high pt-2 mt-2">
  <div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-1">Notes / Preferences</div>
  <textarea id="tsm-notes" rows="2" maxlength="300" onchange="saveTechNotes()" onclick="event.stopPropagation()"
    placeholder="e.g. prefers pedicures · leaves at 5"
    class="w-full bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-xs font-body text-on-surface outline-none focus:border-primary resize-none"></textarea>
</div>
```
`onchange` saves on blur-with-change (right granularity — not per-keystroke; Enter = newline, no accidental
submit). `onclick` stop-prop is a belt to the close-logic fix. (maxlength + the caller's `.slice(300)` are
belt-and-suspenders; a pre-existing >300-char note displays in full until the next manual edit — acceptable.)

### turns.js
1. **Fix the auto-close so in-popup clicks don't close it** — replace the anonymous `{once:true}` with a NAMED
   handler that ignores clicks inside the menu:
   ```js
   function _tsmOutsideClick(e){ const m = document.getElementById('tech-status-menu'); if (m && m.contains(e.target)) return; closeTechStatusMenu(); }
   ```
   - `showTechStatusMenu`: `setTimeout(() => document.addEventListener('click', _tsmOutsideClick), 10);`
     (addEventListener dedupes an identical named reference, so re-opening never stacks listeners.)
   - `closeTechStatusMenu`: `document.removeEventListener('click', _tsmOutsideClick);` (single close path →
     no leak). The Available/Break/Off buttons already call `closeTechStatusMenu()`, so they still close.
2. **Populate the field + stash the id** in `showTechStatusMenu` (the Notes section is static HTML so it's
   already in the height measure — ordering is immaterial, do it near the services set): `const nt =
   document.getElementById('tsm-notes'); if (nt) { nt.value = st.notes || ''; nt.dataset.sid = staffId; }`
   Stashing the id in `dataset` means a save never depends on `_techStatusMenuId` still being set.
3. **`saveTechNotes()`** (exported → window):
   ```js
   export function saveTechNotes(){
     const nt = document.getElementById('tsm-notes'); if (!nt) return;
     const id = nt.dataset.sid || _techStatusMenuId; if (!id) return;   // dataset is the robust source
     const text = (nt.value || '').trim().slice(0, 300);
     const next = _withTechNotes(cfg().staff, id, text);
     if (!next) return;                                   // null = unchanged/missing → skip the synced write
     // Write line — A: dispatch('config.set', { key: 'staff', value: next });
     //              B: dispatch('staff.patch', { id, fields: { notes: text } });   // DO field-merge, deploy
   }
   ```
4. **Pure helper (EXPORTED, unit-tested)** `_withTechNotes(staff, id, text)`: returns a NEW staff array with
   `{...s, notes:text}` for the matching id, or **`null`** when the tech isn't found OR the note is unchanged
   (so we never fire a redundant sync write). Helper compares `text` against `(s.notes||'')`. Used by both A
   (for the write value) and B (for the no-op/unchanged check; B then ships only `{id, notes}`).
5. **(Only if B)** `store.js applyChange` + `cloudflare/worker.js` DO `applyMutation`: handle `staff.patch` by
   merging `fields` onto the stored staff entry by id, with a per-entry stale stamp mirroring `assignmentPatch`.

## Why no permission gate
The popup already lets any dashboard user set Available/Break/Off; notes are the same class of operational
data on the same surface. Techs don't see this popup (their phone shows the staff app). Consistent = no gate.
(Open question below if the owner wants one.)

## Test plan (TDD)
- Unit (`test/tech-notes.test.js`, `import './setup-globals.js'` first) on EXPORTED `_withTechNotes`: sets notes
  on the right tech; leaves others untouched (new array, original not mutated); returns null when unchanged;
  returns null when id missing; overwrites an existing note; trims-equal is a no-op.
- DOM/close-logic → diff review + preview boot check: `saveTechNotes` on window, textarea present, popup opens
  from Turns AND Floor Plan, popup still closes on a true outside click.
- Full suite green, per-file on Windows (`node --test-force-exit --test test/<f>.test.js`).
- Owner eyeball: open from Turns AND Floor Plan → type a note → click elsewhere INSIDE → stays open, saved;
  click truly OUTSIDE → closes; reopen → note persists; edit the tech's profile in Settings → note survives;
  **landscape iPad with the on-screen keyboard up near the bottom of the screen → textarea stays reachable**
  (the overflow cap); note that an in-popup dead-space click no longer dismisses (X + outside still do).

## Rollback
Additive: one `notes` field on staff objects (ignored by all old read paths), one textarea, one save fn + pure
helper, and a close-logic refactor that preserves existing behavior. No schema/storage/Worker change →
Pages-only. Revert = one commit. (A `notes` value written then rolled back simply sits unused on the record.)

## Open questions for the owner
1. **Any gate?** Default: no gate (matches the Break/Off controls on the same popup). Or restrict editing to
   managers (`canDo`)? 
2. **Field size / label** — "Notes / Preferences", 2-row, 300-char cap. OK, or just "Notes"?
3. Should the note also surface on the **tech's own staff app** (read-only)? Out of scope for this item;
   easy follow-on if wanted.
