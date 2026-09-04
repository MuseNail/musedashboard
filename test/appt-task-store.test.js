import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getState, applyChange, hydrate } from '../js/app/store.js';

// App-native appointments + tasks: per-record synced arrays with the same stale-write guard +
// tombstone pattern as customers/records (mirrors TurnDesk's appt.* ops).

test('hydrate carries appointments + tasks + their tombstones', () => {
  hydrate({ state: {
    appointments: [{ id: 'a1', start: 'x' }], apptDeletions: [{ id: 'a9' }],
    tasks: [{ id: 't1', title: 'call vendor' }], taskDeletions: [{ id: 't9' }],
  }, seq: 1 });
  assert.equal(getState().appointments.length, 1);
  assert.deepEqual(getState().apptDeletions, ['a9']);
  assert.equal(getState().tasks[0].title, 'call vendor');
  assert.deepEqual(getState().taskDeletions, ['t9']);
});

test('appt.upsert: stale guard, delete tombstone, don\'t revive cancelled', () => {
  hydrate({ state: { appointments: [{ id: 'a1', notes: 'v2', updatedAt: 200 }] }, seq: 1 });
  applyChange('appt.upsert', { appt: { id: 'a1', notes: 'stale', updatedAt: 100 } });   // older → ignored
  assert.equal(getState().appointments.find(a => a.id === 'a1').notes, 'v2');
  applyChange('appt.upsert', { appt: { id: 'a1', notes: 'v3', updatedAt: 300 } });        // newer → applies
  assert.equal(getState().appointments.find(a => a.id === 'a1').notes, 'v3');
  applyChange('appt.upsert', { appt: { id: 'a2', notes: 'new' } });                        // brand-new (unstamped) → applies
  assert.ok(getState().appointments.find(a => a.id === 'a2'));
  applyChange('appt.delete', { id: 'a1' });                                                 // delete → tombstone
  assert.ok(!getState().appointments.find(a => a.id === 'a1'));
  assert.ok(getState().apptDeletions.includes('a1'));
  applyChange('appt.upsert', { appt: { id: 'a1', notes: 'revive', updatedAt: 999 } });      // must NOT revive a cancelled appt
  assert.ok(!getState().appointments.find(a => a.id === 'a1'));
});

test('task.upsert: stale guard, delete tombstone, don\'t revive deleted', () => {
  hydrate({ state: { tasks: [{ id: 't1', title: 'v2', completed: false, updatedAt: 200 }] }, seq: 1 });
  applyChange('task.upsert', { task: { id: 't1', title: 'stale', updatedAt: 100 } });
  assert.equal(getState().tasks.find(t => t.id === 't1').title, 'v2');
  applyChange('task.upsert', { task: { id: 't1', title: 'v2', completed: true, updatedAt: 300 } });   // toggle done
  assert.equal(getState().tasks.find(t => t.id === 't1').completed, true);
  applyChange('task.delete', { id: 't1' });
  assert.ok(!getState().tasks.find(t => t.id === 't1'));
  assert.ok(getState().taskDeletions.includes('t1'));
  applyChange('task.upsert', { task: { id: 't1', title: 'revive', updatedAt: 999 } });
  assert.ok(!getState().tasks.find(t => t.id === 't1'));
});
