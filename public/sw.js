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
 * A localized page's dictionaries (huge mode's, the Schema view's, Flatten's:
 * /i18n/<name>-strings.<lang>.<hash>.json, named by their content) are named in its HTML,
 * its own language's only, and handled as its /_next/static files are: cached with it,
 * required, cache-first, retired after deploys. A /de visit so caches the German ones
 * and no other; English pages none. (Builds before them named huge mode's in a chunk,
 * /_next/static/media/huge-strings.<lang>.<hash>.json, every language's: followed for
 * the page's own language only.)
 *
 * Pages are replaced whole: new HTML ('/' or any other page) goes into the cache
 * only once its files are (a 200, stored), so an interrupted visit leaves the copy
 * that works. Every /_next/static file the HTML names must make it, and the
 * network must not fail; a chunk named only inside a script that the server
 * doesn't have holds nothing back (a stray name is no file).
 *
 * Deploys: when a cached page ('/' or any other) is replaced by a copy of another
 * build, the hashed files no cached page needs any more are retired, not deleted:
 * the files its old copy needed, and any other cached one no page needs that isn't
 * retired yet (what a tab loaded on its own: a page reached by client-side
 * navigation). Each such retirement is a generation, kept with the tabs open at
 * that moment, and those being opened from the cache: they may run the old build
 * and still load any chunk of it (a feature opened for the first time, offline).
 * A generation's files are deleted once all its tabs are closed (checked on later
 * visits and page messages), or RETIRE_MS after it, unless a cached page needs them
 * again. A tool page showing a new build also brings '/' and its language's home to
 * it, so a visitor who never opens '/' gets the same clean-up. The cache so holds
 * the current build, the builds its cached pages were saved with, and older builds
 * only while their tabs live. The record ('/sw.js?retired') is never served. Why no
 * tab loses a file it needs: see tidy().
 */
const VERSION = 'v2';
const PREFIX = 'json-viewer-';
const CACHE = PREFIX + VERSION;
const ORIGIN = self.location.origin;
const MATCH = { ignoreVary: true };
const RETIRED = ORIGIN + '/sw.js?retired';
/** Homes a page's new build couldn't bring along yet (see refreshHomes), never served either. */
const HOMES = ORIGIN + '/sw.js?homes';
const RETIRE_MS = 7 * 24 * 3600 * 1000;
/** Longer than a tab takes to show among the clients once its page is served (see opening). */
const OPENING_MS = 60 * 1000;
/**
 * The longest the worker waits on what it doesn't control: the list of tabs (CLIENTS_MS), and a download of
 * its own or the body of a page it stores (FETCH_MS). Past that it goes on without it, so every event's work,
 * and the queue of tidy-ups and page stores (see serially), comes to an end: the worker always gets idle.
 */
const CLIENTS_MS = 5 * 1000;
const FETCH_MS = 30 * 1000;
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
// A localized page's dictionaries, named in its HTML (in the RSC payload); named by their content.
const STRINGS_RE = /\/i18n\/[a-z]+-strings\.[a-z]{2}\.[0-9a-f]+\.json/g;
/** Files named by their content: /_next/static files and those dictionaries (see the header). */
const isHashed = (path) => isStatic(path) || /^\/i18n\/[a-z]+-strings\./.test(path);
/**
 * A URL as the cache matches it: without its fragment. (Cache keys can keep one: WebKit lists a worker's
 * script under the URL it was started with, Turbopack's bootstrap plus #params=…, which pages name without.)
 */
const bare = (url) => url.split('#')[0];

/** `promise`'s value, or `fallback` once `ms` have passed without one (the promise may never settle). */
function within(promise, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** fetch() for the worker's own downloads, never a page's request: given up after FETCH_MS, body included. */
function download(url, init) {
  if (typeof AbortController !== 'function') return fetch(url, init);
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), FETCH_MS);
  return fetch(url, Object.assign({}, init, { signal: ctl.signal }));
}

