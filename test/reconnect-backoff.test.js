// Caveat #2b fix (sync.js, v6.04): once the Worker returns 503 (not 401) for a transient backend blip,
// an HTTP 401 / WS 4001 is TRUSTWORTHY — it means a genuine revoke/expiry — so the client STOPS its fast
// reconnect loop instead of v6.03's slow 30s retry.
//   _shouldKeepReconnecting — keep the fast reconnect loop? No once a genuine revoke is known
//     (_authNeeded): the session is destroyed server-side, recovery is a PIN sign-in, and a transient
//     blip is a 503 (never sets _authNeeded), so stopping can't strand a valid device.
//   _shouldThrottleResync — may resync() drop this call to its 1.5s double-fetch throttle? Only while
//     signed IN. While auth-needed a resync IS the recovery attempt (PIN login calls resync), so it must
//     never be throttled away, or a sign-in could be swallowed and leave the board stuck. (UNCHANGED.)
// Same "pure decision tested here, event wiring verified on-device" split as wake-resync.test.js.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { _shouldKeepReconnecting, _shouldThrottleResync } from '../js/app/sync.js';

// ── _shouldKeepReconnecting(authNeeded) ──────────────────────────────────────

test('_shouldKeepReconnecting: signed-in → keep the fast reconnect (a brief blip heals quickly)', () => {
  assert.equal(_shouldKeepReconnecting(false), true);
});

test('_shouldKeepReconnecting: auth-needed → STOP the loop (genuine revoke; recovery is a PIN sign-in)', () => {
  assert.equal(_shouldKeepReconnecting(true), false);
});

// ── _shouldThrottleResync(timerPending, authNeeded) — unchanged from v6.03 ───

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
