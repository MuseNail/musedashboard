import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getState } from '../js/app/store.js';
import { buildCombinedRecords } from '../js/app/features/reports.js';

// buildCombinedRecords: records are the single source of truth for finished sales — a paid
// queue entry surfaces only when no record exists for its id. (Records-authoritative redesign.)
function seed({ records = [], queue = [], deletions = [] }) {
  const s = getState();
  s.records = records; s.queue = queue; s.deletions = deletions;
}
const D = '2026-05-20T15:00:00.000Z';

test('buildCombinedRecords: the record wins over a paid queue copy of the same id', () => {
  seed({
    records: [{ id: 1, status: 'paid', checkinTime: D, assignments: [{ cost: 97 }], totalCost: 97 }],
    queue:   [{ id: 1, status: 'paid', checkinTime: D, assignments: [{ cost: 100 }], totalCost: 100 }],
  });
  const c = buildCombinedRecords();
  assert.equal(c.length, 1);
  assert.equal(c.find(x => String(x.id) === '1').totalCost, 97);   // record (edited) wins, not the queue copy
});

test('buildCombinedRecords: a paid queue entry with no record still surfaces (crash-safety)', () => {
  seed({ records: [], queue: [{ id: 2, status: 'paid', checkinTime: D, assignments: [{ cost: 42 }], totalCost: 42 }] });
  const c = buildCombinedRecords();
  assert.equal(c.length, 1);
  assert.equal(c[0].totalCost, 42);
});

test('buildCombinedRecords: deleted records and deletion ids are excluded', () => {
  seed({
    records: [{ id: 3, status: 'paid', checkinTime: D, assignments: [{ cost: 10 }], totalCost: 10 },
              { id: 4, status: 'deleted', checkinTime: D, totalCost: 99 }],
    queue:   [{ id: 5, status: 'paid', checkinTime: D, assignments: [{ cost: 20 }], totalCost: 20 }],
    deletions: ['5'],
  });
  assert.deepEqual(buildCombinedRecords().map(x => String(x.id)).sort(), ['3']);
});

test('buildCombinedRecords: only finished (paid/done) queue entries are included', () => {
  seed({ records: [], queue: [{ id: 6, status: 'inservice', checkinTime: D, assignments: [{ cost: 30 }], totalCost: 30 }] });
  assert.equal(buildCombinedRecords().length, 0);
});

test('buildCombinedRecords: stale totalCost is recomputed from parts (bulletproofing)', () => {
  seed({ records: [{ id: 7, status: 'paid', checkinTime: D, assignments: [{ cost: 40 }], fees: [{ amount: 2 }], totalCost: 40 }], queue: [] });
  assert.equal(buildCombinedRecords()[0].totalCost, 42);   // 40 svc + 2 fee, ignoring the stale stored 40
});
