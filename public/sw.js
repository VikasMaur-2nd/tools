/* JSON Viewer & Formatter: offline-first service worker (hand-written, no deps, ES2017).
 *
 *  '/' navigations      stale-while-revalidate (instant load, also offline)
 *  other navigations    network-first, then cache, then the cached home of the
 *                       page's language (/es, /ja…), then the cached '/'
 *  /_next/static/*      cache-first (content-hashed, immutable); a worker's script
 *                       is answered with a new Response so it keeps its #params=
 *  other same-origin    stale-while-revalidate
 *  never touched        cross-origin, non-GET, /_vercel/* and /relay/* (analytics), RSC requests,
 *                       no-store requests (what the page fetches for the visitor: a document or schema by URL)
 *
 * What a page needs offline, its files: what its HTML names (scripts, styles,
 * fonts, icons), every chunk those scripts can load later ("static/chunks/…"
 * names inside them: features loaded on first use, workers), followed on, and
 * the fonts its stylesheets name (subsets only some text loads). What the HTML
 * names comes with the page; the rest is followed when the page reports in after
 * its warm-up (its 'cache' message), so a first visit's own loading (and a big
 * document opened at once) never shares the network or the device with 1.5 MB of
 * chunks it may not need yet.
 *
 * A localized page's dictionaries (/i18n/<name>-strings.<lang>.<hash>.json, its own
 * language's only, named in its HTML) are handled as its /_next/static files are. (Older
 * builds named huge mode's, every language's, in a chunk: the page's language's is followed.)
 *
 * Pages are replaced whole: new HTML goes into the cache only once every hashed file it
 * names is, so an interrupted visit leaves the copy that works. (A name inside a script
 * that is no file holds nothing back.)
 *
 * Deploys: when a cached page is replaced by a copy of another build, the hashed
 * files no cached page needs any more are retired, not deleted, as a generation
 * kept with every tab open then, and those being opened from the cache: they may
 * run the old build and load any chunk of it later (offline too). A generation's
 * files are deleted once all its tabs are closed, or RETIRE_MS after it, unless a
 * cached page needs them. The record ('/sw.js?generations') is never served, and
 * the worker before this one (main's) never reads it. A page from the network
 * brings the cached homes ('/', /de…) of another build along, so a visitor who
 * never opens '/' gets the same clean-up. Why no tab loses a file it needs: see
 * tidy().
 */
const VERSION = 'v2';
const PREFIX = 'json-viewer-';
const CACHE = PREFIX + VERSION;
const ORIGIN = self.location.origin;
const MATCH = { ignoreVary: true };
const RECORD = ORIGIN + '/sw.js?generations';
/** The record of the worker before this one: taken in once, then dropped (see tidy). */
const LEGACY = ORIGIN + '/sw.js?retired';
const RETIRE_MS = 7 * 24 * 3600 * 1000;
/** Longer than a tab takes to show among the clients once its page is served (see opening). */
const OPENING_MS = 60 * 1000;
/** The longest the worker waits on the list of tabs, and on a download of its own or a page's body: it always gets idle. */
const CLIENTS_MS = 5 * 1000;
const FETCH_MS = 30 * 1000;
/** The most files followed for one page (the home page has about 90). */
const MAX_FILES = 500;

