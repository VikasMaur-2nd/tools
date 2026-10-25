// A fake PostHog for the privacy suites. The `posthog-mock` build (build.mjs VARIANTS) sends everything to
// it through the site's /relay rewrite. It serves the SDK's lazy scripts from posthog-js/dist, answers the
// remote config with every risky option on (console logs, network bodies and headers, canvas, autocapture,
// exceptions), so only the site's own settings keep data in the browser, and keeps every request it gets,
// decoded.
//
// The build bakes the mock's address in, so the port is fixed. One mock serves every run on the machine:
// the first test that needs it starts it as a detached process (under a lock), later tests and other runs
// find it with a ping, and it exits on its own after IDLE_MS without requests. Tests tell their requests
// apart by a header their browser context sends on every request (`TAG_HEADER`), which Next.js passes on
// through the rewrite.
//
//   const mock = await ensureMock({ dist });              // dist: posthog-js/dist of the build under test
//   await mock.waitFor(tag, (reqs) => reqs.some(…));     // polls the mock every 25 ms
//   await mock.search('TKCANARY…')                        // every request (any tag) holding the text
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DIRS } from './env.mjs';
import { withLock } from './lock.mjs';

export const PORT = 4610;
export const BASE = `http://127.0.0.1:${PORT}`;
export const TAG_HEADER = 'x-harness-tag';
/** Bump when the mock's behaviour or API changes: a running mock of another version is replaced once idle. */
const VERSION = 3;
const IDLE_MS = 5 * 60_000;
/** Requests older than this are dropped (a run's tests read theirs within seconds). */
const KEEP_MS = 30 * 60_000;

// ── The server (runs as `node posthog-mock.mjs serve <port> <dist>`) ─────────────────────────────

const remote = {
  sessionRecording: {
    endpoint: '/s/',
    consoleLogRecordingEnabled: true,
    recorderVersion: 'v2',
    sampleRate: null,
    minimumDurationMilliseconds: 0,
    linkedFlag: null,
    networkPayloadCapture: { recordBody: true, recordHeaders: true },
    recordCanvas: true,
    canvasFps: 4,
    canvasQuality: '0.4',
    urlTriggers: [],
    urlBlocklist: [],
    eventTriggers: [],
    scriptConfig: null,
    masking: { maskAllInputs: false, maskTextSelector: null, blockSelector: null },
  },
  autocaptureExceptions: true,
  capturePerformance: { network_timing: true, web_vitals: true },
  heatmaps: true,
  autocapture_opt_out: false,
  captureDeadClicks: true,
  supportedCompression: ['gzip', 'gzip-js'],
  hasFeatureFlags: false,
  surveys: false,
  productTours: false,
  defaultIdentifiedOnly: true,
  siteApps: [],
  logs: { captureConsoleLogs: true },
};

const decode = (buf) => {
  if (!buf.length) return '';
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) return '[gzip] ' + gunzipSync(buf).toString('utf8');
  } catch {}
  let s = buf.toString('utf8');
  if (s.startsWith('data=')) {
    try {
      s = '[base64] ' + Buffer.from(new URLSearchParams(s).get('data') ?? '', 'base64').toString('utf8');
    } catch {}
  }
  return s;
};

function serveMock(port, dist) {
  // Builds can be pruned while a mock is shared by other worktrees. Keep the SDK scripts
  // in memory so deleting the build directory cannot break an active canary.
  const scripts = new Map(readdirSync(dist).filter((name) => name.endsWith('.js')).map((name) => [name, readFileSync(join(dist, name))]));
  const log = [];
  // Chromium can omit Playwright's extra headers on unload beacons. The SDK's
  // window ID still identifies the originating test, including after navigation.
  const windows = new Map();
  const ids = (entry) => eventsIn([entry]).map((e) => e.properties?.$window_id).filter((id) => typeof id === 'string');
  const tagOf = (entry) => {
    if (entry.tag) return entry.tag;
    const tags = new Set(ids(entry).map((id) => windows.get(id)?.tag).filter(Boolean));
    return tags.size === 1 ? [...tags][0] : null;
  };
  let next = 0;
  let last = Date.now();
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    last = Date.now();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      const u = new URL(url, 'http://x');
      const path = u.pathname;
      // The harness's own API: never logged.
      if (path.startsWith('/__harness/')) {
        const cut = Date.now() - KEEP_MS;
        while (log.length && log[0].t < cut) log.shift();
        for (const [id, value] of windows) if (value.t < cut) windows.delete(id);
        if (path === '/__harness/ping') return json(res, 200, { version: VERSION, pid: process.pid, last: Math.max(0, ...log.map((l) => l.t)) });
        if (path === '/__harness/requests') {
          const tag = u.searchParams.get('tag');
          const since = Number(u.searchParams.get('since') || 0);
          return json(res, 200, { next, items: log.filter((l) => l.i >= since && tagOf(l) === tag) });
        }
        if (path === '/__harness/search') {
          const needles = u.searchParams.getAll('needle').filter(Boolean);
          const hits = [];
          for (const l of log) for (const n of needles) if ((l.url + l.body + JSON.stringify(l.headers)).includes(n)) hits.push({ i: l.i, tag: tagOf(l), method: l.method, path: l.path, needle: n, at: l.body.indexOf(n) });
          return json(res, 200, hits);
        }
        if (path === '/__harness/quit') {
          json(res, 200, { bye: true });
          return setTimeout(() => process.exit(0), 50);
        }
        return json(res, 404, {});
      }
      const tag = req.headers[TAG_HEADER] || null;
      const entry = { i: next++, t: Date.now(), tag: Array.isArray(tag) ? tag[0] : tag, method: req.method, url, path, headers: req.headers, ct: req.headers['content-type'], body: decode(Buffer.concat(chunks)) };
      if (entry.tag) for (const id of ids(entry)) windows.set(id, { tag: entry.tag, t: entry.t });
      log.push(entry);
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
      if (path.startsWith('/static/')) {
        const script = scripts.get(path.split('/').pop());
        if (script) {
          res.writeHead(200, { ...cors, 'Content-Type': 'application/javascript' });
          return res.end(script);
        }
        res.writeHead(404, cors);
        return res.end();
      }
      if (/\/array\/[^/]+\/config\.js$/.test(path)) {
        const token = path.split('/')[2];
        res.writeHead(200, { ...cors, 'Content-Type': 'application/javascript' });
        return res.end(`(function(){window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}]={config:${JSON.stringify(remote)},siteApps:[]}})();`);
      }
      if (/\/array\/[^/]+\/config$/.test(path)) {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(remote));
      }
      if (path.startsWith('/flags')) {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...remote, featureFlags: {}, featureFlagPayloads: {}, errorsWhileComputingFlags: false, flags: {} }));
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end('{"status":1}');
    });
  });
  server.listen(port, '127.0.0.1', () => console.log('mock posthog on', port));
  setInterval(() => Date.now() - last > IDLE_MS && process.exit(0), 10_000).unref();
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'serve') serveMock(Number(process.argv[3]), process.argv[4]);

