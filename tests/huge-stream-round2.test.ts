/**
 * Round 2 of the streamed commands: the independent review's scenarios (REVIEW-GPT.md items 5, 6, 9, 10, 11),
 * each reproduced first, then held as a regression test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDoc } from '../lib/json/format';
import { parse } from '../lib/json/parser';
import { runJob, type Outputs } from '../lib/huge/stream/jobs';
import { Bytes, MemorySink, type Sink } from '../lib/huge/stream/out';
import { condValueOf, filterOf, formValue, test as condTest, type Op } from '../lib/huge/stream/filter';
import { serve } from '../lib/huge/stream/serve';
import { StreamClient } from '../lib/huge/stream/client';
import { crc32, ZipWriter } from '../lib/huge/stream/sinks';
import { rng } from './oracle/compare';
import { enc } from './huge-oracle';

const mem = (b: Uint8Array) => ({ size: b.length, read: async (at: number, len: number) => b.slice(at, at + len) });

/** The most output a job ever had waiting for its sink (Bytes' queue, as the review's probe measured it). */
async function peakQueued(run: () => Promise<unknown>): Promise<number> {
  const proto = Bytes.prototype as unknown as { next(): void; queued: number };
  const old = proto.next;
  let peak = 0;
  proto.next = function (this: { queued: number }) {
    old.call(this);
    if (this.queued > peak) peak = this.queued;
  };
  try {
    await run();
  } finally {
    proto.next = old;
  }
  return peak;
}

/** A sink that keeps only how much it got. */
const counting = () => {
  const s = { bytes: 0, writes: 0, closed: false, aborted: false };
  const sink: Sink = {
    write: (b) => {
      s.bytes += b.length;
      s.writes++;
    },
    close: async () => void (s.closed = true),
    abort: async () => void (s.aborted = true),
  };
  return { s, sink };
};

/** Bound on what may wait for a sink: the pause threshold, plus one token's output and a block. */
const BOUND = 16 << 20;

test('item 5: Pretty of expansion-heavy input keeps its output queue bounded (the review: 42 MB queued from 42 KB)', async () => {
  const doc = '['.repeat(1000) + Array(20000).fill('0').join(',') + ']'.repeat(1000);
  const bytes = enc.encode(doc);
  const { s, sink } = counting();
  const outs: Outputs = { main: async () => sink, part: async () => sink };
  const peak = await peakQueued(() => runJob(mem(bytes), { kind: 'format', scope: { start: 0, end: bytes.length, multi: false }, indent: '  ' }, outs));
  const want = formatDoc(doc, parse(doc), '  ');
  assert.equal(s.bytes, enc.encode(want).length, 'all of it written');
  assert.ok(peak <= BOUND, `queued at most ${BOUND}, was ${peak}`);
  // Bigger still: 10× the values in the same input chunk.
  const doc2 = '['.repeat(1000) + Array(200000).fill('0').join(',') + ']'.repeat(1000);
  const b2 = enc.encode(doc2);
  const c2 = counting();
  const peak2 = await peakQueued(() => runJob(mem(b2), { kind: 'format', scope: { start: 0, end: b2.length, multi: false }, indent: '  ' }, { main: async () => c2.sink, part: async () => c2.sink }));
  assert.ok(c2.s.bytes > 400e6, `${c2.s.bytes} written`);
  assert.ok(peak2 <= BOUND, `queued at most ${BOUND}, was ${peak2}`);
});

test('item 5: Split of one record that expands is bounded too; the output is still exact', async () => {
  const rec = '['.repeat(500) + Array(40000).fill('1').join(',') + ']'.repeat(500);
  const doc = '[' + rec + ',' + rec + ']';
  const bytes = enc.encode(doc);
  const parts: MemorySink[] = [];
  const outs: Outputs = { main: async () => parts[0], part: async (k) => (parts[k] = new MemorySink()) };
  const peak = await peakQueued(() => runJob(mem(bytes), { kind: 'split', scope: { start: 0, end: bytes.length, multi: false }, per: 1, format: 'json', indent: '  ' }, outs));
  assert.equal(parts.length, 2);
  const one = '[' + rec + ']';
  assert.equal(parts[0].text(), formatDoc(one, parse(one), '  '));
  assert.ok(peak <= BOUND, `queued at most ${BOUND}, was ${peak}`);
});

