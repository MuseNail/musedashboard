// ── Square Customer Autocomplete ──────────────────
async function loadSquareCustomers() {
  try {
    let allCustomers = [];
    let cursor = null;

    do {
      const url = `${SQUARE_PROXY}/v2/customers?limit=100&sort_field=CREATED_AT&sort_order=DESC${cursor ? '&cursor=' + cursor : ''}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      allCustomers = allCustomers.concat(data.customers || []);
      cursor = data.cursor || null;
    } while (cursor);

    // Map for autocomplete
    squareCustomers = allCustomers
      .filter(c => c.given_name && c.given_name.trim() !== '-' && c.given_name.trim() !== '')
      .map(c => ({
        id: c.id,
        given_name:  c.given_name?.trim() || '',
        family_name: (c.family_name || '').trim().replace(/^-$/, ''),
        phone:       c.phone_number || '',
        display:     [c.given_name?.trim(), (c.family_name||'').trim().replace(/^-$/,'')].filter(Boolean).join(' '),
      }));

    // Also populate customerDirectory (same data, slightly different shape)
    customerDirectory = allCustomers.map(c => ({
      squareId:  c.id,
      firstName: c.given_name?.trim()  || '',
      lastName:  (c.family_name || '').trim().replace(/^-$/, ''),
      phone:     c.phone_number || '',
      email:     c.email_address || '',
      note:      c.note || '',
    }));

    // Persist both to localStorage
    localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
    console.log(`Loaded ${squareCustomers.length} customers from Square`);
  } catch(e) {
    console.warn('Could not load Square customers:', e);
    // Fall back to cache
    const cached = localStorage.getItem('muse_customers');
    if (cached) {
      customerDirectory = JSON.parse(cached);
      squareCustomers = customerDirectory.map(c => ({
        id:          c.squareId,
        given_name:  c.firstName,
        family_name: c.lastName,
        phone:       c.phone,
        display:     [c.firstName, c.lastName].filter(Boolean).join(' '),
      }));
    }
  }
}

function filterCustomers(query, field) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase().replace(/\D/g,'');
  return squareCustomers.filter(c => {
    if (field === 'phone') {
      // Strip country code from Square's +1XXXXXXXXXX format
      const phone = c.phone.replace(/\D/g,'').replace(/^1(\d{10})$/, '$1');
      return phone.includes(q) && q.length >= 3;
    }
    if (field === 'first') {
      return c.given_name.toLowerCase().startsWith(query.toLowerCase()) ||
             c.display.toLowerCase().startsWith(query.toLowerCase());
    }
    return false;
  }).slice(0, 6);
}

function fillFromCustomer(customer, guestIdx, prefix, phoneId, firstId, lastId) {
  const phoneEl = document.getElementById(phoneId);
  const firstEl = document.getElementById(firstId);
  const lastEl  = document.getElementById(lastId);
  // Strip +1 country code and format as (xxx) xxx-xxxx
  const digits = customer.phone.replace(/\D/g,'').replace(/^1(\d{10})$/, '$1').slice(0,10);
  const formatted = digits.length === 10
    ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
    : customer.phone;
  if (phoneEl) phoneEl.value = formatted;
  if (firstEl) firstEl.value = customer.given_name;
  if (lastEl)  lastEl.value  = customer.family_name;
  // Hide all dropdowns for this guest
  [`ac-phone-${guestIdx}`, `ac-first-${guestIdx}`,
   `mac-phone-${guestIdx}`, `mac-first-${guestIdx}`].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
  });
}

function buildDropdown(customers, dropdownId, guestIdx, phoneId, firstId, lastId) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  if (customers.length === 0) { dropdown.classList.add('hidden'); return; }
  dropdown.innerHTML = customers.map((c, i) => {
    const digits = c.phone.replace(/\D/g,'').replace(/^1(\d{10})$/, '$1').slice(0,10);
    const displayPhone = digits.length === 10
      ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
      : c.phone;
    return `
    <div class="autocomplete-item" data-ac-idx="${i}" onmousedown="fillFromCustomer(
      {id:'${c.id}',phone:'${c.phone.replace(/'/g,"\\'")}',given_name:'${c.given_name.replace(/'/g,"\\'")}',family_name:'${c.family_name.replace(/'/g,"\\'")}'},
      ${guestIdx}, '', '${phoneId}', '${firstId}', '${lastId}'
    )">
      <div class="ac-name">${c.display || '—'}</div>
      <div class="ac-phone">${displayPhone || 'No phone'}</div>
    </div>
  `}).join('');
  dropdown.classList.remove('hidden');

  // Attach keyboard navigation to the input that triggered this dropdown
  const input = document.getElementById(phoneId) || document.getElementById(firstId);
  if (input) _attachAcKeyNav(input, dropdown, (idx) => {
    fillFromCustomer(
      { id: customers[idx].id, phone: customers[idx].phone, given_name: customers[idx].given_name, family_name: customers[idx].family_name },
      guestIdx, '', phoneId, firstId, lastId
    );
  });
}

// Attaches arrow-key + Enter navigation to an autocomplete input/dropdown pair.
// Removes itself when dropdown is hidden.
function _attachAcKeyNav(input, dropdown, onSelect) {
  let activeIdx = -1;
  function highlight(idx) {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((el, i) => el.classList.toggle('ac-highlighted', i === idx));
    activeIdx = idx;
  }
  function handler(e) {
    if (dropdown.classList.contains('hidden')) { input.removeEventListener('keydown', handler); return; }
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight(Math.min(activeIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(Math.max(activeIdx - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      onSelect(activeIdx);
      input.removeEventListener('keydown', handler);
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
      input.removeEventListener('keydown', handler);
    }
  }
  // Remove any previous handler before attaching
  input._acKeyHandler && input.removeEventListener('keydown', input._acKeyHandler);
  input._acKeyHandler = handler;
  input.addEventListener('keydown', handler);
}


// ── Customer Directory ────────────────────────────
let customerDirectory = []; // loaded from Square + local cache
// Pre-populate from cache on startup
(function() {
  const cached = localStorage.getItem('muse_customers');
  if (cached) try { customerDirectory = JSON.parse(cached); } catch(e) {}
})();

function showCustomerDir() {
  document.getElementById('customer-dir-modal').classList.remove('hidden');
  document.getElementById('customer-dir-modal').style.display = 'flex';
  renderCustomerDir('');
}

function closeCustomerDir() {
  document.getElementById('customer-dir-modal').classList.add('hidden');
  document.getElementById('customer-dir-modal').style.display = '';
}

async function syncSquareCustomers() {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  showToast('Syncing customers…');
  await loadSquareCustomers();
  showToast(`${customerDirectory.length} customers synced ✓`);
  renderCustomerDir(document.getElementById('customer-dir-search')?.value || '');
}

function filterCustomerDir(query) { renderCustomerDir(query); }

function renderCustomerDir(query) {
  const list = document.getElementById('customer-dir-list');
  if (!list) return;
  // Load from local cache if empty
  if (customerDirectory.length === 0) {
    const cached = localStorage.getItem('muse_customers');
    if (cached) customerDirectory = JSON.parse(cached);
  }
  const q = (query || '').toLowerCase();
  const filtered = customerDirectory.filter(c =>
    !q ||
    (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) ||
    (c.phone || '').includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  ).slice(0, 100);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="text-sm font-body text-on-surface-variant text-center py-8">No customers found. Tap Sync Square to load.</div>';
    return;
  }
  list.innerHTML = filtered.map(c => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
    return `
      <div class="flex items-center gap-3 px-4 py-3 border-b border-surface-container-high hover:bg-surface-container transition-colors">
        <div class="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
          <span class="text-sm font-headline font-bold text-primary">${name.charAt(0).toUpperCase()}</span>
        </div>
        <div class="flex-grow min-w-0">
          <div class="font-headline font-semibold text-on-surface text-sm">${name}</div>
          <div class="text-xs font-body text-on-surface-variant">${c.phone || ''}${c.email ? ' · ' + c.email : ''}</div>
        </div>
        <button onclick="showEditCustomer('${c.squareId}')" class="w-9 h-9 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors flex-shrink-0">
          <span class="material-symbols-outlined" style="font-size:18px">edit</span>
        </button>
      </div>`;
  }).join('');
}

function showEditCustomer(squareId) {
  const c = customerDirectory.find(x => x.squareId === squareId);
  if (!c) return;
  document.getElementById('edit-cust-id').value       = c.squareId;
  document.getElementById('edit-cust-square-id').value = c.squareId;
  document.getElementById('edit-cust-first').value    = c.firstName;
  document.getElementById('edit-cust-last').value     = c.lastName;
  document.getElementById('edit-cust-phone').value    = c.phone;
  document.getElementById('edit-cust-email').value    = c.email;
  document.getElementById('edit-cust-notes').value    = c.note;
  document.getElementById('edit-customer-modal').classList.remove('hidden');
  document.getElementById('edit-customer-modal').style.display = 'flex';
}

function closeEditCustomer() {
  document.getElementById('edit-customer-modal').classList.add('hidden');
  document.getElementById('edit-customer-modal').style.display = '';
}

async function saveEditCustomer() {
  const squareId = document.getElementById('edit-cust-square-id').value;
  const first    = document.getElementById('edit-cust-first').value.trim();
  const last     = document.getElementById('edit-cust-last').value.trim();
  const phone    = document.getElementById('edit-cust-phone').value.trim();
  const email    = document.getElementById('edit-cust-email').value.trim();
  const note     = document.getElementById('edit-cust-notes').value.trim();
  if (!first) { showToast('First name is required.'); return; }

  // Update local cache first
  const local = customerDirectory.find(x => x.squareId === squareId);
  if (local) { local.firstName=first; local.lastName=last; local.phone=phone; local.email=email; local.note=note; }
  localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));

  // Also update squareCustomers cache used for autocomplete
  const sc = squareCustomers.find(c => c.id === squareId);
  if (sc) { sc.given_name=first; sc.family_name=last; sc.phone=phone; sc.display=`${first} ${last}`.trim(); }

  // Update any matching queue entries (match by phone)
  const fullName = last ? `${first} ${last}` : first;
  let queueUpdated = false;
  queue.forEach(e => {
    if (e.phone && e.phone.replace(/\D/g,'').endsWith(phone.replace(/\D/g,''))) {
      e.name = fullName;
      updateSheetsRow(e);
      queueUpdated = true;
    }
  });
  if (queueUpdated) { saveQueueToStorage(); scheduleSheetsSave(); renderQueue(); renderTurns(); }

  // Push to Square
  if (squareConfig && squareId) {
    try {
      const body = {
        given_name:    first,
        family_name:   last,
        phone_number:  phone,
        email_address: email,
        note,
      };
      await fetch(`${SQUARE_PROXY}/v2/customers/${squareId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      showToast('Customer updated in Square ✓');
    } catch(e) {
      showToast('Saved locally (Square update failed)');
    }
  } else {
    showToast('Customer updated locally ✓');
  }

  closeEditCustomer();
  renderCustomerDir(document.getElementById('customer-dir-search')?.value || '');
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

async function squarePullStaff() {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/team-members?status=ACTIVE&limit=200`);
    if (!res.ok) { showToast('Could not reach Square team members API.'); return; }
    const data = await res.json();
    const members = data.team_members || [];
    let added = 0;
    members.forEach(m => {
      const name = [m.given_name, m.family_name].filter(Boolean).join(' ');
      if (!name) return;
      const id = `sq-staff-${m.id}`;
      if (!STAFF.find(s => s.id === id || s.name.toLowerCase() === name.toLowerCase())) {
        STAFF.push({ id, name, commission: null, squareTeamMemberId: m.id });
        added++;
      }
    });
    if (added > 0) { saveStaffToStorage(); renderStaffList(); showToast(`${added} staff imported from Square`); }
    else showToast('Staff already up to date');
  } catch(e) { console.warn('Square staff sync failed:', e); showToast('Could not sync staff from Square'); }
}


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


// ── Square Catalog Push ───────────────────────────
// Pushes a service or retail item to Square catalog (create or update).
// Fees are never pushed — they are app-only per architecture rules.

async function squarePushService(svc) {
  if (!squareConfig || !svc) return;
  try {
    if (svc.squareItemId) {
      // Update existing — GET to retrieve version (required for optimistic lock), then POST
      const getRes = await fetch(`${SQUARE_PROXY}/v2/catalog/object/${svc.squareItemId}`);
      if (!getRes.ok) { showToast('Square: could not fetch existing service.'); return; }
      const obj = (await getRes.json()).object;
      if (!obj) return;
      obj.item_data.name = svc.label;
      if (obj.item_data.variations?.[0]?.item_variation_data) {
        const vd = obj.item_data.variations[0].item_variation_data;
        vd.pricing_type = svc.baseCost > 0 ? 'FIXED_PRICING' : 'VARIABLE_PRICING';
        if (svc.baseCost > 0) vd.price_money = { amount: Math.round(svc.baseCost * 100), currency: 'USD' };
        else delete vd.price_money;
      }
      const res = await fetch(`${SQUARE_PROXY}/v2/catalog/object`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: `muse-svc-upd-${svc.id}-${Date.now()}`, object: obj }),
      });
      if (res.ok) showToast(`"${svc.label}" updated in Square ✓`);
      else console.warn('[Square] Service update failed:', await res.json());
    } else {
      // Create new service in Square catalog
      const tempId = `#muse-${svc.id}`;
      const res = await fetch(`${SQUARE_PROXY}/v2/catalog/batch-upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: `muse-svc-${svc.id}-${Date.now()}`,
          batches: [{ objects: [{
            type: 'ITEM',
            id:   tempId,
            item_data: {
              name:         svc.label,
              product_type: 'APPOINTMENTS_SERVICE',
              variations: [{
                type: 'ITEM_VARIATION',
                id:   `${tempId}-var`,
                item_variation_data: {
                  item_id:      tempId,
                  name:         'Regular',
                  pricing_type: svc.baseCost > 0 ? 'FIXED_PRICING' : 'VARIABLE_PRICING',
                  ...(svc.baseCost > 0 ? { price_money: { amount: Math.round(svc.baseCost * 100), currency: 'USD' } } : {}),
                },
              }],
            },
          }] }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const itemMapping = (data.id_mappings || []).find(m => m.client_object_id === tempId);
        const varMapping  = (data.id_mappings || []).find(m => m.client_object_id === `${tempId}-var`);
        if (itemMapping?.object_id) svc.squareItemId = itemMapping.object_id;
        if (varMapping?.object_id)  svc.squareVariationId = varMapping.object_id;
        if (itemMapping?.object_id) saveServicesToStorage();
        showToast(`"${svc.label}" added to Square ✓`);
      } else {
        console.warn('[Square] Service create failed:', await res.json());
      }
    }
  } catch(e) {
    console.warn('[Square] Catalog push failed:', e);
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
          duration_minutes:         durMins,
          service_variation_id:     svc.squareVariationId,
          service_variation_version: variationVersion,
          team_member_id:           squareConfig.bookingTeamMemberId,
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


async function squarePushItem(item) {
  if (!squareConfig || !item) return;
  try {
    if (item.squareItemId) {
      // Update existing
      const getRes = await fetch(`${SQUARE_PROXY}/v2/catalog/object/${item.squareItemId}`);
      if (!getRes.ok) { showToast('Square: could not fetch existing item.'); return; }
      const obj = (await getRes.json()).object;
      if (!obj) return;
      obj.item_data.name = item.label;
      if (obj.item_data.variations?.[0]?.item_variation_data) {
        const vd = obj.item_data.variations[0].item_variation_data;
        vd.pricing_type = item.price > 0 ? 'FIXED_PRICING' : 'VARIABLE_PRICING';
        if (item.price > 0) vd.price_money = { amount: Math.round(item.price * 100), currency: 'USD' };
        else delete vd.price_money;
      }
      const res = await fetch(`${SQUARE_PROXY}/v2/catalog/object`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: `muse-item-upd-${item.id}-${Date.now()}`, object: obj }),
      });
      if (res.ok) showToast(`"${item.label}" updated in Square ✓`);
      else console.warn('[Square] Item update failed:', await res.json());
    } else {
      // Create new retail item in Square catalog
      const tempId = `#muse-${item.id}`;
      const res = await fetch(`${SQUARE_PROXY}/v2/catalog/batch-upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: `muse-item-${item.id}-${Date.now()}`,
          batches: [{ objects: [{
            type: 'ITEM',
            id:   tempId,
            item_data: {
              name: item.label,
              variations: [{
                type: 'ITEM_VARIATION',
                id:   `${tempId}-var`,
                item_variation_data: {
                  item_id:      tempId,
                  name:         'Regular',
                  pricing_type: item.price > 0 ? 'FIXED_PRICING' : 'VARIABLE_PRICING',
                  ...(item.price > 0 ? { price_money: { amount: Math.round(item.price * 100), currency: 'USD' } } : {}),
                },
              }],
            },
          }] }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const mapping = (data.id_mappings || []).find(m => m.client_object_id === tempId);
        if (mapping?.object_id) { item.squareItemId = mapping.object_id; saveItems(); }
        showToast(`"${item.label}" added to Square ✓`);
      } else {
        console.warn('[Square] Item create failed:', await res.json());
      }
    }
  } catch(e) {
    console.warn('[Square] Catalog push failed:', e);
  }
}
