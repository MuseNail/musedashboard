// ── Cloudflare Worker — musedashboard ─────────────────────────────────────────
//
// Routes
//   GET/POST/PUT /square/*  — CORS proxy → Square API
//   PUT      /photos/{key}  — Upload binary to R2, returns { url }
//   GET      /photos/{key}  — Serve object from R2 (used as <img src>)
//   DELETE   /photos/{key}  — Delete object from R2
//   /ws, /state/*           — Durable Object sync (source of truth)
//
// Backups: the Durable Object periodically snapshots full state to R2 (see alarm()).
//
// Required secrets (set via: wrangler secret put <NAME>)
//   SQUARE_TOKEN         Square access token
//   RESTORE_TOKEN        (optional) gates /state/restore and /state/reset
//   ORIGIN_GATE_ENABLED  (optional) "true" turns on the Origin allow-list gate (default off)
//   ALLOWED_ORIGINS      (optional) extra comma-separated origins to allow (prod origin is built in)
//
// Optional environment variables (wrangler.toml [vars])
//   SQUARE_BASE_URL Defaults to https://connect.squareup.com
//
// Required R2 binding (wrangler.toml)
//   [[r2_buckets]]
//   binding     = "PHOTOS_BUCKET"
//   bucket_name = "musedashboard-photos"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function corsHeaders(extra = {}) {
  return new Headers({ ...CORS_HEADERS, ...extra });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' }),
  });
}

// Stale-write guard: true when the stored copy is strictly NEWER (by updatedAt) than an
// incoming write — so a lingering stale device copy can't clobber a good queue entry / record
// (the fee-drop root cause). Writes missing a timestamp on either side are never treated as stale.
function _isStaleWrite(prev, next) {
  return !!(prev && next && typeof prev.updatedAt === 'number' && typeof next.updatedAt === 'number' && prev.updatedAt > next.updatedAt);
}

