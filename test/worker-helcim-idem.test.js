// /helcim/refund idempotency-key handling (0-pre-a). The old code normalized EVERY
// client key to ('rf-' + sanitized + padding).slice(0, 32) — truncating off the cents
// and ordinal that made refund intents distinct, so all refunds of one sale shared one
// effective Helcim key. New-format keys ('rf' + 30 hex, minted by v5.42+) must pass
// through UNCHANGED; everything else must normalize BYTE-IDENTICALLY to the old code so
// old cached clients keep their historical effective keys mid-rollout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { helcimIdemKey, filterHelcimRefunds } from '../cloudflare/worker.js';

// The legacy formula, verbatim — the back-compat contract.
const legacy = (key) => ('rf-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '') + '-0000000000000000000000000000000000').slice(0, 32);

test('helcimIdemKey: new-format key passes through unchanged', () => {
  const k = 'rf' + 'a1b2c3d4e5'.repeat(3);   // rf + 30 hex
  assert.equal(helcimIdemKey(k, 'fallback'), k);
});

test('helcimIdemKey: passthrough is EXACT-shape only', () => {
  assert.notEqual(helcimIdemKey('RF' + 'a'.repeat(30), 'f'), 'RF' + 'a'.repeat(30), 'uppercase prefix is not the new format');
  assert.notEqual(helcimIdemKey('rf' + 'g'.repeat(30), 'f'), 'rf' + 'g'.repeat(30), 'non-hex chars are not the new format');
  assert.notEqual(helcimIdemKey('rf' + 'a'.repeat(29), 'f'), 'rf' + 'a'.repeat(29), 'wrong length is not the new format');
});

test('helcimIdemKey: typical legacy concat key normalizes byte-identically to the old worker', () => {
  const key = 'dev-abc123-1739412345678-1-25764674-5000-0';
  assert.equal(helcimIdemKey(key, ''), legacy(key));
  assert.equal(helcimIdemKey(key, ''), 'rf-dev-abc123-1739412345678-1-25');   // pinned literal
});

test('helcimIdemKey: a compliant-charset 25-36 char legacy-SHAPED key still normalizes (never passthrough)', () => {
  // A short-device-id legacy key that happens to fit Helcim's 25-36 window — a
  // length/charset-based passthrough would send it raw, diverging from the old
  // worker's truncation mid-rollout and breaking retry continuity for that sale.
  const key = '1234567890123456-25764674-5000';
  assert.equal(helcimIdemKey(key, ''), legacy(key));
});

test('helcimIdemKey: empty/absent key uses the fallback through the legacy path', () => {
  assert.equal(helcimIdemKey('', '25764674-5000'), legacy('25764674-5000'));
  assert.equal(helcimIdemKey(undefined, '25764674-5000'), legacy('25764674-5000'));
});

// ── filterHelcimRefunds (/helcim/refunds route logic) ────────────────────────────────
const TX = (over = {}) => ({ transactionId: 90000001, type: 'refund', status: 'APPROVED', amount: 30, ...over });

test('filterHelcimRefunds: keeps approved refund-type txns, excludes the original, sums the total', () => {
  const { refunds, refundedTotal } = filterHelcimRefunds(25764674, [
    TX({ transactionId: 25764674, type: 'purchase', amount: 100 }),   // the original
    TX(),                                                             // $30 refund
    TX({ transactionId: 90000002, type: 'REFUND', amount: 20 }),      // case variant
    TX({ transactionId: 90000003, status: 'DECLINED', amount: 99 }),  // declined → ignored
    TX({ transactionId: 90000004, type: 'purchase', amount: 40 }),    // not a refund
  ]);
  assert.deepEqual(refunds.map(t => String(t.transactionId)), ['90000001', '90000002']);
  assert.equal(refundedTotal, 50);
});

test('filterHelcimRefunds: accepts both a bare array and the {value:[...]} envelope', () => {
  const inner = [TX()];
  assert.equal(filterHelcimRefunds(1, inner).refunds.length, 1);
  assert.equal(filterHelcimRefunds(1, { value: inner }).refunds.length, 1);
  assert.equal(filterHelcimRefunds(1, null).refunds.length, 0);
  assert.equal(filterHelcimRefunds(1, {}).refunds.length, 0);
});

test('filterHelcimRefunds: a refund equal to the original id is never double-listed', () => {
  const { refunds } = filterHelcimRefunds(90000001, [TX()]);   // refund txn id === original id param
  assert.equal(refunds.length, 0);
});

test('filterHelcimRefunds: an id-less transaction is dropped (never emitted as "undefined")', () => {
  const { refunds, refundedTotal } = filterHelcimRefunds(1, [TX({ transactionId: undefined })]);
  assert.equal(refunds.length, 0);
  assert.equal(refundedTotal, 0);
});
