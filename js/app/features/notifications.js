// ── Unified notification bell ────────────────────────────────────────────────
// ONE header bell aggregating every pending thing, each row tappable straight to its
// source (and tapping clears it). Strictly READ-ONLY on all state — the bell never
// dispatches. Replaces the scattered, unexplained dots (esp. the old Settings support dot).
import { getState } from '../store.js';
import { getActiveUser, canDo } from '../session.js';
import { tasksOverdueCount, showUpdatePopup, escHtml } from '../utils.js';
import { failedOps } from '../sync.js';
import { chatUnreadCount } from './chat.js';
import { supportAdminUnreadCount, supportUnreadCount, supportAdminUnreadList, supportSalonUnreadList } from './support.js';
import { clockNeedsAttention } from './timeclock.js';
import { buildNotifItems } from '../notif-util.js';
import { structuralChangeCount } from '../fd-schedule-util.js';

// ── Live source read ──────────────────────────────────────────────────────────
function gather() {
  const u = getActiveUser();
  if (!u || !u.id || u.id === 'fallback') return null;   // signed out → no bell
  const role = u.role;
  const caps = { isAdmin: role === 'admin', isManager: role === 'admin' || role === 'manager' };
  const myPid = 'fd:' + u.id;
  const cfg = getState().config || {};
  const counts = {
    failedWrites: failedOps().length,
    supportNew:   supportAdminUnreadCount(),
    supportReply: supportUnreadCount(),
    chat:         chatUnreadCount(),
    tasks:        tasksOverdueCount(getState().tasks, myPid, canDo('manageStaff'), Date.now()),
    fdDraft:      structuralChangeCount(cfg.fd_schedule, cfg.fd_schedule_draft) > 0 ? 1 : 0,   // one nudge, not the raw change count
    clock:        clockNeedsAttention() ? 1 : 0,
    update:       (typeof window.updateAvailableVersion === 'function' && window.updateAvailableVersion()) ? 1 : 0,
  };
  return { counts, caps };
}

// ── Drill to source (tapping a row) ──────────────────────────────────────────
export function openNotifTarget(kind, id) {
  closeNotifPanel();
  switch (kind) {
    case 'recovery':
      window.showDashPanel?.('settings');
      setTimeout(() => window.settingsOpenLeaf?.('settings-recovery-section'), 30); break;
    case 'supportAdmin':
      window.showDashPanel?.('settings');
      setTimeout(() => { window.settingsOpenLeaf?.('settings-support-section'); window.supportInboxOpen?.(id); }, 40); break;
    case 'supportSalon':
      window.openSupport?.(); window.supportOpenThread?.(id); break;
    case 'chat':   window.toggleChat?.(); break;
    case 'tasks':  window.showDashPanel?.('calendar'); setTimeout(() => window.openTasksPanel?.(), 30); break;
    case 'fdSchedule':
      window.showDashPanel?.('settings');
      setTimeout(() => {   // settingsOpenLeaf renders the leaf synchronously, so the schedule view's hidden state is settled before we toggle
        window.settingsOpenLeaf?.('fdusers-merged-section');
        if (document.getElementById('fdusers-schedule-view')?.classList.contains('hidden')) window.toggleFdScheduleView?.();   // show Schedule, not the user list
      }, 60); break;
    case 'clock':  window.onClockBtn?.(); break;
    case 'update': showUpdatePopup?.(typeof window.updateAvailableVersion === 'function' ? window.updateAvailableVersion() : ''); break;
  }
}

