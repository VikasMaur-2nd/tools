import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/*
 * public/sw.js against a stand-in server, Cache Storage, set of open tabs and clock
 * (shared by two workers for an upgrade): what it keeps across visits, deploys and
 * failures (the offline guarantees in its header), and when an old build's files go.
 * The browsers check the same with real builds (harness/suites/platform/offline.mjs).
 */

const ORIGIN = 'https://tools.example';
const RECORD = ORIGIN + '/sw.js?generations';
/** The record of the worker before generations (main's): one list. */
const LEGACY = ORIGIN + '/sw.js?retired';
type Files = Record<string, string | number>;

/**
 * A page of build `tag`: an icon, the stylesheet, the main script and (in its RSC payload, with the build id) the
 * page's script, then `extra`.
 */
const html = (tag: string, title: string, extra = '') =>
  `<!doctype html><title>${title}</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/_next/static/chunks/${tag}-app.css">` +
  `<script src="/_next/static/chunks/${tag}-main.js"></script>${extra}<script>self.__next_f.push([1,"{\\"b\\":\\"${tag}\\",\\"c\\":\\"/_next/static/chunks/${tag}-page.js\\"}"])</script>`;

/** A build: '/' and a tool page naming their scripts, and chunks those load later. `tag` makes its hashed names. */
function build(tag: string): Files {
  return {
    '/': html(tag, 'Home ' + tag),
    '/tools/json-graph': html(tag, 'Graph ' + tag),
    // A font subset only some text uses: named by the stylesheet, never by the HTML.
    [`/_next/static/chunks/${tag}-app.css`]: `@font-face{font-family:M;src:url(../media/${tag}-greek.woff2)format("woff2");unicode-range:U+370-3FF}body{}`,
    [`/_next/static/media/${tag}-greek.woff2`]: 'font',
    // (And a name that is no file: in a real build, the chunks directory.)
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-graph.js");y("/_next/static/chunks/")`,
    [`/_next/static/chunks/${tag}-page.js`]: 'page()',
    // A lazily loaded feature that loads one more chunk of its own, and a font.
    [`/_next/static/chunks/${tag}-graph.js`]: `s.l("static/chunks/${tag}-export.js");f("static/media/${tag}-font.woff2")`,
    [`/_next/static/chunks/${tag}-export.js`]: 'exp()',
    [`/_next/static/media/${tag}-font.woff2`]: 'font',
    '/icon.svg': '<svg/>',
  };
}

/**
 * A build with what tells pages apart: the tool page (English and German) has a script of its own, the
 * German home is a page too, and the diff tool's page has a script and a stylesheet no other page names
 * (a tab that reaches it by client-side navigation loads them through the worker, with no page cached).
 */
function site(tag: string): Files {
  const tool = `<script src="/_next/static/chunks/${tag}-tool.js"></script>`;
  return {
    ...build(tag),
    '/tools/json-graph': html(tag, 'Graph ' + tag, tool),
    '/de': html(tag, 'Start ' + tag),
    '/de/tools/json-graph': html(tag, 'Grafik ' + tag, tool),
    '/tools/json-diff': html(tag, 'Diff ' + tag, `<link rel="stylesheet" href="/_next/static/chunks/${tag}-diff.css"><script src="/_next/static/chunks/${tag}-diff.js"></script>`),
    [`/_next/static/chunks/${tag}-tool.js`]: 'tool()',
    [`/_next/static/chunks/${tag}-diff.js`]: 'diff()',
    [`/_next/static/chunks/${tag}-diff.css`]: '.diff{}',
  };
}

/** What workers on one origin share: the server, Cache Storage, the open tabs, the network and the clock. */
function world() {
  return {
    files: {} as Files,
    online: true,
    failPut: ((): boolean => false) as (url: string) => boolean,
    fetched: [] as string[],
    store: new Map<string, { body: string; type: string; url?: string }>(),
    /** Keys keep the fragment of the request stored (as WebKit's Cache Storage lists them); matching ignores it. */
    fragments: false,
    /** Cache reads that fail (storage errors). */
    failMatch: ((): boolean => false) as (url: string) => boolean,
    /** clients.matchAll() never answers (Firefox waits for every tab's process; a closing one may never reply). */
    stallClients: false,
    /** The clock's timers (setTimeout in the worker): run by advance(). */
    timers: [] as { at: number; fn: () => void; id: number }[],
    tabs: [] as string[],
    /** Fetches of a path wait for these, one each (see hold). */
    holds: new Map<string, Promise<void>[]>(),
    /** Runs when the cache's keys are read (a moment inside a clean-up's scan). */
    onKeys: null as null | (() => void),
    /** Paths whose answer's headers come but whose body never ends. */
    stallBody: new Set<string>(),
    /** Paths whose answers' bodies (their text sent at once) end only once this settles, for fetches started meanwhile. */
    holdBody: new Map<string, Promise<void>>(),
    /** The registration's workers: which one is installing and which one is active (see install), by number. */
    installing: 0,
    active: 0,
    now: 1_700_000_000_000,
  };
}

