/* JSON Viewer & Formatter: offline-first service worker (hand-written, no deps, ES2017).
 *
 *  '/' navigations      stale-while-revalidate (instant load, also offline)
 *  other navigations    network-first, then cache, then the cached home of the
 *                       page's language (/es, /ja…), then the cached '/'
 *  /_next/static/*      cache-first (content-hashed, immutable); a worker's script
 *                       is answered with a new Response so it keeps its #params=
 *  other same-origin    stale-while-revalidate
 *  never touched        cross-origin, non-GET, /_vercel/* and /relay/* (analytics), RSC requests
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
 * Huge mode's dictionaries (/_next/static/media/huge-strings.<lang>.<hash>.json, named in
 * every localized page's chunk), and the Schema view's and Flatten's (schema-strings,
 * flatten-strings), are followed for that page's own language only: a /de visit caches
 * the German ones and no other; English pages none.
 *
 * Pages are replaced whole: new HTML ('/' or any other page) goes into the cache
 * only once its files are (a 200, stored), so an interrupted visit leaves the copy
 * that works. Every /_next/static file the HTML names must make it, and the
 * network must not fail; a chunk named only inside a script that the server
 * doesn't have holds nothing back (a stray name is no file).
 *
 * Deploys: when '/' changes build, the /_next/static files that no cached page
 * needs any more are retired, not deleted: tabs open at that moment run the old
 * build and may still load any chunk of it (a feature opened for the first time,
 * offline). Retired files are deleted once all those tabs are closed (checked on
 * later visits and page messages), or after RETIRE_MS. The cache so holds the
 * current build, the builds its cached pages were saved with, and older builds
 * only while their tabs live. The record ('/sw.js?retired') is never served.
 */
const VERSION = 'v2';
const PREFIX = 'json-viewer-';
const CACHE = PREFIX + VERSION;
const ORIGIN = self.location.origin;
const MATCH = { ignoreVary: true };
const RETIRED = ORIGIN + '/sw.js?retired';
const RETIRE_MS = 7 * 24 * 3600 * 1000;
/** The most files followed for one page (the home page has about 40). */
const MAX_FILES = 500;

// Hashed assets appear in tags *and* inside escaped inline RSC payload strings.
const STATIC_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;
// Root-relative href/src attributes (icons, manifest, preloads).
const ATTR_RE = /\s(?:href|src)="(\/(?!\/)[^"]*)"/g;
const FILE_RE = /\.(?:m?js|css|json|webmanifest|ico|png|svg|jpe?g|webp|avif|gif|woff2?)(?:\?.*)?$/i;
// Chunks a script loads later, named relative to /_next/; files a stylesheet names (font subsets for some scripts).
const CHUNK_RE = /["'](static\/(?:chunks|media)\/[^"'\\\s]+)["']/g;
const CSS_URL_RE = /url\(\s*["']?([^"')\s]+)/g;

const isStatic = (path) => path.startsWith('/_next/static/');
/** Language prefix of a localized page (/es, /pt/tools/…), or ''. */
const langHome = (path) => (/^\/[a-z]{2}(?=\/|$)/.exec(path) || [''])[0];
/** Huge mode's and the lazy features' dictionaries (huge-strings, schema-strings, flatten-strings: lib/i18n/translate.ts). */
const HUGE_STRINGS_RE = /^\/_next\/static\/media\/(?:huge|schema|flatten)-strings\.([a-z]{2})\./;
/** Whether `url` is a dictionary (huge mode's, a lazy feature's) of another language than the page's (`page`, a URL): not one of its files. */
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
  const found = new Set(html.match(STATIC_RE) || []);
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
 * The files of a page (see the header), cached as they are found unless `fetchMissing`
 * is false (then only what the cache holds is followed); with `deep` false, only what
 * its HTML names. `page`: the page's URL (whose language's huge dictionary it needs).
 * `ok`: every file that had to make it is cached; `files`: the URLs found.
 */
async function pageFiles(cache, html, fetchMissing, deep = true, page = ORIGIN + '/') {
  const files = new Set();
  const visit = async (url, required) => {
    if (files.has(url) || files.size >= MAX_FILES || otherStrings(url, page)) return true;
    files.add(url);
    let res = await cache.match(url, MATCH);
    if (!res) {
      if (!fetchMissing) return true;
      try {
        res = await fetch(url, { credentials: 'same-origin' });
      } catch {
        return false; // offline or a flaky network: try again on a later visit
      }
      if (!cacheable(res)) return !required;
      try {
        await cache.put(url, res.clone());
      } catch {
        return false; // (storage full)
      }
    }
    const path = new URL(url).pathname;
    if (!deep || !/\.(?:js|css)$/.test(path) || !isStatic(path)) return true;
    const text = named.has(url) ? '' : await res.text();
    const results = await Promise.all(filesIn(url, text).map((u) => visit(u, false)));
    return results.indexOf(false) === -1;
  };
  const results = await Promise.all(extractAssets(html).map((u) => visit(u, isStatic(new URL(u).pathname))));
  return { ok: results.indexOf(false) === -1, files };
}

/** Whether two pages name the same files (the same build of the same page). */
function sameFiles(a, b) {
  const set = new Set(a);
  return a.length === b.length && b.every((u) => set.has(u));
}

/**
 * Puts a page (`res`, a 200) into the cache once its files are; resolves false when they
 * couldn't be (the copy there stays). A copy of the same build only gets fresher HTML.
 */
async function storePage(cache, key, res) {
  if (isHTML(res)) {
    const html = await res.clone().text();
    const old = await cache.match(key, MATCH);
    const same = old && isHTML(old) && sameFiles(extractAssets(await old.text()), extractAssets(html));
    if (!same && !(await pageFiles(cache, html, true, false, typeof key === 'string' ? key : key.url)).ok) return false;
  }
  await cache.put(key, res);
  return true;
}

/** Cache `url` unless present (a page with its files). Resolves false when it couldn't be. */
async function cacheIfMissing(cache, url) {
  if (await cache.match(url, MATCH)) return true;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return cacheable(res) && (await storePage(cache, url, res));
  } catch {
    return false;
  }
}

