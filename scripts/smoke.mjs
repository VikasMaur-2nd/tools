// Browser smoke test of a running build: every sitemap URL over HTTP, then the main page types in a real
// headless Chrome (desktop + phone, light + dark) driven over the DevTools protocol. No dependencies.
// usage: pnpm smoke [base-url]        default http://localhost:3000 (serve a production build: pnpm build && pnpm start)
//   CHROME_PATH=<chrome, chromium or chrome-headless-shell>   when no browser is found on the usual paths
// Exit 1 on any failure, with one line per failure.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const SITE = 'https://tools.vikasmaur.com';
const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.log(`FAIL ${where}: ${what}`);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, ws, profile;

// ── 1. Every URL in the sitemap answers 200 with the basics a crawler needs ───────────────────────────

const sitemap = await fetch(`${BASE}/sitemap.xml`).then((r) => r.text());
const paths = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, '') || '/'))];
if (paths.length < 10) fail('sitemap', `only ${paths.length} URLs`);
const one = (html, re) => (html.match(re) || []).length;
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < paths.length) {
      const path = paths[next++];
      const res = await fetch(BASE + path, { redirect: 'manual' });
      if (res.status !== 200) {
        fail(path, `HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      if (one(html, /<title>[^<]+<\/title>/g) !== 1) fail(path, 'needs exactly one <title>');
      if (one(html, /<link rel="canonical"/g) !== 1) fail(path, 'needs exactly one canonical link');
      if (one(html, /<h1[\s>]/g) !== 1) fail(path, `has ${one(html, /<h1[\s>]/g)} <h1>`);
      if (one(html, /<main[\s>]/g) !== 1) fail(path, `has ${one(html, /<main[\s>]/g)} <main>`);
      if (!/<html[^>]+lang="[a-z]{2}/.test(html)) fail(path, 'no <html lang>');
      if (!/<meta name="description" content="[^"]{50,}/.test(html)) fail(path, 'no useful meta description');
    }
  }),
);
const missing = await fetch(`${BASE}/no-such-page-${Date.now()}`);
if (missing.status !== 404) fail('404 page', `HTTP ${missing.status}`);
console.log(`checked ${paths.length} sitemap URLs`);

// ── 2. A real browser ─────────────────────────────────────────────────────────────────────────────────

function findChrome() {
  const home = process.env.HOME || '';
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...['1248', '1208'].flatMap((v) => [
      `${home}/.cache/ms-playwright/chromium_headless_shell-${v}/chrome-headless-shell-linux-arm64/chrome-headless-shell`,
      `${home}/.cache/ms-playwright/chromium_headless_shell-${v}/chrome-linux/headless_shell`,
    ]),
  ];
  return candidates.find((p) => p && existsSync(p));
}

const chromePath = findChrome();
if (!chromePath) {
  fail('browser', 'no Chrome found: set CHROME_PATH');
  finish();
}
profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'smoke-'));
chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.on('data', (d) => {
    err += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${err.slice(0, 300)}`)));
});

// Minimal DevTools protocol client: one browser socket, flat sessions for pages.
ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function open(path, { width = 1280, height = 800, dark = false, mobile = false } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  let loaded = false;
  const onEvent = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    // Vercel Web Analytics' script only exists on Vercel: a local server answers 404.
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/\/_vercel\//.test((m.params.entry.url || '') + m.params.entry.text)) errors.push(`${m.params.entry.source}: ${m.params.entry.text.slice(0, 200)}`);
    else if (m.method === 'Page.loadEventFired') loaded = true;
  };
  listeners.add(onEvent);
  const s = (method, params) => send(method, params, sessionId);
  await Promise.all([s('Runtime.enable'), s('Log.enable'), s('Page.enable')]);
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await s('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 300 && !loaded; i++) await delay(50);
  await delay(1500);
  const ev = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    ev,
    errors,
    close: async () => {
      listeners.delete(onEvent);
      await send('Target.closeTarget', { targetId });
    },
  };
}

const PAGES = ['/', '/tools/json-validator', '/es', '/ja/tools/json-to-python', '/tools', '/blogs/origin-of-json', '/json-errors', '/json-errors/unexpected-token-html', '/resources/json-reference', '/privacy', '/integrate', '/about'];
const LAYOUTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 375, height: 740, mobile: true },
];