// Hashed assets appear in tags *and* inside escaped inline RSC payload strings.
const STATIC_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;
// Root-relative href/src attributes (icons, manifest, preloads).
const ATTR_RE = /\s(?:href|src)="(\/(?!\/)[^"]*)"/g;
const FILE_RE = /\.(?:m?js|css|json|webmanifest|ico|png|svg|jpe?g|webp|avif|gif|woff2?)(?:\?.*)?$/i;
// Chunks a script loads later, named relative to /_next/; files a stylesheet names (font subsets for some scripts).
const CHUNK_RE = /["'](static\/(?:chunks|media)\/[^"'\\\s]+)["']/g;
const CSS_URL_RE = /url\(\s*["']?([^"')\s]+)/g;
// The build a page is of: Next's build id, once in its RSC payload.
const BUILD_RE = /\\"b\\":\\"([\w-]+)\\"/;

const isStatic = (path) => path.startsWith('/_next/static/');
// A localized page's dictionaries, named in its HTML (in the RSC payload); named by their content.
const STRINGS_RE = /\/i18n\/[a-z]+-strings\.[a-z]{2}\.[0-9a-f]+\.json/g;
/** Files named by their content: /_next/static files and those dictionaries (see the header). */
const isHashed = (path) => isStatic(path) || /^\/i18n\/[a-z]+-strings\./.test(path);
/**
 * A URL as the cache matches it: without its fragment. (Cache keys can keep one: WebKit lists a worker's
 * script under the URL it was started with, Turbopack's bootstrap plus #params=…, which pages name without.)
 */
const bare = (url) => url.split('#')[0];
const buildOf = (html) => (BUILD_RE.exec(html) || [])[1] || null;

/** `promise`'s value, or `fallback` once `ms` have passed without one (the promise may never settle). */
function within(promise, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** fetch() for the worker's own downloads, never a page's request: given up (aborted) after FETCH_MS, body included. */
function download(url, init) {
  if (typeof AbortController !== 'function') return fetch(url, init);
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), FETCH_MS);
  return fetch(url, Object.assign({}, init, { signal: ctl.signal }));
}

/**
 * The window clients (`all`: another worker's too), or null when the list doesn't come within CLIENTS_MS:
 * Firefox asks each tab's process for its state before answering, and a tab being closed or reloaded may
 * never reply.
 */
const windowTabs = (all) => within(self.clients.matchAll({ type: 'window', includeUncontrolled: all }), CLIENTS_MS, null).catch(() => null);
/** Language prefix of a localized page (/es, /pt/tools/…), or ''. */
const langHome = (path) => (/^\/[a-z]{2}(?=\/|$)/.exec(path) || [''])[0];
const HUGE_STRINGS_RE = /^\/_next\/static\/media\/huge-strings\.([a-z]{2})\./;
/** Whether `url` is huge mode's dictionary of another language than the page's (`page`, a URL): not one of its files. */
const otherStrings = (url, page) => {
  const m = HUGE_STRINGS_RE.exec(new URL(url).pathname);
  return !!m && '/' + m[1] !== langHome(new URL(page).pathname);
};
const isHTML = (res) => (res.headers.get('content-type') || '').includes('text/html');

/** Requests the SW must leave alone (analytics, RSC/flight data, the SW itself). */
function bypass(url, headers) {
  return (
    url.pathname.startsWith('/_vercel/') ||
    url.pathname.startsWith('/relay/') ||
    url.pathname === '/sw.js' ||
    url.searchParams.has('_rsc') ||
    (headers && (headers.has('RSC') || headers.has('Next-Router-Prefetch')))
  );
}

/** Only full, same-origin, non-redirected 200s are worth keeping. */
const cacheable = (res) => res && res.status === 200 && res.type === 'basic' && !res.redirected;

/** Same-origin asset URLs referenced by an HTML document. */
function extractAssets(html) {
  const found = new Set((html.match(STATIC_RE) || []).concat(html.match(STRINGS_RE) || []));
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(html))) found.add(m[1]);
  const out = new Set();
  found.forEach((raw) => {
    const url = new URL(raw.replace(/&amp;/g, '&'), ORIGIN);
    if (url.origin === ORIGIN && FILE_RE.test(url.pathname + url.search) && !bypass(url)) out.add(url.href);
  });
  return Array.from(out);
}

