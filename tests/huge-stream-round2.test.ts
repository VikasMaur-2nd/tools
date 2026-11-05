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
