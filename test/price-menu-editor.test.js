// Phase 2a-core: the pure editor mutators that transform a draft price-menu by node id, plus the
// normalize id-stamping of pages + foot lines (so EVERYTHING is addressable by id) and the dirty check.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePriceMenu, DEFAULT_PRICE_MENU, priceMenuToHtml } from '../js/app/features/guide.js';
import {
  pmFind, pmSetField, pmAddItem, pmRemoveItem, pmMoveItem, pmRelocateItem,
  pmAddSub, pmRemoveSub, pmSetSubField, pmAddFoot, pmRemoveFoot, pmSetFoot, pmIsDirty,
} from '../js/app/features/pricemenu-editor.js';

const draft = () => normalizePriceMenu(null);   // the default, id-stamped
const col = (d, pi, ci) => d.pages[pi].cols[ci];

// ── normalize now stamps page + foot ids ──
test('normalize stamps a stable id on every page and foot line', () => {
  const d = draft();
  assert.ok(d.pages[0].id, 'page has id');
  assert.ok(d.pages[0].foot.every(f => f.id), 'every foot line has id');
});

// ── pmFind ──
test('pmFind locates items, variants/addons, foots, and pages; null on miss', () => {
  const d = draft();
  const row = col(d, 0, 0).find(i => i.t === 'row');
  const f = pmFind(d, row.id);
  assert.equal(f.node, row);
  assert.ok(Array.isArray(f.arr) && f.arr[f.idx] === row);
  assert.equal(pmFind(d, 'nope'), null);
});

// ── pmSetField (optional key deleted when emptied → no false dirty) ──
test('pmSetField sets a field and deletes an emptied optional desc', () => {
  const d = draft();
  const row = col(d, 0, 0).find(i => i.t === 'row');
  pmSetField(d, row.id, 'pr', '$99');
  assert.equal(row.pr, '$99');
  pmSetField(d, row.id, 'desc', 'x'); assert.equal(row.desc, 'x');
  pmSetField(d, row.id, 'desc', ''); assert.ok(!('desc' in row), 'emptied optional key removed');
});

// ── add / remove ──
test('pmAddItem inserts after an id (or appends) with a fresh id', () => {
  const d = draft();
  const c = col(d, 0, 0); const before = c.length; const anchor = c[0];
  const n = pmAddItem(d, _colId(d, 0, 0), 'row', anchor.id);
  assert.ok(n && n.id && n.t === 'row');
  assert.equal(col(d, 0, 0).length, before + 1);
  assert.equal(col(d, 0, 0)[1], n, 'inserted right after the anchor');
});
test('pmRemoveItem removes an item by id', () => {
  const d = draft();
  const c = col(d, 0, 0); const victim = c[1]; const n = c.length;
  assert.equal(pmRemoveItem(d, victim.id), true);
  assert.equal(col(d, 0, 0).length, n - 1);
  assert.ok(!col(d, 0, 0).includes(victim));
});

// ── reorder clamps at the ends ──
test('pmMoveItem swaps neighbors and is a no-op at the ends (no -1 corruption)', () => {
  const d = draft(); const c = col(d, 0, 0);
  const first = c[0], second = c[1];
  assert.equal(pmMoveItem(d, first.id, 'up'), false, 'up at top = no-op');
  assert.equal(pmMoveItem(d, c[c.length - 1].id, 'down'), false, 'down at bottom = no-op');
  assert.equal(pmMoveItem(d, first.id, 'down'), true);
  assert.equal(col(d, 0, 0)[0], second);
  assert.equal(col(d, 0, 0)[1], first);
  assert.ok(!('-1' in col(d, 0, 0)));
});

