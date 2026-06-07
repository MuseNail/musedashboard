// ── Front-desk time clock ────────────────────────────────────────────────────
// The logged-in front-desk user clocks in/out from a header button. Punches are
// synced per-user (config key `fd_clock_<id>` = [{ in:ms, out:ms|null }]) — a key
// per user so two devices punching different people can't clobber each other.
// Payroll computes paid hours from these punches with the owner's rounding: each
// clock-in→out segment's duration is rounded to the nearest 15 min (≤7 min grace
// rounds down, ≥8 rounds up).
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { getActiveUser } from '../session.js';
import { showToast } from '../utils.js';

const cfg = () => getState().config;
const _key = id => 'fd_clock_' + id;

export function fdPunches(userId) { return Array.isArray(cfg()[_key(userId)]) ? cfg()[_key(userId)] : []; }
export function fdIsClockedIn(userId) { const last = fdPunches(userId).slice(-1)[0]; return !!(last && last.in && !last.out); }
export function fdClockedSince(userId) { const last = fdPunches(userId).slice(-1)[0]; return (last && last.in && !last.out) ? last.in : null; }

function _save(userId, list) { dispatch('config.set', { key: _key(userId), value: list }); }
// Manager/admin timecard editing (reports.js) replaces a user's whole punch list.
export function fdSetPunches(userId, list) { _save(userId, Array.isArray(list) ? list : []); }

export function fdClockIn(userId) {
  if (!userId || fdIsClockedIn(userId)) return;
  _save(userId, [...fdPunches(userId), { in: Date.now(), out: null }]);
}
export function fdClockOut(userId) {
  const list = [...fdPunches(userId)];
  const last = list[list.length - 1];
  if (!last || last.out) return;                     // not clocked in → nothing to close
  list[list.length - 1] = { ...last, out: Date.now() };
  _save(userId, list);
}

// Header button: the logged-in FD user toggles their own clock. The synthetic
// "fallback" Manager (PIN 1234, no fd_users entry) can't clock — there's no profile/rate.
export function toggleMyClock() {
  const u = getActiveUser();
  if (!u || !u.id || u.id === 'fallback' || !(cfg().fd_users || []).some(x => x.id === u.id)) {
    showToast('Log in as a front-desk user to clock in.'); return;
  }
  if (!isClockStation()) { showToast('Clock in/out is only available on the salon time-clock station.'); return; }
  if (fdIsClockedIn(u.id)) { fdClockOut(u.id); showToast(`Clocked out — ${u.name}`); }
  else { fdClockIn(u.id); showToast(`Clocked in — ${u.name}`); }
  renderClockButton();
}

export function renderClockButton() {
  const btn = document.getElementById('clock-btn'); if (!btn) return;
  const u = getActiveUser();
  // Only on the designated salon station (so staff can't clock in from a personal phone).
  const show = !!(u && u.id && u.id !== 'fallback' && (cfg().fd_users || []).some(x => x.id === u.id)) && isClockStation();
  btn.style.display = show ? 'inline-flex' : 'none';
  if (!show) return;
  const inNow = fdIsClockedIn(u.id), since = fdClockedSince(u.id);
  const lbl = document.getElementById('clock-btn-label');
  btn.style.background = inNow ? '#2a7a4f' : '';
  btn.style.borderColor = inNow ? '#2a7a4f' : 'var(--primary)';
  btn.style.color = inNow ? '#fff' : 'var(--primary)';
  if (lbl) lbl.textContent = inNow ? `Clock Out · in ${_hhmm(since)}` : 'Clock In';
}
function _hhmm(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }

// ── Time-clock station (one designated device) ───────────────────────────────
// Clocking only works on the device an admin designated as the salon station — so a
// front-desk user can't clock in from a personal phone. The chosen device's id is stored
// in synced config (timeclock_device_id) and compared against this device's muse_device_id.
function _myDeviceId() { try { return localStorage.getItem('muse_device_id') || ''; } catch { return ''; } }
export function clockStationDeviceId() { return cfg().timeclock_device_id || ''; }
export function isClockStation() { const s = clockStationDeviceId(); return !!s && s === _myDeviceId(); }
export function setThisClockStation() {
  if (getActiveUser()?.role !== 'admin') { showToast('Only an admin can set the time-clock station.'); return; }
  const id = _myDeviceId();
  if (!id) { showToast('This device has no id yet — reload and try again.'); return; }
  dispatch('config.set', { key: 'timeclock_device_id', value: id });
  showToast('This device is now the time-clock station ✓');
  renderClockButton(); renderClockStationSetting();
}
export function clearClockStation() {
  if (getActiveUser()?.role !== 'admin') { showToast('Only an admin can change the time-clock station.'); return; }
  dispatch('config.set', { key: 'timeclock_device_id', value: '' });
  showToast('Time-clock station cleared');
  renderClockButton(); renderClockStationSetting();
}
// Fills #timeclock-station-status inside the Pay Period settings section.
export function renderClockStationSetting() {
  const el = document.getElementById('timeclock-station-status'); if (!el) return;
  const setId = clockStationDeviceId(), isThis = isClockStation(), isSet = !!setId;
  el.innerHTML = isThis
    ? `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style="background:rgba(42,122,79,.12)"><span class="text-sm font-body" style="color:#1b5e20"><strong>This device</strong> is the time-clock station ✓</span><button onclick="clearClockStation()" class="text-xs font-body text-error underline flex-shrink-0">Remove</button></div>`
    : `<div class="flex items-center justify-between gap-2 flex-wrap"><span class="text-sm font-body text-on-surface-variant">${isSet ? 'Another device is the station.' : 'No station set yet — staff can’t clock in until one is set.'}</span><button onclick="setThisClockStation()" class="px-3 py-2 rounded-xl bg-primary text-on-primary text-sm font-body font-semibold flex-shrink-0">Make this device the station</button></div>`;
}

// ── Pay computation (used by payroll) ────────────────────────────────────────
// Round a duration (ms) to the nearest quarter hour → hours (e.g. 7 min → 0, 8 → 0.25).
export function roundQuarterHours(ms) { return Math.round((ms / 60000) / 15) * 15 / 60; }

// Paid hours for a user whose shifts STARTED within [fromMs, toMs] — each completed
// segment rounded to the nearest 15 min, then summed. Open (not-yet-clocked-out) punches
// are ignored. Returns { hours, openShift } where openShift flags an in-progress punch.
export function fdPaidHours(userId, fromMs, toMs) {
  let hours = 0, openShift = false;
  for (const p of fdPunches(userId)) {
    if (!p.in || p.in < fromMs || p.in > toMs) continue;
    if (!p.out) { openShift = true; continue; }
    hours += roundQuarterHours(p.out - p.in);
  }
  return { hours, openShift };
}
