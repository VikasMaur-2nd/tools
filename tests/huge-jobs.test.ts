import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDoc } from '../lib/json/format';
import { kids, parse, type JNode } from '../lib/json/parser';
import { toJSONL } from '../lib/convert/data';
import { runJob, type Job, type Outputs } from '../lib/huge/stream/jobs';
import { MemorySink } from '../lib/huge/stream/out';
import { syncSource, type Source } from '../lib/huge/stream/pass';
import { matches, test as condTest, valueOf, type Filter } from '../lib/huge/stream/filter';
import { pathText, K_OBJ, K_STR } from '../lib/huge/stream/shape';
import { gzipSink, ZipWriter, crc32 } from '../lib/huge/stream/sinks';
import { rng, type Rng } from './oracle/compare';
import { enc } from './huge-oracle';
import { docOf } from './huge-stream-oracle';
import { LongString, Records } from './huge-sources';
import { gunzipSync } from 'node:zlib';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

const mem = (b: Uint8Array): Source => ({ size: b.length, read: async (at, len) => b.slice(at, at + len) });

/** Outputs kept in memory: the main one and each part. */
function memOuts() {
  const main = new MemorySink();
  const parts: MemorySink[] = [];
  const outs: Outputs = {
    main: async () => main,
    part: async (k) => (parts[k] = new MemorySink()),
  };
  return { main, parts, outs };
}

/** A document, parsed as the normal path does, with its records container's range in bytes. */
function caseOf(r: Rng) {
  for (;;) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(doc);
    const text = new TextDecoder().decode(bytes);
    const res = parse(text, { lines: /\.jsonl$/.test(name) });
    if (res.error || !res.root || res.issues.some((x) => x.m !== 'Multiple top-level values (wrapped in an array)')) continue;
    const multi = res.multi || /\.jsonl$/.test(name);
    const byteOf = (s: number) => enc.encode(text.slice(0, s)).length;
    return { doc, bytes, text, res, root: res.root, multi, byteOf };
  }
}

/** A filter on the generated records' fields. */
function filterOf(r: Rng): Filter {
  const conds = Array.from({ length: 1 + r.int(2) }, () => {
    const k = r.int(6);
    if (k === 0) return { path: ['id'], op: r.pick(['lt', 'ge', 'gt', 'le'] as const), value: r.int(1000) };
    if (k === 1) return { path: ['v'], op: 'contains' as const, value: String(r.int(10)) };
    if (k === 2) return { path: ['x'], op: 'is' as const, value: r.pick(['object', 'array', 'string', 'number', 'null']) };
    if (k === 3) return { path: ['x', '*'], op: 'exists' as const };
    if (k === 4) return { path: ['x', 'name'], op: 'missing' as const };
    return { path: ['v'], op: 'eq' as const, value: 's' + r.int(100) };
  });
  return { conds, any: r.chance(0.3) };
}

