import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Doc } from '../lib/engine/doc';
import { parse, type JNode } from '../lib/json/parser';
import { paired } from '../lib/engine/store';

/** A body's bytes, as File gives them (`stream`), from its text (a rejected text: the stream fails). */
const streamOf = (text: string | Promise<string>) => new ReadableStream<Uint8Array>({
  async start(c) {
    try {
      c.enqueue(new TextEncoder().encode(await text));
      c.close();
    } catch (e) {
      c.error(e);
    }
  },
});

// The engine's asynchronous work against its lifecycle: requests that finish out of order, work still
// pending when the tool is closed (a client navigation) and another one opens. The real Engine methods
// run without the browser-only constructor; timers, idle callbacks and steps share one fake task queue.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = Record<string, any>;
const load = createRequire(__filename);
const source = readFileSync(resolve(__dirname, '../../lib/engine/engine.ts'), 'utf8').replaceAll('import.meta.url', '"file:///engine.js"');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [ctx => root => ts.visitNode(root, function visit(node: ts.Node): ts.VisitResult<ts.Node> | undefined {
    if (ts.isConstructorDeclaration(node)) return undefined;
    return ts.visitEachChild(node, visit, ctx);
  }) as ts.SourceFile] },
}).outputText;

/** A promise settled from outside, as a slow file, download or chunk is. */
function later<T>() {
  let settle!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { settle = res; fail = rej; });
  return { promise, settle, fail };
}

/** Lets every awaited continuation run. */
const settled = () => new Promise((r) => setImmediate(r));