/** The /_next/static files a script or stylesheet names (hashed files never change: remembered while the SW runs). */
const named = new Map();
function filesIn(url, text) {
  let out = named.get(url);
  if (!out) {
    const found = new Set();
    let m;
    if (/\.css$/.test(url)) {
      CSS_URL_RE.lastIndex = 0;
      while ((m = CSS_URL_RE.exec(text))) {
        const u = new URL(m[1], url);
        if (u.origin === ORIGIN && isStatic(u.pathname)) found.add(u.href);
      }
    } else {
      CHUNK_RE.lastIndex = 0;
      while ((m = CHUNK_RE.exec(text))) found.add(ORIGIN + '/_next/' + m[1]);
      (text.match(STATIC_RE) || []).forEach((p) => found.add(ORIGIN + p));
    }
    out = Array.from(found);
    named.set(url, out);
  }
  return out;
}

/**
 * The files of a page (see the header) from what its HTML names (`roots`), cached as they are found
 * unless `fetchMissing` is false (then only what the cache holds is followed, `have` its keys if
 * given); with `deep` false, only the roots. `page`: the page's URL (whose language's huge dictionary
 * it needs). `ok`: every file that had to make it is cached; `files`: the URLs found; `open`: a script
 * or stylesheet among them isn't cached, so what it names is unknown (a 404 too: it may be a moment
 * of a deploy).
 */
async function pageFiles(cache, roots, fetchMissing, deep = true, page = ORIGIN + '/', have = null) {
  const files = new Set();
  let open = false;
  let retry = false; // a download that may work later (5xx, 408, 429, the network) failed
  const visit = async (url, required) => {
    if (files.has(url) || otherStrings(url, page)) return true;
    if (files.size >= MAX_FILES) {
      open = true; // (past the cap the rest is unknown)
      return true;
    }
    files.add(url);
    const path = new URL(url).pathname;
    const names = deep && /\.(?:js|css)$/.test(path) && isStatic(path); // a file that names others
    // (With `have`, the cache is read only for a text not read yet: see filesIn.)
    let res = have && !have.has(bare(url)) ? null : have && (!names || named.has(url)) ? true : await cache.match(url, MATCH);
    if (!res && fetchMissing) {
      try {
        res = await download(url, { credentials: 'same-origin' });
        if (!cacheable(res)) {
          open = open || names;
          if (res.status >= 500 || res.status === 408 || res.status === 429) retry = true;
          return !required; // (a name in a script that is no file holds no page back)
        }
        await cache.put(url, res.clone());
      } catch {
        open = open || names;
        return false; // offline, a flaky network or storage full: tried again on a later visit
      }
    }
    if (!res) {
      open = open || names; // not cached: what it names is unknown
      return true;
    }
    if (!names) return true;
    const text = named.has(url) ? '' : await res.text();
    const results = await Promise.all(filesIn(url, text).map((u) => visit(u, false)));
    return results.indexOf(false) === -1;
  };
  const results = await Promise.all(roots.map((u) => visit(u, isHashed(new URL(u).pathname))));
  return { ok: results.indexOf(false) === -1, files, open, retry };
}

/** Whether two pages name the same files (the same build of the same page). */
function sameFiles(a, b) {
  const set = new Set(a);
  return a.length === b.length && b.every((u) => set.has(u));
}

/**
 * Puts a page (`res`, a 200) into the cache once its files are; resolves false when they
 * couldn't be (the copy there stays), else as commit(). A copy of the same build only gets
 * fresher HTML. `base`: the cached copy's HTML (or its promise) from before the page was asked for.
 */
async function storePage(cache, key, res, base) {
  if (!isHTML(res)) {
    await cache.put(key, res);
    return { replaced: false };
  }
  const page = typeof key === 'string' ? key : key.url;
  // (A body that stalls is given up: see FETCH_MS. A navigation's isn't one of the worker's downloads.)
  const html = await within(res.clone().text(), FETCH_MS, null);
  if (html === null) return false;
  base = await base;
  const same = base !== null && sameFiles(extractAssets(base), extractAssets(html));
  if (!same && !(await pageFiles(cache, extractAssets(html), true, false, page)).ok) return false;
  return publish(cache, key, page, res, html, false, base);
}

