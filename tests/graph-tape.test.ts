import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ARR, parse, type JNode, type ParseOptions } from '../lib/json/parser';
import { lazyResult, madeCount, nodeAtIndex } from '../lib/json/lazy';
import { pathOf, type Seg } from '../lib/json/path';
import { tapeOf } from '../lib/json/tape-send';
import {
  buildModel,
  cardFinder,
  cardHeadText,
  cardKey,
  cardNode,
  cardOf,
  cardPath,
  cardSizeText,
  fitCols,
  headText,
  labelText,
  locate,
  locateIndex,
  modelBuilder,
  rowColor,
  rowEntry,
  rowIsItem,
  rowKey,
  rowKind,
  rowLabelText,
  rowOf,
  rowValue,
  rowValueText,
  sizeText,
  swatch,
  valueText,
  type GraphModel,
} from '../lib/graph/model';
import { GraphView, tapeTextSearch, textSearch } from '../lib/graph/view';
import { layoutGraph } from '../lib/graph/layout';

const CW = 7.2;
const SLOW = !!process.env.TEST_SLOW;

/** The nodes of a tree in document order: a node's index here is its tape index. */
function preorder(root: JNode): JNode[] {
  const out: JNode[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    if (n.t >= ARR) for (let i = (n.v as JNode[]).length - 1; i >= 0; i--) stack.push((n.v as JNode[])[i]);
  }
  return out;
}

