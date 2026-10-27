import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { Request } from '../lib/engine/reindent.worker';
import { applyCodeChange, codeIndexer, type CodeChange, type CodeIndex } from '../lib/json/code-index';
import { formatDoc } from '../lib/json/format';
import { parse } from '../lib/json/parser';
import type { DocumentMetrics } from '../lib/json/metrics';
import { unpacker, type PackedTree } from '../lib/json/pack';
import { diffResults } from './oracle/compare';

interface Reply {
  id: number;
  out: string | null;
  display?: string;
  patch?: string;
  change?: CodeChange;
  index?: CodeIndex;
  indexReuse?: boolean;
  reset?: boolean;
  good?: boolean;
  tree?: PackedTree;
  metrics?: DocumentMetrics;
  progress?: number;
  chunk?: string;
  field?: 'out' | 'display';
  size?: number;
  chunkedOut?: boolean;
}

/** `clock`: the worker's clock moves on by this many ms at each reading (a fake one, the same on any machine). */
function session({ clock = 0 } = {}) {
  const fake = clock ? `let now=0; performance.now=()=>(now+=${clock});` : '';
  const worker = new Worker(`${fake}const {parentPort}=require('node:worker_threads'); global.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)}; parentPort.on('message',data=>self.onmessage({data})); require(${JSON.stringify(resolve(__dirname, '../lib/engine/reindent.worker.js'))});`, { eval: true });
  const messages: Reply[] = [];
  worker.on('message', (data) => messages.push(data));
  const receive = (id: number) => new Promise<Reply>((done, fail) => {
    const timer = setTimeout(() => { worker.terminate(); fail(new Error(`missing worker reply ${id}`)); }, 10_000);
    const check = () => {
      const i = messages.findIndex((m) => m.id === id && !('chunk' in m) && !('progress' in m));
      if (i < 0) return;
      const result = messages.splice(i, 1)[0];
      clearTimeout(timer); worker.off('message', check); worker.off('error', fail);
      worker.postMessage({ id, prepare: true });
      done(result);
    };
    worker.on('message', check); worker.once('error', fail); check();
  });
  return { worker, receive, messages, async request(data: Request) { const reply = receive(data.id); worker.postMessage(data); return reply; } };
}

test('format worker patches an acknowledged output across skipped replies and invalid edits', async () => {
  const { worker, request } = session();
  try {
    let text = '{"z":"😀\\u0061","a":90071992547409931234,"a":[1,2,{}]}';
    const initial = await request({ id: 1, text, fast: true, indent: '  ' });
    const first = initial.out!;
    assert.equal(first, formatDoc(text, parse(text), '  '));
    text = text.slice(0, 3) + 'é' + text.slice(3);
    const second = await request({ id: 2, edit: { a: 3, b: 3, ins: 'é' }, sourceBase: 1, base: 1, fast: true, indent: '  ' });
    assert.equal(applyCodeChange(first, second.patch!, second.change!), formatDoc(text, parse(text), '  '));
    // The viewer still acknowledges version 1. The worker must patch that exact version.
    const at = text.indexOf('9007') + 3;
    text = text.slice(0, at) + '8' + text.slice(at);
    const third = await request({ id: 3, edit: { a: at, b: at, ins: '8' }, sourceBase: 2, base: 1, fast: true, reuseIndex: true, indent: '  ' });
    const good = applyCodeChange(first, third.patch!, third.change!);
    assert.equal(good, formatDoc(text, parse(text), '  '));
    assert.equal(third.indexReuse, true);
    assert.deepEqual({ ...third.index, close: initial.index!.close, depth: initial.index!.depth }, codeIndexer(good)(Infinity));
    const invalid = await request({ id: 4, edit: { a: text.length, b: text.length, ins: '"' }, sourceBase: 3, base: 3, fast: true, indent: '  ' });
    assert.equal(invalid.out, null);
    const fixed = await request({ id: 5, edit: { a: text.length, b: text.length + 1, ins: '' }, sourceBase: 4, base: 3, fast: true, indent: '  ' });
    assert.equal(applyCodeChange(good, fixed.patch!, fixed.change!), good);
    assert.deepEqual(fixed.index, codeIndexer(good)(Infinity));
    const reset = await request({ id: 6, edit: { a: 0, b: 0, ins: 'x' }, sourceBase: 99, fast: true });
    assert.equal(reset.reset, true);
  } finally { await worker.terminate(); }
});

