import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARR, BOOL, NUL, NUM, STR, kids, parse, type JNode } from '../lib/json/parser';
import { GraphView, textSearch } from '../lib/graph/view';
import type { FindResult } from '../lib/graph/types';

/** The graph's search as it was (one synchronous pass, every child pushed): the results to match. */
function oldSearch(root: JNode, q: string, max: number): JNode[] {
  const out: JNode[] = [];
  const cs = q !== q.toLowerCase();
  const qn = cs ? q : q.toLowerCase();
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  const stack: JNode[] = [root];
  while (stack.length && out.length < max) {
    const n = stack.pop() as JNode;
    let h = typeof n.key === 'string' && has(n.key);
    if (!h) {
      if (n.t === STR || n.t === NUM) h = has(n.v as string);
      else if (n.t === BOOL) h = has(n.v ? 'true' : 'false');
      else if (n.t === NUL) h = has('null');
    }
    if (h) out.push(n);
    if (n.t >= ARR) {
      const list = kids(n);
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
  }
  return out;
}

const DOCS = [
  { users: [{ name: 'Ada Lovelace', email: 'ADA@example.com', active: true, tags: ['Math', 'poetry'] }, { name: 'Grace', id: 7, boss: null, ok: false }] },
  [1, 2, 3, 12, 123.5, -1e10, 'one', 'ONE', 'Öl', 'öl', 'İstanbul', 'istanbul', 'ΣΊΣΥΦΟΣ', 'σίσυφος', 'ﬀ', 'Straße', 'STRASSE', '😀 smile', 'K', 'k'],
  { 'Key With Caps': { 'nested key': [{ deep: [[['TRUE', 'true', true, 'nullable', null]]] }], 'İ': 'i̇', ΣΑΣ: 'σας' } },
  Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `Item ${i}`, kind: i % 3 ? 'Widget' : 'gadget', price: i * 1.25, flags: [i % 2 === 0, null] })),
  [],
  {},
  'just a string',
  42,
];
const QUERIES = ['a', 'A', 'ada', 'ADA', 'item 2', 'Item 2', '1', '12', '.5', 'e10', 'true', 'TRUE', 'tru', 'false', 'null', 'nul', 'NULL', 'öl', 'Öl', 'i̇', 'istanbul',
  'İstanbul', 'σ', 'Σ', 'ς', 'σίσυφος', 'ss', 'straße', 'STRASSE', '😀', 'k', 'K', 'widget', 'Widget', 'nested', 'zzz', ' ', 'key with', 'deep'];

test('graph search finds what it did, in the same order, in one go or a step at a time', () => {
  for (const doc of DOCS) {
    const root = parse(JSON.stringify(doc)).root!;
    for (const q of QUERIES) {
      for (const max of [100_000, 3]) {
        const want = oldSearch(root, q, max);
        const whole = textSearch(root, q, max);
        assert.equal(whole.step(Infinity), true);
        assert.deepEqual(whole.hits, want, `${JSON.stringify(q)} in ${JSON.stringify(doc).slice(0, 40)}`);
        // A deadline already passed: a step every 1024 entries until done, the same hits.
        const sliced = textSearch(root, q, max);
        let steps = 1;
        while (!sliced.step(0)) steps++;
        assert.ok(sliced.hits.length === want.length && sliced.hits.every((n, i) => n === want[i]), q);
        if (max === 100_000 && root.t === ARR && kids(root).length === 3000) assert.ok(steps > 10, `${steps} steps`);
      }
    }
  }
});

