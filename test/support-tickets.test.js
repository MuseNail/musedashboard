// DO-integration tests for the support-ticket system (Wave 3 #16), single-salon Muse.
// Drives MuseSalonDO.fetch for the /support/* routes + the data-safety plumbing (ticket:<id>
// storage, R2 tickets dump, restore CARRIES tickets, factory-reset CLEARS them, pruneBackups
// never evicts a state snapshot for a ticket dump). Mirrors the worker-restore harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseSalonDO, isTicketDump } from '../cloudflare/worker.js';

function makeGate() { return { active: false, entered: 0 }; }
function makeStorage(gate = makeGate()) {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) {
      if (typeof k === 'object' && k !== null) { for (const [kk, vv] of Object.entries(k)) m.set(kk, vv); return; }
      m.set(k, v);
    },
    async delete(k) { if (Array.isArray(k)) k.forEach(x => m.delete(x)); else m.delete(k); },
    async deleteAll() { m.clear(); },
    async list({ prefix } = {}) { const r = new Map(); for (const [k, v] of m) if (!prefix || k.startsWith(prefix)) r.set(k, v); return r; },
    async getAlarm() { return null; },
    async setAlarm() {},
  };
}
function makeState(gate = makeGate()) {
  const storage = makeStorage(gate);
  return { storage, _gate: gate, async blockConcurrencyWhile(fn) { gate.active = true; try { return await fn(); } finally { gate.active = false; } } };
}
function makeBucket() {
  const store = new Map();
  return {
    _store: store,
    async put(k, body) { store.set(k, body); },
    async get(k) { return store.has(k) ? { text: async () => store.get(k) } : null; },
    async delete(k) { (Array.isArray(k) ? k : [k]).forEach(x => store.delete(x)); },
    async list({ prefix, cursor } = {}) { return { objects: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(k => ({ key: k, uploaded: new Date().toISOString(), size: String(store.get(k)).length })), truncated: false }; },
  };
}

// Seed a DO with two front-desk users: an admin (manager) and a plain frontdesk, each with a session.
async function seedDO() {
  const state = makeState();
  const bucket = makeBucket();
  const doInst = new MuseSalonDO(state, { PHOTOS_BUCKET: bucket, VAPID_PRIVATE_KEY: '' });
  const s = state.storage;
  await s.put('config:fd_users', [
    { id: 'mgr', name: 'Rosa', role: 'manager', pin: '1111' },
    { id: 'desk', name: 'Mia', role: 'frontdesk', pin: '2222' },
  ]);
  const far = Date.now() + 1e9;
  await s.put('sess:MGR', { kind: 'fd', id: 'mgr', name: 'Rosa', role: 'manager', expires: far });
  await s.put('sess:DESK', { kind: 'fd', id: 'desk', name: 'Mia', role: 'frontdesk', expires: far });
  return { doInst, s, bucket };
}
const req = (path, { token, method = 'GET', body } = {}) => new Request('https://do' + path, {
  method,
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const jsonOf = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
async function fileTicket(doInst, token, over = {}) {
  const r = await doInst.fetch(req('/support/ticket', { token, method: 'POST', body: { type: 'problem', subject: 'Printer', message: 'out of paper', appVersion: 'v5.71', ...over } }));
  return { r, j: await jsonOf(r) };
}

// ── auth ──────────────────────────────────────────────────────
test('every /support route is 401 without a valid session', async () => {
  const { doInst } = await seedDO();
  const cases = [['/support/tickets', 'GET'], ['/support/ticket', 'POST'], ['/support/ticket/x/reply', 'POST']];
  for (const [p, method] of cases) {
    const r = await doInst.fetch(req(p, method === 'GET' ? {} : { method, body: {} }));
    assert.equal(r.status, 401, p + ' must be 401 unauthenticated');
  }
  const bad = await doInst.fetch(req('/support/tickets', { token: 'NOPE' }));
  assert.equal(bad.status, 401, 'an unknown token is 401');
});

// ── create + list ─────────────────────────────────────────────
test('filing stamps the submitter server-side and stores under ticket:<id>', async () => {
  const { doInst, s } = await seedDO();
  const { r, j } = await fileTicket(doInst, 'DESK');
  assert.equal(r.status, 200);
  assert.ok(j.ticket && j.ticket.id.startsWith('tk-'));
  assert.equal(j.ticket.submittedBy, 'Mia');          // from the session, not the body
  assert.equal(j.ticket.submitterRole, 'frontdesk');
  assert.equal(j.ticket.unreadForDev, true);
  assert.equal(j.ticket.submitterPushId, undefined);   // sanitized out of the client view
  const stored = await s.get('ticket:' + j.ticket.id);
  assert.ok(stored && stored.submitterPushId === 'fd:desk', 'the stored ticket keeps the internal push id');
});

test('create rejects a bad type (400) and a client cannot forge the submitter', async () => {
  const { doInst } = await seedDO();
  const bad = await doInst.fetch(req('/support/ticket', { token: 'DESK', method: 'POST', body: { type: 'spam', subject: 's', message: 'm' } }));
  assert.equal(bad.status, 400);
  const { j } = await fileTicket(doInst, 'DESK', { submittedBy: 'HACKER', submitterRole: 'admin' });
  assert.equal(j.ticket.submittedBy, 'Mia');          // body fields ignored
  assert.equal(j.ticket.submitterRole, 'frontdesk');
});

test('list returns tickets newest-first, sanitized; only the admin gets an unread count', async () => {
  const { doInst } = await seedDO();
  await fileTicket(doInst, 'DESK', { subject: 'A' });
  await fileTicket(doInst, 'DESK', { subject: 'B' });
  const admin = await jsonOf(await doInst.fetch(req('/support/tickets', { token: 'MGR' })));
  assert.equal(admin.tickets.length, 2);
  assert.equal(admin.tickets[0].submitterPushId, undefined);
  assert.equal(admin.unread, 2, 'admin sees the new-ticket (unreadForDev) count');
  const staff = await jsonOf(await doInst.fetch(req('/support/tickets', { token: 'DESK' })));
  assert.equal(staff.tickets.length, 2, 'staff see the shared list');
  assert.ok(!staff.unread, 'the dev-unread count is not leaked to a non-admin');
});

// ── admin-gating + live role re-resolve ───────────────────────
test('dev-reply and status are 403 for a non-admin', async () => {
  const { doInst } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  assert.equal((await doInst.fetch(req('/support/ticket/' + id + '/dev-reply', { token: 'DESK', method: 'POST', body: { message: 'hi' } }))).status, 403);
  assert.equal((await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'DESK', method: 'POST', body: { status: 'resolved' } }))).status, 403);
});