function sameArray(a: ArrayLike<number>, b: ArrayLike<number>, what: string) {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${what}[${i}]: ${a[i]} !== ${b[i]}`);
}

/** How many steps a build takes when every step stops at its first yield. */
function yields(root: JNode, hint: number): number {
  const step = modelBuilder(root, CW, hint);
  let k = 0;
  while (!step(-Infinity)) k++;
  return k;
}

const FIELDS = ['parent', 'depth', 'end', 'rowStart', 'rowChild', 'portRow', 'bus', 'kids', 'kidStart', 'kidList', 'w', 'h', 'labelW'] as const;

/**
 * The graph model of `text` built from its tape equals the one built from its nodes, field by field,
 * and building it, drawing its texts, looking nodes up and searching it make no node.
 */
function check(text: string, label: string, opts?: ParseOptions, queries: string[] = []) {
  const res = parse(text, opts);
  if (!res.root) return null;
  const m = buildModel(res.root, CW, res.nodes);
  const tape = tapeOf(res, text);
  const lazy = lazyResult(tape, text);
  const root = lazy.root!;
  const tm = buildModel(root, CW, lazy.nodes);
  assert.equal(madeCount(root), 1, `${label}: building made nodes`);
  const z = tm.tape!;
  assert.ok(z && z.root === root, `${label}: a tape model`);
  assert.equal(m.tape, null);
  for (const f of ['n', 'rows', 'maxDepth', 'charW'] as const) assert.equal(tm[f], m[f], `${label}: ${f}`);
  for (const f of FIELDS) sameArray(tm[f], m[f], `${label}: ${f}`);

  const pre = preorder(res.root);
  for (let c = 0; c < m.n; c++) if (pre[z.card[c]] !== m.node[c]) assert.fail(`${label}: card ${c} shows tape index ${z.card[c]}`);
  for (let r = 0; r < m.rows; r++) if (pre[z.row[r]] !== m.rowNode[r]) assert.fail(`${label}: row ${r} shows tape index ${z.row[r]}`);

  // Texts and widths, as drawn and exported.
  for (let r = 0; r < m.rows; r++) {
    const n = m.rowNode[r];
    const at = `${label}: row ${r}`;
    assert.equal(rowLabelText(tm, r), labelText(n), at);
    let want = fitCols;
    assert.equal(rowLabelText(tm, r, false), labelText(n, false), at);
    assert.equal(fitCols, want, `${at}: label cols`);
    assert.equal(rowValueText(tm, r), valueText(n), at);
    want = fitCols;
    rowValueText(tm, r, false);
    assert.equal(fitCols, want, `${at}: value cols`);
    valueText(n, false);
    assert.equal(fitCols, want, `${at}: value cols unbuilt`);
    assert.equal(rowColor(tm, r), swatch(n) ? n.v : null, at);
    assert.equal(rowKind(tm, r), n.t, at);
    assert.equal(rowIsItem(tm, r), typeof n.key === 'number', at);
    assert.equal(rowKey(tm, r), n.key, at);
    assert.equal(rowValue(tm, r), n.t >= ARR ? null : n.v, at);
    // The accessors read the node model the same way.
    assert.equal(rowValueText(m, r), valueText(n), at);
    assert.equal(rowColor(m, r), swatch(n) ? n.v : null, at);
  }
  for (let c = 0; c < m.n; c++) {
    const n = m.node[c];
    const at = `${label}: card ${c}`;
    assert.equal(cardHeadText(tm, c), headText(n), at);
    const want = fitCols;
    assert.equal(cardHeadText(tm, c, false), headText(n, false), at);
    assert.equal(fitCols, want, `${at}: head cols`);
    assert.equal(cardSizeText(tm, c), n.t >= ARR ? sizeText(n) : null, at);
    assert.equal(cardKey(tm, c), n.key, at);
    if (m.n < 20_000 || c % 97 === 0) assert.deepEqual(cardPath(tm, c), pathOf(n), at);
  }
  assert.equal(madeCount(root), 1, `${label}: texts made nodes`);

  // Lookups by tape index give what lookups by node give.
  for (let i = 0; i < pre.length; i++) {
    const want = locate(m, pre[i]);
    const got = locateIndex(tm, i);
    if (got.card !== want.card || got.row !== want.row) assert.fail(`${label}: node ${i} at ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  }
  assert.equal(madeCount(root), 1, `${label}: lookups made nodes`);

  // Paths (collapsed cards kept across an edit) find the same cards on the tape, making no node.
  const onTape = cardFinder(tm, root);
  const onNodes = cardFinder(m, res.root);
  const every = Math.max(1, Math.floor(m.n / 3000));
  for (let c = 0; c < m.n; c += every) {
    const path = pathOf(m.node[c]);
    // (Duplicate keys: a path names the first member of that name, as `resolve` does.)
    assert.equal(onTape(path), onNodes(path), `${label}: path of card ${c}`);
    const bogus: Seg[][] = [[...path, 'zz'], [...path, 0], [...path, 70], [...path, '1'], [...path, -1], [...path, 1.5], path.slice(0, -1).concat(typeof path.at(-1) === 'number' ? String(path.at(-1)) : 0)];
    for (const segs of bogus) assert.equal(onTape(segs), onNodes(segs), `${label}: ${JSON.stringify(segs).slice(0, 80)}`);
  }
  assert.equal(madeCount(root), 1, `${label}: paths made nodes`);

  // Find: the same hits, in order, whether in one go or in steps.
  const index = queries.length ? new Map(pre.map((n, i) => [n, i])) : null;
  for (const q of queries) {
    const want = textSearch(res.root, q, 1000);
    want.step(Infinity);
    const wantAt = want.hits.map((n) => index!.get(n)!);
    const whole = tapeTextSearch(z.doc.t, text, 0, q, 1000);
    assert.equal(whole.step(Infinity), true);
    assert.deepEqual(whole.hits, wantAt, `${label}: find ${q}`);
    const sliced = tapeTextSearch(z.doc.t, text, 0, q, 1000);
    while (!sliced.step(-Infinity));
    assert.deepEqual(sliced.hits, wantAt, `${label}: find ${q} in steps`);
  }
  assert.equal(madeCount(root), 1, `${label}: find made nodes`);

  // The same yields.
  assert.equal(yields(lazyResult(tape, text).root!, lazy.nodes), yields(res.root, res.nodes), `${label}: yields`);

  return { m, tm, res, pre, root };
}

const at = (l: { card: number; row: number }) => `${l.card}/${l.row}`;

