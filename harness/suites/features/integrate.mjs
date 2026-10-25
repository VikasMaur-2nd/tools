// Shared links (view, compare, convert, broken, landing pages, URL documents), the "View in Tool Kumar"
// handoff from another origin (it needs `/` to send COOP unsafe-none), the /integrate builder, the ways
// to /integrate (status bar, palette, navbar, phone menu, translations), its snippets, code-language
// switch and logo downloads, and share links too long to open. Ported from tk-e2e/e2e.mjs (73 checks,
// Chromium only, as it ran).
import { randomBytes } from 'node:crypto';
import { defaults, test } from '../../lib/api.mjs';
import { MOD, enc, resetClip, serveHtml, TOAST_RECORDER, until, waitClip, waitToast } from './_helpers.mjs';

defaults({ engines: ['chromium'], width: 1280, height: 800, tags: ['integrate'] });

const LIVE = 'https://tools.vikasmaur.com';
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tab = (page) => page.evaluate(() => window.__vis('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? '');
const editorText = (page, pane = '.pane-ed') => page.evaluate((p) => window.__vis(`${p} .ed-hl`)?.textContent ?? '', pane);
const waitTab = (page, name) => until(page, (n) => window.__vis('[role="tab"][aria-selected="true"]')?.textContent?.trim() === n && n, name);
const waitEditor = (page, re, pane = '.pane-ed') => until(page, ([s, f, p]) => new RegExp(s, f).test(window.__vis(`${p} .ed-hl`)?.textContent ?? ''), [re.source, re.flags, pane]);
const waitBuilder = (page) => until(page, () => !!document.querySelector('.link-builder .lb-out textarea') && !!document.querySelector('.link-builder .lb-preview a[href]'), null, { timeout: 20_000 });
const builderOut = (page) => page.locator('.lb-out textarea').inputValue();
/** Waits for the builder's output to pass `re` (a choice re-renders it); returns it. */
const waitOut = (page, re) => until(page, ([s, f]) => { const v = document.querySelector('.lb-out textarea')?.value ?? ''; return new RegExp(s, f).test(v) && v; }, [re.source, re.flags], { timeout: 10_000 }).then(async (v) => v || builderOut(page));
const comparing = (page) => until(page, () => window.__vis('.app')?.classList.contains('comparing'), null, { timeout: 20_000 });
const at = (page, path) => until(page, (p) => location.pathname === p, path, { timeout: 10_000 });
/** Opens the palette, types `query`, and returns the top hit's title once it matches `re` (or whatever it is then). */
async function paletteTop(page, query, re) {
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+k`);
  const box = page.locator('.palette input');
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  await box.fill(query);
  const title = () => document.querySelector('.palette [role=option] .pl-title')?.textContent ?? null;
  await until(page, ([s, f]) => new RegExp(s, f).test(document.querySelector('.palette [role=option] .pl-title')?.textContent ?? ''), [re.source, re.flags], { timeout: 5000 });
  return page.evaluate(title);
}

test('shared links: view, compare, convert and broken fragments', async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  await page.goto(`${t.base}/#a=${enc('{"id":42,"name":"Ada","roles":["x"]}')}&view=tree`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  let toasts = await waitToast(page, /Loaded shared JSON|broken/, { timeout: 20_000 });
  t.check(toasts.some((x) => /Loaded shared JSON/.test(x)), 'view link: toast', toasts);
  t.check(await until(page, () => location.hash === '', null, { timeout: 5000 }), 'view link: hash removed', await page.evaluate(() => location.hash));
  t.check((await waitTab(page, 'Tree')) === 'Tree', 'view link: tree tab', await tab(page));
  t.check(await waitEditor(page, /"name": "Ada"/), 'view link: formatted in editor', (await editorText(page)).slice(0, 100));

  // A compare link on the same page (a hash change).
  await page.evaluate((h) => (location.hash = h), `a=${enc('{"a":1}')}&b=${enc('{"a":2,"c":true}')}`);
  toasts = await waitToast(page, /shared comparison/, { timeout: 15_000 });
  t.check(toasts.some((x) => /shared comparison/.test(x) && /restores your previous document/.test(x)), 'compare link: toast', toasts);
  t.check(await comparing(page), 'compare link: compare view');
  t.check(await waitEditor(page, /"c": true/, '.pane-cmp'), 'compare link: modified editor', (await editorText(page, '.pane-cmp')).slice(0, 80));

  // Share while comparing: the link carries both documents and opens them again.
  await resetClip(page);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy comparison link' }).click();
  const shared = (await waitClip(page)) ?? '';
  t.check(new RegExp(`^${reEscape(t.base)}/#a=[\\w-]+&b=[\\w-]+$`).test(shared), 'share compare: link shape', shared.slice(0, 100));
  toasts = await waitToast(page, /Comparison link copied/, { timeout: 5000 });
  t.check(toasts.some((x) => /Comparison link copied/.test(x)), 'share compare: toast', toasts.slice(-2));
  const p2 = await t.context.newPage();
  await p2.goto(shared, { waitUntil: 'commit' });
  await t.app.waitEngine(p2);
  t.check(await comparing(p2), 'share compare: reopens in compare');
  t.check(await waitEditor(p2, /"c": true/, '.pane-cmp'), 'share compare: reopened docs', (await editorText(p2, '.pane-cmp')).slice(0, 80));
  await p2.close();

  // A convert link with a target language.
  await page.evaluate((h) => (location.hash = h), `a=${enc('{"user":{"id":1}}')}&view=convert&to=go`);
  t.check((await waitTab(page, 'Convert')) === 'Convert', 'convert link: tab', await tab(page));
  t.check(await until(page, () => /type \w+ struct/.test(window.__vis('#view-convert .cv-rows')?.textContent ?? ''), null, { timeout: 20_000 }), 'convert link: Go output', (await page.evaluate(() => window.__vis('#view-convert .cv-rows')?.textContent ?? '')).slice(0, 100));
  await resetClip(page);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const converted = (await waitClip(page)) ?? '';
  t.check(/&view=convert&to=go$/.test(converted), 'share convert: carries view and target', converted.slice(-50));

  // A broken link, then an ordinary anchor (no toast, the hash stays).
  await page.evaluate(() => (location.hash = 'a=%%%'));
  toasts = await waitToast(page, /broken or incomplete/, { timeout: 10_000 });
  t.check(toasts.some((x) => /broken or incomplete/.test(x)), 'broken link: error toast', toasts);
  await page.goto(`${t.base}/`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  // (Next.js syncs the address bar once as the page becomes interactive: the engine's mark is after that.)
  await page.evaluate(() => {
    window.__toasts.length = 0;
    location.hash = 'how-it-works';
  });
  t.check(await until(page, () => location.hash === '#how-it-works', null, { timeout: 5000 }), 'ordinary anchor: kept');
  // (Two frames for a hashchange handler to have shown a toast.)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  t.check((await page.evaluate(() => window.__toasts)).length === 0 && (await page.evaluate(() => location.hash)) === '#how-it-works', 'ordinary anchor: no toast', await page.evaluate(() => window.__toasts));
});

test('shared links: landing pages and URL documents', async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  // A landing page with a link: the link's documents win over the page's sample.
  await page.goto(`${t.base}/tools/json-diff#a=${enc('{"mine":1}')}&b=${enc('{"mine":2}')}`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  await waitToast(page, /shared comparison/, { timeout: 20_000 });
  t.check(await waitEditor(page, /"mine": 1/), 'landing page link: original document', (await editorText(page)).slice(0, 50));
  t.check(await waitEditor(page, /"mine": 2/, '.pane-cmp'), 'landing page link: modified document', (await editorText(page, '.pane-cmp')).slice(0, 50));

  // A URL instead of a document (same origin).
  const url = `${t.base}/examples/api-response.json`;
  const host = new URL(t.base).hostname;
  await page.goto(`${t.base}/#a=${encodeURIComponent(url)}&view=table`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  const toasts = await waitToast(page, new RegExp(`Loaded ${reEscape(host)}|broken|Could not`), { timeout: 20_000 });
  t.check(toasts.some((x) => x.startsWith(`Loaded ${host}`)), 'URL link: the toast names the host', toasts);
  t.check((await waitTab(page, 'Table')) === 'Table', 'URL link: table tab', await tab(page));
});

test('handoff: another origin opens documents and a comparison', async (t) => {
  const { page, context } = t;
  await context.addInitScript(TOAST_RECORDER);
  // The handoff needs window.opener, so `/` must not cut it (next.config.ts sends unsafe-none there).
  const res = await page.request.get(`${t.base}/`);
  t.check(res.headers()['cross-origin-opener-policy'] === 'unsafe-none', '/ sends Cross-Origin-Opener-Policy: unsafe-none', res.headers()['cross-origin-opener-policy']);
  // The partner page publishes /integrate's handoff function (the copy-paste snippet), pointed at this build.
  const partnerOrigin = await serveHtml(`<!doctype html><meta charset="utf-8"><button id="big">Open big</button><button id="cmp">Open compare</button><button id="url">Open url</button><pre id="out"></pre><script>
    const origin = ${JSON.stringify(t.base)};
    const out = (s) => document.getElementById('out').textContent += s + '\\n';
    function openInToolKumar(json, { compare, view, to } = {}) {
      const text = (value) => typeof value === 'string' || value === undefined ? value : JSON.stringify(value);
      const tab = window.open(origin + '/#handoff', '_blank');
      if (!tab) return Promise.reject(new Error('The browser blocked the tab'));
      return new Promise((resolve, reject) => {
        const fail = (why) => done(new Error('Tool Kumar: ' + why));
        const timer = setTimeout(() => fail('no answer'), 60000);
        function done(error) { clearTimeout(timer); removeEventListener('message', onMessage); error ? reject(error) : resolve(tab); }
        function onMessage(e) {
          if (e.source !== tab || e.origin !== origin) return;
          const kind = e.data && e.data.toolkumar;
          if (kind === 'ready') tab.postMessage({ toolkumar: 'open', a: text(json), b: text(compare), view, to }, origin);
          else if (kind === 'opened') done();
          else if (kind === 'error') fail(e.data.reason);
        }
        addEventListener('message', onMessage);
      });
    }
    const big = JSON.stringify({ items: Array.from({ length: 40000 }, (_, i) => ({ id: i, name: 'item ' + i, tags: ['a', 'b'], n: i / 7 })) });
    document.getElementById('big').onclick = () => openInToolKumar(big, { view: 'table' }).then(() => out('big opened'), (e) => out('big error ' + e.message));
    document.getElementById('cmp').onclick = () => openInToolKumar({ a: 1, b: [1, 2] }, { compare: { a: 2, b: [1, 2, 3] } }).then(() => out('cmp opened'), (e) => out('cmp error ' + e.message));
    document.getElementById('url').onclick = () => { window.open(origin + '/#a=' + encodeURIComponent(origin + '/examples/api-response.json') + '&view=tree', '_blank', 'noopener'); out('url opened'); };
  </script>`);
  const host = new URL(partnerOrigin.origin).host;
  const partner = await context.newPage();
  const promised = (x) => until(partner, (x) => { const o = document.querySelector('#out')?.textContent ?? ''; return (o.includes(x) || o.includes('error')) && o.trim().split('\n').pop(); }, x, { timeout: 30_000 });
  try {
    await partner.goto(`${partnerOrigin.origin}/`, { waitUntil: 'load' });
    for (const id of ['big', 'cmp']) {
      const popupPromise = context.waitForEvent('page');
      await partner.locator(`#${id}`).click();
      const popup = await popupPromise;
      const out = await promised(`${id} opened`);
      t.check(out === `${id} opened`, `handoff #${id}: the partner's promise resolves`, out);
      const toasts = await waitToast(popup, /Opened JSON sent by|broken|error/i, { timeout: 20_000 });
      t.check(toasts.some((x) => x.startsWith(`Opened JSON sent by ${host}`)), `handoff #${id}: the toast names the sender`, toasts);
      if (id === 'big') {
        t.check((await waitTab(popup, 'Table')) === 'Table', 'handoff #big: table view', await tab(popup));
        t.check((await popup.evaluate(() => location.href)) === t.base + '/', 'handoff #big: the address is clean', await popup.evaluate(() => location.href));
      } else t.check(await comparing(popup), 'handoff #cmp: compare view');
      await popup.close();
    }
    const popupPromise = context.waitForEvent('page');
    await partner.locator('#url').click();
    const popup = await popupPromise;
    t.check((await promised('url opened')) === 'url opened', 'handoff #url: the partner opened it');
    await t.app.waitEngine(popup);
    t.check(await popup.evaluate(() => window.opener === null), 'handoff #url: noopener cuts the opener');
    const toasts = await waitToast(popup, /Loaded |broken|Could not/, { timeout: 20_000 });
    t.check(toasts.some((x) => x.startsWith(`Loaded ${new URL(t.base).hostname}`)), 'handoff #url: the document loads', toasts);
    await popup.close();
  } finally {
    await partner.close();
    await partnerOrigin.close();
  }
});

test('integrate builder: output modes, copying and a working local link', async (t) => {
  const { page, context } = t;
  await t.open('/integrate', { tool: false });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  t.assert(await waitBuilder(page), 'builder is ready');
  const md = await builderOut(page);
  t.check(/^\[!\[View in Tool Kumar\]\(https:\/\/tools\.vikasmaur\.com\/badges\/view-in-tool-kumar\.svg\)\]\(https:\/\/tools\.vikasmaur\.com\/#a=[\w-]+&view=tree\)$/.test(md), 'builder: Markdown by default', md.slice(0, 100));
  await page.getByRole('radio', { name: 'Link' }).click();
  const link = await waitOut(page, /^https:/);
  t.check(/^https:\/\/tools\.vikasmaur\.com\/#a=[\w-]+&view=tree$/.test(link), 'builder: link mode', link.slice(0, 80));
  await page.getByRole('radio', { name: 'Compare two' }).click();
  const compareLink = await waitOut(page, /#a=[\w-]+&b=[\w-]+$/);
  t.check(/#a=[\w-]+&b=[\w-]+$/.test(compareLink), 'builder: compare link', compareLink.slice(0, 80));
  await page.getByRole('radio', { name: 'HTML' }).click();
  const html = await waitOut(page, /^<a /);
  t.check(html.startsWith(`<a href="${LIVE}/#a=`) && html.includes('<picture>'), 'builder: HTML with a picture (light and dark)', html.slice(0, 80));
  await page.getByRole('radio', { name: 'White' }).click();
  const white = await waitOut(page, /compare-in-tool-kumar-dark\.svg/);
  t.check(white.includes('compare-in-tool-kumar-dark.svg') && !white.includes('<picture>'), 'builder: white badge', white.slice(0, 120));
  await resetClip(page);
  await page.locator('.lb-copy').click();
  const copied = await waitClip(page);
  t.check(copied === (await builderOut(page)), 'builder: Copy copies the output', copied?.slice(0, 60));
  // Arrow keys move within a choice.
  await page.getByRole('radio', { name: 'HTML' }).focus();
  await page.keyboard.press('ArrowRight');
  t.check(await until(page, () => document.querySelector('.link-builder [role=radio][aria-checked=true]') && [...document.querySelectorAll('.link-builder [role=radio]')].some((r) => r.textContent.trim() === 'Link' && r.getAttribute('aria-checked') === 'true'), null, { timeout: 3000 }), 'builder: arrow keys move the choice');
  // The comparison link opens (served by this build instead of the live site).
  const popup = await context.newPage();
  await popup.goto(compareLink.replace(LIVE, t.base), { waitUntil: 'commit' });
  await t.app.waitEngine(popup);
  t.check(await waitEditor(popup, /"Ada King"/, '.pane-cmp'), 'builder: its link opens the comparison');
  await popup.close();
});

test('the ways to /integrate: status bar, palette, navbar, phone menu, translations', async (t) => {
  const { page } = t;
  await t.open('/');
  await page.locator('.sb-integrate').click();
  t.check(await at(page, '/integrate'), 'status bar: Integrate opens /integrate', page.url());
  t.check(/Open your JSON in Tool Kumar/.test(await page.locator('.ig-hero h1:visible').innerText()), 'integrate: heading');
  await t.open('/');
  const top = await paletteTop(page, 'integrate', /Integrate Tool Kumar into your site/);
  t.check(/Integrate Tool Kumar into your site/.test(top ?? ''), 'palette: Integrate is the top hit', top);
  await page.keyboard.press('Enter');
  t.check(await at(page, '/integrate'), 'palette: opens /integrate', page.url());
  await t.open('/de');
  t.check((await page.locator('.sb-integrate:visible').innerText()) === 'Einbinden', 'German status bar label');
  const deTop = await paletteTop(page, 'einbinden', /Tool Kumar in deine Website einbinden/);
  t.check(/Tool Kumar in deine Website einbinden/.test(deTop ?? ''), 'German palette: the top hit', deTop);
  await page.keyboard.press('Escape');

  await t.open('/tools', { tool: false });
  await page.locator('.nav-links a:visible', { hasText: 'Integrate' }).click();
  t.check(await at(page, '/integrate'), 'navbar: Integrate opens /integrate', page.url());
  const current = await until(page, () => window.__vis('.nav-links a[aria-current="page"]')?.textContent === 'Integrate' && 'Integrate', null, { timeout: 5000 });
  t.check(current === 'Integrate', 'navbar: Integrate is marked current', await page.evaluate(() => window.__vis('.nav-links a[aria-current="page"]')?.textContent));
  await page.setViewportSize({ width: 390, height: 800 });
  await t.open('/tools', { tool: false });
  t.check(!(await page.locator('.nav-links').isVisible()) && (await page.locator('.nav-menu summary').isVisible()), 'phone: inline links hidden, menu shown');
  await page.locator('.nav-menu summary').click();
  t.check(await page.locator('.nav-menu-panel a', { hasText: 'Integrate' }).isVisible(), 'phone: the menu opens');
  await page.keyboard.press('Escape');
  t.check(!(await page.locator('.nav-menu').evaluate((d) => d.open)) && (await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY')), 'phone: Esc closes it and focuses its button');
  await page.locator('.nav-menu summary').click();
  await page.locator('.nav-menu-panel a', { hasText: 'Integrate' }).click();
  const closed = (await at(page, '/integrate')) && (await until(page, () => window.__vis('.nav-menu')?.open === false, null, { timeout: 5000 }));
  t.check(closed, 'phone: a menu link navigates and the menu closes', page.url());
  await page.setViewportSize({ width: 1280, height: 800 });
  await t.open('/ru/tools', { tool: false });
  const ru = await page.evaluate(() => [window.__vis('.nav-links a[href="/integrate"]')?.textContent, window.__vis('.site-footer a[href="/integrate"]')?.textContent]);
  t.check(ru[0] === 'Интеграция' && ru[1] === 'Добавьте Tool Kumar на свой сайт', 'Russian navbar and footer labels', ru);
});

test('/integrate: snippets, the code language switch and logo downloads', async (t) => {
  const { page, context } = t;
  await t.open('/integrate', { tool: false });
  await resetClip(page);
  await page.locator('.ig-copy').first().click();
  t.check(((await waitClip(page)) ?? '').startsWith('// A link that opens `json` in Tool Kumar'), 'snippet copy', await page.evaluate(() => window.__clip?.slice(0, 50)));
  // JavaScript / TypeScript: one choice for every block, kept in localStorage, applied before paint.
  await page.evaluate(() => localStorage.removeItem('jf:codeLang'));
  await page.reload({ waitUntil: 'load' });
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.ig-snippet')].map((s) => (getComputedStyle(s.querySelector('.snip-ts')).display !== 'none' ? 'ts' : 'js')).join(','));
  t.check((await shown()) === 'js,js', 'code language: JavaScript by default', await shown());
  await page.locator('.code-langs [data-lang="ts"]').first().click();
  await until(page, () => document.documentElement.dataset.codeLang === 'ts', null, { timeout: 5000 });
  t.check((await shown()) === 'ts,ts', 'code language: TypeScript everywhere', await shown());
  t.check((await page.evaluate(() => localStorage.getItem('jf:codeLang'))) === 'ts', 'code language: saved');
  await resetClip(page);
  await page.locator('.ig-copy').nth(1).click();
  t.check(((await waitClip(page)) ?? '').startsWith('interface ToolKumarOptions'), 'code language: Copy gives TypeScript', await page.evaluate(() => window.__clip?.slice(0, 50)));
  const other = await context.newPage();
  await other.goto(`${t.base}/integrate`, { waitUntil: 'commit' });
  // The page attribute is right before paint; the switch's own state follows once React hydrates.
  const switched = await until(other, () => document.querySelector('.code-langs [data-lang="ts"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 15_000 });
  t.check((await other.evaluate(() => document.documentElement.dataset.codeLang)) === 'ts' && switched, 'code language: kept in another tab after a reload');
  await page.locator('.code-langs [data-lang="js"]').first().click();
  t.check(await until(other, () => document.documentElement.dataset.codeLang === 'js', null, { timeout: 5000 }), 'code language: the other tab follows');
  await other.close();
  const html = await (await page.request.get(`${t.base}/integrate`)).text();
  t.check(html.indexOf('jf:codeLang') > 0 && html.indexOf('jf:codeLang') < html.indexOf('class="ig-snippet"'), 'code language: an inline script before the first block');
  t.check((await page.request.get(`${t.base}/toolkumar.js`)).status() === 404, 'no hosted toolkumar.js');

  for (const color of ['black', 'white'])
    for (const format of ['svg', 'png', 'webp']) {
      const href = `/brand/tool-kumar-logo-${color}.${format}`;
      const link = page.locator(`.ig-logo-dl a[href="${href}"]`);
      const res = await page.request.get(t.base + href);
      const type = res.headers()['content-type'] ?? '';
      t.check((await link.count()) === 1 && (await link.getAttribute('download')) !== null && res.status() === 200 && type.includes(format === 'svg' ? 'svg' : format) && res.headers()['access-control-allow-origin'] === '*', `logo ${color} ${format}: linked with download, served`, `${res.status()} ${type}`);
    }
  const download = page.waitForEvent('download');
  await page.locator('.ig-logo-dl a[href="/brand/tool-kumar-logo-black.png"]').click();
  t.check((await download).suggestedFilename() === 'tool-kumar-logo-black.png', 'logo: a click downloads the file');
});

test('share links too long to open: still copied, with a warning that says what opens them', { timeout: 240_000 }, async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  // Random base64 barely compresses, so the link is about as long as the JSON.
  const make = (mb) => JSON.stringify(Array.from({ length: Math.round((mb * 1e6) / 820) }, (_, i) => ({ i, d: randomBytes(600).toString('base64') })));
  for (const [mb, warning] of [[1.4, /opens (?:when clicked )?in Chrome, Edge and Safari, but not Firefox/], [2.6, /too long for any browser to open/]]) {
    await t.open('/', { timeout: 120_000 });
    await page.locator('.app:visible input[type=file]').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(make(mb)) });
    t.assert((await waitToast(page, /Opened big\.json/, { timeout: 120_000 })).some((x) => /Opened big\.json/.test(x)), `share ${mb} MB: the file opens`);
    await t.app.waitValid(page, { timeout: 120_000 });
    await resetClip(page);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    const seen = await waitToast(page, warning, { timeout: 60_000 });
    const copied = (await waitClip(page, { timeout: 30_000 })) ?? '';
    t.check(seen.some((x) => warning.test(x)), `share ${mb} MB of base64 JSON: the warning`, seen.slice(-2));
    t.check(copied.startsWith(`${t.base}/#a=`) && copied.length > 1024 * 1024, `share ${mb} MB: the link is still copied`, { length: copied.length });
    if (mb > 2) {
      await page.keyboard.press('Alt+6');
      await until(page, () => !!window.__vis('.pane-cmp .ed-body'), null, { timeout: 20_000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy comparison link' }).click();
      t.check((await waitToast(page, /Share the documents as files instead/, { timeout: 60_000 })).some((x) => /Share the documents as files instead/.test(x)), 'share too long in Compare: names both documents');
      await page.keyboard.press('Alt+1');
      await until(page, () => !window.__vis('.pane-cmp .ed-body'), null, { timeout: 20_000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy link' }).click();
      await waitToast(page, /Share the JSON as a file instead/, { timeout: 60_000 });
      const acts = await until(page, () => { const a = [...document.querySelectorAll('.toasts .toast-act')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()); return a.length && a; }, null, { timeout: 5000 });
      t.check(JSON.stringify(acts) === '["Download"]', 'share too long: Download offered', acts);
    }
  }
});