test('a demoted manager loses admin powers immediately (role re-resolved from fd_users, not the stale session)', async () => {
  const { doInst, s } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  // The MGR session still says role:'manager', but demote the live user to frontdesk:
  await s.put('config:fd_users', [{ id: 'mgr', name: 'Rosa', role: 'frontdesk', pin: '1111' }, { id: 'desk', name: 'Mia', role: 'frontdesk', pin: '2222' }]);
  const r = await doInst.fetch(req('/support/ticket/' + id + '/dev-reply', { token: 'MGR', method: 'POST', body: { message: 'nope' } }));
  assert.equal(r.status, 403, 'the stale admin token must NOT pass once the live role is frontdesk');
});

// ── two-way thread + read-clamp ───────────────────────────────
test('admin dev-reply flips status to replied and pings the salon side; admin open clears dev-unread', async () => {
  const { doInst } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  const rep = await jsonOf(await doInst.fetch(req('/support/ticket/' + id + '/dev-reply', { token: 'MGR', method: 'POST', body: { message: 'on it' } })));
  assert.equal(rep.ticket.status, 'replied');
  assert.equal(rep.ticket.unreadForSalon, true);
  assert.equal(rep.ticket.unreadForDev, false, 'replying marks the dev side read');
  assert.equal(rep.ticket.messages[1].from, 'dev');
});

test('read-clamp: a non-admin can only clear the salon side, never the dev side', async () => {
  const { doInst, s } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  // staff reads their reply: asking for who:'dev' must be clamped to 'salon'
  await doInst.fetch(req('/support/ticket/' + id + '/read', { token: 'DESK', method: 'POST', body: { who: 'dev' } }));
  const t = await s.get('ticket:' + id);
  assert.equal(t.unreadForDev, true, 'a non-admin must not be able to clear the dev-unread flag');
});

test('status change is validated and admin-gated; archived is visible to the admin but hidden from staff', async () => {
  const { doInst } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  assert.equal((await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'MGR', method: 'POST', body: { status: 'bogus' } }))).status, 400);
  const ok = await jsonOf(await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'MGR', method: 'POST', body: { status: 'resolved' } })));
  assert.equal(ok.ticket.status, 'resolved');
  await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'MGR', method: 'POST', body: { status: 'archived' } }));
  const adminList = await jsonOf(await doInst.fetch(req('/support/tickets', { token: 'MGR' })));
  assert.ok(adminList.tickets.find(x => x.id === id), 'the admin can still see an archived ticket (to unarchive it)');
  assert.equal(adminList.unread, 0, 'an archived ticket never counts toward the admin unread');
  const staffList = await jsonOf(await doInst.fetch(req('/support/tickets', { token: 'DESK' })));
  assert.equal(staffList.tickets.find(x => x.id === id), undefined, 'staff never see an archived ticket');
});

