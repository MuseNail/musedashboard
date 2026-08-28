// ── Service waiver (check-in acknowledgment) ─────────────────────────────────
// Gates check-in behind a required liability/informed-consent acceptance and stores each
// acceptance as a durable, non-broadcast legal record (waiver.save → DO key waiver:<id>).
// Shared by all three check-in entry points via window.waiverGate(entries, onCleared).
import { getState } from '../store.js';
import { dispatch, DEVICE_ID } from '../sync.js';
import { STATE_PROXY } from '../config.js';
import { showToast, escHtml } from '../utils.js';
import { notePhoneKey } from './square-customers.js';
import { waiverActive, buildWaiverRecord, newWaiverId, textHash } from '../waiver-util.js';

const cfg = () => getState().config || {};

const primaryDisplay = entry => { const p = String((entry && entry.name) || '').trim().split(/\s+/); return p[1] ? `${p[0]} ${p[1][0]}.` : (p[0] || ''); };
function primaryFields(entry) {
  const parts = String((entry && entry.name) || '').trim().split(/\s+/);
  const phone = (entry && entry.phone) || '';
  const pk = notePhoneKey(phone);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' '), phone, phoneKey: pk, customerId: pk ? 'cust-' + pk : null };
}

// Build + persist ONE acceptance for the party (signed by the primary). Called on EVERY
// check-in — every visit requires acceptance. Returns { id, version, at }.
function saveWaiverRecord(entries, opts = {}) {
  const c = cfg();
  const now = Date.now();
  const id = newWaiverId(now, Math.random().toString(36).slice(2, 10));
  const rec = buildWaiverRecord({
    id, now, primary: primaryFields(entries[0] || {}),
    guests: (entries || []).map(e => ({ name: e.name, phoneKey: notePhoneKey(e.phone) || null })),
    waiverVersion: c.waiver_version, text: c.waiver_text,
    method: opts.method || 'self-kiosk', deviceId: DEVICE_ID, byUser: opts.byUser || null,
    optIns: opts.optIns || {}, bypassed: !!opts.bypassed,
  });
  dispatch('waiver.save', { waiver: rec });
  window.logAudit?.('Waiver accepted', `${rec.signerDisplay} accepted v${c.waiver_version}${(entries || []).length > 1 ? ` for ${entries.length} guests` : ''}`);
  return { id, version: c.waiver_version, at: now };
}

// Stamp the per-visit waiver link onto each queue entry (mutates in place) so the visit is
// provably signed — surfaced in the customer directory + visit history.
export function stampEntriesWaiver(entries, waiverId, version, at) {
  for (const e of (entries || [])) { e.waiverId = waiverId; e.waiverVersion = version; e.waiverAt = at; }
}

// ── The gate (modal — appointment + front-desk paths keep this) ────────────────
// Every visit requires acceptance when active. On accept it stamps the passed-in entries
// (mutated in place) and calls onCleared() — the caller re-dispatches those stamped entries.
export function waiverGate(entries, onCleared, opts = {}) {
  if (!waiverActive(cfg())) return false;
  showWaiverModal(entries, onCleared, opts);
  return true;
}

// Designated-kiosk check (Release 2) — mirrors the time-clock device lock.
export function isKioskDevice() {
  const id = (cfg().kiosk_device_id || '').trim();
  return !!id && id === DEVICE_ID;
}