/** The cached copy of a page as HTML text, or null. */
const htmlOf = (key) => cachedCopy(key).then((r) => (r && isHTML(r) ? r.text() : null));

/** commit() in its turn; a new '/' committed tells every tab a new version is ready. */
async function publish(cache, key, page, res, html, partial, base) {
  const done = await serially(() => commit(cache, key, page, res, html, partial, base));
  if (done && done.replaced && page === ORIGIN + '/') {
    const tabs = await windowTabs(true); // (another worker's too: tabs it still controls while this one installs)
    if (tabs) tabs.forEach((c) => c.postMessage({ type: 'updated' }));
  }
  return done;
}

/** Cache `url` unless present (a page with its files). Resolves false when it couldn't be. */
async function cacheIfMissing(cache, url) {
  if (await cache.match(url, MATCH)) return true;
  try {
    const res = await download(url, { credentials: 'same-origin' });
    return cacheable(res) && !!(await storePage(cache, url, res, null));
  } catch {
    return false;
  }
}

/**
 * One at a time: tidy-ups (each reads and writes the record) and the last step of storing a page (see
 * commit). Both read the cache and the list of tabs only (that one bounded: see CLIENTS_MS), never the
 * network: a stalled download never holds the queue up.
 */
let tidying = Promise.resolve();
const serially = (fn) => (tidying = tidying.then(fn, fn));

/**
 * The last step of storing a page (its HTML `html` already read), in the queue: no tidy-up deletes a file
 * between the checks and the page going in. Nothing is stored (false) if another build's copy went in since
 * this one was fetched (`base`: the copy then), nor, unless the copy there is of the same build (or with
 * `partial` there is none), if a hashed file the HTML names is gone. Then an old copy of another build
 * retires its files (tidy). Resolves { replaced, html }.
 */
async function commit(cache, key, page, res, html, partial, base) {
  const prev = await cache.match(key, MATCH);
  const old = prev && isHTML(prev) ? await prev.text() : null;
  const files = extractAssets(html);
  const same = old !== null && sameFiles(extractAssets(old), files);
  if (!same && (old === null ? base !== null : base === null || !sameFiles(extractAssets(old), extractAssets(base)))) return false;
  if (!same && !(partial && !prev)) {
    const must = files.filter((u) => isHashed(new URL(u).pathname) && !otherStrings(u, page));
    const held = await Promise.all(must.map((u) => cache.match(u, MATCH)));
    if (held.indexOf(undefined) !== -1) return false;
  }
  // (The HTML already read, as a new Response: the queue never waits on a network stream.)
  await cache.put(key, new Response(html, { status: res.status, statusText: res.statusText, headers: res.headers }));
  const replaced = old !== null && !same;
  await tidy(cache, replaced ? { html: old, page } : null).catch(() => {});
  return { replaced, html };
}

/**
 * Tabs being opened: every navigation (it may run a cached page's build, or the network's, which may share
 * files with an old one), until its tab shows among the clients a moment after its page is served, or
 * OPENING_MS. `id`: resultingClientId, '' in browsers without one.
 */
let opening = [];
function noteOpening(id) {
  const now = Date.now();
  opening = opening.filter((o) => now - o.at <= OPENING_MS).concat({ id: id || '', at: now });
}

/**
 * The tabs that may run some build now (`ids`): every window client, another worker's too, and the
 * tabs being opened from the cache. `unnamed`: one of those has no id. Null when the list of window
 * clients doesn't come (see windowTabs): then they are unknown.
 */
async function liveTabs() {
  const tabs = await windowTabs(true);
  if (!tabs) return null;
  const ids = new Set(tabs.map((c) => c.id));
  const now = Date.now();
  // (One that shows is a client like any other from now on; one that never does, after OPENING_MS, none.)
  opening = opening.filter((o) => !ids.has(o.id) && now - o.at <= OPENING_MS);
  opening.forEach((o) => (o.id ? ids.add(o.id) : 0));
  return { ids, unnamed: opening.some((o) => !o.id) };
}