/** Lets every pending promise chain run as far as it can. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

let workers = 0;
function worker(source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), env = world()) {
  const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href.split('#')[0];
  const response = (body: string, type: string, status = 200) => {
    const res = new Response(status === 200 ? body : null, { status, headers: { 'content-type': type } });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const cache = {
    match: async (r: string | { url: string }) => {
      if (env.failMatch(key(r))) throw new DOMException('Unable to read', 'UnknownError');
      const hit = env.store.get(key(r));
      return hit ? response(hit.body, hit.type) : undefined;
    },
    put: async (r: string | { url: string }, res: Response) => {
      if (env.failPut(key(r))) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      const url = new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
      env.store.set(key(r), { body: await res.text(), type: res.headers.get('content-type') ?? '', url });
    },
    delete: async (r: string | { url: string }) => env.store.delete(key(r)),
    keys: async () => {
      env.onKeys?.();
      return [...env.store.entries()].map(([url, e]) => ({ url: env.fragments && e.url ? e.url : url }));
    },
  };
  const fetchFn = async (r: string | { url: string }, init?: { signal?: AbortSignal }) => {
    const url = new URL(key(r));
    const signal = init?.signal;
    const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
    const held = env.holds.get(url.pathname)?.shift();
    if (held) await (signal ? Promise.race([held, new Promise((_, no) => signal.addEventListener('abort', () => no(aborted())))]) : held);
    if (signal?.aborted) throw aborted();
    if (!env.online) throw new TypeError('Failed to fetch');
    env.fetched.push(url.pathname);
    const body = env.files[url.pathname];
    const until = env.stallBody.has(url.pathname) ? new Promise<void>(() => {}) : env.holdBody.get(url.pathname);
    if (until) {
      // (Aborting the request errors its body, as in browsers.)
      const stream = new ReadableStream({
        start: (c) => {
          c.enqueue(new TextEncoder().encode(String(body ?? '')));
          void until.then(() => { try { c.close(); } catch {} });
          signal?.addEventListener('abort', () => { try { c.error(aborted()); } catch {} });
        },
      });
      const res = new Response(stream, { headers: { 'content-type': 'application/octet-stream' } });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    }
    if (typeof body === 'number') return response('', 'text/plain', body);
    if (body === undefined) return response('', 'text/html', 404);
    const type = url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : /\.\w+$/.test(url.pathname) ? 'application/octet-stream' : 'text/html; charset=utf-8';
    return response(body, type);
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const me = ++workers;
  const self = {
    location: { origin: ORIGIN },
    // (Only whether a worker is installing: the one installing is this one during its install event.)
    registration: { get installing() { return env.installing ? {} : null; }, waiting: null, get active() { return env.active ? {} : null; } },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting() {},
    clients: {
      matchAll: () => (env.stallClients ? new Promise(() => {}) : Promise.resolve(env.tabs.map((id) => ({ id, postMessage() {} })))),
      claim: async () => {},
    },
  };
  const caches = { open: async () => cache, keys: async () => ['json-viewer-v2'], delete: async () => true };
  const Clock = class extends Date {};
  Object.defineProperty(Clock, 'now', { value: () => env.now });
  let timerIds = 0;
  const setTimeoutFn = (fn: () => void, ms = 0) => {
    const id = ++timerIds;
    env.timers.push({ at: env.now + ms, fn, id });
    return id;
  };
  const clearTimeoutFn = (id: number) => void (env.timers = env.timers.filter((t) => t.id !== id));
  runInNewContext(source, { self, caches, fetch: fetchFn, Response, URL, Set, Map, Promise, JSON, Date: Clock, DOMException, AbortController, setTimeout: setTimeoutFn, clearTimeout: clearTimeoutFn });
  /** Dispatches an event: its answer (`res`), and `done` once everything it asked to wait for has. */
  const start = (type: string, props: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | null = null;
    listeners[type]({ ...props, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<Response>) => void (answer = p) });
    const res = answer ? (answer as Promise<Response>).catch(() => null) : Promise.resolve(null);
    const done = (async () => {
      await res;
      for (let i = 0; i < waits.length; i++) await waits[i].catch(() => {});
    })();
    return { res, done };
  };
  const dispatch = async (type: string, props: Record<string, unknown> = {}) => {
    const { res, done } = start(type, props);
    await done;
    return res;
  };
  /** A navigation to `path` by the tab `client` will be: its page's text, and `done` once the worker is. */
  const open = (path: string, client = 'tab-' + Math.random().toString(36).slice(2)) => {
    const { res, done } = start('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'navigate', headers: new Headers(), destination: 'document', cache: 'default' }, resultingClientId: client });
    return { text: res.then((r) => (r ? r.text() : null)), done };
  };
  const visit = async (path: string, client?: string) => {
    const nav = open(path, client);
    const text = await nav.text;
    await nav.done;
    return text;
  };
  const message = (urls: string[], from: string) => start('message', { data: { type: 'cache', urls: urls.map((u) => ORIGIN + u) }, source: { id: from } });
  return {
    serve: (f: Files) => void (env.files = f),
    offline: (off = true) => void (env.online = !off),
    failPut: (fn: (url: string) => boolean) => void (env.failPut = fn),
    failMatch: (fn: (url: string) => boolean) => void (env.failMatch = fn),
    tabs: (ids: string[]) => void (env.tabs = ids),
    /** Moves the clock on, running the worker's timers due by then. */
    advance: (ms: number) => {
      env.now += ms;
      const due = env.timers.filter((t) => t.at <= env.now).sort((a, b) => a.at - b.at);
      env.timers = env.timers.filter((t) => t.at > env.now);
      due.forEach((t) => t.fn());
    },
    /** The next fetch of `path` waits until the function returned is called. */
    hold: (path: string) => {
      let release = () => {};
      const p = new Promise<void>((r) => (release = r));
      env.holds.set(path, [...(env.holds.get(path) ?? []), p]);
      return release;
    },
    /** Installs this worker (the registration's installing one meanwhile), which then takes over (skipWaiting). */
    install: async () => {
      env.installing = me;
      try {
        await dispatch('install');
      } finally {
        if (env.installing === me) env.installing = 0;
        env.active = me;
      }
    },
    activate: () => dispatch('activate'),
    open,
    visit,
    /** A file a tab (`client`) loads (a chunk, by client-side navigation say; a worker's script): its text, or null when it can't. */
    load: async (path: string, client: string, destination = 'script') => {
      const res = await dispatch('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: destination === 'worker' ? 'same-origin' : 'no-cors', headers: new Headers(), destination, cache: 'default' }, clientId: client });
      return res && res.ok ? await res.text() : null;
    },
    /** A tab's report of what it loaded (its 'cache' message), waited for. */
    post: async (urls: string[], from = 'tab') => void (await message(urls, from).done),
    /** The same, not waited for: `done` resolves once the worker is. */
    postSoon: (urls: string[], from = 'tab') => message(urls, from).done,
    cached: (path: string) => env.store.get(ORIGIN + path)?.body,
    has: (path: string) => env.store.has(ORIGIN + path),
    statics: () => [...env.store.keys()].filter((u) => u.includes('/_next/static/')).map((u) => new URL(u).pathname).sort(),
    record: () => (env.store.has(RECORD) ? JSON.parse(env.store.get(RECORD)!.body) : null),
    fetched: env.fetched,
    env,
    /** A fetch() the page makes (not a navigation), with its cache mode: the SW's answer, null if it leaves it alone. */
    get: (path: string, cache = 'default') => dispatch('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'cors', headers: new Headers(), destination: '', cache } }),
    /** The same, not waited for: the answer (`res`), and `done` once the worker is. */
    getSoon: (path: string) => start('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'cors', headers: new Headers(), destination: '', cache: 'default' } }),
  };
}

const filesOf = (tag: string, files = build(tag)) => Object.keys(files).filter((p) => p.startsWith('/_next/static/')).sort();

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
  assert.ok(!sw.has('/_next/static/chunks/'));
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

test("service worker: a page caches huge mode's dictionary of its own language only", async () => {
  // Every page loads a chunk that names the dictionaries of all languages (they load when a huge file opens).
  const html = (title: string) => `<!doctype html><title>${title}</title><script src="/_next/static/chunks/h-main.js"></script>`;
  const dict = (l: string) => `/_next/static/media/huge-strings.${l}.0a1b2c.json`;
  const sw = worker();
  sw.serve({
    '/': html('Home'),
    '/de': html('Start'),
    '/de/tools/json-graph': html('Graph'),
    '/ja': html('ホーム'),
    '/_next/static/chunks/h-main.js': ['de', 'ja', 'es'].map((l) => `u(new URL("static/media/huge-strings.${l}.0a1b2c.json"))`).join(';') + ';x.l("static/chunks/h-lazy.js")',
    '/_next/static/chunks/h-lazy.js': 'lazy()',
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
  // Another language's page: its own as well.
  await sw.visit('/ja');
  await sw.post(['/ja']);
  assert.deepEqual(dicts(), [dict('de'), dict('ja')]);
  // Offline, the German page's dictionary is answered from the cache.
  sw.offline();
  assert.equal(sw.cached(dict('de')), '{"Large file":"Große Datei"}');
});

// ── Deploys: when an old build's files go (see "Deploys" in public/sw.js) ─────────────────────────

/** Whether `tab` can load every one of `paths` now (through the worker: from the cache when offline). */
async function loadsAll(sw: ReturnType<typeof worker>, tab: string, paths: string[]) {
  const missing: string[] = [];
  for (const p of paths) if ((await sw.load(p, tab)) === null) missing.push(p);
  return missing;
}

test('service worker: a visitor who only opens tool pages gets old builds cleaned up too', async () => {
  const sw = worker();
  sw.serve(site('a'));
  // A first visit to a German tool page: '/' comes with the worker, and the page's warm-up reports the
  // page, its home and what it loaded (all of build a, lazy features included).
  await sw.install();
  sw.tabs(['a-tab']);
  await sw.post(['/', '/de', '/de/tools/json-graph'], 'a-tab');
  const a = filesOf('a', site('a')).filter((p) => !p.includes('-diff'));
  assert.deepEqual(sw.statics(), a);
  for (const tag of ['b', 'c']) {
    sw.serve(site(tag));
    // The tool page again, a deploy later, in a new tab (the last one was closed): the network's copy.
    // (The tab shows among the clients before its page is stored, as in browsers.)
    sw.tabs([tag + '-tab']);
    assert.match((await sw.visit('/de/tools/json-graph', tag + '-tab'))!, new RegExp('Grafik ' + tag));
    await sw.post(['/', '/de', '/de/tools/json-graph'], tag + '-tab');
    // '/' and the German home, never opened again, are brought to the new build with it. The old build's
    // files stay while that tab is open (it was open at the deploy); a later tab's report, once it's closed,
    // finds nothing of the old build left.
    assert.match(sw.cached('/')!, new RegExp('Home ' + tag));
    assert.match(sw.cached('/de')!, new RegExp('Start ' + tag));
    sw.tabs([tag + '-later']);
    await sw.post(['/', '/de', '/de/tools/json-graph'], tag + '-later');
    assert.deepEqual(sw.statics(), filesOf(tag, site(tag)).filter((p) => !p.includes('-diff')), `after deploy ${tag}`);
    assert.equal(sw.record(), null);
  }
  // Offline, every cached page opens with all its files.
  sw.offline();
  assert.match((await sw.visit('/de/tools/json-graph', 'off'))!, /Grafik c/);
  assert.match((await sw.visit('/', 'off2'))!, /Home c/);
  assert.deepEqual(await loadsAll(sw, 'off', filesOf('c', site('c')).filter((p) => !p.includes('-diff'))), []);
});

test("service worker: an old tab keeps its build's files until it closes, after a deploy first seen on a tool page", async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  await sw.visit('/tools/json-graph', 'a-tab');
  sw.tabs(['a-tab']);
  await sw.post(['/', '/tools/json-graph'], 'a-tab');
  const a = filesOf('a', site('a')).filter((p) => !p.includes('-diff'));
  // Build b: another tab opens the tool page.
  sw.serve(site('b'));
  sw.tabs(['a-tab', 'b-tab']);
  await sw.visit('/tools/json-graph', 'b-tab');
  await sw.post(['/', '/tools/json-graph'], 'b-tab');
  assert.match(sw.cached('/')!, /Home b/);
  // Offline, the old tab still gets every file of its build, features it never opened included.
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'a-tab', a), []);
  sw.offline(false);
  // Closed, and the tab open at the deploy too: its build goes, at a later tab's report.
  sw.tabs(['b-tab']);
  await sw.post(['/tools/json-graph'], 'b-tab');
  assert.ok(sw.has('/_next/static/chunks/a-tool.js'), 'kept while a tab open at the deploy is');
  sw.tabs(['c-tab']);
  await sw.post(['/tools/json-graph'], 'c-tab');
  assert.deepEqual(sw.statics(), filesOf('b', site('b')).filter((p) => !p.includes('-diff')));
});

test('service worker: a tab opened from the old shell while a deploy replaces it keeps its build', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(build('b'));
  // Two tabs open '/' at once. Both get the cached shell of build a; one's visit brings build b in first,
  // the other's refresh then finds b there already.
  const first = sw.hold('/');
  const second = sw.hold('/');
  const y = sw.open('/', 'Y');
  const x = sw.open('/', 'X');
  assert.match((await y.text)!, /Home a/);
  assert.match((await x.text)!, /Home a/);
  first();
  await y.done;
  assert.match(sw.cached('/')!, /Home b/);
  second();
  await x.done;
  // X shows among the tabs only now; Y and the old tab report in, then close.
  sw.tabs(['old', 'Y', 'X']);
  await sw.post(['/'], 'Y');
  sw.tabs(['X']);
  await sw.post(['/', ...filesOf('a').slice(0, 3)], 'X');
  // X runs build a: offline, it can still open every feature.
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'X', filesOf('a')), []);
  sw.offline(false);
  sw.tabs([]);
  await sw.visit('/', 'Z');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), 'gone once X is closed');
});

