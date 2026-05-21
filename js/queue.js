// ── Queue State ────────────────────────────────────
let queue = [];

// ── Queue Persistence ──────────────────────────────
const QUEUE_STORAGE_KEY = 'muse_live_queue';
const QUEUE_DATE_KEY    = 'muse_live_queue_date';

// Whether this session has ever had a non-empty queue — used to distinguish
// "deliberately cleared" from "fresh device with no data" in pushQueueToSheets.
// Declared here so loadQueueFromStorage (below) can safely set it.
let _queueWasPopulated = false;

// Shared queue serializer — converts Date objects to ISO strings for storage/transmission
function serializeQueue(q) {
  return q.map(e => ({
    ...e,
    checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
  }));
}

function saveQueueToStorage() {
  const today = todayStr();
  localStorage.setItem(QUEUE_DATE_KEY, today);
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializeQueue(queue)));
  scheduleSheetsSave();
}

function loadQueueFromStorage() {
  const savedDate = localStorage.getItem(QUEUE_DATE_KEY);
  const today     = todayStr();
  // Only restore if it was saved today — don't restore yesterday's queue
  if (savedDate !== today) {
    localStorage.removeItem(QUEUE_STORAGE_KEY);
    localStorage.removeItem(QUEUE_DATE_KEY);
    return [];
  }
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || '[]');
    const loaded = raw.map(e => ({
      ...e,
      checkinTime: new Date(e.checkinTime),
    }));
    if (loaded.length > 0) _queueWasPopulated = true;
    return loaded;
  } catch { return []; }
}

// ── Queue History Browser ─────────────────────────
let viewingHistoryDate = null;

function loadQueueHistory(dateStr) {
  if (!dateStr) { clearQueueHistory(); return; }
  const today = todayStr();
  if (dateStr === today) { clearQueueHistory(); return; }

  const archive = JSON.parse(localStorage.getItem('muse_queue_archive') || '{}');
  const historical = archive[dateStr];
  viewingHistoryDate = dateStr;
  document.getElementById('clear-history-btn').classList.remove('hidden');

  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');

  if (!historical || historical.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('span:last-child') && (empty.querySelector('span:last-child').textContent = `No records for ${dateStr}`);
    return;
  }

  // Render read-only historical view
  empty.classList.add('hidden');
  const fmt = d => new Date(d).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  list.innerHTML = `
    <div class="bg-secondary-container/40 rounded-xl px-4 py-2 mb-2 text-sm font-body text-on-surface-variant flex items-center gap-2">
      <span class="material-symbols-outlined" style="font-size:16px">history</span>
      Viewing history for ${new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})}
    </div>
    ${historical.map(e => {
      const assignSummary = (e.assignments || []).filter(a => a.techId || a.station || a.cost).map(a => {
        const tech = STAFF.find(s => s.id === a.techId);
        const svc  = SERVICES.find(s => s.id === a.serviceId);
        const parts = [svc?.label, tech ? `→ ${tech.name}` : '', a.station ? `@ ${a.station}` : '', a.cost ? `$${a.cost.toFixed(2)}` : ''].filter(Boolean);
        return parts.join(' ');
      }).join(' · ');
      const badgeClass = { waiting: 'badge-waiting', inservice: 'badge-inservice', done: 'badge-done' }[e.status] || 'badge-done';
      const serviceLabels = (e.services || []).map(sid => SERVICES.find(s=>s.id===sid)?.label || sid).join(', ') || '—';
      return `
        <div class="bg-surface-container-lowest rounded-xl p-4 border border-surface-container-high flex items-center gap-4 opacity-80">
          <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
            <span class="text-sm font-headline font-bold text-on-surface">${(e.name||'?').charAt(0).toUpperCase()}</span>
          </div>
          <div class="flex-grow min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-headline font-semibold text-on-surface text-base">${e.name}</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full font-body font-semibold ${badgeClass}">${e.status}</span>
              ${e.totalCost ? `<span class="font-semibold text-primary text-sm">$${Number(e.totalCost).toFixed(2)}</span>` : ''}
            </div>
            <div class="text-xs font-body text-on-surface-variant mt-0.5">${serviceLabels}</div>
            ${assignSummary ? `<div class="text-[11px] font-body text-primary mt-0.5">${assignSummary}</div>` : ''}
            <div class="text-[11px] font-body text-outline mt-0.5">${fmt(e.checkinTime)}${e.phone ? ' · ' + e.phone : ''}</div>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function clearQueueHistory() {
  viewingHistoryDate = null;
  document.getElementById('queue-history-date').value = '';
  document.getElementById('clear-history-btn').classList.add('hidden');
  renderQueue();
}

function setLogo() {
  // Use custom logo if saved, otherwise fall back to hardcoded LOGO_PATH
  const logoSrc = _logoData || LOGO_PATH;
  ['logo-welcome','logo-checkin','logo-desk'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Always un-hide first — onerror may have hidden it previously
    el.style.display = '';
    el.src = logoSrc;
    // Hide text fallbacks when we have a real logo src
    if (id === 'logo-welcome') {
      const textFallback = document.getElementById('logo-text-welcome');
      if (textFallback) textFallback.style.display = 'none';
    }
    if (id === 'logo-checkin') {
      const textFallback = document.getElementById('logo-text-checkin');
      if (textFallback) textFallback.style.display = 'none';
    }
  });
  // Update settings preview and Re-crop button
  const preview = document.getElementById('logo-settings-preview');
  const placeholder = document.getElementById('logo-settings-placeholder');
  const recropBtn = document.getElementById('logo-recrop-btn');
  if (preview) {
    if (customLogo) {
      preview.innerHTML = `<img src="${customLogo}" class="w-full h-full object-contain">`;
      if (recropBtn) recropBtn.classList.remove('hidden');
    } else {
      preview.innerHTML = `<img src="${LOGO_PATH}" class="w-full h-full object-contain" onerror="this.style.display='none'"><span class="material-symbols-outlined text-2xl text-on-surface-variant" id="logo-settings-placeholder">store</span>`;
      if (recropBtn) recropBtn.classList.add('hidden');
    }
  }
}


// ── Queue (Front Desk) ───────────────────────────
function renderQueue() {
  // NOTE: saveQueueToStorage is NOT called here — only call it when data actually changes
  // (check-in, status change, assignment, remove). Calling it on render causes push/pull loops.
  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');

  let filtered = currentFilter === 'all' ? queue
    : queue.filter(e => e.status === currentFilter);

  // Hide done entries if toggle is off (only when viewing 'all')
  if (currentFilter === 'all' && !showDoneInQueue) {
    filtered = filtered.filter(e => e.status !== 'done');
  }

  // Sort: waiting first, then inservice, then done
  const order = { waiting: 0, inservice: 1, done: 2 };
  filtered.sort((a,b) => order[a.status] - order[b.status] || a.checkinTime - b.checkinTime);

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group by status with dividers when showing all
  if (currentFilter === 'all') {
    const groups = [
      { key: 'waiting',   label: 'Waiting',    color: 'text-secondary' },
      { key: 'inservice', label: 'In Service',  color: 'text-primary' },
      { key: 'done',      label: 'Done Today',  color: 'text-outline' },
    ];
    list.innerHTML = groups.map(g => {
      const entries = filtered.filter(e => e.status === g.key);
      if (entries.length === 0) return '';
      return `
        <div class="mb-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[11px] font-headline font-bold uppercase tracking-widest ${g.color}">${g.label}</span>
            <span class="text-[11px] font-body ${g.color} opacity-60">(${entries.length})</span>
            <div class="flex-grow h-px bg-surface-container-high ml-1"></div>
          </div>
          <div class="space-y-2">${entries.map(e => buildQueueRow(e)).join('')}</div>
        </div>
      `;
    }).join('');
  } else {
    list.innerHTML = `<div class="space-y-2">${filtered.map(e => buildQueueRow(e)).join('')}</div>`;
  }
}

