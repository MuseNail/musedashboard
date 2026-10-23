// ── Support tickets (Wave 3 #16) ──────────────────────────────────────────────
// In-app staff → manager help desk. Front-desk staff file a ticket from the dashboard
// "Help & Feedback" button (a durable, tracked, two-way thread — unlike chat, which clears
// daily, or tasks, which are assignable to-dos). The owner/manager reads + answers them in the
// admin-only Settings → Support inbox. Tickets are a first-class DO entity (ticket:<id>), fetched
// on demand + polled; nothing lives in the synced state blob. The server stamps the submitter and
// gates the admin routes (see cloudflare/support-util.js + worker.js _handleSupport).
import { SUPPORT_PROXY, PUSH_PROXY, VAPID_PUBLIC_KEY, APP_VERSION } from '../config.js';
import { escHtml, escAttrJs, showToast } from '../utils.js';
import { getActiveUser } from '../session.js';

const TYPE_LABEL = { problem: 'Problem', question: 'Question', request: 'Request' };
const MAX_SUBJECT = 120, MAX_MESSAGE = 5000;

// The admin gate MUST match the server's hardcoded admin||manager (support-util.js isAdminRole) —
// deliberately NOT canDo(), which is owner-editable and could drift from the server.
const supportIsAdmin = () => ['admin', 'manager'].includes(getActiveUser()?.role);

let _tickets = [];      // last-loaded shared list (staff modal)
let _view = 'list';     // 'list' | 'compose' | 'thread'
let _openId = null;     // thread open in the staff modal
let _pollTimer = null;
let _loadErr = false;   // last load failed (offline) → distinct empty state