test('item 5: a long string of control characters (six bytes out for each in) is written in bounded slices, exactly', async () => {
  const n = 12 << 20;
  const inner = new Uint8Array(n);
  // \u0001 written as one raw byte: invalid JSON (unescaped control): use \\u0001 escapes instead, 6 bytes in, 6 out; and
  // tabs as \t escapes (2 in, 2 out); and invalid UTF-8 bytes (1 in, 3 out).
  for (let i = 0; i < n; i++) inner[i] = i % 3 === 0 ? 0xff : 0x61;
  const head = enc.encode('["');
  const tail = enc.encode('", 1]');
  const bytes = new Uint8Array(head.length + n + tail.length);
  bytes.set(head);
  bytes.set(inner, head.length);
  bytes.set(tail, head.length + n);
  const out = new MemorySink();
  const peak = await peakQueued(() => runJob(mem(bytes), { kind: 'format', scope: { start: 0, end: bytes.length, multi: false }, indent: '' }, { main: async () => out, part: async () => out }));
  const want = '["' + new TextDecoder().decode(inner) + '",1]';
  assert.equal(out.text(), want);
  assert.ok(peak <= BOUND, `queued at most ${BOUND}, was ${peak}`);
});

test('item 5: Stop is seen during an expansion-heavy Pretty (between bounded amounts of output)', async () => {
  const doc = '['.repeat(1000) + Array(200000).fill('0').join(',') + ']'.repeat(1000);
  const bytes = enc.encode(doc);
  let stop = false;
  const { s, sink } = counting();
  const job = runJob(mem(bytes), { kind: 'format', scope: { start: 0, end: bytes.length, multi: false }, indent: '  ' }, { main: async () => sink, part: async () => sink }, { stopped: () => stop });
  // (A stop request is a message: it arrives in a task of its own.)
  const asked = new Promise<void>((r) => setTimeout(() => ((stop = true), r()), 5));
  await asked;
  await assert.rejects(job, (e: Error) => e.message === 'Stopped');
  assert.ok(s.aborted, 'the output was dropped');
  assert.ok(s.bytes < 400e6, `stopped early: ${s.bytes} written of ~400 MB`);
});

// ── Item 6: numbers in conditions compare exactly ───────────────────────────────

test('item 6: Extract with id = 9007199254740993 picks that record only (the review: both were written)', async () => {
  const s = '[{"id":9007199254740992},{"id":9007199254740993}]';
  const b = enc.encode(s);
  const f = filterOf({ conds: [{ path: 'id', op: 'eq', value: '9007199254740993' }], any: false });
  const out = new MemorySink();
  const r = await runJob(mem(b), { kind: 'extract', scope: { start: 0, end: b.length, multi: false }, filter: f, format: 'jsonl', indent: '' }, { main: async () => out, part: async () => out });
  assert.equal(out.text(), '{"id":9007199254740993}\n');
  assert.equal(r.records, 1);
  // ≠, < and > on the same pair.
  const rec = (t: string) => parse(t).root!;
  const one = rec('{"id":9007199254740993}');
  const two = rec('{"id":9007199254740992}');
  const c = (op: Op, v: string) => filterOf({ conds: [{ path: 'id', op, value: v }], any: false })!.conds[0];
  assert.ok(condTest(two, c('ne', '9007199254740993')) && !condTest(one, c('ne', '9007199254740993')));
  assert.ok(condTest(two, c('lt', '9007199254740993')) && !condTest(one, c('lt', '9007199254740993')));
  assert.ok(condTest(one, c('gt', '9007199254740992')) && !condTest(two, c('gt', '9007199254740992')));
});

