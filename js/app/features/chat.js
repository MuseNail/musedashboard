// ── Staff chat ──────────────────────────────────────────────────────────────
// A small messaging surface for staff: a "Team" group channel + private 1:1 DMs,
// with @mentions. Messages live in config.chat_log and sync to every device.
// Sending uses the 'chat.append' op: the DO appends the single message to its own
// stored array (serialized, idempotent by id) so two people sending at once can't
// clobber each other — unlike a whole-array config.set. Unread (per conversation)
// and last-seen markers are device-local (localStorage), not synced.
//
// Identity: a "person id" (pid) is namespaced — 'fd:<id>' (front-desk user) or
// 'tech:<id>' (technician) — so DMs/mentions can target either kind across the
// dashboard and the staff app. On the dashboard "me" is the signed-in front-desk
// user; the staff app sets its own identity via setChatIdentity().
//
// Push: on an @mention or DM, pushNotify() pings the recipient's phone via the
// Worker's /push/notify fan-out (recipients subscribe by pid in the staff app).
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { getActiveUser } from '../session.js';
import { showToast } from '../utils.js';
import { PUSH_PROXY } from '../config.js';

const cfg = () => getState().config;
const CHAT_CAP = 300;
const SEEN_KEY = 'muse_chat_seen';   // device-local { channelKey: lastSeenMs }

// ── Identity ──────────────────────────────────────────────────────────────────
// The dashboard defaults "me" to the active front-desk user. The staff app calls
// setChatIdentity('tech:<id>' or 'fd:<id>', name) so its surface speaks as that person.
let _identity = null;   // { pid, name } override; null → derive from the dashboard session
export function setChatIdentity(pid, name) { _identity = pid ? { pid, name: name || 'Staff' } : null; }
const myPid  = () => _identity ? _identity.pid  : (getActiveUser() ? 'fd:' + getActiveUser().id : '');
const myName = () => _identity ? _identity.name : (getActiveUser()?.name || 'Staff');

// Everyone reachable in chat: front-desk users + active technicians.
export function chatPeople() {
  const c = cfg();
  const fds = (c.fd_users || []).map(u => ({ pid: 'fd:' + u.id, name: u.name || 'Front desk', kind: 'fd' }));
  const inactive = new Set(c.inactive_staff || []);
  const techs = (c.staff || []).filter(s => !inactive.has(s.id)).map(s => ({ pid: 'tech:' + s.id, name: s.name || 'Tech', kind: 'tech' }));
  return [...fds, ...techs];
}
const personName = pid => chatPeople().find(p => p.pid === pid)?.name || 'Someone';
const firstName  = pid => personName(pid).split(' ')[0];

// ── Channels / messages ───────────────────────────────────────────────────────
const dmKey = (a, b) => 'dm:' + [a, b].sort().join('~');
const dmParts = ch => ch.slice(3).split('~');
const dmInvolves = (ch, pid) => ch.startsWith('dm:') && dmParts(ch).includes(pid);
const dmOther = (ch, me) => { const p = dmParts(ch); return p[0] === me ? p[1] : p[0]; };

// Auto-clear daily at the 4 AM salon-day start (mirrors the rest of the app).
const DAY_START_HOUR = 4;
function dayStartTs() {
  const d = new Date(), c = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() < c.getTime()) c.setDate(c.getDate() - 1);
  return c.getTime();
}
const allMsgs = () => (Array.isArray(cfg().chat_log) ? cfg().chat_log : []).filter(m => (m.ts || 0) >= dayStartTs());
const chOf = m => m.ch || 'team';   // legacy messages had no channel → Team
const msgsFor = ch => allMsgs().filter(m => chOf(m) === ch);
const teamMsgs = () => msgsFor('team');