/**
 * The window clients (`all`: another worker's too), or null when the list doesn't come within CLIENTS_MS:
 * Firefox asks each tab's process for its state before answering, and a tab being closed or reloaded may
 * never reply. Nothing waits on that for longer.
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
        res = await download(url, { credentials: 'same-origin' });
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
  const results = await Promise.all(extractAssets(html).map((u) => visit(u, isHashed(new URL(u).pathname))));
  return { ok: results.indexOf(false) === -1, files };
}

/** Whether two pages name the same files (the same build of the same page). */
function sameFiles(a, b) {
  const set = new Set(a);
  return a.length === b.length && b.every((u) => set.has(u));
}

/**
 * Puts a page (`res`, a 200) into the cache once its files are; resolves false when they
 * couldn't be (the copy there stays), else { replaced: whether it took the place of another
 * build's copy }. A copy of the same build only gets fresher HTML. `fresh`: the tab that got
 * this copy from the network, if any (see tidy).
 */
async function storePage(cache, key, res, fresh) {
  if (!isHTML(res)) {
    await cache.put(key, res);
    return { replaced: false };
  }
  const page = typeof key === 'string' ? key : key.url;
  // (A body that stalls is given up: see FETCH_MS. A navigation's isn't one of the worker's downloads.)
  const html = await within(res.clone().text(), FETCH_MS, null);
  if (html === null) return false;
  const old = await cache.match(key, MATCH);
  const same = old && isHTML(old) && sameFiles(extractAssets(await old.text()), extractAssets(html));
  if (!same && !(await pageFiles(cache, html, true, false, page)).ok) return false;
  return serially(() => commit(cache, key, page, res, html, false, fresh));
}

/** Cache `url` unless present (a page with its files). Resolves false when it couldn't be. */
async function cacheIfMissing(cache, url) {
  if (await cache.match(url, MATCH)) return true;
  try {
    const res = await download(url, { credentials: 'same-origin' });
    return cacheable(res) && !!(await storePage(cache, url, res));
  } catch {
    return false;
  }
}

/**
 * One at a time: tidy-ups (each reads and writes the retired record) and the last step of storing
 * a page (see commit). Both read the cache and the list of tabs only (that one bounded: see
 * CLIENTS_MS), never the network: a stalled download never holds the queue up.
 */
let tidying = Promise.resolve();
const serially = (fn) => (tidying = tidying.then(fn, fn));

/**
 * The last step of storing a page (`res`, its HTML `html` already read, so storing it waits for no
 * network), run through `serially`: no tidy-up deletes a file between the check below and the page
 * going in. Unless the copy there is of the same build (or, with `partial`, there is none), every
 * file the HTML names that must make it is checked to be cached still: if one is gone, nothing is
 * stored (false) and the copy there stays. Then tidies up: an old copy of another build retires
 * the files it needed. Resolves { replaced, old: the old copy's HTML or null }.
 */
async function commit(cache, key, page, res, html, partial, fresh) {
  const prev = await cache.match(key, MATCH);
  const old = prev && isHTML(prev) ? await prev.text() : null;
  const files = extractAssets(html);
  const same = old !== null && sameFiles(extractAssets(old), files);
  if (!same && !(partial && !prev)) {
    const must = files.filter((u) => isHashed(new URL(u).pathname) && !otherStrings(u, page));
    const held = await Promise.all(must.map((u) => cache.match(u, MATCH)));
    if (held.indexOf(undefined) !== -1) return false;
  }
  // (The HTML already read, as a new Response: the queue never waits on a network stream.)
  await cache.put(key, new Response(html, { status: res.status, statusText: res.statusText, headers: res.headers }));
  const replaced = old !== null && !same;
  await tidy(cache, replaced ? { html: old, page, fresh } : null).catch(() => {});
  return { replaced, old };
}

/**
 * Tabs being opened from the cache: navigations that may get a cached page (an old build's,
 * perhaps), noted when they start and dropped once they get the network's page instead, or once
 * their tab shows among the clients, which it does a moment after its page is served (until then
 * clients.matchAll() misses it), or after OPENING_MS. Keyed by navigation; `id`: the id the tab
 * will have (resultingClientId), '' in browsers without one.
 */
