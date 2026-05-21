// ── Auth State ───────────────────────────────────
let activeUser = null;

// ── Logged-in User Display ────────────────────────
function updateLoggedInDisplay() {
  const nameEl   = document.getElementById('logged-in-name');
  const avatarEl = document.getElementById('logged-in-avatar');
  if (!nameEl || !avatarEl) return;
  const name = activeUser?.name || 'Manager';
  nameEl.textContent = name;

  const fdUser    = FRONT_DESK_USERS.find(u => u.id === activeUser?.id);
  const staffUser = STAFF.find(s => s.id === activeUser?.id) || STAFF.find(s => s.name === name);
  const photo     = fdUser?.photo || staffUser?.photo || null;

  if (photo) {
    avatarEl.innerHTML = `<img src="${photo}" class="w-full h-full rounded-full object-cover">`;
  } else {
    avatarEl.innerHTML = '';
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }
  // Show/hide admin-only features
  updateHistoricalButtonVisibility();
}


// ── PIN Modal ────────────────────────────────────
function showPinModal() {
  pinBuffer = "";
  activeUser = null;
  updatePinDots();
  document.getElementById('pin-error').classList.add('hidden');
  document.getElementById('pin-matched-user').textContent = '';
  document.getElementById('pin-modal').classList.remove('hidden');
  document.getElementById('pin-modal').style.display = 'flex';
  // Focus hidden input for keyboard entry
  setTimeout(() => {
    const kb = document.getElementById('pin-keyboard-input');
    if (kb) { kb.value = ''; kb.focus(); }
  }, 100);
}

function pinCancel() {
  document.getElementById('pin-modal').classList.add('hidden');
  document.getElementById('pin-modal').style.display = '';
  pinBuffer = "";
}

// Called by on-screen numpad
function pinInput(d) {
  if (pinBuffer.length >= 6) return;
  pinBuffer += d;
  updatePinDots();
  checkPin();
}

// Called by physical keyboard via hidden input
function onPinKeyboard(val) {
  const digits = val.replace(/\D/g,'');
  pinBuffer = digits.slice(0, 6);
  // Sync hidden input
  document.getElementById('pin-keyboard-input').value = pinBuffer;
  updatePinDots();
  checkPin();
}

function pinBackspace() {
  pinBuffer = pinBuffer.slice(0, -1);
  document.getElementById('pin-keyboard-input').value = pinBuffer;
  updatePinDots();
  document.getElementById('pin-matched-user').textContent = '';
}

function checkPin() {
  // Show matched user name as they type (without revealing PIN)
  const matched = FRONT_DESK_USERS.find(u => u.pin === pinBuffer) ||
    (pinBuffer === STAFF_PIN ? { name: 'Manager', role: 'admin' } : null);

  const matchedEl = document.getElementById('pin-matched-user');
  if (matched && pinBuffer.length >= 4) {
    matchedEl.textContent = `Welcome, ${matched.name}`;
  } else {
    matchedEl.textContent = '';
  }

  // Only attempt login when PIN is at least 4 digits and user typed enough
  if (pinBuffer.length < 4) return;

  // Try to find user with exact PIN match
  const user = FRONT_DESK_USERS.find(u => u.pin === pinBuffer);
  const isFallback = pinBuffer === STAFF_PIN;

  if (user || isFallback) {
    setTimeout(() => {
      activeUser = user || { id: 'fallback', name: 'Manager', pin: STAFF_PIN, role: 'admin' };
      pinCancel();
      updateLoggedInDisplay();
      goTo('screen-desk');
      showDashPanel('turns'); // default to Turns tab on login
      showToast(`Welcome, ${activeUser.name}`);
    }, 300);
  } else if (pinBuffer.length >= 6) {
    // Max length reached with no match
    document.getElementById('pin-error').classList.remove('hidden');
    pinBuffer = "";
    document.getElementById('pin-keyboard-input').value = '';
    updatePinDots();
    matchedEl.textContent = '';
    setTimeout(() => document.getElementById('pin-error').classList.add('hidden'), 2000);
  }
}

function updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('bg-primary', i < pinBuffer.length);
    dot.classList.toggle('bg-surface-container-highest', i >= pinBuffer.length);
    dot.classList.toggle('scale-110', i === pinBuffer.length - 1);
  });
}


// ── Front Desk Users CRUD ─────────────────────────
function togglePinViewer() {
  const list  = document.getElementById('pin-viewer-list');
  const label = document.getElementById('pin-viewer-label');
  if (!list) return;
  const isHidden = list.classList.contains('hidden');
  if (isHidden) {
    // Build PIN list
    const users = [
      // Default manager PIN
      { name: 'Manager (default)', pin: STAFF_PIN, role: 'manager' },
      ...FRONT_DESK_USERS.map(u => ({ name: u.name, pin: u.pin, role: u.role })),
    ];
    list.innerHTML = users.map(u => `
      <div class="flex items-center justify-between px-4 py-3 border-b border-surface-container-high last:border-0">
        <div>
          <span class="font-body font-semibold text-on-surface text-sm">${u.name}</span>
          <span class="text-xs font-body text-on-surface-variant capitalize ml-2">${u.role}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-headline font-bold text-primary tracking-widest text-base">${u.pin}</span>
        </div>
      </div>`).join('');
    label.textContent = 'Hide PINs';
  } else {
    list.innerHTML = '';
    label.textContent = 'View Login PINs';
  }
  list.classList.toggle('hidden', !isHidden);
}

