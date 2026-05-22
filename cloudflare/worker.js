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

// ── Durable Object ─────────────────────────────────────────────────────────────
// One instance per salon (keyed by idFromName('muse')).
// Stateless broadcast hub — no persistent state, just relays messages to all
// connected WebSocket clients so queue/config changes are instant across devices.
// Sheets remains the durable source of truth; the DO just eliminates poll lag.
export class MuseSalonDO {
  constructor(state, env) {
    this.sockets = new Set();
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair             = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws) {
    ws.accept();
    this.sockets.add(ws);

    ws.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        return;
      }

      // Broadcast to all OTHER connected clients (1 = WebSocket.OPEN)
      for (const socket of this.sockets) {
        if (socket !== ws && socket.readyState === 1) {
          try { socket.send(data); } catch {}
        }
      }
    });

    ws.addEventListener('close', () => this.sockets.delete(ws));
    ws.addEventListener('error', () => this.sockets.delete(ws));
  }
}
