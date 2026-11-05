import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { SmallSource } from '../lib/huge/small-source';
import { parse } from '../lib/json/tape-parser';
import type { HugeNode, HugeSource, IndexState } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

/** The core's worker run in this process: two ports passing messages a task later, as a Worker does. */
function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const core = (text: string, name: string) => {
  const bytes = enc.encode(text);
  const blob = new Blob([bytes]);
  return new CoreSource(blob, name, (onProgress) => new HugeClient(blob, { name }, onProgress, inProcess(bytes)));
};

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    const st = src.state();
    if (st.done) return done(st);
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

/** What the views show of a node (its place and text, not how it was found). */
const shown = (n: HugeNode) => ({ at: n.at, end: n.end, t: n.t, key: n.key, i: n.i, depth: n.depth, count: n.count, text: n.text, clipped: !!n.clipped });

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `user ${i}`, email: `u${i}@example.com`, active: i % 3 !== 0, tags: i % 7 ? ['a', 'b'] : [], score: Math.round(i * 7.31) / 100 }));

/** Both sources over `text`: they must answer the views the same. */
async function pair(text: string, name = 'a.json') {
  const a = core(text, name);
  const b = new SmallSource(text, name);
  const [sa, sb] = await Promise.all([ended(a), ended(b)]);
  return { a, b, sa, sb, close: () => (a.destroy(), b.destroy()) };
}

test('the core answers the views as the normal parser does: nodes, pages, paths and offsets', async () => {
  const text = JSON.stringify({ meta: { version: 3, note: 'x'.repeat(3000) }, users: records(2500) }, null, 2);
  const { a, b, sa, sb, close } = await pair(text);
  assert.equal(sa.error, null);
  for (const k of ['nodes', 'depth', 'lines', 'prettyLines', 'jsonl'] as const) assert.equal(sa[k], sb[k], k);
  const [ra, rb] = await Promise.all([a.root(), b.root()]);
  assert.deepEqual({ ...shown(ra), text: '' }, { ...shown(rb), text: '' }, 'the root (the core has no preview for it)');
  const [ka, kb] = await Promise.all([a.children(ra, 0, 10), b.children(rb, 0, 10)]);
  assert.deepEqual(ka.map(shown), kb.map(shown), 'top-level members');
  // A page deep in a big array, and a small container's items (from its page, no request).
  const users = [ka[1], kb[1]];
  const [pa, pb] = await Promise.all([a.children(users[0], 2300, 200), b.children(users[1], 2300, 200)]);
  assert.equal(pa.length, 200);
  assert.deepEqual(pa.map(shown), pb.map(shown), 'items 2,300 to 2,499');
  const [ia, ib] = await Promise.all([a.children(pa[7], 0, 50), b.children(pb[7], 0, 50)]);
  assert.deepEqual(ia.map(shown), ib.map(shown), 'a record\'s members');
  // Paths: the chain from the root, each with its index.
  const path = ['users', 2346, 'tags', 1];
  const [ca, cb] = await Promise.all([a.resolve(path), b.resolve(path)]);
  assert.deepEqual(ca!.map((n) => [n.key, n.i, n.depth, n.at, n.t]), cb!.map((n) => [n.key, n.i, n.depth, n.at, n.t]));
  assert.equal(await a.resolve(['users', 999_999]), null);
  for (const probe of ['u1999@', '"score": 2.19', '"active"', '"tags": [\n        "a"']) {
    const at = text.indexOf(probe) + 2;
    const [la, lb] = await Promise.all([a.locate(at), b.locate(at)]);
    assert.deepEqual(la.map((n) => [n.key, n.i, n.at]), lb.map((n) => [n.key, n.i, n.at]), `locate ${probe}`);
    for (const mode of ['raw', 'pretty'] as const) assert.equal(await a.lineOf(mode, at), await b.lineOf(mode, at), `${mode} line of ${probe}`);
  }
  // Lines as written and pretty.
  for (const mode of ['raw', 'pretty'] as const) {
    const [la, lb] = await Promise.all([a.lines(mode, 4000, 60, 100, '  '), b.lines(mode, 4000, 60, 100, '  ')]);
    assert.deepEqual(la.map((l) => [l.text, l.at]), lb.map((l) => [l.text, l.at]), `${mode} lines`);
  }
  const [cutA] = await a.lines('raw', 3, 1, 50, '  ');
  assert.equal(cutA.text.length, 50);
  assert.ok(cutA.more > 2900, 'a long line is cut, with how much more');
  // Values, find.
  assert.equal(await a.raw(pa[0], 10_000), await b.raw(pb[0], 10_000));
  assert.equal(await a.raw(ra, 1000), null, 'too big to copy');
  assert.equal(await (await a.slice(ca![4])).text(), '"b"');
  const fa: number[] = [];
  const fb: number[] = [];
  await a.find('user 12', 0, (x) => fa.push(...x), new AbortController().signal);
  await b.find('user 12', 0, (x) => fb.push(...x), new AbortController().signal);
  assert.equal(fa.length, 111);
  assert.deepEqual(fa, fb);
  close();
});

