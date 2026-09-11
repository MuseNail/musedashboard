// Regression test for the chat "mark seen" idempotency bug that froze the app.
// Before the fix, markSeen() fell back to Date.now() for a channel with no messages
// (every channel reads empty after the 4 AM salon-day clear). Date.now() strictly
// increases, so the "already caught up" guard never latched: onChatSync → markSeen →
// dispatch(config.set) → onStateChange(config) → onChatSync → … an unbounded loop that
// hard-froze the whole app whenever someone opened an empty conversation.
//
// The decision is now the pure, idempotent seenAdvance(msgs, curTs): it uses the latest
// MESSAGE timestamp (never the wall clock) and returns null when there is nothing to
// write — so re-marking can never advance the marker on its own and the loop is impossible.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seenAdvance } from '../js/app/features/chat.js';

test('empty channel → null (nothing unread, so nothing to mark — this is the loop fix)', () => {
  assert.equal(seenAdvance([], 0), null);
  assert.equal(seenAdvance([], 12345), null);
  assert.equal(seenAdvance(undefined, 0), null);
});

test('non-empty channel → the latest message timestamp (never wall-clock)', () => {
  assert.equal(seenAdvance([{ ts: 100 }, { ts: 300 }, { ts: 200 }], 0), 300);
});

test('already caught up (curTs >= latest) → null, so no re-dispatch', () => {
  assert.equal(seenAdvance([{ ts: 300 }], 300), null);
  assert.equal(seenAdvance([{ ts: 300 }], 999), null);
});

test('idempotent: feeding the result back in yields null (the guard now latches)', () => {
  const msgs = [{ ts: 300 }];
  const first = seenAdvance(msgs, 0);
  assert.equal(first, 300);
  assert.equal(seenAdvance(msgs, first), null);   // second pass writes nothing → no loop
});

test('a message missing ts counts as 0 and does not break the max of real timestamps', () => {
  assert.equal(seenAdvance([{ ts: 500 }, {}], 0), 500);
  assert.equal(seenAdvance([{ ts: 0 }], 0), null);   // all-zero ts, curTs 0 → already caught up
});