/** Resolving: the nodes made on demand are those of the tree, the same objects every time, where lookups find them. */
function checkResolve(m: GraphModel, tm: GraphModel, pre: JNode[], root: JNode, label: string, every = 1) {
  const z = tm.tape!;
  for (let c = 0; c < m.n; c += every) {
    const n = cardNode(tm, c);
    assert.equal(n, nodeAtIndex(root, z.card[c]), `${label}: card ${c} is made once`);
    const o = m.node[c];
    assert.ok(n.s === o.s && n.e === o.e && n.key === o.key && n.t === o.t && n.d === o.d, `${label}: card ${c}`);
    assert.equal(cardOf(tm, n), c);
    assert.equal(at(locate(tm, n)), at(locate(m, o)));
  }
  for (let r = 0; r < m.rows; r += every) {
    const n = rowEntry(tm, r);
    assert.equal(n, rowEntry(tm, r), `${label}: row ${r} is made once`);
    const o = m.rowNode[r];
    assert.ok(n.s === o.s && n.e === o.e && n.key === o.key && n.t === o.t && n.v === (o.t >= ARR ? n.v : o.v), `${label}: row ${r}`);
    assert.equal(rowOf(tm, n), rowOf(m, o));
  }
  for (let i = 0; i < pre.length; i += every) {
    const n = nodeAtIndex(root, i)!;
    assert.equal(at(locate(tm, n)), at(locate(m, pre[i])), `${label}: node ${i}`);
    // A node of another parse is in neither.
    assert.equal(at(locate(tm, pre[i])), '-1/-1');
  }
}

// ── Documents ────────────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: <T>(a: readonly T[]) => a[int(a.length)] };
}
type Rng = ReturnType<typeof rng>;

const STRS = ['', 'a', 'Ada', 'hello world', 'x'.repeat(37), 'y'.repeat(38), 'z'.repeat(39), 'w'.repeat(80), 'line\nbreak', 'tab\there', 'quote "q"', 'back\\slash', '\u0001ctl', '中文字符', '中'.repeat(19), '😀 emoji', '😀'.repeat(20), 'e\u0301', 'zero\u200bwidth', '\u2028sep', '#fff', '#ABCDEF', '#ggg', 'rgb(1, 2, 3)', 'hsla(1, 2%, 3%, 0.5)', 'RGB(0,0,0)', 'rgba(1,2,3,.5)', 'HSL(1, 2%, 3%)', 'rgx(1)', 'hsx', 'rg', 'h', 'r', 'red', 'http://x.y/z', '2024-01-02T03:04:05Z', '1700000000', '\ud800lone', 'Été'];
const KEYS = ['a', 'b', 'id', 'name', 'k'.repeat(23), 'k'.repeat(24), 'k'.repeat(25), 'h'.repeat(33), 'key with space', 'new\nline', '中文键', '😀', '', '0', 'é'];
const NUMS = ['0', '-0', '1', '-12', '3.14', '1e5', '1E-7', '12345678901234567890', '1'.repeat(41), '0.1000'];

/** Values left to make in the document being made (then only primitives). */
let budget = 0;

function value(r: Rng, depth: number): string {
  const k = r.int(depth > 5 || --budget < 0 ? 4 : 12);
  if (k === 0) return JSON.stringify(r.pick(STRS));
  if (k === 1) return r.pick(NUMS);
  if (k === 2) return r.pick(['true', 'false', 'null']);
  if (k === 3) return JSON.stringify(r.pick(STRS) + r.pick(STRS));
  if (k === 4) {
    // A small array of primitives: shown inline when it fits.
    const n = r.int(10);
    return '[' + Array.from({ length: n }, () => (r.int(3) ? r.pick(NUMS) : JSON.stringify(r.pick(STRS).slice(0, 12)))).join(',') + ']';
  }
  if (k < 8) {
    const wide = r.int(12) === 0;
    const n = wide ? 30 + r.int(100) : r.int(6);
    const kind = r.int(3);
    return '[' + Array.from({ length: n }, () => (kind === 0 ? object(r, depth + 1, 1 + r.int(3)) : value(r, depth + 1))).join(',') + ']';
  }
  const wide = r.int(10) === 0;
  return object(r, depth + 1, wide ? 30 + r.int(80) : r.int(7));
}

