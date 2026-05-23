// ── Settings panel ──────────────────────────────────────────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, byName } from '../utils.js';
import { canDo, getActiveUser, ui } from '../session.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../config.js';
import { renderServicesMerged, renderSettingsItems, renderSettingsFees } from './catalog.js';
import { setLogo } from './photos.js';
import { getTurnConfig, saveTurnConfig, isAlwaysBonusService, saveBonusServices } from './turns.js';
import { loadSquareCustomers } from './square-customers.js';

const cfg = () => getState().config;

export function toggleSettingsSection(sectionId) {
  const section = document.getElementById(sectionId);
  const icon = document.getElementById(sectionId + '-icon');
  if (!section) return;
  const isHidden = section.classList.contains('hidden');
  section.classList.toggle('hidden', !isHidden);
  if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : '';
}

// ── Done-card visibility (transient UI state) ─────
export function toggleDoneVisibility() {
  ui.showDoneInQueue = !ui.showDoneInQueue;
  const icon = document.getElementById('done-toggle-icon'), label = document.getElementById('done-toggle-label');
  if (icon) icon.textContent = ui.showDoneInQueue ? 'visibility_off' : 'visibility';
  if (label) label.textContent = ui.showDoneInQueue ? 'Hide Done' : 'Show Done';
  window.renderQueue?.();
}

// ── Active staff (config.inactive_staff) ──────────
export function isStaffActive(id) { return !cfg().inactive_staff.includes(id); }
export function toggleActiveStaff(id) {
  const inactive = cfg().inactive_staff;
  dispatch('config.set', { key: 'inactive_staff', value: inactive.includes(id) ? inactive.filter(x => x !== id) : [...inactive, id] });
  renderSettingsActiveStaff();
}
export function toggleAllActiveStaff() {
  dispatch('config.set', { key: 'inactive_staff', value: cfg().inactive_staff.length === 0 ? cfg().staff.map(s => s.id) : [] });
  renderSettingsActiveStaff();
}
export function renderSettingsActiveStaff() {
  const container = document.getElementById('settings-active-staff');
  if (!container) return;
  container.innerHTML = [...cfg().staff].sort(byName).map(st => {
    const active = isStaffActive(st.id);
    return `<div class="flex items-center justify-between py-2 border-b border-surface-container-high last:border-0">
      <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center"><span class="text-sm font-headline font-bold text-on-surface">${st.name.charAt(0)}</span></div><span class="font-body font-semibold text-on-surface ${active?'':'line-through text-outline-variant'}">${st.name}</span></div>
      <button onclick="toggleActiveStaff('${st.id}')" class="relative w-12 h-6 rounded-full transition-colors ${active?'bg-primary':'bg-surface-container-high'}"><div class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${active?'left-6':'left-0.5'}"></div></button></div>`;
  }).join('');
}

