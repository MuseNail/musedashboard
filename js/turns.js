// ── Per-Service Status Helpers ────────────────────
// assignment.status: 'waiting' | 'inservice' | 'done' (defaults to entry.status if not set)
function getAssignmentStatus(entry, assignment) {
  // NEVER fall back to entry.status — each service is independent
  // Unset = waiting always
  return assignment.status || 'waiting';
}

// Derive entry-level status from its assignments
// If any service is inservice → entry is inservice
// If ALL services are done → entry is done
// Otherwise → waiting
function deriveEntryStatus(entry) {
  if (!entry.assignments || entry.assignments.length === 0) return entry.status || 'waiting';
  const statuses = entry.assignments.map(a => getAssignmentStatus(entry, a));
  if (statuses.some(s => s === 'inservice')) return 'inservice';
  if (statuses.every(s => s === 'done'))     return 'done';
  return 'waiting';
}

function setAssignmentStatus(entry, serviceId, newStatus) {
  if (!entry.assignments) entry.assignments = [];
  const a = entry.assignments.find(x => x.serviceId === serviceId);
  if (a) a.status = newStatus;
  entry.status = deriveEntryStatus(entry);
  if (entry.status === 'done') saveRecord(entry);
  // saveQueueToStorage via saveCurrentGroupTabInputs handles the Sheets push —
  // no separate updateSheetsRow needed here.
  renderQueue();
  updateStats();
  renderTurns();
}


// ── Turns Tab ─────────────────────────────────────
let turnsAssignTarget = null;
let turnsViewingHistory = null;
let turnsTechOrder = [];
let turnsHistory   = JSON.parse(localStorage.getItem('muse_turns_history') || '{}');

function saveTurnsHistory() { localStorage.setItem('muse_turns_history', JSON.stringify(turnsHistory)); }
function getActiveTurnsOrder() {
  // Return stored IDs as-is; renderTurnsTechGrid handles missing staff with a null check
  return turnsTechOrder.filter(id => id && typeof id === 'string');
}

function archiveTurnsForToday() {
  const today = todayStr();
  turnsHistory[today] = {
    order: [...turnsTechOrder],
    snapshot: queue.map(e => ({
      id: String(e.id), name: e.name, phone: e.phone||'',
      services: e.services, assignments: e.assignments||[],
      totalCost: e.totalCost||0, status: e.status,
      checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
    }))
  };
  const keys = Object.keys(turnsHistory).sort().slice(-90);
  const pruned = {};
  keys.forEach(k => pruned[k] = turnsHistory[k]);
  turnsHistory = pruned;
  saveTurnsHistory();
  turnsTechOrder = [];
}

// Staff break status for turns tab (separate from schedule) — in-memory only
let turnsBreakStaff = [];
function saveTurnsBreak() { /* in-memory — no local write needed */ }

function cycleTechStatus(event, staffId) {
  event.stopPropagation();
  const isBreak = turnsBreakStaff.includes(staffId);
  if (isBreak) {
    turnsBreakStaff = turnsBreakStaff.filter(id => id !== staffId);
  } else {
    turnsBreakStaff.push(staffId);
  }
  saveTurnsBreak();
  renderTurnsTechGrid();
  const el = document.getElementById('turns-break-count');
  if (el) el.textContent = turnsBreakStaff.length;
}

function getTechStatusColor(staffId) {
  // Break takes priority — set from turns tab
  if (turnsOffStaff.includes(staffId))   return { bg: '#f3f4f6', text: '#9ca3af', label: 'Off' };
  if (turnsBreakStaff.includes(staffId)) return { bg: '#f5c870', text: '#3a2800', label: 'On Break' };
  const activeEntries = getActiveTechEntries(staffId);
  if (activeEntries.length > 0) return { bg: '#fa746f', text: '#fff', label: 'In Service' };
  return { bg: '#2a7a4f', text: '#fff', label: 'Available' };
}

function getActiveTechEntries(staffId) {
  // A tech is "in service" only when THEIR specific assignment is inservice — not done.
  // An entry with multiple services may have one tech done and another still working.
  return queue.filter(e =>
    e.status === 'inservice' &&
    (e.assignments||[]).some(a => a.techId === staffId && getAssignmentStatus(e, a) === 'inservice')
  );
}

// All assignments for a tech today — one entry per service assignment, ordered by ASSIGNMENT time (not checkin)
function getTechAllAssignments(techId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const result = [];
  queue.forEach(e => {
    const d = e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime);
    if (d < today) return;
    (e.assignments||[]).forEach(a => {
      if (a.techId !== techId) return;
      result.push({ entry: e, assignment: a });
    });
  });
  // Sort by assignedAt timestamp (set when assignment is saved), falling back to checkinTime
  result.sort((a, b) => {
    const ta = a.assignment.assignedAt || (a.entry.checkinTime instanceof Date ? a.entry.checkinTime.getTime() : new Date(a.entry.checkinTime).getTime());
    const tb = b.assignment.assignedAt || (b.entry.checkinTime instanceof Date ? b.entry.checkinTime.getTime() : new Date(b.entry.checkinTime).getTime());
    return ta - tb;
  });
  return result;
}



