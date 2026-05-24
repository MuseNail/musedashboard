import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { staffByPin, myActiveAssignments } from '../js/app/staff.js';

// staffByPin: which tech a PIN logs in as (used by the staff app login).
test('staffByPin matches an active tech by exact PIN', () => {
  const staff = [{ id: 'a', name: 'Amy', pin: '1111' }, { id: 'b', name: 'Bo', pin: '2222' }];
  assert.equal(staffByPin(staff, [], '2222').id, 'b');
  assert.equal(staffByPin(staff, [], '1111').id, 'a');
});

test('staffByPin tolerates numeric vs string PINs', () => {
  const staff = [{ id: 'a', name: 'Amy', pin: 1234 }];
  assert.equal(staffByPin(staff, [], '1234').id, 'a');
});

test('staffByPin returns null for wrong / blank PIN', () => {
  const staff = [{ id: 'a', name: 'Amy', pin: '1111' }];
  assert.equal(staffByPin(staff, [], '9999'), null);
  assert.equal(staffByPin(staff, [], ''), null);
  assert.equal(staffByPin(staff, [], null), null);
  assert.equal(staffByPin([], [], '1111'), null);
});

test('staffByPin excludes inactive techs and techs with no PIN', () => {
  const staff = [{ id: 'a', name: 'Amy', pin: '1111' }, { id: 'b', name: 'Bo' }];
  assert.equal(staffByPin(staff, ['a'], '1111'), null);   // inactive
  assert.equal(staffByPin(staff, [], ''), null);          // Bo has no pin, blank query
});

// myActiveAssignments: the tech's own service lines from the live queue.
const queue = [
  { id: 1, name: 'Cust1', status: 'inservice', assignments: [
    { serviceId: 's1', techId: 'a', status: 'inservice' },
    { serviceId: 's2', techId: 'b', status: 'waiting' },
  ]},
  { id: 2, name: 'Cust2', status: 'waiting', assignments: [
    { serviceId: 's3', techId: 'a', status: 'waiting' },
  ]},
  { id: 3, name: 'Cust3', status: 'paid', assignments: [   // paid → excluded
    { serviceId: 's4', techId: 'a', status: 'paid' },
  ]},
  { id: 4, name: 'Cust4', status: 'waiting', assignments: [
    { serviceId: 's5', techId: '', status: 'waiting' },    // unassigned → excluded
  ]},
];

test('myActiveAssignments returns only this tech\'s lines on active entries', () => {
  const mine = myActiveAssignments(queue, 'a');
  assert.equal(mine.length, 2);                               // Cust1/s1 + Cust2/s3 (paid + unassigned excluded)
  assert.deepEqual(mine.map(x => x.assignment.serviceId).sort(), ['s1', 's3']);
  assert.deepEqual(mine.map(x => x.entry.id).sort(), [1, 2]);
});

test('myActiveAssignments for another tech only sees their own active line', () => {
  const mine = myActiveAssignments(queue, 'b');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].assignment.serviceId, 's2');
});

test('myActiveAssignments handles empty / missing input', () => {
  assert.deepEqual(myActiveAssignments([], 'a'), []);
  assert.deepEqual(myActiveAssignments(queue, ''), []);
  assert.deepEqual(myActiveAssignments(undefined, 'a'), []);
});