function buildQueueRow(e) {
    const timeStr = e.checkinTime.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const serviceLabels = e.services.map(sid => SERVICES.find(s=>s.id===sid)?.label || sid).join(', ') || '—';
    const badgeClass = { waiting: 'badge-waiting', inservice: 'badge-inservice', done: 'badge-done' }[e.status];
    const badgeLabel = { waiting: 'Waiting', inservice: 'In Service', done: 'Done' }[e.status];
    const apptBadge = e.isAppointment ? `<span class="badge-appointment text-[10px] px-1.5 py-0.5 rounded-full font-body font-semibold">Appt</span>` : '';
    const assignSummary = (e.assignments || []).filter(a => a.techId || a.cost).map(a => {
      const tech = STAFF.find(s => s.id === a.techId);
      const svc  = SERVICES.find(s => s.id === a.serviceId);
      const svcStatus = getAssignmentStatus(e, a);
      const statusDot = svcStatus === 'done' ? '✓ ' : svcStatus === 'inservice' ? '● ' : '○ ';
      const parts = [statusDot + (svc ? svc.label : '')];
      if (tech)      parts.push('→ ' + tech.name);
      if (a.station) parts.push('@ ' + a.station);
      if (a.cost)    parts.push('$' + Number(a.cost).toFixed(2));
      return parts.join(' ');
    }).join(' · ');
    const totalDisplay = e.totalCost ? `<span class="font-semibold text-primary ml-1">$${e.totalCost.toFixed(2)}</span>` : '';
    const cardBg = e.status === 'done'
      ? 'bg-surface-container-high border-surface-container-highest opacity-70'
      : `bg-surface-container-lowest ${e.isAppointment ? 'border-primary/40' : 'border-surface-container-high'}`;
    const groupBorderStyle = e.groupId && e.status !== 'done' ? `border-left:4px solid ${e.groupColor};` : '';
    const groupDot = e.groupId ? `<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 mr-0.5" style="background:${e.groupColor}"></span>` : '';
    const groupTag = e.groupLabel ? `<span class="text-[10px] font-body italic" style="color:${e.groupColor}">${e.groupLabel}</span>` : '';
    const btnCls = `flex items-center justify-center min-w-[44px] self-stretch rounded-xl transition-all active:scale-95 border-0 cursor-pointer px-3`;
    const id = e.id;
    return `
      <div class="queue-row ${cardBg} rounded-xl py-1.5 px-3 border flex items-stretch gap-1.5" data-id="${id}" style="${groupBorderStyle}">
        <div class="flex-grow min-w-0 py-1">
          <div class="flex items-center gap-1 flex-wrap leading-tight">
            ${groupDot}<span class="font-headline font-semibold text-on-surface text-sm">${e.name}</span>${groupTag ? ' ' + groupTag : ''}
            <span class="text-[10px] px-1.5 py-0.5 rounded-full font-body font-semibold ${badgeClass}">${badgeLabel}</span>
            ${apptBadge}${totalDisplay}
            <span class="text-[10px] font-body text-outline ml-auto" data-checkin-ts="${e.checkinTime.getTime()}">${formatElapsed(e.checkinTime)}</span>
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
          ${e.status === 'done' ? `<button onclick="confirmReopen('${id}')" title="Reopen" class="${btnCls} bg-surface-container hover:bg-secondary-container text-outline-variant"><span class="material-symbols-outlined" style="font-size:19px">undo</span></button>` : ''}
          <button onclick="removeFromQueue('${id}')" title="Remove" class="${btnCls} bg-surface-container hover:bg-error/20 text-outline hover:text-error"><span class="material-symbols-outlined" style="font-size:17px">close</span></button>
        </div>
      </div>`;
}

function updateStatus(id, status) {
  const entry = queue.find(e => String(e.id) === String(id));
  if (!entry) return;
  if (entry.assignments && entry.assignments.length > 0) {
    if (status === 'inservice') {
      entry.assignments.forEach(a => {
        if (a.techId && getAssignmentStatus(entry, a) === 'waiting') a.status = 'inservice';
      });
    } else if (status === 'waiting') {
      entry.assignments.forEach(a => {
        if (getAssignmentStatus(entry, a) === 'inservice') a.status = 'waiting';
      });
    } else if (status === 'done') {
      entry.assignments.forEach(a => { if (a.techId) a.status = 'done'; });
    }
    entry.status = deriveEntryStatus(entry);
  } else {
    entry.status = status;
  }
  if (entry.status === 'done') saveRecord(entry);
  // saveQueueToStorage pushes the full queue (including this entry) to Sheets —
  // updateSheetsRow is not needed here and would cause a redundant double write.
  saveQueueToStorage();
  scheduleSheetsSave();
  renderQueue();
  updateStats();
  renderTurns();
}

function removeFromQueue(id) {
  queue = queue.filter(e => String(e.id) !== String(id));
  saveQueueToStorage();
  scheduleSheetsSave();
  renderQueue();
  updateStats();
  renderTurns();
}

function filterQueue(filter) {
  currentFilter = filter;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('bg-primary','text-on-primary');
    b.classList.add('bg-surface-container','text-on-surface-variant');
  });
  const active = document.getElementById(`tab-${filter}`);
  if (active) {
    active.classList.add('bg-primary','text-on-primary');
    active.classList.remove('bg-surface-container','text-on-surface-variant');
  }
  renderQueue();
}

function updateStats() {
  // stat elements were removed from header — guard safely
  const w = document.getElementById('stat-waiting');
  const s = document.getElementById('stat-inservice');
  const d = document.getElementById('stat-done');
  if (w) w.textContent = queue.filter(e=>e.status==='waiting').length;
  if (s) s.textContent = queue.filter(e=>e.status==='inservice').length;
  if (d) d.textContent = queue.filter(e=>e.status==='done').length;
}


// ── Manual Add Modal ─────────────────────────────
let manualGuestCount = 0;

function serviceButtonsHtml(prefix) {
  return SERVICES.map(s => `
    <button type="button" onclick="this.classList.toggle('selected')"
      data-service="${s.id}"
      class="service-btn flex flex-col items-center justify-center py-2 rounded-lg bg-surface-container text-on-surface-variant border border-outline-variant/30 hover:bg-primary/10 hover:text-primary transition-all text-xs">
      <span class="font-headline font-bold">${s.abbr}</span>
      <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter text-center leading-tight">${s.label}</span>
    </button>
  `).join('');
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
    <label class="flex items-center gap-2 cursor-pointer" id="manual-same-label-${idx}" onclick="toggleManualSameContact(${idx})">
      <div id="manual-same-box-${idx}" class="w-6 h-6 rounded border-2 border-outline-variant flex items-center justify-center flex-shrink-0 transition-all" style="background:transparent">
        <span class="material-symbols-outlined hidden" id="manual-check-icon-${idx}" style="font-size:14px;color:#ffffff;font-variation-settings:'FILL' 1,'wght' 700">check</span>
      </div>
      <input type="checkbox" id="manual-same-${idx}" class="hidden">
      <span class="text-sm font-body text-on-surface-variant">Same contact info as primary guest</span>
    </label>` : ''}

    <div id="manual-contact-fields-${idx}" class="space-y-3">
      <div class="ac-input-wrap">
        <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">Phone Number</label>
        <input id="manual-phone-${idx}" type="tel" placeholder="(555) 000-0000" autocomplete="off"
          oninput="acSearchManual(this, ${idx}, 'phone')"
          class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline font-light focus:border-primary transition-colors placeholder:text-surface-container-highest">
        <div id="mac-phone-${idx}" class="autocomplete-list hidden"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="ac-input-wrap">
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">First Name</label>
          <input id="manual-first-${idx}" type="text" placeholder="First" autocomplete="off"
            oninput="acSearchManual(this, ${idx}, 'first'); autoCapitalize(this)"
            class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
          <div id="mac-first-${idx}" class="autocomplete-list hidden"></div>
        </div>
        <div>
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">Last Name</label>
          <input id="manual-last-${idx}" type="text" placeholder="Last"
            oninput="autoCapitalize(this)"
            class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
        </div>
      </div>
    </div>

    ${!isPrimary ? `
    <div id="manual-firstonly-fields-${idx}" class="hidden">
      <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">First Name</label>
      <input id="manual-firstonly-${idx}" type="text" placeholder="First"
        oninput="autoCapitalize(this)"
        class="w-full border-b border-surface-container-high bg-transparent py-2 text-base font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
    </div>` : ''}

    <div>
      <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-2">Services</label>
      <div class="grid grid-cols-4 gap-2" id="manual-services-${idx}">${serviceButtonsHtml(idx)}</div>
    </div>
  `;
  container.appendChild(card);
}

function toggleManualSameContact(idx) {
  const cb = document.getElementById(`manual-same-${idx}`);
  const box = document.getElementById(`manual-same-box-${idx}`);
  const checkIcon = document.getElementById(`manual-check-icon-${idx}`);
  const contactFields = document.getElementById(`manual-contact-fields-${idx}`);
  const firstOnlyFields = document.getElementById(`manual-firstonly-fields-${idx}`);

  cb.checked = !cb.checked;

  if (cb.checked) {
    if (box) { box.style.background = '#1a5252'; box.style.borderColor = '#1a5252'; }
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (contactFields) contactFields.classList.add('hidden');
    if (firstOnlyFields) firstOnlyFields.classList.remove('hidden');
  } else {
    if (box) { box.style.background = 'transparent'; box.style.borderColor = '#7a858a'; }
    if (checkIcon) checkIcon.classList.add('hidden');
    if (contactFields) contactFields.classList.remove('hidden');
    if (firstOnlyFields) firstOnlyFields.classList.add('hidden');
  }
}

function showManualAdd() {
  manualGuestCount = 0;
  document.getElementById('manual-guests-container').innerHTML = '';
  addManualGuest();
  document.getElementById('manual-modal').classList.remove('hidden');
  document.getElementById('manual-modal').style.display = 'flex';
}

function addManualGuest() {
  manualGuestCount++;
  renderManualGuestCard(manualGuestCount);
}

function removeManualGuest(idx) {
  const card = document.getElementById(`manual-guest-${idx}`);
  if (card) card.remove();
}

function closeManualAdd() {
  document.getElementById('manual-modal').classList.add('hidden');
  document.getElementById('manual-modal').style.display = '';
  // Reset form so stale data never shows on next open
  manualGuestCount = 0;
  const container = document.getElementById('manual-guests-container');
  if (container) container.innerHTML = '';
}

