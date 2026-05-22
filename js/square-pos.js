// ── Square POS Deep Link ──────────────────────────
// Opens Square POS on the iPad with the total pre-filled.
// Requires Square POS app to be installed.
function openSquarePOS(entryId) {
  const entry = queue.find(e => String(e.id) === String(entryId));
  if (!entry) return;
  const cents = Math.round((entry.totalCost || 0) * 100);
  if (cents <= 0) { showToast('No total — assign a price first.'); return; }
  let url = `squareup://pos/take-payment?amount_money=${cents}&currency_code=USD`;
  // Link the payment to the Square customer record if we have a match by phone
  if (entry.phone) {
    const match = customerDirectory.find(c => c.phone && c.phone.replace(/\D/g,'').endsWith(entry.phone.replace(/\D/g,'')));
    if (match?.squareId) url += `&customer_id=${encodeURIComponent(match.squareId)}`;
  }
  window.location.href = url;
}

// Called from the group assign modal footer — saves the current tab first
function openSquarePOSFromModal() {
  saveCurrentGroupTabInputs();
  const entryId = groupAssignEntries[activeGroupTab];
  if (entryId) openSquarePOS(entryId);
}


// ── Square Order Push ─────────────────────────────
// Push an open ticket to Square so staff can process payment in Square POS.
// Creates as a plain open order with no fulfillment type (salon service, not retail pickup).
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
    // Look up Square customer — check local directory first to avoid an extra API call
    let customerId = null;
    if (entry.phone) {
      const rawPhone = entry.phone.replace(/\D/g, '');
      const cached = customerDirectory.find(c => {
        const cp = (c.phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        return cp && (cp === rawPhone || cp === rawPhone.replace(/^1/, ''));
      });
      if (cached?.squareId) {
        customerId = cached.squareId;
      } else {
        // Not in local cache — fall back to Square API search (must use E.164 format)
        try {
          const digits10 = rawPhone.replace(/^1(\d{10})$/, '$1');
          const phoneE164 = `+1${digits10}`;
          const searchRes = await fetch(`${SQUARE_PROXY}/v2/customers/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { filter: { phone_number: { exact: phoneE164 } } } }),
          });
          if (searchRes.ok) {
            const sd = await searchRes.json();
            customerId = sd?.customers?.[0]?.id || null;
          }
        } catch(e) { /* non-fatal — proceed without customer link */ }
      }
    }

    // Create an open order with no fulfillment type (salon service, not retail pickup)
    const orderBody = {
      idempotency_key: `muse-${String(entry.id)}-${Date.now()}`,
      order: {
        location_id:  squareConfig.locationId,
        state:        'OPEN',
        reference_id: `muse-${String(entry.id).slice(-8)}`,
        line_items:   lineItems,
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


// ── Square Appointments Sync ──────────────────────
async function syncSquareAppointments() {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  showToast('Loading appointments…');
  try {
    const today = new Date();
    const start = new Date(today.setHours(0,0,0,0)).toISOString();
    const end   = new Date(today.setHours(23,59,59,999)).toISOString();
    const res   = await fetch(`${SQUARE_PROXY}/v2/bookings?location_id=${squareConfig.locationId}&start_at_min=${start}&start_at_max=${end}&limit=100`);
    const data  = await res.json();
    if (!data.bookings || data.bookings.length === 0) {
      showToast('No appointments today from Square.');
      return;
    }
    let added = 0;
    for (const b of data.bookings) {
      if (b.status !== 'ACCEPTED' && b.status !== 'PENDING') continue;
      const entryId = 'appt-' + b.id;
      if (queue.find(e => String(e.id) === entryId)) continue; // already in queue
      // Match service by variation ID (most precise) then fall back
      const variationId = b.appointment_segments?.[0]?.service_variation_id;
      const svc = SERVICES.find(s => s.squareVariationId === variationId)
               || SERVICES.find(s => s.squareItemId === variationId)
               || SERVICES[0];
      // Resolve customer name from directory; fall back to customer_note then generic label
      const custDir = b.customer_id
        ? customerDirectory.find(c => c.squareId === b.customer_id)
        : null;
      const name = custDir
        ? [custDir.firstName, custDir.lastName].filter(Boolean).join(' ')
        : (b.customer_note || 'Appointment');
      queue.push({
        id:            entryId,
        name,
        phone:         custDir?.phone || '',
        services:      svc ? [svc.id] : [],
        status:        'waiting',
        isAppointment: true,
        checkinTime:   new Date(b.start_at),
        assignments:   [],
        groupId:       null,
      });
      added++;
    }
    saveQueueToStorage();
    scheduleSheetsSave();
    renderQueue();
    renderTurns();
    showToast(added > 0 ? `${added} appointment(s) added to queue ✓` : 'No new appointments to add.');
  } catch(e) {
    showToast('Appointments sync failed: ' + e.message);
    console.error(e);
  }
}


// ── Square Bookings ───────────────────────────────
// Load team members eligible for bookings so the Square modal can show a picker.
async function loadSquareBookingTeamMembers() {
  if (!squareConfig) return;
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/team-members?status=ACTIVE&limit=200`);
    if (!res.ok) return;
    const data = await res.json();
    const members = data.team_members || [];
    const sel = document.getElementById('sq-booking-member');
    if (!sel) return;
    sel.innerHTML = '<option value="">— None (no SMS reminders) —</option>' +
      members.map(m => {
        const name = [m.given_name, m.family_name].filter(Boolean).join(' ');
        const selected = m.id === squareConfig?.bookingTeamMemberId ? 'selected' : '';
        return `<option value="${m.id}" ${selected}>${name}</option>`;
      }).join('');
    if (members.length === 0) {
      showToast('No active team members found in Square.');
    }
  } catch(e) {
    console.warn('[Square] Could not load team members:', e);
    showToast('Could not load team members from Square.');
  }
}

// Push a Google Calendar appointment to Square Bookings so Square sends SMS reminders.
// Uses the single configured booking team member — all appointments go under one member.
// serviceVariationVersion must be fetched live from Square (required for optimistic lock).
async function squarePushBooking(calId, eventId) {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  if (!squareConfig.bookingTeamMemberId) {
    showToast('Set a booking team member in Square settings first.');
    showSquareModal();
    return;
  }

  const ev = (_calEvents[calId] || []).find(x => x.id === eventId);
  if (!ev) { showToast('Event not found.'); return; }

  const startDt = new Date(ev.start.dateTime || ev.start.date);
  const endDt   = new Date(ev.end?.dateTime   || ev.end?.date || startDt.getTime() + 3600000);
  const durMins = Math.round((endDt - startDt) / 60000);

  // Match the first named service in the event title/description to a SERVICES entry
  const svc = SERVICES.find(s =>
    (ev.summary || '').toLowerCase().includes(s.label.toLowerCase()) ||
    (ev.description || '').toLowerCase().includes(s.label.toLowerCase())
  );

  // squareVariationId is required for Bookings API; squarePushBooking only works for
  // services that have been pushed to Square (so we have the variation ID on hand).
  if (!svc?.squareVariationId) {
    showToast(svc
      ? `Push "${svc.label}" to Square catalog first (Settings → Services).`
      : 'No matching service found — check service names match your catalog.');
    return;
  }

  // Fetch current variation version (Square requires this for the Bookings API)
  let variationVersion;
  try {
    const objRes = await fetch(`${SQUARE_PROXY}/v2/catalog/object/${svc.squareVariationId}`);
    if (!objRes.ok) { showToast('Could not fetch service version from Square.'); return; }
    const objData = await objRes.json();
    variationVersion = objData.object?.version;
    if (!variationVersion) { showToast('Could not read service version from Square.'); return; }
  } catch(e) {
    showToast('Square catalog fetch failed: ' + e.message);
    return;
  }

  // Resolve customer from directory (phone in description)
  const phoneMatch = (ev.description || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const rawPhone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
  const custDir  = rawPhone
    ? customerDirectory.find(c => {
        const cp = (c.phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        return cp && (cp === rawPhone || cp === rawPhone.replace(/^1/, ''));
      })
    : null;

  showToast('Creating Square booking…');
  try {
    const bookingBody = {
      idempotency_key: `muse-booking-${eventId}-${Date.now()}`,
      booking: {
        start_at:         startDt.toISOString(),
        location_id:      squareConfig.locationId,
        customer_note:    ev.summary || '',
        ...(custDir?.squareId ? { customer_id: custDir.squareId } : {}),
        appointment_segments: [{
          duration_minutes:          durMins,
          service_variation_id:      svc.squareVariationId,
          service_variation_version: variationVersion,
          team_member_id:            squareConfig.bookingTeamMemberId,
        }],
      },
    };
    const res = await fetch(`${SQUARE_PROXY}/v2/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingBody),
    });
    const data = await res.json();
    if (res.ok && data.booking?.id) {
      showToast(`Square booking created — SMS reminder will send ✓`);
    } else {
      const msg = data.errors?.[0]?.detail || data.errors?.[0]?.code || JSON.stringify(data);
      showToast('Square booking failed: ' + msg);
      console.error('[Square] Booking error:', data);
    }
  } catch(e) {
    console.error('[Square] Booking push failed:', e);
    showToast('Could not reach Square. Check proxy.');
  }
}
