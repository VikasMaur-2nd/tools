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
    /** The page's own requests (not navigations): what the worker answers with. */
    get: async (path: string) => {
      const res = await dispatch('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'cors', headers: new Headers(), destination: '', cache: 'default' } });
      return res ? await res.text() : null;
    },
    dicts: () => [...store.keys()].filter((u) => u.includes('/i18n/')).map((u) => new URL(u).pathname).sort(),
    fetched,
  };
}

const filesOf = (tag: string) => Object.keys(build(tag)).filter((p) => p.startsWith('/_next/static/')).sort();

test('service worker: installing caches what the shell names, and every chunk it can load later once the page settles', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  assert.match(sw.cached('/')!, /Home a/);
  // A first visit's own loading has the network to itself: only what the HTML names comes now.
  assert.deepEqual(sw.statics(), ['/_next/static/chunks/a-app.css', '/_next/static/chunks/a-main.js', '/_next/static/chunks/a-page.js']);
  assert.ok(!sw.fetched.some((u) => u.includes('a-graph')));
  // The page reports in after its warm-up: the lazily loaded graph, the chunk it loads in turn, its font, and the
  // stylesheet's font subsets follow, so the visit works offline from then on.
  await sw.post(['/']);
  assert.deepEqual(sw.statics(), filesOf('a'));
  assert.ok(sw.has('/icon.svg'));
  // A name inside a script that is no file holds nothing back, and isn't kept.
  assert.ok(!sw.has('/_next/static/chunks/not-a-file.js'));
});

