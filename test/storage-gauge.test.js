// Phase 0 storage gauge — the pure compute behind Settings → Diagnostics → On-device
// storage. It reports the device cache size vs. the ceiling, a per-slice breakdown, and
// a runway projection derived from the oldest record's age (records dominate growth).
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStorageStats } from '../js/app/features/diagnostics.js';

const MB = n => n * 1024 * 1024;
const MONTH_MS = 30.44 * 86400000;

test('computeStorageStats builds a per-slice breakdown, sorted largest first, with counts', () => {
  const state = { records: [{ id: 1 }, { id: 2 }], customers: [{ id: 'c1' }], config: { a: 'x' } };
  const s = computeStorageStats(state, 1000, 1.7e12, MB(5));
  const rec = s.slices.find(x => x.key === 'records');
  assert.equal(rec.count, 2, 'array slices report a count');
  assert.ok(rec.bytes > 0);
  for (let i = 1; i < s.slices.length; i++) assert.ok(s.slices[i - 1].bytes >= s.slices[i].bytes, 'sorted desc by bytes');
});

test('computeStorageStats reports pctUsed against the ceiling', () => {
  const s = computeStorageStats({ records: [] }, MB(2), 1.7e12, MB(5));
  assert.ok(Math.abs(s.pctUsed - 0.4) < 1e-9);
});

test('computeStorageStats projects runway from the oldest record age (conservative all-in rate)', () => {
  const now = 1.7e12;
  const records = [];
  for (let i = 0; i < 100; i++) records.push({ id: i, checkinTime: now - 6 * MONTH_MS + i, blob: 'x'.repeat(50) });
  const cache = MB(2);
  const s = computeStorageStats({ records }, cache, now, MB(5));
  assert.ok(s.ageMonths > 5.9 && s.ageMonths < 6.1, 'age ~6 months from oldest record');
  const expectedGrowth = cache / s.ageMonths;   // whole-cache / age (conservative, not records-only)
  assert.ok(Math.abs(s.growthPerMonth - expectedGrowth) < 1, 'growth = cacheBytes / ageMonths');
  assert.ok(Math.abs(s.monthsToCeiling - (MB(5) - cache) / expectedGrowth) < 0.5, 'months-to-ceiling from growth');
});

test('computeStorageStats will not project with under half a month of history', () => {
  const now = 1.7e12;
  const records = [{ id: 1, checkinTime: now - 10 * 86400000, blob: 'x'.repeat(500) }, { id: 2, checkinTime: now - 2 * 86400000, blob: 'x'.repeat(500) }];
  const s = computeStorageStats({ records }, MB(2), now, MB(5));
  assert.equal(s.growthPerMonth, null, 'span < 0.5 month → no projection');
  assert.equal(s.monthsToCeiling, null);
});

test('computeStorageStats ignores future-dated records and never divides by a zero ceiling', () => {
  const now = 1.7e12;
  const records = [{ id: 1, checkinTime: now + 5 * 86400000, blob: 'x' }, { id: 2, checkinTime: now + 6 * 86400000, blob: 'x' }];
  const s = computeStorageStats({ records }, MB(2), now, 0);
  assert.equal(s.pctUsed, 0, 'ceiling 0 → pctUsed 0, no divide-by-zero');
  assert.equal(s.monthsToCeiling, null, 'all records future-dated → no usable age → no projection');
});

test('computeStorageStats cannot project with too little history', () => {
  const now = 1.7e12;
  const s = computeStorageStats({ records: [{ id: 1, checkinTime: now - 5 * 86400000, blob: 'x'.repeat(500) }] }, MB(2), now, MB(5));
  assert.equal(s.growthPerMonth, null);
  assert.equal(s.monthsToCeiling, null);
});

test('computeStorageStats clamps months-to-ceiling at 0 when already over the ceiling', () => {
  const now = 1.7e12;
  const records = [];
  for (let i = 0; i < 100; i++) records.push({ id: i, checkinTime: now - 6 * MONTH_MS + i, blob: 'x'.repeat(50) });
  const s = computeStorageStats({ records }, MB(6), now, MB(5));
  assert.equal(s.monthsToCeiling, 0);
  assert.ok(s.pctUsed > 1);
});