// ── Panel rows ────────────────────────────────────────────────────────────────
// Each source → one or more rows {icon, color, title, sub, kind, id}. Support expands to one row
// per unread ticket so tapping a row deep-links into that thread and CLEARS its unread.
// Each row carries a category `cls` (danger|support|chat|task|update); the chip colors live in CSS so
// they flip correctly in dark mode (.notif-ico--<cls> + a html[data-appearance="dark"] override).
function rowsFor(item) {
  switch (item.id) {
    case 'failedWrites': return [{ icon: 'cloud_off', cls: 'danger', title: item.count === 1 ? 'A change didn\u2019t save' : `${item.count} changes didn\u2019t save`, sub: 'Data Recovery \u00b7 tap to resync', kind: 'recovery' }];
    case 'supportNew': return supportAdminUnreadList().map(t => ({ icon: 'support_agent', cls: 'support', title: `New ticket ${t.no}`, sub: t.subject || 'Help & Feedback', kind: 'supportAdmin', id: t.id }));
    case 'supportReply': return supportSalonUnreadList().map(t => ({ icon: 'forum', cls: 'support', title: `Reply on your ticket ${t.no}`, sub: t.subject || 'Help & Feedback', kind: 'supportSalon', id: t.id }));
    case 'chat': return [{ icon: 'chat', cls: 'chat', title: item.count === 1 ? '1 unread message' : `${item.count} unread messages`, sub: 'Team chat', kind: 'chat' }];
    case 'tasks': return [{ icon: 'task_alt', cls: 'task', title: item.count === 1 ? '1 overdue task' : `${item.count} overdue tasks`, sub: 'Tasks \u00b7 past due', kind: 'tasks' }];
    case 'fdDraft': return [{ icon: 'edit_calendar', cls: 'task', title: 'Unpublished front-desk schedule', sub: 'Tap to review \u00b7 staff don\u2019t see it until you publish', kind: 'fdSchedule' }];
    case 'clock': return [{ icon: 'schedule', cls: 'task', title: 'Time-clock station changed', sub: 'Tap to review', kind: 'clock' }];
    case 'update': return [{ icon: 'system_update', cls: 'update', title: 'New version ready', sub: 'Tap to update the app', kind: 'update' }];
    default: return [];
  }
}

function _renderPanel(built) {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  const hcount = document.getElementById('notif-hdr-count');
  if (!list) return;
  const rows = built.items.flatMap(rowsFor);
  if (hcount) hcount.textContent = rows.length ? `${built.total} new` : 'all clear';
  if (empty) empty.classList.toggle('hidden', rows.length > 0);
  list.innerHTML = rows.map(r => `
    <button type="button" class="notif-row" onclick="openNotifTarget('${r.kind}'${r.id ? `,'${escAttrJs(r.id)}'` : ''})">
      <span class="notif-ico notif-ico--${r.cls}"><span class="material-symbols-outlined" style="font-size:18px" aria-hidden="true">${r.icon}</span></span>
      <span class="notif-text"><span class="notif-title">${escHtml(r.title)}</span><span class="notif-sub">${escHtml(r.sub)}</span></span>
      <span class="material-symbols-outlined notif-chev" aria-hidden="true">chevron_right</span>
    </button>`).join('');
}
function escAttrJs(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// ── Badge + open/close ────────────────────────────────────────────────────────
let _nbTimer = null;
export function refreshNotifBell() {
  if (_nbTimer) return;                      // debounce: coalesce write/sync bursts to one repaint
  _nbTimer = setTimeout(() => { _nbTimer = null; _repaint(); }, 150);
}
function _repaint() {
  try {
    const data = gather();
    const built = data ? buildNotifItems(data.counts, data.caps) : { items: [], total: 0, hasDanger: false };
    const badge = document.getElementById('notif-bell-badge');
    const btn = document.getElementById('notif-bell-btn');
    if (badge) {
      badge.textContent = built.total > 99 ? '99+' : String(built.total);
      badge.classList.toggle('hidden', built.total <= 0);
      badge.style.background = built.hasDanger ? '#d11a2a' : '#1a5252';
    }
    if (btn) {
      btn.setAttribute('aria-label', built.total ? `Notifications, ${built.total} pending` : 'Notifications');
    }
    const panel = document.getElementById('notif-panel');
    if (panel && panel.classList.contains('open')) _renderPanel(built);
  } catch { /* a bell repaint must never throw into a caller */ }
}
export function toggleNotifPanel() {
  const p = document.getElementById('notif-panel'); if (!p) return;
  if (p.classList.toggle('open')) {
    const data = gather();
    _renderPanel(data ? buildNotifItems(data.counts, data.caps) : { items: [], total: 0, hasDanger: false });
    document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'true');
  } else {
    document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'false');
  }
}
export function closeNotifPanel() {
  document.getElementById('notif-panel')?.classList.remove('open');
  document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'false');
}
// Dismiss on outside click (mirror the Turns ⋯ More pattern: one listener, no stopPropagation).
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const p = document.getElementById('notif-panel');
    if (!p || !p.classList.contains('open')) return;
    if (e.target.closest?.('#notif-bell-wrap')) return;
    closeNotifPanel();
  });
}
