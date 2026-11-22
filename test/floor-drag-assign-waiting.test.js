// Floor-plan drag-assign no longer auto-starts the service. seatTechWaiting seats a tech on one of
// the customer's services WITHOUT flipping it to In Service: a brand-new line is created 'waiting';
// an existing line KEEPS its own status (never downgrade a started/finished line). It stamps
// assignedAt (seat-time ordering) + updatedAt (§14 per-assignment merge) and never sets svcStartedAt.
// Run: node --test-force-exit --test test/floor-drag-assign-waiting.test.js
import './setup-globals.js';   // floorplan.js has top-level document listeners — load the DOM shim first
import test from 'node:test';
import assert from 'node:assert/strict';
import { seatTechWaiting } from '../js/app/features/floorplan.js';
import { deriveEntryStatus } from '../js/app/features/status.js';

test('seatTechWaiting: new (un-created) line → pushed as waiting, teched, seated, stamped, NOT started', () => {
  const e = { assignments: [] };
  const a = seatTechWaiting(e, 't1', 'S3', { serviceId: 'svc_gel', assignment: null });
  assert.equal(e.assignments.length, 1);
  assert.equal(a.status, 'waiting');
  assert.equal(a.techId, 't1');
  assert.equal(a.station, 'S3');
  assert.equal(a.serviceId, 'svc_gel');
  assert.equal(typeof a.assignedAt, 'number');
  assert.equal(typeof a.updatedAt, 'number');
  assert.equal(a.svcStartedAt, undefined);   // the whole point — the clock has NOT started
});

test('seatTechWaiting: existing waiting line → teched + seated + stamped, status stays waiting, cost/comped kept', () => {
  const a0 = { serviceId: 'svc_pedi', techId: '', station: '', status: 'waiting', cost: 42, comped: true };
  const e = { assignments: [a0] };
  const a = seatTechWaiting(e, 't2', 'S5', { serviceId: 'svc_pedi', assignment: a0 });
  assert.equal(e.assignments.length, 1);   // reused, not duplicated
  assert.equal(a.status, 'waiting');
  assert.equal(a.techId, 't2');
  assert.equal(a.station, 'S5');
  assert.equal(a.cost, 42);
  assert.equal(a.comped, true);
  assert.equal(typeof a.updatedAt, 'number');
  assert.equal(a.svcStartedAt, undefined);
});

test('seatTechWaiting: NEVER starts the service (regression on the old auto-flip)', () => {
  const e = { assignments: [] };
  const a = seatTechWaiting(e, 't1', 'S1', { serviceId: 'svc_gel', assignment: null });
  assert.notEqual(a.status, 'inservice');
});

test('seatTechWaiting: an already-started/finished un-teched line is NOT downgraded to waiting', () => {
  // Reachable edge: clearing the tech dropdown in Assign & Price leaves {techId:'', status:'complete'}.
  const a0 = { serviceId: 'svc_gel', techId: '', station: 'S1', status: 'complete', svcStartedAt: 111, serviceMs: 999 };
  const e = { assignments: [a0] };
  const a = seatTechWaiting(e, 't1', 'S1', { serviceId: 'svc_gel', assignment: a0 });
  assert.equal(a.status, 'complete');        // preserved, not reverted
  assert.equal(a.svcStartedAt, 111);         // timing untouched
  assert.equal(a.serviceMs, 999);
  assert.equal(a.techId, 't1');
});

test('seatTechWaiting: single-service entry → whole entry derives Waiting', () => {
  const e = { assignments: [] };
  seatTechWaiting(e, 't1', 'S1', { serviceId: 'svc_gel', assignment: null });
  assert.equal(deriveEntryStatus(e), 'waiting');
});

test('seatTechWaiting: mixed party — seating a 2nd tech on a waiting line leaves a running line + entry In Service', () => {
  const live = { serviceId: 'svc_gel', techId: 't1', station: 'S1', status: 'inservice', svcStartedAt: 222 };
  const e = { assignments: [live] };
  seatTechWaiting(e, 't2', 'S2', { serviceId: 'svc_pedi', assignment: null });
  assert.equal(live.status, 'inservice');    // the running service is untouched
  assert.equal(live.svcStartedAt, 222);
  assert.equal(deriveEntryStatus(e), 'inservice');   // any in-service line keeps the entry In Service
  assert.equal(e.assignments.find(x => x.serviceId === 'svc_pedi').status, 'waiting');
});