test('format worker settings, full rewrites and secondary analysis match a fresh parse', async () => {
  const { worker, request } = session();
  try {
    const text = '{"z":["\\u0061\\ud800",1.20e+9],"a":1,"a":900719925474099312345}';
    let id = 0;
    for (const indent of ['', '  ', '    ', '\t']) for (const sortKeys of [false, true]) for (const escape of [false, true]) {
      const reply = await request({ id: ++id, text, fast: true, indent, sortKeys, escape });
      const expected = formatDoc(text, parse(text), indent, sortKeys);
      assert.equal(reply.out, expected);
      assert.equal(reply.display, escape ? JSON.stringify(expected) : undefined);
      assert.deepEqual(reply.index, codeIndexer((reply.display ?? reply.out)!)(Infinity));
    }
    const analysis = await request({ id: ++id, text, analysis: true });
    const res = unpacker(analysis.tree!, text)(Infinity)!;
    assert.equal(formatDoc(text, res, ''), formatDoc(text, parse(text), ''));
    assert.equal(res.warnings.length, 1);
    const retained = await request({ id: ++id, text, analysis: true, good: true });
    assert.equal(retained.good, true);
    assert.equal(unpacker(retained.tree!, text)(Infinity)!.warnings.length, 1);
    assert.equal(analysis.metrics!.min, Buffer.byteLength(formatDoc(text, parse(text), '')));
  } finally { await worker.terminate(); }
});

test('format worker coalesces output indexing while source patches arrive in order', async () => {
  const { worker, request } = session();
  try {
    let text = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: '😀 original name', value: 9007199254740992 })));
    const first = await request({ id: 1, text, fast: true, indent: '  ' });
    // The first response is chunked. Rebuild the same baseline independently for the patch oracle.
    const baseline = formatDoc(text, parse(text), '  ');
    assert.ok(first.index);
    for (let id = 2; id < 8; id++) {
      const a = text.indexOf('original', id * 3000);
      text = text.slice(0, a) + 'é' + text.slice(a);
      worker.postMessage({ id, edit: { a, b: a, ins: 'é' }, sourceBase: id - 1, base: 1, fast: true, indent: '  ' });
    }
    const a = text.indexOf('original', 30_000);
    text = text.slice(0, a) + '東京' + text.slice(a);
    const last = await request({ id: 8, edit: { a, b: a, ins: '東京' }, sourceBase: 7, base: 1, fast: true, indent: '  ' });
    const expected = formatDoc(text, parse(text), '  ');
    assert.equal(applyCodeChange(baseline, last.patch!, last.change!), expected);
    assert.deepEqual(last.index, codeIndexer(expected)(Infinity));
    // An abandoned chunk stream must not replace the retained source or leak into a later patch.
    worker.postMessage({ id: 9, start: true, fast: true });
    worker.postMessage({ id: 9, chunk: '{"abandoned":' });
    const fixed = await request({ id: 10, edit: { a: 0, b: 0, ins: '' }, sourceBase: 8, base: 8, fast: true, indent: '  ' });
    assert.equal(applyCodeChange(expected, fixed.patch!, fixed.change!), expected);
  } finally { await worker.terminate(); }
});

