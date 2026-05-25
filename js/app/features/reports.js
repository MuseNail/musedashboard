// ── Reports, transactions, historical entry, refunds, deletion ──────────────
// Records live in the DO (state.records). Writes go through dispatch:
//   record.save (complete/historical/refund), record.delete (soft delete).
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, localDateStr, todayStr, partyLetterMap } from '../utils.js';
import { canDo, getActiveUser } from '../session.js';
import { classifyTurn } from './turns.js';
import { isPaidStatus } from './status.js';
import { squareUpsertCustomer } from './square-customers.js';
import { avgServiceTime, fmtDur } from './servicetime.js';
import { LOGO_PATH, PHOTOS_PROXY } from '../config.js';

const cfg = () => getState().config;
const records = () => getState().records;
const queue   = () => getState().queue;
const giftCards = () => getState().giftcards;
const svc = id => cfg().services.find(s => s.id === id);
const staffById = id => cfg().staff.find(s => s.id === id);
const activeStaff = () => cfg().staff.filter(s => !cfg().inactive_staff.includes(s.id));

let reportRange = { type: 'today', from: null, to: null };

// ── Persist a completed entry as a record ─────────────────────────────────────
export function saveRecord(entry) {
  if (!entry.completedAt) entry.completedAt = new Date().toISOString();
  else if (entry.completedAt instanceof Date) entry.completedAt = entry.completedAt.toISOString();
  const record = {
    id: String(entry.id), name: entry.name, phone: entry.phone || '',
    services: entry.services, assignments: entry.assignments || [], items: entry.items || [], fees: entry.fees || [],
    discount: entry.discount || 0, discountNote: entry.discountNote || '', txnNote: entry.txnNote || '', totalCost: entry.totalCost || 0,
    groupId: entry.groupId || '', groupColor: entry.groupColor || '', groupLabel: entry.groupLabel || '',
    checkinTime: typeof entry.checkinTime === 'string' ? entry.checkinTime : new Date(entry.checkinTime).toISOString(),
    completedAt: entry.completedAt, status: entry.status, isAppointment: entry.isAppointment || false,
    loggedBy: getActiveUser()?.name || '',
  };
  dispatch('record.save', { record });
}

// Combine live done queue entries with stored records (queue wins for today).
export function buildCombinedRecords() {
  const deletedIds = new Set(getState().deletions.map(String));
  records().filter(r => r.status === 'deleted').forEach(r => deletedIds.add(String(r.id)));
  const liveSnaps = queue().filter(e => isPaidStatus(e.status) && !deletedIds.has(String(e.id))).map(e => ({
    id: String(e.id), name: e.name, phone: e.phone || '', services: e.services, assignments: e.assignments || [],
    items: e.items || [], fees: e.fees || [], discount: e.discount || 0, discountNote: e.discountNote || '',
    totalCost: e.totalCost || 0, checkinTime: e.checkinTime, completedAt: e.completedAt || null,
    status: e.status, isAppointment: e.isAppointment || false,
    groupId: e.groupId || '', groupColor: e.groupColor || '', groupLabel: e.groupLabel || '',
  }));
  const liveIds = new Set(liveSnaps.map(r => String(r.id)));
  return [...liveSnaps, ...records().filter(r => !liveIds.has(String(r.id)) && r.status !== 'deleted' && !deletedIds.has(String(r.id)))];
}

// ── Report range ──────────────────────────────────
export function setReportRange(type) {
  reportRange.type = type;
  syncRangeButtons();
  const showCustom = type === 'custom';
  ['custom-range-inputs','txn-custom-inputs'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.classList.toggle('hidden', !showCustom); el.classList.toggle('grid', showCustom);
  });
  // Reports + Transactions share one date window — refresh both so they always match.
  if (!showCustom) { runReport(); renderTransactions(); }
}
// Highlight the matching range chip in BOTH the Reports and Transactions panels.
function syncRangeButtons() {
  document.querySelectorAll('.rng-btn').forEach(b => b.classList.toggle('active', b.dataset.range === reportRange.type));
}
function rangeLabel() {
  if (reportRange.type === 'today') return 'Today';
  if (reportRange.type === 'week') return 'This Week';
  if (reportRange.type === 'month') return 'This Month';
  const d = getReportDates(); if (!d) return 'Custom';
  const fmt = x => x.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  if (reportRange.type === 'payperiod') return `Pay Period (${fmt(d.from)} – ${fmt(d.to)})`;
  return `${fmt(d.from)} – ${fmt(d.to)}`;
}

// Current pay period from config.pay_period: weekly/biweekly anchored at startDate,
// or bimonthly (1st–15th, 16th–end). Returns { from, to }.
function payPeriodDates(now = new Date()) {
  const pp = cfg().pay_period || {};
  const type = pp.type || 'weekly';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (type === 'bimonthly') {
    if (today.getDate() <= 15) return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth(), 15, 23,59,59) };
    return { from: new Date(today.getFullYear(), today.getMonth(), 16), to: new Date(today.getFullYear(), today.getMonth()+1, 0, 23,59,59) };
  }
  const len = type === 'biweekly' ? 14 : 7, msDay = 86400000;
  const anchor = pp.startDate ? new Date(pp.startDate + 'T00:00:00') : today;
  const mod = (((Math.floor((today - anchor) / msDay)) % len) + len) % len;
  const from = new Date(today.getTime() - mod * msDay); from.setHours(0,0,0,0);
  const to = new Date(from.getTime() + (len-1) * msDay); to.setHours(23,59,59,999);
  return { from, to };
}
function getReportDates() {
  const now = new Date();
  if (reportRange.type === 'today') return { from: new Date(now.getFullYear(),now.getMonth(),now.getDate()), to: new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59) };
  if (reportRange.type === 'week') { const day = now.getDay() === 0 ? 6 : now.getDay() - 1; const from = new Date(now); from.setDate(now.getDate()-day); from.setHours(0,0,0,0); const to = new Date(from); to.setDate(from.getDate()+6); to.setHours(23,59,59,999); return { from, to }; }
  if (reportRange.type === 'payperiod') return payPeriodDates(now);
  if (reportRange.type === 'month') return { from: new Date(now.getFullYear(),now.getMonth(),1), to: new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59) };
  const f = document.getElementById('report-from')?.value || document.getElementById('txn-from')?.value;
  const t = document.getElementById('report-to')?.value || document.getElementById('txn-to')?.value;
  if (!f || !t) return null;
  return { from: new Date(f+'T00:00:00'), to: new Date(t+'T23:59:59') };
}

