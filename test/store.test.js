import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getState, applyChange, hydrate, isStaleWrite } from '../js/app/store.js';

// Stale-write guard: a queue entry / record write is rejected only when the copy we already
// hold is strictly NEWER (by updatedAt). This stops a lingering stale device copy (e.g. an old
// outbox op from before a $2 fee was added) from clobbering a good record — the fee-drop bug.

test('isStaleWrite: only rejects when the stored copy is strictly newer', () => {
  assert.equal(isStaleWrite({ updatedAt: 2 }, { updatedAt: 1 }), true);   // stored newer → stale, reject
  assert.equal(isStaleWrite({ updatedAt: 1 }, { updatedAt: 2 }), false);  // incoming newer → apply
  assert.equal(isStaleWrite({ updatedAt: 1 }, { updatedAt: 1 }), false);  // equal → apply (idempotent re-save)
  assert.equal(isStaleWrite({}, { updatedAt: 1 }), false);                // no stored timestamp → apply
  assert.equal(isStaleWrite({ updatedAt: 1 }, {}), false);                // no incoming timestamp → apply
  assert.equal(isStaleWrite(null, { updatedAt: 1 }), false);             // brand-new (no prev) → apply
});

test('record.save guard: an older record cannot overwrite a newer one', () => {
  hydrate({ state: { records: [{ id: 'r1', totalCost: 95, fees: [{ amount: 2 }], updatedAt: 200 }] }, seq: 1 });
  // stale write (older) — must be IGNORED, the $2 fee survives
  applyChange('record.save', { record: { id: 'r1', totalCost: 93, fees: [], updatedAt: 100 } });
  let r = getState().records.find(x => x.id === 'r1');
  assert.equal(r.totalCost, 95);
  assert.equal(r.fees.length, 1);
  // newer write — applies
  applyChange('record.save', { record: { id: 'r1', totalCost: 97, fees: [{ amount: 2 }], updatedAt: 300 } });
  assert.equal(getState().records.find(x => x.id === 'r1').totalCost, 97);
  // brand-new record (no prev) — applies
  applyChange('record.save', { record: { id: 'r2', totalCost: 50, updatedAt: 50 } });
  assert.ok(getState().records.find(x => x.id === 'r2'));
});

test('record.save guard: a deleted record cannot be revived by a later save', () => {
  hydrate({ state: { records: [{ id: 'd1', totalCost: 40, updatedAt: 100 }], deletions: [] }, seq: 1 });
  applyChange('record.delete', { id: 'd1' });
  assert.equal(getState().records.find(x => x.id === 'd1').status, 'deleted');
  assert.ok(getState().deletions.includes('d1'));
  // a stale paid queue copy re-fires saveRecord with a FRESH updatedAt — must NOT un-delete it
  applyChange('record.save', { record: { id: 'd1', totalCost: 40, status: 'paid', updatedAt: 999 } });
  assert.equal(getState().records.find(x => x.id === 'd1').status, 'deleted');
});

test('queue.upsert guard: an older entry cannot overwrite a newer one', () => {
  hydrate({ state: { queue: [{ id: 'q1', totalCost: 80, updatedAt: 200 }] }, seq: 1 });
  applyChange('queue.upsert', { entry: { id: 'q1', totalCost: 78, updatedAt: 100 } });   // stale
  assert.equal(getState().queue.find(x => x.id === 'q1').totalCost, 80);
  applyChange('queue.upsert', { entry: { id: 'q1', totalCost: 82, updatedAt: 300 } });   // newer
  assert.equal(getState().queue.find(x => x.id === 'q1').totalCost, 82);
});

test('legacy data without timestamps still applies (guard never blocks untimestamped writes)', () => {
  hydrate({ state: { records: [{ id: 'old', totalCost: 10 }] }, seq: 1 });
  applyChange('record.save', { record: { id: 'old', totalCost: 12 } });   // no updatedAt either side
  assert.equal(getState().records.find(x => x.id === 'old').totalCost, 12);
});