/** Among a generation's tabs: one being opened without an id when it began, or tabs unknown (see tidy). */
const UNSEEN = '?';

/**
 * Whether a worker is on its way in: this one while it installs, or another installing or waiting (main's
 * too, brought back). It may be storing a page whose files it checked before, so nothing is deleted
 * meanwhile: the one it replaces is stopped when it becomes the active one (the spec's Activate).
 */
const arriving = () => !!(self.registration && (self.registration.installing || self.registration.waiting));

/**
 * What the cached pages need, from what the cache holds (`keys`: its keys): `keep`, every file of
 * theirs (bare URLs), and `open`, the pages whose files aren't all known (see pageFiles).
 */
async function needed(cache, keys) {
  const have = new Set(keys.map((k) => bare(k.url)));
  const keep = new Set();
  const open = [];
  for (const k of keys) {
    const path = new URL(k.url).pathname;
    if (isStatic(path) || FILE_RE.test(path)) continue; // (files, and the records: '/sw.js?…')
    const page = await cache.match(k, MATCH);
    if (!page || !isHTML(page)) continue;
    const found = await pageFiles(cache, extractAssets(await page.text()), false, true, k.url, have);
    found.files.forEach((u) => keep.add(bare(u)));
    if (found.open) open.push(k.url);
  }
  return { keep, open };
}

/**
 * Retires and deletes old builds' files (see the header). Run through `serially` only. `replaced`:
 * { html, page } when a cached page's copy was just replaced by another build's; `posted`: the files
 * a tab (`from`, its id) reports it loaded. Resolves true when deleting waited for pages whose files
 * aren't all known (see needed).
 *
 * Why no tab loses a file it needs (a tab runs a page's build, and may load any file of it later):
 *  - Every tab open or being opened when a page's copy is replaced guards the generation its files go to
 *    (moved from an older one too), with every other file no cached page needs (what tabs loaded on their
 *    own: a route reached by client-side navigation, of any build).
 *  - A tab opened later got a cached page, whose files stay while it is cached and go to a generation
 *    with this tab among its tabs when it is replaced, or the network's page: the current build, whose
 *    files a later replacement retires with this tab among the tabs. A retired file such a tab reports
 *    it loaded leaves its generation (to be retired again by a later replacement).
 *  - Deleting checks the cached pages again, with all their files known, and every generation that stays:
 *    a file one of them needs or holds stays. While a page's files aren't all known, nothing goes, past
 *    RETIRE_MS too (lingering, never a page broken offline): its reports follow it again, and a visit or a
 *    new build replaces it.
 * A tab being opened without an id stands as UNSEEN: OPENING_MS later, every tab open then takes its
 * place (it among them, if it is still open).
 */