// ── fetch ──────────────────────────────────────────────────────
async function loadTickets() {
  try {
    const r = await fetch(SUPPORT_PROXY + '/tickets', { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) { _loadErr = true; return { ok: false }; }
    const j = await r.json();
    _tickets = Array.isArray(j.tickets) ? j.tickets : [];
    _loadErr = false;
    return { ok: true, unread: j.unread || 0 };
  } catch (e) { _loadErr = true; return { ok: false }; }
}

const _fmt = ms => { try { return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
function _statusPill(s) {
  const map = { open: ['Open', '#2563eb'], replied: ['Replied', '#16a34a'], resolved: ['Resolved', '#6b7280'], archived: ['Archived', '#9ca3af'] };
  const [lbl, col] = map[s] || ['Open', '#2563eb'];
  return `<span class="text-[10px] font-body font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style="background:${col}1a;color:${col}">${lbl}</span>`;
}

// ── Staff modal (dashboard "Help & Feedback" button) ───────────
export function openSupport() {
  closeSupport();
  _view = 'list'; _openId = null;
  const m = document.createElement('div');
  m.id = 'support-modal';
  m.className = 'fixed inset-0 z-[120] flex items-start justify-center bg-on-surface/40 px-4 pt-16';
  m.onclick = e => { if (e.target === m) closeSupport(); };
  m.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" style="max-height:80vh">
    <div id="support-modal-body" class="flex flex-col min-h-0"></div>
  </div>`;
  document.body.appendChild(m);
  loadTickets().then(_renderModal);
  clearInterval(_pollTimer);
  _pollTimer = setInterval(() => { if (!isEditing()) loadTickets().then(() => { _renderModal(); paintSupportBadges(); }); }, 20000);
}
export function closeSupport() {
  clearInterval(_pollTimer); _pollTimer = null;
  document.getElementById('support-modal')?.remove();
}
// A background poll must NEVER re-render over text the user is typing.
function isEditing() {
  const box = document.getElementById('support-modal'); if (!box) return false;
  const a = document.activeElement;
  if (a && box.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return true;
  return [...box.querySelectorAll('textarea, input[type=text]')].some(el => el.value.trim().length);
}

function _header(title, back) {
  return `<div class="flex items-center gap-2 px-4 py-3 border-b border-surface-container-high flex-shrink-0">
    ${back ? `<button onclick="supportBack()" title="Back" aria-label="Back" class="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center"><span class="material-symbols-outlined text-on-surface-variant" style="font-size:20px">arrow_back</span></button>` : `<span class="material-symbols-outlined text-primary" style="font-size:20px">support_agent</span>`}
    <span class="font-headline font-bold text-on-surface flex-1">${title}</span>
    <button onclick="closeSupport()" title="Close" aria-label="Close" class="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center"><span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px">close</span></button>
  </div>`;
}

function _renderModal() {
  const body = document.getElementById('support-modal-body'); if (!body) return;
  if (_view === 'compose') return void (body.innerHTML = _composeHtml());
  if (_view === 'thread') {
    body.innerHTML = _threadHtml();
    requestAnimationFrame(() => { const p = document.getElementById('sup-thread-scroll'); if (p) p.scrollTop = p.scrollHeight; });   // newest message in view
    return;
  }
  body.innerHTML = _listHtml();
}

function _listHtml() {
  // Staff never see archived tickets (the admin can serve them, e.g. if an admin uses this modal).
  const list = _tickets.filter(t => t.status !== 'archived');
  const rows = list.length ? list.map(t => `
    <button onclick="supportOpenThread('${escAttrJs(t.id)}')" class="w-full flex items-center gap-3 px-4 py-3 border-b border-surface-container hover:bg-surface-container-low text-left">
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2"><span class="font-body font-semibold text-sm text-on-surface truncate">${escHtml(t.subject)}</span>${t.unreadForSalon ? '<span class="w-2 h-2 rounded-full bg-[#d11a2a] flex-shrink-0"></span>' : ''}</span>
        <span class="block text-[11px] font-body text-on-surface-variant mt-0.5">${escHtml(TYPE_LABEL[t.type] || t.type)} · ${_fmt(t.updatedAt)}</span>
      </span>
      ${_statusPill(t.status)}
    </button>`).join('')
    : `<div class="px-5 py-10 text-center text-sm font-body text-on-surface-variant">${_loadErr ? 'You’re offline — tickets need a connection. Try again in a moment.' : 'No tickets yet. Tap “New message” to send one.'}</div>`;
  return _header('Help &amp; Feedback', false) + `
    <div class="overflow-y-auto no-scroll" style="flex:1 1 auto">${rows}</div>
    <div class="p-3 border-t border-surface-container-high flex-shrink-0">
      <button onclick="supportCompose()" class="w-full py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm">New message</button>
    </div>`;
}

function _composeHtml() {
  const radio = (v) => `<label class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-surface-container-high cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/10">
    <input type="radio" name="sup-type" value="${v}" class="accent-[color:var(--primary)]" ${v === 'problem' ? 'checked' : ''}><span class="text-sm font-body">${TYPE_LABEL[v]}</span></label>`;
  return _header('New message', true) + `
    <div class="p-4 space-y-3 overflow-y-auto" style="flex:1 1 auto">
      <div class="flex gap-2">${['problem', 'question', 'request'].map(radio).join('')}</div>
      <input id="sup-subject" type="text" maxlength="${MAX_SUBJECT}" placeholder="Subject (short)"
        class="w-full px-3 py-2.5 rounded-xl border border-surface-container-high bg-surface-container-lowest text-sm font-body text-on-surface outline-none focus:border-primary">
      <textarea id="sup-message" maxlength="${MAX_MESSAGE}" rows="5" placeholder="What’s going on? (please don’t include card numbers)"
        class="w-full px-3 py-2.5 rounded-xl border border-surface-container-high bg-surface-container-lowest text-sm font-body text-on-surface outline-none focus:border-primary resize-none"></textarea>
    </div>
    <div class="p-3 border-t border-surface-container-high flex-shrink-0">
      <button onclick="supportSend()" class="w-full py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm">Send</button>
    </div>`;
}

function _bubble(msg) {
  const mine = msg.from === 'salon';
  return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}">
    <div class="max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}">
      <div class="text-[10px] font-body opacity-70 mb-0.5">${escHtml(msg.author || (mine ? 'You' : 'Manager'))} · ${_fmt(msg.at)}</div>
      <div class="text-sm font-body whitespace-pre-wrap break-words">${escHtml(msg.text)}</div>
    </div></div>`;
}
function _threadHtml() {
  const t = _tickets.find(x => x.id === _openId);
  if (!t) { _view = 'list'; return _listHtml(); }
  const msgs = (t.messages || []).map(_bubble).join('');
  return _header(escHtml(t.subject), true) + `
    <div class="px-3 py-1.5 border-b border-surface-container-high flex items-center gap-2 flex-shrink-0">${_statusPill(t.status)}<span class="text-[11px] font-body text-on-surface-variant">${escHtml(TYPE_LABEL[t.type] || t.type)}</span></div>
    <div id="sup-thread-scroll" class="p-3 space-y-2 overflow-y-auto no-scroll" style="flex:1 1 auto">${msgs}</div>
    ${t.status === 'resolved' || t.status === 'archived' ? '' : `<div class="p-3 border-t border-surface-container-high flex items-end gap-2 flex-shrink-0">
      <textarea id="sup-reply" rows="2" maxlength="${MAX_MESSAGE}" placeholder="Reply…" class="flex-1 px-3 py-2 rounded-xl border border-surface-container-high bg-surface-container-lowest text-sm font-body text-on-surface outline-none focus:border-primary resize-none"></textarea>
      <button onclick="supportReplySend()" class="px-4 py-2 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm flex-shrink-0">Send</button>
    </div>`}`;
}

export function supportBack() { _view = 'list'; _openId = null; _renderModal(); }
export function supportCompose() { _view = 'compose'; _renderModal(); }
export function supportOpenThread(id) {
  _openId = id; _view = 'thread'; _renderModal();
  const t = _tickets.find(x => x.id === id);
  if (t && t.unreadForSalon) {   // optimistic read-clear
    t.unreadForSalon = false; paintSupportBadges();
    fetch(SUPPORT_PROXY + '/ticket/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who: 'salon' }) }).catch(() => {});
  }
}

export async function supportSend() {
  const type = document.querySelector('input[name=sup-type]:checked')?.value || 'problem';
  const subject = document.getElementById('sup-subject')?.value.trim() || '';
  const message = document.getElementById('sup-message')?.value.trim() || '';
  if (!subject) { showToast('Enter a subject'); return; }
  if (!message) { showToast('Enter a message'); return; }
  try {
    const r = await fetch(SUPPORT_PROXY + '/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, subject, message, appVersion: APP_VERSION }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || 'Couldn’t send — try again'); return; }
    await loadTickets(); _openId = j.ticket?.id || null; _view = _openId ? 'thread' : 'list'; _renderModal(); paintSupportBadges();
    showToast('Sent ✓');
  } catch (e) { showToast('You’re offline — try again when connected'); }
}
export async function supportReplySend() {
  const ta = document.getElementById('sup-reply'); const message = ta?.value.trim() || '';
  if (!message) return;
  try {
    const r = await fetch(SUPPORT_PROXY + '/ticket/' + encodeURIComponent(_openId) + '/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || 'Couldn’t send — try again'); return; }
    await loadTickets(); _renderModal(); paintSupportBadges();
  } catch (e) { showToast('You’re offline — try again when connected'); }
}

// ── Unread badges (dashboard button + Settings nav dot) ────────
// Staff signal = the dashboard button badge (unreadForSalon: a manager reply they haven't read).
// Admin signal = a dot on the Settings tab (unreadForDev: new tickets / staff replies awaiting them).
let _lastAdminUnread = null;   // previous admin unread count — toast only on an INCREASE (a genuinely new ticket/reply)
export async function pollSupportUnread() {
  const res = await loadTickets();
  // Toast an active admin the instant a new ticket/reply arrives — a reliable in-app alert on top of the
  // Settings nav dot (persistent) and the opt-in phone push (for when they're away). First poll never toasts.
  if (res.ok && supportIsAdmin()) {
    const n = res.unread || 0;
    if (_lastAdminUnread != null && n > _lastAdminUnread) showToast('New support ticket — open Settings → Support to reply');
    _lastAdminUnread = n;
  }
  paintSupportBadges(res.ok ? res.unread : 0);
  if (document.getElementById('support-modal') && !isEditing()) _renderModal();
}
export function paintSupportBadges(adminUnread) {
  const mine = _tickets.filter(t => t.unreadForSalon && t.status !== 'archived').length;   // archived are off the staff list, so never count them
  const badge = document.getElementById('support-badge');
  if (badge) { badge.textContent = String(mine); badge.classList.toggle('hidden', mine === 0); }
  if (supportIsAdmin()) {
    const n = adminUnread == null ? _tickets.filter(t => t.unreadForDev && t.status !== 'archived').length : adminUnread;
    _paintSettingsDot(n > 0);
  } else { _paintSettingsDot(false); }
}
function _paintSettingsDot(on) {
  const nav = document.getElementById('nav-settings'); if (!nav) return;
  let dot = document.getElementById('settings-support-dot');
  if (on && !dot) {
    nav.style.position = nav.style.position || 'relative';
    dot = document.createElement('span');
    dot.id = 'settings-support-dot';
    dot.style.cssText = 'position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:9999px;background:#d11a2a';
    nav.appendChild(dot);
  } else if (!on && dot) dot.remove();
}

// ── Admin inbox (Settings → Support) ───────────────────────────
let _inbox = [];
let _inboxOpenId = null;
let _inboxFilter = 'all';   // all | open | replied | resolved | archived

export async function renderSupportInbox() {
  const el = document.getElementById('support-inbox-content'); if (!el) return;
  if (!supportIsAdmin()) { el.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-3">Admins &amp; managers only.</div>'; return; }
  el.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-3 opacity-70">Loading…</div>';
  try {
    const r = await fetch(SUPPORT_PROXY + '/tickets', { headers: { 'Content-Type': 'application/json' } });
    const j = await r.json();
    _inbox = Array.isArray(j.tickets) ? j.tickets : [];
  } catch (e) { el.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-3">Couldn’t load tickets — you may be offline.</div>'; return; }
  el.innerHTML = _inboxOpenId ? _inboxThreadHtml() : _inboxListHtml();
  if (_inboxOpenId) requestAnimationFrame(() => { const p = document.getElementById('sup-inbox-scroll'); if (p) p.scrollTop = p.scrollHeight; });   // newest message in view
}

function _alertsOn() { try { return localStorage.getItem('muse_support_alerts') === '1'; } catch (e) { return false; } }

function _inboxListHtml() {
  // The server serves archived tickets to admins (not staff), so the Archived filter can list them and
  // their thread — with its "Open" status button = unarchive — becomes reachable. "All" hides archived.
  const filters = ['all', 'open', 'replied', 'resolved', 'archived'].map(f =>
    `<button onclick="supportInboxFilter('${f}')" class="px-3 py-1 rounded-full text-xs font-body ${_inboxFilter === f ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('');
  const shown = _inbox.filter(t => _inboxFilter === 'all' ? t.status !== 'archived' : t.status === _inboxFilter);
  const alertBtn = _alertsOn()
    ? `<button onclick="disableSupportAlerts()" class="text-xs font-body text-on-surface-variant underline">Turn off push alerts</button>`
    : `<button onclick="enableSupportAlerts()" class="text-xs font-body text-primary underline">Turn on push alerts for this device</button>`;
  const rows = shown.length ? shown.map(t => `
    <button onclick="supportInboxOpen('${escAttrJs(t.id)}')" class="w-full flex items-center gap-3 px-3 py-3 border-b border-surface-container hover:bg-surface-container-low text-left">
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2"><span class="font-body font-semibold text-sm text-on-surface truncate">${escHtml(t.subject)}</span>${t.unreadForDev ? '<span class="w-2 h-2 rounded-full bg-[#d11a2a] flex-shrink-0"></span>' : ''}</span>
        <span class="block text-[11px] font-body text-on-surface-variant mt-0.5">${escHtml(TYPE_LABEL[t.type] || t.type)} · ${escHtml(t.submittedBy || 'Staff')} · ${_fmt(t.updatedAt)}</span>
      </span>
      ${_statusPill(t.status)}
    </button>`).join('')
    : '<div class="px-3 py-8 text-center text-sm font-body text-on-surface-variant">No tickets here.</div>';
  return `<div class="flex items-center justify-between mb-2"><div class="flex gap-1.5 flex-wrap">${filters}</div>${alertBtn}</div>
    <div class="rounded-xl border border-surface-container-high overflow-hidden">${rows}</div>`;
}

function _inboxThreadHtml() {
  const t = _inbox.find(x => x.id === _inboxOpenId);
  if (!t) { _inboxOpenId = null; return _inboxListHtml(); }
  const msgs = (t.messages || []).map(m => {
    const dev = m.from === 'dev';
    return `<div class="flex ${dev ? 'justify-end' : 'justify-start'}"><div class="max-w-[80%] rounded-2xl px-3 py-2 ${dev ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}">
      <div class="text-[10px] font-body opacity-70 mb-0.5">${escHtml(m.author || (dev ? 'You' : 'Staff'))} · ${_fmt(m.at)}</div>
      <div class="text-sm font-body whitespace-pre-wrap break-words">${escHtml(m.text)}</div></div></div>`;
  }).join('');
  // For an archived ticket, "Open" is the unarchive. The reply box is hidden once resolved/archived.
  const statusBtns = ['open', 'resolved', 'archived'].map(s =>
    `<button onclick="supportInboxStatus('${escAttrJs(t.id)}','${s}')" class="px-3 py-1.5 rounded-xl text-xs font-body ${t.status === s ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}">${s === 'open' && t.status === 'archived' ? 'Unarchive' : (s === 'archived' ? (t.status === 'archived' ? 'Archived' : 'Archive') : s[0].toUpperCase() + s.slice(1))}</button>`).join('');
  const canReply = t.status !== 'resolved' && t.status !== 'archived';
  return `<button onclick="supportInboxBack()" class="flex items-center gap-1 text-sm font-body text-on-surface-variant mb-2"><span class="material-symbols-outlined" style="font-size:18px">arrow_back</span>All tickets</button>
    <div class="flex items-center gap-2 mb-2"><span class="font-headline font-bold text-on-surface flex-1 truncate">${escHtml(t.subject)}</span>${_statusPill(t.status)}</div>
    <div class="text-[11px] font-body text-on-surface-variant mb-3">${escHtml(TYPE_LABEL[t.type] || t.type)} · from ${escHtml(t.submittedBy || 'Staff')}${t.appVersion ? ' · ' + escHtml(t.appVersion) : ''}</div>
    <div id="sup-inbox-scroll" class="space-y-2 mb-3 max-h-80 overflow-y-auto no-scroll">${msgs}</div>
    ${canReply ? `<div class="flex items-end gap-2 mb-2">
      <textarea id="sup-inbox-reply" rows="2" maxlength="${MAX_MESSAGE}" placeholder="Reply to the staffer…" class="flex-1 px-3 py-2 rounded-xl border border-surface-container-high bg-surface-container-lowest text-sm font-body text-on-surface outline-none focus:border-primary resize-none"></textarea>
      <button onclick="supportInboxReply('${escAttrJs(t.id)}')" class="px-4 py-2 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm flex-shrink-0">Reply</button>
    </div>` : ''}
    <div class="flex gap-1.5">${statusBtns}</div>`;
}

export function supportInboxFilter(f) { _inboxFilter = f; renderSupportInbox(); }
export function supportInboxBack() { _inboxOpenId = null; renderSupportInbox(); }
export function supportInboxOpen(id) {
  _inboxOpenId = id;
  const t = _inbox.find(x => x.id === id);
  if (t && t.unreadForDev) {   // opening to read clears the admin-unread side
    t.unreadForDev = false; paintSupportBadges();
    fetch(SUPPORT_PROXY + '/ticket/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who: 'dev' }) }).catch(() => {});
  }
  renderSupportInbox();
}
export async function supportInboxReply(id) {
  const ta = document.getElementById('sup-inbox-reply'); const message = ta?.value.trim() || '';
  if (!message) return;
  try {
    const r = await fetch(SUPPORT_PROXY + '/ticket/' + encodeURIComponent(id) + '/dev-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || 'Couldn’t send'); return; }
    renderSupportInbox();
  } catch (e) { showToast('Couldn’t send — try again'); }
}
export async function supportInboxStatus(id, status) {
  try {
    const r = await fetch(SUPPORT_PROXY + '/ticket/' + encodeURIComponent(id) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || 'Couldn’t update'); return; }
    // Leaving the archived view back to the list keeps things tidy.
    if (status === 'archived') _inboxOpenId = null;
    renderSupportInbox();
  } catch (e) { showToast('Couldn’t update — try again'); }
}

// ── Push opt-in for the admin (this device), id 'support' ──────
function _urlB64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
export async function enableSupportAlerts() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { showToast('This device can’t receive push notifications'); return; }
    if (Notification.permission === 'denied') { showToast('Notifications are blocked — turn them on in site settings, then try again'); return; }
    let perm = Notification.permission;
    if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (e) {} }
    if (perm !== 'granted') { showToast('Notifications not turned on'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _urlB64ToBytes(VAPID_PUBLIC_KEY) });
    const r = await fetch(PUSH_PROXY + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ techId: 'support', subscription: sub.toJSON() }) });
    if (r.ok) { try { localStorage.setItem('muse_support_alerts', '1'); } catch (e) {} showToast('Support alerts on for this device ✓'); renderSupportInbox(); }
    else showToast('Allowed, but couldn’t reach the server — try again');
  } catch (e) { showToast('Couldn’t turn on alerts — try again'); }
}
export async function disableSupportAlerts() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await fetch(PUSH_PROXY + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ techId: 'support', endpoint: sub.endpoint }) });
  } catch (e) {}
  try { localStorage.removeItem('muse_support_alerts'); } catch (e) {}
  showToast('Support alerts off for this device'); renderSupportInbox();
}