const opening = new Map();
function noteOpening(id) {
  const key = {};
  const now = Date.now();
  opening.forEach((o, k) => now - o.at > OPENING_MS && opening.delete(k));
  opening.set(key, { id: id || '', at: now });
  return key;
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
  let unnamed = false;
  opening.forEach((o, key) => {
    if (ids.has(o.id) || now - o.at > OPENING_MS) opening.delete(key); // a client like any other from now on, or never one
    else if (o.id) ids.add(o.id);
    else unnamed = true;
  });
  return { ids, unnamed };
}

/** Among a generation's tabs: one being opened without an id when it began (see tidy). */
const UNSEEN = '?';

/** The record's generations of retired files, [{ urls, clients, at }] (see the header). `live`: the tabs open now, or null if unknown. */
function generations(rec, live) {
  if (!rec) return [];
  if (Array.isArray(rec.gens)) return rec.gens.filter((g) => g && Array.isArray(g.urls) && Array.isArray(g.clients) && typeof g.at === 'number');
  // An older worker's record: one list, given the tabs open at each deploy. The tabs open now join it,
  // as that worker's next deploy would have had them (they may run a build whose files it lists).
  if (Array.isArray(rec.urls) && Array.isArray(rec.clients)) return [{ urls: rec.urls.map(bare), clients: rec.clients.concat(live ? Array.from(live) : [UNSEEN]), at: rec.at || Date.now() }];
  return [];
}

/** Every file the cached pages need, from what the cache holds (`keys`: its keys), as bare URLs. */
async function needed(cache, keys) {
  const keep = new Set();
  for (const k of keys) {
    const path = new URL(k.url).pathname;
    if (isStatic(path) || FILE_RE.test(path) || k.url === RETIRED) continue;
    const page = await cache.match(k, MATCH);
    if (page && isHTML(page)) (await pageFiles(cache, await page.text(), false, true, k.url)).files.forEach((u) => keep.add(bare(u)));
  }
  return keep;
}

/**
 * Retires and deletes old builds' files (see the header). Run through `serially` only. `replaced`:
 * { html, page, fresh } when a cached page's copy was just replaced by another build's (`fresh`: the
 * tab that got the new copy from the network); `posted`: the files a tab (`from`, its id) reports it
 * loaded.
 *
 * Why no tab loses a file it needs (a tab runs its page's build, and may load any file of it later):
 *  - A tab open, or being opened from the cache, when its page's copy is replaced is among the tabs of
 *    the generation that copy's files go to (from an older generation too: tabs opened since then may
 *    have got that copy), so they stay while it is open. Not the tab that got the new copy from the
 *    network (it shows among the clients by then): it runs the new build.
 *  - A tab opened later got a cached page, whose files stay while it is cached and go to a generation
 *    with this tab among its tabs when it is replaced, or the network's page: the current build, whose
 *    files a later replacement retires with this tab among the tabs. A retired file such a tab reports
 *    it loaded leaves its generation (to be retired again by a later replacement).
 *  - Deleting checks the cached pages again: a file one needs again stays.
 * A tab being opened without an id stands as UNSEEN: OPENING_MS later, every tab open then takes its
 * place (it among them, if it is still open).
 */
