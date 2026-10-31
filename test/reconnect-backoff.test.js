// Caveat #2 fix (sync.js): back OFF — don't kill — the WS reconnect loop on an auth-needed device.
//   _reconnectDelay      — how long before the next reconnect: the fast 3s cadence normally, a slow
//     30s cadence once the app believes it needs sign-in (so a revoked device stops HAMMERING, while
//     a VALID device wrongly 401'd by a transient fail-closed backend still self-heals, just slower).
//   _shouldThrottleResync — may resync() drop this call to its 1.5s double-fetch throttle? Only while
//     signed IN. While auth-needed a resync IS the recovery attempt (PIN login calls resync), so it
//     must never be throttled away, or a sign-in could be swallowed and leave the board stuck.
// Same "pure decision tested here, event wiring verified on-device" split as wake-resync.test.js.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _reconnectDelay, _shouldThrottleResync } from '../js/app/sync.js';

// ── _reconnectDelay(authNeeded) ──────────────────────────────────────────────

test('_reconnectDelay: signed-in → the fast 3s cadence (a brief blip heals quickly)', () => {
  assert.equal(_reconnectDelay(false), 3000);
});

test('_reconnectDelay: auth-needed → the slow 30s cadence (stop the 3s hammer)', () => {
  assert.equal(_reconnectDelay(true), 30000);
});

test('_reconnectDelay: slow cadence is strictly longer than fast (and still retries, never 0)', () => {
  // the whole point of caveat #2: back off, do NOT stop — a transient fail-closed 401 must still heal
  assert.ok(_reconnectDelay(true) > _reconnectDelay(false));
  assert.ok(_reconnectDelay(true) > 0);
});

// ── _shouldThrottleResync(timerPending, authNeeded) ──────────────────────────

test('_shouldThrottleResync: timer pending + signed-in → throttle (avoid double-fetch)', () => {
  assert.equal(_shouldThrottleResync(true, false), true);
});

test('_shouldThrottleResync: timer pending + auth-needed → do NOT throttle (this is recovery)', () => {
  // the sign-in recovery fix: a PIN login landing within 1.5s of a wake/focus resync must not be swallowed
  assert.equal(_shouldThrottleResync(true, true), false);
});

test('_shouldThrottleResync: no timer pending → never throttle (signed-in)', () => {
  assert.equal(_shouldThrottleResync(false, false), false);
});

test('_shouldThrottleResync: no timer pending → never throttle (auth-needed)', () => {
  assert.equal(_shouldThrottleResync(false, true), false);
});
