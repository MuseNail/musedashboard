// Logo data URL — in-memory; loaded from Sheets on startup via loadConfigFromSheets()
let _logoData = null;
// Photo cache — keyed as 'staff_ID' or 'fduser_ID'; loaded from Sheets via loadPhotosFromSheets()
const _photoCache = {};

// ── Logo Upload & Crop ─────────────────────────────
function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;

  // Set crop target to logo mode
  _photoCropTarget   = { type: 'logo', id: 'business' };
  _photoCropImg      = null;
  _photoCropRotation = 0;
  _photoCropZoom     = 1;
  _photoCropOffset   = { x: 0, y: 0 };

  // Switch preview container to wide rectangular aspect for logo
  const cropArea = document.querySelector('#photo-crop-modal .relative.mb-4');
  if (cropArea) cropArea.style.height = '200px';

  // Open modal
  document.getElementById('photo-crop-zoom').value = 1;
  document.getElementById('photo-crop-canvas').classList.add('hidden');
  document.getElementById('photo-crop-placeholder').classList.remove('hidden');
  document.getElementById('photo-crop-controls').classList.add('hidden');
  document.getElementById('photo-crop-save').disabled = true;
  const h2 = document.querySelector('#photo-crop-modal h2');
  if (h2) h2.textContent = 'Upload Logo';
  document.getElementById('photo-crop-modal').classList.remove('hidden');
  document.getElementById('photo-crop-modal').style.display = 'flex';

  // Load the image
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _photoCropImg = img;
      _photoCropZoom = 1;
      _photoCropOffset = { x: 0, y: 0 };
      document.getElementById('photo-crop-zoom').value = 1;
      document.getElementById('photo-crop-canvas').classList.remove('hidden');
      document.getElementById('photo-crop-placeholder').classList.add('hidden');
      document.getElementById('photo-crop-controls').classList.remove('hidden');
      document.getElementById('photo-crop-save').disabled = false;
      requestAnimationFrame(() => { updatePhotoCrop(); attachCropDrag(); });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function removeLogo() {
  _logoData = null;
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
  setLogo();
  showToast('Logo removed — using default');
}

// Re-open crop modal with the already-saved logo for re-cropping
function recropLogo() {
  const existing = _logoData;
  if (!existing) { showToast('No logo uploaded yet.'); return; }

  _photoCropTarget   = { type: 'logo', id: 'business' };
  _photoCropImg      = null;
  _photoCropRotation = 0;
  _photoCropZoom     = 1;
  _photoCropOffset   = { x: 0, y: 0 };

  // Switch preview area to wide rectangular shape
  const cropArea = document.querySelector('#photo-crop-modal .relative.mb-4');
  if (cropArea) cropArea.style.height = '200px';

  document.getElementById('photo-crop-zoom').value = 1;
  document.getElementById('photo-crop-canvas').classList.add('hidden');
  document.getElementById('photo-crop-placeholder').classList.remove('hidden');
  document.getElementById('photo-crop-controls').classList.add('hidden');
  document.getElementById('photo-crop-save').disabled = true;
  const h2 = document.querySelector('#photo-crop-modal h2');
  if (h2) h2.textContent = 'Re-crop Logo';
  document.getElementById('photo-crop-modal').classList.remove('hidden');
  document.getElementById('photo-crop-modal').style.display = 'flex';

  const img = new Image();
  img.onload = () => {
    _photoCropImg = img;
    _photoCropZoom = 1;
    _photoCropOffset = { x: 0, y: 0 };
    document.getElementById('photo-crop-zoom').value = 1;
    document.getElementById('photo-crop-canvas').classList.remove('hidden');
    document.getElementById('photo-crop-placeholder').classList.add('hidden');
    document.getElementById('photo-crop-controls').classList.remove('hidden');
    document.getElementById('photo-crop-save').disabled = false;
    updatePhotoCrop();
    attachCropDrag();
  };
  img.src = existing;
}


// ── Photo Storage ─────────────────────────────────
// Photos are stored separately from staff data to avoid bloating config sync.
// Each photo is stored as its own localStorage key: muse_photo_staff_ID or muse_photo_fduser_ID

function getPhotoKey(type, id) {
  return `muse_photo_${type}_${id}`;
}

function savePhotoToStorage(type, id, dataUrl) {
  _photoCache[type + '_' + id] = dataUrl;
  pushPhotosToSheets();
}

function loadPhotoFromStorage(type, id) {
  return _photoCache[type + '_' + id] || null;
}

function removePhotoFromStorage(type, id) {
  delete _photoCache[type + '_' + id];
  pushPhotosToSheets();
}