function session() {
  const tasks = new Map<number, () => void>();
  let id = 0;
  const defer = (fn: () => void) => { tasks.set(++id, fn); return id; };
  const cancel = (k: number) => { tasks.delete(k); };
  const state: Dynamic = { fileName: null, status: { kind: 'empty' }, sizes: null, convert: { loading: false, error: null, lines: 0, bytes: 0 }, find: { open: false, q: '', total: 0, index: -1, seq: 0 }, toast: null, menu: null, input: { format: 'json', delimiter: 'auto', detected: ',' } };
  const errors: unknown[] = [];
  const toasts: string[] = [];
  let workers = 0;
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); };
  const off = (type: string, fn: () => void) => { listeners.get(type)?.delete(fn); };
  const storage = new Map<string, string>();
  const fetches: { url: string; mode?: string; cache?: string; signal?: AbortSignal; reply: ReturnType<typeof later<unknown>> }[] = [];
  const sw: Dynamic = { listeners: [] as ((e: { data: unknown }) => void)[], registered: 0 };
  let current: Dynamic | null = null;
  const window: Dynamic = { setTimeout: defer, requestIdleCallback: defer, cancelIdleCallback: cancel, addEventListener: on, removeEventListener: off };
  const document = { readyState: 'complete', documentElement: { lang: 'en', dataset: {} }, createElement: () => ({ getContext: () => null }) };
  const location = { hash: '', href: 'https://tools.example/', pathname: '/', search: '', origin: 'https://tools.example', protocol: 'https:', reload() {} };
  const navigator: Dynamic = { onLine: true };
  const exports: Dynamic = {};
  runInNewContext(js, {
    exports, performance, URL, console, AbortController, Intl, Blob, queueMicrotask,
    process: { env: { NODE_ENV: 'production' } },
    setTimeout: defer, clearTimeout: cancel, requestAnimationFrame: defer, requestIdleCallback: defer, cancelIdleCallback: cancel, window, addEventListener: on, removeEventListener: off,
    document, location,
    getComputedStyle: () => ({}),
    history: { replaceState() {} },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
    navigator: Object.assign(navigator, {
      serviceWorker: {
        addEventListener: (_type: string, fn: (e: { data: unknown }) => void) => sw.listeners.push(fn),
        register: () => { sw.registered++; return new Promise(() => {}); },
      },
    }),
    fetch: (url: unknown, init?: { mode?: string; cache?: string; signal?: AbortSignal }) => {
      const reply = later<unknown>();
      init?.signal?.addEventListener('abort', () => reply.fail(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      fetches.push({ url: String(url), mode: init?.mode, cache: init?.cache, signal: init?.signal, reply });
      return reply.promise;
    },
    Worker: class {
      constructor() { workers++; }
      postMessage() {}
      terminate() {}
    },
    require: (name: string) => {
      if (name === './store') return { paired, store: { get: () => state, set: (patch: object) => { Object.assign(state, patch); }, settings() {} } };
      if (name === './idle') return { soon: defer, idle: defer };
      if (name === './instance') return { getEngine: () => current, getDiffMenu: () => null };
      if (name === '../analytics') return { PRIVATE: 'private', track() {}, reportError: (error: unknown) => errors.push(error) };
      if (name === '../analytics/load') return { noteLoad() {}, watchPastes() {} };
      if (name === './sample') return { SAMPLE: '{"id":1,"name":"Zoë"}' };
      if (name === './sizes') return { compressedSizes: () => Promise.resolve({ gzip: 1 }) };
      if (name === './editor') return { loadSurface: () => Promise.resolve() };
      if (name === '../json/smart') return { embeddedJson: (s: string) => s };
      if (name === '../link' || name === './targets' || name === './doc' || name === './rules' || name === './asks' || name === './source' || name === '../convert/import' || name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const make = () => {
    const engine = new exports.Engine();
    engine.settings = { view: 'format', indent: '2', minify: false, escape: false, sortKeys: false, target: 'typescript', rootName: 'Root', tsStyle: 'interface', csharpLib: 'stj', autoFormat: false, csvHeader: true, csvTypes: true };
    engine.toast = (msg: string) => { if (!engine.dead) toasts.push(msg); };
    return engine;
  };
  const engine = make();
  const tick = () => { const first = tasks.entries().next().value; if (first) { tasks.delete(first[0]); first[1](); } return !!first; };
  const drain = async () => {
    for (let k = 0; k < 100; k++) {
      await settled();
      if (!tick()) return;
      while (tick());
    }
  };
  return { engine, make, state, errors, toasts, tasks, tick, drain, storage, fetches, sw, listeners, document, location, navigator, setCurrent: (e: Dynamic | null) => { current = e; }, workers: () => workers };
}

/** Fakes for what destroy() lets go of. */
function closable(engine: Dynamic, text = '') {
  const el = { removeEventListener() {} };
  const view = { destroy() {} };
  engine.els = { file: el };
  engine.ed = { el, destroy() {}, get length() { return text.length; }, get text() { return text; }, version: Doc.of(text) };
  engine.ed2 = { el, destroy() {} };
  engine.themeMedia = el;
  engine.tree = view;
  engine.table = view;
  engine.code = view;
  engine.fmt = view;
  return { setText: (t: string) => { text = t; } };
}

// ── Conversions ──

/** The Convert view with a valid document, its output recorded. */
function converting(engine: Dynamic, json = '{"a":1}') {
  const code = { text: '', setText(t: string) { code.text = t; }, destroy() {} };
  engine.settings.view = 'convert';
  engine.code = code;
  engine.good = parse(json);
  // (Analysed: the editor's version is the one the good document came from.)
  engine.ed ??= { version: {} };
  engine.parsedVer = engine.goodVer = engine.ed.version;
  return code;
}

const converters = { convert: (root: JNode) => `OUTPUT ${(root.v as JNode[]).map((n) => n.key).join()}`, highlightCode: () => '', codeRows: () => ({ hl: () => '', scanner: null }) };

test('a conversion still loading its code is dropped when the document is cleared meanwhile', async () => {
  const { engine, state } = session();
  const code = converting(engine);
  const mod = later<Dynamic>();
  engine.loadConverters = () => mod.promise;
  const running = engine.runConvert();
  // Cleared: the analysis finds no document, and the next conversion says so.
  engine.good = null;
  await engine.runConvert();
  mod.settle(converters);
  await running;
  assert.equal(code.text, '');
  assert.equal(state.convert.error, 'Paste or open valid JSON on the left to convert it.');
});

test('a conversion is dropped once a newer one is asked for, and the newer one shows', async () => {
  const { engine, tick } = session();
  const code = converting(engine, '{"old":1}');
  const mod = later<Dynamic>();
  engine.loadConverters = () => mod.promise;
  const running = engine.runConvert();
  engine.good = parse('{"new":1}');
  engine.scheduleConvert(150);
  mod.settle(converters);
  await running;
  assert.equal(code.text, '', 'the older document is never shown');
  tick();
  await settled();
  assert.equal(code.text, 'OUTPUT new');
});

test("Copy and Download right after the Convert target changes give the new target's output", async () => {
  const { engine, tick, navigator, toasts } = session();
  const code = converting(engine, '{"a":1}');
  const copied: string[] = [];
  const saved: string[] = [];
  navigator.clipboard = { writeText: async (t: string) => { copied.push(t); } };
  engine.save = (text: string) => saved.push(text);
  engine.loadConverters = async () => ({ ...converters, convert: (_root: JNode, id: string) => `${id} output` });
  // Nothing converted yet: Copy converts it, then copies.
  engine.copyConvert();
  await settled();
  assert.deepEqual(toasts.filter((t) => t !== 'Copied TypeScript'), []);
  assert.equal(code.text, 'typescript output');
  assert.deepEqual(copied, ['typescript output']);
  engine.copyConvert();
  await settled();
  assert.deepEqual(copied, ['typescript output', 'typescript output']);
  copied.length = 0;
  copied.push('typescript output');
  // A big document's view takes a while to show the new target's output: Copy and Download wait for it.
  engine.settings = { ...engine.settings, target: 'yaml' };
  engine.scheduleConvert(0);
  engine.copyConvert();
  await engine.downloadConvert();
  await settled();
  assert.deepEqual(copied, ['typescript output'], 'nothing copied before the conversion');
  assert.deepEqual(saved, []);
  // (The queue holds the first copy's time limit too, before the conversion: it finds nothing left to end.)
  for (let k = 0; k < 10 && (code.text as string) !== 'yaml output'; k++) {
    tick();
    await settled();
  }
  assert.equal(code.text, 'yaml output');
  assert.deepEqual(copied, ['typescript output', 'yaml output']);
  assert.deepEqual(saved, ['yaml output']);
});

test('a superseded conversion whose code failed to load says nothing', async () => {
  const { engine, state, errors } = session();
  converting(engine);
  const mod = later<Dynamic>();
  engine.loadConverters = () => mod.promise;
  const running = engine.runConvert();
  engine.scheduleConvert(0);
  mod.fail(new Error('Loading chunk failed'));
  await running;
  assert.equal(state.convert.error, null);
  assert.deepEqual(errors, []);
});

test('a conversion finishing after the view changed or the tool closed draws nothing', async () => {
  for (const leave of ['view', 'destroy']) {
    const { engine, state } = session();
    closable(engine);
    const code = converting(engine);
    const mod = later<Dynamic>();
    engine.loadConverters = () => mod.promise;
    const running = engine.runConvert();
    if (leave === 'view') engine.settings.view = 'tree';
    else engine.destroy();
    mod.settle(converters);
    await running;
    assert.equal(code.text, '', leave);
    assert.equal(state.convert.lines, 0, leave);
  }
});

// ── Documents asked for: files, links, URLs ──

const file = (name: string, text: Promise<string>, size = 10) => ({ name, size, text: () => text, stream: () => streamOf(text) });

/** A session whose loads are recorded instead of shown. */
function loading() {
  const s = session();
  const loads: string[] = [];
  s.engine.load = (_text: string, name: string | null) => loads.push(`1:${name}`);
  s.engine.loadCompare = (_text: string, name: string | null) => loads.push(`2:${name}`);
  s.engine.setView = (view: string) => { s.engine.settings.view = view; };
  s.engine.ed = { text: '', version: Doc.of(''), setValue() {}, focus() {} };
  s.engine.ed2 = { text: '', setValue() {}, focus() {} };
  s.engine.analyze = () => {};
  return { ...s, loads };
}

test('files open in the order they were asked for, whichever is read first', async () => {
  for (const target of [1, 2]) {
    const { engine, loads, toasts } = loading();
    const open = (f: ReturnType<typeof file>) => (target === 1 ? engine.loadFile(f) : engine.loadCompareFile(f));
    const a = later<string>();
    const b = later<string>();
    const first = open(file('a.json', a.promise));
    const second = open(file('b.json', b.promise));
    b.settle('{"b":1}');
    await second;
    a.settle('{"a":1}');
    await first;
    assert.deepEqual(loads, [`${target}:b.json`]);
    assert.deepEqual(toasts, [target === 1 ? 'Opened b.json' : 'Comparing with b.json']);
  }
});

test('a YAML, CSV, XML or TOML file opens as itself, read as what its name says (errors and all); its file goes to the worker only as JSON', async () => {
  const { engine, toasts } = loading();
  const opened: string[] = [];
  engine.load = (text: string, name: string | null, _persist: boolean, _first: boolean, f: unknown, format: string) => opened.push(`${name} ${format} ${JSON.stringify(text)} ${f ? 'file' : '-'}`);
  await engine.loadFile(file('bad.yaml', Promise.resolve('a: [1, 2\nb: c\n')));
  await engine.loadFile(file('rows.tsv', Promise.resolve('a\tb\n1\t2\n')));
  await engine.loadFile(file('data.json', Promise.resolve('{"a":1}')));
  assert.deepEqual(opened, ['bad.yaml yaml "a: [1, 2\\nb: c\\n" -', 'rows.tsv csv "a\\tb\\n1\\t2\\n" -', 'data.json json "{\\"a\\":1}" file']);
  assert.deepEqual(toasts, ['Opened bad.yaml', 'Opened rows.tsv', 'Opened data.json']);
});

test('a binary file is said to be one, and read again (not kept meanwhile) when opened as text anyway', async () => {
  for (const [target, name] of [[1, 'disk.img'], [1, 'data.csv'], [2, 'disk.img']] as const) {
    const { engine, loads } = loading();
    const said: string[] = [];
    let run: (() => void) | undefined;
    engine.toast = (msg: string, _kind: string, action?: { run: () => void }) => {
      said.push(msg);
      run = action?.run ?? run;
    };
    let reads = 0;
    const bytes = 'PK\x03\x04\0\0\x14\0' + 'x'.repeat(100);
    const f = { name, size: bytes.length, text: () => Promise.resolve(bytes), stream: () => (reads++, streamOf(bytes)) };
    await (target === 1 ? engine.loadFile(f) : engine.loadCompareFile(f));
    assert.deepEqual(said, [`${name} looks like a binary file, not JSON`]);
    assert.deepEqual(loads, []);
    run!();
    for (let i = 0; i < 5; i++) await settled();
    assert.equal(reads, 2, 'read again');
    // (As text: a .csv isn't converted.)
    assert.deepEqual(loads, [`${target}:${name}`]);
    assert.equal(said[1], target === 1 ? `Opened ${name}` : `Comparing with ${name}`);
  }
});

test('a file that fails to read after a newer one was asked for says nothing', async () => {
  for (const target of [1, 2]) {
    const { engine, toasts } = loading();
    const open = (f: ReturnType<typeof file>) => (target === 1 ? engine.loadFile(f) : engine.loadCompareFile(f));
    const a = later<string>();
    const first = open(file('a.json', a.promise));
    void open(file('b.json', new Promise(() => {})));
    a.fail(new Error('gone'));
    await first;
    assert.deepEqual(toasts, []);
  }
});

test('a file asked for in one editor leaves a file on its way to the other one', async () => {
  const { engine, loads } = loading();
  const a = later<string>();
  const first = engine.loadFile(file('a.json', a.promise));
  await engine.loadCompareFile(file('b.json', Promise.resolve('{}')));
  a.settle('{}');
  await first;
  assert.deepEqual(loads, ['2:b.json', '1:a.json']);
});

test('a URL asked for stops the download of the one before, which says nothing', async () => {
  const { engine, loads, toasts, fetches } = loading();
  const first = engine.fetchUrl('https://a.example/a.json');
  const second = engine.fetchUrl('https://b.example/b.json');
  assert.equal(fetches[0].signal?.aborted, true);
  fetches[1].reply.settle({ ok: true, text: () => Promise.resolve('{"b":1}'), get body() { return streamOf(Promise.resolve('{"b":1}')); } });
  fetches[0].reply.settle({ ok: true, text: () => Promise.resolve('{"a":1}'), get body() { return streamOf(Promise.resolve('{"a":1}')); } });
  await Promise.all([first, second]);
  assert.deepEqual(loads, ['1:b.json']);
  assert.deepEqual(toasts, ['Fetching…', 'Fetching…', 'Loaded b.example']);
});

test('a document or schema by URL is fetched past the service worker\'s cache (no-store), its failure probe too (review 2, finding 2)', async () => {
  const { engine, fetches } = loading();
  const got = engine.fetchUrl('https://tools.example/data.json');
  assert.equal(fetches[0].cache, 'no-store');
  fetches[0].reply.fail(new TypeError('Failed to fetch'));
  await settled();
  assert.deepEqual(fetches.map((f) => [f.mode, f.cache]), [[undefined, 'no-store'], ['no-cors', 'no-store']]);
  fetches[1].reply.fail(new TypeError('Failed to fetch'));
  await got;
});

test("a file opened while a link's document downloads wins, and the link stays quiet", async () => {
  const { engine, loads, toasts, fetches, location } = loading();
  location.hash = '#a=' + encodeURIComponent('https://a.example/data.json');
  location.href = 'https://tools.example/' + location.hash;
  const opening = engine.openLink();
  await settled();
  await engine.loadFile(file('b.json', Promise.resolve('{"b":1}')));
  assert.equal(fetches[0].signal?.aborted, true);
  fetches[0].reply.settle({ ok: true, text: () => Promise.resolve('{"a":1}'), get body() { return streamOf(Promise.resolve('{"a":1}')); } });
  await opening;
  await settled();
  assert.deepEqual(loads, ['1:b.json']);
  assert.deepEqual(toasts, ['Fetching…', 'Opened b.json']);
});

test('a share link whose document inflates past 32 MB opens only when asked', async () => {
  const { engine, loads, location } = loading();
  const said: [string, { label: string; run: () => void } | undefined][] = [];
  engine.toast = (msg: string, _kind: string, action?: { label: string; run: () => void }) => said.push([msg, action]);
  const { encodeDoc, LINK_DOCUMENT } = load(resolve(__dirname, '../lib/link'));
  const link = async (text: string) => {
    location.hash = '#a=' + (await encodeDoc(text));
    location.href = 'https://tools.example/' + location.hash;
    await engine.openLink();
    for (let i = 0; i < 20; i++) await settled();
  };
  await link('[' + '0,'.repeat(1000) + '0]');
  assert.deepEqual(loads, ['1:null'], 'a small one opens');
  loads.length = 0;
  said.length = 0;
  // (About 33 KB of link.)
  await link('[' + '0,'.repeat(LINK_DOCUMENT / 2) + '0]');
  assert.deepEqual(loads, []);
  assert.deepEqual(said.map(([m, a]) => [m, a?.label]), [["This link's document is over 32 MB: opening it can slow down or crash this tab", 'Open anyway']]);
  said[0][1]!.run();
  for (let i = 0; i < 200 && !loads.length; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(loads, ['1:null'], 'opened when asked');
});

test('a big file still being read gives back the status it showed when a URL is asked for instead', async () => {
  const { engine, state } = loading();
  const before = (state.status = { kind: 'valid', warnings: 0 });
  const a = later<string>();
  const first = engine.loadFile(file('a.json', a.promise, 5_000_000));
  assert.equal(state.status.kind, 'parsing');
  void engine.fetchUrl('https://b.example/b.json');
  a.settle('{}');
  await first;
  assert.equal(state.status, before);
  // Another big file's percent is left alone.
  const c = later<string>();
  const third = engine.loadFile(file('c.json', c.promise, 5_000_000));
  void engine.loadFile(file('d.json', new Promise(() => {}), 5_000_000));
  const shown = state.status;
  c.settle('{}');
  await third;
  assert.equal(state.status, shown);
});

test("a URL that can't be read says why: no CORS, no server, cut off, http:// on https, or offline", async () => {
  const { engine, toasts, fetches, navigator } = loading();
  const failed = () => new TypeError('Failed to fetch');
  const said = () => toasts.filter((t) => t !== 'Fetching…').at(-1);
  // The server answers but doesn't let other sites read it: a reply the page may not read still arrives.
  let got = engine.fetchUrl('https://a.example/a.json');
  fetches[0].reply.fail(failed());
  await settled();
  assert.equal(fetches[1].mode, 'no-cors');
  assert.equal(fetches[1].url, 'https://a.example/a.json');
  fetches[1].reply.settle({ type: 'opaque' });
  await got;
  assert.equal(said(), "Couldn't fetch. The server must allow cross-origin requests (CORS).");
  assert.equal(fetches[1].signal?.aborted, true, 'the second request stops once it has answered');
  // No reply at all.
  got = engine.fetchUrl('https://b.example/b.json');
  fetches[2].reply.fail(failed());
  await settled();
  fetches[3].reply.fail(failed());
  await got;
  assert.equal(said(), "Couldn't reach the server. Check the address or try again later.");
  // The headers came; the rest didn't.
  got = engine.fetchUrl('https://c.example/c.json');
  fetches[4].reply.settle({ ok: true, text: () => Promise.reject(failed()), get body() { return streamOf(Promise.reject(failed())); } });
  await got;
  assert.equal(said(), 'The connection dropped before the whole file arrived. Try again.');
  // http:// from this https page is blocked, except on this device; offline needs no second request either.
  got = engine.fetchUrl('http://d.example/d.json');
  fetches[5].reply.fail(failed());
  await got;
  assert.equal(said(), 'Browsers block http:// links on an https page. Try the https:// address.');
  got = engine.fetchUrl('http://localhost:8080/e.json');
  fetches[6].reply.fail(failed());
  await settled();
  assert.equal(fetches[7].mode, 'no-cors');
  fetches[7].reply.fail(failed());
  await got;
  navigator.onLine = false;
  got = engine.fetchUrl('https://f.example/f.json');
  fetches[8].reply.fail(failed());
  await got;
  assert.equal(said(), "You're offline. Connect to the internet and try again.");
  assert.equal(fetches.length, 9);
  // A newer request while the second one is out: the first says nothing.
  navigator.onLine = true;
  const before = toasts.length;
  got = engine.fetchUrl('https://g.example/g.json');
  fetches[9].reply.fail(failed());
  await settled();
  void engine.fetchUrl('https://h.example/h.json');
  assert.equal(fetches[10].signal?.aborted, true);
  await got;
  assert.deepEqual(toasts.slice(before), ['Fetching…', 'Fetching…']);
});

test('typing or pasting in an editor drops the document still on its way to it, quietly', async () => {
  const { engine, loads, toasts, fetches } = loading();
  Object.assign(engine.ed, { text: '{}', length: 2, blank: false, setBrackets() {} });
  const url = engine.fetchUrl('https://a.example/a.json');
  const b = later<string>();
  const compare = engine.loadCompareFile(file('b.json', b.promise));
  engine.onChange('input');
  assert.equal(fetches[0].signal?.aborted, true);
  await url;
  engine.onCompareChange('paste');
  b.settle('{}');
  await compare;
  assert.deepEqual(loads, []);
  assert.deepEqual(toasts, ['Fetching…']);
  // What the tool writes into the editor itself leaves a document on its way alone.
  const c = engine.fetchUrl('https://c.example/c.json');
  engine.onChange('set');
  fetches[1].reply.settle({ ok: true, text: () => Promise.resolve('{"c":1}'), get body() { return streamOf(Promise.resolve('{"c":1}')); } });
  await c;
  assert.deepEqual(loads, ['1:c.json']);
});

test('Clear drops a file still being read', async () => {
  const { engine, loads } = loading();
  const a = later<string>();
  const first = engine.loadFile(file('a.json', a.promise));
  engine.clear();
  a.settle('{}');
  await first;
  assert.deepEqual(loads, []);
});

// ── Closing the tool (a client navigation) while work is pending ──

test('the warm-up never starts a worker once the engine is gone', async () => {
  for (let steps = 0; steps < 14; steps++) {
    const s = session();
    closable(s.engine);
    s.engine.warmUp();
    await settled();
    for (let k = 0; k < steps; k++) {
      s.tick();
      await settled();
    }
    const started = s.workers();
    s.engine.destroy();
    await s.drain();
    assert.equal(s.workers(), started, `destroyed after ${steps} steps`);
  }
});

test('destroy cancels a warm-up still waiting for the page to load', async () => {
  for (const loaded of [false, true]) {
    const s = session();
    closable(s.engine);
    s.document.readyState = 'loading';
    s.engine.warmUp();
    assert.equal(s.listeners.get('load')?.size, 1);
    if (loaded) for (const fn of s.listeners.get('load')!) fn();
    s.engine.destroy();
    for (const fn of s.listeners.get('load') ?? []) fn();
    await s.drain();
    assert.equal(s.workers(), 0, loaded ? 'loaded, then destroyed' : 'destroyed while loading');
  }
});

test('sizes still being measured when the engine goes are never published', async () => {
  for (const at of [0, 1, 2]) {
    const s = session();
    closable(s.engine);
    const text = '{"a":[1,2,3]}';
    const prev = (s.state.sizes = { min: 5, stale: false });
    s.engine.measure(parse(text), text);
    for (let k = 0; k < at; k++) s.tick();
    s.engine.destroy();
    await s.drain();
    assert.deepEqual({ ...s.state.sizes }, { ...prev, stale: true }, `destroyed after ${at} steps`);
  }
});

test('a deferred analysis after a big load is dropped when the engine goes', async () => {
  const s = session();
  closable(s.engine);
  const { engine } = s;
  engine.fmt = { text: '', el: { hidden: true }, inlineIndex: () => ({}), snapshotText: () => () => '', destroy() {} };
  engine.drawFormat = () => {};
  let analysed = 0;
  assert.ok(engine.outputFirst(JSON.stringify({ pad: 'x'.repeat(300_000) }), null, () => { analysed++; }));
  engine.destroy();
  await s.drain();
  assert.equal(analysed, 0);
});

test('a save waiting for an idle moment is dropped by destroy, which saves the document itself', async () => {
  const s = session();
  const doc = closable(s.engine, '{"old":1}');
  s.engine.persistEnabled = true;
  s.engine.persistSoon();
  s.tick(); // (the 800 ms wait: the save now waits for an idle moment)
  doc.setText('{"old":2}');
  s.engine.destroy();
  assert.equal(s.storage.get('jf:doc'), '{"old":2}');
  // The next tool saves its own document; the old engine's queued save must not replace it.
  s.storage.set('jf:doc', '{"new":1}');
  await s.drain();
  assert.equal(s.storage.get('jf:doc'), '{"new":1}');
});

test('the file name is saved with the document kept: a load still on its way when the page is left, or the one before', () => {
  for (const [pending, doc, file] of [
    ['{"new":1}', '{"new":1}', 'new.json'],
    // Too big to keep: the document before stays, under its own name.
    ['[' + '0,'.repeat(1_300_000) + '0]', '{"old":1}', 'old.json'],
  ]) {
    const s = session();
    closable(s.engine, '{"old":1}');
    Object.assign(s.engine, { persistEnabled: true, edName: 'old.json' });
    s.storage.set('jf:file', 'old.json');
    s.engine.pendingLoad = { seq: s.engine.loadSeq, text: pending, persist: true, names: ['old.json', 'new.json'] };
    s.engine.destroy();
    assert.equal(s.storage.get('jf:doc'), doc);
    assert.equal(s.storage.get('jf:file'), file);
  }
  // A document too big to keep is saved as none, and so is its name.
  const s = session();
  closable(s.engine, '[' + '0,'.repeat(1_300_000) + '0]');
  Object.assign(s.engine, { persistEnabled: true, edName: 'big.json' });
  s.engine.destroy();
  assert.equal(s.storage.get('jf:doc'), undefined);
  assert.equal(s.storage.get('jf:file'), undefined);
});

test("the Compare editor's file name goes with its document: a load, a clear, a swap and a paste over it tell its undo steps", () => {
  const s = session();
  type Names = [string | null, string | null];
  /** An editor that keeps the file names each whole-document step carries (Editor.undo/redo tell them back: see editor.test). */
  const editor = (text: string) => ({
    text, pasteFull: false, steps: [] as (Names | undefined)[], el: { removeEventListener() {} },
    get length() { return this.text.length; },
    setValue(t: string, ...[, , names]: [number?, boolean?, Names?]) { this.text = t; this.steps.push(names); },
    setDiagnostics() {}, focus() {}, setBrackets() {}, destroy() {},
  });
  const ed = editor('{"a":1}');
  const ed2 = editor('');
  Object.assign(s.engine, { ed, ed2, edName: 'a.json', analyze() {}, persistSoon() {} });
  Object.assign(s.state, { fileName: 'a.json', cmpFile: null });
  s.engine.loadCompare('{"b":1}', 'b.json');
  s.engine.clearCompare();
  assert.equal(s.state.cmpFile, null);
  s.engine.loadCompare('{"c":1}', 'c.json');
  s.engine.swapCompare();
  assert.deepEqual([s.state.fileName, s.state.cmpFile], ['c.json', 'a.json']);
  // (Made in the engine's realm: compared as JSON.)
  assert.equal(JSON.stringify(ed2.steps), JSON.stringify([[null, 'b.json'], ['b.json', null], [null, 'c.json'], ['c.json', 'a.json']]));
  assert.equal(JSON.stringify(ed.steps), JSON.stringify([['a.json', 'c.json']]));
  // Undo or Redo bringing a name back, and the name a paste over everything leaves.
  s.engine.cmpRenamed('b.json');
  assert.equal(s.state.cmpFile, 'b.json');
  assert.equal(s.engine.cmpName(), 'b.json');
  s.engine.onCompareChange('paste');
  assert.equal(s.state.cmpFile, 'b.json', 'a paste into part of it keeps the name');
  ed2.pasteFull = true;
  s.engine.onCompareChange('paste');
  assert.equal(s.state.cmpFile, null, 'a paste over everything leaves the file');
});

test('a paste over the whole editor ends with the caret after what was pasted, as a paste does; a file opens at its start (F26)', () => {
  const s = session();
  const carets: number[] = [];
  const doc = Doc.of('[1,2]');
  s.engine.ed = { el: {}, setValue: (_t: string, caret: number) => carets.push(caret), get version() { return doc; }, takeOver() {}, focus() {} };
  s.engine.refocus = true;
  s.engine.finishLoad('[1,2]', false, true, [null, null]);
  assert.deepEqual(carets, [5]);
  s.engine.finishLoad('[1,2]', false, true, [null, null]);
  assert.deepEqual(carets, [5, 0]);
});

test('Undo while a file is being read undoes that file once it arrives, not the document before it', async () => {
  const { engine, loads, toasts } = loading();
  let undone = 0;
  engine.ed.undo = () => undone++;
  assert.equal(engine.undoing(), false, 'nothing on its way: the editor undoes');
  const a = later<string>();
  const opening = engine.loadFile(file('big.json', a.promise));
  assert.equal(engine.undoing(), true, 'taken');
  a.settle('{"big":1}');
  await opening;
  assert.deepEqual(loads, ['1:big.json']);
  assert.equal(undone, 1, 'opened, then undone');
  assert.deepEqual(toasts, []);
  assert.equal(engine.undoing(), false);
  // Typing meanwhile drops the file (and the Undo with it).
  const b = later<string>();
  const next = engine.loadFile(file('c.json', b.promise));
  assert.equal(engine.undoing(), true);
  engine.requests[1].abort();
  b.settle('{"c":1}');
  await next;
  assert.deepEqual(loads, ['1:big.json']);
  assert.equal(undone, 1);
});

test('destroy closes what the tool showed for itself; a notice with an action stays', () => {
  for (const action of [false, true]) {
    const s = session();
    closable(s.engine);
    const toast = { id: 1, msg: 'Copied', kind: 'ok', ...(action && { action: { label: 'Reload', run() {} } }) };
    Object.assign(s.state, { toast, find: { open: true, q: 'abc', total: 3, index: 0, seq: 4 }, dragging: true, palette: 'commands', shortcuts: true, graphExport: true });
    s.engine.destroy();
    assert.equal(s.state.toast, action ? toast : null);
    assert.equal(s.state.find.open, false);
    assert.equal(s.state.find.q, '');
    assert.ok(s.state.find.seq > 4, 'the find bar starts over');
    assert.equal(s.state.dragging, false);
    assert.equal(s.state.palette, false);
    assert.equal(s.state.shortcuts, false);
    assert.equal(s.state.graphExport, false);
  }
});

test('the service worker is registered once per page; its update notice goes to the tool open then', async () => {
  const s = session();
  const first = s.engine;
  closable(first);
  first.registerSW();
  first.destroy();
  const second = s.make();
  second.registerSW();
  s.setCurrent(second);
  await s.drain();
  assert.equal(s.sw.listeners.length, 1);
  assert.equal(s.sw.registered, 1);
  const shown: Dynamic[] = [];
  first.toast = () => shown.push({ by: 'first' });
  second.toast = (msg: string) => shown.push({ by: 'second', msg });
  for (const fn of s.sw.listeners) fn({ data: { type: 'updated' } });
  assert.deepEqual(shown, [{ by: 'second', msg: 'A new version is ready' }]);
  // Between two tools (a page without one): the next tool shows it.
  s.setCurrent(null);
  for (const fn of s.sw.listeners) fn({ data: { type: 'updated' } });
  const third = s.make();
  third.toast = (msg: string) => shown.push({ by: 'third', msg });
  third.registerSW();
  assert.deepEqual(shown.at(-1), { by: 'third', msg: 'A new version is ready' });
  assert.equal(shown.length, 2);
});

test('expanding nested JSON is dropped if the document changed while its code loaded', async () => {
  const { engine, toasts } = session();
  const text = '{"s":"{\\"x\\":1}"}';
  const version = Doc.of(text);
  const res = parse(text);
  let set: string | null = null;
  engine.ed = { version, text, ls: [text], setValue: (t: string) => { set = t; }, setCaret() {} };
  Object.assign(engine, { res, parsed: text, parsedVer: version, sel: null, analyze() {}, tree: { select() {} } });
  const node = (res.root!.v as JNode[])[0];
  const expanding = engine.expandNested(node);
  // An edit lands before the code arrives: the node's offsets no longer point into the text.
  engine.ed.version = Doc.of(text + ' ');
  await expanding;
  assert.equal(set, null);
  assert.deepEqual(toasts, []);
});

test("Copy and Download from another view after an edit give the edited document's output (F18)", async () => {
  const { engine, navigator } = session();
  const code = converting(engine, '{"a":1}');
  const copied: string[] = [];
  navigator.clipboard = { writeText: async (t: string) => { copied.push(t); } };
  engine.loadConverters = async () => converters;
  await engine.runConvert();
  assert.equal(code.text, 'OUTPUT a');
  // Edited in the Tree: analysed, but the Convert view (hidden) still holds the conversion before.
  engine.settings.view = 'tree';
  engine.good = parse('{"b":2}');
  engine.goodVer = engine.parsedVer = engine.ed.version = {};
  engine.copyConvert();
  await settled();
  assert.deepEqual(copied, ['OUTPUT b']);
  // An edit whose analysis is still to come: Copy waits for it, then converts.
  engine.ed.version = {};
  engine.copyConvert();
  await settled();
  assert.deepEqual(copied, ['OUTPUT b'], 'nothing copied before the analysis');
  engine.good = parse('{"c":3}');
  engine.goodVer = engine.parsedVer = engine.ed.version;
  for (const f of engine.analysed.splice(0)) f();
  await settled();
  assert.deepEqual(copied, ['OUTPUT b', 'OUTPUT c']);
});

test('Copy formatted output from another view after an edit gives the edited document, waiting for its analysis (F18)', async () => {
  const { engine, navigator, state } = session();
  const copied: string[] = [];
  navigator.clipboard = { writeText: async (t: string) => { copied.push(t); } };
  const fmt = { text: '', setText(t: string) { fmt.text = t; }, setNotes() {}, lineCount: 0, el: {} };
  engine.fmt = fmt;
  state.fmt = {};
  const analysed = (json: string) => {
    engine.good = parse(json);
    engine.goodText = json;
    engine.goodVer = engine.parsedVer = engine.ed.version = {};
  };
  engine.ed = { version: {} };
  analysed('{"a":1}');
  engine.settings.view = 'format';
  engine.runFormat();
  assert.equal(fmt.text, '{\n  "a": 1\n}');
  // Edited while the Tree shows: the hidden Format view keeps the output before.
  engine.settings.view = 'tree';
  analysed('{"b":2}');
  engine.copyOutput();
  await settled();
  assert.deepEqual(copied, ['{\n  "b": 2\n}']);
  // Its analysis still to come: Copy waits for it.
  engine.ed.version = {};
  engine.copyOutput();
  await settled();
  assert.equal(copied.length, 1, 'nothing copied before the analysis');
  analysed('{"c":3}');
  for (const f of engine.analysed.splice(0)) f();
  await settled();
  assert.deepEqual(copied, ['{\n  "b": 2\n}', '{\n  "c": 3\n}']);
});

test('past the 500 duplicate keys a parse lists, the status says there are more', () => {
  const { engine } = session();
  closable(engine);
  engine.ed.lineCol = () => ({ line: 1, col: 1 });
  const st = engine.statusOf(parse('{' + Array.from({ length: 600 }, (_, i) => `"k":${i}`).join(',') + '}'));
  assert.equal(st.warnings, 500);
  assert.equal(st.more, true);
  assert.equal(engine.statusOf(parse('{"k":0,"k":1}')).more, false);
});

// ── From PR #31's review (REVIEW-GPT): what waits for an output, and what the engine keeps of a document ──

/** An editor double: setValue is a no-op for the same text, else a new version and a real Engine.onChange. */
function reviewing(s: ReturnType<typeof session>, initial = '') {
  const { engine, state } = s;
  let text = initial;
  let version = Doc.of(text);
  const ed = {
    get text() { return text; }, get length() { return text.length; }, get blank() { return !text.trim(); },
    get version() { return version; }, get ls() { return [0]; }, el: {},
    setValue(next: string) { if (next === text) return; text = next; version = Doc.of(text); engine.onChange('set'); },
    setBrackets() {}, setScope() {}, setDiagnostics() {}, setJwt() {}, focus() {},
    lineCol() { return {line: 1, col: 1}; },
  };
  engine.ed = ed;
  engine.fmt = { text: '', el: {}, setText() {}, setLines() {}, setNotes() {}, snapshotText: () => () => '', inlineIndex: () => ({}) };
  engine.tree = { setRoot() {}, select() {}, releaseRoot() {} };
  engine.table = { setNode() {}, state: () => ({}), path: [], rowCount: 0, colCount: 0 };
  engine.syncTableState = () => {};
  engine.persistSoon = () => {};
  engine.jwtReader = () => null;
  state.fmt = {};
  return ed;
}



test('a Download waiting for a conversion never saves another target\'s under its name: superseded, nothing is saved', async () => {
  const s = session();
  const {engine} = s;
  reviewing(s, '{"a":1}');
  engine.settings.view = 'convert';
  engine.good = parse(engine.ed.text);
  engine.goodText = engine.ed.text;
  engine.goodVer = engine.parsedVer = engine.ed.version;
  engine.code = {text: '', setText(t: string) { this.text = t; }};
  engine.loadConverters = async () => load(resolve(__dirname, '../lib/convert/index'));
  await engine.runConvert();
  engine.settings.target = 'yaml';
  engine.scheduleConvert(0);
  const saved: {text: string; name: string; type: string}[] = [];
  engine.save = (text: string, name: string, type: string) => saved.push({text,name,type});
  await engine.downloadConvert();
  assert.equal(saved.length, 0, 'the YAML download waits for conversion');
  engine.settings.target = 'typescript';
  engine.scheduleConvert(0);
  await engine.runConvert();
  await settled();
  assert.equal(saved.some(s => s.name.endsWith('.yaml') && s.text.includes('interface Root')), false,
    'a TypeScript result must not satisfy a pending YAML download');
  assert.deepEqual(saved, [], 'nothing saved for the superseded click');
  assert.deepEqual(s.toasts, [], 'and nothing said');
  // Asked again for TypeScript: saved, under its own name.
  await engine.downloadConvert();
  await settled();
  // (Read past the assertion above, which narrows `saved` to empty.)
  const now = saved as { text: string; name: string; type: string }[];
  assert.equal(now.length, 1);
  assert.ok(now[0].name.endsWith('.ts') && now[0].text.includes('interface Root'), now[0].name);
});

test('Copy waiting for the Format output of other settings never gets the output of the settings after', async () => {
  const s = session();
  const { engine, navigator, state } = s;
  const copied: string[] = [];
  navigator.clipboard = { writeText: async (t: string) => { copied.push(t); } };
  reviewing(s, '{"a":1}');
  engine.fmt = { text: '', el: {}, setText(t: string) { this.text = t; }, setLines() {}, setNotes() {}, snapshotText: () => () => '', inlineIndex: () => ({}), lineCount: 0 };
  state.fmt = {};
  engine.settings.view = 'format';
  engine.good = parse(engine.ed.text);
  engine.goodText = engine.ed.text;
  engine.goodVer = engine.parsedVer = engine.ed.version;
  engine.runFormat();
  assert.equal(engine.fmt.text, '{\n  "a": 1\n}');
  // Minify asked for: its output still to be drawn (fmtKey still Pretty's), Copy waits for it.
  engine.settings.minify = true;
  engine.copyOutput();
  await settled();
  assert.deepEqual(copied, [], 'waits');
  // Back to Pretty before it comes: the waiting minified Copy ends with nothing (no pretty output, no toast).
  engine.setSettings({ minify: false });
  await s.drain();
  assert.deepEqual(copied, []);
  assert.deepEqual(s.toasts, []);
  // The document edited after a Copy asked: that Copy gets nothing either.
  engine.settings.minify = true;
  engine.copyOutput();
  engine.ed.setValue('{"b":2}');
  engine.runFormat();
  await s.drain();
  assert.deepEqual(copied, []);
});

test('the file a document was read from is let go once the editor\'s text is no longer it (Clear)', async () => {
  const s = session();
  reviewing(s);
  const input = JSON.stringify({value: 'x'.repeat(2_000_000)});
  const file = {size: input.length, name: 'big.json'};
  s.engine.load(input, 'big.json', true, false, file);
  // (The editor has it: the file stands for that version, and its text isn't kept a second time.)
  assert.ok(s.engine.fromFile && s.engine.fromFile.file === file && s.engine.fromFile.doc === s.engine.ed.version, 'the file goes with the version the editor has');
  assert.ok(!('text' in s.engine.fromFile) || s.engine.fromFile.text === undefined, 'its text is not kept');
  s.engine.clear();
  // Drain the zero-delay Format redraw, without advancing the unrelated long timeouts.
  for (let k = 0; k < 5; k++) { s.tick(); await settled(); }
  assert.equal(s.engine.ed.length, 0);
  assert.equal(s.engine.fromFile === null, true, 'the file optimization must release obsolete document versions');
});

test('a pretty index done or dropped keeps no tape: the Format view cleared holds none', async () => {
  const s = session();
  reviewing(s);
  await s.engine.tapeCode();
  const {parse: parseTape} = load(resolve(__dirname, '../lib/json/tape-parser'));
  const tape = parseTape('[1,2,3]');
  s.engine.goodVer = s.engine.ed.version;
  s.engine.drawPretty(tape, '[1,2,3]', s.engine.fmtSettings());
  s.engine.clear();
  for (let k = 0; k < 5; k++) { s.tick(); await settled(); }
  assert.equal(s.engine.fmtPretty, null);
  assert.equal(s.engine.prettyFor === null, true, 'a cleared view must not retain its old tape and cached index');
});

test('Copy waiting for pretty output read off a tape gets it in parts, made in steps, never one string', async () => {
  const s = session();
  reviewing(s);
  const {engine, navigator} = s;
  const {parse: parseTape} = load(resolve(__dirname, '../lib/json/tape-parser'));
  const {PrettyText, prettyIndexer} = load(resolve(__dirname, '../lib/json/pretty'));
  const src = '{"a":1}';
  const tape = parseTape(src);
  const pretty = new PrettyText(tape, src, '  ', prettyIndexer(tape, src, '  ')(Infinity));
  let whole = 0;
  const slice = pretty.slice.bind(pretty);
  pretty.slice = (...args: number[]) => { if (!args.length) whole++; return slice(...args); };
  engine.parsedVer = engine.ed.version;
  engine.fmtKey = 'old settings';
  engine.fmtOut = 'old output';
  const copied: string[] = [];
  navigator.clipboard = { writeText: async (t: string) => { copied.push(t); } };
  engine.copyOutput();
  engine.drawFormat(pretty, engine.fmtSettings());
  await s.drain();
  assert.equal(whole, 0, 'pending Copy must use PrettyText.parts(), just as Copy after rendering does');
  assert.deepEqual(copied, ['{\n  "a": 1\n}']);
});

// ── Input in another format (YAML, CSV, XML, TOML) ──

/**
 * A session whose input editor keeps its text and the steps whole-document changes make, with the views the
 * analysis updates faked. `diags`: the offsets each analysis underlined; `colors`: the colouring it set.
 */
/** A value made in the engine's realm, as one of this one (deepEqual compares prototypes too). */
const realm = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

function sourcing(text: string, format = 'yaml') {
  const s = session();
  const e = s.engine;
  const diags: number[][] = [];
  const ed: Dynamic = {
    text, version: Doc.of(text), caret: 0, steps: [] as unknown[], colors: null, el: { removeEventListener() {} },
    get blank() { return !this.text.trim(); },
    get length() { return this.text.length; },
    get ls() { return this.text.split('\n'); },
    lineCol(p: number) {
      const before = this.text.slice(0, p).split('\n');
      return { line: before.length, col: before[before.length - 1].length + 1 };
    },
    setValue(t: string, _caret?: number, _load?: boolean, names?: unknown, formats?: unknown) {
      if (t === this.text) return;
      this.text = t;
      this.version = Doc.of(t);
      this.steps.push({ names: names ?? null, formats: formats && (formats as string[])[0] !== (formats as string[])[1] ? formats : null });
      e.onChange('set');
    },
    reformatStep(formats: unknown, names?: unknown) { this.steps.push({ names: names ?? null, formats }); },
    setJwt() {}, setColors(c: unknown) { this.colors = c; }, setDiagnostics(d: { p: number }[]) { diags.push(d.map((x) => x.p)); },
    setScope() {}, setBrackets() {}, setCaret() {}, select() {}, focus() {}, destroy() {},
  };
  Object.assign(e, {
    ed, inFmt: format,
    tree: { setRoot() {}, select() {}, releaseRoot() {}, render() {}, destroy() {} },
    table: { setNode() {}, destroy() {} },
    setGraphRoot() {}, measure() {}, syncTableState() {}, afterDoc() {}, releaseWorkerDocuments() {}, persistSoon() {},
  });
  s.state.input = { format, delimiter: 'auto', detected: ',' };
  /** Edits the input as typing would, then lets the analysis run. */
  const type = async (t: string) => {
    ed.text = t;
    ed.version = Doc.of(t);
    e.onChange('input');
    await s.drain();
  };
  return { ...s, ed, diags, type };
}

test('an input in another format stays as typed: the views show its JSON, an error is underlined at its place', async () => {
  const s = sourcing('name: Ada\ntags:\n  - json\n');
  s.engine.analyze();
  await s.drain();
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0, src: 'yaml' });
  assert.equal(s.engine.converted, '{"name":"Ada","tags":["json"]}');
  assert.equal(s.engine.res.root.v.length, 2);
  assert.equal(s.engine.synced, false, 'tree positions are the JSON\'s, not the YAML\'s');
  assert.ok(s.ed.colors, 'coloured as YAML');
  assert.equal(s.ed.text, 'name: Ada\ntags:\n  - json\n', 'the input is never replaced');
  assert.equal(s.state.hint, null);

  await s.type('name: Ada\ntags: [json\n');
  const st = s.state.status;
  assert.equal(st.kind, 'error');
  assert.equal(st.src, 'yaml');
  assert.deepEqual([st.line, st.col], [s.ed.lineCol(st.p).line, s.ed.lineCol(st.p).col]);
  assert.deepEqual(realm(s.diags[s.diags.length - 1]), [st.p]);
  assert.equal(s.state.stale, true, 'the JSON shown is the last good one, dimmed');
  assert.equal(s.engine.converted, null);
  assert.equal(s.engine.good.root.v.length, 2);
});

test('text read as CSV that clearly is JSON says so, and reading it as JSON keeps the text', async () => {
  const s = sourcing('{"a": [1, 2]}', 'csv');
  s.engine.analyze();
  await s.drain();
  assert.equal(s.state.status.kind, 'valid');
  assert.equal(s.state.hint, 'json');
  s.engine.setInput('json');
  await s.drain();
  assert.equal(s.engine.inFmt, 'json');
  assert.equal(s.state.input.format, 'json');
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0 });
  assert.equal(s.ed.colors, null, 'coloured as JSON again');
  assert.equal(s.ed.text, '{"a": [1, 2]}');
  assert.equal(s.engine.synced, true);
  assert.deepEqual(realm(s.ed.steps), [{ names: null, formats: ['csv', 'json'] }], 'one undo step: Undo reads it as CSV again');
  s.engine.setInput('json');
  assert.equal(s.ed.steps.length, 1, 'the same reading again is no step');
});

test('Use as input replaces the YAML with its JSON, read as JSON from then on, under a .json name; the step carries both back', async () => {
  const s = sourcing('name: Ada\nage: 36\n');
  s.engine.edName = 'example.yaml';
  s.state.fileName = 'example.yaml';
  s.engine.analyze();
  await s.drain();
  s.engine.useOutput();
  await s.drain();
  assert.equal(s.ed.text, '{\n  "name": "Ada",\n  "age": 36\n}');
  assert.equal(s.engine.inFmt, 'json');
  assert.equal(s.state.fileName, 'example.json');
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(s.ed.steps)), [{ names: ['example.yaml', 'example.json'], formats: ['yaml', 'json'] }]);
  assert.match(s.toasts[s.toasts.length - 1], /^Formatted input · replaced the YAML with JSON · .*Z to undo$/);
  // Undo: the editor tells the name and the format back (Editor.undo), after its text.
  s.ed.text = 'name: Ada\nage: 36\n';
  s.ed.version = Doc.of(s.ed.text);
  s.engine.onChange('input');
  s.engine.renamed('example.yaml');
  s.engine.reformatted('yaml');
  await s.drain();
  assert.equal(s.engine.inFmt, 'yaml');
  assert.equal(s.state.input.format, 'yaml');
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0, src: 'yaml' });
});