async function tidy(cache, replaced, posted, from) {
  const saved = await cache.match(RECORD);
  // Main's record (written before this worker, or by main's brought back): taken in as a generation (with the tabs
  // open now, as its next deploy would have had them), then dropped: main's worker never acts on this one's.
  const legacy = await cache.match(LEGACY);
  if (!saved && !legacy && !replaced) return false;
  const text = saved ? await saved.text() : null;
  const live = await liveTabs();
  const now = Date.now();
  // Unknown tabs (their list didn't come: see windowTabs) change nothing about them, delete nothing.
  const ids = live ? Array.from(live.ids) : [];
  const unseen = !live || live.unnamed ? [UNSEEN] : [];
  const valid = (g) => g && Array.isArray(g.urls) && Array.isArray(g.clients) && typeof g.at === 'number';
  let gens = [];
  try {
    gens = JSON.parse(text || '[]').filter(valid);
  } catch {}
  try {
    const r = legacy && JSON.parse(await legacy.text());
    if (r && Array.isArray(r.urls) && Array.isArray(r.clients)) gens.push({ urls: r.urls.map(bare), clients: Array.from(new Set(r.clients.concat(ids, unseen))), at: r.at || now });
  } catch {}
  const loaded = new Set((posted || []).map(bare));
  gens.forEach((g) => {
    const waiting = g.clients.indexOf(UNSEEN) !== -1;
    // A newer tab uses these (a tab while one is UNSEEN may be that one: it soon joins the tabs instead).
    if (!waiting && g.clients.indexOf(from) === -1) g.urls = g.urls.filter((u) => !loaded.has(u));
    if (!live) return;
    if (waiting && now - g.at >= OPENING_MS) g.clients = g.clients.concat(ids);
    g.clients = g.clients.filter((id) => live.ids.has(id) || (id === UNSEEN && now - g.at < OPENING_MS)); // closed tabs go
  });
  let need = null;
  if (replaced) {
    const keys = await cache.keys();
    need = await needed(cache, keys);
    // (Bare URLs throughout: a key is compared without its fragment, as the cache matches it.)
    const cached = new Set(keys.map((k) => bare(k.url)));
    const freed = new Set();
    (await pageFiles(cache, extractAssets(replaced.html), false, true, replaced.page, cached)).files.forEach((u) => !need.keep.has(bare(u)) && freed.add(bare(u)));
    const held = new Set();
    gens.forEach((g) => {
      g.urls = g.urls.filter((u) => !freed.has(u));
      g.urls.forEach((u) => held.add(u));
    });
    const urls = Array.from(cached).filter((u) => isHashed(new URL(u).pathname) && !need.keep.has(u) && !held.has(u));
    if (urls.length) gens.push({ urls, clients: ids.concat(unseen), at: now });
  }
  let done = live ? gens.filter((g) => !g.clients.length || now - g.at >= RETIRE_MS) : [];
  let waited = false;
  if (done.length) {
    need = need || (await needed(cache, await cache.keys()));
    if (need.open.length) [waited, done] = [true, []];
  }
  // (Checked right before the deletions go out: see arriving.)
  const stays = new Set([].concat(...gens.filter((g) => done.indexOf(g) === -1).map((g) => g.urls)));
  if (done.length && !arriving()) await Promise.all([].concat(...done.map((g) => g.urls)).filter((u) => !need.keep.has(u) && !stays.has(u)).map((u) => cache.delete(u)));
  else done = [];
  gens = gens.filter((g) => done.indexOf(g) === -1 && g.urls.length);
  const json = JSON.stringify(gens);
  if (gens.length && json !== text) await cache.put(RECORD, new Response(json, { headers: { 'content-type': 'application/json' } }));
  else if (!gens.length && saved) await cache.delete(RECORD);
  if (legacy) await cache.delete(LEGACY);
  return waited;
}

/**
 * Fetch the app shell ('/'), cache its files (see the header), then swap it in. The new HTML
 * replaces the old one only once they are, so an offline load never gets HTML pointing at chunks
 * we don't have.
 */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const before = htmlOf('/'); // (the copy there before the fetch: see commit)
  const res = await download('/', { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) return;
  const html = await res.clone().text();
  const base = await before;
  const prev = base === null ? null : extractAssets(base);
  const now = extractAssets(html);
  if (prev && sameFiles(prev, now)) {
    // The same build: its files came with it (pages post what they load); anything its HTML names that is missing, again.
    await Promise.all(now.map((u) => cacheIfMissing(cache, u)));
  } else if (!(await pageFiles(cache, now, true, false)).ok && prev) return; // flaky network or a half-done deploy: keep the consistent old shell
  // (On a first install, with no copy yet, even a partial one: better than none offline, and the page posts the rest.)
  const first = !prev && !(self.registration && self.registration.active);
  const done = await publish(cache, '/', ORIGIN + '/', res, html, first, base);
  if (done) await refreshHomes(cache, ORIGIN + '/', html, done.replaced);
}