// Collect all photos into one object for Sheets backup
function getAllPhotos() {
  const photos = {};
  STAFF.forEach(s => {
    const p = loadPhotoFromStorage('staff', s.id);
    if (p) photos['staff_' + s.id] = p;
  });
  FRONT_DESK_USERS.forEach(u => {
    const p = loadPhotoFromStorage('fduser', u.id);
    if (p) photos['fduser_' + u.id] = p;
  });
  return photos;
}

// Restore photos from a backup object
function restorePhotos(photos) {
  if (!photos) return;
  Object.entries(photos).forEach(([key, dataUrl]) => {
    const [, type, ...idParts] = key.split('_');
    const id = idParts.join('_');
    if (type && id && dataUrl) _photoCache[type + '_' + id] = dataUrl;
  });
  applyPhotosToObjects();
}

// Apply stored photos to in-memory STAFF and FRONT_DESK_USERS
function applyPhotosToObjects() {
  STAFF.forEach(s => {
    const p = loadPhotoFromStorage('staff', s.id);
    if (p) s.photo = p; else delete s.photo;
  });
  FRONT_DESK_USERS.forEach(u => {
    const p = loadPhotoFromStorage('fduser', u.id);
    if (p) u.photo = p; else delete u.photo;
  });
}

let _photoSyncTimer = null;
async function pushPhotosToSheets() {
  if (_photoSyncTimer) clearTimeout(_photoSyncTimer);
  _photoSyncTimer = setTimeout(async () => {
    try {
      const photos = getAllPhotos();
      if (Object.keys(photos).length === 0) return;
      await fetch(SHEETS_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveConfig', config: { muse_photos: photos }, device: DEVICE_ID }),
      });
    } catch(e) { /* silent */ }
  }, 2000);
}

// Accepts pre-fetched config data from the poll to avoid a second loadConfig HTTP call.
// Falls back to its own fetch if called standalone (e.g. on startup).
async function loadPhotosFromSheets(preloadedData) {
  try {
    let data = preloadedData;
    if (!data) {
      const res = await fetch(`${SHEETS_PROXY}?action=loadConfig&_=${Date.now()}`);
      data = await res.json();
    }
    if (data.success && data.config?.muse_photos) {
      restorePhotos(data.config.muse_photos);
      return true;
    }
  } catch(e) { /* silent */ }
  return false;
}


// ── Photo Crop ─────────────────────────────────────────────────────────────────
let _photoCropTarget  = null; // { type: 'staff'|'fduser', id }
let _photoCropImg     = null; // Image object
let _photoCropRotation = 0;
let _photoCropZoom    = 1;
let _photoCropDrag    = null; // { startX, startY, offsetX, offsetY }
let _photoCropOffset  = { x: 0, y: 0 };

function showPhotoUpload(type, id) {
  _photoCropTarget   = { type, id };
  _photoCropImg      = null;
  _photoCropRotation = 0;
  _photoCropZoom     = 1;
  _photoCropOffset   = { x: 0, y: 0 };
  document.getElementById('photo-crop-input').value = '';
  document.getElementById('photo-crop-zoom').value = 1;
  document.getElementById('photo-crop-modal').classList.remove('hidden');
  document.getElementById('photo-crop-modal').style.display = 'flex';

  // Pre-load existing photo so user can re-crop without re-uploading
  const existing = loadPhotoFromStorage(type, id);
  if (existing) {
    const img = new Image();
    img.onload = () => {
      _photoCropImg = img;
      document.getElementById('photo-crop-canvas').classList.remove('hidden');
      document.getElementById('photo-crop-placeholder').classList.add('hidden');
      document.getElementById('photo-crop-controls').classList.remove('hidden');
      document.getElementById('photo-crop-save').disabled = false;
      requestAnimationFrame(() => { updatePhotoCrop(); attachCropDrag(); });
    };
    img.src = existing;
  } else {
    document.getElementById('photo-crop-canvas').classList.add('hidden');
    document.getElementById('photo-crop-placeholder').classList.remove('hidden');
    document.getElementById('photo-crop-controls').classList.add('hidden');
    document.getElementById('photo-crop-save').disabled = true;
  }
}

// Also keep old showStaffPhotoModal as alias for backward compatibility
// showStaffPhotoModal defined below

function closePhotoCrop() {
  document.getElementById('photo-crop-modal').classList.add('hidden');
  document.getElementById('photo-crop-modal').style.display = '';
  // Reset preview area height (logo mode changes it to wide)
  const cropArea = document.querySelector('#photo-crop-modal .relative.mb-4');
  if (cropArea) cropArea.style.height = '240px';
  // Reset title
  const h2 = document.querySelector('#photo-crop-modal h2');
  if (h2) h2.textContent = 'Upload Photo';
  _photoCropTarget = null; _photoCropImg = null;
}

