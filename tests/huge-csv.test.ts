import { test } from 'node:test';
import assert from 'node:assert/strict';
import { records, toCsv, type CsvOptions } from '../lib/convert/xlsx';
import { parse, type JNode } from '../lib/json/parser';
import { Bytes, MemorySink } from '../lib/huge/stream/out';
import { CsvRows, CsvScan, Trees } from '../lib/huge/stream/csv';
import { Walker } from '../lib/huge/stream/walk';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { enc } from './huge-oracle';
import { docOf } from './huge-stream-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);

const KEYS = ['id', 'name', 'a', 'b', 'a.b', 'x.y.z', 'value', '_value', 'key', 'k\\\\', 'é', '', 'q\\"', 'a\\\\.b', '1', 'dup'];
const STRS = ['', 'plain', '=SUM(A1)', '+1', '-2', '@x', '\\t', 'tab\\there', 'line\\nbreak', 'say \\"hi\\"', 'a,b', 'a;b', '1e5', '-0.5', 'é😀', '\\u0000', ' '];

/** Documents shaped like tables (and not): every branch of toCsv. */
function csvDoc(r: Rng): string {
  const key = () => '"' + r.pick(KEYS) + '"';
  const scalar = (): string => {
    const k = r.int(6);
    if (k === 0) return r.pick(['null', 'true', 'false']);
    if (k < 3) return r.pick(['0', '-1', '3.25', '1e5', '1E-3', '12345678901234567890', '-0']);
    return '"' + r.pick(STRS) + '"';
  };
  const value = (d: number): string => {
    const k = r.int(d > 2 ? 3 : 7);
    if (k < 3) return scalar();
    if (k < 5) return '[' + Array.from({ length: r.int(4) }, () => (r.chance(0.7) ? scalar() : value(d + 1))).join(',') + ']';
    return obj(d + 1);
  };
  const obj = (d: number): string => '{' + Array.from({ length: r.int(5) }, () => key() + ':' + value(d)).join(',') + '}';
  const kind = r.int(9);
  const n = r.int(8);
  switch (kind) {
    case 0:
    case 1:
    case 2:
      return '[' + Array.from({ length: n }, () => (r.chance(0.85) ? obj(1) : value(1))).join(',') + ']';
    case 3: {
      const w = 1 + r.int(4);
      const head = r.chance(0.5) ? '[' + Array.from({ length: w }, () => '"' + r.pick(STRS) + '"').join(',') + '],' : '';
      return '[' + head + Array.from({ length: n }, () => '[' + Array.from({ length: r.int(w + 1) }, () => (r.chance(0.8) ? scalar() : value(2))).join(',') + ']').join(',') + ']';
    }
    case 4:
      return '[' + Array.from({ length: n }, () => value(2)).join(',') + ']';
    case 5:
      return '{' + Array.from({ length: n }, () => key() + ':' + obj(1)).join(',') + '}';
    case 6:
      return '{' + Array.from({ length: n }, () => key() + ':' + value(1)).join(',') + '}';
    case 7:
      return '{"meta": ' + obj(1) + ', "data": [' + Array.from({ length: n }, () => obj(1)).join(',') + '], "more": {"items": [' + Array.from({ length: r.int(12) }, () => obj(1)).join(',') + ']}}';
    default:
      return r.chance(0.5) ? scalar() : genStrict(r, 3);
  }
}

/** The streamed CSV of bytes [a, e) (a container), both passes, chunks of random size. */
function streamed(r: Rng, bytes: Uint8Array, a: number, e: number, multi: boolean, o: CsvOptions): string {
  const walk = (v: Trees) => {
    const w = new Walker(v, { multi });
    let at = a;
    while (at < e) {
      const len = Math.min(e - at, 1 + r.int(r.pick([3, 64, 4096])));
      const b = bytes.slice(at, at + len);
      let i = 0;
      while (i < b.length) i = w.feed(b, at, i);
      at += len;
    }
    w.finish(e);
  };
  const scan = new CsvScan(o.flatten);
  const t1: Trees = new Trees((n) => scan.record(n, t1.rootKind));
  walk(t1);
  const plan = scan.plan(t1.rootKind);
  const out = new Bytes();
  const rows = new CsvRows(plan, out, o);
  walk(new Trees((n) => rows.record(n)));
  const sink = new MemorySink();
  void out.drain(sink);
  return sink.text();
}

function check(r: Rng, doc: string, name: string, o: CsvOptions): boolean {
  const bytes = enc.encode(doc);
  const text = new TextDecoder().decode(bytes);
  const res = parse(text, { lines: /\.jsonl$/.test(name) });
  if (res.error || !res.root || res.issues.some((x) => x.m !== 'Multiple top-level values (wrapped in an array)')) return false;
  const root = res.root;
  const rec: JNode = records(root);
  // (As a file holds it: UTF-8, a lone surrogate as U+FFFD, as a Blob of the normal path's text writes it.)
  const want = new TextDecoder('utf-8', { ignoreBOM: true }).decode(enc.encode(toCsv(rec, o)));
  const multi = res.multi || /\.jsonl$/.test(name);
  const byteOf = (s: number) => enc.encode(text.slice(0, s)).length;
  const whole = rec === root && multi;
  const got = whole ? streamed(r, bytes, 0, bytes.length, true, o) : streamed(r, bytes, byteOf(rec.s), byteOf(rec.e), false, o);
  if (got !== want) {
    let k = 0;
    while (k < got.length && got[k] === want[k]) k++;
    assert.fail(`options ${JSON.stringify(o)}\ndoc ${show(doc)}\nat ${k}: want ${show(want.slice(Math.max(0, k - 80), k + 200))}\ngot  ${show(got.slice(Math.max(0, k - 80), k + 200))}`);
  }
  return true;
}

test('csv: streamed CSV is toCsv(records(root)), byte for byte, on table-shaped documents', () => {
  const r = rng(SEED + 21);
  let checked = 0;
  for (let n = 0; n < 1500 * SCALE; n++) {
    const doc = csvDoc(r);
    const o: CsvOptions = { flatten: r.chance(0.8) ? 'dot' : 'json', delimiter: r.pick([',', ';', '\t'] as const), bom: r.chance(0.1) };
    if (check(r, doc, 'a.json', o)) checked++;
  }
  assert.ok(checked > 1000 * SCALE, `checked ${checked}`);
});

test('csv: and on the other documents (records, JSON Lines, anything)', () => {
  const r = rng(SEED + 22);
  let checked = 0;
  for (let n = 0; n < 300 * SCALE; n++) {
    const { doc, name } = docOf(r);
    if (check(r, doc, name, {})) checked++;
  }
  assert.ok(checked > 150 * SCALE, `checked ${checked}`);
});