// ── The client (what suites use) ──────────────────────────────────────────────────────────────

const api = async (path) => {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`posthog mock ${path}: HTTP ${r.status}`);
  return r.json();
};
const ping = () => api('/__harness/ping').catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ready = null;

/**
 * The machine's mock, started if no run has one (under a lock, so two runs don't both start one). `dist` is
 * posthog-js/dist of the build under test: its lazy scripts are served from there.
 */
export async function ensureMock({ dist }) {
  if ((await ping())?.version === VERSION) return client();
  return (ready ||= (async () => {
    let p = await ping();
    if (p?.version === VERSION) return client();
    await withLock(join(DIRS.tmp, 'posthog-mock.lock'), async () => {
      p = await ping();
      if (p && p.version !== VERSION) {
        // Another checkout's mock: replace it only once nobody has used it for a minute.
        while (p && p.version !== VERSION && Date.now() - p.last < 60_000) {
          await sleep(1000);
          p = await ping();
        }
        if (p && p.version !== VERSION) await api('/__harness/quit').catch(() => {});
        for (let i = 0; i < 100 && (await ping()); i++) await sleep(50);
        p = null;
      }
      if (p) return;
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', String(PORT), dist], { detached: true, stdio: 'ignore' });
      child.unref();
      const t0 = Date.now();
      while (!(await ping())) {
        if (Date.now() - t0 > 15_000) throw new Error(`posthog mock did not start on port ${PORT}`);
        await sleep(25);
      }
    });
    return client();
  })().finally(() => {
    ready = null;
  }));
}

function client() {
  return {
    base: BASE,
    /** Every request with this tag (decoded bodies), oldest first, from index `since`. */
    async requests(tag, since = 0) {
      return (await api(`/__harness/requests?tag=${encodeURIComponent(tag)}&since=${since}`)).items;
    },
    /** The index the next request will get (a mark: requests(tag, mark) are the ones after it). */
    async mark() {
      return (await api('/__harness/requests?tag=&since=0')).next;
    },
    /** Requests of any tag whose URL or body holds one of `needles`. */
    async search(...needles) {
      return api(`/__harness/search?${needles.map((n) => `needle=${encodeURIComponent(n)}`).join('&')}`);
    },
    /** Polls every 25 ms until `cond(requests)` is truthy; returns its value. Throws after `timeout`. */
    async waitFor(tag, cond, { since = 0, timeout = 30_000, what = 'a request' } = {}) {
      const t0 = Date.now();
      const seen = [];
      let at = since;
      for (;;) {
        const r = await api(`/__harness/requests?tag=${encodeURIComponent(tag)}&since=${at}`);
        seen.push(...r.items);
        at = r.next;
        const v = cond(seen);
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for ${what} at the PostHog mock (${seen.length} requests seen)`);
        await sleep(25);
      }
    },
  };
}

// ── Reading what PostHog sent ────────────────────────────────────────────────────────────────

/** The JSON body of a request (decoded), or null. */
export function bodyOf(req) {
  try {
    return JSON.parse(req.body.replace(/^\[(gzip|base64)\] /, ''));
  } catch {
    return null;
  }
}

/** PostHog events in requests: [{ event, properties, … }]. */
export function eventsIn(reqs) {
  const out = [];
  for (const r of reqs) {
    if (r.method !== 'POST') continue;
    const data = bodyOf(r);
    if (!data) continue;
    for (const e of Array.isArray(data) ? data : data.batch ?? [data]) if (e && e.event) out.push(e);
  }
  return out;
}

/** rrweb events of every $snapshot in requests, in order. */
export function snapshotsIn(reqs) {
  return eventsIn(reqs)
    .filter((e) => e.event === '$snapshot')
    .flatMap((e) => {
      const d = e.properties?.$snapshot_data;
      return Array.isArray(d) ? d : d ? [d] : [];
    });
}
