// One browser process per engine (and launch flavour) for the whole run; every test gets its own
// context in it, which takes milliseconds instead of the second or more a browser launch costs.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DIRS, EXTRA_HEADERS } from './env.mjs';
import { chromium, firefox, webkit } from 'playwright-core';

const TYPES = { chromium, firefox, webkit };
const require = createRequire(import.meta.url);
const PW_DIR = dirname(require.resolve('playwright-core/package.json'));
export const HEADED = !!process.env.HEADED;

// Stage a complete tree before publishing it. Never copy over existing hard links.
function seedBrowser(source, dest) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(source, { withFileTypes: true })) {
    const src = join(source, e.name);
    const target = join(dest, e.name);
    if (e.isDirectory()) seedBrowser(src, target);
    else if (e.isSymbolicLink()) symlinkSync(readlinkSync(src), target);
    else {
      try {
        linkSync(src, target);
      } catch (e) {
        if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(e.code)) throw e;
        copyFileSync(src, target);
      }
    }
  }
}

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
  const shared = join(process.platform === 'darwin' ? join(homedir(), 'Library/Caches') : process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright');
  const missing = [];
  for (const name of [...names, 'ffmpeg']) {
    const b = spec.find((x) => x.name === name);
    if (!b) continue;
    // Playwright knows platform-specific revision overrides, including WebKit on macOS.
    const dir = b.revisionOverrides
      ? basename(require('playwright-core/lib/coreBundle').registry.registry.findExecutable(name).directory)
      : `${name.replace(/-/g, '_')}-${b.revision}`;
    const done = (root) => existsSync(join(root, dir, 'INSTALLATION_COMPLETE'));
    if (done(DIRS.browsers)) continue;
    if (resolve(shared) !== resolve(DIRS.browsers) && done(shared) && !existsSync(join(DIRS.browsers, dir))) {
      const staging = mkdtempSync(join(DIRS.browsers, '.seed-'));
      try {
        seedBrowser(join(shared, dir), join(staging, dir));
        renameSync(join(staging, dir), join(DIRS.browsers, dir));
      } catch {
        // A competing seed/install may have published it; otherwise let Playwright install it.
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
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
    const headless = launch.headless ?? !process.env.HEADED;
    ensureBrowsers([engine === 'chromium' && (!headless || launch.channel === 'chromium') ? 'chromium:full' : engine]);
    const args = [...(engine === 'chromium' ? ['--disable-dev-shm-usage', '--disable-background-networking'] : []), ...(launch.args || [])];
    const pending = TYPES[engine].launch({ headless, ...launch, args });
    launched.set(key, pending);
    pending.catch(() => { if (launched.get(key) === pending) launched.delete(key); });
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

/**
 * HARNESS_UI_FONT="DejaVu Sans" sets the page's UI font, to reproduce here what another machine's
 * system-ui font does (GitHub's Ubuntu runners fall back to the wider DejaVu Sans).
 */
const UI_FONT = (font) => {
  const style = () => {
    const s = document.createElement('style');
    s.textContent = `:root { --font-ui: ${JSON.stringify(font)} !important; }`;
    document.head.append(s);
  };
  if (document.head) style();
  else document.addEventListener('DOMContentLoaded', style, { once: true });
};

/** Page helpers the harness polls with. */
const HELPERS = () => {
  window.__vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) || null;
};

// chrome://juggler/ is Playwright's own Firefox instrumentation (it logs NS_BINDING_ABORTED when a navigation
// cuts off a worker's load), not the page.
const IGNORED_CONSOLE = /_vercel\/|favicon|chrome:\/\/juggler\//;
// The spec's benign notice when a ResizeObserver callback resizes what it observes (WebKit reports it
// as an uncaught error on opening Compare, on main as on every branch); not an application failure.
const BENIGN_ERRORS = /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;

/**
 * A fresh context and page. Options: width, height, mobile, dark, locale, serviceWorkers ('block' by
 * default: registering the app's worker precaches every chunk, which only offline tests want), clipboard
 * (stubbed by default), launch (browser launch options), context (raw Playwright context options).
 */
export async function openPage(engine, opts = {}) {
  const browser = await getBrowser(engine, opts.launch);
  opts.signal?.throwIfAborted();
  const mobile = !!opts.mobile;
  const context = await browser.newContext({
    viewport: { width: opts.width || (mobile ? 390 : 1280), height: opts.height || (mobile ? 844 : 800) },
    ...(mobile ? { deviceScaleFactor: 2, ...(engine === 'firefox' ? {} : { isMobile: true, hasTouch: true }) } : {}),
    colorScheme: opts.dark ? 'dark' : 'light',
    locale: opts.locale || 'en-US',
    serviceWorkers: opts.serviceWorkers || 'block',
    acceptDownloads: true,
    ...(Object.keys(EXTRA_HEADERS).length ? { extraHTTPHeaders: EXTRA_HEADERS } : {}),
    ...opts.context,
  });
  const abort = () => { void context.close().catch(() => {}); };
  opts.signal?.addEventListener('abort', abort, { once: true });
  context.once('close', () => opts.signal?.removeEventListener('abort', abort));
  try {
    opts.signal?.throwIfAborted();
    await Promise.all([
      context.addInitScript(HELPERS),
      ...(opts.legacy ? [context.addInitScript(() => (window.__tkLegacy = true))] : []),
      ...(opts.clipboard !== false ? [context.addInitScript(CLIPBOARD_STUB)] : []),
      ...(process.env.HARNESS_UI_FONT ? [context.addInitScript(UI_FONT, process.env.HARNESS_UI_FONT)] : []),
    ]);
    const errors = [];
    const watched = new WeakSet();
    const watch = (page) => {
      if (watched.has(page)) return;
      watched.add(page);
      page.on('pageerror', (e) => {
        if (!BENIGN_ERRORS.test(String(e))) errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400));
      });
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text() + ' ' + (m.location()?.url || '')) && !BENIGN_ERRORS.test(m.text())) errors.push('console: ' + m.text().slice(0, 300));
      });
      page.on('crash', () => errors.push('CRASH'));
    };
    context.on('page', watch);
    const page = await context.newPage();
    watch(page);
    return { context, page, errors, browser };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}
