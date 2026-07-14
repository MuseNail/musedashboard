// Stage 0 (Phase 3) client pieces: which app a device reports itself as (the hello's
// `app` field — the Stage-X bake gate needs ALL THREE entry points visible), and the
// Diagnostics fleet-table shaping (stale/behind flags the owner reads before a roll-off).
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { appKindFromPath } from '../js/app/sync.js';
import { fleetRows, fleetLatest } from '../js/app/features/diagnostics.js';

test('appKindFromPath: maps each entry point, defaults to main', () => {
  assert.equal(appKindFromPath('/index.html'), 'main');
  assert.equal(appKindFromPath('/'), 'main');
  assert.equal(appKindFromPath('/musedashboard/'), 'main');
  assert.equal(appKindFromPath('/staff.html'), 'staff');
  assert.equal(appKindFromPath('/musedashboard/staff.html'), 'staff');
  assert.equal(appKindFromPath('/STAFF.HTML'), 'staff');
  assert.equal(appKindFromPath('/reports.html'), 'reports');
  assert.equal(appKindFromPath('/musedashboard/reports.html'), 'reports');
  assert.equal(appKindFromPath(''), 'main');
  assert.equal(appKindFromPath(undefined), 'main');
});

const T0 = Date.parse('2026-07-13T20:00:00Z');
const D = 86400000;

test('fleetRows: newest first, flags behind-version and stale (≥14d) devices', () => {
  const rows = fleetRows([
    { device: 'dev-old', v: 'v5.40', app: 'staff', lastSeen: T0 - 20 * D },
    { device: 'dev-new', v: 'v5.43', app: 'main', lastSeen: T0 - 1 * D },
  ], 'v5.43', T0);
  assert.deepEqual(rows.map(r => r.device), ['dev-new', 'dev-old']);
  assert.equal(rows[0].current, true);
  assert.equal(rows[0].stale, false);
  assert.equal(rows[1].current, false, 'a device on an older build must be flagged');
  assert.equal(rows[1].stale, true, '≥14 days unseen = stale (the roll-off gate horizon)');
  assert.equal(rows[1].staleDays, 20);
});

test('fleetRows: tolerates missing fields without throwing', () => {
  const rows = fleetRows([{ device: 'dev-x' }], 'v5.43', T0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current, false);
  assert.equal(rows[0].staleDays, null);
  assert.equal(fleetRows(null, 'v5.43', T0).length, 0);
});

test('fleetRows: "behind" compares against the NEWEST build seen, not the viewing device', () => {
  // A viewer on a stale build must not paint every newer device amber (inverted labels).
  const rows = fleetRows([{ device: 'dev-fresh', v: 'v5.43', app: 'main', lastSeen: T0 }], 'v5.40', T0);
  assert.equal(rows[0].current, true, 'the newest device is current even when the viewer is behind');
  assert.equal(fleetLatest([{ v: 'v5.43' }], 'v5.40'), 'v5.43');
  assert.equal(fleetLatest([], 'v5.40'), 'v5.40');
  assert.equal(fleetLatest([{ v: 'garbage' }], 'v5.40'), 'v5.40', 'unparseable versions never win');
});