test('service worker: a tab opened without an id during a deploy keeps its build (browsers before resultingClientId)', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(build('b'));
  assert.match((await sw.visit('/', ''))!, /Home a/);
  sw.tabs(['old', 'anon']);
  sw.tabs(['anon']);
  await sw.post(['/', '/_next/static/chunks/a-main.js'], 'anon');
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'anon', filesOf('a')), []);
  sw.offline(false);
  // A minute on, the tabs open then stand for it: still kept while it is open.
  sw.advance(61_000);
  await sw.post(['/'], 'anon');
  assert.deepEqual(await loadsAll(sw, 'anon', filesOf('a')), []);
  sw.tabs([]);
  await sw.visit('/', 'later');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')));
});

test('service worker: chunks a tab loaded by client-side navigation stay while it is open', async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  // The old tab opens the diff tool by client-side navigation (no page for it is cached).
  assert.equal(await sw.load('/_next/static/chunks/a-diff.js', 'old'), 'diff()');
  // Two deploys while it stays open; between them it opens the diff tool's stylesheet (the server still has
  // build a's files, as hashed files are kept).
  sw.serve({ ...site('a'), ...site('b') });
  await sw.visit('/', 'v1');
  sw.tabs(['old', 'v1']);
  await sw.visit('/', 'new');
  sw.tabs(['old', 'v1', 'new']);
  await sw.post(['/'], 'new');
  assert.equal(await sw.load('/_next/static/chunks/a-diff.css', 'old'), '.diff{}');
  sw.serve({ ...site('a'), ...site('c') });
  await sw.visit('/', 'v2');
  sw.tabs(['old', 'v1', 'new', 'v2']);
  await sw.post(['/'], 'v2');
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'old', [...filesOf('a'), '/_next/static/chunks/a-diff.js', '/_next/static/chunks/a-diff.css']), []);
  sw.offline(false);
  // All closed: only build c is left.
  sw.tabs(['last']);
  await sw.post(['/'], 'last');
  assert.deepEqual(sw.statics(), filesOf('c'));
});

test('service worker: a file a cached page needs again is kept for the tabs of that page', async () => {
  // shared.js (a module unchanged, so the same name) is in build 1's tool page, not in build 2's, again in build 3's.
  const files = (n: number, shared: boolean): Files => ({
    '/': `<script src="/_next/static/chunks/m${n}.js"></script>`,
    '/tools/json-graph': `<script src="/_next/static/chunks/m${n}.js"></script>${shared ? '<script src="/_next/static/chunks/shared.js"></script>' : ''}`,
    [`/_next/static/chunks/m${n}.js`]: 'main()',
    '/_next/static/chunks/shared.js': 'shared()',
  });
  const sw = worker();
  sw.serve(files(1, true));
  await sw.install();
  sw.tabs(['k']);
  await sw.visit('/tools/json-graph', 'k'); // a tab of build 1 that stays open meanwhile
  sw.serve(files(2, false));
  await sw.visit('/tools/json-graph', 't2');
  sw.tabs(['k', 't2']);
  sw.serve(files(3, true));
  await sw.visit('/tools/json-graph', 't3'); // t3 runs build 3, which needs shared.js
  sw.tabs(['k', 't2', 't3']);
  sw.serve(files(4, false));
  await sw.visit('/tools/json-graph', 't4');
  // k and t2 close: what was retired while only they were open goes, but t3 still needs shared.js.
  sw.tabs(['t3', 't4']);
  await sw.post(['/tools/json-graph'], 't4');
  assert.ok(!sw.has('/_next/static/chunks/m1.js'));
  assert.equal(await sw.load('/_next/static/chunks/shared.js', 't3'), 'shared()');
  sw.tabs(['t4']);
  await sw.post(['/tools/json-graph'], 't4');
  assert.deepEqual(sw.statics(), ['/_next/static/chunks/m4.js']);
});

test('service worker: a download that stalls or fails never holds back the clean-up', async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve({ ...site('b'), '/_next/static/chunks/gone.js': 404, '/_next/static/chunks/slow.js': 'slow()' });
  await sw.visit('/', 'v');
  sw.tabs(['old', 'v']);
  await sw.post(['/'], 'v');
  sw.tabs(['n']); // the old tabs closed; n runs build b
  // n's report names a file that never arrives (for now) and one the server lost.
  const release = sw.hold('/_next/static/chunks/slow.js');
  const busy = sw.postSoon(['/', '/_next/static/chunks/slow.js', '/_next/static/chunks/gone.js'], 'n');
  await settle();
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), "the old build's files went at once");
  // A page whose script stalls doesn't hold anything up either: a later page goes in, and a later deploy is cleaned up.
  const releaseTool = sw.hold('/_next/static/chunks/b-tool.js');
  const tool = sw.open('/tools/json-graph', 'n2');
  await settle();
  sw.serve({ ...site('c'), '/_next/static/chunks/b-tool.js': 'tool()', '/_next/static/chunks/slow.js': 'slow()' });
  await sw.visit('/', 'v3');
  sw.tabs(['n', 'v3']);
  await sw.post(['/'], 'v3');
  sw.tabs(['n3']);
  await sw.visit('/de', 'n3');
  assert.match(sw.cached('/de')!, /Start c/);
  await sw.post(['/'], 'n3');
  assert.ok(!sw.statics().some((p) => p.includes('/b-')), "build b's files went");
  release();
  releaseTool();
  await Promise.all([busy, tool.done]);
  assert.equal(sw.cached('/_next/static/chunks/slow.js'), 'slow()');
});

