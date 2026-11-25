import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse } from '../lib/json/parser';
import { EN } from '../lib/i18n/ui';
import { paired } from '../lib/engine/store';
import { decodeDoc, encodeDoc, parseLink, type LinkSource } from '../lib/link';

// Links as the engine opens and makes them, with lib/link.ts loaded when needed (its code isn't in the first load):
// what typing, the schema editor or another view do while it loads, what a failed load says, CSV's reading in links,
// and the service worker getting links' code before the other features.

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

const ORIGIN = 'https://tools.vikasmaur.com';

/** An engine whose link code loads (or fails to, `linkFails`) as the page's would; `globals` added to its world. */
function session({ linkFails = false, globals = {} as Dynamic } = {}) {
  const calls: unknown[][] = [];
  const state: Dynamic = { settings: { view: 'format', target: 'typescript', indent: '2', csvHeader: true, csvTypes: true }, convert: { error: null }, input: { format: 'json', delimiter: 'auto', detected: ',' } };
  const loc = { origin: ORIGIN, hash: '', href: ORIGIN + '/', pathname: '/', search: '' };
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error, Promise, AbortController, setTimeout: () => 0,
    location: loc,
    history: { replaceState: () => { loc.hash = ''; calls.push(['replaceState']); } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    ...globals,
    require: (name: string) => {
      if (name === '../link') {
        if (linkFails) throw new TypeError('Failed to fetch dynamically imported module');
        return load(resolve(__dirname, '../lib/link'));
      }
      if (name === './store') return { paired, store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch), settings: (patch: Dynamic) => (state.settings = { ...state.settings, ...patch }) } };
      if (name === '../analytics/load') return { noteLoad: () => {} };
      if (name === '../analytics') return { track: () => {}, reportError: () => {} };
      if (name === '../i18n/ui') return { rt: EN };
      if (name === './idle' && globals.idle) return { idle: globals.idle, soon: (f: () => void) => f() };
      if (name === './rules' || name === './targets' || name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const engine = new out.Engine();
  engine.settings = state.settings;
  engine.ed = { version: {}, text: '' };
  engine.ed2 = { version: {}, text: '' };
  engine.dead = false;
  engine.inFmt = 'json';
  engine.flushLoad = () => {};
  engine.toast = (...args: unknown[]) => calls.push(['toast', ...args]);
  engine.openRequest = (r: Dynamic, signal: AbortSignal) => calls.push(['open', r, signal.aborted]);
  return { engine, calls, state, loc };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const opened = (calls: unknown[][]) => calls.filter((c) => c[0] === 'open');

test('a link opened while its code loads: typing in the input wins (its request is made before the code loads)', async () => {
  // (The request was made once lib/link.ts had loaded, so an edit meanwhile couldn't stop it: the link replaced it.)
  const s = session();
  s.loc.hash = '#a=' + (await encodeDoc('{"linked":1}'));
  const opening = s.engine.openLink();
  // What typing does (Engine.onChange): the input's request stops.
  s.engine.requests[1]?.abort();
  await opening;
  await settle();
  assert.deepEqual(opened(s.calls), []);
  assert.equal(s.loc.hash, '', 'the link is taken out of the address bar all the same');
  // Untouched, it opens.
  const t = session();
  t.loc.hash = '#a=' + (await encodeDoc('{"linked":1}'));
  await t.engine.openLink();
  await settle();
  assert.equal(opened(t.calls).length, 1);
});

test("a schema link: the schema editor has its own request, which a schema change stops (Compare's doesn't)", async () => {
  const s = session();
  const schema = s.engine.requestFor({ b: true, view: 'schema' });
  const compare = s.engine.requestFor({ b: true, view: 'compare' });
  assert.equal(schema.aborted, false, "Compare's request isn't the schema's");
  s.engine.schemaChanged();
  assert.equal(schema.aborted, true);
  assert.equal(compare.aborted, false);
  // A cold schema link: the schema edited while its code loads stops it.
  const t = session();
  t.loc.hash = `#a=${await encodeDoc('{"n":1}')}&b=${await encodeDoc('{"type":"object"}')}&view=schema`;
  const opening = t.engine.openLink();
  t.engine.schemaChanged();
  await opening;
  await settle();
  assert.deepEqual(opened(t.calls), []);
  // Typing in Compare doesn't stop a schema link.
  const u = session();
  u.loc.hash = `#b=${await encodeDoc('{"type":"object"}')}&view=schema`;
  const going = u.engine.openLink();
  u.engine.requests[2]?.abort();
  await going;
  await settle();
  assert.equal(opened(u.calls).length, 1);
});

test("a link whose code can't load says so, and stays in the address bar for a reload", async () => {
  // (It said nothing: the old document stayed, the link sat in the address bar.)
  const s = session({ linkFails: true });
  s.loc.hash = '#a=abc';
  await s.engine.openLink();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [['toast', "Couldn't open the link. Check your connection, then reload the page.", 'err']]);
  assert.equal(s.loc.hash, '#a=abc');
  // Not a link: nothing is loaded, nothing said.
  const t = session({ linkFails: true });
  t.loc.hash = '#how-it-works';
  await t.engine.openLink();
  assert.deepEqual(t.calls, []);
});

test("Share: the whole request is the page's at the click (switching to Schema while the code loads doesn't change it)", async () => {
  // (b was read at the click, the view after the code had loaded: Compare's document went out as view=schema's schema.)
  const s = session();
  s.engine.settings = { ...s.engine.settings, view: 'compare' };
  s.engine.ed = { version: {}, text: '[1]' };
  s.engine.ed2 = { version: {}, text: '[2]' };
  s.engine.fresh = () => parse('[1]');
  const sharing = s.engine.shareUrl();
  s.engine.settings = { ...s.engine.settings, view: 'schema', target: 'flatten', flat: { sep: '/', arrays: 'dot', escape: false, depth: 1 } };
  s.engine.schemaShare = () => ({ text: '{"type":"object"}', draft: 'draft-07', formats: true });
  s.engine.inFmt = 'csv';
  const { url, comparing } = await sharing;
  assert.equal(comparing, true);
  const link = parseLink(new URL(url).hash) as Dynamic;
  assert.equal(link.view, undefined, 'a comparison (two documents open Compare by themselves)');
  assert.equal(await decodeDoc((link.b as { data: string }).data), '[2]');
  assert.doesNotMatch(url, /view=schema|draft=|formats=|in=|sep=/);
});

test('CSV links carry how CSV reads (separator, header row, typing), and open with it for that visit only', async () => {
  // (The reader's own CSV settings read the document: a schema could pass for one and fail for the other.)
  const s = session();
  s.engine.inFmt = 'csv';
  s.engine.csvDelim = ';';
  s.engine.settings = { ...s.engine.settings, csvHeader: false, csvTypes: false };
  s.engine.ed = { version: {}, text: 'a;b\n1;2\n' };
  s.engine.fresh = () => parse('[]');
  const { url } = await s.engine.shareUrl();
  assert.match(url, /&in=csv&delimiter=semicolon&header=0&types=0$/);
  assert.deepEqual((parseLink(new URL(url).hash) as Dynamic).csv, { delimiter: ';', header: false, types: false });
  // The defaults aren't written.
  s.engine.csvDelim = 'auto';
  s.engine.settings = { ...s.engine.settings, csvHeader: true, csvTypes: true };
  assert.match((await s.engine.shareUrl()).url, /&in=csv$/);

  // Opening one: the separator for its document, header and typing before it is read, nothing saved.
  const t = session();
  const own = { theme: 'dark', csvHeader: true, csvTypes: true };
  t.engine.saved = { ...own };
  let at: Dynamic = {};
  t.engine.load = (_text: string, _name: unknown, _persist: unknown, _first: unknown, _file: unknown, format: string, delimiter: string) => {
    at = { format, delimiter, header: t.engine.settings.csvHeader, types: t.engine.settings.csvTypes };
  };
  delete t.engine.openRequest;
  t.engine.setView = () => {};
  await t.engine.openRequest({ a: { text: 'a;b\n1;2\n' }, in: 'csv', csv: { delimiter: ';', header: false, types: false } }, new AbortController().signal);
  assert.deepEqual(at, { format: 'csv', delimiter: ';', header: false, types: false });
  assert.deepEqual(t.engine.saved, own, 'nothing saved: the reader\'s own settings are back next time');
  assert.equal(t.engine.presetting, false);
  // Without them (an older link, or JSON): the reader's settings, a separator detected.
  await t.engine.openRequest({ a: { text: 'a,b\n1,2\n' }, in: 'csv' }, new AbortController().signal);
  assert.deepEqual(at, { format: 'csv', delimiter: undefined, header: false, types: false });
});

test("the service worker gets links' code first, before the other features load one per idle period", async () => {
  // (Links' code came in the last pass, after every feature: offline before that, a cached page couldn't open a link.)
  const posted: Dynamic[] = [];
  const idles: (() => void)[] = [];
  const chunk = ORIGIN + '/_next/static/chunks/link.js';
  const globals = {
    process: { env: { NODE_ENV: 'production' } },
    navigator: { serviceWorker: { addEventListener: () => {}, register: () => Promise.resolve(), ready: Promise.resolve({ active: { postMessage: (m: Dynamic) => posted.push(m) } }) } },
    document: { readyState: 'complete' },
    window: { addEventListener: () => {} },
    setTimeout: (f: () => void) => f(),
    performance: { now: () => performance.now(), getEntriesByType: () => [{ name: chunk }, { name: 'https://elsewhere.example/x.js' }] },
    idle: (f: () => void) => void idles.push(f),
  };
  const s = session({ globals });
  s.engine.registerSW();
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: 'cache', urls: [chunk] }]);
  assert.equal(idles.length, 1, 'the other features wait for an idle period');
});

