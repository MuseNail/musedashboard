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
  ticketDayCode, nextTicketSeq, planTicketNumbers, findRecentDuplicate,
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

// ── ticketDayCode — salon-local YYMMDD (the ID date segment) ──
const TZ = 'America/Los_Angeles';
test('ticketDayCode returns the salon-local YYMMDD', () => {
  // 2026-11-05 20:00 UTC = 12:00 PST on Nov 5 (PST, DST ended Nov 1)
  assert.equal(ticketDayCode(Date.UTC(2026, 10, 5, 20, 0, 0), TZ), '261105');
});
test('ticketDayCode buckets by salon tz across the UTC day boundary', () => {
  // 2026-11-05 06:30 UTC = 2026-11-04 22:30 PST, but 2026-11-05 01:30 EST
  assert.equal(ticketDayCode(Date.UTC(2026, 10, 5, 6, 30, 0), TZ), '261104');
  assert.equal(ticketDayCode(Date.UTC(2026, 10, 5, 6, 30, 0), 'America/New_York'), '261105');
});

// ── nextTicketSeq — the create-path number ───────────────────
test('nextTicketSeq counts same-day tickets (incl. resolved/archived) and zero-pads', () => {
  const day = '261105';
  const t = (ms, over = {}) => ({ createdAt: Date.UTC(2026, 10, 5, 20, 0, 0) + ms, ...over });
  assert.equal(nextTicketSeq([], day, TZ), '01');
  assert.equal(nextTicketSeq([t(0), t(1, { status: 'resolved' }), t(2, { status: 'archived' })], day, TZ), '04');
  assert.equal(nextTicketSeq([{ createdAt: Date.UTC(2026, 10, 4, 20, 0, 0) }], day, TZ), '01', 'a different-day ticket does not count');
});
test('nextTicketSeq widens past 99', () => {
  const many = Array.from({ length: 120 }, () => ({ createdAt: Date.UTC(2026, 10, 5, 20, 0, 0) }));
  assert.equal(nextTicketSeq(many, '261105', TZ), '121');
});

// ── planTicketNumbers — the backfill, agreeing with create count+1 ─
test('planTicketNumbers assigns a per-day running sequence to tickets missing num, skipping numbered ones', () => {
  const base = Date.UTC(2026, 10, 5, 20, 0, 0);
  const tickets = [
    { id: 'c', createdAt: base + 2000 },                       // same day, 3rd
    { id: 'a', createdAt: base + 0 },                          // same day, 1st
    { id: 'b', createdAt: base + 1000, num: '261105-02' },     // same day, 2nd, ALREADY numbered
    { id: 'd', createdAt: Date.UTC(2026, 10, 6, 20, 0, 0) },   // next day, 1st
  ];
  assert.deepEqual(planTicketNumbers(tickets, TZ), [
    { id: 'a', num: '261105-01' },
    { id: 'c', num: '261105-03' },   // b consumed slot 02 though it already had its num
    { id: 'd', num: '261106-01' },
  ]);
});
test('planTicketNumbers is a no-op when every ticket already has a num', () => {
  assert.deepEqual(planTicketNumbers([{ id: 'a', createdAt: 1, num: 'x' }], TZ), []);
});

// ── findRecentDuplicate — the double-submit safety net ───────
test('findRecentDuplicate matches same submitter+subject+first-message within the window', () => {
  const now = 1_000_000;
  const existing = [{ id: 't1', createdAt: now - 5000, status: 'open', submitterPushId: 'fd:7', submittedBy: 'Hien', subject: 'Clock in', messages: [{ text: 'cannot clock in' }] }];
  assert.equal(findRecentDuplicate(existing, { submitterKey: 'fd:7', subject: 'Clock in', message: 'cannot clock in', now, windowMs: 60000 })?.id, 't1');
});
test('findRecentDuplicate rejects different content, submitter, archived, or out-of-window', () => {
  const now = 1_000_000;
  const base = { id: 't1', createdAt: now - 5000, status: 'open', submitterPushId: 'fd:7', submittedBy: 'Hien', subject: 'Clock in', messages: [{ text: 'cannot clock in' }] };
  const call = (over = {}, q = {}) => findRecentDuplicate([{ ...base, ...over }], { submitterKey: 'fd:7', subject: 'Clock in', message: 'cannot clock in', now, windowMs: 60000, ...q });
  assert.equal(call({ subject: 'Something else' }), null);
  assert.equal(call({ messages: [{ text: 'different' }] }), null);
  assert.equal(call({}, { submitterKey: 'fd:9' }), null);
  assert.equal(call({ status: 'archived' }), null);
  assert.equal(call({ createdAt: now - 120000 }), null, 'older than the 60s window');
});
test('findRecentDuplicate falls back to submittedBy when there is no push id (admin submitter)', () => {
  const now = 1_000_000;
  const existing = [{ id: 't1', createdAt: now - 1000, status: 'open', submitterPushId: null, submittedBy: 'Carlos', subject: 'S', messages: [{ text: 'm' }] }];
  assert.equal(findRecentDuplicate(existing, { submitterKey: 'Carlos', subject: 'S', message: 'm', now })?.id, 't1');
});

// ── buildTicket num ──────────────────────────────────────────
test('buildTicket stores num when provided, null otherwise', () => {
  assert.equal(mk({ num: '261105-01' }).num, '261105-01');
  assert.equal(mk().num, null);
});