test('jobs: extract, split and JSON Lines write what the normal path writes for the same records', async () => {
  const r = rng(SEED + 31);
  for (let n = 0; n < 120 * SCALE; n++) {
    const c = caseOf(r);
    const where = `\ndoc ${show(c.doc)}`;
    const root = c.root;
    if (root.t !== 4) continue;
    const scope = { start: 0, end: c.bytes.length, multi: c.multi };
    const items = kids(root);
    const src = (start: number, e: number) => c.text.slice(0, 0) + items.slice(start, e).map((x) => c.text.slice(x.s, x.e)).join(',');
    // Extract with a filter and a limit.
    const filter = r.chance(0.8) ? filterOf(r) : null;
    const limit = r.chance(0.3) ? r.int(5) : undefined;
    const indent = r.pick(['  ', '', '\t']);
    const format = r.pick(['json', 'jsonl'] as const);
    let picked = items.filter((x) => matches(x, filter));
    if (limit !== undefined) picked = picked.slice(0, limit);
    const arr = '[' + picked.map((x) => c.text.slice(x.s, x.e)).join(',') + ']';
    const want = format === 'json' ? formatDoc(arr, parse(arr), indent) : toJSONL(parse(arr).root!);
    const o = memOuts();
    const res = await runJob(mem(c.bytes), { kind: 'extract', scope, filter, limit, format, indent }, o.outs, { chunk: 1 + r.int(64) });
    assert.equal(o.main.text(), want, `extract ${JSON.stringify({ filter, limit, format, indent })}${where}`);
    assert.equal(res.records, picked.length);
    // Split: each part is the normal path's text of its records; together, every record.
    const per = 1 + r.int(5);
    const s = memOuts();
    const sres = await runJob(mem(c.bytes), { kind: 'split', scope, per, format, indent }, s.outs, { chunk: 1 + r.int(64) });
    assert.equal(sres.parts, Math.ceil(items.length / per), `parts${where}`);
    for (let k = 0; k < sres.parts; k++) {
      const part = '[' + src(k * per, (k + 1) * per) + ']';
      const pw = format === 'json' ? formatDoc(part, parse(part), indent) : toJSONL(parse(part).root!);
      assert.equal(s.parts[k].text(), pw, `split part ${k}${where}`);
      assert.ok(s.parts[k].closed);
    }
    // JSON Lines.
    const l = memOuts();
    await runJob(mem(c.bytes), { kind: 'lines', scope }, l.outs, { chunk: 1 + r.int(64) });
    assert.equal(l.main.text(), toJSONL(root), `lines${where}`);
  }
});

test('jobs: a part may end at a size; a selected value is formatted on its own', async () => {
  const doc = '{"meta": {"a": [1, 2]}, "records": [' + Array.from({ length: 50 }, (_, i) => `{"i": ${i}, "s": "${'x'.repeat(i)}"}`).join(', ') + ']}';
  const bytes = enc.encode(doc);
  const at = doc.indexOf('[{');
  const end = doc.lastIndexOf(']') + 1;
  const scope = { start: at, end, multi: false };
  const s = memOuts();
  const res = await runJob(mem(bytes), { kind: 'split', scope, bytes: 300, format: 'jsonl', indent: '' }, s.outs);
  const all = s.parts.map((p) => p.text()).join('');
  assert.equal(all, toJSONL(parse(doc.slice(at, end)).root!));
  for (const p of s.parts.slice(0, -1)) assert.ok(p.bytes().length >= 300 && p.bytes().length < 300 + 80);
  assert.equal(res.records, 50);
  const f = memOuts();
  await runJob(mem(bytes), { kind: 'format', scope: { start: doc.indexOf('{"a"'), end: doc.indexOf('}, "records"') + 1, multi: false }, indent: '  ' }, f.outs);
  assert.equal(f.main.text(), '{\n  "a": [\n    1,\n    2\n  ]\n}');
});

test('jobs: Seek finds the next value of a kind, the next object lacking a member, and counts them', async () => {
  const recs = ['{"a": 1, "e": "x"}', '{"a": 2}', '{"a": "three", "e": null}', '{"e": "y"}', '{"a": 5}'];
  const doc = '[' + recs.join(',') + ']';
  const bytes = enc.encode(doc);
  const scope = { start: 0, end: bytes.length, multi: false };
  const starts = recs.map((x) => doc.indexOf(x));
  const seek = async (target: Job & { kind: 'seek' }) => (await runJob(mem(bytes), target)).seek!;
  // Missing "e": records 1 and 4.
  let s = await seek({ kind: 'seek', scope, target: { path: ['*', 'e'], missing: true }, from: 0 });
  assert.equal(s.first, starts[1]);
  s = await seek({ kind: 'seek', scope, target: { path: ['*', 'e'], missing: true }, from: starts[1] + 1 });
  assert.equal(s.first, starts[4]);
  s = await seek({ kind: 'seek', scope, target: { path: ['*', 'e'], missing: true }, from: 0, count: true });
  assert.equal(s.found, 2);
  // A string "a": record 2's value.
  s = await seek({ kind: 'seek', scope, target: { path: ['*', 'a'], kind: K_STR }, from: 0 });
  assert.equal(s.first, doc.indexOf('"three"'));
  // From inside the array (the next record's start), as a list of its records.
  s = await seek({ kind: 'seek', scope: { start: starts[2], end: doc.length - 1, multi: true }, target: { path: ['*', 'a'], kind: K_OBJ }, from: 0, count: true });
  assert.equal(s.found, 0);
});

