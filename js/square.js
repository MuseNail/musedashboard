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
      const svcName = b.appointment_segments?.[0]?.service_variation_id || 'Appointment';
      const svc = SERVICES.find(s => s.squareItemId === svcName || s.label.toLowerCase().includes('appointment')) || SERVICES[0];
      const name = b.customer_note || 'Appointment';
      queue.push({
        id:            entryId,
        name,
        phone:         '',
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