// ── Role permissions (config.role_permissions) ────
const _PERM_LABELS = {
  historicalEntry: 'Add / Edit Historical Transactions', deleteTransaction: 'Delete Transactions',
  refund: 'Issue Refunds', viewReports: 'View Reports & Transactions',
  manageStaff: 'Manage Staff', manageServices: 'Manage Services & Catalog',
};
function rolePerms() {
  const stored = cfg().role_permissions;
  return (stored && Object.keys(stored).length) ? stored : DEFAULT_ROLE_PERMISSIONS;
}
export function renderRolePermissions() {
  const el = document.getElementById('role-permissions-list');
  if (!el) return;
  const rp = rolePerms();
  const roles = Object.keys(rp);
  el.innerHTML = roles.length === 0 ? '<p class="text-sm font-body text-on-surface-variant">No configurable roles found.</p>'
    : roles.map(role => `<div class="mb-5 last:mb-0"><div class="font-headline font-semibold text-on-surface text-sm mb-2 capitalize">${role}</div>
      <div class="bg-surface-container-lowest rounded-xl border border-surface-container-high overflow-hidden">
        ${Object.entries(_PERM_LABELS).map(([perm,label]) => { const enabled = rp[role]?.[perm] ?? false; return `<div class="flex items-center justify-between px-4 py-2.5 border-b border-surface-container-high last:border-0"><span class="text-sm font-body text-on-surface">${label}</span><button onclick="toggleRolePermission('${role}','${perm}')" class="relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-4 ${enabled?'bg-primary':'bg-surface-container-high'}"><div class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled?'left-5':'left-0.5'}"></div></button></div>`; }).join('')}
      </div></div>`).join('');
}
export function toggleRolePermission(role, perm) {
  const rp = JSON.parse(JSON.stringify(rolePerms()));
  if (!rp[role]) rp[role] = {};
  rp[role][perm] = !rp[role][perm];
  dispatch('config.set', { key: 'role_permissions', value: rp });
  renderRolePermissions();
  showToast('Permission updated ✓');
}

// Re-render role-gated panels on login/logout/role change.
export function updatePermissionGatedUI() {
  if (document.getElementById('panel-transactions')?.classList.contains('active')) window.renderTransactions?.();
  if (document.getElementById('panel-reports')?.classList.contains('active')) window.runReport?.();
  // Visibility of the role-permissions section is owned by the settings drill-down
  // (it's an admin-only leaf). Keep the wrapper hidden here so it never leaks into
  // another open leaf; the drill-down un-hides it when that leaf is opened.
  const permSection = document.getElementById('settings-role-permissions');
  if (permSection) permSection.classList.add('hidden');
}

// ── Audit log (device-local deletion log) ─────────
export function loadAuditLog() {
  const el = document.getElementById('audit-log-content');
  if (!el) return;
  const log = JSON.parse(localStorage.getItem('muse_deletion_log') || '[]');
  el.innerHTML = !log.length ? '<p class="text-sm text-on-surface-variant">No audit entries yet.</p>'
    : [...log].reverse().map(entry => { const dt = new Date(entry.deletedAt); return `<div class="bg-surface-container rounded-xl px-4 py-3 text-sm font-body border border-surface-container-high"><div class="flex items-center justify-between mb-1"><span class="font-semibold text-on-surface">${entry.name || '—'}</span><span class="text-xs text-outline">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div><div class="text-xs text-on-surface-variant">Deleted by ${entry.deletedBy} · $${(entry.total||0).toFixed(2)}</div>${entry.reason?`<div class="text-xs text-outline mt-1">Reason: ${entry.reason}</div>`:''}</div>`; }).join('');
}

// ── Turn thresholds + bonus services ──────────────
export function saveTurnThresholds() {
  const fullMin = parseInt(document.getElementById('thresh-full')?.value) || 28;
  const halfMin = parseInt(document.getElementById('thresh-half')?.value) || 12;
  if (halfMin >= fullMin) { showToast('Half min must be less than full min.'); return; }
  saveTurnConfig({ fullMin, halfMin });
  showToast('Turn thresholds saved ✓');
}
export function renderBonusServicesList() {
  const el = document.getElementById('bonus-services-list');
  if (!el) return;
  el.innerHTML = cfg().services.map(s => { const isBonus = isAlwaysBonusService(s.id); return `<label class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-surface-container transition-colors ${isBonus?'bg-primary/10 border border-primary/30':'border border-transparent'}"><input type="checkbox" class="w-4 h-4 accent-primary" ${isBonus?'checked':''} onchange="toggleBonusService('${s.id}', this.checked)"><span class="font-body font-semibold text-on-surface text-sm">${s.label}</span><span class="text-[10px] font-body text-outline">${s.abbr}</span>${isBonus?'<span class="ml-auto text-[10px] font-semibold text-primary">Always Bonus</span>':''}</label>`; }).join('');
}
export function toggleBonusService(serviceId, checked) {
  const ids = [...cfg().bonus_services];
  if (checked && !ids.includes(serviceId)) ids.push(serviceId);
  else if (!checked) { const i = ids.indexOf(serviceId); if (i > -1) ids.splice(i, 1); }
  saveBonusServices(ids);
  renderBonusServicesList();
  showToast(checked ? 'Marked as always bonus ✓' : 'Removed from always bonus');
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
  dispatch('config.set', { key: 'square_config', value: { locationId } });
  const status = document.getElementById('settings-square-status'); if (status) status.textContent = '✓ Connected — Location: ' + locationId;
  loadSquareCustomers();
  showToast('Square connected ✓');
}

