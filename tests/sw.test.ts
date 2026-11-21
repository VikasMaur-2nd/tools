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
  const store = new Map<string, { body: string; type: string; headers?: [string, string][] }>();
  const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href.split('#')[0];
  const response = (body: string, type: string, status = 200, headers: [string, string][] = []) => {
    const res = new Response(status === 200 ? body : null, { status, headers: [['content-type', type], ...headers.filter(([k]) => k !== 'content-type')] });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const cache = {
    match: async (r: string | { url: string }) => {
      const hit = store.get(key(r));
      return hit ? response(hit.body, hit.type, 200, hit.headers) : undefined;
    },
    put: async (r: string | { url: string }, res: Response) => {
      if (failPut(key(r))) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      store.set(key(r), { body: await res.text(), type: res.headers.get('content-type') ?? '', headers: [...res.headers] });
    },
    delete: async (r: string | { url: string }) => store.delete(key(r)),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  /** Responses held until released (see hold). */
  const held = new Map<string, Promise<void>>();
  const fetchFn = async (r: string | { url: string }) => {
    const url = new URL(key(r));
    if (!online) throw new TypeError('Failed to fetch');
    fetched.push(url.pathname);
    await held.get(url.pathname);
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
  /** The worker's clock (see later). */
  let now = Date.now();
  const Clock = class extends Date {
    static now() {
      return now;
    }
  };
  runInNewContext(source, { self, caches, fetch: fetchFn, Response, Headers, URL, Set, Map, Promise, JSON, Date: Clock, DOMException });
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
    /** Time passes for the worker. */
    later: (ms: number) => void (now += ms),
    /** Holds `path`'s responses until the returned function is called. */
    hold: (path: string) => {
      let release = () => {};
      held.set(path, new Promise<void>((r) => (release = r)));
      return () => {
        held.delete(path);
        release();
      };
    },
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
  // (Seen open before: gone at once, no waiting.)
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

test('service worker: a cached page replaced by a later build\'s leaves the dictionaries nothing needs, once no tab of it is open (round 3, finding 8)', async () => {
  const hash = (n: number) => `/i18n/schema-strings.de.${String(n).repeat(12)}.json`;
  const sw = worker();
  sw.serve(localized('a', { de: [hash(1)] }));
  await sw.install();
  await sw.visit('/de', 'tab-a');
  await sw.post(['/de'], 'tab-a');
  assert.deepEqual(sw.dicts(), [hash(1)]);
  // Build b changes the translation: a tab of the German page is still open on build a.
  sw.tabs(['tab-a']);
  sw.serve(localized('b', { de: [hash(2)] }));
  await sw.visit('/de', 'tab-b');
  await sw.post(['/de'], 'tab-b');
  assert.deepEqual(sw.dicts(), [hash(1), hash(2)], 'the open tab of build a can still open the Schema view offline');
  // Served from the cache as a hashed file.
  const fetches = sw.fetched.length;
  assert.equal(await sw.get(hash(2)), `{"file":"${hash(2)}"}`);
  assert.equal(sw.fetched.length, fetches, 'cache-first: not fetched again');
  // That tab closed: the next tidy-up deletes it. Builds c and d, visiting /de only (never '/'): one each.
  sw.tabs(['tab-b']);
  sw.later(60_000);
  await sw.post(['/de'], 'tab-b');
  assert.deepEqual(sw.dicts(), [hash(2)]);
  for (const [tag, n] of [['c', 3], ['d', 4]] as const) {
    sw.serve(localized(tag, { de: [hash(n)] }));
    await sw.visit('/de', `tab-${tag}`);
    sw.tabs([`tab-${tag}`]);
    sw.later(60_000);
    await sw.post(['/de'], `tab-${tag}`);
    assert.deepEqual(sw.dicts(), [hash(n)], `build ${tag}`);
  }
  // Another cached page still naming an older one keeps it.
  sw.serve({ ...localized('e', { de: [hash(5)] }), '/de/tools/json-graph': localized('d', { de: [hash(4)] })['/de/tools/json-graph'] });
  await sw.visit('/de/tools/json-graph', 'tab-d');
  await sw.visit('/de', 'tab-e');
  await sw.post(['/de'], 'tab-e');
  assert.deepEqual(sw.dicts(), [hash(4), hash(5)]);
});

test('service worker: what replacements that failed brought in, and old builds\' files, go once nothing needs them, whichever tab stays open (round 4, finding 8)', async () => {
  const hash = (n: number) => `/i18n/schema-strings.de.${String(n).repeat(12)}.json`;
  const sw = worker();
  sw.serve(localized('a', { de: [hash(1)] }));
  await sw.install();
  await sw.visit('/de', 'tab-a');
  await sw.post(['/de'], 'tab-a');
  // Three deploys whose German page can't be stored (its page script is missing): their dictionaries came in anyway.
  for (const [tag, n] of [['b', 2], ['c', 3], ['d', 4]] as const) {
    sw.serve({ ...localized(tag, { de: [hash(n)] }), [`/_next/static/chunks/${tag}-main.js`]: 404 });
    await sw.visit('/de', `tab-${tag}`);
  }
  assert.match(sw.cached('/de')!, /de a/);
  // No tab open: what no page needs goes, the cached page's dictionary stays.
  sw.tabs([]);
  sw.later(60_000);
  await sw.post(['/de'], 'tab-a');
  assert.deepEqual(sw.dicts(), [hash(1)]);
  // An unrelated tab (on the current build) staying open holds nothing back: no timer, a file goes when unneeded.
  sw.serve(localized('e', { de: [hash(5)] }));
  await sw.visit('/de', 'tab-e');
  sw.tabs(['tab-e']);
  sw.later(19 * 24 * 3600 * 1000);
  await sw.post(['/de'], 'tab-e');
  assert.deepEqual(sw.dicts(), [hash(5)]);
});

test('service worker: a tab opening from the cached copy while another build replaces it keeps that copy\'s files (round 4, finding 1)', async () => {
  const a = '/i18n/schema-strings.de.aaaaaaaaaaaa.json';
  const b = '/i18n/schema-strings.de.bbbbbbbbbbbb.json';
  const sw = worker();
  sw.serve(localized('a', { de: [a] }));
  await sw.install();
  await sw.visit('/de', 'tab-a');
  await sw.post(['/de'], 'tab-a');
  // Build b's German page is being stored: held just before its dictionary arrives.
  sw.serve(localized('b', { de: [b] }));
  const release = sw.hold(b);
  const storing = sw.visit('/de', 'tab-b');
  await new Promise((r) => setTimeout(r, 10));
  // Meanwhile a second visit, offline, opens from the cached copy (build a).
  sw.offline();
  assert.match((await sw.visit('/de', 'tab-opening'))!, /de a/);
  sw.offline(false);
  // The replacement finishes before that tab shows among the clients; no other tab is open.
  sw.tabs([]);
  release();
  await storing;
  assert.match(sw.cached('/de')!, /de b/);
  await sw.post(['/de'], 'tab-b');
  // The opening tab, offline, opens the Schema view: build a's dictionary is still there.
  sw.offline();
  assert.equal(await sw.get(a), `{"file":"${a}"}`);
  // Once it is gone (closed), so is the dictionary.
  sw.offline(false);
  sw.later(60_000);
  await sw.post(['/de'], 'tab-b');
  assert.deepEqual(sw.dicts(), [b]);
});

test('service worker: a dictionary that doesn\'t arrive is asked for again, and a cached page keeps working until its replacement\'s have (round 3, finding 4)', async () => {
  const a = '/i18n/schema-strings.de.aaaaaaaaaaaa.json';
  const b = '/i18n/schema-strings.de.bbbbbbbbbbbb.json';
  const sw = worker();
  // A first visit whose dictionary is missing on the server: the warm-up isn't complete, and is done again.
  sw.serve({ ...localized('a', { de: [a] }), [a]: 404 });
  await sw.install();
  await sw.visit('/de', 'tab');
  await sw.post(['/de'], 'tab');
  assert.deepEqual(sw.dicts(), []);
  sw.serve(localized('a', { de: [a] }));
  await sw.post(['/de'], 'tab');
  assert.deepEqual(sw.dicts(), [a], 'the same worker asks for it again once the server has it');
  // A deploy whose new dictionary 404s: the German page cached before stays, with its dictionary, offline.
  sw.tabs([]);
  sw.serve({ ...localized('b', { de: [b] }), [b]: 404 });
  assert.match((await sw.visit('/de', 'tab'))!, /de b/, 'online, the new page itself is shown');
  await sw.post(['/de'], 'tab');
  assert.match(sw.cached('/de')!, /de a/);
  assert.deepEqual(sw.dicts(), [a]);
  sw.offline();
  assert.match((await sw.visit('/de', 'tab'))!, /de a/);
  assert.equal(await sw.get(a), `{"file":"${a}"}`);
  // The server has it again: the next online visit replaces the page, with its dictionary.
  sw.offline(false);
  sw.serve(localized('b', { de: [b] }));
  await sw.visit('/de', 'tab');
  assert.match(sw.cached('/de')!, /de b/);
  assert.ok(sw.dicts().includes(b));
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
