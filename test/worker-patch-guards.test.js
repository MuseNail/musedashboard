// Device-scoped stale-write guards (Phase 4). The per-assignment / per-entry patch guard
// rejects ONLY a stale replay from the SAME device (matched by updatedBy) — never a
// cross-device action. This closes the offline-replay gap WITHOUT the clock-skew data-loss
// of a naive wall-clock compare: a tech's genuinely-later Start/Complete/price from a phone
// whose clock lags the front desk is never dropped. See worker.js applyMutation
// queue.assignmentPatch / queue.entryPatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO } from '../cloudflare/worker.js';

function makeStorage() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : undefined; }, async put(k, v) { m.set(k, v); },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); }, async deleteAll() { m.clear(); },
    async list({ prefix } = {}) { const r = new Map(); for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v); return r; },
    async getAlarm() { return null; }, async setAlarm() {},
  };
}
function makeDO() {
  const bucket = { async put() {}, async get() { return null; }, async list() { return { objects: [] }; }, async delete() {} };
  return new MuseSalonDO({ storage: makeStorage() }, { PHOTOS_BUCKET: bucket });
}
const seed = (d, entry) => d.state.storage.put('queue:' + entry.id, entry);
const apply = (d, op, payload) => d.applyMutation({ op, payload }, null);
const asg = o => ({ serviceId: 's1', techId: 't1', status: 'inservice', cost: 40, ...o });

// ── queue.assignmentPatch ──────────────────────────────────────────────────
test('assignmentPatch rejects a stale replay from the SAME device', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'inservice', assignments: [asg({ updatedAt: 200, updatedBy: 'devA' })] });
  const res = await apply(d, 'queue.assignmentPatch', { entryId: 'e1', serviceId: 's1', techId: 't1', assignment: asg({ status: 'complete', cost: 99, updatedAt: 100, updatedBy: 'devA' }) });
  assert.equal(res.stale, true, 'same-device older replay is rejected');
  const stored = await d.state.storage.get('queue:e1');
  assert.equal(stored.assignments[0].cost, 40);
  assert.equal(stored.assignments[0].updatedAt, 200);
});

test('assignmentPatch applies a newer patch from the same device', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'inservice', assignments: [asg({ updatedAt: 200, updatedBy: 'devA' })] });
  const res = await apply(d, 'queue.assignmentPatch', { entryId: 'e1', serviceId: 's1', techId: 't1', assignment: asg({ status: 'complete', cost: 55, updatedAt: 300, updatedBy: 'devA' }) });
  assert.notEqual(res.stale, true);
  assert.equal((await d.state.storage.get('queue:e1')).assignments[0].cost, 55);
});

test('assignmentPatch NEVER drops a cross-device patch, even with an older timestamp (clock-skew safety)', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'inservice', assignments: [asg({ updatedAt: 200, updatedBy: 'frontdesk' })] });   // front desk stamped it
  // tech phone (slower clock) sends its genuinely-later Start with a SMALLER timestamp
  const res = await apply(d, 'queue.assignmentPatch', { entryId: 'e1', serviceId: 's1', techId: 't1', assignment: asg({ cost: 45, updatedAt: 100, updatedBy: 'techphone' }) });
  assert.notEqual(res.stale, true, 'a different device is never rejected on a timestamp compare');
  assert.equal((await d.state.storage.get('queue:e1')).assignments[0].cost, 45, 'the cross-device tech action is applied, not silently dropped');
});

test('assignmentPatch applies when the stored assignment has no updatedBy (front-desk-set, no device stamp)', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'inservice', assignments: [asg({ updatedAt: 200 })] });   // no updatedBy
  const res = await apply(d, 'queue.assignmentPatch', { entryId: 'e1', serviceId: 's1', techId: 't1', assignment: asg({ status: 'complete', cost: 55, updatedAt: 100, updatedBy: 'techphone' }) });
  assert.notEqual(res.stale, true);
  assert.equal((await d.state.storage.get('queue:e1')).assignments[0].cost, 55);
});

// ── queue.entryPatch ───────────────────────────────────────────────────────
test('entryPatch rejects a stale replay from the same device', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'waiting', txnNote: 'original', _patchedAt: 200, _patchedBy: 'devA', assignments: [] });
  const res = await apply(d, 'queue.entryPatch', { entryId: 'e1', patch: { txnNote: 'stale' }, updatedAt: 100, updatedBy: 'devA' });
  assert.equal(res.stale, true);
  assert.equal((await d.state.storage.get('queue:e1')).txnNote, 'original');
});

test('entryPatch applies a newer same-device patch and advances _patchedAt/_patchedBy', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'waiting', txnNote: 'original', _patchedAt: 200, _patchedBy: 'devA', assignments: [] });
  const res = await apply(d, 'queue.entryPatch', { entryId: 'e1', patch: { txnNote: 'newer' }, updatedAt: 300, updatedBy: 'devA' });
  assert.notEqual(res.stale, true);
  const stored = await d.state.storage.get('queue:e1');
  assert.equal(stored.txnNote, 'newer');
  assert.equal(stored._patchedAt, 300);
  assert.equal(stored._patchedBy, 'devA');
});