function submitManualAdd() {
  const newEntries = [];
  const isAppointment = document.getElementById('manual-is-appointment')?.checked || false;
  for (let i = 1; i <= manualGuestCount; i++) {
    const card = document.getElementById(`manual-guest-${i}`);
    if (!card) continue;

    const sameContact = i > 1 && document.getElementById(`manual-same-${i}`)?.checked;
    let phone, first, last;

    if (sameContact) {
      first = document.getElementById(`manual-firstonly-${i}`)?.value.trim() || '';
      phone = document.getElementById('manual-phone-1')?.value.trim() || '';
      last  = '';
    } else {
      phone = document.getElementById(`manual-phone-${i}`)?.value.trim() || '';
      first = document.getElementById(`manual-first-${i}`)?.value.trim() || '';
      last  = document.getElementById(`manual-last-${i}`)?.value.trim() || '';
    }

    if (!first) { showToast('Please enter a first name for each guest.'); return; }

    const selectedBtns = card.querySelectorAll('.service-btn.selected');
    const services = Array.from(selectedBtns).map(b => b.dataset.service);

    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      name: first + (last ? ' ' + last : ''),
      phone, services,
      status: 'waiting',
      checkinTime: new Date(),
      isNew: false,
      skipSquare: sameContact,
      isAppointment,
    };
    newEntries.push(entry);
    queue.push(entry);
  }

  if (newEntries.length === 0) return;

  // Assign group info if multiple guests
  if (newEntries.length > 1) {
    const groupId = `grp-${Date.now()}`;
    const groupColor = GROUP_COLORS[groupColorIndex % GROUP_COLORS.length];
    groupColorIndex++;
    const primaryName = newEntries[0].name;
    newEntries.forEach((e, i) => {
      e.groupId = groupId;
      e.groupColor = groupColor;
      e.groupLabel = i === 0 ? `${e.name} (primary)` : `${primaryName} — ${e.name}`;
    });
  }

  newEntries.forEach(e => { if (!e.skipSquare) squareUpsertCustomer(e); });
  newEntries.forEach(e => exportToSheets(e));

  // Save and push to Sheets immediately so other devices see new entries
  saveQueueToStorage();
  pushQueueToSheets();

  renderQueue();
  updateStats();
  renderTurns(); // always refresh turns so waiting panel updates immediately
  closeManualAdd();
  showToast(`${newEntries.map(e => e.name).join(' & ')} added to queue`);
}


// ── Edit Check-In ─────────────────────────────────
let _editCheckinId = null;

function showEditCheckin(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;
  _editCheckinId = entryId;

  // Parse name
  const nameParts = (entry.name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  document.getElementById('edit-checkin-content').innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">First Name</label>
        <input id="eci-first" type="text" value="${firstName}" oninput="autoCapitalize(this)"
          class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none">
      </div>
      <div>
        <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Last Name</label>
        <input id="eci-last" type="text" value="${lastName}" oninput="autoCapitalize(this)"
          class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none">
      </div>
    </div>
    <div>
      <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Phone</label>
      <input id="eci-phone" type="tel" value="${entry.phone || ''}"
        class="w-full border-2 border-surface-container-high bg-transparent rounded-xl px-4 py-2 text-base font-headline focus:border-primary outline-none">
    </div>
    <div>
      <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Services</label>
      <div class="grid grid-cols-3 gap-2">
        ${SERVICES.map(s => `
          <label class="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-surface-container border ${entry.services.includes(s.id) ? 'border-primary bg-primary/10' : 'border-transparent'}">
            <input type="checkbox" class="eci-svc accent-primary" value="${s.id}" ${entry.services.includes(s.id) ? 'checked' : ''}>
            <span class="text-xs font-body">${s.label}</span>
          </label>`).join('')}
      </div>
    </div>
    ${entry.groupId ? `<div class="p-3 bg-surface-container rounded-xl text-xs font-body text-on-surface-variant">
      <span class="material-symbols-outlined align-middle" style="font-size:14px">group</span>
      This customer is part of a group check-in. Name and phone changes apply only to this guest.
    </div>` : ''}
  `;

  document.getElementById('edit-checkin-modal').classList.remove('hidden');
  document.getElementById('edit-checkin-modal').style.display = 'flex';
}

function closeEditCheckin() {
  document.getElementById('edit-checkin-modal').classList.add('hidden');
  document.getElementById('edit-checkin-modal').style.display = '';
  _editCheckinId = null;
}

function saveEditCheckin() {
  const entry = queue.find(e => String(e.id) === String(_editCheckinId));
  if (!entry) return;
  const first = document.getElementById('eci-first')?.value.trim();
  const last  = document.getElementById('eci-last')?.value.trim();
  const phone = document.getElementById('eci-phone')?.value.trim();
  const svcs  = [...document.querySelectorAll('.eci-svc:checked')].map(cb => cb.value);
  if (!first) { showToast('First name is required.'); return; }
  if (svcs.length === 0) { showToast('Select at least one service.'); return; }

  entry.name     = last ? `${first} ${last}` : first;
  entry.phone    = phone;
  entry.services = svcs;
  // Update assignments to remove any services no longer selected
  if (entry.assignments) {
    entry.assignments = entry.assignments.filter(a => svcs.includes(a.serviceId));
  }
  entry.status = deriveEntryStatus(entry);

  // Also update any group members that share the same contact (same phone)
  if (entry.groupId) {
    queue.filter(e => e.groupId === entry.groupId && String(e.id) !== String(_editCheckinId)).forEach(member => {
      // Only sync phone — other members have their own names
    });
  }

  // Update Square customer record if we have a match
  if (squareConfig && phone) {
    const match = customerDirectory.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(phone.replace(/\D/g,'')));
    if (match) {
      match.firstName = first;
      match.lastName  = last;
      match.phone     = phone;
      localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
      // Push to Square silently
      fetch(`${SQUARE_PROXY}/v2/customers/${match.squareId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ given_name: first, family_name: last, phone_number: phone }),
      }).catch(() => {});
      // Also update squareCustomers autocomplete cache
      const sc = squareCustomers.find(c => c.id === match.squareId);
      if (sc) { sc.given_name = first; sc.family_name = last; sc.phone = phone; sc.display = `${first} ${last}`.trim(); }
    }
  }

  pushUndo('Edit check-in: ' + entry.name);
  saveQueueToStorage();
  scheduleSheetsSave();
  updateSheetsRow(entry);
  closeEditCheckin();
  renderQueue();
  renderTurns();
  showToast('Check-in updated ✓');
}


// ── Queue Assign Modal ────────────────────────────
let assignEntryId = null;

function showAssignModal(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;
  assignEntryId = entryId;

  document.getElementById('assign-guest-name').textContent = `Guest: ${entry.name}`;

  // Render service picker
  renderAssignServicePicker(entry);

  // Render assignment rows for currently selected services
  renderAssignRows(entry);

  document.getElementById('assign-modal').classList.remove('hidden');
  document.getElementById('assign-modal').style.display = 'flex';
}

function renderAssignServicePicker(entry) {
  const picker = document.getElementById('assign-service-picker');
  if (!picker) return;
  picker.innerHTML = SERVICES.filter(s => isServiceVisibleOnDash(s.id)).map(s => {
    const selected = entry.services.includes(s.id);
    return `
      <button type="button"
        onclick="toggleAssignService('${s.id}')"
        id="assign-svc-btn-${s.id}"
        class="service-btn flex flex-col items-center justify-center py-2 rounded-lg border transition-all duration-200 text-xs ${selected ? 'bg-primary text-on-primary border-primary selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:bg-primary/10 hover:text-primary'}">
        <span class="font-headline font-bold">${s.abbr}</span>
        <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span>
      </button>
    `;
  }).join('');
}

function toggleAssignService(sid) {
  const entry = queue.find(e => String(e.id) === String(assignEntryId));
  if (!entry) return;

  if (entry.services.includes(sid)) {
    if (entry.services.length === 1) { showToast('At least one service required.'); return; }
    entry.services = entry.services.filter(id => id !== sid);
    // Remove stale assignment
    if (entry.assignments) entry.assignments = entry.assignments.filter(a => a.serviceId !== sid);
  } else {
    entry.services.push(sid);
  }

  // Update button visual
  const btn = document.getElementById(`assign-svc-btn-${sid}`);
  if (btn) {
    const selected = entry.services.includes(sid);
    btn.classList.toggle('bg-primary', selected);
    btn.classList.toggle('text-on-primary', selected);
    btn.classList.toggle('border-primary', selected);
    btn.classList.toggle('selected', selected);
    btn.classList.toggle('bg-surface-container', !selected);
    btn.classList.toggle('text-on-surface-variant', !selected);
    btn.classList.toggle('border-outline-variant/30', !selected);
  }

  renderAssignRows(entry);
}

