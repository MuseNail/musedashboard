// ── Queue: live queue render, status flow, modals (assign/pricing, split/merge) ─
// Reads the queue from the store; persists every change via dispatch('queue.upsert'
// | 'queue.remove'). Modal editing mutates the in-store entry as a local buffer and
// commits with a dispatch on save (matching the original "edit then save" UX).

import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, formatElapsed } from '../utils.js';
import { GROUP_COLORS } from '../config.js';
import { ui } from '../session.js';
import { getAssignmentStatus, deriveEntryStatus, setAssignmentStatus } from './status.js';
import { isServiceVisibleOnDash } from './catalog.js';
import { squareUpsertCustomer, showEditCustomer, customerDirectory } from './square-customers.js';
import { pushOrderToSquare } from './square-pos.js';

const cfg   = () => getState().config;
const q     = () => getState().queue;
const svc   = id => cfg().services.find(s => s.id === id);
const staffById = id => cfg().staff.find(s => s.id === id);
const activeStaff = () => cfg().staff.filter(s => !cfg().inactive_staff.includes(s.id));
const STATIONS = [...Array.from({length:12}, (_,i)=>`P${i+1}`), ...Array.from({length:15}, (_,i)=>`M${i+1}`)];

const upsert = entry => dispatch('queue.upsert', { entry });