test('service worker: repeated deploys: each build goes once its own tabs close', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['tA']);
  await sw.post(['/'], 'tA');
  sw.serve(build('b'));
  await sw.visit('/', 'v1'); // gets build a's shell, brings build b in
  sw.tabs(['tA', 'v1']);
  await sw.visit('/', 'tB'); // a tab of build b
  sw.tabs(['tA', 'v1', 'tB']);
  await sw.post(['/'], 'tB');
  sw.serve(build('c'));
  await sw.visit('/', 'v2'); // gets build b's shell, brings build c in
  sw.tabs(['tA', 'v1', 'tB', 'v2']);
  await sw.post(['/'], 'v2');
  // Build a's tabs close: build a goes, while build b's tabs keep build b.
  sw.tabs(['tB', 'v2']);
  await sw.post(['/'], 'v2');
  assert.deepEqual(sw.statics(), [...filesOf('b'), ...filesOf('c')].sort());
  sw.serve(build('d'));
  await sw.visit('/', 'v3');
  sw.tabs(['tB', 'v2', 'v3']);
  await sw.post(['/'], 'v3');
  assert.deepEqual(sw.statics(), [...filesOf('b'), ...filesOf('c'), ...filesOf('d')].sort());
  // All closed: build d alone, and no record.
  sw.tabs([]);
  await sw.visit('/', 'last');
  assert.deepEqual(sw.statics(), filesOf('d'));
  assert.equal(sw.record(), null);
});

test('service worker: a week after its deploy, a generation goes even with its tab open; later deploys never postpone that', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(build('b'));
  await sw.visit('/', 'old2');
  sw.tabs(['old', 'old2']);
  sw.advance(4 * 24 * 3600 * 1000);
  sw.serve(build('c'));
  await sw.visit('/', 'old3');
  sw.tabs(['old', 'old2', 'old3']);
  await sw.post(['/'], 'old3');
  sw.advance(4 * 24 * 3600 * 1000);
  await sw.post(['/'], 'old');
  // Build a's generation is 8 days old: gone. Build b's is 4 days old: kept for its open tabs.
  assert.ok(!sw.statics().some((p) => p.includes('/a-')));
  assert.ok(sw.has('/_next/static/chunks/b-main.js'));
});

test('service worker: offline, closed tabs still get their files cleaned up, and every cached page stays whole', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(build('b'));
  await sw.visit('/', 'v');
  sw.tabs(['old', 'v', 'n']);
  await sw.post(['/'], 'n');
  sw.offline();
  sw.tabs(['n']);
  assert.match((await sw.visit('/', 'n2'))!, /Home b/);
  sw.tabs(['n', 'n2']);
  await sw.post(['/'], 'n2');
  assert.deepEqual(sw.statics(), filesOf('b'));
  assert.deepEqual(await loadsAll(sw, 'n2', filesOf('b')), []);
  // Back online for a moment: a deploy's download is cut off half-way. The shell there stays, whole.
  sw.offline(false);
  sw.serve(build('c'));
  const release = sw.hold('/_next/static/chunks/c-page.js');
  const v = sw.open('/', 'v2');
  await settle();
  sw.offline();
  release();
  await v.done;
  await sw.post(['/'], 'n2');
  assert.match(sw.cached('/')!, /Home b/);
  assert.deepEqual(await loadsAll(sw, 'n2', filesOf('b')), []);
});

test('service worker: upgrading from the frozen production worker keeps its tabs whole, then cleans up', async () => {
  const env = world();
  const legacy = worker(readFileSync(join(process.cwd(), 'harness/suites/platform/fixtures/legacy-sw.js'), 'utf8'), env);
  legacy.serve(build('a'));
  await legacy.install();
  legacy.tabs(['old']);
  // Its page reports everything it loaded (its warm-up loads every feature).
  await legacy.post(['/', ...filesOf('a')], 'old');
  const had = legacy.statics();
  assert.deepEqual(had, filesOf('a'));
  // A deploy brings this worker.
  legacy.serve(build('b'));
  const sw = worker(undefined, env);
  await sw.install();
  await sw.activate();
  // Installing beside it cached build b's files; '/' moves at the next visit to it.
  assert.match(sw.cached('/')!, /Home a/);
  assert.ok(['main', 'page', 'app'].every((f) => sw.has(`/_next/static/chunks/b-${f}.${f === 'app' ? 'css' : 'js'}`)));
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'old', had), []);
  sw.offline(false);
  // (That visit got build a's shell, and runs build a: its files stay while it is open too.)
  await sw.visit('/', 'n');
  assert.match(sw.cached('/')!, /Home b/);
  sw.tabs(['old', 'n']);
  await sw.post(['/'], 'n');
  sw.tabs(['n']);
  await sw.post(['/'], 'n');
  assert.ok(sw.has('/_next/static/chunks/a-main.js'));
  sw.tabs(['m']);
  await sw.post(['/'], 'm');
  assert.deepEqual(sw.statics(), filesOf('b'));
});

test("service worker: the previous worker's record is honoured, then dropped: it never reads this one's (review 2, finding 5)", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  // The previous worker retired a file at its last deploy, for a tab still open.
  const old = ORIGIN + '/_next/static/chunks/z-old.js';
  sw.env.store.set(old, { body: 'old()', type: 'text/javascript' });
  sw.env.store.set(LEGACY, { body: JSON.stringify({ urls: [old], clients: ['older'], at: sw.env.now }), type: 'application/json' });
  sw.tabs(['older']);
  await sw.post(['/'], 'older');
  assert.ok(sw.has('/_next/static/chunks/z-old.js'));
  // Taken in as a generation of this worker's own record, and dropped.
  assert.ok(!sw.has('/sw.js?retired'));
  assert.deepEqual(sw.record(), [{ urls: [old], clients: ['older'], at: sw.env.now }]);
  sw.serve(build('b'));
  await sw.visit('/', 'v');
  assert.ok(!sw.has('/sw.js?retired'), 'never written again');
  assert.ok(sw.record().some((g: { urls: string[] }) => g.urls.includes(ORIGIN + '/_next/static/chunks/a-main.js')));
  sw.tabs(['older', 'v']);
  await sw.post(['/'], 'v');
  sw.tabs(['n']);
  await sw.post(['/'], 'n');
  assert.ok(!sw.has('/_next/static/chunks/z-old.js'));
  assert.equal(sw.record(), null);
});

test('service worker: a page is never stored without a file that a clean-up deleted while it was being stored', async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.serve(site('b'));
  // A tab of build b reaches the diff tool by client-side navigation: its script is cached, no page names it.
  await sw.visit('/tools/json-graph', 'b1');
  sw.tabs(['b1']);
  assert.equal(await sw.load('/_next/static/chunks/b-diff.js', 'b1'), 'diff()');
  // The deploy is seen on '/': that script is retired with the tabs open then.
  await sw.visit('/', 'v');
  sw.tabs(['b2']);
  // b2 opens the diff tool's page; its stylesheet is slow. Meanwhile b2's report cleans up the closed tabs' files.
  const release = sw.hold('/_next/static/chunks/b-diff.css');
  const nav = sw.open('/tools/json-diff', 'b2');
  await settle();
  await sw.post(['/'], 'b3');
  release();
  await nav.done;
  const page = sw.cached('/tools/json-diff');
  if (page) assert.ok(sw.has('/_next/static/chunks/b-diff.js'), 'a cached page has every file it names');
  // Offline, the page opens whole (or falls back to the shell).
  sw.offline();
  assert.match((await sw.visit('/tools/json-diff', 'b4'))!, /Diff b|Home b/);
  // The next visit online stores it whole.
  sw.offline(false);
  await sw.visit('/tools/json-diff', 'b5');
  assert.match(sw.cached('/tools/json-diff')!, /Diff b/);
  assert.ok(sw.has('/_next/static/chunks/b-diff.js'));
});