async function tidy(cache, replaced, posted, from) {
  const saved = await cache.match(RETIRED);
  const text = saved ? await saved.text() : null;
  let rec = null;
  try {
    rec = text && JSON.parse(text);
  } catch {}
  if (!rec && !replaced) return;
  // Unknown tabs (their list didn't come: see windowTabs) change nothing about them, and delete nothing.
  const live = await liveTabs();
  const known = !!live;
  const ids = known ? live.ids : new Set();
  const unnamed = known && live.unnamed;
  const now = Date.now();
  const loaded = new Set((posted || []).map((u) => u.split('#')[0]));
  let gens = generations(rec, known ? ids : null);
  gens.forEach((g) => {
    const unseen = g.clients.indexOf(UNSEEN) !== -1;
    // A newer tab uses these (a tab while one is UNSEEN may be that one: it soon joins the tabs instead).
    if (!unseen && g.clients.indexOf(from) === -1) g.urls = g.urls.filter((u) => !loaded.has(u));
    if (!known) return;
    if (unseen && now - g.at >= OPENING_MS) g.clients = g.clients.concat(Array.from(ids));
    g.clients = g.clients.filter((id) => ids.has(id) || (id === UNSEEN && now - g.at < OPENING_MS)); // closed tabs go
  });
  let keep = null;
  if (replaced) {
    const keys = await cache.keys();
    keep = await needed(cache, keys);
    // (Bare URLs throughout: a key is compared without its fragment, as the cache matches it.)
    const cached = new Set(keys.map((k) => bare(k.url)));
    const freed = new Set();
    (await pageFiles(cache, replaced.html, false, true, replaced.page)).files.forEach((u) => cached.has(bare(u)) && !keep.has(bare(u)) && freed.add(bare(u)));
    const held = new Set();
    gens.forEach((g) => {
      g.urls = g.urls.filter((u) => !freed.has(u));
      g.urls.forEach((u) => held.add(u));
    });
    const urls = Array.from(cached).filter((u) => isHashed(new URL(u).pathname) && !keep.has(u) && !held.has(u));
    // (Tabs unknown: UNSEEN stands for all of them, the ones open OPENING_MS later taking its place.)
    const clients = known ? Array.from(ids).filter((id) => id !== replaced.fresh) : [];
    if (urls.length) gens.push({ urls, clients: clients.concat(unnamed || !known ? [UNSEEN] : []), at: now });
  }
  const done = known ? gens.filter((g) => !g.clients.length || now - g.at >= RETIRE_MS) : [];
  if (done.length) {
    if (!keep) keep = await needed(cache, await cache.keys());
    await Promise.all([].concat(...done.map((g) => g.urls)).filter((u) => !keep.has(u)).map((u) => cache.delete(u)));
  }
  gens = gens.filter((g) => done.indexOf(g) === -1 && g.urls.length);
  if (!gens.length) {
    if (saved) await cache.delete(RETIRED);
    return;
  }
  // (Also as one list, the record of workers before generations: one still running, or brought back, reads that.
  // Without a generation one of whose tabs is UNSEEN: such a worker knows no UNSEEN, takes it for a closed tab and
  // would delete what it guards. Those files stay, should one come back, until this one tidies up again.)
  const legacy = gens.filter((g) => g.clients.indexOf(UNSEEN) === -1);
  const all = (k) => [].concat(...legacy.map((g) => g[k]));
  const json = JSON.stringify({ gens, urls: all('urls'), clients: Array.from(new Set(all('clients'))), at: legacy.length ? Math.max(...legacy.map((g) => g.at)) : now });
  if (json !== text) await cache.put(RETIRED, new Response(json, { headers: { 'content-type': 'application/json' } }));
}

/**
 * Fetch the app shell ('/'), cache its files (see the header), then swap it in.
 * The new HTML replaces the old one only once they are, so an offline load never
 * gets HTML pointing at chunks we don't have. After a deploy (the shell names
 * other hashed files) the old build's files are retired (see commit).
 */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await download('/', { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) return;
  const html = await res.clone().text();
  const old = await cache.match('/', MATCH);
  const prev = old ? extractAssets(await old.text()) : null;
  const now = extractAssets(html);
  if (prev && sameFiles(prev, now)) {
    // The same build: its files came with it (pages post what they load); anything its HTML names that is missing, again.
    await Promise.all(now.map((u) => cacheIfMissing(cache, u)));
  } else if (!(await pageFiles(cache, html, true, false)).ok && prev) return; // flaky network or a half-done deploy: keep the consistent old shell
  // (With no copy yet, even a partial one: better than none offline, and the page posts the rest.)
  const done = await serially(() => commit(cache, '/', ORIGIN + '/', res, html, true));
  if (!done || !done.old || extractAssets(done.old).every((u) => now.indexOf(u) !== -1)) return; // not stored, first install, or same build
  // A new deploy is cached and ready: let open tabs offer a reload.
  const tabs = await windowTabs(false);
  if (tabs) tabs.forEach((c) => c.postMessage({ type: 'updated' }));
}

