// Logo R2 URL — in-memory; loaded from Sheets config on startup via loadConfigFromSheets()
let _logoData = null;
// Photo cache — keyed as 'staff_{id}' or 'fduser_{id}'; values are R2 URLs
const _photoCache = {};

// ── R2 Helpers ─────────────────────────────────────
// Converts a base64 data URL to binary and PUTs it to R2 via the worker.
// Returns the CDN URL of the uploaded object, or null on failure.
async function _uploadToR2(key, dataUrl, mimeType) {
  try {
    const [, b64] = dataUrl.split(',');
    const binary  = atob(b64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const res = await fetch(`${PHOTOS_PROXY}/${key}`, {
      method:  'PUT',
      body:    bytes,
      headers: { 'Content-Type': mimeType },
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.url || null;
  } catch(e) {
    console.warn('[Photos] Upload failed:', e);
    return null;
  }
}

async function _deleteFromR2(key) {
  try {
    await fetch(`${PHOTOS_PROXY}/${key}`, { method: 'DELETE' });
  } catch(e) {
    console.warn('[Photos] Delete failed:', e);
  }
}


// ── Logo Upload & Crop ─────────────────────────────
function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;

  _photoCropTarget   = { type: 'logo', id: 'business' };
  _photoCropImg      = null;
  _photoCropRotation = 0;
  _photoCropZoom     = 1;
  _photoCropOffset   = { x: 0, y: 0 };

  // Switch preview container to wide rectangular aspect for logo
  const cropArea = document.querySelector('#photo-crop-modal .relative.mb-4');
  if (cropArea) cropArea.style.height = '200px';

  document.getElementById('photo-crop-zoom').value = 1;
  document.getElementById('photo-crop-canvas').classList.add('hidden');
  document.getElementById('photo-crop-placeholder').classList.remove('hidden');
  document.getElementById('photo-crop-controls').classList.add('hidden');
  document.getElementById('photo-crop-save').disabled = true;
  const h2 = document.querySelector('#photo-crop-modal h2');
  if (h2) h2.textContent = 'Upload Logo';
  document.getElementById('photo-crop-modal').classList.remove('hidden');
  document.getElementById('photo-crop-modal').style.display = 'flex';

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
  _deleteFromR2('logo_business').catch(() => {});
  delete _photoCache['logo_business'];
  _logoData = null;
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 500);
  setLogo();
  showToast('Logo removed');
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
// Photos live in Cloudflare R2. _photoCache holds the R2 URLs for the session.
// URLs are synced to Sheets config (muse_photos) so other devices can load them.

function getPhotoKey(type, id) {
  return `${type}_${id}`;
}

// Upload a photo to R2 and cache the resulting URL.
// Returns the URL on success, null on failure.
async function savePhotoToStorage(type, id, dataUrl) {
  const key      = getPhotoKey(type, id);
  const mimeType = type === 'logo' ? 'image/png' : 'image/jpeg';
  const url      = await _uploadToR2(key, dataUrl, mimeType);
  if (!url) return null;
  _photoCache[key] = url;
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
  return url;
}

function loadPhotoFromStorage(type, id) {
  return _photoCache[getPhotoKey(type, id)] || null;
}

function removePhotoFromStorage(type, id) {
  const key = getPhotoKey(type, id);
  _deleteFromR2(key).catch(() => {});
  delete _photoCache[key];
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}

// Returns { 'staff_ID': url, 'fduser_ID': url } for all cached photos.
// Used by pushConfigToSheets to persist URL references across devices.
function getAllPhotos() {
  const photos = {};
  STAFF.forEach(s => {
    const url = _photoCache['staff_' + s.id];
    if (url) photos['staff_' + s.id] = url;
  });
  FRONT_DESK_USERS.forEach(u => {
    const url = _photoCache['fduser_' + u.id];
    if (url) photos['fduser_' + u.id] = url;
  });
  return photos;
}

// Restore photo URLs from config into _photoCache.
// Values are R2 URLs, not base64.
function restorePhotos(photos) {
  if (!photos) return;
  Object.assign(_photoCache, photos);
  applyPhotosToObjects();
}

// Extract photo URLs from a pre-fetched config response and apply them to the cache.
// Called by app.js on startup and by the config poll timer in sync.js.
// rawConfig is the full response object from loadConfigFromSheets (_raw).
// When called without args (app.js startup path), fetches config fresh.
async function loadPhotosFromSheets(rawConfig) {
  if (rawConfig?.config?.muse_photos) {
    restorePhotos(rawConfig.config.muse_photos);
    return true;
  }
  // No raw config passed — fetch a fresh copy just to get the photo URLs
  try {
    const res  = await fetch(`${SHEETS_PROXY}?action=loadConfig&_=${Date.now()}`);
    const data = await res.json();
    if (!data.success || !data.config?.muse_photos) return false;
    restorePhotos(data.config.muse_photos);
    return true;
  } catch(e) {
    console.warn('[Photos] Load failed:', e);
    return false;
  }
}

// Apply cached photo URLs to in-memory STAFF and FRONT_DESK_USERS objects.
function applyPhotosToObjects() {
  STAFF.forEach(s => {
    const url = loadPhotoFromStorage('staff', s.id);
    if (url) s.photo = url; else delete s.photo;
  });
  FRONT_DESK_USERS.forEach(u => {
    const url = loadPhotoFromStorage('fduser', u.id);
    if (url) u.photo = url; else delete u.photo;
  });
}


// ── Photo Crop ─────────────────────────────────────────────────────────────────
let _photoCropTarget   = null; // { type: 'staff'|'fduser'|'logo', id }
let _photoCropImg      = null; // Image object
let _photoCropRotation = 0;
let _photoCropZoom     = 1;
let _photoCropDrag     = null; // { startX, startY, offsetX, offsetY }
let _photoCropOffset   = { x: 0, y: 0 };

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

function closePhotoCrop() {
  document.getElementById('photo-crop-modal').classList.add('hidden');
  document.getElementById('photo-crop-modal').style.display = '';
  const cropArea = document.querySelector('#photo-crop-modal .relative.mb-4');
  if (cropArea) cropArea.style.height = '240px';
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
    const W = 600, H = 300;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
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
  newCanvas.addEventListener('pointerup',     () => { dragStart = null; });
  newCanvas.addEventListener('pointercancel', () => { dragStart = null; });
}

async function savePhotoCrop() {
  const canvas = document.getElementById('photo-crop-canvas');
  if (!canvas || !_photoCropTarget) return;
  const { type, id } = _photoCropTarget;

  if (type === 'logo') {
    const dataUrl = canvas.toDataURL('image/png');
    closePhotoCrop();
    showToast('Uploading logo…');
    const url = await savePhotoToStorage('logo', 'business', dataUrl);
    if (!url) { showToast('Logo upload failed — check connection'); return; }
    _logoData = url;
    setLogo();
    showToast('Logo saved ✓');
    return;
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  closePhotoCrop();
  showToast('Uploading photo…');

  const url = await savePhotoToStorage(type, id, dataUrl);
  if (!url) { showToast('Photo upload failed — check connection'); return; }

  if (type === 'staff') {
    const st = STAFF.find(s => s.id === id);
    if (st) { st.photo = url; saveStaffToStorage(); renderStaffList(); renderSchedule(); renderTurns(); updateLoggedInDisplay(); }
  } else if (type === 'fduser') {
    const u = FRONT_DESK_USERS.find(x => x.id === id);
    if (u) { u.photo = url; saveFdUsersToStorage(); renderFdUsersList(); updateLoggedInDisplay(); }
  }
  showToast('Photo saved ✓');
}

function clearPhotoCrop() {
  if (!_photoCropTarget) return;
  const { type, id } = _photoCropTarget;
  closePhotoCrop();

  removePhotoFromStorage(type, id);

  if (type === 'staff') {
    const st = STAFF.find(s => s.id === id);
    if (st) { delete st.photo; saveStaffToStorage(); renderStaffList(); renderTurns(); updateLoggedInDisplay(); }
  } else if (type === 'fduser') {
    const u = FRONT_DESK_USERS.find(x => x.id === id);
    if (u) { delete u.photo; saveFdUsersToStorage(); renderFdUsersList(); updateLoggedInDisplay(); }
  }
  showToast('Photo removed');
}


// ── Staff Photo Modal ──────────────────────────────
// Legacy modal kept for the staff list UI flow. Routes into the shared crop modal.

function showStaffPhotoModal(staffId) {
  const st = STAFF.find(s => s.id === staffId);
  if (!st) return;
  document.getElementById('staff-photo-target-id').value = staffId;
  document.getElementById('staff-photo-initial').textContent = st.name.charAt(0).toUpperCase();
  const preview   = document.getElementById('staff-photo-preview');
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
}

function recropStaffPhoto() {
  const id = document.getElementById('staff-photo-target-id').value;
  if (!id) return;
  const existing = loadPhotoFromStorage('staff', id);
  if (!existing) { showToast('No photo to re-crop'); return; }
  closeStaffPhotoModal();
  showPhotoUpload('staff', id);
  const img = new Image();
  img.onload = () => {
    _photoCropImg    = img;
    _photoCropZoom   = 1;
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
  closeStaffPhotoModal();
  showPhotoUpload('staff', id);
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _photoCropImg    = img;
      _photoCropZoom   = 1;
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
  const id = document.getElementById('staff-photo-target-id').value;
  const st = STAFF.find(s => s.id === id);
  if (!st) return;
  saveStaffToStorage();
  closeStaffPhotoModal();
  renderStaffList();
  renderSchedule();
  showToast('Photo saved');
}

function clearStaffPhoto() {
  const id = document.getElementById('staff-photo-target-id').value;
  const st = STAFF.find(s => s.id === id);
  if (!st) return;
  removePhotoFromStorage('staff', id);
  delete st.photo;
  saveStaffToStorage();
  closeStaffPhotoModal();
  renderStaffList();
  renderSchedule();
  showToast('Photo removed');
}
