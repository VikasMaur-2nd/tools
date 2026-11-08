import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { lazyResult } from '../lib/json/lazy';
import { MAX_DEPTH, type JNode } from '../lib/json/parser';
import { formatPath, nodeAt, pathOf } from '../lib/json/path';
import { PrettyText, prettyIndexer, writeTape } from '../lib/json/pretty';
import { childCount, endOf, nextOf, startOf, type Tape } from '../lib/json/tape';
import { parse } from '../lib/json/tape-parser';
import { byteAfterUnits } from '../lib/huge/bytes';
import { PageNodes } from '../lib/huge/page';
import { LIST, type HugeNode } from '../lib/huge/types';
import type { HugeDoc } from '../lib/huge/doc';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { enc, hugeOf, pageText } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

/** A strict document: random, or records (JSON Lines or an array of them), with long strings now and then. */
function docOf(r: Rng): { doc: string; name: string } {
  const k = r.int(4);
  if (k === 0) return { doc: genStrict(r, 5), name: 'a.json' };
  const rec = () => {
    const long = r.chance(0.1) ? '"' + 'é'.repeat(50 + r.int(400)) + '"' : '"s' + r.int(100) + '"';
    return genStrict(r, 2).trim() ? `{"id": ${r.int(1000)}, "v": ${long}, "x": ${genStrict(r, 2).trim()}}` : '{}';
  };
  const n = 1 + r.int(30);
  const recs = Array.from({ length: n }, rec);
  if (k === 1) return { doc: recs.join('\n') + (r.chance(0.5) ? '\n' : ''), name: r.chance(0.5) ? 'a.jsonl' : 'a.json' };
  if (k === 2) return { doc: '[\n' + recs.join(',\n') + '\n]', name: 'a.json' };
  return { doc: '{"meta": {"n": ' + n + '}, "records": [' + recs.join(',') + '], "tail": "' + 'x'.repeat(r.int(600)) + '"}', name: 'a.json' };
}

function fileOf(r: Rng, doc: string): Uint8Array {
  if (r.chance(0.3)) doc = doc.replace(/\n/g, '\r\n');
  return enc.encode(doc);
}

interface Case {
  bytes: Uint8Array;
  text: string;
  tape: Tape;
  d: HugeDoc;
  where: string;
}

function makeCase(r: Rng): Case {
  const { doc, name } = docOf(r);
  const bytes = fileOf(r, doc);
  const text = pageText(bytes);
  const tape = parse(text, { lines: /\.jsonl$/.test(name), maxDepth: MAX_DEPTH });
  const every = 64 * (1 + r.int(4));
  const big = 40 + r.int(300);
  const window = 64 * (1 + r.int(3));
  const pageBytes = 64 + r.int(2000);
  if (process.env.HUGE_DUMP) writeFileSync(process.env.HUGE_DUMP, JSON.stringify({ doc: new TextDecoder().decode(bytes), name, every, big, window, pageBytes }));
  const d = hugeOf(bytes, { name, every, big }, { window, queryWindow: window, pageBytes });
  return { bytes, text, tape, d, where: `\ndoc: ${show(doc)} name ${name} every ${every} big ${big} window ${window}` };
}

/** The byte of UTF-16 offset `p` of the page's text. */
const byteOfText = (c: Case, p: number) => byteAfterUnits(c.bytes, 0, c.bytes.length, p);

/** Children of the normal tape's container `i`. */
function kidsOf(t: Tape, i: number): number[] {
  const out: number[] = [];
  for (let c = i + 1, e = nextOf(t, i); c < e; c = nextOf(t, c)) out.push(c);
  return out;
}

