// ── One-time Google → app-native import (Release A only) ────────────────────
// Pure, dependency-free transforms that turn the Google Calendar/Tasks payloads Muse used to
// write into app-native appointment/task records. Kept in their own module so the whole Google
// import is a single file to delete in Release B (the clean break). The async fetch/dispatch
// orchestration lives in calendar.js (it needs gapi + the token refresh); these are the testable
// core: fan-out regrouping and the task mapping.

// Muse wrote one Google event PER PERSON PER CALENDAR the person's lines touched — every copy of a
// person carries the same museName + museLines (that person's full line set). museLines is a JSON
// array of { svcId, calId } (calId = the tech's Google calendar id). A booking's copies share a
// museGroupId; the primary guest's copies carry musePrimary='1' plus musePrimaryName/Phone.

function _parseMuseLines(ev) {
  const raw = ev && ev.extendedProperties && ev.extendedProperties.private
    ? ev.extendedProperties.private.museLines : undefined;
  if (raw === undefined) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
// A Google event is a Muse appointment only if it carries Muse metadata — this deliberately
// EXCLUDES personal/all-day/vacation events on a tech's calendar (so they never import as fake
// bookings) and makes idempotency airtight.
function _isMuseAppt(ev) {
  const ext = (ev && ev.extendedProperties && ev.extendedProperties.private) || {};
  return !!(ext.museGroupId || ext.museLines !== undefined || ext.musePhone);
}

// Regroup the fan-out into one app-native appointment per booking. `calToStaff` maps a Google
// calendar id → a config.staff id (built by the caller from calendarList.list, name-matched); a
// line whose calId isn't in the map becomes Unassigned (staffId '') and is counted. `genId` mints
// a fresh app-native appointment id (injected so tests are deterministic).
// Returns { appts, unmatchedLines }.
export function _regroupGoogleAppts(events, calToStaff, genId) {
  const map = calToStaff || {};
  let _seq = 0;
  const gen = genId || (() => 'appt_g' + Date.now().toString(36) + '_' + (_seq++).toString(36) + Math.random().toString(36).slice(2, 6));
  const groups = new Map();
  (events || []).forEach(ev => {
    if (!_isMuseAppt(ev)) return;
    if (!ev.start || !ev.start.dateTime) return;   // timed singles only (drops all-day / date-only)
    const ext = ev.extendedProperties.private || {};
    const gid = ext.museGroupId || ('solo:' + ev.id);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(ev);
  });
  let unmatchedLines = 0;
  const appts = [];
  groups.forEach((evs, gid) => {
    const primaryEv = evs.find(e => ((e.extendedProperties && e.extendedProperties.private) || {}).musePrimary === '1') || evs[0];
    const ppriv = (primaryEv.extendedProperties && primaryEv.extendedProperties.private) || {};
    const start = new Date(primaryEv.start.dateTime);
    if (isNaN(start)) return;
    const endRaw = primaryEv.end && primaryEv.end.dateTime ? new Date(primaryEv.end.dateTime) : null;
    const end = (endRaw && !isNaN(endRaw)) ? endRaw : new Date(start.getTime() + 60 * 60000);
    const notes = primaryEv.description || '';
    const confirmed = evs.some(e => ((e.extendedProperties && e.extendedProperties.private) || {}).museConfirmed === '1');
    const noShow = evs.some(e => ((e.extendedProperties && e.extendedProperties.private) || {}).museNoShow === '1');
    // Dedupe guests by museName — cross-calendar copies of one person collapse to one guest.
    const byName = new Map();
    evs.forEach(e => {
      const ep = (e.extendedProperties && e.extendedProperties.private) || {};
      const nm = ep.museName || (e.summary || '').split(' — ')[0] || 'Guest';
      if (byName.has(nm)) return;
      const lines = _parseMuseLines(e).filter(l => l && (l.svcId || l.calId)).map(l => {
        const staffId = Object.prototype.hasOwnProperty.call(map, l.calId) ? (map[l.calId] || '') : '';
        if (l.calId && !staffId) unmatchedLines++;
        return { serviceId: l.svcId || '', staffId };
      });
      byName.set(nm, { name: nm, phone: ep.musePhone || '', lines });
    });
    let guests = [...byName.values()];
    if (!guests.length) return;
    // Order the primary guest to guests[0] — consumers read guests[0] as the booking name.
    const primaryName = ppriv.musePrimaryName || ppriv.museName || (primaryEv.summary || '').split(' — ')[0] || '';
    if (primaryName) {
      const idx = guests.findIndex(g => g.name === primaryName);
      if (idx > 0) { const pg = guests.splice(idx, 1)[0]; guests.unshift(pg); }
    }
    const now = Date.now();
    appts.push({ id: gen(), start: start.toISOString(), end: end.toISOString(), guests, notes, confirmed, noShow, googleGroupId: gid, createdAt: now, updatedAt: now });
  });
  return { appts, unmatchedLines };
}

// Map one Google task → an app-native task. `listTitle` is the Google task-list name (kept as the
// app-native `list` label). `genId` mints a fresh app-native id. Google subtasks are flattened to
// top-level (the `parent` field is dropped). Returns null for an empty task.
export function _mapGoogleTask(gt, listTitle, genId) {
  if (!gt || (gt.title == null && gt.notes == null && gt.status == null)) return null;
  let _seq = 0;
  const gen = genId || (() => 'task_g' + Date.now().toString(36) + '_' + (_seq++).toString(36) + Math.random().toString(36).slice(2, 6));
  const now = Date.now();
  return {
    id: gen(),
    title: gt.title || '',
    notes: gt.notes || '',
    due: gt.due || '',
    completed: gt.status === 'completed',
    completedAt: gt.completed || '',
    list: listTitle || 'Tasks',
    googleTaskId: gt.id || '',
    sortIndex: now,
    createdAt: now, updatedAt: now,
  };
}
