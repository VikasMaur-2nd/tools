import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { Request } from '../lib/engine/reindent.worker';
import { applyCodeChange, codeIndexer, type CodeChange, type CodeIndex } from '../lib/json/code-index';
import { formatDoc } from '../lib/json/format';
import { parse } from '../lib/json/parser';
import type { DocumentMetrics } from '../lib/json/metrics';
import { unpacker, type PackedTree } from '../lib/json/pack';
import { diffResults, genDeep, genLoose, mutate, rng } from './oracle/compare';
import { genStrict, loosen } from './oracle/tape';
import { byteLength } from '../lib/json/format';
import { documentMetrics } from '../lib/json/metrics';
import { jsonLines } from '../lib/engine/rules';
import { kids } from '../lib/json/parser';

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

/**
 * `clock`: the worker's clock moves on by this many ms at each reading (a fake one, the same on any machine).
 * `wasm`: the worker can fetch tape.wasm (as in a browser; else its fetch fails and the JavaScript parser does
 * everything). `offline`: loading the JavaScript tape parser's chunk fails this many times first. `loads()`
 * asks the worker how many times that chunk has loaded.
 */
function session({ clock = 0, wait = 10_000, wasm = false, offline = 0 } = {}) {
  const fake = clock ? `let now=0; performance.now=()=>(now+=${clock});` : '';
  const fetcher = wasm ? `global.fetch=async(u)=>new Response(require('node:fs').readFileSync(require('node:url').fileURLToPath(String(u)).replace('/.test-build/','/')),{headers:{'content-type':'application/wasm'}});` : '';
  const chunk = `const seen={loads:0,fail:${offline}}; const M=require('node:module'); const req=M.prototype.require; M.prototype.require=function(id){ if(/tape-parser$/.test(id)){ if(seen.fail>0){ seen.fail--; throw new Error('offline'); } seen.loads++; } return req.apply(this,arguments); };`;
  const worker = new Worker(`${fake}${fetcher}${chunk}const {parentPort}=require('node:worker_threads'); global.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)}; parentPort.on('message',data=>data.loads?parentPort.postMessage({loads:seen.loads}):self.onmessage({data})); require(${JSON.stringify(resolve(__dirname, '../lib/engine/reindent.worker.js'))});`, { eval: true });
  const messages: Reply[] = [];
  worker.on('message', (data) => data.loads === undefined && messages.push(data));
  const receive = (id: number) => new Promise<Reply>((done, fail) => {
    const timer = setTimeout(() => { worker.terminate(); fail(new Error(`missing worker reply ${id}`)); }, wait);
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
  const loads = () => new Promise<number>((done) => {
    const got = (m: { loads?: number }) => {
      if (m.loads === undefined) return;
      worker.off('message', got);
      done(m.loads);
    };
    worker.on('message', got);
    worker.postMessage({ loads: true });
  });
  return { worker, receive, messages, loads, async request(data: Request) { const reply = receive(data.id); worker.postMessage(data); return reply; } };
}

test('the parse request and the output of loose documents read the tape: the same tree, metrics and output as parser.ts', async () => {
  // (parser.ts left the worker: these requests parse to a tape now. Byte for byte what they gave before.)
  const { worker, request, receive } = session();
  const r = rng(77);
  let id = 0;
  try {
    for (let it = 0; it < 300; it++) {
      const k = it % 6;
      let text = k === 0 ? genStrict(r, 4) : k === 1 ? loosen(r, genStrict(r, 4)) : k === 2 ? mutate(r, genLoose(r, 4)) : k === 3 ? genLoose(r, 5) : k === 4 ? genDeep(r, 480 + r.int(60)) : [genStrict(r, 2), genStrict(r, 2), genLoose(r, 2)].join('\n');
      if (it % 25 === 0) text = '{"a":1,"a":{"b":[1,2,{"a":3,"a":4}]},"c":"\\u0041😀"}';
      const lines = k === 5 && r.chance(0.5);
      const indent = r.pick(['', '  ', '\t']);
      const sortKeys = r.chance(0.3);
      const escape = r.chance(0.2);
      const old = parse(text, { lines, repair: true });
      const expected = old.root ? formatDoc(text, old, indent, sortKeys) : null;
      const label = `iteration ${it}: ${JSON.stringify(text.slice(0, 200))} ${JSON.stringify({ lines, indent, sortKeys, escape })}`;
      // The parse request: the tree first, then the output.
      const parsed = await request({ id: ++id, text, parse: true, indent, sortKeys, escape, lines });
      const res = unpacker(parsed.tree!, text)(Infinity)!;
      assert.equal(diffResults(old, res), null, label);
      const min = old.root ? formatDoc(text, old, '') : null;
      const metrics = documentMetrics(text, old, min ?? '');
      if (jsonLines(text, old)) metrics.records = kids(old.root!).length;
      if (escape && min !== null) metrics.escaped = byteLength(JSON.stringify(min));
      assert.deepEqual(parsed.metrics, metrics, label);
      const output = await receive(id);
      assert.equal(output.out, expected, label);
      assert.equal(output.display, escape && expected ? JSON.stringify(expected) : undefined, label);
      // The fast path (Format view settings): its output.
      const fast = await request({ id: ++id, text, fast: true, indent, sortKeys, escape, lines });
      assert.equal(fast.out === null ? null : escape ? JSON.parse(fast.display!) : fast.out, expected, label);
    }
  } finally { await worker.terminate(); }
});

test("parser.ts's parser stays out of the worker: nothing it imports calls it", () => {
  // (The worker parses to tapes only, which keeps the old parser's ~4 KB out of its bundle. Its constants,
  // repair passes and types may still come from parser.ts.)
  const root = resolve(__dirname, '../..');
  const seen = new Set<string>();
  const callers: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
      const names = (m[2] ?? '').replace(/[{}]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
      if (m[1] || (names.length && names.every((x) => x.startsWith('type ')))) continue;
      const dep = resolve(dirname(file), m[3]) + '.ts';
      if (dep.endsWith('/lib/json/parser.ts') && names.some((x) => /^(parse|parser)( as |$)/.test(x))) callers.push(relative(root, file));
      walk(dep);
    }
  };
  walk(resolve(root, 'lib/engine/reindent.worker.ts'));
  assert.ok(seen.size > 10, `${seen.size} modules`);
  assert.deepEqual(callers, []);
});

test('the JavaScript tape parser is its own chunk in the worker: nothing the worker imports statically imports it', () => {
  const root = resolve(__dirname, '../..');
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
      const names = (m[2] ?? '').replace(/[{}]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
      if (m[1] || (names.length && names.every((x) => x.startsWith('type ')))) continue;
      walk(resolve(dirname(file), m[3]) + '.ts');
    }
  };
  walk(resolve(root, 'lib/engine/reindent.worker.ts'));
  assert.ok(seen.size > 10, `${seen.size} modules`);
  assert.ok(!seen.has(resolve(root, 'lib/json/tape-parser.ts')), 'tape-parser.ts is imported statically');
  assert.match(readFileSync(resolve(root, 'lib/engine/reindent.worker.ts'), 'utf8'), /import\('\.\.\/json\/tape-parser'\)/);
});