test("service worker: a worker's script cached under its #params URL (WebKit lists keys so) is never taken for an unneeded file", async () => {
  // Turbopack starts a worker at its bootstrap's URL plus #params=… (its chunks); the page's report names it without.
  const files = (tag: string): Files => ({
    ...build(tag),
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-graph.js");w("static/chunks/worker.js")`,
    '/_next/static/chunks/worker.js': 'boot()',
  });
  const WORKER = '/_next/static/chunks/worker.js#params=%5B%5B%22static%2Fchunks%2Fw.js%22%5D%5D';
  const env = world();
  env.fragments = true;
  const sw = worker(undefined, env);
  sw.serve(files('a'));
  await sw.install();
  sw.tabs(['old']);
  // The tab's worker starts once the service worker controls it: its script is stored under the URL it asked for.
  assert.equal(await sw.load(WORKER, 'old', 'worker'), 'boot()');
  await sw.post(['/', '/_next/static/chunks/worker.js'], 'old');
  // A deploy (the same bootstrap), seen on '/'; the old tabs close; a tab of the new build reports in.
  sw.serve(files('b'));
  await sw.visit('/', 'v');
  sw.tabs(['old', 'v']);
  await sw.post(['/'], 'v');
  sw.tabs(['n']);
  await sw.post(['/', '/_next/static/chunks/worker.js'], 'n');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), "build a's files went");
  // Offline, the new build's worker still starts from the cache.
  sw.offline();
  assert.equal(await sw.load(WORKER, 'n', 'worker'), 'boot()');
});

test("service worker: when the cache can't be read, the network answers (never a failed load the network could serve)", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.post(['/']);
  sw.failMatch(() => true);
  assert.equal(await sw.load('/_next/static/chunks/a-main.js', 'tab'), build('a')['/_next/static/chunks/a-main.js']);
  assert.equal(await sw.load('/icon.svg', 'tab', 'image'), '<svg/>');
  assert.match((await sw.visit('/', 'tab2'))!, /Home a/);
  assert.match((await sw.visit('/tools/json-graph', 'tab3'))!, /Graph a/);
});

/** Whether a promise has settled (after letting everything that can run, run). */
async function settled(p: Promise<unknown>) {
  let done = false;
  void p.then(() => (done = true), () => (done = true));
  await settle();
  return done;
}

test("service worker: a list of tabs that never comes (Firefox, a tab closing) never keeps it busy, nor deletes anything", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  // A deploy is seen while clients.matchAll() doesn't answer.
  sw.env.stallClients = true;
  sw.serve(build('b'));
  const nav = sw.open('/', 'v');
  assert.match((await nav.text)!, /Home a/);
  assert.ok(!(await settled(nav.done)), 'waits a moment for the tabs');
  // (5 s for the tidy-up, 5 more for the tabs it tells a new version is ready.)
  for (let i = 0; i < 2; i++) {
    sw.advance(5_000);
    await settle();
  }
  assert.ok(await settled(nav.done), 'then goes on without them: the visit is done');
  assert.match(sw.cached('/')!, /Home b/);
  // Not knowing the tabs, nothing goes: build a's files stay, also at the next report.
  sw.tabs([]);
  const report = sw.postSoon(['/'], 'n');
  // (5 s for its clean-up, 5 more for the one after its pages' chunks are followed.)
  for (let i = 0; i < 2; i++) {
    await settle();
    sw.advance(5_000);
  }
  assert.ok(await settled(report), 'a report is done too');
  for (const f of filesOf('a')) assert.ok(sw.has(f), f);
  // The tabs answer again: once the old tab is closed, build a goes.
  sw.env.stallClients = false;
  sw.advance(61_000);
  await sw.post(['/'], 'n');
  assert.deepEqual(sw.statics(), filesOf('b').filter((f) => sw.has(f)).sort());
  assert.ok(!sw.statics().some((p) => p.includes('/a-')));
});

test("service worker: a download that never ends is given up, so the worker always gets done", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  await sw.post(['/']);
  sw.serve(build('b'));
  // The new shell's page script never arrives (the connection hangs, neither data nor error).
  sw.hold('/_next/static/chunks/b-page.js');
  const nav = sw.open('/', 'v');
  await nav.text;
  assert.ok(!(await settled(nav.done)));
  sw.advance(30_000);
  assert.ok(await settled(nav.done), 'given up after 30 s');
  assert.match(sw.cached('/')!, /Home a/, 'the shell there stays, whole');
  for (const f of filesOf('a')) assert.ok(sw.has(f), f);
});

/**
 * A build whose localized pages name their language's dictionaries in their RSC payload (lib/i18n/server.ts
 * stringFiles): `dicts` maps a locale to its files' URLs. `tag` makes the hashed chunk names.
 */
function localized(tag: string, dicts: Record<string, string[]>): Files {
  const page = (title: string, urls: string[] = []) =>
    `<!doctype html><title>${title}</title><script src="/_next/static/chunks/${tag}-main.js"></script>` +
    `<script>self.__next_f.push([1,"{\\"files\\":{${urls.map((u, i) => `\\"f${i}\\":\\"${u}\\"`).join(',')}}}"])</script>`;
  return {
    '/': page('Home ' + tag),
    ...Object.fromEntries(Object.entries(dicts).map(([l, urls]) => [`/${l}`, page(`${l} ${tag}`, urls)])),
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-lazy.js")`,
    [`/_next/static/chunks/${tag}-lazy.js`]: 'lazy()',
    ...Object.fromEntries(Object.values(dicts).flat().map((u) => [u, `{"file":"${u}"}`])),
  };
}
const dictsOf = (sw: ReturnType<typeof worker>) => [...new Set(sw.fetched)].filter((p) => p.startsWith('/i18n/'));

test('service worker: a localized page\'s dictionaries come with it, as its chunks do: its own language\'s only, offline too', async () => {
  const de = ['/i18n/huge-strings.de.0a1b2c3d4e5f.json', '/i18n/schema-strings.de.1a1b2c3d4e5f.json', '/i18n/flatten-strings.de.2a1b2c3d4e5f.json'];
  const ja = ['/i18n/huge-strings.ja.3a1b2c3d4e5f.json', '/i18n/schema-strings.ja.4a1b2c3d4e5f.json', '/i18n/flatten-strings.ja.5a1b2c3d4e5f.json'];
  const sw = worker();
  sw.serve(localized('a', { de, ja }));
  await sw.install();
  await sw.post(['/']);
  // English: none.
  assert.deepEqual(dictsOf(sw), []);
  // A German page: stored with its files, its dictionaries among them; no other language's.
  await sw.visit('/de');
  assert.match(sw.cached('/de')!, /de a/);
  assert.deepEqual(de.filter((u) => sw.has(u)), de);
  assert.ok(!sw.fetched.some((p) => p.includes('.ja.')));
  // Offline, a feature opening on the German page gets its strings from the cache.
  sw.offline();
  assert.match((await sw.visit('/de'))!, /de a/);
  assert.equal(sw.cached(de[1]), `{"file":"${de[1]}"}`);
});

test('service worker: a dictionary that doesn\'t arrive holds its page back, as a missing chunk does (main\'s fail404)', async () => {
  const a = '/i18n/schema-strings.de.aaaaaaaaaaaa.json';
  const b = '/i18n/schema-strings.de.bbbbbbbbbbbb.json';
  const sw = worker();
  sw.serve(localized('a', { de: [a] }));
  await sw.install();
  await sw.visit('/de');
  assert.match(sw.cached('/de')!, /de a/);
  // A deploy whose German dictionary is missing: the page itself is shown, the cached copy stays, with its dictionary.
  sw.serve({ ...localized('b', { de: [b] }), [b]: 404 });
  assert.match((await sw.visit('/de'))!, /de b/);
  assert.match(sw.cached('/de')!, /de a/);
  sw.offline();
  assert.match((await sw.visit('/de'))!, /de a/);
  assert.equal(sw.cached(a), `{"file":"${a}"}`);
  // The server has it again: the next visit stores the new copy with it.
  sw.offline(false);
  sw.serve(localized('b', { de: [b] }));
  await sw.visit('/de');
  assert.match(sw.cached('/de')!, /de b/);
  assert.ok(sw.has(b));
});

