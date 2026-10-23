// Turn classification (Item D) — pure classifier + config merge.
// Run: node --test-force-exit --test test/turn-classify.test.js
import './setup-globals.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState } from '../js/app/store.js';
import { classifyAmount, _mergeTurnConfig, getTurnConfig, isHalfService, turnClassOf, isEstimatedTurn, getTechTurns } from '../js/app/features/turns.js';

// The full default config — MUST stay in lockstep with getTurnConfig()'s defaults.
const DEF = {
  fullMin: 28, halfMin: 12,
  halfEnabled: true, bonusEnabled: true,
  halfByCost: true, halfByService: false,
  bonusByCost: true, bonusByService: true,
  precedence: 'bonusFirst',
};
const f = (isBonusSvc = false, isHalfSvc = false) => ({ isBonusSvc, isHalfSvc });

// Oracle = TODAY's classifyTurn (turns.js:37-44) before the overhaul.
function legacy(cost, isBonusSvc) {
  if (isBonusSvc) return 'bonus';          // always-bonus wins FIRST, even at cost 0
  if (!cost || cost <= 0) return 'unpriced';
  if (cost >= 28) return 'full';
  if (cost >= 12) return 'half';
  return 'bonus';
}

test('GOLDEN: default config reproduces legacy classifyTurn across the cost sweep + always-bonus', () => {
  for (const cost of [0, 1, 5, 11, 12, 13, 27, 28, 40, 100]) {
    for (const isBonusSvc of [false, true]) {
      assert.equal(
        classifyAmount(cost, 's', DEF, f(isBonusSvc, false)),
        legacy(cost, isBonusSvc),
        `cost=${cost} bonusSvc=${isBonusSvc}`
      );
    }
  }
});

test('half turns OFF: a would-be-half service counts as full', () => {
  assert.equal(classifyAmount(15, 's', { ...DEF, halfEnabled: false }, f()), 'full');
});

test('bonus turns OFF: a would-be-bonus (cheap) service counts as full', () => {
  assert.equal(classifyAmount(5, 's', { ...DEF, bonusEnabled: false }, f()), 'full');
});

test('both OFF: every priced service is a full turn', () => {
  const cfg = { ...DEF, halfEnabled: false, bonusEnabled: false };
  for (const cost of [5, 15, 50]) assert.equal(classifyAmount(cost, 's', cfg, f()), 'full');
});

test('bonus OFF nullifies the always-bonus list: a tagged service counts by cost', () => {
  const cfg = { ...DEF, bonusEnabled: false };
  assert.equal(classifyAmount(50, 's', cfg, f(true)), 'full');   // was bonus, now full by cost
});

test('half BY SERVICE classifies an unpriced service (service rule bypasses the unpriced gate)', () => {
  const cfg = { ...DEF, halfByService: true };
  assert.equal(classifyAmount(0, 's', cfg, f(false, true)), 'half');
});

test('bonus BY COST off: a cheap priced service is not bonus (falls to full)', () => {
  const cfg = { ...DEF, bonusByCost: false };
  assert.equal(classifyAmount(5, 's', cfg, f(false)), 'full');
});

test('unpriced with no service rule is unpriced in every precedence mode', () => {
  for (const precedence of ['bonusFirst', 'highestValue', 'costWins']) {
    assert.equal(classifyAmount(0, 's', { ...DEF, precedence }, f()), 'unpriced', precedence);
  }
});

test('precedence: always-bonus service priced at a full amount ($50)', () => {
  assert.equal(classifyAmount(50, 's', { ...DEF, precedence: 'bonusFirst' }, f(true)), 'bonus');
  assert.equal(classifyAmount(50, 's', { ...DEF, precedence: 'highestValue' }, f(true)), 'full');
  assert.equal(classifyAmount(50, 's', { ...DEF, precedence: 'costWins' }, f(true)), 'full');
});

test('precedence: always-bonus service priced in the half band ($15)', () => {
  assert.equal(classifyAmount(15, 's', { ...DEF, precedence: 'bonusFirst' }, f(true)), 'bonus');
  assert.equal(classifyAmount(15, 's', { ...DEF, precedence: 'highestValue' }, f(true)), 'half');
  assert.equal(classifyAmount(15, 's', { ...DEF, precedence: 'costWins' }, f(true)), 'half');
});

test('precedence: half-by-service, unpriced — half in every mode', () => {
  const base = { ...DEF, halfByService: true };
  for (const precedence of ['bonusFirst', 'highestValue', 'costWins']) {
    assert.equal(classifyAmount(0, 's', { ...base, precedence }, f(false, true)), 'half', precedence);
  }
});

test('costWins respects the By-cost method flag (half-by-cost OFF -> a $15 is not half)', () => {
  // half only by service, but this service is NOT a half service -> $15 should not become half via cost
  const cfg = { ...DEF, precedence: 'costWins', halfByCost: false, halfByService: true };
  assert.equal(classifyAmount(15, 's', cfg, f(false, false)), 'full');
});

test('getTurnConfig returns the full defaults on a fresh (empty) turn_config', () => {
  getState().config.turn_config = {};
  assert.deepEqual(getTurnConfig(), DEF);
});

