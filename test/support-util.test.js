// Pure core for the in-app support-ticket system (Wave 3 #16), adapted from TurnDesk's
// help-desk for SINGLE-salon Muse: no `salon` field, no tenant-isolation gate; tickets are
// keyed `ticket:<id>` in the one salon DO. The internal field vocabulary (`from:'salon'|'dev'`,
// unreadForSalon/unreadForDev) is kept from TurnDesk on purpose — "dev" means the owner/manager
// (admin) here. Types are Problem/Question/Request (owner decision).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_TYPES, MAX_SUBJECT, MAX_MESSAGE, MAX_THREAD,
  validateTicketInput, validateReplyInput,
  ticketKey, newTicketId, canonicalPushId, isAdminRole,
  buildTicket, applyReply, markRead, sanitizeTicket,
} from '../cloudflare/support-util.js';

const submitter = { kind: 'fd', id: '7', name: 'Rosa', role: 'manager' };
const mk = (over = {}) => buildTicket({ id: 'tk-1', now: 1, submitter, type: 'problem', subject: 's', message: 'm', ...over });

// ── validateTicketInput ──────────────────────────────────────
test('validateTicketInput accepts a good ticket and trims', () => {
  const r = validateTicketInput({ type: 'problem', subject: '  Login broken ', message: ' It fails ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.type, 'problem');
  assert.equal(r.value.subject, 'Login broken');
  assert.equal(r.value.message, 'It fails');
});

test('validateTicketInput rejects a bad/missing type; accepts every real type', () => {
  assert.equal(validateTicketInput({ type: 'spam', subject: 'x', message: 'y' }).ok, false);
  assert.equal(validateTicketInput({ subject: 'x', message: 'y' }).ok, false);
  for (const t of TICKET_TYPES) assert.equal(validateTicketInput({ type: t, subject: 'x', message: 'y' }).ok, true);
  assert.deepEqual(TICKET_TYPES, ['problem', 'question', 'request']);
});

test('validateTicketInput requires subject and message', () => {
  assert.equal(validateTicketInput({ type: 'problem', subject: '', message: 'y' }).ok, false);
  assert.equal(validateTicketInput({ type: 'problem', subject: '   ', message: 'y' }).ok, false);
  assert.equal(validateTicketInput({ type: 'problem', subject: 'x', message: '' }).ok, false);
});

test('validateTicketInput enforces subject/message caps', () => {
  assert.equal(validateTicketInput({ type: 'problem', subject: 'a'.repeat(MAX_SUBJECT), message: 'y' }).ok, true);
  assert.equal(validateTicketInput({ type: 'problem', subject: 'a'.repeat(MAX_SUBJECT + 1), message: 'y' }).ok, false);
  assert.equal(validateTicketInput({ type: 'problem', subject: 'x', message: 'a'.repeat(MAX_MESSAGE) }).ok, true);
  assert.equal(validateTicketInput({ type: 'problem', subject: 'x', message: 'a'.repeat(MAX_MESSAGE + 1) }).ok, false);
});

test('validateReplyInput checks the message only', () => {
  assert.equal(validateReplyInput({ message: 'hi' }).ok, true);
  assert.equal(validateReplyInput({ message: '' }).ok, false);
  assert.equal(validateReplyInput({ message: '   ' }).ok, false);
  assert.equal(validateReplyInput({ message: 'a'.repeat(MAX_MESSAGE + 1) }).ok, false);
});

// ── ticketKey / newTicketId — single-tenant (no salon segment) ─
test('ticketKey has NO salon segment', () => {
  assert.equal(ticketKey('tk-1'), 'ticket:tk-1');
});

test('newTicketId is prefixed and distinct per random token', () => {
  assert.match(newTicketId(1000, 'abc123'), /^tk-1000-abc123$/);
  assert.notEqual(newTicketId(1000, 'aaa'), newTicketId(1000, 'bbb'));
});

// ── canonicalPushId — Muse fd/tech namespacing ───────────────
test('canonicalPushId namespaces front-desk vs tech, null for the rest', () => {
  assert.equal(canonicalPushId({ kind: 'fd', id: '7' }), 'fd:7');
  assert.equal(canonicalPushId({ kind: 'tech', id: '7' }), '7');
  assert.equal(canonicalPushId({ kind: 'staff', id: '7' }), '7');
  assert.equal(canonicalPushId({ kind: 'admin', id: 'x' }), null);
  assert.equal(canonicalPushId(null), null);
  assert.equal(canonicalPushId({ id: '' }), null);
});

// ── isAdminRole — the hardcoded admin||manager gate ──────────
test('isAdminRole is true only for admin or manager', () => {
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('manager'), true);
  assert.equal(isAdminRole('frontdesk'), false);
  assert.equal(isAdminRole('tech'), false);
  assert.equal(isAdminRole(''), false);
  assert.equal(isAdminRole(undefined), false);
});

// ── buildTicket — no salon field; new ticket unread for the admin/dev ─
test('buildTicket stamps server fields; a new ticket is unread for the dev; NO salon field', () => {
  const t = mk({ now: 5000, type: 'problem', subject: 'Broken', message: 'It fails', appVersion: 'v5.71' });
  assert.equal(t.id, 'tk-1');
  assert.equal('salon' in t, false);
  assert.equal(t.submittedBy, 'Rosa');
  assert.equal(t.submitterRole, 'manager');
  assert.equal(t.submitterPushId, 'fd:7');
  assert.equal(t.appVersion, 'v5.71');
  assert.equal(t.type, 'problem');
  assert.equal(t.status, 'open');
  assert.equal(t.unreadForDev, true);
  assert.equal(t.unreadForSalon, false);
  assert.equal(t.createdAt, 5000);
  assert.equal(t.updatedAt, 5000);
  assert.deepEqual(t.messages[0], { from: 'salon', author: 'Rosa', text: 'It fails', at: 5000 });
});

test('buildTicket caps appVersion and falls back to a Staff author', () => {
  const t = buildTicket({ id: 'tk-2', now: 1, submitter: { kind: 'fd', id: '9' }, type: 'question', subject: 's', message: 'm', appVersion: 'x'.repeat(40) });
  assert.equal(t.appVersion.length, 20);
  assert.equal(t.submittedBy, 'Staff');
});

// ── applyReply — the two-sided unread/status machine ─────────
test('salon reply flags unread-for-dev and keeps status open', () => {
  const t = mk(); markRead(t, 'dev');
  applyReply(t, { from: 'salon', author: 'Rosa', text: 'still broken', now: 10 });
  assert.equal(t.unreadForDev, true);
  assert.equal(t.unreadForSalon, false);
  assert.equal(t.status, 'open');
  assert.equal(t.updatedAt, 10);
  assert.equal(t.messages.length, 2);
});

test('a salon reply reopens a resolved ticket', () => {
  const t = mk(); t.status = 'resolved';
  applyReply(t, { from: 'salon', author: 'Rosa', text: 'back again', now: 11 });
  assert.equal(t.status, 'open');
});

test('dev reply flags unread-for-salon and sets status replied', () => {
  const t = mk();
  applyReply(t, { from: 'dev', author: 'Manager', text: 'looking into it', now: 20 });
  assert.equal(t.unreadForSalon, true);
  assert.equal(t.status, 'replied');
  assert.equal(t.updatedAt, 20);
  assert.equal(t.messages[1].from, 'dev');
});

test('applyReply caps the thread at MAX_THREAD, keeping the newest', () => {
  const t = mk({ message: 'm0' });
  for (let i = 1; i <= MAX_THREAD + 5; i++) applyReply(t, { from: 'salon', author: 'Rosa', text: 'm' + i, now: 1 + i });
  assert.equal(t.messages.length, MAX_THREAD);
  assert.equal(t.messages[t.messages.length - 1].text, 'm' + (MAX_THREAD + 5));
});

// ── markRead ─────────────────────────────────────────────────
test('markRead clears the right side only', () => {
  const t = mk();
  applyReply(t, { from: 'dev', author: 'Manager', text: 'r', now: 2 });
  markRead(t, 'salon');
  assert.equal(t.unreadForSalon, false);
  assert.equal(t.unreadForDev, true);
  markRead(t, 'dev');
  assert.equal(t.unreadForDev, false);
});

// ── sanitizeTicket — client view drops the internal push id ──
test('sanitizeTicket drops submitterPushId, keeps the rest', () => {
  const s = sanitizeTicket(mk());
  assert.equal(s.submitterPushId, undefined);
  assert.equal(s.id, 'tk-1');
  assert.equal(s.messages.length, 1);
  assert.equal(s.unreadForSalon, false);
});
