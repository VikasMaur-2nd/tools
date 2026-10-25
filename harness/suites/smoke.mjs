// The site answers like a crawler and a visitor expect: every sitemap URL, the main page types on a
// desktop and a phone in light and dark mode, and the tool itself.
import { defaults, test } from '../lib/api.mjs';

defaults({ tags: ['smoke'], engines: 'all' });

const SAMPLE = JSON.stringify({ name: 'Ada', age: 36, tags: ['x', 'y'], nested: { ok: true, list: [1, 2, 3] } });
const PAGES = ['/', '/tools/json-validator', '/es', '/ja/tools/json-to-python', '/tools', '/blogs/origin-of-json', '/json-errors', '/json-errors/unexpected-token-html', '/resources/json-reference', '/privacy', '/integrate', '/about'];
const TOOL = /^\/(?:[a-z]{2}(?:\/|$))?(?:tools\/[\w-]+)?$/; // pages with the JSON tool: /, /es, /tools/x, /ja/tools/x

test('every sitemap URL answers 200 with one title, canonical, h1, main, lang and a description', { page: false, engines: ['chromium'] }, async (t) => {
  const sitemap = await t.fetch(`${t.base}/sitemap.xml`).then((r) => r.text());
  const paths = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname))];
  t.check(paths.length >= 10, `sitemap lists ${paths.length} URLs`);
  const one = (html, re) => (html.match(re) || []).length;
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < paths.length) {
        const path = paths[next++];
        const res = await t.fetch(t.base + path, { redirect: 'manual' });
        if (!t.check(res.status === 200, `${path}: HTTP 200`, res.status)) continue;
        const html = await res.text();
        t.check(one(html, /<title>[^<]+<\/title>/g) === 1, `${path}: one <title>`);
        t.check(one(html, /<link rel="canonical"/g) === 1, `${path}: one canonical link`);
        t.check(one(html, /<h1[\s>]/g) === 1, `${path}: one <h1>`, one(html, /<h1[\s>]/g));
        t.check(one(html, /<main[\s>]/g) === 1, `${path}: one <main>`, one(html, /<main[\s>]/g));
        t.check(/<html[^>]+lang="[a-z]{2}/.test(html), `${path}: <html lang>`);
        t.check(/<meta name="description" content="[^"]{50,}/.test(html), `${path}: a useful meta description`);
      }
    }),
  );
  const missing = await t.fetch(`${t.base}/no-such-page-${Date.now()}`);
  t.check(missing.status === 404, 'unknown URL answers 404', missing.status);
});

/** After hydration: no sideways scrolling, the theme's background, one h1 and one main. */
async function layoutChecks(t, page, where, dark) {
  // Against the device width, not innerWidth: Chromium's mobile emulation widens the layout viewport to
  // fit overflowing content (a real phone zooms out), which hid a 480 px line on a 375 px screen.
  const width = page.viewportSize().width;
  const r = await page.evaluate((width) => {
    const d = document.documentElement;
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
    return { overflow: d.scrollWidth - width, light: bg.reduce((a, b) => a + b, 0) / 3, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length };
  }, width);
  // Real bug (2026-10-25, every engine, main and PR #26): /integrate's link-format line
  // "https://tools.vikasmaur.com/#a=<document>&view=tree" is one unbreakable 480 px <code> on a 375 px phone.
  const known = where.startsWith('phone') && t.path === '/integrate' ? { known: 'bug: /integrate link-format <code> line overflows phones by ~160 px' } : {};
  t.check(r.overflow <= 1, `${where}: no sideways scrolling`, `${r.overflow}px wider than the window`, known);
  t.check(dark ? r.light <= 60 : r.light >= 190, `${where}: ${dark ? 'dark' : 'light'} background`, Math.round(r.light));
  t.check(r.h1 === 1, `${where}: one <h1> after hydration`, r.h1);
  t.check(r.main === 1, `${where}: one <main> after hydration`, r.main);
}

async function settle(t, page, path) {
  const tool = TOOL.test(path);
  await t.app.open(page, t.base, path, { tool });
  // Content pages: hydration has run once the page is idle after load.
  if (!tool) await page.evaluate(() => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50))));
}

for (const path of PAGES) {
  test(`layout ${path}: desktop and phone, light and dark`, async (t) => {
    t.path = path;
    for (const mobile of [false, true]) {
      const page = mobile ? (await t.newPage({ mobile: true, width: 375, height: 740 })).page : t.page;
      await settle(t, page, path);
      for (const dark of [false, true]) {
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
        await layoutChecks(t, page, `${mobile ? 'phone' : 'desktop'}${dark ? ' dark' : ''}`, dark);
      }
    }
  });
}

for (const path of ['/', '/tools/json-validator', '/es']) {
  test(`tool ${path}: paste, validate, every view, desktop and phone`, async (t) => {
    for (const mobile of [false, true]) {
      const where = mobile ? 'phone' : 'desktop';
      const page = mobile ? (await t.newPage({ mobile: true, width: 375, height: 740 })).page : t.page;
      await t.app.open(page, t.base, path);
      // The input editor fills its pane (a page-container class once shrank it by 48px).
      const widths = await page.evaluate(() => [...document.querySelectorAll('.pane > .ed')].filter((e) => e.offsetWidth).map((e) => [e.parentElement.getBoundingClientRect().width, e.getBoundingClientRect().width]));
      for (const [pane, ed] of widths) t.check(Math.abs(pane - ed) <= 1, `${where}: editor fills its pane`, `${ed}px in ${pane}px`, { known: 'PR #26: .wrap also styles the editor' });
      await t.app.setText(page, SAMPLE);
      const s = await t.app.waitStatus(page, /Valid JSON|JSON válido/, { timeout: 15_000 }).catch((e) => String(e).slice(0, 80));
      t.check(/Valid JSON|JSON válido/.test(s), `${where}: valid JSON recognised`, s);
      for (const v of ['tree', 'table', 'graph', 'convert', 'compare', 'format']) {
        const shown = await page.evaluate((v) => {
          const b = window.__vis(`[role=tab][aria-controls="view-${v}"]`);
          if (b) b.click();
          else {
            const s = window.__vis('.tabs-pick select');
            s.value = v;
            s.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }, v);
        const ok =
          shown &&
          (await page
            .waitForFunction((v) => document.querySelector(`[role=tab][aria-controls="view-${v}"]`)?.getAttribute('aria-selected') === 'true' || window.__vis('.tabs-pick select')?.value === v, v, { timeout: 10_000, polling: 25 })
            .then(() => true, () => false));
        t.check(ok, `${where}: ${v} view opens`);
      }
    }
  });
}

test('error screens stay visible for returning visitors', { engines: ['chromium'] }, async (t) => {
  await t.open('/blogs/origin-of-json', { tool: false });
  const visibility = await t.page.evaluate(() => {
    document.documentElement.dataset.doc = ''; // set before paint when a document is saved
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.className = 'error-screen';
    box.innerHTML = '<div class="error-screen-in"><h2>x</h2></div>';
    document.body.append(box);
    const v = getComputedStyle(box).visibility;
    box.remove();
    return v;
  });
  t.check(visibility === 'visible', 'error screen visible when a document is saved', visibility);
});