test('item 6: decimals, exponents, zeros and signs compare as the numbers they write', () => {
  const rec = (t: string) => parse(`{"v":${t}}`).root!;
  const c = (op: Op, v: string) => filterOf({ conds: [{ path: 'v', op, value: v }], any: false })!.conds[0];
  const eq = [
    ['100', '1e2'],
    ['1.50', '1.5'],
    ['0', '-0'],
    ['0.0', '0e10'],
    ['12345678901234567890123', '1.2345678901234567890123e22'],
    ['-0.000001', '-1E-6'],
    ['1e400', '10e399'],
  ];
  for (const [a, b] of eq) assert.ok(condTest(rec(a), c('eq', b)), `${a} = ${b}`);
  const lt = [
    ['0.1', '0.1000000000000000055511151231257827'],
    ['1e399', '1e400'],
    ['-1e400', '-1e399'],
    ['9007199254740992', '9007199254740993'],
    ['-9007199254740993', '-9007199254740992'],
    ['1.0000000000000000000001', '1.0000000000000000000002'],
    ['-0.5', '0'],
    ['0', '5e-324'],
    ['5e-325', '5e-324'],
  ];
  for (const [a, b] of lt) {
    assert.ok(condTest(rec(a), c('lt', b)), `${a} < ${b}`);
    assert.ok(!condTest(rec(a), c('eq', b)), `${a} ≠ ${b}`);
    assert.ok(condTest(rec(b), c('gt', a)), `${b} > ${a}`);
    assert.ok(condTest(rec(a), c('le', b)) && !condTest(rec(a), c('ge', b)), `${a} ≤ ${b}`);
  }
});

test('item 6: ordering agrees with exact arithmetic on random numbers', () => {
  const r = rng(61);
  // value × 10^60 as a BigInt (exponents kept within ±30).
  const exact = (t: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([-+]?\d+))?$/.exec(t)!;
    const frac = m[3] ?? '';
    const e = Number(m[4] ?? 0) - frac.length + 60;
    let v = BigInt(m[2] + frac);
    v = e >= 0 ? v * 10n ** BigInt(e) : v / 10n ** BigInt(-e);
    return m[1] ? -v : v;
  };
  const num = () => {
    const ip = r.chance(0.3) ? '0' : String(1 + r.int(9)) + Array.from({ length: r.int(22) }, () => r.int(10)).join('');
    const fp = r.chance(0.5) ? '.' + Array.from({ length: 1 + r.int(12) }, () => r.int(10)).join('') : '';
    const ep = r.chance(0.4) ? 'e' + (r.chance(0.5) ? '-' : '') + r.int(25) : '';
    return (r.chance(0.3) ? '-' : '') + ip + fp + ep;
  };
  for (let k = 0; k < 5000; k++) {
    const a = num();
    // (Often a neighbour: the same digits with one changed, where rounding to a double would make them equal.)
    const near = () => {
      const m = /^(-?)(\d+)(.*)$/.exec(a)!;
      const ds = m[2].split('');
      const k = Math.max(0, ds.length - 1 - r.int(3));
      ds[k] = String((Number(ds[k]) + 1 + r.int(8)) % 10);
      if (ds.length > 1 && ds[0] === '0') ds[0] = '1';
      return m[1] + ds.join('') + m[3];
    };
    const b = r.chance(0.1) ? a : r.chance(0.5) ? near() : num();
    const want = exact(a) < exact(b) ? -1 : exact(a) > exact(b) ? 1 : 0;
    const node = parse(`{"v":${a}}`).root!;
    const cond = (op: Op) => filterOf({ conds: [{ path: 'v', op, value: b }], any: false })!.conds[0];
    assert.equal(condTest(node, cond('lt')), want < 0, `${a} < ${b}`);
    assert.equal(condTest(node, cond('eq')), want === 0, `${a} = ${b}`);
    assert.equal(condTest(node, cond('gt')), want > 0, `${a} > ${b}`);
  }
});

test('item 6: the Shape panel hands a big number to Extract as written', () => {
  // (Its common values are text as written; the Convert form gets that text, and its filter compares it exactly.)
  const conds = [{ path: ['id'], op: 'eq' as const, value: condValueOf('9007199254740993') }];
  const form = conds.map((x) => formValue(x.value));
  assert.deepEqual(form, ['9007199254740993']);
  const f = filterOf({ conds: [{ path: 'id', op: 'eq', value: form[0] }], any: false })!;
  assert.ok(condTest(parse('{"id":9007199254740993}').root!, f.conds[0]));
  assert.ok(!condTest(parse('{"id":9007199254740992}').root!, f.conds[0]));
  // A string that reads as a number stays a string.
  assert.equal(formValue('12'), '"12"');
  assert.equal(filterOf({ conds: [{ path: 'id', op: 'eq', value: formValue('12') }], any: false })!.conds[0].value, '12');
});

