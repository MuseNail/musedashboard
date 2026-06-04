// ── Per-service / entry status helpers (shared by queue + turns) ────────────
// Kept dependency-light (store + sync only) so queue.js and turns.js can both
// import it without an import cycle.

import { dispatch } from '../sync.js';

// Flow: waiting → inservice → complete → paid.
//   complete = service finished, payment pending (still active; tech earned the turn).
//   paid     = finalized sale (record created, counts in Reports, leaves the floor).
// 'done' is the LEGACY finalized status — treated everywhere as equivalent to 'paid'.
export function getAssignmentStatus(entry, assignment) {
  return assignment.status || 'waiting';
}
// Finalized = money collected / archived. Accepts legacy 'done'.
export const isPaidStatus = s => s === 'paid' || s === 'done';

export function deriveEntryStatus(entry) {
  if (!entry.assignments || entry.assignments.length === 0) return entry.status || 'waiting';
  const ss = entry.assignments.map(a => getAssignmentStatus(entry, a));
  if (ss.some(s => s === 'inservice')) return 'inservice';
  if (ss.every(isPaidStatus)) return 'paid';
  if (ss.every(s => s === 'complete' || isPaidStatus(s))) return 'complete';
  return 'waiting';
}

// Set entry.status from its assignments AND stamp entry.statusSince when the
// status actually changes, so views can show a timer that resets per status
// (waiting → inservice → complete). Call this instead of assigning entry.status
// directly, BEFORE dispatching, so statusSince syncs to every device.
// Pass isRevert=true when CORRECTING a mistake (moving a status backward) so the visible
// per-status timer isn't reset to now — instead it's restored from the anchor saved before the
// (mistaken) forward transition. One level of undo, which is all a correction needs.
export function applyEntryStatus(entry, isRevert) {
  const prev = entry.status;
  const next = deriveEntryStatus(entry);
  if (next !== prev) {
    if (isRevert && entry.prevStatusSince != null) {
      entry.statusSince = entry.prevStatusSince;   // correction → restore the pre-mistake timer
    } else {
      entry.prevStatusSince = entry.statusSince;   // remember the anchor so a later revert can restore it
      entry.statusSince = Date.now();
    }
  }
  entry.status = next;
  return next;
}
// ms timestamp the entry entered its current status (falls back to check-in =
// waiting start for entries that haven't transitioned yet).
export function entryStatusSince(entry) {
  return entry.statusSince || (entry.checkinTime ? new Date(entry.checkinTime).getTime() : Date.now());
}

// Per-assignment in-service clock. Accumulates the time THIS service spent
// "In Service" into a.serviceMs across however many spells (so "Back to In
// Service" then "Complete" again adds correctly), tracking the current spell's
// start in a.svcStartedAt. Both fields ride along on the assignment object, so
// they sync to every device and persist onto the saved record automatically.
// Call this instead of assigning a.status directly so timing is never missed.
export function applyAssignmentStatus(a, newStatus) {
  if (!a) return;
  const prev = a.status || 'waiting';
  if (prev !== 'inservice' && newStatus === 'inservice') {
    a.svcStartedAt = Date.now();
  } else if (prev === 'inservice' && newStatus !== 'inservice' && a.svcStartedAt) {
    a.serviceMs = (a.serviceMs || 0) + (Date.now() - a.svcStartedAt);
    a.svcStartedAt = 0;
  }
  a.status = newStatus;
  a.updatedAt = Date.now();   // per-assignment version → drives the per-assignment merge in queue.upsert (3c)
}

// Per-service-status visual tokens for the queue / turns / floor-plan cards — one source of
// truth so all three surfaces match. Each status carries THREE redundant cues (color-blind safe):
// a colored glyph shape, a tiny text pill, and a row accent. Only in-service gets the loud
// bar+tint ("the hot row"); paid fades. Palette = the staff-app STATUS_CHIP values.
// `dot` = the per-status fill/border for a CSS-DRAWN circle (not a text glyph): waiting/in-service
// are filled, complete is a ring (the "Done" outline look), paid is filled grey. Drawing the circle
// keeps every status the EXACT same diameter — Unicode glyphs (● vs ◍) render at different sizes.
// Render it as: <span style="display:inline-block;width:.8em;height:.8em;border-radius:50%;box-sizing:border-box;{dot}"></span>
export function serviceLineStyle(status) {
  if (isPaidStatus(status))    return { key: 'paid',      dot: 'background:#b4bec2',                                bar: '#b4bec2', tint: '',                          pill: { bg: '#dde2e5', fg: '#555555', label: 'Paid'   }, rowOpacity: 0.6 };
  if (status === 'inservice')  return { key: 'inservice', dot: 'background:#2a7a4f',                                bar: '#2a7a4f', tint: 'rgba(200,230,197,.35)', pill: { bg: '#c8e6c5', fg: '#1b5e20', label: 'In Svc' }, rowOpacity: 1 };
  if (status === 'complete')   return { key: 'complete',  dot: 'background:transparent;border:1.6px solid #1a5c7a', bar: '#1a5c7a', tint: '',                          pill: { bg: '#cfe3ef', fg: '#0a3a52', label: 'Done'   }, rowOpacity: 1 };
  return                              { key: 'waiting',   dot: 'background:#d4860a',                                bar: '#d4860a', tint: '',                          pill: { bg: '#ffe0c2', fg: '#6d3200', label: 'Wait'   }, rowOpacity: 0.9 };
}

export function setAssignmentStatus(entry, serviceId, newStatus, isRevert) {
  if (!entry.assignments) entry.assignments = [];
  const a = entry.assignments.find(x => x.serviceId === serviceId);
  if (a) applyAssignmentStatus(a, newStatus);
  applyEntryStatus(entry, isRevert);
  dispatch('queue.upsert', { entry });
  if (entry.status === 'paid') window.saveRecord?.(entry);   // finalize the sale only at Paid
  window.renderQueue?.(); window.updateStats?.(); window.renderTurns?.(); window.renderFloorPlan?.();
}
