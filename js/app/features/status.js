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

export function setAssignmentStatus(entry, serviceId, newStatus) {
  if (!entry.assignments) entry.assignments = [];
  const a = entry.assignments.find(x => x.serviceId === serviceId);
  if (a) a.status = newStatus;
  entry.status = deriveEntryStatus(entry);
  dispatch('queue.upsert', { entry });
  if (entry.status === 'paid') window.saveRecord?.(entry);   // finalize the sale only at Paid
  window.renderQueue?.(); window.updateStats?.(); window.renderTurns?.(); window.renderFloorPlan?.();
}
