import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDoc } from '../lib/json/format';
import { parse, type ParseResult } from '../lib/json/parser';
import { toJSONL } from '../lib/convert/data';
import { Bytes, MemorySink } from '../lib/huge/stream/out';
import { Reformat } from '../lib/huge/stream/reformat';
import { Walker, WalkError, type Visitor } from '../lib/huge/stream/walk';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { enc, pageText } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

/** A strict document: random, records as JSON Lines or an array, or records under a key. */
export function docOf(r: Rng): { doc: string; name: string } {
  const k = r.int(4);
  if (k === 0) return { doc: genStrict(r, 5), name: 'a.json' };
  const rec = () => {
    const long = r.chance(0.1) ? '"' + 'é'.repeat(50 + r.int(400)) + '"' : '"s' + r.int(100) + '"';
    return genStrict(r, 2).trim() ? `{"id": ${r.int(1000)}, "v": ${long}, "x": ${genStrict(r, 2).trim()}}` : '{}';
  };
  const n = 1 + r.int(30);
  const recs = Array.from({ length: n }, rec);
  if (k === 1) return { doc: recs.join(r.chance(0.2) ? ' , ' : '\n') + (r.chance(0.5) ? '\n' : ''), name: r.chance(0.5) ? 'a.jsonl' : 'a.json' };
  if (k === 2) return { doc: '[\n' + recs.join(',\n') + '\n]', name: 'a.json' };
  return { doc: '{"meta": {"n": ' + n + '}, "records": [' + recs.join(',') + '], "tail": "' + 'x'.repeat(r.int(600)) + '"}', name: 'a.json' };
}

/** The normal path's parse of a file's bytes (null if it has a problem the huge index reports: commands refuse those). */
export function normal(bytes: Uint8Array, name: string): { text: string; res: ParseResult } | null {
  const text = pageText(bytes);
  const res = parse(text, { lines: /\.(jsonl|ndjson)$/i.test(name) });
  if (res.error || !res.root || res.issues.some((x) => x.m !== 'Multiple top-level values (wrapped in an array)')) return null;
  return { text, res };
}

/** Feeds `bytes` to a walker over `v` in random chunks (1 to `max` bytes), pausing now and then. */
export function walkAll(r: Rng, bytes: Uint8Array, v: Visitor, multi: boolean, max = 64, keep?: number, parts = false): Walker {
  const w = new Walker(v, { multi, keep, parts });
  let at = 0;
  while (at < bytes.length) {
    const len = 1 + r.int(max);
    const b = bytes.slice(at, at + len);
    let i = 0;
    while (i < b.length) i = w.feed(b, at, i);
    at += b.length;
  }
  w.finish(bytes.length);
  return w;
}

function reformatted(r: Rng, bytes: Uint8Array, multi: boolean, indent: string, lines: boolean, max: number, keep?: number): string {
  const out = new Bytes();
  const f = new Reformat(out, { indent, lines });
  walkAll(r, bytes, f, multi, max, keep, true);
  f.finish();
  const sink = new MemorySink();
  void out.drain(sink);
  return sink.text();
}

test('stream: Pretty, Minify and JSON Lines are the normal path’s, byte for byte, whatever the chunks', () => {
  const r = rng(SEED + 1);
  let checked = 0;
  for (let n = 0; n < 400 * SCALE; n++) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(r.chance(0.2) ? doc.replace(/\n/g, '\r\n') : doc);
    const nm = normal(bytes, name);
    if (!nm) continue;
    const multi = nm.res.multi || /\.jsonl$/.test(name);
    const max = r.pick([1, 3, 16, 64, 4096]);
    const keep = r.chance(0.3) ? 1 + r.int(40) : undefined;
    for (const indent of ['  ', '\t', '    ', '']) {
      const want = formatDoc(nm.text, nm.res, indent);
      const got = reformatted(r, bytes, multi, indent, false, max, keep);
      if (got !== want) assert.fail(`indent ${JSON.stringify(indent)} max ${max} keep ${keep}\ndoc ${show(doc)}\nwant ${show(want)}\ngot  ${show(got)}`);
    }
    const want = toJSONL(nm.res.root!);
    const got = reformatted(r, bytes, multi, '', true, max, keep);
    if (got !== want) assert.fail(`lines max ${max}\ndoc ${show(doc)}\nwant ${show(want)}\ngot  ${show(got)}`);
    checked++;
  }
  assert.ok(checked > 200 * SCALE, `checked ${checked}`);
});

test('stream: invalid UTF-8 in strings is written as the page reads it (U+FFFD)', () => {
  const r = rng(SEED + 2);
  const cases = [
    [0x22, 0xff, 0x22],
    [0x22, 0xc3, 0x22],
    [0x22, 0xe2, 0x82, 0x22],
    [0x22, 0xed, 0xa0, 0x80, 0x22],
    [0x22, 0xf0, 0x9f, 0x98, 0x22],
    [0x22, 0x61, 0xc0, 0xaf, 0x5c, 0x6e, 0x22],
    [0x22, 0xf4, 0x90, 0x80, 0x80, 0x22],
  ];
  for (const c of cases) {
    const bytes = new Uint8Array([0x5b, ...c, 0x2c, ...c, 0x5d]);
    const nm = normal(bytes, 'a.json')!;
    for (const indent of ['  ', '']) assert.equal(reformatted(r, bytes, false, indent, false, 2), formatDoc(nm.text, nm.res, indent));
  }
});

test('stream: broken documents throw a WalkError, never a result', () => {
  const bad = ['[1,]', '{"a" 1}', '[1 2]', '{"a":1,}', 'tru', '[nul]', '{"a":1]', '[1}', '1 2', '"abc', '[', '{"a":', '', ' '];
  const r = rng(SEED + 3);
  for (const s of bad) {
    assert.throws(() => reformatted(r, enc.encode(s), false, '', false, 3), (e) => e instanceof WalkError, s);
  }
  // (Several top-level values are a list, not an error, when the walker is told so.)
  assert.equal(reformatted(r, enc.encode('1 2;3,{"a":[]}'), true, '', false, 2), '[1,2,3,{"a":[]}]');
});
