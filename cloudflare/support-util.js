// Pure helpers for the in-app support-ticket system (Wave 3 #16). No Cloudflare APIs →
// unit-testable + wrangler-bundled into worker.js. Adapted from TurnDesk's help-desk for
// SINGLE-salon Muse: tickets live in the one salon DO keyed `ticket:<id>` (no tenant segment,
// no cross-salon isolation gate). The internal field vocabulary — `from:'salon'|'dev'`,
// unreadForSalon/unreadForDev — is kept from TurnDesk on purpose to minimise port risk; here
// "dev" means the owner/manager (admin) who answers tickets, not an external developer.

export const TICKET_TYPES = ['problem', 'question', 'request'];
export const MAX_SUBJECT = 120;
export const MAX_MESSAGE = 5000;
export const MAX_THREAD  = 100;   // cap messages[] on one ticket (keep newest)

export function validateTicketInput(body) {
  const b = body || {};
  const type    = String(b.type || '');
  const subject = String(b.subject || '').trim();
  const message = String(b.message || '').trim();
  if (!TICKET_TYPES.includes(type))   return { ok: false, error: 'Pick a valid type.' };
  if (subject.length < 1)             return { ok: false, error: 'Enter a subject.' };
  if (subject.length > MAX_SUBJECT)   return { ok: false, error: 'Subject is too long.' };
  if (message.length < 1)             return { ok: false, error: 'Enter a message.' };
  if (message.length > MAX_MESSAGE)   return { ok: false, error: 'Message is too long.' };
  return { ok: true, value: { type, subject, message } };
}

export function validateReplyInput(body) {
  const message = String((body || {}).message || '').trim();
  if (message.length < 1)             return { ok: false, error: 'Enter a message.' };
  if (message.length > MAX_MESSAGE)   return { ok: false, error: 'Message is too long.' };
  return { ok: true, value: { message } };
}

export function ticketKey(id) { return 'ticket:' + id; }

// id is generated in the Worker (which supplies now + a random token) so this stays pure.
export function newTicketId(now, rand) { return 'tk-' + now + '-' + rand; }

// The push subscription namespace differs by user kind: the staff app registers front-desk
// users under `push:fd:<id>:` and technicians under the raw `push:<techId>:`. An admin/owner
// dashboard user has no staff push identity → null.
export function canonicalPushId(user) {
  if (!user || !user.id) return null;
  const kind = user.kind || '';
  if (kind === 'fd') return 'fd:' + user.id;
  if (kind === 'staff' || kind === 'tech') return String(user.id);
  return null;
}

// The hardcoded admin gate for reply-as-dev / status / clearing the dev-unread side. Matches
// the app's existing `['admin','manager'].includes(role)` pattern (reports.js, helcim.js) —
// deliberately NOT the owner-editable canDo() permissions, so the client and server never
// disagree about who may answer tickets.
export function isAdminRole(role) { return role === 'admin' || role === 'manager'; }

// ── Numeric ticket ID helpers (#YYMMDD-NN) ────────────────────────────────────
// The visible ID is salon-local-date based: a stable per-day sequence the owner can
// say out loud. ticketDayCode mirrors monthOfTs (worker.js/utils.js) but to the DAY —
// a client copy lives in js/app/utils.js and is pinned to this one by test. Bucketing
// is ALWAYS by config.salon_tz, never device/server local time.
const _dayFmt = new Map();
export function ticketDayCode(ts, tz) {
  let f = _dayFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); _dayFmt.set(tz, f); }
  return f.format(new Date(ts)).slice(2).replace(/-/g, '');   // "2026-11-05" → "261105"
}

// The create-path sequence: 1 + the count of existing tickets filed the SAME salon-day
// (resolved/archived included so a number is never reused within a day). Zero-padded to
// 2, widening past 99. Must agree with planTicketNumbers' running count for the same set.
export function nextTicketSeq(existingTickets, dayCode, tz) {
  let n = 0;
  for (const t of existingTickets || []) {
    if (t && t.createdAt != null && ticketDayCode(t.createdAt, tz) === dayCode) n++;
  }
  return String(n + 1).padStart(2, '0');
}

