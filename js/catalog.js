// ── Services CRUD ────────────────────────────────
function renderServicesList() {
  const list = document.getElementById('services-list');
  if (!list) return;
  list.innerHTML = SERVICES.map(s => `
    <div class="bg-surface-container-lowest rounded-xl px-5 py-4 border border-surface-container-high flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
          <span class="text-xs font-headline font-bold text-on-primary">${s.abbr}</span>
        </div>
        <div>
          <span class="font-headline font-semibold text-on-surface text-base">${s.label}</span>
          ${s.baseCost != null ? `<div class="text-xs font-body text-on-surface-variant mt-0.5">Base: $${Number(s.baseCost).toFixed(2)}</div>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="showEditService('${s.id}')" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors">
          <span class="material-symbols-outlined" style="font-size:18px">edit</span>
        </button>
        <button onclick="deleteService('${s.id}')" class="w-9 h-9 rounded-full hover:bg-error/10 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors">
          <span class="material-symbols-outlined" style="font-size:18px">delete</span>
        </button>
      </div>
    </div>
  `).join('');
}

function showAddService() {
  document.getElementById('service-modal-title').textContent = 'Add Service';
  document.getElementById('service-name-input').value = '';
  document.getElementById('service-abbr-input').value = '';
  document.getElementById('service-base-cost-input').value = '';
  document.getElementById('service-edit-id').value = '';
  document.getElementById('service-modal').classList.remove('hidden');
  document.getElementById('service-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('service-name-input').focus(), 100);
}

function showEditService(id) {
  const svc = SERVICES.find(s => s.id === id);
  if (!svc) return;
  document.getElementById('service-modal-title').textContent = 'Edit Service';
  document.getElementById('service-name-input').value = svc.label;
  document.getElementById('service-abbr-input').value = svc.abbr;
  document.getElementById('service-base-cost-input').value = svc.baseCost != null ? svc.baseCost : '';
  document.getElementById('service-edit-id').value = id;
  document.getElementById('service-modal').classList.remove('hidden');
  document.getElementById('service-modal').style.display = 'flex';
}

function closeServiceModal() {
  document.getElementById('service-modal').classList.add('hidden');
  document.getElementById('service-modal').style.display = '';
}

function saveService() {
  const label    = document.getElementById('service-name-input').value.trim();
  const abbr     = document.getElementById('service-abbr-input').value.trim();
  const baseCostRaw = document.getElementById('service-base-cost-input').value.trim();
  const baseCost = baseCostRaw !== '' ? parseFloat(baseCostRaw) : null;
  const editId   = document.getElementById('service-edit-id').value;
  if (!label) { showToast('Please enter a service name.'); return; }
  if (!abbr)  { showToast('Please enter an abbreviation.'); return; }
  // Prevent duplicate labels (case-insensitive)
  const duplicate = SERVICES.find(s => s.label.toLowerCase() === label.toLowerCase() && s.id !== editId);
  if (duplicate) { showToast(`"${label}" already exists as a service.`); return; }
  let changedSvc;
  if (editId) {
    changedSvc = SERVICES.find(s => s.id === editId);
    if (changedSvc) { changedSvc.label = label; changedSvc.abbr = abbr; changedSvc.baseCost = baseCost; }
  } else {
    changedSvc = { id: `svc-${Date.now()}`, label, abbr, baseCost };
    SERVICES.push(changedSvc);
  }
  saveServicesToStorage();
  closeServiceModal();
  renderServicesList();
  showToast(editId ? 'Service updated' : `"${label}" added`);
  // Fire-and-forget: sync to Square catalog if configured
  if (squareConfig && changedSvc) squarePushService(changedSvc);
}

function deleteService(id) {
  const svc = SERVICES.find(s => s.id === id);
  if (!svc) return;
  if (!confirm(`Remove "${svc.label}" from services?`)) return;
  SERVICES = SERVICES.filter(s => s.id !== id);
  saveServicesToStorage();
  renderServicesList();
  showToast(`"${svc.label}" removed`);
}


// ── Dashboard service visibility ──────────────────
function isServiceVisibleOnDash(id) { return !hiddenDashServices.includes(id); }
function saveHiddenDashServices() {
  // in-memory — no local write; callers invoke pushConfigToSheets() directly
}
function toggleDashService(id) {
  if (hiddenDashServices.includes(id)) hiddenDashServices = hiddenDashServices.filter(x => x !== id);
  else hiddenDashServices.push(id);
  saveHiddenDashServices();
  renderSettingsDashServiceVisibility();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}
function toggleAllDashServices() {
  hiddenDashServices = hiddenDashServices.length === 0 ? SERVICES.map(s => s.id) : [];
  saveHiddenDashServices();
  renderSettingsDashServiceVisibility();
}
function renderSettingsDashServiceVisibility() {
  const container = document.getElementById('settings-dash-service-visibility');
  if (!container) return;
  container.innerHTML = SERVICES.map(s => {
    const visible = isServiceVisibleOnDash(s.id);
    return `
      <div class="flex items-center justify-between py-2 border-b border-surface-container-high last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center">
            <span class="text-xs font-headline font-bold text-on-surface">${s.abbr}</span>
          </div>
          <span class="font-body font-semibold text-on-surface">${s.label}</span>
        </div>
        <button onclick="toggleDashService('${s.id}')"
          class="relative w-12 h-6 rounded-full transition-colors ${visible ? 'bg-primary' : 'bg-surface-container-high'}">
          <div class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${visible ? 'left-6' : 'left-0.5'}"></div>
        </button>
      </div>`;
  }).join('');
}


// ── Items settings render ─────────────────────────
function renderSettingsItems() {
  const container = document.getElementById('settings-items-list');
  if (!container) return;
  container.innerHTML = ITEMS.map((item, i) => `
    <div class="flex items-center gap-2 py-2 border-b border-surface-container-high last:border-0">
      <input type="text" value="${item.label}" placeholder="Item name"
        onchange="ITEMS[${i}].label=this.value; saveItems()"
        class="flex-1 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none">
      <input type="text" value="${item.abbr}" placeholder="Abbr"
        onchange="ITEMS[${i}].abbr=this.value; saveItems()"
        class="w-16 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body font-semibold focus:border-primary outline-none text-center">
      <div class="flex items-center gap-1">
        <span class="text-sm text-on-surface-variant">$</span>
        <input type="text" inputmode="decimal" value="${item.price || ''}" placeholder="0.00"
          onchange="ITEMS[${i}].price=parseFloat(this.value)||0; saveItems()"
          class="w-16 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none text-right">
      </div>
      ${squareConfig ? `<button onclick="squarePushItem(ITEMS[${i}])" title="Push to Square" class="text-outline-variant hover:text-primary transition-colors flex-shrink-0">
        <span class="material-symbols-outlined" style="font-size:16px">point_of_sale</span>
      </button>` : ''}
      <button onclick="removeItem(${i})" class="text-outline-variant hover:text-error transition-colors flex-shrink-0">
        <span class="material-symbols-outlined" style="font-size:16px">delete</span>
      </button>
    </div>`).join('') || '<p class="text-sm text-on-surface-variant py-2">No items yet.</p>';
}

function addItemRow() {
  ITEMS.push({ id: 'item-' + Date.now(), label: '', abbr: '', price: 0 });
  saveItems();
  renderSettingsItems();
}
function removeItem(i) {
  ITEMS.splice(i, 1);
  saveItems();
  renderSettingsItems();
}
function saveItemInline(i) {
  const row = document.querySelectorAll('#settings-items-list > div')[i];
  if (!row) return;
  const label = row.querySelector('input:first-child')?.value.trim() || '';
  if (!label) { showToast('Item name cannot be blank.'); return; }
  // Check for duplicate label (excluding self)
  const dup = ITEMS.find((it, idx) => idx !== i && it.label.toLowerCase() === label.toLowerCase());
  if (dup) { showToast(`"${label}" already exists as an item.`); return; }
  saveItems();
}


// ── Fees settings render ──────────────────────────
function renderSettingsFees() {
  const container = document.getElementById('settings-fees-list');
  if (!container) return;
  container.innerHTML = FEES.map((fee, i) => `
    <div class="flex items-center gap-2 py-2 border-b border-surface-container-high last:border-0">
      <input type="text" value="${fee.label}" placeholder="Fee name"
        onchange="FEES[${i}].label=this.value; saveFees()"
        class="flex-1 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none">
      <select onchange="FEES[${i}].type=this.value; saveFees()"
        class="bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none">
        <option value="flat"    ${fee.type==='flat'   ?'selected':''}>Flat $</option>
        <option value="percent" ${fee.type==='percent'?'selected':''}>Percent %</option>
      </select>
      <input type="text" inputmode="decimal" value="${fee.value || ''}" placeholder="0"
        onchange="FEES[${i}].value=parseFloat(this.value)||0; saveFees()"
        class="w-16 bg-transparent border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:border-primary outline-none text-right">
      <button onclick="removeFee(${i})" class="text-outline-variant hover:text-error transition-colors">
        <span class="material-symbols-outlined" style="font-size:16px">delete</span>
      </button>
    </div>`).join('') || '<p class="text-sm text-on-surface-variant py-2">No fees yet.</p>';
}

function addFeeRow() {
  FEES.push({ id: 'fee-' + Date.now(), label: '', type: 'flat', value: 0 });
  saveFees();
  renderSettingsFees();
}
function removeFee(i) {
  FEES.splice(i, 1);
  saveFees();
  renderSettingsFees();
}
function saveFeeInline(i) {
  const row = document.querySelectorAll('#settings-fees-list > div')[i];
  if (!row) return;
  const label = row.querySelector('input:first-child')?.value.trim() || '';
  if (!label) { showToast('Fee name cannot be blank.'); return; }
  const dup = FEES.find((f, idx) => idx !== i && f.label.toLowerCase() === label.toLowerCase());
  if (dup) { showToast(`"${label}" already exists as a fee.`); return; }
  saveFees();
}

