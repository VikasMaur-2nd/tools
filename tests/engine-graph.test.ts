import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse } from '../lib/json/parser';
import { packTree } from '../lib/json/pack';
import { EN } from '../lib/i18n/ui';

// Run the real engine methods with a controlled import and animation-frame queue.
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

function session() {
  const frames: (() => void)[] = [];
  const tasks: (() => void)[] = [];
  const calls: [string, ...unknown[]][] = [];
  const events: unknown[] = [];
  const errors: unknown[] = [];
  const state: Dynamic = { settings: { view: 'format' }, find: { q: '', seq: 0 }, fileName: 'example.json' };
  let fail = false;
  let imports = 0;
  let exportsFail = false;
  const graph: Dynamic = {};
  for (const name of ['setRoot', 'activate', 'deactivate', 'select', 'expandAll', 'collapseAll', 'expandTo', 'fit', 'zoomBy', 'themeChanged', 'destroy']) {
    graph[name] = (...args: unknown[]) => { calls.push([name, ...args]); };
  }
  graph.search = (q: string, jump: boolean) => { calls.push(['search', q, jump]); return { total: 2, index: 0 }; };
  graph.step = (dir: number) => { calls.push(['step', dir]); return { total: 2, index: 1 }; };
  graph.exportImage = (opts: { format: string }) => exportsFail ? Promise.reject(new Error('Image is too large')) : Promise.resolve(new Blob([opts.format]));
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error,
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout: (fn: () => void) => tasks.push(fn), clearTimeout: () => {},
    window: { setTimeout: (fn: () => void) => tasks.push(fn) },
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
      if (name === './idle') return { soon: (fn: () => void) => tasks.push(fn) };
      if (name === '../analytics') return { track: (...args: unknown[]) => events.push(args), reportError: (...args: unknown[]) => errors.push(args) };
      if (name === '../i18n/ui') return { rt: EN };
      if (name === '../graph/view') {
        imports++;
        if (fail) throw new Error('Network failure');
        return { GraphView: class { constructor(_host: unknown, ev: unknown) { graph.events = ev; return graph; } } };
      }
      if (name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const engine = new out.Engine();
  engine.settings = state.settings;
  engine.els = { graph: {} };
  engine.flushLoad = () => {};
  engine.setSettings = (patch: Dynamic) => Object.assign(state.settings, patch);
  engine.tree = { select: (...args: unknown[]) => calls.push(['tree.select', ...args]), setRoot: () => {} };
  engine.table = { setNode: () => {} };
  engine.compareMarks = () => {};
  engine.scheduleFormat = () => {};
  engine.scheduleConvert = () => {};
  engine.ed = { setScope: (...args: unknown[]) => calls.push(['scope', ...args]), isVisible: () => true };
  engine.toast = (...args: unknown[]) => calls.push(['toast', ...args]);
  engine.saveBlob = (...args: unknown[]) => calls.push(['save', ...args]);
  const frame = () => { for (const fn of frames.splice(0)) fn(); };
  const drain = () => { while (tasks.length) tasks.shift()!(); };
  const open = async () => { engine.setView('graph'); await engine.loadGraph(); frame(); };
  return { engine, graph, calls, events, errors, state, open, frame, drain, imports: () => imports, fail: (v: boolean) => { fail = v; }, failExport: () => { exportsFail = true; } };
}

test('graph imports once and receives the latest pending document before activation', async () => {
  const s = session();
  const first = parse('{"first":1}');
  const latest = parse('{"latest":{"value":2}}');
  s.engine.setGraphRoot(first.root, true, first.nodes);
  s.engine.setGraphRoot(latest.root, false, latest.nodes);
  assert.equal(s.imports(), 0);
  await s.open();
  assert.equal(s.imports(), 1);
  assert.equal(s.state.settings.view, 'graph');
  assert.deepEqual(s.calls[0], ['setRoot', latest.root, false, latest.nodes, false]);
  assert.ok(s.calls.some(([name]) => name === 'activate'));
  s.engine.setView('format');
  assert.ok(s.calls.some(([name]) => name === 'deactivate'));
  await s.open();
  assert.equal(s.imports(), 1);
});

test('graph import failure leaves the current view usable and the next open retries', async () => {
  const s = session();
  s.fail(true);
  await s.open();
  assert.equal(s.state.settings.view, 'format');
  assert.equal(s.errors.length, 1);
  assert.ok(s.calls.some(([name]) => name === 'toast'));
  s.fail(false);
  await s.open();
  assert.equal(s.imports(), 2);
  assert.equal(s.state.settings.view, 'graph');
});

test('a slow graph import cannot override a later view choice', async () => {
  const s = session();
  s.engine.setView('graph');
  s.engine.setView('format');
  await s.engine.loadGraph();
  s.frame();
  assert.equal(s.state.settings.view, 'format');
  assert.ok(!s.calls.some(([name]) => name === 'activate'));
});

test('a queued graph activation cannot run after leaving the view', async () => {
  const s = session();
  await s.engine.loadGraph();
  s.engine.setView('graph');
  s.engine.setView('format');
  s.frame();
  assert.ok(!s.calls.some(([name]) => name === 'activate'));
});

test('graph root updates track whether the view is active and preserve the reset flag', async () => {
  const s = session();
  await s.open();
  const r = parse('{"a":1}');
  s.engine.setGraphRoot(r.root, true, r.nodes);
  assert.deepEqual(s.calls.at(-1), ['setRoot', r.root, true, r.nodes, true]);
  s.engine.setView('format');
  s.engine.setGraphRoot(null, true);
  assert.deepEqual(s.calls.at(-1), ['setRoot', null, true, 0, false]);
});

test('graph receives packed documents through the deferred node path', async () => {
  const s = session();
  await s.engine.loadGraph();
  const text = '{"nested":{"value":1}}';
  const parsed = parse(text);
  s.engine.goodPacked = { id: -1, tree: packTree(parsed, text), text };
  s.engine.setView('graph');
  assert.equal(s.state.settings.view, 'format');
  s.drain();
  s.frame();
  assert.equal(s.state.settings.view, 'graph');
  assert.ok(s.calls.some(([name, node]) => name === 'setRoot' && node && (node as { t: number }).t === parsed.root!.t));
});

test('graph find, stepping and folding route through the graph API', async () => {
  const s = session();
  await s.open();
  s.engine.find('$.nested');
  assert.equal(s.state.find.total, 2);
  assert.deepEqual(s.calls.at(-1), ['search', '$.nested', true]);
  s.engine.findStep(1);
  assert.equal(s.state.find.index, 1);
  s.engine.refind(false);
  assert.deepEqual(s.calls.at(-1), ['search', '$.nested', false]);
  s.engine.expandAll();
  assert.deepEqual(s.calls.at(-1), ['expandAll']);
  s.engine.collapseAll();
  assert.deepEqual(s.calls.at(-1), ['collapseAll']);
  s.engine.expandTo(3);
  assert.deepEqual(s.calls.at(-1), ['expandTo', 3]);
});

test('graph selection shares the editor scope and selected-value copy flow', async () => {
  const s = session();
  await s.open();
  const n = parse('{"value":1}').root!;
  Object.defineProperty(s.engine, 'synced', { value: true });
  s.graph.events.select(n, 'pointer');
  assert.equal(s.engine.sel, n);
  assert.equal(s.state.path, '$');
  assert.deepEqual(s.calls.at(-1), ['scope', n.s, n.e]);
  let copied: unknown;
  s.engine.copyValue = (value: unknown) => { copied = value; };
  s.engine.copyView();
  assert.equal(copied, n);
});

test('editor navigation reveals the caret node in the active graph', async () => {
  const s = session();
  await s.open();
  const text = '{"value":1}';
  s.engine.res = parse(text);
  s.engine.ed.text = text;
  s.engine.ed.caret = 9;
  Object.defineProperty(s.engine, 'synced', { value: true });
  s.engine.onNav();
  const selection = s.calls.find(([name, node]) => name === 'select' && node);
  assert.ok(selection);
  assert.equal((selection[1] as { v: string }).v, '1');
  assert.equal((selection[2] as { scroll: boolean }).scroll, true);
  assert.equal(s.state.path, '$.value');
});

test('graph open, copy and escape events use the existing editor commands', async () => {
  const s = session();
  await s.open();
  const n = parse('1').root!;
  const calls: unknown[] = [];
  s.engine.openInEditor = (node: unknown) => calls.push(['open', node]);
  s.engine.copyValue = (node: unknown) => calls.push(['value', node]);
  s.engine.copyPath = (node: unknown) => calls.push(['path', node]);
  s.engine.focusEditor = () => calls.push(['escape']);
  s.graph.events.open(n);
  s.graph.events.copy(n, 'value');
  s.graph.events.copy(n, 'path');
  s.graph.events.escape();
  assert.deepEqual(calls, [['open', n], ['value', n], ['path', n], ['escape']]);
});

test('graph exports use the document base name and do not reactivate the graph', async () => {
  const s = session();
  await s.open();
  s.calls.length = 0;
  // The toolbar's download button opens the export dialog.
  s.engine.downloadView();
  assert.equal(s.state.graphExport, true);
  s.engine.downloadGraph('png');
  await Promise.resolve();
  assert.equal(s.calls[0][0], 'save');
  assert.equal(s.calls[0][2], 'example.png');
  s.engine.downloadGraph('svg');
  await Promise.resolve();
  assert.equal(s.calls.at(-1)![2], 'example.svg');
  s.engine.downloadGraph({ format: 'jpeg', area: 'view', background: '#ffffff', scale: 1 }, 'my chart');
  await Promise.resolve();
  assert.equal(s.calls.at(-1)![2], 'my chart.jpg');
  assert.ok(!s.calls.some(([name]) => name === 'activate'));
});

test('a graph download asked for before the graph shows settles, also when it never does', async () => {
  const s = session();
  await s.engine.loadGraph();
  // Another view before the graph showed: nothing is saved, and the caller hears so.
  const first = s.engine.downloadGraph('png');
  s.engine.setView('format');
  s.frame();
  assert.equal(await first, null);
  assert.ok(!s.calls.some(([name]) => name === 'save'));
  // Two asked for while it opens both run once it shows.
  const second = s.engine.downloadGraph('png');
  const third = s.engine.downloadGraph('svg');
  s.frame();
  assert.deepEqual({ ...(await second) }, { file: 'example.png', size: 3 });
  assert.deepEqual({ ...(await third) }, { file: 'example.svg', size: 3 });
  // The graph's code doesn't load: the view goes back to Format, and the download settles.
  const t = session();
  t.fail(true);
  const fourth = t.engine.downloadGraph('png');
  await t.engine.loadGraph();
  assert.equal(t.state.settings.view, 'format');
  assert.equal(await fourth, null);
});

test('graph export rejections become a translated toast and a sanitized error report', async () => {
  const s = session();
  await s.open();
  s.failExport();
  s.engine.downloadGraph('png');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.errors.length, 1);
  assert.deepEqual(s.calls.at(-1), ['toast', "Couldn't download graph: Image is too large", 'err']);
});

test('system theme changes refresh graph colours on the next animation frame', async () => {
  const s = session();
  await s.open();
  s.calls.length = 0;
  s.engine.settings.theme = 'system';
  s.engine.onSystemTheme();
  assert.equal(s.calls.length, 0);
  s.frame();
  assert.deepEqual(s.calls, [['themeChanged']]);
  s.engine.settings.theme = 'light';
  s.engine.onSystemTheme();
  s.frame();
  assert.equal(s.calls.length, 1);
});