test('random worker edits equal a full format with every output setting', async () => {
  const { worker, request } = session();
  let id = 0;
  let seed = 481;
  const rnd = (n: number) => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) % n);
  const original = '{"z":"Zoë 東京 😀 \\u0061 \\ud800","a":9007199254740993123456789,"a":-0,"deep":' + '['.repeat(120) + '[1.2300e+99,true,null]' + ']'.repeat(120) + '}';
  try {
    for (const indent of ['  ', '    ', '\t']) for (const minify of [false, true]) for (const sortKeys of [false, true]) for (const escape of [false, true]) {
      const options = { fast: true, indent: minify || escape ? '' : indent, sortKeys, escape };
      let text = original;
      let base = 0;
      let visible = '';
      const check = async (a?: number, b = a, ins = '') => {
        const sourceBase = id;
        if (a !== undefined) text = text.slice(0, a) + ins + text.slice(b);
        const reply = await request({ ...options, id: ++id, base, ...(a === undefined ? { text } : { edit: { a, b: b!, ins }, sourceBase }) });
        const res = parse(text, { repair: true });
        const expected = res.root ? formatDoc(text, res, options.indent, sortKeys) : null;
        if (expected === null) {
          assert.equal(reply.out, null);
          assert.equal(reply.patch, undefined);
          return;
        }
        const raw = reply.patch === undefined ? reply.out : applyCodeChange(visible, reply.patch, reply.change!);
        assert.equal(raw, expected, `worker ${id}, ${JSON.stringify(options)}`);
        assert.equal(reply.display, escape ? JSON.stringify(expected) : undefined);
        const shown = reply.display ?? raw!;
        assert.deepEqual(reply.index, codeIndexer(shown)(Infinity));
        // Sometimes skip an acknowledgement. The next patch must still use the displayed base.
        if (rnd(4)) { base = id; visible = shown; }
      };
      await check();
      for (let i = 0; i < 40; i++) {
        if (i % 9 === 0) {
          const end = text.length;
          await check(end, end, '"');
          await check(end, end + 1, '');
        } else if (i % 11 === 0) {
          await check(0, 0, '[');
          await check(text.length, text.length, ']');
          await check(text.length - 1, text.length, '');
          await check(0, 1, '');
        } else if (i % 7 === 0) {
          const at = rnd(text.length);
          const old = text.slice(at, at + 1);
          await check(at, at + 1, '\n');
          await check(at, at + 1, old);
        } else {
          const strings = [...text.matchAll(/"(?:[^"\\]|\\.)*"/g)];
          const at = strings[rnd(strings.length)].index! + 1;
          await check(at, at, ['é', '😀', '東京', '\\u0062', '\\"', '\\\\', '\\udfff', '\\t'][rnd(8)]);
        }
      }
    }
  } finally { await worker.terminate(); }
});

test('non-fast retained edits from 200 KB to 2 MB match fresh output, nodes and metrics', async () => {
  const { worker, request, receive } = session();
  let id = 0;
  let seed = 301;
  const rnd = (n: number) => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) % n);
  try {
    for (const size of [200_000, 250_000, 500_000, 1_999_000]) {
      let text = '{"value":"start","padding":"' + 'x'.repeat(size - 100) + '"}\n';
      const initial = await request({ id: ++id, text, indent: '  ' });
      let output = initial.out!;
      let base = id;
      for (let i = 0; i < 8; i++) {
        const sourceBase = id;
        const at = i % 3 ? text.indexOf('"value":"') + 9 + rnd(5) : (rnd(2) ? text.length : 0);
        const ins = i % 3 ? ['é', '東京', '😀', '9'][rnd(4)] : ' ';
        text = text.slice(0, at) + ins + text.slice(at);
        const reply = await request({ id: ++id, edit: { a: at, b: at, ins }, sourceBase, base, fast: false, parse: true, indent: '  ' });
        // Parse and output are separate messages. Collect the output after the tree.
        const formatted = reply.tree ? await receive(id) : reply;
        const expected = formatDoc(text, parse(text), '  ');
        output = formatted.patch === undefined ? formatted.out! : applyCodeChange(output, formatted.patch, formatted.change!);
        assert.equal(output, expected, `${size} characters, edit ${i}`);
        assert.ok(reply.tree?.nodes.length);
        assert.equal(reply.metrics?.min, Buffer.byteLength(formatDoc(text, parse(text), '')));
        base = id;
      }
    }
  } finally { await worker.terminate(); }
});

test('clearing a worker releases retained output and source bases', async () => {
  const { worker, request } = session();
  try {
    const text = '{"old":1}';
    await request({ id: 1, text, fast: true, indent: '  ' });
    worker.postMessage({ id: 2, clear: true });
    const fresh = await request({ id: 3, text: '{"new":2}', base: 1, fast: true, indent: '  ' });
    assert.equal(fresh.change, undefined);
    assert.equal(fresh.out, '{\n  "new": 2\n}');
    const stale = await request({ id: 4, sourceBase: 1, edit: { a: 0, b: 0, ins: '' }, fast: true });
    assert.equal(stale.reset, true);
  } finally { await worker.terminate(); }
});

/** The progress a request's work posted, checked to only grow within (0, last]. */
function progressOf(messages: Reply[], id: number, last: number) {
  const got = messages.filter((m) => m.id === id && m.progress !== undefined).map((m) => m.progress!);
  for (let k = 0; k < got.length; k++) {
    assert.ok(got[k] > 0 && got[k] <= last, `progress ${got[k]} out of range`);
    if (k) assert.ok(got[k] >= got[k - 1], `progress went back: ${got.join(', ')}`);
  }
  if (got.length) assert.equal(got.at(-1), last);
  return got;
}

