// Pure cores behind the inline Services/Items editor (Item 1):
//  mergeCatalogRow     — Save merges ONE row into the LIVE array (never a stale whole-array snapshot),
//                        so a concurrent edit to a DIFFERENT row on another device isn't clobbered.
//  validateServiceFields — required name/abbr + dup-name (extracted from the old modal saveService).
//  catalogRowDirty     — whether a row's draft differs from what's stored (drives the Save button).
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalogRow, validateServiceFields, catalogRowDirty } from '../js/app/features/catalog.js';

// ── mergeCatalogRow(arr, id, fields) ──
test('mergeCatalogRow updates only the matching row, leaving a concurrently-added row intact', () => {
  const live = [{ id: 'a', label: 'A', abbr: 'A' }, { id: 'b', label: 'B', abbr: 'B' }];
  const next = mergeCatalogRow(live, 'a', { label: 'A2', abbr: 'A' });
  assert.deepEqual(next, [{ id: 'a', label: 'A2', abbr: 'A' }, { id: 'b', label: 'B', abbr: 'B' }]);
});
test('mergeCatalogRow appends when the id is not present (new row)', () => {
  const next = mergeCatalogRow([{ id: 'a', label: 'A' }], 'new1', { label: 'N', abbr: 'N' });
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { id: 'new1', label: 'N', abbr: 'N' });
});
test('mergeCatalogRow is immutable (does not mutate the input array or rows)', () => {
  const live = [{ id: 'a', label: 'A' }];
  const next = mergeCatalogRow(live, 'a', { label: 'Z' });
  assert.equal(live[0].label, 'A');     // original untouched
  assert.notEqual(next, live);
  assert.notEqual(next[0], live[0]);
});
test('mergeCatalogRow tolerates a non-array', () => {
  assert.deepEqual(mergeCatalogRow(undefined, 'x', { label: 'X' }), [{ id: 'x', label: 'X' }]);
});

// ── validateServiceFields(fields, services, id) ──
test('validateServiceFields requires a name', () => {
  assert.match(validateServiceFields({ label: '', abbr: 'P' }, [], null), /name/i);
});
test('validateServiceFields requires an abbreviation', () => {
  assert.match(validateServiceFields({ label: 'Pedi', abbr: '' }, [], null), /abbrevi/i);
});
test('validateServiceFields rejects a duplicate name (other row)', () => {
  const svcs = [{ id: 'a', label: 'Pedicure', abbr: 'P' }];
  assert.match(validateServiceFields({ label: 'pedicure', abbr: 'PD' }, svcs, 'b'), /already exists/i);
});
test('validateServiceFields allows the same name on the SAME row (editing itself)', () => {
  const svcs = [{ id: 'a', label: 'Pedicure', abbr: 'P' }];
  assert.equal(validateServiceFields({ label: 'Pedicure', abbr: 'P' }, svcs, 'a'), null);
});

// ── catalogRowDirty(kind, draft, storedRow) ──
test('catalogRowDirty: a new (unsaved) row is always dirty', () => {
  assert.equal(catalogRowDirty('service', { label: '', abbr: '' }, null), true);
});
test('catalogRowDirty: service unchanged draft is clean (incl. missing desc vs empty desc)', () => {
  const row = { id: 'a', label: 'Pedi', abbr: 'P', baseCost: 30 };
  assert.equal(catalogRowDirty('service', { label: 'Pedi', abbr: 'P', baseCost: 30, desc: '' }, row), false);
});
test('catalogRowDirty: service detects a changed field (desc added)', () => {
  const row = { id: 'a', label: 'Pedi', abbr: 'P', baseCost: 30 };
  assert.equal(catalogRowDirty('service', { label: 'Pedi', abbr: 'P', baseCost: 30, desc: 'Relaxing' }, row), true);
});
test('catalogRowDirty: item price compared numerically (30 vs "30" is clean)', () => {
  const row = { id: 'i', label: 'Polish', abbr: 'PO', price: 30 };
  assert.equal(catalogRowDirty('item', { label: 'Polish', abbr: 'PO', price: '30' }, row), false);
});
