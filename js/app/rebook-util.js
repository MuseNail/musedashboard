// ── Book-next-appointment (rebook) — pure helpers ────────────────────────────
// Node-safe (no DOM, no imports from DOM modules) so they can be unit-tested directly.
// The DOM side lives in features/rebook.js, mirroring the notif-util.js / notifications.js split.

// First token → first name, the rest → last name. Whitespace trimmed and collapsed.
export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

// Offer the rebook prompt only for a real, bookable SERVICE visit on the checkout device:
// the setting is on (default ON unless explicitly false), the ticket has a customer name,
// it is not a Quick Sale, and it carries at least one service (so gift-card-page sales and
// retail-only tickets don't prompt — you rebook a service visit, not a purchase).
export function shouldOfferRebook(entry, cfg) {
  if (!entry) return false;
  if ((cfg || {}).rebook_prompt === false) return false;
  if (entry.quickSale) return false;
  if (!String(entry.name || '').trim()) return false;
  if (!((entry.services || []).length > 0)) return false;
  return true;
}

// ── Rebook SETUP builders (carry the finished setup into the booking form) ────
// These are pure (no DOM) so the mapping is unit-tested directly. They emit the
// APPOINTMENT-canonical shape ({serviceId, staffId} / {name, phone, lines}); the DOM
// side (calendar.js showNewApptModal) translates serviceId→svcId and name→first/last
// exactly as showEditApptModal already does.

// Resolve ONE queue entry to appointment lines [{serviceId, staffId}]:
//  • each assignment → its serviceId + techId,
//  • plus any service with no assignment (staffId ''),
//  • a service no longer in the catalog is dropped,
//  • a tech who is gone or inactive resolves to '' (Unassigned) — a rebook must never
//    silently book a wrong or retired tech (active = in cfg.staff AND not inactive_staff,
//    mirroring calendar.js buildStaffColumns),
//  • deduped by serviceId; assignments first, then uncovered services.
export function buildRebookLines(entry, cfg) {
  if (!entry) return [];
  const c = cfg || {};
  const svcIds = new Set((c.services || []).map(s => s && s.id).filter(Boolean));
  const inactive = new Set(c.inactive_staff || []);
  const activeIds = new Set((c.staff || []).filter(s => s && s.id && !inactive.has(s.id)).map(s => s.id));
  const resolveStaff = id => (id && activeIds.has(id)) ? id : '';
  const out = [], seen = new Set();
  (entry.assignments || []).forEach(a => {
    const sid = a && a.serviceId;
    if (!sid || seen.has(sid) || !svcIds.has(sid)) return;
    seen.add(sid);
    out.push({ serviceId: sid, staffId: resolveStaff(a.techId) });
  });
  (entry.services || []).forEach(sid => {
    if (!sid || seen.has(sid) || !svcIds.has(sid)) return;
    seen.add(sid);
    out.push({ serviceId: sid, staffId: '' });
  });
  return out;
}

// Resolve a list of queue entries (one checkout party, or a single entry) to the rebook
// party [{name, phone, lines}], the real primary FIRST. The primary is the member flagged
// '(primary)' in its groupLabel (else entries[0]) and is ALWAYS kept, even with zero lines.
// A secondary with no name AND no lines is dropped. A secondary phone that duplicates an
// earlier member's is blanked (mirrors manual check-in's shared-contact handling) so saving
// the appointment doesn't churn the customer directory. name is entry.name, never groupLabel.
export function buildRebookParty(entries, cfg) {
  const list = (entries || []).filter(e => e && (String(e.name || '').trim() || (e.services || []).length || (e.assignments || []).length));
  if (!list.length) return [];
  let primaryIdx = list.findIndex(e => /\(primary\)\s*$/.test(String(e.groupLabel || '')));
  if (primaryIdx < 0) primaryIdx = 0;
  const ordered = [list[primaryIdx], ...list.filter((_, i) => i !== primaryIdx)];
  const seenPhones = new Set();
  const party = [];
  ordered.forEach((e, idx) => {
    const name = String(e.name || '').trim();
    const lines = buildRebookLines(e, cfg);
    if (idx > 0 && !name) return;   // a nameless secondary is dropped by saveAppt anyway — match that
    let phone = String(e.phone || '').trim();
    if (phone && seenPhones.has(phone)) phone = '';   // blank a duplicate phone (keep the name)
    if (phone) seenPhones.add(phone);
    party.push({ name, phone, lines });
  });
  return party;
}