// ── First-time setup wizard ───────────────────────
export function showSetupWizard() { const w = document.getElementById('setup-wizard'); if (!w) return; w.classList.remove('hidden'); w.style.display = 'flex'; setTimeout(() => document.getElementById('setup-location-id')?.focus(), 300); }
export function hideSetupWizard() { const w = document.getElementById('setup-wizard'); if (!w) return; w.classList.add('hidden'); w.style.display = ''; }
export function completeSetup() {
  const locationId = document.getElementById('setup-location-id')?.value.trim();
  if (!locationId) { showToast('Please enter your Square Location ID.'); return; }
  dispatch('config.set', { key: 'square_config', value: { locationId } });
  hideSetupWizard(); loadSquareCustomers();
  showToast('Connected to Square ✓');
}
export function skipSetup() { sessionStorage.setItem('muse_setup_skipped', '1'); hideSetupWizard(); showToast('Running without Square. You can connect later in Settings.'); }

// ── Embedded settings panels ──────────────────────
export function renderStaffEmbed() {
  const el = document.getElementById('settings-staff-embed');
  if (!el) return;
  el.innerHTML = `<div class="text-sm font-body text-on-surface-variant mb-3">Manage staff, photos, commission rates and schedules.</div>
    <button onclick="showDashPanel('staff')" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm hover:bg-primary-dim transition-colors mb-3"><span class="material-symbols-outlined" style="font-size:16px">open_in_full</span> Open Full Staff Manager</button>`;
  window.renderStaffList?.();
}
export function renderServicesEmbed() {
  const el = document.getElementById('settings-services-embed');
  if (!el) return;
  el.innerHTML = `<div class="text-sm font-body text-on-surface-variant mb-3">Add, edit or remove services and set base costs.</div>
    <button onclick="showDashPanel('services')" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm hover:bg-primary-dim transition-colors"><span class="material-symbols-outlined" style="font-size:16px">open_in_full</span> Open Full Services Manager</button>`;
}

