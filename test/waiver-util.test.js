import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAIVER_METHODS, textHash, newWaiverId, waiverActive, partyNeedsWaiver,
  buildWaiverRecord, signerDisplayName,
} from '../js/app/waiver-util.js';

// ── textHash ─────────────────────────────────────────────────
test('textHash is stable and sensitive', () => {
  assert.equal(textHash('hello'), textHash('hello'));
  assert.notEqual(textHash('hello'), textHash('hello.'));
  assert.match(textHash('anything'), /^[0-9a-f]+$/);
});

// ── newWaiverId ──────────────────────────────────────────────
test('newWaiverId is prefixed + unique-ish', () => {
  assert.match(newWaiverId(1000, 'abc'), /^wv-1000-abc$/);
  assert.notEqual(newWaiverId(1, 'a'), newWaiverId(1, 'b'));
});

// ── signerDisplayName (first + last initial) ─────────────────
test('signerDisplayName is first name + last initial', () => {
  assert.equal(signerDisplayName('Sarah', 'Miller'), 'Sarah M.');
  assert.equal(signerDisplayName('Sarah', ''), 'Sarah');
  assert.equal(signerDisplayName(' Ann ', ' Lee '), 'Ann L.');
});

// ── waiverActive (empty-text guard) ──────────────────────────
test('waiverActive requires enabled + version + non-empty text', () => {
  assert.equal(waiverActive({ waiver_enabled: true, waiver_version: '02', waiver_text: 'terms…' }), true);
  assert.equal(waiverActive({ waiver_enabled: false, waiver_version: '02', waiver_text: 'x' }), false);
  assert.equal(waiverActive({ waiver_enabled: true, waiver_version: '02', waiver_text: '   ' }), false);
  assert.equal(waiverActive({ waiver_enabled: true, waiver_version: '', waiver_text: 'x' }), false);
  assert.equal(waiverActive({}), false);
});

// ── partyNeedsWaiver (the re-sign rule) ──────────────────────
test('party is covered only when every guest has the current version', () => {
  const covered = { '9091234567': '02', '9095551212': '02' };
  // all covered → no gate
  assert.equal(partyNeedsWaiver([{ phoneKey: '9091234567' }, { phoneKey: '9095551212' }], covered, '02'), false);
  // a co-guest on an older version → gate
  assert.equal(partyNeedsWaiver([{ phoneKey: '9091234567' }, { phoneKey: '0000000000' }], covered, '02'), true);
  // a co-guest with an OLD version stamp → gate
  assert.equal(partyNeedsWaiver([{ phoneKey: '9091234567' }], { '9091234567': '01' }, '02'), true);
});
test('a phone-less guest can never be proven covered → always gate', () => {
  assert.equal(partyNeedsWaiver([{ phoneKey: '9091234567' }, { phoneKey: '' }], { '9091234567': '02' }, '02'), true);
  assert.equal(partyNeedsWaiver([{ phoneKey: null }], {}, '02'), true);
});
test('empty party is not a gate', () => {
  assert.equal(partyNeedsWaiver([], {}, '02'), false);
});

// ── buildWaiverRecord ────────────────────────────────────────
test('buildWaiverRecord stores full text inline + hash + attribution', () => {
  const rec = buildWaiverRecord({
    id: 'wv-1', now: 5000,
    primary: { firstName: 'Sarah', lastName: 'Miller', phone: '(909) 123-4567', phoneKey: '9091234567', customerId: 'cust-9091234567' },
    guests: [{ name: 'Sarah Miller', phoneKey: '9091234567' }, { name: 'Ann', phoneKey: null }],
    waiverVersion: '02', text: 'FULL WAIVER TEXT', method: 'self-kiosk', deviceId: 'devA',
    optIns: { marketing: true, media: false }, arbitrationOptOut: false, bypassed: false,
  });
  assert.equal(rec.id, 'wv-1');
  assert.equal(rec.customerId, 'cust-9091234567');
  assert.equal(rec.phoneKey, '9091234567');
  assert.equal(rec.signerFullName, 'Sarah Miller');
  assert.equal(rec.signerDisplay, 'Sarah M.');
  assert.equal(rec.signerPhone, '(909) 123-4567');
  assert.equal(rec.waiverVersion, '02');
  assert.equal(rec.text, 'FULL WAIVER TEXT');       // full text inline (system of record)
  assert.equal(rec.textHash, textHash('FULL WAIVER TEXT'));
  assert.equal(rec.acceptedAt, 5000);
  assert.equal(rec.method, 'self-kiosk');
  assert.equal(rec.deviceId, 'devA');
  assert.deepEqual(rec.optIns, { marketing: true, media: false });
  assert.equal(rec.arbitrationOptOut, false);
  assert.equal(rec.bypassed, false);
  assert.equal(rec.guests.length, 2);
});

test('buildWaiverRecord defaults optIns/bypass safely', () => {
  const rec = buildWaiverRecord({ id: 'wv-2', now: 1, primary: { firstName: 'Bo', lastName: 'K', phoneKey: 'pk' }, guests: [], waiverVersion: '02', text: 't', method: 'front-desk-kiosk' });
  assert.deepEqual(rec.optIns, { marketing: false, media: false });
  assert.equal(rec.arbitrationOptOut, false);
  assert.equal(rec.bypassed, false);
});

test('WAIVER_METHODS is the closed set', () => {
  assert.deepEqual(WAIVER_METHODS, ['self-kiosk', 'front-desk-kiosk']);
});
