// Tech notes/preferences in the shared tech-status popup (Wave 2 #4). The write is an Option-B
// field-merge op (staff.patch) so a note can never clobber a concurrent payroll edit; the pure
// _withTechNotes builds the next staff array (or null when there's nothing worth a synced write).
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _withTechNotes } from '../js/app/features/turns.js';

const base = () => [
  { id: 's1', name: 'Maria', commission: 55, notes: 'prefers pedis' },
  { id: 's2', name: 'Lin', commission: 50 },
];

test('_withTechNotes sets the note on the matching tech only', () => {
  const staff = base();
  const next = _withTechNotes(staff, 's2', 'leaves at 5');
  assert.equal(next[1].notes, 'leaves at 5');
  assert.equal(next[0].notes, 'prefers pedis');   // other techs untouched
});
test('_withTechNotes preserves the tech’s other fields (e.g. payroll)', () => {
  const next = _withTechNotes(base(), 's1', 'new note');
  assert.equal(next[0].commission, 55);
  assert.equal(next[0].name, 'Maria');
  assert.equal(next[0].notes, 'new note');
});
test('_withTechNotes does not mutate the original array or objects', () => {
  const staff = base();
  const next = _withTechNotes(staff, 's1', 'changed');
  assert.notEqual(next, staff);
  assert.notEqual(next[0], staff[0]);
  assert.equal(staff[0].notes, 'prefers pedis');   // original intact
});
test('_withTechNotes returns null when the note is unchanged (no redundant sync write)', () => {
  assert.equal(_withTechNotes(base(), 's1', 'prefers pedis'), null);
});
test('_withTechNotes treats missing notes as empty (empty->empty is a no-op)', () => {
  assert.equal(_withTechNotes(base(), 's2', ''), null);
});
test('_withTechNotes returns null when the tech id is not found', () => {
  assert.equal(_withTechNotes(base(), 'nope', 'x'), null);
});
test('_withTechNotes can clear an existing note (non-empty -> empty is a change)', () => {
  const next = _withTechNotes(base(), 's1', '');
  assert.equal(next[0].notes, '');
});