// ── Turn Suggestion Engine ────────────────────────────────────────
// Returns best tech suggestion for a given serviceId based on:
// 1. Turn order from turnsTechOrder
// 2. Who has fewest turns today
// 3. Only techs that can perform this service (from staff profile)
// 4. Only available techs (not on break, not currently in service)
function suggestTechForService(serviceId) {
  const order = getActiveTurnsOrder();
  if (order.length === 0) return null;

  const eligible = order.filter(id => {
    const st = STAFF.find(s => s.id === id);
    if (!st) return false;
    if (turnsBreakStaff.includes(id)) return false;
    if (turnsOffStaff.includes(id))   return false;
    if (st.services && st.services.length > 0) {
      if (!st.services.includes(serviceId)) return false;
    }
    return getActiveTechEntries(id).length === 0; // available only
  });

  if (eligible.length === 0) return null;

  // Fewest turns wins; turn-order position breaks ties
  let best = null;
  let bestTurns = Infinity;
  let bestOrderIdx = Infinity;

  eligible.forEach(id => {
    const turns = getTechTurns(id);
    const orderIdx = order.indexOf(id);
    if (turns.total < bestTurns || (turns.total === bestTurns && orderIdx < bestOrderIdx)) {
      best = id;
      bestTurns = turns.total;
      bestOrderIdx = orderIdx;
    }
  });

  if (!best) return null;
  const st = STAFF.find(s => s.id === best);
  return { techId: best, techName: st?.name || '?' };
}

// Build suggestion map for all waiting customers
// Returns { entryId: { serviceId: { techId, techName } } }
function buildSuggestions() {
  const suggestions = {};
  queue.filter(e => e.status !== 'done').forEach(e => {
    suggestions[e.id] = {};
    e.services.forEach(sid => {
      const a = (e.assignments || []).find(x => x.serviceId === sid);
      const svcStatus = a ? getAssignmentStatus(e, a) : 'waiting';
      if (svcStatus !== 'waiting') return; // only suggest for waiting services
      if (a && a.techId) return; // already assigned
      const suggestion = suggestTechForService(sid);
      if (suggestion) suggestions[e.id][sid] = suggestion;
    });
  });
  return suggestions;
}
function renderTurns() {
  renderTurnsTechGrid();
  renderTurnsQueue();
}