function renderAssignRows(entry) {
  const stations = [
    ...Array.from({length:12}, (_,i) => `P${i+1}`),
    ...Array.from({length:15}, (_,i) => `M${i+1}`),
  ];
  const servicesList = document.getElementById('assign-services-list');
  const entryServices = entry.services.length > 0 ? entry.services : ['other'];
  servicesList.innerHTML = entryServices.map(sid => {
    const svc = SERVICES.find(s => s.id === sid) || { id: sid, label: sid };
    const assignment = (entry.assignments || []).find(a => a.serviceId === sid) || {};
    const _checkedIn1 = getActiveStaff().filter(s => turnsTechOrder.includes(s.id));
    const techOptions = _checkedIn1.length > 0
      ? _checkedIn1.map(st => `<option value="${st.id}" ${assignment.techId === st.id ? 'selected' : ''}>${st.name}</option>`).join('')
      : `<option value="" disabled>No techs checked in — add in Turns tab</option>`;
    const stationOptions = stations.map(st =>
      `<option value="${st}" ${assignment.station === st ? 'selected' : ''}>${st}</option>`
    ).join('');
    return `
      <div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high" data-service-id="${sid}">
        <div class="font-headline font-semibold text-on-surface mb-3">${svc.label}</div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Technician</label>
            <select class="assign-tech w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary" onchange="updateAssignTotal()">
              <option value="">— Unassigned —</option>
              ${techOptions}
            </select>
          </div>
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Station</label>
            <select class="assign-station w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              ${stationOptions}
            </select>
          </div>
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Cost ($)</label>
            <input type="text" inputmode="decimal"
              placeholder="${svc.baseCost != null ? Number(svc.baseCost).toFixed(2) : '0.00'}"
              value="${assignment.cost != null && assignment.cost !== 0 ? assignment.cost : (svc.baseCost != null && svc.baseCost > 0 ? Number(svc.baseCost).toFixed(2) : '')}"
              class="assign-cost w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary cursor-pointer"
              onfocus="openNumpad(this,'Cost — ' + '${svc.label}')"
              onclick="openNumpad(this,'Cost — ' + '${svc.label}')"
              oninput="updateAssignTotal()">
          </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  updateAssignTotal();
}

function updateAssignTotal() {
  const costs = [...document.querySelectorAll('.assign-cost')].map(i => parseFloat(i.value) || 0);
  const total = costs.reduce((a, b) => a + b, 0);
  document.getElementById('assign-total').textContent = `$${total.toFixed(2)}`;
}

function closeAssignModal() {
  document.getElementById('assign-modal').classList.add('hidden');
  document.getElementById('assign-modal').style.display = '';
  assignEntryId = null;
}

// Shared: read current assign modal inputs into entry
function readAssignModalInputs(entry) {
  const rows = document.querySelectorAll('#assign-services-list [data-service-id]');
  entry.assignments = Array.from(rows).map(row => {
    const sid = row.dataset.serviceId;
    // Preserve existing status — only cycleServiceStatus may change it
    const existing = (entry.assignments || []).find(a => a.serviceId === sid);
    return {
      serviceId: sid,
      techId:    row.querySelector('.assign-tech').value,
      station:   row.querySelector('.assign-station')?.value || '',
      cost:      parseFloat(row.querySelector('.assign-cost').value) || 0,
      status:    existing?.status || 'waiting',
      assignedAt: existing?.assignedAt || 0,
    };
  });
  entry.totalCost = entry.assignments.reduce((a, b) => a + b.cost, 0);
}

// Check if all services have a tech and cost assigned
function validateAssignments(entry) {
  if (!entry.assignments || entry.assignments.length === 0) return false;
  return entry.assignments.every(a => a.techId && a.cost > 0);
}

// Block advancing to 'done' without full assignments
function tryAdvanceStatus(id, targetStatus) {
  const entry = queue.find(e => String(e.id) === String(id));
  if (!entry) return;

  if (targetStatus === 'done') {
    if (!validateAssignments(entry)) {
      showToast('Please assign a technician and cost before marking as Done.');
      showGroupAssignModal(id);
      return;
    }
  }
  updateStatus(id, targetStatus);
}

// Save assignments + advance status from within the assign modal
function saveAndAdvanceStatus() {
  const entry = queue.find(e => String(e.id) === String(assignEntryId));
  if (!entry) return;
  readAssignModalInputs(entry);
  const targetStatus = entry.status === 'inservice' ? 'done' : 'inservice';
  if (targetStatus === 'done' && !validateAssignments(entry)) {
    showToast('Please assign a tech and cost for every service.');
    return;
  }
  // Advance all assignment statuses to match targetStatus, then derive entry status
  entry.assignments.forEach(a => { if (a.techId) a.status = targetStatus; });
  entry.status = deriveEntryStatus(entry);
  closeAssignModal();
  if (entry.status === 'done') saveRecord(entry);
  updateSheetsRow(entry);
  saveQueueToStorage();
  renderQueue();
  updateStats();
  renderTurns();
  showToast(`Saved & moved to ${entry.status === 'done' ? 'Done' : 'In Service'}`);
}

function saveAssignments() {
  const entry = queue.find(e => String(e.id) === String(assignEntryId));
  if (!entry) return;
  readAssignModalInputs(entry);
  // Re-derive entry status from assignment statuses
  entry.status = deriveEntryStatus(entry);
  closeAssignModal();
  // saveQueueToStorage → scheduleSheetsSave handles the full queue push;
  // updateSheetsRow is NOT called here to avoid a redundant double write.
  saveQueueToStorage();
  renderQueue();
  renderTurns();
  showToast('Assignments saved');
}

async function saveAssignmentsAndPushToSquare() {
  const entry = queue.find(e => String(e.id) === String(assignEntryId));
  if (!entry) return;
  readAssignModalInputs(entry);
  if (!validateAssignments(entry)) {
    showToast('Please assign a tech and cost before pushing to Square.');
    return;
  }
  updateSheetsRow(entry);
  renderQueue();
  renderTurns();
  showToast('Pushing to Square…');
  await pushOrderToSquare(entry);
  closeAssignModal();
}


// ── Edit Services Modal ───────────────────────────
let editServicesEntryId = null;

function showEditServicesModal(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;
  editServicesEntryId = entryId;

  document.getElementById('edit-services-guest-name').textContent = `Guest: ${entry.name}`;

  const grid = document.getElementById('edit-services-grid');
  grid.innerHTML = SERVICES.map(s => {
    const selected = entry.services.includes(s.id);
    return `
      <button type="button" onclick="this.classList.toggle('selected')"
        data-service="${s.id}"
        class="service-btn flex flex-col items-center justify-center py-3 rounded-lg border transition-all duration-200 ${selected ? 'bg-primary text-on-primary border-primary selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:bg-primary/10 hover:text-primary'}">
        <span class="text-xs font-headline font-bold">${s.abbr}</span>
        <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span>
      </button>
    `;
  }).join('');

  document.getElementById('edit-services-modal').classList.remove('hidden');
  document.getElementById('edit-services-modal').style.display = 'flex';
}

function closeEditServicesModal() {
  document.getElementById('edit-services-modal').classList.add('hidden');
  document.getElementById('edit-services-modal').style.display = '';
  editServicesEntryId = null;
}

function saveEditedServices() {
  const entry = queue.find(e => String(e.id) === String(editServicesEntryId));
  if (!entry) return;

  const selected = [...document.querySelectorAll('#edit-services-grid .service-btn.selected')].map(b => b.dataset.service);
  if (selected.length === 0) { showToast('Please select at least one service.'); return; }

  entry.services = selected;

  // Remove stale assignments for services no longer selected
  if (entry.assignments) {
    entry.assignments = entry.assignments.filter(a => selected.includes(a.serviceId));
  }

  closeEditServicesModal();
  updateSheetsRow(entry);
  renderQueue();
  showToast('Services updated');
}


// ── Group Assign Modal ────────────────────────────
let groupAssignEntries = []; // array of entry ids in current group modal
let activeGroupTab = 0;

function showGroupAssignModal(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;

  // Collect all group members if applicable
  if (entry.groupId) {
    groupAssignEntries = queue
      .filter(e => e.groupId === entry.groupId)
      .map(e => String(e.id));
  } else {
    groupAssignEntries = [String(entry.id)];
  }

  // Always start on the tab for the CLICKED entry
  const clickedTabIdx = groupAssignEntries.indexOf(String(entryId));
  activeGroupTab = clickedTabIdx >= 0 ? clickedTabIdx : 0;

  renderGroupAssignTabs();
  renderGroupAssignContent();

  // Set advance button label from current tab's entry status
  const advLabel = document.getElementById('group-advance-label');
  if (advLabel && entry) advLabel.textContent = entry.status === 'inservice' ? 'Mark Done' : 'In Service';
  const advBtn = document.getElementById('group-advance-btn');
  if (advBtn && entry) advBtn.style.display = entry.status === 'done' ? 'none' : '';

  document.getElementById('group-assign-modal').classList.remove('hidden');
  document.getElementById('group-assign-modal').style.display = 'flex';
}

function renderGroupAssignTabs() {
  const tabs = document.getElementById('group-assign-tabs');
  tabs.innerHTML = groupAssignEntries.map((id, i) => {
    const entry = queue.find(e => String(e.id) === id);
    if (!entry) return '';
    const isActive = i === activeGroupTab;
    const color = entry.groupColor || '#1a5252';
    return `
      <div class="flex items-center gap-1">
        <button onclick="switchGroupTab(${i})" id="gtab-${i}"
          class="px-4 py-2 rounded-full text-sm font-body font-semibold transition-all flex items-center gap-2 ${isActive ? 'text-white' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}"
          style="${isActive ? `background:${color}` : ''}">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>
          ${entry.name.split(' ')[0]}
        </button>
        ${isActive ? `<button onclick="openCustomerFromAssign('${id}')" title="Edit customer" class="w-7 h-7 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors">
          <span class="material-symbols-outlined" style="font-size:16px">person_edit</span>
        </button>` : ''}
      </div>
    `;
  }).join('');
}

function openCustomerFromAssign(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;

  // Try to find in Square customer directory by phone
  const match = entry.phone
    ? customerDirectory.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(entry.phone.replace(/\D/g,'')))
    : null;

  if (match) {
    // Has a Square customer record — open the full edit modal
    showEditCustomer(match.squareId);
  } else {
    // Not in Square directory — open the check-in edit modal instead
    closeGroupAssignModal();
    showEditCheckin(entryId);
  }
}

function switchGroupTab(i) {
  saveCurrentGroupTabInputs();
  activeGroupTab = i;
  renderGroupAssignTabs();
  renderGroupAssignContent();
  // Update advance button label for newly selected entry
  const entryId = groupAssignEntries[i];
  const entry = queue.find(e => String(e.id) === entryId);
  const advLabel = document.getElementById('group-advance-label');
  if (advLabel && entry) advLabel.textContent = entry.status === 'inservice' ? 'Mark Done' : 'In Service';
  const advBtn = document.getElementById('group-advance-btn');
  if (advBtn && entry) advBtn.style.display = entry.status === 'done' ? 'none' : '';
}

function cycleServiceStatus(entryId, serviceId, newStatus) {
  // Save current modal inputs first so we don't lose tech/cost data.
  // Only meaningful when the group assign modal is open — guard against stale DOM reads.
  const modalOpen = document.getElementById('group-assign-modal')?.style.display === 'flex';
  if (modalOpen) saveCurrentGroupTabInputs();
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;

  // Find this service's assignment
  const a = (entry.assignments || []).find(x => x.serviceId === serviceId);

  // Validate before advancing
  if (newStatus === 'inservice') {
    if (!a || !a.techId) {
      showToast('Assign a technician before marking In Service.');
      return;
    }
  }
  if (newStatus === 'done') {
    if (!a || !a.techId) {
      showToast('Assign a technician before marking Done.');
      return;
    }
    if (!a.cost || a.cost <= 0) {
      showToast('Enter a price before marking Done.');
      return;
    }
  }

  setAssignmentStatus(entry, serviceId, newStatus);
  // Re-render the modal content to update the button
  renderGroupAssignContent();
}

function saveCurrentGroupTabInputs() {
  const entryId = groupAssignEntries[activeGroupTab];
  if (!entryId) return;
  const entry = queue.find(e => String(e.id) === entryId);
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
  // Save items
  entry.items = [];
  document.querySelectorAll('#group-assign-content [data-item-id]').forEach(row => {
    const itemId = row.dataset.itemId;
    const qty   = parseInt(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    if (price > 0 && qty > 0) entry.items.push({ itemId, qty, price });
  });
  // Save fees — only include fees where staff explicitly entered an amount.
  // Percent fees auto-calculate a placeholder but should NOT be saved unless
  // staff deliberately confirms them by typing a value.
  const svcSubtotal = entry.assignments.reduce((s, a) => s + (a.cost||0), 0);
  entry.fees = [];
  document.querySelectorAll('#group-assign-content [data-fee-id]').forEach(row => {
    const feeId   = row.dataset.feeId;
    const feeType = row.dataset.feeType;
    const feeVal  = parseFloat(row.dataset.feeValue) || 0;
    const rawInput = row.querySelector('.fee-amount')?.value;
    // Only add fee if staff typed an explicit value — empty field means "not applied"
    if (!rawInput || rawInput.trim() === '') return;
    let amount = feeType === 'percent'
      ? Math.round(svcSubtotal * feeVal / 100 * 100) / 100
      : parseFloat(rawInput) || 0;
    if (amount > 0) entry.fees.push({ feeId, amount, type: feeType });
  });
  const itemTotal = (entry.items||[]).reduce((s,i)=>s+(i.price*(i.qty||0)),0);
  const feeTotal  = (entry.fees ||[]).reduce((s,f)=>s+(f.amount||0),0);

  // Discount — flat dollar or percent of service subtotal
  const discountTypeEl  = document.querySelector('#group-assign-content .discount-type-select');
  const discountInputEl = document.querySelector('#group-assign-content .discount-input');
  const discountNoteEl  = document.querySelector('#group-assign-content .discount-note-input');
  const discountType    = discountTypeEl?.value || 'flat';
  const discountInput   = parseFloat(discountInputEl?.value) || 0;
  const discountNote    = discountNoteEl?.value?.trim() || '';
  const svcSub          = entry.assignments.reduce((s,a)=>s+(a.cost||0),0);
  const discountAmt     = discountType === 'percent'
    ? Math.round(svcSub * discountInput / 100 * 100) / 100
    : discountInput;
  entry.discount     = discountAmt;
  entry.discountNote = discountNote;

  entry.totalCost = svcSub + itemTotal + feeTotal - discountAmt;
  if (entry.totalCost < 0) entry.totalCost = 0;
  entry.status = deriveEntryStatus(entry);
  setTimeout(updateGroupTotal, 0);
}

function renderGroupAssignContent() {
  const entryId = groupAssignEntries[activeGroupTab];
  const entry = queue.find(e => String(e.id) === entryId);
  if (!entry) return;

  const color = entry.groupColor || '#1a5252';
  const stations = [
    ...Array.from({length:12}, (_,i) => `P${i+1}`),
    ...Array.from({length:15}, (_,i) => `M${i+1}`),
  ];

  const content = document.getElementById('group-assign-content');
  const serviceRows = entry.services.map(sid => {
    const svc = SERVICES.find(s => s.id === sid) || { id: sid, label: sid };
    const assignment = (entry.assignments || []).find(a => a.serviceId === sid) || {};
    const svcStatus = getAssignmentStatus(entry, assignment);
    const _checkedIn2 = getActiveStaff().filter(s => turnsTechOrder.includes(s.id));
    const techOptions = _checkedIn2.length > 0
      ? _checkedIn2.map(st => `<option value="${st.id}" ${assignment.techId === st.id ? 'selected' : ''}>${st.name}</option>`).join('')
      : `<option value="" disabled>No techs checked in — add in Turns tab</option>`;
    const stationOptions = stations.map(st =>
      `<option value="${st}" ${assignment.station === st ? 'selected' : ''}>${st}</option>`
    ).join('');

    // Status badge + cycle button for this service
    const statusBtnStyle = {
      waiting:   'background:#ffe0b2;color:#6d3200',
      inservice: 'background:#c8e6c5;color:#1b5e20',
      done:      'background:#dde2e5;color:#555',
    }[svcStatus] || 'background:#ffe0b2;color:#6d3200';
    const statusLabel = {waiting:'Waiting', inservice:'In Service', done:'Done'}[svcStatus] || 'Waiting';
    const nextStatus = {waiting:'inservice', inservice:'done', done:'waiting'}[svcStatus];

    return `
      <div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-service-id="${sid}">
        <div class="flex items-center justify-between mb-3">
          <div class="font-headline font-semibold text-on-surface">${svc.label}</div>
          <button onclick="cycleServiceStatus('${entry.id}','${sid}','${nextStatus}')"
            class="text-[11px] px-3 py-1 rounded-full font-body font-semibold transition-all hover:opacity-80"
            style="${statusBtnStyle}">${statusLabel} ›</button>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Technician</label>
            <select class="assign-tech w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary" onchange="updateGroupTotal()">
              <option value="">— Unassigned —</option>${techOptions}
            </select>
          </div>
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Station</label>
            <select class="assign-station w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary">
              <option value="">— None —</option>${stationOptions}
            </select>
          </div>
          <div>
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-1">Cost ($)</label>
            <input type="text" inputmode="decimal"
              placeholder="${svc.baseCost != null ? Number(svc.baseCost).toFixed(2) : '0.00'}"
              value="${assignment.cost != null && assignment.cost !== 0 ? assignment.cost : (svc.baseCost != null && svc.baseCost > 0 ? Number(svc.baseCost).toFixed(2) : '')}"
              class="assign-cost w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-2 text-sm font-body text-on-surface focus:outline-none focus:border-primary cursor-pointer"
              onfocus="openNumpad(this,'Cost — ' + '${svc.label}')"
              onclick="openNumpad(this,'Cost — ' + '${svc.label}')"
              oninput="updateGroupTotal()">
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Service picker — only show dash-visible services
  const svcPicker = SERVICES.filter(s => isServiceVisibleOnDash(s.id)).map(s => {
    const selected = entry.services.includes(s.id);
    return `
      <button type="button" onclick="toggleGroupService('${s.id}')" id="gsvc-btn-${s.id}"
        class="service-btn flex flex-col items-center justify-center py-2 rounded-lg border transition-all text-xs ${selected ? 'text-white border-transparent selected' : 'bg-surface-container text-on-surface-variant border-outline-variant/30'}"
        style="${selected ? `background:${color}; border-color:${color}` : ''}">
        <span class="font-headline font-bold">${s.abbr}</span>
        <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span>
      </button>
    `;
  }).join('');

  // Items rows (no tech/station, just cost)
  const itemRows = ITEMS.map(item => {
    const existing = (entry.items || []).find(i => i.itemId === item.id) || {};
    return `
      <div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-item-id="${item.id}">
        <div class="flex items-center justify-between">
          <div class="font-headline font-semibold text-on-surface text-sm">${item.label}
            <span class="ml-2 text-[10px] font-body text-outline-variant uppercase tracking-widest">Retail Item</span>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">Qty</label>
            <input type="text" inputmode="numeric" value="${existing.qty || ''}" placeholder="1"
              class="item-qty w-12 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body text-center focus:outline-none focus:border-primary"
              oninput="updateGroupTotal()">
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">$</label>
            <input type="text" inputmode="decimal" value="${existing.price != null && existing.price !== 0 ? existing.price : (item.price || '')}" placeholder="${item.price || '0.00'}"
              class="item-price w-16 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:outline-none focus:border-primary text-right cursor-pointer"
              onfocus="openNumpad(this,'${item.label}')"
              onclick="openNumpad(this,'${item.label}')"
              oninput="updateGroupTotal()">
          </div>
        </div>
      </div>`;
  }).join('');

  // Fees rows (flat $ or % of service subtotal)
  const feeRows = FEES.map(fee => {
    const existing = (entry.fees || []).find(f => f.feeId === fee.id) || {};
    const feeLabel = fee.type === 'percent' ? `${fee.value}%` : `$${fee.value.toFixed(2)}`;
    return `
      <div class="bg-surface-container-low rounded-xl p-4 border border-surface-container-high mb-3" data-fee-id="${fee.id}" data-fee-type="${fee.type}" data-fee-value="${fee.value}">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-headline font-semibold text-on-surface text-sm">${fee.label}
              <span class="ml-2 text-[10px] font-body text-outline-variant uppercase tracking-widest">${fee.type === 'percent' ? 'Percent Fee' : 'Flat Fee'}</span>
            </div>
            ${fee.type === 'percent' ? `<div class="text-xs text-on-surface-variant mt-0.5">${feeLabel} of service subtotal</div>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest">$</label>
            <input type="text" inputmode="decimal" value="${existing.amount != null && existing.amount !== 0 ? existing.amount : ''}" placeholder="${fee.type==='flat'?fee.value.toFixed(2):'auto'}"
              class="fee-amount w-20 bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-sm font-body focus:outline-none focus:border-primary text-right cursor-pointer"
              ${fee.type==='percent' ? 'readonly' : ''}
              onfocus="if(!this.readOnly) openNumpad(this,'${fee.label}')"
              onclick="if(!this.readOnly) openNumpad(this,'${fee.label}')"
              oninput="updateGroupTotal()">
          </div>
        </div>
      </div>`;
  }).join('');

  const hasSupplement = ITEMS.length > 0 || FEES.length > 0;

  content.innerHTML = `
    <div class="flex items-center gap-2 mb-3">
      <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${color}"></span>
      <span class="font-headline font-bold text-on-surface">${entry.name}</span>
      ${entry.groupLabel ? `<span class="text-[10px] font-body italic" style="color:${color}">${entry.groupLabel}</span>` : ''}
    </div>
    <div class="mb-1">
      <label class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest block mb-2">Services</label>
      <div class="grid grid-cols-4 gap-2 mb-4">${svcPicker}</div>
    </div>
    ${serviceRows}
    ${hasSupplement ? `
      <div class="border-t border-surface-container-high mt-2 pt-3 mb-2">
        <div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-3">Items &amp; Fees</div>
        ${itemRows}${feeRows}
      </div>` : ''}
    <!-- Discount row — always shown, defaults to 0 -->
    <div class="border-t border-surface-container-high pt-3 mb-2">
      <div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-2">Discount</div>
      <div class="bg-surface-container-low rounded-xl p-3 border border-surface-container-high">
        <div class="flex items-center gap-2 mb-2">
          <select class="discount-type-select bg-surface-container border border-surface-container-high rounded-lg px-2 py-1.5 text-xs font-body focus:outline-none focus:border-primary" onchange="updateGroupTotal()">
            <option value="flat">$ Off</option>
            <option value="percent">% Off</option>
          </select>
          <input type="text" inputmode="decimal"
            class="discount-input flex-1 bg-surface-container border border-surface-container-high rounded-lg px-3 py-1.5 text-sm font-body text-right focus:outline-none focus:border-primary cursor-pointer"
            value="${entry.discount && entry.discount > 0 ? entry.discount : ''}"
            placeholder="0"
            onfocus="openNumpad(this,'Discount')"
            onclick="openNumpad(this,'Discount')"
            oninput="updateGroupTotal()">
        </div>
        <input type="text" maxlength="60"
          class="discount-note-input w-full bg-surface-container border border-surface-container-high rounded-lg px-3 py-1.5 text-xs font-body focus:outline-none focus:border-primary"
          value="${entry.discountNote || ''}"
          placeholder="Reason (optional)">
      </div>
    </div>
    <div class="border-t border-surface-container-high pt-3 flex items-center justify-between">
      <span class="font-body font-semibold text-on-surface text-sm">Subtotal</span>
      <span id="group-subtotal" class="font-headline font-bold text-primary">$0.00</span>
    </div>
  `;
  updateGroupTotal();
}

function toggleGroupService(sid) {
  const entryId = groupAssignEntries[activeGroupTab];
  const entry = queue.find(e => String(e.id) === entryId);
  if (!entry) return;
  const color = entry.groupColor || '#1a5252';

  if (entry.services.includes(sid)) {
    if (entry.services.length === 1) { showToast('At least one service required.'); return; }
    entry.services = entry.services.filter(id => id !== sid);
    if (entry.assignments) entry.assignments = entry.assignments.filter(a => a.serviceId !== sid);
  } else {
    entry.services.push(sid);
  }
  // Re-render content with updated services
  renderGroupAssignContent();
}

function updateGroupTotal() {
  const svcCosts = [...document.querySelectorAll('#group-assign-content .assign-cost')].map(i=>parseFloat(i.value)||0);
  const svcSubtotal = svcCosts.reduce((a,b)=>a+b,0);
  const itemTotal = [...document.querySelectorAll('#group-assign-content [data-item-id]')].reduce((sum,row)=>{
    const qty = parseInt(row.querySelector('.item-qty')?.value)||0;
    const price = parseFloat(row.querySelector('.item-price')?.value)||0;
    return sum + price*qty;
  },0);
  let feeTotal = 0;
  document.querySelectorAll('#group-assign-content [data-fee-id]').forEach(row=>{
    const feeType = row.dataset.feeType;
    const feeVal  = parseFloat(row.dataset.feeValue)||0;
    const inp = row.querySelector('.fee-amount');
    if (feeType==='percent') {
      const computed = Math.round(svcSubtotal*feeVal)/100;
      if (inp) inp.value = computed>0?computed.toFixed(2):'';
      feeTotal += computed;
    } else { feeTotal += parseFloat(inp?.value)||0; }
  });

  // Read discount from the discount row
  const discountTypeEl = document.querySelector('#group-assign-content .discount-type-select');
  const discountInpEl  = document.querySelector('#group-assign-content .discount-input');
  const discountType   = discountTypeEl?.value || 'flat';
  const discountInput  = parseFloat(discountInpEl?.value) || 0;
  const discountAmt    = discountType === 'percent'
    ? Math.round(svcSubtotal * discountInput / 100 * 100) / 100
    : discountInput;

  const subtotal = Math.max(0, svcSubtotal + itemTotal + feeTotal - discountAmt);
  const el = document.getElementById('group-subtotal');
  if (el) el.textContent = `$${subtotal.toFixed(2)}`;
  const currentId = groupAssignEntries[activeGroupTab];
  let partyTotal = subtotal;
  groupAssignEntries.forEach((id,i)=>{
    if (i===activeGroupTab) return;
    const e = queue.find(x=>String(x.id)===id);
    if (e) partyTotal += (e.totalCost||0);
  });
  const pel = document.getElementById('group-party-total');
  if (pel) pel.textContent = `$${partyTotal.toFixed(2)}`;
}

function closeGroupAssignModal() {
  document.getElementById('group-assign-modal').classList.add('hidden');
  document.getElementById('group-assign-modal').style.display = '';
  groupAssignEntries = [];
}

function collectGroupAssignments() {
  // Save current tab first
  saveCurrentGroupTabInputs();
  // Return all entries
  return groupAssignEntries.map(id => queue.find(e => String(e.id) === id)).filter(Boolean);
}

function validateGroupAssignments(entries) {
  const incomplete = entries.filter(e =>
    !e.assignments || e.assignments.length === 0 ||
    e.assignments.some(a => !a.techId || a.cost <= 0)
  );
  return incomplete;
}

function saveGroupAssignments() {
  const entries = collectGroupAssignments();
  entries.forEach(e => { e.status = deriveEntryStatus(e); updateSheetsRow(e); });
  saveQueueToStorage(); // pushes queue to Sheets so other devices get assignment updates
  closeGroupAssignModal();
  renderQueue();
  updateStats();
  renderTurns();
  showToast('Assignments saved');
}

function saveGroupAndAdvance() {
  const currentEntryId = groupAssignEntries[activeGroupTab];
  const currentEntry = queue.find(e => String(e.id) === String(currentEntryId));
  if (!currentEntry) return;
  saveCurrentGroupTabInputs();

  const curStatus = currentEntry.status || 'waiting';
  const targetStatus = curStatus === 'inservice' ? 'done' : 'inservice';

  // Validate before advancing
  if (targetStatus === 'inservice') {
    // Must have a tech assigned to at least one service
    const hasTech = (currentEntry.assignments||[]).some(a => a.techId);
    if (!hasTech) {
      showToast('Assign a technician before marking In Service.');
      return;
    }
  }
  if (targetStatus === 'done') {
    // Must have tech AND price for every service
    const incomplete = validateGroupAssignments([currentEntry]);
    if (incomplete.length > 0) {
      showToast(currentEntry.name.split(' ')[0] + ' — assign a tech and price for all services before marking Done.');
      return;
    }
  }

  if (!currentEntry.assignments || currentEntry.assignments.length === 0) {
    // No assignments yet — set entry status directly
    currentEntry.status = targetStatus;
  } else {
    // Only advance services that have a tech assigned
    // AND are currently in the expected source status
    const sourceStatus = targetStatus === 'inservice' ? 'waiting' : 'inservice';
    currentEntry.assignments.forEach(a => {
      if (!a.techId) return; // skip unassigned services
      const currentSvcStatus = getAssignmentStatus(currentEntry, a);
      if (currentSvcStatus === sourceStatus) {
        a.status = targetStatus;
      }
    });
    currentEntry.status = deriveEntryStatus(currentEntry);
  }

  if (currentEntry.status === 'done') saveRecord(currentEntry);
  updateSheetsRow(currentEntry);
  saveQueueToStorage(); // push updated queue to Sheets for cross-device sync
  closeGroupAssignModal();
  renderQueue(); updateStats(); renderTurns();
  showToast(currentEntry.name.split(' ')[0] + ' → ' + (targetStatus === 'done' ? 'Done' : 'In Service'));
}

async function saveGroupAndPushSquare() {
  // Save current tab inputs first
  saveCurrentGroupTabInputs();
  const entries = collectGroupAssignments();

  // For Square push, only require at least one priced service — tech not required
  const hasPrice = entries.some(e =>
    (e.assignments||[]).some(a => a.cost > 0)
  );
  if (!hasPrice) {
    showToast('Add at least one price before pushing to Square.');
    return;
  }

  showToast('Creating Square ticket…');
  for (const e of entries) {
    updateSheetsRow(e);
    await pushOrderToSquare(e);
  }
  closeGroupAssignModal();
  renderQueue();
  renderTurns();
}


// ── Split Modal ───────────────────────────────────
function showSplitMergeModal(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry || !entry.groupId) return;
  const groupMembers = queue.filter(e => e.groupId === entry.groupId);
  const color = entry.groupColor;

  document.getElementById('split-merge-title').textContent = 'Split Party';
  document.getElementById('split-merge-content').innerHTML = `
    <p class="text-sm font-body text-on-surface-variant mb-4">Select guests to split into a separate ticket. They will keep their services but be unlinked from the group.</p>
    <div class="space-y-2 mb-5">
      ${groupMembers.map(m => `
        <label class="flex items-center gap-3 p-3 rounded-xl bg-surface-container cursor-pointer hover:bg-surface-container-high transition-colors">
          <input type="checkbox" id="split-cb-${m.id}" class="w-4 h-4 accent-primary" ${String(m.id) === String(entryId) ? '' : ''}>
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color}"></span>
          <div>
            <div class="font-headline font-semibold text-on-surface text-sm">${m.name}</div>
            ${m.groupLabel ? `<div class="text-[10px] font-body italic text-outline">${m.groupLabel}</div>` : ''}
          </div>
        </label>
      `).join('')}
    </div>
    <button onclick="executeSplit()" class="w-full bg-primary hover:bg-primary-dim text-on-primary py-3 rounded-xl font-headline font-bold transition-all active:scale-95">
      Split Selected
    </button>
  `;

  document.getElementById('split-merge-modal').classList.remove('hidden');
  document.getElementById('split-merge-modal').style.display = 'flex';
}

function executeSplit() {
  const checked = [...document.querySelectorAll('[id^="split-cb-"]:checked')].map(cb => cb.id.replace('split-cb-', ''));
  if (checked.length === 0) { showToast('Select at least one guest to split.'); return; }

  // Detach selected guests from the group
  checked.forEach(id => {
    const e = queue.find(x => String(x.id) === id);
    if (!e) return;
    e.groupId = null;
    e.groupColor = null;
    e.groupLabel = null;
  });

  // If only one member left in group, dissolve the group
  const remaining = queue.filter(e => e.groupId === queue.find(x => !checked.includes(String(x.id)) && x.groupId)?.groupId);
  if (remaining.length === 1) {
    remaining[0].groupId = null;
    remaining[0].groupColor = null;
    remaining[0].groupLabel = null;
  }

  closeSplitMergeModal();
  renderQueue();
  showToast(`${checked.length} guest${checked.length > 1 ? 's' : ''} split into separate ticket${checked.length > 1 ? 's' : ''}`);
}

function closeSplitMergeModal() {
  document.getElementById('split-merge-modal').classList.add('hidden');
  document.getElementById('split-merge-modal').style.display = '';
}


// ── Merge Select Modal ────────────────────────────
function showMergeSelectModal(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;

  // Show all other queue entries (excluding done and this entry)
  const candidates = queue.filter(e =>
    String(e.id) !== String(entryId) && e.status !== 'done'
  );

  document.getElementById('split-merge-title').textContent = 'Merge with Guest';
  document.getElementById('split-merge-content').innerHTML = `
    <p class="text-sm font-body text-on-surface-variant mb-4">Select a guest to merge with <strong>${entry.name}</strong>. They will be linked as a party with a shared color.</p>
    <div class="space-y-2 mb-5 max-h-64 overflow-y-auto no-scroll">
      ${candidates.length === 0 ? '<p class="text-sm font-body text-on-surface-variant text-center py-4">No other guests in queue.</p>' :
        candidates.map(c => `
          <label class="flex items-center gap-3 p-3 rounded-xl bg-surface-container cursor-pointer hover:bg-surface-container-high transition-colors">
            <input type="radio" name="merge-pick" value="${c.id}" class="w-4 h-4 accent-primary">
            ${c.groupColor ? `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${c.groupColor}"></span>` : '<span class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-outline-variant"></span>'}
            <div>
              <div class="font-headline font-semibold text-on-surface text-sm">${c.name}</div>
              <div class="text-[11px] font-body text-on-surface-variant">${c.services.map(sid => SERVICES.find(s=>s.id===sid)?.label||sid).join(', ') || '—'}</div>
            </div>
          </label>
        `).join('')
      }
    </div>
    ${candidates.length > 0 ? `
    <button onclick="executeMerge('${entryId}')" class="w-full bg-primary hover:bg-primary-dim text-on-primary py-3 rounded-xl font-headline font-bold transition-all active:scale-95">
      Merge
    </button>` : ''}
  `;

  document.getElementById('split-merge-modal').classList.remove('hidden');
  document.getElementById('split-merge-modal').style.display = 'flex';
}

function executeMerge(entryId) {
  const targetId = document.querySelector('[name="merge-pick"]:checked')?.value;
  if (!targetId) { showToast('Please select a guest to merge with.'); return; }

  const entry  = queue.find(e => String(e.id) === String(entryId));
  const target = queue.find(e => String(e.id) === String(targetId));
  if (!entry || !target) return;

  // Use existing group if target already has one, otherwise create new
  const groupId    = target.groupId || entry.groupId || `grp-${Date.now()}`;
  const groupColor = target.groupColor || entry.groupColor || GROUP_COLORS[groupColorIndex++ % GROUP_COLORS.length];

  // Collect all members of both groups
  const allMembers = queue.filter(e =>
    String(e.id) === String(entryId) ||
    String(e.id) === String(targetId) ||
    (e.groupId && (e.groupId === entry.groupId || e.groupId === target.groupId))
  );

  // Assign group data; first member becomes primary
  const primaryName = allMembers[0].name;
  allMembers.forEach((m, i) => {
    m.groupId    = groupId;
    m.groupColor = groupColor;
    m.groupLabel = i === 0
      ? `${m.name} (primary)`
      : `${primaryName} — ${m.name}`;
  });

  closeSplitMergeModal();
  renderQueue();
  showToast(`${entry.name} & ${target.name} merged into a party`);
}
function showWarnModal(title, body, onConfirm) {
  document.getElementById('warn-title').textContent = title;
  document.getElementById('warn-body').textContent = body;
  const btn = document.getElementById('warn-confirm-btn');
  btn.onclick = () => { closeWarnModal(); onConfirm(); };
  document.getElementById('warn-modal').classList.remove('hidden');
  document.getElementById('warn-modal').style.display = 'flex';
}

function closeWarnModal() {
  document.getElementById('warn-modal').classList.add('hidden');
  document.getElementById('warn-modal').style.display = '';
}

function confirmReopen(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;
  showWarnModal(
    'Reopen this ticket?',
    `This will move ${entry.name} back to "In Service." Google Sheets will be updated.`,
    () => {
      // Reset entry and all assignment statuses back to inservice
      entry.status = 'inservice';
      if (entry.assignments) {
        entry.assignments.forEach(a => {
          if (getAssignmentStatus(entry, a) === 'done') a.status = 'inservice';
        });
      }
      // Clear any completed timestamp so Check-Ins row doesn't show wrong completion time
      entry.completedAt = null;

      updateSheetsRow(entry); // updates Transaction Log + Check-Ins row (no completedAt → clears it)
      saveQueueToStorage();
      renderQueue();
      updateStats();
      renderTurns();
      showToast(`${entry.name}'s ticket reopened`);
    }
  );
}
function showSquareModal() {
  if (squareConfig) {
    document.getElementById('sq-location').value = squareConfig.locationId || '';
  }
  document.getElementById('square-modal').classList.remove('hidden');
  document.getElementById('square-modal').style.display = 'flex';
}

function saveSquareConfig() {
  const locationId = document.getElementById('sq-location').value.trim();
  if (!locationId) { showToast('Please enter your Location ID.'); return; }
  squareConfig = { locationId };
  localStorage.setItem('muse_sq_config', JSON.stringify(squareConfig));
  document.getElementById('square-modal').classList.add('hidden');
  document.getElementById('square-modal').style.display = '';
  updateSyncLabel('ok', 'Square synced');
  showToast('Square connection saved!');
}

async function testSquareConnection() {
  if (!squareConfig) { showToast('Save config first.'); return; }
  const status = document.getElementById('sq-status');
  status.classList.remove('hidden');
  status.textContent = 'Testing connection…';
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/locations`);
    if (res.ok) {
      status.textContent = '✓ Connected successfully!';
      status.style.color = '#2a6868';
      updateSyncLabel('ok', 'Square synced');
    } else {
      const err = await res.json();
      status.textContent = '✗ ' + (err.errors?.[0]?.detail || 'Connection failed — check your Location ID');
      status.style.color = '#a83836';
      updateSyncLabel('error', 'Square error');
    }
  } catch(e) {
    status.textContent = '✗ Could not reach proxy — check Worker is deployed';
    status.style.color = '#a83836';
  }
}

async function syncSquare() {
  if (!squareConfig) { showSquareModal(); return; }
  updateSyncLabel('pending', 'Syncing…');
  showToast('Syncing with Square…');
  try {
    await Promise.all([squarePullCustomers(), squarePullServices()]);
    updateSyncLabel('ok', 'Square synced');
    showToast('Square sync complete');
  } catch(e) {
    updateSyncLabel('error', 'Sync failed');
    showToast('Square sync failed. Check settings.');
  }
}

// Pull catalog items from Square and merge into SERVICES, ITEMS, FEES
// Square returns ITEM type for retail products and SERVICE type for services.
// We keep them strictly separated — ITEM catalog objects → ITEMS only,
// SERVICE catalog objects → SERVICES or FEES (if name contains fee/charge).
async function squarePullServices() {
  if (!squareConfig) return;
  try {
    // Pull Services (Service Library in Square)
    const svcRes = await fetch(`${SQUARE_PROXY}/v2/catalog/list?types=SERVICE`);
    if (svcRes.ok) {
      const svcData = await svcRes.json();
      let addedSvc = 0;
      (svcData.objects || []).forEach(item => {
        const name = item.item_data?.name;
        if (!name) return;
        const lname = name.toLowerCase();
        // Route fee/charge/surcharge names to FEES
        if (lname.includes('fee') || lname.includes('charge') || lname.includes('surcharge')) {
          const id = `sq-fee-${item.id}`;
          if (!FEES.find(f => f.id === id || f.label.toLowerCase() === lname)) {
            const price = item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
            FEES.push({ id, label: name, type: 'flat', value: price ? price / 100 : 0, squareItemId: item.id });
            // Don't save yet — will be saved in the consolidated push at the end
          }
          return;
        }
        // Add to SERVICES — never to ITEMS (strict separation)
        const id = `sq-${item.id}`;
        if (!SERVICES.find(s => s.id === id || s.label.toLowerCase() === lname)) {
          const abbr = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
          SERVICES.push({ id, label: name, abbr, squareItemId: item.id });
          addedSvc++;
        }
      });
      if (addedSvc > 0) {
        showToast(`${addedSvc} service${addedSvc>1?'s':''} imported from Square`);
      }
    }

    // Pull Items (Item Library in Square) — retail products only, never add to SERVICES
    const itemRes = await fetch(`${SQUARE_PROXY}/v2/catalog/list?types=ITEM`);
    if (itemRes.ok) {
      const itemData = await itemRes.json();
      let addedItems = 0;
      (itemData.objects || []).forEach(item => {
        const name = item.item_data?.name;
        if (!name) return;
        // Skip anything that looks like a service — it belongs in SERVICES not ITEMS
        const lname = name.toLowerCase();
        if (SERVICES.find(s => s.label.toLowerCase() === lname)) return;
        const id = `sq-item-${item.id}`;
        if (!ITEMS.find(i => i.id === id || i.label.toLowerCase() === lname)) {
          const abbr = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
          const price = item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
          ITEMS.push({ id, label: name, abbr, price: price ? price / 100 : 0, squareItemId: item.id });
          addedItems++;
        }
      });
      if (addedItems > 0) {
        showToast(`${addedItems} item${addedItems>1?'s':''} imported from Square`);
      }
    }

    // Single consolidated push — saves services, items, and fees in one Sheets write
    _configWriteTime = Date.now();
    setTimeout(() => pushConfigToSheets(), 500);
  } catch(e) {
    console.warn('Could not pull Square catalog:', e);
  }
}

// Push an order to Square for easy checkout
async function pushOrderToSquare(entry) {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  if (!squareConfig.locationId) { showToast('Location ID missing.'); return; }

  // Build line items — service name + price (no tech name since you'll assign in Square POS)
  const lineItems = (entry.assignments || [])
    .filter(a => a.cost > 0)
    .map(a => {
      const svc = SERVICES.find(s => s.id === a.serviceId);
      return {
        name:     svc?.label || 'Service',
        quantity: '1',
        base_price_money: { amount: Math.round(Number(a.cost) * 100), currency: 'USD' },
        note: a.station || '',
      };
    });

  // Also add any services that have no assignment yet (no price) as $0 line items
  // so the staff can see everything in Square POS
  const assignedSvcIds = new Set((entry.assignments||[]).map(a => a.serviceId));
  entry.services.forEach(sid => {
    if (!assignedSvcIds.has(sid)) {
      const svc = SERVICES.find(s => s.id === sid);
      lineItems.push({
        name: svc?.label || 'Service',
        quantity: '1',
        base_price_money: { amount: 0, currency: 'USD' },
      });
    }
  });

  if (lineItems.length === 0) {
    showToast('No services to push to Square.');
    return;
  }

  showToast('Creating Square ticket…');

  try {
    // Look up Square customer by phone so the ticket is linked to them
    let customerId = null;
    if (entry.phone) {
      try {
        const searchRes = await fetch(`${SQUARE_PROXY}/v2/customers/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { filter: { phone_number: { exact: entry.phone } } } }),
        });
        if (searchRes.ok) {
          const sd = await searchRes.json();
          customerId = sd?.customers?.[0]?.id || null;
        }
      } catch(e) { /* non-fatal — proceed without customer link */ }
    }

    // Create an OPEN order with PICKUP fulfillment
    // This is what makes it appear as an Open Ticket in Square POS
    const orderBody = {
      idempotency_key: `muse-${String(entry.id)}-${Date.now()}`,
      order: {
        location_id: squareConfig.locationId,
        state:       'OPEN',
        reference_id: `muse-${String(entry.id).slice(-8)}`,
        line_items:  lineItems,
        fulfillments: [{
          type:  'PICKUP',
          state: 'PROPOSED',
          pickup_details: {
            recipient: {
              display_name: entry.name,
              phone_number: entry.phone || '',
            },
            pickup_at: new Date(Date.now() + 30 * 60000).toISOString(), // ~30 min from now
            note: `Check-in: ${(entry.checkinTime instanceof Date ? entry.checkinTime : new Date(entry.checkinTime)).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`,
          },
        }],
        ...(customerId ? { customer_id: customerId } : {}),
      },
    };

    const orderRes = await fetch(`${SQUARE_PROXY}/v2/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody),
    });

    const od = await orderRes.json();
    if (orderRes.ok && od?.order?.id) {
      const orderId = od.order.id;
      const total   = od.order.total_money?.amount;
      const display = total != null ? ` · $${(total/100).toFixed(2)}` : '';
      entry.squareOrderId = orderId;
      showToast(`✓ Ticket open in Square POS${display}`);
      saveQueueToStorage();
      renderQueue();
    } else {
      const msg = od?.errors?.[0]?.detail || od?.errors?.[0]?.code || JSON.stringify(od);
      showToast(`Square error: ${msg}`);
      console.error('Square order error:', od);
    }
  } catch(e) {
    console.error('Square push failed:', e);
    showToast('Could not reach Square. Check proxy.');
  }
}
async function squarePullCustomers() {
  if (!squareConfig) return;
  const res = await fetch(`${SQUARE_PROXY}/v2/customers?limit=100`);
  if (!res.ok) throw new Error('Square API error');
  return res.json();
}

async function squareUpsertCustomer(entry) {
  if (!entry.name || entry.name.trim() === '-') return;
  const nameParts = entry.name.trim().split(/\s+/);
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const rawPhone   = (entry.phone || '').replace(/\D/g, '');

  // Only sync to Square if we can uniquely identify the customer.
  // First name only with no phone → skip to avoid creating duplicates
  // for walk-ins who share a common first name.
  if (!rawPhone && !lastName) return;

  try {
    let existingId = null;

    // 1. Check local cache by phone
    if (rawPhone && squareCustomers.length > 0) {
      const cached = squareCustomers.find(c => {
        const cp = (c.phone||'').replace(/\D/g,'').replace(/^1(\d{10})$/,'$1');
        return cp === rawPhone || cp === rawPhone.replace(/^1/,'');
      });
      if (cached) existingId = cached.id;
    }

    // 2. Search Square by phone if not in cache
    if (!existingId && rawPhone) {
      try {
        const searchRes = await fetch(`${SQUARE_PROXY}/v2/customers/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { filter: { phone_number: { exact: entry.phone } } } })
        });
        if (searchRes.ok) {
          const sd = await searchRes.json();
          existingId = sd?.customers?.[0]?.id || null;
        }
      } catch(e) { /* search failed */ }
    }

    // 3. No phone — search local cache by full name to avoid duplicate
    if (!existingId && !rawPhone && lastName) {
      const cached = squareCustomers.find(c =>
        (c.given_name||'').toLowerCase() === firstName.toLowerCase() &&
        (c.family_name||'').toLowerCase() === lastName.toLowerCase()
      );
      if (cached) existingId = cached.id;
    }

    const svcLabels = (entry.services || []).map(sid => SERVICES.find(s => s.id === sid)?.label || sid).join(', ');
    const payload = {
      given_name:  firstName,
      family_name: lastName,
      note: `Last check-in: ${new Date().toLocaleDateString()}${svcLabels ? ' | Services: ' + svcLabels : ''}`,
    };
    if (rawPhone) payload.phone_number = entry.phone;

    if (existingId) {
      const res = await fetch(`${SQUARE_PROXY}/v2/customers/${existingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const c = data.customer;
        if (c && !squareCustomers.find(x => x.id === c.id)) {
          squareCustomers.push({ id: c.id, given_name: c.given_name||'', family_name: c.family_name||'', phone: c.phone_number||'', display: entry.name });
        }
      }
    } else {
      // Stable idempotency key — phone (best) or full name (no timestamp, prevents duplicates on retry)
      const iKey = rawPhone
        ? `muse-customer-${rawPhone}`
        : `muse-customer-${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
      const res = await fetch(`${SQUARE_PROXY}/v2/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: iKey, ...payload })
      });
      if (res.ok) {
        const data = await res.json();
        const c = data.customer;
        if (c) {
          squareCustomers.push({ id: c.id, given_name: c.given_name||'', family_name: c.family_name||'', phone: c.phone_number||'', display: entry.name });
          customerDirectory.push({ squareId: c.id, firstName: c.given_name||'', lastName: c.family_name||'', phone: c.phone_number||'', email: '', note: c.note||'' });
          localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
        }
      }
    }
  } catch(e) {
    console.warn('[Square] Customer upsert failed:', e);
  }
}

function updateSyncLabel(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (dot) { dot.className = `sync-dot ${state}`; }
  if (lbl) lbl.textContent = label;
}