/**
 * After a page from the network (`url`, its HTML `html`) is stored: each cached home ('/', /de…) of another
 * build follows it (unvisited pages fall back to them offline, and their old build can go). One that can't now
 * is tried again after the next page. (Without build ids: '/' and the page's home, if it `replaced` another build.)
 */
async function refreshHomes(cache, url, html, replaced) {
  const path = new URL(url).pathname;
  const build = buildOf(html);
  const keys = await cache.keys();
  await Promise.all(
    keys.map(async (k) => {
      const p = new URL(k.url).pathname;
      if (p === path || !/^\/(?:[a-z]{2})?$/.test(p)) return;
      const home = await cache.match(k, MATCH);
      const text = home && isHTML(home) ? await home.text() : null;
      const theirs = text && buildOf(text);
      if (build && theirs ? theirs === build : !replaced || (p !== '/' && p !== langHome(path))) return;
      const res = await download(p, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => null);
      if (cacheable(res)) await storePage(cache, ORIGIN + p, res, text);
    }),
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // The new shell goes in now; nothing is deleted while this worker installs (see arriving), and the worker before
  // it (main's) never reads this one's record. (A partial precache is fine; the page posts the rest.)
  event.waitUntil(refreshShell().catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => within(self.clients.claim(), CLIENTS_MS)),
  );
});

// The page posts { type: 'cache', urls } with every resource it loaded (see registerSW()).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache' || !Array.isArray(data.urls)) return;
  // Absolute same-origin URLs only (that's what the page sends): pages and the app's hashed files, never another
  // file it fetched (a document or schema by URL, fetched again here with cookies and kept).
  const urls = data.urls
    .slice(0, 500)
    .filter((u) => typeof u === 'string' && u.startsWith(ORIGIN + '/'))
    .map((u) => new URL(u))
    .filter((url) => !bypass(url) && (isHashed(url.pathname) || !FILE_RE.test(url.pathname)))
    .map((url) => url.href);
  const from = event.source && event.source.id;
  // (The warm-up's report names its page; an earlier one, only files: then nothing is followed but what it names.)
  const report = urls.some((u) => !FILE_RE.test(new URL(u).pathname));
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      // At once, not after the downloads below (a stalled one never holds it up): tabs of an old build may have
      // closed since, and their files can go; what this tab loaded stays (see tidy).
      const first = serially(() => tidy(cache, null, urls, from)).catch(() => false);
      return Promise.all(urls.map((u) => cacheIfMissing(cache, u)))
        .then(() => Promise.all(urls.map((u) => followPage(cache, u)))) // the page has settled: its chunks (see the header)
        .then(() => first)
        .then(async (waited) => {
          if (!waited || !report) return;
          // Deleting waited for cached pages whose files aren't all known: those are followed again, then it runs again.
          const { open } = await needed(cache, await cache.keys());
          await Promise.all(open.map((u) => followPage(cache, u)));
          await serially(() => tidy(cache));
        })
        .catch(() => {});
    }),
  );
});

/** Pages whose files were all followed while this worker runs (one per page and build). */
const followed = new Set();