function renderTurnsTechGrid() {
  const grid = document.getElementById('turns-tech-grid');
  if (!grid) return;
  if (turnsViewingHistory) { renderTurnsHistoryView(); return; }

  const todayLabel = document.getElementById('turns-date-label');
  if (todayLabel) todayLabel.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const bc = document.getElementById('turns-break-count');
  if (bc) bc.textContent = turnsBreakStaff.length;

  const order = getActiveTurnsOrder();
  let activeCount = 0;

  if (order.length === 0) {
    grid.innerHTML = '<div class="text-sm font-body text-on-surface-variant py-8 text-center opacity-60"><span class="material-symbols-outlined text-4xl block mb-2">swap_vert</span>No technicians added today.<br>Click <strong>Technicians</strong> to set up the turn order.</div>';
    const el = document.getElementById('turns-active-count'); if (el) el.textContent = '0';
    return;
  }

  const rows = order.map(staffId => {
    const st = STAFF.find(s => s.id === staffId);
    if (!st) return '<div class="flex items-center border-b border-surface-container-high py-1 px-3 gap-2 opacity-40 text-xs text-outline italic">Staff not found (' + staffId.slice(0,10) + ')</div>';

    const turns = getTechTurns(staffId);
    const allAssign = getTechAllAssignments(staffId);
    if (allAssign.some(a => getAssignmentStatus(a.entry, a.assignment) === 'inservice')) activeCount++;
    const statusColor = getTechStatusColor(staffId);

    const photo = st.photo
      ? '<img src="' + st.photo + '" class="w-10 h-10 rounded-full object-cover border-2 flex-shrink-0" style="border-color:' + statusColor.bg + '">'
      : '<div class="w-10 h-10 rounded-full flex items-center justify-center border-2 flex-shrink-0 text-sm font-headline font-bold" style="background:' + statusColor.bg + '20;border-color:' + statusColor.bg + ';color:' + statusColor.bg + '">' + st.name.charAt(0).toUpperCase() + '</div>';

    // Turn counter — larger, highlight yellow if half turn
    const isHalfTurn = !Number.isInteger(turns.total) && turns.total > 0;
    const turnDisplay = turns.total > 0
      ? '<span class="text-sm font-headline font-bold ' + (isHalfTurn ? 'px-1.5 py-0.5 rounded-md' : '') + '" style="' + (isHalfTurn ? 'background:#f5c870;color:#3a2800' : 'color:' + statusColor.bg) + '">' + turns.total + 't</span>'
      : '<span class="text-sm font-headline text-outline-variant">0t</span>';

    const techCol = '<div class="flex items-center gap-2 w-[155px] flex-shrink-0 pr-2">' +
      '<button onclick="showTechStatusMenu(event,\'' + staffId + '\')" class="focus:outline-none flex-shrink-0">' + photo + '</button>' +
      '<div class="min-w-0">' +
      '<div class="font-headline font-semibold text-on-surface text-sm truncate leading-tight">' + st.name + '</div>' +
      '<div class="flex items-center gap-1.5 mt-0.5">' +
      '<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-none" style="background:' + statusColor.bg + ';color:' + statusColor.text + '">' + statusColor.label + '</span>' +
      turnDisplay +
      (turns.bonus > 0 ? '<span class="text-[10px] text-secondary">+' + turns.bonus + 'b</span>' : '') +
      '</div></div></div>';

    const MIN_SLOTS = 5;
    const totalSlots = Math.max(MIN_SLOTS, allAssign.length + 1);
    let turnCounter = 0;

    const slotHtml = Array.from({length: totalSlots}, (_, slotIdx) => {
      const item = allAssign[slotIdx];
      if (item) {
        const { entry: e, assignment: a } = item;
        const cost = a.cost || 0;
        const _tt = classifyTurn(cost, a.serviceId||'');
        const isFull = _tt==='full'; const isHalf = _tt==='half'; const isBonus = _tt==='bonus';
        if (isFull) turnCounter += 1; else if (isHalf) turnCounter += 0.5;
        const turnLabelNum = Number.isInteger(turnCounter) ? turnCounter : turnCounter.toFixed(1);
        const turnLabel = isBonus ? 'Bonus' : (cost === 0 ? '?' : '' + turnLabelNum);

        const svcStatus = getAssignmentStatus(e, a);
        let bg, fg;
        if (svcStatus === 'done')        { bg='#dde2e5'; fg='#555'; }
        else if (svcStatus === 'inservice') { bg='#c8e6c5'; fg='#1b5e20'; }
        else                             { bg='#ffe0b2'; fg='#6d3200'; }

        const outlineStyle = e.groupId ? ';outline:2px solid ' + (e.groupColor||'#e8a230') + ';outline-offset:-1px' : '';
        const svc = SERVICES.find(s => s.id === a.serviceId);
        const svcLabel = svc ? svc.label : (e.services.map(sid=>{const sv=SERVICES.find(s=>s.id===sid);return sv?sv.label:'?';}).join(', '));
        const station = a.station || '';
        const costStr = a.cost ? '$' + Number(a.cost).toFixed(0) : '';
        const t = e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime);
        const timeStr = t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        const groupDot = e.groupId ? '<span class="inline-block w-1.5 h-1.5 rounded-full mr-0.5 flex-shrink-0" style="background:'+(e.groupColor||'#888')+'"></span>' : '';

        return '<div class="flex-shrink-0 w-[150px] px-1 turns-filled-slot" data-entry-id="'+e.id+'" data-tech-id="'+staffId+'" data-slot="'+slotIdx+'">' +
          '<button onclick="showGroupAssignModal(\''+e.id+'\')" class="w-full rounded-xl px-2 py-1.5 text-left active:scale-95 transition-all text-xs font-body" style="background:'+bg+';color:'+fg+';min-height:66px'+outlineStyle+'">' +
          '<div class="flex items-center justify-between gap-0.5 mb-0.5">' +
            '<div class="flex items-center gap-0.5 min-w-0">'+groupDot+'<span class="font-semibold text-[11px] truncate">'+e.name+'</span></div>' +
            (turnLabel ? '<span class="text-[11px] font-headline font-bold flex-shrink-0 ml-1" style="opacity:0.75">'+turnLabel+'</span>' : '') +
          '</div>' +
          '<div class="text-[10px] opacity-90 leading-tight">'+svcLabel+(station?' · '+station:'')+(costStr?' · '+costStr:'')+'</div>' +
          '<div class="text-[9px] opacity-60">'+timeStr+'</div>' +
          '</button></div>';
      } else {
        return '<div class="flex-shrink-0 w-[150px] px-1 turns-drop-zone" data-tech-id="'+staffId+'" data-slot="'+slotIdx+'">' +
          '<div class="turns-empty-slot w-full rounded-xl border-2 border-dashed border-outline-variant/40 flex items-center justify-center text-outline-variant cursor-pointer hover:border-primary hover:bg-primary/5 hover:text-primary transition-all" style="min-height:66px" onclick="openTurnsAssign(\''+staffId+'\','+slotIdx+')">' +
          '<span class="material-symbols-outlined" style="font-size:20px">add</span></div></div>';
      }
    }).join('');

    return '<div class="flex items-center border-b border-surface-container-high py-2 gap-2">' +
      techCol +
      '<div class="turns-slot-row flex gap-1.5 overflow-x-auto pb-0.5" style="min-width:0;flex:1;scrollbar-width:thin">' +
      slotHtml + '</div></div>';
  }).filter(Boolean).join('');

  grid.innerHTML = rows || '<div class="text-sm text-on-surface-variant py-4 text-center">No active technicians.</div>';
  const el = document.getElementById('turns-active-count'); if (el) el.textContent = activeCount;

  grid.querySelectorAll('.turns-slot-row').forEach(row => {
    row.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && row.scrollWidth > row.clientWidth) {
        row.scrollLeft += e.deltaY; e.preventDefault();
      }
    }, {passive:false});
  });

  setupTurnsDragDrop();
}

