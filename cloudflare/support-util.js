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

export function buildTicket({ id, now, submitter, type, subject, message, appVersion }) {
  const author = (submitter && submitter.name) || 'Staff';
  return {
    id,
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
