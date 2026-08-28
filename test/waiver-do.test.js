// Integration tests for signed-waiver storage at the Durable Object layer: waiver.save
// persists to its own key, is NOT broadcast (no PII on the wire) and NOT in buildSnapshot,
// gets its own R2 backup, and — the load-bearing assertions — SURVIVES both a restore and a
// factory reset. See worker.js MuseSalonDO waiver.save / alarm / restoreFromBackup / factoryReset.
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
    async list({ prefix, cursor } = {}) {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort();
      return { objects: keys.map(k => ({ key: k, uploaded: store.get(k).uploaded, size: store.get(k).body.length })), truncated: false, cursor: undefined };
    },
  };
}
const gatedState = (storage) => ({ storage, async blockConcurrencyWhile(fn) { return fn(); } });
const sampleWaiver = (id = 'wv-1') => ({ id, phoneKey: '9091234567', signerFullName: 'Sarah Miller', signerDisplay: 'Sarah M.', waiverVersion: '02', text: 'FULL SIGNED TEXT', textHash: 'abc', acceptedAt: 1000, optIns: { marketing: true, media: false } });

test('waiver.save persists to waiver:<id> and is NOT broadcast', async () => {
  const storage = makeStorage();
  const sent = [];
  const doInst = new MuseSalonDO(gatedState(storage), {});
  doInst.sockets = new Set([{ readyState: 1, send: (m) => sent.push(m) }]);   // a peer socket that must NOT receive PII
  const res = await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1', device: 'devA' }, null);
  assert.equal(res.applied, true);
  assert.deepEqual(storage._m.get('waiver:wv-1').signerFullName, 'Sarah Miller');
  assert.equal(sent.length, 0, 'signed-waiver PII must never be broadcast to peers');
});

test('waiver.save is idempotent by mutationId (offline-replay safe)', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);   // replay
  const keys = [...storage._m.keys()].filter(k => k.startsWith('waiver:'));
  assert.equal(keys.length, 1, 'a replayed waiver must not create a duplicate row');
});

test('waiver.save rejects a record with no id', async () => {
  const doInst = new MuseSalonDO(gatedState(makeStorage()), {});
  const res = await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: { text: 'x' } } }, null);
  assert.ok(res.error);
});

test('waivers are NOT in buildSnapshot (never synced to clients / cache)', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);
  const snap = await doInst.buildSnapshot();
  assert.equal(JSON.stringify(snap).includes('Sarah Miller'), false, 'no waiver PII may appear in the synced snapshot');
  assert.equal('waivers' in snap.state, false);
});

test('alarm() writes a separate waiver backup to R2', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);
  await doInst.alarm();
  const wkeys = [...bucket._store.keys()].filter(k => k.startsWith('backups/waivers-'));
  assert.equal(wkeys.length, 1, 'a waiver backup object was written');
  const dump = JSON.parse(bucket._store.get(wkeys[0]).body);
  assert.equal(dump[0].signerFullName, 'Sarah Miller');
});

test('a signed waiver SURVIVES restoreFromBackup (deleteAll would erase it)', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  bucket._store.set('backups/state-2026-01-01T00-00-00-000Z.json', { body: JSON.stringify({ state: { config: { marker: 'restored' } }, seq: 5 }), uploaded: '2026-01-01T00:00:00.000Z' });
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);
  const res = await doInst.restoreFromBackup('backups/state-2026-01-01T00-00-00-000Z.json');
  assert.equal(res.restored, true);
  assert.equal(await storage.get('config:marker'), 'restored', 'the restore actually ran');
  assert.ok(storage._m.get('waiver:wv-1'), 'the signed waiver must survive the restore wipe');
  assert.equal(storage._m.get('waiver:wv-1').signerFullName, 'Sarah Miller');
});

test('a signed waiver SURVIVES factoryReset (legal retention by design)', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver() }, mutationId: 'm1' }, null);
  storage._m.set('record:r1', { id: 'r1' });   // ordinary data that SHOULD be wiped
  const res = await doInst.factoryReset();
  assert.equal(res.reset, true);
  assert.equal(storage._m.has('record:r1'), false, 'ordinary records are wiped by factory reset');
  assert.ok(storage._m.get('waiver:wv-1'), 'signed waivers persist through a factory reset');
});

test('no-key restore after a waiver dump exists restores the latest STATE snapshot, not the waiver dump', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  // A real state snapshot, then a waiver dump written LATER (its uploaded time is newer).
  bucket._store.set('backups/state-2026-01-01T00-00-00-000Z.json', { body: JSON.stringify({ state: { config: { marker: 'good-state' }, records: [{ id: 'r1' }] }, seq: 9 }), uploaded: '2026-01-01T00:00:00.000Z' });
  bucket._store.set('backups/waivers-2026-01-02T00-00-00-000Z.json', { body: JSON.stringify([{ id: 'wv-1', signerFullName: 'Sarah Miller' }]), uploaded: '2026-01-02T00:00:00.000Z' });
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  const res = await doInst.restoreFromBackup();   // no key → MUST skip the newer waiver dump
  assert.equal(res.restored, true);
  assert.equal(await storage.get('config:marker'), 'good-state', 'restored the real state snapshot, not the waiver dump');
  assert.ok(storage._m.has('record:r1'), 'salon state was rebuilt (not wiped to empty)');
});

test('restoring from a waiver dump key is refused (never wipes the salon)', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  bucket._store.set('backups/waivers-2026-01-02T00-00-00-000Z.json', { body: JSON.stringify([{ id: 'wv-1' }]), uploaded: '2026-01-02T00:00:00.000Z' });
  storage._m.set('record:r1', { id: 'r1' });
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  const res = await doInst.restoreFromBackup('backups/waivers-2026-01-02T00-00-00-000Z.json');
  assert.ok(res.error, 'a waiver-dump key must be refused');
  assert.ok(storage._m.has('record:r1'), 'salon state untouched');
});

test('/state/backups recovery list hides waiver dumps', async () => {
  const storage = makeStorage();
  const bucket = makeBucket();
  bucket._store.set('backups/state-2026-01-01T00-00-00-000Z.json', { body: '{"state":{}}', uploaded: '2026-01-01T00:00:00.000Z' });
  bucket._store.set('backups/waivers-2026-01-02T00-00-00-000Z.json', { body: '[]', uploaded: '2026-01-02T00:00:00.000Z' });
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  const body = await (await doInst.fetch(new Request('https://do/state/backups'))).json();
  assert.equal(body.count, 1);
  assert.ok(!body.backups.some(b => b.key.includes('waivers-')), 'no waiver dump offered as a restore candidate');
});

test('GET /state/waivers returns records; /state/waivers/clear removes them', async () => {
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), {});
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver('wv-1') }, mutationId: 'm1' }, null);
  await doInst.applyMutation({ op: 'waiver.save', payload: { waiver: sampleWaiver('wv-2') }, mutationId: 'm2' }, null);
  const listRes = await doInst.fetch(new Request('https://do/state/waivers'));
  const body = await listRes.json();
  assert.equal(body.count, 2);
  assert.ok(body.waivers[0].text, 'export includes the full inline text');
  const clr = await doInst.fetch(new Request('https://do/state/waivers/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) }));
  assert.equal((await clr.json()).cleared, 2);
  assert.equal([...storage._m.keys()].filter(k => k.startsWith('waiver:')).length, 0);
});
