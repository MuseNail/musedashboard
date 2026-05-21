// ── Reports ───────────────────────────────────────
let reportRange = { type: 'today', from: null, to: null };
// In-memory historical records (persisted to localStorage)
let allRecords = JSON.parse(localStorage.getItem('muse_records') || '[]');

function saveRecord(entry) {
  // Called when status changes to 'done' — persist a snapshot
  const existing = allRecords.findIndex(r => String(r.id) === String(entry.id));
  const alreadySavedDone = existing >= 0 && allRecords[existing].status === 'done';

  // Ensure completedAt is set and persisted on the entry
  if (!entry.completedAt) entry.completedAt = new Date().toISOString();
  else if (entry.completedAt instanceof Date) entry.completedAt = entry.completedAt.toISOString();

  const snapshot = {
    id:            String(entry.id),
    name:          entry.name,
    phone:         entry.phone || '',
    services:      entry.services,
    assignments:   entry.assignments || [],
    items:         entry.items || [],
    fees:          entry.fees || [],
    discount:      entry.discount || 0,
    discountNote:  entry.discountNote || '',
    totalCost:     entry.totalCost || 0,
    checkinTime:   entry.checkinTime instanceof Date ? entry.checkinTime.toISOString() : entry.checkinTime,
    completedAt:   entry.completedAt,
    status:        entry.status,
    isAppointment: entry.isAppointment || false,
    loggedBy:      activeUser ? activeUser.name : '',
  };
  if (existing >= 0) allRecords[existing] = snapshot;
  else allRecords.push(snapshot);
  localStorage.setItem('muse_records', JSON.stringify(allRecords));

  // Event-driven push so other devices get the update within the next 15s poll.
  scheduleRecordsPush();

  // Only write Check-Ins row to Sheets on the FIRST time a record is saved as done.
  // Subsequent calls (e.g. re-pricing after done) update local state only.
  if (!alreadySavedDone) {
    sendCheckinRow(entry);
  }
}


// ── Shared record merge helper ────────────────────
// Combines live queue (done, non-deleted) with allRecords (historical).
// Queue entries take priority over allRecords for today's customers —
// they have the freshest totalCost and assignment data.
// Used by both runReport() and renderTransactions() to guarantee consistency.
function buildCombinedRecords() {
  const deletedIds = new Set(allRecords.filter(r => r.status === 'deleted').map(r => String(r.id)));
  const liveSnaps  = queue
    .filter(e => e.status === 'done' && !deletedIds.has(String(e.id)))
    .map(e => ({
      id:            String(e.id),
      name:          e.name,
      phone:         e.phone || '',
      services:      e.services,
      assignments:   e.assignments || [],
      items:         e.items || [],
      fees:          e.fees || [],
      discount:      e.discount || 0,
      discountNote:  e.discountNote || '',
      totalCost:     e.totalCost || 0,
      checkinTime:   e.checkinTime instanceof Date ? e.checkinTime.toISOString() : e.checkinTime,
      completedAt:   e.completedAt || null,
      status:        e.status,
      isAppointment: e.isAppointment || false,
    }));
  const liveIds = new Set(liveSnaps.map(r => String(r.id)));
  return [
    ...liveSnaps,
    ...allRecords.filter(r => !liveIds.has(String(r.id)) && r.status !== 'deleted'),
  ];
}