/** One deploy tidy-up at a time (each reads and writes the retired record). */
let tidying = Promise.resolve();
const serially = (fn) => (tidying = tidying.then(fn, fn));

/**
 * After a deploy (`deployed`), retires the /_next/static files no cached page needs,
 * with the tabs open now (`opening`: one being opened from the old shell); then deletes
 * retired files once those tabs are all gone, or RETIRE_MS later (see the header).
 */
async function tidy(cache, deployed, opening) {
  const saved = await cache.match(RETIRED);
  const rec = saved ? await saved.json().catch(() => null) : null;
  if (!deployed && !rec) return;
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const live = new Set(tabs.map((c) => c.id));
  if (opening) live.add(opening);
  const keys = await cache.keys();
  // What cached pages need, from what the cache holds.
  const keep = new Set();
  for (const k of keys) {
    const path = new URL(k.url).pathname;
    if (isStatic(path) || FILE_RE.test(path) || k.url === RETIRED) continue;
    const page = await cache.match(k, MATCH);
    if (page && isHTML(page)) (await pageFiles(cache, await page.text(), false, true, k.url)).files.forEach((u) => keep.add(u));
  }
  let urls = rec ? rec.urls : [];
  let clients = rec ? rec.clients.filter((id) => live.has(id)) : [];
  let at = rec ? rec.at : Date.now();
  if (deployed) {
    const old = new Set(urls);
    keys.forEach((k) => isStatic(new URL(k.url).pathname) && !keep.has(k.url) && old.add(k.url));
    urls = Array.from(old);
    clients = Array.from(new Set(clients.concat(Array.from(live))));
    at = Date.now();
  }
  if (clients.length && Date.now() - at < RETIRE_MS) {
    await cache.put(RETIRED, new Response(JSON.stringify({ urls, clients, at }), { headers: { 'content-type': 'application/json' } }));
    return;
  }
  await Promise.all(urls.filter((u) => !keep.has(u)).map((u) => cache.delete(u)));
  await cache.delete(RETIRED);
}