function renderTurnsQueue() {
  const waitingList = document.getElementById('turns-waiting-list');
  const activeList  = document.getElementById('turns-active-list');
  if (!waitingList || !activeList) return;

  const waiting   = queue.filter(e => {
    if (e.status === 'done') return false;
    if (!e.assignments || e.assignments.length === 0) return e.status === 'waiting';
    return e.assignments.some(a => getAssignmentStatus(e, a) === 'waiting');
  });
  const inservice = queue.filter(e => {
    if (!e.assignments || e.assignments.length === 0) return e.status === 'inservice';
    return e.assignments.some(a => getAssignmentStatus(e, a) === 'inservice');
  });

  const wLabel = document.getElementById('turns-waiting-label');
  const aLabel = document.getElementById('turns-active-label');
  if (wLabel) wLabel.textContent = waiting.length + ' in queue';
  if (aLabel) aLabel.textContent = inservice.length + ' in service';

  // Build suggestion map for waiting customers
  const suggestions = buildSuggestions();

  function buildCard(e, draggable) {
    const t = e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime);
    const timeStr = t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const groupDot = e.groupId ? '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:'+(e.groupColor||'')+'"></span>' : '';
    const groupLbl = e.groupLabel ? '<span class="text-[10px] font-body italic ml-0.5" style="color:'+(e.groupColor||'#888')+'">'+e.groupLabel+'</span>' : '';
    const avatar = e.groupId
      ? '<div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-headline font-bold" style="background:'+e.groupColor+'20;color:'+e.groupColor+';border:2px solid '+e.groupColor+'">'+e.name.charAt(0).toUpperCase()+'</div>'
      : '<div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0"><span class="text-xs font-headline font-bold text-primary">'+e.name.charAt(0).toUpperCase()+'</span></div>';

    // Assignment / suggestion info
    const assignments = (e.assignments||[]).filter(a => a.techId || a.serviceId);
    const entrySuggestions = suggestions[e.id] || {};
    let serviceContent;
    if (assignments.length > 0) {
      serviceContent = assignments.map(a => {
        const tech = STAFF.find(s=>s.id===a.techId);
        const svc  = SERVICES.find(s=>s.id===a.serviceId);
        const svcStatus = getAssignmentStatus(e, a);
        const dot = svcStatus==='done'?'✓ ':svcStatus==='inservice'?'● ':'○ ';
        const parts = [dot + (svc?svc.label:'')];
        if (tech) parts.push('→ '+tech.name);
        else if (entrySuggestions[a.serviceId]) parts.push('→ '+entrySuggestions[a.serviceId].techName+'?');
        if (a.cost) parts.push('$'+a.cost);
        return '<div class="text-[10px] text-on-surface-variant leading-tight">'+parts.join(' ')+'</div>';
      }).join('');
    } else {
      // No assignments yet — show services with suggestions
      serviceContent = e.services.map(sid => {
        const svc = SERVICES.find(s=>s.id===sid);
        const sug = entrySuggestions[sid];
        return '<div class="text-[10px] text-on-surface-variant leading-tight">○ '+(svc?svc.label:sid)+(sug?' <span class="font-semibold" style="color:#1a5252">→ '+sug.techName+'?</span>':'')+'</div>';
      }).join('');
    }

    const borderColor = e.status==='inservice' ? '#2a7a4f' : '#d4860a';
    const bgTint      = e.status==='inservice' ? 'rgba(200,230,197,0.25)' : 'rgba(255,224,178,0.25)';
    return '<div class="px-3 py-2 '+(draggable?'cursor-grab ':'cursor-pointer ')+'hover:brightness-95 transition-all select-none border-b border-surface-container-high border-l-4" style="border-left-color:'+borderColor+';background:'+bgTint+'" data-entry-id="'+e.id+'" onclick="showGroupAssignModal(\''+e.id+'\')">' +
      '<div class="flex items-start gap-2 pointer-events-none">' + avatar +
      '<div class="min-w-0 flex-grow">' +
      '<div class="flex items-center gap-1 flex-wrap leading-tight">' + groupDot +
      '<span class="font-headline font-semibold text-on-surface text-sm">'+e.name+'</span>' + groupLbl +
      '<span class="text-[10px] font-body text-on-surface-variant ml-1">'+timeStr+'</span></div>' +
      serviceContent +
      '</div></div></div>';
  }

  waitingList.innerHTML = waiting.length === 0
    ? '<div class="px-4 py-3 text-xs text-on-surface-variant text-center">No one waiting</div>'
    : waiting.map(e => buildCard(e, true)).join('');

  activeList.innerHTML = inservice.length === 0
    ? '<div class="px-4 py-3 text-xs text-on-surface-variant text-center">No one in service</div>'
    : inservice.map(e => buildCard(e, true)).join('');

  setupTurnsDragDrop();
}



function reorderTurnSlots(techId, moveEntryId, beforeEntryId) {
  const allAssign = getTechAllAssignments(techId);
  const moveItem   = allAssign.find(a => String(a.entry.id) === String(moveEntryId));
  const beforeItem = allAssign.find(a => String(a.entry.id) === String(beforeEntryId));
  if (!moveItem || !beforeItem) return;

  // Remove moveItem, reinsert before beforeItem
  const reordered = allAssign.filter(a => String(a.entry.id) !== String(moveEntryId));
  const idx = reordered.findIndex(a => String(a.entry.id) === String(beforeEntryId));
  reordered.splice(idx, 0, moveItem);

  // Re-stamp assignedAt in new order (1ms apart so sort is stable)
  const base = Date.now();
  reordered.forEach((item, i) => { item.assignment.assignedAt = base + i; });

  pushUndo('Reorder turns for ' + (STAFF.find(s=>s.id===techId)?.name||'tech'));
  saveQueueToStorage();
  scheduleSheetsSave();
  renderTurns();
  showToast('Turn order updated ✓');
}

