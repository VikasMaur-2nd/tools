/**
 * Edits (doc.ts edit, tail.ts): after any sequence of changes, valid or not, the edited document answers every
 * query exactly as the same bytes opened fresh (which the other huge-* tests check against the normal path), and
 * its status bar is the normal path's. Tiny windows, checkpoints and directory sizes, so every edit meets old
 * checkpoints, big values and window edges.
 */
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { MAX_DEPTH } from '../lib/json/parser';
import { writeTape } from '../lib/json/pretty';
import { endOf, kindOf, nextOf, startOf } from '../lib/json/tape';
import { parse } from '../lib/json/tape-parser';
import { byteAfterUnits } from '../lib/huge/bytes';
import { HugeDoc } from '../lib/huge/doc';
import { PageNodes } from '../lib/huge/page';
import { piecesOf } from '../lib/huge/pieces';
import type { HugeNode } from '../lib/huge/types';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { enc, hugeMod, memSource, normalBar, pageText, tapeMod } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
const dec = new TextDecoder();

interface Tune {
  every: number;
  big: number;
  window: number;
  pageBytes: number;
}

function docOf(r: Rng): { doc: string; name: string } {
  const k = r.int(5);
  if (k === 0) return { doc: genStrict(r, 5), name: 'a.json' };
  const rec = () => {
    const long = r.chance(0.1) ? '"' + 'é'.repeat(30 + r.int(200)) + '"' : '"s' + r.int(100) + '"';
    return `{"id": ${r.int(1000)}, "v": ${long}, "x": ${genStrict(r, 2).trim() || '0'}}`;
  };
  const recs = Array.from({ length: 1 + r.int(25) }, rec);
  if (k === 1) return { doc: recs.join('\n') + (r.chance(0.5) ? '\n' : ''), name: r.chance(0.5) ? 'a.jsonl' : 'a.json' };
  if (k === 2) return { doc: '[\n  ' + recs.join(',\n  ') + '\n]', name: 'a.json' };
  if (k === 3) return { doc: '{"meta": {"n": 1}, "records": [' + recs.join(',') + '], "tail": "' + 'x'.repeat(r.int(300)) + '"}', name: 'a.json' };
  return { doc: JSON.stringify(JSON.parse('[' + recs.join(',') + ']'), null, 2), name: 'a.json' };
}

export const open = (bytes: Uint8Array, name: string, t: Tune) => {
  const d = new HugeDoc(memSource(bytes), hugeMod, { wasm: tapeMod, parse }, { name, every: t.every, big: t.big }, { window: t.window, queryWindow: t.window, pageBytes: t.pageBytes });
  d.step(Infinity);
  return d;
};

/**
 * Everything the views can ask, as text lines: the summary, every page down to depth 5, every pretty and raw line,
 * locate at `at`. (Pretty lines apart: a broken document's run a value past its last checkpoint before the error,
 * which isn't at the same place in an edited one and a fresh one.)
 */
export function dump(d: HugeDoc, at: number[]): { out: string[]; pretty: string[] } {
  const out: string[] = [];
  const pretty: string[] = [];
  const s = d.summary();
  const { size, done, records, multi, jsonl, nodes, depth, lines, prettyLines, error, status, warnings, moreWarnings } = s;
  out.push(JSON.stringify({ size, done, records, multi, jsonl, nodes, depth, lines, prettyLines, error, status, warnings, moreWarnings }));
  const node = (n: HugeNode | null) => (n ? JSON.stringify([n.kind, n.start, n.end, n.depth, n.key, n.count, !!n.partial, n.pretty, n.prettyLines, n.preview ?? null]) : 'null');
  out.push('root ' + node(s.root));
  const walk = (n: HugeNode, d0: number) => {
    for (let from = 0; ; ) {
      const page = d.children(n, from, 5);
      const view = new PageNodes(page);
      for (const k of view.children) {
        const stub = view.stub(k);
        out.push(`${d0} ${from} ${JSON.stringify(k.key ?? null)} ${JSON.stringify(view.span(k))} ` + (stub ? 'stub ' + node(stub) : writeTape(view.tape, page.text, k.zi!, '')));
        if (stub && stub.kind >= 4 && d0 < 5) walk(stub, d0 + 1);
      }
      if (!page.more || !page.count) break;
      from += page.count;
    }
  };
  if (s.root && s.root.kind >= 4) walk(s.root, 0);
  for (let from = 0; from < s.prettyLines; ) {
    const p = d.prettyLines(from, 40, '  ', 1 << 20);
    if (!p.text.length) break;
    // (A line's close is given when the stretch it's in holds it: where stretches end differs, prettyClose doesn't.)
    for (let j = 0; j < p.text.length; j++) pretty.push(`p${from + j} ${p.text[j]} ${p.depth![j]} ${p.kind![j]} ${p.kind![j] === 1 ? d.prettyClose(from + j) : -1} ${p.pos[j]}`);
    from += p.text.length;
  }
  for (let from = 0; from < s.lines; ) {
    const p = d.rawLines(from, 40, 1 << 20);
    if (!p.text.length) break;
    for (let j = 0; j < p.text.length; j++) out.push(`r${from + j} ${p.text[j]}`);
    from += p.text.length;
  }
  for (const p of at) {
    const l = d.locate(p);
    out.push(`at ${p} ` + (l ? JSON.stringify({ path: l.path, node: [l.node.start, l.node.end, l.node.kind, l.node.count], index: l.index, chain: l.chain.map((c) => [c.node.start, c.node.kind, c.node.count, c.index]), line: l.line, col: l.col }) : 'null'));
  }
  return { out, pretty };
}

