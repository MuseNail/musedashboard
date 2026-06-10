// ── Helcim Smart Terminal payments (webhook-driven) ─────────────────────────
// The Worker holds the api-token and drives the terminal; the result returns via the
// /terminal/webhook receiver, which broadcasts a `helcim_result` envelope over the same
// WebSocket the app already holds (sync.js → window.onHelcimResult). chargeOnHelcim() starts
// a purchase and resolves when that broadcast lands — with a fallback poll of /helcim/result
// (covers a missed broadcast / briefly-disconnected socket) and a hard timeout.
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast } from '../utils.js';
import { HELCIM_PROXY } from '../config.js';

const cfg = () => getState().config;
export function helcimDeviceCode() { return String(cfg().helcim_device_code || '').trim(); }

// Which processor the checkout charges cards on. Default 'square' until the operator flips it.
export function activeProcessor() { return cfg().payment_processor === 'helcim' ? 'helcim' : 'square'; }
export function helcimActive() { return activeProcessor() === 'helcim'; }
export function setPaymentProcessor(p) {
  const v = p === 'helcim' ? 'helcim' : 'square';
  dispatch('config.set', { key: 'payment_processor', value: v });
  showToast(v === 'helcim' ? 'Card processor set to Helcim ✓' : 'Card processor set to Square ✓');
  syncProcessorClass(); renderHelcimSettings();
}
// Toggle a body class so CSS can hide Square-only UI (the legacy POS deep-link) when Helcim is
// active. Called on boot, on every store change, and on flip — so it stays accurate cross-device.
export function syncProcessorClass() { try { document.body.classList.toggle('proc-helcim', helcimActive()); } catch {} }

// invoiceNumber → { settle } resolver for an in-flight terminal charge.
const _pending = {};

function _normResult(status, transactionId, amount) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return { ok: true,  status: 'APPROVED',  transactionId: transactionId || null, amount };
  if (s === 'CANCELLED' || s === 'CANCELED') return { ok: false, status: 'CANCELLED', error: 'Cancelled on the terminal.' };
  if (s === 'DECLINED') return { ok: false, status: 'DECLINED', error: 'Card declined — try again.' };
  return null;   // unknown / still pending → ignore (keep waiting)
}

// Called by sync.js when the Worker broadcasts a terminal result.
export function onHelcimResult(msg) {
  const p = _pending[msg && msg.invoiceNumber]; if (!p) return;
  const res = _normResult(msg.status, msg.transactionId, msg.amount);
  if (res) p.settle(res);
}

