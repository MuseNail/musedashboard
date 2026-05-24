// ── Square customers: directory, autocomplete, upsert, staff import ─────────
// Customers are owned by Square — kept as a device-local cache (localStorage
// 'muse_customers'), NOT in the DO store. Staff import writes config.staff.

import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { showToast, formatPhone, autoCapitalize } from '../utils.js';
import { SQUARE_PROXY } from '../config.js';

const cfg = () => getState().config;
// Manual customer notes are app-owned + synced (config.customer_notes, keyed by
// Square id) — kept SEPARATE from Square's `note` field, which the app uses for
// the auto "last check-in" stamp. This is what the check-in popup shows.
const customerNote = id => ((cfg().customer_notes || {})[id] || '').trim();

export let squareCustomers   = [];
export let customerDirectory = [];

// Pre-populate from the local cache on load (works offline + before Square sync).
(function initFromCache() {
  try {
    const cached = localStorage.getItem('muse_customers');
    if (cached) {
      customerDirectory = JSON.parse(cached);
      squareCustomers = customerDirectory.map(c => ({
        id: c.squareId, given_name: c.firstName || '', family_name: c.lastName || '',
        phone: c.phone || '', display: [c.firstName, c.lastName].filter(Boolean).join(' '),
      })).filter(c => c.given_name);
    }
  } catch (e) {}
})();

