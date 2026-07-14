// listBackups() must PAGE through every R2 object, not just the first list() page.
// R2 .list() returns at most 1000 objects per call, in ascending KEY order — and the
// backup keys are `backups/state-<ISO>.json`, so ascending key == OLDEST first. With a
// long backup history a single non-paginated list() surfaces only the oldest snapshots,
// so "restore latest" and the Settings → Data Recovery list silently pick a STALE backup
// while hiding every recent one — the exact moment DR matters most.
// See worker.js MuseSalonDO.listBackups / restoreFromBackup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO } from '../cloudflare/worker.js';

// Map-backed DurableObjectStorage stand-in (only what the DO touches here).
function makeStorage() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) {
      if (typeof k === 'object' && k !== null) { for (const [kk, vv] of Object.entries(k)) m.set(kk, vv); return; }
      m.set(k, v);
    },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); },
    async deleteAll() { m.clear(); },
    async list({ prefix } = {}) { const r = new Map(); for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v); return r; },
    async getAlarm() { return null; },
    async setAlarm() {},
  };
}

// R2 stand-in that PAGES like the real bucket: list() returns at most `pageSize` objects
// in ascending KEY order, with { truncated, cursor } to fetch the next page.
function makePagingBucket(pageSize = 2) {
  const store = new Map();   // key -> { body, uploaded }
  return {
    _store: store,
    seed(key, body, uploaded) { store.set(key, { body, uploaded }); },
    async put(k, body) { store.set(k, { body, uploaded: new Date().toISOString() }); },
    async get(k) { const o = store.get(k); return o ? { text: async () => o.body } : null; },
    async list({ prefix, cursor } = {}) {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map(k => ({ key: k, uploaded: store.get(k).uploaded, size: store.get(k).body.length })),
        truncated,
        cursor: truncated ? String(start + pageSize) : undefined,
      };
    },
  };
}

// restoreFromBackup wraps its wipe/rebuild in state.blockConcurrencyWhile (0-pre-b).
const gatedState = (storage) => ({ storage, async blockConcurrencyWhile(fn) { return fn(); } });

test('listBackups pages through every snapshot and returns the newest first', async () => {
  const bucket = makePagingBucket(2);   // 2 per page → 5 snapshots span 3 pages
  for (let i = 1; i <= 5; i++) {
    bucket.seed(`backups/state-2026-01-0${i}T00-00-00-000Z.json`, JSON.stringify({ seq: i }), `2026-01-0${i}T00:00:00.000Z`);
  }
  const doInst = new MuseSalonDO(gatedState(makeStorage()), { PHOTOS_BUCKET: bucket });
  const { backups, count } = await doInst.listBackups();
  assert.equal(count, 5, 'must return ALL snapshots across every page, not just the first list() page');
  assert.equal(backups[0].key, 'backups/state-2026-01-05T00-00-00-000Z.json', 'backups[0] must be the NEWEST snapshot');
  assert.equal(backups[backups.length - 1].key, 'backups/state-2026-01-01T00-00-00-000Z.json', 'oldest snapshot must be last');
});

test('restoreFromBackup with no key restores the NEWEST snapshot even across list pages', async () => {
  const bucket = makePagingBucket(2);
  bucket.seed('backups/state-2026-01-01T00-00-00-000Z.json', JSON.stringify({ state: { config: { marker: 'old1' } }, seq: 1 }), '2026-01-01T00:00:00.000Z');
  bucket.seed('backups/state-2026-01-02T00-00-00-000Z.json', JSON.stringify({ state: { config: { marker: 'old2' } }, seq: 2 }), '2026-01-02T00:00:00.000Z');
  bucket.seed('backups/state-2026-01-03T00-00-00-000Z.json', JSON.stringify({ state: { config: { marker: 'newest' } }, seq: 3 }), '2026-01-03T00:00:00.000Z');
  const storage = makeStorage();
  const doInst = new MuseSalonDO(gatedState(storage), { PHOTOS_BUCKET: bucket });
  const res = await doInst.restoreFromBackup();   // no key → must pick the newest, which sits on a later page
  assert.equal(res.restored, true);
  assert.equal(await storage.get('config:marker'), 'newest', 'no-key restore must load the newest snapshot, not a stale earlier page');
});