test('valid JSON pasted over a document in another format is read as JSON again; a YAML flow mapping stays YAML', async () => {
  const s = sourcing('name: Ada\n');
  s.engine.analyze();
  await s.drain();
  /** A paste over everything as the editor makes it: its step asks for the formats, then the change follows. */
  const paste = async (t: string) => {
    const formats = s.engine.pastedFormats(t);
    s.ed.text = t;
    s.ed.version = Doc.of(t);
    s.ed.pasteFull = true;
    s.engine.onChange('paste');
    await s.drain();
    return formats && realm(formats);
  };
  assert.equal(await paste('{a: 1}'), undefined);
  assert.equal(s.engine.inFmt, 'yaml');
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0, src: 'yaml' });
  assert.deepEqual(await paste('{"a": [1, 2]}'), ['yaml', 'json'], 'its step carries the YAML back (see Editor.undo)');
  assert.equal(s.engine.inFmt, 'json');
  assert.equal(s.state.input.format, 'json');
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0 });
  assert.equal(s.ed.colors, null, 'coloured as JSON');
  assert.equal(await paste('[1]'), undefined, 'read as JSON already: nothing changes');
});

test('a converter failing (not the input) says the conversion failed, reported, as the worker says it', async () => {
  const s = sourcing('name: Ada\n');
  s.engine.analyze();
  await s.drain();
  s.engine.srcMod = { ...s.engine.srcMod, convertSource() { throw new TypeError('bug'); } };
  await s.type('name: Lin\n');
  assert.equal(s.state.status.kind, 'error');
  assert.equal(s.state.status.msg, 'Conversion failed');
  assert.equal(s.state.status.src, 'yaml');
  assert.equal(s.errors.length, 1, 'reported (without the input)');
});

