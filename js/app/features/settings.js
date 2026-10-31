// ── Settings panel ──────────────────────────────────────────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { getAppToken, getSessionUser } from '../apptoken.js';
import { showToast, setSwitchVisual, escHtml, isValidTz } from '../utils.js';
import { canDo, getActiveUser, ui } from '../session.js';
import { DEFAULT_ROLE_PERMISSIONS, APP_VERSION } from '../config.js';
import { renderServicesMerged, renderSettingsItems, renderSettingsFees } from './catalog.js';
import { setLogo } from './photos.js';
import { getTurnConfig, saveTurnConfig, isAlwaysBonusService, saveBonusServices, isHalfService, saveHalfServices, getDedicatedBonusServices } from './turns.js';

const cfg = () => getState().config;

// ── Done-card visibility (transient UI state) ─────
export function toggleDoneVisibility() {
  ui.showDoneInQueue = !ui.showDoneInQueue;
  const icon = document.getElementById('done-toggle-icon'), label = document.getElementById('done-toggle-label');
  if (icon) icon.textContent = ui.showDoneInQueue ? 'visibility_off' : 'visibility';
  if (label) label.textContent = ui.showDoneInQueue ? 'Hide Paid' : 'Show Paid';
  window.renderQueue?.();
}

// ── Role permissions (config.role_permissions) ────
const _PERM_LABELS = {
  historicalEntry: 'Add / Edit Historical Transactions', deleteTransaction: 'Delete Transactions',
  refund: 'Issue Refunds', viewReports: 'View Reports & Payroll',
  manageStaff: 'Manage Staff', manageServices: 'Manage Services & Catalog',
  markPaidDirect: 'Mark Paid without charging (payment taken outside the app)',
  viewClockedIn: 'See Who’s Clocked In',
};
// Merged per role+key over the defaults, mirroring canDo() — the toggles must show
// what is actually enforced, even for keys added after the map was last saved.
function rolePerms() {
  const stored = cfg().role_permissions || {};
  const roles = [...new Set([...Object.keys(DEFAULT_ROLE_PERMISSIONS), ...Object.keys(stored)])];
  const out = {};
  roles.forEach(r => { out[r] = { ...(DEFAULT_ROLE_PERMISSIONS[r] || {}), ...(stored[r] || {}) }; });
  return out;
}
export function renderRolePermissions() {
  const el = document.getElementById('role-permissions-list');
  if (!el) return;
  const rp = rolePerms();
  const roles = Object.keys(rp);
  el.innerHTML = roles.length === 0 ? '<p class="text-sm font-body text-on-surface-variant">No configurable roles found.</p>'
    : roles.map(role => `<div class="mb-5 last:mb-0"><div class="font-headline font-semibold text-on-surface text-sm mb-2 capitalize">${role}</div>
      <div class="bg-surface-container-lowest rounded-xl border border-surface-container-high overflow-hidden">
        ${Object.entries(_PERM_LABELS).map(([perm,label]) => { const enabled = rp[role]?.[perm] ?? false; return `<div class="flex items-center justify-between px-4 py-2.5 border-b border-surface-container-high last:border-0"><span class="text-sm font-body text-on-surface">${label}</span><button onclick="toggleRolePermission('${role}','${perm}',this)" class="mswitch relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${enabled?'bg-primary':'bg-surface-container-high'}"><div class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${enabled?'left-7':'left-0.5'}"></div></button></div>`; }).join('')}
      </div></div>`).join('');
}
export function toggleRolePermission(role, perm, btn) {
  const rp = JSON.parse(JSON.stringify(rolePerms()));
  if (!rp[role]) rp[role] = {};
  rp[role][perm] = !rp[role][perm];
  dispatch('config.set', { key: 'role_permissions', value: rp });
  if (btn) setSwitchVisual(btn, rp[role][perm]); else renderRolePermissions();
  showToast('Permission updated ✓');
}

// Re-render role-gated panels on login/logout/role change.
export function updatePermissionGatedUI() {
  if (document.getElementById('panel-transactions')?.classList.contains('active')) window.renderTransactions?.();
  if (document.getElementById('panel-reports')?.classList.contains('active')) window.runReport?.();
  // Visibility of the role-permissions section is owned by the settings drill-down
  // (it's an admin-only leaf). Re-hide the wrapper so it never leaks into another
  // open leaf — BUT NOT while that leaf is the one currently open, or toggling a
  // permission (which fires a config change → this fn) would blank the screen.
  const permSection = document.getElementById('settings-role-permissions');
  const permContent = document.getElementById('settings-perms-section');
  const leafOpen = permContent && !permContent.classList.contains('hidden');
  if (permSection && !leafOpen) permSection.classList.add('hidden');
}

// ── Turn thresholds + bonus services ──────────────
export function saveTurnThresholds() {
  // "$X or less" cutoffs. Read only the inputs that are shown; fall back to the CURRENT stored value
  // (not a hardcoded default) so saving while one field is hidden can't reset the other.
  const c = getTurnConfig();
  const be = document.getElementById('thresh-bonus'), he = document.getElementById('thresh-half');
  const bonusMax = be ? (parseInt(be.value) || c.bonusMax) : c.bonusMax;
  const halfMax = he ? (parseInt(he.value) || c.halfMax) : c.halfMax;
  if (be && he && bonusMax >= halfMax) { showToast('The bonus cutoff must be less than the half cutoff.'); return; }
  saveTurnConfig({ bonusMax, halfMax });
  showToast('Cutoffs saved ✓');
}
export function renderBonusServicesList() {
  const el = document.getElementById('bonus-services-list');
  if (!el) return;
  // When the dedicated-counter feature is on, show which services currently have their own counter
  // (the first ≤3) so "first 3" isn't a hidden, uncontrollable artifact.
  const dedOn = getTurnConfig().dedicatedBonusCounters;
  const dedPos = new Map(getDedicatedBonusServices().map((s, i) => [s.id, i + 1]));
  el.innerHTML = cfg().services.map(s => {
    const isBonus = isAlwaysBonusService(s.id);
    const counter = dedOn && dedPos.has(s.id) ? `<span class="ml-auto text-[10px] font-semibold text-on-primary bg-primary rounded-full px-2 py-0.5">Counter ${dedPos.get(s.id)}</span>` : (isBonus ? '<span class="ml-auto text-[10px] font-semibold text-primary">Always Bonus</span>' : '');
    return `<label class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-surface-container transition-colors ${isBonus?'bg-primary/10 border border-primary/30':'border border-transparent'}"><input type="checkbox" class="w-5 h-5 accent-primary" ${isBonus?'checked':''} onchange="toggleBonusService('${s.id}', this.checked)"><span class="font-body font-semibold text-on-surface text-sm">${s.label}</span><span class="text-[10px] font-body text-outline">${s.abbr}</span>${counter}</label>`;
  }).join('');
}
export function toggleBonusService(serviceId, checked) {
  const ids = [...(cfg().bonus_services || [])];
  if (checked && !ids.includes(serviceId)) ids.push(serviceId);
  else if (!checked) { const i = ids.indexOf(serviceId); if (i > -1) ids.splice(i, 1); }
  saveBonusServices(ids);
  renderBonusServicesList();
  showToast(checked ? 'Marked as always bonus ✓' : 'Removed from always bonus');
}
// Item D: on/off half & bonus, each by cost and/or by service, + a precedence choice. The whole
// section re-renders on each flag/precedence change (they show/hide sub-controls); the two service
// lists keep their own cheap re-render so toggling one service doesn't rebuild the section.
function _turnMethodChk(label, flag, on, sub) {
  return `<label class="flex items-center gap-2 py-1 cursor-pointer">
    <input type="checkbox" class="w-4 h-4 accent-primary" ${on ? 'checked' : ''} onchange="toggleTurnFlag('${flag}', this.checked)">
    <span class="font-body text-sm text-on-surface">${label}</span>${sub ? `<span class="text-[11px] text-on-surface-variant">${sub}</span>` : ''}
  </label>`;
}
export function toggleTurnFlag(flag, checked) { saveTurnConfig({ [flag]: !!checked }); renderTurnsSettings(); }
export function setTurnPrecedence(value) { saveTurnConfig({ precedence: value }); renderTurnsSettings(); showToast('Precedence updated ✓'); }
export function renderHalfServicesList() {
  const el = document.getElementById('half-services-list');
  if (!el) return;
  el.innerHTML = cfg().services.map(s => { const on = isHalfService(s.id); return `<label class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-surface-container transition-colors ${on?'bg-primary/10 border border-primary/30':'border border-transparent'}"><input type="checkbox" class="w-5 h-5 accent-primary" ${on?'checked':''} onchange="toggleHalfService('${s.id}', this.checked)"><span class="font-body font-semibold text-on-surface text-sm">${s.label}</span><span class="text-[10px] font-body text-outline">${s.abbr}</span>${on?'<span class="ml-auto text-[10px] font-semibold text-primary">Half Turn</span>':''}</label>`; }).join('');
}
export function toggleHalfService(serviceId, checked) {
  const ids = [...(cfg().half_services || [])];
  if (checked && !ids.includes(serviceId)) ids.push(serviceId);
  else if (!checked) { const i = ids.indexOf(serviceId); if (i > -1) ids.splice(i, 1); }
  saveHalfServices(ids);
  renderHalfServicesList();
}
export function renderTurnsSettings() {
  const el = document.getElementById('turns-thresh-section');
  if (!el) return;
  const c = getTurnConfig();
  const noMethodHint = (enabled, byCost, byService, kind) => (enabled && !byCost && !byService)
    ? `<p class="text-[11px] font-body text-error mt-1">Pick at least one method, or nothing will count as a ${kind} turn.</p>` : '';
  // "$X or less = <kind> turn" cutoff, shown inline right under the category's By-cost checkbox.
  const cutoffRow = (id, val, kind) => `<div class="flex items-center gap-2 mt-1 mb-1 pl-6">
      <span class="text-sm font-body text-on-surface-variant">$</span>
      <input id="${id}" type="number" min="1" step="1" value="${val}" onchange="saveTurnThresholds()" class="w-20 border-2 border-surface-container-high bg-transparent rounded-lg px-2 py-1 text-sm font-headline text-on-surface focus:border-primary outline-none">
      <span class="text-sm font-body text-on-surface-variant">or less = ${kind} turn</span>
    </div>`;
  const precOpts = [['bonusFirst', 'Bonus → Half → Full (bonus wins)'], ['highestValue', 'Highest value wins (Full → Half → Bonus)'], ['costWins', 'Price decides (ignore service tags when priced)']];
  el.innerHTML = `
    <div class="mb-3 pb-3 border-b border-surface-container-high">
      <label class="flex items-center gap-2 cursor-pointer mb-1">
        <input type="checkbox" class="w-5 h-5 accent-primary" ${c.countOnAssign ? 'checked' : ''} onchange="toggleTurnFlag('countOnAssign', this.checked)">
        <span class="font-headline font-semibold text-on-surface">Count a turn when assigned</span>
      </label>
      <p class="pl-7 text-[11px] font-body text-on-surface-variant">On: a turn counts the moment a customer is assigned to a tech — waiting, in service, or done — using the service's base price. Off: a turn counts only once the service is marked Done or a price is entered. Either way, a service with no base price shows a “?” after the count until it's priced.</p>
    </div>
    <div class="mb-3">
      <label class="flex items-center gap-2 cursor-pointer mb-1">
        <input type="checkbox" class="w-5 h-5 accent-primary" ${c.halfEnabled ? 'checked' : ''} onchange="toggleTurnFlag('halfEnabled', this.checked)">
        <span class="font-headline font-semibold text-on-surface">Half turns</span>
      </label>
      ${c.halfEnabled ? `<div class="pl-7">
        <div class="text-[11px] text-on-surface-variant mb-1">Count a half turn by:</div>
        ${_turnMethodChk('Cost', 'halfByCost', c.halfByCost, '')}
        ${c.halfByCost ? cutoffRow('thresh-half', c.halfMax, 'half') : ''}
        ${_turnMethodChk('Service', 'halfByService', c.halfByService, '(a chosen list of services)')}
        ${noMethodHint(c.halfEnabled, c.halfByCost, c.halfByService, 'half')}
        ${c.halfByService ? `<div class="mt-2"><div class="text-[11px] font-semibold text-outline uppercase tracking-widest mb-1">Half-Turn Services</div><div id="half-services-list" class="space-y-2"></div></div>` : ''}
      </div>` : `<p class="pl-7 text-[11px] text-on-surface-variant">Off — these services count as full turns.</p>`}
    </div>
    <div class="border-t border-surface-container-high pt-3 mb-3">
      <label class="flex items-center gap-2 cursor-pointer mb-1">
        <input type="checkbox" class="w-5 h-5 accent-primary" ${c.bonusEnabled ? 'checked' : ''} onchange="toggleTurnFlag('bonusEnabled', this.checked)">
        <span class="font-headline font-semibold text-on-surface">Bonus turns</span>
      </label>
      ${c.bonusEnabled ? `<div class="pl-7">
        <div class="text-[11px] text-on-surface-variant mb-1">Count a bonus turn by:</div>
        ${_turnMethodChk('Cost', 'bonusByCost', c.bonusByCost, '')}
        ${c.bonusByCost ? cutoffRow('thresh-bonus', c.bonusMax, 'bonus') : ''}
        ${_turnMethodChk('Service', 'bonusByService', c.bonusByService, '(the always-bonus list below)')}
        ${noMethodHint(c.bonusEnabled, c.bonusByCost, c.bonusByService, 'bonus')}
        ${c.bonusByService ? `<div class="mt-2"><div class="text-[11px] font-semibold text-outline uppercase tracking-widest mb-1">Always-Bonus Services</div><p class="text-xs font-body text-on-surface-variant mb-2">Always count as bonus regardless of price (e.g. add-ons).</p><div id="bonus-services-list" class="space-y-2"></div></div>` : ''}
        <div class="mt-3 pt-2 border-t border-surface-container-high/60">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" class="w-5 h-5 accent-primary" ${c.dedicatedBonusCounters ? 'checked' : ''} onchange="toggleTurnFlag('dedicatedBonusCounters', this.checked)">
            <span class="font-body font-semibold text-on-surface text-sm">Separate counters for always-bonus add-ons</span>
          </label>
          <p class="pl-7 text-[11px] font-body text-on-surface-variant mt-0.5">Shows the first 3 services in the list above as their own per-tech counters next to the turn count, and keeps them out of the “+b” total.${!c.bonusByService ? ' <span style="color:#b0612a">Turn on “Count a bonus turn by: Service” above for these to count.</span>' : ''}</p>
        </div>
      </div>` : `<p class="pl-7 text-[11px] text-on-surface-variant">Off — these services count as full turns.</p>`}
    </div>
    <div class="border-t border-surface-container-high pt-3">
      <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">When rules overlap</label>
      <select onchange="setTurnPrecedence(this.value)" class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-3 py-2 text-sm font-body text-on-surface focus:border-primary outline-none">
        ${precOpts.map(([v, l]) => `<option value="${v}" ${c.precedence === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <p class="text-[11px] font-body text-on-surface-variant mt-1">If a service matches more than one rule (e.g. an always-bonus service priced like a full turn), this decides which wins.</p>
    </div>
  `;
  if (c.halfEnabled && c.halfByService) renderHalfServicesList();
  if (c.bonusEnabled && c.bonusByService) renderBonusServicesList();
}

// ── Calendar hours (device-local pref) ────────────
export function saveCalHours() {
  const start = parseInt(document.getElementById('cal-hour-start')?.value || '6');
  const end = parseInt(document.getElementById('cal-hour-end')?.value || '22');
  localStorage.setItem('muse_cal_hours', JSON.stringify({ start, end }));
  if (document.getElementById('panel-calendar')?.classList.contains('active')) window.calRenderGrid?.();
  showToast('Calendar hours updated ✓');
}
export function initCalHoursSelectors() {
  const c = JSON.parse(localStorage.getItem('muse_cal_hours') || 'null');
  if (!c) return;
  const s = document.getElementById('cal-hour-start'), e = document.getElementById('cal-hour-end');
  if (s) s.value = String(c.start ?? 6);
  if (e) e.value = String(c.end ?? 22);
}

// ── Square connection (from settings) ─────────────
export function saveSquareFromSettings() {
  const locationId = document.getElementById('settings-location-id')?.value.trim();
  if (!locationId) { showToast('Please enter a Location ID.'); return; }
  const applicationId = document.getElementById('settings-app-id')?.value.trim() || '';
  dispatch('config.set', { key: 'square_config', value: { ...cfg().square_config, locationId, applicationId } });
  const status = document.getElementById('settings-square-status'); if (status) status.textContent = '✓ Connected — Location: ' + locationId;
  showToast('Square connected ✓');
}

export function syncSquareFromSettings() {
  if (!cfg().square_config) { showToast('Connect a Location ID first.'); return; }
  window.syncSquare?.();
}


// ── Salon timezone (Business leaf, Phase 3 Stage 0) ─────────────────
// config.salon_tz decides which salon-local day/month every sale belongs to — the
// archive writer and all readers bucket by it, never by a device's own timezone.
// It must be set BEFORE the first archive write; changing it later re-buckets
// month boundaries for archived history, hence the set-once warning.
const US_TZS = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu'];
export function renderSalonTzSettings() {
  const el = document.getElementById('salontz-section'); if (!el) return;
  const cur = cfg().salon_tz || 'America/Los_Angeles';
  const zones = [...new Set([cur, ...US_TZS])];
  const opts = zones.map(z => `<option value="${escHtml(z)}" ${z === cur ? 'selected' : ''}>${escHtml(z.split('/').pop().replace(/_/g, ' '))} (${escHtml(z)})</option>`).join('');
  el.innerHTML = `
    <p class="text-sm font-body text-on-surface-variant mb-3">Will decide which month each sale is filed under when older history starts being archived — the same on every device, no matter where a device thinks it is. The salon runs on Pacific time (Los Angeles); only change this if the business moves.</p>
    <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Salon timezone</label>
    <div class="flex gap-2 mb-2">
      <select id="salon-tz" class="flex-1 px-3 py-2 rounded-xl border border-surface-container-high bg-surface-container-lowest text-sm font-body text-on-surface">${opts}</select>
      <button onclick="saveSalonTz()" class="btn-primary px-4 py-2 rounded-xl font-body font-bold text-sm">Save</button>
    </div>
    <div class="text-xs font-body text-on-surface-variant">⚠️ Set once, before archiving starts. Changing it later could make old sales near midnight show under a different month in reports.</div>`;
}
export function saveSalonTz() {
  const v = document.getElementById('salon-tz')?.value || '';
  if (!isValidTz(v)) { showToast('That timezone isn’t valid'); return; }
  const cur = cfg().salon_tz || '';
  if (v === cur) { showToast('Timezone unchanged'); return; }
  if (cur && !window.confirm('Change the salon timezone? Sales near midnight could move to a different day or month in reports.')) return;
  dispatch('config.set', { key: 'salon_tz', value: v });
  showToast('Salon timezone saved ✓');
  renderSalonTzSettings();
}

// ── App Info (Data & System leaf) ─────────────────
export function renderAppInfo() {
  const el = document.getElementById('appinfo-content');
  if (!el) return;
  const st = getState();
  const rows = [
    ['App version', APP_VERSION],
    ['Device ID', localStorage.getItem('muse_device_id') || '—'],
    ['Live sync', st.connected ? `Connected${st.pendingCount ? ` · ${st.pendingCount} pending` : ''}` : 'Offline'],
    ['Square', cfg().square_config ? `Connected · ${cfg().square_config.locationId}` : 'Not connected'],
    ['Server sign-in', getAppToken() ? `Active${getSessionUser()?.name ? ` · ${getSessionUser().name}` : ''}` : 'None yet — minted on the next PIN entry'],
  ];
  el.innerHTML = rows.map(([k, v]) => `
    <div class="flex items-center justify-between px-4 py-3 border-b border-surface-container-high last:border-0">
      <span class="text-sm font-body text-on-surface-variant">${k}</span>
      <span class="text-sm font-body font-semibold text-on-surface text-right break-all ml-4">${v}</span>
    </div>`).join('');
}

// ── Pay period (config.pay_period) — drives the Reports/Transactions quick button ─
export function renderPayPeriodSettings() {
  const el = document.getElementById('settings-payperiod-section'); if (!el) return;
  const pp = cfg().pay_period || {}; const type = pp.type || 'weekly';
  const needsStart = type === 'weekly' || type === 'biweekly';
  const lbl = 'text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1';
  const inp = 'w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary';
  el.innerHTML = `
    <p class="text-xs font-body text-on-surface-variant mb-4">Sets the <strong>Pay Period</strong> quick button in Reports &amp; Transactions (and the pay-period option for scheduled report emails).</p>
    <label class="${lbl}">Period</label>
    <select id="pp-type" onchange="savePayPeriod(); renderPayPeriodSettings()" class="${inp} mb-3">
      <option value="weekly" ${type==='weekly'?'selected':''}>Weekly</option>
      <option value="biweekly" ${type==='biweekly'?'selected':''}>Bi-weekly (every 2 weeks)</option>
      <option value="bimonthly" ${type==='bimonthly'?'selected':''}>Bi-monthly (1st–15th, 16th–end of month)</option>
    </select>
    ${needsStart ? `<label class="${lbl}">Period start date</label>
      <input type="date" id="pp-start" value="${pp.startDate||''}" onchange="savePayPeriod()" class="${inp}">
      <p class="text-[11px] font-body text-on-surface-variant mt-1">Repeats every ${type==='biweekly'?'14':'7'} days from this date — e.g., a Monday start runs Mon–Sun.</p>` : ''}
    <div class="mt-5 pt-4 border-t border-surface-container-high">
      <label class="${lbl}">Time-Clock Station</label>
      <p class="text-xs font-body text-on-surface-variant mb-2">Front-desk staff can clock in/out <strong>only on the designated station device</strong> — so nobody can clock in from a personal phone. Set this on the salon's front-desk device.</p>
      <div id="timeclock-station-status"></div>
    </div>
    <div class="mt-5 pt-4 border-t border-surface-container-high">
      <label class="${lbl}">Check-in Kiosk</label>
      <p class="text-xs font-body text-on-surface-variant mb-2">The front desk can <strong>send a check-in to this device</strong> so the customer reviews their details and signs the waiver themselves. Set this on the customer-facing kiosk device.</p>
      <div id="kiosk-device-status"></div>
    </div>
    <div class="mt-5 pt-4 border-t border-surface-container-high">
      <label class="${lbl}">Waiver Bypass Mode</label>
      <p class="text-xs font-body text-on-surface-variant mb-2">Temporarily <strong>skip waiver signing for every check-in</strong> (special circumstances). Leaves an audit trail; reminds you daily while it's on.</p>
      <div id="checkin-bypass-status"></div>
    </div>`;
  window.renderClockStationSetting?.();
  window.renderKioskDeviceSetting?.();
  window.renderCheckinBypassSetting?.();
}

// ── Check-in kiosk device (clones the time-clock station lock; admin-gated) ────
function _myDeviceId() { try { return localStorage.getItem('muse_device_id') || ''; } catch { return ''; } }
export function kioskDeviceId() { return (cfg().kiosk_device_id || '').trim(); }
export function setThisKioskDevice() {
  if (getActiveUser()?.role !== 'admin') { showToast('Only an admin can set the check-in kiosk.'); return; }
  const id = _myDeviceId();
  if (!id) { showToast('This device has no id yet — reload and try again.'); return; }
  dispatch('config.set', { key: 'kiosk_device_id', value: id });
  showToast('This device is now the check-in kiosk ✓');
  renderKioskDeviceSetting();
}
export function clearKioskDevice() {
  if (getActiveUser()?.role !== 'admin') { showToast('Only an admin can change the check-in kiosk.'); return; }
  dispatch('config.set', { key: 'kiosk_device_id', value: '' });
  showToast('Check-in kiosk cleared');
  renderKioskDeviceSetting();
}
export function renderKioskDeviceSetting() {
  const el = document.getElementById('kiosk-device-status'); if (!el) return;
  const setId = kioskDeviceId(), thisId = _myDeviceId(), isThis = !!setId && setId === thisId, isSet = !!setId;
  let row;
  if (isThis) {
    row = `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style="background:rgba(42,122,79,.12)"><span class="text-sm font-body" style="color:#1b5e20"><strong>This device</strong> is the check-in kiosk ✓</span><button onclick="clearKioskDevice()" class="text-xs font-body text-error underline flex-shrink-0">Remove</button></div>`;
  } else if (isSet) {
    row = `<div class="flex items-center justify-between gap-2 flex-wrap px-3 py-2 rounded-lg" style="background:#fef3c7"><span class="text-sm font-body" style="color:#7c4a03">⚠️ A kiosk is saved, but it’s <strong>not this device</strong>. If this should be the kiosk, make it the kiosk again.</span><button onclick="setThisKioskDevice()" class="px-3 py-2 rounded-xl bg-primary text-on-primary text-sm font-body font-semibold flex-shrink-0">Make this device the kiosk</button></div>`;
  } else {
    row = `<div class="flex items-center justify-between gap-2 flex-wrap"><span class="text-sm font-body text-on-surface-variant">No kiosk set — the front desk will hand its own device to the customer or skip the waiver.</span><button onclick="setThisKioskDevice()" class="px-3 py-2 rounded-xl bg-primary text-on-primary text-sm font-body font-semibold flex-shrink-0">Make this device the kiosk</button></div>`;
  }
  const ids = `<div class="text-[11px] font-body text-on-surface-variant mt-2" style="font-family:ui-monospace,Menlo,Consolas,monospace"><strong>This device:</strong> ${escHtml(thisId || '—')} &nbsp;·&nbsp; <strong>Saved kiosk:</strong> ${isSet ? escHtml(setId) + (isThis ? '' : ' (not this device)') : '— none —'}</div>`;
  el.innerHTML = row + ids;
}

// ── Waiver bypass mode (anyone can toggle, confirm on change, daily reminder) ──
export function renderCheckinBypassSetting() {
  const el = document.getElementById('checkin-bypass-status'); if (!el) return;
  const on = !!cfg().checkin_bypass_mode;
  el.innerHTML = `
    <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style="background:${on ? '#fef3c7' : 'transparent'}">
      <span class="text-sm font-body" style="${on ? 'color:#7c4a03' : ''}">${on ? '⚠️ <strong>Bypass mode is ON</strong> — waivers are NOT being signed at check-in.' : 'Off — waivers are captured normally.'}</span>
      <label class="mswitch" style="cursor:pointer"><input type="checkbox" id="checkin-bypass-toggle" ${on ? 'checked' : ''} onchange="toggleCheckinBypassMode(this.checked)"></label>
    </div>`;
}
export function toggleCheckinBypassMode(on) {
  if (on && !window.confirm('Turn ON bypass mode?\n\nThis SKIPS waiver signing for ALL check-ins on every device until you turn it back off. Use only for a special circumstance.')) { renderCheckinBypassSetting(); return; }
  if (!on && !window.confirm('Turn OFF bypass mode and resume waiver signing at check-in?')) { renderCheckinBypassSetting(); return; }
  dispatch('config.set', { key: 'checkin_bypass_mode', value: !!on });
  window.logAudit?.('Bypass mode', `${on ? 'ENABLED' : 'disabled'} by ${getActiveUser()?.name || 'staff'}`);
  try { localStorage.removeItem('muse_bypass_reminded'); } catch {}   // reset the once-a-day reminder gate
  showToast(on ? 'Bypass mode ON — waivers skipped' : 'Bypass mode off');
  renderCheckinBypassSetting();
}
// Owner asked for a daily reminder while bypass mode is on (instead of auto-off). Called from
// runDayRolloverIfNeeded (hydrate/midnight/tab-visible); once per day per device, deferred so it
// doesn't block boot. OK = turn it off now; Cancel = keep it on for today.
export function checkinBypassDailyReminder() {
  if (!cfg()?.checkin_bypass_mode) return;
  const today = (window.todayStr?.() || new Date().toISOString().slice(0, 10));
  let last = ''; try { last = localStorage.getItem('muse_bypass_reminded') || ''; } catch {}
  if (last === today) return;
  try { localStorage.setItem('muse_bypass_reminded', today); } catch {}
  setTimeout(() => {
    if (!cfg()?.checkin_bypass_mode) return;   // may have been turned off between scheduling and firing
    const turnOff = window.confirm('Reminder: check-in BYPASS MODE is still ON — customers are not signing the waiver.\n\nOK = turn it OFF now.   Cancel = keep it on for today.');
    if (!turnOff) return;
    dispatch('config.set', { key: 'checkin_bypass_mode', value: false });
    window.logAudit?.('Bypass mode', `disabled via daily reminder by ${getActiveUser()?.name || 'staff'}`);
    showToast('Bypass mode turned off');
    renderCheckinBypassSetting();
  }, 900);
}
export function savePayPeriod() {
  const type = document.getElementById('pp-type')?.value || 'weekly';
  const startDate = document.getElementById('pp-start')?.value || (cfg().pay_period||{}).startDate || '';
  dispatch('config.set', { key: 'pay_period', value: { type, startDate } });
  showToast('Pay period saved');
  window.renderTransactions?.(); window.runReport?.();
}

// ── Commission & refunds policy (config.commission_includes_refunds) ─────────────
export function renderCommissionSettings() {
  const el = document.getElementById('settings-commission-section'); if (!el) return;
  const on = !!cfg().commission_includes_refunds;
  el.innerHTML = `
    <p class="text-xs font-body text-on-surface-variant mb-4">When a transaction is refunded in the app, choose whether that refund <strong>reduces the technician’s commission</strong> for the original sale’s pay period.</p>
    <label class="flex items-center justify-between gap-4 cursor-pointer">
      <span class="text-sm font-body font-semibold text-on-surface">Refunds reduce tech commission</span>
      <input type="checkbox" ${on ? 'checked' : ''} onchange="setCommissionIncludesRefunds(this.checked)" class="w-5 h-5 accent-primary cursor-pointer">
    </label>
    <p class="text-[11px] font-body text-on-surface-variant mt-2">${on
      ? 'On — a refund subtracts the refunded amount from that technician’s billed total and commission (proportional for partial refunds).'
      : 'Off (default) — the salon absorbs refunds; technician commission is unchanged.'}</p>`;
}
export function setCommissionIncludesRefunds(checked) {
  dispatch('config.set', { key: 'commission_includes_refunds', value: !!checked });
  renderCommissionSettings();
  window.runReport?.(); window.renderPayrollPage?.();
  showToast(checked ? 'Refunds will reduce commission' : 'Refunds no longer affect commission');
}

// ── Numpad entry mode (config.numpad_whole_dollars) ─────────────────────────────
export function renderNumpadSettings() {
  const el = document.getElementById('settings-numpad-section'); if (!el) return;
  const whole = !!cfg().numpad_whole_dollars;
  const opt = (on, title, desc, val) => `<label class="flex items-center justify-between gap-4 cursor-pointer bg-surface-container-low rounded-xl px-4 py-3 border ${on ? 'border-primary' : 'border-surface-container-high'}">
      <span class="min-w-0"><span class="text-sm font-body font-semibold text-on-surface">${title}</span><span class="block text-[11px] font-body text-on-surface-variant">${desc}</span></span>
      <input type="radio" name="numpad-mode" ${on ? 'checked' : ''} onchange="setNumpadWholeDollars(${val})" class="w-5 h-5 accent-primary cursor-pointer flex-shrink-0"></label>`;
  el.innerHTML = `
    <p class="text-xs font-body text-on-surface-variant mb-4">How the on-screen number pad enters prices (services, items, fees).</p>
    <div class="space-y-2">
      ${opt(!whole, 'Cents', 'Every digit is a cent — type 4 5 0 0 for $45.00.', false)}
      ${opt(whole, 'Whole dollars', 'Digits build whole dollars — type 4 5 for $45.00. Use the dot for cents (e.g. $45.50).', true)}
    </div>`;
}
export function setNumpadWholeDollars(val) {
  dispatch('config.set', { key: 'numpad_whole_dollars', value: !!val });
  renderNumpadSettings();
  showToast(val ? 'Numpad: whole dollars' : 'Numpad: cents');
}

// ── Orchestrator ──────────────────────────────────
// ── Settings drill-down navigation ────────────────────────────────────────────
// Groups existing setting sections into 6 categories. Content is already rendered
// by renderSettingsPanel(); nav just toggles which section wrapper is visible.
const SETTINGS_NAV = [
  { id:'catalog', title:'Services, Items & Fees', desc:'What you sell', items:[
    { label:'Services', sub:'Add, edit, delete & visibility', content:'services-merged-section', render:'renderServicesMerged', perm:'manageServices', icon:'design_services' },
    { label:'Retail Items', sub:'Add-on items', content:'items-section', perm:'manageServices', icon:'inventory_2' },
    { label:'Fees', sub:'Flat or percentage fees', content:'fees-section', perm:'manageServices', icon:'percent' },
  ]},
  { id:'staff', title:'Staff & Access', desc:'People & permissions', items:[
    { label:'Technicians', sub:'Staff, photos, schedule & active toggle', content:'staff-merged-section', render:'renderStaffMerged', perm:'manageStaff', icon:'group' },
    { label:'Front Desk Users', sub:'Dashboard PIN login accounts', content:'fdusers-merged-section', render:'renderFdUsersList', adminOnly:true, icon:'badge' },
    { label:'Role Permissions', sub:'What each role can do', content:'settings-perms-section', render:'renderRolePermissions', adminOnly:true, icon:'lock' },
  ]},
  { id:'workflow', title:'Workflow', desc:'How the floor runs', items:[
    { label:'Turn Rules', sub:'Half / bonus on-off, by cost or service, cutoffs & precedence', content:'turns-thresh-section', render:'renderTurnsSettings', icon:'swap_vert' },
    { label:'Stations', sub:'Add, rename & delete pedicure / manicure seats', content:'settings-stations-section', render:'renderStationsSettings', icon:'event_seat' },
    { label:'Pay Period', sub:'Weekly / bi-weekly / bi-monthly for the quick button', content:'settings-payperiod-section', render:'renderPayPeriodSettings', adminOnly:true, icon:'event_repeat' },
    { label:'Commission & Refunds', sub:'Whether refunds reduce tech commission', content:'settings-commission-section', render:'renderCommissionSettings', adminOnly:true, icon:'paid' },
    { label:'Numpad Entry', sub:'Cents or whole dollars', content:'settings-numpad-section', render:'renderNumpadSettings', icon:'dialpad' },
    { label:'Turns Board Display', sub:'Text size & tech/turn separation (divider or lane) — set per device', content:'settings-turnsdisplay-section', render:'renderTurnsDisplaySettings', icon:'format_size' },
    { label:'Calendar Hours', sub:'Visible time range', content:'settings-calhours-section', icon:'schedule' },
  ]},
  { id:'integrations', title:'Integrations', desc:'Payments & messaging', items:[
    { label:'Payment Processing', sub:'Card processor, terminal & Square', content:'helcim-section', render:'renderHelcimSettings', icon:'credit_card' },
    { label:'Square', sub:'Location, connection & sync', content:'square-section', hidden:true, icon:'storefront' },   // reached from the Payment Processing panel
    { label:'Text Messaging', sub:'SMS confirmations & replies (httpSMS)', content:'sms-section', render:'renderSmsSettings', adminOnly:true, icon:'sms' },
    { label:'Back Office sync', sub:'Push daily sales & payroll to the books app', content:'bosync-section', render:'renderBoSyncSettings', adminOnly:true, icon:'sync' },
    { label:'Customer Directory', sub:'Browse synced customers', action:'showCustomerDir', icon:'contacts' },
  ]},
  { id:'business', title:'Business', desc:'Branding', items:[
    { label:'Business Logo', sub:'Header & report logo', content:'logo-section', icon:'image' },
    { label:'Price Menu', sub:'Edit the printed customer price menu', content:'settings-pricemenu-section', render:'renderPriceMenuEditor', adminOnly:true, icon:'receipt_long' },
    { label:'Receipt & Reviews', sub:'Re-routable review-QR link on printed receipts', content:'receipt-section', render:'renderReceiptSettings', adminOnly:true, icon:'reviews' },
    { label:'Service Waiver', sub:'Require & manage the check-in waiver + signed records', content:'waiver-section', render:'renderWaiverSettings', adminOnly:true, icon:'gavel' },
    { label:'Timezone', sub:'Which day & month each sale counts under', content:'salontz-section', render:'renderSalonTzSettings', adminOnly:true, icon:'schedule' },
  ]},
  { id:'data', title:'Data & System', desc:'Backup, logs & info', items:[
    { label:'Backup & Restore', sub:'Export / import data', content:'backup-section', icon:'backup' },
    { label:'Activity Log', sub:'All users, all devices', content:'settings-audit-section', render:'renderActivityLog', icon:'history' },
    { label:'Data Recovery', sub:'Find & restore lost check-ins', content:'settings-recovery-section', render:'renderRecoveryReport', adminOnly:true, icon:'restore_page' },
    { label:'Diagnostics', sub:'Automatic error log & bug alerts', content:'settings-diagnostics-section', render:'renderDiagnostics', adminOnly:true, icon:'bug_report' },
    { label:'Support', sub:'Staff help & feedback tickets', content:'settings-support-section', render:'renderSupportInbox', adminOrManager:true, icon:'support_agent' },
    { label:'App Info', sub:'Version & connection status', content:'appinfo-section', render:'renderAppInfo', icon:'info' },
  ]},
];
let _settingsView = 'root', _settingsCat = null;

function _hideAllSettingsSections() {
  const panel = document.getElementById('panel-settings');
  if (!panel) return;
  [...panel.children].forEach(ch => {
    if (ch.classList.contains('settings-nav-header') || ch.id === 'settings-root' || ch.id === 'settings-category') return;
    ch.classList.add('hidden');
  });
}
function _setSettingsHeader(title, desc, showBack) {
  const t = document.getElementById('settings-nav-title'); if (t) t.textContent = title;
  const d = document.getElementById('settings-nav-desc'); if (d) d.textContent = desc || '';
  const b = document.getElementById('settings-back-btn'); if (b) b.classList.toggle('hidden', !showBack);
}
// One iconned row, shared by the category drill-down list and the search results.
// `subText` overrides the default sub line (search shows "Category · sub").
function _settingsItemRow(it, subText) {
  return `<button onclick="${it.action ? it.action + '()' : `settingsOpenLeaf('${it.content}')`}" class="w-full flex items-center gap-4 px-5 py-4 bg-surface-container-lowest rounded-xl border border-surface-container-high mb-2 hover:bg-surface-container hover:border-primary/40 transition-colors text-left">
    <div class="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined text-primary">${it.icon || 'settings'}</span></div>
    <div class="min-w-0 flex-1"><div class="font-headline font-bold text-on-surface">${escHtml(it.label)}</div><div class="text-xs font-body text-on-surface-variant mt-0.5">${escHtml(subText != null ? subText : (it.sub || ''))}</div></div>
    <span class="material-symbols-outlined text-on-surface-variant flex-shrink-0">${it.action ? 'open_in_new' : 'chevron_right'}</span>
  </button>`;
}

export function settingsNavRoot() {
  if (window.pmEditorHasUnsaved?.() && window.pmGuardLeave) { window.pmGuardLeave(() => settingsNavRoot()); return; }
  if (window.catalogHasUnsaved?.() && window.catalogGuardLeave) { window.catalogGuardLeave(() => settingsNavRoot()); return; }
  _settingsView = 'root'; _settingsCat = null;
  _hideAllSettingsSections();
  document.getElementById('settings-category')?.classList.add('hidden');
  const sInput = document.getElementById('settings-search'); if (sInput) sInput.value = '';
  document.getElementById('settings-search-clear')?.classList.add('hidden');
  document.getElementById('settings-results')?.classList.add('hidden');
  document.getElementById('settings-search-wrap')?.classList.remove('hidden');
  document.getElementById('settings-root')?.classList.remove('hidden');
  _setSettingsHeader('Settings', 'Configure app behavior and customer options', false);
}

// One permission predicate for a settings leaf — reused by the category list, the in-panel search,
// AND the header global-search Settings group, so "who sees what" has a single source of truth.
export function settingsLeafVisible(it) {
  if (it.hidden) return false;
  const role = getActiveUser()?.role;
  if (it.adminOnly && role !== 'admin') return false;
  if (it.adminOrManager && !['admin', 'manager'].includes(role)) return false;
  if (it.perm && !canDo(it.perm)) return false;
  return true;
}
// Pure: filter the settings nav by a query + a visibility predicate → flat result rows (projected to
// just what a result row renders). Pure (predicate injected) so it's unit-testable without app state.
export function _settingsSearchRows(nav, query, visible) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  (nav || []).forEach(g => (g.items || []).forEach(it => {
    if (!visible(it)) return;
    if ((it.label + ' ' + (it.sub || '') + ' ' + g.title).toLowerCase().includes(q))
      out.push({ label: it.label, sub: it.sub || '', cat: g.title, content: it.content || null, action: it.action || null, icon: it.icon || 'settings' });
  }));
  return out;
}
// Consumed by the header global search (search.js) to surface Settings as results (same perm filter).
export function searchSettings(query) { return _settingsSearchRows(SETTINGS_NAV, query, settingsLeafVisible); }

// Live filter across the whole settings tree → jump straight to any leaf.
export function filterSettings(q) {
  // Switching views via the search box with an unsaved inline-catalog row open → guard it (parity with the
  // nav chokepoints). Inert unless a catalog row is dirty; the search box is also hidden inside leaf views.
  if (window.catalogHasUnsaved?.() && window.catalogGuardLeave) { window.catalogGuardLeave(() => filterSettings(q)); return; }
  const query = (q || '').trim().toLowerCase();
  document.getElementById('settings-search-clear')?.classList.toggle('hidden', !query);
  const results = document.getElementById('settings-results');
  const root = document.getElementById('settings-root');
  if (!query) { if (results) { results.classList.add('hidden'); results.innerHTML = ''; } root?.classList.remove('hidden'); return; }
  _settingsCat = null;   // searching resets category context so Back returns to the root
  const matches = _settingsSearchRows(SETTINGS_NAV, query, settingsLeafVisible);
  root?.classList.add('hidden');
  document.getElementById('settings-category')?.classList.add('hidden');
  if (!results) return;
  results.innerHTML = matches.length === 0
    ? `<p class="text-sm font-body text-on-surface-variant px-1 py-3">No settings match “${escHtml(query)}”.</p>`
    : matches.map(it => _settingsItemRow(it, it.cat + (it.sub ? ' · ' + it.sub : ''))).join('');
  results.classList.remove('hidden');
}
export function clearSettingsSearch() { const i = document.getElementById('settings-search'); if (i) { i.value = ''; filterSettings(''); i.focus(); } }
export function settingsOpenCategory(catId) {
  if (window.pmEditorHasUnsaved?.() && window.pmGuardLeave) { window.pmGuardLeave(() => settingsOpenCategory(catId)); return; }   // defense-in-depth (benign today; unreachable from a leaf view)
  if (window.catalogHasUnsaved?.() && window.catalogGuardLeave) { window.catalogGuardLeave(() => settingsOpenCategory(catId)); return; }
  const g = SETTINGS_NAV.find(x => x.id === catId); if (!g) return;
  _settingsView = 'cat'; _settingsCat = catId;
  _hideAllSettingsSections();
  document.getElementById('settings-root')?.classList.add('hidden');
  const list = document.getElementById('settings-category');
  const items = g.items.filter(settingsLeafVisible);
  list.innerHTML = items.length === 0 ? '<p class="text-sm font-body text-on-surface-variant px-1 py-3">Your role doesn’t have access to these settings.</p>' : items.map(it => _settingsItemRow(it)).join('');
  list.classList.remove('hidden');
  _setSettingsHeader(g.title, g.desc, true);
}
export function settingsOpenLeaf(contentId) {
  if (window.pmEditorHasUnsaved?.() && window.pmGuardLeave) { window.pmGuardLeave(() => settingsOpenLeaf(contentId)); return; }
  if (window.catalogHasUnsaved?.() && window.catalogGuardLeave) { window.catalogGuardLeave(() => settingsOpenLeaf(contentId)); return; }
  let item = null;
  SETTINGS_NAV.forEach(g => g.items.forEach(it => { if (it.content === contentId) item = it; }));
  // Single source of truth for access (settingsLeafVisible) — the nav + search already filter on it;
  // here we add the specific per-reason toast when it says no, so a future role-rule change is one spot.
  if (item && !settingsLeafVisible(item)) {
    const role = getActiveUser()?.role;
    if (item.adminOnly && role !== 'admin') showToast('Admin only.');
    else if (item.adminOrManager && !['admin', 'manager'].includes(role)) showToast('Admins & managers only.');
    else if (item.perm && !canDo(item.perm)) showToast(`Your role doesn’t have access to ${item.label}.`);
    return;
  }
  _settingsView = 'leaf';
  _hideAllSettingsSections();
  document.getElementById('settings-root')?.classList.add('hidden');
  document.getElementById('settings-category')?.classList.add('hidden');
  if (item?.render) window[item.render]?.();
  const content = document.getElementById(contentId);
  if (content) {
    const wrapper = content.parentElement;
    if (wrapper) wrapper.classList.remove('hidden');
    content.classList.remove('hidden');
    const hdr = wrapper?.querySelector(':scope > button'); if (hdr) hdr.classList.add('hidden');
  }
  // The price-menu editor renders while its section is still display:none (clientWidth 0), so its
  // fraction-based list-column width can't be computed until now — re-apply once it's visible.
  if (contentId === 'settings-pricemenu-section') window._applyPmListColW?.();
  _setSettingsHeader(item?.label || 'Settings', '', true);
}
export function settingsBack() {
  if (window.pmEditorHasUnsaved?.() && window.pmGuardLeave) { window.pmGuardLeave(() => settingsBack()); return; }
  if (window.catalogHasUnsaved?.() && window.catalogGuardLeave) { window.catalogGuardLeave(() => settingsBack()); return; }
  if (_settingsView === 'leaf' && _settingsCat) settingsOpenCategory(_settingsCat);
  else settingsNavRoot();
}

export function renderSettingsPanel() {
  renderServicesMerged();
  renderSettingsItems();
  renderSettingsFees();
  renderRolePermissions();
  initCalHoursSelectors();
  window.renderCalAutoHideSetting?.();
  window.renderApptReminderSettings?.();
  const lbl = document.getElementById('last-backup-label'); if (lbl) lbl.textContent = localStorage.getItem('muse_last_backup') || 'Never';
  setLogo();
  const sqStatus = document.getElementById('settings-square-status'), sqInput = document.getElementById('settings-location-id'), sqAppInput = document.getElementById('settings-app-id');
  if (sqStatus) sqStatus.textContent = cfg().square_config ? `✓ Connected — Location: ${cfg().square_config.locationId}` : 'Not connected';
  if (sqInput && cfg().square_config?.locationId) sqInput.value = cfg().square_config.locationId;
  if (sqAppInput && cfg().square_config?.applicationId) sqAppInput.value = cfg().square_config.applicationId;
  window.renderTerminalStatus?.();
  // Turn Rules settings are built on-demand by renderTurnsSettings (a render-leaf), not seeded here.
  settingsNavRoot();
}