/** Every child of `node` through pages of `size`, checked against the normal tape's container `i`, recursively into stubs. */
function checkPages(c: Case, node: HugeNode, i: number, size: number, depth = 0) {
  const asked = size;
  const t = c.tape;
  const want = kidsOf(t, i);
  let at = 0;
  // (A page may hold fewer than asked: its byte budget. The next starts after it.)
  for (let from = 0; ; from += size) {
    const page = c.d.children(node, from, asked);
    size = Math.max(1, page.count);
    const view = new PageNodes(page);
    const kids = view.children;
    assert.equal(page.count, kids.length, `page count${c.where}`);
    for (let j = 0; j < kids.length; j++, at++) {
      const k = kids[j];
      const w = want[at];
      assert.ok(w !== undefined, `more children than the normal path at ${at}${c.where}`);
      const stub = view.stub(k);
      const [s, e] = view.span(k);
      assert.equal(s, byteOfText(c, startOf(t, w)), `child ${at} start${c.where}`);
      assert.equal(e, byteOfText(c, endOf(t, w)), `child ${at} end${c.where}`);
      if (stub) {
        assert.equal(stub.count ?? 0, childCount(t, w), `stub ${at} count${c.where}`);
        // Its row: the normal tree's preview of it, or its decoded start.
        if (stub.preview !== undefined) {
          const z = lazyResult(t, c.text).root!.z!;
          const v = z.at(w);
          const want = v.t >= 4 ? z.preview(v) : (v.v as string).length > 1024 ? (v.v as string).slice(0, 1024) + '…' : (v.v as string);
          assert.equal(stub.preview, want, `stub ${at} preview${c.where}`);
        }
        if (stub.kind >= 4 && depth < 6) checkPages(c, stub, w, 1 + (asked >> 1), depth + 1);
      } else {
        assert.equal(k.key ?? null, (lazyResult(t, c.text).root && keyOfNormal(c, w)) ?? null, `child ${at} key${c.where}`);
        const pt = view.tape;
        assert.equal(writeTape(pt, page.text, k.zi!, ''), writeTape(t, c.text, w, ''), `child ${at} value${c.where}`);
      }
    }
    if (!page.more) break;
    assert.ok(kids.length > 0, `an empty page with more${c.where}`);
  }
  assert.equal(at, want.length, `children in all of ${JSON.stringify(node)} pages of ${size}${c.where}`);
}

function keyOfNormal(c: Case, w: number): string | number | null {
  const n = lazyResult(c.tape, c.text).root!.z!.at(w);
  return n.key ?? null;
}

test('pages: every child, in pages of any size, as the normal path parses it', () => {
  const r = rng(SEED + 21);
  for (let k = 0; k < 300 * SCALE; k++) {
    const c = makeCase(r);
    const s = c.d.summary();
    assert.equal(s.error, null, `error ${JSON.stringify(s.error)}${c.where}`);
    const root = s.root!;
    if (root.kind === LIST) checkPages(c, root, 0, 1 + r.int(7));
    else if (root.kind >= 4) checkPages(c, root, 0, 1 + r.int(7));
    assert.equal(s.nodes, c.tape.head.nodes - (s.multi ? 1 : 0), `nodes${c.where}`);
  }
});

test('pretty lines: the Format view\'s lines, depths, kinds and folds', () => {
  const r = rng(SEED + 22);
  for (let k = 0; k < 300 * SCALE; k++) {
    const c = makeCase(r);
    const indent = r.pick(['  ', '    ', '\t']);
    const index = prettyIndexer(c.tape, c.text, indent)(Infinity)!;
    const pt = new PrettyText(c.tape, c.text, indent, index);
    const total = index.starts.length;
    const s = c.d.summary();
    assert.equal(s.prettyLines, total, `pretty lines${c.where}`);
    // In pieces of random sizes, from random places.
    for (let from = 0; from < total; ) {
      const n = 1 + r.int(40);
      const got = c.d.prettyLines(from, n, indent, 1 << 20);
      assert.equal(got.total, total, `total${c.where}`);
      assert.equal(got.text.length, Math.min(n, total - from), `lines from ${from}${c.where}`);
      for (let j = 0; j < got.text.length; j++) {
        const line = from + j;
        const want = pt.line(line);
        if (got.cut[j]) assert.ok(want.length > (1 << 20) || got.length[j] >= got.text[j].length, `cut ${line}${c.where}`);
        else if (got.length[j] === got.text[j].length) assert.equal(got.text[j], want, `line ${line}${c.where}`);
        assert.equal(got.depth![j], Math.round((want.length - want.trimStart().length) / indent.length), `depth ${line}${c.where}`);
        const x = index.node[line];
        assert.equal(got.kind![j], x < 0 ? 2 : index.close[line] >= 0 ? 1 : 0, `kind ${line}${c.where}`);
        if (got.close![j] >= 0) assert.equal(got.close![j], index.close[line], `close ${line}${c.where}`);
        else if (got.kind![j] === 1) assert.equal(c.d.prettyClose(line), index.close[line], `prettyClose ${line}${c.where}`);
        if (x >= 0) assert.equal(got.pos[j], byteOfText(c, startOf(c.tape, x)), `pos ${line}${c.where}`);
      }
      from += got.text.length;
    }
  }
});

