// ── Staff CRUD + weekly schedule ────────────────────────────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, localDateStr, byName } from '../utils.js';
import { SCHEDULE_COLORS } from '../config.js';

const cfg = () => getState().config;
const setStaff = (staff) => dispatch('config.set', { key: 'staff', value: staff });

// ── Active staff (config.inactive_staff) ──────────
export function isStaffActive(id) { return !cfg().inactive_staff.includes(id); }
export function toggleActiveStaff(id) {
  const inactive = cfg().inactive_staff;
  dispatch('config.set', { key: 'inactive_staff', value: inactive.includes(id) ? inactive.filter(x => x !== id) : [...inactive, id] });
  renderStaffList();
}
export function toggleAllActiveStaff() {
  dispatch('config.set', { key: 'inactive_staff', value: cfg().inactive_staff.length === 0 ? cfg().staff.map(s => s.id) : [] });
  renderStaffList();
}

// Re-render the list view, ensuring schedule view is hidden (settings leaf entry).
export function renderStaffMerged() { window.showStaffListView?.(); renderStaffList(); }

// ── Staff CRUD ────────────────────────────────────
export function renderStaffList() {
  const list = document.getElementById('staff-list');
  if (!list) return;
  list.innerHTML = [...cfg().staff].sort(byName).map(st => {
    const active = isStaffActive(st.id);
    const photoHtml = st.photo
      ? `<button onclick="showEditStaff('${st.id}')" class="flex-shrink-0 focus:outline-none"><img src="${st.photo}" class="w-10 h-10 rounded-full object-cover border border-surface-container-high hover:opacity-80 transition-opacity"></button>`
      : `<button onclick="showEditStaff('${st.id}')" class="flex-shrink-0 focus:outline-none"><div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center hover:bg-primary hover:text-on-primary transition-colors"><span class="text-sm font-headline font-bold text-on-surface">${st.name.charAt(0).toUpperCase()}</span></div></button>`;
    const staffSvcs = (st.services && st.services.length > 0)
      ? st.services.map(sid => cfg().services.find(s => s.id === sid)?.abbr || '?').join(', ')
      : 'All services';
    return `
    <div class="bg-surface-container-lowest rounded-xl px-5 py-4 border border-surface-container-high flex items-center justify-between">
      <div class="flex items-center gap-4 min-w-0">
        ${photoHtml}
        <div class="min-w-0">
          <div class="font-headline font-semibold text-on-surface text-base ${active ? '' : 'line-through text-outline-variant'}">${st.name}</div>
          <div class="flex gap-3 flex-wrap mt-0.5">
            ${st.commission != null ? `<span class="text-xs font-body text-on-surface-variant">${st.commission}% commission</span>` : ''}
            <span class="text-xs font-body text-primary truncate">${staffSvcs}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <button onclick="toggleActiveStaff('${st.id}')" title="${active ? 'Active — shown in menus' : 'Inactive — hidden from menus'}" class="flex flex-col items-center gap-1 px-1 py-1">
          <span class="text-[9px] font-body uppercase tracking-wider ${active ? 'text-primary' : 'text-outline-variant'}">Active</span>
          <div class="mswitch relative w-14 h-7 rounded-full transition-colors ${active ? 'bg-primary' : 'bg-surface-container-high'}"><div class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${active ? 'left-7' : 'left-0.5'}"></div></div>
        </button>
        <div class="flex items-center gap-1">
          <button onclick="showPhotoUpload('staff','${st.id}')" title="Photo" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors"><span class="material-symbols-outlined" style="font-size:18px">photo_camera</span></button>
          <button onclick="showEditStaff('${st.id}')" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors"><span class="material-symbols-outlined" style="font-size:18px">edit</span></button>
          <button onclick="deleteStaff('${st.id}')" class="w-9 h-9 rounded-full hover:bg-error/10 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function renderStaffServicesPicker(selectedServices) {
  const picker = document.getElementById('staff-services-picker');
  if (!picker) return;
  picker.innerHTML = cfg().services.map(s => {
    const sel = selectedServices && selectedServices.includes(s.id);
    return `<button type="button" onclick="this.classList.toggle('selected')" data-service="${s.id}"
      class="service-btn flex flex-col items-center justify-center py-2 rounded-lg border transition-all text-xs ${sel ? 'bg-primary text-on-primary border-primary selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30'}">
      <span class="font-headline font-bold">${s.abbr}</span>
      <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter">${s.label}</span>
    </button>`;
  }).join('');
}

export function showAddStaff() {
  document.getElementById('staff-modal-title').textContent = 'Add Technician';
  document.getElementById('staff-name-input').value = '';
  document.getElementById('staff-commission-input').value = '';
  const pinEl = document.getElementById('staff-pin-input'); if (pinEl) pinEl.value = '';
  document.getElementById('staff-edit-id').value = '';
  _setStaffCheckFields('variable', '');
  renderStaffServicesPicker([]);
  const m = document.getElementById('staff-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => document.getElementById('staff-name-input').focus(), 100);
}

export function showEditStaff(id) {
  const st = cfg().staff.find(s => s.id === id);
  if (!st) return;
  document.getElementById('staff-modal-title').textContent = 'Edit Technician';
  document.getElementById('staff-name-input').value = st.name;
  document.getElementById('staff-commission-input').value = st.commission != null ? st.commission : '';
  const pinEl = document.getElementById('staff-pin-input'); if (pinEl) pinEl.value = st.pin || '';
  document.getElementById('staff-edit-id').value = id;
  _setStaffCheckFields(st.checkType || 'variable', st.checkValue != null ? st.checkValue : '');
  renderStaffServicesPicker(st.services || []);
  const m = document.getElementById('staff-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}

export function closeStaffModal() {
  const m = document.getElementById('staff-modal'); m.classList.add('hidden'); m.style.display = '';
}
// Paycheck (gross) config — how the tech's check portion is set on the Payroll page.
function _setStaffCheckFields(type, value) {
  const ts = document.getElementById('staff-check-type'); if (ts) ts.value = type;
  const vi = document.getElementById('staff-check-value'); if (vi) vi.value = value;
  staffCheckTypeChanged();
}
export function staffCheckTypeChanged() {
  const type = document.getElementById('staff-check-type')?.value || 'variable';
  const wrap = document.getElementById('staff-check-value-wrap');
  const lbl = document.getElementById('staff-check-value-label');
  if (wrap) wrap.classList.toggle('hidden', type === 'variable');
  if (lbl) lbl.textContent = type === 'percent' ? '% of commission' : 'Check amount ($)';
}

export function saveStaff() {
  const name = document.getElementById('staff-name-input').value.trim();
  const commRaw = document.getElementById('staff-commission-input').value.trim();
  const commission = commRaw !== '' ? parseFloat(commRaw) : null;
  const pin = (document.getElementById('staff-pin-input')?.value || '').trim();
  const checkType = document.getElementById('staff-check-type')?.value || 'variable';
  const checkValue = checkType === 'variable' ? null : (parseFloat(document.getElementById('staff-check-value')?.value) || 0);
  const editId = document.getElementById('staff-edit-id').value;
  const selectedSvcs = [...document.querySelectorAll('#staff-services-picker .service-btn.selected')].map(b => b.dataset.service);
  if (!name) { showToast('Please enter a name.'); return; }
  if (commission !== null && (isNaN(commission) || commission < 0 || commission > 100)) { showToast('Commission must be 0–100.'); return; }
  // Soft-warn (don't block) if this Staff-App PIN collides with another tech's — same PIN logs in as whoever matches first.
  if (pin && cfg().staff.some(s => s.id !== editId && s.pin === pin)) showToast('Heads up: another tech already uses that PIN.');
  const staff = [...cfg().staff];
  if (editId) {
    const i = staff.findIndex(s => s.id === editId);
    if (i >= 0) staff[i] = { ...staff[i], name, commission, services: selectedSvcs, pin, checkType, checkValue };
  } else {
    staff.push({ id: `staff-${Date.now()}`, name, commission, services: selectedSvcs, pin, checkType, checkValue });
  }
  setStaff(staff);
  closeStaffModal();
  renderStaffList();
  showToast(editId ? 'Technician updated' : `${name} added`);
}

export function deleteStaff(id) {
  const st = cfg().staff.find(s => s.id === id);
  if (!st) return;
  if (!confirm(`Remove ${st.name} from staff?`)) return;
  setStaff(cfg().staff.filter(s => s.id !== id));
  renderStaffList();
  showToast(`${st.name} removed`);
}

// ── Weekly schedule ───────────────────────────────
let scheduleWeekStart = getWeekStart(new Date());
let schedulePickerTarget = null;

export function getWeekStart(d) {
  const date = new Date(d); date.setHours(0,0,0,0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

export function scheduleWeekOffset(delta, goToToday = false) {
  if (goToToday) scheduleWeekStart = getWeekStart(new Date());
  else { scheduleWeekStart = new Date(scheduleWeekStart); scheduleWeekStart.setDate(scheduleWeekStart.getDate() + delta * 7); }
  renderSchedule();
}

export function getScheduleStatus(date, staffId) {
  const sched = cfg().schedule || {};
  if (sched[date]?.[staffId]) return sched[date][staffId];
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  return sched._repeats?.[staffId]?.[dayOfWeek] || null;
}

export function renderSchedule() {
  const grid = document.getElementById('schedule-grid');
  const label = document.getElementById('schedule-week-label');
  if (!grid || !label) return;
  const sched = cfg().schedule || {};
  const weekEnd = new Date(scheduleWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  label.textContent = `${fmtShort(scheduleWeekStart)} – ${fmtShort(weekEnd)}`;

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dates = days.map((_, i) => { const d = new Date(scheduleWeekStart); d.setDate(d.getDate() + i); return d; });
  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = d => d.toDateString() === today.toDateString();

  const headerCols = dates.map((d, i) => `
    <div class="text-center px-2 py-2 min-w-[90px]">
      <div class="text-[11px] font-body font-semibold text-on-surface-variant uppercase tracking-widest">${days[i]}</div>
      <div class="text-sm font-headline font-bold ${isToday(d) ? 'text-primary' : 'text-on-surface'}">${d.getDate()}</div>
    </div>`).join('');

  const staffRows = [...cfg().staff].sort(byName).map(st => {
    const photoHtml = st.photo
      ? `<img src="${st.photo}" class="w-9 h-9 rounded-full object-cover border border-surface-container-high flex-shrink-0">`
      : `<div class="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-xs font-headline font-bold text-on-surface">${st.name.charAt(0).toUpperCase()}</span></div>`;
    const cells = dates.map(d => {
      const key = localDateStr(d);
      const status = getScheduleStatus(key, st.id);
      const isRepeat = !sched[key]?.[st.id] && sched._repeats?.[st.id]?.[d.getDay()];
      const sColor = status ? SCHEDULE_COLORS[status] : null;
      const cellStyle = sColor ? `background:${sColor.bg};color:${sColor.text};` : '';
      const isPast = d < today && !isToday(d);
      return `
        <div class="min-w-[90px] px-1 py-1">
          <button onclick="openSchedulePicker('${key}','${st.id}')"
            class="w-full h-10 rounded-lg text-xs font-body font-semibold transition-all hover:opacity-80 border relative ${sColor ? 'border-transparent' : 'border-dashed border-outline-variant/50 hover:bg-surface-container'} ${isPast ? 'opacity-50' : ''}"
            style="${cellStyle}">${sColor ? sColor.label : ''}
            ${isRepeat ? '<span style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.7)"></span>' : ''}
          </button>
        </div>`;
    }).join('');
    return `
      <div class="flex items-center border-b border-surface-container-high last:border-0">
        <div class="flex items-center gap-2 min-w-[130px] pr-3 py-2 flex-shrink-0">${photoHtml}
          <span class="text-sm font-body font-semibold text-on-surface truncate">${st.name}</span></div>
        ${cells}
      </div>`;
  }).join('');

  grid.innerHTML = `
    <div class="flex items-center border-b-2 border-surface-container-high">
      <div class="min-w-[130px] flex-shrink-0"></div>${headerCols}
    </div>
    ${staffRows || '<div class="text-sm font-body text-on-surface-variant py-8 text-center">No staff added yet. Add staff in the Staff tab.</div>'}`;
}

export function openSchedulePicker(date, staffId) {
  schedulePickerTarget = { date, staffId };
  const st = cfg().staff.find(s => s.id === staffId);
  const d  = new Date(date + 'T12:00:00');
  document.getElementById('schedule-picker-label').textContent = `${st?.name || ''} — ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const cb  = document.getElementById('repeat-toggle-cb');
  const box = document.getElementById('repeat-toggle-box');
  const chk = document.getElementById('repeat-toggle-check');
  if (cb)  cb.checked = false;
  if (box) { box.style.background = 'transparent'; box.style.borderColor = ''; }
  if (chk) chk.classList.add('hidden');
  const m = document.getElementById('schedule-picker'); m.classList.remove('hidden'); m.style.display = 'flex';
}

export function toggleRepeatSchedule() {
  const cb  = document.getElementById('repeat-toggle-cb');
  const box = document.getElementById('repeat-toggle-box');
  const chk = document.getElementById('repeat-toggle-check');
  cb.checked = !cb.checked;
  if (cb.checked) { box.style.background = '#2f80d8'; box.style.borderColor = '#2f80d8'; chk.classList.remove('hidden'); }
  else { box.style.background = 'transparent'; box.style.borderColor = ''; chk.classList.add('hidden'); }
}

export function closeSchedulePicker() {
  const m = document.getElementById('schedule-picker'); m.classList.add('hidden'); m.style.display = '';
  schedulePickerTarget = null;
}

export function setScheduleStatus(status) {
  if (!schedulePickerTarget) return;
  const { date, staffId } = schedulePickerTarget;
  const repeat = document.getElementById('repeat-toggle-cb')?.checked || false;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const sched = JSON.parse(JSON.stringify(cfg().schedule || {}));

  if (repeat && status !== null) {
    if (!sched._repeats) sched._repeats = {};
    if (!sched._repeats[staffId]) sched._repeats[staffId] = {};
    sched._repeats[staffId][dayOfWeek] = status;
  } else if (repeat && status === null) {
    if (sched._repeats?.[staffId]?.[dayOfWeek]) delete sched._repeats[staffId][dayOfWeek];
  }
  if (!sched[date]) sched[date] = {};
  if (status === null) { delete sched[date][staffId]; if (Object.keys(sched[date]).length === 0) delete sched[date]; }
  else sched[date][staffId] = status;

  dispatch('config.set', { key: 'schedule', value: sched });
  closeSchedulePicker();
  renderSchedule();
}