test('getTurnConfig merges stored values over defaults without dropping keys', () => {
  getState().config.turn_config = { halfEnabled: false, fullMin: 30 };
  const c = getTurnConfig();
  assert.equal(c.halfEnabled, false);
  assert.equal(c.fullMin, 30);
  assert.equal(c.halfMin, 12);              // default kept
  assert.equal(c.precedence, 'bonusFirst'); // default kept
  getState().config.turn_config = {};       // reset
});

test('_mergeTurnConfig never drops existing keys', () => {
  assert.deepEqual(
    _mergeTurnConfig({ fullMin: 30, bonusEnabled: false }, { fullMin: 25 }),
    { fullMin: 25, bonusEnabled: false }
  );
});

// ── Item A: turnClassOf (status-aware; expected price = baseCost; NO provisional-full) ──
test('turnClassOf: a priced service classifies by its actual cost', () => {
  getState().config.services = [{ id: 's1', baseCost: 30 }];
  getState().config.turn_config = {};
  assert.equal(turnClassOf({ serviceId: 's1', cost: 40, status: 'paid' }), 'full');
  assert.equal(turnClassOf({ serviceId: 's1', cost: 15, status: 'complete' }), 'half');
});

test('turnClassOf: complete + unpriced counts via the expected price (baseCost)', () => {
  getState().config.services = [{ id: 's1', baseCost: 30 }];
  getState().config.turn_config = {};
  assert.equal(turnClassOf({ serviceId: 's1', cost: 0, status: 'complete' }), 'full'); // 30 >= 28
});

test('turnClassOf: in-service + unpriced is NOT counted, even with an expected price', () => {
  getState().config.services = [{ id: 's1', baseCost: 30 }];
  getState().config.turn_config = {};
  assert.equal(turnClassOf({ serviceId: 's1', cost: 0, status: 'inservice' }), 'unpriced');
});

test('turnClassOf: complete + NO expected price stays unpriced (exactly as today)', () => {
  getState().config.services = [{ id: 's2' }];
  getState().config.turn_config = {};
  assert.equal(turnClassOf({ serviceId: 's2', cost: 0, status: 'complete' }), 'unpriced');
});

test('turnClassOf: a comp keeps its real cost and counts by it (not lineCharge)', () => {
  getState().config.services = [{ id: 's1', baseCost: 5 }];
  getState().config.turn_config = {};
  assert.equal(turnClassOf({ serviceId: 's1', cost: 30, comped: true, status: 'complete' }), 'full');
  getState().config.services = [];   // reset
});

// ── isEstimatedTurn: the grey "~" provisional cue — only on number-bearing full/half from expected price ──
test('isEstimatedTurn: true for a counted complete+unpriced full/half number', () => {
  assert.equal(isEstimatedTurn({ cost: 0, status: 'complete' }, 'full'), true);
  assert.equal(isEstimatedTurn({ cost: 0, status: 'complete' }, 'half'), true);
});
test('isEstimatedTurn: false for bonus (shows "Bonus", not an estimate) and unpriced', () => {
  assert.equal(isEstimatedTurn({ cost: 0, status: 'complete' }, 'bonus'), false);
  assert.equal(isEstimatedTurn({ cost: 0, status: 'complete' }, 'unpriced'), false);
});
test('isEstimatedTurn: false once priced, and false while still in service', () => {
  assert.equal(isEstimatedTurn({ cost: 30, status: 'complete' }, 'full'), false);
  assert.equal(isEstimatedTurn({ cost: 0, status: 'inservice' }, 'full'), false);
});

// ── getTechTurns integration: proves Item A counting + Item D priced-path parity over a real queue ──
test('getTechTurns tallies priced, expected-price (done-unpriced), comped and always-bonus correctly', () => {
  const now = new Date().toISOString(), ms = Date.now();
  getState().config.turn_config = {};
  getState().config.turns_skips = [];
  getState().config.bonus_services = ['svAB'];
  getState().config.half_services = [];
  getState().config.services = [
    { id: 'sv1', label: 'Gel', baseCost: 30 },   // expected $30 -> full
    { id: 'svNo', label: 'Misc' },               // no baseCost -> no early count
    { id: 'svAB', label: 'Wax' },                // always-bonus
  ];
  const E = (id, a) => ({ id, name: id, checkinTime: now, status: a.status, assignments: [{ techId: 't1', assignedAt: ms, ...a }] });
  getState().queue = [
    E('e1', { serviceId: 'sv1', cost: 40, status: 'paid' }),                 // priced full
    E('e2', { serviceId: 'sv1', cost: 0, status: 'complete' }),             // done-unpriced -> expected $30 -> full (Item A)
    E('e3', { serviceId: 'svNo', cost: 0, status: 'complete' }),           // done-unpriced, no baseCost -> NOT counted
    E('e4', { serviceId: 'sv1', cost: 40, comped: true, status: 'complete' }), // comp keeps real cost -> full
    E('e5', { serviceId: 'svAB', cost: 0, status: 'inservice' }),          // always-bonus unpriced -> bonus
  ];
  const t = getTechTurns('t1');
  assert.deepEqual(t, { full: 3, half: 0, bonus: 1, total: 3 });
  getState().queue = [];
  getState().config.services = [];
  getState().config.bonus_services = [];
});

test('isHalfService is guarded: no throw when half_services is undefined', () => {
  getState().config.half_services = undefined;
  assert.equal(isHalfService('x'), false);
  getState().config.half_services = ['a'];
  assert.equal(isHalfService('a'), true);
  assert.equal(isHalfService('b'), false);
  getState().config.half_services = [];     // reset
});