function object(r: Rng, depth: number, n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const key = r.int(4) ? r.pick(KEYS) : r.pick(KEYS) + i;
    parts.push(JSON.stringify(key) + ':' + (r.int(3) ? value(r, depth) : depth > 5 || budget < 0 ? '1' : object(r, depth + 1, 1 + r.int(4))));
  }
  return '{' + parts.join(',') + '}';
}

const HAND = [
  '1',
  '"a"',
  '"#fff"',
  'true',
  'null',
  '[]',
  '{}',
  '[1,2,3]',
  '[[1]]',
  '[{}]',
  '{"a":[]}',
  '{"a":{"b":{"c":1}},"other":{"x":2}}',
  '{"a":1,"a":2}',
  '{"a":{"a":1},"a":2}',
  '[[1,2],[3,4],["a","b"]]',
  '{"coords":[51.5362,-0.1031],"tags":["a","b"],"one":[1],"long":[123456789012,123456789012,123456789012,1],"many":[1,2,3,4,5,6,7,8,9],"empty":[]}',
  '"\\u0041\\n\\ud800"',
  '{"s":"esc\\u00e9\\n\\"q\\"","c":"#a\\u0062c"}',
  '[1e5, -0, 0.5, 1.50, 0.0000001, 12345678901234567]',
  '[01, +1, .5, 1., 0x1F, -0x1f]',
  "{a: 1, 'b': 'c', `d`: `e`, “f”: ‘g’}",
  '[hello world, http://x.y/z, #fff, rgb(1,2,3), rg, h]',
  '[NaN, Infinity, -Infinity, undefined, None, True]',
  '1\n2\n3',
  '{"a":1}\n{"b":2}',
  '{"a":[1,2]}\n[{"b":2}]\n"x"',
  'cb({"a":[1,2]})',
  '{"a": ObjectId("x"), "b": [f(1), g({"c": 2})]}',
  '// c\n{"a":1 /* c */}',
  '{"a":1',
  '[1, 2',
  JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 40 }, (_, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [i, -i] }, properties: { name: `n${i}` } })) }),
  JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, { v: i }]))),
  JSON.stringify(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, [i, { v: i }]]))),
  JSON.stringify(Array.from({ length: 200 }, (_, i) => (i % 3 ? { i } : [i, [i]]))),
  '{"a":'.repeat(300) + '0' + '}'.repeat(300),
  '['.repeat(300) + ']'.repeat(300),
];

const QUERIES = ['a', 'A', 'name', 'Name', 'nul', 'null', 'tru', 'false', 'e', 'é', 'É', '1', '中', '😀', '\n', '#f', 'zz', 'k'];

test('graph on a tape: hand-written documents give the same model, making no node', () => {
  for (const [i, text] of HAND.entries()) {
    for (const opts of [undefined, { lines: true }]) {
      const out = check(text, `hand ${i}`, opts, QUERIES);
      if (out) checkResolve(out.m, out.tm, out.pre, out.root, `hand ${i}`);
    }
  }
});

test('graph on a tape: random documents give the same model, making no node', () => {
  const r = rng(7);
  const count = SLOW ? 3000 : 200;
  for (let i = 0; i < count; i++) {
    budget = r.int(10) ? 300 : 3000;
    const text = r.int(8) ? value(r, 0) : object(r, 0, 40 + r.int(60));
    const out = check(text, `random ${i}`, undefined, i % 10 === 0 ? QUERIES : []);
    if (out && i % 4 === 0) checkResolve(out.m, out.tm, out.pre, out.root, `random ${i}`);
  }
});