export function runReport() {
  const dates = getReportDates();
  if (!dates) return;
  const { from, to } = dates;
  const filtered = buildCombinedRecords().filter(r => {
    if (r.status === 'deleted') return false;
    const d = new Date(r.checkinTime);
    return d >= from && d <= to && (isPaidStatus(r.status) || r.status === 'refund');
  });

  const svcTotal = filtered.reduce((s,r)=>s+(r.assignments||[]).reduce((a,x)=>a+(x.cost||0),0),0);
  const itemsTotal = filtered.reduce((s,r)=>s+(r.items||[]).reduce((a,x)=>a+(x.price||0)*(x.qty||0),0),0);
  const feesTotal = filtered.reduce((s,r)=>s+(r.fees||[]).reduce((a,x)=>a+(x.amount||0),0),0);
  const discountTotal = filtered.reduce((s,r)=>s+(r.discount||0),0);
  const totalIncome = filtered.reduce((s,r)=>s+(r.totalCost||0),0);
  const guestCount = filtered.filter(r => isPaidStatus(r.status)).length;
  const avgTicket = guestCount > 0 ? totalIncome / guestCount : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rpt-total-income', `$${totalIncome.toFixed(2)}`); set('rpt-total-guests', guestCount); set('rpt-avg-ticket', `$${avgTicket.toFixed(2)}`);
  set('rpt-svc-total', `$${svcTotal.toFixed(2)}`); set('rpt-items-total', `$${itemsTotal.toFixed(2)}`); set('rpt-fees-total', `$${feesTotal.toFixed(2)}`);
  set('rpt-discount-total', discountTotal > 0 ? `-$${discountTotal.toFixed(2)}` : '-$0.00');
  const refundsTotal = filtered.filter(r => r.status === 'refund').reduce((s,r)=>s+(r.totalCost||0),0);
  document.getElementById('rpt-refunds-row')?.classList.toggle('hidden', refundsTotal === 0);
  if (refundsTotal !== 0) set('rpt-refunds-total', `-$${Math.abs(refundsTotal).toFixed(2)}`);

  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  set('report-range-label', `Showing: ${fmt(from)}${reportRange.type !== 'today' ? ' – ' + fmt(to) : ''}`);

  // Per-staff
  const staffMap = {};
  filtered.forEach(r => (r.assignments||[]).forEach(a => {
    if (!a.techId) return;
    if (!staffMap[a.techId]) staffMap[a.techId] = { income:0, count:0, fullTurns:0, halfTurns:0, bonusTurns:0 };
    const m = staffMap[a.techId]; m.income += a.cost||0; m.count++;
    const t = classifyTurn(a.cost||0, a.serviceId||''); if (t==='full') m.fullTurns++; else if (t==='half') m.halfTurns += 0.5; else m.bonusTurns++;
  }));
  const turnsOrder = cfg().turns_order || [];
  const staffEntries = Object.entries(staffMap).sort((a,b)=>{
    const ra = turnsOrder.indexOf(a[0]) === -1 ? Infinity : turnsOrder.indexOf(a[0]);
    const rb = turnsOrder.indexOf(b[0]) === -1 ? Infinity : turnsOrder.indexOf(b[0]);
    if (ra !== rb) return ra - rb;            // rotation order; non-rotation techs last
    return b[1].income - a[1].income;          // both off-rotation → by income
  });
  const totalComm = staffEntries.reduce((sum,[id,d])=>{ const t = staffById(id); return t?.commission != null ? sum + d.income*t.commission/100 : sum; }, 0);
  set('rpt-shop-keeps', `$${(totalIncome-totalComm).toFixed(2)}`); set('rpt-total-commission', `$${totalComm.toFixed(2)}`);

  const staffBreakdown = document.getElementById('rpt-staff-breakdown');
  if (staffBreakdown) {
    staffBreakdown.innerHTML = staffEntries.length === 0 ? '<p class="text-sm font-body text-on-surface-variant py-2">No assigned services in this period.</p>'
      : `<div class="bg-primary/10 rounded-xl px-5 py-3 border border-primary/30 flex items-center justify-between mb-3"><div><div class="text-xs font-body font-semibold text-on-surface uppercase tracking-widest">Total Commission Owed</div><div class="text-xs font-body text-on-surface-variant mt-0.5">${staffEntries.filter(([id])=>staffById(id)?.commission!=null).length} staff with commission set</div></div><div class="font-headline font-bold text-primary text-xl">$${totalComm.toFixed(2)}</div></div>`
      + staffEntries.map(([techId,data])=>{
        const tech = staffById(techId), name = tech?.name || 'Unknown';
        const commPct = tech?.commission != null ? tech.commission : null;
        const commAmt = commPct != null ? data.income*commPct/100 : null;
        const totalTurns = data.fullTurns + data.halfTurns;
        const avatar = tech?.photo ? `<img src="${tech.photo}" class="w-10 h-10 rounded-full object-cover flex-shrink-0">` : `<div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-sm font-headline font-bold text-on-surface">${name.charAt(0)}</span></div>`;
        return `<div class="bg-surface-container-lowest rounded-xl border border-surface-container-high hover:bg-surface-container transition-colors cursor-pointer overflow-hidden" onclick="drillDownStaff('${techId}')">
          <div class="flex items-center gap-3 px-4 py-3">${avatar}<div class="flex-grow min-w-0"><div class="font-headline font-semibold text-on-surface text-sm">${name}</div>
            <div class="text-xs font-body text-on-surface-variant flex gap-3 mt-0.5"><span>${data.count} service${data.count!==1?'s':''}</span><span class="text-primary font-semibold">${totalTurns}t</span>${data.bonusTurns>0?`<span class="text-secondary">+${data.bonusTurns}b</span>`:''}${commPct!=null?`<span>${commPct}% commission</span>`:'<span class="text-outline italic">no commission set</span>'}</div></div>
            <span class="material-symbols-outlined text-on-surface-variant flex-shrink-0" style="font-size:18px">chevron_right</span></div>
          <div class="flex border-t border-surface-container-high divide-x divide-surface-container-high">
            <div class="flex-1 px-4 py-2 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Billed</div><div class="font-headline font-bold text-on-surface text-base">$${data.income.toFixed(2)}</div></div>
            ${commAmt!=null?`<div class="flex-1 px-4 py-2 text-center" style="background:rgba(26,82,82,0.06)"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Commission (${commPct}%)</div><div class="font-headline font-bold text-primary text-base">$${commAmt.toFixed(2)}</div></div><div class="flex-1 px-4 py-2 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Salon Keeps</div><div class="font-headline font-bold text-on-surface text-base">$${(data.income-commAmt).toFixed(2)}</div></div>`:''}
          </div></div>`;
      }).join('');
  }

  // Per-service
  const svcMap = {};
  filtered.forEach(r => {
    (r.assignments||[]).forEach(a => { if (!a.serviceId) return; if (!svcMap[a.serviceId]) svcMap[a.serviceId] = { income:0, count:0 }; svcMap[a.serviceId].income += a.cost||0; svcMap[a.serviceId].count++; });
    if (!r.assignments || r.assignments.length === 0) r.services.forEach(sid => { if (!svcMap[sid]) svcMap[sid] = { income:0, count:0 }; svcMap[sid].count++; });
  });
  const svcBreakdown = document.getElementById('rpt-services-breakdown');
  if (svcBreakdown) {
    const entries = Object.entries(svcMap).sort((a,b)=>b[1].income-a[1].income);
    svcBreakdown.innerHTML = entries.length === 0 ? '<p class="text-sm font-body text-on-surface-variant py-2">No services in this period.</p>'
      : entries.map(([sid,data])=>{ const s = svc(sid); return `<div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between cursor-pointer hover:bg-surface-container transition-colors" onclick="drillDownService('${sid}')"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-primary flex items-center justify-center"><span class="text-xs font-headline font-bold text-on-primary">${s?.abbr||'?'}</span></div><div><div class="font-headline font-semibold text-on-surface text-sm">${s?.label||sid}</div><div class="text-xs font-body text-on-surface-variant">${data.count} time${data.count!==1?'s':''} · tap for details</div></div></div><div class="flex items-center gap-3"><div class="font-headline font-bold text-on-surface">$${data.income.toFixed(2)}</div><span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px">chevron_right</span></div></div>`; }).join('');
  }

  // Per-fee + per-item
  const feeMap = {};
  filtered.forEach(r => (r.fees||[]).forEach(f => { if (!f.feeId) return; if (!feeMap[f.feeId]) feeMap[f.feeId] = { total:0, count:0 }; feeMap[f.feeId].total += f.amount||0; feeMap[f.feeId].count++; }));
  const feesBreakdown = document.getElementById('rpt-fees-breakdown');
  if (feesBreakdown) {
    const entries = Object.entries(feeMap).sort((a,b)=>b[1].total-a[1].total);
    feesBreakdown.innerHTML = entries.length === 0 ? '<p class="text-sm font-body text-on-surface-variant py-2">No fees charged in this period.</p>'
      : entries.map(([feeId,data])=>{ const fee = cfg().fees.find(f=>f.id===feeId); return `<div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(26,82,82,0.10)"><span class="material-symbols-outlined" style="font-size:16px;color:#1a5252">receipt</span></div><div><div class="font-headline font-semibold text-on-surface text-sm">${fee?.label||feeId}</div><div class="text-xs font-body text-on-surface-variant">${data.count} time${data.count!==1?'s':''} charged</div></div></div><div class="font-headline font-bold text-on-surface">$${data.total.toFixed(2)}</div></div>`; }).join('');
  }
  const itemMap = {};
  filtered.forEach(r => (r.items||[]).forEach(x => { if (!x.itemId || !x.qty || x.qty <= 0) return; if (!itemMap[x.itemId]) itemMap[x.itemId] = { revenue:0, qty:0 }; itemMap[x.itemId].revenue += (x.price||0)*(x.qty||0); itemMap[x.itemId].qty += x.qty||0; }));
  const itemBreakdown = document.getElementById('rpt-items-breakdown');
  if (itemBreakdown) {
    const entries = Object.entries(itemMap).sort((a,b)=>b[1].revenue-a[1].revenue);
    itemBreakdown.innerHTML = entries.length === 0 ? '<p class="text-sm font-body text-on-surface-variant py-2">No retail items sold in this period.</p>'
      : entries.map(([itemId,data])=>{ const item = cfg().items.find(i=>i.id===itemId); return `<div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(92,64,16,0.12)"><span class="text-xs font-headline font-bold" style="color:#5c4010">${item?.abbr||'?'}</span></div><div><div class="font-headline font-semibold text-on-surface text-sm">${item?.label||itemId}</div><div class="text-xs font-body text-on-surface-variant">${data.qty} unit${data.qty!==1?'s':''} sold</div></div></div><div class="font-headline font-bold text-on-surface">$${data.revenue.toFixed(2)}</div></div>`; }).join('');
  }

  // Gift cards — own subtotals, NOT folded into service income (a sale is a
  // liability until redeemed; counting both the sale and the later redemption
  // against a service would double-count). Sold/redeemed scoped to the period
  // by datePurchased / dateUsed; outstanding balance is point-in-time (all cards).
  const inPeriod = ds => ds && ds >= localDateStr(from) && ds <= localDateStr(to);
  const gcSold = giftCards().filter(g => inPeriod(g.datePurchased));
  const gcSoldValue = gcSold.reduce((s,g)=>s+(g.amount||0),0);
  const gcRedeemed = giftCards().filter(g => inPeriod(g.dateUsed)).reduce((s,g)=>s+(g.amountUsed||0),0);
  const gcOutstanding = giftCards().reduce((s,g)=>s+((g.amount||0)-(g.amountUsed||0)),0);
  set('rpt-gc-sold', `$${gcSoldValue.toFixed(2)}`);
  set('rpt-gc-redeemed', `$${gcRedeemed.toFixed(2)}`);
  const gcBreakdown = document.getElementById('rpt-giftcards-breakdown');
  if (gcBreakdown) {
    const row = (label, value, sub) => `<div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between"><div><div class="font-headline font-semibold text-on-surface text-sm">${label}</div><div class="text-xs font-body text-on-surface-variant">${sub}</div></div><div class="font-headline font-bold text-on-surface">${value}</div></div>`;
    gcBreakdown.innerHTML =
      row('Gift Cards Sold', `$${gcSoldValue.toFixed(2)}`, `${gcSold.length} card${gcSold.length!==1?'s':''} sold this period`) +
      row('Redeemed', `$${gcRedeemed.toFixed(2)}`, 'Used this period (not counted as service income)') +
      row('Outstanding Balance', `$${gcOutstanding.toFixed(2)}`, 'Unredeemed value across all gift cards');
  }

  window._currentReportData = { filtered, from, to, totalIncome, guestCount, avgTicket, staffMap, svcMap, gcSoldValue, gcRedeemed, gcOutstanding };
}

// ── Drill-downs ───────────────────────────────────
export function drillDownStaff(techId) {
  const d = window._currentReportData; if (!d) return;
  const tech = staffById(techId), name = tech?.name || 'Unknown', commPct = tech?.commission != null ? tech.commission : null;
  const rows = [];
  d.filtered.forEach(r => (r.assignments||[]).forEach(a => { if (a.techId !== techId) return; rows.push({ customer: r.name, serviceId: a.serviceId, service: svc(a.serviceId)?.label || a.serviceId, cost: a.cost||0, comm: commPct!=null?(a.cost||0)*commPct/100:null, station: a.station||'', time: new Date(r.checkinTime), turnType: classifyTurn(a.cost||0, a.serviceId||''), durMs: a.serviceMs||0 }); }));
  const totalBilled = rows.reduce((s,r)=>s+r.cost,0);
  const totalComm = commPct != null ? totalBilled*commPct/100 : null;
  const totalTurns = rows.reduce((s,r)=>s+(r.turnType==='full'?1:r.turnType==='half'?0.5:0),0);
  const summary = `<div class="bg-primary/10 rounded-xl border border-primary/30 flex divide-x divide-primary/20 mb-4">
    <div class="flex-1 px-4 py-3 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Total Billed</div><div class="font-headline font-bold text-on-surface text-lg">$${totalBilled.toFixed(2)}</div></div>
    ${totalComm!=null?`<div class="flex-1 px-4 py-3 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Commission (${commPct}%)</div><div class="font-headline font-bold text-primary text-lg">$${totalComm.toFixed(2)}</div></div><div class="flex-1 px-4 py-3 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Salon Keeps</div><div class="font-headline font-bold text-on-surface text-lg">$${(totalBilled-totalComm).toFixed(2)}</div></div>`:''}
    <div class="flex-1 px-4 py-3 text-center"><div class="text-[10px] font-body text-on-surface-variant uppercase tracking-widest">Turns</div><div class="font-headline font-bold text-primary text-lg">${totalTurns}</div></div></div>`;
  // Average service time per service this tech performed (outlier-filtered, all-time
  // benchmark — the same number the live bubbles compare against). "—" until there
  // are enough clean samples.
  const avgBySvc = [...new Set(rows.map(r => r.serviceId).filter(Boolean))].map(sid => {
    const { avgMs, n } = avgServiceTime(techId, sid);
    return { label: svc(sid)?.label || sid, avgMs, n };
  });
  const avgBlock = avgBySvc.length ? `<div class="mb-4">
    <div class="text-[11px] font-body text-on-surface-variant uppercase tracking-widest mb-1.5">Avg Service Time</div>
    <div class="flex flex-wrap gap-1.5">${avgBySvc.map(x => `<span class="text-xs font-body bg-surface-container-lowest border border-surface-container-high rounded-lg px-2.5 py-1"><span class="text-on-surface font-semibold">${x.label}</span> · <span class="${x.avgMs!=null?'text-primary font-bold':'text-outline'}">${x.avgMs!=null?'~'+fmtDur(x.avgMs):'—'}</span>${x.avgMs!=null?`<span class="text-outline"> (${x.n})</span>`:''}</span>`).join('')}</div></div>` : '';
  const rowsHtml = rows.map(row => { const badge = row.turnType==='full'?'1t':row.turnType==='half'?'½t':'B'; const color = row.turnType==='bonus'?'#f5c870':'#1a5252'; return `<div class="bg-surface-container-lowest rounded-xl px-4 py-3 border border-surface-container-high flex items-center justify-between"><div class="min-w-0"><div class="flex items-center gap-2"><span class="font-headline font-semibold text-on-surface text-sm">${row.customer}</span><span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style="background:${color}20;color:${color}">${badge}</span>${row.durMs?`<span class="text-[10px] font-body text-on-surface-variant">${fmtDur(row.durMs)}</span>`:''}</div><div class="text-xs font-body text-on-surface-variant">${row.service}${row.station?' · '+row.station:''}</div><div class="text-[11px] font-body text-outline">${row.time.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${row.time.toLocaleDateString()}</div></div><div class="text-right flex-shrink-0 ml-3"><div class="font-headline font-bold text-on-surface">$${row.cost.toFixed(2)}</div>${row.comm!=null?`<div class="text-xs font-body text-primary">comm $${row.comm.toFixed(2)}</div>`:''}</div></div>`; }).join('');
  showDrillPanel(`${name} — Service Detail`, summary + avgBlock + rowsHtml);
}
export function drillDownService(sid) {
  const d = window._currentReportData; if (!d) return;
  const s = svc(sid), rows = [];
  d.filtered.forEach(r => (r.assignments||[]).forEach(a => { if (a.serviceId !== sid) return; rows.push({ customer: r.name, tech: staffById(a.techId)?.name || '—', cost: a.cost||0, station: a.station||'', time: new Date(r.checkinTime) }); }));
  showDrillPanel(`${s?.label||sid} — Detail`, rows.map(row => `<div class="bg-surface-container-lowest rounded-xl px-5 py-3 border border-surface-container-high flex items-center justify-between"><div><div class="font-headline font-semibold text-on-surface text-sm">${row.customer}</div><div class="text-xs font-body text-on-surface-variant">Tech: ${row.tech}${row.station?' · '+row.station:''}</div><div class="text-[11px] font-body text-outline">${row.time.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${row.time.toLocaleDateString()}</div></div><div class="font-headline font-bold text-on-surface">$${row.cost.toFixed(2)}</div></div>`).join(''));
}
function showDrillPanel(title, html) {
  document.getElementById('rpt-drill-title').textContent = title;
  document.getElementById('rpt-drill-list').innerHTML = html || '<p class="text-sm font-body text-on-surface-variant">No detail available.</p>';
  document.getElementById('rpt-drill-panel').classList.remove('hidden');
  document.getElementById('rpt-drill-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export function closeDrillDown() { document.getElementById('rpt-drill-panel').classList.add('hidden'); }

// ── Payroll page (per-tech commission / check / cash by pay period, prev-period compare) ─
// Its own dashboard tab. Techs are cards (horizontal scroll); each shows Billed,
// Commission, Check, Cash + a per-day breakdown, each line compared to the previous
// pay period (▲ green / ▼ red + %). Check = staff paycheck setting (set $, set % of
// commission, or variable=manual entry here, stored per tech per period). Cash = comm − check.
let _payrollOffset = 0;   // 0 = current pay period, -1 = previous, +1 = next
function prevPayPeriod({ from }) {
  const pp = cfg().pay_period || {}, type = pp.type || 'weekly', msDay = 86400000;
  if (type === 'bimonthly') {
    if (from.getDate() <= 15) { const y = from.getFullYear(), m = from.getMonth() - 1; return { from: new Date(y, m, 16), to: new Date(y, m + 1, 0, 23,59,59) }; }
    return { from: new Date(from.getFullYear(), from.getMonth(), 1), to: new Date(from.getFullYear(), from.getMonth(), 15, 23,59,59) };
  }
  const len = type === 'biweekly' ? 14 : 7;
  const f = new Date(from.getTime() - len * msDay); f.setHours(0,0,0,0);
  const t = new Date(from.getTime() - msDay); t.setHours(23,59,59,999);
  return { from: f, to: t };
}
function nextPayPeriod({ from }) {
  const pp = cfg().pay_period || {}, type = pp.type || 'weekly', msDay = 86400000;
  if (type === 'bimonthly') {
    if (from.getDate() <= 15) return { from: new Date(from.getFullYear(), from.getMonth(), 16), to: new Date(from.getFullYear(), from.getMonth() + 1, 0, 23,59,59) };
    const y = from.getFullYear(), m = from.getMonth() + 1; return { from: new Date(y, m, 1), to: new Date(y, m, 15, 23,59,59) };
  }
  const len = type === 'biweekly' ? 14 : 7;
  const f = new Date(from.getTime() + len * msDay); f.setHours(0,0,0,0);
  const t = new Date(f.getTime() + (len - 1) * msDay); t.setHours(23,59,59,999);
  return { from: f, to: t };
}
function payrollPeriodAt(offset) {
  let p = payPeriodDates(new Date());
  const step = offset < 0 ? prevPayPeriod : nextPayPeriod;
  for (let i = 0; i < Math.abs(offset); i++) p = step(p);
  return p;
}
function payrollDaysInRange(from, to) {
  const days = [], d = new Date(from.getFullYear(), from.getMonth(), from.getDate()), end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d <= end) { days.push(localDateStr(new Date(d))); d.setDate(d.getDate() + 1); }
  return days;
}
function payrollRange(from, to) {
  const recs = buildCombinedRecords().filter(r => { if (r.status === 'deleted' || r.status === 'refund' || !isPaidStatus(r.status)) return false; const d = new Date(r.checkinTime); return d >= from && d <= to; });
  const byTech = {};
  recs.forEach(r => (r.assignments || []).forEach(a => {
    if (!a.techId) return;
    const tech = staffById(a.techId), pct = tech?.commission != null ? tech.commission : 0, cost = a.cost || 0, comm = cost * pct / 100;
    const t = byTech[a.techId] = byTech[a.techId] || { billed: 0, commission: 0, daily: {} };
    t.billed += cost; t.commission += comm;
    const day = localDateStr(new Date(r.checkinTime));
    const dd = t.daily[day] = t.daily[day] || { billed: 0, commission: 0 };
    dd.billed += cost; dd.commission += comm;
  }));
  return byTech;
}
function techCheckAmount(tech, commission, perKey) {
  const type = tech?.checkType || 'variable';
  if (type === 'amount') return tech.checkValue || 0;
  if (type === 'percent') return commission * (tech.checkValue || 0) / 100;
  const m = (cfg().payroll_checks || {})[tech.id + ':' + perKey];
  return m != null ? m : 0;
}
export function payrollSetCheck(techId, val) {
  const perKey = localDateStr(payrollPeriodAt(_payrollOffset).from);
  const checks = { ...(cfg().payroll_checks || {}) };
  const n = parseFloat(val);
  if (!isNaN(n) && n !== 0) checks[techId + ':' + perKey] = n; else delete checks[techId + ':' + perKey];
  dispatch('config.set', { key: 'payroll_checks', value: checks });
  renderPayrollPage();
}
export function payrollNav(dir) { _payrollOffset += dir; renderPayrollPage(); }
const _pcmp = (cur, prev) => {
  if (!prev && !cur) return '';
  if (!prev) return '<span style="color:#16a34a;font-size:9px;font-weight:800">▲</span>';
  const up = cur >= prev;
  return `<span style="color:${up ? '#16a34a' : '#dc2626'};font-size:9px;font-weight:800">${up ? '▲' : '▼'} ${Math.abs((cur - prev) / prev * 100).toFixed(0)}%</span>`;
};
const _m2 = n => '$' + (n || 0).toFixed(2);
export function renderPayrollPage() {
  const wrap = document.getElementById('payroll-cards'); if (!wrap) return;
  const cur = payrollPeriodAt(_payrollOffset), prev = prevPayPeriod(cur);
  const fmtD = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lbl = document.getElementById('payroll-period-label');
  if (lbl) lbl.textContent = `${fmtD(cur.from)} – ${fmtD(cur.to)}${_payrollOffset === 0 ? ' · current' : ''}`;
  const curData = payrollRange(cur.from, cur.to), prevData = payrollRange(prev.from, prev.to);
  const curKey = localDateStr(cur.from), prevKey = localDateStr(prev.from);
  const curDays = payrollDaysInRange(cur.from, cur.to), prevDays = payrollDaysInRange(prev.from, prev.to);
  const order = cfg().turns_order || [];
  const techs = (cfg().staff || []).filter(s => !cfg().inactive_staff.includes(s.id))
    .sort((a, b) => { const ra = order.indexOf(a.id), rb = order.indexOf(b.id); return (ra === -1 ? 1e9 : ra) - (rb === -1 ? 1e9 : rb); });
  if (!techs.length) { wrap.innerHTML = '<div class="text-sm text-on-surface-variant py-8 text-center w-full">No technicians configured.</div>'; return; }
  wrap.innerHTML = techs.map(tech => {
    const c = curData[tech.id] || { billed: 0, commission: 0, daily: {} };
    const p = prevData[tech.id] || { billed: 0, commission: 0, daily: {} };
    const cCheck = techCheckAmount(tech, c.commission, curKey), pCheck = techCheckAmount(tech, p.commission, prevKey);
    const cCash = Math.max(0, c.commission - cCheck), pCash = Math.max(0, p.commission - pCheck);
    const isVar = (tech.checkType || 'variable') === 'variable';
    const line = (label, cv, pv) => `<div class="flex items-center justify-between gap-2 py-1"><span class="text-on-surface-variant text-xs">${label}</span><span class="flex items-center gap-1.5"><span class="font-headline font-bold text-on-surface text-sm">${_m2(cv)}</span>${_pcmp(cv, pv)}</span></div>`;
    const checkRow = isVar
      ? `<div class="flex items-center justify-between gap-2 py-1"><span class="text-on-surface-variant text-xs">Check</span><span class="flex items-center gap-1.5"><input type="number" min="0" step="1" value="${cCheck || ''}" placeholder="0" onchange="payrollSetCheck('${tech.id}',this.value)" class="w-16 bg-surface-container border border-surface-container-high rounded px-1.5 py-0.5 text-sm font-headline font-bold text-right text-on-surface focus:outline-none focus:border-primary">${_pcmp(cCheck, pCheck)}</span></div>`
      : line(`Check${tech.checkType === 'percent' ? ` (${tech.checkValue || 0}%)` : ''}`, cCheck, pCheck);
    const days = curDays.map((day, i) => {
      const cd = c.daily[day] || { billed: 0, commission: 0 };
      const pd = p.daily[prevDays[i]] || { billed: 0, commission: 0 };
      const dlabel = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      return `<div class="flex items-center justify-between gap-2 py-0.5 text-[11px]"><span class="text-on-surface-variant">${dlabel}</span><span class="flex items-center gap-1"><span class="${cd.billed ? 'text-on-surface' : 'text-outline-variant'}">$${cd.billed.toFixed(0)}/$${cd.commission.toFixed(0)}</span>${_pcmp(cd.commission, pd.commission)}</span></div>`;
    }).join('');
    return `<div class="flex-shrink-0 w-64 bg-surface-container-lowest rounded-2xl border border-surface-container-high p-4">
      <div class="font-headline font-bold text-on-surface text-base mb-2 truncate">${tech.name}${tech.commission != null ? ` <span class="text-xs font-body text-on-surface-variant">${tech.commission}%</span>` : ''}</div>
      <div class="space-y-0.5 border-b border-surface-container-high pb-2 mb-2">
        ${line('Billed', c.billed, p.billed)}${line('Commission', c.commission, p.commission)}${checkRow}${line('Cash', cCash, pCash)}
      </div>
      <div class="text-[10px] font-body font-semibold text-outline uppercase tracking-widest mb-1">By day · billed/comm</div>
      <div>${days}</div>
    </div>`;
  }).join('');
}
function payrollExportRows() {
  const cur = payrollPeriodAt(_payrollOffset), data = payrollRange(cur.from, cur.to), perKey = localDateStr(cur.from);
  const order = cfg().turns_order || [];
  return {
    cur,
    rows: (cfg().staff || []).filter(s => !cfg().inactive_staff.includes(s.id))
      .sort((a, b) => { const ra = order.indexOf(a.id), rb = order.indexOf(b.id); return (ra === -1 ? 1e9 : ra) - (rb === -1 ? 1e9 : rb); })
      .map(t => { const c = data[t.id] || { billed: 0, commission: 0 }; const chk = techCheckAmount(t, c.commission, perKey); return { name: t.name, billed: c.billed, commission: c.commission, check: chk, cash: Math.max(0, c.commission - chk) }; })
      .filter(r => r.billed || r.commission || r.check),
  };
}
export function payrollExportCSV() {
  const { cur, rows } = payrollExportRows();
  if (!rows.length) { showToast('No payroll data for this period.'); return; }
  const fmt = d => d.toLocaleDateString();
  const t = k => rows.reduce((s, r) => s + r[k], 0);
  const matrix = [
    ['Muse Nails & Spa — Payroll'], [`Pay period: ${fmt(cur.from)} – ${fmt(cur.to)}`], [],
    ['Technician', 'Billed', 'Commission', 'Check', 'Cash'],
    ...rows.map(r => [r.name, `$${r.billed.toFixed(2)}`, `$${r.commission.toFixed(2)}`, `$${r.check.toFixed(2)}`, `$${r.cash.toFixed(2)}`]),
    [], ['Totals', `$${t('billed').toFixed(2)}`, `$${t('commission').toFixed(2)}`, `$${t('check').toFixed(2)}`, `$${t('cash').toFixed(2)}`],
  ];
  const csv = matrix.map(line => line.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `muse-payroll-${localDateStr(cur.from)}.csv`; a.click(); URL.revokeObjectURL(url);
  showToast('Payroll exported as CSV');
}
export function payrollExportPDF() {
  const { cur, rows } = payrollExportRows();
  if (!rows.length) { showToast('No payroll data for this period.'); return; }
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const period = `${fmt(cur.from)} – ${fmt(cur.to)}`, logo = cfg().logo || LOGO_PATH, t = k => rows.reduce((s, r) => s + r[k], 0);
  const tr = rows.map(r => `<tr><td>${_eTxn(r.name)}</td><td style="text-align:right">$${r.billed.toFixed(2)}</td><td style="text-align:right">$${r.commission.toFixed(2)}</td><td style="text-align:right">$${r.check.toFixed(2)}</td><td style="text-align:right">$${r.cash.toFixed(2)}</td><td></td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muse Payroll — ${_eTxn(period)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:24px}.h{display:flex;align-items:center;gap:14px;margin-bottom:6px}.logo{max-width:140px;max-height:54px;width:auto;height:auto;object-fit:contain;border-radius:8px;flex-shrink:0}
    h1{color:#1a5252;font-size:19px;margin:0 0 2px}.sub{color:#666;margin:0;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1a5252;color:#fff;padding:7px 9px;text-align:left;font-size:11px}td{padding:8px 9px;border-bottom:1px solid #e0e0e0;font-size:12px}tr:nth-child(even) td{background:#fafafa}
    tfoot td{font-weight:800;border-top:2px solid #1a5252;background:#fff}
    .footer{margin-top:22px;font-size:10px;color:#999;text-align:center}
  </style></head><body>
    <div class="h">${logo ? `<img src="${logo}" class="logo" onerror="this.style.display='none'">` : ''}<div><h1>Muse Nails &amp; Spa — Payroll</h1><p class="sub">Pay period ${_eTxn(period)}</p></div></div>
    <table><thead><tr><th>Technician</th><th>Billed</th><th>Commission</th><th>Check</th><th>Cash</th><th>Signature</th></tr></thead><tbody>${tr}</tbody>
    <tfoot><tr><td>Totals</td><td style="text-align:right">$${t('billed').toFixed(2)}</td><td style="text-align:right">$${t('commission').toFixed(2)}</td><td style="text-align:right">$${t('check').toFixed(2)}</td><td style="text-align:right">$${t('cash').toFixed(2)}</td><td></td></tr></tfoot></table>
    <div class="footer">Generated ${new Date().toLocaleString()} · Muse Nails &amp; Spa</div></body></html>`;
  const u = URL.createObjectURL(new Blob([html], { type: 'text/html' })); const w = window.open(u, '_blank'); if (w) setTimeout(() => w.print(), 600); URL.revokeObjectURL(u);
  showToast('Payroll PDF opened — Print → Save as PDF');
}

// ── Transactions list ─────────────────────────────
export function txnToday() { setReportRange('today'); }
export function renderTransactions() {
  const list = document.getElementById('txn-list'), empty = document.getElementById('txn-empty');
  if (!list) return;
  syncRangeButtons();
  const dates = getReportDates();   // shared Reports window (Today / Week / Month / Custom)
  const banner = document.getElementById('txn-history-banner');
  if (banner) {
    const notToday = reportRange.type !== 'today';
    banner.classList.toggle('hidden', !notToday);
    const bt = document.getElementById('txn-history-banner-text');
    if (notToday && bt) bt.textContent = `Showing: ${rangeLabel()}`;
  }
  let combined = buildCombinedRecords();
  if (dates) combined = combined.filter(r => { const d = new Date(r.checkinTime); return d >= dates.from && d <= dates.to; });
  combined = combined.filter(r => isPaidStatus(r.status) || r.status === 'refund').sort((a,b)=>new Date(b.checkinTime)-new Date(a.checkinTime));
  if (combined.length === 0) { list.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  const letters = partyLetterMap(combined);
  const txnCard = (r) => {
    const dt = new Date(r.checkinTime);
    const timeStr = dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), dateStr = dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const isRefund = r.status === 'refund';
    const badgeClass = isRefund ? 'badge-refund' : ({ waiting:'badge-waiting', inservice:'badge-inservice', complete:'badge-complete', paid:'badge-done', done:'badge-done' }[r.status] || 'badge-done');
    const serviceLabels = (r.services||[]).map(sid => svc(sid)?.label||sid).join(', ') || '—';
    const assignRows = !isRefund && (r.assignments||[]).filter(a=>a.techId||a.cost).map(a=>`<div class="text-[11px] font-body text-primary">${svc(a.serviceId)?.label||''} → ${staffById(a.techId)?.name||'—'}${a.station?' @ '+a.station:''} ${a.cost?'· $'+a.cost.toFixed(2):''}</div>`).join('');
    const refundNote = isRefund && r.discountNote ? `<div class="text-[11px] font-body text-error mt-1">Reason: ${r.discountNote}</div>` : '';
    const isPast = new Date(r.checkinTime) < new Date(new Date().setHours(0,0,0,0));
    const totalDisplay = isRefund ? `<div class="text-lg font-headline font-extrabold text-error">-$${Math.abs(r.totalCost||0).toFixed(2)}</div>` : `<div class="text-lg font-headline font-extrabold text-primary">$${(r.totalCost||0).toFixed(2)}</div>`;
    return `<div class="bg-surface-container-lowest rounded-xl px-5 py-4 border ${isRefund?'border-error/30':'border-surface-container-high'}">
      <div class="flex items-start justify-between"><div class="flex-grow min-w-0">
        <div class="flex items-center gap-2 flex-wrap mb-1"><span class="font-headline font-bold text-on-surface">${r.name}</span><span class="text-[11px] px-2 py-0.5 rounded-full font-body font-semibold ${badgeClass}">${isRefund?'refund':r.status}</span>${!isRefund&&r.isAppointment?'<span class="badge-appointment text-[11px] px-2 py-0.5 rounded-full font-body font-semibold">Appt</span>':''}</div>
        <div class="text-xs font-body text-on-surface-variant mb-1">${serviceLabels}</div>${assignRows||''}${refundNote}
        <div class="text-[11px] font-body text-outline mt-1">${dateStr} · ${timeStr}${r.phone?' · '+r.phone:''}</div></div>
        <div class="text-right ml-4 flex-shrink-0 flex flex-col items-end gap-2">${totalDisplay}
          ${!isRefund&&canDo('historicalEntry')&&isPast?`<button onclick="showHistoricalEntryModal('${r.id}')" class="flex items-center gap-1 text-[11px] font-body text-outline hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"><span class="material-symbols-outlined" style="font-size:14px">edit</span> Edit</button>`:''}
          ${!isRefund&&canDo('refund')?`<button onclick="initiateRefund('${r.id}')" class="flex items-center gap-1 text-[11px] font-body text-outline hover:text-secondary transition-colors px-2 py-1 rounded-lg hover:bg-secondary/10"><span class="material-symbols-outlined" style="font-size:14px">undo</span> Refund</button>`:''}
          ${canDo('deleteTransaction')?`<button onclick="initiateDeleteTransaction('${r.id}')" class="flex items-center gap-1 text-[11px] font-body text-outline hover:text-error transition-colors px-2 py-1 rounded-lg hover:bg-error/10"><span class="material-symbols-outlined" style="font-size:14px">delete</span> Delete</button>`:''}
        </div></div></div>`;
  };
  // Bracket a party (paid records sharing a groupId) under a header with a combined total,
  // so it's clear at a glance who was checked in / paid together. Solos render as-is.
  const blocks = []; const partyIdx = {};
  combined.forEach(r => {
    if (r.groupId && r.status !== 'refund') {
      if (partyIdx[r.groupId] == null) { partyIdx[r.groupId] = blocks.length; blocks.push({ type:'party', groupId:r.groupId, color:r.groupColor||'#1a5252', members:[] }); }
      blocks[partyIdx[r.groupId]].members.push(r);
    } else blocks.push({ type:'solo', record:r });
  });
  list.innerHTML = blocks.map(b => {
    if (b.type === 'solo') return txnCard(b.record);
    if (b.members.length === 1) return txnCard(b.members[0]);
    // A party was charged together in Square, so show ONE transaction with the
    // combined total (matching the Square report). Tap to expand the per-customer
    // tickets, which keep their own Refund / Delete / Edit actions.
    const total = b.members.reduce((s,m)=>s+(m.totalCost||0),0), c = b.color, letter = letters.get(b.groupId) || '•';
    const primary = (b.members.find(m=>/\(primary\)/i.test(m.groupLabel||'')) || b.members[0]).name;
    const dt = new Date(b.members[0].checkinTime);
    const timeStr = dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), dateStr = dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const svcSet = [...new Set(b.members.flatMap(m => (m.services||[]).map(sid => svc(sid)?.label||sid)))];
    const svcSummary = svcSet.slice(0,5).join(', ') + (svcSet.length>5?'…':'');
    return `<div style="border:1.5px solid ${c}66;background:${c}0d;border-radius:14px;overflow:hidden">
      <div onclick="togglePartyTxn(this)" class="cursor-pointer px-5 py-4 flex items-start justify-between">
        <div class="flex-grow min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:${c};color:#fff;font-size:11px;font-weight:800;flex-shrink:0">${letter}</span>
            <span class="font-headline font-bold text-on-surface">${primary} · party of ${b.members.length}</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-body font-semibold badge-done">paid</span>
            <span class="material-symbols-outlined party-chevron text-on-surface-variant" style="font-size:18px;transition:transform .15s">expand_more</span>
          </div>
          <div class="text-xs font-body text-on-surface-variant mb-1">${svcSummary || '—'}</div>
          <div class="text-[11px] font-body text-outline">${dateStr} · ${timeStr} · tap to expand</div>
        </div>
        <div class="text-right ml-4 flex-shrink-0"><div class="text-lg font-headline font-extrabold" style="color:${c}">$${total.toFixed(2)}</div></div>
      </div>
      <div class="party-members hidden space-y-2 px-2 pb-2">${b.members.map(txnCard).join('')}</div>
    </div>`;
  }).join('');
}
// Expand/collapse a party transaction's per-customer tickets.
export function togglePartyTxn(headerEl) {
  const members = headerEl.parentElement.querySelector('.party-members');
  const chev = headerEl.querySelector('.party-chevron');
  if (!members) return;
  members.classList.toggle('hidden');
  if (chev) chev.style.transform = members.classList.contains('hidden') ? '' : 'rotate(180deg)';
}
export function updateHistoricalButtonVisibility() { document.getElementById('add-historical-btn')?.classList.toggle('hidden', !canDo('historicalEntry')); }

// ── Transactions export (every ticket expanded, current shared date window) ───
// One row per customer/ticket (parties are NOT collapsed here — the owner wants the
// full breakdown). The Party column carries the group letter so members of one Square
// charge can be summed back together. Matches whatever range the Transactions tab shows.
function txnExportRecords() {
  const dates = getReportDates();
  let combined = buildCombinedRecords();
  if (dates) combined = combined.filter(r => { const d = new Date(r.checkinTime); return d >= dates.from && d <= dates.to; });
  return combined.filter(r => isPaidStatus(r.status) || r.status === 'refund')
    .sort((a,b) => new Date(a.checkinTime) - new Date(b.checkinTime));
}
function txnRow(r, letter) {
  const dt = new Date(r.checkinTime), isRefund = r.status === 'refund';
  const services = (r.services||[]).map(sid => svc(sid)?.label||sid).join('; ');
  const techs = [...new Set((r.assignments||[]).filter(a=>a.techId).map(a=>staffById(a.techId)?.name).filter(Boolean))].join('; ');
  const items = (r.items||[]).map(i => `${cfg().items.find(x=>x.id===i.itemId)?.label||'Item'}×${i.qty}`).join('; ');
  const feeAmt = (r.fees||[]).reduce((s,f)=>s+(f.amount||0),0);
  return {
    date: dt.toLocaleDateString(), time: dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
    customer: r.name||'', phone: r.phone||'', party: r.groupId ? (letter||'•') : '',
    services, techs, items, fees: feeAmt ? feeAmt.toFixed(2) : '', discount: r.discount ? r.discount.toFixed(2) : '',
    total: (isRefund?'-':'') + '$' + Math.abs(r.totalCost||0).toFixed(2), totalNum: isRefund ? -Math.abs(r.totalCost||0) : (r.totalCost||0),
    status: isRefund ? 'refund' : 'paid',
  };
}
function txnExportRows() {
  const recs = txnExportRecords();
  const letters = partyLetterMap(recs);
  return recs.map(r => txnRow(r, letters.get(r.groupId)));
}
export function exportTransactionsCSV() {
  const rows = txnExportRows();
  if (!rows.length) { showToast('No transactions to export.'); return; }
  const net = rows.reduce((s,r)=>s+r.totalNum,0);
  const matrix = [
    ['Muse Nails & Spa — Transactions'], [`Showing: ${rangeLabel()}`], [`Tickets: ${rows.length}`, `Net total: $${net.toFixed(2)}`], [],
    ['Date','Time','Customer','Phone','Party','Services','Technicians','Items','Fees','Discount','Total','Status'],
    ...rows.map(r => [r.date, r.time, r.customer, r.phone, r.party, r.services, r.techs, r.items, r.fees, r.discount, r.total, r.status]),
  ];
  const csv = matrix.map(line => line.map(c => `"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿'+csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `muse-transactions-${localDateStr(getReportDates()?.from || new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
  showToast('Transactions exported as CSV (opens in Excel)');
}
export function exportTransactionsPDF() {
  const rows = txnExportRows();
  if (!rows.length) { showToast('No transactions to export.'); return; }
  const url = URL.createObjectURL(new Blob([buildTxnHtml(rows)], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (win) setTimeout(() => win.print(), 600);
  URL.revokeObjectURL(url);
  showToast('PDF opened — use Print → Save as PDF');
}
const _eTxn = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function buildTxnHtml(rows) {
  const logo = cfg().logo || LOGO_PATH;
  const net = rows.reduce((s,r)=>s+r.totalNum,0);
  const tr = rows.map(r => `<tr><td>${r.date}</td><td>${r.time}</td><td>${_eTxn(r.customer)}</td><td style="text-align:center">${r.party}</td><td>${_eTxn(r.services)}</td><td>${_eTxn(r.techs)}</td><td>${_eTxn(r.items)}</td><td style="text-align:right">${r.fees?'$'+r.fees:''}</td><td style="text-align:right">${r.discount?'-$'+r.discount:''}</td><td style="text-align:right">${r.total}</td><td>${r.status}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muse Transactions — ${_eTxn(rangeLabel())}</title><style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:20px}.h{display:flex;align-items:center;gap:14px;margin-bottom:6px}.logo{max-width:140px;max-height:52px;width:auto;height:auto;object-fit:contain;border-radius:8px;flex-shrink:0}
    h1{color:#1a5252;font-size:18px;margin:0 0 2px}.sub{color:#666;margin:0;font-size:12px}
    .tot{background:#1a5252;color:#fff;border-radius:10px;padding:10px 16px;display:inline-block;margin:12px 0 16px}.tot .v{font-size:22px;font-weight:800;line-height:1}.tot .l{font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.85}
    table{width:100%;border-collapse:collapse}th{background:#1a5252;color:#fff;padding:5px 6px;text-align:left;font-size:10px}td{padding:4px 6px;border-bottom:1px solid #e0e0e0;font-size:10px;vertical-align:top}tr:nth-child(even) td{background:#fafafa}
    .footer{margin-top:20px;font-size:10px;color:#999;text-align:center}
  </style></head><body>
    <div class="h">${logo?`<img src="${logo}" class="logo" onerror="this.style.display='none'">`:''}<div><h1>Muse Nails &amp; Spa — Transactions</h1><p class="sub">${_eTxn(rangeLabel())} · ${rows.length} ticket${rows.length===1?'':'s'}</p></div></div>
    <div class="tot"><div class="v">$${net.toFixed(2)}</div><div class="l">Net total</div></div>
    <table><thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Party</th><th>Services</th><th>Tech</th><th>Items</th><th>Fees</th><th>Disc</th><th>Total</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table>
    <div class="footer">Generated ${new Date().toLocaleString()} · Muse Nails &amp; Spa</div></body></html>`;
}

// ── CSV export ────────────────────────────────────
export function exportReportExcel() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }
  const rows = [
    ['Muse Nails & Spa — Report'], [`Period: ${d.from.toLocaleDateString()} – ${d.to.toLocaleDateString()}`],
    [`Total Income: $${d.totalIncome.toFixed(2)}`, `Guests Served: ${d.guestCount}`, `Avg Ticket: $${(d.totalIncome/Math.max(d.guestCount,1)).toFixed(2)}`], [],
    ['CHECK-INS'], ['Date','Time','Name','Phone','Services','Type','Staff','Total','Status'],
    ...d.filtered.map(r => { const dt = new Date(r.checkinTime); const staffNames = (r.assignments||[]).map(a=>staffById(a.techId)?.name).filter(Boolean).join(', '); return [dt.toLocaleDateString(), dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), r.name, r.phone, r.services.map(sid=>svc(sid)?.label||sid).join(', '), r.isAppointment?'Appointment':'Walk-In', staffNames, r.totalCost?`$${r.totalCost.toFixed(2)}`:'$0.00', r.status]; }),
    [], ['STAFF BREAKDOWN'], ['Technician','Services','Turns','Bonus Turns','Total Billed','Commission %','Commission Earned','Salon Keeps'],
    ...Object.entries(d.staffMap).map(([techId,data])=>{ const tech = staffById(techId); const commPct = tech?.commission!=null?tech.commission:null; const commAmt = commPct!=null?data.income*commPct/100:0; return [tech?.name||'Unknown', data.count, data.fullTurns+data.halfTurns, data.bonusTurns, `$${data.income.toFixed(2)}`, commPct!=null?`${commPct}%`:'N/A', `$${commAmt.toFixed(2)}`, `$${(data.income-commAmt).toFixed(2)}`]; }),
    [], ['GIFT CARDS (separate ledger — not in service income)'],
    ['Sold this period', `$${(d.gcSoldValue||0).toFixed(2)}`], ['Redeemed this period', `$${(d.gcRedeemed||0).toFixed(2)}`], ['Outstanding balance (all cards)', `$${(d.gcOutstanding||0).toFixed(2)}`],
  ];
  const csv = rows.map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `muse-report-${localDateStr(d.from)}.csv`; a.click(); URL.revokeObjectURL(url);
  showToast('Report downloaded as CSV (opens in Excel)');
}

// Shared report HTML builder (used by PDF print + R2 link export) — consolidates
// the two near-identical templates from the original.
function buildReportHtml(d) {
  const fmt = dt => new Date(dt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const fmtT = dt => new Date(dt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const period = d.from.toDateString() === d.to.toDateString() ? fmt(d.from) : `${fmt(d.from)} – ${fmt(d.to)}`;
  const staffEntries = Object.entries(d.staffMap).sort((a,b)=>b[1].income-a[1].income);
  const totalComm = staffEntries.reduce((sum,[tid,data])=>{ const t = staffById(tid); return sum + (t?.commission!=null?data.income*t.commission/100:0); }, 0);
  const shopKeeps = d.totalIncome - totalComm;
  const staffRows = staffEntries.map(([tid,data])=>{ const t = staffById(tid); const comm = t?.commission!=null?data.income*t.commission/100:null; const turns = data.fullTurns+data.halfTurns; return `<tr><td>${t?.name||'Unknown'}</td><td>${data.count}</td><td>${turns}t${data.bonusTurns>0?' +'+data.bonusTurns+'b':''}</td><td>$${data.income.toFixed(2)}</td><td>${t?.commission!=null?t.commission+'%':'—'}</td><td>${comm!=null?'$'+comm.toFixed(2):'—'}</td><td>${comm!=null?'$'+(data.income-comm).toFixed(2):'—'}</td></tr>`; }).join('');
  const txRows = d.filtered.map(r => { const dt = new Date(r.checkinTime); const staffNames = [...new Set((r.assignments||[]).filter(a=>a.techId).map(a=>staffById(a.techId)?.name||'').filter(Boolean))].join(', '); return `<tr><td>${dt.toLocaleDateString()}</td><td>${fmtT(dt)}</td><td>${r.name}</td><td>${r.services.map(sid=>svc(sid)?.label||sid).join(', ')}</td><td>${staffNames||'—'}</td><td>$${(r.totalCost||0).toFixed(2)}</td><td>${r.status}</td></tr>`; }).join('');
  const logo = cfg().logo || LOGO_PATH;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muse Report ${period}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:24px}.report-header{display:flex;align-items:center;gap:16px;margin-bottom:8px}.report-logo{max-width:140px;max-height:56px;width:auto;height:auto;object-fit:contain;border-radius:8px;flex-shrink:0}
    h1{color:#1a5252;font-size:20px;margin:0 0 2px}h2{color:#1a5252;font-size:14px;margin:20px 0 8px;border-bottom:2px solid #1a5252;padding-bottom:4px}
    .summary{display:flex;gap:24px;margin:12px 0 20px;flex-wrap:wrap}.card{background:#f5f5f5;border-radius:8px;padding:10px 16px;min-width:120px;text-align:center}.card .val{font-size:20px;font-weight:bold;color:#1a5252}.card .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.5px}.card.amber .val{color:#a05000}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#1a5252;color:#fff;padding:6px 8px;text-align:left;font-size:11px}td{padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px}tr:nth-child(even) td{background:#fafafa}.footer{margin-top:24px;font-size:10px;color:#999;text-align:center}
  </style></head><body>
    <div class="report-header">${logo?`<img src="${logo}" class="report-logo" onerror="this.style.display='none'">`:''}<div><h1>Muse Nails &amp; Spa — Daily Report</h1><p style="color:#666;margin:0">${period}</p></div></div>
    <div class="summary"><div class="card"><div class="val">$${d.totalIncome.toFixed(2)}</div><div class="lbl">Total Billed</div></div><div class="card"><div class="val">${d.guestCount}</div><div class="lbl">Guests Served</div></div><div class="card"><div class="val">$${(d.totalIncome/Math.max(d.guestCount,1)).toFixed(2)}</div><div class="lbl">Avg Ticket</div></div><div class="card"><div class="val">$${shopKeeps.toFixed(2)}</div><div class="lbl">Shop Keeps</div></div><div class="card amber"><div class="val">$${totalComm.toFixed(2)}</div><div class="lbl">Commission Owed</div></div></div>
    <h2>Staff Breakdown</h2><table><thead><tr><th>Technician</th><th>Services</th><th>Turns</th><th>Billed</th><th>Comm %</th><th>Commission</th><th>Shop Keeps</th></tr></thead><tbody>${staffRows}</tbody></table>
    <h2>Transactions (${d.filtered.length})</h2><table><thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Services</th><th>Staff</th><th>Total</th><th>Status</th></tr></thead><tbody>${txRows}</tbody></table>
    <div class="footer">Generated ${new Date().toLocaleString()} · Muse Nails &amp; Spa</div></body></html>`;
}

export function exportReportPDF() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }
  const url = URL.createObjectURL(new Blob([buildReportHtml(d)], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (win) setTimeout(() => win.print(), 600);
  URL.revokeObjectURL(url);
  showToast('PDF report opened — use Print → Save as PDF');
}
export async function exportReportLink() {
  const d = window._currentReportData;
  if (!d || d.filtered.length === 0) { showToast('No data to export.'); return; }
  showToast('Uploading report…');
  try {
    const res = await fetch(`${PHOTOS_PROXY}/reports/${localDateStr(d.from)}.html`, { method: 'PUT', body: new TextEncoder().encode(buildReportHtml(d)), headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    if (!res.ok) throw new Error(res.status);
    const url = (await res.json()).url;
    try { await navigator.clipboard.writeText(url); } catch (e) {}
    showToast('Link copied to clipboard ✓');
  } catch (e) { showToast('Upload failed — check connection'); }
}

// ── Refunds ───────────────────────────────────────
let _refundTxnId = null, _refundTxnRecord = null;
export function initiateRefund(recordId) {
  if (!canDo('refund')) { showToast('Permission denied'); return; }
  const rec = records().find(r => String(r.id) === String(recordId)) || buildCombinedRecords().find(r => String(r.id) === String(recordId));
  if (!rec) { showToast('Record not found.'); return; }
  if (rec.status === 'refund') { showToast('Cannot refund a refund.'); return; }
  _refundTxnId = String(recordId); _refundTxnRecord = rec;
  document.getElementById('refund-txn-name').textContent = rec.name;
  document.getElementById('refund-txn-original').textContent = `$${(rec.totalCost||0).toFixed(2)}`;
  document.getElementById('refund-amount').value = (rec.totalCost||0).toFixed(2);
  document.getElementById('refund-reason').value = '';
  const m = document.getElementById('refund-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
  setTimeout(() => document.getElementById('refund-reason')?.focus(), 100);
}
export function closeRefundModal() { const m = document.getElementById('refund-modal'); m.classList.add('hidden'); m.style.display = ''; _refundTxnId = null; _refundTxnRecord = null; }
export function confirmRefund() {
  const reason = document.getElementById('refund-reason').value.trim();
  const amount = parseFloat(document.getElementById('refund-amount').value) || 0;
  if (!reason) { showToast('Please enter a reason for the refund.'); return; }
  if (amount <= 0) { showToast('Refund amount must be greater than zero.'); return; }
  if (amount > (_refundTxnRecord?.totalCost || 0)) { showToast('Refund cannot exceed the original total.'); return; }
  const o = _refundTxnRecord, now = new Date().toISOString();
  const record = { id: String(Date.now()*1000 + Math.floor(Math.random()*1000)), name: o.name, phone: o.phone||'', services: o.services||[], assignments: [], items: [], fees: [], discount: 0, discountNote: reason, totalCost: -amount, checkinTime: now, completedAt: now, status: 'refund', isAppointment: false, refundOf: _refundTxnId, loggedBy: getActiveUser()?.name || '' };
  dispatch('record.save', { record });
  closeRefundModal();
  renderTransactions();
  if (document.getElementById('panel-reports')?.classList.contains('active')) runReport();
  showToast(`Refund of $${amount.toFixed(2)} recorded ✓`);
}

// ── Delete transaction (soft delete via DO) ───────
let _deleteTxnId = null, _deleteTxnRecord = null;
export function initiateDeleteTransaction(recordId) {
  if (!canDo('deleteTransaction')) { showToast('Permission denied'); return; }
  const fromRecords = records().find(r => String(r.id) === String(recordId));
  const fromQueue = queue().find(e => String(e.id) === String(recordId));
  _deleteTxnRecord = fromRecords || (fromQueue ? { id: String(fromQueue.id), name: fromQueue.name, totalCost: fromQueue.totalCost||0, checkinTime: fromQueue.checkinTime, status: fromQueue.status, services: fromQueue.services, assignments: fromQueue.assignments||[] } : null);
  if (!_deleteTxnRecord) { showToast('Record not found.'); return; }
  _deleteTxnId = String(recordId);
  const dt = new Date(_deleteTxnRecord.checkinTime);
  document.getElementById('del-txn-subtitle').textContent = `${_deleteTxnRecord.name} · ${dt.toLocaleDateString()} · $${(_deleteTxnRecord.totalCost||0).toFixed(2)}`;
  document.getElementById('del-txn-reason').value = '';
  document.getElementById('del-txn-step1').classList.remove('hidden');
  document.getElementById('del-txn-step2').classList.add('hidden');
  const m = document.getElementById('delete-txn-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function deleteTxnStep2() { document.getElementById('del-txn-step1').classList.add('hidden'); document.getElementById('del-txn-step2').classList.remove('hidden'); setTimeout(() => document.getElementById('del-txn-reason')?.focus(), 100); }
export function closeDeleteTxnModal() { const m = document.getElementById('delete-txn-modal'); m.classList.add('hidden'); m.style.display = ''; _deleteTxnId = null; _deleteTxnRecord = null; }
export function confirmDeleteTransaction() {
  const reason = document.getElementById('del-txn-reason').value.trim();
  if (!reason) { showToast('Please enter a reason for deletion.'); return; }
  if (!_deleteTxnId) return;
  dispatch('record.delete', { id: _deleteTxnId, reason, by: getActiveUser()?.name || 'Unknown' });
  if (queue().find(e => String(e.id) === _deleteTxnId)) dispatch('queue.remove', { id: _deleteTxnId });
  // Device-local audit trail
  const log = JSON.parse(localStorage.getItem('muse_deletion_log') || '[]');
  log.push({ deletedAt: new Date().toISOString(), deletedBy: getActiveUser()?.name || 'Unknown', recordId: _deleteTxnId, name: _deleteTxnRecord?.name || '', total: _deleteTxnRecord?.totalCost || 0, checkinTime: _deleteTxnRecord?.checkinTime || '', reason });
  localStorage.setItem('muse_deletion_log', JSON.stringify(log));
  closeDeleteTxnModal();
  renderTransactions(); window.renderQueue?.(); runReport();
  showToast('Transaction deleted — reason logged ✓');
}

// ── Historical transaction entry (admin) ──────────
let _histMode = 'add', _histEditId = null, _histType = 'Walk-In', _histSelectedSvcs = [], _histAssignments = {}, _histItems = [], _histFees = [];
export function showHistoricalEntryModal(editId, prefillDate) {
  if (!canDo('historicalEntry')) { showToast('Permission denied'); return; }
  _histMode = editId ? 'edit' : 'add'; _histEditId = editId || null;
  _histSelectedSvcs = []; _histAssignments = {}; _histItems = []; _histFees = [];
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yesterdayStr = localDateStr(yest);
  document.getElementById('hist-date').max = yesterdayStr;
  const title = document.getElementById('hist-modal-title');
  if (_histMode === 'edit') {
    const rec = records().find(r => String(r.id) === String(editId));
    if (!rec) { showToast('Record not found'); return; }
    const dt = new Date(rec.checkinTime);
    if (localDateStr(dt) >= todayStr()) { showToast("Today's records are edited through the live queue"); return; }
    if (title) title.textContent = 'Edit Transaction';
    document.getElementById('hist-date').value = localDateStr(dt);
    document.getElementById('hist-time').value = dt.toTimeString().slice(0,5);
    document.getElementById('hist-name').value = rec.name || '';
    document.getElementById('hist-phone').value = rec.phone || '';
    document.getElementById('hist-discount').value = rec.discount > 0 ? rec.discount : '';
    document.getElementById('hist-discount-note').value = rec.discountNote || '';
    _histSelectedSvcs = [...(rec.services || [])];
    rec.assignments.forEach(a => { if (a.serviceId) _histAssignments[a.serviceId] = { techId: a.techId||'', station: a.station||'', cost: a.cost||0 }; });
    _histItems = (rec.items||[]).map(i => ({ itemId: i.itemId, qty: i.qty||1, price: i.price||0 }));
    _histFees = (rec.fees||[]).map(f => ({ feeId: f.feeId, amount: f.amount||0 }));
    _histType = rec.isAppointment ? 'Appointment' : 'Walk-In';
  } else {
    if (title) title.textContent = 'Add Historical Transaction';
    document.getElementById('hist-date').value = (prefillDate && prefillDate < todayStr()) ? prefillDate : yesterdayStr;
    document.getElementById('hist-time').value = '12:00';
    document.getElementById('hist-name').value = '';
    document.getElementById('hist-phone').value = '';
    document.getElementById('hist-discount').value = '';
    document.getElementById('hist-discount-note').value = '';
    _histType = 'Walk-In';
  }
  setHistType(_histType); _renderHistServices(); _renderHistAssignments(); _renderHistItems(); _renderHistFees(); _computeHistTotal();
  const m = document.getElementById('historical-modal'); m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeHistoricalModal() { const m = document.getElementById('historical-modal'); m.classList.add('hidden'); m.style.display = ''; }
export function setHistType(type) {
  _histType = type;
  ['Walk-In','Appointment'].forEach(t => { const el = document.getElementById(t === 'Walk-In' ? 'hist-type-walkin' : 'hist-type-appt'); if (!el) return; const on = t === type; el.classList.toggle('bg-primary',on); el.classList.toggle('text-on-primary',on); el.classList.toggle('border-primary',on); el.classList.toggle('bg-transparent',!on); el.classList.toggle('border-outline-variant',!on); el.classList.toggle('text-on-surface',!on); });
}
export function toggleHistService(sid, btn) {
  const i = _histSelectedSvcs.indexOf(sid);
  if (i >= 0) { _histSelectedSvcs.splice(i,1); delete _histAssignments[sid]; btn.classList.remove('border-primary','bg-primary/10','text-primary'); btn.classList.add('border-surface-container-high','text-on-surface-variant'); }
  else { _histSelectedSvcs.push(sid); _histAssignments[sid] = { techId:'', station:'', cost: svc(sid)?.baseCost || 0 }; btn.classList.add('border-primary','bg-primary/10','text-primary'); btn.classList.remove('border-surface-container-high','text-on-surface-variant'); }
  _renderHistAssignments(); _computeHistTotal();
}
function _renderHistServices() {
  const el = document.getElementById('hist-services'); if (!el) return;
  el.innerHTML = cfg().services.filter(s => !cfg().hidden_dash_services.includes(s.id)).map(s => { const sel = _histSelectedSvcs.includes(s.id); return `<button type="button" onclick="toggleHistService('${s.id}',this)" class="px-3 py-2 rounded-xl border-2 text-xs font-body font-semibold transition-all ${sel?'border-primary bg-primary/10 text-primary':'border-surface-container-high text-on-surface-variant hover:border-primary'}">${s.label}</button>`; }).join('');
}
function _renderHistAssignments() {
  const el = document.getElementById('hist-assignments'); if (!el) return;
  if (_histSelectedSvcs.length === 0) { el.innerHTML = '<p class="text-xs font-body text-on-surface-variant italic">Select at least one service above to assign staff.</p>'; return; }
  el.innerHTML = _histSelectedSvcs.map(sid => { const s = svc(sid), asgn = _histAssignments[sid] || { techId:'', station:'', cost:0 }; const techOpts = '<option value="">— Tech —</option>' + activeStaff().map(t => `<option value="${t.id}" ${asgn.techId===t.id?'selected':''}>${t.name}</option>`).join(''); return `<div class="flex items-center gap-2 py-2 border-b border-surface-container-high last:border-0"><div class="w-24 flex-shrink-0 text-xs font-body font-semibold text-on-surface truncate">${s?.label||sid}</div><select onchange="_histSetTech('${sid}',this.value)" class="flex-1 min-w-0 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body focus:border-primary outline-none">${techOpts}</select><input type="text" inputmode="decimal" placeholder="$0.00" value="${asgn.cost>0?asgn.cost:''}" oninput="_histSetCost('${sid}',this.value)" class="w-20 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body text-right focus:border-primary outline-none"></div>`; }).join('');
}
export function _histSetTech(sid, val) { if (_histAssignments[sid]) _histAssignments[sid].techId = val; }
export function _histSetCost(sid, val) { if (_histAssignments[sid]) _histAssignments[sid].cost = parseFloat(val) || 0; _computeHistTotal(); }
export function addHistItem() { const first = cfg().items.find(i => !_histItems.some(x => x.itemId === i.id)) || cfg().items[0]; if (!first) { showToast('No items configured'); return; } _histItems.push({ itemId: first.id, qty: 1, price: first.price || 0 }); _renderHistItems(); _computeHistTotal(); }
export function removeHistItem(idx) { _histItems.splice(idx,1); _renderHistItems(); _computeHistTotal(); }
function _renderHistItems() {
  const el = document.getElementById('hist-items'); if (!el) return;
  if (_histItems.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = _histItems.map((item,i) => { const opts = cfg().items.map(x => `<option value="${x.id}" ${item.itemId===x.id?'selected':''}>${x.label}</option>`).join(''); return `<div class="flex items-center gap-2 mb-1"><select onchange="_histItemPick(${i},this.value)" class="flex-1 min-w-0 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body focus:border-primary outline-none">${opts}</select><input type="number" min="1" value="${item.qty}" placeholder="Qty" oninput="_histItemQty(${i},this.value)" class="w-12 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body text-center focus:border-primary outline-none"><input type="text" inputmode="decimal" value="${item.price>0?item.price:''}" placeholder="$0" oninput="_histItemPrice(${i},this.value)" class="w-16 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body text-right focus:border-primary outline-none"><button onclick="removeHistItem(${i})" class="flex-shrink-0 text-error hover:bg-error/10 rounded-lg p-1"><span class="material-symbols-outlined" style="font-size:16px">close</span></button></div>`; }).join('');
}
export function _histItemPick(i, id) { _histItems[i].itemId = id; const x = cfg().items.find(a => a.id === id); if (x) _histItems[i].price = x.price || 0; _renderHistItems(); _computeHistTotal(); }
export function _histItemQty(i, v) { _histItems[i].qty = parseInt(v) || 1; _computeHistTotal(); }
export function _histItemPrice(i, v) { _histItems[i].price = parseFloat(v) || 0; _computeHistTotal(); }
export function addHistFee() { const first = cfg().fees[0]; if (!first) { showToast('No fees configured'); return; } _histFees.push({ feeId: first.id, amount: first.value || 0 }); _renderHistFees(); _computeHistTotal(); }
export function removeHistFee(idx) { _histFees.splice(idx,1); _renderHistFees(); _computeHistTotal(); }
function _renderHistFees() {
  const el = document.getElementById('hist-fees'); if (!el) return;
  if (_histFees.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = _histFees.map((fee,i) => { const opts = cfg().fees.map(f => `<option value="${f.id}" ${fee.feeId===f.id?'selected':''}>${f.label}</option>`).join(''); return `<div class="flex items-center gap-2 mb-1"><select onchange="_histFeePick(${i},this.value)" class="flex-1 min-w-0 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body focus:border-primary outline-none">${opts}</select><input type="text" inputmode="decimal" value="${fee.amount>0?fee.amount:''}" placeholder="$0" oninput="_histFeeAmt(${i},this.value)" class="w-20 border border-surface-container-high bg-transparent rounded-lg px-2 py-1.5 text-xs font-body text-right focus:border-primary outline-none"><button onclick="removeHistFee(${i})" class="flex-shrink-0 text-error hover:bg-error/10 rounded-lg p-1"><span class="material-symbols-outlined" style="font-size:16px">close</span></button></div>`; }).join('');
}
export function _histFeePick(i, id) { _histFees[i].feeId = id; const f = cfg().fees.find(x => x.id === id); if (f) _histFees[i].amount = f.value || 0; _renderHistFees(); _computeHistTotal(); }
export function _histFeeAmt(i, v) { _histFees[i].amount = parseFloat(v) || 0; _computeHistTotal(); }
function _computeHistTotal() {
  const svcTotal = _histSelectedSvcs.reduce((s,sid)=>s+(parseFloat(_histAssignments[sid]?.cost)||0),0);
  const itemsTotal = _histItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0),0);
  const feesTotal = _histFees.reduce((s,f)=>s+(parseFloat(f.amount)||0),0);
  const discount = parseFloat(document.getElementById('hist-discount')?.value) || 0;
  const total = Math.max(0, svcTotal + itemsTotal + feesTotal - discount);
  const el = document.getElementById('hist-total-display'); if (el) el.textContent = `$${total.toFixed(2)}`;
  return total;
}
export { _computeHistTotal };
export function saveHistoricalTransaction() {
  const name = document.getElementById('hist-name').value.trim();
  const phone = document.getElementById('hist-phone').value.trim();
  const dateVal = document.getElementById('hist-date').value;
  const timeVal = document.getElementById('hist-time').value || '12:00';
  const discount = parseFloat(document.getElementById('hist-discount').value) || 0;
  const discountNote = document.getElementById('hist-discount-note').value.trim();
  if (!name) { showToast('Customer name is required'); return; }
  if (!dateVal) { showToast('Date is required'); return; }
  if (dateVal >= todayStr()) { showToast('Date must be before today'); return; }
  const checkinTime = new Date(`${dateVal}T${timeVal}:00`);
  const total = _computeHistTotal();
  const assignments = _histSelectedSvcs.map(sid => ({ serviceId: sid, techId: _histAssignments[sid]?.techId||'', station: _histAssignments[sid]?.station||'', cost: parseFloat(_histAssignments[sid]?.cost)||0, status: 'paid', assignedAt: checkinTime.getTime() }));
  if (assignments.length === 0 && total > 0) assignments.push({ serviceId:'', techId:'', station:'', cost: total, status:'paid', assignedAt: checkinTime.getTime() });
  const items = _histItems.filter(i => i.itemId && i.qty > 0).map(i => ({ itemId: i.itemId, qty: i.qty, price: i.price }));
  const fees = _histFees.filter(f => f.feeId && f.amount > 0).map(f => ({ feeId: f.feeId, amount: f.amount }));
  const base = { name, phone, services: _histSelectedSvcs, assignments, items, fees, discount, discountNote, totalCost: total, checkinTime: checkinTime.toISOString(), status: 'paid', isAppointment: _histType === 'Appointment', loggedBy: getActiveUser()?.name || 'Admin' };
  if (_histMode === 'edit') {
    const existing = records().find(r => String(r.id) === String(_histEditId));
    dispatch('record.save', { record: { ...existing, ...base, id: String(_histEditId), completedAt: existing?.completedAt || checkinTime.toISOString() } });
    showToast('Transaction updated ✓');
  } else {
    dispatch('record.save', { record: { ...base, id: String(Date.now()*1000 + Math.floor(Math.random()*1000)), completedAt: checkinTime.toISOString() } });
    showToast('Historical transaction saved ✓');
  }
  if (phone) squareUpsertCustomer({ name, phone, services: _histSelectedSvcs });   // sync customer to directory + Square
  closeHistoricalModal();
  renderTransactions();
  if (document.getElementById('panel-reports')?.classList.contains('active')) runReport();
  window.renderTurns?.();   // keep the past-day Turns grid in sync when added/edited from there
}
