import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, BOOL, NUL, NUM, STR, parse, type JNode } from '../lib/json/parser';
import { lazyResult, madeCount, nodeAtIndex, tapeOfNode, tapeSearch } from '../lib/json/lazy';
import { tapeOf } from '../lib/json/tape-send';

/** The tree view's search on nodes (TreeView.search), as the reference. */
function nodeSearch(root: JNode, q: string): JNode[] {
  const cs = q !== q.toLowerCase();
  const qn = cs ? q : q.toLowerCase();
  const has = (s: string) => (cs ? s : s.toLowerCase()).includes(qn);
  const out: JNode[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    let hit = typeof n.key === 'string' && has(n.key);
    if (!hit) {
      if (n.t === STR || n.t === NUM) hit = has(n.v as string);
      else if (n.t === BOOL) hit = has(n.v ? 'true' : 'false');
      else if (n.t === NUL) hit = has('null');
    }
    if (hit) out.push(n);
    if (n.t >= ARR) for (let i = (n.v as JNode[]).length - 1; i >= 0; i--) stack.push((n.v as JNode[])[i]);
  }
  return out;
}

const docs = [
  '{"Name": "Ada", "name": "ADA", "list": [true, false, null, 1.5e3, "nul"], "nested": {"true": "x", "é": "Été"}}',
  "{a: 'single', b: True, c: None, d: +1, e: .5, 'k\\u00e9y': \"esc\\u00e9\\n\"}",
  '{"a": 1}\n{"a": 2, "b": "a"}\n',
  JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i, name: `User ${i}`, tags: ['a', 'B'], ok: i % 3 === 0, n: i % 7 ? null : i * 1.25 }))),
  // Characters whose lowercase holds ASCII (İ, the Kelvin sign) or that look like it (ı, ſ), escapes, quotes.
  '{"a": "İd", "b": "İ", "c": "\u212aK", "d": "ıd ſs", "e": "say \\"id\\"", "f": "x\\u0049D", "g": ["ID", "iD", "kk", "", "i"]}',
  "{'single': 'İD', curly: “kK”, raw: ID}",
  // Escapes: simple ones, \u and \x, a loose one (\e is e), a line continuation, an escaped backslash before u.
  '{"a": "ab\\nid", "b": "\\u0069d", "c": "x\\x69dy", "d": "\\i\\d", "e": "i\\\nd", "f": "\\\\u0069d", "g": "say \\"id\\" \\/ \\t"}',
];
const queries = ['a', 'A', 'name', 'Name', 'nul', 'null', 'tru', 'false', 'e', 'é', 'É', '1', '1.5', 'user 4', 'User 4', 'zzz', '\\n', '\n', ':', 'i', 'id', 'ID', 'k', 'kk', 's', '"', '"id"', 'i̇'];

test('tree search on a tape finds the same nodes as on nodes, in order, making only the matches gone to', () => {
  for (const text of docs) {
    const res = parse(text);
    for (const q of queries) {
      const lazy = lazyResult(tapeOf(res, text), text);
      const cs = q !== q.toLowerCase();
      const hits = tapeSearch(tapeOfNode(lazy.root!)!.tape, text, 0, cs ? q : q.toLowerCase(), cs, 100_000);
      assert.equal(madeCount(lazy.root), 1, 'nothing made');
      const want = nodeSearch(res.root!, q);
      assert.equal(hits.length, want.length, `${q} in ${text.slice(0, 30)}`);
      for (let k = 0; k < hits.length; k++) {
        const n = nodeAtIndex(lazy.root!, hits[k])!;
        assert.equal(n.s, want[k].s, `${q} #${k}`);
        assert.equal(n.key, want[k].key);
        assert.equal(nodeAtIndex(lazy.root!, hits[k]), n, 'same object');
      }
    }
  }
});

test('tree search on a tape agrees with the nodes on fuzzed documents and queries', async () => {
  const { genLoose, rng } = await import('./oracle/compare');
  const { genStrict } = await import('./oracle/tape');
  const r = rng(91);
  const PIECES = ['a', 'A', 'id', 'İ', 'K', 'k', 'ı', '\\n', '\\"', '\\\\', '\\/', '\\u0069', '\\x49', '\\e', ' ', 'é', '😀', '"', "'", 'null', '1'];
  const QUERIES = ['a', 'id', 'i', 'k', 'ka', 'e', '"', "'", '/', '\\', 'nul', ' a', '1', 'é'];
  for (let it = 0; it < 400; it++) {
    const strings = Array.from({ length: 6 }, () => Array.from({ length: 1 + r.int(8) }, () => r.pick(PIECES)).join(''));
    const text = it % 3 === 0 ? genStrict(r, 3) : it % 3 === 1 ? genLoose(r, 3) : '{' + strings.map((s, k) => `"k${k}${r.pick(['', 'A', 'İ'])}": "${s}"`).join(', ') + '}';
    const res = parse(text);
    if (!res.root) continue;
    for (const q of QUERIES) {
      const lazy = lazyResult(tapeOf(res, text), text);
      const cs = q !== q.toLowerCase();
      const hits = tapeSearch(tapeOfNode(lazy.root!)!.tape, text, 0, cs ? q : q.toLowerCase(), cs, 100_000);
      const want: number[] = nodeSearch(res.root!, q).map((n: JNode) => n.s);
      assert.deepEqual(hits.map((h) => nodeAtIndex(lazy.root!, h)!.s), want, `${JSON.stringify(q)} in ${JSON.stringify(text).slice(0, 200)}`);
    }
  }
});
