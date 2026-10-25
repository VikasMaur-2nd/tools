// What a visitor downloads and waits for: first-load JavaScript per page (exact bytes, one round),
// paint timings and layout shift in a cold context, and Lighthouse.
import { spawn } from 'node:child_process';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { ensureBrowsers } from '../../lib/browsers.mjs';
import { DIRS } from '../../lib/env.mjs';
import { chromium } from 'playwright-core';

defaults({ tags: ['perf'], engines: ['chromium'] });

const PAGES = ['/', '/tools/json-validator', '/integrate', '/blogs/origin-of-json'];

// Every script the page loads before it is idle, compressed the way a CDN serves it. Byte counts are
// exact, so one round settles it and any change against the base is real.
for (const path of PAGES) {
  test(`first-load JS ${path}`, { rounds: 1 }, async (t) => {
    const scripts = new Map();
    t.page.on('response', async (r) => {
      if (r.request().resourceType() !== 'script' || !r.ok()) return;
      scripts.set(r.url(), r.body().catch(() => null));
    });
    await t.open(path, { tool: path !== '/blogs/origin-of-json' && path !== '/integrate' });
    await t.page.waitForLoadState('networkidle');
    let gz = 0;
    let br = 0;
    let raw = 0;
    for (const body of await Promise.all(scripts.values())) {
      if (!body) continue;
      raw += body.length;
      gz += gzipSync(body, { level: 9 }).length;
      br += brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    }
    t.metric('JS gzip bytes', gz, 'B');
    t.metric('JS brotli bytes', br, 'B');
    t.metric('JS raw bytes', raw, 'B');
    t.metric('script requests', scripts.size, '');
  });
}

// Paint, layout shift and main-thread blocking during load, in a fresh context (cold cache).
for (const path of ['/', '/tools/json-validator', '/blogs/origin-of-json']) {
  test(`load ${path}`, async (t) => {
    await t.context.addInitScript(() => {
      window.__lt = { cls: 0, long: 0, lcp: 0 };
      try {
        new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__lt.cls += e.value))).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lt.long += Math.max(0, e.duration - 50)))).observe({ type: 'longtask', buffered: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lt.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {}
    });
    await t.page.goto(t.base + path, { waitUntil: 'load' });
    await t.page.waitForLoadState('networkidle');
    const m = await t.page.evaluate(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      ...window.__lt,
      dcl: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null,
    }));
    t.metric('FCP ms', m.fcp);
    t.metric('LCP ms', m.lcp);
    t.metric('blocking ms', m.long);
    t.metric('CLS', m.cls, '');
    t.metric('DOMContentLoaded ms', m.dcl);
  });
}

// Lighthouse (mobile, its own throttling) through `pnpm dlx`, so it isn't a dependency of the repo.
// Slow (~30 s a page): pick it with `pnpm perf lighthouse` or leave it out with --skip-tag lighthouse.
for (const path of ['/', '/tools/json-validator', '/blogs/origin-of-json']) {
  test(`lighthouse ${path}`, { page: false, tags: ['lighthouse'], rounds: 3, timeout: 240_000 }, async (t) => {
    ensureBrowsers(['chromium:full']);
    const out = await new Promise((resolve, reject) => {
      const p = spawn(
        'pnpm',
        ['dlx', 'lighthouse@13.5.0', t.base + path, '--output=json', '--quiet', '--only-categories=performance,accessibility,best-practices,seo', '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage'],
        { env: { ...process.env, CHROME_PATH: chromium.executablePath(), TMPDIR: DIRS.tmp }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let json = '';
      let err = '';
      p.stdout.on('data', (d) => (json += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => (code === 0 ? resolve(json) : reject(new Error(`lighthouse exit ${code}: ${err.slice(-500)}`))));
    });
    const lh = JSON.parse(out);
    for (const [k, c] of Object.entries(lh.categories)) t.metric(`${k} score`, Math.round(c.score * 100), '');
    const a = lh.audits;
    t.metric('LCP ms', a['largest-contentful-paint'].numericValue);
    t.metric('TBT ms', a['total-blocking-time'].numericValue);
    t.metric('CLS', a['cumulative-layout-shift'].numericValue, '');
    t.metric('Speed Index ms', a['speed-index'].numericValue);
  });
}
