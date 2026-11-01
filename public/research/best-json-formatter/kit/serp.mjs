// Search snapshot for the inclusion rule (protocol section 2): the first results page of Google and Bing for five
// queries, English, United States, signed out. Saves each page's HTML and a screenshot, and the organic results it
// found, to <out>/serp/. Run it headed (xvfb-run on Linux):
//
//   xvfb-run -a node serp.mjs --out out
//
// The parsed lists are a convenience: the screenshots are the evidence, and select.mjs's output is checked
// against them by hand before the tool list is frozen.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'out' }, query: { type: 'string', multiple: true }, 'query-index': { type: 'string' } } });
export const ALL_QUERIES = ['json formatter', 'json beautifier', 'json viewer', 'json validator', 'format json online'];
// One query per job (--query-index 1..5): both engines answered the first search of a runner and asked for a CAPTCHA
// after that (run 41327510021).
const QUERIES = o.query ?? (o['query-index'] ? [ALL_QUERIES[Number(o['query-index']) - 1]] : ALL_QUERIES);
const dir = join(o.out, 'serp');
mkdirSync(dir, { recursive: true });

const ENGINES = {
  google: {
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&pws=0`,
    blocked: (page) => page.url().includes('/sorry/') || page.locator('form#captcha-form, iframe[src*="recaptcha"]').count().then((n) => n > 0),
    // Organic results: headings inside a link in the main results column (ads sit outside #rso). Google wraps the
    // link in a redirect, so the address is read from the result's displayed URL (its <cite>).
    parse: () =>
      [...document.querySelectorAll('#rso h3')]
        .map((h) => ({ h, a: h.closest('a[href]') }))
        .filter(({ a }) => a)
        .map(({ h, a }) => {
          const block = a.closest('[data-hveid]') ?? a.parentElement;
          const cite = block.querySelector('cite')?.innerText.trim() ?? '';
          const shown = cite.split(/\s*›\s*/);
          let url = a.href;
          if (/^https?:\/\/www\.google\.[^/]+\/(goto|url)\b/.test(url) && /^https?:\/\//.test(shown[0])) url = shown[0]; // the shown path is a breadcrumb, not a URL: keep the site
          return { url, title: h.innerText.trim(), cite };
        }),
  },
  bing: {
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-US&cc=US&mkt=en-US`,
    blocked: (page) => page.locator('#b_captcha, iframe[src*="captcha"]').count().then((n) => n > 0),
    parse: () =>
      [...document.querySelectorAll('#b_results > li.b_algo')]
        .map((li) => li.querySelector('h2 a[href]'))
        .filter(Boolean)
        .map((a) => {
          // Bing wraps links as bing.com/ck/a?…&u=a1<base64url of the target>.
          let url = a.href;
          const u = new URL(url).searchParams.get('u');
          if (url.includes('bing.com/ck/a') && u?.startsWith('a1')) {
            const b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
            url = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
          }
          return { url, title: a.innerText.trim() };
        }),
  },
};

const browser = await chromium.launch({ headless: false });
const browserVersion = `Chromium ${browser.version()}`;
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
const lists = [];
for (const [engine, e] of Object.entries(ENGINES)) {
  for (const query of QUERIES) {
    const page = await context.newPage();
    const name = `${engine}--${query.replace(/\s+/g, '-')}`;
    const entry = { engine, query, url: e.url(query), at: new Date().toISOString(), blocked: false, results: [] };
    try {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      entry.finalUrl = page.url();
      entry.blocked = await e.blocked(page);
      if (!entry.blocked) entry.results = (await page.evaluate(e.parse)).slice(0, 10).map((r, i) => ({ position: i + 1, ...r }));
      writeFileSync(join(dir, `${name}.html`), await page.content());
      await page.screenshot({ path: join(dir, `${name}.jpg`), fullPage: true, type: 'jpeg', quality: 70 });
    } catch (err) {
      entry.error = String(err.message).split('\n')[0];
    }
    lists.push(entry);
    console.log(`${engine} · ${query}: ${entry.blocked ? 'BLOCKED' : entry.error ? 'ERROR ' + entry.error : entry.results.length + ' results'}`);
    for (const r of entry.results) console.log(`  ${r.position}. ${r.url}`);
    await page.close();
    await new Promise((r) => setTimeout(r, 15_000 + Math.random() * 5000)); // a person's pace, not a crawler's
  }
}
const ip = await context.request.get('https://ipinfo.io/json').then((r) => r.json()).catch(() => null);
await browser.close();
writeFileSync(
  join(dir, `serp${o['query-index'] ? '-' + o['query-index'] : ''}.json`),
  JSON.stringify({ takenAt: new Date().toISOString(), browser: browserVersion, location: ip && { city: ip.city, region: ip.region, country: ip.country, org: ip.org }, lists }, null, 2) + '\n',
);
