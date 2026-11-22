// Helpers for the platform suites (privacy, offline, WebMCP). Not a suite: the runner skips files starting with _.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { ensureBuild, freePort, serve } from '../../lib/build.mjs';
import { ROOT } from '../../lib/env.mjs';
import { ensureMock, eventsIn, TAG_HEADER } from '../../lib/posthog-mock.mjs';
import { test as registerTest } from '../../lib/api.mjs';

export { eventsIn, snapshotsIn } from '../../lib/posthog-mock.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const POLL = { polling: 25 };
const budgets = new WeakMap();
export const budget = (page, ms) => budgets.get(page)?.(ms) ?? ms;

/** Apply the runner's busy-machine budget to page and condition waits. */
export function test(name, opts, fn) {
  if (typeof opts === 'function') [fn, opts] = [opts, {}];
  registerTest(name, opts, async (t) => {
    t.platformConsoleErrors = [];
    /** Requests a page cancelled itself (it navigated away while they loaded): see checkErrors in offline.mjs. */
    t.platformAborted = new Set();
    const prepare = (page) => {
      budgets.set(page, t.budget);
      page.setDefaultTimeout(t.budget(15_000));
      page.setDefaultNavigationTimeout(t.budget(30_000));
      page.on('response', (r) => {
        if (r.status() >= 400) t.log(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
      });
      page.on('requestfailed', (r) => {
        const error = r.failure()?.errorText;
        if (/NS_BINDING_ABORTED|net::ERR_ABORTED|cancelled/i.test(error || '')) t.platformAborted.add(r.url());
        t.log(`request failed ${r.url()}: ${error}`);
      });
      // Firefox's console text can be only "Error" for a rejected chunk import.
      // Read its actual Error argument so it can be classified without ignoring
      // unrelated errors that happen to have the same console label.
      page.on('console', (m) => {
        if (m.type() !== 'error' || m.text() !== 'Error' || /_vercel\/|favicon/.test(m.location()?.url || '')) return;
        t.platformConsoleErrors.push(Promise.all(m.args().map((arg) => arg.evaluate((v) =>
          v && typeof v.message === 'string' && v.message ? `${v.name || 'Error'}: ${v.message}` : null,
        ).catch(() => null))).then((parts) => parts.filter(Boolean).join(' | ') || 'Error'));
      });
    };
    prepare(t.page);
    t.context.on('page', prepare);
    const newPage = t.newPage;
    t.newPage = async (opts) => {
      const p = await newPage(opts);
      prepare(p.page);
      p.context.on('page', prepare);
      return p;
    };
    await fn(t);
  });
}

/** Poll an asynchronous condition. Playwright 1.64's waitForFunction treats a Promise as truthy. */
export async function until(read, { timeout = 30_000, what = 'condition' } = {}) {
  const end = performance.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (performance.now() >= end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ══ Privacy: PostHog against the mock ════════════════════════════════════════════════════════════

/** A desktop Chrome: PostHog drops events from browsers that say "HeadlessChrome". */
export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Test options for the privacy suites: the build whose PostHog talks to the mock, and a person's user agent. */
export const ANALYTICS = { variant: 'posthog-mock', engines: ['chromium'], launch: { channel: 'chromium' }, context: { userAgent: UA } };

const distOf = (dir) => [dir && join(dir, 'node_modules/posthog-js/dist'), join(ROOT, 'node_modules/posthog-js/dist')].find((d) => d && existsSync(d));

/** Runs in every page: PostHog must treat the browser as a person's, and load on this host (the 'debug' choice). */
const PERSON = ({ pref, gpc, ua }) => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  // Chromium restores its protocol UA override before pagehide. Pin the JS value
  // too, or PostHog suddenly sees HeadlessChrome and drops the unload events.
  Object.defineProperty(navigator, 'userAgent', { get: () => ua });
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  if (gpc) Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
  try {
    // (Not again once a test turned analytics off: the next pages must keep that choice.)
    if (pref && !sessionStorage.getItem('harness-optout')) localStorage.setItem('jf:analytics', pref);
  } catch {}
};

/**
 * Prepares a browser context for analytics checks: PostHog takes it for a person's browser, and every
 * request it makes carries a tag the mock files it under. `pref` is the 'jf:analytics' choice ('debug'
 * loads PostHog on this host, 'off' is the privacy page's switch, null leaves it unset).
 * Returns { mock, tag, requests(since), events(since), waitEvent(pred, opts) }.
 */
export async function analytics(t, { context = t.context, pref = 'debug', gpc = false, name = 'page' } = {}) {
  const mock = await ensureMock({ dist: distOf(t.target.dir) });
  const tag = `${name}-${randomBytes(6).toString('hex')}`;
  await context.setExtraHTTPHeaders({ [TAG_HEADER]: tag });
  await context.addInitScript(PERSON, { pref, gpc, ua: UA });
  t.log(`mock tag ${tag}`);
  return {
    mock,
    tag,
    requests: (since = 0) => mock.requests(tag, since),
    events: async (since = 0) => eventsIn(await mock.requests(tag, since)),
    /** Waits for an event matching `pred` (an event name or a function) at the mock. */
    waitEvent: (pred, { since = 0, timeout = 30_000 } = {}) => {
      const match = typeof pred === 'string' ? (e) => e.event === pred : pred;
      return mock.waitFor(tag, (rs) => eventsIn(rs).find(match), { since, timeout: t.budget(timeout), what: typeof pred === 'string' ? pred : 'an event' });
    },
  };
}

/**
 * Waits until PostHog has loaded on this page (it does once the visitor has paused and the browser is idle,
 * at least 3 s after load) and its recorder runs. The 'debug' choice exposes it as window.posthog.
 */
export async function waitPostHog(page, { recording = true, timeout = 60_000 } = {}) {
  await page.waitForFunction(() => !!window.posthog, null, { ...POLL, timeout: budget(page, timeout) });
  if (recording) await page.waitForFunction(() => window.posthog.sessionRecordingStarted?.() === true, null, { ...POLL, timeout: budget(page, timeout) });
}

let flushes = 0;
/**
 * Makes sure the recording reached the mock up to now: a moment of interaction (the recorder holds a fresh
 * recording until there is one), then a hidden element whose id the recorder must deliver.
 */
export async function flushRecording(page, a, { timeout = 30_000 } = {}) {
  const id = `harness-flush-${a.tag}-${++flushes}`;
  await page.mouse.move(2, 300 + (flushes % 7));
  await page.evaluate((id) => {
    const i = document.createElement('i');
    i.id = id;
    i.hidden = true;
    document.body.append(i);
  }, id);
  await a.mock.waitFor(a.tag, (rs) => rs.some((r) => r.path.startsWith('/s') && r.body.includes(id)), { timeout: budget(page, timeout), what: 'the recording to catch up' });
}

/**
 * Ends a page visit so everything it holds reaches the mock: the recording first (a page's last recording
 * goes out as a beacon on unload, which drops anything over 64 KB), then its queued events, which leave
 * with the $pageleave on unload.
 */
export async function leavePage(page, a) {
  await flushRecording(page, a);
  const before = (await a.events()).filter((e) => e.event === '$pageleave').length;
  await page.goto('about:blank');
  await a.mock.waitFor(a.tag, (rs) => eventsIn(rs).filter((e) => e.event === '$pageleave').length > before, { timeout: budget(page, 30_000), what: 'the $pageleave of the page left' });
}

/** Marker strings for a test: TKCANARY<NAME><run>, so no marker is a substring of another and runs don't mix. */
export function markers(names) {
  const run = Array.from(randomBytes(6), (b) => String.fromCharCode(65 + (b % 26))).join('');
  return Object.fromEntries(names.map((n) => [n, `TKCANARY${n.toUpperCase()}${run}`]));
}

/**
 * The verdict: no marker (and no `extra` needle, such as a share link's fragment) is in any request the mock
 * got, from any test. One check per marker; hits list where the marker was.
 */
export async function checkNoLeaks(t, a, K, extra = {}) {
  const all = { ...K, ...extra };
  const forms = Object.values(K).flatMap((k) => [k.toLowerCase(), k[0] + k.slice(1).toLowerCase()]);
  const hits = await a.mock.search(...Object.values(all), ...forms, 'TKCANARY', 'Tkcanary', 'tkcanary');
  for (const [what, needle] of Object.entries(all)) {
    const mine = hits.filter((h) => h.needle.toLowerCase() === needle.toLowerCase());
    t.check(!mine.length, `${what} (${what in K ? 'marker' : 'needle'}) never reaches PostHog`, mine.slice(0, 5).map((h) => `${h.method} ${h.path} @${h.at}`));
  }
  // A marker PostHog changed on the way (cut, re-cased…): any TKCANARY in this test's own requests.
  const knownMarkers = new Set(Object.values(all).map((k) => k.toLowerCase()));
  const reqs = await a.requests();
  const hay = (r) => r.url + r.body + JSON.stringify(r.headers);
  const odd = reqs.filter((r) => /TKCANARY/i.test(hay(r)) && ![...knownMarkers].some((k) => hay(r).toLowerCase().includes(k)));
  t.check(!odd.length, 'no altered marker reaches PostHog', odd.slice(0, 3).map((r) => `${r.method} ${r.path}: ${(r.url + r.body).match(/.{0,40}TKCANARY.{0,40}/)?.[0]}`));
}

/** Classes that only exist inside PRIVATE boxes (checker messages, positions, sizes, counts): never in a recording. */
const INSIDE_PRIVATE = ['lb-check-err', 'lb-check-ok', 'lb-check-warn', 'st-msg', 'st-link', 'sz-raw', 'sz-min', 'stats muted', 'gx-info'];

/** All recording payloads of this test as one string. */
export async function recordingText(a) {
  return (await a.requests())
    .filter((r) => r.path.startsWith('/s'))
    .map((r) => r.body)
    .join('\n');
}

export function checkPrivateBoxes(t, snap) {
  const outside = snap.replace(/"class":"[^"]*ph-no-capture[^"]*"/g, '');
  const found = INSIDE_PRIVATE.filter((cls) => new RegExp(`"class":"[^"]*\\b${cls}\\b`).test(outside));
  t.check(!found.length, 'nothing from inside a private box is in the recording', found.map((c) => '.' + c));
}

/** Tooltips that state facts about the document ("34% smaller", "1 type change") must stay out of recordings. */
export function checkTooltipFacts(t, snap) {
  for (const [what, re] of [['the Minify / size tooltip', /\d+% smaller/], ['a Compare count tooltip', /\d+ type changes?\)/]]) {
    t.check(!re.test(snap), `${what} is not in the recording`, snap.match(re)?.[0]);
  }
}

/** Requests the page sends to PostHog's relay, counted in the browser (beacons included): { started, inFlight, idle() }. */
export function watchRelay(context) {
  const s = { started: [], inFlight: new Set() };
  const mine = (r) => r.url().includes('/relay/');
  context.on('request', (r) => {
    if (!mine(r)) return;
    s.started.push(`${r.method()} ${new URL(r.url()).pathname}`);
    s.inFlight.add(r);
  });
  const done = (r) => s.inFlight.delete(r);
  context.on('requestfinished', done);
  context.on('requestfailed', done);
  s.idle = async (timeout = 30_000) => {
    const t0 = Date.now();
    while (s.inFlight.size) {
      if (Date.now() - t0 > timeout) throw new Error(`relay requests still in flight after ${timeout} ms`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return s;
}

/** Fakes a tab switch (headless pages are always visible): document.visibilityState and a visibilitychange event. */
export const setVisibility = (page, state) =>
  page.evaluate((v) => {
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => v, configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => v === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

/** A JSON file at `https://remote.harness.invalid/<name>` for Load from URL and ?url= links (served by the context). */
export const REMOTE = 'https://remote.harness.invalid';
export async function remoteJson(context, docs) {
  await context.route(`${REMOTE}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const body = docs[name];
    route.fulfill(body === undefined ? { status: 404, body: 'not found' } : { status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body });
  });
}

// ══ The JSON tool, as a visitor uses it ═════════════════════════════════════════════════════════

/** Waits until the visible tooltip shows text matching `re`; returns [text, className]. */
export async function waitTip(page, re, { timeout = 10_000 } = {}) {
  const h = await page.waitForFunction(
    ([src, flags]) => {
      const tip = document.querySelector('.tip');
      return tip && tip.classList.contains('in') && new RegExp(src, flags).test(tip.textContent) && [tip.textContent, tip.className];
    },
    [re.source, re.flags],
    { ...POLL, timeout: budget(page, timeout) },
  );
  return h.jsonValue();
}

/** Waits until the visible element matching `sel` exists (and, with `text`, its text matches). */
export async function waitVisible(page, sel, { text, timeout = 15_000 } = {}) {
  await page.waitForFunction(
    ([s, src, flags]) => {
      const e = window.__vis(s);
      return e && (!src || new RegExp(src, flags).test(e.textContent));
    },
    [sel, text ? text.source : null, text?.flags],
    { ...POLL, timeout: budget(page, timeout) },
  );
}

export { MOD, POLL };

/** Dispatches a paste after selecting the visible editor in the same page turn. */
export async function pasteSelected(page, text, which = 'input') {
  await page.evaluate(
    ([t, w]) => {
      const ta = window.__vis(`#${w}`);
      ta.focus();
      ta.select();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
      if (ta.dispatchEvent(ev)) {
        ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: t, bubbles: true }));
      }
    },
    [text, which],
  );
}

// ══ Offline: the service worker against a proxy that can deploy, 404 and go offline ══════════════

const servers = new Map();
/** A server of a build variant of the working tree, started once per run (the runner serves the test's own). */
export function serveVariant(variant) {
  if (!servers.has(variant))
    servers.set(
      variant,
      (async () => {
        const b = await ensureBuild({ variant, log: () => {} });
        return serve(b.dir);
      })().catch((e) => {
        servers.delete(variant);
        throw e;
      }),
    );
  return servers.get(variant);
}

/**
 * The site the browser sees, in front of builds `upstreams` ({ A: base, A2: base }): it forwards to one at
 * a time (`deploy('A2')`), can answer 404 for single paths (`fail`), and goes offline by destroying every
 * connection (the service worker's own fetches fail too, unlike context.setOffline in some engines).
 * It also adds a probe to /sw.js that counts the worker's unfinished waitUntil() work, so tests can wait
 * for the worker to be idle instead of for time (`swIdle`).
 */
export async function startProxy(upstreams, { initial = 'A', workerVersions = false, legacyWorker } = {}) {
  const port = await freePort();
  const net = { up: initial, offline: false, fail: new Set(), sockets: new Set(), inFlight: 0, requests: [], workers: [] };
  const server = http.createServer((req, res) => {
    if (net.offline) return req.socket.destroy();
    const path = req.url.split('?')[0];
    net.requests.push(path);
    if (net.fail.has(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const upstream = net.up;
    const target = new URL(upstreams[upstream]);
    const sw = path === '/sw.js';
    const headers = { ...req.headers, host: target.host };
    if (sw) for (const h of ['accept-encoding', 'if-none-match', 'if-modified-since']) delete headers[h];
    net.inFlight++;
    const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (r) => {
      if (sw && r.statusCode === 200) {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          const version = workerVersions ? upstream : 'stable';
          const source = upstream === 'BASE' && legacyWorker ? legacyWorker : Buffer.concat(chunks).toString('utf8');
          const body = `self.__harnessVersion = ${JSON.stringify(version)};\n` + SW_PROBE + source;
          net.workers.push({ upstream, version, bytes: Buffer.byteLength(body) });
          const h = { ...r.headers, 'content-length': Buffer.byteLength(body) };
          delete h['content-encoding'];
          delete h['transfer-encoding'];
          delete h.etag;
          delete h['last-modified'];
          h['cache-control'] = 'no-store';
          res.writeHead(200, h);
          res.end(body);
          net.inFlight--;
        });
        return;
      }
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      r.on('end', () => net.inFlight--);
      r.on('error', () => net.inFlight--);
    });
    up.on('error', () => {
      net.inFlight--;
      req.socket.destroy();
    });
    req.pipe(up);
  });
  server.on('connection', (s) => {
    net.sockets.add(s);
    s.on('close', () => net.sockets.delete(s));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    // localhost (not 127.0.0.1): a secure context for service workers in every engine.
    origin: `http://localhost:${port}`,
    net,
    deploy(up) {
      net.up = up;
    },
    offline(off = true) {
      net.offline = off;
      if (off) for (const s of net.sockets) s.destroy();
    },
    close() {
      for (const s of net.sockets) s.destroy();
      server.close();
    },
  };
}

/**
 * Prepended to /sw.js by the proxy: counts the worker's unfinished waitUntil() promises and answers
 * { type: 'harness-idle' } on a MessageChannel with the count. It only observes; the worker is unchanged.
 */
const SW_PROBE = `(() => {
  let pending = 0;
  const wait = ExtendableEvent.prototype.waitUntil;
  ExtendableEvent.prototype.waitUntil = function (p) {
    pending++;
    Promise.resolve(p).then(() => pending--, () => pending--);
    return wait.call(this, p);
  };
  self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'harness-idle' && e.ports[0]) e.ports[0].postMessage(pending);
    if (e.data && e.data.type === 'harness-version' && e.ports[0]) e.ports[0].postMessage(self.__harnessVersion);
  });
})();
`;

/**
 * Waits until the worker controlling `page` has no unfinished work (install, refreshes, caching what pages
 * posted) and, with `posted`, until this page has posted its 'cache' message (after its warm-up).
 */
export async function swIdle(page, { posted = false, timeout = 60_000 } = {}) {
  await until(() => page.evaluate(
    async (posted) => {
      const sw = navigator.serviceWorker?.controller;
      if (!sw || (posted && !window.__swPosted)) return false;
      const n = await new Promise((resolve) => {
        const ch = new MessageChannel();
        const timer = setTimeout(() => { ch.port1.close(); resolve(-1); }, 1000);
        ch.port1.onmessage = (e) => { clearTimeout(timer); ch.port1.close(); resolve(e.data); };
        sw.postMessage({ type: 'harness-idle' }, [ch.port2]);
      });
      return n === 0;
    },
    posted,
  ), { timeout: budget(page, timeout), what: 'the service worker to finish its cache work' });
}

/** Wait for the worker installed after a proxy deploy, rather than a registration's old active worker. */
export async function swVersion(page, version, { timeout = 30_000, active = false, candidate = false } = {}) {
  try { await until(() => page.evaluate(async ([version, active, candidate]) => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const workers = active
      ? [reg?.active, reg?.waiting, reg?.installing].filter((sw, i, all) => sw && all.indexOf(sw) === i)
      : [navigator.serviceWorker?.controller];
    window.__harnessWorkerState = { active: reg?.active?.state, installing: reg?.installing?.state, waiting: reg?.waiting?.state, controller: navigator.serviceWorker?.controller?.state };
    for (const sw of workers) {
      if (!sw || (active && !candidate && sw.state !== 'activated') || sw.state === 'redundant') continue;
      const matches = await new Promise((resolve) => {
        const ch = new MessageChannel();
        const timer = setTimeout(() => { ch.port1.close(); resolve(false); }, 1000);
        ch.port1.onmessage = (e) => { clearTimeout(timer); ch.port1.close(); window.__harnessWorkerState.version = e.data; resolve(e.data === version); };
        sw.postMessage({ type: 'harness-version' }, [ch.port2]);
      });
      if (matches) return true;
    }
    // A page's own register() can coalesce the explicit update check. Retry that
    // check only when no replacement is installing or waiting.
    if (active && reg && !reg.installing && !reg.waiting) await reg.update();
    return false;
  }, [version, active, candidate]), { timeout: budget(page, timeout), what: `service worker ${version}${active ? candidate ? ' to install' : ' to activate' : ' to control the page'}` });
  } catch (e) {
    const state = await page.evaluate(() => window.__harnessWorkerState).catch(() => null);
    throw new Error(`${e.message}; registration ${JSON.stringify(state)}`);
  }
}

/** In every page of an offline test: notes when the page posts its 'cache' message to the worker. */
export const WATCH_POSTS = () => {
  if (typeof ServiceWorker === 'undefined') return; // about:blank and download frames
  const post = ServiceWorker.prototype.postMessage;
  ServiceWorker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.type === 'cache') window.__swPosted = (window.__swPosted || 0) + 1;
    return post.call(this, msg, ...rest);
  };
};

