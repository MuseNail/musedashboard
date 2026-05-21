// ── Guest Card Builder ───────────────────────────
function renderGuestsContainer() {
  const container = document.getElementById('guests-container');
  container.innerHTML = '';
  guestCount = 0;
  addGuestCard();
  renderAddGuestButton();
}

function renderAddGuestButton() {
  // Remove existing button if present
  const existing = document.getElementById('add-guest-btn-row');
  if (existing) existing.remove();
  const container = document.getElementById('guests-container');
  const row = document.createElement('div');
  row.id = 'add-guest-btn-row';
  row.className = 'flex justify-center pt-2 pb-2';
  row.innerHTML = `
    <button onclick="addGuestCard()" class="group flex items-center gap-2 text-secondary hover:text-on-secondary-container transition-colors px-5 py-3 rounded-full hover:bg-secondary-container text-sm font-body font-semibold tracking-wide">
      <span class="material-symbols-outlined text-lg">person_add</span>
      Add another guest
    </button>
  `;
  container.appendChild(row);
}

function addGuestCard() {
  guestCount++;
  const idx = guestCount;
  const container = document.getElementById('guests-container');

  // Remove add-button so we insert card before re-appending it
  const addBtn = document.getElementById('add-guest-btn-row');
  if (addBtn) addBtn.remove();

  const card = document.createElement('section');
  card.className = 'guest-card bg-surface-container-lowest p-6 rounded-xl shadow-sm border border-surface-container-high mb-5';
  card.id = `guest-card-${idx}`;

  const visibleServices = SERVICES.filter(s => isServiceVisibleOnCheckin(s.id));
  const serviceButtons = visibleServices.map(s => `
    <button type="button" onclick="toggleService(this, '${idx}', '${s.id}')"
      data-service="${s.id}"
      class="service-btn flex flex-col items-center justify-center py-3 rounded-lg bg-surface-container text-on-surface-variant border border-outline-variant/30 hover:bg-primary/10 hover:text-primary transition-all duration-200">
      <span class="text-xs font-headline font-bold">${s.abbr}</span>
      <span class="text-[9px] font-body mt-0.5 uppercase tracking-tighter leading-tight text-center">${s.label}</span>
    </button>
  `).join('');

  if (idx === 1) {
    // Primary guest — full form with autocomplete
    card.innerHTML = `
      <div class="flex justify-between items-baseline mb-5">
        <h2 class="text-xs font-headline font-bold tracking-widest text-primary uppercase">Primary Guest</h2>
        <span class="text-[10px] font-body text-outline uppercase tracking-tighter opacity-50">Entry 01</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-5">
        <div class="space-y-4">
          <div class="ac-input-wrap">
            <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">Phone Number</label>
            <input id="phone-${idx}" type="tel" placeholder="(555) 000-0000" autocomplete="off"
              oninput="acSearch(this, ${idx}, 'phone')"
              class="w-full bg-transparent border-b border-surface-container-high py-2 text-xl font-headline font-light focus:border-primary transition-colors placeholder:text-surface-container-highest">
            <div id="ac-phone-${idx}" class="autocomplete-list hidden"></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="ac-input-wrap">
              <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">First Name</label>
              <input id="first-${idx}" type="text" placeholder="Name" autocomplete="off"
                oninput="acSearch(this, ${idx}, 'first'); autoCapitalize(this)"
                class="w-full bg-transparent border-b border-surface-container-high py-2 text-lg font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
              <div id="ac-first-${idx}" class="autocomplete-list hidden"></div>
            </div>
            <div>
              <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">Last Name</label>
              <input id="last-${idx}" type="text" placeholder="Last name"
                oninput="autoCapitalize(this)"
                class="w-full bg-transparent border-b border-surface-container-high py-2 text-lg font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
            </div>
          </div>
        </div>
        <div>
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-3">Select Services</label>
          <div class="grid grid-cols-4 gap-2" id="services-${idx}">${serviceButtons}</div>
        </div>
      </div>
    `;
  } else {
    // Additional guest — simplified with same-contact checkbox
    card.innerHTML = `
      <div class="flex justify-between items-baseline mb-4">
        <h2 class="text-xs font-headline font-bold tracking-widest text-primary uppercase">Guest ${idx}</h2>
        <div class="flex items-center gap-3">
          <span class="text-[10px] font-body text-outline uppercase tracking-tighter opacity-50">Entry ${String(idx).padStart(2,'0')}</span>
          <button onclick="removeGuest(${idx})" class="text-xs font-body text-outline hover:text-error transition-colors flex items-center gap-1">
            <span class="material-symbols-outlined" style="font-size:14px">remove_circle</span> Remove
          </button>
        </div>
      </div>

      <!-- Same contact checkbox -->
      <label class="flex items-center gap-3 mb-5 cursor-pointer" id="same-contact-label-${idx}" onclick="toggleSameContact(${idx})">
        <div id="same-contact-box-${idx}"
          class="w-6 h-6 rounded border-2 border-outline-variant flex items-center justify-center flex-shrink-0 transition-all"
          style="background:transparent">
          <span class="material-symbols-outlined hidden" id="same-contact-check-${idx}"
            style="font-size:14px;color:#ffffff;font-variation-settings:'FILL' 1,'wght' 700">check</span>
        </div>
        <span class="text-sm font-body text-on-surface-variant">Same contact info as primary guest</span>
        <input type="checkbox" id="same-contact-${idx}" class="hidden">
      </label>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-5">
        <!-- Contact fields (hidden when same-contact checked) -->
        <div id="manual-contact-fields-${idx}" class="space-y-3">
      <div class="ac-input-wrap">
        <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest block mb-1">Phone Number</label>
        <input id="phone-${idx}" type="tel" placeholder="(555) 000-0000" autocomplete="off"
          oninput="acSearch(this, ${idx}, 'phone')"
          class="w-full bg-transparent border-b border-surface-container-high py-2 text-xl font-headline font-light focus:border-primary transition-colors placeholder:text-surface-container-highest">
        <div id="ac-phone-${idx}" class="autocomplete-list hidden"></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="ac-input-wrap">
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">First Name</label>
          <input id="first-${idx}" type="text" placeholder="Name" autocomplete="off"
            oninput="acSearch(this, ${idx}, 'first'); autoCapitalize(this)"
            class="w-full bg-transparent border-b border-surface-container-high py-2 text-lg font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
          <div id="ac-first-${idx}" class="autocomplete-list hidden"></div>
        </div>
        <div>
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">Last Name</label>
          <input id="last-${idx}" type="text" placeholder="Last name"
            oninput="autoCapitalize(this)"
            class="w-full bg-transparent border-b border-surface-container-high py-2 text-lg font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
        </div>
      </div>
    </div>
        <!-- First name only (shown when same-contact checked) -->
        <div id="first-only-fields-${idx}" class="hidden space-y-4">
          <div>
            <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-1">First Name</label>
            <input id="first-only-${idx}" type="text" placeholder="Name"
              oninput="autoCapitalize(this)"
              class="w-full bg-transparent border-b border-surface-container-high py-2 text-lg font-headline focus:border-primary transition-colors placeholder:text-surface-container-highest">
          </div>
        </div>
        <!-- Services -->
        <div>
          <label class="text-[11px] font-body font-semibold text-outline-variant uppercase tracking-widest px-1 block mb-3">Select Services</label>
          <div class="grid grid-cols-4 gap-2" id="services-${idx}">${serviceButtons}</div>
        </div>
      </div>
    `;
  }

  container.appendChild(card);
  renderAddGuestButton();

  // Scroll new card into view
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function toggleSameContact(idx) {
  const cb = document.getElementById(`same-contact-${idx}`);
  const box = document.getElementById(`same-contact-box-${idx}`);
  const checkIcon = document.getElementById(`same-contact-check-${idx}`);
  const contactFields = document.getElementById(`manual-contact-fields-${idx}`);
  const firstOnlyFields = document.getElementById(`first-only-fields-${idx}`);

  cb.checked = !cb.checked;

  if (cb.checked) {
    // Retain any first name already typed in the contact fields
    const existingFirst = document.getElementById(`first-${idx}`)?.value.trim() || '';
    box.style.background = '#1a5252';
    box.style.borderColor = '#1a5252';
    checkIcon.classList.remove('hidden');
    contactFields.classList.add('hidden');
    firstOnlyFields.classList.remove('hidden');
    // Pre-fill the first-only field with the existing first name
    const firstOnlyInput = document.getElementById(`first-only-${idx}`);
    if (firstOnlyInput && existingFirst) firstOnlyInput.value = existingFirst;
  } else {
    box.style.background = 'transparent';
    box.style.borderColor = '#7a858a';
    checkIcon.classList.add('hidden');
    contactFields.classList.remove('hidden');
    firstOnlyFields.classList.add('hidden');
    // Restore the first name back to the full contact field
    const firstOnlyVal = document.getElementById(`first-only-${idx}`)?.value.trim() || '';
    const firstInput = document.getElementById(`first-${idx}`);
    if (firstInput && firstOnlyVal) firstInput.value = firstOnlyVal;
  }
}

function removeGuest(idx) {
  const card = document.getElementById(`guest-card-${idx}`);
  if (card) card.remove();
}

function toggleService(btn, guestIdx, serviceId) {
  btn.classList.toggle('selected');
}


// ── Check-In Submission ──────────────────────────
const GROUP_COLORS = [
  '#1a5252','#785a1a','#5c3d8f','#1a5c7a','#7a2a1a',
  '#2a7a4f','#7a1a5c','#4f4f1a','#1a3a7a','#7a4f1a'
];
let groupColorIndex = 0;

function submitCheckin() {
  const newEntries = [];
  for (let i = 1; i <= guestCount; i++) {
    const card = document.getElementById(`guest-card-${i}`);
    if (!card) continue;

    const sameContact = i > 1 && document.getElementById(`same-contact-${i}`)?.checked;

    let phone, first, last;
    if (sameContact) {
      first = document.getElementById(`first-only-${i}`)?.value.trim() || '';
      phone = document.getElementById('phone-1')?.value.trim() || '';
      last  = '';
    } else {
      phone = document.getElementById(`phone-${i}`)?.value.trim() || '';
      first = document.getElementById(`first-${i}`)?.value.trim() || '';
      last  = document.getElementById(`last-${i}`)?.value.trim() || '';
    }

    if (!first) { showToast('Please enter a first name for each guest.'); return; }

    const selectedBtns = card.querySelectorAll('.service-btn.selected');
    const services = Array.from(selectedBtns).map(b => b.dataset.service);

    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      name: first + (last ? ' ' + last : ''),
      phone,
      services,
      status: 'waiting',
      checkinTime: new Date(),
      isNew: true,
      skipSquare: sameContact,
      isAppointment: currentCheckinType === 'appointment',
    };
    newEntries.push(entry);
    queue.push(entry);
  }

  if (newEntries.length === 0) return;

  // Assign group info if multiple guests checked in together
  if (newEntries.length > 1) {
    const groupId = `grp-${Date.now()}`;
    const groupColor = GROUP_COLORS[groupColorIndex % GROUP_COLORS.length];
    groupColorIndex++;
    const primaryName = newEntries[0].name;
    newEntries.forEach((e, i) => {
      e.groupId = groupId;
      e.groupColor = groupColor;
      e.groupLabel = i === 0
        ? `${e.name} (primary)`
        : `${primaryName} — ${e.name}`;
    });
  }

  // Square: upsert only guests who aren't using same contact
  newEntries.forEach(e => { if (!e.skipSquare) squareUpsertCustomer(e); });

  // Save queue to localStorage AND push to Sheets immediately (not debounced)
  // This is what makes other devices see the new check-in within 5 seconds
  saveQueueToStorage();
  pushQueueToSheets(); // immediate push, not debounced

  // Export to Google Sheets (Check-Ins tab)
  newEntries.forEach(e => exportToSheets(e));

  // Show confirmation
  document.getElementById('confirm-name').textContent =
    newEntries.map(e => e.name).join(' & ');
  goTo('screen-confirm');

  clearTimeout(window._confirmResetTimer);
  window._confirmResetTimer = setTimeout(() => {
    if (document.getElementById('screen-confirm').classList.contains('active')) {
      goTo('screen-welcome');
    }
  }, 5000);

  renderQueue();
  updateStats();
  renderTurns();
}


