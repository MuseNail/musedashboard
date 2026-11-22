// ── Book-next-appointment (rebook) at checkout ───────────────────────────────
// After a sale is paid, offer to book the customer's next visit. "Book next appointment"
// jumps to the Calendar and shows a banner; clicking a slot opens the New Appointment form
// prefilled with the SAME setup just finished — the whole party, each guest's services, and
// the same tech per service (handled in calendar.js). Device-local only — `_pending` is NEVER
// synced, and maybeOfferRebook runs ONLY from the local finalize path.
import { getState } from '../store.js';
import { escHtml } from '../utils.js';
import { splitName, shouldOfferRebook, buildRebookParty } from '../rebook-util.js';

const cfg = () => getState().config;

// The party to book next: [{ name, phone, lines:[{serviceId,staffId}] }], primary first.
// Null = no rebook in progress. Device-local.
let _pending = null;
// The party shown on the success card (before the operator taps Book). Separate from
// _pending so a card the operator ignores never enters rebook mode.
let _cardCandidate = null;

export function rebookPending() { return _pending; }

// Join a party's names for the card/banner/chip: "Ana", "Ana & Bea", "Ana, Bea & Cy".
function _joinNames(names) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

// ── Offer the prompt (checkout device only) ──────────────────────────────────
// GUARDRAIL: call this ONLY from the local _finalizeTerminalPaid. NEVER from updateStatus,
// store.applyChange, onStateChange, or any sync/webhook handler — a synced "paid" transition
// on another device must not pop this card (it would fire on every device for every sale).
// `entries` = the ORIGINAL queue entries (carry the gate fields services/quickSale/name,
// and respect config.rebook_prompt); `party` = the resolved setup from buildRebookParty.
export function maybeOfferRebook(entries, party) {
  // Clear any stale offer from a PREVIOUS sale first — so a later non-service sale (gift card /
  // Quick Sale) doesn't leave the old customer's card up, where "Book" would rebook the wrong person.
  document.getElementById('rebook-card')?.remove();
  document.removeEventListener('keydown', _onCardKey);
  _cardCandidate = null;
  const list = Array.isArray(entries) ? entries : (entries ? [entries] : []);
  // Offer when the setting is on AND any party member is a bookable service visit (a mixed
  // party whose primary is retail/gift-only still offers). shouldOfferRebook ANDs rebook_prompt.
  if (!list.some(e => shouldOfferRebook(e, cfg()))) return;
  if (!party || !party.length) return;
  _cardCandidate = party;
  _showCard(party);
}

function _onCardKey(e) { if (e.key === 'Escape') rebookDismiss(); }

function _showCard(party) {
  document.getElementById('rebook-card')?.remove();   // a new sale replaces any lingering card
  const names = (party || []).map(p => p.name).filter(Boolean);
  const multi = names.length > 1;
  const lead = multi
    ? `${escHtml(_joinNames(names))} are all set — book their next appointment while they're here?`
    : `${escHtml(splitName(names[0] || '').first || 'this customer')} is all set — book their next appointment while they're here?`;
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
      <div class="text-base font-body text-on-surface-variant mb-5">${lead}</div>
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
  const party = _cardCandidate;
  rebookDismiss();
  if (party && party.length) startRebook(party);
}

// ── Rebook mode: banner + navigate ───────────────────────────────────────────
// `party` = [{ name, phone, lines }] (primary first). Derives the display fields once.
export function startRebook(party) {
  const p = (party || []).filter(Boolean);
  if (!p.length) return;
  const names = p.map(g => g.name).filter(Boolean);
  _pending = { party: p, primaryName: p[0].name || '', namesLabel: _joinNames(names) };
  window.showDashPanel?.('calendar');
  renderRebookBanner();
}

// Start a rebook straight from a queue customer card (independent of the post-checkout prompt).
// If the tapped entry is in a party, the WHOLE party is booked with the real primary on top,
// regardless of which member's card was tapped.
export function rebookFromQueue(entryId) {
  const q = getState().queue || [];
  const e = q.find(x => String(x.id) === String(entryId));
  if (!e || !String(e.name || '').trim()) return;
  const group = e.groupId ? q.filter(x => x.groupId === e.groupId) : [e];
  const party = buildRebookParty(group, cfg());
  if (party.length) startRebook(party);
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
  if (_pending && _pending.party && _pending.party.length) {
    if (nameEl) nameEl.textContent = _pending.namesLabel || _pending.primaryName || 'this customer';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
