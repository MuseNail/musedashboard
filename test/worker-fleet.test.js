// Stage 0 (Phase 3): per-device fleet telemetry. The WS hello now carries
// { v, device, app } and the DO stamps a durable fleet:<device> entry — the signal the
// Stage-X roll-off gate needs ("no device below vR seen in 14 days"), which in-memory
// socket counts can't provide (they reset on every deploy). Writes are THROTTLED
// (version/app change, or an hour since the last stamp) so reconnect storms don't
// churn storage on every hello.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO } from '../cloudflare/worker.js';

function makeStorage() {
  const m = new Map();
  let puts = 0;
  return {
    _m: m, get puts() { return puts; },
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) {
      if (typeof k === 'object' && k !== null) { for (const [kk, vv] of Object.entries(k)) { m.set(kk, vv); puts++; } return; }
      m.set(k, v); puts++;
    },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); },
    async deleteAll() { m.clear(); },
    async list({ prefix } = {}) { const r = new Map(); for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v); return r; },
    async getAlarm() { return null; },
    async setAlarm() {},
  };
}
const makeDO = () => {
  const storage = makeStorage();
  return { doInst: new MuseSalonDO({ storage, async blockConcurrencyWhile(fn) { return fn(); } }, {}), storage };
};

const T0 = Date.parse('2026-07-13T20:00:00Z');
const HELLO = { type: 'hello', v: 'v5.43', device: 'dev-abc123', app: 'main' };

test('stampFleet: first hello writes; identical hello within the hour does not', async () => {
  const { doInst, storage } = makeDO();
  assert.equal(await doInst.stampFleet(HELLO, T0), true);
  assert.deepEqual(await storage.get('fleet:dev-abc123:main'), { v: 'v5.43', app: 'main', lastSeen: T0 });
  assert.equal(await doInst.stampFleet(HELLO, T0 + 5 * 60000), false, 'reconnect storm must not churn storage');
  assert.equal((await storage.get('fleet:dev-abc123:main')).lastSeen, T0);
});

test('stampFleet: a version change stamps immediately; an hour elapsing stamps again', async () => {
  const { doInst, storage } = makeDO();
  await doInst.stampFleet(HELLO, T0);
  assert.equal(await doInst.stampFleet({ ...HELLO, v: 'v5.44' }, T0 + 60000), true, 'version change = the signal the bake gate needs');
  assert.equal((await storage.get('fleet:dev-abc123:main')).v, 'v5.44');
  assert.equal(await doInst.stampFleet({ ...HELLO, v: 'v5.44' }, T0 + 60000 + 3600001), true, 'hourly heartbeat keeps lastSeen honest');
});

test('stampFleet: one browser running two apps keeps BOTH visible, throttled independently', async () => {
  // The Stage-X gate needs every entry point visible per device; a single per-device
  // entry would flip-flop on alternating dashboard/reports reconnects (each one a write)
  // and hide one app entirely.
  const { doInst } = makeDO();
  assert.equal(await doInst.stampFleet({ ...HELLO, app: 'main' }, T0), true);
  assert.equal(await doInst.stampFleet({ ...HELLO, app: 'reports' }, T0 + 1000), true, 'second app = its own entry');
  assert.equal(await doInst.stampFleet({ ...HELLO, app: 'main' }, T0 + 2000), false, 'alternating apps must not defeat the throttle');
  const { devices } = await doInst.listFleet();
  assert.deepEqual(devices.map(d => d.app).sort(), ['main', 'reports']);
  assert.ok(devices.every(d => d.device === 'dev-abc123'), 'both rows carry the bare device id');
});

test('stampFleet: a legacy bare hello (no device) stamps nothing', async () => {
  const { doInst, storage } = makeDO();
  assert.equal(await doInst.stampFleet({ type: 'hello' }, T0), false);
  assert.equal((await storage.list({ prefix: 'fleet:' })).size, 0);
});

test('stampFleet: device/version/app are sanitized and bounded', async () => {
  const { doInst, storage } = makeDO();
  await doInst.stampFleet({ device: 'x'.repeat(100) + '<script>', v: 'v'.repeat(50), app: 'a:b'.repeat(20) }, T0);
  const keys = [...(await storage.list({ prefix: 'fleet:' })).keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].length <= 'fleet:'.length + 40 + 1 + 10, 'device + app bounded');
  assert.equal(keys[0].split(':').length, 3, 'app charset sanitized — exactly one key separator pair');
  const val = await storage.get(keys[0]);
  assert.ok(val.v.length <= 20 && val.app.length <= 10, 'fields bounded');
});

test('listFleet: newest-first device list; buildSnapshot never includes fleet keys', async () => {
  const { doInst } = makeDO();
  await doInst.stampFleet({ device: 'dev-old', v: 'v5.40', app: 'staff' }, T0 - 20 * 86400000);
  await doInst.stampFleet({ device: 'dev-new', v: 'v5.43', app: 'main' }, T0);
  const { devices } = await doInst.listFleet();
  assert.deepEqual(devices.map(d => d.device), ['dev-new', 'dev-old']);
  assert.equal(devices[1].v, 'v5.40');
  const snap = await doInst.buildSnapshot();
  assert.equal(JSON.stringify(snap).includes('fleet'), false, 'telemetry must not ride the state snapshot into caches/backups');
});

test('GET /state/fleet returns the device list (Worker forwards /state/* to the DO)', async () => {
  const { doInst } = makeDO();
  await doInst.stampFleet(HELLO, T0);
  const res = await doInst.fetch(new Request('https://do/state/fleet'));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.devices.length, 1);
  assert.equal(j.devices[0].device, 'dev-abc123');
});