test('raw lines: the text as stored, a line at a time', () => {
  const r = rng(SEED + 23);
  for (let k = 0; k < 200 * SCALE; k++) {
    const c = makeCase(r);
    const lines = c.text.split('\n');
    const s = c.d.summary();
    assert.equal(s.lines, lines.length, `raw lines${c.where}`);
    for (let from = 0; from < lines.length; ) {
      const n = 1 + r.int(20);
      const got = c.d.rawLines(from, n, 1 << 20);
      assert.equal(got.text.length, Math.min(n, lines.length - from), `count from ${from}${c.where}`);
      for (let j = 0; j < got.text.length; j++) assert.equal(got.text[j], lines[from + j], `line ${from + j}${c.where}`);
      from += got.text.length;
    }
    // Cut at a few bytes.
    const cut = c.d.rawLines(0, 3, 5);
    for (let j = 0; j < cut.text.length; j++) assert.ok(cut.text[j].length <= 5 && (cut.cut[j] === 1) === cut.length[j] > 5, `cut line${c.where}`);
  }
});

test('locate and resolve: the node at a byte and its path, as path.ts finds them', () => {
  const r = rng(SEED + 24);
  for (let k = 0; k < 200 * SCALE; k++) {
    const c = makeCase(r);
    const root = lazyResult(c.tape, c.text).root!;
    for (let q = 0; q < 20; q++) {
      const p = r.int(c.text.length);
      const want = nodeAt(root, p, c.text);
      const got = c.d.locate(byteOfText(c, p));
      if (!want || !want.u) {
        // (The root, or nothing: huge mode may say either for whitespace around the document.)
        if (got && got.node.kind !== LIST) assert.equal(formatPath(got.path), formatPath(want ? pathOf(want) : []), `root at ${p}${c.where}`);
        continue;
      }
      assert.ok(got, `nothing at ${p}: want ${formatPath(pathOf(want))}${c.where}`);
      assert.equal(formatPath(got!.path), formatPath(pathOf(want)), `path at ${p}${c.where}`);
      assert.equal(got!.node.start, byteOfText(c, want.s), `start at ${p}${c.where}`);
      if (got!.node.end >= 0) assert.equal(got!.node.end, byteOfText(c, want.e), `end at ${p}${c.where}`);
      // And back from its path (an object's first member with a name: what path.ts resolve finds).
      const back = c.d.resolve(pathOf(want));
      const first = resolveFirst(root, pathOf(want));
      assert.equal(back?.node.start, first ? byteOfText(c, first.s) : undefined, `resolve ${formatPath(pathOf(want))}${c.where}`);
    }
  }
});

function resolveFirst(root: JNode, path: (string | number)[]): JNode | null {
  let n: JNode | null = root;
  for (const k of path) {
    if (!n) return null;
    n = n.z!.child(n, k);
  }
  return n;
}

test('find: every match of a query in the bytes, forward and back, either case', () => {
  const r = rng(SEED + 25);
  for (let k = 0; k < 200 * SCALE; k++) {
    const c = makeCase(r);
    const at = r.int(c.text.length);
    const q = c.text.slice(at, at + 1 + r.int(6));
    const cs = r.chance(0.5);
    const hay = new TextDecoder('latin1').decode(c.bytes);
    const needle = new TextDecoder('latin1').decode(enc.encode(q));
    const norm = (s: string) => (cs ? s : s.replace(/[A-Z]/g, (x) => x.toLowerCase()));
    const want: number[] = [];
    for (let i = norm(hay).indexOf(norm(needle)); i >= 0; i = norm(hay).indexOf(norm(needle), i + 1)) want.push(i);
    const from = r.int(c.bytes.length + 1);
    const got: number[] = [];
    for (const b of c.d.find(q, { from, caseSensitive: cs })) if ('matches' in b) got.push(...b.matches);
    const order = [...want.filter((x) => x >= from), ...want.filter((x) => x < from)];
    assert.deepEqual(got, order, `find ${JSON.stringify(q)} from ${from} cs ${cs}${c.where}`);
    const back: number[] = [];
    for (const b of c.d.find(q, { from, caseSensitive: cs, backward: true })) if ('matches' in b) back.push(...b.matches);
    const border = [...want.filter((x) => x < from).reverse(), ...want.filter((x) => x >= from).reverse()];
    assert.deepEqual(back, border, `find back ${JSON.stringify(q)} from ${from}${c.where}`);
  }
});
