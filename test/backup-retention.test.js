// Phase 1 backup retention — the pure keep-set computation behind the tiered
// (grandfather-father-son) prune: 6-hourly for 1 week, daily for 1 month, monthly for
// 1 year, yearly for 7 years; plus a hard floor (always keep the newest few) and an
// exemption for DR "safety" snapshots. See worker.js computeBackupKeepSet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBackupKeepSet, MuseSalonDO } from '../cloudflare/worker.js';

const DAY = 86400000;
const iso = t => new Date(t).toISOString();
const stateKey = t => ({ key: 'backups/state-' + iso(t).replace(/[:.]/g, '-') + '.json', uploaded: iso(t) });

test('keeps every 6-hourly point within the last week', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  const backups = [];
  for (let d = 0; d < 12; d++) for (const h of [0, 6, 12, 18]) backups.push(stateKey(now - d * DAY - h * 3600000));
  const { keep } = computeBackupKeepSet(backups, now);
  for (const b of backups) if (Date.parse(b.uploaded) >= now - 7 * DAY) assert.ok(keep.has(b.key), 'every point in the last 7 days is kept');
});

test('beyond a week keeps only the newest snapshot per day (for a month)', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  const recent = [];                                   // 12 recent daily points so the newest-8 floor is satisfied by them
  for (let d = 0; d < 12; d++) recent.push(stateKey(now - d * DAY - 12 * 3600000));
  const dayTs = now - 15 * DAY;                        // a day ~2 weeks back (past the 6h tier, inside the daily tier, past the floor)
  const early = stateKey(dayTs + 2 * 3600000);         // 02:00
  const late = stateKey(dayTs + 20 * 3600000);         // 20:00 — the end-of-day representative
  const { keep } = computeBackupKeepSet([...recent, early, late], now);
  assert.ok(keep.has(late.key), 'newest-in-day kept');
  assert.ok(!keep.has(early.key), 'older same-day dropped');
});

test('keeps the newest per month across a year, and per year across 7 years', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  const backups = [];
  // one snapshot mid-each-month back 18 months + one per year back 9 years
  for (let m = 1; m <= 18; m++) backups.push(stateKey(now - m * 30 * DAY));
  for (let y = 1; y <= 9; y++) backups.push(stateKey(now - y * 365 * DAY));
  const { keep, del } = computeBackupKeepSet(backups, now);
  // months within the last ~12mo: at least several kept; anything past 7 years: dropped
  const oldest = stateKey(now - 9 * 365 * DAY);
  assert.ok(del.includes(oldest.key), 'a 9-year-old snapshot is pruned (past the 7-year tier)');
  // total kept is bounded and far below the input
  assert.ok(keep.size <= 80, 'keep-set is bounded (~70), got ' + keep.size);
});

test('always keeps the newest few as a hard floor even if bucketing would drop them', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  // many snapshots in a single hour long ago — bucketing would keep only 1, floor keeps newest 8 overall
  const backups = [];
  for (let i = 0; i < 20; i++) backups.push(stateKey(now - 1000 * DAY + i * 60000));   // ~2.7y ago, 1/min
  const { keep } = computeBackupKeepSet(backups, now);
  const newest8 = backups.slice().sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded)).slice(0, 8);
  for (const b of newest8) assert.ok(keep.has(b.key), 'newest 8 always kept');
});

test('exempts DR safety snapshots from pruning (keeps the newest few)', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  const backups = [];
  for (let d = 0; d < 40; d++) for (const h of [0, 12]) backups.push(stateKey(now - d * DAY - h * 3600000));
  // a safety snapshot dropped mid-day, 20 days ago — would normally be pruned (not end-of-day)
  const safetyTs = now - 20 * DAY - 9 * 3600000;
  const safety = { key: 'backups/safety-' + iso(safetyTs).replace(/[:.]/g, '-') + '.json', uploaded: iso(safetyTs) };
  const { keep } = computeBackupKeepSet([...backups, safety], now);
  assert.ok(keep.has(safety.key), 'a recent safety snapshot is never pruned');
});

