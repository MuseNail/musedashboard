// ── Staff CRUD ────────────────────────────────────
function renderStaffList() {
  const list = document.getElementById('staff-list');
  if (!list) return;
  list.innerHTML = STAFF.map(st => {
    const photoHtml = st.photo
      ? `<button onclick="showEditStaff('${st.id}')" class="flex-shrink-0 focus:outline-none"><img src="${st.photo}" class="w-10 h-10 rounded-full object-cover border border-surface-container-high hover:opacity-80 transition-opacity"></button>`
      : `<button onclick="showEditStaff('${st.id}')" class="flex-shrink-0 focus:outline-none"><div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center hover:bg-primary hover:text-on-primary transition-colors"><span class="text-sm font-headline font-bold text-on-surface">${st.name.charAt(0).toUpperCase()}</span></div></button>`;

    // Services this tech does (empty = all services)
    const staffSvcs = (st.services && st.services.length > 0)
      ? st.services.map(sid => SERVICES.find(s=>s.id===sid)?.abbr || '?').join(', ')
      : 'All services';

    return `
    <div class="bg-surface-container-lowest rounded-xl px-5 py-4 border border-surface-container-high flex items-center justify-between">
      <div class="flex items-center gap-4 min-w-0">
        ${photoHtml}
        <div class="min-w-0">
          <div class="font-headline font-semibold text-on-surface text-base">${st.name}</div>
          <div class="flex gap-3 flex-wrap mt-0.5">
            ${st.commission != null ? `<span class="text-xs font-body text-on-surface-variant">${st.commission}% commission</span>` : ''}
            <span class="text-xs font-body text-primary truncate">${staffSvcs}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button onclick="showPhotoUpload('staff','${st.id}')" title="Photo" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors">
          <span class="material-symbols-outlined" style="font-size:18px">photo_camera</span>
        </button>
        <button onclick="showEditStaff('${st.id}')" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors">
          <span class="material-symbols-outlined" style="font-size:18px">edit</span>
        </button>
        <button onclick="deleteStaff('${st.id}')" class="w-9 h-9 rounded-full hover:bg-error/10 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors">
          <span class="material-symbols-outlined" style="font-size:18px">delete</span>
        </button>
      </div>
    </div>
  `}).join('');
}

function renderStaffServicesPicker(selectedServices) {
  const picker = document.getElementById('staff-services-picker');
  if (!picker) return;
  picker.innerHTML = SERVICES.map(s => {
    const sel = selectedServices && selectedServices.includes(s.id);
    return `
      <button type="button" onclick="this.classList.toggle('selected')" data-service="${s.id}"
        class="service-btn flex flex-col items-center justify-center py-2 rounded-lg border transition-all text-xs ${sel ? 'bg-primary text-on-primary border-primary selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30'}">
        <span class="font-headline font-bold">${s.abbr}</span>
        <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter">${s.label}</span>
      </button>`;
  }).join('');
}

