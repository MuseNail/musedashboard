// Regression test for the "not enough memory to open this page" hotfix (v5.58).
//
// The pre-v5.57 chat mark-seen bug could dispatch thousands of config.set ops for the SAME key
// while the tab was frozen. Every dispatch appends to the offline outbox (muse_outbox in
// localStorage); with the main thread blocked, WS acks (which remove entries) never ran, so a
// giant outbox persisted. On the next load reapplyOutbox() applied every entry and replayOutbox()
// sent every entry — a flooded outbox froze / OOM'd the tab on boot, and kept doing so on every
// reload because the poison lives in localStorage. v5.57 stopped NEW floods; this heals the ones
// already on disk.
//
// config.set is last-writer-wins per key, so an earlier write to a key is superseded by a later
// one and is safe to drop. coalesceConfigSets keeps only the LAST config.set per key (order
// preserved) once the outbox is pathologically full of them — mirroring the existing
// customer.upsert coalesce.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceConfigSets } from '../js/app/sync.js';

const cfg = (key, val, id) => ({ type: 'mutate', op: 'config.set', payload: { key, value: val }, mutationId: id, device: 'devA' });
const other = (op, id) => ({ type: 'mutate', op, payload: {}, mutationId: id, device: 'devA' });

test('a normal small outbox is returned untouched (below the flood threshold)', () => {
  const arr = [cfg('a', 1, 'm1'), cfg('b', 2, 'm2'), other('queue.upsert', 'm3')];
  assert.deepEqual(coalesceConfigSets(arr), arr);
});

test('a flood of the SAME key collapses to the single latest write', () => {
  const arr = [];
  for (let i = 0; i < 5000; i++) arr.push(cfg('chat_seen_fd:7', { team: 1000 + i }, 'm' + i));
  const out = coalesceConfigSets(arr);
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.value.team, 1000 + 4999);   // the LAST write survives
  assert.equal(out[0].mutationId, 'm4999');
});

test('non-config ops are preserved, in order, alongside the coalesced config writes', () => {
  const arr = [other('record.save', 'r1')];
  for (let i = 0; i < 100; i++) arr.push(cfg('chat_seen_fd:7', { team: i }, 'c' + i));
  arr.push(other('queue.upsert', 'q1'));
  arr.push(cfg('turns_order', ['x'], 'c-turns'));
  const out = coalesceConfigSets(arr);
  // record.save, one surviving chat_seen (last), queue.upsert, turns_order → 4, original order kept
  assert.deepEqual(out.map(m => m.mutationId), ['r1', 'c99', 'q1', 'c-turns']);
});

test('distinct keys are all kept — only superseded same-key writes are dropped', () => {
  const arr = [];
  for (let i = 0; i < 60; i++) arr.push(cfg('key_' + i, i, 'k' + i));   // 60 distinct keys, none superseded
  const out = coalesceConfigSets(arr);
  assert.equal(out.length, 60);
});

test('a malformed config.set with no key is never dropped', () => {
  const arr = [{ type: 'mutate', op: 'config.set', payload: {}, mutationId: 'bad', device: 'devA' }];
  for (let i = 0; i < 60; i++) arr.push(cfg('chat_seen_fd:7', { team: i }, 'c' + i));
  const out = coalesceConfigSets(arr);
  assert.ok(out.some(m => m.mutationId === 'bad'));
});
