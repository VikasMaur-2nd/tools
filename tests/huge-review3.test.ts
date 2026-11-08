/**
 * The third review's core findings (REVIEW-3.md), each from its probe:
 * C3. names alike once decoded (invalid bytes as U+FFFD) are duplicates, as the normal path warns;
 * D5. a raw line number far past a broken document's error (more than the 2 MiB the UI's fallback read).
 * (Sessions: B1, C2, C5, C6, C8, D3, D4 in huge-sessions.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import type { HugeSummary } from '../lib/huge/types';
import { hugeMod, hugeOf, memSource, pageText, tapeMod } from './huge-oracle';

const enc = new TextEncoder();
const cat = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(out);
};

/** The normal path's duplicate-name warnings: their messages. */
const normalDups = (bytes: Uint8Array) => parse(pageText(bytes)).head.warnings.map((w) => w.m);

test('C3: names alike once decoded (an invalid byte is U+FFFD) are duplicates, as the normal path warns', () => {
  const cases: [string, Uint8Array][] = [
    // (The reviewer's: two Latin-1 letters, both U+FFFD.)
    ['two invalid bytes', cat('{"caf', [0xe9], '": 1, "caf', [0xe8], '": 2}')],
    ['an invalid byte and U+FFFD itself', cat('{"caf', [0xe9], '": 1, "caf', [0xef, 0xbf, 0xbd], '": 2}')],
    ['a cut character and a lone byte', cat('{"x', [0xe2, 0x82], 'y": 1, "x', [0xff], 'y": 2}')],
    ['invalid bytes and an escape', cat('{"caf', [0xe9], '\\u0041": 1, "caf', [0xe8], 'A": 2}')],
    ['different once decoded', cat('{"caf', [0xe9], 'x": 1, "caf', [0xe9], 'y": 2}')],
    ['deep, in a big object', cat('{"o": {', Array.from({ length: 300 }, (_, i) => `"k${i}": ${i}, `).join(''), '"a', [0xc0], '": 1, "a', [0x80], '": 2}}')],
  ];
  for (const [what, bytes] of cases) {
    const want = normalDups(bytes);
    const got = hugeOf(bytes, { name: 'a.json' }, {}).summary().warnings.map((w) => w.msg);
    assert.deepEqual(got, want, what);
  }
  assert.equal(normalDups(cases[0][1]).length, 1, 'the normal path warns');
});

function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

test('D5: the raw line of a byte far past a broken document\'s error (past 2 MiB): CoreSource.lineOf', async () => {
  const head = '[\n{"bad": tru e},\n';
  const rows = Array.from({ length: 100000 }, (_, i) => JSON.stringify({ id: i, s: 'y'.repeat(30 + (i % 40)) }));
  const text = head + rows.join(',\n') + '\n]\n';
  const bytes = enc.encode(text);
  assert.ok(bytes.length > 4 << 20);
  const [page, worker] = channel();
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => Object.assign(memSource(bytes), { cached: true }));
  const blob = new Blob([bytes as BlobPart]);
  const client = new HugeClient(blob, { name: 'a.json' }, undefined, page);
  const counted = new Promise<HugeSummary>((done) => (client.onSummary = (s) => !s.counting && done(s)));
  const s = await client.ready;
  if (s.counting) await counted;
  const src = new CoreSource(blob, 'a.json', () => client);
  const at = text.indexOf('{"id":95000,');
  assert.ok(at > 4 << 20);
  assert.equal(await src.lineOf('raw', at + 5), 2 + 95000);
  await client.close();
});