function same(got: HugeDoc, bytes: Uint8Array, name: string, t: Tune, r: Rng, where: string) {
  const fresh = open(bytes, name, t);
  const at = Array.from({ length: 12 }, () => r.int(bytes.length + 1));
  const a = dump(got, at);
  const b = dump(fresh, at);
  for (let j = 0; j < Math.max(a.out.length, b.out.length); j++) assert.equal(a.out[j], b.out[j], `line ${j} of the dump${where}`);
  // (Broken: how far before the error its pretty lines go depends on where checkpoints are.)
  if (!fresh.summary().error) assert.equal(a.pretty.length, b.pretty.length, `pretty lines${where}`);
  for (let j = 0; j < Math.min(a.pretty.length, b.pretty.length); j++) assert.equal(a.pretty[j], b.pretty[j], `pretty line ${j}${where}`);
  // And the status bar is the normal path's (huge mode's .jsonl rule aside, as huge-front).
  const want = normalBar(bytes, name);
  const st = got.summary().status!;
  if (!(name.endsWith('.jsonl') && (want.msg === 'Multiple top-level values (wrapped in an array)' || (want.kind !== 'error' && want.jsonl === null)))) {
    assert.equal(st.kind, want.kind, `status ${JSON.stringify(st)} want ${JSON.stringify(want)}${where}`);
    assert.equal(st.msg, want.msg, `status msg${where}`);
  }
}

/** A byte where a character starts (no edit cuts one). */
const boundary = (b: Uint8Array, p: number) => {
  while (p > 0 && p < b.length && (b[p] & 0xc0) === 0x80) p--;
  return p;
};

/** A random change of the document: a value, a child removed or copied (the document stays valid), or bytes cut or added (it may break). */
function change(r: Rng, bytes: Uint8Array, name: string): { a: number; b: number; ins: string } {
  const text = pageText(bytes);
  const t = parse(text, { lines: /jsonl$/.test(name), maxDepth: MAX_DEPTH });
  const byte = (u: number) => byteAfterUnits(bytes, 0, bytes.length, u);
  const n = t.count;
  const k = r.int(6);
  if (!t.head.error && n > 1 && k < 4) {
    const i = 1 + r.int(n - 1);
    const s = byte(startOf(t, i));
    const e = byte(endOf(t, i));
    if (k === 0) return { a: s, b: e, ins: r.pick(['1', '"é"', 'true', 'null', '{"k": [1, 2]}', '[]', '-0.5e3', '"' + 'y'.repeat(r.int(120)) + '"']) };
    if (k === 1) {
      // Delete with its comma (or the one before).
      const c = text.indexOf(',', endOf(t, i));
      const next = nextOf(t, i);
      if (c >= 0 && next < n && c < startOf(t, next) && kindOf(t, i) !== 0) return { a: s, b: byte(startOf(t, next)), ins: '' };
      return { a: s, b: e, ins: '0' };
    }
    if (k === 2) return { a: e, b: e, ins: text[endOf(t, i)] === ',' || text.slice(endOf(t, i)).trimStart().startsWith(',') ? ', ' + text.slice(startOf(t, i), endOf(t, i)) : '' };
    // Whitespace (lines move).
    return { a: s, b: s, ins: r.pick(['\n', '  ', '\n\n  ', ' ']) };
  }
  const a = boundary(bytes, r.int(bytes.length + 1));
  const b = boundary(bytes, Math.min(bytes.length, a + r.int(12)));
  return { a, b: Math.max(a, b), ins: r.pick(['', ',', ']', '}', '"', '{"a": 1}', ' ', '\n', 'x', '[[', '1']) };
}

function apply(bytes: Uint8Array, a: number, b: number, ins: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length - (b - a) + ins.length);
  out.set(bytes.subarray(0, a));
  out.set(ins, a);
  out.set(bytes.subarray(b), a + ins.length);
  return out;
}

test('edits: after each of a random sequence, every query is the fresh document\'s', () => {
  const r = rng(SEED + 61);
  for (let k = 0; k < 60 * SCALE; k++) {
    const { doc, name } = docOf(r);
    let bytes: Uint8Array = enc.encode(doc);
    const t: Tune = { every: 64 * (1 + r.int(3)), big: r.chance(0.5) ? 40 + r.int(200) : 1 << 20, window: 64 * (1 + r.int(3)), pageBytes: 64 + r.int(1500) };
    const d = open(bytes, name, t);
    const log: string[] = [];
    for (let e = 0; e < 8; e++) {
      const c = change(r, bytes, name);
      const ins = enc.encode(c.ins);
      log.push(`${c.a}-${c.b}=${JSON.stringify(c.ins)}`);
      const where = `\ndoc: ${show(doc)} name ${name} tune ${JSON.stringify(t)}\nedits ${log.join(' ')}\nnow ${show(dec.decode(apply(bytes, c.a, c.b, ins)))}`;
      if (process.env.HUGE_DUMP) writeFileSync(process.env.HUGE_DUMP, JSON.stringify({ doc, name, t, log }));
      d.edit([{ a: c.a, b: c.b, put: piecesOf(ins) }]);
      bytes = apply(bytes, c.a, c.b, ins);
      assert.equal(dec.decode(d.src.read(0, d.src.size)), dec.decode(bytes), `bytes${where}`);
      same(d, bytes, name, t, r, where);
    }
  }
});