test('graph search: a wide array is walked by index, deep nesting by a stack, within the step deadline', () => {
  const wide = parse(JSON.stringify(Array.from({ length: 300_000 }, (_, i) => (i % 1000 ? i : `needle ${i}`)))).root!;
  const s = textSearch(wide, 'needle', 100_000);
  let longest = 0;
  for (let done = false; !done; ) {
    const t0 = performance.now();
    done = s.step(t0 + 8);
    longest = Math.max(longest, performance.now() - t0);
  }
  assert.equal(s.hits.length, 300);
  // A step checks the clock every 1024 entries: it overruns its deadline by a few entries' worth, never by the array.
  assert.ok(longest < 40, `longest step ${longest.toFixed(1)} ms`);
  const depth = 100_000;
  const deep = parse('['.repeat(depth) + '"bottom"' + ']'.repeat(depth)).root!;
  const d = textSearch(deep, 'bottom', 10);
  assert.equal(d.step(Infinity), true);
  assert.equal(d.hits.length, 1);
  assert.equal(d.hits[0].d, depth);
  // Opening container after container still looks at the clock: a deadline already gone stops each step early.
  const e = textSearch(deep, 'bottom', 10);
  let steps = 1;
  while (!e.step(0)) steps++;
  assert.ok(steps >= depth / 1024, `${steps} steps`);
  assert.equal(e.hits[0], d.hits[0]);
});

/** soon()'s tasks (lib/engine/idle.ts posts them through a MessageChannel), run by hand. */
const tasks: (() => void)[] = [];
(globalThis as { MessageChannel?: unknown }).MessageChannel = class {
  port1: { onmessage: (() => void) | null } = { onmessage: null };
  port2 = { postMessage: () => void tasks.push(() => this.port1.onmessage?.()) };
};

/** A GraphView with only what search needs (Node has no DOM). */
function view(root: JNode, found?: (r: FindResult) => void) {
  const obj = Object.create(GraphView.prototype) as GraphView & Record<string, unknown>;
  Object.assign(obj, { root, m: null, card: -1, row: -1, q: '', findSeq: 0, matches: [], mi: -1, hitFor: null, redraw: () => {}, ev: { found, select: () => {} } });
  const drain = () => {
    while (tasks.length) tasks.shift()!();
  };
  return { obj, drain, tasks };
}

test('graph view: a long search answers with its count so far, then tells the engine its result', () => {
  const doc = Array.from({ length: 120_000 }, (_, i) => ({ id: i, name: i % 7 ? 'plain' : 'Special' }));
  const root = parse(JSON.stringify(doc)).root!;
  const want = oldSearch(root, 'special', 100_000).length;
  const results: FindResult[] = [];
  const v = view(root, (r) => results.push(r));
  // A slow device: every look at the clock finds a millisecond gone (a step is 8 of them).
  let clock = 0;
  const now = performance.now;
  Object.defineProperty(performance, 'now', { value: () => ++clock, configurable: true });
  test.after(() => Object.defineProperty(performance, 'now', { value: now, configurable: true }));
  const first = v.obj.search('special', false);
  assert.equal(first.index, -1, 'no current match until it is done');
  assert.ok(first.total < want, `${first.total} found in the first step`);
  assert.equal(results.length, 0);
  v.drain();
  assert.deepEqual(results, [{ total: want, index: 0, note: undefined }]);
  // A newer query, or a new document, stops the one still running.
  results.length = 0;
  v.obj.search('special', false);
  v.obj.search('plain', false);
  v.drain();
  assert.equal(results.length, 1);
  assert.equal(results[0].total, oldSearch(root, 'plain', 100_000).length);
  results.length = 0;
  v.obj.search('special', false);
  Object.assign(v.obj, { L: null, keep: [], keepFor: null, token: 0, building: false, editTimer: 0, mini: { release() {} }, reset: false, dirty: false });
  v.obj.setRoot(parse('[1]').root!, true, 2, false);
  v.drain();
  assert.equal(results.length, 0);
});

test('graph view: without an engine listening, a long search finishes at once', () => {
  const root = parse(JSON.stringify(Array.from({ length: 120_000 }, (_, i) => ({ id: i, name: i % 7 ? 'plain' : 'Special' })))).root!;
  const v = view(root);
  const r = v.obj.search('special', false);
  assert.deepEqual(r, { total: oldSearch(root, 'special', 100_000).length, index: 0, note: undefined });
  assert.equal(v.tasks.length, 0);
  // Paths still jump straight to their node, and say why a pattern can't match.
  assert.equal(v.obj.search('$[5].name', false).total, 1);
  assert.equal(v.obj.search('$[*].name', false).note, 'Wildcards, filters and slices are not supported. Use a concrete path such as $.users[0].name');
});
