// ── Gift Cards ────────────────────────────────────
let giftCards = [];

function saveGiftCardsToStorage() { /* in-memory — gift cards synced to Sheets via exportGiftCardsSheets() */ }

function showDashPanelGiftCards() {
  renderGiftCards();
}

function showAddGiftCard() {
  document.getElementById('gc-modal-title').textContent = 'New Gift Card';
  document.getElementById('gc-edit-id').value = '';
  document.getElementById('gc-date').value = todayStr();
  document.getElementById('gc-serial').value = '';
  document.getElementById('gc-amount').value = '';
  document.getElementById('gc-phone').value = '';
  document.getElementById('gc-from').value = '';
  document.getElementById('gc-to').value = '';
  document.getElementById('gc-date-used').value = '';
  document.getElementById('gc-amount-used').value = '';
  document.getElementById('gc-notes').value = '';
  document.getElementById('gc-modal').classList.remove('hidden');
  document.getElementById('gc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('gc-serial').focus(), 100);
}

function showEditGiftCard(id) {
  const gc = giftCards.find(g => g.id === id);
  if (!gc) return;
  document.getElementById('gc-modal-title').textContent = 'Edit Gift Card';
  document.getElementById('gc-edit-id').value = id;
  document.getElementById('gc-date').value       = gc.datePurchased || '';
  document.getElementById('gc-serial').value     = gc.serial || '';
  document.getElementById('gc-amount').value     = gc.amount || '';
  document.getElementById('gc-phone').value      = gc.phone || '';
  document.getElementById('gc-from').value       = gc.from || '';
  document.getElementById('gc-to').value         = gc.to || '';
  document.getElementById('gc-date-used').value  = gc.dateUsed || '';
  document.getElementById('gc-amount-used').value = gc.amountUsed || '';
  document.getElementById('gc-notes').value      = gc.notes || '';
  document.getElementById('gc-modal').classList.remove('hidden');
  document.getElementById('gc-modal').style.display = 'flex';
}

function closeGcModal() {
  document.getElementById('gc-modal').classList.add('hidden');
  document.getElementById('gc-modal').style.display = '';
}

function saveGiftCard() {
  const editId = document.getElementById('gc-edit-id').value;
  const gc = {
    id:            editId || 'gc-' + Date.now(),
    datePurchased: document.getElementById('gc-date').value,
    serial:        document.getElementById('gc-serial').value.trim(),
    amount:        parseFloat(document.getElementById('gc-amount').value) || 0,
    phone:         document.getElementById('gc-phone').value.trim(),
    from:          document.getElementById('gc-from').value.trim(),
    to:            document.getElementById('gc-to').value.trim(),
    dateUsed:      document.getElementById('gc-date-used').value,
    amountUsed:    parseFloat(document.getElementById('gc-amount-used').value) || 0,
    notes:         document.getElementById('gc-notes').value.trim(),
    createdAt:     editId ? (giftCards.find(g=>g.id===editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
  };
  if (editId) {
    const idx = giftCards.findIndex(g => g.id === editId);
    if (idx >= 0) giftCards[idx] = gc; else giftCards.push(gc);
  } else {
    giftCards.push(gc);
  }
  saveGiftCardsToStorage();
  closeGcModal();
  renderGiftCards();
  exportGiftCardsSheets(); // auto-sync on save
  showToast(editId ? 'Gift card updated ✓' : 'Gift card added ✓');
}

function deleteGiftCard(id) {
  showWarnModal('Delete gift card?', 'This will permanently remove this gift card record.', () => {
    giftCards = giftCards.filter(g => g.id !== id);
    exportGiftCardsSheets();
    renderGiftCards();
    showToast('Gift card deleted');
  });
}

function renderGiftCards() {
  const list  = document.getElementById('gc-list');
  const empty = document.getElementById('gc-empty');
  if (!list) return;

  const q = (document.getElementById('gc-search')?.value || '').toLowerCase();
  let filtered = giftCards.filter(g =>
    !q || (g.serial||'').toLowerCase().includes(q) ||
    (g.from||'').toLowerCase().includes(q) ||
    (g.to||'').toLowerCase().includes(q) ||
    (g.phone||'').includes(q) ||
    (g.notes||'').toLowerCase().includes(q)
  );
  // Hide $0 balance cards if toggled
  if (_gcHideZero) filtered = filtered.filter(g => ((g.amount||0) - (g.amountUsed||0)) > 0);
  // Sort
  filtered.sort((a, b) => {
    let av, bv;
    if (_gcSortField === 'amount')       { av = a.amount||0; bv = b.amount||0; }
    else if (_gcSortField === 'balance') { av = (a.amount||0)-(a.amountUsed||0); bv = (b.amount||0)-(b.amountUsed||0); }
    else if (_gcSortField === 'serial')  { av = a.serial||''; bv = b.serial||''; }
    else if (_gcSortField === 'status')  {
      const order = { Active: 0, Partial: 1, Redeemed: 2 };
      const getS = g => { const bal = (g.amount||0)-(g.amountUsed||0); return bal<=0?'Redeemed':g.amountUsed>0?'Partial':'Active'; };
      av = order[getS(a)]??3; bv = order[getS(b)]??3;
    }
    else { av = a.datePurchased||''; bv = b.datePurchased||''; } // date
    if (av < bv) return _gcSortDir === 'asc' ? -1 : 1;
    if (av > bv) return _gcSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Summary
  const totalValue   = giftCards.reduce((s,g) => s + (g.amount||0), 0);
  const totalUsed    = giftCards.reduce((s,g) => s + (g.amountUsed||0), 0);
  const totalBalance = totalValue - totalUsed;
  const el = id => document.getElementById(id);
  if (el('gc-total-sold'))    el('gc-total-sold').textContent    = giftCards.length;
  if (el('gc-total-value'))   el('gc-total-value').textContent   = '$' + totalValue.toFixed(2);
  if (el('gc-total-used'))    el('gc-total-used').textContent    = '$' + totalUsed.toFixed(2);
  if (el('gc-total-balance')) el('gc-total-balance').textContent = '$' + totalBalance.toFixed(2);

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    document.getElementById('gc-headers')?.classList.add('hidden');
    return;
  }
  empty?.classList.add('hidden');
  document.getElementById('gc-headers')?.classList.remove('hidden');

  list.innerHTML = filtered.map(g => {
    const balance   = (g.amount||0) - (g.amountUsed||0);
    const isRedeemed = balance <= 0 && (g.dateUsed || g.amountUsed > 0);
    const isPartial  = g.amountUsed > 0 && balance > 0;
    const statusColor = isRedeemed
      ? { bg:'rgba(200,230,197,0.2)', border:'#2a7a4f', label:'Redeemed', lc:'#2a7a4f' }
      : isPartial
        ? { bg:'rgba(255,224,178,0.2)', border:'#d4860a', label:'Partial',   lc:'#a05000' }
        : { bg:'',                      border:'#c8d4d8', label:'Active',     lc:'#1a5252' };

    const formatDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : null;

    // Grid layout — fixed columns so all cards align
    return `
      <div class="rounded-xl border flex items-center gap-0 overflow-hidden" style="background:${statusColor.bg};border-color:${statusColor.border}">

        <!-- Amount bubble -->
        <div class="flex-shrink-0 flex items-center justify-center font-headline font-extrabold text-xl px-4 self-stretch"
          style="width:88px;background:${statusColor.border}22;border-right:1px solid ${statusColor.border}40;color:${statusColor.lc}">
          $${(g.amount||0).toFixed(0)}
        </div>

        <!-- Status badge — fixed width so columns align -->
        <div class="flex-shrink-0 flex items-center justify-center px-3" style="width:96px">
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style="background:${statusColor.border}20;color:${statusColor.lc}">${statusColor.label}</span>
        </div>

        <!-- Serial — fixed width -->
        <div class="flex-shrink-0 text-xs font-body font-semibold text-on-surface px-2" style="width:90px">${g.serial ? '#' + g.serial : '—'}</div>

        <!-- Date purchased — fixed width -->
        <div class="flex-shrink-0 text-xs font-body text-on-surface-variant px-2" style="width:96px">${g.datePurchased ? formatDate(g.datePurchased) : '—'}</div>

        <!-- From — fixed width -->
        <div class="flex-shrink-0 text-xs font-body px-2 truncate" style="width:110px">
          ${g.from ? `<span class="text-on-surface-variant">From: </span><span class="text-on-surface">${g.from}</span>` : '<span class="text-outline-variant">—</span>'}
        </div>

        <!-- To — fixed width -->
        <div class="flex-shrink-0 text-xs font-body px-2 truncate" style="width:110px">
          ${g.to ? `<span class="text-on-surface-variant">To: </span><span class="text-on-surface">${g.to}</span>` : '<span class="text-outline-variant">—</span>'}
        </div>

        <!-- Phone — fixed width -->
        <div class="flex-shrink-0 text-xs font-body text-on-surface-variant px-2" style="width:110px">${g.phone || '—'}</div>

        <!-- Notes — flex grow -->
        <div class="flex-grow min-w-0 text-xs font-body text-on-surface-variant italic truncate px-2">${g.notes || ''}</div>

        <!-- Balance — fixed width -->
        <div class="flex-shrink-0 text-right px-3 py-3" style="width:90px">
          <div class="text-[10px] text-on-surface-variant leading-none mb-0.5">Balance</div>
          <div class="text-base font-headline font-extrabold leading-none" style="color:${balance > 0 ? '#1a5252' : '#aaa'}">${'$' + balance.toFixed(2)}</div>
          ${g.amountUsed > 0 ? `<div class="text-[10px] text-on-surface-variant mt-0.5">$${(g.amountUsed).toFixed(2)} used</div>` : ''}
        </div>

        <!-- Action buttons -->
        <div class="flex-shrink-0 flex gap-1 px-2">
          <button onclick="showEditGiftCard('${g.id}')" title="Edit"
            class="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors active:scale-95">
            <span class="material-symbols-outlined" style="font-size:18px">edit</span>
          </button>
          <button onclick="deleteGiftCard('${g.id}')" title="Delete"
            class="w-9 h-9 rounded-xl bg-surface-container hover:bg-error/15 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors active:scale-95">
            <span class="material-symbols-outlined" style="font-size:18px">delete</span>
          </button>
        </div>
      </div>`;
  }).join('');
}

async function exportGiftCardsSheets() {
  try {
    const proxy = SHEETS_PROXY;
    await fetch(proxy, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveGiftCards', giftCards }),
    });
  } catch(e) { /* silent */ }
}


let _deleteTxnId     = null;
let _deleteTxnRecord = null;

function initiateDeleteTransaction(recordId) {
  if (!canDo('deleteTransaction')) { showToast('Permission denied'); return; }
  const fromRecords = allRecords.find(r => String(r.id) === String(recordId));
  const fromQueue   = queue.find(e => String(e.id) === String(recordId));
  _deleteTxnRecord  = fromRecords || (fromQueue ? {
    id: String(fromQueue.id), name: fromQueue.name,
    totalCost: fromQueue.totalCost || 0,
    checkinTime: fromQueue.checkinTime,
    status: fromQueue.status,
    services: fromQueue.services,
    assignments: fromQueue.assignments || [],
  } : null);
  if (!_deleteTxnRecord) { showToast('Record not found.'); return; }
  _deleteTxnId = String(recordId);
  const dt = new Date(_deleteTxnRecord.checkinTime);
  document.getElementById('del-txn-subtitle').textContent =
    `${_deleteTxnRecord.name} · ${dt.toLocaleDateString()} · $${(_deleteTxnRecord.totalCost||0).toFixed(2)}`;
  document.getElementById('del-txn-reason').value = '';
  document.getElementById('del-txn-step1').classList.remove('hidden');
  document.getElementById('del-txn-step2').classList.add('hidden');
  document.getElementById('delete-txn-modal').classList.remove('hidden');
  document.getElementById('delete-txn-modal').style.display = 'flex';
}

function deleteTxnStep2() {
  document.getElementById('del-txn-step1').classList.add('hidden');
  document.getElementById('del-txn-step2').classList.remove('hidden');
  setTimeout(() => document.getElementById('del-txn-reason').focus(), 100);
}

function closeDeleteTxnModal() {
  document.getElementById('delete-txn-modal').classList.add('hidden');
  document.getElementById('delete-txn-modal').style.display = '';
  _deleteTxnId = null; _deleteTxnRecord = null;
}

function confirmDeleteTransaction() {
  const reason = document.getElementById('del-txn-reason').value.trim();
  if (!reason) { showToast('Please enter a reason for deletion.'); return; }
  if (!_deleteTxnId) return;

  // Soft-delete: mark as 'deleted' in local records instead of removing
  const delIdx = allRecords.findIndex(r => String(r.id) === _deleteTxnId);
  if (delIdx >= 0) {
    allRecords[delIdx] = { ...allRecords[delIdx], status: 'deleted' };
  } else {
    // Record only in queue (today's customer) — add a deleted snapshot to allRecords
    const qEntry = queue.find(e => String(e.id) === _deleteTxnId);
    if (qEntry) {
      allRecords.push({
        id: String(qEntry.id), name: qEntry.name, phone: qEntry.phone || '',
        services: qEntry.services, assignments: qEntry.assignments || [],
        totalCost: qEntry.totalCost || 0,
        checkinTime: qEntry.checkinTime instanceof Date ? qEntry.checkinTime.toISOString() : qEntry.checkinTime,
        status: 'deleted', isAppointment: qEntry.isAppointment || false,
        loggedBy: activeUser?.name || '',
      });
    }
  }
  localStorage.setItem('muse_records', JSON.stringify(allRecords));

  // CRITICAL: also mark the queue entry itself as 'deleted' so it's filtered from
  // reports/transactions immediately and doesn't re-appear after the next poll sync.
  // The deleted entry stays in the queue array so other devices receive deletedIds
  // and mark it deleted on their end within the next 5s poll cycle.
  const qIdx = queue.findIndex(e => String(e.id) === _deleteTxnId);
  if (qIdx >= 0) queue[qIdx].status = 'deleted';

  // Save to deletion log
  const log = JSON.parse(localStorage.getItem('muse_deletion_log') || '[]');
  log.push({
    deletedAt: new Date().toISOString(),
    deletedBy: activeUser?.name || 'Unknown',
    recordId:  _deleteTxnId,
    name:      _deleteTxnRecord?.name || '',
    total:     _deleteTxnRecord?.totalCost || 0,
    checkinTime: _deleteTxnRecord?.checkinTime || '',
    reason,
  });
  localStorage.setItem('muse_deletion_log', JSON.stringify(log));

  // Push queue immediately (don't wait for debounce) so deletedIds propagates to
  // other devices on their next 5s poll — no stale re-appearance of deleted entries.
  saveQueueToStorage();
  pushQueueToSheets();

  // Push allRecords to Sheets so other devices see the deletion within 15s
  scheduleRecordsPush();

  // Write deletion to both Transaction Log AND Check-Ins tab in Sheets
  const proxy = SHEETS_PROXY;
  const delPayload = {
    entryId:   _deleteTxnId,
    name:      _deleteTxnRecord?.name || '',
    status:    'deleted',
    detail:    `DELETED by ${activeUser?.name||'Unknown'}: ${reason}`,
    loggedBy:  activeUser?.name || '',
    checkinTime: _deleteTxnRecord?.checkinTime || new Date().toISOString(),
    services:  (_deleteTxnRecord?.services||[]).map(sid => SERVICES.find(s=>s.id===sid)?.label||sid),
    total:     _deleteTxnRecord?.totalCost || 0,
  };
  // Update Transaction Log row
  fetch(proxy, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'update', ...delPayload }) }).catch(()=>{});
  // Update Check-Ins row status to deleted
  fetch(proxy, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'checkinRow', ...delPayload, isAppointment: _deleteTxnRecord?.isAppointment||false }) }).catch(()=>{});

  closeDeleteTxnModal();
  renderTransactions();
  renderQueue();
  runReport();
  showToast('Transaction deleted — reason logged ✓');
}

