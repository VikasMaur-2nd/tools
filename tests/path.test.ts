import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { formatPath, parsePath, pathOf, resolve } from '../lib/json/path';
import { lazyResult } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';
import { matchRanges, TreeView, type TreeEvents } from '../lib/engine/tree';
import { GraphView } from '../lib/graph/view';
import { diff } from '../lib/diff/diff';

// Paths as the Find bars (tree, graph), Compare's ignore list and the path tools read them.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

test('`$` starts a path only as `$`, `$.` or `$[`: `$type`, `$ref` are text', () => {
  assert.deepEqual(parsePath('$'), []);
  assert.deepEqual(parsePath('$.type'), ['type']);
  assert.deepEqual(parsePath("$['type']"), ['type']);
  assert.deepEqual(parsePath('$["$type"]'), ['$type']);
  assert.deepEqual(parsePath('$[0].a'), [0, 'a']);
  assert.deepEqual(parsePath('$.$type'), ['$type']);
  assert.deepEqual(parsePath(' $.a \n'), ['a']);
  for (const q of ['$type', '$ref', '$ref.id', '$$', '$ .a', '$0', '$-']) assert.equal(parsePath(q), null, q);
  // (what formatPath writes still reads back)
  assert.deepEqual(parsePath(formatPath(['$type', 'a'])), ['$type', 'a']);
});

test('a JSON Pointer keeps the spaces of its tokens; a pasted line break is left out', () => {
  assert.deepEqual(parsePath('/a '), ['a ']);
  assert.deepEqual(parsePath('/ '), [' ']);
  assert.deepEqual(parsePath('/a\u00a0'), ['a\u00a0']);
  assert.deepEqual(parsePath('/a\u2028'), ['a\u2028']);
  assert.deepEqual(parsePath('/ a/ b /0'), [' a', ' b ', 0]);
  assert.deepEqual(parsePath('/a\n'), ['a']);
  assert.deepEqual(parsePath('/a/b\r\n'), ['a', 'b']);
  assert.deepEqual(parsePath('  /a'), ['a']);
  const root = parse('{"a":1,"a ":2," ":3,"a\\u00a0":4,"a\\u2028":5}').root!;
  const at = (q: string) => resolve(root, parsePath(q)!)?.v;
  assert.equal(at('/a'), '1');
  assert.equal(at('/a '), '2');
  assert.equal(at('/ '), '3');
  assert.equal(at('/a\u00a0'), '4');
  assert.equal(at('/a\u2028'), '5');
});

test('a duplicated key resolves to its last member (as JSON.parse, the Table and Compare read it), on nodes and on a tape', () => {
  const text = '{"a":{"x":1},"b":[1],"a":{"x":2,"x":3}}';
  const res = parse(text);
  const lazy = lazyResult(tapeOf(res, text), text);
  for (const root of [res.root!, lazy.root!]) {
    assert.equal(resolve(root, ['a', 'x'])?.v, '3');
    assert.deepEqual(pathOf(resolve(root, ['a'])!), ['a']);
    assert.equal(resolve(root, ['a'])!.s, text.lastIndexOf('{"x":2'));
    assert.equal(resolve(root, ['b', 0])?.v, '1');
  }
});

const events: TreeEvents = { select() {}, copy() {}, open() {}, escape() {}, nested() {} };
class Viewport extends EventTarget {
  hidden = true;
  clientHeight = 480;
  scrollTop = 0;
  querySelector() {
    return { style: {} };
  }
}

const DOC = '{"type":"top","$type":"T1","items":[{"$type":"T2","$ref":"#/a"}],"a ":1}';

test('tree Find: `$type` searches the text; `$.type` and `/a ` go to the node', () => {
  const tree = new TreeView(new Viewport() as unknown as HTMLElement, events);
  const root = parse(DOC).root!;
  tree.setRoot(root, true);
  assert.equal(tree.search('$type', false).total, 2);
  assert.equal(tree.search('$ref', false).total, 1);
  assert.equal(tree.search('$.type', false).total, 1);
  assert.equal(tree.search('/a ', false).total, 1);
  // and on a tape
  const lazy = lazyResult(tapeOf(parse(DOC), DOC), DOC);
  tree.setRoot(lazy.root, true);
  assert.equal(tree.search('$type', false).total, 2);
  assert.equal(tree.search('$.type', false).total, 1);
});

