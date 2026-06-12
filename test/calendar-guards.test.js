import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _gcalNoteDeleted, _gcalNoteWritten, _gcalApplyGuards } from '../js/app/features/calendar.js';

// Google events.list is eventually consistent: just-deleted events can still be returned
// (ghosts) and just-inserted/updated ones can be missing. The guards reconcile a fetched
// list against tombstones (deletes) and pins (the resource Google returned from a write).

const ev = (id, updated, summary) => ({ id, updated, summary });

test('a just-deleted event is filtered out of a fetched list (ghost)', () => {
  _gcalNoteDeleted('calA', 'ghost1');
  const out = _gcalApplyGuards('calA', [ev('ghost1', '2026-06-11T20:00:00Z'), ev('keep1', '2026-06-11T20:00:00Z')]);
  assert.deepEqual(out.map(e => e.id), ['keep1']);
});

test('a just-written event missing from the fetch is appended (pin)', () => {
  _gcalNoteWritten('calB', ev('new1', '2026-06-11T21:00:00Z', 'fresh'));
  const out = _gcalApplyGuards('calB', [ev('other', '2026-06-11T20:00:00Z')]);
  assert.deepEqual(out.map(e => e.id).sort(), ['new1', 'other']);
});

test('a stale fetched copy is replaced by the newer pinned copy; a newer fetch wins', () => {
  _gcalNoteWritten('calC', ev('e1', '2026-06-11T21:00:00Z', 'post-edit'));
  const stale = _gcalApplyGuards('calC', [ev('e1', '2026-06-11T20:00:00Z', 'pre-edit')]);
  assert.equal(stale[0].summary, 'post-edit');
  const newer = _gcalApplyGuards('calC', [ev('e1', '2026-06-11T22:00:00Z', 'even-newer')]);
  assert.equal(newer[0].summary, 'even-newer');
});

test('guards are per-calendar: calX tombstone does not affect calY', () => {
  _gcalNoteDeleted('calX', 'shared-id');
  const out = _gcalApplyGuards('calY', [ev('shared-id', '2026-06-11T20:00:00Z')]);
  assert.equal(out.length, 1);
});

test('a write to the same id clears its tombstone (delete then re-insert)', () => {
  _gcalNoteDeleted('calZ', 'e2');
  _gcalNoteWritten('calZ', ev('e2', '2026-06-11T21:00:00Z'));
  const out = _gcalApplyGuards('calZ', [ev('e2', '2026-06-11T20:00:00Z')]);
  assert.equal(out.length, 1);
});
