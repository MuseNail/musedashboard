import test from 'node:test';
import assert from 'node:assert/strict';
import { departedFromConfigSet, pushPrefixesForDeparted, sessionIsDeparted } from '../cloudflare/worker.js';

// ── departedFromConfigSet ──────────────────────────────────────────────────────
// Given a config.set write, return which tech/FD ids just DEPARTED (so their push
// subscriptions + sessions should be purged and their live socket closed).

test('inactive_staff: a newly-added id is a departed tech', () => {
  const r = departedFromConfigSet('inactive_staff', [], ['t1']);
  assert.deepEqual(r, { techIds: ['t1'], fdIds: [] });
});

test('inactive_staff: only the NEWLY-added id departs (not the ones already inactive)', () => {
  const r = departedFromConfigSet('inactive_staff', ['t1'], ['t1', 't2']);
  assert.deepEqual(r, { techIds: ['t2'], fdIds: [] });
});

test('inactive_staff: reactivation (id removed from the list) departs no one', () => {
  const r = departedFromConfigSet('inactive_staff', ['t1'], []);
  assert.deepEqual(r, { techIds: [], fdIds: [] });
});

test('inactive_staff: deactivate-all flags every newly-inactive tech', () => {
  const r = departedFromConfigSet('inactive_staff', [], ['t1', 't2', 't3']);
  assert.deepEqual(r, { techIds: ['t1', 't2', 't3'], fdIds: [] });
});

test('staff: a deleted tech (present before, gone after) departs', () => {
  const r = departedFromConfigSet('staff', [{ id: 't1' }, { id: 't2' }], [{ id: 't1' }]);
  assert.deepEqual(r, { techIds: ['t2'], fdIds: [] });
});

test('staff: a rename/edit with no removal departs no one', () => {
  const r = departedFromConfigSet('staff', [{ id: 't1', name: 'Al' }], [{ id: 't1', name: 'Alex' }]);
  assert.deepEqual(r, { techIds: [], fdIds: [] });
});

test('fd_users: a deleted front-desk user departs', () => {
  const r = departedFromConfigSet('fd_users', [{ id: 'f1' }, { id: 'f2' }], [{ id: 'f1' }]);
  assert.deepEqual(r, { techIds: [], fdIds: ['f2'] });
});

test('an unrelated config key departs no one', () => {
  const r = departedFromConfigSet('turns_order', ['t1'], []);
  assert.deepEqual(r, { techIds: [], fdIds: [] });
});

test('missing / non-array old or new values never throw and depart no one', () => {
  assert.deepEqual(departedFromConfigSet('staff', undefined, [{ id: 't1' }]), { techIds: [], fdIds: [] });
  assert.deepEqual(departedFromConfigSet('staff', [{ id: 't1' }], undefined), { techIds: [], fdIds: [] });
  assert.deepEqual(departedFromConfigSet('staff', null, null), { techIds: [], fdIds: [] });
  assert.deepEqual(departedFromConfigSet('inactive_staff', 'nope', 5), { techIds: [], fdIds: [] });
});

test('ids are coerced to strings (numeric id in old staff, string elsewhere)', () => {
  const r = departedFromConfigSet('staff', [{ id: 7 }, { id: 't2' }], [{ id: 't2' }]);
  assert.deepEqual(r, { techIds: ['7'], fdIds: [] });
});

// ── pushPrefixesForDeparted ─────────────────────────────────────────────────────
// A tech is reachable under BOTH the raw id (assignment/price alerts) and 'tech:<id>'
// (chat); a front-desk user under 'fd:<id>'. The trailing ':' prevents a prefix for
// id 't1' from also matching 't10'.

test('a departed tech yields both the raw-id and tech: prefixes', () => {
  assert.deepEqual(pushPrefixesForDeparted(['t2'], []), ['push:t2:', 'push:tech:t2:']);
});

test('a departed FD user yields the fd: prefix', () => {
  assert.deepEqual(pushPrefixesForDeparted([], ['f2']), ['push:fd:f2:']);
});

test('techs and FD users combine; ids are stringified', () => {
  assert.deepEqual(pushPrefixesForDeparted([7], ['f1']), ['push:7:', 'push:tech:7:', 'push:fd:f1:']);
});

test('no departures yields no prefixes', () => {
  assert.deepEqual(pushPrefixesForDeparted([], []), []);
});

// ── sessionIsDeparted ────────────────────────────────────────────────────────────
// Used for BOTH deleting sess: tokens and matching an open socket's tagged identity.

test('a tech session whose id is in the departed tech set is departed', () => {
  assert.equal(sessionIsDeparted({ kind: 'tech', id: 't2' }, new Set(['t2']), new Set()), true);
});

test('an FD session whose id is in the departed fd set is departed', () => {
  assert.equal(sessionIsDeparted({ kind: 'fd', id: 'f2' }, new Set(), new Set(['f2'])), true);
});

test('a session not in either departed set is NOT departed', () => {
  assert.equal(sessionIsDeparted({ kind: 'tech', id: 't9' }, new Set(['t2']), new Set(['f2'])), false);
});

test('the fallback Manager session is never departed', () => {
  assert.equal(sessionIsDeparted({ kind: 'fd', id: 'fallback' }, new Set(), new Set(['fallback'])), false);
});

test('a null / fieldless session is never departed and never throws', () => {
  assert.equal(sessionIsDeparted(null, new Set(['t2']), new Set()), false);
  assert.equal(sessionIsDeparted({}, new Set(['t2']), new Set()), false);
});

test('a numeric session id matches a stringified departed set', () => {
  assert.equal(sessionIsDeparted({ kind: 'tech', id: 7 }, new Set(['7']), new Set()), true);
});

test('a tech id is not matched against the FD set (kind is respected)', () => {
  assert.equal(sessionIsDeparted({ kind: 'tech', id: 'x' }, new Set(), new Set(['x'])), false);
});
