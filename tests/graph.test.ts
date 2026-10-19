import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { buildModel, cardOf, cardOfRow, fit, fitCols, G, inlineCols, locate, rowOf, valueText } from '../lib/graph/model';
import { anchorY, cardAt, cardsIn, layoutGraph, portY, rowAt, type GraphLayout } from '../lib/graph/layout';

const CW = 7.2;
const model = (s: string) => {
  const r = parse(s);
  return buildModel(r.root!, CW, r.nodes);
};

/** No two shown cards in a column overlap, and columns don't overlap. */
function assertNoOverlap(L: GraphLayout) {
  for (let d = 0; d < L.levels.length; d++) {
    const list = L.levels[d];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      assert.ok(L.y[b] >= L.y[a] + L.m.h[a] + G.sibGap - 1e-6, `column ${d}: card ${b} overlaps ${a}`);
    }
    if (d) assert.ok(L.colX[d] >= L.colX[d - 1] + L.colW[d - 1] + G.colGap - 1e-6);
  }
}

test('graph model: cards, rows, ports and buses', () => {
  const m = model('{"name":"Ada","age":36,"tags":["json","tools",{"x":1}],"profile":{"city":"London"},"empty":{},"list":[{"a":1},{"a":2}]}');
  // root, tags, tags[2], profile, list, list[0], list[1]
  assert.equal(m.n, 7);
  assert.deepEqual(Array.from(m.depth), [0, 1, 2, 1, 1, 2, 2]);
  assert.deepEqual(Array.from(m.parent), [-1, 0, 1, 0, 0, 4, 4]);
  assert.deepEqual(Array.from(m.end), [7, 3, 3, 4, 7, 6, 7]);
  // The root lists every entry (6 rows); tags, profile and list are port rows.
  assert.equal(m.rowStart[1] - m.rowStart[0], 6);
  assert.equal(m.rowChild[2], 1);
  assert.equal(m.rowChild[3], 3);
  assert.equal(m.rowChild[4], -1); // empty object: shown inline
  assert.equal(m.rowChild[5], 4);
  assert.equal(m.portRow[1], 2);
  // A mixed array lists its primitives and a port row for the object.
  assert.equal(m.rowStart[2] - m.rowStart[1], 3);
  // An array of objects uses a bus and lists no rows.
  assert.equal(m.bus[4], 1);
  assert.equal(m.rowStart[5] - m.rowStart[4], 0);
  assert.equal(m.portRow[5], -1);
  assert.equal(m.h[4], G.head);
  assert.deepEqual(Array.from(m.kidList.subarray(m.kidStart[0], m.kidStart[1])), [1, 3, 4]);
});

test('graph model: small arrays of primitives are shown inline', () => {
  const r = parse('{"geo":[51.5362,-0.1031],"tags":["a","b"],"long":["' + 'x'.repeat(40) + '"],"many":[1,2,3,4,5,6,7,8,9],"mixed":[1,{"a":1}],"none":[]}');
  const m = buildModel(r.root!, CW);
  const list = r.root!.v as JNode[];
  // root, long, many, mixed, mixed[1]
  assert.equal(m.n, 5);
  assert.equal(valueText(list[0]), '[51.5362, -0.1031]');
  assert.equal(valueText(list[1]), '["a", "b"]');
  assert.equal(inlineCols(list[1]), 10);
  assert.equal(valueText(list[2]), '[1]');
  assert.equal(valueText(list[5]), '[]');
  assert.equal(m.rowChild[0], -1);
  assert.deepEqual(locate(m, (list[0].v as JNode[])[1]), { card: -1, row: 0 });
  assert.deepEqual(locate(m, list[2]), { card: 1, row: 2 });
  assert.deepEqual(locate(m, r.root!), { card: 0, row: -1 });
});

test('graph model: lookups', () => {
  const r = parse('{"a":[1,2,{"b":true}],"c":{"d":null}}');
  const m = buildModel(r.root!, CW);
  const a = (r.root!.v as JNode[])[0];
  const inner = (a.v as JNode[])[2];
  assert.equal(cardOf(m, r.root!), 0);
  assert.equal(cardOf(m, a), 1);
  assert.equal(cardOf(m, inner), 2);
  assert.equal(cardOf(m, (a.v as JNode[])[0]), -1);
  const row = rowOf(m, (a.v as JNode[])[1]);
  assert.equal(m.rowNode[row], (a.v as JNode[])[1]);
  assert.equal(cardOfRow(m, row), 1);
  assert.equal(m.rowNode[rowOf(m, inner)], inner);
});