// ── Inline acknowledgment (kiosk check-in screen) ──────────────────────────────
// The checkbox lives inline on the check-in screen (always visible when active), with the
// Read-the-full-waiver link. Check In stays disabled until it's checked (see checkin.js).
export function renderCheckinWaiver() {
  const host = document.getElementById('checkin-waiver-inline');
  if (!host) return;
  if (!waiverActive(cfg())) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div style="background:var(--surface-container-lowest,#fff);border:1px solid var(--outline,#d4d7e0);border-radius:12px;padding:9px 12px;margin-bottom:10px">
      <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">
        <input type="checkbox" id="ci-waiver-accept" onchange="updateCheckinSubmitState()" style="width:20px;height:20px;flex-shrink:0;margin-top:1px;accent-color:var(--primary,#1a5252)">
        <span style="font-size:11.5px;line-height:1.45;color:var(--on-surface,#1a1d27)">I have read and agree to the <a href="#" onclick="showWaiverTextPopup();return false" style="color:var(--primary,#1a5252);font-weight:700;text-decoration:underline">service waiver</a>. Checking this box is my electronic signature, using the name I provide.</span>
      </label>
    </div>`;
}
export function checkinWaiverAccepted() {
  return !waiverActive(cfg()) || !!document.getElementById('ci-waiver-accept')?.checked;
}
// Kiosk submit calls this: persist the acceptance + stamp the entries. Returns false only if
// the box isn't checked (submitCheckin already gates the button, so this is a safety net).
export function acceptWaiverInline(entries, opts = {}) {
  if (!waiverActive(cfg())) return true;
  if (!document.getElementById('ci-waiver-accept')?.checked) return false;
  const s = saveWaiverRecord(entries, { method: 'self-kiosk', ...opts });
  stampEntriesWaiver(entries, s.id, s.version, s.at);
  return true;
}
export function showWaiverTextPopup() { showWaiverText(cfg().waiver_text); }

// Open a specific signed waiver by id (from a visit-history badge) — shows the EXACT text
// stored on that record (the system of record), not the current config text.
export async function openSignedWaiver(id) {
  showWaiverText('Loading the signed waiver…');
  try {
    const r = await fetch(STATE_PROXY + '/waivers', { method: 'GET' });
    const list = (await r.json()).waivers || [];
    const w = list.find(x => x.id === id);
    document.getElementById('waiver-text-modal')?.remove();
    if (!w) { showToast('That signed waiver was not found.'); return; }
    const header = `Signed by ${w.signerDisplay || w.signerFullName || ''} · v${w.waiverVersion || ''} · ${(() => { try { return new Date(w.acceptedAt).toLocaleString(); } catch { return ''; } })()}\n${'─'.repeat(28)}\n\n`;
    showWaiverText(header + (w.text || '(no text stored on this record)'));
  } catch (e) {
    document.getElementById('waiver-text-modal')?.remove();
    showToast('Couldn’t load the signed waiver — check the connection.');
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────
function showWaiverModal(entries, onCleared, opts) {
  closeWaiverModal();
  const c = cfg();
  const display = primaryDisplay(entries[0]);
  const partyLine = entries.length > 1 ? `<div style="font-size:13px;color:var(--on-surface-variant,#5b606e);margin-bottom:10px">This applies to all guests in this check-in: ${escHtml(entries.map(e => e.name).join(', '))}.</div>` : '';

  const overlay = document.createElement('div');
  overlay.id = 'waiver-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;background:rgba(20,22,30,.55);padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:18px;max-width:460px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.32)">
      <div style="padding:20px 22px 6px">
        <div style="font-size:21px;font-weight:800;color:var(--on-surface,#1a1d27)">One last step</div>
        <div style="font-size:14px;color:var(--on-surface-variant,#5b606e);margin-top:2px">Please review and accept our service waiver to finish checking in.</div>
      </div>
      <div style="padding:8px 22px 0">
        <button id="wv-read" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--outline,#d4d7e0);border-radius:12px;background:transparent;color:var(--primary,#1a5252);font-size:15px;font-weight:700;cursor:pointer">
          <span>Read the full waiver</span><span aria-hidden="true">›</span>
        </button>
      </div>
      <div style="padding:16px 22px 4px;overflow-y:auto">
        ${partyLine}
        <label id="wv-accept-row" style="display:flex;gap:12px;align-items:flex-start;padding:14px;border:2px solid var(--primary,#1a5252);border-radius:14px;background:var(--primary-container,#e1f5ee);cursor:pointer">
          <input type="checkbox" id="wv-accept" style="width:22px;height:22px;flex-shrink:0;margin-top:1px;accent-color:var(--primary,#1a5252)">
          <span style="font-size:13.5px;line-height:1.5;color:var(--on-primary-container,#0a2e2e)">I have read and agree to the entire waiver, and I understand that checking this box is my electronic signature, using the name I provided at check-in.
            <span style="display:block;margin-top:6px;font-weight:700;color:var(--on-primary-container,#0a2e2e)">Signing as: ${escHtml(display)}</span>
          </span>
        </label>
      </div>
      <div style="padding:14px 22px 18px">
        <button id="wv-complete" disabled style="width:100%;padding:15px;border:0;border-radius:13px;background:var(--primary,#1a5252);color:#fff;font-size:16px;font-weight:800;cursor:not-allowed;opacity:.45">Complete check-in</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const accept = overlay.querySelector('#wv-accept');
  const complete = overlay.querySelector('#wv-complete');
  accept.addEventListener('change', () => { complete.disabled = !accept.checked; complete.style.opacity = accept.checked ? '1' : '.45'; complete.style.cursor = accept.checked ? 'pointer' : 'not-allowed'; });
  overlay.querySelector('#wv-read').addEventListener('click', () => showWaiverText(c.waiver_text));
  complete.addEventListener('click', () => {
    if (!accept.checked) return;
    const s = saveWaiverRecord(entries, opts);
    stampEntriesWaiver(entries, s.id, s.version, s.at);
    closeWaiverModal();
    if (typeof onCleared === 'function') onCleared();
  });
}

export function closeWaiverModal() { document.getElementById('waiver-modal')?.remove(); }

function showWaiverText(text) {
  if (document.getElementById('waiver-text-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'waiver-text-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483450;display:flex;align-items:center;justify-content:center;background:rgba(20,22,30,.55);padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:16px;max-width:520px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.32)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--outline,#e5e7eb)">
        <span style="font-size:16px;font-weight:800;color:var(--on-surface,#1a1d27)">Service waiver</span>
        <button id="wvt-close" aria-label="Close" style="width:32px;height:32px;border:0;border-radius:50%;background:var(--surface-container,#f1f0f4);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="padding:16px 18px;overflow-y:auto;white-space:pre-wrap;font-size:13px;line-height:1.6;color:var(--on-surface,#1a1d27)">${escHtml(text || '')}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--outline,#e5e7eb)">
        <button id="wvt-done" style="width:100%;padding:12px;border:0;border-radius:11px;background:var(--primary,#1a5252);color:#fff;font-size:15px;font-weight:700;cursor:pointer">Close and continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#wvt-close').addEventListener('click', close);
  overlay.querySelector('#wvt-done').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ── Settings (admin) ─────────────────────────────────────────────────────────
export function renderWaiverSettings() {
  const host = document.getElementById('waiver-section');
  if (!host) return;
  const c = cfg();
  const active = waiverActive(c);
  const warn = c.waiver_enabled && !active
    ? `<div style="margin:10px 0;padding:10px 12px;border-radius:10px;background:#fdecec;color:#a12626;font-size:13px">Waiver is ON but the text is empty — check-in will proceed without it until you add the text below.</div>` : '';
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0 12px;border-bottom:1px solid var(--outline,#e5e7eb)">
      <div><div style="font-weight:700;color:var(--on-surface,#1a1d27)">Require waiver at check-in</div>
        <div style="font-size:13px;color:var(--on-surface-variant,#5b606e)">${c.waiver_enabled ? 'On' : 'Off'}${c.waiver_version ? ' · Version ' + escHtml(c.waiver_version) : ''}</div></div>
      <label class="mswitch" style="cursor:pointer"><input type="checkbox" id="wv-enable" ${c.waiver_enabled ? 'checked' : ''} onchange="saveWaiverEnabled(this.checked)"></label>
    </div>
    ${warn}
    <div style="margin-top:14px">
      <label style="font-size:13px;font-weight:700;color:var(--on-surface,#1a1d27)">Waiver text</label>
      <textarea id="wv-text" rows="10" style="width:100%;margin-top:6px;padding:10px;border:1px solid var(--outline,#d4d7e0);border-radius:10px;font-size:12.5px;line-height:1.5;font-family:inherit;color:var(--on-surface,#1a1d27);background:var(--surface,#fff)">${escHtml(c.waiver_text || '')}</textarea>
      <div style="font-size:12px;color:var(--on-surface-variant,#5b606e);margin-top:4px">The waiver is acknowledged at every check-in. Saving changed text bumps the version, so past signatures stay tied to the exact text that was signed.</div>
      <button onclick="saveWaiverText()" style="margin-top:8px;padding:10px 16px;border:0;border-radius:10px;background:var(--primary,#1a5252);color:#fff;font-weight:700;cursor:pointer">Save waiver text</button>
    </div>
    <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="viewSignedWaivers()" style="padding:10px 16px;border:1px solid var(--outline,#d4d7e0);border-radius:10px;background:transparent;color:var(--on-surface,#1a1d27);font-weight:600;cursor:pointer">View signed waivers</button>
      <button onclick="exportWaivers()" style="padding:10px 16px;border:1px solid var(--outline,#d4d7e0);border-radius:10px;background:transparent;color:var(--on-surface,#1a1d27);font-weight:600;cursor:pointer">Export all (download)</button>
    </div>
    <div id="wv-signed-list" style="margin-top:14px"></div>`;
}

