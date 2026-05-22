// ── Validation harness bootstrap ────────────────────────────────────────────
// Boots a minimal slice of the new modular app (real store + sync + catalog) to
// validate the DO-source-of-truth contracts before porting the big modules.
// Loaded by app.html only — NOT part of the production index.html.

import { getState, subscribe } from './store.js';
import { start, dispatch, DEVICE_ID } from './sync.js';
import {
  renderServicesList, showAddService, showEditService,
  closeServiceModal, saveService, deleteService,
} from './features/catalog.js';

// Inline onclick handlers in the markup need these on window.
Object.assign(window, { showAddService, showEditService, closeServiceModal, saveService, deleteService, dispatch });

function renderStatus() {
  const s  = getState();
  const el = document.getElementById('vstatus');
  if (el) {
    el.innerHTML =
      `<b>${s.connected ? '🟢 connected' : '🔴 offline'}</b> · seq <b>${s.seq}</b> · ` +
      `outbox <b>${s.pendingCount}</b> · services <b>${s.config.services.length}</b> · ` +
      `device <code>${DEVICE_ID}</code>`;
  }
  const raw = document.getElementById('vstate');
  if (raw) raw.textContent = JSON.stringify(s.config, null, 2);
}

// Re-render on every store change (hydrate, local dispatch, remote broadcast).
subscribe(() => { renderStatus(); renderServicesList(); });

// type=module scripts are deferred, so the DOM is ready here.
start();
renderStatus();
renderServicesList();
