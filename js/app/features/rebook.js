// ── Book-next-appointment (rebook) at checkout ───────────────────────────────
// After a sale is paid, offer to book the customer's next visit. "Book next appointment"
// jumps to the Calendar and shows a banner; clicking a slot opens the New Appointment form
// autofilled with the customer's name + phone (handled in calendar.js). Device-local only —
// `_pending` is NEVER synced, and maybeOfferRebook runs ONLY from the local finalize path.
import { getState } from '../store.js';
import { escHtml } from '../utils.js';
import { splitName, shouldOfferRebook } from '../rebook-util.js';

const cfg = () => getState().config;

// The customer to book next: { name, phone }. Null = no rebook in progress. Device-local.
let _pending = null;
// The candidate shown on the success card (before the operator taps Book). Separate from
// _pending so a card the operator ignores never enters rebook mode.
let _cardCandidate = null;

export function rebookPending() { return _pending; }

// ── Offer the prompt (checkout device only) ──────────────────────────────────
// GUARDRAIL: call this ONLY from the local _finalizeTerminalPaid. NEVER from updateStatus,
// store.applyChange, onStateChange, or any sync/webhook handler — a synced "paid" transition
// on another device must not pop this card (it would fire on every device for every sale).
export function maybeOfferRebook(entry) {
  // Clear any stale offer from a PREVIOUS sale first — so a later non-service sale (gift card /
  // Quick Sale) doesn't leave the old customer's card up, where "Book" would rebook the wrong person.
  document.getElementById('rebook-card')?.remove();
  document.removeEventListener('keydown', _onCardKey);
  _cardCandidate = null;
  if (!shouldOfferRebook(entry, cfg())) return;
  _cardCandidate = { name: entry.name, phone: entry.phone || '' };
  _showCard(_cardCandidate);
}

function _onCardKey(e) { if (e.key === 'Escape') rebookDismiss(); }

function _showCard({ name }) {
  document.getElementById('rebook-card')?.remove();   // a new sale replaces any lingering card
  const first = splitName(name).first || 'this customer';
  // Centered modal-style prompt over a soft backdrop so it's impossible to miss. It does NOT hard-block:
  // tapping the backdrop (or Not now / Escape) dismisses it, so the next checkout is one tap away.
  const card = document.createElement('div');
  card.id = 'rebook-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Book next appointment');
  card.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4';
  card.innerHTML = `
    <div class="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-2xl border border-surface-container-high p-6" aria-live="polite">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined text-primary" style="font-size:26px" aria-hidden="true">event_upcoming</span></span>
        <span class="font-headline font-bold text-on-surface text-xl">Book next visit?</span>
        <button onclick="rebookDismiss()" aria-label="Dismiss" class="ml-auto w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"><span class="material-symbols-outlined" style="font-size:22px" aria-hidden="true">close</span></button>
      </div>
      <div class="text-base font-body text-on-surface-variant mb-5">${escHtml(first)} is all set — book their next appointment while they're here?</div>
      <button onclick="rebookBookNow()" class="w-full bg-primary hover:bg-primary-dim text-on-primary py-3.5 rounded-2xl font-headline font-bold text-base flex items-center justify-center gap-2"><span class="material-symbols-outlined" style="font-size:22px" aria-hidden="true">event_upcoming</span>Book next appointment</button>
      <button onclick="rebookDismiss()" class="w-full mt-2 py-3 rounded-2xl text-on-surface-variant font-headline font-semibold text-base hover:bg-surface-container transition-colors">Not now</button>
    </div>`;
  // Outside-tap (on the backdrop itself, not the inner card) dismisses.
  card.addEventListener('click', (ev) => { if (ev.target === card) rebookDismiss(); });
  document.body.appendChild(card);
  document.addEventListener('keydown', _onCardKey);
}

export function rebookDismiss() {
  document.getElementById('rebook-card')?.remove();
  document.removeEventListener('keydown', _onCardKey);
  _cardCandidate = null;
}

export function rebookBookNow() {
  const c = _cardCandidate;
  rebookDismiss();
  if (c) startRebook(c);
}

// ── Rebook mode: banner + navigate ───────────────────────────────────────────
export function startRebook({ name, phone }) {
  _pending = { name, phone: phone || '' };
  window.showDashPanel?.('calendar');
  renderRebookBanner();
}

// Start a rebook straight from a queue customer card (independent of the post-checkout prompt).
// Looks the entry up by id so the inline onclick stays a simple string; needs a name to prefill.
export function rebookFromQueue(entryId) {
  const e = (getState().queue || []).find(x => String(x.id) === String(entryId));
  if (!e || !String(e.name || '').trim()) return;
  startRebook({ name: e.name, phone: e.phone || '' });
}

export function cancelRebook() { _pending = null; renderRebookBanner(); }

// Clear rebook mode after a NEW appointment is saved (calendar.js gates on _apptEditId == null).
export function finishRebook() { if (_pending) { _pending = null; renderRebookBanner(); } }

// Show/hide the calendar banner from _pending. Called on every calendar render so it survives
// tab re-entry and live re-renders.
export function renderRebookBanner() {
  const banner = document.getElementById('rebook-banner');
  if (!banner) return;
  const nameEl = document.getElementById('rebook-banner-name');
  if (_pending) {
    if (nameEl) nameEl.textContent = _pending.name || 'this customer';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