function showAddStaff() {
  document.getElementById('staff-modal-title').textContent = 'Add Technician';
  document.getElementById('staff-name-input').value = '';
  document.getElementById('staff-commission-input').value = '';
  document.getElementById('staff-edit-id').value = '';
  renderStaffServicesPicker([]);
  document.getElementById('staff-modal').classList.remove('hidden');
  document.getElementById('staff-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('staff-name-input').focus(), 100);
}

function showEditStaff(id) {
  const st = STAFF.find(s => s.id === id);
  if (!st) return;
  document.getElementById('staff-modal-title').textContent = 'Edit Technician';
  document.getElementById('staff-name-input').value = st.name;
  document.getElementById('staff-commission-input').value = st.commission != null ? st.commission : '';
  document.getElementById('staff-edit-id').value = id;
  renderStaffServicesPicker(st.services || []);
  document.getElementById('staff-modal').classList.remove('hidden');
  document.getElementById('staff-modal').style.display = 'flex';
}

function closeStaffModal() {
  document.getElementById('staff-modal').classList.add('hidden');
  document.getElementById('staff-modal').style.display = '';
}

function saveStaff() {
  const name = document.getElementById('staff-name-input').value.trim();
  const commRaw = document.getElementById('staff-commission-input').value.trim();
  const commission = commRaw !== '' ? parseFloat(commRaw) : null;
  const editId = document.getElementById('staff-edit-id').value;
  const selectedSvcs = [...document.querySelectorAll('#staff-services-picker .service-btn.selected')].map(b => b.dataset.service);
  if (!name) { showToast('Please enter a name.'); return; }
  if (commission !== null && (isNaN(commission) || commission < 0 || commission > 100)) {
    showToast('Commission must be 0–100.'); return;
  }
  if (editId) {
    const st = STAFF.find(s => s.id === editId);
    if (st) { st.name = name; st.commission = commission; st.services = selectedSvcs; }
  } else {
    STAFF.push({ id: `staff-${Date.now()}`, name, commission, services: selectedSvcs });
  }
  saveStaffToStorage();
  closeStaffModal();
  renderStaffList();
  showToast(editId ? 'Technician updated' : `${name} added`);
}

function deleteStaff(id) {
  const st = STAFF.find(s => s.id === id);
  if (!st) return;
  if (!confirm(`Remove ${st.name} from staff?`)) return;
  STAFF = STAFF.filter(s => s.id !== id);
  saveStaffToStorage();
  renderStaffList();
  showToast(`${st.name} removed`);
}


// ── Schedule Calendar ─────────────────────────────
const SCHEDULE_COLORS = {
  working:  { bg: '#1a5252', text: '#ffffff', label: 'Working' },
  off:      { bg: '#f5c870', text: '#3a2800', label: 'Off' },
  sick:     { bg: '#fa746f', text: '#ffffff', label: 'Sick' },
  vacation: { bg: '#adb3b5', text: '#000000', label: 'Vacation' },
};

// scheduleData: { 'YYYY-MM-DD': { staffId: status } }
let scheduleData = JSON.parse(localStorage.getItem('muse_schedule') || '{}');
let scheduleWeekStart = getWeekStart(new Date());
let schedulePickerTarget = null; // { date, staffId }

function saveScheduleData() {
  localStorage.setItem('muse_schedule', JSON.stringify(scheduleData));
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}

function getWeekStart(d) {
  const date = new Date(d);
  date.setHours(0,0,0,0);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}

function scheduleWeekOffset(delta, goToToday = false) {
  if (goToToday) {
    scheduleWeekStart = getWeekStart(new Date());
  } else {
    scheduleWeekStart = new Date(scheduleWeekStart);
    scheduleWeekStart.setDate(scheduleWeekStart.getDate() + delta * 7);
  }
  renderSchedule();
}

function renderSchedule() {
  const grid = document.getElementById('schedule-grid');
  const label = document.getElementById('schedule-week-label');
  if (!grid || !label) return;

  const weekEnd = new Date(scheduleWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const fmtShort = d => d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
  label.textContent = `${fmtShort(scheduleWeekStart)} – ${fmtShort(weekEnd)}`;

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dates = days.map((_, i) => {
    const d = new Date(scheduleWeekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = d => d.toDateString() === today.toDateString();

  // Header row
  const headerCols = dates.map((d, i) => `
    <div class="text-center px-2 py-2 min-w-[90px]">
      <div class="text-[11px] font-body font-semibold text-on-surface-variant uppercase tracking-widest">${days[i]}</div>
      <div class="text-sm font-headline font-bold ${isToday(d) ? 'text-primary' : 'text-on-surface'}">${d.getDate()}</div>
    </div>
  `).join('');

  // Staff rows
  const staffRows = STAFF.map(st => {
    const photoHtml = st.photo
      ? `<img src="${st.photo}" class="w-9 h-9 rounded-full object-cover border border-surface-container-high flex-shrink-0">`
      : `<div class="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-xs font-headline font-bold text-on-surface">${st.name.charAt(0).toUpperCase()}</span></div>`;

    const cells = dates.map(d => {
      const key = localDateStr(d);
      const status = getScheduleStatus(key, st.id);
      const isRepeat = !scheduleData[key]?.[st.id] && scheduleData._repeats?.[st.id]?.[d.getDay()];
      const sColor = status ? SCHEDULE_COLORS[status] : null;
      const cellStyle = sColor ? `background:${sColor.bg};color:${sColor.text};` : '';
      const cellLabel = sColor ? sColor.label : '';
      const isPast = d < today && !isToday(d);
      return `
        <div class="min-w-[90px] px-1 py-1">
          <button onclick="openSchedulePicker('${key}','${st.id}')"
            class="w-full h-10 rounded-lg text-xs font-body font-semibold transition-all hover:opacity-80 border relative ${sColor ? 'border-transparent' : 'border-dashed border-outline-variant/50 hover:bg-surface-container'} ${isPast ? 'opacity-50' : ''}"
            style="${cellStyle}">
            ${cellLabel}
            ${isRepeat ? '<span style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.7)"></span>' : ''}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="flex items-center border-b border-surface-container-high last:border-0">
        <div class="flex items-center gap-2 min-w-[130px] pr-3 py-2 flex-shrink-0">
          ${photoHtml}
          <span class="text-sm font-body font-semibold text-on-surface truncate">${st.name}</span>
        </div>
        ${cells}
      </div>
    `;
  }).join('');

  grid.innerHTML = `
    <div class="flex items-center border-b-2 border-surface-container-high">
      <div class="min-w-[130px] flex-shrink-0"></div>
      ${headerCols}
    </div>
    ${staffRows || '<div class="text-sm font-body text-on-surface-variant py-8 text-center">No staff added yet. Add staff in the Staff tab.</div>'}
  `;
}

function openSchedulePicker(date, staffId) {
  schedulePickerTarget = { date, staffId };
  const st = STAFF.find(s => s.id === staffId);
  const d  = new Date(date + 'T12:00:00');
  const fmtDate = d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
  document.getElementById('schedule-picker-label').textContent = `${st?.name || ''} — ${fmtDate}`;

  // Reset repeat toggle
  const cb  = document.getElementById('repeat-toggle-cb');
  const box = document.getElementById('repeat-toggle-box');
  const chk = document.getElementById('repeat-toggle-check');
  if (cb)  cb.checked = false;
  if (box) { box.style.background = 'transparent'; box.style.borderColor = ''; }
  if (chk) chk.classList.add('hidden');

  document.getElementById('schedule-picker').classList.remove('hidden');
  document.getElementById('schedule-picker').style.display = 'flex';
}

function toggleRepeatSchedule() {
  const cb  = document.getElementById('repeat-toggle-cb');
  const box = document.getElementById('repeat-toggle-box');
  const chk = document.getElementById('repeat-toggle-check');
  cb.checked = !cb.checked;
  if (cb.checked) {
    box.style.background = '#1a5252'; box.style.borderColor = '#1a5252';
    chk.classList.remove('hidden');
  } else {
    box.style.background = 'transparent'; box.style.borderColor = '';
    chk.classList.add('hidden');
  }
}

function closeSchedulePicker() {
  document.getElementById('schedule-picker').classList.add('hidden');
  document.getElementById('schedule-picker').style.display = '';
  schedulePickerTarget = null;
}

function setScheduleStatus(status) {
  if (!schedulePickerTarget) return;
  const { date, staffId } = schedulePickerTarget;
  const repeat = document.getElementById('repeat-toggle-cb')?.checked || false;
  const d = new Date(date + 'T12:00:00');
  const dayOfWeek = d.getDay(); // 0=Sun..6=Sat

  if (repeat && status !== null) {
    // Store a weekly repeat rule per staff per day-of-week
    // repeatRules: { staffId: { dayOfWeek: status } }
    if (!scheduleData._repeats) scheduleData._repeats = {};
    if (!scheduleData._repeats[staffId]) scheduleData._repeats[staffId] = {};
    scheduleData._repeats[staffId][dayOfWeek] = status;
  } else if (repeat && status === null) {
    // Clear repeat rule
    if (scheduleData._repeats?.[staffId]?.[dayOfWeek]) {
      delete scheduleData._repeats[staffId][dayOfWeek];
    }
  }

  // Also set the specific date
  if (!scheduleData[date]) scheduleData[date] = {};
  if (status === null) {
    delete scheduleData[date][staffId];
    if (Object.keys(scheduleData[date]).length === 0) delete scheduleData[date];
  } else {
    scheduleData[date][staffId] = status;
  }

  saveScheduleData();
  closeSchedulePicker();
  renderSchedule();
}

function getScheduleStatus(date, staffId) {
  // Check specific date first, then fall back to repeat rule
  if (scheduleData[date]?.[staffId]) return scheduleData[date][staffId];
  const d = new Date(date + 'T12:00:00');
  const dayOfWeek = d.getDay();
  return scheduleData._repeats?.[staffId]?.[dayOfWeek] || null;
}



