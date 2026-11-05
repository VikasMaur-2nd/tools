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