test('filter: conditions as typed', () => {
  const rec = parse('{"id": 7, "name": "Ada Lovelace", "tags": ["x", "y"], "n": null, "at": "2024-05-01", "big": 12345678901234567890, "o": {"k": true}}').root!;
  const t = (path: (string | number)[], op: Parameters<typeof condTest>[1]['op'], value?: string) => condTest(rec, { path, op, value: value === undefined ? undefined : valueOf(value) });
  assert.ok(t(['id'], 'eq', '7'));
  assert.ok(t(['id'], 'lt', '8') && !t(['id'], 'gt', '7') && t(['id'], 'ge', '7'));
  assert.ok(t(['name'], 'contains', 'love'));
  assert.ok(!condTest(rec, { path: ['name'], op: 'contains', value: 'love', caseSensitive: true }));
  assert.ok(t(['name'], 'starts', 'ada'));
  assert.ok(t(['tags', '*'], 'eq', 'y') && !t(['tags', '*'], 'eq', 'z'));
  assert.ok(t(['tags', 1], 'eq', 'y'));
  assert.ok(t(['n'], 'eq', 'null') && t(['n'], 'is', 'null'));
  assert.ok(t(['missing'], 'missing') && !t(['id'], 'missing'));
  assert.ok(t(['at'], 'ge', '2024-01-01') && t(['at'], 'lt', '"2025"'));
  assert.ok(t(['o', 'k'], 'eq', 'true'));
  assert.ok(t(['big'], 'eq', '12345678901234567890'));
  assert.ok(t(['name'], 'ne', 'Bob') && !t(['nope'], 'ne', 'x'));
  assert.ok(matches(rec, { conds: [{ path: ['id'], op: 'eq', value: 1 }, { path: ['id'], op: 'eq', value: 7 }], any: true }));
  assert.ok(!matches(rec, { conds: [{ path: ['id'], op: 'eq', value: 1 }, { path: ['id'], op: 'eq', value: 7 }] }));
  assert.equal(valueOf('"7"'), '7');
});

test('sinks: gzip output decompresses to the bytes written; a ZIP64 archive of parts', async () => {
  const inner = new MemorySink();
  const g = gzipSink(inner);
  const data = enc.encode('hello '.repeat(100_000));
  for (let at = 0; at < data.length; at += 7777) await g.write(data.slice(at, at + 7777));
  await g.close();
  assert.ok(inner.closed);
  assert.deepEqual(new Uint8Array(gunzipSync(inner.bytes())), data);
  // A zip of two entries, read back by its central directory.
  let all = new Uint8Array(1 << 16);
  const f = {
    name: 'z',
    size: 0,
    write(b: Uint8Array) {
      all.set(b, f.size);
      f.size += b.length;
    },
    writeAt(b: Uint8Array, at: number) {
      all.set(b, at);
    },
    close: async () => {},
    abort: async () => {},
    file: async () => new File([], 'z'),
  };
  const zip = new ZipWriter(f);
  for (const [name, text] of [['a.jsonl', '{"a":1}\n'], ['b.jsonl', 'é'.repeat(1000)]]) {
    const e = zip.entry(name);
    await e.write(enc.encode(text));
    await e.close();
  }
  await zip.close();
  all = all.slice(0, f.size);
  // End of central directory: entries and the ZIP64 record.
  const v = new DataView(all.buffer);
  assert.equal(v.getUint32(all.length - 22, true), 0x06054b50);
  assert.equal(v.getUint32(all.length - 22 - 20, true), 0x07064b50);
  const cdAt = Number(v.getBigUint64(all.length - 22 - 20 - 56 + 48, true));
  assert.equal(v.getUint32(cdAt, true), 0x02014b50);
  // The first local header: CRC and sizes patched in.
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), crc32(enc.encode('{"a":1}\n')));
  assert.equal(Number(v.getBigUint64(30 + 7 + 4, true)), 8);
});

