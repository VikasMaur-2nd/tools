/* JSON Viewer & Formatter: offline-first service worker (hand-written, no deps, ES2017).
 *
 *  '/' navigations      stale-while-revalidate (instant load, also offline)
 *  other navigations    network-first, then cache, then the cached home of the
 *                       page's language (/es, /ja…), then the cached '/'
 *  /_next/static/*      cache-first (content-hashed, immutable); a worker's script
 *                       is answered with a new Response so it keeps its #params=
 *  /i18n/*-strings.*    cache-first too (named by their content)
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
 * The dictionaries a localized page loads later (huge mode's, the Schema view's and
 * Flatten's: /i18n/<name>-strings.<lang>.<hash>.json, named by their content) are named
 * in that page's HTML, its own language's only, and followed with its chunks (on a first
 * visit not with its HTML: they wait for the page's warm-up too). They are files the
 * page must have: one that doesn't arrive (a 404, the network) leaves the warm-up to be
 * done again, and a cached copy of the page is replaced only once the new one's are
 * cached. A /de visit caches the German ones and no other; English pages none. Builds
 * before them named every language's in a chunk
 * (/_next/static/media/huge-strings.<lang>.<hash>.json): followed for the page's language
 * only as well.
 *
 * Pages are replaced whole: new HTML ('/' or any other page) goes into the cache
 * only once its files are (a 200, stored), so an interrupted visit leaves the copy
 * that works. Every /_next/static file the HTML names must make it, and the
 * network must not fail; a chunk named only inside a script that the server
 * doesn't have holds nothing back (a stray name is no file).
 *
 * Old builds: a hashed file (/_next/static, a dictionary) stays while a page needs it:
 * a cached page, or the page a tab was opened with (each navigation's HTML is kept for
 * its tab, '/sw.js?served=<tab>', while the tab is open, and up to OPENING_MS before it
 * shows among the clients), since a tab of an old build may still load any chunk of it
 * (a feature opened for the first time, offline). Every other hashed file is deleted
 * (checked on later visits and page messages): an old build's once its tabs are closed,
 * what a replacement that failed brought in. While a tab whose page this worker didn't
 * serve is open (an older worker's), nothing is deleted. Storing a page (its files, then
 * its HTML) and tidying up run one at a time, so a tidy-up never comes in between.
 */
const VERSION = 'v2';
const PREFIX = 'json-viewer-';
const CACHE = PREFIX + VERSION;
const ORIGIN = self.location.origin;
const MATCH = { ignoreVary: true };
/** A tab's page (see the header), never served: the tab's id follows. */
const SERVED = ORIGIN + '/sw.js?served=';
/** How long a tab's page is kept before the tab shows among the clients (a navigation still opening). */
const OPENING_MS = 30 * 1000;
/** Older workers' record of retired files: dropped. */
const RETIRED = ORIGIN + '/sw.js?retired';
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
// A localized page's later dictionaries, named in its HTML (in the RSC payload).
const STRINGS_RE = /\/i18n\/[a-z]+-strings\.[a-z]{2}\.[0-9a-f]+\.json/g;
/** Files named by their content: never change, retired after deploys like /_next/static files. */
const isHashed = (path) => isStatic(path) || /^\/i18n\/[a-z]+-strings\./.test(path);
/** Language prefix of a localized page (/es, /pt/tools/…), or ''. */
const langHome = (path) => (/^\/[a-z]{2}(?=\/|$)/.exec(path) || [''])[0];
/** Huge mode's and the lazy features' dictionaries (huge-strings, schema-strings, flatten-strings: lib/i18n/translate.ts). */
const HUGE_STRINGS_RE = /^\/(?:_next\/static\/media|i18n)\/(?:huge|schema|flatten)-strings\.([a-z]{2})\./;
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

/** The later dictionaries a page's HTML names (its language's: see the header). */
const stringsIn = (html) => Array.from(new Set(html.match(STRINGS_RE) || [])).map((p) => ORIGIN + p);
/** Everything a page's HTML names: what tells one build of it from another. */
const namesOf = (html) => extractAssets(html).concat(stringsIn(html));

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
 * `strings`: its dictionaries too (with its chunks; with its HTML when it replaces a
 * copy: see storePage). `ok`: every file that had to make it is cached; `files`: the URLs found.
 */
async function pageFiles(cache, html, fetchMissing, deep = true, page = ORIGIN + '/', strings = deep) {
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
  const visits = extractAssets(html).map((u) => visit(u, isStatic(new URL(u).pathname)));
  // (Its dictionaries must make it: a page offline without them would be in English.)
  if (strings) stringsIn(html).forEach((u) => visits.push(visit(u, true)));
  const results = await Promise.all(visits);
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
 * Replacing a copy of another build: its dictionaries must be cached too (the copy there
 * keeps working offline until they are), and the files nothing needs any more are retired.
 */
async function storePage(cache, key, res) {
  if (!isHTML(res)) {
    await cache.put(key, res);
    return true;
  }
  return serially(async () => {
    const html = await res.clone().text();
    const old = await cache.match(key, MATCH);
    const oldHtml = old && isHTML(old) ? await old.text() : null;
    const same = oldHtml !== null && sameFiles(namesOf(oldHtml), namesOf(html));
    if (!same && !(await pageFiles(cache, html, true, false, typeof key === 'string' ? key : key.url, oldHtml !== null)).ok) return false;
    await cache.put(key, res);
    // (Another build's copy replaced: what only it needed can go.)
    if (oldHtml !== null && !same) await tidy(cache);
    return true;
  });
}

/** Cache `url` unless present (a page with its files; `page` false: a file, never stored as a page). Resolves false when it couldn't be. */
async function cacheIfMissing(cache, url, page = true) {
  if (await cache.match(url, MATCH)) return true;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!cacheable(res)) return false;
    if (page) return await storePage(cache, url, res);
    await cache.put(url, res);
    return true;
  } catch {
    return false;
  }
}