const _esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Highlight @mentions of known people in message text.
function withMentions(text) {
  let out = _esc(text);
  chatPeople().forEach(p => {
    const f = _esc(firstName(p.pid));
    if (!f) return;
    out = out.replace(new RegExp('@' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'),
      '<span class="chat-tag">@' + f + '</span>');
  });
  return out;
}

// ── Unread (device-local, per channel) ────────────────────────────────────────
function seenMap() { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch { return {}; } }
function markSeen(ch) { try { const m = seenMap(); m[ch] = Date.now(); localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch (e) {} }
function unreadFor(ch) { const s = seenMap()[ch] || 0, me = myPid(); return msgsFor(ch).filter(m => m.ts > s && m.uid !== me).length; }
function totalUnread() {
  const me = myPid();
  let n = unreadFor('team');
  dmConversations().forEach(c => { n += unreadFor(dmKey(me, c.pid)); });
  return n;
}

// DM conversations involving me, newest first.
function dmConversations() {
  const me = myPid(); if (!me) return [];
  const map = new Map();
  allMsgs().forEach(m => {
    const ch = chOf(m); if (!dmInvolves(ch, me)) return;
    const other = dmOther(ch, me);
    const cur = map.get(other);
    if (!cur || m.ts > cur.lastTs) map.set(other, { pid: other, name: personName(other), lastTs: m.ts, lastText: m.text, lastMine: m.uid === me });
  });
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

// ── Panel state ───────────────────────────────────────────────────────────────
let _open = false, _view = 'list', _maxed = false, _atOpen = false, _draft = '', _pendMentions = [];
let _lastNotifiedTs = 0, _chatInit = false;

export function toggleChat() { _open ? closeChat() : openChat(); }
export function openChat() {
  _open = true; _view = 'list'; _atOpen = false; _draft = '';
  const p = document.getElementById('chat-panel'); if (p) { p.classList.remove('hidden'); p.style.display = 'flex'; }
  render(); updateChatBadge();
}
export function closeChat() {
  _open = false; _atOpen = false;
  const p = document.getElementById('chat-panel'); if (p) { p.classList.add('hidden'); p.style.display = ''; }
}
export function chatBack() { _view = 'list'; _atOpen = false; _draft = ''; render(); }
export function chatToggleMax() { _maxed = !_maxed; render(); }
export function chatNewMessage() { _view = 'new'; _atOpen = false; render(); }
export function chatToggleMentions() { _atOpen = !_atOpen; render(); }
export function chatDraft(v) { _draft = v; }

const channelOfView = () => _view.startsWith('dm:') ? dmKey(myPid(), _view.slice(3)) : (_view === 'team' ? 'team' : null);

export function chatOpen(view) {
  _view = view; _atOpen = false; _draft = ''; _pendMentions = [];
  const ch = channelOfView(); if (ch) markSeen(ch);
  render(); updateChatBadge();
}
export function chatPickMention(pid) {
  if (!_pendMentions.includes(pid)) _pendMentions.push(pid);
  const input = document.getElementById('chat-input');
  _draft = ((input?.value || _draft || '').replace(/\s*$/, '') + ' @' + firstName(pid) + ' ').replace(/^\s+/, '');
  _atOpen = false; render();
  setTimeout(() => { const i = document.getElementById('chat-input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30);
}

export function sendChatMessage() {
  const input = document.getElementById('chat-input'); if (!input) return;
  const text = (input.value || '').trim(); if (!text) return;
  const me = myPid(); if (!me) { showToast('Sign in to chat.'); return; }
  let ch = 'team', to = '', mentions = [];
  if (_view.startsWith('dm:')) { to = _view.slice(3); ch = dmKey(me, to); }
  else { mentions = _pendMentions.filter(pid => text.includes('@' + firstName(pid))); }
  const msg = { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), uid: me, name: myName(), text: text.slice(0, 1000), ts: Date.now(), ch };
  if (to) msg.to = to;
  if (mentions.length) msg.mentions = mentions;
  dispatch('chat.append', { message: msg });   // DO-side atomic append — no whole-array clobber
  _draft = ''; _pendMentions = []; _atOpen = false; _lastNotifiedTs = msg.ts;
  markSeen(ch); render(); updateChatBadge();
  pushNotify(to ? [to] : mentions, to ? myName() : myName() + ' · Team', text);
}
// Ping the @mentioned people / DM recipient's phone via the existing Worker push
// fan-out (/push/notify accepts person ids; recipients subscribe by pid in the
// staff app). Best-effort, never on every message — only on a tag/DM.
function pushNotify(pids, title, text) {
  const me = myPid();
  const targets = [...new Set((pids || []).filter(p => p && p !== me))];
  if (!targets.length) return;
  fetch(PUSH_PROXY + '/notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ techIds: targets, title: String(title).slice(0, 80), body: String(text).slice(0, 200), tag: 'muse-chat' }),
  }).catch(() => {});
}
export function chatInputKey(ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendChatMessage(); } }

// Manager-only: wipe the chat for everyone (in addition to the automatic 4 AM clear).
export function clearChat() {
  if (getActiveUser()?.role !== 'admin') { showToast('Only a manager can clear the chat.'); return; }
  const doClear = () => { dispatch('config.set', { key: 'chat_log', value: [] }); render(); updateChatBadge(); showToast('Chat cleared'); };
  if (window.showWarnModal) window.showWarnModal('Clear chat for everyone?', 'This permanently removes the chat history on all devices.', doClear);
  else doClear();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const AV_COLORS = ['#1a5252', '#7a4ea0', '#c77700', '#2a7a4f', '#b5306e', '#3a6ea5', '#9a6b00'];
const avColor = pid => AV_COLORS[Math.abs([...String(pid)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % AV_COLORS.length];
const initial = n => (n || '?').charAt(0).toUpperCase();
const timeStr = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function applySize(p) {
  if (_maxed) { p.style.width = 'min(440px,calc(100vw - 24px))'; p.style.height = 'min(660px,calc(100vh - 80px))'; }
  else { p.style.width = '360px'; p.style.height = '520px'; }
}
function header(title, icon, withBack) {
  const maxIcon = _maxed ? 'close_fullscreen' : 'open_in_full';
  const clearBtn = (_view === 'team' && getActiveUser()?.role === 'admin')
    ? `<button onclick="clearChat()" title="Clear chat for everyone" class="chat-hbtn"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>` : '';
  return `<div class="chat-head">
    ${withBack ? `<button onclick="chatBack()" class="chat-hbtn" title="Back"><span class="material-symbols-outlined" style="font-size:22px">arrow_back</span></button>` : ''}
    <div class="chat-title"><span class="material-symbols-outlined" style="font-size:20px;color:var(--primary,#1a5252)">${icon}</span> ${_esc(title)}</div>
    ${clearBtn}
    <button onclick="chatToggleMax()" class="chat-hbtn" title="${_maxed ? 'Restore size' : 'Maximize'}"><span class="material-symbols-outlined" style="font-size:18px">${maxIcon}</span></button>
    <button onclick="closeChat()" class="chat-hbtn" title="Close"><span class="material-symbols-outlined" style="font-size:20px">close</span></button>
  </div>`;
}
function listView() {
  const me = myPid();
  const teamU = unreadFor('team');
  const teamRow = `<div class="chat-conv" onclick="chatOpen('team')">
    <div class="chat-av" style="background:#1a5252"><span class="material-symbols-outlined" style="font-size:20px">groups</span></div>
    <div class="chat-cmid"><div class="chat-cname">Team</div><div class="chat-cprev">${teamMsgs().length ? _esc((teamMsgs().slice(-1)[0].uid === me ? 'You: ' : (firstName(teamMsgs().slice(-1)[0].uid) + ': ')) + teamMsgs().slice(-1)[0].text) : 'No messages yet'}</div></div>
    ${teamU ? `<span class="chat-unread">${teamU > 9 ? '9+' : teamU}</span>` : ''}
  </div>`;
  const dms = dmConversations().map(c => {
    const u = unreadFor(dmKey(me, c.pid));
    return `<div class="chat-conv" onclick="chatOpen('dm:${c.pid}')">
      <div class="chat-av" style="background:${avColor(c.pid)}">${initial(c.name)}</div>
      <div class="chat-cmid"><div class="chat-cname">${_esc(c.name)}</div><div class="chat-cprev">${_esc((c.lastMine ? 'You: ' : '') + c.lastText)}</div></div>
      <div class="chat-cright"><span class="chat-ctime">${timeStr(c.lastTs)}</span>${u ? `<span class="chat-unread">${u > 9 ? '9+' : u}</span>` : ''}</div>
    </div>`;
  }).join('');
  return header('Chat', 'forum', false)
    + `<div class="chat-body">
        <div class="chat-seclbl">Group</div>${teamRow}
        ${dms ? `<div class="chat-seclbl">Direct messages</div>${dms}` : ''}
      </div>
      <div class="chat-composer"><button onclick="chatNewMessage()" class="chat-cbtn at" title="New message"><span class="material-symbols-outlined" style="font-size:19px">edit_square</span></button>
        <input readonly onclick="chatNewMessage()" placeholder="Start a new message…" class="chat-input"></div>`;
}
function newView() {
  const rows = chatPeople().filter(p => p.pid !== myPid()).map(p =>
    `<div class="chat-conv" onclick="chatOpen('dm:${p.pid}')">
      <div class="chat-av" style="background:${avColor(p.pid)}">${initial(p.name)}</div>
      <div class="chat-cmid"><div class="chat-cname">${_esc(p.name)}</div></div>
      <span class="chat-role">${p.kind === 'tech' ? 'Tech' : 'Front desk'}</span>
    </div>`).join('') || `<div class="chat-empty">No one to message yet.</div>`;
  return header('New message', 'edit_square', true) + `<div class="chat-body"><div class="chat-seclbl">Pick someone</div>${rows}</div>`;
}
function threadView() {
  const me = myPid(), isTeam = _view === 'team';
  const other = isTeam ? null : _view.slice(3);
  const ch = channelOfView();
  const list = msgsFor(ch);
  const body = list.length ? list.map(m => {
    const mine = m.uid === me;
    return `<div class="chat-msg ${mine ? 'me' : ''}">
      <div class="chat-meta">${isTeam ? (mine ? 'You' : _esc(firstName(m.uid) || m.name)) + ' · ' : ''}${timeStr(m.ts)}</div>
      <div class="chat-bub ${mine ? 'mine' : 'other'}">${withMentions(m.text)}</div>
    </div>`;
  }).join('') : `<div class="chat-empty">${isTeam ? 'No messages yet — say hello.' : 'No messages yet. Say hi to ' + _esc(firstName(other)) + '.'}</div>`;
  const atPop = (_atOpen && isTeam) ? `<div class="chat-atpop">${chatPeople().filter(p => p.pid !== me).map(p =>
    `<div class="chat-atrow" onclick="chatPickMention('${p.pid}')"><div class="chat-av sm" style="background:${avColor(p.pid)}">${initial(p.name)}</div>${_esc(p.name)}<span class="chat-role">${p.kind === 'tech' ? 'Tech' : 'Front desk'}</span></div>`).join('')}</div>` : '';
  const dmHint = isTeam ? '' : `<div class="chat-dmhint">Private message to ${_esc(personName(other))}${' '}· will ping their phone</div>`;
  const ph = isTeam ? 'Message the team…' : 'Message ' + _esc(firstName(other)) + '…';
  return header(isTeam ? 'Team' : personName(other), isTeam ? 'groups' : 'person', true)
    + `<div class="chat-body"><div class="chat-msgs">${dmHint}${body}</div></div>`
    + `<div class="chat-composer">${atPop}
        ${isTeam ? `<button onclick="chatToggleMentions()" class="chat-cbtn at" title="Mention someone"><span class="material-symbols-outlined" style="font-size:19px">alternate_email</span></button>` : ''}
        <input id="chat-input" class="chat-input" maxlength="1000" autocomplete="off" placeholder="${ph}" oninput="chatDraft(this.value)" onkeydown="chatInputKey(event)">
        <button onclick="sendChatMessage()" class="chat-cbtn send" title="Send"><span class="material-symbols-outlined" style="font-size:18px">send</span></button>
      </div>`;
}
function render() {
  const p = document.getElementById('chat-panel'); if (!p || !_open) return;
  applySize(p);
  p.innerHTML = _view === 'list' ? listView() : _view === 'new' ? newView() : threadView();
  const input = document.getElementById('chat-input');
  if (input && _view !== 'list' && _view !== 'new') {
    input.value = _draft;
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 30);
    const box = p.querySelector('.chat-msgs'); if (box) box.scrollTop = box.scrollHeight;
  }
}
// Back-compat alias (older callers / store subscription used renderChat()).
export function renderChat() { render(); }

export function updateChatBadge() {
  const badge = document.getElementById('chat-badge'); if (!badge) return;
  const n = totalUnread();
  if (n > 0 && !_open) { badge.textContent = n > 9 ? '9+' : String(n); badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// Called from the store subscription when config (incl. chat_log) syncs in.
export function onChatSync() {
  const list = allMsgs();
  const newest = list.length ? list[list.length - 1] : null;
  const me = myPid();
  if (!_chatInit) { _chatInit = true; _lastNotifiedTs = newest ? newest.ts : Date.now(); }
  else if (newest && newest.ts > _lastNotifiedTs) {
    _lastNotifiedTs = newest.ts;
    // Dashboard: only on the desk screen (never the customer kiosk). Staff/reports
    // apps have no #screen-desk, so allow the toast there.
    const deskEl = document.getElementById('screen-desk');
    const onSurface = deskEl ? deskEl.classList.contains('active') : true;
    const toMe = chOf(newest).startsWith('dm:') ? dmInvolves(chOf(newest), me) : true;
    if (me && newest.uid !== me && !_open && onSurface && toMe) {
      const who = firstName(newest.uid) || newest.name;
      const tag = chOf(newest).startsWith('dm:') ? '💬 ' : '';
      showToast(`${tag}${who}: ${newest.text.slice(0, 40)}`);
    }
  }
  if (_open) {
    const ch = channelOfView(); if (ch) markSeen(ch);
    render();
  }
  updateChatBadge();
}
