// ── SMS (httpSMS Android-phone gateway) ──────────────────────────────────────
// Texts are sent through the shop's Android phone (running the httpSMS app) via the
// Worker's /sms proxy, which holds the httpSMS API key + "from" number as secrets
// (HTTPSMS_API_KEY / HTTPSMS_FROM). The PWA never sees the key.
//
// Phase 1 (this file): sendSms() + the Settings "Text Messaging" test panel.
// Phase 2 will add appointment-confirmation texts; Phase 3 a two-way inbox.
import { SMS_PROXY } from '../config.js';
import { showToast } from '../utils.js';

// Low-level send. Resolves { ok, sent, to, error, status } — never throws (callers branch on .ok).
export async function sendSms(to, content) {
  try {
    const res = await fetch(`${SMS_PROXY}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, content }),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok && !!j.sent, status: res.status, ...j };
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach the Worker' };
  }
}

// ── Settings → Integrations → Text Messaging ─────────────────────────────────
export async function renderSmsSettings() {
  const st = document.getElementById('sms-status'); if (!st) return;
  st.textContent = 'Checking…'; st.style.color = '';
  const res = document.getElementById('sms-test-result'); if (res) res.textContent = '';
  try {
    const r = await fetch(`${SMS_PROXY}/status`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (j.configured) { st.textContent = `✓ Connected — sending from ${j.from || 'the shop phone'}`; st.style.color = '#2a7a4f'; }
    else { st.textContent = 'Not set up yet — add HTTPSMS_API_KEY + HTTPSMS_FROM as Worker secrets, then deploy.'; st.style.color = '#c53030'; }
  } catch (e) { st.textContent = 'Could not reach the Worker to check status.'; st.style.color = '#c53030'; }
}

export async function sendTestSms() {
  const to = document.getElementById('sms-test-to')?.value || '';
  const content = (document.getElementById('sms-test-msg')?.value || '').trim();
  const out = document.getElementById('sms-test-result');
  if (!to.replace(/\D/g, '')) { showToast('Enter a phone number to text'); return; }
  if (!content) { showToast('Enter a message'); return; }
  if (out) { out.textContent = 'Sending…'; out.style.color = ''; }
  const btn = document.getElementById('sms-test-btn'); if (btn) btn.disabled = true;
  const r = await sendSms(to, content);
  if (btn) btn.disabled = false;
  if (r.ok) {
    if (out) { out.textContent = `✓ Sent to ${r.to || to}`; out.style.color = '#2a7a4f'; }
    showToast('Test text sent ✓');
    window.logAudit?.('SMS', `Test text sent to ${r.to || to}`);
  } else {
    const msg = r.error || (r.status === 503 ? 'Not configured (set Worker secrets + deploy)' : 'Send failed');
    if (out) { out.textContent = '✗ ' + msg; out.style.color = '#c53030'; }
    showToast('SMS: ' + msg);
  }
}