test('Unescape: offered and done only for JSON in a string; escaped JSON with raw tabs and CRLF unescapes', async () => {
  const unescaping = async (text: string) => {
    const s = sourcing(text, 'json');
    s.engine.analyze();
    await s.drain();
    const hint = s.state.hint;
    s.engine.unescapeDoc();
    await s.drain();
    return { hint, text: s.ed.text, toast: s.toasts[s.toasts.length - 1] };
  };
  // Prose in a string that starts with a bracket: no banner, nothing changed.
  for (const text of ['"[citation needed]"', '"[1, 2] and more"']) {
    assert.deepEqual(await unescaping(text), { hint: null, text, toast: "This doesn't look like an escaped JSON string" }, text);
  }
  assert.deepEqual(await unescaping('"{\\"a\\": [1, 2]}"'), { hint: 'unescape', text: '{\n  "a": [\n    1,\n    2\n  ]\n}', toast: 'Unescaped' });
  // Pasted without its quotes, with a raw tab and a CRLF line break (JSON.parse rejects both in a string).
  for (const text of ['{\\"a\\":\t1}', '{\\"a\\":1,\r\n\\"b\\":2}']) {
    const r = await unescaping(text);
    assert.equal(r.hint, 'unescape', JSON.stringify(text));
    assert.equal(r.toast, 'Unescaped', JSON.stringify(text));
    assert.deepEqual(JSON.parse(r.text), text.includes('b') ? { a: 1, b: 2 } : { a: 1 });
  }
  // Escaped, but not JSON once unescaped: not offered.
  assert.equal((await unescaping('[\\"citation\\" needed]')).hint, null);
});