test('jobs: 2.2 GB of JSON Lines made on the fly: Shape, Split by size and CSV in constant memory', async () => {
  const src = new Records(27_000_000, -1, true);
  assert.ok(src.size > 2.1e9);
  const scope = { start: 0, end: src.size, multi: true };
  const heap0 = process.memoryUsage().rss;
  let peak = heap0;
  const watch = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 200);
  try {
    const t0 = performance.now();
    const shape = (await runJob(syncSource(src), { kind: 'shape', scope })).shape!;
    const ms = performance.now() - t0;
    assert.equal(shape.records, 27_000_000);
    const byPath = new Map(shape.paths.map((p) => [pathText(shape, p), p]));
    assert.equal(byPath.get('$[*].id')!.n, 27_000_000);
    assert.equal(byPath.get('$[*].id')!.num!.max, 26_999_999);
    assert.ok(Math.abs(byPath.get('$[*].id')!.distinct - 27e6) / 27e6 < 0.05);
    assert.equal(byPath.get('$[*].tags[*]')!.n, 108_000_000);
    console.log(`shape: ${(src.size / 1e6 / (ms / 1000)).toFixed(0)} MB/s`);
    // Split by ~512 MB: each part a sink that only counts.
    let parts = 0;
    let bytes = 0;
    const counting = {
      main: async () => {
        throw new Error('no');
      },
      part: async () => {
        parts++;
        return { write: (b: Uint8Array) => void (bytes += b.length), close: async () => {}, abort: async () => {} };
      },
    };
    const t1 = performance.now();
    const res = await runJob(syncSource(src), { kind: 'split', scope, bytes: 512 << 20, format: 'jsonl', indent: '' }, counting);
    console.log(`split: ${(src.size / 1e6 / ((performance.now() - t1) / 1000)).toFixed(0)} MB/s`);
    assert.equal(res.records, 27_000_000);
    assert.equal(parts, Math.ceil(bytes / (512 << 20)));
    // (Minified: an id's padding spaces go, the name's stay; a line each.)
    let digits = 0;
    for (let d = 1, lo = 0; lo < 27_000_000; d++) {
      const hi = Math.min(27_000_000, 10 ** d);
      digits += (hi - lo) * d;
      lo = hi;
    }
    assert.equal(bytes, 27_000_000 * (src.len - 12 + 1) + digits);
  } finally {
    clearInterval(watch);
  }
  assert.ok(peak - heap0 < 400 << 20, `rss grew ${((peak - heap0) / 2 ** 20).toFixed(0)} MiB`);
});

test('jobs: a 300 MB string is written whole in parts (Pretty), and cut in the shape', async () => {
  const src = new LongString(300_000_000);
  const scope = { start: 0, end: src.size, multi: false };
  let n = 0;
  let head = '';
  let tail = new Uint8Array(0);
  const outs = {
    main: async () => ({
      write: (b: Uint8Array) => {
        if (head.length < 20) head = (head + new TextDecoder().decode(b.subarray(0, 20))).slice(0, 20);
        n += b.length;
        tail = b.slice(-40);
      },
      close: async () => {},
      abort: async () => {},
    }),
    part: async () => {
      throw new Error('no');
    },
  };
  await runJob(syncSource(src), { kind: 'format', scope, indent: '  ' }, outs);
  assert.equal(head, '{\n  "a": "xxxxxxxxxx');
  assert.equal(n, '{\n  "a": "'.length + 300_000_000 + '",\n  "b": [\n    1,\n    2\n  ]\n}'.length);
  assert.ok(new TextDecoder().decode(tail).endsWith('    2\n  ]\n}'));
  const shape = (await runJob(syncSource(src), { kind: 'shape', scope })).shape!;
  const a = shape.paths.find((p) => p.key === 'a')!;
  assert.equal(a.str!.max, 300_000_000);
  assert.ok(a.examples[0][0].endsWith('…"'));
});