export function saveWaiverEnabled(on) {
  dispatch('config.set', { key: 'waiver_enabled', value: !!on });
  // First time turning it on with text present but no version → seed version 01.
  const c = cfg();
  if (on && String(c.waiver_text || '').trim() && !c.waiver_version) bumpWaiverVersion(c.waiver_text);
  setTimeout(renderWaiverSettings, 50);
}

function bumpWaiverVersion(text) {
  const c = cfg();
  const cur = Number(c.waiver_version || 0);
  const next = String(cur + 1).padStart(2, '0');
  const versions = { ...(c.waiver_versions || {}) };
  versions[next] = { text, hash: textHash(text), effectiveAt: Date.now() };
  dispatch('config.set', { key: 'waiver_version', value: next });
  dispatch('config.set', { key: 'waiver_versions', value: versions });
  return next;
}
export function saveWaiverText() {
  const text = (document.getElementById('wv-text')?.value || '').trim();
  if (!text) { showToast('Enter the waiver text first.'); return; }
  const c = cfg();
  dispatch('config.set', { key: 'waiver_text', value: text });
  if (text !== (c.waiver_text || '') || !c.waiver_version) {
    const v = bumpWaiverVersion(text);
    showToast(`Saved — now version ${v}. Clients will be re-prompted.`);
  } else showToast('Saved.');
  setTimeout(renderWaiverSettings, 50);
}