test('service worker: a shell whose files fail to arrive never replaces the one that works', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.post(['/']);
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
  await sw.post(['/'], 'old-tab');
  sw.tabs(['old-tab']);
  sw.serve(build('b'));
  assert.match((await sw.visit('/', 'opening'))!, /Home a/);
  assert.match(sw.cached('/')!, /Home b/);
  await sw.post(['/'], 'opening');
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
  await sw.post(['/tools/json-graph']);
  assert.match(sw.cached('/tools/json-graph')!, /Graph a/);
  sw.tabs([]);
  sw.serve(build('b'));
  await sw.visit('/');
  await sw.post(['/']);
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
  await sw.post(['/tools/json-graph']);
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

/**
 * A build whose localized pages name their language's later dictionaries in their RSC payload (lib/i18n/server.ts
 * stringFiles): `dicts` maps a locale to its files' URLs. `tag` makes the hashed chunk names.
 */
function localized(tag: string, dicts: Record<string, string[]>): Files {
  const page = (title: string, urls: string[] = []) =>
    `<!doctype html><title>${title}</title><script src="/_next/static/chunks/${tag}-main.js"></script>` +
    `<script>self.__next_f.push([1,"{\\"files\\":{${urls.map((u, i) => `\\"f${i}\\":\\"${u}\\"`).join(',')}}}"])</script>`;
  return {
    '/': page('Home ' + tag),
    ...Object.fromEntries(Object.entries(dicts).map(([l, urls]) => [`/${l}`, page(`${l} ${tag}`, urls)])),
    '/de/tools/json-graph': page('Graph ' + tag, dicts.de),
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-lazy.js")`,
    [`/_next/static/chunks/${tag}-lazy.js`]: 'lazy()',
    ...Object.fromEntries(Object.values(dicts).flat().map((u) => [u, `{"file":"${u}"}`])),
  };
}

test('service worker: a localized page caches the dictionaries it names (its own language\'s) with its chunks, not with its HTML', async () => {
  const de = ['/i18n/huge-strings.de.0a1b2c3d4e5f.json', '/i18n/schema-strings.de.1a1b2c3d4e5f.json', '/i18n/flatten-strings.de.2a1b2c3d4e5f.json'];
  const ja = ['/i18n/huge-strings.ja.3a1b2c3d4e5f.json', '/i18n/schema-strings.ja.4a1b2c3d4e5f.json', '/i18n/flatten-strings.ja.5a1b2c3d4e5f.json'];
  const sw = worker();
  sw.serve(localized('a', { de, ja }));
  await sw.install();
  await sw.post(['/']);
  // English: none, while the page's other chunks are followed.
  assert.ok(sw.has('/_next/static/chunks/a-lazy.js'));
  assert.deepEqual(sw.dicts(), []);
  // A German page: its HTML comes with what it names to run; the dictionaries wait for its warm-up, as its chunks do.
  await sw.visit('/de/tools/json-graph');
  assert.match(sw.cached('/de/tools/json-graph')!, /Graph a/);
  assert.ok(!sw.fetched.some((p) => p.startsWith('/i18n/')));
  await sw.post(['/de/tools/json-graph']);
  assert.deepEqual(sw.dicts(), [...de].sort());
  assert.ok(!sw.fetched.some((p) => p.includes('.ja.')));
  // Another language's page: its own as well.
  await sw.visit('/ja');
  await sw.post(['/ja']);
  assert.deepEqual(sw.dicts(), [...de, ...ja].sort());
  // Offline, a feature opening on the German page gets its strings from the cache.
  sw.offline();
  assert.equal(await sw.get(de[1]), `{"file":"${de[1]}"}`);
});

test('service worker: a dictionary of older texts goes after a deploy, once no cached page or open tab needs it', async () => {
  const before = '/i18n/schema-strings.de.aaaaaaaaaaaa.json';
  const after = '/i18n/schema-strings.de.bbbbbbbbbbbb.json';
  const sw = worker();
  sw.serve(localized('a', { de: [before] }));
  await sw.install();
  await sw.visit('/de');
  await sw.post(['/de']);
  assert.deepEqual(sw.dicts(), [before]);
  // The translation changes (build b). Online, the page gets the new one; served from the cache as a hashed file.
  sw.tabs([]);
  sw.serve(localized('b', { de: [after] }));
  await sw.visit('/', 'b-tab');
  await sw.post(['/'], 'b-tab');
  await sw.visit('/de', 'b-tab');
  await sw.post(['/de'], 'b-tab');
  assert.deepEqual(sw.dicts(), [after, before].sort());
  const fetches = sw.fetched.length;
  assert.equal(await sw.get(after), `{"file":"${after}"}`);
  assert.equal(sw.fetched.length, fetches, 'cache-first: not fetched again');
  // The next deploy retires what no cached page names; deleted once that deploy's opening tab is gone.
  sw.serve(localized('c', { de: [after] }));
  sw.tabs([]);
  await sw.visit('/', 'c-tab');
  await sw.post(['/'], 'other');
  assert.deepEqual(sw.dicts(), [after]);
});

test("service worker: an older build's chunk naming every language's dictionaries: the page's own only", async () => {
  // Builds before the pages named their own: every page loaded a chunk that named the dictionaries of all languages.
  const html = (title: string) => `<!doctype html><title>${title}</title><script src="/_next/static/chunks/h-main.js"></script>`;
  const dict = (l: string) => `/_next/static/media/huge-strings.${l}.0a1b2c.json`;
  const sw = worker();
  sw.serve({
    '/': html('Home'),
    '/de': html('Start'),
    '/de/tools/json-graph': html('Graph'),
    '/ja': html('ホーム'),
    '/_next/static/chunks/h-main.js':
      ['de', 'ja', 'es'].map((l) => `u(new URL("static/media/huge-strings.${l}.0a1b2c.json"));u(new URL("static/media/schema-strings.${l}.3d4e5f.json"))`).join(';') + ';x.l("static/chunks/h-lazy.js")',
    '/_next/static/chunks/h-lazy.js': 'lazy()',
    ...Object.fromEntries(['de', 'ja', 'es'].map((l) => [`/_next/static/media/schema-strings.${l}.3d4e5f.json`, '{"Valid":"…"}'])),
    [dict('de')]: '{"Large file":"Große Datei"}',
    [dict('ja')]: '{"Large file":"大容量ファイル"}',
    [dict('es')]: '{"Large file":"Archivo grande"}',
  });
  const dicts = () => sw.statics().filter((p) => p.includes('huge-strings'));
  await sw.install();
  await sw.post(['/']);
  // English: none, while the page's other chunks are followed.
  assert.ok(sw.has('/_next/static/chunks/h-lazy.js'));
  assert.deepEqual(dicts(), []);
  await sw.visit('/de/tools/json-graph');
  await sw.post(['/de/tools/json-graph']);
  assert.deepEqual(dicts(), [dict('de')]);
  assert.ok(!sw.fetched.some((p) => p.includes('huge-strings.ja') || p.includes('huge-strings.es')));
  // The Schema view's (a lazy feature's) the same way.
  assert.deepEqual(sw.statics().filter((p) => p.includes('schema-strings')), ['/_next/static/media/schema-strings.de.3d4e5f.json']);
  // Another language's page: its own as well.
  await sw.visit('/ja');
  await sw.post(['/ja']);
  assert.deepEqual(dicts(), [dict('de'), dict('ja')]);
  // Offline, the German page's dictionary is answered from the cache.
  sw.offline();
  assert.equal(sw.cached(dict('de')), '{"Large file":"Große Datei"}');
});
