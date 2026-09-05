// ── Break time-blocks (pure helpers) ────────────────────────────────────────
// A break = { id, staffId, start(ISO), end(ISO), label }. Per-tech time blocks (e.g. lunch),
// stored in the synced config list cfg().breaks. They grey the tech's calendar column for the
// window and flag the tech "On Break" in the Assign & Price tech picker while active. They do NOT
// affect the Turns rotation or the "next up" logic. Pure + dependency-free → unit-tested in
// isolation; callers pass cfg().breaks.

function _activeAt(b, atMs) {
  const s = +new Date(b.start), e = +new Date(b.end);
  return isFinite(s) && isFinite(e) && s <= atMs && atMs < e;
}

// Is this tech inside a break window at `atMs` (default: now)? Drives the Assign & Price flag.
export function staffOnBreakNow(breaks, staffId, atMs = Date.now()) {
  const sid = String(staffId == null ? '' : staffId);
  return (breaks || []).some(b => b && String(b.staffId) === sid && _activeAt(b, atMs));
}

// This tech's breaks overlapping the [dayStartMs, dayEndMs) window, start-sorted — for rendering
// the greyed bands on that tech's calendar column for the viewed day.
export function breaksForColumnDay(breaks, staffId, dayStartMs, dayEndMs) {
  const sid = String(staffId == null ? '' : staffId);
  return (breaks || []).filter(b => {
    if (!b || String(b.staffId) !== sid) return false;
    const s = +new Date(b.start), e = +new Date(b.end);
    return isFinite(s) && isFinite(e) && s < dayEndMs && e > dayStartMs;   // overlaps the day
  }).sort((a, b) => +new Date(a.start) - +new Date(b.start));
}
