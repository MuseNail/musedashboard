// Helcim refund idempotency + processor-truth helpers (0-pre-a).
// Helcim clears idempotency keys after 5 MINUTES (devdocs.helcim.com/docs/idempotency):
// same key + identical payload within the window replays the first successful response;
// same key + different payload → 409. So the key's ONLY job is deduping an immediate
// retry — the deterministic (saleId, txn, cents, per-cents ordinal) hash below. Every
// longer-horizon protection (delayed retry, cross-device, already-refunded sale) comes
// from the processor-truth check helpers, not the key.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _refundIdemKey, _priorCardRefunds, _unrecordedHelcimRefunds, _matchUnrecordedTxn } from '../js/app/features/reports.js';

// ── _refundIdemKey ────────────────────────────────
test('_refundIdemKey: 32 chars, rf + 30 lowercase hex (Helcim window is 25-36)', async () => {
  const k = await _refundIdemKey('s1', '25764674', 5000, 0);
  assert.match(k, /^rf[0-9a-f]{30}$/);
  assert.equal(k.length, 32);
});

test('_refundIdemKey: deterministic — same intent tuple → same key (that IS the dedup)', async () => {
  const a = await _refundIdemKey('s1', '25764674', 5000, 0);
  const b = await _refundIdemKey('s1', '25764674', 5000, 0);
  assert.equal(a, b);
  // Fixed vector: a silent change to the delimiter/slice/format would alter every key
  // and break retry continuity — pin the exact output.
  assert.equal(a, 'rf89e2c9c58dd35feb19a23133fcb3b8');
});

test('_refundIdemKey: every tuple element is discriminating', async () => {
  const base = await _refundIdemKey('s1', '25764674', 5000, 0);
  assert.notEqual(await _refundIdemKey('s2', '25764674', 5000, 0), base, 'sale id');
  assert.notEqual(await _refundIdemKey('s1', '25764675', 5000, 0), base, 'txn id');
  assert.notEqual(await _refundIdemKey('s1', '25764674', 3000, 0), base, 'cents (amount edit → new key)');
  assert.notEqual(await _refundIdemKey('s1', '25764674', 5000, 1), base, 'ordinal (recorded refund → new key)');
});

// ── _priorCardRefunds (the ordinal n) ────────────────────────────────
// Per-CENTS count of recorded card-bearing refunds: a flat count would let deleting an
// unrelated refund shift another amount's ordinal onto an already-consumed key.
const R = (over = {}) => ({ id: 'r1', status: 'refund', refundOf: 'sale1', totalCost: -50, squareRefundIds: ['90000001'], ...over });

test('_priorCardRefunds: counts only same-cents card-bearing refunds of THIS sale', () => {
  const records = [
    R(),                                                          // $50 card refund of sale1 → counts at 5000
    R({ id: 'r2', totalCost: -30, squareRefundIds: ['90000002'] }), // $30 → different cents bucket
    R({ id: 'r3', refundOf: 'other' }),                           // other sale
    R({ id: 'r4', squareRefundIds: [], cardRefund: undefined }),  // no card leg (cash/Zelle-only refund)
    { id: 'x1', status: 'paid', refundOf: 'sale1', totalCost: 50 }, // not a refund
  ];
  assert.equal(_priorCardRefunds(records, 'sale1', 5000), 1);
  assert.equal(_priorCardRefunds(records, 'sale1', 3000), 1);
  assert.equal(_priorCardRefunds(records, 'sale1', 2000), 0);
});

test('_priorCardRefunds: deleted refunds do not count (delete-then-redo lands on the truth check, not a shifted key)', () => {
  const records = [R({ status: 'deleted' })];
  assert.equal(_priorCardRefunds(records, 'sale1', 5000), 0);
});

test('_priorCardRefunds: mixed-tender refund counts by its CARD cents, not the record total', () => {
  // $50 refund where only $30 went back to the card (v5.42+ stamps cardRefundCents).
  const records = [R({ cardRefund: true, cardRefundCents: 3000 })];
  assert.equal(_priorCardRefunds(records, 'sale1', 3000), 1);
  assert.equal(_priorCardRefunds(records, 'sale1', 5000), 0, 'must not fall back to totalCost when cardRefundCents exists');
});

test('_priorCardRefunds: cardRefund flag counts even when Helcim returned no transactionId', () => {
  const records = [R({ squareRefundIds: undefined, cardRefund: true, cardRefundCents: 5000 })];
  assert.equal(_priorCardRefunds(records, 'sale1', 5000), 1);
});

test('_priorCardRefunds: refundOf matches across string/number id types', () => {
  const records = [R({ refundOf: 1747000000001 })];
  assert.equal(_priorCardRefunds(records, '1747000000001', 5000), 1);
});

// ── _unrecordedHelcimRefunds (processor-truth reconciliation) ────────────────────────────────
test('_unrecordedHelcimRefunds: flags Helcim refunds with no live recorded counterpart', () => {
  const helcim = [
    { transactionId: '90000001', amount: 50 },
    { transactionId: '90000002', amount: 30 },
  ];
  const records = [R()];   // records only 90000001
  const un = _unrecordedHelcimRefunds(helcim, records, 'sale1');
  assert.equal(un.length, 1);
  assert.equal(un[0].transactionId, '90000002');
});

test('_unrecordedHelcimRefunds: a DELETED refund record does not account for its Helcim txn (the money still went back once)', () => {
  const helcim = [{ transactionId: '90000001', amount: 50 }];
  const records = [R({ status: 'deleted' })];
  const un = _unrecordedHelcimRefunds(helcim, records, 'sale1');
  assert.equal(un.length, 1, 'deleting the record must not make the processor refund look recordable-again');
});

test('_unrecordedHelcimRefunds: id comparison coerces number/string', () => {
  const helcim = [{ transactionId: 90000001, amount: 50 }];
  const records = [R({ squareRefundIds: ['90000001'] })];
  assert.equal(_unrecordedHelcimRefunds(helcim, records, 'sale1').length, 0);
});

// ── _matchUnrecordedTxn (record-only reconciliation) ────────────────────────────────
// After the unrecorded-refund block, a toggle-OFF record at the matching amount gets
// stamped with that Helcim txn id — exactly one amount match, or nothing is stamped.
test('_matchUnrecordedTxn: single exact-amount match wins; ambiguity or mismatch stamps nothing', () => {
  const t1 = { transactionId: '91', amount: 50 }, t2 = { transactionId: '92', amount: 50 }, t3 = { transactionId: '93', amount: 30 };
  assert.equal(_matchUnrecordedTxn([t1, t3], 50), t1);
  assert.equal(_matchUnrecordedTxn([t1, t3], 30), t3);
  assert.equal(_matchUnrecordedTxn([t1, t2], 50), null, 'two same-amount candidates → ambiguous → no stamp');
  assert.equal(_matchUnrecordedTxn([t1, t3], 20), null, 'no amount match → no stamp');
  assert.equal(_matchUnrecordedTxn([t1], 50.004), t1, 'sub-cent tolerance');
  assert.equal(_matchUnrecordedTxn([], 50), null);
});