test('service worker: after a deploy, an old build\'s dictionaries go once its tabs are closed, as its chunks do', async () => {
  const a = '/i18n/schema-strings.de.aaaaaaaaaaaa.json';
  const b = '/i18n/schema-strings.de.bbbbbbbbbbbb.json';
  const sw = worker();
  sw.serve(localized('a', { de: [a] }));
  await sw.install();
  await sw.visit('/de', 'tab-a');
  sw.tabs(['tab-a']);
  // Build b: the German page is visited again, then the shell's change is seen (a deploy).
  sw.serve(localized('b', { de: [b] }));
  await sw.visit('/de', 'tab-b');
  await sw.visit('/', 'tab-b');
  await sw.post(['/'], 'tab-b');
  // The tab of build a is still open: its dictionary stays.
  assert.ok(sw.has(a) && sw.has(b));
  // Closed: it goes with build a's chunks.
  sw.tabs(['tab-b']);
  await sw.post(['/de'], 'tab-b');
  assert.deepEqual([sw.has(a), sw.has(b), sw.has('/_next/static/chunks/a-main.js')], [false, true, false]);
});

test('service worker: what the page fetches for the visitor (no-store) is never answered or kept; the warm-up names only pages and app files (review 2, finding 2)', async () => {
  const sw = worker();
  sw.serve({ ...build('a'), '/schema.json': '{"type": "string"}', '/api/schema': '{}' });
  await sw.install();
  // A schema or document by URL: the SW leaves it alone (the browser fetches it), nothing is cached.
  assert.equal(await sw.get('/schema.json', 'no-store'), null);
  assert.ok(!sw.has('/schema.json'));
  // (Without no-store, a same-origin file is answered and kept: what the page must not let happen to them.)
  assert.ok(await sw.get('/schema.json'));
  // The warm-up: a file the page fetched isn't fetched again here, nor kept; its pages and app files still are.
  const fresh = worker();
  fresh.serve({ ...build('a'), '/schema.json': '{"type": "string"}' });
  await fresh.install();
  await fresh.post(['/', '/schema.json', '/tools/json-graph', '/_next/static/chunks/a-graph.js']);
  assert.ok(!fresh.fetched.includes('/schema.json') && !fresh.has('/schema.json'));
  assert.ok(fresh.has('/tools/json-graph') && fresh.has('/_next/static/chunks/a-graph.js'));
});

// ── Review round 1 (PR #40) ──────────────────────────────────────────────────────────────────────────

test("service worker: a file that isn't hashed goes to the page as soon as its headers come, whatever its body does (finding 6)", async () => {
  const sw = worker();
  sw.serve({ ...build('a'), '/manifest.webmanifest': '{"name":"Tool"}' });
  await sw.install();
  await sw.post(['/']);
  // Not cached yet: the headers come, the body never ends. The page gets the response (and reads it as it streams).
  sw.env.stallBody.add('/manifest.webmanifest');
  const first = sw.getSoon('/manifest.webmanifest');
  assert.ok(await settled(first.res), 'answered at its headers');
  assert.ok((await first.res)?.ok);
  assert.ok(!(await settled(first.done)), 'storing it waits on the body');
  sw.advance(30_000);
  assert.ok(await settled(first.done), 'given up after 30 s');
  assert.ok(!sw.has('/manifest.webmanifest'));
  // Cached, and the network's headers never come: the cached copy answers at once, and the worker gets done after 30 s.
  sw.env.stallBody.delete('/manifest.webmanifest');
  await sw.get('/manifest.webmanifest');
  assert.equal(sw.cached('/manifest.webmanifest'), '{"name":"Tool"}');
  sw.hold('/manifest.webmanifest');
  const second = sw.getSoon('/manifest.webmanifest');
  assert.equal(await (await second.res)?.text(), '{"name":"Tool"}');
  assert.ok(!(await settled(second.done)));
  sw.advance(30_000);
  assert.ok(await settled(second.done));
});

test('service worker: a home that failed to follow a tool page to its new build is tried again on the next visit (finding 5)', async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['a-tab']);
  await sw.visit('/tools/json-graph', 'a-tab');
  await sw.post(['/', '/tools/json-graph'], 'a-tab');
  // Build b: the tool page comes from the network, but '/' answers 503 for that moment.
  sw.serve({ ...site('b'), '/': 503 });
  sw.tabs(['b1']);
  await sw.visit('/tools/json-graph', 'b1');
  assert.match(sw.cached('/tools/json-graph')!, /Graph b/);
  assert.match(sw.cached('/')!, /Home a/, 'the shell there stays, whole');
  // The same build's tool page again, '/' fine now: the shell follows.
  sw.serve(site('b'));
  sw.tabs(['b2']);
  await sw.visit('/tools/json-graph', 'b2');
  assert.match(sw.cached('/')!, /Home b/);
  // And build a's files go once the tabs open at the deploys are closed.
  sw.tabs(['b3']);
  await sw.post(['/', '/tools/json-graph'], 'b3');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), sw.statics().join(' '));
});

test("service worker: main's worker brought back never deletes what a tab still being opened guards (finding 4)", async () => {
  const env = world();
  const sw = worker(undefined, env);
  sw.serve(build('a'));
  await sw.install();
  await sw.post(['/'], 'first');
  // Build b: a tab whose navigation has no id (resultingClientId) opens '/' from the cached shell, build a,
  // while its visit brings build b in. Build a's files are kept for it: its tab is UNSEEN for now.
  sw.serve(build('b'));
  assert.match((await sw.visit('/', ''))!, /Home a/);
  assert.match(sw.cached('/')!, /Home b/);
  sw.tabs(['anon']); // it shows among the tabs
  // Main's worker comes back (a rollback) before this one wrote that tab's id in: it reads the record's one list.
  const main = worker(readFileSync(join(process.cwd(), 'harness/suites/platform/fixtures/main-sw.js'), 'utf8'), env);
  await main.install();
  await main.activate();
  await main.post(['/'], 'anon');
  // The tab runs build a: offline, every file of it still comes.
  main.offline();
  assert.deepEqual(await loadsAll(main, 'anon', filesOf('a')), []);
});

test("service worker: installing deletes nothing, so a page the worker before it is still storing keeps its files (finding 1)", async () => {
  const env = world();
  const main = worker(readFileSync(join(process.cwd(), 'harness/suites/platform/fixtures/main-sw.js'), 'utf8'), env);
  main.serve(site('a'));
  await main.install();
  await main.activate();
  main.tabs(['t']);
  await main.post(['/'], 't');
  // The tab opens the diff tool; main's worker stores build a's page, waiting for its stylesheet.
  const release = main.hold('/_next/static/chunks/a-diff.css');
  const nav = main.open('/tools/json-diff', 't');
  assert.match((await nav.text)!, /Diff a/);
  // Meanwhile build b is deployed (the server keeps build a's files) and this worker installs; the tab closes.
  main.serve({ ...site('a'), ...site('b') });
  main.tabs([]);
  const sw = worker(undefined, env);
  await sw.install();
  // (Beside main's, the install caches build b's files only: '/' stays.)
  assert.match(sw.cached('/')!, /Home a/);
  assert.ok(sw.has('/_next/static/chunks/b-main.js'));
  // Main's worker gets its stylesheet and stores the page; then this one takes over and a tab reports in.
  release();
  await nav.done;
  assert.match(sw.cached('/tools/json-diff')!, /Diff a/);
  await sw.activate();
  sw.tabs(['n']);
  await sw.post(['/'], 'n');
  // Offline, the cached diff page opens with every file it names.
  sw.offline();
  assert.match((await sw.visit('/tools/json-diff', 'off'))!, /Diff a/);
  const named = ['app.css', 'main.js', 'page.js', 'diff.css', 'diff.js'].map((f) => '/_next/static/chunks/a-' + f);
  assert.deepEqual(await loadsAll(sw, 'off', named), []);
});