test('Unescape and Swap with an input in another format: the JSON is read as JSON; nothing to swap while it doesn\'t convert', async () => {
  const s = sourcing('"{\\"a\\": 1}"\n');
  s.engine.analyze();
  await s.drain();
  assert.equal(s.engine.converted, '"{\\"a\\": 1}"', 'a YAML string holding JSON');
  s.engine.unescapeDoc();
  await s.drain();
  assert.equal(s.ed.text, '{\n  "a": 1\n}');
  assert.equal(s.engine.inFmt, 'json', 'unescaped JSON is read as JSON');
  assert.deepEqual(realm(s.ed.steps[s.ed.steps.length - 1].formats), ['yaml', 'json']);

  const t = sourcing('a: [1\n');
  t.engine.analyze();
  await t.drain();
  t.engine.ed2 = { text: '{"b": 1}', setValue() { throw new Error('nothing goes over'); } };
  t.engine.swapCompare();
  assert.equal(t.toasts[t.toasts.length - 1], "Can't do that yet. Fix the error first.");
  assert.equal(t.ed.text, 'a: [1\n', 'the YAML stays');
});

test('an agent tool waits for the reader of the input\'s format, so a YAML input isn\'t empty to it', async () => {
  const s = sourcing('name: Ada\n');
  assert.equal(s.engine.srcMod, null);
  await s.engine.agentReady();
  assert.ok(s.engine.srcMod, 'the reader is loaded');
  const doc = s.engine.agentDoc();
  assert.equal(doc.format, 'yaml');
  assert.equal(doc.res.root.v.length, 1);
  assert.equal(doc.src, '{"name":"Ada"}');
});

