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
import { endOf, kindOf, nextOf, startOf } from '../lib/json/tape';
import { parse } from '../lib/json/tape-parser';
import { byteAfterUnits } from '../lib/huge/bytes';
import { HugeDoc } from '../lib/huge/doc';
import { Skeleton, type State } from '../lib/huge/skeleton';
import { piecesOf } from '../lib/huge/pieces';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { dump, enc, hugeMod, memSource, normalBar, open, pageText, type EditTune } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
const dec = new TextDecoder();

type Tune = EditTune;

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

function same(got: HugeDoc, bytes: Uint8Array, name: string, t: Tune, r: Rng, where: string) {
  const fresh = open(bytes, name, t);
  const at = Array.from({ length: 12 }, () => r.int(bytes.length + 1));
  const a = dump(got, at);
  const b = dump(fresh, at);
  for (let j = 0; j < Math.max(a.out.length, b.out.length); j++) assert.equal(a.out[j], b.out[j], `line ${j} of the dump${where}`);
  // (Broken: how far before the error its pretty lines go depends on where checkpoints are.)
  if (!fresh.summary().error) assert.equal(a.pretty.length, b.pretty.length, `pretty lines${where}`);
  for (let j = 0; j < Math.min(a.pretty.length, b.pretty.length); j++) assert.equal(a.pretty[j], b.pretty[j], `pretty line ${j}${where}`);
  // And the status bar is the normal path's (huge mode's .jsonl rule aside, as huge-front), where the fresh
  // document's is: where it isn't (a bare word right after a number: whether that's a second value is the normal
  // path's repair's call), counted (huge-front's business, not edits').
  const want = normalBar(bytes, name);
  const st = got.summary().status!;
  if (!(name.endsWith('.jsonl') && (want.msg === 'Multiple top-level values (wrapped in an array)' || (want.kind !== 'error' && want.jsonl === null)))) {
    const fst = fresh.summary().status!;
    if (fst.msg !== want.msg || fst.kind !== want.kind) {
      statusDiffers++;
      return;
    }
    assert.equal(st.kind, want.kind, `status ${JSON.stringify(st)} want ${JSON.stringify(want)}${where}`);
    assert.equal(st.msg, want.msg, `status msg${where}`);
  }
}

/** Edited documents whose fresh document's status isn't the normal path's (see same()). */
let statusDiffers = 0;

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
      truth(d, bytes, where);
      same(d, bytes, name, t, r, where);
    }
  }
  if (statusDiffers) console.log(`(status: ${statusDiffers} documents where huge mode's status isn't the normal path's, opened fresh too)`);
});

/** Every checkpoint of `d`'s index is the parser's state at its byte in `bytes` (read from the start). */
function truth(d: HugeDoc, bytes: Uint8Array, where: string) {
  const ix = d.index;
  const strip = (x: State) => JSON.stringify([x.pos, x.state, x.nodes, x.closers, x.lines, x.u16, x.lineU16, x.top, x.frames.map((f) => [f.kind, f.count, f.start, f.key, f.nodes, f.closers])]);
  for (let k = 1; k < ix.n; k++) {
    const want = ix.state(k);
    const q = new Skeleton(hugeMod);
    q.start(memSource(bytes), { window: 64 });
    q.target(-1);
    q.stopAfter(want.pos);
    q.go();
    assert.equal(strip(want), strip(q.snapshot()), `checkpoint ${k} of ${ix.n}${where}`);
  }
}

test('edits while reading again: queries stay answered, more edits come, several in one; the end is the fresh document', () => {
  const r = rng(SEED + 62);
  for (let k = 0; k < 40 * SCALE; k++) {
    const { doc, name } = docOf(r);
    let bytes: Uint8Array = enc.encode(doc);
    const t: Tune = { every: 64 * (1 + r.int(3)), big: r.chance(0.5) ? 40 + r.int(200) : 1 << 20, window: 64, pageBytes: 64 + r.int(1500) };
    const d = open(bytes, name, t);
    const log: string[] = [];
    // (What was done, for HUGE_DUMP: edits, steps, queries.)
    const acts: unknown[] = [];
    for (let e = 0; e < 10; e++) {
      // One to three changes at once, in order (each at the document as the one before leaves it).
      const ops = [];
      for (let j = 0, n = 1 + (r.chance(0.3) ? r.int(3) : 0); j < n; j++) {
        const c = change(r, bytes, name);
        const ins = enc.encode(c.ins);
        ops.push({ a: c.a, b: c.b, put: piecesOf(ins) });
        log.push(`${j ? '+' : ''}${c.a}-${c.b}=${JSON.stringify(c.ins)}`);
        acts.push(['op', c.a, c.b, c.ins]);
        bytes = apply(bytes, c.a, c.b, ins);
      }
      const where = `\ndoc: ${show(doc)} name ${name} tune ${JSON.stringify(t)}\nedits ${log.join(' ')}\nnow ${show(dec.decode(bytes))}`;
      acts.push(['edit']);
      const dump = () => process.env.HUGE_DUMP && writeFileSync(process.env.HUGE_DUMP, JSON.stringify({ doc, name, t, log, acts }));
      dump();
      // Read again a window at a time (no time to spare): queries meanwhile, sometimes the next edit right away.
      let done = d.edit(ops, 0).done;
      while (!done && !r.chance(0.3)) {
        const s = d.summary();
        assert.ok(!s.done, `not done while reading again${where}`);
        if (s.root && s.root.kind >= 4) d.children(s.root, 0, 3);
        d.prettyLines(0, 5, '  ', 1 << 16);
        const at = r.int(bytes.length + 1);
        d.locate(at);
        acts.push(['ask', at]);
        done = d.step(0);
      }
      if (!done && r.chance(0.5)) continue;
      acts.push(['done']);
      dump();
      d.step(Infinity);
      assert.equal(dec.decode(d.src.read(0, d.src.size)), dec.decode(bytes), `bytes${where}`);
      truth(d, bytes, where);
      same(d, bytes, name, t, r, where);
    }
    d.step(Infinity);
    same(d, bytes, name, t, r, `\nat the end: doc ${show(doc)} edits ${log.join(' ')}`);
  }
});
