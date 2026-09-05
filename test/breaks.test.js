import test from 'node:test';
import assert from 'node:assert/strict';
import { staffOnBreakNow, breaksForColumnDay } from '../js/app/features/breaks.js';

// A break = { id, staffId, start(ISO), end(ISO), label }. Per-tech time blocks (e.g. lunch);
// they grey the tech's calendar column and flag the tech "On Break" in Assign & Price while active.
const brk = (o) => ({ id: o.id, staffId: o.staffId, start: o.start, end: o.end, label: o.label || 'Break' });
const iso = (h, m = 0) => { const d = new Date('2026-09-10T00:00:00'); d.setHours(h, m, 0, 0); return d.toISOString(); };
const at = (h, m = 0) => { const d = new Date('2026-09-10T00:00:00'); d.setHours(h, m, 0, 0); return +d; };

test('staffOnBreakNow: true only for the right tech within [start, end)', () => {
  const breaks = [brk({ id: 'b1', staffId: 's1', start: iso(12), end: iso(13) })];
  assert.equal(staffOnBreakNow(breaks, 's1', at(12, 30)), true);   // mid-break
  assert.equal(staffOnBreakNow(breaks, 's1', at(12, 0)), true);    // start inclusive
  assert.equal(staffOnBreakNow(breaks, 's1', at(13, 0)), false);   // end exclusive
  assert.equal(staffOnBreakNow(breaks, 's1', at(11, 59)), false);  // before
  assert.equal(staffOnBreakNow(breaks, 's2', at(12, 30)), false);  // different tech
  assert.equal(staffOnBreakNow(breaks, 's1', at(15, 0)), false);   // after
});

test('staffOnBreakNow: handles empty/blank + string/number staffId', () => {
  assert.equal(staffOnBreakNow([], 's1', at(12, 30)), false);
  assert.equal(staffOnBreakNow(null, 's1', at(12, 30)), false);
  const breaks = [brk({ id: 'b1', staffId: 5, start: iso(12), end: iso(13) })];
  assert.equal(staffOnBreakNow(breaks, '5', at(12, 30)), true);    // numeric id vs string lookup
});

test('breaksForColumnDay: only this tech, only breaks overlapping the day, sorted by start', () => {
  const dayStart = at(0, 0), dayEnd = at(0, 0) + 24 * 3600 * 1000;
  const breaks = [
    brk({ id: 'b2', staffId: 's1', start: iso(15), end: iso(15, 30), label: 'Coffee' }),
    brk({ id: 'b1', staffId: 's1', start: iso(12), end: iso(13), label: 'Lunch' }),
    brk({ id: 'b3', staffId: 's2', start: iso(12), end: iso(13) }),                 // other tech
    brk({ id: 'b4', staffId: 's1', start: '2026-09-11T12:00:00.000Z', end: '2026-09-11T13:00:00.000Z' }), // other day
  ];
  const rows = breaksForColumnDay(breaks, 's1', dayStart, dayEnd);
  assert.deepEqual(rows.map(r => r.id), ['b1', 'b2']);   // this tech, this day, start-sorted
});