// The backfill plan: walk all tickets oldest-first, run a per-salon-day counter over
// EVERY same-day ticket (so an already-numbered ticket still consumes its slot and the
// sequence stays in step with the create path), and emit {id, num} ONLY for tickets that
// are missing a num. Pure → the DO applies it with a re-get-before-put so a concurrent
// reply is never clobbered.
export function planTicketNumbers(tickets, tz) {
  const sorted = [...(tickets || [])]
    .filter(t => t && t.createdAt != null)
    .sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
  const perDay = Object.create(null);
  const out = [];
  for (const t of sorted) {
    const day = ticketDayCode(t.createdAt, tz);
    perDay[day] = (perDay[day] || 0) + 1;
    if (!t.num) out.push({ id: t.id, num: day + '-' + String(perDay[day]).padStart(2, '0') });
  }
  return out;
}

// Double-submit safety net: an existing NON-archived ticket from the SAME submitter with
// the SAME subject + first-message text, created within windowMs (default 60s). A second
// identical file (double-tap, or a network retry) resolves to this one instead of a twin.
// submitterKey = canonicalPushId(who) when present, else the stamped name (admins have no
// push id) — matched against the stored submitterPushId, falling back to submittedBy.
export function findRecentDuplicate(existingTickets, { submitterKey, subject, message, now, windowMs = 60000 }) {
  const subj = String(subject || '').trim();
  const msg = String(message || '').trim();
  const key = submitterKey || '';
  for (const t of existingTickets || []) {
    if (!t || t.status === 'archived') continue;
    const created = t.createdAt || 0;
    if (now < created || (now - created) > windowMs) continue;
    if ((t.submitterPushId || t.submittedBy || '') !== key) continue;
    if (String(t.subject || '').trim() !== subj) continue;
    const first = (t.messages && t.messages[0] && t.messages[0].text) || '';
    if (String(first).trim() !== msg) continue;
    return t;
  }
  return null;
}

export function buildTicket({ id, now, submitter, type, subject, message, appVersion, num }) {
  const author = (submitter && submitter.name) || 'Staff';
  return {
    id,
    num: num || null,
    submittedBy: author,
    submitterRole: (submitter && submitter.role) || '',
    submitterPushId: canonicalPushId(submitter),
    appVersion: String(appVersion || '').slice(0, 20),   // diagnostic context (client-supplied)
    type, subject,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    unreadForDev: true,       // a brand-new ticket must surface to the admin
    unreadForSalon: false,
    messages: [{ from: 'salon', author, text: message, at: now }],
  };
}

// Append a message and run the unread state machine. `from` is 'salon' (a staffer) or 'dev'
// (the admin/manager).
export function applyReply(ticket, { from, author, text, now }) {
  ticket.messages.push({ from, author: author || (from === 'dev' ? 'Manager' : 'Staff'), text, at: now });
  if (ticket.messages.length > MAX_THREAD) ticket.messages.splice(0, ticket.messages.length - MAX_THREAD);
  ticket.updatedAt = now;
  if (from === 'dev') {
    ticket.unreadForSalon = true;
    ticket.status = 'replied';
  } else {
    ticket.unreadForDev = true;
    if (ticket.status === 'resolved') ticket.status = 'open';   // reopened by a new staff message
  }
  return ticket;
}

export function markRead(ticket, who) {
  if (who === 'dev') ticket.unreadForDev = false;
  else if (who === 'salon') ticket.unreadForSalon = false;
  return ticket;
}

// Client-facing view: strip the internal push id (never needed on a device).
export function sanitizeTicket(ticket) {
  const { submitterPushId, ...rest } = ticket;
  return rest;
}
