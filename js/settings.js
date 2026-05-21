// ── Settings Panel ────────────────────────────────
// Services visible on customer-facing check-in — in-memory; loaded from Sheets
let hiddenCheckinServices = [];
let hiddenDashServices    = [];
let showDoneInQueue = true; // toggle for showing/hiding done cards in queue tab

// Retail items — in-memory; loaded from Sheets on startup
let ITEMS = [];

// Fees — in-memory; loaded from Sheets on startup
let FEES = [];

function saveItems() {
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}
function saveFees() {
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}


// ── Staff & Service Visibility ─────────────────────────────────────────────────
let inactiveStaff = [];


function saveInactiveStaff() { /* in-memory — callers push via pushConfigToSheets() */ }

function isStaffActive(id) { return !inactiveStaff.includes(id); }
function getActiveStaff()  { return STAFF.filter(s => isStaffActive(s.id)); }

function toggleDoneVisibility() {
  showDoneInQueue = !showDoneInQueue;
  const icon  = document.getElementById('done-toggle-icon');
  const label = document.getElementById('done-toggle-label');
  if (icon)  icon.textContent  = showDoneInQueue ? 'visibility_off' : 'visibility';
  if (label) label.textContent = showDoneInQueue ? 'Hide Done' : 'Show Done';
  renderQueue();
}

function isServiceVisibleOnCheckin(id) {
  return !hiddenCheckinServices.includes(id);
}

function saveHiddenServices() { /* in-memory — callers push via pushConfigToSheets() */ }

function toggleSettingsSection(sectionId) {
  const section = document.getElementById(sectionId);
  const icon    = document.getElementById(sectionId + '-icon');
  if (!section) return;
  const isHidden = section.classList.contains('hidden');
  section.classList.toggle('hidden', !isHidden);
  if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : '';
}

// renderSettingsPanel defined below

function renderSettingsServiceVisibility() {
  const container = document.getElementById('settings-service-visibility');
  if (!container) return;
  container.innerHTML = SERVICES.map(s => {
    const visible = isServiceVisibleOnCheckin(s.id);
    return `
      <div class="flex items-center justify-between py-2 border-b border-surface-container-high last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span class="text-xs font-headline font-bold text-on-primary">${s.abbr}</span>
          </div>
          <span class="font-body font-semibold text-on-surface">${s.label}</span>
        </div>
        <button onclick="toggleCheckinService('${s.id}')"
          class="relative w-12 h-6 rounded-full transition-colors ${visible ? 'bg-primary' : 'bg-surface-container-high'}">
          <div class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${visible ? 'left-6' : 'left-0.5'}"></div>
        </button>
      </div>`;
  }).join('');
}

function renderSettingsActiveStaff() {
  const container = document.getElementById('settings-active-staff');
  if (!container) return;
  container.innerHTML = STAFF.map(st => {
    const active = isStaffActive(st.id);
    return `
      <div class="flex items-center justify-between py-2 border-b border-surface-container-high last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center">
            <span class="text-sm font-headline font-bold text-on-surface">${st.name.charAt(0)}</span>
          </div>
          <span class="font-body font-semibold text-on-surface ${active ? '' : 'line-through text-outline-variant'}">${st.name}</span>
        </div>
        <button onclick="toggleActiveStaff('${st.id}')"
          class="relative w-12 h-6 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-surface-container-high'}">
          <div class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${active ? 'left-6' : 'left-0.5'}"></div>
        </button>
      </div>`;
  }).join('');
}

function toggleCheckinService(id) {
  if (hiddenCheckinServices.includes(id)) hiddenCheckinServices = hiddenCheckinServices.filter(x => x !== id);
  else hiddenCheckinServices.push(id);
  saveHiddenServices();
  renderSettingsServiceVisibility();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}

function toggleAllCheckinServices() {
  hiddenCheckinServices = hiddenCheckinServices.length === 0 ? SERVICES.map(s => s.id) : [];
  saveHiddenServices();
  renderSettingsServiceVisibility();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}

function toggleActiveStaff(id) {
  if (inactiveStaff.includes(id)) inactiveStaff = inactiveStaff.filter(x => x !== id);
  else inactiveStaff.push(id);
  saveInactiveStaff();
  renderSettingsActiveStaff();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}

