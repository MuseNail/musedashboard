// ── Notification-bell pure helpers ───────────────────────────────────────────
// No DOM / store / dispatch → unit-testable. Used by features/notifications.js (badge + panel)
// and features/timeclock.js (clock gate). See test/notifications.test.js.

// Only the actionable clock state belongs in the bell. 'notice' (a front-desk user signed in off
// the station device) is permanent and non-clearable, so it must NOT light the bell — only 'warn'
// (the admin station-changed condition they can actually resolve).
export const clockStateNeedsAttention = (state) => state === 'warn';

// Severity order + per-source role gate. caps = { isAdmin, isManager } where isManager = the elevated
// tier (admin OR manager). Drops zero-count sources, returns the ordered list + badge total + danger flag.
const NOTIF_SPEC = [
  { id: 'failedWrites', danger: true,  gate: c => c.isAdmin || c.isManager },
  { id: 'supportNew',   danger: false, gate: c => c.isAdmin || c.isManager },
  { id: 'supportReply', danger: false, gate: () => true },
  { id: 'chat',         danger: false, gate: () => true },
  { id: 'tasks',        danger: false, gate: () => true },
  { id: 'clock',        danger: false, gate: c => c.isAdmin },
  { id: 'update',       danger: false, gate: () => true },
];
export function buildNotifItems(counts = {}, caps = {}) {
  const items = [];
  let total = 0, hasDanger = false;
  for (const s of NOTIF_SPEC) {
    const n = +counts[s.id] || 0;
    if (n <= 0 || !s.gate(caps)) continue;
    items.push({ id: s.id, count: n, danger: s.danger });
    total += n;
    if (s.danger) hasDanger = true;
  }
  return { items, total, hasDanger };
}