test('graph on a tape: a whole document resolves to the tree, node for node', () => {
  const r = rng(11);
  for (let i = 0; i < (SLOW ? 50 : 8); i++) {
    budget = 2000;
    const text = object(r, 0, 60);
    const out = check(text, `resolve ${i}`)!;
    checkResolve(out.m, out.tm, out.pre, out.root, `resolve ${i}`);
    // Every node made once: the tree's own count.
    for (let k = 0; k < out.pre.length; k++) nodeAtIndex(out.root, k);
    assert.equal(madeCount(out.root), out.pre.length);
  }
});

// ── Corpora on this host (skipped where missing) ─────────────────────────

const CORPORA = [join(homedir(), '.cache/selftest/pbench-data/simd'), join(homedir(), '.cache/tool-kumar-harness/fixtures/v1')];

function corpus(max: number): string[] {
  const out: string[] = [];
  for (const dir of CORPORA) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (/\.jsonl?$/.test(name) && statSync(p).size <= max) out.push(p);
    }
  }
  return out;
}

test('graph on a tape: corpus documents give the same model, making no node', () => {
  const files = corpus(SLOW ? 20e6 : 800e3);
  for (const p of files) {
    const text = readFileSync(p, 'utf8');
    const out = check(text, p, { lines: p.endsWith('.jsonl') }, ['a', 'name', 'zz', '1']);
    if (out) checkResolve(out.m, out.tm, out.pre, out.root, p, Math.max(1, Math.floor(out.pre.length / 5000)));
  }
});

// ── The view on a tape ───────────────────────────────────────────────────

/** A GraphView with only what find, selection and rebuilds need (Node has no DOM). */
function viewOf(root: JNode, m: GraphModel, selected: JNode[]) {
  const obj = Object.create(GraphView.prototype) as GraphView & Record<string, unknown>;
  const L = layoutGraph(m);
  Object.assign(obj, {
    root,
    m,
    L,
    card: -1,
    row: -1,
    q: '',
    findSeq: 0,
    matches: [],
    mi: -1,
    hitFor: null,
    hitRow: null,
    hitCard: null,
    building: false,
    dirty: false,
    pending: null,
    keep: [],
    keepFor: null,
    reset: false,
    token: 0,
    editTimer: 0,
    redraw: () => {},
    announce: () => {},
    reveal: () => {},
    ev: { select: (n: JNode) => selected.push(n) },
  });
  return obj;
}

