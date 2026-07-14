// Restore-from-backup must rebuild the FULL DO state — including the customer
// directory and the customer soft-delete tombstones. A gap here is silent
// data loss: restoring a backup wipes every customer.  See worker.js
// MuseSalonDO.restoreFromBackup / buildSnapshot.
//
// 0-pre-b hardening (Phase 3 Stage 0-pre): the wipe/rebuild must run inside
// state.blockConcurrencyWhile — the safety backupNow's R2 put is the one await
// where a WS mutate could land, get ACKed, then be wiped by deleteAll while
// absent from the safety snapshot (an acknowledged write silently lost). The
// restored meta:seq must never regress below the live counter, and the rebuild
// must round-trip cfgmeta: (stale-write guard) + audit: keys, which the
// snapshot carries but restore used to drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO } from '../cloudflare/worker.js';

// Map-backed stand-in for DurableObjectStorage — implements only what
// buildSnapshot / restoreFromBackup / backupNow / ensureBackupScheduled touch.
// `gate` (shared with the state stub + bucket) records whether each operation
// ran inside blockConcurrencyWhile. put() accepts the batched object form the
// real API supports: put({ k1: v1, k2: v2 }).
function makeGate() { return { active: false, entered: 0 }; }
function makeStorage(gate = makeGate()) {
  const m = new Map();
  const ops = [];
  return {
    _m: m, _ops: ops,
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) {
      if (typeof k === 'object' && k !== null) {
        for (const [kk, vv] of Object.entries(k)) { m.set(kk, vv); ops.push({ op: 'put', key: kk, inGate: gate.active }); }
        return;
      }
      m.set(k, v); ops.push({ op: 'put', key: k, inGate: gate.active });
    },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); },
    async deleteAll() { m.clear(); ops.push({ op: 'deleteAll', inGate: gate.active }); },
    async list({ prefix } = {}) {
      const r = new Map();
      for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v);
      return r;
    },
    async getAlarm() { return null; },
    async setAlarm() {},
  };
}

// DO `state` stand-in: storage + a blockConcurrencyWhile that tracks entry.
function makeState(gate = makeGate()) {
  const storage = makeStorage(gate);
  return {
    storage, _gate: gate,
    async blockConcurrencyWhile(fn) {
      gate.entered++; gate.active = true;
      try { return await fn(); } finally { gate.active = false; }
    },
  };
}

// Minimal R2 stand-in for env.PHOTOS_BUCKET; records whether puts ran in-gate.
function makeBucket(gate = makeGate()) {
  const store = new Map();
  const puts = [];
  return {
    _store: store, _puts: puts,
    async put(k, body) { store.set(k, body); puts.push({ key: k, inGate: gate.active }); },
    async get(k) { return store.has(k) ? { text: async () => store.get(k) } : null; },
    async list({ prefix } = {}) {
      return { objects: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(k => ({ key: k, uploaded: new Date().toISOString(), size: store.get(k).length })) };
    },
  };
}

test('restoreFromBackup rebuilds the customer directory + tombstones (no silent wipe)', async () => {
  const gate = makeGate();
  const state = makeState(gate);
  const bucket = makeBucket(gate);
  const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
  const storage = state.storage;

  // Seed a live salon: config, records, a 2-customer directory, one customer tombstone.
  await storage.put('config:business_name', 'Muse');
  await storage.put('record:r1', { id: 'r1', total: 40 });
  await storage.put('customer:c1', { id: 'c1', firstName: 'Alice', phone: '5551112222' });
  await storage.put('customer:c2', { id: 'c2', firstName: 'Bob' });
  await storage.put('custdeletion:c9', { id: 'c9', at: '2026-01-01T00:00:00Z' });

  // Snapshot → R2 (the backup we will restore from).
  const snap = await doInst.buildSnapshot();
  assert.equal(snap.state.customers.length, 2, 'snapshot must include customers');
  assert.equal(snap.state.customerDeletions.length, 1, 'snapshot must include customer tombstones');
  await bucket.put('backups/test.json', JSON.stringify(snap));

  // Restore internally deleteAll()s then rewrites — so anything that survives was rewritten.
  const res = await doInst.restoreFromBackup('backups/test.json');
  assert.equal(res.restored, true);

  // The whole customer directory must come back.
  assert.deepEqual(await storage.get('customer:c1'), { id: 'c1', firstName: 'Alice', phone: '5551112222' });
  assert.deepEqual(await storage.get('customer:c2'), { id: 'c2', firstName: 'Bob' });
  // The tombstone must come back (else a stale replay could revive a deleted customer).
  assert.ok(await storage.get('custdeletion:c9'), 'customer tombstone must be restored');
  // Non-customer data still restored (regression guard).
  assert.deepEqual(await storage.get('record:r1'), { id: 'r1', total: 40 });
  // Counts must report customers.
  assert.equal(res.counts.customers, 2);
});