test('the core: JSON Lines as a list of records, and table rows', async () => {
  const text = records(1200).map((r) => JSON.stringify(r)).join('\n') + '\n';
  const { a, b, sa, sb, close } = await pair(text, 'events.jsonl');
  assert.equal(sa.jsonl, true);
  assert.equal(sa.records, sb.records);
  const [ra, rb] = await Promise.all([a.root(), b.root()]);
  assert.equal(ra.at, -1);
  assert.equal(ra.depth, 0);
  assert.equal(ra.count, 1200);
  const [ka, kb] = await Promise.all([a.children(ra, 1190, 20), b.children(rb, 1190, 20)]);
  assert.deepEqual(ka.map(shown), kb.map(shown));
  const [wa, wb] = await Promise.all([a.rows(ra, 5, 3, 50), b.rows(rb, 5, 3, 50)]);
  assert.deepEqual(wa.map((r) => [shown(r.node), [...r.cells!].map(([k, v]) => [k, shown(v)])]), wb.map((r) => [shown(r.node), [...r.cells!].map(([k, v]) => [k, shown(v)])]));
  const chain = await a.locate(text.indexOf('u777@'));
  assert.deepEqual(chain.map((n) => n.key), [undefined, 777, 'email']);
  close();
});

const broken = JSON.stringify(records(50), null, 2).replace('"id": 31,', '"id": 31,,');

test('the core: an invalid file\'s error is the normal path\'s', async () => {
  const { sa, sb, close } = await pair(broken);
  assert.deepEqual(sa.error, { ...sb.error, at: sa.error?.at });
  assert.deepEqual({ ...sa.error, at: undefined }, { msg: 'Unexpected extra comma', line: 329, col: 14, at: undefined });
  close();
});

test('the core: what comes before an error inside the root can be browsed', async () => {
  const { a, close } = await pair(broken);
  try {
    const root = await a.root();
    // The normal tree tolerates that comma and shows all 50 records, record 31 whole. Read strictly up to the
    // error, the closest is records 0–30 and record 31 begun: its members before the comma, marked partial.
    const first = await a.children(root, 0, 50);
    assert.equal(first[0].key, 0);
    assert.equal(first.length, 32, 'the records before the error, and the one it is in');
    assert.ok(!first[30].partial && first[31].partial, 'the broken one last, partial');
    const begun = await a.children(first[31], 0, 10);
    assert.deepEqual(begun.map((n) => [n.key, n.text]), [['id', '31']], 'its members before the error');
  } finally {
    close();
  }
});

test('the core: positions in bytes; columns in characters on a line with accents', async () => {
  const text = '[\n  {"name": "Zoë Ångström", "city": "Malmö"},\n  {"name": "Ada"}\n]\n';
  const a = core(text, 'a.json');
  await ended(a);
  const bytes = enc.encode(text);
  const at = enc.encode(text.slice(0, text.indexOf('Malmö'))).length;
  assert.equal(new TextDecoder().decode(bytes.subarray(at, at + 6)), 'Malmö');
  const [line] = await a.lines('raw', 1, 1, 200, '  ');
  const col = a.colOf(line, at);
  assert.equal(line.text.slice(col, col + 5), 'Malmö');
  assert.equal(a.atOf(line, col), at);
  const chain = await a.locate(at);
  assert.equal(chain[chain.length - 1].key, 'city');
  a.destroy();
});

test("the core: a page's spans are the document's bytes, with a pair across any boundary (REVIEW-GPT 2's case)", async () => {
  // (Paddings putting the emoji's two halves either side of 256- and 4,096-unit boundaries, and controls.)
  // (Every padding from 12 before to 4 after each boundary: wherever the page's text starts, one lands on it.)
  const pads = [240, 4080, 8176].flatMap((b) => Array.from({ length: 16 }, (_, k) => b + k));
  for (const pad of pads) {
    const text = '[{"s": "' + 'a'.repeat(pad) + '😀é"}, 123, {"t": "ü😀"}, [4]]';
    const a = core(text, 'a.json');
    await ended(a);
    const bytes = enc.encode(text);
    const byteAt = (needle: string) => enc.encode(text.slice(0, text.indexOf(needle))).length;
    const items = await a.children(await a.root(), 0, 10);
    const want: [number, number][] = [
      [byteAt('{"s"'), byteAt(', 123')],
      [byteAt('123'), byteAt('123') + 3],
      [byteAt('{"t"'), byteAt(', [4]')],
      [byteAt('[4]'), byteAt('[4]') + 3],
    ];
    assert.deepEqual(items.map((n) => [n.at, n.end]), want, `pad ${pad}`);
    const [member] = await a.children(items[0], 0, 1);
    assert.equal(new TextDecoder().decode(bytes.subarray(member.at, member.end)), '"' + 'a'.repeat(pad) + '😀é"', `pad ${pad}: the string's own bytes`);
    a.destroy();
  }
});

test('the core: Cancel stops indexing where it is, and what was read stays browsable', async () => {
  const text = '{"meta": {"n": 1}, "records": [\n' + Array.from({ length: 300_000 }, (_, i) => JSON.stringify({ id: i, name: `user ${i}`, note: 'x'.repeat(40) })).join(',\n') + '\n]}\n';
  const a = core(text, 'big.json');
  await new Promise((r) => setTimeout(r, 30));
  a.cancel();
  const st = await new Promise<IndexState>((done) => {
    if (a.state().cancelled || a.state().done) return done(a.state());
    const stop = a.onState((s) => (s.cancelled || s.done) && (stop(), done(s)));
  });
  assert.equal(st.cancelled, true, 'stopped, not done');
  assert.equal(st.done, false);
  const root = await a.root();
  assert.equal(root.partial, true);
  const [, records] = await a.children(root, 0, 2);
  assert.equal(records.key, 'records');
  assert.ok(records.partial && records.count > 0 && records.count < 300_000, `records so far: ${records.count}`);
  const items = await a.children(records, 0, 5);
  assert.deepEqual(items.map((n) => n.key), [0, 1, 2, 3, 4]);
  a.destroy();
});
