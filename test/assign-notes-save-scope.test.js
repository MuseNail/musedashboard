// Regression guard for the A&P notes side-strip SAVE PATH (the bug Muse shipped in its v6.24: the note
// boxes were moved to the sibling #ga-notes-row strip but the save selectors still scoped to
// #group-assign-content, so A&P customer + visit notes silently never persisted). No jsdom here, so this
// is a source-invariant tripwire (like no-raw-customer-sinks / the _drillRow def-invariant): it fails the
// build if the boxes lose their data-assign-entry anchor, or if any save reader points at the wrong
// container again. Run: node --test-force-exit --test test/assign-notes-save-scope.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js/app/features/queue.js'), 'utf8');

// Isolate a function body (signature → the next COLUMN-0 declaration) so a match elsewhere in the
// 3000-line file can't give a false pass, and so the whole body is covered regardless of length.
function body(sig) {
  const i = src.indexOf(sig);
  assert.ok(i >= 0, `function not found (did it move/rename?): ${sig}`);
  const rest = src.slice(i + sig.length);
  const m = rest.match(/\n(?:export function |function |const |let )\w/);   // next top-level decl (indented ones have leading spaces, so ignored)
  return src.slice(i, i + sig.length + (m ? m.index : 2500));
}

test('the A&P note box is anchored with data-assign-entry (phone-key + per-entry save need it)', () => {
  const b = body('function _assignGuestNotesHtml(');
  assert.match(b, /class="ga-note-box[^"]*"[^>]*data-assign-entry="\$\{e\.id\}"/, 'ga-note-box must carry data-assign-entry="${e.id}"');
});

test('the input handlers read the note boxes from the #ga-notes-row strip (not #group-assign-content)', () => {
  const vis = body('export function assignGuestVisitNoteInput(');
  assert.match(vis, /#ga-notes-row \[data-assign-entry="\$\{entryId\}"\]/, 'visit-note input must query the strip');
  assert.doesNotMatch(vis, /#group-assign-content \[data-assign-entry/, 'visit-note input must NOT scope to #group-assign-content (the box is not there)');
  const cust = body('export function assignGuestCustNoteInput(');
  assert.match(cust, /#ga-notes-row \[data-assign-entry="\$\{entryId\}"\]/, 'cust-note input must query the strip');
  assert.doesNotMatch(cust, /#group-assign-content \[data-assign-entry/, 'cust-note input must NOT scope to #group-assign-content');
});

test('the customer-note flush reads the strip boxes and keys off the LIVE inline phone', () => {
  const b = body('function _flushAssignGuestCustNotes(');
  assert.match(b, /querySelectorAll\(\s*['"`]#ga-notes-row \.ga-custnote/, 'flush must read #ga-notes-row .ga-custnote');
  assert.doesNotMatch(b, /#group-assign-content \.ga-custnote/, 'flush must NOT read the old #group-assign-content .ga-custnote (always empty now → notes silently dropped)');
  // The strip box has no phone input, so the key comes from the live inline .ga-phone in the assign row.
  assert.match(b, /#group-assign-content \[data-assign-entry="\$\{id\}"\] \.ga-phone/, 'flush must resolve the phone key from the live inline phone field by entry id');
});

test('_saveAssignOneList captures the visit note from the strip box', () => {
  const b = body('function _saveAssignOneList(');
  assert.match(b, /#ga-notes-row \[data-assign-entry="\$\{entry\.id\}"\] \.ga-visitnote/, 'save must read .ga-visitnote from the strip, not #group-assign-content');
});