/** One at a time: storing a page, tidying up (see the header). Never nested. */
let queue = Promise.resolve();
const serially = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/** Tabs' pages being written (a tidy-up waits for them: see keepServed). */
const writing = new Set();

/**
 * Keeps the page a navigation (`event`) is answered with (`res`) for its tab, while the tab is open (see the
 * header). Written at once, not behind a page being stored: a tidy-up waits for it, so a tab opening from a copy
 * that is being replaced keeps that copy's files.
 */
function keepServed(event, cache, res, page) {
  const id = event.resultingClientId;
  if (!id || !res || !isHTML(res)) return;
  const copy = res.clone();
  const w = copy
    .text()
    .then((text) => cache.put(SERVED + encodeURIComponent(id), new Response(text, { headers: { 'content-type': 'text/html', 'x-page': page, 'x-at': String(Date.now()) } })))
    .catch(() => {});
  writing.add(w);
  w.then(() => writing.delete(w));
  event.waitUntil(w);
}

/**
 * Deletes the hashed files no page needs (see the header): not a cached page, not a tab's.
 * Tabs' pages go with their tabs. Run through `serially` only.
 */
async function tidy(cache) {
  await Promise.all(Array.from(writing));
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const live = new Set(tabs.map((c) => c.id));
  const known = new Set();
  const keys = await cache.keys();
  const keep = new Set();
  for (const k of keys) {
    if (k.url === RETIRED) {
      await cache.delete(k);
      continue;
    }
    const page = !k.url.startsWith(SERVED) && (isStatic(new URL(k.url).pathname) || FILE_RE.test(new URL(k.url).pathname)) ? null : await cache.match(k, MATCH);
    if (!page || !isHTML(page)) continue;
    let url = k.url;
    const text = await page.text();
    if (k.url.startsWith(SERVED)) {
      const id = decodeURIComponent(k.url.slice(SERVED.length));
      const seen = page.headers.get('x-seen') === '1';
      // (Gone: once it was seen among the clients, or OPENING_MS after its navigation if it never showed.)
      if (!live.has(id) && (seen || Date.now() - Number(page.headers.get('x-at') || 0) > OPENING_MS)) {
        await cache.delete(k);
        continue;
      }
      if (live.has(id) && !seen) await cache.put(k, new Response(text, { headers: { 'content-type': 'text/html', 'x-page': page.headers.get('x-page') || '', 'x-at': page.headers.get('x-at') || '0', 'x-seen': '1' } }));
      known.add(id);
      url = page.headers.get('x-page') || ORIGIN + '/';
    }
    (await pageFiles(cache, text, false, true, url)).files.forEach((u) => keep.add(u));
  }
  // (A tab whose page isn't known, an older worker's: what it may load isn't known either.)
  if (tabs.some((c) => !known.has(c.id))) return;
  await Promise.all(keys.filter((k) => isHashed(new URL(k.url).pathname) && !keep.has(k.url)).map((k) => cache.delete(k)));
}

/**
 * Fetch the app shell ('/'), cache its files (see the header), then swap it in.
 * The new HTML replaces the old one only once they are, so an offline load never
 * gets HTML pointing at chunks we don't have. After a deploy (the shell names
 * other hashed files) the old build's files are retired. `opening`: the tab
 * being opened from the old shell, when a visit to '/' asked for this.
 */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) return;
  const deployed = await serially(async () => {
    const html = await res.clone().text();
    const old = await cache.match('/', MATCH);
    const prev = old ? extractAssets(await old.text()) : null;
    const now = extractAssets(html);
    if (prev && sameFiles(prev, now)) {
      // The same build: its files came with it (pages post what they load); anything its HTML names that is missing, again.
      await Promise.all(now.map((u) => cacheIfMissing(cache, u, false)));
    } else if (!(await pageFiles(cache, html, true, false)).ok && prev) return false; // flaky network or a half-done deploy: keep the consistent old shell
    await cache.put('/', res);
    await tidy(cache);
    return !!prev && !prev.every((u) => now.indexOf(u) !== -1);
  });
  if (!deployed) return; // first install, same build, or not stored
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
        .then(() => serially(() => tidy(cache)))
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
  const key = url + ' ' + extractAssets(html).concat(stringsIn(html)).join(' ');
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
      const cache = caches.open(CACHE);
      const answer = cache.then(async (c) => {
        const res = (await c.match('/', MATCH)) || (await fetch(req));
        keepServed(event, c, res, ORIGIN + '/');
        return res;
      });
      event.respondWith(answer);
      event.waitUntil(answer.then(() => refreshShell()).catch(() => {}));
    } else {
      event.respondWith(networkFirst(event, req));
    }
  } else if (isHashed(url.pathname)) {
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
      if (cacheable(res)) {
        keepServed(event, cache, res, req.url);
        event.waitUntil(storePage(cache, req, res.clone()).catch(() => {}));
      }
      return res;
    },
    async () => {
      const home = langHome(new URL(req.url).pathname);
      const res = (await cache.match(req, MATCH)) || (home && (await cache.match(home, MATCH))) || (await cache.match('/', MATCH));
      // (Its tab runs that copy's build, an old one maybe: its files stay while it is open.)
      keepServed(event, cache, res, req.url);
      return res || Response.error();
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
