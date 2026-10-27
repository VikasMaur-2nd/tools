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