test('graph Find: `$type` searches the text; `$.type` goes to the node', () => {
  const v = Object.create(GraphView.prototype) as GraphView & Record<string, unknown>;
  Object.assign(v, { root: parse(DOC).root!, m: null, card: -1, row: -1, q: '', findSeq: 0, matches: [], mi: -1, hitFor: null, redraw: () => {}, ev: { select: () => {} } });
  assert.equal(v.search('$type', false).total, 2);
  assert.equal(v.search('$.type', false).total, 1);
  assert.equal(v.search("$['$type']", false).total, 1);
});

test('Compare: ignoring `$type` ignores that key (anywhere), not "type"', () => {
  const a = parse('{"type":1,"$type":"a","x":{"$type":"b","type":2}}').root!;
  const b = parse('{"type":5,"$type":"z","x":{"$type":"y","type":6}}').root!;
  const lines = (ignore: string[]) => diff(a, b, { ignorePaths: ignore }).changes.map((c) => formatPath(c.path));
  assert.deepEqual(lines(['$type']), ['$.type', '$.x.type']);
  assert.deepEqual(lines(['$..$type']), ['$.type', '$.x.type']);
  assert.deepEqual(lines(['$.$type']), ['$.type', '$.x.$type', '$.x.type']);
  assert.deepEqual(lines(['$["$type"]', 'type']), ['$.x.$type']);
  assert.deepEqual(lines(['$type.q', 'x.$type']), ['$.type', '$.$type', '$.x.type']);
  assert.deepEqual(lines(['$.type']), ['$.$type', '$.x.$type', '$.x.type']);
});

test('tree Find marks what it found where it shows: lowercasing that changes lengths, escaped text', () => {
  const r = (text: string, q: string) => {
    const cs = q !== q.toLowerCase();
    return matchRanges(text, cs ? q : q.toLowerCase(), cs);
  };
  assert.deepEqual(r('İstanbul', 'stan'), [1, 5]);
  assert.deepEqual(r('İstanbul', 'i'), [0, 1]);
  assert.deepEqual(r('İİx', 'x'), [2, 3]);
  assert.deepEqual(r('aİb', 'İb'), [1, 3]);
  assert.deepEqual(r('😀a😀a', 'a'), [2, 3, 5, 6]);
  assert.deepEqual(r('aaa', 'aa'), [0, 2]);
  assert.equal(r('abc', 'x'), null);

  const tree = new TreeView(new Viewport() as unknown as HTMLElement, events);
  const text = '{"city":"İstanbul","q":"say a\\"b","İİx":"plain","long":"' + 'z'.repeat(420) + '","t":"a\\tb"}';
  const root = parse(text).root!;
  tree.setRoot(root, true);
  const row = (n: JNode) => (tree as unknown as { row(n: JNode, i: number): string }).row(n, 0);
  const node = (k: string) => resolve(root, [k])!;
  tree.search('stan', false);
  assert.ok(row(node('city')).includes('&quot;İ<mark>stan</mark>bul&quot;'), row(node('city')));
  tree.search('a"b', false);
  assert.ok(row(node('q')).includes('say <mark>a\\&quot;b</mark>'), row(node('q')));
  tree.search('x', false);
  assert.ok(row(node('İİx')).includes('İİ<mark>x</mark>'), row(node('İİx')));
  // a match past what a row shows marks nothing; one across the cut marks what shows
  tree.search('zzzz', false);
  assert.equal((row(node('long')).match(/<mark>/g) ?? []).length, 1);
  assert.ok(row(node('long')).includes('<mark>' + 'z'.repeat(400) + '</mark>…'));
  // an escape's letter isn't the text: \t shows as \t but a "t" search marks only the key
  tree.search('t', false);
  assert.ok(!row(node('t')).includes('\\<mark>'), row(node('t')));
});
