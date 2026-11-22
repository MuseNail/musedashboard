// A tech who has been GIVEN a customer but hasn't started shows a distinct "Assigned" state (not
// green "Available", not red "In Service"). getTechStatusColor is the one source of truth, consumed
// by the floor roster + turns board. Order: Off → On Break → In Service → Assigned → Available.
// Run: node --test-force-exit --test test/tech-status-assigned.test.js
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrate } from '../js/app/store.js';
import { getTechStatusColor } from '../js/app/features/turns.js';

const today = () => new Date().toISOString();
function seed(queue, cfg = {}) {
  hydrate({ state: { config: { turns_off: [], turns_break: [], ...cfg }, queue } });
}

test('getTechStatusColor: tech holding a WAITING customer → Assigned (not Available)', () => {
  seed([{ id: 1, status: 'waiting', checkinTime: today(), assignments: [{ serviceId: 's1', techId: 't1', status: 'waiting' }] }]);
  assert.equal(getTechStatusColor('t1').label, 'Assigned');
});

test('getTechStatusColor: idle tech (no customers) → Available', () => {
  seed([{ id: 1, status: 'waiting', checkinTime: today(), assignments: [{ serviceId: 's1', techId: 't1', status: 'waiting' }] }]);
  assert.equal(getTechStatusColor('t2').label, 'Available');
});

test('getTechStatusColor: actively working → In Service takes precedence over a second waiting line', () => {
  seed([{ id: 1, status: 'inservice', checkinTime: today(), assignments: [
    { serviceId: 's1', techId: 't1', status: 'inservice' },
    { serviceId: 's2', techId: 't1', status: 'waiting' },
  ] }]);
  assert.equal(getTechStatusColor('t1').label, 'In Service');
});

test('getTechStatusColor: On Break / Off take precedence over Assigned', () => {
  const q = [{ id: 1, status: 'waiting', checkinTime: today(), assignments: [{ serviceId: 's1', techId: 't1', status: 'waiting' }] }];
  seed(q, { turns_break: ['t1'] });
  assert.equal(getTechStatusColor('t1').label, 'On Break');
  seed(q, { turns_off: ['t1'] });
  assert.equal(getTechStatusColor('t1').label, 'Off');
});