test('one-time cleanup: ~4 months of 6h backups reduces to a small bounded set', () => {
  const now = Date.parse('2026-07-13T00:00:00.000Z');
  const backups = [];
  for (let d = 0; d < 135; d++) for (const h of [0, 6, 12, 18]) backups.push(stateKey(now - d * DAY - h * 3600000));
  assert.equal(backups.length, 540);
  const { keep, del } = computeBackupKeepSet(backups, now);
  assert.ok(keep.size >= 40 && keep.size <= 80, 'keep ~50-70, got ' + keep.size);
  assert.equal(keep.size + del.length, 540, 'every backup is either kept or deleted, none lost');
  // the newest is always kept
  const newest = backups.slice().sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded))[0];
  assert.ok(keep.has(newest.key));
});

// ── Integration: pruneBackups (gated + prefix-guarded) ───────────────────────
function makeStorage() {
  const m = new Map();
  return { async get(k){return m.has(k)?m.get(k):undefined;}, async put(k,v){m.set(k,v);}, async delete(k){if(Array.isArray(k))k.forEach(x=>m.delete(x));else m.delete(k);}, async deleteAll(){m.clear();}, async list(){return new Map();}, async getAlarm(){return null;}, async setAlarm(){} };
}
function makeBucket() {
  const store = new Map();   // key -> { body, uploaded }
  return {
    _store: store,
    seed(key, uploaded) { store.set(key, { body: '{}', uploaded }); },
    async put(k, body) { store.set(k, { body: String(body), uploaded: new Date().toISOString() }); },
    async get(k) { const o = store.get(k); return o ? { text: async () => o.body } : null; },
    async list({ prefix } = {}) { const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)); return { objects: keys.map(k => ({ key: k, uploaded: store.get(k).uploaded, size: store.get(k).body.length })), truncated: false }; },
    async delete(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => store.delete(k)); },
  };
}
function seedYearOfBackups(bucket, now, days) {
  for (let d = 0; d < days; d++) for (const h of [0, 6, 12, 18]) { const t = now - d * DAY - h * 3600000; bucket.seed('backups/state-' + iso(t).replace(/[:.]/g, '-') + '.json', iso(t)); }
}

test('pruneBackups in log-only mode (default) deletes nothing but reports what it would prune', async () => {
  const bucket = makeBucket(); const now = Date.now();
  seedYearOfBackups(bucket, now, 200);
  const before = bucket._store.size;
  const doInst = new MuseSalonDO({ storage: makeStorage() }, { PHOTOS_BUCKET: bucket });   // BACKUP_RETENTION unset
  const res = await doInst.pruneBackups();
  assert.equal(res.live, false, 'not live by default');
  assert.ok(res.wouldPrune > 100, 'reports a large would-prune count');
  assert.equal(res.pruned, 0);
  assert.equal(bucket._store.size, before, 'log-only deletes nothing');
});

test('pruneBackups live mode prunes orphans but keeps the newest points and safety snapshots', async () => {
  const bucket = makeBucket(); const now = Date.now();
  seedYearOfBackups(bucket, now, 200);
  const safetyTs = now - 40 * DAY - 7 * 3600000;   // a mid-day safety snapshot 40 days back
  const safetyKey = 'backups/safety-' + iso(safetyTs).replace(/[:.]/g, '-') + '.json';
  bucket.seed(safetyKey, iso(safetyTs));
  const newestKey = 'backups/state-' + iso(now).replace(/[:.]/g, '-') + '.json';
  const doInst = new MuseSalonDO({ storage: makeStorage() }, { PHOTOS_BUCKET: bucket, BACKUP_RETENTION: 'on' });
  const res = await doInst.pruneBackups();
  assert.equal(res.live, true);
  assert.ok(res.pruned > 100, 'prunes a lot of old points');
  assert.ok(bucket._store.has(safetyKey), 'safety snapshot survives the prune');
  assert.ok(bucket._store.has(newestKey), 'the newest snapshot survives');
  assert.ok(bucket._store.size <= 80, 'reduced to a bounded ~70, got ' + bucket._store.size);
});