test('with WebAssembly, valid JSON never loads the JavaScript tape parser; the first broken document does, and gets the same result as without', async () => {
  const s = session({ wasm: true });
  try {
    const item = (i: number) => ({ id: i, name: `Zoë ${i}`, tags: ['a', 'b'], n: 1.5e3, ok: true, x: null, s: 'say "hi"\n' });
    const valid = JSON.stringify(Array.from({ length: 3000 }, (_, i) => item(i)));
    // Analysis, a typed parse, sorted keys, and typing into a value (the scalar formatter re-parses the token).
    const a = await s.request({ id: 1, text: valid, analysis: true });
    assert.equal(diffResults(parse(valid), unpacker(a.tree!, valid)(Infinity)!), null);
    const b = await s.request({ id: 2, text: valid, parse: true, indent: '  ' });
    assert.equal(diffResults(parse(valid), unpacker(b.tree!, valid)(Infinity)!), null);
    // (Its output is the second reply.)
    assert.equal((await s.receive(2)).out, formatDoc(valid, parse(valid), '  '));
    const sorted = await s.request({ id: 3, text: valid, fast: true, indent: '  ', sortKeys: true });
    assert.equal(sorted.out, formatDoc(valid, parse(valid), '  ', true));
    const fast = await s.request({ id: 4, text: valid, fast: true, indent: '  ' });
    assert.equal(fast.out, formatDoc(valid, parse(valid), '  '));
    let text = valid;
    let out = fast.out!;
    let patched = 0;
    for (let k = 0; k < 5; k++) {
      const at = text.indexOf('Zoë', 1000 * (k + 1)) + 1;
      text = text.slice(0, at) + 'é' + text.slice(at);
      const r = await s.request({ id: 5 + k, edit: { a: at, b: at, ins: 'é' }, sourceBase: 4 + k, fast: true, indent: '  ', base: 4 + k });
      out = r.patch !== undefined && r.change ? applyCodeChange(out, r.patch, r.change) : r.out!;
      if (r.patch !== undefined) patched++;
      assert.equal(out, formatDoc(text, parse(text), '  '), `edit ${k}`);
    }
    assert.ok(patched >= 3, `typing patched ${patched} times`);
    assert.equal(await s.loads(), 0, 'valid JSON loaded the JavaScript tape parser');
    // The first broken document loads it, once; the next ones use it.
    const broken = valid.replace(/\]$/, ',]').replace('"id":7,', '"id":7,,');
    const c = await s.request({ id: 20, text: broken, analysis: true });
    assert.equal(diffResults(parse(broken, { repair: true }), unpacker(c.tree!, broken)(Infinity)!), null);
    const d = await s.request({ id: 21, text: broken, fast: true, indent: '  ' });
    assert.equal(d.out, formatDoc(broken, parse(broken, { repair: true }), '  '));
    const lines = '{"a":1}\n{"b":[2,3]}\n';
    const e = await s.request({ id: 22, text: lines, analysis: true, lines: true });
    assert.equal(diffResults(parse(lines, { lines: true, repair: true }), unpacker(e.tree!, lines)(Infinity)!), null);
    assert.equal(await s.loads(), 1);
  } finally { await s.worker.terminate(); }
});