test('CSV options changed while a big CSV converts in the worker: a command meanwhile reads it the new way', async () => {
  const csv = 'id,name\n' + Array.from({ length: 8000 }, (_, i) => `${i},user ${i}`).join('\n') + '\n';
  assert.ok(csv.length > 100_000);
  const s = sourcing(csv, 'csv');
  const posted: Dynamic[] = [];
  s.engine.srcMod = load(resolve(__dirname, '../lib/engine/source'));
  s.engine.srcWorker = { postMessage: (m: Dynamic) => posted.push(m), terminate() {} };
  s.engine.analyzeInSteps();
  s.engine.sourceConverted({ seq: posted[0].seq, json: s.engine.srcMod.convertSource(posted[0].text, 'csv', posted[0].csv).json });
  await s.drain();
  assert.ok(s.engine.converted.startsWith('[{"id":0,'));
  s.engine.setCsv({ header: false });
  assert.equal(posted.length, 2, 'the new reading goes to the worker');
  assert.equal(s.engine.res, null, 'the reading before is no answer now');
  // (A command before its reply: fresh() reads it here, the new way.)
  s.engine.fresh();
  assert.ok(s.engine.converted.startsWith('[["id","name"],[0,"user 0"]'), s.engine.converted.slice(0, 40));
});