function loadPhotoCrop(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _photoCropImg      = img;
      _photoCropRotation = 0;
      _photoCropZoom     = 1;
      _photoCropOffset   = { x: 0, y: 0 };
      document.getElementById('photo-crop-zoom').value = 1;
      document.getElementById('photo-crop-canvas').classList.remove('hidden');
      document.getElementById('photo-crop-placeholder').classList.add('hidden');
      document.getElementById('photo-crop-controls').classList.remove('hidden');
      document.getElementById('photo-crop-save').disabled = false;
      requestAnimationFrame(() => { updatePhotoCrop(); attachCropDrag(); });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function updatePhotoCrop() {
  const canvas = document.getElementById('photo-crop-canvas');
  if (!canvas || !_photoCropImg) return;
  _photoCropZoom = parseFloat(document.getElementById('photo-crop-zoom').value) || 1;

  const isLogo = _photoCropTarget?.type === 'logo';

  if (isLogo) {
    // Rectangular crop for logos — 3:2 aspect ratio, no circular clip
    const W = 600, H = 300;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    // Transparent background — preserve PNG alpha
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W/2 + _photoCropOffset.x, H/2 + _photoCropOffset.y);
    ctx.rotate((_photoCropRotation * Math.PI) / 180);
    ctx.scale(_photoCropZoom, _photoCropZoom);
    const aspect = _photoCropImg.width / _photoCropImg.height;
    let dw, dh;
    if (aspect >= W/H) { dh = H; dw = H * aspect; }
    else               { dw = W; dh = W / aspect; }
    ctx.drawImage(_photoCropImg, -dw/2, -dh/2, dw, dh);
    ctx.restore();
  } else {
    // Square + circular clip for staff/fduser photos
    const SIZE = 300;
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE/2, SIZE/2, SIZE/2, 0, Math.PI*2);
    ctx.clip();
    ctx.translate(SIZE/2 + _photoCropOffset.x, SIZE/2 + _photoCropOffset.y);
    ctx.rotate((_photoCropRotation * Math.PI) / 180);
    ctx.scale(_photoCropZoom, _photoCropZoom);
    const aspect = _photoCropImg.width / _photoCropImg.height;
    let dw, dh;
    if (aspect >= 1) { dh = SIZE; dw = SIZE * aspect; }
    else             { dw = SIZE; dh = SIZE / aspect; }
    ctx.drawImage(_photoCropImg, -dw/2, -dh/2, dw, dh);
    ctx.restore();
  }
}

function rotateCrop(deg) {
  _photoCropRotation = (_photoCropRotation + deg + 360) % 360;
  updatePhotoCrop();
}

