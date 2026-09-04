// DO-layer tests for app-native appointments + tasks: appt.upsert/task.upsert persist to their
// own keys with a tombstone + stale-write guard, appear in buildSnapshot (synced + backed up),
// and SURVIVE a restore. Mirrors the customer.upsert pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO } from '../cloudflare/worker.js';

function makeStorage() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) { if (typeof k === 'object' && k !== null) { for (const [kk, vv] of Object.entries(k)) m.set(kk, vv); return; } m.set(k, v); },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); },
    async deleteAll() { m.clear(); },
    async list({ prefix } = {}) { const r = new Map(); for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v); return r; },
    async getAlarm() { return null; },
    async setAlarm() {},
  };
}
function makeBucket() {
  const store = new Map();
  return {
    _store: store,
    async put(k, body) { store.set(k, { body, uploaded: new Date().toISOString() }); },
    async get(k) { const o = store.get(k); return o ? { text: async () => o.body } : null; },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => store.delete(x)); else store.delete(k); },
    async list({ prefix } = {}) {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort();
      return { objects: keys.map(k => ({ key: k, uploaded: store.get(k).uploaded, size: store.get(k).body.length })), truncated: false, cursor: undefined };
    },
  };
}
const gatedState = (storage) => ({ storage, async blockConcurrencyWhile(fn) { return fn(); } });
const appt = (id = 'a1') => ({ id, start: '2026-09-01T17:00:00.000Z', end: '2026-09-01T18:00:00.000Z', guests: [{ name: 'Sarah', phone: '9091234567', lines: [{ serviceId: 'mani', staffId: 's1' }] }], notes: '', confirmed: false, noShow: false, updatedAt: 100 });
const task = (id = 't1') => ({ id, title: 'Order supplies', notes: '', due: '', completed: false, list: 'Tasks', updatedAt: 100 });

test('appt.upsert persists to appt:<id>, guarded, tombstoned on delete', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  doInst.sockets = new Set();
  await doInst.applyMutation({ op: 'appt.upsert', payload: { appt: appt() }, mutationId: 'm1', device: 'd' }, null);
  assert.equal(storage._m.get('appt:a1').guests[0].name, 'Sarah');
  // stale write ignored
  await doInst.applyMutation({ op: 'appt.upsert', payload: { appt: { ...appt(), notes: 'stale', updatedAt: 50 } }, mutationId: 'm2', device: 'd' }, null);
  assert.equal(storage._m.get('appt:a1').notes, '');
  // delete → tombstone; re-upsert must not revive
  await doInst.applyMutation({ op: 'appt.delete', payload: { id: 'a1' }, mutationId: 'm3', device: 'd' }, null);
  assert.ok(!storage._m.has('appt:a1'));
  assert.ok(storage._m.has('apptdeletion:a1'));
  await doInst.applyMutation({ op: 'appt.upsert', payload: { appt: { ...appt(), notes: 'revive', updatedAt: 999 } }, mutationId: 'm4', device: 'd' }, null);
  assert.ok(!storage._m.has('appt:a1'));
});

test('task.upsert persists to task:<id> and tombstones on delete', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  doInst.sockets = new Set();
  await doInst.applyMutation({ op: 'task.upsert', payload: { task: task() }, mutationId: 'm1', device: 'd' }, null);
  assert.equal(storage._m.get('task:t1').title, 'Order supplies');
  await doInst.applyMutation({ op: 'task.delete', payload: { id: 't1' }, mutationId: 'm2', device: 'd' }, null);
  assert.ok(!storage._m.has('task:t1'));
  assert.ok(storage._m.has('taskdeletion:t1'));
});

test('appointments + tasks appear in buildSnapshot', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  doInst.sockets = new Set();
  await doInst.applyMutation({ op: 'appt.upsert', payload: { appt: appt('a5') }, mutationId: 'm1', device: 'd' }, null);
  await doInst.applyMutation({ op: 'task.upsert', payload: { task: task('t5') }, mutationId: 'm2', device: 'd' }, null);
  const snap = await doInst.buildSnapshot();
  assert.equal(snap.state.appointments.length, 1);
  assert.equal(snap.state.appointments[0].id, 'a5');
  assert.equal(snap.state.tasks[0].id, 't5');
});

test('appointments + tasks SURVIVE a restore', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  doInst.sockets = new Set();
  // A state snapshot in R2 carrying an appt + a task
  bucket._store.set('backups/state-2026-01-01T00-00-00-000Z.json', { body: JSON.stringify({ state: { appointments: [appt('a7')], tasks: [task('t7')] }, seq: 5 }), uploaded: '2026-01-01T00:00:00.000Z' });
  const res = await doInst.restoreFromBackup();
  assert.equal(res.restored, true);
  assert.ok(storage._m.has('appt:a7'), 'appointment restored');
  assert.ok(storage._m.has('task:t7'), 'task restored');
});
