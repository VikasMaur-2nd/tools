/**
 * A broken document's raw lines past its error (UI-NOTES 21, REVIEW-2 #6): once all read, the bytes are all there,
 * so raw lines go on to the file's end (never `cut` 2), the error's line comes whole with the error marked, its
 * lines are counted to the end (in steps: `counting`, then a summary), and lineAt answers anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { HugeDoc } from '../lib/huge/doc';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import type { HugeSummary } from '../lib/huge/types';
import { hugeMod, memSource, tapeMod } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();
const parsers = { wasm: tapeMod, parse };

/** The document's raw lines as the normal path splits them (\r\n, \r, \n), and where each starts. */
function linesOf(text: string): { text: string[]; pos: number[] } {
  const out: string[] = [];
  const pos: number[] = [];
  let at = 0;
  let byte = 0;
  const re = /\r\n|\r|\n/g;
  for (let m = re.exec(text); ; m = re.exec(text)) {
    const end = m ? m.index : text.length;
    out.push(text.slice(at, end));
    pos.push(byte);
    if (!m) break;
    byte += enc.encode(text.slice(at, end)).length + m[0].length;
    at = end + m[0].length;
  }
  return { text: out, pos };
}

function broken(nl: string, after: number): string {
  // An error on line 3, then `after` lines of records (some long) to the end.
  const head = `[${nl}{"ok": 1},${nl}{"bad": tru e},${nl}`;
  return head + Array.from({ length: after }, (_, i) => JSON.stringify({ id: i, s: 'x'.repeat(i % 200) })).join(`,${nl}`) + `${nl}]${nl}`;
}

function check(d: HugeDoc, text: string, where: string) {
  const want = linesOf(text);
  const s = d.summary();
  assert.ok(s.error, 'broken' + where);
  assert.equal(s.counting ?? false, false, 'all counted' + where);
  assert.equal(s.lines, want.text.length, 'lines: the whole file\'s' + where);
  // All the raw lines, in batches across the error and past it.
  for (let from = 0; from < want.text.length; from += 97) {
    const r = d.rawLines(from, 97, 1 << 16);
    assert.deepEqual(r.text, want.text.slice(from, from + 97), `lines from ${from}` + where);
    assert.deepEqual(Array.from(r.pos), want.pos.slice(from, from + 97), `starts from ${from}` + where);
    assert.ok(!Array.from(r.cut).includes(2), 'never cut 2 once all read' + where);
    // The error's line: marked, where on it.
    const e: { pos: number } = s.error!;
    const k = want.pos.findIndex((p, j) => e.pos >= p && (j + 1 >= want.pos.length || e.pos < want.pos[j + 1]));
    if (k >= from && k < from + 97) assert.deepEqual(r.error, { line: k - from, byte: e.pos - want.pos[k] }, 'the error marked' + where);
    else assert.equal(r.error, undefined);
  }
  // lineAt, anywhere: before the error, at it, past it, at every line start and a byte into each.
  for (let j = 0; j < want.pos.length; j += 7) {
    assert.equal(d.lineAt(want.pos[j]), j, `lineAt line ${j} start` + where);
    if (want.text[j].length > 2) assert.equal(d.lineAt(want.pos[j] + 2), j, `lineAt in line ${j}` + where);
  }
}

test('lines past the error: all of them, the error marked, counted to the end, lineAt anywhere (\\n, \\r\\n, \\r)', () => {
  for (const nl of ['\n', '\r\n', '\r']) {
    const text = broken(nl, 3000);
    const d = new HugeDoc(Object.assign(memSource(enc.encode(text)), { cached: true }), hugeMod, parsers, { every: 256, big: 1 << 12 }, { window: 64, queryWindow: 64 });
    d.step(Infinity);
    assert.equal(d.summary().counting, true, 'counting on after the error');
    while (!d.stepLines(0));
    check(d, text, ` (${JSON.stringify(nl)})`);
  }
});

test('lines past the error: a sample where a \\r\\n is cut by a read (1 MiB), and lines far past it', () => {
  // The error at byte 0; byte 2^20 - 1 a \r, 2^20 its \n: the count's first read ends between them.
  const first = 'x' + 'a'.repeat((1 << 20) - 2);
  const rest = Array.from({ length: 40000 }, (_, i) => 'line ' + i + ' ' + 'b'.repeat(i % 90)).join('\r\n');
  const text = first + '\r\n' + rest + '\r\n';
  const d = new HugeDoc(Object.assign(memSource(enc.encode(text)), { cached: true }), hugeMod, parsers, {}, {});
  d.step(Infinity);
  while (!d.stepLines(0));
  const want = linesOf(text);
  assert.equal(d.summary().lines, want.text.length);
  for (const from of [0, 1, 2, 5000, 20000, 39990]) {
    const r = d.rawLines(from, 12, 1 << 21);
    assert.deepEqual(r.text, want.text.slice(from, from + 12), `lines from ${from}`);
  }
  for (const j of [0, 1, 2, 777, 20001, 39999]) assert.equal(d.lineAt(want.pos[j] + 1), j, `lineAt ${j}`);
  assert.equal(d.lineAt((1 << 20) - 1), 0, 'the \\r ends line 0');
});

function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

test('lines past the error through the worker: counted in steps, a summary when all are, lineOf raw anywhere; an edit counts again', async () => {
  const text = broken('\n', 20000);
  const bytes = enc.encode(text);
  const [page, worker] = channel();
  serve(worker, async () => ({ huge: hugeMod, parsers }), () => Object.assign(memSource(bytes), { cached: true }));
  const blob = new Blob([bytes as BlobPart]);
  const client = new HugeClient(blob, { name: 'a.json' }, undefined, page);
  const want = linesOf(text);
  const counted = new Promise<HugeSummary>((done) => (client.onSummary = (s) => !s.counting && done(s)));
  const s0 = await client.ready;
  assert.ok(s0.error);
  const s1 = s0.counting ? await counted : s0;
  assert.equal(s1.lines, want.text.length);
  assert.equal(await client.lineAt(want.pos[15000] + 3), 15000);
  const src = new CoreSource(blob, 'a.json', () => client);
  assert.equal(await src.lineOf('raw', want.pos[19000]), 19000);
  const lines = await src.lines('raw', 2, 3, 200, '  ');
  assert.equal(lines[0].text, '{"bad": tru e},');
  assert.ok(lines.every((l) => !l.reading));
  // Fixed by an edit: valid, its lines the index's again.
  const at = text.indexOf('tru e');
  const fixed = await client.replace([{ a: at, b: at + 5, text: 'true' }]);
  const s2 = fixed.summary ?? (await new Promise<HugeSummary>((done) => (client.onSummary = done)));
  assert.equal(s2.error, null);
  assert.equal(s2.lines, want.text.length);
  await client.close();
});

test('lines past the error: an edit on a broken document reads and counts again (the line count follows)', () => {
  const text = broken('\n', 500);
  const d = new HugeDoc(Object.assign(memSource(enc.encode(text)), { cached: true }), hugeMod, parsers, { every: 256, big: 1 << 12 }, { window: 64, queryWindow: 64 });
  d.step(Infinity);
  while (!d.stepLines(0));
  const ed = new HugeEditor(d);
  // Two lines more, past the error.
  const at = text.indexOf('{"id":300,');
  ed.apply([{ a: at, b: at, put: piecesOf(enc.encode('\n\n')) }]);
  d.step(Infinity);
  while (!d.stepLines(0));
  const now = dec.decode(d.src.read(0, d.src.size));
  check(d, now, ' (edited)');
});