function exportAllData() {
  const permanentKeys = [
    'muse_records', 'muse_queue_archive', 'muse_turns_history',
    'muse_live_queue', 'muse_live_queue_date', 'muse_deletion_log',
  ];
  const backup = {
    exportedAt: new Date().toISOString(),
    appVersion: APP_NAME + '-' + APP_VERSION,
    data: {},
    photos: getAllPhotos(),
  };

  // Permanent keys from localStorage
  permanentKeys.forEach(key => {
    const val = localStorage.getItem(key);
    if (!val) return;
    try { backup.data[key] = JSON.parse(val); } catch(e) { backup.data[key] = val; }
  });

  // In-memory config vars
  if (STAFF.length)                           backup.data['muse_staff']               = STAFF;
  if (SERVICES.length)                        backup.data['muse_services']            = SERVICES;
  if (FRONT_DESK_USERS.length)                backup.data['muse_fd_users']            = FRONT_DESK_USERS;
  if (ITEMS.length)                           backup.data['muse_items']               = ITEMS;
  if (FEES.length)                            backup.data['muse_fees']                = FEES;
  if (Object.keys(scheduleData).length)       backup.data['muse_schedule']            = scheduleData;
  if (turnsTechOrder.length)                  backup.data['muse_turns_order']         = turnsTechOrder;
  if (hiddenCheckinServices.length)           backup.data['muse_hidden_services']     = hiddenCheckinServices;
  if (inactiveStaff.length)                   backup.data['muse_inactive_staff']      = inactiveStaff;
  if (_logoData)                              backup.data['muse_logo']                = _logoData;

  // Square config still lives in localStorage (permanent key)
  const sqCfg = localStorage.getItem('muse_sq_config');
  if (sqCfg) { try { backup.data['muse_sq_config'] = JSON.parse(sqCfg); } catch(e) { backup.data['muse_sq_config'] = sqCfg; } }

  // In-memory queue
  backup.data['muse_live_queue'] = queue.map(e => ({
    ...e,
    checkinTime: e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
  }));

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = todayStr();
  a.href     = url;
  a.download = `muse-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  const now = new Date().toLocaleString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'});
  localStorage.setItem('muse_last_backup', now);
  const lbl = document.getElementById('last-backup-label');
  if (lbl) lbl.textContent = now;
  showToast('Backup downloaded ✓');
}

function importAllData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.data) { showToast('Invalid backup file.'); return; }

      const confirmImport = confirm(
        `Restore backup from ${backup.exportedAt?.slice(0,10) || 'unknown date'}?\n\n` +
        `This will REPLACE your current data with the backup.\n` +
        `Your current data will be overwritten.`
      );
      if (!confirmImport) return;

      const d = backup.data;

      // Restore permanent keys to localStorage
      ['muse_records','muse_queue_archive','muse_turns_history','muse_live_queue','muse_live_queue_date','muse_deletion_log'].forEach(key => {
        if (d[key] !== undefined) localStorage.setItem(key, typeof d[key] === 'string' ? d[key] : JSON.stringify(d[key]));
      });
      if (d.muse_sq_config !== undefined) localStorage.setItem('muse_sq_config', typeof d.muse_sq_config === 'string' ? d.muse_sq_config : JSON.stringify(d.muse_sq_config));

      // Restore in-memory config vars directly from backup
      if (d.muse_staff?.length)               STAFF                = d.muse_staff;
      if (d.muse_services?.length)            SERVICES             = dedupByLabel(d.muse_services);
      if (d.muse_fd_users?.length)            FRONT_DESK_USERS     = d.muse_fd_users;
      if (d.muse_items?.length)               ITEMS                = dedupByLabel(d.muse_items);
      if (d.muse_fees?.length)                FEES                 = dedupByLabel(d.muse_fees);
      if (d.muse_schedule)                    scheduleData         = d.muse_schedule;
      if (Array.isArray(d.muse_turns_order))  turnsTechOrder       = d.muse_turns_order;
      if (d.muse_hidden_services)             hiddenCheckinServices = d.muse_hidden_services;
      if (d.muse_inactive_staff)              inactiveStaff        = d.muse_inactive_staff;
      if (typeof d.muse_logo === 'string')    _logoData            = d.muse_logo;

      // Restore photos
      if (backup.photos) restorePhotos(backup.photos);

      // Reload transactional data
      allRecords = JSON.parse(localStorage.getItem('muse_records') || '[]');
      queue = loadQueueFromStorage();
      renderQueue();
      updateStats();
      renderTurns();
      setLogo();

      // Push restored config to Sheets
      _configWriteTime = Date.now();
      setTimeout(() => pushConfigToSheets(), 1000);

      showToast('Backup restored — reloading…');
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      showToast('Failed to read backup file.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// Show last backup date in settings when panel opens
function renderSettingsPanel() {
  renderSettingsServiceVisibility();
  renderSettingsDashServiceVisibility();
  renderSettingsActiveStaff();
  renderSettingsItems();
  renderSettingsFees();
  renderRolePermissions();
  initCalHoursSelectors();
  const lbl = document.getElementById('last-backup-label');
  if (lbl) lbl.textContent = localStorage.getItem('muse_last_backup') || 'Never';

  // Logo preview
  setLogo();

  // Square connection status
  const sqStatus = document.getElementById('settings-square-status');
  const sqInput  = document.getElementById('settings-location-id');
  if (sqStatus) sqStatus.textContent = squareConfig ? `✓ Connected — Location: ${squareConfig.locationId}` : 'Not connected';
  if (sqInput && squareConfig?.locationId) sqInput.value = squareConfig.locationId;

  // Turn thresholds
  const cfg = getTurnConfig();
  const fi = document.getElementById('thresh-full');
  const hi = document.getElementById('thresh-half');
  if (fi) fi.value = cfg.fullMin;
  if (hi) hi.value = cfg.halfMin;
  renderBonusServicesList();
}

function saveTurnThresholds() {
  const fullMin = parseInt(document.getElementById('thresh-full')?.value) || 28;
  const halfMin = parseInt(document.getElementById('thresh-half')?.value) || 12;
  if (halfMin >= fullMin) { showToast('Half min must be less than full min.'); return; }
  saveTurnConfig({ fullMin, halfMin });
  showToast('Turn thresholds saved ✓');
}

function renderBonusServicesList() {
  const el = document.getElementById('bonus-services-list');
  if (!el) return;
  el.innerHTML = SERVICES.map(s => {
    const isBonus = _bonusServices.includes(s.id);
    return `<label class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-surface-container transition-colors ${isBonus ? 'bg-primary/10 border border-primary/30' : 'border border-transparent'}">
      <input type="checkbox" class="w-4 h-4 accent-primary" ${isBonus ? 'checked' : ''} onchange="toggleBonusService('${s.id}', this.checked)">
      <span class="font-body font-semibold text-on-surface text-sm">${s.label}</span>
      <span class="text-[10px] font-body text-outline">${s.abbr}</span>
      ${isBonus ? '<span class="ml-auto text-[10px] font-semibold text-primary">Always Bonus</span>' : ''}
    </label>`;
  }).join('');
}

function toggleBonusService(serviceId, checked) {
  const ids = [..._bonusServices];
  if (checked && !ids.includes(serviceId)) ids.push(serviceId);
  else if (!checked) { const i = ids.indexOf(serviceId); if (i > -1) ids.splice(i,1); }
  saveBonusServices(ids);
  renderBonusServicesList();
  showToast(checked ? 'Marked as always bonus ✓' : 'Removed from always bonus');
}


// ── Refunds ────────────────────────────────────────
let _refundTxnId     = null;
let _refundTxnRecord = null;

function initiateRefund(recordId) {
  if (!canDo('refund')) { showToast('Permission denied'); return; }
  const rec = allRecords.find(r => String(r.id) === String(recordId));
  if (!rec) { showToast('Record not found.'); return; }
  if (rec.status === 'refund') { showToast('Cannot refund a refund.'); return; }
  _refundTxnId     = String(recordId);
  _refundTxnRecord = rec;

  const nameEl     = document.getElementById('refund-txn-name');
  const origEl     = document.getElementById('refund-txn-original');
  const amountEl   = document.getElementById('refund-amount');
  const reasonEl   = document.getElementById('refund-reason');
  if (nameEl)   nameEl.textContent   = rec.name;
  if (origEl)   origEl.textContent   = `$${(rec.totalCost||0).toFixed(2)}`;
  if (amountEl) amountEl.value       = (rec.totalCost||0).toFixed(2);
  if (reasonEl) reasonEl.value       = '';

  document.getElementById('refund-modal').classList.remove('hidden');
  document.getElementById('refund-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('refund-reason')?.focus(), 100);
}

function closeRefundModal() {
  document.getElementById('refund-modal').classList.add('hidden');
  document.getElementById('refund-modal').style.display = '';
  _refundTxnId = null;
  _refundTxnRecord = null;
}

function confirmRefund() {
  const reason      = document.getElementById('refund-reason').value.trim();
  const amountInput = parseFloat(document.getElementById('refund-amount').value) || 0;

  if (!reason)        { showToast('Please enter a reason for the refund.'); return; }
  if (amountInput <= 0)  { showToast('Refund amount must be greater than zero.'); return; }
  if (amountInput > (_refundTxnRecord?.totalCost || 0)) {
    showToast('Refund cannot exceed the original total.'); return;
  }

  const original = _refundTxnRecord;
  const refundId  = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  const now       = new Date().toISOString();

  const refundRecord = {
    id:            refundId,
    name:          original.name,
    phone:         original.phone || '',
    services:      original.services || [],
    assignments:   [],
    items:         [],
    fees:          [],
    discount:      0,
    discountNote:  reason,
    totalCost:     -amountInput,
    checkinTime:   now,
    completedAt:   now,
    status:        'refund',
    isAppointment: false,
    refundOf:      _refundTxnId,
    loggedBy:      activeUser?.name || '',
  };

  allRecords.push(refundRecord);
  localStorage.setItem('muse_records', JSON.stringify(allRecords));
  scheduleRecordsPush();

  // Write to Transaction Log in Sheets so the record appears in the history tab
  fetch(SHEETS_PROXY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action:      'append',
      entryId:     refundId,
      checkinTime: now,
      name:        original.name + ' (REFUND)',
      phone:       original.phone || '',
      services:    (original.services || []).map(sid => SERVICES.find(s => s.id === sid)?.label || sid).join(', '),
      type:        'Refund',
      status:      'refund',
      staff:       '',
      stations:    '',
      detail:      `REFUND by ${activeUser?.name || 'Unknown'}: ${reason}`,
      total:       -amountInput,
      loggedBy:    activeUser?.name || '',
    }),
  }).catch(() => {});

  closeRefundModal();
  renderTransactions();
  if (document.getElementById('panel-reports')?.classList.contains('active')) runReport();
  showToast(`Refund of $${amountInput.toFixed(2)} recorded ✓`);
}


// ── Gift Card Sort/Filter ─────────────────────────
let _gcSortField = 'datePurchased';
let _gcSortDir   = 'desc';
let _gcHideZero  = false;

function setGcSort(field) {
  if (_gcSortField === field) _gcSortDir = _gcSortDir === 'asc' ? 'desc' : 'asc';
  else { _gcSortField = field; _gcSortDir = field === 'datePurchased' ? 'desc' : 'asc'; }
  renderGiftCards();
}

function toggleGcHideZero() {
  _gcHideZero = !_gcHideZero;
  const btn = document.getElementById('gc-hide-zero-btn');
  if (btn) btn.textContent = _gcHideZero ? 'Show $0' : 'Hide $0';
  renderGiftCards();
}