// Start a terminal purchase; resolve when the result arrives. amountDollars = the FULL amount
// to charge (services + items + tip — tips are entered in-app, never on the device).
export async function chargeOnHelcim(amountDollars, invoiceNumber, opts = {}) {
  const deviceCode = helcimDeviceCode();
  if (!deviceCode)            return { ok: false, error: 'Set your terminal device code in Settings → Payments first.' };
  if (!(amountDollars > 0))   return { ok: false, error: 'Amount must be greater than zero.' };
  if (!invoiceNumber)         return { ok: false, error: 'Missing invoice reference.' };

  // Idempotency (Helcim's purchase call has no idempotency key): if a successful charge already
  // exists for this reference — e.g. a retry after a timeout where the first attempt DID go
  // through — return it instead of charging the card a second time.
  try {
    const r = await fetch(`${HELCIM_PROXY}/result?invoiceNumber=${encodeURIComponent(invoiceNumber)}`);
    const j = await r.json().catch(() => ({}));
    const prior = (j && Array.isArray(j.value)) ? j.value.find(t => String(t.status).toUpperCase() === 'APPROVED') : null;
    if (prior) return { ok: true, status: 'APPROVED', transactionId: prior.transactionId, amount: prior.amount, reused: true };
  } catch {}

  let start;
  try {
    const r = await fetch(`${HELCIM_PROXY}/purchase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode, amount: Number(amountDollars), invoiceNumber, ...(opts.customerCode ? { customerCode: opts.customerCode } : {}) }),
    });
    start = await r.json().catch(() => ({}));
    if (r.status >= 400) return { ok: false, error: start.error || start.message || `Couldn't start the terminal (HTTP ${r.status}).` };
  } catch (e) { return { ok: false, error: 'Network error starting the terminal: ' + (e.message || e) }; }

  const TIMEOUT_MS = opts.timeoutMs || 180000;   // 3 min — customer is interacting with the device
  return await new Promise((resolve) => {
    let done = false, poll = null, hard = null;
    const finish = (res) => { if (done) return; done = true; clearInterval(poll); clearTimeout(hard); delete _pending[invoiceNumber]; resolve(res); };
    _pending[invoiceNumber] = { settle: (res) => res && finish(res) };
    poll = setInterval(async () => {
      try {
        const r = await fetch(`${HELCIM_PROXY}/result?invoiceNumber=${encodeURIComponent(invoiceNumber)}`);
        const j = await r.json().catch(() => ({}));
        const txn = (j && Array.isArray(j.value)) ? j.value[0] : null;
        if (txn) { const res = _normResult(txn.status, txn.transactionId, txn.amount); if (res) finish(res); }
      } catch {}
    }, 3000);
    hard = setTimeout(() => finish({ ok: false, status: 'TIMEOUT', error: 'Timed out — check the terminal and try again.' }), TIMEOUT_MS);
  });
}

// ── Settings → Payments (Helcim) panel ──────────────────────────────────────
export function renderHelcimSettings() {
  const el = document.getElementById('helcim-device-code'); if (el && document.activeElement !== el) el.value = helcimDeviceCode();
  const active = activeProcessor();
  const on  = 'flex-1 px-4 py-2 rounded-xl border font-body font-bold text-sm transition-colors bg-primary text-on-primary border-primary';
  const off = 'flex-1 px-4 py-2 rounded-xl border font-body font-bold text-sm transition-colors bg-surface-container-lowest text-on-surface border-surface-container-high';
  const sb = document.getElementById('helcim-proc-square'); if (sb) sb.className = active === 'square' ? on : off;
  const hb = document.getElementById('helcim-proc-helcim'); if (hb) hb.className = active === 'helcim' ? on : off;
  const st = document.getElementById('helcim-conn-status'); if (st && !st.dataset.touched) st.textContent = helcimDeviceCode() ? `Device ${helcimDeviceCode()} saved.` : 'No terminal device code set.';
}
export function helcimSaveDevice() {
  const v = String(document.getElementById('helcim-device-code')?.value || '').trim().toUpperCase();
  dispatch('config.set', { key: 'helcim_device_code', value: v });
  showToast(v ? `Terminal device ${v} saved ✓` : 'Device code cleared');
  const st = document.getElementById('helcim-conn-status'); if (st) { st.dataset.touched = ''; delete st.dataset.touched; st.textContent = v ? `Device ${v} saved.` : 'No terminal device code set.'; }
}
const _setStatus = (html) => { const st = document.getElementById('helcim-conn-status'); if (st) { st.dataset.touched = '1'; st.innerHTML = html; } };
export async function helcimCheckConnection() {
  _setStatus('Checking…');
  try {
    const r = await fetch(`${HELCIM_PROXY}/ping`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { _setStatus(`<span style="color:#c0392b">Connection failed (HTTP ${r.status}). Check the API token.</span>`); return; }
    const devices = Array.isArray(j) ? j : (Array.isArray(j.devices) ? j.devices : (Array.isArray(j.value) ? j.value : []));
    const codes = devices.map(d => String(d.code || d.deviceCode || d.id || '')).filter(Boolean);
    const want = helcimDeviceCode();
    const found = want && codes.some(c => c.toUpperCase() === want.toUpperCase());
    _setStatus(`<span style="color:#2a7a4f">Connected ✓</span> — terminals: ${codes.join(', ') || '(none returned)'}${want ? (found ? ` · device ${want} found ✓` : ` · <span style="color:#c0392b">device ${want} NOT in the list</span>`) : ''}`);
  } catch (e) { _setStatus(`<span style="color:#c0392b">Error: ${e.message || e}</span>`); }
}
export async function helcimRunTest() {
  if (!helcimDeviceCode()) { showToast('Set the device code first.'); return; }
  const inv = 'test-' + Date.now();
  _setStatus('Starting <b>$1.00</b> test charge — finish on the terminal…');
  showToast('Test charge started — complete it on the terminal');
  const res = await chargeOnHelcim(1, inv, { timeoutMs: 120000 });
  if (res.ok) _setStatus(`<span style="color:#2a7a4f">Test APPROVED ✓</span> — txn ${res.transactionId} ($${Number(res.amount || 1).toFixed(2)}). Refund it in your Helcim dashboard.`);
  else _setStatus(`<span style="color:#c0392b">Test not completed: ${res.error || res.status}</span>`);
}