// Normalize a US phone to E.164 (+1XXXXXXXXXX) for httpSMS. Returns null if it isn't a
// usable 10/11-digit US number (so we never send to a malformed recipient).
function toE164(raw) {
  const s = String(raw || '').trim();
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (s.startsWith('+') && d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

// ── Web Push (VAPID) helpers ────────────────────────────────────────────────────
// Payload-less push: only a VAPID JWT (ES256) is needed — no aes128gcm body
// encryption. (Pure helpers exported for unit tests.)
export function b64urlFromBytes(bytes) {
  const b = new Uint8Array(bytes); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlFromStr(str) { return b64urlFromBytes(new TextEncoder().encode(str)); }
export function vapidJwtUnsigned(aud, sub, expSec) {
  return b64urlFromStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
         b64urlFromStr(JSON.stringify({ aud, exp: expSec, sub }));
}
async function vapidJwt(privJwkStr, aud, sub) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privJwkStr), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const unsigned = vapidJwtUnsigned(aud, sub, Math.floor(Date.now() / 1000) + 12 * 3600);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64urlFromBytes(sig);   // WebCrypto ECDSA = raw r‖s, exactly what ES256 wants
}
async function pushKeyHash(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Origin gate (OFF by default; flip on live via the ORIGIN_GATE_ENABLED secret) ──
// When enabled, browser requests from a non-allowed Origin get 403. Requests with
// NO Origin header (server-to-server, <img> loads, curl, the cron) always pass —
// origin-gating only deters other websites, not non-browser clients (real fix =
// token auth, T2.12). Safe rollout: deploy with the gate OFF (this is a no-op),
// then `wrangler secret put ORIGIN_GATE_ENABLED` = "true" and immediately verify
// the app still syncs. Set it back to "false" (or delete it) to disable instantly
// — live, no redeploy — if anything can't connect.
function originAllowed(request, env) {
  if (String(env.ORIGIN_GATE_ENABLED || '').toLowerCase() !== 'true') return true; // gate off
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser / same-origin / image / cron
  const allow = new Set(
    ['https://musenail.github.io',
     ...String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]
      .map(s => s.toLowerCase())
  );
  return allow.has(origin.toLowerCase());
}

export default {
  async fetch(request, env) {
    // Top-level guard: any unhandled throw is logged (visible in Workers Logs /
    // `wrangler tail`) and returned as a clean CORS 500 instead of an opaque crash.
    try {
      return await this._handle(request, env);
    } catch (e) {
      let p = '?'; try { p = new URL(request.url).pathname; } catch {}
      console.error('[fetch] unhandled', request.method, p, '-', (e && e.message) || String(e));
      return json({ error: 'internal error' }, 500);
    }
  },

  async _handle(request, env) {
    const url     = new URL(request.url);
    const path    = url.pathname;
    const method  = request.method.toUpperCase();
    // Multi-salon: each location gets its own DO instance. Defaults to 'muse'
    // so existing clients (which send no ?salon=) are unaffected.
    const salonId = url.searchParams.get('salon') || 'muse';

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Origin gate (no-op unless ORIGIN_GATE_ENABLED = "true"). Covers /ws, /state,
    // /square, /photos, /backup — all share the same allow-list.
    if (!originAllowed(request, env)) return json({ error: 'forbidden origin' }, 403);

    // ── R2 Photo Routes ───────────────────────────────────────────────────────
    if (path.startsWith('/photos/')) {
      const key = path.slice('/photos/'.length);
      if (!key) return json({ error: 'Missing photo key' }, 400);

      if (method === 'PUT') {
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const body        = await request.arrayBuffer();
        await env.PHOTOS_BUCKET.put(key, body, {
          httpMetadata: { contentType },
        });
        const photoUrl = `${url.origin}/photos/${key}`;
        return json({ success: true, url: photoUrl });
      }

      if (method === 'GET') {
        const object = await env.PHOTOS_BUCKET.get(key);
        if (!object) return new Response('Not found', { status: 404, headers: corsHeaders() });
        const headers = corsHeaders({
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag':          object.etag,
        });
        object.writeHttpMetadata(headers);
        return new Response(object.body, { headers });
      }

      if (method === 'DELETE') {
        await env.PHOTOS_BUCKET.delete(key);
        return json({ success: true });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    // ── WebSocket / Durable Object Route ─────────────────────────────────────
    if (path === '/ws') {
      const id   = env.SALON_DO.idFromName(salonId);
      const stub = env.SALON_DO.get(id);
      return stub.fetch(request);
    }

    // ── App State (Durable Object source of truth) ───────────────────────────
    // GET  /state/snapshot  → full state snapshot { state, seq, schemaVersion }
    // POST /state/mutate    → apply a mutation { op, payload, mutationId } → { applied, seq }
    // HTTP fallback for the new client; the DO also serves these over /ws.
    if (path.startsWith('/state/')) {
      const id    = env.SALON_DO.idFromName(salonId);
      const stub  = env.SALON_DO.get(id);
      const doRes = await stub.fetch(request);
      if (doRes.status >= 500) console.error('[state]', method, path, '->', doRes.status);
      // Re-wrap with CORS so cross-origin clients (GitHub Pages, local dev) are allowed.
      const body  = await doRes.text();
      return new Response(body, {
        status:  doRes.status,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Web Push (Muse Staff notifications) ──────────────────────────────────────
    // POST /push/subscribe | /push/unsubscribe — register a tech's push subscription.
    // Forwarded to the DO (same pattern as /state), re-wrapped with CORS.
    if (path.startsWith('/push/')) {
      const stub  = env.SALON_DO.get(env.SALON_DO.idFromName(salonId));
      const doRes = await stub.fetch(request);
      const body  = await doRes.text();
      return new Response(body, { status: doRes.status, headers: corsHeaders({ 'Content-Type': 'application/json' }) });
    }

    // ── AI analytics (Google Gemini) ────────────────────────────────────────────
    // POST /ai/ask { question, data } → Gemini generateContent. The API key is held
    // server-side as a secret (GEMINI_API_KEY) so it never ships in the public PWA.
    // Owner setup: `wrangler secret put GEMINI_API_KEY` (free-tier key from aistudio.google.com).
    if (path === '/ai/ask' && method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'AI not configured' }, 503);
      let body = {}; try { body = await request.json(); } catch {}
      const question = String(body.question || '').slice(0, 2000);
      const data     = String(body.data || '').slice(0, 24000);
      if (!question) return json({ error: 'No question' }, 400);
      const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
      const prompt = `You are a concise analytics assistant for a nail salon. Answer the owner's question using ONLY the data below. Give specific numbers, be brief, and say if the data can't answer it.\n\nDATA:\n${data}\n\nQUESTION: ${question}`;
      try {
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        const gJson = await gRes.json();
        if (!gRes.ok) { console.warn('[ai]', gRes.status); return json({ error: gJson.error?.message || 'AI request failed' }, gRes.status); }
        const answer = (gJson.candidates?.[0]?.content?.parts || []).map(p => p.text).join('').trim();
        return json({ answer: answer || 'No answer returned.' });
      } catch (e) { return json({ error: 'AI service unreachable' }, 502); }
    }

    // ── SMS via httpSMS (Android phone gateway) ─────────────────────────────────
    // The shop's Android phone runs the httpSMS app; texts are sent through it via the
    // httpSMS cloud API. Secrets (owner: `wrangler secret put …`, never shipped in the PWA):
    //   HTTPSMS_API_KEY  — from httpsms.com/settings
    //   HTTPSMS_FROM     — the phone's number, +1XXXXXXXXXX (the "from" on every text)
    if (path === '/sms/status' && method === 'GET') {
      return json({ configured: !!(env.HTTPSMS_API_KEY && env.HTTPSMS_FROM), from: env.HTTPSMS_FROM || null });
    }
    if (path === '/sms/send' && method === 'POST') {
      if (!env.HTTPSMS_API_KEY || !env.HTTPSMS_FROM) return json({ error: 'SMS not configured' }, 503);
      let body = {}; try { body = await request.json(); } catch {}
      const to = toE164(body.to);
      const content = String(body.content || '').replace(/\s+$/,'').slice(0, 1000).trim();
      if (!to) return json({ error: 'Invalid recipient number' }, 400);
      if (!content) return json({ error: 'Empty message' }, 400);
      try {
        const r = await fetch('https://api.httpsms.com/v1/messages/send', {
          method: 'POST',
          headers: { 'x-api-key': env.HTTPSMS_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.HTTPSMS_FROM, to, content }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { console.warn('[sms]', r.status, j?.message || ''); return json({ error: j?.message || 'Send failed', status: r.status }, r.status); }
        return json({ sent: true, to, id: j?.data?.id || null });
      } catch (e) { return json({ error: 'SMS service unreachable' }, 502); }
    }
    // Delivery status for a sent message. httpSMS ACCEPTS a message immediately (the /send
    // response only means "queued to the phone"); the actual SMS can still FAIL on the phone
    // afterwards (e.g. Samsung "generic failure"). This lets the dashboard show the real
    // phone-side outcome (status + failure reason) instead of guessing it succeeded.
    if (path.startsWith('/sms/message/') && method === 'GET') {
      if (!env.HTTPSMS_API_KEY) return json({ error: 'SMS not configured' }, 503);
      const id = decodeURIComponent(path.slice('/sms/message/'.length));
      if (!id) return json({ error: 'Missing message id' }, 400);
      try {
        const r = await fetch('https://api.httpsms.com/v1/messages/' + encodeURIComponent(id), {
          headers: { 'x-api-key': env.HTTPSMS_API_KEY },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return json({ error: j?.message || 'Lookup failed', status: r.status }, r.status);
        const d = j?.data || {};
        return json({ id: d.id || id, status: d.status || 'unknown', failureReason: d.failure_reason || d.failed_reason || null, sendAttemptCount: d.send_attempt_count ?? null });
      } catch (e) { return json({ error: 'SMS service unreachable' }, 502); }
    }

    // ── Square Proxy ──────────────────────────────────────────────────────────
    if (path.startsWith('/square')) {
      const squareBase = env.SQUARE_BASE_URL || 'https://connect.squareup.com';
      const squarePath = path.replace(/^\/square/, '') || '/';
      const squareUrl  = squareBase + squarePath + (url.search || '');

      const headers = new Headers(request.headers);
      headers.set('Authorization',  `Bearer ${env.SQUARE_TOKEN}`);
      headers.set('Square-Version', '2024-11-20');
      headers.set('Content-Type',   'application/json');
      // Strip browser-context headers so Square sees a clean server-to-server call.
      // Forwarding Origin/Referer causes Square to reject certain endpoints (e.g. catalog)
      // with "invalid cross-origin request".
      headers.delete('host');
      headers.delete('origin');
      headers.delete('referer');

      const hasBody = method !== 'GET' && method !== 'HEAD';
      const upstream = await fetch(squareUrl, {
        method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
      });

      // Log non-2xx Square responses by status + path only (never bodies/headers —
      // they carry tokens + customer PII) so API failures are diagnosable.
      if (upstream.status >= 400) console.warn('[square]', method, squarePath, '->', upstream.status);
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status:  upstream.status,
        headers: corsHeaders({
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        }),
      });
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── Durable Object — Single Source of Truth ─────────────────────────────────────
// One instance per salon (keyed by idFromName(salonId), default 'muse'). Holds canonical app state
// in SQLite-backed DO storage (state.storage.*). Single writer ⇒ atomic per-key
// writes, no blob overwrite, no conflict guards. Clients hydrate via `snapshot`
// and mutate via typed `mutate` messages; changes broadcast to all peers.
//
// Storage key layout:
//   config:<field>   one key per config field (staff, services, turns_order, …)
//   queue:<id>       live queue entries
//   record:<id>      transaction records
//   giftcard:<id>    gift cards
//   deletion:<id>    soft-delete markers
//   mut:<mutationId> idempotency markers (value = seq); pruned in alarm()
//   meta:seq         monotonic change counter
//
// Wire protocol (over /ws, JSON):
//   client→DO: {type:'hello'} | {type:'mutate',op,payload,mutationId,device} | {type:'ping'}
//   DO→client: {type:'snapshot',state,seq} | {type:'applied',mutationId,seq}
//              | {type:'change',op,payload,seq,device} | {type:'pong'}
// HTTP fallback: GET /state/snapshot, POST /state/mutate.
//
// During the v2.00 transition the DO ALSO relays any legacy message verbatim
// (the current production client sends {type:'queue'|'config'}), so the live app
// keeps working until the new client cuts over. Remove the legacy relay after cutover.
export class MuseSalonDO {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    this.sockets = new Set();
    this.SCHEMA_VERSION = 1;
    this.BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
  }

  async fetch(request) {
    const url     = new URL(request.url);
    const upgrade = request.headers.get('Upgrade');

    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      const pair             = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.handleSession(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP fallback API (used by the client when the WebSocket is unavailable)
    if (url.pathname === '/state/snapshot') {
      const snap = await this.buildSnapshot();
      return new Response(JSON.stringify(snap), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/state/mutate' && request.method === 'POST') {
      let msg;
      try { msg = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 }); }
      const res = await this.applyMutation(msg, null);
      return new Response(JSON.stringify(res), {
        status: res.error ? 400 : 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/state/backups') {
      return new Response(JSON.stringify(await this.listBackups()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/state/backup-now' && request.method === 'POST') {
      return new Response(JSON.stringify(await this.backupNow()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/state/restore' && request.method === 'POST') {
      let body = {}; try { body = await request.json(); } catch {}
      if (!body.confirm) return new Response(JSON.stringify({ error: 'restore requires { confirm: true }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      if (this.env.RESTORE_TOKEN && body.token !== this.env.RESTORE_TOKEN) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      const res = await this.restoreFromBackup(body.key);
      return new Response(JSON.stringify(res), { status: res.error ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Factory reset: wipe ALL state to an empty system. Token-gated + requires
    // { confirm:true }. Takes a safety snapshot to R2 first (recoverable via /state/restore).
    if (url.pathname === '/state/reset' && request.method === 'POST') {
      let body = {}; try { body = await request.json(); } catch {}
      if (!body.confirm) return new Response(JSON.stringify({ error: 'reset requires { confirm: true }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      if (this.env.RESTORE_TOKEN && body.token !== this.env.RESTORE_TOKEN) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      const res = await this.factoryReset();
      return new Response(JSON.stringify(res), { status: res.error ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Web Push subscriptions (per tech) ───────────────────────────────────────
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      let body = {}; try { body = await request.json(); } catch {}
      const { techId, subscription } = body;
      if (!techId || !subscription || !subscription.endpoint) return new Response(JSON.stringify({ error: 'techId + subscription required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const hash = await pushKeyHash(subscription.endpoint);
      await this.state.storage.put('push:' + techId + ':' + hash, subscription);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      let body = {}; try { body = await request.json(); } catch {}
      if (body.techId && body.endpoint) await this.state.storage.delete('push:' + body.techId + ':' + (await pushKeyHash(body.endpoint)));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Expected WebSocket upgrade or /state/*', { status: 426 });
  }

  // Send a payload-less push to every device subscribed for this tech; prune dead subs.
  async sendPushToTech(techId) {
    if (!this.env.VAPID_PRIVATE_KEY) return;
    const subs = await this.state.storage.list({ prefix: 'push:' + techId + ':' });
    if (subs.size === 0) return;
    const subject = this.env.VAPID_SUBJECT || 'mailto:admin@musenailandspa.com';
    const pub = this.env.VAPID_PUBLIC_KEY || '';
    await Promise.all([...subs.entries()].map(async ([key, sub]) => {
      try {
        if (!sub || !sub.endpoint) { await this.state.storage.delete(key); return; }
        const jwt = await vapidJwt(this.env.VAPID_PRIVATE_KEY, new URL(sub.endpoint).origin, subject);
        const res = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: `vapid t=${jwt}, k=${pub}`, TTL: '2592000' } });
        if (res.status === 404 || res.status === 410) await this.state.storage.delete(key);   // subscription gone
        else if (!res.ok) console.warn('[push]', res.status, 'tech', techId);
      } catch (e) { console.error('[push] send failed:', (e && e.message) || String(e)); }
    }));
  }

  // On a queue.upsert, notify any tech whose techId is NEWLY assigned (present now,
  // absent before) — so a price/status edit doesn't re-ping. Best-effort, non-blocking.
  _notifyNewAssignments(prev, entry) {
    try {
      if (entry.status === 'paid' || entry.status === 'done') return;
      const techSet = e => new Set(((e && e.assignments) || []).map(a => a.techId).filter(Boolean));
      const before = techSet(prev), after = techSet(entry);
      for (const t of after) if (!before.has(t)) this.sendPushToTech(t).catch(() => {});
    } catch {}
  }

  handleSession(ws) {
    ws.accept();
    this.sockets.add(ws);

    ws.addEventListener('message', async ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        return;
      }

      // New protocol: hydrate
      if (msg.type === 'hello') {
        const snap = await this.buildSnapshot();
        try { ws.send(JSON.stringify({ type: 'snapshot', state: snap.state, seq: snap.seq, schemaVersion: snap.schemaVersion })); } catch {}
        return;
      }

      // New protocol: mutate (apply → ack sender → broadcast change to peers)
      if (msg.type === 'mutate') {
        const res = await this.applyMutation(msg, ws);
        try { ws.send(JSON.stringify({ type: 'applied', mutationId: msg.mutationId, seq: res.seq, error: res.error })); } catch {}
        return;
      }

      // Legacy relay — current production client ({type:'queue'|'config'}).
      // Broadcast verbatim to all OTHER clients. Remove after cutover.
      for (const socket of this.sockets) {
        if (socket !== ws && socket.readyState === 1) {
          try { socket.send(data); } catch {}
        }
      }
    });

    ws.addEventListener('close', () => this.sockets.delete(ws));
    ws.addEventListener('error', () => this.sockets.delete(ws));
  }

  async nextSeq() {
    const cur  = (await this.state.storage.get('meta:seq')) || 0;
    const next = cur + 1;
    await this.state.storage.put('meta:seq', next);
    return next;
  }

  // Apply a mutation to storage, stamp a seq, dedupe by mutationId, broadcast.
  async applyMutation(msg, fromWs) {
    const { op, payload, mutationId } = msg || {};
    if (!op || !payload) return { error: 'missing op or payload' };

    // Idempotency: a replayed mutation (offline outbox) returns the original seq.
    if (mutationId) {
      const seen = await this.state.storage.get('mut:' + mutationId);
      if (seen) return { applied: true, seq: seen, dedup: true };
    }

    let stale = false;
    try {
      switch (op) {
        case 'config.set': {
          // Stale-write guard for config (mirrors queue/record): reject a write strictly OLDER than
          // the stored value for this key, so a stale offline-outbox replay can't revert the catalog /
          // turns roster / settings and re-broadcast the regression. Unstamped/equal writes apply.
          const cts = (typeof payload.updatedAt === 'number') ? payload.updatedAt : null;
          if (cts != null) {
            const prevMeta = await this.state.storage.get('cfgmeta:' + payload.key);
            if (prevMeta && typeof prevMeta.updatedAt === 'number' && cts < prevMeta.updatedAt) { stale = true; break; }
          }
          await this.state.storage.put('config:' + payload.key, payload.value);
          if (cts != null) await this.state.storage.put('cfgmeta:' + payload.key, { updatedAt: cts, updatedBy: payload.updatedBy || null });
          break;
        }
        case 'queue.upsert': {
          const qKey = 'queue:' + payload.entry.id;
          const prevEntry = await this.state.storage.get(qKey);
          if (_isStaleWrite(prevEntry, payload.entry)) { stale = true; break; }   // older copy — don't clobber a newer one
          await this.state.storage.put(qKey, payload.entry);
          this._notifyNewAssignments(prevEntry, payload.entry);   // push to newly-assigned techs (best-effort)
          break;
        }
        case 'queue.remove':
          await this.state.storage.delete('queue:' + payload.id);
          break;
        case 'record.save': {
          const rKey = 'record:' + payload.record.id;
          // Never revive a deleted transaction: a stale paid queue copy on another device can
          // re-fire saveRecord with a fresh updatedAt that passes the stale-write guard. Reject if
          // a deletion marker exists, so a restore from R2 can't bring the deleted sale back.
          if (await this.state.storage.get('deletion:' + payload.record.id)) { stale = true; break; }
          const prevRec = await this.state.storage.get(rKey);
          if (_isStaleWrite(prevRec, payload.record)) { stale = true; break; }   // older copy — keep the newer record (prevents fee-drop)
          await this.state.storage.put(rKey, payload.record);
          break;
        }
        case 'record.delete': {
          const existing = await this.state.storage.get('record:' + payload.id);
          if (existing) await this.state.storage.put('record:' + payload.id, { ...existing, status: 'deleted' });
          await this.state.storage.put('deletion:' + payload.id, {
            id: payload.id, reason: payload.reason || '', by: payload.by || '', at: new Date().toISOString(),
          });
          break;
        }
        case 'giftcard.save':
          await this.state.storage.put('giftcard:' + payload.card.id, payload.card);
          break;
        case 'giftcard.delete':
          await this.state.storage.delete('giftcard:' + payload.id);
          break;
        case 'audit.log': {
          // Append-only activity log (who/when/device/action). Each event is its own key
          // so concurrent writes never clobber. Probabilistically prune to the last ~1000.
          if (payload && payload.event && payload.event.id) {
            await this.state.storage.put('audit:' + payload.event.id, payload.event);
            if (Math.random() < 0.1) {
              const keys = [...(await this.state.storage.list({ prefix: 'audit:' })).keys()].sort();
              if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 1000)) await this.state.storage.delete(k);
            }
          }
          break;
        }
        default:
          console.warn('[mutate] unknown op:', op);
          return { error: 'unknown op: ' + op };
      }
    } catch (e) {
      console.error('[mutate]', op, 'failed:', (e && e.message) || String(e));
      return { error: 'apply failed: ' + (e && e.message || String(e)) };
    }

    if (stale) {
      // Older-than-stored write: don't persist or broadcast it (peers keep the newer value).
      // Still ack the sender (record the mutationId) so it doesn't retry the stale op forever.
      const seq = await this.nextSeq();
      if (mutationId) await this.state.storage.put('mut:' + mutationId, seq);
      return { applied: true, seq, stale: true };
    }

    const seq = await this.nextSeq();
    if (mutationId) await this.state.storage.put('mut:' + mutationId, seq);

    // Broadcast the change to every OTHER connected client.
    const change = JSON.stringify({ type: 'change', op, payload, seq, device: msg.device || null });
    for (const socket of this.sockets) {
      if (socket !== fromWs && socket.readyState === 1) {
        try { socket.send(change); } catch {}
      }
    }

    await this.ensureBackupScheduled();
    return { applied: true, seq };
  }

  // Assemble the full state from storage (prefix scans skip mut:/meta: keys).
  async buildSnapshot() {
    const state = { config: {}, configMeta: {}, queue: [], records: [], giftcards: [], deletions: [], audit: [] };
    const cfg = await this.state.storage.list({ prefix: 'config:' });
    for (const [k, v] of cfg) state.config[k.slice('config:'.length)] = v;
    const cm = await this.state.storage.list({ prefix: 'cfgmeta:' });
    for (const [k, v] of cm) state.configMeta[k.slice('cfgmeta:'.length)] = v;
    const q = await this.state.storage.list({ prefix: 'queue:' });
    for (const [, v] of q) state.queue.push(v);
    const r = await this.state.storage.list({ prefix: 'record:' });
    for (const [, v] of r) state.records.push(v);
    const g = await this.state.storage.list({ prefix: 'giftcard:' });
    for (const [, v] of g) state.giftcards.push(v);
    const d = await this.state.storage.list({ prefix: 'deletion:' });
    for (const [, v] of d) state.deletions.push(v);
    const al = await this.state.storage.list({ prefix: 'audit:' });
    for (const [, v] of al) state.audit.push(v);
    // Newest first, capped so the snapshot payload stays lean (full history lives in the DO).
    state.audit.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    state.audit = state.audit.slice(0, 500);
    const seq = (await this.state.storage.get('meta:seq')) || 0;
    return { state, seq, schemaVersion: this.SCHEMA_VERSION };
  }

  async ensureBackupScheduled() {
    const cur = await this.state.storage.getAlarm();
    if (cur === null) await this.state.storage.setAlarm(Date.now() + this.BACKUP_INTERVAL_MS);
  }

  // Periodic backup of the full snapshot to R2 + idempotency-marker pruning.
  async alarm() {
    try {
      const snap = await this.buildSnapshot();
      const ts   = new Date().toISOString().replace(/[:.]/g, '-');
      if (this.env.PHOTOS_BUCKET) {
        await this.env.PHOTOS_BUCKET.put('backups/state-' + ts + '.json', JSON.stringify(snap), {
          httpMetadata: { contentType: 'application/json' },
        });
      }
      // Bound the idempotency markers: keep the newest ~2000 by seq.
      const muts = await this.state.storage.list({ prefix: 'mut:' });
      if (muts.size > 4000) {
        const sorted   = [...muts.entries()].sort((a, b) => a[1] - b[1]); // oldest seq first
        const toDelete = sorted.slice(0, sorted.length - 2000).map(e => e[0]);
        for (let i = 0; i < toDelete.length; i += 128) {
          await this.state.storage.delete(toDelete.slice(i, i + 128));
        }
      }
    } catch (e) { console.error('[alarm] backup failed:', (e && e.message) || String(e)); }   // best-effort; re-armed below
    await this.state.storage.setAlarm(Date.now() + this.BACKUP_INTERVAL_MS);
  }

  // List the timestamped snapshots in R2 (newest first).
  async listBackups() {
    if (!this.env.PHOTOS_BUCKET) return { backups: [], count: 0 };
    const listed = await this.env.PHOTOS_BUCKET.list({ prefix: 'backups/' });
    const backups = (listed.objects || [])
      .map(o => ({ key: o.key, uploaded: o.uploaded, size: o.size }))
      .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    return { backups, count: backups.length };
  }

  // Force a snapshot to R2 right now (used for testing + before a restore).
  async backupNow() {
    const snap = await this.buildSnapshot();
    const key  = 'backups/state-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    if (this.env.PHOTOS_BUCKET) await this.env.PHOTOS_BUCKET.put(key, JSON.stringify(snap), { httpMetadata: { contentType: 'application/json' } });
    return { backedUp: true, key, seq: snap.seq };
  }

  // Disaster recovery: replace ALL state with a backup snapshot from R2.
  // Takes a safety snapshot of current state first, then broadcasts the
  // restored state to every connected client.
  async restoreFromBackup(key) {
    if (!this.env.PHOTOS_BUCKET) return { error: 'no backup storage configured' };
    let useKey = key;
    if (!useKey) { const l = await this.listBackups(); useKey = l.backups[0]?.key; }
    if (!useKey) return { error: 'no backup found' };
    const obj = await this.env.PHOTOS_BUCKET.get(useKey);
    if (!obj) return { error: 'backup not found: ' + useKey };
    let snap; try { snap = JSON.parse(await obj.text()); } catch { return { error: 'backup is not valid JSON' }; }
    const st = snap.state || {};
    await this.backupNow();                           // safety snapshot before wiping
    await this.state.storage.deleteAll();
    for (const [k, v] of Object.entries(st.config || {})) await this.state.storage.put('config:' + k, v);
    for (const e of (st.queue || []))     await this.state.storage.put('queue:' + String(e.id), e);
    for (const r of (st.records || []))   await this.state.storage.put('record:' + String(r.id), r);
    for (const g of (st.giftcards || [])) await this.state.storage.put('giftcard:' + String(g.id), g);
    for (const d of (st.deletions || [])) await this.state.storage.put('deletion:' + String(d.id), d);
    await this.state.storage.put('meta:seq', (snap.seq || 0) + 1);
    await this.ensureBackupScheduled();
    const fresh = await this.buildSnapshot();
    const payload = JSON.stringify({ type: 'snapshot', state: fresh.state, seq: fresh.seq, schemaVersion: fresh.schemaVersion });
    for (const socket of this.sockets) { if (socket.readyState === 1) { try { socket.send(payload); } catch {} } }
    return { restored: true, key: useKey, counts: { config: Object.keys(st.config||{}).length, queue: (st.queue||[]).length, records: (st.records||[]).length, giftcards: (st.giftcards||[]).length } };
  }

  // Factory reset: wipe ALL state to an empty system, after a safety snapshot to
  // R2 (recoverable via /state/restore). Broadcasts the empty snapshot so any
  // connected client clears immediately.
  async factoryReset() {
    const safety = await this.backupNow();            // recovery point before wiping
    await this.state.storage.deleteAll();
    await this.state.storage.put('meta:seq', 1);
    await this.ensureBackupScheduled();
    const fresh = await this.buildSnapshot();
    const payload = JSON.stringify({ type: 'snapshot', state: fresh.state, seq: fresh.seq, schemaVersion: fresh.schemaVersion });
    for (const socket of this.sockets) { if (socket.readyState === 1) { try { socket.send(payload); } catch {} } }
    return { reset: true, seq: fresh.seq, safetyBackup: safety.key };
  }
}