test('entryPatch NEVER drops a cross-device patch even with an older timestamp', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'waiting', txnNote: 'original', _patchedAt: 200, _patchedBy: 'devA', assignments: [] });
  const res = await apply(d, 'queue.entryPatch', { entryId: 'e1', patch: { txnNote: 'fromB' }, updatedAt: 100, updatedBy: 'devB' });
  assert.notEqual(res.stale, true);
  assert.equal((await d.state.storage.get('queue:e1')).txnNote, 'fromB');
});

test('entryPatch applies an unstamped patch (back-compat)', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'waiting', txnNote: 'original', assignments: [] });
  const res = await apply(d, 'queue.entryPatch', { entryId: 'e1', patch: { txnNote: 'note2' } });
  assert.notEqual(res.stale, true);
  assert.equal((await d.state.storage.get('queue:e1')).txnNote, 'note2');
});

test('queue.upsert preserves the entryPatch guard marker so a later stale replay is still rejected', async () => {
  const d = makeDO();
  await seed(d, { id: 'e1', status: 'waiting', txnNote: 'orig', _patchedAt: 200, _patchedBy: 'devA', assignments: [] });
  // front desk does a whole-entry upsert — its client copy carries no _patchedAt marker
  await apply(d, 'queue.upsert', { entry: { id: 'e1', status: 'waiting', txnNote: 'orig', fees: 5, updatedAt: 500, assignments: [] } });
  let stored = await d.state.storage.get('queue:e1');
  assert.equal(stored._patchedAt, 200, 'marker carried forward across the whole-entry write');
  assert.equal(stored._patchedBy, 'devA');
  const res = await apply(d, 'queue.entryPatch', { entryId: 'e1', patch: { txnNote: 'stale' }, updatedAt: 100, updatedBy: 'devA' });
  assert.equal(res.stale, true, 'stale same-device replay still guarded after the upsert');
  assert.equal((await d.state.storage.get('queue:e1')).txnNote, 'orig');
});

// ── staff.patch (tech notes) — field-merge, never clobbers a concurrent payroll edit ─────────
const seedStaff = (d, arr) => d.state.storage.put('config:staff', arr);
test('staff.patch merges the note onto the right tech, preserving payroll + other techs', async () => {
  const d = makeDO();
  await seedStaff(d, [{ id: 's1', name: 'Maria', commission: 55 }, { id: 's2', name: 'Lin', commission: 50 }]);
  await apply(d, 'staff.patch', { id: 's2', fields: { notes: 'leaves at 5' }, updatedAt: 100, updatedBy: 'devA' });
  const arr = await d.state.storage.get('config:staff');
  assert.equal(arr[1].notes, 'leaves at 5');
  assert.equal(arr[1].commission, 50, 'payroll field untouched by the note patch');
  assert.equal(arr[0].name, 'Maria', 'other techs untouched');
});
test('staff.patch does NOT clobber a concurrent commission change (the whole point of Option B)', async () => {
  const d = makeDO();
  await seedStaff(d, [{ id: 's1', name: 'Maria', commission: 55 }]);
  // manager bumps commission (whole-array config.set) …
  await apply(d, 'config.set', { key: 'staff', value: [{ id: 's1', name: 'Maria', commission: 60 }], updatedAt: 200 });
  // … then a note patch lands AFTER it — it must merge into the CURRENT stored array, keeping commission 60
  await apply(d, 'staff.patch', { id: 's1', fields: { notes: 'no fumes' }, updatedAt: 300, updatedBy: 'devB' });
  const arr = await d.state.storage.get('config:staff');
  assert.equal(arr[0].commission, 60, 'the note patch kept the newer commission');
  assert.equal(arr[0].notes, 'no fumes');
});
test('staff.patch rejects a stale SAME-device replay, applies cross-device + newer', async () => {
  const d = makeDO();
  await seedStaff(d, [{ id: 's1', name: 'Maria', notes: 'current', _notesAt: 200, _notesBy: 'devA' }]);
  const stale = await apply(d, 'staff.patch', { id: 's1', fields: { notes: 'old' }, updatedAt: 100, updatedBy: 'devA' });
  assert.equal(stale.stale, true);
  assert.equal((await d.state.storage.get('config:staff'))[0].notes, 'current');
  const cross = await apply(d, 'staff.patch', { id: 's1', fields: { notes: 'other device' }, updatedAt: 100, updatedBy: 'devB' });
  assert.notEqual(cross.stale, true, 'a different device is never dropped on a timestamp compare');
  const newer = await apply(d, 'staff.patch', { id: 's1', fields: { notes: 'newest' }, updatedAt: 300, updatedBy: 'devA' });
  assert.notEqual(newer.stale, true);
  assert.equal((await d.state.storage.get('config:staff'))[0].notes, 'newest');
});
test('staff.patch is a safe no-op when the array/tech is missing', async () => {
  const d = makeDO();
  await apply(d, 'staff.patch', { id: 's1', fields: { notes: 'x' }, updatedAt: 1 });   // no config:staff yet
  assert.equal(await d.state.storage.get('config:staff'), undefined);
  await seedStaff(d, [{ id: 's1', name: 'Maria' }]);
  await apply(d, 'staff.patch', { id: 'nope', fields: { notes: 'x' }, updatedAt: 1 });
  assert.equal((await d.state.storage.get('config:staff'))[0].notes, undefined);
});