test('CSV: the separator is detected unless chosen, and the header row and typed values can be turned off', async () => {
  const s = sourcing('a;b\n1;x\n', 'csv');
  s.engine.analyze();
  await s.drain();
  assert.equal(s.engine.converted, '[{"a":1,"b":"x"}]');
  assert.equal(s.state.input.detected, ';');
  s.engine.setCsv({ header: false });
  assert.equal(s.engine.converted, '[["a","b"],[1,"x"]]');
  s.engine.setCsv({ header: true, types: false });
  assert.equal(s.engine.converted, '[{"a":"1","b":"x"}]');
  s.engine.setCsv({ types: true, delimiter: ',' });
  assert.equal(s.engine.converted, '[{"a;b":"1;x"}]');
  assert.equal(s.state.input.delimiter, ',');
  // A new document detects its separator again; a .tsv file's is a tab.
  s.engine.finishLoad = () => {};
  s.engine.load('a\tb\n1\t2\n', 'rows.tsv');
  assert.deepEqual([s.engine.inFmt, s.state.input.delimiter], ['csv', '\t']);
  s.engine.load('a,b\n1,2\n', null);
  assert.deepEqual([s.engine.inFmt, s.state.input.delimiter], ['csv', 'auto'], 'a paste keeps the format it is pasted into');
  s.engine.load('{}', 'data.json');
  assert.equal(s.engine.inFmt, 'json');
});

