// Pure helpers behind the book-next-appointment (rebook) prompt.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitName, shouldOfferRebook, buildRebookLines, buildRebookParty } from '../js/app/rebook-util.js';

// ── splitName: first token / rest, trimmed, collapse-safe ────────────────────
test('splitName: first + last', () => {
  assert.deepEqual(splitName('Maya Rodriguez'), { first: 'Maya', last: 'Rodriguez' });
});
test('splitName: single name → empty last', () => {
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
});
test('splitName: empty / nullish → both empty', () => {
  assert.deepEqual(splitName(''), { first: '', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
  assert.deepEqual(splitName(undefined), { first: '', last: '' });
});
test('splitName: extra/leading/trailing whitespace collapses; rest kept as last', () => {
  assert.deepEqual(splitName('  Ana   Maria Lopez '), { first: 'Ana', last: 'Maria Lopez' });
});

// ── shouldOfferRebook: setting + service + name + quickSale gates ─────────────
const svc = extra => ({ name: 'Maya Rodriguez', phone: '7605550188', services: ['svc_gel'], ...extra });

test('shouldOfferRebook: ON by default (key absent) for a named service ticket', () => {
  assert.equal(shouldOfferRebook(svc(), {}), true);
});
test('shouldOfferRebook: OFF when rebook_prompt === false', () => {
  assert.equal(shouldOfferRebook(svc(), { rebook_prompt: false }), false);
});
test('shouldOfferRebook: any non-false value (e.g. true) still offers', () => {
  assert.equal(shouldOfferRebook(svc(), { rebook_prompt: true }), true);
});
test('shouldOfferRebook: false for a Quick Sale', () => {
  assert.equal(shouldOfferRebook(svc({ quickSale: true }), {}), false);
});
test('shouldOfferRebook: false when there is no service (gift-card / retail)', () => {
  assert.equal(shouldOfferRebook(svc({ services: [] }), {}), false);
  assert.equal(shouldOfferRebook({ name: 'Buyer', phone: '1', services: undefined }, {}), false);
});
test('shouldOfferRebook: false for empty / whitespace-only name', () => {
  assert.equal(shouldOfferRebook(svc({ name: '' }), {}), false);
  assert.equal(shouldOfferRebook(svc({ name: '   ' }), {}), false);
});
test('shouldOfferRebook: false for a null/undefined entry', () => {
  assert.equal(shouldOfferRebook(null, {}), false);
  assert.equal(shouldOfferRebook(undefined, {}), false);
});
test('shouldOfferRebook: tolerates a null config', () => {
  assert.equal(shouldOfferRebook(svc(), null), true);
});

// ── Fixture cfg for the party/line builders ──────────────────────────────────
// t3 is retired (kept in staff, listed inactive). svc_x is a stale id not in the catalog.
const CFG = {
  staff: [{ id: 't1', name: 'Ann' }, { id: 't2', name: 'Bea' }, { id: 't3', name: 'Cy' }],
  inactive_staff: ['t3'],
  services: [{ id: 'svc_gel', label: 'Gel' }, { id: 'svc_pedi', label: 'Pedi' }, { id: 'svc_mani', label: 'Mani' }],
};

// ── buildRebookLines: assignments ∪ services, active-tech + catalog gates ─────
test('buildRebookLines: 2 services each with a tech → 2 lines, right serviceId+staffId', () => {
  const e = { services: ['svc_gel', 'svc_pedi'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }, { serviceId: 'svc_pedi', techId: 't2' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: 't1' }, { serviceId: 'svc_pedi', staffId: 't2' }]);
});
test('buildRebookLines: service with no assignment → line with staffId \'\'', () => {
  const e = { services: ['svc_gel', 'svc_pedi'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: 't1' }, { serviceId: 'svc_pedi', staffId: '' }]);
});
test('buildRebookLines: inactive tech → staffId \'\' (line kept)', () => {
  const e = { services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't3' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: '' }]);
});
test('buildRebookLines: unknown tech id → staffId \'\'', () => {
  const e = { services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 'zzz' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: '' }]);
});
test('buildRebookLines: serviceId not in catalog → line dropped', () => {
  const e = { services: ['svc_gel', 'svc_x'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }, { serviceId: 'svc_x', techId: 't2' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: 't1' }]);
});
test('buildRebookLines: service in both services[] and assignments[] → one line (dedupe)', () => {
  const e = { services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  assert.deepEqual(buildRebookLines(e, CFG), [{ serviceId: 'svc_gel', staffId: 't1' }]);
});
test('buildRebookLines: no services, no assignments → []', () => {
  assert.deepEqual(buildRebookLines({ services: [], assignments: [] }, CFG), []);
  assert.deepEqual(buildRebookLines({}, CFG), []);
  assert.deepEqual(buildRebookLines(null, CFG), []);
});

// ── buildRebookParty: primary-first, primary never dropped, shared-phone blank ─
test('buildRebookParty: group → guests primary-first (by groupLabel), each with lines', () => {
  const B = { name: 'Bea Member', phone: '222', groupLabel: 'Ann — Bea Member', services: ['svc_pedi'], assignments: [{ serviceId: 'svc_pedi', techId: 't2' }] };
  const A = { name: 'Ann', phone: '111', groupLabel: 'Ann (primary)', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  const C = { name: 'Cee', phone: '333', groupLabel: 'Ann — Cee', services: ['svc_mani'], assignments: [{ serviceId: 'svc_mani', techId: 't1' }] };
  const out = buildRebookParty([B, A, C], CFG);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { name: 'Ann', phone: '111', lines: [{ serviceId: 'svc_gel', staffId: 't1' }] });
  assert.equal(out[1].name, 'Bea Member');   // order of the rest preserved
  assert.equal(out[2].name, 'Cee');
});
test('buildRebookParty: no (primary) label → entries[0] is primary', () => {
  const X = { name: 'Xa', phone: '1', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  const Y = { name: 'Yb', phone: '2', services: ['svc_pedi'], assignments: [{ serviceId: 'svc_pedi', techId: 't2' }] };
  assert.equal(buildRebookParty([X, Y], CFG)[0].name, 'Xa');
});
test('buildRebookParty: primary with zero resolvable lines → still index 0 with lines []', () => {
  const A = { name: 'Ann', phone: '111', groupLabel: 'Ann (primary)', services: [], assignments: [] };
  const B = { name: 'Bea', phone: '222', groupLabel: 'Ann — Bea', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  const out = buildRebookParty([A, B], CFG);
  assert.deepEqual(out[0], { name: 'Ann', phone: '111', lines: [] });
  assert.equal(out[1].name, 'Bea');
});
test('buildRebookParty: nameless secondary dropped even WITH lines (matches saveAppt name gate)', () => {
  const A = { name: 'Ann', phone: '111', groupLabel: 'Ann (primary)', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  const ghost = { name: '', phone: '', groupLabel: 'Ann — ', services: ['svc_pedi'], assignments: [{ serviceId: 'svc_pedi', techId: 't2' }] };
  const out = buildRebookParty([A, ghost], CFG);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Ann');
});
test('buildRebookParty: secondary phone == an earlier member phone → blanked', () => {
  const A = { name: 'Ann', phone: '111', groupLabel: 'Ann (primary)', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  const B = { name: 'Mom', phone: '111', groupLabel: 'Ann — Mom', services: ['svc_pedi'], assignments: [{ serviceId: 'svc_pedi', techId: 't2' }] };
  const out = buildRebookParty([A, B], CFG);
  assert.equal(out[0].phone, '111');
  assert.equal(out[1].phone, '');   // dup of primary blanked, name kept
  assert.equal(out[1].name, 'Mom');
});
test('buildRebookParty: party name is entry.name, never groupLabel', () => {
  const A = { name: 'Ann', phone: '111', groupLabel: 'Ann (primary)', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  assert.equal(buildRebookParty([A], CFG)[0].name, 'Ann');
});
test('buildRebookParty: single non-group entry → one guest', () => {
  const X = { name: 'Solo', phone: '9', services: ['svc_gel'], assignments: [{ serviceId: 'svc_gel', techId: 't1' }] };
  assert.deepEqual(buildRebookParty([X], CFG), [{ name: 'Solo', phone: '9', lines: [{ serviceId: 'svc_gel', staffId: 't1' }] }]);
});
test('buildRebookParty: null / empty / garbage → []', () => {
  assert.deepEqual(buildRebookParty(null, CFG), []);
  assert.deepEqual(buildRebookParty([], CFG), []);
  assert.deepEqual(buildRebookParty([null, undefined], CFG), []);
});