test('offline before the JavaScript tape parser was ever cached: its chunk is tried again, and the broken document is answered', async () => {
  for (const wasm of [true, false]) {
    const s = session({ wasm, offline: 2, wait: 15_000 });
    try {
      const broken = '{"a": [1, 2,], b: true}';
      const r = await s.request({ id: 1, text: broken, analysis: true });
      assert.equal(diffResults(parse(broken, { repair: true }), unpacker(r.tree!, broken)(Infinity)!), null, `wasm ${wasm}`);
      assert.equal(await s.loads(), 1);
    } finally { await s.worker.terminate(); }
  }
});

test('a broken document between two valid ones: superseded, each says it stopped; then each answered as a fresh worker would', async () => {
  const valid = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, s: 'v' + i })));
  const broken = valid.replace(/\]$/, ',]');
  const same = (r: Reply, text: string) => diffResults(parse(text, { repair: true }), unpacker(r.tree!, text)(Infinity)!);
  // `offline`: the chunk's first load fails, so the broken document still waits for it when the next one comes.
  for (const offline of [0, 1]) {
    const s = session({ wasm: true, offline });
    try {
      s.worker.postMessage({ id: 1, text: valid, analysis: true });
      s.worker.postMessage({ id: 2, text: broken, analysis: true });
      const third = await s.request({ id: 3, text: valid, analysis: true });
      assert.equal(same(third, valid), null);
      // (Superseded while they ran: each says it stopped, and nothing it made is sent.)
      await new Promise((done) => setTimeout(done, offline ? 1500 : 100));
      for (const id of [1, 2]) assert.ok(s.messages.some((m) => m.id === id && (m as { dropped?: boolean }).dropped) && !s.messages.some((m) => m.id === id && m.tree), `${id} answered as stopped`);
      // Then alone: the tolerant parse, the chunk loaded once.
      assert.equal(same(await s.request({ id: 4, text: broken, analysis: true }), broken), null);
      assert.equal(same(await s.request({ id: 5, text: valid, analysis: true }), valid), null);
      assert.equal(await s.loads(), 1);
    } finally { await s.worker.terminate(); }
  }
});

