import test from 'node:test';
import assert from 'node:assert/strict';
import { _regroupGoogleAppts, _mapGoogleTask } from '../js/app/features/calendar-import.js';

// Muse's Google fan-out: one event per person per calendar the person's lines touch; every copy of
// a person carries the same museName + museLines (that person's FULL set). The importer must
// regroup by museGroupId, dedupe guests by museName, map each line's calId → staffId, and put the
// primary guest at guests[0].

const ev = (o) => ({
  id: o.id, summary: o.summary || (o.name + ' — svc'),
  description: o.description || '',
  start: { dateTime: o.start || '2026-09-10T17:00:00.000Z' },
  end: { dateTime: o.end || '2026-09-10T18:00:00.000Z' },
  extendedProperties: { private: {
    museGroupId: o.gid, museName: o.name, musePhone: o.phone || '',
    museLines: JSON.stringify(o.lines || []),
    ...(o.primary ? { musePrimary: '1', musePrimaryName: o.primaryName || o.name, musePrimaryPhone: o.primaryPhone || o.phone || '' } : { musePrimaryName: o.primaryName || '' }),
    ...(o.confirmed ? { museConfirmed: '1' } : {}),
    ...(o.noShow ? { museNoShow: '1' } : {}),
  } },
});
const calToStaff = { c1: 'st1', c2: 'st2', cInfo: '' };   // cInfo (unassigned/info cal) matches no staff
const genSeq = () => { let n = 0; return () => 'appt_' + (n++); };

test('regroup: 2-guest booking → one appt, primary at guests[0], lines mapped', () => {
  const events = [
    ev({ id: 'e1', gid: 'g1', name: 'Bob', lines: [{ svcId: 's2', calId: 'c2' }] }),                          // guest, on tech2
    ev({ id: 'e2', gid: 'g1', name: 'Alice', primary: true, primaryName: 'Alice', lines: [{ svcId: 's1', calId: 'c1' }] }),   // primary, on tech1
  ];
  const { appts, unmatchedLines } = _regroupGoogleAppts(events, calToStaff, genSeq());
  assert.equal(appts.length, 1);
  assert.equal(unmatchedLines, 0);
  const a = appts[0];
  assert.equal(a.googleGroupId, 'g1');
  assert.equal(a.guests[0].name, 'Alice');                 // primary ordered first
  assert.equal(a.guests[1].name, 'Bob');
  assert.deepEqual(a.guests[0].lines, [{ serviceId: 's1', staffId: 'st1' }]);
  assert.deepEqual(a.guests[1].lines, [{ serviceId: 's2', staffId: 'st2' }]);
  assert.equal(a.start, '2026-09-10T17:00:00.000Z');
});

test('regroup: cross-calendar copies of one guest dedupe by museName, keep full line set', () => {
  // Alice's services touch BOTH techs → Muse writes two copies of Alice (same museLines).
  const aliceLines = [{ svcId: 's1', calId: 'c1' }, { svcId: 's3', calId: 'c2' }];
  const events = [
    ev({ id: 'e1', gid: 'g2', name: 'Alice', primary: true, primaryName: 'Alice', lines: aliceLines }),
    ev({ id: 'e2', gid: 'g2', name: 'Alice', primary: true, primaryName: 'Alice', lines: aliceLines }),
  ];
  const { appts } = _regroupGoogleAppts(events, calToStaff, genSeq());
  assert.equal(appts.length, 1);
  assert.equal(appts[0].guests.length, 1, 'the two copies collapse to one guest');
  assert.deepEqual(appts[0].guests[0].lines, [{ serviceId: 's1', staffId: 'st1' }, { serviceId: 's3', staffId: 'st2' }]);
});

test('regroup: unmatched tech calendar → Unassigned + counted; non-muse + all-day events skipped', () => {
  const events = [
    ev({ id: 'e1', gid: 'g3', name: 'Cara', primary: true, primaryName: 'Cara', lines: [{ svcId: 's1', calId: 'cGhost' }] }),  // cGhost not in map
    { id: 'personal', summary: 'Dentist', start: { dateTime: '2026-09-10T20:00:00.000Z' }, end: { dateTime: '2026-09-10T21:00:00.000Z' }, extendedProperties: { private: {} } },  // no muse metadata → skip
    { id: 'allday', summary: 'Vacation', start: { date: '2026-09-11' }, extendedProperties: { private: { museGroupId: 'gX', museLines: '[]' } } },  // all-day → skip
  ];
  const { appts, unmatchedLines } = _regroupGoogleAppts(events, calToStaff, genSeq());
  assert.equal(appts.length, 1, 'only the muse-timed booking imports');
  assert.equal(appts[0].guests[0].lines[0].staffId, '', 'unmatched tech → Unassigned');
  assert.equal(unmatchedLines, 1);
});

test('regroup: confirmed / noShow OR across the group; solo (no gid) keyed by event id', () => {
  const events = [
    ev({ id: 'solo1', gid: undefined, name: 'Dan', primary: true, primaryName: 'Dan', confirmed: true, lines: [{ svcId: 's1', calId: 'c1' }] }),
  ];
  const { appts } = _regroupGoogleAppts(events, calToStaff, genSeq());
  assert.equal(appts.length, 1);
  assert.equal(appts[0].confirmed, true);
  assert.equal(appts[0].noShow, false);
  assert.equal(appts[0].googleGroupId, 'solo:solo1');
});

test('mapGoogleTask: fields, completed status, list label, empty → null', () => {
  const t = _mapGoogleTask({ id: 'gt1', title: 'Order acetone', notes: 'ASAP', due: '2026-09-15T00:00:00.000Z', status: 'needsAction' }, 'Supplies', () => 'task_0');
  assert.equal(t.title, 'Order acetone');
  assert.equal(t.notes, 'ASAP');
  assert.equal(t.completed, false);
  assert.equal(t.list, 'Supplies');
  assert.equal(t.googleTaskId, 'gt1');
  const done = _mapGoogleTask({ id: 'gt2', title: 'Pay rent', status: 'completed', completed: '2026-09-01T00:00:00.000Z' }, '', () => 'task_1');
  assert.equal(done.completed, true);
  assert.equal(done.completedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(done.list, 'Tasks');   // default label
  assert.equal(_mapGoogleTask(null, 'x'), null);
  assert.equal(_mapGoogleTask({}, 'x'), null);
});
