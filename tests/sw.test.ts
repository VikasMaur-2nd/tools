import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/*
 * public/sw.js against a stand-in server, Cache Storage and set of open tabs:
 * what it keeps across visits, deploys and failures (the offline guarantees in
 * its header). The browsers check the same with real builds.
 */

const ORIGIN = 'https://tools.example';
type Files = Record<string, string | number>;

/** A build: '/' and a tool page naming their scripts, and chunks those load later. `tag` makes its hashed names. */
function build(tag: string): Files {
  const page = (title: string) =>
    `<!doctype html><title>${title}</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/_next/static/chunks/${tag}-app.css">` +
    `<script src="/_next/static/chunks/${tag}-main.js"></script><script>self.__next_f.push([1,"\\"/_next/static/chunks/${tag}-page.js\\""])</script>`;
  return {
    '/': page('Home ' + tag),
    '/tools/json-graph': page('Graph ' + tag),
    // A font subset only some text uses: named by the stylesheet, never by the HTML.
    [`/_next/static/chunks/${tag}-app.css`]: `@font-face{font-family:M;src:url(../media/${tag}-greek.woff2)format("woff2");unicode-range:U+370-3FF}body{}`,
    [`/_next/static/media/${tag}-greek.woff2`]: 'font',
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-graph.js");y("static/chunks/not-a-file.js")`,
    [`/_next/static/chunks/${tag}-page.js`]: 'page()',
    // A lazily loaded feature that loads one more chunk of its own, and a font.
    [`/_next/static/chunks/${tag}-graph.js`]: `s.l("static/chunks/${tag}-export.js");f("static/media/${tag}-font.woff2")`,
    [`/_next/static/chunks/${tag}-export.js`]: 'exp()',
    [`/_next/static/media/${tag}-font.woff2`]: 'font',
    '/icon.svg': '<svg/>',
  };
}

function worker(source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')) {
  let files: Files = {};
  let online = true;
  let failPut: (url: string) => boolean = () => false;
  const fetched: string[] = [];
  const store = new Map<string, { body: string; type: string }>();
  const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href.split('#')[0];
  const response = (body: string, type: string, status = 200) => {
    const res = new Response(status === 200 ? body : null, { status, headers: { 'content-type': type } });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const cache = {
    match: async (r: string | { url: string }) => {
      const hit = store.get(key(r));
      return hit ? response(hit.body, hit.type) : undefined;
    },
    put: async (r: string | { url: string }, res: Response) => {
      if (failPut(key(r))) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      store.set(key(r), { body: await res.text(), type: res.headers.get('content-type') ?? '' });
    },
    delete: async (r: string | { url: string }) => store.delete(key(r)),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  const fetchFn = async (r: string | { url: string }) => {
    const url = new URL(key(r));
    if (!online) throw new TypeError('Failed to fetch');
    fetched.push(url.pathname);
    const body = files[url.pathname];
    if (typeof body === 'number') return response('', 'text/plain', body);
    if (body === undefined) return response('', 'text/html', 404);
    const type = url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : /\.\w+$/.test(url.pathname) ? 'application/octet-stream' : 'text/html; charset=utf-8';
    return response(body, type);
  };
  let tabs: string[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting() {},
    clients: { matchAll: async () => tabs.map((id) => ({ id, postMessage() {} })), claim: async () => {} },
  };
  const caches = { open: async () => cache, keys: async () => ['json-viewer-v2'], delete: async () => true };
  runInNewContext(source, { self, caches, fetch: fetchFn, Response, URL, Set, Map, Promise, JSON, Date, DOMException });
  /** Dispatches an event and waits for everything it asked to wait for. */
  const dispatch = async (type: string, props: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | null = null;
    listeners[type]({ ...props, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<Response>) => void (answer = p) });
    const res = answer ? await (answer as Promise<Response>).catch(() => null) : null;
    for (let i = 0; i < waits.length; i++) await waits[i].catch(() => {});
    return res;
  };
  const visit = async (path: string, client = 'tab-' + Math.random().toString(36).slice(2)) => {
    const res = await dispatch('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'navigate', headers: new Headers(), destination: 'document', cache: 'default' }, resultingClientId: client });
    return res ? await res.text() : null;
  };
  return {
    serve: (f: Files) => void (files = f),
    offline: (off = true) => void (online = !off),
    failPut: (fn: (url: string) => boolean) => void (failPut = fn),
    tabs: (ids: string[]) => void (tabs = ids),
    install: () => dispatch('install'),
    visit,
    post: (urls: string[], from = 'tab') => dispatch('message', { data: { type: 'cache', urls: urls.map((u) => ORIGIN + u) }, source: { id: from } }),
    cached: (path: string) => store.get(ORIGIN + path)?.body,
    has: (path: string) => store.has(ORIGIN + path),
    statics: () => [...store.keys()].filter((u) => u.includes('/_next/static/')).map((u) => new URL(u).pathname).sort(),
    fetched,
  };
}

const filesOf = (tag: string) => Object.keys(build(tag)).filter((p) => p.startsWith('/_next/static/')).sort();

test('service worker: installing caches the shell with every chunk it can load later', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  assert.match(sw.cached('/')!, /Home a/);
  // The lazily loaded graph, the chunk it loads in turn, its font, and the stylesheet's font subsets: offline from the first visit.
  assert.deepEqual(sw.statics(), filesOf('a'));
  assert.ok(sw.has('/icon.svg'));
  // A name inside a script that is no file holds nothing back, and isn't kept.
  assert.ok(!sw.has('/_next/static/chunks/not-a-file.js'));
});

test('service worker: a shell whose files fail to arrive never replaces the one that works', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  // A deploy whose main script 404s (a half-done deploy), then one the cache can't store: the old shell stays, whole.
  sw.serve({ ...build('b'), '/_next/static/chunks/b-main.js': 404 });
  assert.match((await sw.visit('/'))!, /Home a/);
  assert.match(sw.cached('/')!, /Home a/);
  sw.serve(build('b'));
  sw.failPut((url) => url.endsWith('b-main.js'));
  await sw.visit('/');
  assert.match(sw.cached('/')!, /Home a/);
  for (const f of filesOf('a')) assert.ok(sw.has(f), f);
  // Fixed: the next visit swaps it in.
  sw.failPut(() => false);
  await sw.visit('/');
  assert.match(sw.cached('/')!, /Home b/);
});

