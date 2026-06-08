// ── Front-desk weekly schedule (separate from the tech schedule; carries HOURS) ──
// config.fd_schedule = {
//   "YYYY-MM-DD": { <fdId>: {s:"HH:MM", e:"HH:MM"} | "off" },   // explicit per-date
//   _repeats:     { <fdId>: { 0..6: {s,e} | "off" | null } },   // weekly default (Sun..Sat)
// }
// A working day is an object {s,e}; "off" = day off; null = unset; SCHED_NONE = one-off blank
// that overrides a weekly repeat (mirrors the tech schedule). Pay is from the time clock, NOT
// this — the schedule is the plan (e.g. come in later / leave earlier).
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { localDateStr, showToast } from '../utils.js';

const cfg = () => getState().config;
const SCHED_NONE = '__none__';
let fdWeekStart = _weekStart(new Date());
let fdPickerTarget = null;

function _weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _fmtTime = hhmm => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'p' : 'a'; const h12 = h % 12 === 0 ? 12 : h % 12; return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`; };
const _shiftLabel = sh => (sh && sh.s) ? `${_fmtTime(sh.s)}–${_fmtTime(sh.e)}` : '';

// Effective shift for a date: {s,e} (working) | 'off' | null (unset).
export function getFdShift(date, fdId) {
  const sched = cfg().fd_schedule || {};
  const ex = sched[date]?.[fdId];
  if (ex === SCHED_NONE) return null;
  if (ex) return ex;
  const dow = new Date(date + 'T12:00:00').getDay();
  return sched._repeats?.[fdId]?.[dow] || null;
}
export const fdShiftLabel = _shiftLabel;   // reused by the staff app's FD view

export function fdScheduleWeek(delta, today = false) {
  if (today) fdWeekStart = _weekStart(new Date());
  else { fdWeekStart = new Date(fdWeekStart); fdWeekStart.setDate(fdWeekStart.getDate() + delta * 7); }
  renderFdSchedule();
}

export function toggleFdScheduleView() {
  const listV = document.getElementById('fdusers-list-view'), schedV = document.getElementById('fdusers-schedule-view'), btn = document.getElementById('fd-schedule-view-btn');
  if (!listV || !schedV) return;
  const showingSched = !schedV.classList.contains('hidden');
  listV.classList.toggle('hidden', !showingSched);
  schedV.classList.toggle('hidden', showingSched);
  if (btn) { btn.style.background = showingSched ? '' : '#1a5252'; btn.style.color = showingSched ? '' : '#fff'; }
  if (!showingSched) renderFdSchedule();
}

export function renderFdSchedule() {
  const grid = document.getElementById('fd-schedule-grid'); if (!grid) return;
  const label = document.getElementById('fd-schedule-week-label');
  const sched = cfg().fd_schedule || {};
  const weekEnd = new Date(fdWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (label) label.textContent = `${fmtShort(fdWeekStart)} – ${fmtShort(weekEnd)}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dates = days.map((_, i) => { const d = new Date(fdWeekStart); d.setDate(d.getDate() + i); return d; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = d => d.toDateString() === today.toDateString();
  const stickyBg = 'background:var(--surface-container-lowest, #f5f7f8)';
  const headerCols = dates.map((d, i) => `<div class="text-center px-2 py-1.5 min-w-[92px]${isToday(d) ? ' bg-primary/5' : ''}"><div class="text-[11px] font-body font-semibold text-on-surface-variant uppercase tracking-widest">${days[i]}</div><div class="text-sm font-headline font-bold ${isToday(d) ? 'text-primary' : 'text-on-surface'}">${d.getDate()}</div></div>`).join('');
  const rows = (cfg().fd_users || []).map(u => {
    const cells = dates.map(d => {
      const key = localDateStr(d), sh = getFdShift(key, u.id);
      const isRepeat = !sched[key]?.[u.id] && sched._repeats?.[u.id]?.[d.getDay()];
      const off = sh === 'off', work = !!(sh && sh.s);
      const bg = off ? 'background:#f5c870;color:#3a2800;' : work ? 'background:#dcebea;color:#0a3a3a;' : '';
      const txt = off ? 'Off' : work ? _shiftLabel(sh) : '';
      const isPast = d < today && !isToday(d);
      return `<div class="min-w-[92px] px-1 py-0.5"><button onclick="openFdShiftPicker('${key}','${u.id}')" class="w-full h-9 rounded-lg text-[11px] font-body font-semibold transition-all hover:opacity-80 border relative ${(off || work) ? 'border-transparent' : 'border-dashed border-outline-variant/50 hover:bg-surface-container'} ${isPast ? 'opacity-50' : ''}" style="${bg}">${txt}${isRepeat ? '<span style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#15514f;box-shadow:0 0 0 1px rgba(255,255,255,0.7)"></span>' : ''}</button></div>`;
    }).join('');
    const photo = u.photo ? `<img src="${_esc(u.photo)}" class="w-8 h-8 rounded-full object-cover border border-surface-container-high flex-shrink-0">` : `<div class="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0"><span class="text-xs font-headline font-bold text-on-surface">${_esc((u.name || '?').charAt(0).toUpperCase())}</span></div>`;
    return `<div class="flex items-center border-b border-surface-container-high last:border-0"><div class="flex items-center gap-2 w-[150px] pr-2 py-1 flex-shrink-0 sticky left-0 z-10" style="${stickyBg}">${photo}<span class="text-sm font-body font-semibold text-on-surface truncate min-w-0 flex-grow">${_esc(u.name)}</span></div>${cells}</div>`;
  }).join('');
  grid.innerHTML = `<div class="flex items-center border-b-2 border-surface-container-high sticky top-0 z-20" style="${stickyBg}"><div class="w-[150px] flex-shrink-0 sticky left-0 z-30" style="${stickyBg}"></div>${headerCols}</div>${rows || '<div class="text-sm font-body text-on-surface-variant py-8 text-center">No front-desk users yet — add one above.</div>'}`;
}

export function openFdShiftPicker(date, fdId) {
  fdPickerTarget = { date, fdId };
  const u = (cfg().fd_users || []).find(x => x.id === fdId);
  const d = new Date(date + 'T12:00:00'), cur = getFdShift(date, fdId);
  const lab = document.getElementById('fd-shift-picker-label');
  if (lab) lab.textContent = `${u?.name || ''} — ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const s = document.getElementById('fd-shift-start'), e = document.getElementById('fd-shift-end');
  if (s) s.value = (cur && cur.s) ? cur.s : '09:00';
  if (e) e.value = (cur && cur.e) ? cur.e : '17:00';
  const hasRepeat = !!(cfg().fd_schedule?._repeats?.[fdId]?.[d.getDay()]);
  const cb = document.getElementById('fd-repeat-cb'); if (cb) cb.checked = hasRepeat;
  _fdRepeatVisual(hasRepeat);
  const m = document.getElementById('fd-shift-picker'); if (m) { m.classList.remove('hidden'); m.style.display = 'flex'; }
}
function _fdRepeatVisual(on) { const box = document.getElementById('fd-repeat-box'), chk = document.getElementById('fd-repeat-check'); if (box) { box.style.background = on ? '#1a5252' : 'transparent'; box.style.borderColor = on ? '#1a5252' : ''; } if (chk) chk.classList.toggle('hidden', !on); }
export function fdToggleRepeat() { const cb = document.getElementById('fd-repeat-cb'); if (!cb) return; cb.checked = !cb.checked; _fdRepeatVisual(cb.checked); }
export function closeFdShiftPicker() { const m = document.getElementById('fd-shift-picker'); if (m) { m.classList.add('hidden'); m.style.display = ''; } fdPickerTarget = null; }

// value: {s,e} (working) | 'off' | null (clear)
function _setFdShift(value) {
  if (!fdPickerTarget) return;
  const { date, fdId } = fdPickerTarget;
  const repeat = document.getElementById('fd-repeat-cb')?.checked || false;
  const dow = new Date(date + 'T12:00:00').getDay();
  const sched = JSON.parse(JSON.stringify(cfg().fd_schedule || {}));
  if (repeat && value !== null) { sched._repeats = sched._repeats || {}; sched._repeats[fdId] = sched._repeats[fdId] || {}; sched._repeats[fdId][dow] = value; }
  else if (repeat && value === null) { if (sched._repeats?.[fdId]?.[dow]) delete sched._repeats[fdId][dow]; }
  if (!sched[date]) sched[date] = {};
  if (value === null) {
    if (sched._repeats?.[fdId]?.[dow]) sched[date][fdId] = SCHED_NONE;   // blank one day a repeat covers
    else { delete sched[date][fdId]; if (Object.keys(sched[date]).length === 0) delete sched[date]; }
  } else sched[date][fdId] = value;
  dispatch('config.set', { key: 'fd_schedule', value: sched });
  closeFdShiftPicker();
  renderFdSchedule();
}
export function saveFdShift() {
  const s = document.getElementById('fd-shift-start')?.value, e = document.getElementById('fd-shift-end')?.value;
  if (!s || !e) { showToast('Enter a start and end time.'); return; }
  _setFdShift({ s, e });
}
export function setFdShiftOff() { _setFdShift('off'); }
export function clearFdShift() { _setFdShift(null); }
