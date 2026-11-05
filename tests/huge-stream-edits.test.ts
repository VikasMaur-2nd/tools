/**
 * Streamed commands on an edited document (round 3): what a command reads is the document as edited (the
 * core's slice: its pieces as a Blob), exactly, and one version of it (stream/snapshot.ts); an edit while a
 * command runs leaves it alone; a Split into a picked folder that stops keeps its finished parts.
 */
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { parse as tapeParse } from '../lib/json/tape-parser';
import { ARR, OBJ, kids, parse, type JNode } from '../lib/json/parser';
import { formatDoc } from '../lib/json/format';
import { toJSONL } from '../lib/convert/data';
import { records, toCsv } from '../lib/convert/xlsx';
import { runJob, type Job, type Outputs, type Scope } from '../lib/huge/stream/jobs';
import { MemorySink, type Sink } from '../lib/huge/stream/out';
import { blobSource } from '../lib/huge/stream/pass';
import { matches, type Filter } from '../lib/huge/stream/filter';
import { snapshot, SnapshotError } from '../lib/huge/stream/snapshot';
import { outputsFor } from '../lib/huge/stream/serve';
import type { HugeSummary } from '../lib/huge/types';
import { rng, type Rng } from './oracle/compare';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';
import { docOf } from './huge-stream-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const dec = new TextDecoder();
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

/** The core (huge.worker's serve) in this process over `bytes`, as the page's HugeClient talks to it. */
function coreOf(bytes: Uint8Array, name: string, every: number, big: number): HugeClient {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse: tapeParse } }), () => memSource(bytes));
  return new HugeClient(new Blob([bytes as Uint8Array<ArrayBuffer>]), { name, every, big }, undefined, client);
}