for (const path of PAGES) {
  for (const layout of LAYOUTS) {
    for (const dark of [false, true]) {
      const where = `${path} ${layout.name}${dark ? ' dark' : ''}`;
      const p = await open(path, { ...layout, dark });
      try {
        const r = await p.ev(`(() => {
          const d = document.documentElement;
          const bg = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).slice(0, 3).map(Number);
          return { overflow: d.scrollWidth - innerWidth, light: bg.reduce((a, b) => a + b, 0) / 3, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length };
        })()`);
        if (r.overflow > 1) fail(where, `page is ${r.overflow}px wider than the window`);
        if (dark ? r.light > 60 : r.light < 190) fail(where, `background lightness ${Math.round(r.light)} in ${dark ? 'dark' : 'light'} mode`);
        if (r.h1 !== 1) fail(where, `${r.h1} <h1> after hydration`);
        if (r.main !== 1) fail(where, `${r.main} <main> after hydration`);
        for (const e of p.errors) fail(where, e);
      } catch (e) {
        fail(where, e.message);
      }
      await p.close();
    }
  }
}

// ── 3. The app itself ─────────────────────────────────────────────────────────────────────────────────

const SAMPLE = JSON.stringify({ name: 'Ada', age: 36, tags: ['x', 'y'], nested: { ok: true, list: [1, 2, 3] } });
for (const path of ['/', '/tools/json-validator', '/es']) {
  for (const layout of LAYOUTS) {
    const where = `app ${path} ${layout.name}`;
    const p = await open(path, layout);
    try {
      await p.ev(`new Promise((r) => { const t = setInterval(() => { if (document.querySelector('#input')) { clearInterval(t); r(); } }, 50); setTimeout(r, 10000); })`);
      // The input editor fills its pane (a page-container class once shrank it by 48px).
      const w = await p.ev(`[...document.querySelectorAll('.pane > .ed')].filter((e) => e.offsetWidth).map((e) => [e.parentElement.getBoundingClientRect().width, e.getBoundingClientRect().width])`);
      for (const [pane, ed] of w) if (Math.abs(pane - ed) > 1) fail(where, `editor is ${ed}px wide in a ${pane}px pane`);
      await p.ev(`(() => { const ta = document.querySelector('#input'); ta.focus(); ta.value = ${JSON.stringify(SAMPLE)}; ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true })); })()`);
      await delay(1200);
      const status = await p.ev(`document.querySelector('.statusbar')?.textContent ?? ''`);
      if (!/Valid JSON|JSON válido/.test(status)) fail(where, `status after pasting valid JSON: "${status.slice(0, 80)}"`);
      for (const view of ['tree', 'table', 'graph', 'convert', 'compare', 'format']) {
        await p.ev(`(() => { const b = document.querySelector('[role=tab][aria-controls="view-${view}"]'); if (b && b.offsetWidth) b.click(); else { const s = document.querySelector('.tabs-pick select'); s.value = '${view}'; s.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
        await delay(900);
        const shown = await p.ev(`document.querySelector('[role=tab][aria-controls="view-${view}"]')?.getAttribute('aria-selected') === 'true' || document.querySelector('.tabs-pick select')?.value === '${view}'`);
        if (!shown) fail(where, `could not switch to the ${view} view`);
      }
      for (const e of p.errors) fail(where, e);
    } catch (e) {
      fail(where, e.message);
    }
    await p.close();
  }
}

// Error screens stay visible for returning visitors (data-doc is set before paint when a document is saved).
{
  const p = await open('/blogs/origin-of-json');
  const hidden = await p.ev(`(() => {
    document.documentElement.dataset.doc = '';
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.className = 'hero error-screen';
    box.innerHTML = '<div class="hero-in"><h2>x</h2></div>';
    document.body.append(box);
    const v = getComputedStyle(box).visibility;
    box.remove();
    return v;
  })()`);
  if (hidden !== 'visible') fail('error screen', `visibility "${hidden}" when a document is saved`);
  await p.close();
}

finish();

function finish() {
  try {
    ws?.close();
  } catch {}
  chrome?.kill();
  if (profile) rmSync(profile, { recursive: true, force: true });
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nsmoke: all passed');
  process.exit(failures.length ? 1 : 0);
}