test('the format is saved with the document, and only with it; a share link says what its document is', async () => {
  const s = sourcing('name: Ada\n');
  Object.assign(s.engine, { persistEnabled: true, edName: null });
  s.engine.persist(null);
  assert.equal(s.storage.get('jf:doc'), 'name: Ada\n');
  assert.equal(s.storage.get('jf:fmt'), 'yaml');
  s.engine.inFmt = 'json';
  s.engine.persist(null);
  assert.equal(s.storage.get('jf:fmt'), undefined);

  const link = load(resolve(__dirname, '../lib/link'));
  const hash: string = await link.linkHash({ a: { text: 'name: Ada\n' }, view: 'tree', in: 'yaml' });
  assert.match(hash, /&in=yaml$/);
  assert.equal(link.parseLink(hash).in, 'yaml');
  assert.equal(link.parseLink(hash.replace('in=yaml', 'in=exe')).in, undefined);
  assert.doesNotMatch(await link.linkHash({ a: { text: '{}' }, in: 'json' }), /in=/);
});

test('Download input saves another format as itself', () => {
  const s = sourcing('a,b\n1,2\n', 'csv');
  const saved: string[] = [];
  s.engine.save = (_text: string, name: string, type: string) => saved.push(`${name} ${type}`);
  s.engine.download();
  s.state.fileName = 'rows.tsv';
  s.engine.download();
  assert.deepEqual(saved, ['data.csv text/csv', 'rows.tsv text/csv']);
});

test('a big input in another format converts in the worker, its JSON parsed in steps; a reply for an older version or reading is dropped', async () => {
  const yaml = Array.from({ length: 4000 }, (_, i) => `- id: ${i}\n  name: user ${i}\n`).join('');
  assert.ok(yaml.length > 100_000);
  const s = sourcing(yaml);
  const posted: Dynamic[] = [];
  const workers: Dynamic[] = [];
  s.engine.srcMod = load(resolve(__dirname, '../lib/engine/source'));
  // (A worker as the page makes one: started on first use, and again after one was stopped.)
  s.engine.sourceWorker = () => {
    if (s.engine.srcWorker === undefined) workers.push((s.engine.srcWorker = { postMessage: (m: Dynamic) => posted.push(m), terminate() { this.stopped = true; }, stopped: false }));
    return s.engine.srcWorker;
  };
  s.engine.analyzeInSteps();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].format, 'yaml');
  assert.equal(s.state.status.kind, 'parsing');
  const reply = (m: Dynamic) => s.engine.sourceConverted({ seq: m.seq, json: s.engine.srcMod.convertSource(m.text, m.format, m.csv).json });
  reply(posted[0]);
  await s.drain();
  assert.deepEqual(realm(s.state.status), { kind: 'valid', warnings: 0, src: 'yaml' });
  assert.equal(s.engine.res.root.v.length, 4000);
  assert.equal(s.engine.synced, false);

  // Typed again: the reply for the version before is dropped, the newest one is shown.
  await s.type(yaml + '- id: x\n');
  assert.equal(posted.length, 2);
  assert.equal(workers.length, 1, 'an idle worker takes the next one');
  await s.type(yaml + '- id: y\n');
  assert.equal(posted.length, 3);
  assert.deepEqual([workers.length, workers[0].stopped], [2, true], 'one still converting an older text is stopped, not waited out');
  reply(posted[1]);
  await s.drain();
  assert.equal(s.state.status.kind, 'parsing');
  reply(posted[2]);
  await s.drain();
  assert.equal(s.engine.res.root.v.length, 4001);
  assert.equal(s.engine.res.root.v[4000].v[0].v, 'y');

  // An error from the worker is shown at its place, as one made here.
  await s.type(yaml + 'x: [1\n');
  s.engine.sourceConverted({ seq: posted[3].seq, error: 'Unterminated flow sequence', p: yaml.length + 3 });
  await s.drain();
  assert.equal(s.state.status.kind, 'error');
  assert.equal(s.state.status.p, yaml.length + 3);
  assert.equal(s.state.status.src, 'yaml');
});

test('the Schema view\'s places in a big input are found in the source worker, a small one\'s here; one on its way ends with the worker (review 2, finding 6)', async () => {
  const real = load(resolve(__dirname, '../lib/engine/source'));
  const here: unknown[][] = [];
  const csv = 'id,name\n' + Array.from({ length: 12_000 }, (_, i) => `${i},user ${i}`).join('\n') + '\n';
  assert.ok(csv.length > 100_000);
  const big = sourcing(csv, 'csv');
  big.engine.srcMod = { ...real, locateImport: (...a: unknown[]) => (here.push(a), real.locateImport(...a)) };
  const w = big.engine.sourceWorker();
  const posted: Dynamic[] = [];
  w.postMessage = (m: Dynamic) => posted.push(m);
  const got = big.engine.locateSource('csv', { delimiter: ',', header: true }, ['/5/name'], [false]);
  assert.deepEqual([posted.length, JSON.stringify(posted[0].locate), posted[0].text === csv, here.length], [1, '{"pointers":["/5/name"],"keys":[false]}', true, 0]);
  w.onmessage({ data: { seq: posted[0].seq, places: [{ p: 42, exact: true }] } });
  assert.deepEqual(await got, [{ p: 42, exact: true }]);
  // The worker fails (or is stopped for a newer conversion): what was asked of it comes back as nothing.
  const lost = big.engine.locateSource('csv', { delimiter: ',', header: true }, ['/5/name'], [false]);
  w.onerror({ preventDefault() {} });
  assert.equal(await lost, null);
  // A small input: here, no worker.
  const small = sourcing('id,name\n1,Ada\n', 'csv');
  small.engine.srcMod = { ...real, locateImport: (...a: unknown[]) => (here.push(a), real.locateImport(...a)) };
  const places = await small.engine.locateSource('csv', { delimiter: ',', header: true }, ['/0/name'], [false]);
  assert.deepEqual([places, here.length, small.engine.srcWorker], [[{ p: 10, exact: true }], 1, undefined]);
});