function openTurnsAssign(techId, slotIndex) {
  turnsAssignTarget = { techId, slotIndex };
  const tech = STAFF.find(s => s.id === techId);
  document.getElementById('turns-assign-label').textContent = `Assign to ${tech?.name || ''}`;

  // Build list of { entry, serviceId, svcLabel } for every waiting service
  // that is not already assigned to this tech
  const options = [];
  queue.forEach(e => {
    if (e.status === 'done') return;
    e.services.forEach(sid => {
      const a = (e.assignments || []).find(x => x.serviceId === sid);
      const svcStatus = a ? getAssignmentStatus(e, a) : 'waiting';
      // Show if waiting AND not already assigned to this exact tech for this service
      if (svcStatus !== 'waiting') return;
      if (a && a.techId === techId) return; // already with this tech
      const svc = SERVICES.find(s => s.id === sid);
      options.push({ entry: e, serviceId: sid, svcLabel: svc ? svc.label : sid });
    });
  });

  const list = document.getElementById('turns-assign-list');
  if (options.length === 0) {
    list.innerHTML = '<div class="text-sm font-body text-on-surface-variant text-center py-4">No waiting services to assign</div>';
  } else {
    // Group by customer name for readability
    const byCustomer = {};
    options.forEach(o => {
      const key = String(o.entry.id);
      if (!byCustomer[key]) byCustomer[key] = { entry: o.entry, svcs: [] };
      byCustomer[key].svcs.push({ serviceId: o.serviceId, svcLabel: o.svcLabel });
    });

    list.innerHTML = Object.values(byCustomer).map(({ entry: e, svcs }) => {
      const t = e.checkinTime instanceof Date ? e.checkinTime : new Date(e.checkinTime);
      const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const svcButtons = svcs.map(({ serviceId, svcLabel }) => `
        <button onclick="assignServiceFromTurns('${e.id}','${serviceId}')"
          class="w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors text-left border-t border-surface-container-high">
          <div class="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"></div>
          <div class="min-w-0">
            <span class="text-sm font-body font-semibold text-on-surface">${svcLabel}</span>
          </div>
        </button>`).join('');
      return `
        <div class="border border-surface-container-high rounded-xl mb-2 overflow-hidden">
          <div class="px-4 py-2 bg-surface-container flex items-center justify-between">
            <span class="font-headline font-semibold text-on-surface text-sm">${e.name}</span>
            <span class="text-[11px] font-body text-on-surface-variant">${timeStr}</span>
          </div>
          ${svcButtons}
        </div>`;
    }).join('');
  }

  document.getElementById('turns-assign-modal').classList.remove('hidden');
  document.getElementById('turns-assign-modal').style.display = 'flex';
}

function assignServiceFromTurns(entryId, serviceId) {
  const techId = turnsAssignTarget?.techId;
  closeTurnsAssignModal();
  showGroupAssignModal(entryId);

  setTimeout(() => {
    const tabIdx = groupAssignEntries.indexOf(String(entryId));
    if (tabIdx > 0) switchGroupTab(tabIdx);

    setTimeout(() => {
      // Find the service row for this specific service and set ONLY that tech dropdown
      const rows = document.querySelectorAll('#group-assign-content [data-service-id]');
      rows.forEach(row => {
        if (row.dataset.serviceId === serviceId) {
          // Pre-select the tech that owns this slot
          const techSelect = row.querySelector('.assign-tech');
          if (techSelect && techId) techSelect.value = techId;
          // Highlight and scroll to the row
          row.style.outline = '2px solid #1a5252';
          row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          setTimeout(() => { row.style.outline = ''; }, 1500);
          updateGroupTotal();
        }
      });
    }, 100);
  }, 200);
}

function closeTurnsAssignModal() {
  document.getElementById('turns-assign-modal').classList.add('hidden');
  document.getElementById('turns-assign-modal').style.display = '';
}

function assignFromTurns(entryId) {
  closeTurnsAssignModal();
  showGroupAssignModal(entryId);
  setTimeout(() => {
    const tabIdx = groupAssignEntries.indexOf(String(entryId));
    if (tabIdx > 0) switchGroupTab(tabIdx);
    // Do NOT prefill tech — user assigns manually
  }, 200);
}


// ── Tech Status Menu ──────────────────────────────
let _techStatusMenuId = null;