test('the analysis worker reads a loaded file itself: the text as the page has it, then edits; a changed file asks for the text', async () => {
  const { worker, request, receive } = session();
  try {
    const body = '[\r\n' + Array.from({ length: 3000 }, (_, i) => `  {"id": ${i}, "s": "é東😀 ${i}"}`).join(',\r\n') + '\r\n]\r\n';
    const text = body.replace(/\r\n?/g, '\n');
    const tree = (reply: { tree?: PackedTree }, src: string) => diffResults(parse(src, { repair: true }), unpacker(reply.tree!, src)(Infinity)!);
    // UTF-8 with a byte order mark and CRLF: the text is the page's (no BOM, LF).
    const utf8 = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), body]);
    assert.equal(tree(await request({ id: 1, analysis: true, file: utf8, size: text.length }), text), null);
    // UTF-16 LE with its byte order mark: read as UTF-16, as the page reads it.
    const le = new Uint8Array(2 + body.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < body.length; i++) { le[2 + 2 * i] = body.charCodeAt(i) & 0xff; le[3 + 2 * i] = body.charCodeAt(i) >> 8; }
    assert.equal(tree(await request({ id: 2, analysis: true, file: new Blob([le]), size: text.length }), text), null);
    // An edit sent while the file is read waits for it, then applies to its text (the file's own analysis,
    // superseded by it, says it stopped).
    const at = text.indexOf('"id": 7,') + 6;
    const edited = text.slice(0, at) + '70' + text.slice(at + 1);
    worker.postMessage({ id: 3, analysis: true, file: utf8, size: text.length });
    const next = request({ id: 4, analysis: true, edit: { a: at, b: at + 1, ins: '70' }, sourceBase: 3 });
    assert.equal((await receive(3) as { dropped?: boolean }).dropped, true);
    assert.equal(tree(await next, edited), null);
    // Not the page's text (the file changed on disk since): the page is asked for it.
    assert.equal((await request({ id: 5, analysis: true, file: utf8, size: text.length + 1 })).reset, true);
  } finally { await worker.terminate(); }
});

test('the analysis worker warmed up before a document analyses it as a fresh one does', async () => {
  const { worker, request, messages } = session();
  try {
    worker.postMessage({ id: -2, warmTape: true });
    const text = '{"a":[1,"x\\u00e9",{"b":null}],"a":2}';
    const reply = await request({ id: 1, text, analysis: true });
    assert.equal(diffResults(parse(text, { repair: true }), unpacker(reply.tree!, text)(Infinity)!), null);
    assert.ok(!messages.some((m) => m.id === -2), 'the warm-up answers nothing');
  } finally { await worker.terminate(); }
});

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

test('an analysis superseded while it runs stops at its next step: it answers that it stopped, sending no tape or index; the newest is answered', async () => {
  const s = session({ wasm: true });
  try {
    const text = JSON.stringify(Array.from({ length: 30_000 }, (_, i) => ({ id: i, s: 'v' + i })));
    // A document, then (as the page does at the next paste) a cancel and the newer one.
    s.worker.postMessage({ id: 1, text, analysis: true, pretty: '  ' });
    s.worker.postMessage({ id: 2, cancel: true });
    const third = await s.request({ id: 3, text: text.replace(/]$/, ',1]'), analysis: true, pretty: '  ' });
    assert.ok(third.tree, 'the newest is analysed');
    const first = s.messages.filter((m) => m.id === 1);
    assert.equal(first.length, 1);
    assert.equal((first[0] as { dropped?: boolean }).dropped, true, 'the first says it stopped');
    assert.ok(!first[0].tree && !(first[0] as { pretty?: unknown }).pretty, 'and sends nothing it made');
  } finally {
    await s.worker.terminate();
  }
});

