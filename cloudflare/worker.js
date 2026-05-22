// ── Cloudflare Worker — musedashboard ─────────────────────────────────────────
//
// Routes
//   GET/POST /sheets        — CORS proxy → Google Apps Script doPost
//   GET/POST/PUT /square/*  — CORS proxy → Square API
//   PUT      /photos/{key}  — Upload binary to R2, returns { url }
//   GET      /photos/{key}  — Serve object from R2 (used as <img src>)
//   DELETE   /photos/{key}  — Delete object from R2
//
// Required secrets (set via: wrangler secret put <NAME>)
//   SHEETS_URL      Google Apps Script doPost endpoint (web app URL)
//   SQUARE_TOKEN    Square access token
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

// Called by the Cron Trigger at 4:05 AM Pacific every night.
// Forwards an archiveDay request to Apps Script, which computes the day's
// stats, sends the Gmail summary, and clears the live queue.
async function _runMidnightArchive(env) {
  const sheetsUrl = (env.SHEETS_URL || '').trim();
  if (!sheetsUrl) return;
  // clientDate in Pacific Time so Apps Script uses the right day
  const clientDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  try {
    const res = await fetch(sheetsUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'archiveDay', clientDate }),
    });
    const data = await res.json();
    console.log('[Cron] archiveDay:', JSON.stringify(data));
  } catch(e) {
    console.error('[Cron] archiveDay failed:', e.message);
  }
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

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
      const id   = env.SALON_DO.idFromName('muse');
      const stub = env.SALON_DO.get(id);
      return stub.fetch(request);
    }

    // ── App State (Durable Object source of truth) ───────────────────────────
    // GET  /state/snapshot  → full state snapshot { state, seq, schemaVersion }
    // POST /state/mutate    → apply a mutation { op, payload, mutationId } → { applied, seq }
    // HTTP fallback for the new client; the DO also serves these over /ws.
    if (path === '/state/snapshot' || path === '/state/mutate') {
      const id    = env.SALON_DO.idFromName('muse');
      const stub  = env.SALON_DO.get(id);
      const doRes = await stub.fetch(request);
      // Re-wrap with CORS so cross-origin clients (GitHub Pages, local dev) are allowed.
      const body  = await doRes.text();
      return new Response(body, {
        status:  doRes.status,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Sheets Proxy ──────────────────────────────────────────────────────────
    if (path === '/sheets' || path === '/sheets/') {
      const sheetsUrl = (env.SHEETS_URL || '').trim();
      if (!sheetsUrl) return json({ error: 'SHEETS_URL not configured' }, 500);

      // Read body once — streams can only be consumed once
      const bodyText   = method === 'POST' ? await request.text() : null;
      let   parsedBody = null;
      if (bodyText) { try { parsedBody = JSON.parse(bodyText); } catch {} }

      const isLoadConfig = method === 'GET' && url.searchParams.get('action') === 'loadConfig';
      const isSaveConfig = parsedBody?.action === 'saveConfig';

      // KV fast path — serve loadConfig from cache, skipping Apps Script entirely
      if (isLoadConfig && env.CONFIG_KV) {
        try {
          const cached = await env.CONFIG_KV.get('config');
          if (cached) {
            return new Response(cached, {
              status:  200,
              headers: corsHeaders({ 'Content-Type': 'application/json' }),
            });
          }
        } catch {} // cache miss or KV error — fall through to Apps Script
      }

      const targetUrl = method === 'GET' && url.search
        ? `${sheetsUrl}${url.search}`
        : sheetsUrl;

      const init = { method, headers: { 'Content-Type': 'application/json' } };
      if (bodyText) init.body = bodyText;

      try {
        const upstream = await fetch(targetUrl, init);
        const text     = await upstream.text();

        // KV write-through: keep cache warm after every loadConfig or saveConfig
        if (env.CONFIG_KV && upstream.ok) {
          if (isLoadConfig) {
            // Cache the authoritative Apps Script response (includes recordsUpdatedAt)
            env.CONFIG_KV.put('config', text, { expirationTtl: 86400 });
          } else if (isSaveConfig && parsedBody.config) {
            // Proactively update KV so the next cold start skips Apps Script
            env.CONFIG_KV.put('config', JSON.stringify({
              success:          true,
              config:           parsedBody.config,
              device:           parsedBody.device || '',
              recordsUpdatedAt: null,
            }), { expirationTtl: 86400 });
          }
        }

        return new Response(text, {
          status:  upstream.status,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        });
      } catch(e) {
        return json({ error: 'Sheets proxy error', detail: e.message }, 502);
      }
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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(_runMidnightArchive(env));
  },
};

// ── Durable Object — Single Source of Truth ─────────────────────────────────────
// One instance per salon (keyed by idFromName('muse')). Holds canonical app state
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

    return new Response('Expected WebSocket upgrade or /state/*', { status: 426 });
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

    try {
      switch (op) {
        case 'config.set':
          await this.state.storage.put('config:' + payload.key, payload.value);
          break;
        case 'turns.order':
          await this.state.storage.put('config:turns_order', payload.order);
          break;
        case 'queue.upsert':
          await this.state.storage.put('queue:' + payload.entry.id, payload.entry);
          break;
        case 'queue.remove':
          await this.state.storage.delete('queue:' + payload.id);
          break;
        case 'record.save':
          await this.state.storage.put('record:' + payload.record.id, payload.record);
          break;
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
        default:
          return { error: 'unknown op: ' + op };
      }
    } catch (e) {
      return { error: 'apply failed: ' + (e && e.message || String(e)) };
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
    const state = { config: {}, queue: [], records: [], giftcards: [], deletions: [] };
    const cfg = await this.state.storage.list({ prefix: 'config:' });
    for (const [k, v] of cfg) state.config[k.slice('config:'.length)] = v;
    const q = await this.state.storage.list({ prefix: 'queue:' });
    for (const [, v] of q) state.queue.push(v);
    const r = await this.state.storage.list({ prefix: 'record:' });
    for (const [, v] of r) state.records.push(v);
    const g = await this.state.storage.list({ prefix: 'giftcard:' });
    for (const [, v] of g) state.giftcards.push(v);
    const d = await this.state.storage.list({ prefix: 'deletion:' });
    for (const [, v] of d) state.deletions.push(v);
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
    } catch (e) { /* swallow — backup is best-effort */ }
    await this.state.storage.setAlarm(Date.now() + this.BACKUP_INTERVAL_MS);
  }
}
