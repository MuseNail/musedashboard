// Assignable tasks (Wave 2 #5): pure helpers for task visibility, the assignee label (with an
// orphan-safe name snapshot), and the technician badge count (assigned-only — "Anyone" tasks never
// inflate it). The field-merge task.patch op (Option B) is tested in worker-patch-guards.test.js.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskVisibleTo, assigneeLabel, taskBadgeCount } from '../js/app/utils.js';

const people = [{ pid: 'fd:1', name: 'Dana' }, { pid: 'tech:7', name: 'Jasmine' }];

// ── taskVisibleTo(task, myPid, isManager) — the FRONT-DESK rule: manager all; else own + Anyone ──
test('taskVisibleTo: a manager sees every task', () => {
  assert.equal(taskVisibleTo({ assignee: 'tech:7' }, 'fd:1', true), true);
});
test('taskVisibleTo: a non-manager sees an unassigned (Anyone) task', () => {
  assert.equal(taskVisibleTo({ assignee: '' }, 'fd:1', false), true);
  assert.equal(taskVisibleTo({}, 'fd:1', false), true);   // legacy task, no field
});
test('taskVisibleTo: a non-manager sees their own task', () => {
  assert.equal(taskVisibleTo({ assignee: 'fd:1' }, 'fd:1', false), true);
});
test('taskVisibleTo: a non-manager does NOT see someone else’s task', () => {
  assert.equal(taskVisibleTo({ assignee: 'tech:7' }, 'fd:1', false), false);
});

// ── assigneeLabel(task, people) — orphan-safe ──
test('assigneeLabel: unassigned reads Anyone', () => {
  assert.equal(assigneeLabel({ assignee: '' }, people), 'Anyone');
  assert.equal(assigneeLabel({}, people), 'Anyone');
});
test('assigneeLabel: a known pid reads the live name', () => {
  assert.equal(assigneeLabel({ assignee: 'tech:7' }, people), 'Jasmine');
});
test('assigneeLabel: an orphaned pid falls back to the stored name snapshot', () => {
  assert.equal(assigneeLabel({ assignee: 'tech:99', assigneeName: 'Removed Tech' }, people), 'Removed Tech');
});
test('assigneeLabel: an orphaned pid with no snapshot reads Unknown', () => {
  assert.equal(assigneeLabel({ assignee: 'tech:99' }, people), 'Unknown');
});

// ── taskBadgeCount(tasks, myTechPid) — DIRECTLY-assigned open tasks only ──
test('taskBadgeCount: counts only tasks assigned to this tech and not completed', () => {
  const tasks = [
    { assignee: 'tech:7', completed: false },
    { assignee: 'tech:7', completed: true },   // done → not counted
    { assignee: '', completed: false },         // Anyone → NOT counted (never inflates the badge)
    { assignee: 'tech:8', completed: false },   // another tech → not counted
  ];
  assert.equal(taskBadgeCount(tasks, 'tech:7'), 1);
});
test('taskBadgeCount: empty/garbage input is 0', () => {
  assert.equal(taskBadgeCount(null, 'tech:7'), 0);
  assert.equal(taskBadgeCount([null, undefined], 'tech:7'), 0);
});
