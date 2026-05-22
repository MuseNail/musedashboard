// ── Durable Object Sync Client ──────────────────────────────────────────────
// The client's only link to the source of truth (MuseSalonDO). Connects over a
// WebSocket, hydrates the store from a snapshot, applies remote `change`
// broadcasts, and sends local mutations. Writes are optimistic + queued in a
// persistent outbox, so the front desk keeps working through wifi drops; the
// outbox replays on reconnect and the DO dedupes by mutationId.

import { hydrate, applyChange, setConnection, loadCache } from './store.js';

const PROD_ORIGIN = 'https://musedashboard.musenailandspa.workers.dev';
// When served from localhost (a static server in front of `wrangler dev`), talk to
// the local Worker on :8787; otherwise the production Worker.
const ORIGIN = (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))
  ? 'http://localhost:8787'
  : PROD_ORIGIN;
const WS_URL     = ORIGIN.replace(/^http/, 'ws') + '/ws';
const STATE      = ORIGIN + '/state';
const OUTBOX_KEY = 'muse_outbox';

export const DEVICE_ID = (() => {
  let id = localStorage.getItem('muse_device_id');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 8); localStorage.setItem('muse_device_id', id); }
  return id;
})();

let _ws = null, _connected = false, _reconnect = null, _ping = null, _mutCounter = 0;
let _outbox = loadOutbox();

function loadOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } }
function saveOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(_outbox)); } catch {}
  setConnection(_connected, _outbox.length);
}
function enqueue(msg)        { _outbox.push(msg); saveOutbox(); }
function ackOutbox(id)       { const i = _outbox.findIndex(m => m.mutationId === id); if (i >= 0) { _outbox.splice(i, 1); saveOutbox(); } }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start() {
  loadCache();                                   // instant render from last snapshot
  connect();
  setTimeout(() => { if (!_connected) httpSnapshot(); }, 2500); // WS slow/blocked → HTTP hydrate
}

function connect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  try { _ws = new WebSocket(WS_URL); } catch { scheduleReconnect(); return; }

  _ws.onopen = () => {
    _connected = true;
    setConnection(true, _outbox.length);
    send({ type: 'hello' });
    _ping = setInterval(() => send({ type: 'ping' }), 20000);
  };
  _ws.onmessage = ({ data }) => { let msg; try { msg = JSON.parse(data); } catch { return; } handle(msg); };
  _ws.onclose = _ws.onerror = () => {
    _connected = false;
    setConnection(false, _outbox.length);
    clearInterval(_ping); _ping = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (_reconnect) return;
  _reconnect = setTimeout(() => { _reconnect = null; connect(); }, 3000);
}

function send(obj) {
  try { if (_ws && _ws.readyState === WebSocket.OPEN) { _ws.send(JSON.stringify(obj)); return true; } } catch {}
  return false;
}

function handle(msg) {
  if (msg.type === 'pong') return;
  if (msg.type === 'snapshot') { hydrate({ state: msg.state, seq: msg.seq }); replayOutbox(); return; }
  if (msg.type === 'applied') {
    if (msg.error) console.warn('[sync] mutation rejected:', msg.error, msg.mutationId);
    ackOutbox(msg.mutationId);
    return;
  }
  if (msg.type === 'change') {
    if (msg.device && msg.device === DEVICE_ID) return; // our own echo (already applied optimistically)
    applyChange(msg.op, msg.payload, msg.seq);
    return;
  }
}

function replayOutbox() { for (const msg of _outbox) send(msg); } // DO dedupes by mutationId

// ── Public: dispatch a mutation (optimistic local apply + queued send) ──────────
// op: 'config.set' | 'turns.order' | 'queue.upsert' | 'queue.remove'
//   | 'record.save' | 'record.delete' | 'giftcard.save' | 'giftcard.delete'
export function dispatch(op, payload) {
  const mutationId = DEVICE_ID + '-' + Date.now() + '-' + (++_mutCounter);
  applyChange(op, payload);                                  // optimistic
  const msg = { type: 'mutate', op, payload, mutationId, device: DEVICE_ID };
  enqueue(msg);
  if (!send(msg)) httpMutate(msg);                           // WS down → HTTP fallback (idempotent)
}

// ── HTTP fallbacks (used when the WebSocket is unavailable) ─────────────────────
async function httpSnapshot() {
  try {
    const res = await fetch(STATE + '/snapshot', { cache: 'no-store' });
    if (!res.ok) return;
    hydrate(await res.json());
    replayOutbox();
  } catch (e) { /* offline — the localStorage cache already rendered */ }
}

async function httpMutate(msg) {
  try {
    const res = await fetch(STATE + '/mutate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
    });
    if (res.ok) { const d = await res.json(); if (d.applied) ackOutbox(msg.mutationId); }
  } catch (e) { /* stays in outbox for WebSocket replay on reconnect */ }
}