// ── Report Range ──────────────────────────────────
function setReportRange(type) {
  reportRange.type = type;
  document.querySelectorAll('.rng-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`rng-${type}`)?.classList.add('active');
  const customInputs = document.getElementById('custom-range-inputs');
  if (type === 'custom') {
    customInputs?.classList.remove('hidden');
    customInputs?.classList.add('grid');
    // Don't run report yet — wait for user to pick both dates
  } else {
    customInputs?.classList.add('hidden');
    customInputs?.classList.remove('grid');
    runReport();
  }
}

function getReportDates() {
  const now = new Date();
  let from, to;
  if (reportRange.type === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    to   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (reportRange.type === 'week') {
    // Week starts Monday (day 1); Sunday (0) treated as day 7 so it stays in the current week
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
    from = new Date(now); from.setDate(now.getDate() - day); from.setHours(0,0,0,0);
    to   = new Date(from); to.setDate(from.getDate() + 6); to.setHours(23,59,59,999);
  } else if (reportRange.type === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59);
  } else {
    const f = document.getElementById('report-from')?.value;
    const t = document.getElementById('report-to')?.value;
    if (!f || !t) return null;
    from = new Date(f + 'T00:00:00');
    to   = new Date(t + 'T23:59:59');
  }
  return { from, to };
}

function runReport() {
  const dates = getReportDates();
  if (!dates) return;
  const { from, to } = dates;

  // Use shared helper — guarantees same merge logic as renderTransactions()
  const combined = buildCombinedRecords();
  const filtered = combined.filter(r => {
    if (r.status === 'deleted') return false;
    const d = r.checkinTime instanceof Date ? r.checkinTime : new Date(r.checkinTime);
    return d >= from && d <= to && r.status === 'done';
  });

  // Totals — broken down by services, items, fees, discount
  const svcTotal      = filtered.reduce((s, r) => s + (r.assignments||[]).reduce((a, x) => a + (x.cost||0), 0), 0);
  const itemsTotal    = filtered.reduce((s, r) => s + (r.items||[]).reduce((a, x) => a + (x.price||0)*(x.qty||0), 0), 0);
  const feesTotal     = filtered.reduce((s, r) => s + (r.fees||[]).reduce((a, x) => a + (x.amount||0), 0), 0);
  const discountTotal = filtered.reduce((s, r) => s + (r.discount||0), 0);
  const totalIncome   = filtered.reduce((s, r) => s + (r.totalCost || 0), 0);
  const guestCount  = filtered.length;
  const avgTicket   = guestCount > 0 ? totalIncome / guestCount : 0;

  document.getElementById('rpt-total-income').textContent = `$${totalIncome.toFixed(2)}`;
  document.getElementById('rpt-total-guests').textContent = guestCount;
  document.getElementById('rpt-avg-ticket').textContent   = `$${avgTicket.toFixed(2)}`;
  const svcEl   = document.getElementById('rpt-svc-total');
  const itmEl   = document.getElementById('rpt-items-total');
  const feeEl   = document.getElementById('rpt-fees-total');
  const discEl  = document.getElementById('rpt-discount-total');
  if (svcEl)  svcEl.textContent   = `$${svcTotal.toFixed(2)}`;
  if (itmEl)  itmEl.textContent   = `$${itemsTotal.toFixed(2)}`;
  if (feeEl)  feeEl.textContent   = `$${feesTotal.toFixed(2)}`;
  if (discEl) discEl.textContent  = discountTotal > 0 ? `-$${discountTotal.toFixed(2)}` : '-$0.00';

  // Date label
  const fmt = d => d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  document.getElementById('report-range-label').textContent =
    `Showing: ${fmt(from)}${reportRange.type !== 'today' ? ' – ' + fmt(to) : ''}`;

  // Per-staff breakdown
  const staffMap = {};
  filtered.forEach(r => {
    (r.assignments || []).forEach(a => {
      if (!a.techId) return;
      if (!staffMap[a.techId]) staffMap[a.techId] = { income: 0, count: 0, fullTurns: 0, halfTurns: 0, bonusTurns: 0 };
      staffMap[a.techId].income += a.cost || 0;
      staffMap[a.techId].count++;
      const cost = a.cost || 0;
      const ttype = classifyTurn(cost, a.serviceId||'');
      if (ttype === 'full')       staffMap[a.techId].fullTurns  += 1;
      else if (ttype === 'half')  staffMap[a.techId].halfTurns  += 0.5;
      else                  staffMap[a.techId].bonusTurns += 1;
    });
  });
  const staffBreakdown = document.getElementById('rpt-staff-breakdown');
  const staffEntries = Object.entries(staffMap).sort((a,b) => b[1].income - a[1].income);

  // Compute totals for top summary cards
  const totalComm = staffEntries.reduce((sum, [techId, data]) => {
    const tech = STAFF.find(s => s.id === techId);
    if (tech?.commission != null) return sum + (data.income * tech.commission / 100);
    return sum;
  }, 0);
  const shopKeeps = totalIncome - totalComm;

  const shopEl  = document.getElementById('rpt-shop-keeps');
  const commEl  = document.getElementById('rpt-total-commission');
  if (shopEl)  shopEl.textContent  = `$${shopKeeps.toFixed(2)}`;
  if (commEl)  commEl.textContent  = `$${totalComm.toFixed(2)}`;

  if (staffEntries.length === 0) {
    staffBreakdown.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-2">No assigned services in this period.</p>';
  } else {

    const summaryBar = `
      <div class="bg-primary/10 rounded-xl px-5 py-3 border border-primary/30 flex items-center justify-between mb-3">
        <div>
          <div class="text-xs font-body font-semibold text-on-surface uppercase tracking-widest">Total Commission Owed</div>
          <div class="text-xs font-body text-on-surface-variant mt-0.5">${staffEntries.filter(([id]) => STAFF.find(s=>s.id===id)?.commission != null).length} staff with commission set</div>
        </div>
        <div class="font-headline font-bold text-primary text-xl">$${totalComm.toFixed(2)}</div>
      </div>`;

    staffBreakdown.innerHTML = summaryBar + staffEntries.map(([techId, data]) => {
      const tech = STAFF.find(s => s.id === techId);
      const name = tech?.name || 'Unknown';
      const commPct  = tech?.commission != null ? tech.commission : null;
      const commAmt  = commPct != null ? (data.income * commPct / 100) : null;
      const totalTurns = data.fullTurns + data.halfTurns;

      // Photo or initial
      const avatar = tech?.photo
        ? `<img src="${tech.photo}" class="w-10 h-10 rounded-full object-cover flex-shrink-0">`
        : `<div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-sm font-headline font-bold text-on-surface">${name.charAt(0)}</span></div>`;

      return `
        <div class="bg-surface-container-lowest rounded-xl border border-surface-container-high hover:bg-surface-container transition-colors cursor-pointer overflow-hidden" onclick="drillDownStaff('${techId}')">
          <div class="flex items-center gap-3 px-4 py-3">
            ${avatar}
            <div class="flex-grow min-w-0">
              <div class="font-headline font-semibold text-on-surface text-sm">${name}</div>
              <div class="text-xs font-body text-on-surface-variant flex gap-3 mt-0.5">
                <span>${data.count} service${data.count !== 1 ? 's' : ''}</span>
                <span class="text-primary font-semibold">${totalTurns}t</span>
                ${data.bonusTurns > 0 ? `<span class="text-secondary">+${data.bonusTurns}b</span>` : ''}
                ${commPct != null ? `<span>${commPct}% commission</span>` : '<span class="text-outline italic">no commission set</span>'}
              </div>
            </div>
            <span class="material-symbols-outlined text-on-surface-variant flex-shrink-0" style="font-size:18px">chevron_right</span>
          </div>
          <!-- Income + Commission bar -->
          <div class="flex border-t border-surface-container-high divide-x divide-surface-container-high">
            <div class="flex-1 px-4 py-2 text-center">
              <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Billed</div>
              <div class="font-headline font-bold text-on-surface text-base">$${data.income.toFixed(2)}</div>
            </div>
            ${commAmt != null ? `
            <div class="flex-1 px-4 py-2 text-center" style="background:rgba(26,82,82,0.06)">
              <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Commission (${commPct}%)</div>
              <div class="font-headline font-bold text-primary text-base">$${commAmt.toFixed(2)}</div>
            </div>
            <div class="flex-1 px-4 py-2 text-center">
              <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Salon Keeps</div>
              <div class="font-headline font-bold text-on-surface text-base">$${(data.income - commAmt).toFixed(2)}</div>
            </div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // Per-service breakdown
  const svcMap = {};
  filtered.forEach(r => {
    (r.assignments || []).forEach(a => {
      if (!a.serviceId) return;
      if (!svcMap[a.serviceId]) svcMap[a.serviceId] = { income: 0, count: 0 };
      svcMap[a.serviceId].income += a.cost || 0;
      svcMap[a.serviceId].count++;
    });
    // Also count services without assignments
    if (!r.assignments || r.assignments.length === 0) {
      r.services.forEach(sid => {
        if (!svcMap[sid]) svcMap[sid] = { income: 0, count: 0 };
        svcMap[sid].count++;
      });
    }
  });
  const svcBreakdown = document.getElementById('rpt-services-breakdown');
  const svcEntries = Object.entries(svcMap).sort((a,b) => b[1].income - a[1].income);
  if (svcEntries.length === 0) {
    svcBreakdown.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-2">No services in this period.</p>';
  } else {
    svcBreakdown.innerHTML = svcEntries.map(([sid, data]) => {
      const svc = SERVICES.find(s => s.id === sid);
      return `
        <div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between cursor-pointer hover:bg-surface-container transition-colors" onclick="drillDownService('${sid}')">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <span class="text-xs font-headline font-bold text-on-primary">${svc?.abbr || '?'}</span>
            </div>
            <div>
              <div class="font-headline font-semibold text-on-surface text-sm">${svc?.label || sid}</div>
              <div class="text-xs font-body text-on-surface-variant">${data.count} time${data.count !== 1 ? 's' : ''} · tap for details</div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="font-headline font-bold text-on-surface">$${data.income.toFixed(2)}</div>
            <span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px">chevron_right</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Per-fees breakdown
  const feeMap = {};
  filtered.forEach(r => {
    (r.fees || []).forEach(f => {
      if (!f.feeId) return;
      if (!feeMap[f.feeId]) feeMap[f.feeId] = { total: 0, count: 0 };
      feeMap[f.feeId].total += f.amount || 0;
      feeMap[f.feeId].count++;
    });
  });
  const feesBreakdown = document.getElementById('rpt-fees-breakdown');
  if (feesBreakdown) {
    const feeEntries = Object.entries(feeMap).sort((a,b) => b[1].total - a[1].total);
    if (feeEntries.length === 0) {
      feesBreakdown.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-2">No fees charged in this period.</p>';
    } else {
      feesBreakdown.innerHTML = feeEntries.map(([feeId, data]) => {
        const fee = FEES.find(f => f.id === feeId);
        return `
          <div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(26,82,82,0.10)">
                <span class="material-symbols-outlined" style="font-size:16px;color:#1a5252">receipt</span>
              </div>
              <div>
                <div class="font-headline font-semibold text-on-surface text-sm">${fee?.label || feeId}</div>
                <div class="text-xs font-body text-on-surface-variant">${data.count} time${data.count !== 1 ? 's' : ''} charged</div>
              </div>
            </div>
            <div class="font-headline font-bold text-on-surface">$${data.total.toFixed(2)}</div>
          </div>`;
      }).join('');
    }
  }

  // Store current filtered data for export
  window._currentReportData = { filtered, from, to, totalIncome, guestCount, avgTicket, staffMap, svcMap };

  // Per-items breakdown
  const itemMap = {};
  filtered.forEach(r => {
    (r.items || []).forEach(x => {
      if (!x.itemId || !x.qty || x.qty <= 0) return;
      if (!itemMap[x.itemId]) itemMap[x.itemId] = { revenue: 0, qty: 0 };
      itemMap[x.itemId].revenue += (x.price || 0) * (x.qty || 0);
      itemMap[x.itemId].qty    += x.qty || 0;
    });
  });
  const itemBreakdown = document.getElementById('rpt-items-breakdown');
  if (itemBreakdown) {
    const itemEntries = Object.entries(itemMap).sort((a, b) => b[1].revenue - a[1].revenue);
    if (itemEntries.length === 0) {
      itemBreakdown.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-2">No retail items sold in this period.</p>';
    } else {
      itemBreakdown.innerHTML = itemEntries.map(([itemId, data]) => {
        const item = ITEMS.find(i => i.id === itemId);
        return `
          <div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(92,64,16,0.12)">
                <span class="text-xs font-headline font-bold" style="color:#5c4010">${item?.abbr || '?'}</span>
              </div>
              <div>
                <div class="font-headline font-semibold text-on-surface text-sm">${item?.label || itemId}</div>
                <div class="text-xs font-body text-on-surface-variant">${data.qty} unit${data.qty !== 1 ? 's' : ''} sold</div>
              </div>
            </div>
            <div class="font-headline font-bold text-on-surface">$${data.revenue.toFixed(2)}</div>
          </div>`;
      }).join('');
    }
  }
}


// ── Report Drill-Down ─────────────────────────────
function drillDownStaff(techId) {
  const d = window._currentReportData;
  if (!d) return;
  const tech    = STAFF.find(s => s.id === techId);
  const name    = tech?.name || 'Unknown';
  const commPct = tech?.commission != null ? tech.commission : null;

  // Collect all assignments for this tech in the period
  const rows = [];
  d.filtered.forEach(r => {
    (r.assignments || []).forEach(a => {
      if (a.techId !== techId) return;
      const svc = SERVICES.find(s => s.id === a.serviceId);
      const dt  = new Date(r.checkinTime);
      const cost = a.cost || 0;
      const comm = commPct != null ? (cost * commPct / 100) : null;
      rows.push({ customer: r.name, service: svc?.label || a.serviceId, cost, comm, station: a.station || '', time: dt, turnType: classifyTurn(cost, a.serviceId||'') });
    });
  });

  const totalBilled = rows.reduce((s, r) => s + r.cost, 0);
  const totalComm   = commPct != null ? (totalBilled * commPct / 100) : null;
  const totalTurns  = rows.reduce((s, r) => s + (r.turnType==='full' ? 1 : r.turnType==='half' ? 0.5 : 0), 0);

  const summaryHtml = `
    <div class="bg-primary/10 rounded-xl border border-primary/30 flex divide-x divide-primary/20 mb-4">
      <div class="flex-1 px-4 py-3 text-center">
        <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Total Billed</div>
        <div class="font-headline font-bold text-on-surface text-lg">$${totalBilled.toFixed(2)}</div>
      </div>
      ${totalComm != null ? `
      <div class="flex-1 px-4 py-3 text-center">
        <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Commission (${commPct}%)</div>
        <div class="font-headline font-bold text-primary text-lg">$${totalComm.toFixed(2)}</div>
      </div>
      <div class="flex-1 px-4 py-3 text-center">
        <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Salon Keeps</div>
        <div class="font-headline font-bold text-on-surface text-lg">$${(totalBilled - totalComm).toFixed(2)}</div>
      </div>` : ''}
      <div class="flex-1 px-4 py-3 text-center">
        <div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Turns</div>
        <div class="font-headline font-bold text-primary text-lg">${totalTurns}</div>
      </div>
    </div>`;

  const rowsHtml = rows.map(row => {
    const turnBadge = row.turnType === 'full' ? '1t' : row.turnType === 'half' ? '½t' : 'B';
    const turnColor = row.turnType === 'bonus' ? '#f5c870' : '#1a5252';
    return `
      <div class="bg-surface-container-lowest rounded-xl px-4 py-3 border border-surface-container-high flex items-center justify-between">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-headline font-semibold text-on-surface text-sm">${row.customer}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style="background:${turnColor}20;color:${turnColor}">${turnBadge}</span>
          </div>
          <div class="text-xs font-body text-on-surface-variant">${row.service}${row.station ? ' · ' + row.station : ''}</div>
          <div class="text-[11px] font-body text-outline">${row.time.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${row.time.toLocaleDateString()}</div>
        </div>
        <div class="text-right flex-shrink-0 ml-3">
          <div class="font-headline font-bold text-on-surface">$${row.cost.toFixed(2)}</div>
          ${row.comm != null ? `<div class="text-xs font-body text-primary">comm $${row.comm.toFixed(2)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  showDrillPanel(`${name} — Service Detail`, summaryHtml + rowsHtml);
}

function drillDownService(sid) {
  const d = window._currentReportData;
  if (!d) return;
  const svc = SERVICES.find(s => s.id === sid);

  const rows = [];
  d.filtered.forEach(r => {
    (r.assignments || []).forEach(a => {
      if (a.serviceId !== sid) return;
      const tech = STAFF.find(s => s.id === a.techId);
      const dt = new Date(r.checkinTime);
      rows.push({ customer: r.name, tech: tech?.name || '—', cost: a.cost || 0, station: a.station || '', time: dt });
    });
  });

  showDrillPanel(`${svc?.label || sid} — Detail`, rows.map(row => `
    <div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between">
      <div>
        <div class="font-headline font-semibold text-on-surface text-sm">${row.customer}</div>
        <div class="text-xs font-body text-on-surface-variant">Tech: ${row.tech}${row.station ? ' · ' + row.station : ''}</div>
        <div class="text-[11px] font-body text-outline">${row.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · ${row.time.toLocaleDateString()}</div>
      </div>
      <div class="font-headline font-bold text-on-surface">$${row.cost.toFixed(2)}</div>
    </div>
  `).join(''));
}

function showDrillPanel(title, html) {
  document.getElementById('rpt-drill-title').textContent = title;
  document.getElementById('rpt-drill-list').innerHTML = html || '<p class="text-sm font-body text-on-surface-variant">No detail available.</p>';
  document.getElementById('rpt-drill-panel').classList.remove('hidden');
  // Scroll to drill panel
  document.getElementById('rpt-drill-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDrillDown() {
  document.getElementById('rpt-drill-panel').classList.add('hidden');
}


// ── Transactions History ──────────────────────────
function renderTransactions() {
  const list = document.getElementById('txn-list');
  const empty = document.getElementById('txn-empty');
  if (!list) return;

  const dateFilter = document.getElementById('txn-date-filter')?.value;

  // Use shared helper — same merge logic as runReport()
  let combined = buildCombinedRecords();

  if (dateFilter) {
    combined = combined.filter(r => {
      const d = new Date(r.checkinTime);
      const localDate = d.getFullYear() + '-' +
        String(d.getMonth()+1).padStart(2,'0') + '-' +
        String(d.getDate()).padStart(2,'0');
      return localDate === dateFilter;
    });
  }

  combined = combined.filter(r => r.status === 'done');
  combined.sort((a, b) => new Date(b.checkinTime) - new Date(a.checkinTime));

  if (combined.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = combined.map(r => {
    const dt = new Date(r.checkinTime);
    const timeStr = dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const dateStr = dt.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    const badgeClass = { waiting: 'badge-waiting', inservice: 'badge-inservice', done: 'badge-done' }[r.status] || 'badge-done';
    const serviceLabels = (r.services || []).map(sid => SERVICES.find(s=>s.id===sid)?.label||sid).join(', ') || '—';
    const assignRows = (r.assignments || []).filter(a => a.techId || a.cost).map(a => {
      const tech = STAFF.find(s => s.id === a.techId);
      const svc  = SERVICES.find(s => s.id === a.serviceId);
      return `<div class="text-[11px] font-body text-primary">${svc?.label || ''} → ${tech?.name || '—'}${a.station ? ' @ ' + a.station : ''} ${a.cost ? '· $' + a.cost.toFixed(2) : ''}</div>`;
    }).join('');

    return `
      <div class="bg-surface-container-lowest rounded-xl px-5 py-4 border border-surface-container-high">
        <div class="flex items-start justify-between">
          <div class="flex-grow min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-headline font-bold text-on-surface">${r.name}</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full font-body font-semibold ${badgeClass}">${r.status}</span>
              ${r.isAppointment ? '<span class="badge-appointment text-[11px] px-2 py-0.5 rounded-full font-body font-semibold">Appt</span>' : ''}
            </div>
            <div class="text-xs font-body text-on-surface-variant mb-1">${serviceLabels}</div>
            ${assignRows}
            <div class="text-[11px] font-body text-outline mt-1">${dateStr} · ${timeStr}${r.phone ? ' · ' + r.phone : ''}</div>
          </div>
          <div class="text-right ml-4 flex-shrink-0 flex flex-col items-end gap-2">
            <div class="text-lg font-headline font-extrabold text-primary">$${(r.totalCost||0).toFixed(2)}</div>
            <button onclick="initiateDeleteTransaction('${r.id}')"
              class="flex items-center gap-1 text-[11px] font-body text-outline hover:text-error transition-colors px-2 py-1 rounded-lg hover:bg-error/10">
              <span class="material-symbols-outlined" style="font-size:14px">delete</span> Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}


function exportReportExcel() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }

  // Build CSV content (opens in Excel)
  const rows = [
    ['Muse Nails & Spa — Report'],
    [`Period: ${d.from.toLocaleDateString()} – ${d.to.toLocaleDateString()}`],
    [`Total Income: $${d.totalIncome.toFixed(2)}`, `Guests Served: ${d.guestCount}`, `Avg Ticket: $${(d.totalIncome/Math.max(d.guestCount,1)).toFixed(2)}`],
    [],
    ['CHECK-INS'],
    ['Date','Time','Name','Phone','Services','Type','Staff','Total','Status'],
    ...d.filtered.map(r => {
      const dt = new Date(r.checkinTime);
      const staffNames = (r.assignments||[]).map(a => STAFF.find(s=>s.id===a.techId)?.name).filter(Boolean).join(', ');
      return [
        dt.toLocaleDateString(), dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
        r.name, r.phone,
        r.services.map(sid => SERVICES.find(s=>s.id===sid)?.label||sid).join(', '),
        r.isAppointment ? 'Appointment' : 'Walk-In',
        staffNames, r.totalCost ? `$${r.totalCost.toFixed(2)}` : '$0.00', r.status,
      ];
    }),
    [],
    ['STAFF BREAKDOWN'],
    ['Technician','Services','Turns','Bonus Turns','Total Billed','Commission %','Commission Earned','Salon Keeps'],
    ...Object.entries(d.staffMap).map(([techId, data]) => {
      const tech      = STAFF.find(s=>s.id===techId);
      const commPct   = tech?.commission != null ? tech.commission : null;
      const commAmt   = commPct != null ? (data.income * commPct / 100) : 0;
      const salonKeep = data.income - commAmt;
      const totalTurns = data.fullTurns + data.halfTurns;
      return [
        tech?.name||'Unknown', data.count, totalTurns, data.bonusTurns,
        `$${data.income.toFixed(2)}`,
        commPct != null ? `${commPct}%` : 'N/A',
        `$${commAmt.toFixed(2)}`,
        `$${salonKeep.toFixed(2)}`,
      ];
    }),
    [],
    ['SERVICES BREAKDOWN'],
    ['Service','Count','Income'],
    ...Object.entries(d.svcMap).map(([sid, data]) => {
      const svc = SERVICES.find(s=>s.id===sid);
      return [svc?.label||sid, data.count, `$${data.income.toFixed(2)}`];
    }),
  ];

  const csv = rows.map(r => r.map(cell => `"${String(cell||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `muse-report-${localDateStr(d.from)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded as CSV (opens in Excel)');
}


// ── Sheets Report Export ──────────────────────────
function exportReportPDF() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }

  const fmt    = dt => new Date(dt).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  const fmtT   = dt => new Date(dt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const period = d.from.toDateString() === d.to.toDateString()
    ? fmt(d.from)
    : `${fmt(d.from)} – ${fmt(d.to)}`;

  // Build filename: May_18,2026_Daily_Report
  const fileDate = d.from.toDateString() === d.to.toDateString()
    ? new Date(d.from).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}).replace(/ /g, '_').replace(',', ',')
    : `${new Date(d.from).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}).replace(/ /g,'_')}_to_${new Date(d.to).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}).replace(/ /g,'_')}`;
  const filename = `${fileDate}_Daily_Report`;

  // Commission totals
  const staffEntries = Object.entries(d.staffMap).sort((a,b) => b[1].income - a[1].income);
  const totalComm = staffEntries.reduce((sum, [tid, data]) => {
    const t = STAFF.find(s=>s.id===tid);
    return sum + (t?.commission != null ? data.income * t.commission / 100 : 0);
  }, 0);
  const shopKeeps = d.totalIncome - totalComm;

  const staffRows = staffEntries.map(([tid, data]) => {
    const t = STAFF.find(s=>s.id===tid);
    const comm = t?.commission != null ? (data.income * t.commission / 100) : null;
    const turns = data.fullTurns + data.halfTurns;
    return `<tr>
      <td>${t?.name||'Unknown'}</td>
      <td>${data.count}</td>
      <td>${turns}t${data.bonusTurns>0?' +'+data.bonusTurns+'b':''}</td>
      <td>$${data.income.toFixed(2)}</td>
      <td>${t?.commission!=null?t.commission+'%':'—'}</td>
      <td>${comm!=null?'$'+comm.toFixed(2):'—'}</td>
      <td>${comm!=null?'$'+(data.income-comm).toFixed(2):'—'}</td>
    </tr>`;
  }).join('');

  const txRows = d.filtered.map(r => {
    const dt = new Date(r.checkinTime);
    const staffNames = [...new Set((r.assignments||[]).filter(a=>a.techId).map(a=>STAFF.find(s=>s.id===a.techId)?.name||'').filter(Boolean))].join(', ');
    return `<tr>
      <td>${dt.toLocaleDateString()}</td>
      <td>${fmtT(dt)}</td>
      <td>${r.name}</td>
      <td>${r.services.map(sid=>SERVICES.find(s=>s.id===sid)?.label||sid).join(', ')}</td>
      <td>${staffNames||'—'}</td>
      <td>$${(r.totalCost||0).toFixed(2)}</td>
      <td>${r.status}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${filename}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 24px; }
      .report-header { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
      .report-logo { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
      h1 { color: #1a5252; font-size: 20px; margin: 0 0 2px; }
      h2 { color: #1a5252; font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #1a5252; padding-bottom: 4px; }
      .summary { display: flex; gap: 24px; margin: 12px 0 20px; flex-wrap: wrap; }
      .card { background: #f5f5f5; border-radius: 8px; padding: 10px 16px; min-width: 120px; text-align: center; }
      .card .val { font-size: 20px; font-weight: bold; color: #1a5252; }
      .card .lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
      .card.amber .val { color: #a05000; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #1a5252; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
      td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
      tr:nth-child(even) td { background: #fafafa; }
      .footer { margin-top: 24px; font-size: 10px; color: #999; text-align: center; }
      @media print { body { margin: 12px; } }
    </style>
  </head><body>
    <div class="report-header">
      ${(_logoData || LOGO_PATH) ? `<img src="${_logoData || LOGO_PATH}" class="report-logo" onerror="this.style.display='none'">` : ''}
      <div>
        <h1>Muse Nails &amp; Spa — Daily Report</h1>
        <p style="color:#666;margin:0">${period}</p>
      </div>
    </div>
    <div class="summary">
      <div class="card"><div class="val">$${d.totalIncome.toFixed(2)}</div><div class="lbl">Total Billed</div></div>
      <div class="card"><div class="val">${d.guestCount}</div><div class="lbl">Guests Served</div></div>
      <div class="card"><div class="val">$${(d.totalIncome/Math.max(d.guestCount,1)).toFixed(2)}</div><div class="lbl">Avg Ticket</div></div>
      <div class="card"><div class="val">$${shopKeeps.toFixed(2)}</div><div class="lbl">Shop Keeps</div></div>
      <div class="card amber"><div class="val">$${totalComm.toFixed(2)}</div><div class="lbl">Commission Owed</div></div>
    </div>
    <h2>Staff Breakdown</h2>
    <table><thead><tr><th>Technician</th><th>Services</th><th>Turns</th><th>Billed</th><th>Comm %</th><th>Commission</th><th>Shop Keeps</th></tr></thead>
    <tbody>${staffRows}</tbody></table>
    <h2>Transactions (${d.filtered.length})</h2>
    <table><thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Services</th><th>Staff</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${txRows}</tbody></table>
    <div class="footer">Generated ${new Date().toLocaleString()} · Muse Nails &amp; Spa</div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  // Trigger print dialog after a short delay so content renders
  if (win) setTimeout(() => { win.print(); }, 600);
  URL.revokeObjectURL(url);
  showToast('PDF report opened — use Print → Save as PDF');
}

// Upload the report as an HTML file to R2 and copy the shareable URL to clipboard.
async function exportReportLink() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }

  const fmt    = dt => new Date(dt).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  const fmtT   = dt => new Date(dt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const period = d.from.toDateString() === d.to.toDateString()
    ? fmt(d.from)
    : `${fmt(d.from)} – ${fmt(d.to)}`;

  const staffEntries = Object.entries(d.staffMap).sort((a,b) => b[1].income - a[1].income);
  const totalComm    = staffEntries.reduce((sum, [tid, data]) => {
    const t = STAFF.find(s=>s.id===tid);
    return sum + (t?.commission != null ? data.income * t.commission / 100 : 0);
  }, 0);
  const shopKeeps = d.totalIncome - totalComm;

  const staffRows = staffEntries.map(([tid, data]) => {
    const t    = STAFF.find(s=>s.id===tid);
    const comm = t?.commission != null ? (data.income * t.commission / 100) : null;
    const turns = data.fullTurns + data.halfTurns;
    return `<tr>
      <td>${t?.name||'Unknown'}</td><td>${data.count}</td>
      <td>${turns}t${data.bonusTurns>0?' +'+data.bonusTurns+'b':''}</td>
      <td>$${data.income.toFixed(2)}</td>
      <td>${t?.commission!=null?t.commission+'%':'—'}</td>
      <td>${comm!=null?'$'+comm.toFixed(2):'—'}</td>
      <td>${comm!=null?'$'+(data.income-comm).toFixed(2):'—'}</td>
    </tr>`;
  }).join('');

  const txRows = d.filtered.map(r => {
    const dt = new Date(r.checkinTime);
    const staffNames = [...new Set((r.assignments||[]).filter(a=>a.techId).map(a=>STAFF.find(s=>s.id===a.techId)?.name||'').filter(Boolean))].join(', ');
    return `<tr>
      <td>${dt.toLocaleDateString()}</td><td>${fmtT(dt)}</td>
      <td>${r.name}</td>
      <td>${r.services.map(sid=>SERVICES.find(s=>s.id===sid)?.label||sid).join(', ')}</td>
      <td>${staffNames||'—'}</td>
      <td>$${(r.totalCost||0).toFixed(2)}</td><td>${r.status}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muse Report ${period}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:24px}
      .report-header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
      .report-logo{width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0}
      h1{color:#1a5252;font-size:20px;margin:0 0 2px}h2{color:#1a5252;font-size:14px;margin:20px 0 8px;border-bottom:2px solid #1a5252;padding-bottom:4px}
      .summary{display:flex;gap:24px;margin:12px 0 20px;flex-wrap:wrap}
      .card{background:#f5f5f5;border-radius:8px;padding:10px 16px;min-width:120px;text-align:center}
      .card .val{font-size:20px;font-weight:bold;color:#1a5252}.card .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.5px}
      .card.amber .val{color:#a05000}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{background:#1a5252;color:white;padding:6px 8px;text-align:left;font-size:11px}
      td{padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px}
      tr:nth-child(even) td{background:#fafafa}
      .footer{margin-top:24px;font-size:10px;color:#999;text-align:center}
    </style></head><body>
    <div class="report-header">
      ${(_logoData||LOGO_PATH)?`<img src="${_logoData||LOGO_PATH}" class="report-logo" onerror="this.style.display='none'">`:''}
      <div><h1>Muse Nails &amp; Spa — Daily Report</h1><p style="color:#666;margin:0">${period}</p></div>
    </div>
    <div class="summary">
      <div class="card"><div class="val">$${d.totalIncome.toFixed(2)}</div><div class="lbl">Total Billed</div></div>
      <div class="card"><div class="val">${d.guestCount}</div><div class="lbl">Guests Served</div></div>
      <div class="card"><div class="val">$${(d.totalIncome/Math.max(d.guestCount,1)).toFixed(2)}</div><div class="lbl">Avg Ticket</div></div>
      <div class="card"><div class="val">$${shopKeeps.toFixed(2)}</div><div class="lbl">Shop Keeps</div></div>
      <div class="card amber"><div class="val">$${totalComm.toFixed(2)}</div><div class="lbl">Commission Owed</div></div>
    </div>
    <h2>Staff Breakdown</h2>
    <table><thead><tr><th>Technician</th><th>Services</th><th>Turns</th><th>Billed</th><th>Comm %</th><th>Commission</th><th>Shop Keeps</th></tr></thead>
    <tbody>${staffRows}</tbody></table>
    <h2>Transactions (${d.filtered.length})</h2>
    <table><thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Services</th><th>Staff</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${txRows}</tbody></table>
    <div class="footer">Generated ${new Date().toLocaleString()} · Muse Nails &amp; Spa</div>
  </body></html>`;

  showToast('Uploading report…');
  const key = `reports/${localDateStr(d.from)}.html`;
  try {
    const res  = await fetch(`${PHOTOS_PROXY}/${key}`, {
      method:  'PUT',
      body:    new TextEncoder().encode(html),
      headers: { 'Content-Type': 'text/html;charset=utf-8' },
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const url  = data.url;
    try { await navigator.clipboard.writeText(url); } catch(e) { /* clipboard unavailable — URL shown in toast */ }
    showToast('Link copied to clipboard ✓');
  } catch(e) {
    console.warn('[Report] R2 upload failed:', e);
    showToast('Upload failed — check connection');
  }
}

async function exportReportSheets() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }
  showToast('Exporting report to Google Sheets…');
  try {
    const payload = {
      action: 'report',
      sheetId: '1VesuEJxRyH-RIwdTp33u2ulKYNCXIbHZ5EU-PxJteqo',
      from: d.from.toLocaleDateString(),
      to: d.to.toLocaleDateString(),
      totalIncome: d.totalIncome.toFixed(2),
      guestCount: d.guestCount,
      avgTicket: (d.totalIncome / Math.max(d.guestCount,1)).toFixed(2),
      rows: d.filtered.map(r => {
        const dt = new Date(r.checkinTime);
        const staffNames = (r.assignments||[]).map(a => STAFF.find(s=>s.id===a.techId)?.name).filter(Boolean).join(', ');
        return {
          date: dt.toLocaleDateString(),
          time: dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
          name: r.name, phone: r.phone,
          services: r.services.map(sid => SERVICES.find(s=>s.id===sid)?.label||sid).join(', '),
          type: r.isAppointment ? 'Appointment' : 'Walk-In',
          staff: staffNames,
          total: r.totalCost ? `$${r.totalCost.toFixed(2)}` : '$0.00',
          status: r.status,
        };
      }),
      staffBreakdown: Object.entries(d.staffMap).map(([techId, data]) => {
        const tech = STAFF.find(s=>s.id===techId);
        const comm = tech?.commission != null ? (data.income * tech.commission / 100) : 0;
        return { name: tech?.name||'Unknown', count: data.count, income: data.income.toFixed(2), commissionPct: tech?.commission||0, commissionEarned: comm.toFixed(2) };
      }),
    };
    await fetch(PROXY_SHEETS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showToast('Report sent to Google Sheets!');
  } catch(e) { showToast('Failed to export report.'); console.warn(e); }
}


// ── Historical Transaction Entry (admin only) ──────
let _histType = 'Walk-In';
let _histServices = [];

function showHistoricalEntryModal() {
  if (!['admin'].includes(activeUser?.role)) { showToast('Admin access required'); return; }
  // Pre-fill date/time to today/now
  const now = new Date();
  document.getElementById('hist-date').value = todayStr();
  document.getElementById('hist-time').value = now.toTimeString().slice(0,5);
  document.getElementById('hist-name').value = '';
  document.getElementById('hist-phone').value = '';
  document.getElementById('hist-total').value = '';
  _histServices = [];
  _histType = 'Walk-In';
  setHistType('Walk-In');

  // Populate services
  const svcGrid = document.getElementById('hist-services');
  svcGrid.innerHTML = SERVICES.filter(s => isServiceVisibleOnDash(s.id)).map(s =>
    `<button type="button" onclick="toggleHistService('${s.id}',this)"
      class="px-3 py-2 rounded-xl border-2 border-surface-container-high text-xs font-body font-semibold text-on-surface-variant hover:border-primary transition-all"
      data-sid="${s.id}">${s.label}</button>`
  ).join('');

  // Populate tech dropdown
  const techSel = document.getElementById('hist-tech');
  techSel.innerHTML = '<option value="">— Select tech —</option>' +
    getActiveStaff().map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  document.getElementById('historical-modal').classList.remove('hidden');
  document.getElementById('historical-modal').style.display = 'flex';
}

function closeHistoricalModal() {
  document.getElementById('historical-modal').classList.add('hidden');
  document.getElementById('historical-modal').style.display = '';
}

function toggleHistService(sid, btn) {
  if (_histServices.includes(sid)) {
    _histServices = _histServices.filter(s => s !== sid);
    btn.classList.remove('border-primary', 'bg-primary/10', 'text-primary');
    btn.classList.add('border-surface-container-high', 'text-on-surface-variant');
  } else {
    _histServices.push(sid);
    btn.classList.add('border-primary', 'bg-primary/10', 'text-primary');
    btn.classList.remove('border-surface-container-high', 'text-on-surface-variant');
  }
}

function setHistType(type) {
  _histType = type;
  ['Walk-In','Appointment'].forEach(t => {
    const btn = document.getElementById('hist-type-' + (t === 'Walk-In' ? 'walkin' : 'appt'));
    if (t === type) {
      btn.classList.add('bg-primary','text-on-primary','border-primary');
      btn.classList.remove('bg-transparent','border-outline-variant','text-on-surface');
    } else {
      btn.classList.remove('bg-primary','text-on-primary','border-primary');
      btn.classList.add('bg-transparent','border-outline-variant','text-on-surface');
    }
  });
}

function saveHistoricalTransaction() {
  const name  = document.getElementById('hist-name').value.trim();
  const phone = document.getElementById('hist-phone').value.trim();
  const total = parseFloat(document.getElementById('hist-total').value) || 0;
  const techId = document.getElementById('hist-tech').value;
  const dateVal = document.getElementById('hist-date').value;
  const timeVal = document.getElementById('hist-time').value;

  if (!name) { showToast('Enter a customer name'); return; }
  if (!dateVal) { showToast('Select a date'); return; }

  const checkinTime = new Date(`${dateVal}T${timeVal || '12:00'}:00`);
  const entryId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const assignments = _histServices.length > 0
    ? _histServices.map(sid => ({
        serviceId: sid, techId: techId || '',
        status: 'done', cost: total / Math.max(_histServices.length, 1),
        assignedAt: checkinTime.getTime(),
      }))
    : total > 0 ? [{ serviceId: '', techId: techId || '', status: 'done', cost: total, assignedAt: checkinTime.getTime() }] : [];

  const record = {
    id:            String(entryId),
    name,
    phone:         phone || '',
    services:      _histServices,
    assignments,
    totalCost:     total,
    checkinTime:   checkinTime.toISOString(),
    completedAt:   checkinTime.toISOString(),
    status:        'done',
    isAppointment: _histType === 'Appointment',
    loggedBy:      activeUser?.name || 'Admin',
  };

  // Add to allRecords
  allRecords.push(record);
  localStorage.setItem('muse_records', JSON.stringify(allRecords));

  // Push to Sheets — exportToSheets writes both Transaction Log row AND Check-Ins row.
  // Do NOT call sendCheckinRow separately here — exportToSheets already calls it internally.
  const entry = {
    ...record,
    checkinTime: checkinTime,
    completedAt: checkinTime,
  };
  exportToSheets(entry);

  closeHistoricalModal();
  renderTransactions();
  showToast('Historical transaction saved ✓');
}

// Show/hide "Add Historical" button based on role
function updateHistoricalButtonVisibility() {
  const btn = document.getElementById('add-historical-btn');
  if (btn) btn.classList.toggle('hidden', activeUser?.role !== 'admin');
}


