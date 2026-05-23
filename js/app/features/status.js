// ── Per-service / entry status helpers (shared by queue + turns) ────────────
// Kept dependency-light (store + sync only) so queue.js and turns.js can both
// import it without an import cycle.

import { dispatch } from '../sync.js';

// Each service assignment carries its own status; unset = 'waiting'.
export function getAssignmentStatus(entry, assignment) {
  return assignment.status || 'waiting';
}

// Derive the entry-level status from its assignments:
// any inservice → inservice; all done → done; else waiting.
export function deriveEntryStatus(entry) {
  if (!entry.assignments || entry.assignments.length === 0) return entry.status || 'waiting';
  const statuses = entry.assignments.map(a => getAssignmentStatus(entry, a));
  if (statuses.some(s => s === 'inservice')) return 'inservice';
  if (statuses.every(s => s === 'done'))     return 'done';
  return 'waiting';
}

export function setAssignmentStatus(entry, serviceId, newStatus) {
  if (!entry.assignments) entry.assignments = [];
  const a = entry.assignments.find(x => x.serviceId === serviceId);
  if (a) a.status = newStatus;
  entry.status = deriveEntryStatus(entry);
  dispatch('queue.upsert', { entry });
  if (entry.status === 'done') window.saveRecord?.(entry);
  window.renderQueue?.(); window.updateStats?.(); window.renderTurns?.();
}
