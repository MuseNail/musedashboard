// Pure helpers behind the unified notification bell.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifItems, clockStateNeedsAttention } from '../js/app/notif-util.js';
import { tasksOverdueCount } from '../js/app/utils.js';

// ── buildNotifItems: role-gating + severity order + badge color ──────────────
const FULL = { failedWrites: 1, supportNew: 2, supportReply: 1, chat: 3, tasks: 4, clock: 1, update: 1 };

test('buildNotifItems: admin sees every source, danger-first order, summed total', () => {
  const r = buildNotifItems(FULL, { isAdmin: true, isManager: true });
  assert.deepEqual(r.items.map(i => i.id), ['failedWrites', 'supportNew', 'supportReply', 'chat', 'tasks', 'clock', 'update']);
  assert.equal(r.total, 1 + 2 + 1 + 3 + 4 + 1 + 1);
  assert.equal(r.hasDanger, true);
});

test('buildNotifItems: a plain staffer never sees failed-writes, new-tickets, or clock', () => {
  const r = buildNotifItems(FULL, { isAdmin: false, isManager: false });
  assert.deepEqual(r.items.map(i => i.id), ['supportReply', 'chat', 'tasks', 'update']);
  assert.equal(r.hasDanger, false, 'no danger item for a non-admin/manager');
  assert.equal(r.total, 1 + 3 + 4 + 1); // supportReply + chat + tasks + update
});

test('buildNotifItems: a manager sees failed-writes + new-tickets but NOT the admin-only clock', () => {
  const r = buildNotifItems(FULL, { isAdmin: false, isManager: true });
  assert.ok(r.items.some(i => i.id === 'failedWrites'));
  assert.ok(r.items.some(i => i.id === 'supportNew'));
  assert.ok(!r.items.some(i => i.id === 'clock'), 'clock is admin-only');
  assert.equal(r.hasDanger, true);
});

test('buildNotifItems: zero counts yield an empty, danger-free result', () => {
  const r = buildNotifItems({}, { isAdmin: true, isManager: true });
  assert.deepEqual(r.items, []);
  assert.equal(r.total, 0);
  assert.equal(r.hasDanger, false);
});

test('buildNotifItems: badge is non-danger when only non-failed items are present', () => {
  const r = buildNotifItems({ chat: 2, tasks: 1 }, { isAdmin: true, isManager: true });
  assert.equal(r.hasDanger, false);
  assert.equal(r.total, 3);
});

// ── clockStateNeedsAttention: only the actionable 'warn' state ───────────────
test('clockStateNeedsAttention: only warn is actionable (notice is a permanent, non-clearable state)', () => {
  assert.equal(clockStateNeedsAttention('warn'), true);
  assert.equal(clockStateNeedsAttention('notice'), false);
  assert.equal(clockStateNeedsAttention('clock'), false);
  assert.equal(clockStateNeedsAttention('hidden'), false);
  assert.equal(clockStateNeedsAttention(undefined), false);
});

// ── tasksOverdueCount: overdue + visible-to-me, not completed ────────────────
const NOW = new Date('2026-11-11T12:00:00').getTime();
const past = '2026-11-10', future = '2026-12-01';

test('tasksOverdueCount: counts past-due, uncompleted, visible tasks only', () => {
  const tasks = [
    { id: 'a', due: past,   completed: false, assignee: 'fd:me' },   // overdue, mine → count
    { id: 'b', due: past,   completed: true,  assignee: 'fd:me' },   // done → skip
    { id: 'c', due: future, completed: false, assignee: 'fd:me' },   // not due yet → skip
    { id: 'd', due: past,   completed: false, assignee: 'fd:other' },// not mine → skip (non-manager)
    { id: 'e', due: '',     completed: false, assignee: 'fd:me' },   // no due date → skip
  ];
  assert.equal(tasksOverdueCount(tasks, 'fd:me', false, NOW), 1);
});

test('tasksOverdueCount: a manager sees every overdue task; Anyone-tasks count for all', () => {
  const tasks = [
    { id: 'a', due: past, completed: false, assignee: 'fd:other' },
    { id: 'b', due: past, completed: false, assignee: '' },   // Anyone
  ];
  assert.equal(tasksOverdueCount(tasks, 'fd:me', true, NOW), 2, 'manager sees all');
  assert.equal(tasksOverdueCount(tasks, 'fd:me', false, NOW), 1, 'staffer sees own(0) + Anyone(1)');
});

test('tasksOverdueCount: empty / undefined list is zero', () => {
  assert.equal(tasksOverdueCount([], 'fd:me', false, NOW), 0);
  assert.equal(tasksOverdueCount(undefined, 'fd:me', true, NOW), 0);
});