function renderFdUsersList() {
  const list = document.getElementById('fdusers-list');
  if (!list) return;

  // Show PIN viewer button only for managers
  const pinSection = document.getElementById('pin-viewer-section');
  if (pinSection) {
    pinSection.classList.toggle('hidden', !['admin','manager'].includes(activeUser?.role));
  }
  // Reset pin viewer if it was open
  const pinList = document.getElementById('pin-viewer-list');
  const pinLabel = document.getElementById('pin-viewer-label');
  if (pinList) { pinList.classList.add('hidden'); pinList.innerHTML = ''; }
  if (pinLabel) pinLabel.textContent = 'View Login PINs';
  if (FRONT_DESK_USERS.length === 0) {
    list.innerHTML = '<p class="text-sm font-body text-on-surface-variant py-4 text-center">No front desk users yet. Add one above.</p>';
    return;
  }
  list.innerHTML = FRONT_DESK_USERS.map(u => {
    const photoHtml = u.photo
      ? `<img src="${u.photo}" class="w-10 h-10 rounded-full object-cover border-2 border-surface-container-high">`
      : `<div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center"><span class="text-sm font-headline font-bold text-on-primary">${u.name.charAt(0).toUpperCase()}</span></div>`;
    return `
      <div class="bg-surface-container-lowest rounded-xl px-5 py-4 border border-surface-container-high flex items-center justify-between">
        <div class="flex items-center gap-4">
          ${photoHtml}
          <div>
            <div class="font-headline font-semibold text-on-surface text-base">${u.name}</div>
            <div class="text-xs font-body text-on-surface-variant capitalize">${u.role} · PIN: ${'•'.repeat(u.pin.length)}</div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="showPhotoUpload('fduser','${u.id}')" title="Photo" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors">
            <span class="material-symbols-outlined" style="font-size:18px">photo_camera</span>
          </button>
          <button onclick="showEditFdUser('${u.id}')" class="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant transition-colors">
            <span class="material-symbols-outlined" style="font-size:18px">edit</span>
          </button>
          <button onclick="deleteFdUser('${u.id}')" class="w-9 h-9 rounded-full hover:bg-error/10 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors">
            <span class="material-symbols-outlined" style="font-size:18px">delete</span>
          </button>
        </div>
      </div>`;
  }).join('');
}

function selectRole(role) {
  document.getElementById('fduser-role-input').value = role;
  ['admin','manager','frontdesk'].forEach(r => {
    const btn = document.getElementById(`role-btn-${r}`);
    if (r === role) {
      btn.classList.add('bg-primary','text-on-primary','border-primary');
      btn.classList.remove('bg-transparent','border-outline-variant','text-on-surface');
    } else {
      btn.classList.remove('bg-primary','text-on-primary','border-primary');
      btn.classList.add('bg-transparent','border-outline-variant','text-on-surface');
    }
  });
}

function showAddFdUser() {
  document.getElementById('fduser-modal-title').textContent = 'Add Front Desk User';
  document.getElementById('fduser-name-input').value = '';
  document.getElementById('fduser-pin-input').value = '';
  document.getElementById('fduser-edit-id').value = '';
  selectRole('frontdesk');
  document.getElementById('fduser-modal').classList.remove('hidden');
  document.getElementById('fduser-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('fduser-name-input').focus(), 100);
}

function showEditFdUser(id) {
  const u = FRONT_DESK_USERS.find(x => x.id === id);
  if (!u) return;
  document.getElementById('fduser-modal-title').textContent = 'Edit User';
  document.getElementById('fduser-name-input').value = u.name;
  document.getElementById('fduser-pin-input').value = u.pin;
  document.getElementById('fduser-edit-id').value = id;
  selectRole(u.role);
  document.getElementById('fduser-modal').classList.remove('hidden');
  document.getElementById('fduser-modal').style.display = 'flex';
}

function closeFdUserModal() {
  document.getElementById('fduser-modal').classList.add('hidden');
  document.getElementById('fduser-modal').style.display = '';
}

function saveFdUser() {
  const name  = document.getElementById('fduser-name-input').value.trim();
  const pin   = document.getElementById('fduser-pin-input').value.trim();
  const role  = document.getElementById('fduser-role-input').value;
  const editId = document.getElementById('fduser-edit-id').value;
  if (!name) { showToast('Please enter a name.'); return; }
  if (!pin || pin.length < 4) { showToast('PIN must be at least 4 digits.'); return; }
  if (!/^\d+$/.test(pin)) { showToast('PIN must be numbers only.'); return; }
  // Check for duplicate PINs
  const duplicate = FRONT_DESK_USERS.find(u => u.pin === pin && u.id !== editId);
  if (duplicate) { showToast(`PIN already used by ${duplicate.name}.`); return; }

  if (editId) {
    const u = FRONT_DESK_USERS.find(x => x.id === editId);
    if (u) { u.name = name; u.pin = pin; u.role = role; }
  } else {
    FRONT_DESK_USERS.push({ id: `fd-${Date.now()}`, name, pin, role });
  }
  saveFrontDeskUsers();
  closeFdUserModal();
  renderFdUsersList();
  showToast(editId ? 'User updated' : `${name} added`);
}

function deleteFdUser(id) {
  const u = FRONT_DESK_USERS.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Remove ${u.name} from front desk users?`)) return;
  FRONT_DESK_USERS = FRONT_DESK_USERS.filter(x => x.id !== id);
  saveFrontDeskUsers();
  renderFdUsersList();
  showToast(`${u.name} removed`);
}