test("the offline checks' WATCH_POSTS counts the warm-up's post, not links' early one: swIdle's `posted` still waits for the features", async () => {
  // (Links' code is posted first, on its own: counted as the page's post, swIdle({ posted }) went on before the
  // features were loaded and their chunks followed, and the offline checks after it raced the worker.)
  const { WATCH_POSTS } = (await import(join(process.cwd(), 'harness/suites/platform/_helpers.mjs'))) as { WATCH_POSTS: () => void };
  const page: Dynamic = { location: { origin: ORIGIN, pathname: '/' } };
  const sent: Dynamic[] = [];
  const browser: Dynamic = {
    ServiceWorker: class { postMessage(m: Dynamic) { sent.push(m); } },
    ServiceWorkerContainer: class {
      register() { return Promise.resolve(); }
      get ready() { return Promise.resolve({ active: new browser.ServiceWorker() }); }
      addEventListener() {}
    },
    window: page, location: page.location,
  };
  runInNewContext(`(${WATCH_POSTS})()`, browser);
  const idles: (() => void)[] = [];
  const s = session({ globals: {
    process: { env: { NODE_ENV: 'production' } },
    navigator: { serviceWorker: new browser.ServiceWorkerContainer() },
    document: { readyState: 'complete' }, window: { addEventListener: () => {} },
    // (At once, registering 4 s after load included, but not the warm-up's 6 s and 20 s fallbacks: idle periods drive it here.)
    setTimeout: (f: () => void, ms = 0) => void (ms < 6000 && f()),
    performance: { now: () => performance.now(), mark() {}, getEntriesByType: () => [{ name: ORIGIN + '/_next/static/chunks/link.js' }] },
    idle: (f: () => void) => void idles.push(f),
  } });
  s.engine.registerSW();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(sent.length, 1, "links' code, posted");
  assert.deepEqual({ posted: page.__swPosted, early: page.__swSteps.early, register: page.__swSteps.register, ready: page.__swSteps.ready }, { posted: undefined, early: 1, register: 'resolved', ready: true });
  // The features, one per idle period, then the warm-up's post naming the page.
  for (let i = 0; i < 20 && idles.length; i++) {
    idles.shift()!();
    for (let k = 0; k < 3; k++) await settle();
  }
  assert.equal(sent.length, 2);
  assert.ok((sent[1].urls as string[]).includes(ORIGIN + '/'));
  assert.equal(page.__swPosted, 1);
});

test('a link source decodes as the engine hands it over (sanity)', async () => {
  const hash = '#a=' + (await encodeDoc('{"x":1}'));
  assert.equal(await decodeDoc(((parseLink(hash) as { a: LinkSource }).a as { data: string }).data), '{"x":1}');
});