test('a big load asks the worker how far it got: the progress only grows and the results are the same', async () => {
  const { worker, request, messages } = session({ clock: 25 });
  try {
    const item = (i: number) => ({ id: i, name: `Zoë ${i}`, tags: ['a', 'b'], n: 1.5e3, ok: true, x: null, s: 'say "hi"\n' });
    const text = JSON.stringify(Array.from({ length: 40_000 }, (_, i) => item(i)));
    assert.ok(text.length > 2_000_000);
    // Formatting: re-indenting in steps (then indexing the output), its output in chunks that tell its size.
    const formatted = await request({ id: 1, text, fast: true, indent: '  ', progress: true });
    const made = progressOf(messages, 1, 0.65);
    assert.ok(made.length >= 4, `formatting posted ${made.length} times`);
    const chunks = messages.filter((m) => m.id === 1 && m.field === 'out');
    const out = chunks.map((m) => m.chunk).join('');
    assert.equal(formatted.chunkedOut, true);
    assert.equal(out, formatDoc(text, parse(text), '  '));
    assert.ok(chunks.every((m) => m.size === out.length));
    // Analysing: parsing in steps, measuring, packing. (A smaller document: its compressed sizes follow.)
    const small = JSON.stringify(Array.from({ length: 4_000 }, (_, i) => item(i)));
    const analysis = await request({ id: 2, text: small, analysis: true, progress: true });
    const analysed = progressOf(messages, 2, 0.8);
    assert.ok(analysed.filter((p) => p < 0.58).length >= 4, `parsing posted ${analysed.length} times`);
    assert.ok(analysed.includes(0.58) && analysed.includes(0.69));
    assert.equal(diffResults(parse(small), unpacker(analysis.tree!, small)(Infinity)!), null);
    assert.equal(analysis.metrics!.min, Buffer.byteLength(formatDoc(small, parse(small), '')));
    // Typing (and anything that doesn't ask) posts none.
    await request({ id: 3, edit: { a: 1, b: 1, ins: ' ' }, sourceBase: 2, fast: true, indent: '  ' });
    await request({ id: 4, text: small, analysis: true });
    assert.deepEqual(progressOf(messages, 3, 0), []);
    assert.deepEqual(progressOf(messages, 4, 0), []);
  } finally { await worker.terminate(); }
});

test('a big load whose text is not strict JSON still ends its progress where formatting does', async () => {
  const { worker, request, messages } = session({ clock: 5 });
  try {
    const text = JSON.stringify(Array.from({ length: 40_000 }, (_, i) => ({ id: i, name: `item ${i}` }))).replace(/\]$/, ',]');
    const reply = await request({ id: 1, text, fast: true, indent: '  ', progress: true });
    progressOf(messages, 1, 0.65);
    assert.equal(messages.filter((m) => m.id === 1 && m.field === 'out').map((m) => m.chunk).join('') || reply.out, formatDoc(text, parse(text), '  '));
  } finally { await worker.terminate(); }
});

test('the formatting worker measures compressed sizes for the page, answering only the newest request', async () => {
  const { worker, messages } = session();
  try {
    const doc = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, s: 'value ' + i })));
    const blob = new Blob([doc]);
    worker.postMessage({ id: 0, measure: blob, seq: 1 });
    worker.postMessage({ id: 0, measure: blob, seq: 2 });
    const reply = await new Promise<{ measured: number; sizes: Record<string, number> }>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('no sizes')), 10_000);
      const check = () => {
        const m = messages.find((x) => (x as unknown as { measured?: number }).measured === 2);
        if (m) { clearTimeout(timer); done(m as unknown as { measured: number; sizes: Record<string, number> }); }
      };
      worker.on('message', check);
      check();
    });
    assert.equal(reply.measured, 2);
    const { gzipSync } = await import('node:zlib');
    // (CompressionStream's gzip and zlib's agree within a few bytes: headers.)
    assert.ok(Math.abs(reply.sizes.gzip - gzipSync(doc).length) < 64, `gzip ${reply.sizes.gzip}`);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!messages.some((x) => (x as unknown as { measured?: number }).measured === 1), 'the older request is not answered');
  } finally {
    await worker.terminate();
  }
});
