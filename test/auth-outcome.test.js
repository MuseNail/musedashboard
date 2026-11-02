// Caveat #2b (v6.04): the Worker must tell a TRANSIENT backend blip from a GENUINE revoke, so the
// client can STOP a true revoke's reconnect loop without ever stranding a valid device on a hiccup.
// These lock the classification AND the non-pure appAuthOk wiring (the regression-bearing seam): a DO
// throw / 5xx → 'transient' (503, and NEVER cached, so a valid session self-heals on the next request);
// a clean 200 {ok:false} → 'revoked' (401). The appAuthOk cases use a mocked SALON_DO stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAuthCheck, authCacheMs, authOutcomeStatus, appAuthOk } from '../cloudflare/worker.js';

// ── classifyAuthCheck(fetchThrew, httpOk, bodyOk) ────────────────────────────
test('classifyAuthCheck: fetch threw → transient (DO unreachable / authCheck storage blip)', () => {
  assert.equal(classifyAuthCheck(true, false, false), 'transient');
  assert.equal(classifyAuthCheck(true, true, true), 'transient');   // a throw wins regardless of the rest
});
test('classifyAuthCheck: non-2xx from the DO → transient (not a clean verdict)', () => {
  assert.equal(classifyAuthCheck(false, false, false), 'transient');
});
test('classifyAuthCheck: 200 {ok:true} → ok', () => {
  assert.equal(classifyAuthCheck(false, true, true), 'ok');
});
test('classifyAuthCheck: 200 {ok:false} → revoked (the only genuine negative)', () => {
  assert.equal(classifyAuthCheck(false, true, false), 'revoked');
});

// ── authOutcomeStatus(outcome) ───────────────────────────────────────────────
test('authOutcomeStatus: ok → 0 (caller proceeds, emits no error)', () => { assert.equal(authOutcomeStatus('ok'), 0); });
test('authOutcomeStatus: revoked → 401 (client may fully stop)', () => { assert.equal(authOutcomeStatus('revoked'), 401); });
test('authOutcomeStatus: transient → 503 (client treats as offline, keeps fast-retrying)', () => { assert.equal(authOutcomeStatus('transient'), 503); });

// ── authCacheMs(outcome) ─────────────────────────────────────────────────────
test('authCacheMs: ok cached 60s', () => { assert.equal(authCacheMs('ok'), 60000); });
test('authCacheMs: revoked cached 10s', () => { assert.equal(authCacheMs('revoked'), 10000); });
test('authCacheMs: transient NEVER cached (0) — the next request must re-probe so a recovered DO self-heals', () => {
  assert.equal(authCacheMs('transient'), 0);
});

// ── appAuthOk(request, url, env, salonId) — the wiring (mocked DO) ───────────
function makeEnv(fetchImpl, enforced = 'true') {
  const state = { calls: 0 };
  return {
    state,
    env: {
      AUTH_ENFORCED: enforced,
      SALON_DO: { idFromName: () => 'do-id', get: () => ({ fetch: async (req) => { state.calls++; return fetchImpl(req); } }) },
    },
  };
}
function reqUrl(token, path = '/state/snapshot') {
  const url = new URL('https://w.example' + path + (token ? ('?auth=' + encodeURIComponent(token)) : ''));
  return { request: new Request(url.toString()), url };
}
const okResp     = () => new Response(JSON.stringify({ ok: true }),  { status: 200 });
const revResp    = () => new Response(JSON.stringify({ ok: false }), { status: 200 });
const err5xxResp = () => new Response('err', { status: 503 });

test('appAuthOk: DO fetch throws → transient, and a transient is NOT cached (re-probes next call)', async () => {
  const m = makeEnv(() => { throw new Error('DO unreachable'); });
  const { request, url } = reqUrl('tok-throw-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'transient');
  await appAuthOk(request, url, m.env, 'muse');
  assert.equal(m.state.calls, 2, 'a transient must not be cached — the second call re-probes the DO');
});
test('appAuthOk: DO returns 5xx → transient', async () => {
  const m = makeEnv(err5xxResp);
  const { request, url } = reqUrl('tok-5xx-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'transient');
});
test('appAuthOk: 200 with an UNPARSEABLE body → transient (safe direction — never a wrong logout)', async () => {
  const m = makeEnv(() => new Response('<html>not json</html>', { status: 200 }));
  const { request, url } = reqUrl('tok-badbody-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'transient');
});
test('appAuthOk: 200 {ok:true} → ok, and a positive IS cached (no second DO round-trip)', async () => {
  const m = makeEnv(okResp);
  const { request, url } = reqUrl('tok-ok-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'ok');
  await appAuthOk(request, url, m.env, 'muse');
  assert.equal(m.state.calls, 1, 'a positive is cached — the second call is served from the isolate cache');
});
test('appAuthOk: 200 {ok:false} → revoked (genuine)', async () => {
  const m = makeEnv(revResp);
  const { request, url } = reqUrl('tok-rev-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'revoked');
});
test('appAuthOk: no token → revoked, and never hits the DO', async () => {
  const m = makeEnv(okResp);
  const { request, url } = reqUrl('');
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'revoked');
  assert.equal(m.state.calls, 0);
});
test('appAuthOk: /ws is exempt → ok (WS auth is delegated to the DO handleSession)', async () => {
  const m = makeEnv(() => { throw new Error('should not be called for /ws'); });
  const { request, url } = reqUrl('tok-ws-' + Math.random(), '/ws');
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'ok');
  assert.equal(m.state.calls, 0, '/ws must not hit the outer /auth/check at all');
});
test('appAuthOk: migration mode (AUTH_ENFORCED != "true") → ok, no DO call', async () => {
  const m = makeEnv(() => { throw new Error('should not be called in migration mode'); }, 'false');
  const { request, url } = reqUrl('tok-mig-' + Math.random());
  assert.equal(await appAuthOk(request, url, m.env, 'muse'), 'ok');
  assert.equal(m.state.calls, 0);
});
