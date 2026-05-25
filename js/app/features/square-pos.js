// ── Square POS deep link, orders, appointments, bookings ────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast } from '../utils.js';
import { SQUARE_PROXY } from '../config.js';
import { customerDirectory } from './square-customers.js';

const cfg     = () => getState().config;
const sqConfig = () => cfg().square_config || null;
const queue    = () => getState().queue;

// ── POS deep link (with a pre-launch confirm screen) ──────────────
// Square Point of Sale API (iOS web): square-commerce-v1://payment/create?data=<percent-encoded JSON>.
// Requires the public Application ID as client_id and an https callback_url — see Settings → Square.
let _pendingPay = null;

// A single entry's charge, computed from its components — authoritative, so a
// possibly-stale entry.totalCost can't make the group total wrong.
function entryTotal(e) {
  const svc   = (e.assignments || []).reduce((s, a) => s + (a.cost || 0), 0);
  const items = (e.items || []).reduce((s, i) => s + ((i.price || 0) * (i.qty || 0)), 0);
  const fees  = (e.fees || []).reduce((s, f) => s + (f.amount || 0), 0);
  return Math.max(0, svc + items + fees - (e.discount || 0));
}
function payLine(label, amt) {
  return `<div class="flex justify-between text-sm font-body"><span class="text-on-surface-variant">${label}</span><span class="${amt < 0 ? 'text-error' : 'text-on-surface'}">${amt < 0 ? '-' : ''}$${Math.abs(amt).toFixed(2)}</span></div>`;
}
function payCustomerBlock(e) {
  const lines = [];
  (e.assignments || []).forEach(a => { const s = cfg().services.find(x => x.id === a.serviceId); lines.push(payLine(s?.label || 'Service', a.cost || 0)); });
  (e.items || []).forEach(it => { const item = cfg().items.find(x => x.id === it.itemId); lines.push(payLine(`${item?.label || 'Item'} ×${it.qty || 1}`, (it.price || 0) * (it.qty || 0))); });
  (e.fees || []).forEach(f => { const fee = cfg().fees.find(x => x.id === f.feeId); lines.push(payLine(fee?.label || 'Fee', f.amount || 0)); });
  if (e.discount > 0) lines.push(payLine(`Discount${e.discountNote ? ' (' + e.discountNote + ')' : ''}`, -e.discount));
  return `<div class="bg-surface-container rounded-xl px-4 py-3">
    <div class="flex justify-between items-center mb-1.5"><span class="font-headline font-bold text-on-surface">${e.name}</span><span class="font-headline font-bold text-primary">$${entryTotal(e).toFixed(2)}</span></div>
    ${lines.join('') || '<div class="text-xs text-on-surface-variant italic">No charges</div>'}
  </div>`;
}

export function openSquarePOS(entryId) {
  const entry = queue().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  // Group check-in → the whole party is on one ticket. To pay separately, split the
  // ticket in-app first (then each member is its own non-grouped entry).
  const party = entry.groupId ? queue().filter(e => e.groupId === entry.groupId) : [entry];
  const cents = Math.round(party.reduce((s, e) => s + entryTotal(e), 0) * 100);
  if (cents <= 0) { showToast('No total — assign a price first.'); return; }
  // Persist each ticket to the server BEFORE charging. Fees/prices entered in the
  // Assign & Price modal are only in memory until this point (the modal defers the
  // sync to its Save button, which the Pay-in-Square flow skips). Without this, the
  // app re-hydrates from the server on return from Square and loses the un-synced fee
  // — so the saved record was short the fee while Square charged the full amount.
  party.forEach(e => dispatch('queue.upsert', { entry: e }));
  const body = document.getElementById('square-confirm-body');
  if (body) body.innerHTML = party.map(payCustomerBlock).join('');
  const totalEl = document.getElementById('square-confirm-total');
  if (totalEl) totalEl.textContent = `$${(cents / 100).toFixed(2)}`;
  _pendingPay = { cents, ids: party.map(e => String(e.id)), names: party.map(e => e.name).filter(Boolean).join(', ').slice(0, 120) };
  const m = document.getElementById('square-confirm-modal');
  if (m) { m.classList.remove('hidden'); m.style.display = 'flex'; }
}

export function closeSquareConfirm() {
  _pendingPay = null;
  const m = document.getElementById('square-confirm-modal');
  if (m) { m.classList.add('hidden'); m.style.display = ''; }
}

