import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionStaff, normalizeSsn4, maskSsn } from '../js/app/utils.js';

test('partitionStaff splits by inactive ids, preserving order', () => {
  const staff = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const r = partitionStaff(staff, ['b']);
  assert.deepEqual(r.active.map(s => s.id), ['a', 'c']);
  assert.deepEqual(r.inactive.map(s => s.id), ['b']);
  assert.deepEqual(partitionStaff([], []), { active: [], inactive: [] });
  assert.deepEqual(partitionStaff(null, null), { active: [], inactive: [] });
});

test('normalizeSsn4 keeps only the last 4 digits', () => {
  assert.equal(normalizeSsn4('123-45-6789'), '6789');
  assert.equal(normalizeSsn4('6789'), '6789');
  assert.equal(normalizeSsn4('12'), '12');
  assert.equal(normalizeSsn4(''), '');
  assert.equal(normalizeSsn4(null), '');
});

test('maskSsn masks last-4, blank when empty', () => {
  assert.equal(maskSsn('6789'), '•••-••-6789');
  assert.equal(maskSsn(''), '');
});