test("service worker: a file the new build's tab loaded on its own stays while that tab is open, after its homes follow (finding 2)", async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['a-tab']);
  await sw.visit('/tools/json-graph', 'a-tab');
  await sw.post(['/', '/tools/json-graph'], 'a-tab');
  // Build b: the only tab opens the tool page from the network; '/' follows it, slowly.
  sw.serve(site('b'));
  sw.tabs(['T']);
  const release = sw.hold('/');
  const nav = sw.open('/tools/json-graph', 'T');
  assert.match((await nav.text)!, /Graph b/);
  await settle();
  // Meanwhile the tab reaches the diff tool by client-side navigation: its script (no cached page names it) is cached.
  assert.equal(await sw.load('/_next/static/chunks/b-diff.js', 'T'), 'diff()');
  release();
  await nav.done;
  assert.match(sw.cached('/')!, /Home b/);
  // Another tab of build b reports in (the clean-up sees every cached page in full).
  sw.tabs(['T', 'U']);
  await sw.post(['/'], 'U');
  assert.ok(sw.has('/_next/static/chunks/b-diff.js'), 'kept while the tab that loaded it is open');
  sw.offline();
  assert.equal(await sw.load('/_next/static/chunks/b-diff.js', 'T'), 'diff()');
  sw.offline(false);
  // That tab closed: it goes.
  sw.tabs(['U']);
  await sw.post(['/'], 'U');
  assert.ok(!sw.has('/_next/static/chunks/b-diff.js'));
  assert.ok(!sw.statics().some((p) => p.includes('/a-')));
});

test("service worker: a file a cached page needs through a chunk not cached yet isn't deleted before that chunk is read (finding 3)", async () => {
  // shared.js: in build a's lazy chunk, not in build b, in build c's lazy chunk again (a module unchanged).
  const tiny = (tag: string, lazy: string): Files => ({
    '/': `<!doctype html><title>Home ${tag}</title><script src="/_next/static/chunks/${tag}-main.js"></script>`,
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-lazy.js")`,
    [`/_next/static/chunks/${tag}-lazy.js`]: lazy,
    '/_next/static/chunks/shared.js': 'shared()',
  });
  const uses = 's.l("static/chunks/shared.js")';
  const sw = worker();
  sw.serve(tiny('a', uses));
  await sw.install();
  sw.tabs(['tA']);
  await sw.post(['/'], 'tA');
  assert.ok(sw.has('/_next/static/chunks/shared.js'));
  // Build b, then build c, each brought in by a visit while build a's tab is open.
  sw.serve(tiny('b', 'b()'));
  await sw.visit('/', 'v1');
  sw.tabs(['tA', 'v1']);
  sw.serve(tiny('c', uses));
  await sw.visit('/', 'v2');
  sw.tabs(['tA', 'v1', 'v2']);
  // The old tabs close; a tab of build c reports in, while the server can't send shared.js again.
  sw.serve({ ...tiny('c', uses), '/_next/static/chunks/shared.js': 503 });
  sw.tabs(['tC']);
  sw.advance(61_000); // (the visits' tabs are no longer being opened)
  // (Build c's lazy chunk takes a moment to come: the clean-up the report starts at once has run by then.)
  const release = sw.hold('/_next/static/chunks/c-lazy.js');
  const report = sw.postSoon(['/'], 'tC');
  await settle();
  release();
  await report;
  assert.ok(sw.has('/_next/static/chunks/shared.js'), 'kept: build c needs it');
  assert.ok(!sw.has('/_next/static/chunks/a-lazy.js') && !sw.has('/_next/static/chunks/b-main.js'), 'what nothing needs went');
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'tC', ['/_next/static/chunks/c-main.js', '/_next/static/chunks/c-lazy.js', '/_next/static/chunks/shared.js']), []);
});

// ── Review round 2 (PR #40) ──────────────────────────────────────────────────────────────────────────

const MAIN_SW = () => readFileSync(join(process.cwd(), 'harness/suites/platform/fixtures/main-sw.js'), 'utf8');

test("service worker: installing beside main's worker changes no page and writes no record, so main's clean-up never deletes what it is storing (review 2, finding 1)", async () => {
  const env = world();
  const main = worker(MAIN_SW(), env);
  main.serve(site('a'));
  await main.install();
  await main.activate();
  main.tabs(['t']);
  await main.post(['/'], 't');
  const release = main.hold('/_next/static/chunks/a-diff.css');
  const nav = main.open('/tools/json-diff', 't');
  await nav.text;
  main.serve({ ...site('a'), ...site('b') });
  const sw = worker(undefined, env);
  await sw.install();
  assert.ok(!sw.has('/sw.js?retired') && !sw.has('/sw.js?generations'), 'no record');
  // A report main's worker handles meanwhile (another tab), before it stores the diff page.
  main.tabs(['x']);
  await main.post(['/'], 'x');
  release();
  await nav.done;
  await sw.activate();
  sw.offline();
  assert.match((await sw.visit('/tools/json-diff', 'off'))!, /Diff a/);
  const named = ['app.css', 'main.js', 'page.js', 'diff.css', 'diff.js'].map((f) => '/_next/static/chunks/a-' + f);
  assert.deepEqual(await loadsAll(sw, 'off', named), []);
});

test('service worker: a worker that starts installing during a clean-up\'s scan stops its deletions (review 2, finding 1)', async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(build('b'));
  await sw.visit('/', 'v');
  sw.tabs(['old', 'v']);
  await sw.post(['/'], 'v');
  // The old tabs close; while the next clean-up reads the cache, another worker starts installing.
  sw.tabs(['n']);
  sw.env.onKeys = () => void (sw.env.installing = 99);
  await sw.post(['/'], 'n');
  sw.env.onKeys = null;
  for (const f of filesOf('a')) assert.ok(sw.has(f), f);
  // Once it is the only one again, they go.
  sw.env.installing = 0;
  await sw.post(['/'], 'n');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')));
});

test("service worker: a chunk the new build's tab reaches through a route, also named by the old home, stays while that tab is open (review 2, finding 2)", async () => {
  // l.js: in build a's home (its main chunk names it), not in build b's pages, but in build b's diff route.
  const a = { ...site('a'), '/_next/static/chunks/a-main.js': 'x.l("static/chunks/a-graph.js");x.l("static/chunks/l.js")', '/_next/static/chunks/l.js': 'l()' };
  const b = { ...site('b'), '/_next/static/chunks/b-diff.js': 'x.l("static/chunks/l.js")', '/_next/static/chunks/l.js': 'l()' };
  const sw = worker();
  sw.serve(a);
  await sw.install();
  sw.tabs(['tA']);
  await sw.visit('/tools/json-graph', 'tA');
  await sw.post(['/', '/tools/json-graph'], 'tA');
  assert.ok(sw.has('/_next/static/chunks/l.js'));
  // Build b: the only tab gets the tool page from the network, and '/' follows; it reaches the diff route.
  sw.serve(b);
  sw.tabs(['T']);
  await sw.visit('/tools/json-graph', 'T');
  assert.match(sw.cached('/')!, /Home b/);
  assert.equal(await sw.load('/_next/static/chunks/b-diff.js', 'T'), 'x.l("static/chunks/l.js")');
  // Another tab reports in (every cached page's files known), then the network goes.
  sw.tabs(['T', 'U']);
  await sw.post(['/'], 'U');
  sw.offline();
  assert.equal(await sw.load('/_next/static/chunks/l.js', 'T'), 'l()');
});

/** Build a cached and its tab closed; build b's '/' in, its old tabs closed too: build a's files wait for a clean-up. */
async function deployed(sw: ReturnType<typeof worker>, b: Files) {
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  sw.serve(b);
  await sw.visit('/', 'v');
  sw.tabs(['n']);
  sw.advance(61_000); // (v is no longer being opened)
}

test('service worker: a lazy script that failed once is fetched again on a later report, and the clean-up goes on (review 2, finding 3)', async () => {
  const sw = worker();
  // Build b's lazy graph chunk answers 503 at first: '/' isn't known in full, so build a's files wait.
  await deployed(sw, { ...build('b'), '/_next/static/chunks/b-graph.js': 503 });
  await sw.post(['/'], 'n');
  assert.ok(sw.has('/_next/static/chunks/a-main.js'), 'waits');
  // The server recovers: the next report fetches it, and the clean-up runs.
  sw.serve(build('b'));
  await sw.post(['/'], 'n');
  assert.ok(sw.has('/_next/static/chunks/b-graph.js'));
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), sw.statics().join(' '));
});