/**
 * Fetch the app shell ('/'), cache its files (see the header), then swap it in.
 * The new HTML replaces the old one only once they are, so an offline load never
 * gets HTML pointing at chunks we don't have. After a deploy (the shell names
 * other hashed files) the old build's files are retired. `opening`: the tab
 * being opened from the old shell, when a visit to '/' asked for this.
 */
async function refreshShell(opening) {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) return;
  const html = await res.clone().text();
  const old = await cache.match('/', MATCH);
  const prev = old ? extractAssets(await old.text()) : null;
  const now = extractAssets(html);
  if (prev && sameFiles(prev, now)) {
    // The same build: its files came with it (pages post what they load); anything its HTML names that is missing, again.
    await Promise.all(now.map((u) => cacheIfMissing(cache, u)));
  } else if (!(await pageFiles(cache, html, true, false)).ok && prev) return; // flaky network or a half-done deploy: keep the consistent old shell
  await cache.put('/', res);
  const deployed = !!prev && !prev.every((u) => now.indexOf(u) !== -1);
  await serially(() => tidy(cache, deployed, opening));
  if (!deployed) return; // first install, or same build
  // A new deploy is cached and ready: let open tabs offer a reload.
  const tabs = await self.clients.matchAll({ type: 'window' });
  tabs.forEach((c) => c.postMessage({ type: 'updated' }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(refreshShell().catch(() => {})); // partial precache is fine; the page posts the rest
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page posts { type: 'cache', urls } with every resource it loaded (see registerSW()).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache' || !Array.isArray(data.urls)) return;
  // Absolute same-origin URLs only (that's what the page sends).
  const urls = data.urls
    .slice(0, 500)
    .filter((u) => typeof u === 'string' && u.startsWith(ORIGIN + '/'))
    .map((u) => new URL(u))
    .filter((url) => !bypass(url))
    .map((url) => url.href);
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(urls.map((u) => cacheIfMissing(cache, u)))
        // The page has settled: now the chunks its pages' scripts can load later (see the header).
        .then(() => Promise.all(urls.map((u) => followPage(cache, u))))
        // Tabs of an old build may have closed since: their files can go.
        .then(() => serially(() => tidy(cache, false)))
        .catch(() => {}),
    ),
  );
});

/** Pages whose chunks were followed while this worker runs (one per page and build). */
const followed = new Set();

/** Caches every file a cached page (`url`) can load later, once per build of it. */
async function followPage(cache, url) {
  const path = new URL(url).pathname;
  if (isStatic(path) || FILE_RE.test(path)) return;
  const page = await cache.match(url, MATCH);
  if (!page || !isHTML(page)) return;
  const html = await page.text();
  const key = url + ' ' + extractAssets(html).join(' ');
  if (followed.has(key)) return;
  if ((await pageFiles(cache, html, true, true, url)).ok) followed.add(key);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.origin !== ORIGIN || bypass(url, req.headers)) return;

  if (req.mode === 'navigate') {
    if (url.pathname === '/') {
      // Stale-while-revalidate the shell; query strings (utm_*, etc.) are ignored.
      const hit = caches.open(CACHE).then((c) => c.match('/', MATCH));
      event.respondWith(hit.then((res) => res || fetch(req)));
      event.waitUntil(hit.then(() => refreshShell(event.resultingClientId)).catch(() => {}));
    } else {
      event.respondWith(networkFirst(event, req));
    }
  } else if (isStatic(url.pathname)) {
    event.respondWith(cacheFirst(event, req));
  } else {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  return fetch(req).then(
    (res) => {
      // Kept with its files only (see the header): until they are, the cached copy stays.
      if (cacheable(res)) event.waitUntil(storePage(cache, req, res.clone()).catch(() => {}));
      return res;
    },
    async () => {
      const home = langHome(new URL(req.url).pathname);
      return (await cache.match(req, MATCH)) || (home && (await cache.match(home, MATCH))) || (await cache.match('/', MATCH)) || Response.error();
    },
  );
}

async function cacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  const res = hit || (await fetch(req));
  if (!hit && cacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
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
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  const net = fetch(req).then((res) => {
    if (cacheable(res)) return cache.put(req, res.clone()).then(() => res, () => res);
    return res;
  });
  event.waitUntil(net.catch(() => {}));
  return hit || net;
}