/**
 * After a page (`url`) was replaced by a new build's copy (from the network, for the tab `fresh`): '/'
 * and the page's language home, when cached, are brought to the network's copy too (stored whole, see
 * storePage). Unvisited pages fall back to them offline, and their old build can go although this
 * visitor may never open them again. A home that couldn't be (a network error, a 503, a file missing)
 * is noted (HOMES) and tried again after the next page from the network, of whichever build.
 */
async function refreshHomes(cache, url, fresh) {
  const path = new URL(url).pathname;
  const noted = await cache.match(HOMES);
  const due = noted ? await noted.json().catch(() => []) : [];
  const homes = ['/', langHome(path)].concat(due).filter((p, i, all) => typeof p === 'string' && p && p !== path && all.indexOf(p) === i);
  const failed = [];
  await Promise.all(
    homes.map(async (p) => {
      if (!(await cache.match(p, MATCH))) return;
      try {
        const res = await download(p, { cache: 'no-cache', credentials: 'same-origin' });
        if (cacheable(res) && (await storePage(cache, ORIGIN + p, res, fresh))) return;
      } catch {}
      failed.push(p);
    }),
  );
  if (failed.length) await cache.put(HOMES, new Response(JSON.stringify(failed), { headers: { 'content-type': 'application/json' } }));
  else if (noted) await cache.delete(HOMES);
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
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([
        // At once, not after the downloads below (a stalled one never holds it up): tabs of an old build may
        // have closed since, and their files can go; what this tab loaded stays (see tidy).
        serially(() => tidy(cache, null, urls, from)).catch(() => {}),
        Promise.all(urls.map((u) => cacheIfMissing(cache, u)))
          // The page has settled: now the chunks its pages' scripts can load later (see the header).
          .then(() => Promise.all(urls.map((u) => followPage(cache, u))))
          .catch(() => {}),
      ]),
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
  if (req.cache === 'no-store') return;
  const url = new URL(req.url);
  if (url.origin !== ORIGIN || bypass(url, req.headers)) return;

  if (req.mode === 'navigate') {
    // The tab may get an old build from the cache: one being opened (see opening) until it gets the network's page.
    const tab = noteOpening(event.resultingClientId);
    if (url.pathname === '/') {
      // Stale-while-revalidate the shell; query strings (utm_*, etc.) are ignored.
      const hit = cachedCopy('/');
      event.respondWith(
        hit.then((res) => {
          if (res) return res;
          opening.delete(tab);
          return fetch(req);
        }),
      );
      event.waitUntil(hit.then(() => refreshShell()).catch(() => {}));
    } else {
      event.respondWith(networkFirst(event, req, tab));
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

/** `tab`: the navigation's entry among the tabs being opened (see opening). */
function networkFirst(event, req, tab) {
  return fetch(req).then(
    (res) => {
      opening.delete(tab); // the network's page: the current build
      // Kept with its files only (see the header): until they are, the cached copy stays. A new build: the homes
      // follow (also those an earlier try left behind: see refreshHomes).
      const fresh = event.resultingClientId;
      if (cacheable(res)) {
        const copy = res.clone();
        const homes = async (cache, r) => r && (r.replaced || (await cache.match(HOMES))) && refreshHomes(cache, req.url, fresh);
        event.waitUntil(caches.open(CACHE).then((cache) => storePage(cache, req, copy, fresh).then((r) => homes(cache, r))).catch(() => {}));
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
  // The network's answer goes to the page as soon as its headers come; storing it (its body) is bounded on its own.
  const net = fetch(req).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      try {
        event.waitUntil(within(caches.open(CACHE).then((c) => c.put(req, copy)), FETCH_MS).catch(() => {}));
      } catch {} // (the event is over: a cached copy answered, and the headers came past FETCH_MS)
    }
    return res;
  });
  event.waitUntil(within(net, FETCH_MS).catch(() => {}));
  return hit || net;
}