test('restoreFromBackup runs safety-backup + wipe + rebuild + seq inside blockConcurrencyWhile', async () => {
  const gate = makeGate();
  const state = makeState(gate);
  const bucket = makeBucket(gate);
  const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
  const storage = state.storage;

  await storage.put('config:business_name', 'Muse');
  await storage.put('meta:seq', 500);
  await bucket.put('backups/test.json', JSON.stringify({ state: { config: { business_name: 'Muse' } }, seq: 10 }));
  storage._ops.length = 0; bucket._puts.length = 0;

  const res = await doInst.restoreFromBackup('backups/test.json');
  assert.equal(res.restored, true);
  assert.ok(gate.entered >= 1, 'restore must use state.blockConcurrencyWhile');

  const wipe = storage._ops.find(o => o.op === 'deleteAll');
  assert.ok(wipe, 'restore must wipe');
  assert.equal(wipe.inGate, true, 'deleteAll must run inside the gate');
  const rebuildPuts = storage._ops.filter(o => o.op === 'put');
  assert.ok(rebuildPuts.length > 0, 'restore must rebuild keys');
  for (const p of rebuildPuts) assert.equal(p.inGate, true, `rebuild put ${p.key} must run inside the gate`);

  // The safety snapshot's R2 put is the one await where an ACKed mutate could
  // otherwise land and then be wiped — it MUST sit inside the gate.
  const safety = bucket._puts.find(p => p.key.startsWith('backups/safety-'));
  assert.ok(safety, 'restore must take a safety snapshot first');
  assert.equal(safety.inGate, true, 'the safety backup must run inside the gate (ack-then-wipe window)');
});

test('restored meta:seq never regresses below the live counter (max(current, snap.seq) + 1)', async () => {
  // Live counter HIGHER than the snapshot's — the dangerous direction.
  {
    const gate = makeGate(); const state = makeState(gate); const bucket = makeBucket(gate);
    const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
    await state.storage.put('meta:seq', 500);
    await bucket.put('backups/t.json', JSON.stringify({ state: { config: {} }, seq: 10 }));
    await doInst.restoreFromBackup('backups/t.json');
    assert.equal(await state.storage.get('meta:seq'), 501, 'seq must advance past the LIVE counter, not regress to snap.seq+1');
  }
  // Snapshot seq higher (restore of a newer backup into an older/blank DO).
  {
    const gate = makeGate(); const state = makeState(gate); const bucket = makeBucket(gate);
    const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
    await state.storage.put('meta:seq', 5);
    await bucket.put('backups/t.json', JSON.stringify({ state: { config: {} }, seq: 10 }));
    await doInst.restoreFromBackup('backups/t.json');
    assert.equal(await state.storage.get('meta:seq'), 11, 'seq must still advance past the snapshot seq');
  }
});

test('restore round-trips configMeta (stale-write guard) and the audit trail', async () => {
  const gate = makeGate();
  const state = makeState(gate);
  const bucket = makeBucket(gate);
  const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
  const storage = state.storage;

  await storage.put('config:turns_order', ['t1', 't2']);
  await storage.put('cfgmeta:turns_order', { updatedAt: 1751400000000, updatedBy: 'dev-abc123' });
  await storage.put('audit:evt1', { id: 'evt1', at: '2026-07-01T10:00:00Z', action: 'Refund', detail: 'x' });

  const snap = await doInst.buildSnapshot();
  assert.ok(snap.state.configMeta.turns_order, 'snapshot must carry configMeta');
  assert.equal(snap.state.audit.length, 1, 'snapshot must carry audit');
  await bucket.put('backups/test.json', JSON.stringify(snap));

  await doInst.restoreFromBackup('backups/test.json');
  assert.deepEqual(await storage.get('cfgmeta:turns_order'), { updatedAt: 1751400000000, updatedBy: 'dev-abc123' },
    'cfgmeta must be restored or the config stale-write guard is disarmed after every restore');
  assert.deepEqual(await storage.get('audit:evt1'), { id: 'evt1', at: '2026-07-01T10:00:00Z', action: 'Refund', detail: 'x' },
    'audit trail must survive a restore');
});

test('factoryReset runs inside the gate and its seq never regresses', async () => {
  const gate = makeGate();
  const state = makeState(gate);
  const bucket = makeBucket(gate);
  const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket });
  await state.storage.put('meta:seq', 500);
  await state.storage.put('config:business_name', 'Muse');

  const res = await doInst.factoryReset();
  assert.equal(res.reset, true);
  assert.ok(gate.entered >= 1, 'factoryReset must use state.blockConcurrencyWhile');
  assert.equal(await state.storage.get('meta:seq'), 501,
    'factory-reset seq must advance past the live counter (a hard reset to 1 regresses below every client)');
  assert.equal(await state.storage.get('config:business_name'), undefined, 'state must be wiped');
  const safety = bucket._puts.find(p => p.key.startsWith('backups/safety-'));
  assert.ok(safety && safety.inGate, 'factoryReset safety snapshot must run inside the gate');
});