test('the analysis worker lets go of a huge document after analysing it, and an edit then asks for all of it again', async () => {
  // (Over 48M characters: seconds of work, longer on a busy machine.)
  const { worker, request } = session({ wait: 120_000 });
  try {
    // Over the worker's 48M-character limit: an array of short numbers.
    const text = '[' + '1,'.repeat(24_100_000) + '1]';
    const first = await request({ id: 1, text, analysis: true });
    assert.ok(first.tree && first.tree.count > 24_000_000, 'analysed');
    // An edit against that version: the worker no longer has it, so it says so (the page then sends it whole).
    const edited = await request({ id: 2, edit: { a: 1, b: 1, ins: ' ' }, sourceBase: 1, analysis: true });
    assert.equal(edited.reset, true);
    // A small document is kept: an edit against it is applied.
    await request({ id: 3, text: '[1,2]', analysis: true });
    const small = await request({ id: 4, edit: { a: 1, b: 1, ins: ' ' }, sourceBase: 3, analysis: true });
    assert.equal(small.reset, undefined);
    assert.ok(small.tree, 'the edit was analysed');
  } finally {
    await worker.terminate();
  }
});

test('the formatting worker lets go of a huge document after formatting it, and an edit then asks for all of it again', async () => {
  const { worker, request } = session({ wait: 120_000 });
  try {
    // Over the worker's 48M-character limit: minified (indent ''), so the output is as long.
    const text = '[' + '1,'.repeat(24_100_000) + '1]';
    const first = await request({ id: 1, text, fast: true, indent: '' });
    assert.ok(first.chunkedOut, 'formatted (and sent in chunks)');
    const edited = await request({ id: 2, edit: { a: 1, b: 1, ins: ' ' }, sourceBase: 1, base: 1, fast: true, indent: '' });
    assert.equal(edited.reset, true);
    // A small document is kept: an edit against it is formatted.
    await request({ id: 3, text: '[1,2]', fast: true, indent: '' });
    const small = await request({ id: 4, edit: { a: 1, b: 1, ins: ' ' }, sourceBase: 3, base: 3, fast: true, indent: '' });
    assert.equal(small.reset, undefined);
    assert.ok(small.out === '[1,2]' || small.patch !== undefined, 'the edit was formatted');
  } finally {
    await worker.terminate();
  }
});

test('an analysis for the Format view shown Pretty indexes its pretty lines with the tape', async () => {
  const { worker, request } = session();
  try {
    const text = JSON.stringify({ a: [1, 'é😀', { b: null }], c: {}, d: 'say "hi"' });
    const want = codeIndexer(formatDoc(text, parse(text), '    '))(Infinity)!;
    const reply = await request({ id: 1, text, analysis: true, pretty: '    ' }) as Reply & { pretty?: { indent: string; index: CodeIndex & { node: Int32Array } } };
    assert.equal(reply.pretty?.indent, '    ');
    assert.deepEqual(Array.from(reply.pretty!.index.starts), Array.from(want.starts));
    assert.deepEqual(Array.from(reply.pretty!.index.close), Array.from(want.close));
    assert.equal(reply.pretty!.index.node.length, want.starts.length);
    // Not asked for: none.
    const plain = await request({ id: 2, text, analysis: true }) as Reply & { pretty?: unknown };
    assert.equal(plain.pretty, null);
  } finally {
    await worker.terminate();
  }
});

test('the output\'s older version and the current one, sent together, are answered in the order sent (R11)', async () => {
  // The page sends the version the Format output shows (`good`) and then the current one, under one id. Their
  // analyses run one after the other: the older one's tree never lands after the current one's, where the page
  // would show the older version in the views.
  const s = session({ wasm: true });
  try {
    const older = JSON.stringify(Array.from({ length: 60_000 }, (_, i) => ({ id: i, s: 'v' + i })));
    const current = '{"a":1,"added":[1,2]}';
    s.worker.postMessage({ id: 5, text: older, analysis: true, good: true, pretty: '  ' });
    s.worker.postMessage({ id: 5, text: current, analysis: true, pretty: '  ' });
    const trees = () => s.messages.filter((m) => m.id === 5 && m.tree);
    for (let k = 0; k < 400 && trees().length < 2; k++) await new Promise((r) => setTimeout(r, 25));
    const got = trees();
    assert.equal(got.length, 2, 'both answered');
    assert.deepEqual(got.map((m) => !!m.good), [true, false], 'the older version first, the current one last');
  } finally {
    await s.worker.terminate();
  }
});
