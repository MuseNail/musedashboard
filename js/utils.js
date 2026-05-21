// ── Clock ────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes().toString().padStart(2,'0');
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    const clockEl = document.getElementById('clock-display');
    if (clockEl) clockEl.textContent = `${h}:${m}`;

    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
    const dateEl = document.getElementById('date-display');
    if (dateEl) dateEl.textContent = dateStr;
  }
  tick();
  setInterval(tick, 1000);
}

function updateDeskDate() {
  const now = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const el = document.getElementById('desk-date');
  if (el) el.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
}


// ── Auto Capitalize ───────────────────────────────
function autoCapitalize(input) {
  const val = input.value;
  if (!val) return;
  input.value = val.replace(/(?:^|\s|-)\S/g, c => c.toUpperCase());
}


// ── Local Date Helper ─────────────────────────────
// Always use local date (not UTC) to avoid timezone shifts at end of day
// e.g. 5pm Pacific = midnight UTC = wrong date with toISOString()
function localDateStr(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function todayStr() { return localDateStr(new Date()); }


// ── Deduplication helper ──────────────────────────
// Removes duplicate entries by label (case-insensitive), keeping the first occurrence.
// Applied whenever services/items/fees are loaded from Sheets or localStorage to prevent
// duplicate sync cycles from accumulating entries.
function dedupByLabel(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const key = (item.label || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// loadConfigFromSheets skips overwriting if this device wrote the row,
// with a 10s fallback for slow writes where DEVICE_ID may not match yet.
let _configWriteTime = 0;


// ── Elapsed Time Timer ────────────────────────────
let _elapsedTimer = null;

function startElapsedTimer() {
  if (_elapsedTimer) return;
  _elapsedTimer = setInterval(updateElapsedTimes, 10000); // update every 10s
  updateElapsedTimes();
}

function updateElapsedTimes() {
  const now = Date.now();
  document.querySelectorAll('[data-checkin-ts]').forEach(el => {
    const ts = parseInt(el.dataset.checkinTs);
    if (!ts) return;
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) el.textContent = 'just now';
    else if (mins < 60) el.textContent = mins + 'm';
    else el.textContent = Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
  });
}

function formatElapsed(checkinTime) {
  const ts = checkinTime instanceof Date ? checkinTime.getTime() : new Date(checkinTime).getTime();
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm';
  return Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
}


// ── Phone Formatting ─────────────────────────────
function formatPhone(input) {
  // Strip everything except digits
  let digits = input.value.replace(/\D/g, '').slice(0, 10);
  let formatted = '';
  if (digits.length === 0) {
    formatted = '';
  } else if (digits.length <= 3) {
    formatted = `(${digits}`;
  } else if (digits.length <= 6) {
    formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  } else {
    formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  input.value = formatted;
}

// Customer-facing autocomplete
function acSearch(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const results = filterCustomers(input.value, field);
  const dropId = field === 'phone' ? `ac-phone-${idx}` : `ac-first-${idx}`;
  buildDropdown(results, dropId, idx, `phone-${idx}`, `first-${idx}`, `last-${idx}`);
  // Hide the other dropdown
  const otherId = field === 'phone' ? `ac-first-${idx}` : `ac-phone-${idx}`;
  const other = document.getElementById(otherId);
  if (other) { other.innerHTML = ''; other.classList.add('hidden'); }
}

// Front desk autocomplete
function acSearchManual(input, idx, field) {
  if (field === 'phone') formatPhone(input);
  const results = filterCustomers(input.value, field);
  const dropId = field === 'phone' ? `mac-phone-${idx}` : `mac-first-${idx}`;
  buildDropdown(results, dropId, idx, `manual-phone-${idx}`, `manual-first-${idx}`, `manual-last-${idx}`);
  const otherId = field === 'phone' ? `mac-first-${idx}` : `mac-phone-${idx}`;
  const other = document.getElementById(otherId);
  if (other) { other.innerHTML = ''; other.classList.add('hidden'); }
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ac-input-wrap')) {
    document.querySelectorAll('.autocomplete-list').forEach(d => {
      d.innerHTML = ''; d.classList.add('hidden');
    });
  }
});


// ── Numeric Keypad ────────────────────────────────
let _numpadTarget   = null; // the input element being edited
let _numpadRaw      = '';   // raw string being built
let _numpadCallback = null; // optional callback after confirm
let _numpadMode     = 'cost'; // 'cost' | 'phone'

function openNumpad(inputEl, label) {
  if (window.matchMedia('(pointer: fine)').matches) return;
  _numpadMode     = 'cost';
  _numpadTarget   = inputEl;
  _numpadCallback = null;
  const existing = (inputEl.value || '').replace(/[^0-9.]/g, '');
  _numpadRaw = existing && !isNaN(parseFloat(existing))
    ? Math.round(parseFloat(existing) * 100).toString()
    : '';
  document.getElementById('numpad-label').textContent = label || 'Cost';
  // Show decimal dot key, show 00 key
  document.getElementById('numpad-dot-key').textContent = '.';
  document.getElementById('numpad-plus-key').textContent = '+';
  _numpadUpdateDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
  document.getElementById('numpad-modal').style.display = 'flex';
  inputEl.blur();
}

function openPhoneNumpad(inputEl, label) {
  if (window.matchMedia('(pointer: fine)').matches) return;
  _numpadMode     = 'phone';
  _numpadTarget   = inputEl;
  _numpadCallback = null;
  // Strip formatting — keep digits only
  _numpadRaw = (inputEl.value || '').replace(/\D/g, '').slice(0, 10);
  document.getElementById('numpad-label').textContent = label || 'Phone Number';
  // Change dot key to show nothing useful for phone — hide it
  document.getElementById('numpad-dot-key').textContent = '';
  document.getElementById('numpad-plus-key').textContent = '';
  _numpadUpdateDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
  document.getElementById('numpad-modal').style.display = 'flex';
  inputEl.blur();
}

// Global listener: intercept focus on tel inputs to show phone numpad
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.tagName === 'INPUT' && el.type === 'tel' && !el.dataset.noNumpad) {
    // Use setTimeout to avoid interfering with the focus event itself
    setTimeout(() => openPhoneNumpad(el, el.placeholder || 'Phone Number'), 0);
  }
});