function showTechStatusMenu(event, staffId) {
  event.stopPropagation();
  const menu2 = document.getElementById('tech-status-menu');
  if (_techStatusMenuId === staffId && menu2 && !menu2.classList.contains('hidden')) { closeTechStatusMenu(); return; }
  _techStatusMenuId = staffId;
  const st = STAFF.find(s => s.id === staffId);
  const menu = document.getElementById('tech-status-menu');
  if (!menu || !st) return;
  document.getElementById('tech-status-menu-name').textContent = st.name;
  const isBreak = turnsBreakStaff.includes(staffId);
  document.getElementById('tsm-available').style.opacity = isBreak ? '0.4' : '1';
  document.getElementById('tsm-break').style.opacity    = isBreak ? '1'   : '0.4';
  // Services from staff profile (which services this tech CAN perform)
  const profileSvcs = (st.services && st.services.length > 0)
    ? st.services.map(sid => { const svc = SERVICES.find(s=>s.id===sid); return svc ? svc.label : null; }).filter(Boolean)
    : SERVICES.map(s => s.label); // if none set, show all
  const svcList = document.getElementById('tech-status-menu-services');
  svcList.innerHTML = profileSvcs.length > 0
    ? profileSvcs.map(label => '<div>' + label + '</div>').join('')
    : '<div class="italic text-outline">No services configured</div>';
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - 290) + 'px';
  menu.style.top  = (rect.bottom + 8) + 'px';
  menu.classList.remove('hidden');
  setTimeout(() => document.addEventListener('click', closeTechStatusMenu, {once:true}), 10);
}

function closeTechStatusMenu() {
  document.getElementById('tech-status-menu')?.classList.add('hidden');
  _techStatusMenuId = null;
}

function setTechBreak(isBreak) {
  if (!_techStatusMenuId) return;
  const staffId = _techStatusMenuId;
  if (isBreak && !turnsBreakStaff.includes(staffId)) turnsBreakStaff.push(staffId);
  else if (!isBreak) turnsBreakStaff = turnsBreakStaff.filter(id => id !== staffId);
  // Remove from off if setting break/available
  turnsOffStaff = turnsOffStaff.filter(id => id !== staffId);
  saveTurnsBreak(); saveTurnsOff();
  closeTechStatusMenu();
  renderTurnsTechGrid();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}

function setTechOff() {
  if (!_techStatusMenuId) return;
  const staffId = _techStatusMenuId;
  toggleTurnsOffStaff(staffId);
  closeTechStatusMenu();
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
}


// ── Undo Stack ────────────────────────────────────
const undoStack = [];

function pushUndo(description) {
  const snapshot = queue.map(e => ({
    ...e,
    checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
  }));
  undoStack.push({ description, snapshot });
  if (undoStack.length > 20) undoStack.shift();
}

function performUndo() {
  if (!undoStack.length) { showToast('Nothing to undo'); return; }
  const { description, snapshot } = undoStack.pop();
  queue = snapshot.map(e => ({ ...e, checkinTime: new Date(e.checkinTime) }));
  renderQueue(); updateStats(); renderTurns();
  showToast('Undone: ' + description);
}


// ── Updated setupTurnsDragDrop — includes filled slots ──

// ── Drag & Drop — event delegation (no per-element cloning) ────
// One pointerdown listener on the grid container handles everything.
// This avoids the cloneNode/re-registration bugs.