// ── relocate: a section takes its contiguous rows; a row moves alone ──
test('pmRelocateItem moves a SECTION with its contiguous rows to another column', () => {
  const d = draft();
  const src = col(d, 0, 0);
  const sec = src.find(i => i.t === 'sec');               // first section
  const secIdx = src.indexOf(sec);
  let n = 1; while (src[secIdx + n] && src[secIdx + n].t === 'row') n++;   // the section + its rows
  const groupIds = src.slice(secIdx, secIdx + n).map(i => i.id);
  const srcLen = src.length, dstLen = col(d, 0, 1).length;
  assert.equal(pmRelocateItem(d, sec.id, _colId(d, 0, 1)), true);
  assert.equal(col(d, 0, 0).length, srcLen - n, 'group left the source');
  const dst = col(d, 0, 1);
  assert.deepEqual(dst.slice(dst.length - n).map(i => i.id), groupIds, 'group appended in order to the target');
});
test('pmRelocateItem moves a ROW alone', () => {
  const d = draft();
  const row = col(d, 0, 0).find(i => i.t === 'row');
  assert.equal(pmRelocateItem(d, row.id, _colId(d, 1, 0)), true);
  assert.ok(!col(d, 0, 0).includes(row));
  assert.ok(col(d, 1, 0).includes(row));
});

// ── variants / add-ons ──
test('pmAddSub/pmRemoveSub/pmSetSubField manage a row’s variants + add-ons by id', () => {
  const d = draft();
  const row = col(d, 0, 0).find(i => i.t === 'row');
  const v = pmAddSub(d, row.id, 'variants'); assert.ok(v.id && row.variants.includes(v));
  pmSetSubField(d, v.id, 'nm', 'Full set'); assert.equal(v.nm, 'Full set');
  const a = pmAddSub(d, row.id, 'addons'); assert.ok(a.id && row.addons.includes(a));
  assert.equal(pmRemoveSub(d, v.id), true);
  assert.ok(!(row.variants || []).includes(v));
});

// ── footers ──
test('pmAddFoot/pmRemoveFoot/pmSetFoot edit a page’s footer lines by id', () => {
  const d = draft();
  const pageId = d.pages[0].id, n = d.pages[0].foot.length;
  const f = pmAddFoot(d, pageId); assert.equal(d.pages[0].foot.length, n + 1);
  pmSetFoot(d, f.id, 'text', 'New line'); assert.equal(f.text, 'New line');
  pmSetFoot(d, f.id, 'cls', 'cash'); assert.equal(f.cls, 'cash');
  assert.equal(pmRemoveFoot(d, f.id), true); assert.equal(d.pages[0].foot.length, n);
});

// ── dirty + generic N columns ──
test('pmIsDirty compares against a baseline', () => {
  const d = draft(); const base = JSON.stringify(d);
  assert.equal(pmIsDirty(d, base), false);
  pmSetField(d, col(d, 0, 0).find(i => i.t === 'row').id, 'pr', '$1');
  assert.equal(pmIsDirty(d, base), true);
});
test('a 3-column page survives a mutate (no data dropped — generic over N cols)', () => {
  const d = normalizePriceMenu({ v: 1, pages: [{ title: 'T', cols: [[{ t: 'row', nm: 'A', pr: '$1' }], [{ t: 'row', nm: 'B', pr: '$2' }], [{ t: 'row', nm: 'C', pr: '$3' }]], foot: [] }] });
  assert.equal(d.pages[0].cols.length, 3);
  pmSetField(d, pmFind(d, d.pages[0].cols[2][0].id).node.id, 'pr', '$9');
  assert.equal(d.pages[0].cols.length, 3, 'third column preserved');
  assert.doesNotThrow(() => priceMenuToHtml(d, '<img>', s => s));
});

// helper: resolve a column's id (cols don't carry ids; the editor addresses a column by page id + index)
function _colId(d, pi, ci) { return d.pages[pi].id + ':' + ci; }

test('pmRemoveSection deletes a section WITH its contiguous services', async () => {
  const { pmRemoveSection } = await import('../js/app/features/pricemenu-editor.js');
  const d = draft();
  const src = col(d, 0, 0);
  const sec = src.find(i => i.t === 'sec');
  const secIdx = src.indexOf(sec);
  let n = 1; while (src[secIdx + n] && src[secIdx + n].t === 'row') n++;
  const before = src.length;
  assert.equal(pmRemoveSection(d, sec.id), n, 'returns count removed');
  assert.equal(col(d, 0, 0).length, before - n);
  assert.ok(!col(d, 0, 0).includes(sec));
  assert.equal(pmRemoveSection(d, col(d, 0, 0).find(i => i.t === 'row').id), 0, 'returns 0 on a non-section');
});
