// Phase 2 — the pure decision behind loadCache(): given the IndexedDB blob, the legacy
// localStorage raw, and the current live seq, decide what to hydrate and whether to migrate
// the legacy copy into IDB. This is the risky part (stale-guard + one-time migration);
// the IDB round-trip + async boot are verified in the browser. See store.js _decideCacheLoad.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _decideCacheLoad } from '../js/app/store.js';

test('prefers the IndexedDB blob when present (no migration)', () => {
  const d = _decideCacheLoad({ seq: 5, records: [] }, JSON.stringify({ seq: 3 }), 0);
  assert.equal(d.hydrate, true);
  assert.equal(d.migrate, false);
  assert.equal(d.blob.seq, 5);
});

test('adopts and migrates the legacy localStorage blob when IndexedDB is empty', () => {
  const d = _decideCacheLoad(null, JSON.stringify({ seq: 4, records: [1, 2] }), 0);
  assert.equal(d.hydrate, true);
  assert.equal(d.migrate, true, 'legacy cache is migrated into IDB');
  assert.equal(d.blob.seq, 4);
});

test('prefers a newer localStorage blob over a staler IndexedDB blob (and migrates it back into IDB)', () => {
  const d = _decideCacheLoad({ seq: 3 }, JSON.stringify({ seq: 8, records: [1] }), 0);
  assert.equal(d.hydrate, true);
  assert.equal(d.migrate, true, 'the newer localStorage blob is adopted + migrated');
  assert.equal(d.blob.seq, 8);
});

test('no cache anywhere → no hydrate', () => {
  assert.equal(_decideCacheLoad(null, null, 0).hydrate, false);
});

test('invalid legacy JSON → no hydrate, no crash', () => {
  assert.equal(_decideCacheLoad(null, '{bad json', 0).hydrate, false);
});

test('never hydrates a cache whose seq is below the current live seq (stale-guard)', () => {
  assert.equal(_decideCacheLoad({ seq: 2 }, null, 10).hydrate, false, 'stale IDB blob refused');
  assert.equal(_decideCacheLoad(null, JSON.stringify({ seq: 2 }), 10).hydrate, false, 'stale legacy blob refused');
});

test('an equal-seq cache still hydrates (not below current)', () => {
  assert.equal(_decideCacheLoad({ seq: 7 }, null, 7).hydrate, true);
});
