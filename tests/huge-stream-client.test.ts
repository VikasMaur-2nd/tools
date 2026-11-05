import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { StreamClient, StreamError, gzSize, type Port } from '../lib/huge/stream/client';
import { serve, type ServePort } from '../lib/huge/stream/serve';
import { condPath, filterOf, matches, parseCondPath } from '../lib/huge/stream/filter';
import { parse } from '../lib/json/parser';

/** A client and the worker's side in process, messages structured-cloned and delivered a task later (as postMessage). */
function pair(): StreamClient {
  const worker: ServePort = { postMessage: (m) => setTimeout(() => client.onmessage?.({ data: structuredClone(m) })), onmessage: null };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: structuredClone(m) })), onmessage: null };
  serve(worker);
  return new StreamClient(client);
}

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, kind: i % 3 ? 'a' : 'b', ...(i % 5 ? {} : { flag: true }) }));

test('stream client: a Shape pass streams its reports, then the result; Stop ends one with "Stopped"', async () => {
  const c = pair();
  const text = JSON.stringify(records(200_000));
  const file = new Blob([text]);
  let reports = 0;
  const progress: number[] = [];
  const run = c.run(file, 0, { kind: 'shape', scope: { start: 0, end: file.size, multi: false } }, { kind: 'none' }, { progress: (d) => progress.push(d), shape: () => reports++ });
  const { result } = await run.done;
  assert.equal(result.shape!.records, 200_000);
  assert.ok(progress.length >= 1 && progress[progress.length - 1] === file.size);
  // Stopped at once: before the first of its 16 MiB chunks is through.
  const big = new Blob([JSON.stringify(records(1_500_000))]);
  assert.ok(big.size > 40e6);
  const r2 = c.run(big, 0, { kind: 'shape', scope: { start: 0, end: big.size, multi: false } }, { kind: 'none' });
  r2.stop();
  await assert.rejects(r2.done, (e) => e instanceof StreamError && e.message === 'Stopped');
  // An invalid document: a fixed message and the byte.
  const bad = new Blob(['[1, 2,, 3]']);
  await assert.rejects(c.run(bad, 0, { kind: 'shape', scope: { start: 0, end: bad.size, multi: false } }, { kind: 'none' }).done, (e) => e instanceof StreamError && e.message === 'Invalid JSON' && e.at === 6);
  void reports;
  c.close();
});

test('stream client: a small .gz decompresses in memory; a broken one says so', async () => {
  const c = pair();
  const json = JSON.stringify(records(1000));
  const gz = new Blob([gzipSync(json)]);
  assert.equal(await gzSize(gz), Buffer.byteLength(json));
  const r = await c.gunzip(gz, 'x.tmp', 1 << 30).done;
  assert.equal(await r.blob!.text(), json);
  assert.equal(r.size, json.length);
  const broken = new Uint8Array(gzipSync(json));
  broken[40] ^= 0xff;
  await assert.rejects(c.gunzip(new Blob([broken]), 'y.tmp', 1 << 30).done, (e) => e instanceof StreamError && e.message === 'Not a gzip file');
  assert.equal(await gzSize(new Blob(['{"not": "gzip"} and some more text'])), null);
  c.close();
});

test('Extract form: condition paths and values as typed', () => {
  assert.deepEqual(parseCondPath('address.city'), ['address', 'city']);
  assert.deepEqual(parseCondPath('$.tags[*]'), ['tags', '*']);
  assert.deepEqual(parseCondPath('items[3].sku'), ['items', 3, 'sku']);
  assert.deepEqual(parseCondPath('["a.b"].c'), ['a.b', 'c']);
  assert.equal(parseCondPath('a..b'), null);
  for (const segs of [['a', 'b'], ['x', '*', 'y'], ['a.b', 3, 'c d'], ['é']]) assert.deepEqual(parseCondPath(condPath(segs)), segs);
  const f = filterOf({ conds: [{ path: 'kind', op: 'eq', value: 'b' }, { path: 'flag', op: 'exists', value: '' }, { path: '', op: 'eq', value: 'x' }], any: false })!;
  assert.equal(f.conds.length, 2);
  const rec = parse('{"id": 0, "kind": "b", "flag": true}').root!;
  assert.ok(matches(rec, f));
  assert.ok(!matches(parse('{"id": 1, "kind": "a"}').root!, f));
  // A number typed is a number; quoted, text.
  assert.deepEqual(filterOf({ conds: [{ path: 'id', op: 'eq', value: '12' }], any: false })!.conds[0].value, { num: '12' });
  assert.equal(filterOf({ conds: [{ path: 'id', op: 'eq', value: '"12"' }], any: false })!.conds[0].value, '12');
});