(function initTurnsDrag() {
  let dragEntryId    = null;
  let dragTechId     = null;
  let dragClone      = null;
  let isDragging     = false;
  const DRAG_THRESH  = 6; // pixels of movement before drag starts
  let startX = 0, startY = 0;
  let pendingEntry = null, pendingTech = null;

  function getTarget(e, selector) {
    let el = e.target;
    while (el && el !== document.body) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function startDrag(card, clientX, clientY) {
    isDragging  = true;
    dragEntryId = card.dataset.entryId;
    dragTechId  = card.dataset.techId || null;
    const rect  = card.getBoundingClientRect();
    dragClone   = card.cloneNode(true);
    dragClone.style.cssText = [
      'position:fixed',
      'left:' + rect.left + 'px',
      'top:' + rect.top + 'px',
      'width:' + rect.width + 'px',
      'opacity:0.92',
      'pointer-events:none',
      'z-index:9999',
      'border-radius:12px',
      'box-shadow:0 14px 44px rgba(0,0,0,0.28)',
      'transform:rotate(1.5deg) scale(1.03)',
      'transition:none',
      'background:white',
    ].join(';');
    document.body.appendChild(dragClone);
    card.style.opacity   = '0.2';
    card.style.transform = 'scale(0.97)';
  }

  function endDrag(e) {
    if (!isDragging) { pendingEntry = null; pendingTech = null; return; }
    isDragging = false;
    if (dragClone) { dragClone.remove(); dragClone = null; }

    // Reset source card appearance
    document.querySelectorAll('#turns-waiting-list [data-entry-id], #turns-active-list [data-entry-id], .turns-filled-slot').forEach(c => {
      c.style.opacity = ''; c.style.transform = '';
    });
    document.querySelectorAll('.turns-empty-slot').forEach(s => s.classList.remove('turns-drop-highlight'));

    const capturedId  = dragEntryId;
    const capturedTech = dragTechId;
    dragEntryId = null; dragTechId = null;
    pendingEntry = null; pendingTech = null;
    if (!capturedId) return;

    // Find what we dropped onto
    const pt = document.elementFromPoint(e.clientX, e.clientY);

    // 1. Same-tech reorder: dropped on a filled slot of the same tech
    const filledTarget = pt?.closest('.turns-filled-slot');
    if (filledTarget && filledTarget.dataset.techId === capturedTech && filledTarget.dataset.entryId !== capturedId) {
      const targetEntryId = filledTarget.dataset.entryId;
      showWarnModal('Reorder turns?', 'Move this customer before the selected slot? All other turns shift accordingly.',
        () => reorderTurnSlots(capturedTech, capturedId, targetEntryId));
      return;
    }

    // 2. Empty drop zone
    const dropZone = pt?.closest('.turns-drop-zone');
    if (!dropZone) return;
    const targetTech = dropZone.dataset.techId;

    // 3. Move between techs (filled slot → different tech's empty)
    if (capturedTech && capturedTech !== targetTech) {
      const entry = queue.find(x => String(x.id) === String(capturedId));
      if (entry?.assignments) {
        pushUndo('Move ' + (entry.name||'customer') + ' between techs');
        entry.assignments.forEach(a => { if (a.techId === capturedTech) a.techId = targetTech; });
        updateSheetsRow(entry);
        renderQueue(); renderTurns();
        showToast('Moved to ' + (STAFF.find(s=>s.id===targetTech)?.name||'tech'));
      }
      return;
    }

    // 4. From waiting/active panel → open assign modal
    turnsAssignTarget = { techId: targetTech };
    showGroupAssignModal(capturedId);
    setTimeout(() => {
      const tabIdx = groupAssignEntries.indexOf(String(capturedId));
      if (tabIdx > 0) switchGroupTab(tabIdx);
      setTimeout(() => {
        document.querySelectorAll('#group-assign-content .assign-tech').forEach(sel => { if (!sel.value) sel.value = targetTech; });
        updateGroupTotal();
      }, 60);
    }, 200);
  }

  // Attach one listener to document — works for all current and future slots
  document.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    const card = getTarget(e, '.turns-filled-slot, #turns-waiting-list [data-entry-id], #turns-active-list [data-entry-id]');
    if (!card) return;
    // Don't start drag on buttons inside the card
    if (e.target.closest('button')) return;
    startX = e.clientX; startY = e.clientY;
    pendingEntry = card;
    pendingTech  = card.dataset.techId || null;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('pointermove', function(e) {
    if (isDragging && dragClone) {
      const w = parseFloat(dragClone.style.width);
      dragClone.style.left = (e.clientX - w/2) + 'px';
      dragClone.style.top  = (e.clientY - 30)  + 'px';
      // Highlight drop zones
      document.querySelectorAll('.turns-empty-slot').forEach(slot => {
        const r = slot.getBoundingClientRect();
        const over = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
        slot.classList.toggle('turns-drop-highlight', over);
      });
      return;
    }
    if (pendingEntry && !isDragging) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.sqrt(dx*dx+dy*dy) > DRAG_THRESH) {
        startDrag(pendingEntry, e.clientX, e.clientY);
      }
    }
  });

  document.addEventListener('pointerup', function(e) {
    if (isDragging) {
      endDrag(e);
    } else {
      pendingEntry = null; pendingTech = null;
    }
    isDragging = false;
  });

  document.addEventListener('pointercancel', function() {
    isDragging = false;
    if (dragClone) { dragClone.remove(); dragClone = null; }
    document.querySelectorAll('.turns-filled-slot, #turns-waiting-list [data-entry-id], #turns-active-list [data-entry-id]').forEach(c => {
      c.style.opacity=''; c.style.transform='';
    });
    document.querySelectorAll('.turns-empty-slot').forEach(s => s.classList.remove('turns-drop-highlight'));
    pendingEntry = null; pendingTech = null;
    dragEntryId = null; dragTechId = null;
  });
})();

function setupTurnsDragDrop() { /* no-op — drag handled by event delegation above */ }


// ── Turns: "Off" status ───────────────────────────
let turnsOffStaff = [];
function saveTurnsOff() { /* in-memory — no local write needed */ }

function toggleTurnsOffStaff(staffId) {
  if (turnsOffStaff.includes(staffId)) {
    turnsOffStaff = turnsOffStaff.filter(id => id !== staffId);
  } else {
    turnsOffStaff.push(staffId);
    // Remove from break if they go off
    turnsBreakStaff = turnsBreakStaff.filter(id => id !== staffId);
    saveTurnsBreak();
  }
  saveTurnsOff();
  renderTurns();
}


// ── Turns: Save & Sync button handler ─────────────
function saveTurnsAndSync() {
  renderTurns();
  _configWriteTime = Date.now();
  pushConfigToSheets();
  showToast('Turns saved & synced ✓');
}
let _taskLists     = [];
let _currentListId = null;

async function loadTaskLists() {
  try {
    const res = await gapi.client.tasks.tasklists.list({ maxResults: 20 });
    _taskLists = res.result.items || [];
    const sel = document.getElementById('tasks-list-select');
    if (!sel) return;
    sel.innerHTML = _taskLists.map(l => `<option value="${l.id}">${l.title}</option>`).join('');
    if (_taskLists.length > 0) {
      _currentListId = _taskLists[0].id;
      loadTasksForList(_currentListId);
    }
    const panel = document.getElementById('cal-tasks-panel');
    if (panel) { panel.classList.remove('hidden'); panel.style.display = 'flex'; }
  } catch(e) { console.warn('[Tasks] loadTaskLists failed:', e); }
}

