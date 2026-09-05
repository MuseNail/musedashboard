// ── Tech's own appointments (pure, app-native) ──────────────────────────────
// Replaces the old Google-Calendar read in staff.js. One row per booking the tech has a service
// line in, within [today 00:00, today+days+1 00:00) — the same window the Google reader used
// (today + the next `days` days). Shows only THIS tech's services and the booking's primary name.
// Pure + dependency-free so it's unit-tested in isolation; staff.js feeds it the synced
// getState().appointments, the tech's config.staff[].id, and the service list.
export function deriveMyAppts(appointments, staffId, services, nowMs, days) {
  const sid = String(staffId == null ? '' : staffId);
  if (!sid) return [];
  const from = new Date(nowMs); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + days + 1);   // exclusive upper bound (mirrors the old +DAYS+1)
  const fromMs = +from, toMs = +to;
  const label = id => (services || []).find(s => s.id === id)?.label;
  const out = [];
  (appointments || []).forEach(a => {
    if (!a || !a.start) return;
    const startMs = +new Date(a.start);
    if (!isFinite(startMs) || startMs < fromMs || startMs >= toMs) return;
    const myLines = (a.guests || []).flatMap(g => g.lines || []).filter(l => l && String(l.staffId) === sid && l.serviceId);
    if (!myLines.length) return;   // this tech isn't on this booking
    const endMs = a.end ? +new Date(a.end) : NaN;
    const g0 = (a.guests || [])[0] || {};
    out.push({
      startMs,
      endMs: isFinite(endMs) ? endMs : startMs + 3600000,
      name: g0.name || 'Guest',
      guests: Math.max(0, (a.guests || []).length - 1),
      services: [...new Set(myLines.map(l => label(l.serviceId)).filter(Boolean))],
      notes: (a.notes || '').trim(),
      confirmed: !!a.confirmed,
      noShow: !!a.noShow,
    });
  });
  out.sort((x, y) => x.startMs - y.startMs);
  return out;
}