test('graph view on a tape: find, matches, selection and kept collapsed cards, making only what is gone to', () => {
  const doc = (k: number) => JSON.stringify({ users: Array.from({ length: 3000 }, (_, i) => ({ id: i, name: i % 7 ? 'plain' : 'Special', tags: ['a', 'b'], more: { deep: { x: i + k } } })), meta: { n: 3000 } });
  const text = doc(0);
  const res = parse(text);
  const tape = tapeOf(res, text);
  const root = lazyResult(tape, text).root!;
  const tm = buildModel(root, CW);
  const m = buildModel(res.root!, CW);
  const selected: JNode[] = [];
  const v = viewOf(root, tm, selected);
  const ref = viewOf(res.root!, m, []);
  // Their private state.
  const v_ = v as unknown as Record<string, unknown>;
  const ref_ = ref as unknown as Record<string, unknown>;

  // Find: the same count and hits, nothing made.
  for (const q of ['special', 'Plain', 'deep', 'x', '42', 'zzz']) {
    const got = v.search(q, false);
    const want = ref.search(q, false);
    assert.deepEqual(got, want, q);
    (v as unknown as { ensureHits(): void }).ensureHits();
    (ref as unknown as { ensureHits(): void }).ensureHits();
    assert.deepEqual(v_.hitRow, ref_.hitRow, `${q}: rows hit`);
    assert.deepEqual(v_.hitCard, ref_.hitCard, `${q}: cards hit`);
  }
  assert.equal(madeCount(root), 1, 'find made nodes');

  // Going to a match makes that node (and its ancestors' children), selects it and tells the engine.
  v.search('special', false);
  ref.search('special', false);
  for (let k = 0; k < 3; k++) {
    assert.deepEqual(v.step(1), ref.step(1));
    const n = selected.at(-1)!;
    assert.equal(n, rowEntry(tm, v_.row as number), 'the node selected is the row shown');
    assert.equal(n.s, (ref_.matches as JNode[])[ref_.mi as number].s);
    assert.equal(v_.card, ref_.card);
    assert.equal(v_.row, ref_.row);
  }
  const made = madeCount(root);
  assert.ok(made < 3000 + 100, `${made} made`);

  // A node from elsewhere (another parse) is found by its path.
  const stale = ((res.root!.v as JNode[])[0].v as JNode[])[1500];
  v.select(stale);
  assert.equal(v_.card, cardOf(tm, nodeAtIndex(root, preorder(res.root!).indexOf(stale))!));
  assert.ok((v_.card as number) > 0);

  // Collapsed cards are kept across an edit by path, read off the tape and found on the next one.
  const collapsed = new Uint8Array(tm.n);
  // Every third record, and the `deep` card of others (a card under a collapsed one is kept as its root only).
  for (let c = 0, k = 0; c < tm.n; c++) if ((tm.depth[c] === 2 && k++ % 3 === 0) || (tm.depth[c] === 4 && c % 2 === 0)) collapsed[c] = 1;
  (v_.L as { collapsed: Uint8Array }).collapsed = collapsed;
  (ref_.L as { collapsed: Uint8Array }).collapsed = collapsed.slice();
  const text2 = doc(1);
  const res2 = parse(text2);
  const root2 = lazyResult(tapeOf(res2, text2), text2).root!;
  v.setRoot(root2, false, res2.nodes, false);
  ref.setRoot(res2.root!, false, res2.nodes, false);
  const kept = (o: GraphView) => (o as unknown as { keep: Seg[][] }).keep;
  assert.deepEqual(kept(v), kept(ref));
  assert.ok(kept(v).length > 1000, `${kept(v).length} kept`);
  const restored = (v as unknown as { restoreCollapsed(m: GraphModel): Uint8Array }).restoreCollapsed(buildModel(root2, CW));
  const want = (ref as unknown as { restoreCollapsed(m: GraphModel): Uint8Array }).restoreCollapsed(buildModel(res2.root!, CW));
  assert.deepEqual(restored, want);
  assert.equal(restored.reduce((a, b) => a + b, 0), kept(v).length);
  assert.equal(madeCount(root2), 1, 'restoring made nodes');
});

test('graph on a tape stays depth-safe at 100,000 levels', () => {
  // (The inline array at the bottom is the parser's 100,000th level.)
  const depth = 99_999;
  const text = '{"a":'.repeat(depth) + '[0, "#fff"]' + '}'.repeat(depth);
  const res = parse(text);
  const root = lazyResult(tapeOf(res, text), text).root!;
  const tm = buildModel(root, CW, res.nodes);
  const m = buildModel(res.root!, CW, res.nodes);
  for (const f of FIELDS) sameArray(tm[f], m[f], f);
  assert.equal(madeCount(root), 1);
  const last = tm.n - 1;
  assert.deepEqual(cardPath(tm, last), pathOf(m.node[last]));
  assert.equal(cardFinder(tm, root)(cardPath(tm, last)), last);
  const find = tapeTextSearch(tapeOfModel(tm), text, 0, 'a', 1_000_000);
  find.step(Infinity);
  assert.equal(find.hits.length, depth);
  // The deepest value, inside an inline array: its node is made with its ancestors, and found again.
  const leaf = res.nodes - 1;
  assert.deepEqual(locateIndex(tm, leaf), locate(m, (m.rowNode[m.rows - 1].v as JNode[])[1]));
  const n = nodeAtIndex(root, leaf)!;
  assert.equal(n.v, '#fff');
  assert.deepEqual(locate(tm, n), locateIndex(tm, leaf));
  assert.equal(rowEntry(tm, tm.rows - 1), n.u);
  assert.equal(rowValueText(tm, tm.rows - 1), '[0, "#fff"]');
});

const tapeOfModel = (m: GraphModel) => m.tape!.doc.t;
