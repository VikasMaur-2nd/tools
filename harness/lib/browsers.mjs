// One browser process per engine (and launch flavour) for the whole run; every test gets its own
// context in it, which takes milliseconds instead of the second or more a browser launch costs.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DIRS } from './env.mjs';
import { chromium, firefox, webkit } from 'playwright-core';

const TYPES = { chromium, firefox, webkit };
const require = createRequire(import.meta.url);
const PW_DIR = dirname(require.resolve('playwright-core/package.json'));
export const HEADED = !!process.env.HEADED;

/** Browser downloads each engine needs (Playwright's names). */
const NEEDS = { chromium: ['chromium-headless-shell'], 'chromium:full': ['chromium'], firefox: ['firefox'], webkit: ['webkit'] };

let installed = new Set();
/**
 * Installs missing browsers into the harness cache. Copies come first (hard links, so no extra disk)
 * from Playwright's shared folder when it has the same revisions, then Playwright downloads the rest.
 */
export function ensureBrowsers(keys) {
  const names = [...new Set(keys.flatMap((k) => NEEDS[k] || []))].filter((n) => !installed.has(n));
  if (!names.length) return;
  const spec = JSON.parse(readFileSync(join(PW_DIR, 'browsers.json'), 'utf8')).browsers;
  const shared = join(homedir(), '.cache', 'ms-playwright');
  const missing = [];
  for (const name of [...names, 'ffmpeg']) {
    const b = spec.find((x) => x.name === name);
    if (!b) continue;
    const dir = `${name.replace(/-/g, '_')}-${b.revision}`;
    const done = (root) => existsSync(join(root, dir, 'INSTALLATION_COMPLETE'));
    if (done(DIRS.browsers)) continue;
    if (shared !== DIRS.browsers && done(shared)) {
      const r = spawnSync('cp', ['-al', join(shared, dir), join(DIRS.browsers, dir)]);
      if (r.status !== 0) cpSync(join(shared, dir), join(DIRS.browsers, dir), { recursive: true });
      if (done(DIRS.browsers)) continue;
    }
    missing.push(name);
  }
  if (missing.length) {
    console.log(`  installing browsers: ${missing.join(', ')} → ${DIRS.browsers}`);
    const r = spawnSync(process.execPath, [join(PW_DIR, 'cli.js'), 'install', ...missing], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) throw new Error(`playwright install ${missing.join(' ')} failed`);
  }
  installed = new Set([...installed, ...names]);
}

const launched = new Map();
/** The shared browser for an engine. `launch` options (args, channel) give a separate process. */
export function getBrowser(engine, launch = {}) {
  const key = `${engine}:${JSON.stringify(launch)}`;
  if (!launched.has(key)) {
    ensureBrowsers([launch.channel === 'chromium' ? 'chromium:full' : engine]);
    const args = [...(engine === 'chromium' ? ['--disable-dev-shm-usage', '--disable-background-networking'] : []), ...(launch.args || [])];
    launched.set(key, TYPES[engine].launch({ headless: !HEADED, ...launch, args }));
  }
  return launched.get(key);
}

export async function closeBrowsers() {
  const all = [...launched.values()];
  launched.clear();
  await Promise.all(all.map((p) => p.then((b) => b.close()).catch(() => {})));
}

/** Records clipboard writes instead of touching the system clipboard; tests read window.__clip. */
const CLIPBOARD_STUB = () => {
  window.__clip = null;
  const c = { writeText: async (t) => void (window.__clip = String(t)), readText: async () => window.__clip ?? '', write: async () => {}, read: async () => [] };
  try {
    Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true });
  } catch {}
};

/** Page helpers the harness polls with. */
const HELPERS = () => {
  window.__vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) || null;
};

const IGNORED_CONSOLE = /_vercel\/|favicon/;

/**
 * A fresh context and page. Options: width, height, mobile, dark, locale, serviceWorkers ('block' by
 * default: registering the app's worker precaches every chunk, which only offline tests want), clipboard
 * (stubbed by default), launch (browser launch options), context (raw Playwright context options).
 */
export async function openPage(engine, opts = {}) {
  const browser = await getBrowser(engine, opts.launch);
  const mobile = !!opts.mobile;
  const context = await browser.newContext({
    viewport: { width: opts.width || (mobile ? 390 : 1280), height: opts.height || (mobile ? 844 : 800) },
    ...(mobile ? { deviceScaleFactor: 2, ...(engine === 'firefox' ? {} : { isMobile: true, hasTouch: true }) } : {}),
    colorScheme: opts.dark ? 'dark' : 'light',
    locale: opts.locale || 'en-US',
    serviceWorkers: opts.serviceWorkers || 'block',
    acceptDownloads: true,
    ...opts.context,
  });
  await context.addInitScript(HELPERS);
  if (opts.clipboard !== false) await context.addInitScript(CLIPBOARD_STUB);
  const errors = [];
  const watched = new WeakSet();
  const watch = (page) => {
    if (watched.has(page)) return;
    watched.add(page);
    page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text() + ' ' + (m.location()?.url || ''))) errors.push('console: ' + m.text().slice(0, 300));
    });
    page.on('crash', () => errors.push('CRASH'));
  };
  context.on('page', watch);
  const page = await context.newPage();
  watch(page);
  return { context, page, errors, browser };
}
