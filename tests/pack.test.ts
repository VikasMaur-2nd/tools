import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, parse, type JNode, type ParseResult } from '../lib/json/parser';
import { nodeAt, pathOf } from '../lib/json/path';
import { packTree, packedPosition, unpacker } from '../lib/json/pack';
import { madeCount } from '../lib/json/lazy';
import { Doc } from '../lib/engine/doc';

/** Every field of every node, parent links included, must match. */
function same(a: JNode | null, b: JNode | null, path = '$') {
  if (!a || !b) return assert.equal(a, b, path);
  assert.equal(a.t, b.t, path + ' t');
  assert.equal(a.s, b.s, path + ' s');
  assert.equal(a.e, b.e, path + ' e');
  assert.equal(a.d, b.d, path + ' d');
  assert.equal(a.key, b.key, path + ' key');
  assert.equal(a.x, b.x, path + ' x');
  if (a.t >= ARR) {
    const ka = a.v as JNode[];
    const kb = b.v as JNode[];
    assert.equal(ka.length, kb.length, path + ' kids');
    for (let i = 0; i < ka.length; i++) {
      assert.equal(ka[i].u, a, path + ' parent');
      assert.equal(kb[i].u, b, path + ' parent');
      same(ka[i], kb[i], `${path}/${String(ka[i].key)}`);
    }
  } else assert.equal(a.v, b.v, path + ' v');
}

/** Packs and rebuilds in tiny steps (deadline already passed: one batch per call). */
function roundTrip(src: string, lines = false): [ParseResult, ParseResult] {
  const res = parse(src, { lines });
  const packed = packTree(res, src);
  const step = unpacker(structuredClone(packed), src);
  let out: ParseResult | undefined;
  for (let k = 0; k < 100_000 && !(out = step(0)); k++);
  assert.ok(out, 'finished');
  return [res, out!];
}

function check(src: string, lines = false) {
  const [a, b] = roundTrip(src, lines);
  same(a.root, b.root);
  for (const k of ['issues', 'warnings', 'error', 'nodes', 'depth', 'exact', 'multi'] as const) assert.deepEqual(b[k], a[k], k);
}

let seed = 7;
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const words = ['a', 'id', 'name', 'Zürich', '東京', 'say "hi"', 'tab\there', 'new\nline', '😀', 'back\\slash', '', 'ü\u0000x'];
function value(depth: number): unknown {
  const r = rnd(depth > 4 ? 6 : 9);
  if (r === 0) return null;
  if (r === 1) return rnd(2) === 0;
  if (r === 2) return rnd(100000) / (rnd(3) + 1) - 500;
  if (r === 3) return 1e21 * (rnd(5) + 1);
  if (r <= 5) return words[rnd(words.length)] + rnd(10);
  if (r <= 7) return Array.from({ length: rnd(6) }, () => value(depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = rnd(6); i > 0; i--) o[words[rnd(words.length)] + rnd(4)] = value(depth + 1);
  return o;
}

test('packed trees rebuild exactly: random strict JSON, compact and indented', () => {
  for (let k = 0; k < 400; k++) {
    const v = value(0);
    check(JSON.stringify(v));
    check(JSON.stringify(v, null, k % 2 ? 2 : '\t'));
  }
});

test('packed trees rebuild exactly: lenient input, escapes, JSON Lines and errors', () => {
  const cases = [
    "{a: 1, 'b': 'two', c: [1, 2,], /* note */ d: +5, e: .5, f: 0x1F, g: NaN, // tail\n}",
    '{"k\\u00e9y": "v\\u00e9", "esc": "\\"q\\" \\\\ \\n", "big": 12345678901234567890, "neg": -0.0e+5}',
    '{"dup": 1, "dup": 2, "1": "int-like", "": "empty key"}',
    '{"a": [1, 2, {"b": [[], {}, [[]]]}]}',
    '[]',
    '{}',
    '"just a string"',
    '42',
    'true',
    'null',
    '{"a": 1}\n{"b": [2, 3]}\n\n{"c": "x"}\n',
    '{"a": 1} {"b": 2}',
    '{"broken": [1, 2',
    '{"a": 1,, "b": 2}',
    '',
  ];
  for (const c of cases) check(c);
  check('{"a": 1}\n', true);
  check('{"a": 1}\n{"b": 2}\n', true);
});

test('a big document is received in short steps, and makes nodes only when read', () => {
  const src = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, [`name${i}`]: `User ${i}`, tags: ['a', 'b'], ok: i % 2 === 0, n: i * 1.5, s: 'x\ny' })));
  const res = parse(src);
  const packed = packTree(res, src);
  const step = unpacker(packed, src);
  let calls = 0;
  let out: ParseResult | undefined;
  while (!(out = step(0))) calls++;
  assert.ok(calls >= 4, 'sliced');
  assert.equal(madeCount(out.root), 1, 'only the root is made');
  const first = (out.root!.v as JNode[])[0];
  assert.equal(madeCount(out.root), 20001, 'one level');
  assert.equal((first.v as JNode[]).length, 6);
  assert.equal(first, (out.root!.v as JNode[])[0], 'stable identity');
  same(res.root, out.root);
});

test('packed caret navigation matches the node tree, including keys and container boundaries', () => {
  for (const text of ['{"a":[1,2,{"b":true}], "c": "v", "empty":{}}', '[1,2,{"key,comma": [[],{}]}]', '{a:1,b:[2,3,]}', '{"a":1}\n{"b":2}']) {
    const res = parse(text);
    const packed = packTree(res, text);
    for (let off = 0; off <= text.length; off++) {
      const n = nodeAt(res.root, off, text);
      const at = packedPosition(packed, off, text);
      assert.deepEqual(at?.path ?? null, n ? pathOf(n) : null, `${text} @ ${off}`);
      let container = n;
      while (container && container.t < ARR) container = container.u;
      assert.equal(at?.start ?? -1, container?.s ?? -1, `container @ ${off}`);
      assert.equal(at?.end ?? -1, container?.e ?? -1, `container end @ ${off}`);
    }
  }
});

test('transferred strings retain empty text, escapes and unpaired UTF-16 surrogates', () => {
  check('{"": "", "lone": "\\ud800", "key\\udc00": "\\udfff", "paired": "😀", "escape": "a\\nb"}');
  const src = '{"key": "value"}';
  const res = parse(src);
  const plain = unpacker(packTree(res, src), src)(Infinity)!;
  same(plain.root, res.root);
});

test('packed navigation reads document pieces without building the complete text', () => {
  let doc = Doc.of('{"a":[1,2,{"key,comma":"😀"}],"b":true}');
  doc = doc.edit(3, 3, 'é');
  const text = doc.toString();
  const tree = packTree(parse(text), text);
  doc.toString = () => { throw new Error('must not flatten'); };
  for (let off = 0; off <= text.length; off++) assert.deepEqual(packedPosition(tree, off, doc), packedPosition(tree, off, text));
});