export function proceedSquarePayment() {
  if (!_pendingPay) return;
  const appId = sqConfig()?.applicationId;
  if (!appId) { showToast('Add your Square Application ID in Settings → Square first.'); return; }
  const data = {
    // callback_url must EXACTLY match the Web Callback URL registered in the Square
    // Developer Console (Point of Sale API). Pinned to the app scope.
    amount_money: { amount: _pendingPay.cents, currency_code: 'USD' },
    callback_url: location.origin + '/musedashboard/',
    client_id: appId,
    version: '1.3',
    notes: `Muse${_pendingPay.names ? ' · ' + _pendingPay.names : ''}`,
    options: { supported_tender_types: ['CREDIT_CARD', 'CASH', 'OTHER', 'SQUARE_GIFT_CARD', 'CARD_ON_FILE'] },
  };
  // Stash the party (+ names/amount) so we can mark them Paid on return. The Safari
  // return tab uses this to write muse_sq_paid; the installed PWA — which iOS resumes
  // WITHOUT the callback data — uses it for the confirm-on-resume prompt (see main.js).
  try { localStorage.setItem('muse_sq_pending', JSON.stringify({ ids: _pendingPay.ids || [], names: _pendingPay.names || '', cents: _pendingPay.cents || 0, at: Date.now() })); } catch (e) {}
  closeSquareConfirm();
  window.location.href = `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
}
export function openSquarePOSFromModal() {
  window.saveCurrentGroupTabInputs?.();
  const entryId = window.activeGroupEntryId?.();
  if (entryId) openSquarePOS(entryId);
}

// ── Appointments → queue ──────────────────────────
export async function syncSquareAppointments() {
  if (!sqConfig()) { showToast('Square not configured.'); return; }
  showToast('Loading appointments…');
  try {
    const today = new Date();
    const start = new Date(today.setHours(0,0,0,0)).toISOString();
    const end   = new Date(today.setHours(23,59,59,999)).toISOString();
    const res   = await fetch(`${SQUARE_PROXY}/v2/bookings?location_id=${sqConfig().locationId}&start_at_min=${start}&start_at_max=${end}&limit=100`);
    const data  = await res.json();
    if (!data.bookings || data.bookings.length === 0) { showToast('No appointments today from Square.'); return; }
    let added = 0;
    for (const b of data.bookings) {
      if (b.status !== 'ACCEPTED' && b.status !== 'PENDING') continue;
      const entryId = 'appt-' + b.id;
      if (queue().find(e => String(e.id) === entryId)) continue;
      const variationId = b.appointment_segments?.[0]?.service_variation_id;
      const svc = cfg().services.find(s => s.squareVariationId === variationId) || cfg().services.find(s => s.squareItemId === variationId) || cfg().services[0];
      const custDir = b.customer_id ? customerDirectory.find(c => c.squareId === b.customer_id) : null;
      const name = custDir ? [custDir.firstName, custDir.lastName].filter(Boolean).join(' ') : (b.customer_note || 'Appointment');
      dispatch('queue.upsert', { entry: {
        id: entryId, name, phone: custDir?.phone || '', services: svc ? [svc.id] : [],
        status: 'waiting', isAppointment: true, checkinTime: new Date(b.start_at).toISOString(), assignments: [], groupId: null,
      } });
      added++;
    }
    window.renderQueue?.(); window.renderTurns?.();
    showToast(added > 0 ? `${added} appointment(s) added to queue ✓` : 'No new appointments to add.');
  } catch (e) { showToast('Appointments sync failed: ' + e.message); }
}

// ── Push a calendar appointment to Square Bookings (SMS reminders) ──────────────
export async function squarePushBooking(calId, eventId) {
  if (!sqConfig()) { showToast('Square not configured.'); return; }
  if (!sqConfig().bookingTeamMemberId) { showToast('Set a booking team member in Square settings first.'); showSquareModalGlue(); return; }

  const ev = (window.calEventsFor?.(calId) || []).find(x => x.id === eventId);
  if (!ev) { showToast('Event not found.'); return; }

  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const endDt   = new Date(ev.end?.dateTime || ev.end?.date || startDt.getTime() + 3600000);
  const durMins = Math.round((endDt - startDt) / 60000);

  const svc = cfg().services.find(s => (ev.summary||'').toLowerCase().includes(s.label.toLowerCase()) || (ev.description||'').toLowerCase().includes(s.label.toLowerCase()));
  if (!svc?.squareVariationId) { showToast(svc ? `Push "${svc.label}" to Square catalog first (Settings → Services).` : 'No matching service found — check service names match your catalog.'); return; }

  let variationVersion;
  try {
    const objRes = await fetch(`${SQUARE_PROXY}/v2/catalog/object/${svc.squareVariationId}`);
    if (!objRes.ok) { showToast('Could not fetch service version from Square.'); return; }
    variationVersion = (await objRes.json()).object?.version;
    if (!variationVersion) { showToast('Could not read service version from Square.'); return; }
  } catch (e) { showToast('Square catalog fetch failed: ' + e.message); return; }

  const phoneMatch = (ev.description || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const rawPhone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
  const custDir = rawPhone ? customerDirectory.find(c => { const cp = (c.phone||'').replace(/\D/g,'').replace(/^1(\d{10})$/,'$1'); return cp && (cp === rawPhone || cp === rawPhone.replace(/^1/,'')); }) : null;

  showToast('Creating Square booking…');
  try {
    const bookingBody = { idempotency_key: `muse-booking-${eventId}-${Date.now()}`, booking: {
      start_at: startDt.toISOString(), location_id: sqConfig().locationId, customer_note: ev.summary || '',
      ...(custDir?.squareId ? { customer_id: custDir.squareId } : {}),
      appointment_segments: [{ duration_minutes: durMins, service_variation_id: svc.squareVariationId, service_variation_version: variationVersion, team_member_id: sqConfig().bookingTeamMemberId }],
    } };
    const res = await fetch(`${SQUARE_PROXY}/v2/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bookingBody) });
    const data = await res.json();
    if (res.ok && data.booking?.id) showToast('Square booking created — SMS reminder will send ✓');
    else showToast('Square booking failed: ' + (data.errors?.[0]?.detail || data.errors?.[0]?.code || 'unknown'));
  } catch (e) { showToast('Could not reach Square. Check proxy.'); }
}

function showSquareModalGlue() { window.showSquareModal?.(); }