async function loadTasksForList(listId) {
  if (!listId) return;
  _currentListId = listId;
  const container = document.getElementById('tasks-list');
  if (!container) return;
  container.innerHTML = '<div class="text-xs text-on-surface-variant text-center py-4">Loading…</div>';
  try {
    const res = await gapi.client.tasks.tasks.list({
      tasklist: listId, showCompleted: true, showHidden: false, maxResults: 100,
    });
    const tasks = (res.result.items || []).sort((a,b) => {
      const ad = a.status === 'completed' ? 1 : 0;
      const bd = b.status === 'completed' ? 1 : 0;
      return ad - bd;
    });
    renderTasks(tasks);
  } catch(e) {
    container.innerHTML = '<div class="text-xs text-error text-center py-4">Failed to load tasks</div>';
  }
}

function renderTasks(tasks) {
  const container = document.getElementById('tasks-list');
  if (!container) return;
  if (!tasks.length) {
    container.innerHTML = '<div class="text-xs text-on-surface-variant text-center py-6 opacity-60">No tasks — all caught up!</div>';
    return;
  }
  container.innerHTML = tasks.map(t => {
    const done    = t.status === 'completed';
    const due     = t.due ? new Date(t.due) : null;
    const dueStr  = due ? due.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
    const overdue = due && due < new Date() && !done;
    const lid     = _currentListId;
    return `<div class="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container transition-colors group">
      <button onclick="toggleTask('${lid}','${t.id}','${done?'needsAction':'completed'}')"
        class="flex-shrink-0 transition-colors mt-0.5"
        style="width:16px;height:16px;min-width:16px;min-height:16px;aspect-ratio:1/1;border-radius:50%;border:2px solid ${done?'#1a5252':'#9ca3af'};
               background:${done?'#1a5252':'#ffffff'};display:flex;align-items:center;justify-content:center;padding:0;box-sizing:border-box">
        ${done?'<span class="material-symbols-outlined text-on-primary" style="font-size:9px;line-height:1;font-variation-settings:\'FILL\' 1">check</span>':''}
      </button>
      <div class="flex-1 min-w-0" style="line-height:1.3">
        <div class="text-xs font-body ${done?'line-through text-on-surface-variant opacity-50':'text-on-surface font-medium'}">${t.title||'(no title)'}</div>
        ${t.notes?`<div class="text-[10px] text-on-surface-variant truncate">${t.notes}</div>`:''}
        ${dueStr?`<div class="text-[10px] font-semibold ${overdue?'text-error':'text-on-surface-variant'}">${overdue?'⚠ ':''}${dueStr}</div>`:''}
      </div>
      <button onclick="deleteTask('${lid}','${t.id}')" class="opacity-0 group-hover:opacity-100 flex-shrink-0 text-outline-variant hover:text-error transition-all mt-0.5">
        <span class="material-symbols-outlined" style="font-size:12px">close</span>
      </button>
    </div>`;
  }).join('');
}

let _tasksMinimized = false;
function toggleTasksPanel() {
  _tasksMinimized = !_tasksMinimized;
  const panel = document.getElementById('cal-tasks-panel');
  const btn   = document.getElementById('tasks-minimize-btn');
  const body  = document.getElementById('tasks-list');
  const selWrap = document.getElementById('tasks-list-select')?.parentElement;
  if (panel) {
    panel.style.width = _tasksMinimized ? '40px' : '260px';
    panel.style.overflow = 'hidden';
    if (body) body.style.display = _tasksMinimized ? 'none' : '';
    if (selWrap) selWrap.style.display = _tasksMinimized ? 'none' : '';
    // Hide title text but keep header row for the button
    const titleEl = panel.querySelector('.font-headline.font-bold.text-on-surface.text-sm');
    if (titleEl) titleEl.style.display = _tasksMinimized ? 'none' : '';
    const iconEl = panel.querySelector('.material-symbols-outlined.text-primary');
    if (iconEl) iconEl.style.display = _tasksMinimized ? 'none' : '';
    const addBtn = panel.querySelector('button[title="Add task"]');
    if (addBtn) addBtn.style.display = _tasksMinimized ? 'none' : '';
  }
  if (btn) {
    btn.querySelector('.material-symbols-outlined').textContent = _tasksMinimized ? 'chevron_left' : 'chevron_right';
    btn.title = _tasksMinimized ? 'Show Tasks' : 'Hide Tasks';
  }
}

async function toggleTask(listId, taskId, newStatus) {
  try {
    await gapi.client.tasks.tasks.patch({
      tasklist: listId, task: taskId,
      resource: { status: newStatus, completed: newStatus==='completed' ? new Date().toISOString() : null },
    });
    loadTasksForList(listId);
  } catch(e) { showToast('Could not update task'); }
}

async function deleteTask(listId, taskId) {
  try {
    await gapi.client.tasks.tasks.delete({ tasklist: listId, task: taskId });
    loadTasksForList(listId);
  } catch(e) { showToast('Could not delete task'); }
}

function showAddTaskModal() {
  const title = prompt('New task title:');
  if (!title?.trim() || !_currentListId) return;
  gapi.client.tasks.tasks.insert({ tasklist: _currentListId, resource: { title: title.trim() } })
    .then(() => loadTasksForList(_currentListId))
    .catch(() => showToast('Could not add task'));
}


