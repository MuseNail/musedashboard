// ── Square Config Modal ───────────────────────────
function showSquareModal() {
  if (squareConfig) {
    document.getElementById('sq-location').value = squareConfig.locationId || '';
    // Pre-populate team member dropdown if we already have members loaded
    const sel = document.getElementById('sq-booking-member');
    if (sel && sel.options.length <= 1 && squareConfig.locationId) {
      loadSquareBookingTeamMembers();
    } else if (sel && squareConfig.bookingTeamMemberId) {
      sel.value = squareConfig.bookingTeamMemberId;
    }
  }
  document.getElementById('square-modal').classList.remove('hidden');
  document.getElementById('square-modal').style.display = 'flex';
}

function saveSquareConfig() {
  const locationId = document.getElementById('sq-location').value.trim();
  if (!locationId) { showToast('Please enter your Location ID.'); return; }
  const sel = document.getElementById('sq-booking-member');
  const memberId   = sel?.value || '';
  const memberName = sel?.options[sel.selectedIndex]?.text || '';
  squareConfig = {
    locationId,
    ...(memberId ? { bookingTeamMemberId: memberId, bookingTeamMemberName: memberName } : {}),
  };
  localStorage.setItem('muse_sq_config', JSON.stringify(squareConfig));
  document.getElementById('square-modal').classList.add('hidden');
  document.getElementById('square-modal').style.display = '';
  updateSyncLabel('ok', 'Square synced');
  showToast('Square connection saved!');
}

async function testSquareConnection() {
  if (!squareConfig) { showToast('Save config first.'); return; }
  const status = document.getElementById('sq-status');
  status.classList.remove('hidden');
  status.textContent = 'Testing connection…';
  try {
    const res = await fetch(`${SQUARE_PROXY}/v2/locations`);
    if (res.ok) {
      status.textContent = '✓ Connected successfully!';
      status.style.color = '#2a6868';
      updateSyncLabel('ok', 'Square synced');
    } else {
      const err = await res.json();
      status.textContent = '✗ ' + (err.errors?.[0]?.detail || 'Connection failed — check your Location ID');
      status.style.color = '#a83836';
      updateSyncLabel('error', 'Square error');
    }
  } catch(e) {
    status.textContent = '✗ Could not reach proxy — check Worker is deployed';
    status.style.color = '#a83836';
  }
}

async function syncSquare() {
  if (!squareConfig) { showSquareModal(); return; }
  updateSyncLabel('pending', 'Syncing…');
  showToast('Syncing with Square…');
  try {
    await Promise.all([loadSquareCustomers(), squarePullServices()]);
    updateSyncLabel('ok', 'Square synced');
    showToast('Square sync complete');
  } catch(e) {
    updateSyncLabel('error', 'Sync failed');
    showToast('Square sync failed. Check settings.');
  }
}

function updateSyncLabel(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (dot) { dot.className = `sync-dot ${state}`; }
  if (lbl) lbl.textContent = label;
}


// ── Square Catalog Pull ───────────────────────────
// Pull catalog items from Square and merge into SERVICES, ITEMS, FEES.
// Square returns ITEM type for retail products and SERVICE type for services.
// We keep them strictly separated — ITEM catalog objects → ITEMS only,
// SERVICE catalog objects → SERVICES or FEES (if name contains fee/charge).
async function squarePullServices() {
  if (!squareConfig) return;
  try {
    // Square stores both services and retail items as ITEM type.
    // Services are distinguished by product_type === 'APPOINTMENTS_SERVICE'.
    // A single ITEM request replaces the old two-request approach (SERVICE type
    // is not a valid CatalogObjectType in Square's current API).
    const res = await fetch(`${SQUARE_PROXY}/v2/catalog/list?types=ITEM`);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const e = await res.json();
        detail = e.errors?.[0]?.detail || e.errors?.[0]?.code || e.errors?.[0]?.category || detail;
      } catch {}
      showToast(`Square catalog: ${detail}`);
      console.warn('Square catalog error:', res.status, detail);
      return;
    }

    const data = await res.json();
    let addedSvc = 0, addedItems = 0;

    (data.objects || []).forEach(item => {
      const name = item.item_data?.name;
      if (!name) return;
      const lname = name.toLowerCase();
      const isService = item.item_data?.product_type === 'APPOINTMENTS_SERVICE';

      // Fee/charge/surcharge names always route to FEES regardless of product type
      if (lname.includes('fee') || lname.includes('charge') || lname.includes('surcharge')) {
        const id = `sq-fee-${item.id}`;
        if (!FEES.find(f => f.id === id || f.label.toLowerCase() === lname)) {
          const price = item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
          FEES.push({ id, label: name, type: 'flat', value: price ? price / 100 : 0, squareItemId: item.id });
        }
        return;
      }

      if (isService) {
        // Appointments service → SERVICES
        const id = `sq-${item.id}`;
        if (!SERVICES.find(s => s.id === id || s.label.toLowerCase() === lname)) {
          const abbr = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
          const variationId = item.item_data?.variations?.[0]?.id || null;
          SERVICES.push({ id, label: name, abbr, squareItemId: item.id, squareVariationId: variationId });
          addedSvc++;
        }
      } else {
        // Retail item → ITEMS (skip if already tracked as a service)
        if (SERVICES.find(s => s.label.toLowerCase() === lname)) return;
        const id = `sq-item-${item.id}`;
        if (!ITEMS.find(i => i.id === id || i.label.toLowerCase() === lname)) {
          const abbr = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
          const price = item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
          ITEMS.push({ id, label: name, abbr, price: price ? price / 100 : 0, squareItemId: item.id });
          addedItems++;
        }
      }
    });

    if (addedSvc > 0)   showToast(`${addedSvc} service${addedSvc>1?'s':''} imported from Square`);
    if (addedItems > 0) showToast(`${addedItems} item${addedItems>1?'s':''} imported from Square`);
    if (addedSvc === 0 && addedItems === 0) showToast('Catalog already up to date');

    // Single consolidated push — saves services, items, and fees in one Sheets write
    _configWriteTime = Date.now();
    setTimeout(() => pushConfigToSheets(), 500);
  } catch(e) {
    console.warn('Could not pull Square catalog:', e);
  }
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