test('a reply to an archived ticket is refused', async () => {
  const { doInst } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'MGR', method: 'POST', body: { status: 'archived' } }));
  const r = await doInst.fetch(req('/support/ticket/' + id + '/reply', { token: 'DESK', method: 'POST', body: { message: 'hi' } }));
  assert.equal(r.status, 400, 'no replies to an archived ticket');
});

test('archiving clears BOTH unread sides (an archived ticket is off every list, so unread for nobody)', async () => {
  const { doInst, s } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  await doInst.fetch(req('/support/ticket/' + id + '/dev-reply', { token: 'MGR', method: 'POST', body: { message: 'reply' } }));   // sets unreadForSalon=true
  await doInst.fetch(req('/support/ticket/' + id + '/status', { token: 'MGR', method: 'POST', body: { status: 'archived' } }));
  const t = await s.get('ticket:' + id);
  assert.equal(t.unreadForSalon, false, 'archiving must clear the salon-unread side too (no stuck badge)');
  assert.equal(t.unreadForDev, false);
});

test('an admin filing their own ticket does not self-notify (dev-unread pre-cleared)', async () => {
  const { doInst } = await seedDO();
  const { j } = await fileTicket(doInst, 'MGR');   // the admin files
  assert.equal(j.ticket.unreadForDev, false, 'the admin’s own ticket is not unread for the admin');
});

// ── data-safety: backup dump + restore carries + reset clears ─
test('isTicketDump recognises only a tickets dump', () => {
  assert.equal(isTicketDump('backups/tickets-2026.json'), true);
  assert.equal(isTicketDump('backups/state-2026.json'), false);
  assert.equal(isTicketDump('backups/waivers-2026.json'), false);
});

test('alarm() writes a backups/tickets-*.json dump containing the ticket', async () => {
  const { doInst, bucket } = await seedDO();
  await fileTicket(doInst, 'DESK');
  await doInst.alarm();
  const dumpKey = [...bucket._store.keys()].find(k => isTicketDump(k));
  assert.ok(dumpKey, 'a tickets dump must be written');
  const arr = JSON.parse(bucket._store.get(dumpKey));
  assert.equal(arr.length, 1);
  assert.equal(arr[0].submitterPushId, 'fd:desk', 'the dump keeps full ticket data');
});

test('restoreFromBackup CARRIES live tickets through the wipe (tickets are not in the snapshot)', async () => {
  const { doInst, s, bucket } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  const id = j.ticket.id;
  const snap = await doInst.buildSnapshot();
  assert.equal(JSON.stringify(snap).includes('ticket:'), false, 'tickets must NOT be in the broadcast snapshot');
  await bucket.put('backups/state-x.json', JSON.stringify(snap));
  await doInst.restoreFromBackup('backups/state-x.json');
  assert.ok(await s.get('ticket:' + id), 'the ticket must survive a restore');
});

test('restore-latest and the explicit guard skip a tickets dump (never restore from one)', async () => {
  const { doInst, bucket } = await seedDO();
  await fileTicket(doInst, 'DESK');
  const snap = await doInst.buildSnapshot();
  await bucket.put('backups/state-1.json', JSON.stringify(snap));
  await bucket.put('backups/tickets-2.json', JSON.stringify([{ id: 'tk-x' }]));   // newest, must be skipped
  const res = await doInst.restoreFromBackup(null);   // latest
  assert.equal(res.restored, true, 'latest-restore must pick the state snapshot, not the tickets dump');
  const guard = await doInst.restoreFromBackup('backups/tickets-2.json');
  assert.ok(guard.error, 'restoring FROM a tickets dump is refused');
});

test('factoryReset CLEARS tickets (operational, not legal like waivers)', async () => {
  const { doInst, s } = await seedDO();
  const { j } = await fileTicket(doInst, 'DESK');
  await doInst.factoryReset();
  assert.equal(await s.get('ticket:' + j.ticket.id), undefined, 'a factory reset wipes tickets');
});

test('pruneBackups keeps a tickets dump out of the state keep-set (cannot evict a state snapshot)', async () => {
  const { doInst, bucket } = await seedDO();
  // One state snapshot + one tickets dump; retention LIVE. The state snapshot must never be pruned
  // in favour of the ticket dump.
  doInst.env.BACKUP_RETENTION = 'on';
  await bucket.put('backups/state-1.json', JSON.stringify({ state: {}, seq: 1 }));
  await bucket.put('backups/tickets-1.json', JSON.stringify([{ id: 'tk-x' }]));
  await doInst.pruneBackups();
  assert.ok(bucket._store.has('backups/state-1.json'), 'the state snapshot must survive');
  assert.ok(bucket._store.has('backups/tickets-1.json'), 'the single tickets dump (newest 30) survives');
});
