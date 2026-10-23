// Pure helpers behind two Wave-1 quick wins:
//   _clampTechColW (turns.js) — the resizable tech-column width clamp.
//   _visitLines (reports.js) — the per-service→tech mapping for customer visit history.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _clampTechColW } from '../js/app/features/turns.js';
import { _visitLines } from '../js/app/features/reports.js';

// ── _clampTechColW(px) — min 120, max 280, default 155 ──
test('_clampTechColW clamps below the minimum', () => {
  assert.equal(_clampTechColW(50), 120);
});
test('_clampTechColW clamps above the maximum', () => {
  assert.equal(_clampTechColW(999), 280);
});
test('_clampTechColW passes a value in range (rounded)', () => {
  assert.equal(_clampTechColW(200.6), 201);
});
test('_clampTechColW falls back to the default on a non-number', () => {
  assert.equal(_clampTechColW('abc'), 155);
});

// ── _visitLines(assignments, services, svcLabel, techName, chargeOf) ──
// Item 3: each line now additively carries `charge` (via injected chargeOf) + `comped`.
const svcLabel = id => ({ s1: 'Gel Mani', s2: 'Pedi' }[id]);
const techName = id => ({ t1: 'Jane', t2: 'Bob' }[id]);

test('_visitLines maps each assignment to its service + tech (+ charge/comped fields)', () => {
  const lines = _visitLines([{ serviceId: 's1', techId: 't1' }, { serviceId: 's2', techId: 't2' }], ['s1', 's2'], svcLabel, techName);
  assert.deepEqual(lines, [
    { service: 'Gel Mani', tech: 'Jane', charge: null, comped: false },
    { service: 'Pedi', tech: 'Bob', charge: null, comped: false },
  ]);
});
test('_visitLines surfaces the per-service charge + comped flag when chargeOf is injected', () => {
  const chargeOf = a => (a.comped ? 0 : a.cost || 0);
  const lines = _visitLines([{ serviceId: 's1', techId: 't1', cost: 30 }, { serviceId: 's2', techId: 't2', cost: 40, comped: true }], ['s1', 's2'], svcLabel, techName, chargeOf);
  assert.deepEqual(lines, [
    { service: 'Gel Mani', tech: 'Jane', charge: 30, comped: false },
    { service: 'Pedi', tech: 'Bob', charge: 0, comped: true },
  ]);
});
test('_visitLines drops blank catch-all assignments (no serviceId and no techId)', () => {
  const lines = _visitLines([{ serviceId: '', techId: '' }, { serviceId: 's1', techId: 't1' }], ['s1'], svcLabel, techName);
  assert.deepEqual(lines, [{ service: 'Gel Mani', tech: 'Jane', charge: null, comped: false }]);
});
test('_visitLines falls back to the service list when there are no assignments', () => {
  const lines = _visitLines([], ['s1', 's2'], svcLabel, techName);
  assert.deepEqual(lines, [{ service: 'Gel Mani', tech: '', charge: null, comped: false }, { service: 'Pedi', tech: '', charge: null, comped: false }]);
});
test('_visitLines appends a ticket service that has no assignment row (parity, never dropped)', () => {
  const lines = _visitLines([{ serviceId: 's1', techId: 't1' }], ['s1', 's2'], svcLabel, techName);
  assert.deepEqual(lines, [{ service: 'Gel Mani', tech: 'Jane', charge: null, comped: false }, { service: 'Pedi', tech: '', charge: null, comped: false }]);
});
test('_visitLines tolerates an unknown tech/service id (blank, not a crash)', () => {
  const lines = _visitLines([{ serviceId: 'sX', techId: 'tX' }], [], svcLabel, techName);
  assert.deepEqual(lines, [{ service: 'sX', tech: '', charge: null, comped: false }]);
});
