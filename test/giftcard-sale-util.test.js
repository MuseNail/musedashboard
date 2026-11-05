// Pure helpers for the unified gift-card sale path (js/app/giftcard-sale-util.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { giftSaleAction, giftCardFromSale, partitionGiftReverse } from '../js/app/giftcard-sale-util.js';

// ── giftSaleAction ───────────────────────────────────────────
test('giftSaleAction: edit always wins; new+none = record; new+payment = pay', () => {
  assert.equal(giftSaleAction({ editId: 'gc-1', payMethod: 'cash' }), 'edit');   // editing never charges
  assert.equal(giftSaleAction({ editId: '', payMethod: 'none' }), 'record');
  assert.equal(giftSaleAction({ editId: '', payMethod: '' }), 'record');
  assert.equal(giftSaleAction({ payMethod: 'cash' }), 'pay');
  assert.equal(giftSaleAction({ payMethod: 'card' }), 'pay');
  assert.equal(giftSaleAction({ payMethod: 'zelle' }), 'pay');
  assert.equal(giftSaleAction({}), 'record');
});

// ── giftCardFromSale ─────────────────────────────────────────
test('giftCardFromSale carries notes, pads a numeric serial, forces today + empty redemptions', () => {
  const c = giftCardFromSale('tk-9', { amount: 50, serial: '29', phone: '555', from: 'Buyer', to: 'Recip', notes: 'birthday' }, 2, '2026-11-05');
  assert.equal(c.id, 'gc-tkt-tk-9-2');
  assert.equal(c.serial, '00000029');
  assert.equal(c.amount, 50);
  assert.equal(c.notes, 'birthday');
  assert.equal(c.datePurchased, '2026-11-05');
  assert.equal(c.saleTicketId, 'tk-9');
  assert.deepEqual(c.redemptions, []);
  assert.equal(c.amountUsed, 0);
  assert.equal(c.from, 'Buyer');
  assert.equal(c.to, 'Recip');
  assert.equal('createdAt' in c, false, 'caller adds createdAt');
});
test('giftCardFromSale keeps a non-numeric serial as-is and defaults missing fields', () => {
  const c = giftCardFromSale('t', { amount: 10, serial: 'ABC-7' }, 0, '2026-01-01');
  assert.equal(c.serial, 'ABC-7');
  assert.equal(c.notes, '');
  assert.equal(c.phone, '');
});

// ── partitionGiftReverse ─────────────────────────────────────
test('partitionGiftReverse voids unredeemed cards and keeps redeemed ones', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const used = c => ({ a: 0, b: 25, c: 0 }[c.id]);   // b has been redeemed
  assert.deepEqual(partitionGiftReverse(cards, used), { voidIds: ['a', 'c'], keepIds: ['b'] });
});
test('partitionGiftReverse handles an empty/undefined list', () => {
  assert.deepEqual(partitionGiftReverse([], () => 0), { voidIds: [], keepIds: [] });
  assert.deepEqual(partitionGiftReverse(undefined, () => 0), { voidIds: [], keepIds: [] });
});
