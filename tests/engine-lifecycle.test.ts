import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Doc } from '../lib/engine/doc';
import { parse, type JNode } from '../lib/json/parser';

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
  const state: Dynamic = { fileName: null, status: { kind: 'empty' }, sizes: null, convert: { loading: false, error: null, lines: 0, bytes: 0 }, find: { open: false, q: '', total: 0, index: -1, seq: 0 }, toast: null, menu: null };
  const errors: unknown[] = [];
  const toasts: string[] = [];
  let workers = 0;
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); };
  const off = (type: string, fn: () => void) => { listeners.get(type)?.delete(fn); };
  const storage = new Map<string, string>();
  const fetches: { url: string; signal?: AbortSignal; reply: ReturnType<typeof later<unknown>> }[] = [];
  const sw: Dynamic = { listeners: [] as ((e: { data: unknown }) => void)[], registered: 0 };
  let current: Dynamic | null = null;
  const window: Dynamic = { setTimeout: defer, requestIdleCallback: defer, cancelIdleCallback: cancel, addEventListener: on, removeEventListener: off };
  const document = { readyState: 'complete', documentElement: { lang: 'en', dataset: {} }, createElement: () => ({ getContext: () => null }) };
  const location = { hash: '', href: 'https://tools.example/', pathname: '/', search: '', origin: 'https://tools.example', reload() {} };
  const exports: Dynamic = {};
  runInNewContext(js, {
    exports, performance, URL, console, AbortController, Intl, Blob,
    process: { env: { NODE_ENV: 'production' } },
    setTimeout: defer, clearTimeout: cancel, requestAnimationFrame: defer, requestIdleCallback: defer, cancelIdleCallback: cancel, window, addEventListener: on, removeEventListener: off,
    document, location,
    getComputedStyle: () => ({}),
    history: { replaceState() {} },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
    navigator: {
      serviceWorker: {
        addEventListener: (_type: string, fn: (e: { data: unknown }) => void) => sw.listeners.push(fn),
        register: () => { sw.registered++; return new Promise(() => {}); },
      },
    },
    fetch: (url: unknown, init?: { signal?: AbortSignal }) => {
      const reply = later<unknown>();
      init?.signal?.addEventListener('abort', () => reply.fail(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      fetches.push({ url: String(url), signal: init?.signal, reply });
      return reply.promise;
    },
    Worker: class {
      constructor() { workers++; }
      postMessage() {}
      terminate() {}
    },
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: (patch: object) => { Object.assign(state, patch); } } };
      if (name === './idle') return { soon: defer, idle: defer };
      if (name === './instance') return { getEngine: () => current, getDiffMenu: () => null };
      if (name === '../analytics') return { PRIVATE: 'private', track() {}, reportError: (error: unknown) => errors.push(error) };
      if (name === '../analytics/load') return { noteLoad() {}, watchPastes() {} };
      if (name === './sample') return { SAMPLE: '{"id":1,"name":"Zoë"}' };
      if (name === './sizes') return { compressedSizes: () => Promise.resolve({ gzip: 1 }) };
      if (name === './editor') return { loadSurface: () => Promise.resolve() };
      if (name === '../json/smart') return { embeddedJson: (s: string) => s };
      if (name === '../link' || name === './targets' || name === './doc' || name === './rules' || name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const make = () => {
    const engine = new exports.Engine();
    engine.settings = { view: 'format', indent: '2', minify: false, escape: false, sortKeys: false, target: 'typescript', rootName: 'Root', tsStyle: 'interface', csharpLib: 'stj', autoFormat: false };
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
  return { engine, make, state, errors, toasts, tasks, tick, drain, storage, fetches, sw, listeners, document, location, setCurrent: (e: Dynamic | null) => { current = e; }, workers: () => workers };
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
  return code;
}

const converters = { convert: (root: JNode) => `OUTPUT ${(root.v as JNode[]).map((n) => n.key).join()}`, highlightCode: () => '' };

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

const file = (name: string, text: Promise<string>, size = 10) => ({ name, size, text: () => text });

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
  fetches[1].reply.settle({ ok: true, text: () => Promise.resolve('{"b":1}') });
  fetches[0].reply.settle({ ok: true, text: () => Promise.resolve('{"a":1}') });
  await Promise.all([first, second]);
  assert.deepEqual(loads, ['1:b.json']);
  assert.deepEqual(toasts, ['Fetching…', 'Fetching…', 'Loaded b.example']);
});

test("a file opened while a link's document downloads wins, and the link stays quiet", async () => {
  const { engine, loads, toasts, fetches, location } = loading();
  location.hash = '#a=' + encodeURIComponent('https://a.example/data.json');
  location.href = 'https://tools.example/' + location.hash;
  const opening = engine.openLink();
  await settled();
  await engine.loadFile(file('b.json', Promise.resolve('{"b":1}')));
  assert.equal(fetches[0].signal?.aborted, true);
  fetches[0].reply.settle({ ok: true, text: () => Promise.resolve('{"a":1}') });
  await opening;
  await settled();
  assert.deepEqual(loads, ['1:b.json']);
  assert.deepEqual(toasts, ['Fetching…', 'Opened b.json']);
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

test('Clear drops a file still being read', async () => {
  const { engine, loads } = loading();
  const a = later<string>();
  const first = engine.loadFile(file('a.json', a.promise));
  engine.clear();
  a.settle('{}');
  await first;
  assert.deepEqual(loads, []);
});
