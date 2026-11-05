/*
 * The commands' scopes (lib/huge/tasks.ts): CSV, Extract and Split on an object find its records array; positions
 * after invalid UTF-8 are the bytes' (REVIEW-3 B4: a U+FFFD standing for one byte was counted as 3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { HugeTasks } from '../lib/huge/tasks';
import { OBJ } from '../lib/huge/types';
import { parse } from '../lib/json/tape-parser';
import type { HugeSession } from '../lib/huge/session';
import type { HugeSource, IndexState } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

const cat = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(out);
};

test('REVIEW-3 B4: the records array of a small object, after invalid UTF-8: its bytes', async () => {
  for (const bad of [[0xe9], [0xe2, 0x82], [0xff, 0xfe]]) {
    const bytes = cat('{"note": "caf', bad, ' ', bad, ' ', bad, '", "rows": [{"a": 1}, {"a": 2}]}');
    const blob = new Blob([bytes as BlobPart]);
    const src = new CoreSource(blob, 'r.json', (p) => new HugeClient(blob, { name: 'r.json' }, p, inProcess(bytes)));
    await ended(src);
    const session = { src, indent: '  ', selected: null, meta: { name: 'r.json' }, ui: { get: () => ({ edit: null }) } } as unknown as HugeSession;
    const tasks = new HugeTasks(session);
    const root = await src.root();
    const at = { scope: { start: 0, end: bytes.length, multi: false }, path: [], node: root, t: OBJ, count: root.count };
    const r = await (tasks as unknown as { records(at: unknown, blob: () => Promise<Blob>): Promise<{ scope: { start: number; end: number } }> }).records(at, async () => blob);
    const want = [Buffer.from(bytes).indexOf('[{'), Buffer.from(bytes).lastIndexOf(']') + 1];
    assert.deepEqual([r.scope.start, r.scope.end], want, `the rows' bytes (${bad})`);
    tasks.destroy();
    await src.destroy();
  }
});