export async function loadSquareCustomers() {
  try {
    let all = [], cursor = null;
    do {
      const url = `${SQUARE_PROXY}/v2/customers?limit=100&sort_field=CREATED_AT&sort_order=DESC${cursor ? '&cursor=' + cursor : ''}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      all = all.concat(data.customers || []);
      cursor = data.cursor || null;
    } while (cursor);

    squareCustomers = all
      .filter(c => c.given_name && c.given_name.trim() !== '-' && c.given_name.trim() !== '')
      .map(c => ({
        id: c.id,
        given_name:  c.given_name?.trim() || '',
        family_name: (c.family_name || '').trim().replace(/^-$/, ''),
        phone:       c.phone_number || '',
        display:     [c.given_name?.trim(), (c.family_name||'').trim().replace(/^-$/,'')].filter(Boolean).join(' '),
      }));
    customerDirectory = all.map(c => ({
      squareId: c.id, firstName: c.given_name?.trim() || '', lastName: (c.family_name || '').trim().replace(/^-$/, ''),
      phone: c.phone_number || '', email: c.email_address || '', note: c.note || '',
    }));
    localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
    console.log(`Loaded ${squareCustomers.length} customers from Square`);
  } catch (e) {
    console.warn('Could not load Square customers:', e);
  }
}

export function filterCustomers(query, field) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase().replace(/\D/g, '');
  return squareCustomers.filter(c => {
    if (field === 'phone') {
      const phone = c.phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
      return phone.includes(q) && q.length >= 3;
    }
    if (field === 'first') {
      return c.given_name.toLowerCase().startsWith(query.toLowerCase()) || c.display.toLowerCase().startsWith(query.toLowerCase());
    }
    return false;
  }).slice(0, 6);
}

export function fillFromCustomer(customer, guestIdx, prefix, phoneId, firstId, lastId) {
  const phoneEl = document.getElementById(phoneId);
  const firstEl = document.getElementById(firstId);
  const lastEl  = document.getElementById(lastId);
  const digits = customer.phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1').slice(0, 10);
  const formatted = digits.length === 10 ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` : customer.phone;
  if (phoneEl) phoneEl.value = formatted;
  if (firstEl) firstEl.value = customer.given_name;
  if (lastEl)  lastEl.value  = customer.family_name;
  [`ac-phone-${guestIdx}`, `ac-first-${guestIdx}`, `mac-phone-${guestIdx}`, `mac-first-${guestIdx}`].forEach(id => {
    const el = document.getElementById(id); if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
  });
  // On a DASHBOARD check-in (manual-add uses `manual-*` field ids) — NOT the
  // customer-facing check-in screen — surface the saved manual note for a
  // returning customer chosen from autofill.
  if (/^manual-/.test(firstId || '')) {
    const note = customerNote(customer.id);
    if (note) showCustomerNote([customer.given_name, customer.family_name].filter(Boolean).join(' '), note);
  }
}
export function showCustomerNote(name, note) {
  const nameEl = document.getElementById('customer-note-name');
  const bodyEl = document.getElementById('customer-note-body');
  const m = document.getElementById('customer-note-modal');
  if (!m || !bodyEl) return;
  if (nameEl) nameEl.textContent = name || '';
  bodyEl.textContent = note || '';
  m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeCustomerNote() {
  const m = document.getElementById('customer-note-modal');
  if (m) { m.classList.add('hidden'); m.style.display = ''; }
}

export function buildDropdown(customers, dropdownId, guestIdx, phoneId, firstId, lastId) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  if (customers.length === 0) { dropdown.classList.add('hidden'); return; }
  dropdown.innerHTML = customers.map((c, i) => {
    const digits = c.phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1').slice(0, 10);
    const displayPhone = digits.length === 10 ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` : c.phone;
    return `
    <div class="autocomplete-item" data-ac-idx="${i}" onmousedown="fillFromCustomer(
      {id:'${c.id}',phone:'${c.phone.replace(/'/g,"\\'")}',given_name:'${c.given_name.replace(/'/g,"\\'")}',family_name:'${c.family_name.replace(/'/g,"\\'")}'},
      ${guestIdx}, '', '${phoneId}', '${firstId}', '${lastId}'
    )">
      <div class="ac-name">${c.display || '—'}</div>
      <div class="ac-phone">${displayPhone || 'No phone'}</div>
    </div>`;
  }).join('');
  dropdown.classList.remove('hidden');
  const input = document.getElementById(phoneId) || document.getElementById(firstId);
  if (input) _attachAcKeyNav(input, dropdown, idx => fillFromCustomer(
    { id: customers[idx].id, phone: customers[idx].phone, given_name: customers[idx].given_name, family_name: customers[idx].family_name },
    guestIdx, '', phoneId, firstId, lastId));
}

function _attachAcKeyNav(input, dropdown, onSelect) {
  let activeIdx = -1;
  function highlight(idx) { dropdown.querySelectorAll('.autocomplete-item').forEach((el, i) => el.classList.toggle('ac-highlighted', i === idx)); activeIdx = idx; }
  function handler(e) {
    if (dropdown.classList.contains('hidden')) { input.removeEventListener('keydown', handler); return; }
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(activeIdx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); onSelect(activeIdx); input.removeEventListener('keydown', handler); }
    else if (e.key === 'Escape') { dropdown.classList.add('hidden'); input.removeEventListener('keydown', handler); }
  }
  input._acKeyHandler && input.removeEventListener('keydown', input._acKeyHandler);
  input._acKeyHandler = handler;
  input.addEventListener('keydown', handler);
}
export { _attachAcKeyNav };

// Customer-facing + front-desk autocomplete entry points (inline oninput).
export function acSearch(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const results = filterCustomers(input.value, field);
  const dropId = field === 'phone' ? `ac-phone-${idx}` : `ac-first-${idx}`;
  buildDropdown(results, dropId, idx, `phone-${idx}`, `first-${idx}`, `last-${idx}`);
  const other = document.getElementById(field === 'phone' ? `ac-first-${idx}` : `ac-phone-${idx}`);
  if (other) { other.innerHTML = ''; other.classList.add('hidden'); }
}
export function acSearchManual(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const results = filterCustomers(input.value, field);
  const dropId = field === 'phone' ? `mac-phone-${idx}` : `mac-first-${idx}`;
  buildDropdown(results, dropId, idx, `manual-phone-${idx}`, `manual-first-${idx}`, `manual-last-${idx}`);
  const other = document.getElementById(field === 'phone' ? `mac-first-${idx}` : `mac-phone-${idx}`);
  if (other) { other.innerHTML = ''; other.classList.add('hidden'); }
}

// ── Customer Directory modal ──────────────────────
export function showCustomerDir() {
  const m = document.getElementById('customer-dir-modal');
  m.classList.remove('hidden'); m.style.display = 'flex';
  renderCustomerDir('');
}
export function closeCustomerDir() {
  const m = document.getElementById('customer-dir-modal');
  m.classList.add('hidden'); m.style.display = '';
}
export async function syncSquareCustomers() {
  if (!cfg().square_config) { showToast('Square not configured.'); return; }
  showToast('Syncing customers…');
  await loadSquareCustomers();
  showToast(`${customerDirectory.length} customers synced ✓`);
  renderCustomerDir(document.getElementById('customer-dir-search')?.value || '');
}
export function filterCustomerDir(query) { renderCustomerDir(query); }

export function renderCustomerDir(query) {
  const list = document.getElementById('customer-dir-list');
  if (!list) return;
  const q = (query || '').toLowerCase();
  const filtered = customerDirectory.filter(c =>
    !q || (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
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

export function showEditCustomer(squareId) {
  const c = customerDirectory.find(x => x.squareId === squareId);
  if (!c) return;
  document.getElementById('edit-cust-id').value        = c.squareId;
  document.getElementById('edit-cust-square-id').value = c.squareId;
  document.getElementById('edit-cust-first').value     = c.firstName;
  document.getElementById('edit-cust-last').value      = c.lastName;
  document.getElementById('edit-cust-phone').value     = c.phone;
  document.getElementById('edit-cust-email').value     = c.email;
  document.getElementById('edit-cust-notes').value     = customerNote(c.squareId);   // app-owned manual note (not Square's auto stamp)
  const m = document.getElementById('edit-customer-modal');
  m.classList.remove('hidden'); m.style.display = 'flex';
}
export function closeEditCustomer() {
  const m = document.getElementById('edit-customer-modal');
  m.classList.add('hidden'); m.style.display = '';
}

export async function saveEditCustomer() {
  const squareId = document.getElementById('edit-cust-square-id').value;
  const first = document.getElementById('edit-cust-first').value.trim();
  const last  = document.getElementById('edit-cust-last').value.trim();
  const phone = document.getElementById('edit-cust-phone').value.trim();
  const email = document.getElementById('edit-cust-email').value.trim();
  const note  = document.getElementById('edit-cust-notes').value.trim();
  if (!first) { showToast('First name is required.'); return; }

  const local = customerDirectory.find(x => x.squareId === squareId);
  if (local) { local.firstName = first; local.lastName = last; local.phone = phone; local.email = email; }
  localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
  // Manual note → app-owned synced store (kept out of Square's auto-stamped note).
  const notes = { ...(cfg().customer_notes || {}) };
  if (note) notes[squareId] = note; else delete notes[squareId];
  dispatch('config.set', { key: 'customer_notes', value: notes });
  const sc = squareCustomers.find(c => c.id === squareId);
  if (sc) { sc.given_name = first; sc.family_name = last; sc.phone = phone; sc.display = `${first} ${last}`.trim(); }

  // Update matching queue entries (match by phone) via the store.
  const fullName = last ? `${first} ${last}` : first;
  getState().queue.forEach(e => {
    if (e.phone && phone && e.phone.replace(/\D/g,'').endsWith(phone.replace(/\D/g,''))) {
      dispatch('queue.upsert', { entry: { ...e, name: fullName } });
    }
  });
  window.renderQueue?.(); window.renderTurns?.();

  if (cfg().square_config && squareId) {
    try {
      await fetch(`${SQUARE_PROXY}/v2/customers/${squareId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ given_name: first, family_name: last, phone_number: phone, email_address: email }),   // note stays app-owned (Square note = auto last-checkin stamp)
      });
      showToast('Customer updated in Square ✓');
    } catch (e) { showToast('Saved locally (Square update failed)'); }
  } else { showToast('Customer updated locally ✓'); }

  closeEditCustomer();
  renderCustomerDir(document.getElementById('customer-dir-search')?.value || '');
}