/** Caches every file a cached page (`url`) can load later, once per build of it (until all are). */
async function followPage(cache, url) {
  const path = new URL(url).pathname;
  if (isStatic(path) || FILE_RE.test(path)) return;
  const page = await cache.match(url, MATCH);
  if (!page || !isHTML(page)) return;
  const html = await page.text();
  const key = url + ' ' + extractAssets(html).join(' ');
  if (followed.has(key)) return;
  const found = await pageFiles(cache, extractAssets(html), true, true, url);
  if (found.ok && !found.open && !found.retry) followed.add(key);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  if (req.cache === 'no-store') return;
  const url = new URL(req.url);
  if (url.origin !== ORIGIN || bypass(url, req.headers)) return;

  if (req.mode === 'navigate') {
    noteOpening(event.resultingClientId); // (see opening)
    if (url.pathname === '/') {
      // Stale-while-revalidate the shell; query strings (utm_*, etc.) are ignored.
      const hit = cachedCopy('/');
      event.respondWith(hit.then((res) => res || fetch(req)));
      event.waitUntil(hit.then(() => refreshShell()).catch(() => {}));
    } else {
      event.respondWith(networkFirst(event, req));
    }
  } else if (isHashed(url.pathname)) {
    event.respondWith(cacheFirst(event, req));
  } else {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

/**
 * What the cache holds for `req`, or nothing when it can't be read (a storage error): the network
 * answers then, so a request the network can serve never fails because of the cache.
 */
const cachedCopy = (req) => caches.open(CACHE).then((c) => c.match(req, MATCH)).catch(() => undefined);

function networkFirst(event, req) {
  const before = htmlOf(req); // (the copy there before the fetch: see commit)
  return fetch(req).then(
    (res) => {
      // Kept with its files only (see the header): until they are, the cached copy stays. Then the homes follow.
      if (cacheable(res)) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => storePage(cache, req, copy, before).then((r) => r && r.html && refreshHomes(cache, req.url, r.html, r.replaced))).catch(() => {}));
      }
      return res;
    },
    async () => {
      const home = langHome(new URL(req.url).pathname);
      return (await cachedCopy(req)) || (home && (await cachedCopy(home))) || (await cachedCopy('/')) || Response.error();
    },
  );
}

async function cacheFirst(event, req) {
  const hit = await cachedCopy(req);
  const res = hit || (await fetch(req));
  if (!hit && cacheable(res)) {
    const copy = res.clone();
    // (Its body comes with the page's: should that stall, the worker isn't held past FETCH_MS.)
    event.waitUntil(within(caches.open(CACHE).then((c) => c.put(req, copy)), FETCH_MS).catch(() => {}));
  }
  return req.destination === 'worker' ? asNew(res) : res;
}

/**
 * Turbopack's worker bootstrap reads its config from its URL's fragment (#params=…), and a
 * worker takes the URL of the response it gets. A cached copy can have been fetched without
 * the fragment (Safari lists resources without it, so the page hands over the bare URL), and
 * served as is it starts the worker without its config ("Missing worker bootstrap config").
 * A new Response has no URL, so the worker keeps the one it was created with.
 */
const asNew = (res) => new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });

async function staleWhileRevalidate(event, req) {
  const hit = await cachedCopy(req);
  if (req.cache === 'only-if-cached') return hit || fetch(req);
  // A miss: the page's own request, and a clone (taken before the page reads it) for the cache. A hit: the worker's
  // own, aborted at FETCH_MS. A copy is kept only if its body is in by then, counted from the fetch's start (none
  // lands late over a newer one).
  const end = Date.now() + FETCH_MS;
  const net = hit ? download(req) : fetch(req);
  event.waitUntil(
    net
      .then((res) => {
        if (!cacheable(res)) return;
        return storeBy(req, hit ? res : res.clone(), end);
      })
      .catch(() => {}),
  );
  return hit || net;
}

/**
 * Stores `res` (a copy only the cache reads) under `req` if its body is all in by `end`: past it, the copy's read is
 * cancelled (the page's own copy goes on) and the half-written entry fails, so nothing lands.
 */
function storeBy(req, res, end) {
  const reader = res.body.getReader();
  if (Date.now() >= end) return reader.cancel();
  let ctl;
  const body = new ReadableStream({ start: (c) => (ctl = c), pull: (c) => reader.read().then((r) => (r.done ? c.close() : c.enqueue(r.value))) });
  const timer = setTimeout(() => {
    try {
      ctl.error(new Error('late'));
    } catch {} // (already read in full: the entry is being written)
    reader.cancel().catch(() => {});
  }, end - Date.now());
  return caches.open(CACHE).then((c) => c.put(req, new Response(body, res))).finally(() => clearTimeout(timer));
}