function toggleAllActiveStaff() {
  inactiveStaff = inactiveStaff.length === 0 ? STAFF.map(s => s.id) : [];
  saveInactiveStaff();
  renderSettingsActiveStaff();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}


// ── First-Time Setup Wizard ───────────────────────
function saveSquareFromSettings() {
  const locationId = document.getElementById('settings-location-id')?.value.trim();
  if (!locationId) { showToast('Please enter a Location ID.'); return; }
  squareConfig = { locationId };
  localStorage.setItem('muse_sq_config', JSON.stringify(squareConfig));
  updateSyncLabel('ok', 'Square synced');
  const status = document.getElementById('settings-square-status');
  if (status) status.textContent = '✓ Connected — Location: ' + locationId;
  loadSquareCustomers();
  showToast('Square connected ✓');
}

function showSetupWizard() {
  const wizard = document.getElementById('setup-wizard');
  if (!wizard) return;
  wizard.classList.remove('hidden');
  wizard.style.display = 'flex';
  setTimeout(() => document.getElementById('setup-location-id')?.focus(), 300);
}

function hideSetupWizard() {
  const wizard = document.getElementById('setup-wizard');
  if (!wizard) return;
  wizard.classList.add('hidden');
  wizard.style.display = '';
}

function completeSetup() {
  const locationId = document.getElementById('setup-location-id')?.value.trim();
  if (!locationId) {
    showToast('Please enter your Square Location ID.');
    return;
  }
  squareConfig = { locationId };
  localStorage.setItem('muse_sq_config', JSON.stringify(squareConfig));
  updateSyncLabel('ok', 'Square synced');
  hideSetupWizard();
  loadSquareCustomers();
  showToast('Connected to Square ✓');
}

function skipSetup() {
  // Mark as skipped so wizard doesn't show again this session
  sessionStorage.setItem('muse_setup_skipped', '1');
  hideSetupWizard();
  showToast('Running without Square. You can connect later in Settings.');
}


// ── Settings embedded panels ─────────────────────
function renderStaffEmbed() {
  const el = document.getElementById('settings-staff-embed');
  if (!el) return;
  el.innerHTML = `<div class="text-sm font-body text-on-surface-variant mb-3">Manage staff, photos, commission rates and schedules.</div>
    <button onclick="showDashPanel('staff')" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm hover:bg-primary-dim transition-colors mb-3">
      <span class="material-symbols-outlined" style="font-size:16px">open_in_full</span> Open Full Staff Manager
    </button>`;
  // Re-render the staff list (live, not a clone — cloneNode loses event listeners)
  renderStaffList();
}

function renderServicesEmbed() {
  const el = document.getElementById('settings-services-embed');
  if (!el) return;
  el.innerHTML = `<div class="text-sm font-body text-on-surface-variant mb-3">Add, edit or remove services and set base costs.</div>
    <button onclick="showDashPanel('services')" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-body font-semibold text-sm hover:bg-primary-dim transition-colors">
      <span class="material-symbols-outlined" style="font-size:16px">open_in_full</span> Open Full Services Manager
    </button>`;
}


// ── Audit Log ─────────────────────────────────────
function loadAuditLog() {
  const el = document.getElementById('audit-log-content');
  if (!el) return;
  const log = JSON.parse(localStorage.getItem('muse_deletion_log') || '[]');
  if (!log.length) { el.innerHTML = '<p class="text-sm text-on-surface-variant">No audit entries yet.</p>'; return; }
  el.innerHTML = [...log].reverse().map(entry => {
    const dt = new Date(entry.deletedAt);
    return `<div class="bg-surface-container rounded-xl px-4 py-3 text-sm font-body border border-surface-container-high">
      <div class="flex items-center justify-between mb-1">
        <span class="font-semibold text-on-surface">${entry.name || '—'}</span>
        <span class="text-xs text-outline">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
      </div>
      <div class="text-xs text-on-surface-variant">Deleted by ${entry.deletedBy} · $${(entry.total||0).toFixed(2)}</div>
      ${entry.reason ? `<div class="text-xs text-outline mt-1">Reason: ${entry.reason}</div>` : ''}
    </div>`;
  }).join('');
}