export async function squarePullStaff() {
  if (!cfg().square_config) { showToast('Square not configured.'); return; }
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/team-members/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { filter: { status: 'ACTIVE' } }, limit: 200 }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const e = await res.json(); detail = e.errors?.[0]?.detail || e.errors?.[0]?.category || detail; } catch {}
      showToast(`Square team members: ${detail}`); return;
    }
    const members = (await res.json()).team_members || [];
    const staff = [...cfg().staff];
    let added = 0;
    members.forEach(m => {
      const name = [m.given_name, m.family_name].filter(Boolean).join(' ');
      if (!name) return;
      const id = `sq-staff-${m.id}`;
      if (!staff.find(s => s.id === id || s.name.toLowerCase() === name.toLowerCase())) {
        staff.push({ id, name, commission: null, squareTeamMemberId: m.id });
        added++;
      }
    });
    if (added > 0) { dispatch('config.set', { key: 'staff', value: staff }); window.renderStaffList?.(); showToast(`${added} staff imported from Square`); }
    else showToast('Staff already up to date');
  } catch (e) { showToast('Could not sync staff from Square'); }
}

// Creates/updates a Square customer on check-in (requires a phone number).
export async function squareUpsertCustomer(entry) {
  if (!entry.name || entry.name.trim() === '-') return;
  const parts = entry.name.trim().split(/\s+/);
  const firstName = parts[0] || '', lastName = parts.slice(1).join(' ') || '';
  const rawPhone = (entry.phone || '').replace(/\D/g, '');
  if (!rawPhone) return;
  try {
    let existingId = null;
    if (squareCustomers.length > 0) {
      const cached = squareCustomers.find(c => {
        const cp = (c.phone||'').replace(/\D/g,'').replace(/^1(\d{10})$/,'$1');
        return cp === rawPhone || cp === rawPhone.replace(/^1/,'');
      });
      if (cached) existingId = cached.id;
    }
    if (!existingId) {
      try {
        const phoneE164 = `+1${rawPhone.replace(/^1(\d{10})$/, '$1')}`;
        const sr = await fetch(`${SQUARE_PROXY}/v2/customers/search`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { filter: { phone_number: { exact: phoneE164 } } } }),
        });
        if (sr.ok) existingId = (await sr.json())?.customers?.[0]?.id || null;
      } catch (e) {}
    }
    const svcLabels = (entry.services || []).map(sid => cfg().services.find(s => s.id === sid)?.label || sid).join(', ');
    const payload = { given_name: firstName, family_name: lastName, note: `Last check-in: ${new Date().toLocaleDateString()}${svcLabels ? ' | Services: ' + svcLabels : ''}` };
    if (rawPhone) payload.phone_number = entry.phone;

    if (existingId) {
      const res = await fetch(`${SQUARE_PROXY}/v2/customers/${existingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        const c = (await res.json()).customer;
        if (c) {
          // Refresh the local caches so a name/phone fix shows immediately in-app
          // (not only after the next full sync).
          const sc = squareCustomers.find(x => x.id === c.id);
          if (sc) { sc.given_name = c.given_name||''; sc.family_name = c.family_name||''; sc.phone = c.phone_number||''; sc.display = entry.name; }
          else squareCustomers.push({ id: c.id, given_name: c.given_name||'', family_name: c.family_name||'', phone: c.phone_number||'', display: entry.name });
          const dir = customerDirectory.find(x => x.squareId === c.id);
          if (dir) { dir.firstName = c.given_name||''; dir.lastName = c.family_name||''; dir.phone = c.phone_number||''; }
          else customerDirectory.push({ squareId: c.id, firstName: c.given_name||'', lastName: c.family_name||'', phone: c.phone_number||'', email: '', note: c.note||'' });
          localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
        }
      }
    } else {
      const iKey = rawPhone ? `muse-customer-${rawPhone}` : `muse-customer-${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
      const res = await fetch(`${SQUARE_PROXY}/v2/customers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: iKey, ...payload }) });
      if (res.ok) {
        const c = (await res.json()).customer;
        if (c) {
          squareCustomers.push({ id: c.id, given_name: c.given_name||'', family_name: c.family_name||'', phone: c.phone_number||'', display: entry.name });
          customerDirectory.push({ squareId: c.id, firstName: c.given_name||'', lastName: c.family_name||'', phone: c.phone_number||'', email: '', note: c.note||'' });
          localStorage.setItem('muse_customers', JSON.stringify(customerDirectory));
        }
      }
    }
  } catch (e) { console.warn('[Square] Customer upsert failed:', e); }
}