test("service worker: a deploy keeps the old build's chunks while a tab of it is open", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  // A tab runs build a; then build b is deployed and the next visit to '/' (served the old shell) brings it in.
  sw.tabs(['old-tab']);
  sw.serve(build('b'));
  assert.match((await sw.visit('/', 'opening'))!, /Home a/);
  assert.match(sw.cached('/')!, /Home b/);
  // Both builds whole: the open tabs can still open the graph (and its export) offline.
  assert.deepEqual(sw.statics(), [...filesOf('a'), ...filesOf('b')].sort());
  // A visit while they are open changes nothing.
  sw.tabs(['old-tab', 'opening', 'new-tab']);
  await sw.visit('/', 'new-tab');
  assert.ok(sw.has('/_next/static/chunks/a-graph.js'));
  // Once they are closed, the old build's files go (the new tab, on build b, stays open).
  sw.tabs(['new-tab']);
  await sw.post(['/_next/static/chunks/b-main.js'], 'new-tab');
  assert.deepEqual(sw.statics(), filesOf('b'));
  assert.ok(!sw.has('/sw.js?retired'));
});

test('service worker: a cached page keeps the files of the build it was saved with, offline included', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.visit('/tools/json-graph');
  assert.match(sw.cached('/tools/json-graph')!, /Graph a/);
  sw.tabs([]);
  sw.serve(build('b'));
  await sw.visit('/');
  // No tab of build a is open, but the cached tool page still names it: its files stay, lazy ones included.
  assert.deepEqual(sw.statics(), [...filesOf('a'), ...filesOf('b')].sort());
  sw.offline();
  assert.match((await sw.visit('/tools/json-graph'))!, /Graph a/);
});

test('service worker: a page is replaced only once its files are cached', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.visit('/tools/json-graph');
  // Build b's page arrives, but its page script doesn't (the connection drops after the HTML).
  sw.serve({ ...build('b'), '/_next/static/chunks/b-page.js': 503 });
  assert.match((await sw.visit('/tools/json-graph'))!, /Graph b/, 'the page itself is shown');
  assert.match(sw.cached('/tools/json-graph')!, /Graph a/, 'the cached copy that works offline stays');
  sw.offline();
  assert.match((await sw.visit('/tools/json-graph'))!, /Graph a/);
  sw.offline(false);
  sw.serve(build('b'));
  await sw.visit('/tools/json-graph');
  assert.match(sw.cached('/tools/json-graph')!, /Graph b/);
  for (const f of filesOf('b')) assert.ok(sw.has(f), f);
});

test('service worker: the same build visited again reads nothing it already has', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.visit('/tools/json-graph');
  sw.fetched.length = 0;
  await sw.visit('/');
  await sw.visit('/tools/json-graph');
  assert.deepEqual(sw.fetched, ['/', '/tools/json-graph']);
});

test('service worker: files posted by a page are cached only when really there', async () => {
  const sw = worker();
  sw.serve({ ...build('a'), '/_next/static/chunks/gone.js': 404 });
  await sw.install();
  await sw.post(['/_next/static/chunks/gone.js', '/manifest.webmanifest']);
  assert.ok(!sw.has('/_next/static/chunks/gone.js'));
  assert.ok(!sw.has('/manifest.webmanifest'));
});