// ── Items 9, 10: ZIP Split cleans up after itself and keeps no per-part memory ──

/** An OPFS in memory that, like the browser, won't delete a file while an access handle on it is open. */
function mockOpfs() {
  const files = new Map<string, { data: Uint8Array; size: number; open: number }>();
  const stats = { removed: 0, refused: 0, maxOpen: 0 };
  const opened = () => [...files.values()].reduce((n, f) => n + f.open, 0);
  const fileHandle = (name: string) => ({
    kind: 'file',
    async createSyncAccessHandle() {
      const f = files.get(name)!;
      f.open++;
      stats.maxOpen = Math.max(stats.maxOpen, opened());
      let closed = false;
      return {
        truncate(n: number) {
          f.size = Math.min(f.size, n);
        },
        getSize: () => f.size,
        write(b: Uint8Array, o: { at: number }) {
          if (o.at + b.length > f.data.length) {
            const g = new Uint8Array(Math.max(f.data.length * 2, o.at + b.length));
            g.set(f.data.subarray(0, f.size));
            f.data = g;
          }
          f.data.set(b, o.at);
          f.size = Math.max(f.size, o.at + b.length);
          return b.length;
        },
        read(b: Uint8Array, o: { at: number }) {
          const n = Math.max(0, Math.min(b.length, f.size - o.at));
          b.set(f.data.subarray(o.at, o.at + n));
          return n;
        },
        flush() {},
        close() {
          if (!closed) f.open--;
          closed = true;
        },
      };
    },
    async getFile() {
      const f = files.get(name)!;
      return new File([f.data.slice(0, f.size)], name);
    },
  });
  const dir = {
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!o?.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, { data: new Uint8Array(1024), size: 0, open: 0 });
      }
      return fileHandle(name);
    },
    async removeEntry(name: string) {
      const f = files.get(name);
      if (!f) throw new DOMException('Not found', 'NotFoundError');
      if (f.open) {
        stats.refused++;
        throw new DOMException('Handle still open', 'NoModificationAllowedError');
      }
      files.delete(name);
      stats.removed++;
    },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) } } });
  const restore = () => {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
  };
  return { files, stats, opened, restore };
}

/** A stream client and its worker side in process (messages a task apart, as postMessage). */
function streamPair() {
  const page: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = { onmessage: null, postMessage: (m) => setImmediate(() => worker.onmessage?.({ data: m })) };
  const worker: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = { onmessage: null, postMessage: (m) => setImmediate(() => page.onmessage?.({ data: m })) };
  serve(worker);
  return { client: new StreamClient(page), worker };
}

/** The entries of a ZIP64 archive written by ZipWriter: names and contents. */
function unzip(z: Uint8Array): { name: string; data: string; crcOk: boolean }[] {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  const z64 = Number(v.getBigUint64(eocd - 20 + 8, true));
  assert.equal(v.getUint32(z64, true), 0x06064b50);
  const count = Number(v.getBigUint64(z64 + 32, true));
  let at = Number(v.getBigUint64(z64 + 48, true));
  const out = [];
  for (let k = 0; k < count; k++) {
    assert.equal(v.getUint32(at, true), 0x02014b50, `central record ${k}`);
    const n = v.getUint16(at + 28, true);
    const x = v.getUint16(at + 30, true);
    const crc = v.getUint32(at + 16, true);
    const name = new TextDecoder().decode(z.subarray(at + 46, at + 46 + n));
    const size = Number(v.getBigUint64(at + 46 + n + 4, true));
    const local = Number(v.getBigUint64(at + 46 + n + 20, true));
    const ln = v.getUint16(local + 26, true);
    const lx = v.getUint16(local + 28, true);
    const data = z.subarray(local + 30 + ln + lx, local + 30 + ln + lx + size);
    out.push({ name, data: new TextDecoder().decode(data), crcOk: crc32(data) === crc && v.getUint32(local + 14, true) === crc });
    at += 46 + n + x;
  }
  return out;
}