// ── Render ────────────────────────────────────────
export function renderQueue() {
  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  if (!list) return;
  let filtered = ui.currentFilter === 'all' ? [...q()] : q().filter(e => e.status === ui.currentFilter);
  if (ui.currentFilter === 'all' && !ui.showDoneInQueue) filtered = filtered.filter(e => e.status !== 'done');
  const order = { waiting: 0, inservice: 1, done: 2 };
  filtered.sort((a,b) => order[a.status] - order[b.status] || new Date(a.checkinTime) - new Date(b.checkinTime));

  if (filtered.length === 0) { list.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  if (ui.currentFilter === 'all') {
    const groups = [
      { key: 'waiting',   label: 'Waiting',    color: 'text-secondary' },
      { key: 'inservice', label: 'In Service', color: 'text-primary' },
      { key: 'done',      label: 'Done Today',  color: 'text-outline' },
    ];
    list.innerHTML = groups.map(g => {
      const entries = filtered.filter(e => e.status === g.key);
      if (entries.length === 0) return '';
      return `<div class="mb-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[11px] font-headline font-bold uppercase tracking-widest ${g.color}">${g.label}</span>
          <span class="text-[11px] font-body ${g.color} opacity-60">(${entries.length})</span>
          <div class="flex-grow h-px bg-surface-container-high ml-1"></div>
        </div>
        <div class="space-y-2">${entries.map(buildQueueRow).join('')}</div>
      </div>`;
    }).join('');
  } else {
    list.innerHTML = `<div class="space-y-2">${filtered.map(buildQueueRow).join('')}</div>`;
  }
}

function buildQueueRow(e) {
  const t = new Date(e.checkinTime);
  const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const serviceLabels = e.services.map(sid => svc(sid)?.label || sid).join(', ') || '—';
  const badgeClass = { waiting: 'badge-waiting', inservice: 'badge-inservice', done: 'badge-done' }[e.status];
  const badgeLabel = { waiting: 'Waiting', inservice: 'In Service', done: 'Done' }[e.status];
  const apptBadge = e.isAppointment ? `<span class="badge-appointment text-[10px] px-1.5 py-0.5 rounded-full font-body font-semibold">Appt</span>` : '';
  const assignSummary = (e.assignments || []).filter(a => a.techId || a.cost).map(a => {
    const tech = staffById(a.techId), s = svc(a.serviceId);
    const st = getAssignmentStatus(e, a);
    const dot = st === 'done' ? '✓ ' : st === 'inservice' ? '● ' : '○ ';
    const parts = [dot + (s ? s.label : '')];
    if (tech) parts.push('→ ' + tech.name);
    if (a.station) parts.push('@ ' + a.station);
    if (a.cost) parts.push('$' + Number(a.cost).toFixed(2));
    return parts.join(' ');
  }).join(' · ');
  const totalDisplay = e.totalCost ? `<span class="font-semibold text-primary ml-1">$${e.totalCost.toFixed(2)}</span>` : '';
  const cardBg = e.status === 'done'
    ? 'bg-surface-container-high border-surface-container-highest opacity-70'
    : `bg-surface-container-lowest ${e.isAppointment ? 'border-primary/40' : 'border-surface-container-high'}`;
  const groupBorder = e.groupId && e.status !== 'done' ? `border-left:4px solid ${e.groupColor};` : '';
  const groupDot = e.groupId ? `<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 mr-0.5" style="background:${e.groupColor}"></span>` : '';
  const groupTag = e.groupLabel ? `<span class="text-[10px] font-body italic" style="color:${e.groupColor}">${e.groupLabel}</span>` : '';
  const btnCls = `flex items-center justify-center min-w-[44px] self-stretch rounded-xl transition-all active:scale-95 border-0 cursor-pointer px-3`;
  const id = e.id;
  const hasSquare = !!cfg().square_config;
  return `
    <div class="queue-row ${cardBg} rounded-xl py-1.5 px-3 border flex items-stretch gap-1.5" data-id="${id}" style="${groupBorder}">
      <div class="flex-grow min-w-0 py-1">
        <div class="flex items-center gap-1 flex-wrap leading-tight">
          ${groupDot}<span class="font-headline font-semibold text-on-surface text-sm">${e.name}</span>${groupTag ? ' ' + groupTag : ''}
          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-body font-semibold ${badgeClass}">${badgeLabel}</span>
          ${apptBadge}${totalDisplay}
          <span class="text-[10px] font-body text-outline ml-auto" data-checkin-ts="${t.getTime()}">${formatElapsed(e.checkinTime)}</span>
        </div>
        <div class="text-[11px] font-body text-on-surface-variant truncate">${serviceLabels}</div>
        ${assignSummary ? `<div class="text-[11px] font-body text-primary truncate">${assignSummary}</div>` : ''}
        <div class="text-[10px] font-body text-outline">${timeStr}${e.phone ? ' · ' + e.phone : ''}</div>
      </div>
      <div class="flex items-stretch gap-1 flex-shrink-0">
        <button onclick="showGroupAssignModal('${id}')" title="Assign & Price" class="${btnCls} bg-surface-container hover:bg-surface-container-high text-on-surface-variant"><span class="material-symbols-outlined" style="font-size:19px">assignment_ind</span></button>
        <button onclick="showEditCheckin('${id}')" title="Edit check-in info" class="${btnCls} bg-surface-container hover:bg-surface-container-high text-on-surface-variant"><span class="material-symbols-outlined" style="font-size:19px">edit_note</span></button>
        ${e.groupId
          ? `<button onclick="showSplitMergeModal('${id}')" title="Split/Merge" class="${btnCls} bg-surface-container hover:bg-surface-container-high text-on-surface-variant"><span class="material-symbols-outlined" style="font-size:19px">call_split</span></button>`
          : `<button onclick="showMergeSelectModal('${id}')" title="Merge" class="${btnCls} bg-surface-container hover:bg-surface-container-high text-on-surface-variant"><span class="material-symbols-outlined" style="font-size:19px">merge</span></button>`}
        ${e.status === 'waiting' ? `<button onclick="tryAdvanceStatus('${id}','inservice')" title="In Service" class="${btnCls}" style="background:#8fd4d3;color:#0a2e2e;"><span class="material-symbols-outlined" style="font-size:19px">play_circle</span></button>` : ''}
        ${e.status === 'inservice' ? `
          <button onclick="updateStatus('${id}','waiting')" title="Back to Waiting" class="${btnCls}" style="background:#f5c870;color:#3a2800;"><span class="material-symbols-outlined" style="font-size:19px">arrow_back</span></button>
          <button onclick="tryAdvanceStatus('${id}','done')" title="Done" class="${btnCls}" style="background:#c2cacd;color:#333;"><span class="material-symbols-outlined" style="font-size:19px">check_circle</span></button>` : ''}
        ${e.status === 'done' && hasSquare && e.totalCost > 0 ? `<button onclick="openSquarePOS('${id}')" title="Pay in Square POS" class="${btnCls}" style="background:#1b5e3b;color:#fff;"><span class="material-symbols-outlined" style="font-size:19px">point_of_sale</span></button>` : ''}
        ${e.status === 'done' ? `<button onclick="confirmReopen('${id}')" title="Reopen" class="${btnCls} bg-surface-container hover:bg-secondary-container text-outline-variant"><span class="material-symbols-outlined" style="font-size:19px">undo</span></button>` : ''}
        <button onclick="removeFromQueue('${id}')" title="Remove" class="${btnCls} bg-surface-container hover:bg-error/20 text-outline hover:text-error"><span class="material-symbols-outlined" style="font-size:17px">close</span></button>
      </div>
    </div>`;
}

export function updateStatus(id, status) {
  const entry = q().find(e => String(e.id) === String(id));
  if (!entry) return;
  if (entry.assignments && entry.assignments.length > 0) {
    if (status === 'inservice') entry.assignments.forEach(a => { if (a.techId && getAssignmentStatus(entry, a) === 'waiting') a.status = 'inservice'; });
    else if (status === 'waiting') entry.assignments.forEach(a => { if (getAssignmentStatus(entry, a) === 'inservice') a.status = 'waiting'; });
    else if (status === 'done') entry.assignments.forEach(a => { if (a.techId) a.status = 'done'; });
    entry.status = deriveEntryStatus(entry);
  } else entry.status = status;
  if (entry.status === 'done') window.saveRecord?.(entry);
  upsert(entry);
  renderQueue(); updateStats(); window.renderTurns?.();
}

export function removeFromQueue(id) { window.initiateDeleteTransaction?.(id); }

export function filterQueue(filter) {
  ui.currentFilter = filter;
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('bg-primary','text-on-primary'); b.classList.add('bg-surface-container','text-on-surface-variant'); });
  const active = document.getElementById(`tab-${filter}`);
  if (active) { active.classList.add('bg-primary','text-on-primary'); active.classList.remove('bg-surface-container','text-on-surface-variant'); }
  renderQueue();
}

export function updateStats() {
  const w = document.getElementById('stat-waiting'), s = document.getElementById('stat-inservice'), d = document.getElementById('stat-done');
  if (w) w.textContent = q().filter(e => e.status === 'waiting').length;
  if (s) s.textContent = q().filter(e => e.status === 'inservice').length;
  if (d) d.textContent = q().filter(e => e.status === 'done').length;
}

export function validateAssignments(entry) {
  if (!entry.assignments || entry.assignments.length === 0) return false;
  return entry.assignments.every(a => a.techId && a.cost > 0);
}

export function tryAdvanceStatus(id, targetStatus) {
  const entry = q().find(e => String(e.id) === String(id));
  if (!entry) return;
  if (targetStatus === 'done' && !validateAssignments(entry)) {
    showToast('Please assign a technician and cost before marking as Done.');
    showGroupAssignModal(id);
    return;
  }
  updateStatus(id, targetStatus);
}

// ── Manual Add modal ──────────────────────────────
let manualGuestCount = 0;
let groupColorIndex = 0;