// ── Orchestrator ──────────────────────────────────
// ── Settings drill-down navigation ────────────────────────────────────────────
// Groups existing setting sections into 6 categories. Content is already rendered
// by renderSettingsPanel(); nav just toggles which section wrapper is visible.
const SETTINGS_NAV = [
  { id:'catalog', title:'Services, Items & Fees', desc:'What you sell', items:[
    { label:'Services', sub:'Add, edit, delete & visibility', content:'services-merged-section', render:'renderServicesMerged' },
    { label:'Retail Items', sub:'Add-on items', content:'items-section' },
    { label:'Fees', sub:'Flat or percentage fees', content:'fees-section' },
  ]},
  { id:'staff', title:'Staff & Access', desc:'People & permissions', items:[
    { label:'Technicians', sub:'Manage staff, photos, commission', content:'settings-staff-section', render:'renderStaffEmbed' },
    { label:'Active Staff', sub:'Who appears in menus', content:'active-staff-section' },
    { label:'Role Permissions', sub:'What each role can do', content:'settings-perms-section', adminOnly:true },
  ]},
  { id:'workflow', title:'Workflow', desc:'How the floor runs', items:[
    { label:'Turn Thresholds', sub:'Full / half / bonus cutoffs', content:'turns-thresh-section' },
    { label:'Calendar Hours', sub:'Visible time range', content:'settings-calhours-section' },
  ]},
  { id:'integrations', title:'Integrations', desc:'Square & Google', items:[
    { label:'Square', sub:'Location & connection', content:'square-section' },
    { label:'Customer Directory', sub:'Browse synced customers', action:'showCustomerDir' },
  ]},
  { id:'business', title:'Business', desc:'Branding', items:[
    { label:'Business Logo', sub:'Header & report logo', content:'logo-section' },
  ]},
  { id:'data', title:'Data & System', desc:'Backup & logs', items:[
    { label:'Backup & Restore', sub:'Export / import data', content:'backup-section' },
    { label:'Audit Log', sub:'Deletions & admin actions', content:'settings-audit-section', render:'loadAuditLog' },
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
export function settingsNavRoot() {
  _settingsView = 'root'; _settingsCat = null;
  _hideAllSettingsSections();
  document.getElementById('settings-category')?.classList.add('hidden');
  document.getElementById('settings-root')?.classList.remove('hidden');
  _setSettingsHeader('Settings', 'Configure app behavior and customer options', false);
}
export function settingsOpenCategory(catId) {
  const g = SETTINGS_NAV.find(x => x.id === catId); if (!g) return;
  _settingsView = 'cat'; _settingsCat = catId;
  _hideAllSettingsSections();
  document.getElementById('settings-root')?.classList.add('hidden');
  const isAdmin = getActiveUser()?.role === 'admin';
  const list = document.getElementById('settings-category');
  list.innerHTML = g.items.filter(it => !it.adminOnly || isAdmin).map(it => `
    <button onclick="${it.action ? it.action + '()' : `settingsOpenLeaf('${it.content}')`}" class="w-full flex items-center justify-between px-5 py-4 bg-surface-container-lowest rounded-xl border border-surface-container-high mb-2 hover:bg-surface-container transition-colors text-left">
      <div><div class="font-headline font-bold text-on-surface">${it.label}</div><div class="text-xs font-body text-on-surface-variant mt-0.5">${it.sub || ''}</div></div>
      <span class="material-symbols-outlined text-on-surface-variant">${it.action ? 'open_in_new' : 'chevron_right'}</span>
    </button>`).join('');
  list.classList.remove('hidden');
  _setSettingsHeader(g.title, g.desc, true);
}
export function settingsOpenLeaf(contentId) {
  let item = null;
  SETTINGS_NAV.forEach(g => g.items.forEach(it => { if (it.content === contentId) item = it; }));
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
  _setSettingsHeader(item?.label || 'Settings', '', true);
}
export function settingsBack() {
  if (_settingsView === 'leaf' && _settingsCat) settingsOpenCategory(_settingsCat);
  else settingsNavRoot();
}

export function renderSettingsPanel() {
  renderServicesMerged();
  renderSettingsActiveStaff();
  renderSettingsItems();
  renderSettingsFees();
  renderRolePermissions();
  initCalHoursSelectors();
  const lbl = document.getElementById('last-backup-label'); if (lbl) lbl.textContent = localStorage.getItem('muse_last_backup') || 'Never';
  setLogo();
  const sqStatus = document.getElementById('settings-square-status'), sqInput = document.getElementById('settings-location-id');
  if (sqStatus) sqStatus.textContent = cfg().square_config ? `✓ Connected — Location: ${cfg().square_config.locationId}` : 'Not connected';
  if (sqInput && cfg().square_config?.locationId) sqInput.value = cfg().square_config.locationId;
  const c = getTurnConfig();
  const fi = document.getElementById('thresh-full'), hi = document.getElementById('thresh-half');
  if (fi) fi.value = c.fullMin;
  if (hi) hi.value = c.halfMin;
  renderBonusServicesList();
  settingsNavRoot();
}