test('graph text: escapes, wide characters and truncation', () => {
  assert.equal(fit('a\nb"', 40, true), 'a\\nb\\"');
  assert.equal(fit('abcdef', 4, false), 'abc…');
  assert.equal(fitCols, 4);
  assert.equal(fit('日本語テキスト', 6, false), '日本…');
  assert.equal(fitCols, 5);
  assert.equal(fit('😀😀', 4, false), '😀😀');
  assert.equal(fit('🚀🚀🚀', 5, false), '🚀🚀…');
  assert.equal(fit('👍🏽 e\u0301', 40, false), '👍🏽 e\u0301');
  assert.equal(fitCols, 6);
  const n = parse('"' + 'x'.repeat(100) + '"').root!;
  assert.equal(valueText(n).length, G.valMax);
});

test('graph layout: first edge level, no overlaps, edges never climb', () => {
  const m = model('{"name":"Ada","age":36,"tags":["json","tools"],"profile":{"city":"London","geo":{"lat":1,"lng":2}},"list":[{"a":1},{"a":2,"b":[1,2,3]}]}');
  const L = layoutGraph(m);
  assertNoOverlap(L);
  for (let c = 1; c < m.n; c++) {
    assert.ok(anchorY(L, c) >= portY(L, c) - 1e-6, `edge into ${c} climbs`);
    // First children are level with their port.
    if (m.kidList[m.kidStart[m.parent[c]]] === c) assert.ok(Math.abs(anchorY(L, c) - portY(L, c)) < 1e-6);
  }
  let minY = Infinity;
  for (let c = 0; c < m.n; c++) minY = Math.min(minY, L.y[c]);
  assert.equal(minY, 0);
  // Hit testing.
  const c = cardAt(L, L.x[2] + 5, L.y[2] + G.head + 3);
  assert.equal(c, 2);
  assert.equal(rowAt(L, 2, L.y[2] + G.head + 3), m.rowStart[2]);
  const [from, to] = cardsIn(L, 1, -Infinity, Infinity);
  assert.equal(to - from, L.levels[1].length);
});

test('graph layout: collapsing hides descendants', () => {
  const m = model('{"a":{"b":{"c":{"d":1}}},"e":[{"f":1},{"g":2}]}');
  const collapsed = new Uint8Array(m.n);
  collapsed[1] = 1;
  const L = layoutGraph(m, collapsed);
  assert.equal(L.shown[2], 0);
  assert.ok(Number.isNaN(L.y[2]));
  assert.equal(L.shownCount, m.n - 2);
  assertNoOverlap(L);
});

test('graph layout: deep, wide and big documents stay linear', () => {
  // 800 levels deep (the parser recurses; the graph does not).
  const deep = '['.repeat(800) + '1' + ']'.repeat(800);
  const md = model(deep);
  const Ld = layoutGraph(md);
  // The innermost [1] is shown inline.
  assert.equal(Ld.levels.length, 799);
  assertNoOverlap(Ld);
  // 200,000 records.
  const big = '[' + Array.from({ length: 200000 }, (_, i) => `{"id":${i},"name":"user ${i}","tags":["a","b"],"geo":{"x":${i},"y":2}}`).join(',') + ']';
  const t0 = performance.now();
  const r = parse(big);
  const t1 = performance.now();
  const mb = buildModel(r.root!, CW, r.nodes);
  const t2 = performance.now();
  const Lb = layoutGraph(mb);
  const t3 = performance.now();
  // Each record: its card and geo (tags are shown inline).
  assert.equal(mb.n, 1 + 200000 * 2);
  assertNoOverlap(Lb);
  console.log(`  200k records: parse ${(t1 - t0).toFixed(0)} ms, model ${(t2 - t1).toFixed(0)} ms, layout ${(t3 - t2).toFixed(0)} ms, ${mb.n} cards`);
});
