// ── Utilities (pure-ish helpers + clock/toast/numpad) ───────────────────────
// Ported from the original utils.js. No global mutable app state lives here.
// Functions used by inline HTML handlers are exported and attached to window in main.js.

// ── Clock ────────────────────────────────────────
export function startClock() {
  function tick() {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes().toString().padStart(2, '0');
    const clockEl = document.getElementById('clock-display');
    if (clockEl) clockEl.textContent = `${h}:${m}`;

    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dateEl = document.getElementById('date-display');
    if (dateEl) dateEl.textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  }
  tick();
  setInterval(tick, 1000);
}

export function updateDeskDate() {
  const now = new Date();
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const el = document.getElementById('desk-date');
  if (el) el.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
}

// ── Auto Capitalize ───────────────────────────────
export function autoCapitalize(input) {
  const val = input.value;
  if (!val) return;
  input.value = val.replace(/(?:^|\s|-)\S/g, c => c.toUpperCase());
}

// ── Local Date Helper ─────────────────────────────
// Always local date (not UTC) so end-of-day in US timezones keeps the right date.
export function localDateStr(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
export function todayStr() { return localDateStr(new Date()); }

// ── Deduplication helper ──────────────────────────
export function dedupByLabel(arr) {
  const seen = new Set();
  return (arr || []).filter(item => {
    const key = (item.label || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Elapsed Time Timer ────────────────────────────
let _elapsedTimer = null;
export function startElapsedTimer() {
  if (_elapsedTimer) return;
  _elapsedTimer = setInterval(updateElapsedTimes, 10000);
  updateElapsedTimes();
}
export function updateElapsedTimes() {
  const now = Date.now();
  document.querySelectorAll('[data-checkin-ts]').forEach(el => {
    const ts = parseInt(el.dataset.checkinTs);
    if (!ts) return;
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) el.textContent = 'just now';
    else if (mins < 60) el.textContent = mins + 'm';
    else el.textContent = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  });
}
export function formatElapsed(checkinTime) {
  const ts = checkinTime instanceof Date ? checkinTime.getTime() : new Date(checkinTime).getTime();
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

// ── Phone Formatting ─────────────────────────────
export function formatPhone(input) {
  let digits = input.value.replace(/\D/g, '').slice(0, 10);
  let formatted = '';
  if (digits.length === 0)      formatted = '';
  else if (digits.length <= 3)  formatted = `(${digits}`;
  else if (digits.length <= 6)  formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  else                          formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  input.value = formatted;
}

// ── Numeric Keypad ────────────────────────────────
let _numpadTarget = null, _numpadRaw = '', _numpadCallback = null, _numpadMode = 'cost';

export function openNumpad(inputEl, label) {
  if (window.matchMedia('(pointer: fine)').matches) return;
  _numpadMode = 'cost'; _numpadTarget = inputEl; _numpadCallback = null;
  const existing = (inputEl.value || '').replace(/[^0-9.]/g, '');
  _numpadRaw = existing && !isNaN(parseFloat(existing)) ? Math.round(parseFloat(existing) * 100).toString() : '';
  document.getElementById('numpad-label').textContent = label || 'Cost';
  document.getElementById('numpad-dot-key').textContent  = '.';
  document.getElementById('numpad-plus-key').textContent = '+';
  _numpadUpdateDisplay();
  const m = document.getElementById('numpad-modal');
  m.classList.remove('hidden'); m.style.display = 'flex';
  inputEl.blur();
}

export function openPhoneNumpad(inputEl, label) {
  if (window.matchMedia('(pointer: fine)').matches) return;
  _numpadMode = 'phone'; _numpadTarget = inputEl; _numpadCallback = null;
  _numpadRaw = (inputEl.value || '').replace(/\D/g, '').slice(0, 10);
  document.getElementById('numpad-label').textContent = label || 'Phone Number';
  document.getElementById('numpad-dot-key').textContent  = '';
  document.getElementById('numpad-plus-key').textContent = '';
  _numpadUpdateDisplay();
  const m = document.getElementById('numpad-modal');
  m.classList.remove('hidden'); m.style.display = 'flex';
  inputEl.blur();
}

function _numpadUpdateDisplay() {
  const el = document.getElementById('numpad-display');
  if (_numpadMode === 'phone') {
    const d = _numpadRaw;
    let f = '';
    if (d.length === 0) f = '';
    else if (d.length <= 3) f = '(' + d;
    else if (d.length <= 6) f = '(' + d.slice(0,3) + ') ' + d.slice(3);
    else f = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6,10);
    el.textContent = f || '—';
  } else {
    const cents = parseInt(_numpadRaw || '0', 10);
    el.textContent = '$' + (cents / 100).toFixed(2);
  }
}

export function numpadKey(key) {
  if (_numpadMode === 'phone') {
    if (key === '.' || key === '+') return;
    if (_numpadRaw.length >= 10) return;
    if (key === '00') {
      if (_numpadRaw.length + 2 <= 10) _numpadRaw += '00';
      else if (_numpadRaw.length + 1 <= 10) _numpadRaw += '0';
    } else { _numpadRaw += key; }
    _numpadUpdateDisplay();
    return;
  }
  if (key === '.' || key === '+') return;
  if (key === '00') { if (_numpadRaw === '' || _numpadRaw === '0') return; _numpadRaw += '00'; }
  else { if (_numpadRaw === '0') _numpadRaw = key; else _numpadRaw += key; }
  if (_numpadRaw.length > 6) _numpadRaw = _numpadRaw.slice(0, 6);
  _numpadUpdateDisplay();
}

export function numpadBackspace() { _numpadRaw = _numpadRaw.slice(0, -1); _numpadUpdateDisplay(); }

export function numpadConfirm() {
  if (_numpadTarget) {
    if (_numpadMode === 'phone') {
      const d = _numpadRaw;
      let f = '';
      if (d.length === 10) f = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
      else if (d.length > 0) f = d;
      _numpadTarget.value = f;
    } else {
      const cents = parseInt(_numpadRaw || '0', 10);
      _numpadTarget.value = cents > 0 ? (cents / 100).toString() : '';
    }
    _numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (_numpadCallback) _numpadCallback();
  _closeNumpadModal();
}
export function closeNumpad() { numpadConfirm(); }
function _closeNumpadModal() {
  const m = document.getElementById('numpad-modal');
  m.classList.add('hidden'); m.style.display = '';
  _numpadTarget = null; _numpadRaw = '';
}

// ── Toast ────────────────────────────────────────
let _toastTimer;
export function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = msg;
  toast.classList.remove('hidden');
  toast.style.display = 'flex';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.classList.add('hidden'); toast.style.display = ''; }, 3000);
}

// ── Global listeners (run once on import) ─────────────────────────────────────
// Close autocomplete dropdowns on outside click.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ac-input-wrap')) {
    document.querySelectorAll('.autocomplete-list').forEach(d => { d.innerHTML = ''; d.classList.add('hidden'); });
  }
});
// Intercept focus on tel inputs to show the on-screen phone numpad (touch only).
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.tagName === 'INPUT' && el.type === 'tel' && !el.dataset.noNumpad) {
    setTimeout(() => openPhoneNumpad(el, el.placeholder || 'Phone Number'), 0);
  }
});
