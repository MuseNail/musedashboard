// Pure helpers for the unified gift-card sale path (js/app/giftcard-sale-util.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { giftSaleAction, giftCardFromSale, partitionGiftReverse, resolveGiftDiscount, giftLineNet, giftSalesNet, giftSalesDiscountTotal } from '../js/app/giftcard-sale-util.js';

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

// ── resolveGiftDiscount: $/% → a clamped, 2dp dollar discount ─────────────────
test('resolveGiftDiscount: $ mode clamps to [0, amount] and rounds to cents', () => {
  assert.equal(resolveGiftDiscount(100, '$', 10), 10);
  assert.equal(resolveGiftDiscount(100, '$', 150), 100, 'cannot exceed the card amount');
  assert.equal(resolveGiftDiscount(100, '$', -5), 0, 'never negative');
  assert.equal(resolveGiftDiscount(100, '$', 10.005), 10.01, 'rounds the $ branch too (cent-exact)');
});
test('resolveGiftDiscount: % mode is amount*pct/100, clamped + rounded', () => {
  assert.equal(resolveGiftDiscount(100, '%', 10), 10);
  assert.equal(resolveGiftDiscount(38, '%', 10), 3.8);
  assert.equal(resolveGiftDiscount(33.33, '%', 10), 3.33, 'round2');
  assert.equal(resolveGiftDiscount(100, '%', 150), 100, '>100% clamps to the full amount');
  assert.equal(resolveGiftDiscount(100, '%', -10), 0);
});
test('resolveGiftDiscount: coerces NaN/empty/garbage inputs to 0 (never poisons the charge)', () => {
  assert.equal(resolveGiftDiscount(100, '$', ''), 0);
  assert.equal(resolveGiftDiscount(100, '$', NaN), 0);
  assert.equal(resolveGiftDiscount(100, '%', 'abc'), 0);
  assert.equal(resolveGiftDiscount('bad', '$', 10), 0, 'a non-numeric amount clamps the discount to 0');
  assert.equal(resolveGiftDiscount(undefined, '%', 10), 0);
});

// ── giftLineNet / giftSalesNet / giftSalesDiscountTotal ───────────────────────
test('giftLineNet: amount − discount, never below 0, missing discount = 0', () => {
  assert.equal(giftLineNet({ amount: 100, discount: 10 }), 90);
  assert.equal(giftLineNet({ amount: 100 }), 100, 'no discount → full amount');
  assert.equal(giftLineNet({ amount: 100, discount: 200 }), 0, 'clamped at 0');
  assert.equal(giftLineNet({}), 0);
});
test('giftSalesNet: sums the net of each line (customer-paid gift total)', () => {
  assert.equal(giftSalesNet([{ amount: 100, discount: 10 }, { amount: 50 }]), 140);
  assert.equal(giftSalesNet([]), 0);
  assert.equal(giftSalesNet(null), 0);
  assert.equal(giftSalesNet(undefined), 0);
});
test('giftSalesNet: a line with no discount is byte-identical to the old Σ amount (back-compat)', () => {
  const lines = [{ amount: 25 }, { amount: 75 }];
  assert.equal(giftSalesNet(lines), 100);
});
test('giftSalesDiscountTotal: sums the clamped per-line discounts (promo cost)', () => {
  assert.equal(giftSalesDiscountTotal([{ amount: 100, discount: 10 }, { amount: 50, discount: 5 }]), 15);
  assert.equal(giftSalesDiscountTotal([{ amount: 100, discount: 200 }]), 100, 'clamped to amount');
  assert.equal(giftSalesDiscountTotal([{ amount: 100 }]), 0);
  assert.equal(giftSalesDiscountTotal(null), 0);
});

// ── giftCardFromSale: now records saleDiscount; card value stays FULL face ─────
test('giftCardFromSale: records saleDiscount but the card amount is the FULL face (INVARIANT)', () => {
  const c = giftCardFromSale('tk-1', { amount: 100, serial: '7', discount: 10 }, 0, '2026-11-21');
  assert.equal(c.amount, 100, 'card loads full value regardless of discount');
  assert.equal(c.saleDiscount, 10);
});
test('giftCardFromSale: saleDiscount defaults to 0, is clamped to the amount, and 2dp', () => {
  assert.equal(giftCardFromSale('t', { amount: 50 }, 0, '2026-01-01').saleDiscount, 0);
  assert.equal(giftCardFromSale('t', { amount: 50, discount: 80 }, 0, '2026-01-01').saleDiscount, 50);
  assert.equal(giftCardFromSale('t', { amount: 50, discount: 10.005 }, 0, '2026-01-01').saleDiscount, 10.01);
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
