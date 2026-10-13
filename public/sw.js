/* JSON Viewer & Formatter: offline-first service worker (hand-written, no deps, ES2017).
 *
 *  '/' navigations      stale-while-revalidate (instant load, also offline)
 *  other navigations    network-first, then cache, then the cached '/'
 *  /_next/static/*      cache-first (content-hashed, immutable)
 *  other same-origin    stale-while-revalidate
 *  never touched        cross-origin, non-GET, /_vercel/* (analytics), RSC requests
 */
const VERSION = 'v1';
const PREFIX = 'json-viewer-';
const CACHE = PREFIX + VERSION;
const ORIGIN = self.location.origin;
const MATCH = { ignoreVary: true };

// Hashed assets appear in tags *and* inside escaped inline RSC payload strings.
const STATIC_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;
// Root-relative href/src attributes (icons, manifest, preloads).
const ATTR_RE = /\s(?:href|src)="(\/(?!\/)[^"]*)"/g;
const FILE_RE = /\.(?:m?js|css|json|webmanifest|ico|png|svg|jpe?g|webp|avif|gif|woff2?)(?:\?.*)?$/i;

const isStatic = (path) => path.startsWith('/_next/static/');

/** Requests the SW must leave alone (analytics, RSC/flight data, the SW itself). */
function bypass(url, headers) {
  return (
    url.pathname.startsWith('/_vercel/') ||
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

/** Cache `url` unless present. Resolves false only on a network failure. */
async function cacheIfMissing(cache, url) {
  if (await cache.match(url, MATCH)) return true;
  return fetch(url, { credentials: 'same-origin' }).then(
    (res) => (cacheable(res) ? cache.put(url, res).then(() => true, () => true) : true),
    () => false,
  );
}

/**
 * Fetch the app shell ('/'), cache everything it references, then swap it in.
 * The new HTML replaces the old one only once all its assets are cached, so an
 * offline load never gets HTML pointing at chunks we don't have. After a deploy
 * (hashed asset set changed) stale /_next/static entries are pruned.
 */
async function refreshShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) return;
  const assets = extractAssets(await res.clone().text());
  const old = await cache.match('/', MATCH);
  const prev = old ? extractAssets(await old.text()) : null;
  const results = await Promise.all(assets.map((u) => cacheIfMissing(cache, u)));
  if (prev && results.indexOf(false) !== -1) return; // flaky network: keep the consistent old shell
  await cache.put('/', res);
  const keep = new Set(assets);
  if (!prev || prev.every((u) => keep.has(u))) return; // first install, or same build
  const keys = await cache.keys();
  await Promise.all(
    keys.filter((k) => isStatic(new URL(k.url).pathname) && !keep.has(k.url)).map((k) => cache.delete(k)),
  );
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
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cacheIfMissing(cache, u)))));
});

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
      event.waitUntil(hit.then(() => refreshShell()).catch(() => {}));
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
      if (cacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    },
    async () => (await cache.match(req, MATCH)) || (await cache.match('/', MATCH)) || Response.error(),
  );
}

async function cacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

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