function attachCropDrag() {
  const canvas = document.getElementById('photo-crop-canvas');
  if (!canvas) return;
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  newCanvas.id = 'photo-crop-canvas';
  let dragStart = null;

  newCanvas.addEventListener('pointerdown', e => {
    dragStart = { x: e.clientX, y: e.clientY, ox: _photoCropOffset.x, oy: _photoCropOffset.y };
    newCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  newCanvas.addEventListener('pointermove', e => {
    if (!dragStart) return;
    _photoCropOffset.x = dragStart.ox + (e.clientX - dragStart.x);
    _photoCropOffset.y = dragStart.oy + (e.clientY - dragStart.y);
    updatePhotoCrop();
  });
  newCanvas.addEventListener('pointerup',   () => { dragStart = null; });
  newCanvas.addEventListener('pointercancel', () => { dragStart = null; });
}

function savePhotoCrop() {
  const canvas = document.getElementById('photo-crop-canvas');
  if (!canvas || !_photoCropTarget) return;
  const { type, id } = _photoCropTarget;

  // For logos: save as PNG to preserve transparency — no white background
  let dataUrl;
  if (type === 'logo') {
    dataUrl = canvas.toDataURL('image/png');
    _logoData = dataUrl;
    closePhotoCrop();
    setLogo();
    _configWriteTime = Date.now();
    setTimeout(() => pushConfigToSheets(), 500);
    showToast('Logo saved ✓');
    return;
  }

  dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // Save photo to its own storage key
  savePhotoToStorage(type, id, dataUrl);

  // Apply to in-memory object
  if (type === 'staff') {
    const st = STAFF.find(s => s.id === id);
    if (st) { st.photo = dataUrl; saveStaffToStorage(); renderStaffList(); renderSchedule(); renderTurns(); updateLoggedInDisplay(); }
  } else if (type === 'fduser') {
    const u = FRONT_DESK_USERS.find(x => x.id === id);
    if (u) { u.photo = dataUrl; saveFdUsersToStorage(); renderFdUsersList(); updateLoggedInDisplay(); }
  }
  closePhotoCrop();
  showToast('Photo saved ✓');
}

function clearPhotoCrop() {
  if (!_photoCropTarget) return;
  const { type, id } = _photoCropTarget;

  removePhotoFromStorage(type, id);

  if (type === 'staff') {
    const st = STAFF.find(s => s.id === id);
    if (st) { delete st.photo; saveStaffToStorage(); renderStaffList(); renderTurns(); updateLoggedInDisplay(); }
  } else if (type === 'fduser') {
    const u = FRONT_DESK_USERS.find(x => x.id === id);
    if (u) { delete u.photo; saveFdUsersToStorage(); renderFdUsersList(); updateLoggedInDisplay(); }
  }
  closePhotoCrop();
  showToast('Photo removed');
}

// Keep old functions as aliases
// closeStaffPhotoModal defined below
// saveStaffPhoto and clearStaffPhoto defined below



function showStaffPhotoModal(staffId) {
  staffPhotoTargetId = staffId;
  staffPhotoDataUrl  = null;
  const st = STAFF.find(s => s.id === staffId);
  if (!st) return;
  document.getElementById('staff-photo-target-id').value = staffId;
  document.getElementById('staff-photo-initial').textContent = st.name.charAt(0).toUpperCase();
  const preview = document.getElementById('staff-photo-preview');
  const recropBtn = document.getElementById('staff-recrop-btn');
  if (st.photo) {
    preview.innerHTML = `<img src="${st.photo}" class="w-full h-full object-cover rounded-full">`;
    if (recropBtn) recropBtn.classList.remove('hidden');
  } else {
    preview.innerHTML = `<span class="text-3xl font-headline font-bold text-on-surface-variant">${st.name.charAt(0).toUpperCase()}</span>`;
    if (recropBtn) recropBtn.classList.add('hidden');
  }
  document.getElementById('staff-photo-input').value = '';
  document.getElementById('staff-photo-modal').classList.remove('hidden');
  document.getElementById('staff-photo-modal').style.display = 'flex';
}

function closeStaffPhotoModal() {
  document.getElementById('staff-photo-modal').classList.add('hidden');
  document.getElementById('staff-photo-modal').style.display = '';
  staffPhotoTargetId = null;
  staffPhotoDataUrl  = null;
}

// Re-crop existing staff photo
function recropStaffPhoto() {
  const id = document.getElementById('staff-photo-target-id').value;
  if (!id) return;
  const existing = loadPhotoFromStorage('staff', id);
  if (!existing) { showToast('No photo to re-crop'); return; }
  closeStaffPhotoModal();
  // Open the crop modal with existing photo
  showPhotoUpload('staff', id);
  // Pre-load existing photo
  const img = new Image();
  img.onload = () => {
    _photoCropImg = img;
    _photoCropZoom = 1;
    _photoCropOffset = { x: 0, y: 0 };
    document.getElementById('photo-crop-zoom').value = 1;
    document.getElementById('photo-crop-canvas').classList.remove('hidden');
    document.getElementById('photo-crop-placeholder').classList.add('hidden');
    document.getElementById('photo-crop-controls').classList.remove('hidden');
    document.getElementById('photo-crop-save').disabled = false;
    requestAnimationFrame(() => { updatePhotoCrop(); attachCropDrag(); });
  };
  img.src = existing;
}

function handleStaffPhotoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Photo must be under 2MB.'); return; }
  const id = document.getElementById('staff-photo-target-id').value;
  // Close simple modal and open crop modal
  closeStaffPhotoModal();
  showPhotoUpload('staff', id);
  // Load the file into crop modal
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _photoCropImg = img;
      _photoCropZoom = 1;
      _photoCropOffset = { x: 0, y: 0 };
      document.getElementById('photo-crop-zoom').value = 1;
      document.getElementById('photo-crop-canvas').classList.remove('hidden');
      document.getElementById('photo-crop-placeholder').classList.add('hidden');
      document.getElementById('photo-crop-controls').classList.remove('hidden');
      document.getElementById('photo-crop-save').disabled = false;
      requestAnimationFrame(() => { updatePhotoCrop(); attachCropDrag(); });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function saveStaffPhoto() {
  const st = STAFF.find(s => s.id === staffPhotoTargetId);
  if (!st) return;
  if (staffPhotoDataUrl) st.photo = staffPhotoDataUrl;
  saveStaffToStorage();
  closeStaffPhotoModal();
  renderStaffList();
  renderSchedule();
  showToast('Photo saved');
}

function clearStaffPhoto() {
  const st = STAFF.find(s => s.id === staffPhotoTargetId);
  if (!st) return;
  delete st.photo;
  saveStaffToStorage();
  closeStaffPhotoModal();
  renderStaffList();
  renderSchedule();
  showToast('Photo removed');
}