function serviceButtonsHtml() {
  return cfg().services.map(s => `
    <button type="button" onclick="this.classList.toggle('selected')" data-service="${s.id}"
      class="service-btn flex flex-col items-center justify-center py-2 rounded-lg bg-surface-container text-on-surface-variant border border-outline-variant/30 hover:bg-primary/10 hover:text-primary transition-all text-xs">
      <span class="font-headline font-bold">${s.abbr}</span>
      <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter text-center leading-tight">${s.label}</span>
    </button>`).join('');
}

function renderManualGuestCard(idx) {
  const isPrimary = idx === 1;
  const container = document.getElementById('manual-guests-container');
  const card = document.createElement('div');
  card.id = `manual-guest-${idx}`;
  card.className = 'bg-surface-container-low rounded-xl p-4 border border-surface-container-high space-y-3';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-xs font-headline font-bold tracking-widest text-primary uppercase">${isPrimary ? 'Primary Guest' : 'Guest ' + idx}</span>
      ${!isPrimary ? `<button onclick="removeManualGuest(${idx})" class="text-xs font-body text-outline hover:text-error transition-colors flex items-center gap-1"><span class="material-symbols-outlined" style="font-size:14px">remove_circle</span> Remove</button>` : ''}
    </div>
    ${!isPrimary ? `
    <label class="flex items-center gap-2 cursor-pointer" onclick="toggleManualSameContact(${idx})">
      <div id="manual-same-box-${idx}" class="w-6 h-6 rounded border-2 border-outline-variant flex items-center justify-center flex-shrink-0 transition-all" style="background:transparent">
        <span class="material-symbols-outlined hidden" id="manual-check-icon-${idx}" style="font-size:14px;color:#fff;font-variation-settings:'FILL' 1,'wght' 700">check</span>
      </div>
      <input type="checkbox" id="manual-same-${idx}" class="hidden">
      <span class="text-sm font-body text-on-surface-variant">Same contact info as primary guest</span>
    </label>` : ''}
    <div id="manual-contact-fields-${idx}" class="space-y-3">
      <div class="ac-input-wrap">
        <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">Phone Number</label>
        <input id="manual-phone-${idx}" type="tel" placeholder="(555) 000-0000" autocomplete="off" oninput="acSearchManual(this, ${idx}, 'phone')"
          class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline font-light focus:border-primary transition-colors placeholder:text-surface-container-highest">
        <div id="mac-phone-${idx}" class="autocomplete-list hidden"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="ac-input-wrap">
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">First Name</label>
          <input id="manual-first-${idx}" type="text" placeholder="First" autocomplete="off" oninput="acSearchManual(this, ${idx}, 'first'); autoCapitalize(this)"
            class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
          <div id="mac-first-${idx}" class="autocomplete-list hidden"></div>
        </div>
        <div>
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">Last Name</label>
          <input id="manual-last-${idx}" type="text" placeholder="Last" oninput="autoCapitalize(this)"
            class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
        </div>
      </div>
    </div>
    ${!isPrimary ? `
    <div id="manual-firstonly-fields-${idx}" class="hidden">
      <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">First Name</label>
      <input id="manual-firstonly-${idx}" type="text" placeholder="First" oninput="autoCapitalize(this)"
        class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
    </div>` : ''}
    <div>
      <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-2">Services</label>
      <div class="grid grid-cols-4 gap-2" id="manual-services-${idx}">${serviceButtonsHtml()}</div>
    </div>`;
  container.appendChild(card);
}

export function toggleManualSameContact(idx) {
  const cb = document.getElementById(`manual-same-${idx}`);
  const box = document.getElementById(`manual-same-box-${idx}`);
  const checkIcon = document.getElementById(`manual-check-icon-${idx}`);
  const contactFields = document.getElementById(`manual-contact-fields-${idx}`);
  const firstOnlyFields = document.getElementById(`manual-firstonly-fields-${idx}`);
  cb.checked = !cb.checked;
  if (cb.checked) {
    if (box) { box.style.background = '#1a5252'; box.style.borderColor = '#1a5252'; }
    checkIcon?.classList.remove('hidden');
    contactFields?.classList.add('hidden'); firstOnlyFields?.classList.remove('hidden');
  } else {
    if (box) { box.style.background = 'transparent'; box.style.borderColor = '#7a858a'; }
    checkIcon?.classList.add('hidden');
    contactFields?.classList.remove('hidden'); firstOnlyFields?.classList.add('hidden');
  }
}

export function showManualAdd() {
  manualGuestCount = 0;
  document.getElementById('manual-guests-container').innerHTML = '';
  addManualGuest();
  const appt = document.getElementById('manual-is-appointment'); if (appt) appt.checked = false;
  const m = document.getElementById('manual-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => document.getElementById('manual-phone-1')?.focus(), 100);
}
export function addManualGuest() { manualGuestCount++; renderManualGuestCard(manualGuestCount); }
export function removeManualGuest(idx) { document.getElementById(`manual-guest-${idx}`)?.remove(); }
export function closeManualAdd() {
  const m = document.getElementById('manual-modal'); m.classList.add('hidden'); m.style.display = '';
  manualGuestCount = 0;
  const c = document.getElementById('manual-guests-container'); if (c) c.innerHTML = '';
}

export function submitManualAdd() {
  const newEntries = [];
  const isAppointment = document.getElementById('manual-is-appointment')?.checked || false;
  for (let i = 1; i <= manualGuestCount; i++) {
    const card = document.getElementById(`manual-guest-${i}`);
    if (!card) continue;
    const sameContact = i > 1 && document.getElementById(`manual-same-${i}`)?.checked;
    let phone, first, last;
    if (sameContact) { first = document.getElementById(`manual-firstonly-${i}`)?.value.trim() || ''; phone = document.getElementById('manual-phone-1')?.value.trim() || ''; last = ''; }
    else { phone = document.getElementById(`manual-phone-${i}`)?.value.trim() || ''; first = document.getElementById(`manual-first-${i}`)?.value.trim() || ''; last = document.getElementById(`manual-last-${i}`)?.value.trim() || ''; }
    if (!first) { showToast('Please enter a first name for each guest.'); return; }
    const services = Array.from(card.querySelectorAll('.service-btn.selected')).map(b => b.dataset.service);
    newEntries.push({ id: Date.now() * 1000 + Math.floor(Math.random() * 1000), name: first + (last ? ' ' + last : ''), phone, services, status: 'waiting', checkinTime: new Date().toISOString(), isNew: false, skipSquare: sameContact, isAppointment });
  }
  if (newEntries.length === 0) return;
  if (newEntries.length > 1) {
    const groupId = `grp-${Date.now()}`, groupColor = GROUP_COLORS[groupColorIndex++ % GROUP_COLORS.length], primaryName = newEntries[0].name;
    newEntries.forEach((e, i) => { e.groupId = groupId; e.groupColor = groupColor; e.groupLabel = i === 0 ? `${e.name} (primary)` : `${primaryName} — ${e.name}`; });
  }
  newEntries.forEach(e => upsert(e));
  newEntries.forEach(e => { if (!e.skipSquare) squareUpsertCustomer(e); });
  renderQueue(); updateStats(); window.renderTurns?.();
  closeManualAdd();
  showToast(`${newEntries.map(e => e.name).join(' & ')} added to queue`);
}

// ── Edit Check-In ─────────────────────────────────
let _editCheckinId = null;
export function showEditCheckin(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  _editCheckinId = entryId;
  const parts = (entry.name || '').trim().split(' ');
  const firstName = parts[0] || '', lastName = parts.slice(1).join(' ') || '';
  document.getElementById('edit-checkin-content').innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">First Name</label>
        <input id="eci-first" type="text" value="${firstName}" oninput="autoCapitalize(this)" class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none"></div>
      <div><label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Last Name</label>
        <input id="eci-last" type="text" value="${lastName}" oninput="autoCapitalize(this)" class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none"></div>
    </div>
    <div><label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Phone</label>
      <input id="eci-phone" type="tel" value="${entry.phone || ''}" class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none"></div>
    <div><label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Services</label>
      <div class="grid grid-cols-3 gap-2">
        ${cfg().services.map(s => `
          <label class="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-surface-container border ${entry.services.includes(s.id) ? 'border-primary bg-primary/10' : 'border-transparent'}">
            <input type="checkbox" class="eci-svc accent-primary" value="${s.id}" ${entry.services.includes(s.id) ? 'checked' : ''}>
            <span class="text-xs font-body">${s.label}</span>
          </label>`).join('')}
      </div></div>`;
  const m = document.getElementById('edit-checkin-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeEditCheckin() {
  const m = document.getElementById('edit-checkin-modal'); m.classList.add('hidden'); m.style.display = '';
  _editCheckinId = null;
}
export function saveEditCheckin() {
  const entry = q().find(e => String(e.id) === String(_editCheckinId));
  if (!entry) return;
  const first = document.getElementById('eci-first')?.value.trim();
  const last  = document.getElementById('eci-last')?.value.trim();
  const phone = document.getElementById('eci-phone')?.value.trim();
  const svcs  = [...document.querySelectorAll('.eci-svc:checked')].map(cb => cb.value);
  if (!first) { showToast('First name is required.'); return; }
  if (svcs.length === 0) { showToast('Select at least one service.'); return; }
  entry.name = last ? `${first} ${last}` : first;
  entry.phone = phone;
  entry.services = svcs;
  if (entry.assignments) entry.assignments = entry.assignments.filter(a => svcs.includes(a.serviceId));
  entry.status = deriveEntryStatus(entry);
  upsert(entry);
  closeEditCheckin();
  renderQueue(); window.renderTurns?.();
  showToast('Check-in updated ✓');
}

// ── Group Assign / Price modal ────────────────────
let groupAssignEntries = [];
let activeGroupTab = 0;
export function activeGroupEntryId() { return groupAssignEntries[activeGroupTab]; }

export function showGroupAssignModal(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  groupAssignEntries = entry.groupId ? q().filter(e => e.groupId === entry.groupId).map(e => String(e.id)) : [String(entry.id)];
  const clicked = groupAssignEntries.indexOf(String(entryId));
  activeGroupTab = clicked >= 0 ? clicked : 0;
  renderGroupAssignTabs();
  renderGroupAssignContent();
  const m = document.getElementById('group-assign-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}

function renderGroupAssignTabs() {
  const tabs = document.getElementById('group-assign-tabs');
  tabs.innerHTML = groupAssignEntries.map((id, i) => {
    const entry = q().find(e => String(e.id) === id);
    if (!entry) return '';
    const isActive = i === activeGroupTab, color = entry.groupColor || '#1a5252';
    return `<div class="flex items-center gap-1">
        <button onclick="switchGroupTab(${i})" class="px-4 py-2 rounded-full text-sm font-body font-semibold transition-all flex items-center gap-2 ${isActive ? 'text-white' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}" style="${isActive ? `background:${color}` : ''}">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>${entry.name.split(' ')[0]}
        </button>
        ${isActive ? `<button onclick="openCustomerFromAssign('${id}')" title="Edit customer" class="w-7 h-7 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors"><span class="material-symbols-outlined" style="font-size:16px">person_edit</span></button>` : ''}
      </div>`;
  }).join('');
}

export function openCustomerFromAssign(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  const match = entry.phone ? customerDirectory.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(entry.phone.replace(/\D/g,''))) : null;
  if (match) showEditCustomer(match.squareId);
  else { closeGroupAssignModal(); showEditCheckin(entryId); }
}

export function switchGroupTab(i) {
  saveCurrentGroupTabInputs();
  activeGroupTab = i;
  renderGroupAssignTabs();
  renderGroupAssignContent();
}

export function cycleServiceStatus(entryId, serviceId, newStatus) {
  if (document.getElementById('group-assign-modal')?.style.display === 'flex') saveCurrentGroupTabInputs();
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  const a = (entry.assignments || []).find(x => x.serviceId === serviceId);
  if (newStatus === 'inservice' && (!a || !a.techId)) { showToast('Assign a technician before marking In Service.'); return; }
  if (newStatus === 'done') {
    if (!a || !a.techId) { showToast('Assign a technician before marking Done.'); return; }
    if (!a.cost || a.cost <= 0) { showToast('Enter a price before marking Done.'); return; }
  }
  setAssignmentStatus(entry, serviceId, newStatus);
  renderGroupAssignContent();
}

// Mutates the in-store entry as an editing buffer (committed by the save handlers).
export function saveCurrentGroupTabInputs() {
  const entry = q().find(e => String(e.id) === groupAssignEntries[activeGroupTab]);
  if (!entry) return;
  const rows = document.querySelectorAll('#group-assign-content [data-service-id]');
  if (!entry.assignments) entry.assignments = [];
  rows.forEach(row => {
    const sid = row.dataset.serviceId;
    let a = entry.assignments.find(x => x.serviceId === sid);
    if (!a) { a = { serviceId: sid, status: 'waiting' }; entry.assignments.push(a); }
    const prevTech = a.techId;
    a.techId  = row.querySelector('.assign-tech')?.value || '';
    a.station = row.querySelector('.assign-station')?.value || '';
    a.cost    = parseFloat(row.querySelector('.assign-cost')?.value) || 0;
    if (a.techId && !prevTech) a.assignedAt = Date.now();
  });
  entry.services = entry.assignments.map(a => a.serviceId);
  entry.items = [];
  document.querySelectorAll('#group-assign-content [data-item-id]').forEach(row => {
    const qty = parseInt(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    if (price > 0 && qty > 0) entry.items.push({ itemId: row.dataset.itemId, qty, price });
  });
  const svcSubtotal = entry.assignments.reduce((s, a) => s + (a.cost||0), 0);
  entry.fees = [];
  document.querySelectorAll('#group-assign-content [data-fee-id]').forEach(row => {
    const feeType = row.dataset.feeType, feeVal = parseFloat(row.dataset.feeValue) || 0;
    const rawInput = row.querySelector('.fee-amount')?.value;
    if (!rawInput || rawInput.trim() === '') return;
    const amount = feeType === 'percent' ? Math.round(svcSubtotal * feeVal / 100 * 100) / 100 : parseFloat(rawInput) || 0;
    if (amount > 0) entry.fees.push({ feeId: row.dataset.feeId, amount, type: feeType });
  });
  const itemTotal = entry.items.reduce((s,i)=>s+(i.price*(i.qty||0)),0);
  const feeTotal  = entry.fees.reduce((s,f)=>s+(f.amount||0),0);
  const discountType = document.querySelector('#group-assign-content .discount-type-select')?.value || 'flat';
  const discountInput = parseFloat(document.querySelector('#group-assign-content .discount-input')?.value) || 0;
  const discountNote = document.querySelector('#group-assign-content .discount-note-input')?.value?.trim() || '';
  const discountAmt = discountType === 'percent' ? Math.round(svcSubtotal * discountInput / 100 * 100) / 100 : discountInput;
  entry.discount = discountAmt;
  entry.discountNote = discountNote;
  entry.totalCost = Math.max(0, svcSubtotal + itemTotal + feeTotal - discountAmt);
  entry.status = deriveEntryStatus(entry);
  setTimeout(updateGroupTotal, 0);
}

export function renderGroupAssignContent() {
  const entry = q().find(e => String(e.id) === groupAssignEntries[activeGroupTab]);
  if (!entry) return;
  const color = entry.groupColor || '#1a5252';
  const content = document.getElementById('group-assign-content');
  const checkedIn = activeStaff().filter(s => cfg().turns_order.includes(s.id));
  const techOptions = sel => checkedIn.length > 0
    ? checkedIn.map(st => `<option value="${st.id}" ${sel === st.id ? 'selected' : ''}>${st.name}</option>`).join('')
    : `<option value="" disabled>No techs checked in — add in Turns tab</option>`;
  const stationOptions = sel => STATIONS.map(st => `<option value="${st}" ${sel === st ? 'selected' : ''}>${st}</option>`).join('');

  const serviceRows = entry.services.map(sid => {
    const s = svc(sid) || { id: sid, label: sid };
    const a = (entry.assignments || []).find(x => x.serviceId === sid) || {};
    const st = getAssignmentStatus(entry, a);
    const statusBtnStyle = { waiting:'background:#ffe0b2;color:#6d3200', inservice:'background:#c8e6c5;color:#1b5e20', done:'background:#dde2e5;color:#555' }[st] || 'background:#ffe0b2;color:#6d3200';
    const statusLabel = { waiting:'Waiting', inservice:'In Service', done:'Done' }[st] || 'Waiting';
    const nextStatus = { waiting:'inservice', inservice:'done', done:'waiting' }[st];
    return `
      <div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-service-id="${sid}">
        <div class="flex items-center justify-between mb-3">
          <div class="font-headline font-semibold text-on-surface">${s.label}</div>
          <button onclick="cycleServiceStatus('${entry.id}','${sid}','${nextStatus}')" class="text-[11px] px-3 py-1 rounded-full font-body font-semibold transition-all hover:opacity-80" style="${statusBtnStyle}">${statusLabel} ›</button>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Technician</label>
            <select class="assign-tech w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary" onchange="updateGroupTotal()"><option value="">— Unassigned —</option>${techOptions(a.techId)}</select></div>
          <div><label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Station</label>
            <select class="assign-station w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary"><option value="">— None —</option>${stationOptions(a.station)}</select></div>
          <div><label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Cost ($)</label>
            <input type="text" inputmode="decimal" placeholder="${s.baseCost != null ? Number(s.baseCost).toFixed(2) : '0.00'}" value="${a.cost != null && a.cost !== 0 ? a.cost : ''}"
              class="assign-cost w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary cursor-pointer"
              onfocus="openNumpad(this,'Cost — ' + '${s.label}')" onclick="openNumpad(this,'Cost — ' + '${s.label}')" oninput="updateGroupTotal()"></div>
        </div>
      </div>`;
  }).join('');

  const svcPicker = cfg().services.filter(s => isServiceVisibleOnDash(s.id)).map(s => {
    const selected = entry.services.includes(s.id);
    return `<button type="button" onclick="toggleGroupService('${s.id}')" class="service-btn flex flex-col items-center justify-center py-2 rounded-lg border transition-all text-xs ${selected ? 'text-white border-transparent selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30'}" style="${selected ? `background:${color};border-color:${color}` : ''}">
      <span class="font-headline font-bold">${s.abbr}</span><span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span></button>`;
  }).join('');

  const itemRows = cfg().items.map(item => {
    const existing = (entry.items || []).find(i => i.itemId === item.id) || {};
    return `<div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-item-id="${item.id}">
        <div class="flex items-center justify-between">
          <div class="font-headline font-semibold text-on-surface text-sm">${item.label}<span class="ml-2 text-[10px] font-body text-outline-variant uppercase tracking-widest">Retail Item</span></div>
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">Qty</label>
            <input type="text" inputmode="numeric" value="${existing.qty || ''}" placeholder="0" class="item-qty w-12 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body text-center focus:outline-none focus:border-primary" oninput="updateGroupTotal()">
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">$</label>
            <input type="text" inputmode="decimal" value="${existing.price != null && existing.price !== 0 ? existing.price : ''}" placeholder="${item.price || '0.00'}" class="item-price w-16 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:outline-none focus:border-primary text-right cursor-pointer" onfocus="openNumpad(this,'${item.label}')" onclick="openNumpad(this,'${item.label}')" oninput="updateGroupTotal()">
          </div></div></div>`;
  }).join('');

  const feeRows = cfg().fees.map(fee => {
    const existing = (entry.fees || []).find(f => f.feeId === fee.id) || {};
    const feeLabel = fee.type === 'percent' ? `${fee.value}%` : `$${fee.value.toFixed(2)}`;
    return `<div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-fee-id="${fee.id}" data-fee-type="${fee.type}" data-fee-value="${fee.value}">
        <div class="flex items-center justify-between">
          <div><div class="font-headline font-semibold text-on-surface text-sm">${fee.label}<span class="ml-2 text-[10px] font-body text-outline-variant uppercase tracking-widest">${fee.type === 'percent' ? 'Percent Fee' : 'Flat Fee'}</span></div>
            ${fee.type === 'percent' ? `<div class="text-xs text-on-surface-variant mt-0.5">${feeLabel} of service subtotal</div>` : ''}</div>
          <div class="flex items-center gap-2"><label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">$</label>
            <input type="text" inputmode="decimal" value="${existing.amount != null && existing.amount !== 0 ? existing.amount : ''}" placeholder="${fee.type==='flat'?fee.value.toFixed(2):'auto'}" class="fee-amount w-20 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:outline-none focus:border-primary text-right cursor-pointer" ${fee.type==='percent' ? 'readonly' : ''} onfocus="if(!this.readOnly) openNumpad(this,'${fee.label}')" onclick="if(!this.readOnly) openNumpad(this,'${fee.label}')" oninput="updateGroupTotal()">
          </div></div></div>`;
  }).join('');

  const hasSupplement = cfg().items.length > 0 || cfg().fees.length > 0;
  content.innerHTML = `
    <div class="flex items-center gap-2 mb-3"><span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${color}"></span>
      <span class="font-headline font-bold text-on-surface">${entry.name}</span>
      ${entry.phone ? `<span class="text-xs font-body text-on-surface-variant">· ${entry.phone}</span>` : ''}
      ${entry.groupLabel ? `<span class="text-[10px] font-body italic" style="color:${color}">${entry.groupLabel}</span>` : ''}</div>
    <div class="mb-1"><label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-2">Services</label>
      <div class="grid grid-cols-4 gap-2 mb-4">${svcPicker}</div></div>
    ${serviceRows}
    ${hasSupplement ? `<div class="border-t border-surface-container-high mt-2 pt-3 mb-2"><div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-3">Items &amp; Fees</div>${itemRows}${feeRows}</div>` : ''}
    <div class="border-t border-surface-container-high pt-3 mb-2"><div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-2">Discount</div>
      <div class="bg-surface-container-low rounded-xl p-3 border border-surface-container-high">
        <div class="flex items-center gap-2 mb-2">
          <select class="discount-type-select bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-xs font-body focus:outline-none focus:border-primary" onchange="updateGroupTotal()"><option value="flat">$ Off</option><option value="percent">% Off</option></select>
          <input type="text" inputmode="decimal" class="discount-input flex-1 bg-surface-container border border-surface-container-high rounded-lg px-3 py-1.5 text-sm font-body text-right focus:outline-none focus:border-primary cursor-pointer" value="${entry.discount && entry.discount > 0 ? entry.discount : ''}" placeholder="0" onfocus="openNumpad(this,'Discount')" onclick="openNumpad(this,'Discount')" oninput="updateGroupTotal()">
        </div>
        <input type="text" maxlength="60" class="discount-note-input w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-1.5 text-xs font-body focus:outline-none focus:border-primary" value="${entry.discountNote || ''}" placeholder="Reason (optional)">
      </div></div>
    <div class="border-t border-surface-container-high pt-3 flex items-center justify-between">
      <span class="font-body font-semibold text-on-surface text-sm">Subtotal</span>
      <span id="group-subtotal" class="font-headline font-bold text-primary">$0.00</span></div>`;
  updateGroupTotal();
}

export function toggleGroupService(sid) {
  const entry = q().find(e => String(e.id) === groupAssignEntries[activeGroupTab]);
  if (!entry) return;
  if (entry.services.includes(sid)) {
    if (entry.services.length === 1) { showToast('At least one service required.'); return; }
    entry.services = entry.services.filter(id => id !== sid);
    if (entry.assignments) entry.assignments = entry.assignments.filter(a => a.serviceId !== sid);
  } else entry.services.push(sid);
  renderGroupAssignContent();
}

export function updateGroupTotal() {
  const svcCosts = [...document.querySelectorAll('#group-assign-content .assign-cost')].map(i => parseFloat(i.value) || 0);
  const svcSubtotal = svcCosts.reduce((a,b)=>a+b,0);
  const itemTotal = [...document.querySelectorAll('#group-assign-content [data-item-id]')].reduce((sum,row)=>{
    const qty = parseInt(row.querySelector('.item-qty')?.value)||0, price = parseFloat(row.querySelector('.item-price')?.value)||0;
    return sum + price*qty;
  },0);
  let feeTotal = 0;
  document.querySelectorAll('#group-assign-content [data-fee-id]').forEach(row=>{
    const feeType = row.dataset.feeType, feeVal = parseFloat(row.dataset.feeValue)||0, inp = row.querySelector('.fee-amount');
    if (feeType === 'percent') { const computed = Math.round(svcSubtotal*feeVal)/100; if (inp) inp.value = computed>0?computed.toFixed(2):''; feeTotal += computed; }
    else feeTotal += parseFloat(inp?.value)||0;
  });
  const discountType = document.querySelector('#group-assign-content .discount-type-select')?.value || 'flat';
  const discountInput = parseFloat(document.querySelector('#group-assign-content .discount-input')?.value) || 0;
  const discountAmt = discountType === 'percent' ? Math.round(svcSubtotal * discountInput / 100 * 100) / 100 : discountInput;
  const subtotal = Math.max(0, svcSubtotal + itemTotal + feeTotal - discountAmt);
  const el = document.getElementById('group-subtotal'); if (el) el.textContent = `$${subtotal.toFixed(2)}`;
  let partyTotal = subtotal;
  groupAssignEntries.forEach((id,i) => { if (i === activeGroupTab) return; const e = q().find(x => String(x.id) === id); if (e) partyTotal += (e.totalCost||0); });
  const pel = document.getElementById('group-party-total'); if (pel) pel.textContent = `$${partyTotal.toFixed(2)}`;
}

export function closeGroupAssignModal() {
  const m = document.getElementById('group-assign-modal'); m.classList.add('hidden'); m.style.display = '';
  groupAssignEntries = [];
}

function collectGroupAssignments() { saveCurrentGroupTabInputs(); return groupAssignEntries.map(id => q().find(e => String(e.id) === id)).filter(Boolean); }
function validateGroupAssignments(entries) { return entries.filter(e => !e.assignments || e.assignments.length === 0 || e.assignments.some(a => !a.techId || a.cost <= 0)); }

export function saveGroupAssignments() {
  const entries = collectGroupAssignments();
  entries.forEach(e => { e.status = deriveEntryStatus(e); upsert(e); });
  closeGroupAssignModal();
  renderQueue(); updateStats(); window.renderTurns?.();
  showToast('Assignments saved');
}

export async function saveGroupAndPushSquare() {
  saveCurrentGroupTabInputs();
  const entries = collectGroupAssignments();
  if (!entries.some(e => (e.assignments||[]).some(a => a.cost > 0))) { showToast('Add at least one price before pushing to Square.'); return; }
  showToast('Creating Square ticket…');
  for (const e of entries) { upsert(e); await pushOrderToSquare(e); }
  closeGroupAssignModal();
  renderQueue(); window.renderTurns?.();
}

// ── Edit Services modal ───────────────────────────
let editServicesEntryId = null;
export function showEditServicesModal(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  editServicesEntryId = entryId;
  document.getElementById('edit-services-guest-name').textContent = `Guest: ${entry.name}`;
  document.getElementById('edit-services-grid').innerHTML = cfg().services.map(s => {
    const selected = entry.services.includes(s.id);
    return `<button type="button" onclick="this.classList.toggle('selected')" data-service="${s.id}" class="service-btn flex flex-col items-center justify-center py-3 rounded-lg border transition-all duration-200 ${selected ? 'bg-primary text-on-primary border-primary selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:bg-primary/10 hover:text-primary'}">
      <span class="text-xs font-headline font-bold">${s.abbr}</span><span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span></button>`;
  }).join('');
  const m = document.getElementById('edit-services-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeEditServicesModal() {
  const m = document.getElementById('edit-services-modal'); m.classList.add('hidden'); m.style.display = '';
  editServicesEntryId = null;
}
export function saveEditedServices() {
  const entry = q().find(e => String(e.id) === String(editServicesEntryId));
  if (!entry) return;
  const selected = [...document.querySelectorAll('#edit-services-grid .service-btn.selected')].map(b => b.dataset.service);
  if (selected.length === 0) { showToast('Please select at least one service.'); return; }
  entry.services = selected;
  if (entry.assignments) entry.assignments = entry.assignments.filter(a => selected.includes(a.serviceId));
  upsert(entry);
  closeEditServicesModal();
  renderQueue();
  showToast('Services updated');
}

// ── Split / Merge ─────────────────────────────────
export function showSplitMergeModal(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry || !entry.groupId) return;
  const groupMembers = q().filter(e => e.groupId === entry.groupId);
  document.getElementById('split-merge-title').textContent = 'Split Party';
  document.getElementById('split-merge-content').innerHTML = `
    <p class="text-sm font-body text-on-surface-variant mb-4">Select guests to split into a separate ticket. They keep their services but are unlinked from the group.</p>
    <div class="space-y-2 mb-5">
      ${groupMembers.map(m => `<label class="flex items-center gap-3 p-3 rounded-xl bg-surface-container cursor-pointer hover:bg-surface-container-high transition-colors">
        <input type="checkbox" id="split-cb-${m.id}" class="w-4 h-4 accent-primary">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${entry.groupColor}"></span>
        <div><div class="font-headline font-semibold text-on-surface text-sm">${m.name}</div>${m.groupLabel ? `<div class="text-[10px] font-body italic text-outline">${m.groupLabel}</div>` : ''}</div></label>`).join('')}
    </div>
    <button onclick="executeSplit()" class="w-full bg-primary hover:bg-primary-dim text-on-primary py-3 rounded-xl font-headline font-bold transition-all active:scale-95">Split Selected</button>`;
  const m = document.getElementById('split-merge-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function executeSplit() {
  const checked = [...document.querySelectorAll('[id^="split-cb-"]:checked')].map(cb => cb.id.replace('split-cb-', ''));
  if (checked.length === 0) { showToast('Select at least one guest to split.'); return; }
  checked.forEach(id => { const e = q().find(x => String(x.id) === id); if (e) { e.groupId = null; e.groupColor = null; e.groupLabel = null; upsert(e); } });
  closeSplitMergeModal();
  renderQueue();
  showToast(`${checked.length} guest${checked.length > 1 ? 's' : ''} split into separate ticket${checked.length > 1 ? 's' : ''}`);
}
export function closeSplitMergeModal() {
  const m = document.getElementById('split-merge-modal'); m.classList.add('hidden'); m.style.display = '';
}
export function showMergeSelectModal(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  const candidates = q().filter(e => String(e.id) !== String(entryId) && e.status !== 'done');
  document.getElementById('split-merge-title').textContent = 'Merge with Guest';
  document.getElementById('split-merge-content').innerHTML = `
    <p class="text-sm font-body text-on-surface-variant mb-4">Select a guest to merge with <strong>${entry.name}</strong>. They become a party with a shared color.</p>
    <div class="space-y-2 mb-5 max-h-64 overflow-y-auto no-scroll">
      ${candidates.length === 0 ? '<p class="text-sm font-body text-on-surface-variant text-center py-4">No other guests in queue.</p>' :
        candidates.map(c => `<label class="flex items-center gap-3 p-3 rounded-xl bg-surface-container cursor-pointer hover:bg-surface-container-high transition-colors">
          <input type="radio" name="merge-pick" value="${c.id}" class="w-4 h-4 accent-primary">
          ${c.groupColor ? `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${c.groupColor}"></span>` : '<span class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-outline-variant"></span>'}
          <div><div class="font-headline font-semibold text-on-surface text-sm">${c.name}</div><div class="text-[11px] font-body text-on-surface-variant">${c.services.map(sid => svc(sid)?.label||sid).join(', ') || '—'}</div></div></label>`).join('')}
    </div>
    ${candidates.length > 0 ? `<button onclick="executeMerge('${entryId}')" class="w-full bg-primary hover:bg-primary-dim text-on-primary py-3 rounded-xl font-headline font-bold transition-all active:scale-95">Merge</button>` : ''}`;
  const m = document.getElementById('split-merge-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function executeMerge(entryId) {
  const targetId = document.querySelector('[name="merge-pick"]:checked')?.value;
  if (!targetId) { showToast('Please select a guest to merge with.'); return; }
  const entry = q().find(e => String(e.id) === String(entryId));
  const target = q().find(e => String(e.id) === String(targetId));
  if (!entry || !target) return;
  const groupId = target.groupId || entry.groupId || `grp-${Date.now()}`;
  const groupColor = target.groupColor || entry.groupColor || GROUP_COLORS[groupColorIndex++ % GROUP_COLORS.length];
  const allMembers = q().filter(e => String(e.id) === String(entryId) || String(e.id) === String(targetId) || (e.groupId && (e.groupId === entry.groupId || e.groupId === target.groupId)));
  const primaryName = allMembers[0].name;
  allMembers.forEach((m, i) => { m.groupId = groupId; m.groupColor = groupColor; m.groupLabel = i === 0 ? `${m.name} (primary)` : `${primaryName} — ${m.name}`; upsert(m); });
  closeSplitMergeModal();
  renderQueue();
  showToast(`${entry.name} & ${target.name} merged into a party`);
}

// ── Warn modal + reopen ───────────────────────────
export function showWarnModal(title, body, onConfirm) {
  document.getElementById('warn-title').textContent = title;
  document.getElementById('warn-body').textContent = body;
  document.getElementById('warn-confirm-btn').onclick = () => { closeWarnModal(); onConfirm(); };
  const m = document.getElementById('warn-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeWarnModal() {
  const m = document.getElementById('warn-modal'); m.classList.add('hidden'); m.style.display = '';
}
export function confirmReopen(entryId) {
  const entry = q().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  showWarnModal('Reopen this ticket?', `This will move ${entry.name} back to "In Service."`, () => {
    entry.status = 'inservice';
    if (entry.assignments) entry.assignments.forEach(a => { if (getAssignmentStatus(entry, a) === 'done') a.status = 'inservice'; });
    entry.completedAt = null;
    upsert(entry);
    renderQueue(); updateStats(); window.renderTurns?.();
    showToast(`${entry.name}'s ticket reopened`);
  });
}
