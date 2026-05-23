// ── Square POS deep link, orders, appointments, bookings ────────────────────
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast } from '../utils.js';
import { SQUARE_PROXY } from '../config.js';
import { customerDirectory } from './square-customers.js';

const cfg     = () => getState().config;
const sqConfig = () => cfg().square_config || null;
const queue    = () => getState().queue;

// ── POS deep link ─────────────────────────────────
export function openSquarePOS(entryId) {
  const entry = queue().find(e => String(e.id) === String(entryId));
  if (!entry) return;
  const cents = Math.round((entry.totalCost || 0) * 100);
  if (cents <= 0) { showToast('No total — assign a price first.'); return; }
  let url = `squareup://pos/take-payment?amount_money=${cents}&currency_code=USD`;
  if (entry.phone) {
    const match = customerDirectory.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(entry.phone.replace(/\D/g,'')));
    if (match?.squareId) url += `&customer_id=${encodeURIComponent(match.squareId)}`;
  }
  window.location.href = url;
}
export function openSquarePOSFromModal() {
  window.saveCurrentGroupTabInputs?.();
  const entryId = window.activeGroupEntryId?.();
  if (entryId) openSquarePOS(entryId);
}

// ── Order push (open ticket) ──────────────────────
export async function pushOrderToSquare(entry) {
  if (!sqConfig()) { showToast('Square not configured.'); return; }
  if (!sqConfig().locationId) { showToast('Location ID missing.'); return; }

  const lineItems = (entry.assignments || []).filter(a => a.cost > 0).map(a => {
    const svc = cfg().services.find(s => s.id === a.serviceId);
    return { name: svc?.label || 'Service', quantity: '1', base_price_money: { amount: Math.round(Number(a.cost) * 100), currency: 'USD' }, note: a.station || '' };
  });
  const assignedSvcIds = new Set((entry.assignments||[]).map(a => a.serviceId));
  entry.services.forEach(sid => {
    if (!assignedSvcIds.has(sid)) {
      const svc = cfg().services.find(s => s.id === sid);
      lineItems.push({ name: svc?.label || 'Service', quantity: '1', base_price_money: { amount: 0, currency: 'USD' } });
    }
  });
  if (lineItems.length === 0) { showToast('No services to push to Square.'); return; }

  showToast('Creating Square ticket…');
  try {
    let customerId = null;
    if (entry.phone) {
      const rawPhone = entry.phone.replace(/\D/g, '');
      const cached = customerDirectory.find(c => { const cp = (c.phone||'').replace(/\D/g,'').replace(/^1(\d{10})$/,'$1'); return cp && (cp === rawPhone || cp === rawPhone.replace(/^1/,'')); });
      if (cached?.squareId) customerId = cached.squareId;
      else {
        try {
          const phoneE164 = `+1${rawPhone.replace(/^1(\d{10})$/, '$1')}`;
          const sr = await fetch(`${SQUARE_PROXY}/v2/customers/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: { filter: { phone_number: { exact: phoneE164 } } } }) });
          if (sr.ok) customerId = (await sr.json())?.customers?.[0]?.id || null;
        } catch (e) {}
      }
    }
    const orderBody = { idempotency_key: `muse-${String(entry.id)}-${Date.now()}`, order: { location_id: sqConfig().locationId, state: 'OPEN', reference_id: `muse-${String(entry.id).slice(-8)}`, line_items: lineItems, ...(customerId ? { customer_id: customerId } : {}) } };
    const orderRes = await fetch(`${SQUARE_PROXY}/v2/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderBody) });
    const od = await orderRes.json();
    if (orderRes.ok && od?.order?.id) {
      const total = od.order.total_money?.amount;
      const display = total != null ? ` · $${(total/100).toFixed(2)}` : '';
      dispatch('queue.upsert', { entry: { ...entry, squareOrderId: od.order.id } });
      showToast(`✓ Ticket open in Square POS${display}`);
      window.renderQueue?.();
    } else {
      showToast(`Square error: ${od?.errors?.[0]?.detail || od?.errors?.[0]?.code || 'unknown'}`);
    }
  } catch (e) { showToast('Could not reach Square. Check proxy.'); }
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