export const CACHE_NAME = 'json-viewer-v2';

export const cacheKeys = (page) =>
  page.evaluate(async (name) => {
    const c = await caches.open(name);
    return (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  }, CACHE_NAME);

export const cachedText = (page, path) =>
  page.evaluate(
    async ([name, p]) => {
      const c = await caches.open(name);
      const r = await c.match(p, { ignoreVary: true });
      return r ? r.text() : null;
    },
    [CACHE_NAME, path],
  );

/** Waits until the cache holds every path (true) or `timeout` passes (false). */
export async function waitInCache(page, paths, { timeout = 30_000 } = {}) {
  return until(() => page.evaluate(
      async ([name, ps]) => {
        const c = await caches.open(name);
        const have = new Set((await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search));
        return ps.every((p) => have.has(p));
      },
      [CACHE_NAME, paths],
    ), { timeout: budget(page, timeout), what: 'paths to be cached' })
    .then(
      () => true,
      () => false,
    );
}

/** The paths in `paths` the cache doesn't hold. */
export async function missingFromCache(page, paths) {
  const keys = new Set(await cacheKeys(page));
  return paths.filter((p) => !keys.has(p));
}

/**
 * The /_next/static files of a page of a build, as the service worker follows them: what the HTML names
 * (`named`), then chunk names inside scripts and files named by stylesheets (`all`, existing files only).
 */
const closures = new Map();
export function closure(base, page = '/') {
  const key = base + page;
  if (!closures.has(key)) closures.set(key, buildClosure(base, page));
  return closures.get(key);
}
async function buildClosure(base, page) {
  const seen = new Set();
  const queue = [];
  const add = (p) => !seen.has(p) && (seen.add(p), queue.push(p));
  const html = await (await fetch(base + page)).text();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) add(m[0]);
  const named = new Set(seen);
  while (queue.length) {
    const p = queue.shift();
    if (!/\.(js|css)$/.test(p)) continue;
    const res = await fetch(base + p);
    if (!res.ok) continue;
    const text = await res.text();
    if (p.endsWith('.css')) {
      for (const m of text.matchAll(/url\(\s*["']?([^"')\s]+)/g)) {
        const u = new URL(m[1], 'http://x' + p);
        if (u.origin === 'http://x' && u.pathname.startsWith('/_next/static/')) add(u.pathname);
      }
    } else for (const m of text.matchAll(/["'](static\/(?:chunks|media)\/[^"'\\\s]+)["']/g)) add('/_next/' + m[1]);
  }
  // (Names inside scripts that aren't files: the worker skips them too.)
  const real = [];
  await Promise.all(
    [...seen].map(async (p) => {
      if ((await fetch(base + p, { method: 'HEAD' })).ok) real.push(p);
    }),
  );
  return { named: [...named], all: real.sort() };
}

/** Paths of `paths` that `page` can't fetch now (through its worker, when offline). */
export const unreachable = (page, paths) =>
  page.evaluate(async (ps) => {
    const missing = [];
    await Promise.all(
      ps.map(async (p) => {
        try {
          if (!(await fetch(p)).ok) missing.push(p);
        } catch {
          missing.push(p);
        }
      }),
    );
    return missing;
  }, paths);

/** Opens `path` on `origin`: { ok, lang, tool } (tool: the JSON tool's editor is there). */
export async function opened(page, origin, path) {
  const res = await page.goto(origin + path, { waitUntil: 'load', timeout: 30_000 }).catch((e) => String(e));
  const lang = await page.evaluate(() => document.documentElement.lang).catch(() => '');
  const tool = await page.locator('#input').count().catch(() => 0);
  return { ok: typeof res !== 'string', lang, tool, error: typeof res === 'string' ? res.split('\n')[0] : undefined };
}