test('service worker: a page whose files stay unknown holds a clean-up for RETIRE_MS at most (review 2, finding 3)', async () => {
  const sw = worker();
  await deployed(sw, { ...build('b'), '/_next/static/chunks/b-graph.js': 503 });
  await sw.post(['/'], 'n');
  sw.advance(6 * 24 * 3600 * 1000);
  await sw.post(['/'], 'n');
  assert.ok(sw.has('/_next/static/chunks/a-main.js'), 'still within the week');
  sw.advance(2 * 24 * 3600 * 1000);
  await sw.post(['/'], 'n');
  assert.ok(!sw.statics().some((p) => p.includes('/a-')), sw.statics().join(' '));
  assert.match(sw.cached('/')!, /Home b/, 'the page stays');
});

test("service worker: a lazy chunk's 404 during a deploy isn't taken for a name that is no file (review 2, finding 4)", async () => {
  const tiny = (tag: string, lazy: string): Files => ({
    '/': `<!doctype html><title>Home ${tag}</title><script src="/_next/static/chunks/${tag}-main.js"></script>`,
    [`/_next/static/chunks/${tag}-main.js`]: `x.l("static/chunks/${tag}-lazy.js")`,
    [`/_next/static/chunks/${tag}-lazy.js`]: lazy,
    '/_next/static/chunks/shared.js': 'shared()',
  });
  const uses = 's.l("static/chunks/shared.js")';
  const sw = worker();
  sw.serve(tiny('a', uses));
  await sw.install();
  sw.tabs(['tA']);
  await sw.post(['/'], 'tA');
  sw.serve(tiny('c', uses));
  await sw.visit('/', 'v');
  // Build a's tabs close; build c's report comes while its lazy chunk answers 404 (not all of the deploy is out yet).
  sw.tabs(['tC']);
  sw.advance(61_000);
  sw.serve({ ...tiny('c', uses), '/_next/static/chunks/c-lazy.js': 404 });
  await sw.post(['/'], 'tC');
  assert.ok(sw.has('/_next/static/chunks/shared.js'), 'kept: what c-lazy.js names is unknown');
  // It is out now; shared.js can't come from the server any more. The next report completes build c, from the cache.
  sw.serve({ ...tiny('c', uses), '/_next/static/chunks/shared.js': 404 });
  await sw.post(['/'], 'tC');
  sw.offline();
  assert.deepEqual(await loadsAll(sw, 'tC', ['/_next/static/chunks/c-main.js', '/_next/static/chunks/c-lazy.js', '/_next/static/chunks/shared.js']), []);
});

test("service worker: main's worker brought back neither reads nor drops this one's record (review 2, finding 5)", async () => {
  const env = world();
  const sw = worker(undefined, env);
  sw.serve(build('a'));
  await sw.install();
  sw.tabs(['old']);
  await sw.post(['/'], 'old');
  // Build b comes in while a tab opens '/' from build a's shell, without an id (UNSEEN guards build a for it).
  sw.serve(build('b'));
  await sw.visit('/', '');
  sw.tabs(['anon']);
  const record = JSON.stringify(sw.record());
  assert.notEqual(record, 'null');
  // Main's worker comes back with the same build ('/' stays): its clean-ups find no record of its own.
  const main = worker(MAIN_SW(), env);
  await main.install();
  await main.activate();
  await main.post(['/'], 'anon');
  assert.equal(JSON.stringify(sw.record()), record, 'untouched');
  for (const f of filesOf('a')) assert.ok(sw.has(f), f);
  // This one again: the tab takes UNSEEN's place a minute on; once it closes, build a's files go.
  const back = worker(undefined, env);
  await back.install();
  await back.activate();
  back.advance(61_000);
  await back.post(['/'], 'anon');
  for (const f of filesOf('a')) assert.ok(back.has(f), f);
  back.tabs(['n']);
  await back.post(['/'], 'n');
  assert.ok(!back.statics().some((p) => p.includes('/a-')), back.statics().join(' '));
});

test('service worker: a home left behind by a worker stopped mid-way follows on the next page from the network (review 2, finding 6)', async () => {
  const env = world();
  const sw = worker(undefined, env);
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['a1']);
  await sw.visit('/tools/json-graph', 'a1');
  await sw.post(['/', '/tools/json-graph'], 'a1');
  // Build b: the tool page from the network goes in; '/' is being fetched when the worker is stopped.
  sw.serve(site('b'));
  sw.hold('/');
  sw.tabs(['b1']);
  const nav = sw.open('/tools/json-graph', 'b1');
  await nav.text;
  await settle();
  assert.match(sw.cached('/tools/json-graph')!, /Graph b/);
  // The next worker (the same one started again: nothing in memory) gets the same build's tool page.
  const again = worker(undefined, env);
  await again.activate();
  await again.visit('/tools/json-graph', 'b2');
  assert.match(again.cached('/')!, /Home b/);
});

test("service worker: a visit to '/' brings a language home left behind along (review 2, finding 7)", async () => {
  const sw = worker();
  sw.serve(site('a'));
  await sw.install();
  sw.tabs(['a1']);
  await sw.visit('/de/tools/json-graph', 'a1');
  await sw.post(['/', '/de', '/de/tools/json-graph'], 'a1');
  // Build b, from the German tool page while '/de' answers 503: '/' follows, '/de' doesn't.
  sw.serve({ ...site('b'), '/de': 503 });
  sw.tabs(['b1']);
  await sw.visit('/de/tools/json-graph', 'b1');
  assert.match(sw.cached('/')!, /Home b/);
  assert.match(sw.cached('/de')!, /Start a/);
  // Then only '/' is visited.
  sw.serve(site('b'));
  await sw.visit('/', 'b2');
  assert.match(sw.cached('/de')!, /Start b/);
});

test("service worker: a page's early report (files only, before its warm-up) starts no lazy downloads (review 2, finding 8)", async () => {
  const sw = worker();
  sw.serve(build('a'));
  await sw.install();
  sw.fetched.length = 0;
  // Links' code goes first, on its own: what it names is cached, nothing else.
  await sw.post(['/_next/static/chunks/a-main.js']);
  assert.deepEqual(sw.fetched, []);
  // The warm-up's report (it names the page) follows the page's lazy chunks.
  await sw.post(['/', '/_next/static/chunks/a-main.js']);
  assert.ok(sw.fetched.includes('/_next/static/chunks/a-graph.js'));
});

test("service worker: a file that isn't hashed: the page reads it as it streams, and its cache copy never lands past the deadline (review 2, finding 9)", async () => {
  const M = '/manifest.webmanifest';
  const sw = worker();
  sw.serve({ ...build('a'), [M]: 'v1' });
  await sw.install();
  // Not cached: the body takes long. The page gets the response and its first bytes at once.
  let release = () => {};
  sw.env.holdBody.set(M, new Promise<void>((r) => (release = r)));
  const first = sw.getSoon(M);
  const res = await first.res;
  const chunk = await res!.body!.getReader().read();
  assert.equal(new TextDecoder().decode(chunk.value), 'v1');
  // A new version on the server, fetched and kept meanwhile; then the slow one ends, past the deadline.
  sw.env.holdBody.delete(M);
  sw.serve({ ...build('a'), [M]: 'v2' });
  await sw.get(M);
  assert.equal(sw.cached(M), 'v2');
  sw.advance(30_000);
  assert.ok(await settled(first.done));
  release();
  await settle();
  assert.equal(sw.cached(M), 'v2', 'the late one never overwrites it');
  // Cached: a revalidation that takes long is given up at the deadline, and nothing lands after it.
  sw.serve({ ...build('a'), [M]: 'v3' });
  sw.env.holdBody.set(M, new Promise<void>((r) => (release = r)));
  const again = sw.getSoon(M);
  assert.equal(await (await again.res)!.text(), 'v2');
  sw.advance(30_000);
  assert.ok(await settled(again.done));
  release();
  await settle();
  assert.equal(sw.cached(M), 'v2');
});
