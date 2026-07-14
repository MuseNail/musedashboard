// Stage 0 (Phase 3): salon-timezone month bucketing. The archive writer (Worker) and
// every reader (client) must bucket a sale into the SAME salon-local month or hot/cold
// stitching drifts — the no-build rule means two copies of monthOfTs exist (utils.js +
// worker.js), so this file pins them to each other and to the boundary semantics.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthOfTs, isValidTz } from '../js/app/utils.js';
import { monthOfTs as workerMonthOfTs } from '../cloudflare/worker.js';

const LA = 'America/Los_Angeles', NY = 'America/New_York';

test('monthOfTs: salon-local month, not UTC month', () => {
  // 2026-03-01 07:59 UTC = Feb 28 23:59 in LA — LA salon still books it to February.
  assert.equal(monthOfTs(Date.parse('2026-03-01T07:59:00Z'), LA), '2026-02');
  assert.equal(monthOfTs(Date.parse('2026-03-01T08:01:00Z'), LA), '2026-03');
  // The same instant is already March in New York.
  assert.equal(monthOfTs(Date.parse('2026-03-01T07:59:00Z'), NY), '2026-03');
});

test('monthOfTs: DST transitions do not shift the month', () => {
  assert.equal(monthOfTs(Date.parse('2026-03-08T10:30:00Z'), LA), '2026-03');   // spring-forward day
  assert.equal(monthOfTs(Date.parse('2026-11-01T08:30:00Z'), LA), '2026-11');   // fall-back day
});

test('monthOfTs: accepts a Date, an ISO string, and epoch ms', () => {
  const iso = '2026-07-13T20:00:00Z';
  assert.equal(monthOfTs(iso, LA), '2026-07');
  assert.equal(monthOfTs(new Date(iso), LA), '2026-07');
  assert.equal(monthOfTs(Date.parse(iso), LA), '2026-07');
});

test('monthOfTs: client and worker copies agree on every boundary fixture', () => {
  const fixtures = [
    ['2026-03-01T07:59:00Z', LA], ['2026-03-01T08:01:00Z', LA],
    ['2026-01-01T00:00:00Z', LA], ['2025-12-31T23:59:00Z', NY],
    ['2026-03-08T10:30:00Z', LA], ['2026-11-01T08:30:00Z', LA],
    ['2026-06-15T12:00:00Z', 'Pacific/Honolulu'],
  ];
  for (const [iso, tz] of fixtures) {
    assert.equal(monthOfTs(Date.parse(iso), tz), workerMonthOfTs(Date.parse(iso), tz), `${iso} @ ${tz}`);
  }
});

test('isValidTz: real IANA zones pass, garbage does not', () => {
  assert.equal(isValidTz('America/Los_Angeles'), true);
  assert.equal(isValidTz('Pacific/Honolulu'), true);
  assert.equal(isValidTz('Not/AZone'), false);
  assert.equal(isValidTz(''), false);
  assert.equal(isValidTz(null), false);
});