async function fetchWaivers() {
  const r = await fetch(STATE_PROXY + '/waivers', { method: 'GET' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).waivers || [];
}
export async function viewSignedWaivers() {
  const host = document.getElementById('wv-signed-list'); if (host) host.innerHTML = '<div style="font-size:13px;color:var(--on-surface-variant,#5b606e)">Loading…</div>';
  try {
    const list = await fetchWaivers();
    if (!list.length) { if (host) host.innerHTML = '<div style="font-size:13px;color:var(--on-surface-variant,#5b606e)">No signed waivers yet.</div>'; return; }
    if (host) host.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:6px">${list.length} signed waiver${list.length === 1 ? '' : 's'}</div>` + list.slice(0, 200).map(w => {
      const when = (() => { try { return new Date(w.acceptedAt).toLocaleString(); } catch { return ''; } })();
      return `<div style="padding:9px 11px;border:1px solid var(--outline,#e5e7eb);border-radius:9px;margin-bottom:6px;font-size:13px;color:var(--on-surface,#1a1d27)">
        <b>${escHtml(w.signerDisplay || w.signerFullName || '')}</b> · v${escHtml(w.waiverVersion || '')} · ${escHtml(when)}
        <div style="font-size:12px;color:var(--on-surface-variant,#5b606e)">${escHtml(w.signerPhone || '')}${w.guests && w.guests.length > 1 ? ' · ' + w.guests.length + ' guests' : ''}${w.bypassed ? ' · bypassed' : ''}</div>
      </div>`;
    }).join('');
  } catch (e) { if (host) host.innerHTML = `<div style="font-size:13px;color:#a12626">Couldn’t load waivers (${escHtml(String(e.message || e))}).</div>`; }
}
export async function exportWaivers() {
  try {
    const list = await fetchWaivers();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `muse-waivers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${list.length} waiver${list.length === 1 ? '' : 's'}.`);
  } catch (e) { showToast('Export failed — check the connection.'); }
}
