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


async function squarePullStaff() {
  if (!squareConfig) { showToast('Square not configured.'); return; }
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/team-members?status=ACTIVE&limit=200`);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const e = await res.json(); detail = e.errors?.[0]?.detail || e.errors?.[0]?.category || detail; } catch {}
      showToast(`Square team members: ${detail}`);
      console.warn('Square team members error:', res.status, detail);
      return;
    }
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


// ── Square Customer Upsert ────────────────────────
// Creates or updates a Square customer profile on check-in.
// Requires a phone number — profiles without phone are skipped entirely:
//   • can't receive SMS reminders
//   • can't be found by future phone searches → duplicates on next visit
//   • same-contact additional guests are guarded upstream via skipSquare flag
async function squareUpsertCustomer(entry) {
  if (!entry.name || entry.name.trim() === '-') return;
  const nameParts = entry.name.trim().split(/\s+/);
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const rawPhone   = (entry.phone || '').replace(/\D/g, '');

  // Require a phone number to create or update a Square profile.
  // Profiles without a phone can't receive SMS, can't be found by future phone search,
  // and will produce a duplicate on the next visit when the customer provides a phone.
  if (!rawPhone) return;

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
    // Square stores numbers in E.164 format (+15551234567) — the exact filter does not
    // normalize display formats like (555) 123-4567, so we must send E.164 explicitly.
    if (!existingId && rawPhone) {
      try {
        const digits10 = rawPhone.replace(/^1(\d{10})$/, '$1'); // strip leading 1 if 11 digits
        const phoneE164 = `+1${digits10}`;
        const searchRes = await fetch(`${SQUARE_PROXY}/v2/customers/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { filter: { phone_number: { exact: phoneE164 } } } })
        });
        if (searchRes.ok) {
          const sd = await searchRes.json();
          existingId = sd?.customers?.[0]?.id || null;
        }
      } catch(e) { /* search failed */ }
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