function _numpadUpdateDisplay() {
  const el = document.getElementById('numpad-display');
  if (_numpadMode === 'phone') {
    // Format as (XXX) XXX-XXXX
    const d = _numpadRaw;
    let formatted = '';
    if (d.length === 0) formatted = '';
    else if (d.length <= 3) formatted = '(' + d;
    else if (d.length <= 6) formatted = '(' + d.slice(0,3) + ') ' + d.slice(3);
    else formatted = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6,10);
    el.textContent = formatted || '—';
  } else {
    const cents = parseInt(_numpadRaw || '0', 10);
    el.textContent = '$' + (cents / 100).toFixed(2);
  }
}

function numpadKey(key) {
  if (_numpadMode === 'phone') {
    if (key === '.' || key === '+') return; // no decimals for phone
    if (_numpadRaw.length >= 10) return;    // max 10 digits
    if (key === '00') {
      if (_numpadRaw.length + 2 <= 10) _numpadRaw += '00';
      else if (_numpadRaw.length + 1 <= 10) _numpadRaw += '0';
    } else {
      _numpadRaw += key;
    }
    _numpadUpdateDisplay();
    return;
  }
  // Cost mode
  if (key === '.') return;
  if (key === '+') return;
  if (key === '00') {
    if (_numpadRaw === '' || _numpadRaw === '0') return;
    _numpadRaw += '00';
  } else {
    if (_numpadRaw === '0') _numpadRaw = key;
    else _numpadRaw += key;
  }
  if (_numpadRaw.length > 6) _numpadRaw = _numpadRaw.slice(0, 6);
  _numpadUpdateDisplay();
}

function numpadBackspace() {
  _numpadRaw = _numpadRaw.slice(0, -1);
  _numpadUpdateDisplay();
}

function numpadConfirm() {
  if (_numpadTarget) {
    if (_numpadMode === 'phone') {
      // Format phone number for the input
      const d = _numpadRaw;
      let formatted = '';
      if (d.length === 10) formatted = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
      else if (d.length > 0) formatted = d; // partial — just digits
      _numpadTarget.value = formatted;
    } else {
      const cents = parseInt(_numpadRaw || '0', 10);
      _numpadTarget.value = cents > 0 ? (cents / 100).toString() : '';
    }
    _numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (_numpadCallback) _numpadCallback();
  _closeNumpadModal();
}

function closeNumpad(e) {
  numpadConfirm();
}

function _closeNumpadModal() {
  document.getElementById('numpad-modal').classList.add('hidden');
  document.getElementById('numpad-modal').style.display = '';
  _numpadTarget = null;
  _numpadRaw = '';
}


// ── Toast ────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = msg;
  toast.classList.remove('hidden');
  toast.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
    toast.style.display = '';
  }, 3000);
}