const split = (file: Blob, per = 1) => ({ kind: 'split' as const, scope: { start: 0, end: file.size, multi: false }, per, format: 'jsonl' as const, indent: '' });
const zipOut = { kind: 'zip' as const, name: 'probe.zip', names: 'part-{n}.jsonl', gzip: false };

test('item 9: a ZIP Split stopped before its first entry closes its files and deletes them (the review: 1 handle left open)', async () => {
  const fs = mockOpfs();
  try {
    const { client, worker } = streamPair();
    const file = new Blob(['[1,2,3]']);
    const run = client.run(file, 0, split(file), zipOut);
    // (Stopped at once, as the review's probe did: before any input is read.)
    worker.onmessage?.({ data: { id: 2, op: 'stop', target: 1 } });
    await assert.rejects(run.done, (e: Error) => e.message === 'Stopped');
    assert.equal(fs.opened(), 0, 'no access handle left open');
    assert.deepEqual([...fs.files.keys()], [], 'no file left');
    client.close();
  } finally {
    fs.restore();
  }
});

test('item 9: a ZIP Split that fails part-way (invalid JSON after some parts) leaves nothing behind', async () => {
  const fs = mockOpfs();
  try {
    const { client } = streamPair();
    const file = new Blob(['[' + Array.from({ length: 500 }, (_, i) => `{"i":${i}}`).join(',') + ',}]']);
    await assert.rejects(client.run(file, 0, split(file, 7), zipOut).done, (e: Error) => e.message === 'Invalid JSON');
    assert.equal(fs.opened(), 0, 'no access handle left open');
    assert.deepEqual([...fs.files.keys()], [], 'no file left');
    client.close();
  } finally {
    fs.restore();
  }
});

test('item 10: a ZIP Split of 20,000 parts keeps no per-part memory; the archive (and only it) is left, complete', async () => {
  const fs = mockOpfs();
  try {
    const { client } = streamPair();
    const n = 20_000;
    const lines = Array.from({ length: n }, (_, i) => `{"i":${i},"s":"é${i}"}`);
    const file = new Blob(['[' + lines.join(',') + ']']);
    const { result, file: zip } = await client.run(file, 0, split(file), zipOut).done;
    assert.equal(result.parts, n);
    assert.equal(fs.opened(), 0, 'every handle closed');
    assert.deepEqual([...fs.files.keys()], ['probe.zip'], 'the central directory spool is gone');
    const entries = unzip(new Uint8Array(await zip!.arrayBuffer()));
    assert.equal(entries.length, n);
    for (let k = 0; k < n; k += 997) {
      assert.equal(entries[k].name, `part-${String(k + 1).padStart(4, '0')}.jsonl`);
      assert.equal(entries[k].data, lines[k] + '\n');
      assert.ok(entries[k].crcOk, `crc ${k}`);
    }
    client.close();
  } finally {
    fs.restore();
  }
  // The writer itself: nothing that grows with the entries (the review: an array of every part's metadata).
  const f = { name: 'z', size: 0, write(b: Uint8Array) { this.size += b.length; }, writeAt() {}, readAt: () => 0, close: async () => {}, abort: async () => {}, file: async () => new File([], 'z') };
  const spool = { ...f, name: 'z.cd', size: 0, write(b: Uint8Array) { this.size += b.length; } };
  const zw = new ZipWriter(f, spool);
  for (let k = 0; k < 5000; k++) {
    const e = zw.entry(`p${k}`);
    await e.write(new Uint8Array([k & 255]));
    await e.close();
  }
  for (const v of Object.values(zw)) {
    if (Array.isArray(v) || v instanceof Map || v instanceof Set) assert.ok((v as { length?: number; size?: number }).length ?? (v as { size: number }).size < 5000, 'no collection per entry');
  }
  assert.ok(spool.size > 5000 * 46, 'its central directory went to the spool');
});