/** The core's summary once the document is read again (an edit that didn't answer done reads on in steps). */
async function settled(c: HugeClient): Promise<HugeSummary> {
  for (let k = 0; k < 2000; k++) {
    const s = await c.summary();
    if (s.done) return s;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('never read again');
}

const text = (b: Uint8Array) => dec.decode(b);
const apply = (b: Uint8Array, a: number, e: number, ins: Uint8Array) => {
  const out = new Uint8Array(b.length - (e - a) + ins.length);
  out.set(b.subarray(0, a));
  out.set(ins, a);
  out.set(b.subarray(e), a + ins.length);
  return out;
};

/** A random edit of `bytes` (mostly keeping it valid): a value replaced, a member or item removed or copied, whitespace; or bytes cut. */
function editOf(r: Rng, bytes: Uint8Array, lines: boolean): { a: number; b: number; text: string } {
  const t = text(bytes);
  const res = parse(t, { lines });
  const byteOf = (u: number) => enc.encode(t.slice(0, u)).length;
  const nodes: JNode[] = [];
  const walk = (n: JNode) => {
    nodes.push(n);
    if (n.t >= ARR) for (const c of kids(n)) walk(c);
  };
  if (res.root) walk(res.root);
  const inner = nodes.filter((n) => n.u);
  const k = r.int(10);
  if (inner.length && k < 8) {
    const n = r.pick(inner);
    const s = byteOf(n.s);
    const e = byteOf(n.e);
    if (k < 4) return { a: s, b: e, text: r.pick(['1', '"é"', 'true', 'null', '{"k": [1, 2]}', '[]', '-0.5e3', '9007199254740993', '"' + 'y'.repeat(r.int(80)) + '"', '{"id": 7, "v": "s1", "x": {"name": 2}}']) };
    if (k < 6) return { a: s, b: s, text: r.pick([' ', '\n  ', '\r\n']) };
    // (A copy of it after it, in its container: arrays only, so no duplicate names.)
    if (n.u!.t === ARR) return { a: e, b: e, text: ', ' + t.slice(n.s, n.e) };
    return { a: s, b: e, text: '0' };
  }
  // Something that may break it (at characters' starts: the core cuts no character).
  const boundary = (p: number) => {
    while (p > 0 && p < bytes.length && (bytes[p] & 0xc0) === 0x80) p--;
    return p;
  };
  const a = boundary(r.int(bytes.length + 1));
  return { a, b: Math.max(a, boundary(Math.min(bytes.length, a + r.int(3)))), text: r.pick(['', ',', ']', '"']) };
}

/** What the normal path writes for each command on `t` (null: the command doesn't apply). */
function normal(t: string, name: string) {
  const lines = /\.jsonl$/.test(name);
  const res = parse(t, { lines });
  // (A problem a repair would fix is a problem: huge mode reads strict JSON. Several values are a list.)
  if (res.error || !res.root || res.issues.some((x) => x.m !== 'Multiple top-level values (wrapped in an array)')) return null;
  const root = res.root;
  const rec = records(root);
  const byteOf = (u: number) => enc.encode(t.slice(0, u)).length;
  return { res, root, rec, recScope: rec === root ? null : { start: byteOf(rec.s), end: byteOf(rec.e), multi: false }, multi: res.multi || lines, byteOf };
}

const run = async (blob: Blob, job: Job) => {
  const out = new MemorySink();
  const parts: MemorySink[] = [];
  const outs: Outputs = { main: async () => out, part: async (k) => (parts[k] = new MemorySink()) };
  const result = await runJob(blobSource(blob), job, outs, { chunk: 64 + 4 });
  return { out: out.text(), parts: parts.map((p) => p.text()), result };
};

test('commands on an edited document: each output is the normal path’s on the edited text (random edits, undo, redo)', async () => {
  const r = rng(SEED + 91);
  let checked = 0;
  let refused = 0;
  for (let n = 0; n < 30 * SCALE; n++) {
    const { doc, name } = docOf(r);
    const lines = /\.jsonl$/.test(name);
    let bytes: Uint8Array = enc.encode(doc);
    if (!normal(doc, name)) continue;
    const tune = { every: 64 * (1 + r.int(3)), big: r.chance(0.5) ? 40 + r.int(200) : 1 << 20 };
    const c = coreOf(bytes, name, tune.every, tune.big);
    await c.ready;
    // The versions, for undo and redo.
    const history: Uint8Array[] = [bytes];
    let at = 0;
    const log: string[] = [];
    for (let step = 0; step < 6; step++) {
      const k = r.int(10);
      if (k < 2 && at > 0) {
        await c.undo();
        at--;
        log.push('undo');
      } else if (k < 3 && at < history.length - 1) {
        await c.redo();
        at++;
        log.push('redo');
      } else {
        const e = editOf(r, history[at], lines);
        await c.replace([e]);
        history.length = at + 1;
        history.push(apply(history[at], e.a, e.b, enc.encode(e.text)));
        at++;
        log.push(`${e.a}-${e.b}=${JSON.stringify(e.text)}`);
      }
      bytes = history[at];
      await settled(c);
      const t = text(bytes);
      const where = `\ndoc ${show(doc)} ${name}\nedits ${log.join(' ')}\nnow ${show(t)}`;
      const nm = normal(t, name);
      // A broken document: commands refuse it (the snapshot says why), until it is fixed or undone.
      if (!nm) {
        await assert.rejects(snapshot(c, async () => null), (e: Error) => e instanceof SnapshotError && e.message === 'Invalid JSON', `refused${where}`);
        refused++;
        continue;
      }
      const snap = await snapshot(c, async () => null);
      assert.equal(text(new Uint8Array(await snap.blob.arrayBuffer())), t, `the snapshot is the edited text${where}`);
      const scope: Scope = { start: 0, end: bytes.length, multi: nm.multi };
      for (const indent of ['  ', '']) {
        const got = await run(snap.blob, { kind: 'format', scope, indent });
        assert.equal(got.out, formatDoc(t, nm.res, indent), `format ${JSON.stringify(indent)}${where}`);
      }
      if (nm.root.t === ARR) {
        assert.equal((await run(snap.blob, { kind: 'lines', scope })).out, toJSONL(nm.root), `lines${where}`);
        const filter: Filter = { conds: [{ path: ['id'], op: 'gt', value: { num: '400' } }] };
        const picked = kids(nm.root).filter((x) => matches(x, filter));
        const arr = '[' + picked.map((x) => t.slice(x.s, x.e)).join(',') + ']';
        assert.equal((await run(snap.blob, { kind: 'extract', scope, filter, format: 'jsonl', indent: '' })).out, picked.length ? toJSONL(parse(arr).root!) : '', `extract${where}`);
        const sp = await run(snap.blob, { kind: 'split', scope, per: 2, format: 'json', indent: '  ' });
        const items = kids(nm.root);
        assert.equal(sp.parts.length, Math.ceil(items.length / 2), `split parts${where}`);
        sp.parts.forEach((p, k) => {
          const part = '[' + items.slice(k * 2, k * 2 + 2).map((x) => t.slice(x.s, x.e)).join(',') + ']';
          assert.equal(p, formatDoc(part, parse(part), '  '), `split part ${k}${where}`);
        });
      }
      const csvScope = nm.recScope ?? scope;
      const csv = await run(snap.blob, { kind: 'csv', scope: csvScope, csv: {} });
      assert.equal(csv.out, dec.decode(enc.encode(toCsv(nm.rec))), `csv${where}`);
      // Shape: the same report as over the edited bytes themselves.
      const sh = await run(snap.blob, { kind: 'shape', scope });
      const fresh = await runJob({ size: bytes.length, read: async (a, l) => bytes.slice(a, a + l) }, { kind: 'shape', scope });
      assert.deepEqual(sh.result.shape, fresh.shape, `shape${where}`);
      // A selected value: found again by its path in this version (where it was may have moved).
      const containers: { path: (string | number)[]; n: JNode }[] = [];
      const walk = (x: JNode, path: (string | number)[]) => {
        if (x.t >= ARR && path.length) containers.push({ path, n: x });
        if (x.t >= ARR) for (const ch of kids(x)) walk(ch, [...path, ch.key as string | number]);
      };
      walk(nm.root, []);
      // (A path names the first member of a name, as path.ts resolve does: a duplicate's own path is its first's.)
      const first = (path: (string | number)[]) => {
        let x: JNode | undefined = nm.root;
        for (const seg of path) x = x && x.t === ARR ? kids(x)[seg as number] : x && x.t === OBJ ? kids(x).find((ch) => ch.key === seg) : undefined;
        return x;
      };
      // (Only values a path names: under a duplicate name, the second member has no path of its own.)
      const named = containers.filter((x) => first(x.path) === x.n);
      if (named.length) {
        const pick = r.pick(named);
        const v = await snapshot(c, async () => {
          const loc = await c.resolve(pick.path);
          if (!loc) {
            if (process.env.HUGE_DUMP) writeFileSync(process.env.HUGE_DUMP, JSON.stringify({ doc, name, now: t, path: pick.path, log, tune }));
            assert.fail(`resolve ${JSON.stringify(pick.path)} found nothing${where}`);
          }
          return loc.node;
        });
        const { start, end } = v.scope;
        assert.equal(text(new Uint8Array(await v.blob.slice(start, end).arrayBuffer())), t.slice(pick.n.s, pick.n.e), `the value at ${JSON.stringify(pick.path)}${where}`);
        const p = await run(v.blob, { kind: 'format', scope: { start, end, multi: false }, indent: '  ' });
        const own = t.slice(pick.n.s, pick.n.e);
        assert.equal(p.out, formatDoc(own, parse(own), '  '), `the value formatted${where}`);
      }
      checked++;
    }
    c.close();
  }
  assert.ok(checked > 60 * SCALE, `checked ${checked} (refused ${refused})`);
});

test('a snapshot is one version: taken while an edit is in flight, its bytes and its scope agree', async () => {
  const r = rng(SEED + 92);
  for (let n = 0; n < 40; n++) {
    const recs = Array.from({ length: 50 }, (_, i) => `{"id": ${i}, "v": "s${i}"}`);
    const before = '[' + recs.join(', ') + ']';
    const c = coreOf(enc.encode(before), 'a.json', 64, 1 << 20);
    await c.ready;
    // An edit asked, not waited for; then a snapshot whose scope is item 10, found by path.
    const at = before.indexOf('"s3"');
    const edit = c.replace([{ a: at, b: at + 4, text: '"' + 'z'.repeat(1 + r.int(40)) + '"' }]);
    const snap = await snapshot(c, async () => (await c.resolve([10]))!.node);
    await edit;
    const got = text(new Uint8Array(await snap.blob.arrayBuffer()));
    const after = before.slice(0, at) + got.slice(at, got.indexOf('"', at + 1) + 1) + before.slice(at + 4);
    assert.ok(got === before || got === after, 'one whole version');
    // Item 10, in that version.
    assert.equal(got.slice(snap.scope.start, snap.scope.end), `{"id": 10, "v": "s10"}`, `item 10 in the version taken (${got === before ? 'before' : 'after'})`);
    c.close();
  }
});

test('a snapshot starts over when an edit lands as it is taken, and gives up if edits never stop', async () => {
  let version = 0;
  let editsLeft = 2;
  const mk = (v: number): HugeSummary => ({ size: 10, bom: 0, done: true, error: null, version: v, root: null } as unknown as HugeSummary);
  const core = {
    summary: async () => mk(version),
    slice: async () => {
      // (An edit lands between the version read and the slice.)
      if (editsLeft-- > 0) version++;
      return new Blob([`v${version}`.padEnd(10)]);
    },
  };
  const s = await snapshot(core, async (sum) => sum.version);
  assert.equal(s.version, 2);
  assert.equal(s.scope, 2);
  assert.equal((await s.blob.text()).trim(), 'v2');
  editsLeft = Infinity;
  await assert.rejects(snapshot(core, async () => 0), (e: Error) => e instanceof SnapshotError && e.message === 'Changed');
  // Not read yet (an edit read on in steps): refused.
  await assert.rejects(snapshot({ summary: async () => ({ ...mk(0), done: false }), slice: core.slice }, async () => 0), (e: Error) => e.message === 'Not ready');
});

test('an edit while a command runs leaves the command its version', async () => {
  const recs = Array.from({ length: 400 }, (_, i) => `{"id": ${i}, "v": "s${i}", "t": [1, 2, 3]}`);
  const before = '[' + recs.join(',\n') + ']';
  const c = coreOf(enc.encode(before), 'a.json', 128, 1 << 20);
  await c.ready;
  const snap = await snapshot(c, async () => null);
  // A slow sink: the command is still writing when the edits come.
  let edits: Promise<unknown> | null = null;
  const parts: string[] = [];
  const sink: Sink = {
    write: async (b) => {
      parts.push(dec.decode(b));
      if (!edits) {
        const s = await c.summary();
        const at = before.indexOf('"s200"');
        edits = (async () => {
          await c.replace([{ a: at, b: at + 6, text: '"CHANGED"' }]);
          await c.replace([{ a: 1, b: 1, text: '\n' }]);
          await c.undo();
        })();
        void s;
      }
      await new Promise((r) => setTimeout(r, 1));
    },
    close: async () => {},
    abort: async () => {},
  };
  await runJob(blobSource(snap.blob), { kind: 'format', scope: { start: 0, end: snap.blob.size, multi: false }, indent: '' }, { main: async () => sink, part: async () => sink }, { chunk: 1024 });
  await edits;
  assert.equal(parts.join(''), formatDoc(before, parse(before), ''), 'the version it started on');
  const now = await settled(c);
  assert.ok(now.edited, 'and the document was edited meanwhile');
  c.close();
});

// ── Split into a picked folder, stopped: the finished parts stay, the unfinished one goes ──

/** A FileSystemDirectoryHandle in memory: files, writables, removal. */
function mockFolder(onWrite?: (name: string, bytes: number) => void) {
  const files = new Map<string, string>();
  const handle = {
    name: 'exports',
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!o?.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, '');
      }
      return {
        async createWritable() {
          let buf = '';
          return {
            async write(b: Uint8Array) {
              buf += dec.decode(b);
              onWrite?.(name, buf.length);
            },
            async close() {
              files.set(name, buf);
            },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('Not found', 'NotFoundError');
    },
  };
  return { files, handle: handle as unknown as FileSystemDirectoryHandle };
}

test('a Split into a folder that stops keeps its finished parts, removes the unfinished one, and says how many', async () => {
  const recs = Array.from({ length: 300 }, (_, i) => `{"id":${i},"v":"${'w'.repeat(20)}"}`);
  const doc = '[' + recs.join(',') + ']';
  const bytes = enc.encode(doc);
  let stop = false;
  // (Stopped once part 4 has begun: its file exists, unfinished.)
  const folder = mockFolder((name) => {
    if (name === 'part-0004.jsonl') stop = true;
  });
  const o = await outputsFor({ kind: 'dir', handle: folder.handle, names: 'part-{n}.jsonl', gzip: false }, { bytes: 0 });
  const job: Job = { kind: 'split', scope: { start: 0, end: bytes.length, multi: false }, bytes: 1500, format: 'jsonl', indent: '' };
  await assert.rejects(
    runJob({ size: bytes.length, read: async (a, l) => bytes.slice(a, a + l) }, job, o.outs, { chunk: 700, stopped: () => stop }),
    (e: Error) => e.message === 'Stopped',
  );
  // As serve.ts does on a failure: abort (the unfinished part removed), and the finished ones counted.
  await o.abort();
  assert.equal(o.kept(), 3);
  assert.deepEqual([...folder.files.keys()].sort(), ['part-0001.jsonl', 'part-0002.jsonl', 'part-0003.jsonl']);
  // Each finished part whole: together, the first records in order.
  const all = [...folder.files.values()].join('');
  assert.ok(all.length >= 4500);
  assert.equal(all, recs.slice(0, all.split('\n').length - 1).map((x) => x + '\n').join(''));
  // ZIP and OPFS outputs keep all-or-nothing (items 9, 10 of the review: tests/huge-stream-round2.test.ts).
  void OBJ;
});
