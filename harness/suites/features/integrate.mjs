// Shared-link routing, the View in Tool Kumar handoff, and /integrate's public
// navigation and download controls. Ported from tk-e2e/e2e.mjs (75 checks).
import { randomBytes } from 'node:crypto';
import { defaults, test } from '../../lib/api.mjs';
import { enc, serveHtml, TOAST_RECORDER, until, waitClip, waitToast } from './_helpers.mjs';

defaults({ engines: ['chromium'], width: 1280, height: 800, tags: ['integrate'] });

const LIVE = 'https://tools.vikasmaur.com';
const A = '{"name":"Ada","roles":["x"]}';

const tab = (page) => page.evaluate(() => window.__vis('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? '');
const editorText = (page, pane = '.pane-ed') => page.evaluate((p) => window.__vis(`${p} .ed-hl`)?.textContent ?? '', pane);
const waitTab = (page, name) => until(page, (n) => window.__vis('[role="tab"][aria-selected="true"]')?.textContent?.trim() === n && n, name);
const waitEditor = (page, re, pane = '.pane-ed') => until(page, ([s, f, p]) => new RegExp(s, f).test(window.__vis(`${p} .ed-hl`)?.textContent ?? ''), [re.source, re.flags, pane]);
const waitBuilder = (page) => until(page, () => !!document.querySelector('.link-builder .lb-out textarea') && !!document.querySelector('.link-builder .lb-preview a[href]'), null, { timeout: 20_000 });
const builderOut = (page) => page.locator('.lb-out textarea').inputValue();

test('shared links: view, compare, convert and broken fragments', async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  await page.goto(`${t.base}/#a=${enc('{"id":42,"name":"Ada","roles":["x"]}')}&view=tree`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  let toasts = await waitToast(page, /Loaded shared JSON|broken/, { timeout: 20_000 });
  t.check(toasts.some((x) => /Loaded shared JSON/.test(x)), 'view link: toast', toasts);
  t.check(await until(page, () => location.hash === '', null, { timeout: 5000 }), 'view link: hash removed');
  t.check((await waitTab(page, 'Tree')) === 'Tree', 'view link: tree tab', await tab(page));
  t.check(await waitEditor(page, /"name": "Ada"/), 'view link: formatted in editor', (await editorText(page)).slice(0, 100));

  await page.evaluate((h) => (location.hash = h), `a=${enc('{"a":1}')}&b=${enc('{"a":2,"c":true}')}`);
  toasts = await waitToast(page, /shared comparison/, { timeout: 15_000 });
  t.check(toasts.some((x) => /shared comparison/.test(x) && /restores your previous document/.test(x)), 'compare link: toast', toasts);
  t.check(await until(page, () => window.__vis('.app')?.classList.contains('comparing'), null, { timeout: 10_000 }), 'compare link: compare view');
  t.check(await waitEditor(page, /"c": true/, '.pane-cmp'), 'compare link: modified editor', (await editorText(page, '.pane-cmp')).slice(0, 80));

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy comparison link' }).click();
  const shared = await waitClip(page);
  t.check(new RegExp(`^${t.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/#a=[\\w-]+&b=[\\w-]+$`).test(shared), 'share compare: link shape', shared?.slice(0, 100));
  t.check(/Comparison link copied/.test(await page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '))), 'share compare: toast');
  const p2 = await t.context.newPage();
  await p2.goto(shared, { waitUntil: 'commit' });
  await t.app.waitEngine(p2);
  t.check(await until(p2, () => window.__vis('.app')?.classList.contains('comparing'), null, { timeout: 20_000 }), 'share compare: reopens in compare');
  t.check(await until(p2, () => /"c": true/.test(window.__vis('.pane-cmp .ed-hl')?.textContent ?? ''), null, { timeout: 20_000 }), 'share compare: reopened docs');
  await p2.close();

  await page.evaluate((h) => (location.hash = h), `a=${enc('{"user":{"id":1}}')}&view=convert&to=go`);
  t.check((await waitTab(page, 'Convert')) === 'Convert', 'convert link: tab', await tab(page));
  t.check(await until(page, () => /struct|type Root struct/.test(window.__vis('#view-convert')?.textContent ?? ''), null, { timeout: 20_000 }), 'convert link: go output');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const converted = await waitClip(page);
  t.check(/&view=convert&to=go$/.test(converted), 'share convert: carries view and target', converted?.slice(-50));

  await page.evaluate(() => (location.hash = 'a=%%%'));
  toasts = await waitToast(page, /broken or incomplete/, { timeout: 10_000 });
  t.check(toasts.some((x) => /broken or incomplete/.test(x)), 'broken link: error toast', toasts);
  await page.goto(`${t.base}/`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  await until(page, () => !!window.__vis('.sb-integrate'), null, { timeout: 10_000 });
  await page.evaluate(() => { window.__toasts.length = 0; location.hash = 'how-it-works'; });
  t.check(await until(page, () => location.hash === '#how-it-works', null, { timeout: 5000 }), 'ordinary anchor: kept');
  t.check((await page.evaluate(() => window.__toasts)).length === 0, 'ordinary anchor: no toast');
});

test('shared links: landing pages and URL documents', async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  await page.goto(`${t.base}/tools/json-diff#a=${enc('{"mine":1}')}&b=${enc('{"mine":2}')}`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  await waitToast(page, /shared comparison/, { timeout: 20_000 });
  t.check(await waitEditor(page, /"mine": 1/), 'landing page link: original document', (await editorText(page)).slice(0, 50));
  t.check(await waitEditor(page, /"mine": 2/, '.pane-cmp'), 'landing page link: modified document', (await editorText(page, '.pane-cmp')).slice(0, 50));

  const url = `${t.base}/examples/api-response.json`;
  await page.goto(`${t.base}/#a=${encodeURIComponent(url)}&view=table`, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  const toasts = await waitToast(page, /Loaded|Fetching/, { timeout: 20_000 });
  t.check(toasts.some((x) => /Loaded /.test(x)), 'URL link: loaded-host toast', toasts);
  t.check((await waitTab(page, 'Table')) === 'Table', 'URL link: table tab', await tab(page));
});

test('handoff: another origin opens documents and a comparison', async (t) => {
  const { page, context } = t;
  await context.addInitScript(TOAST_RECORDER);
  const partnerOrigin = await serveHtml(`<!doctype html><meta charset="utf-8"><button id="big">Open big</button><button id="cmp">Open compare</button><button id="url">Open url</button><pre id="out"></pre><script>
    const origin = ${JSON.stringify(t.base)};
    const out = (s) => document.getElementById('out').textContent += s + '\\n';
    function openInToolKumar(json, { compare, view, to } = {}) {
      const tab = window.open(origin + '/#handoff', '_blank');
      if (!tab) return Promise.reject(new Error('The browser blocked the tab'));
      return new Promise((resolve, reject) => {
        const done = (error) => { clearTimeout(timer); removeEventListener('message', onMessage); error ? reject(error) : resolve(tab); };
        const onMessage = (e) => {
          if (e.source !== tab || e.origin !== origin) return;
          const kind = e.data && e.data.toolkumar;
          if (kind === 'ready') tab.postMessage({ toolkumar: 'open', a: typeof json === 'string' ? json : JSON.stringify(json), b: compare === undefined ? undefined : typeof compare === 'string' ? compare : JSON.stringify(compare), view, to }, origin);
          else if (kind === 'opened') done();
          else if (kind === 'error') done(new Error(e.data.reason));
        };
        const timer = setTimeout(() => done(new Error('no answer')), 60000);
        addEventListener('message', onMessage);
      });
    }
    const big = JSON.stringify({ items: Array.from({ length: 40000 }, (_, i) => ({ id: i, name: 'item ' + i, tags: ['a', 'b'], n: i })) });
    document.getElementById('big').onclick = () => openInToolKumar(big, { view: 'table' }).then(() => out('big opened'), (e) => out('big error ' + e.message));
    document.getElementById('cmp').onclick = () => openInToolKumar({ a: 1, b: [1, 2] }, { compare: { a: 2, b: [1, 2, 3] } }).then(() => out('cmp opened'), (e) => out('cmp error ' + e.message));
    document.getElementById('url').onclick = () => { window.open(origin + '/#a=' + encodeURIComponent(origin + '/examples/api-response.json') + '&view=tree', '_blank', 'noopener'); out('url opened'); };
  </script>`,);
  const partner = await context.newPage();
  try {
    await partner.goto(`${partnerOrigin.origin}/`, { waitUntil: 'load' });
    for (const [id, expected, view] of [['big', 'big opened', 'Table'], ['cmp', 'cmp opened', null]]) {
      const popupPromise = context.waitForEvent('page');
      await partner.locator(`#${id}`).click();
      const popup = await popupPromise;
      await t.app.waitEngine(popup);
      t.check(await until(partner, (x) => document.querySelector('#out')?.textContent.includes(x), expected, { timeout: 20_000 }), `handoff #${id}: partner promise`);
      const host = new URL(partnerOrigin.origin).host;
      const toast = await until(popup, (h) => [...document.querySelectorAll('.toast')].map((x) => x.textContent).find((x) => new RegExp(h).test(x)), `Opened JSON sent by ${host}`, { timeout: 20_000 });
      t.check(!!toast, `handoff ${id}: toast names sender`, toast);
      if (view) t.check((await waitTab(popup, view)) === view, `handoff ${id}: ${view.toLowerCase()} view`, await tab(popup));
      else t.check(await until(popup, () => window.__vis('.app')?.classList.contains('comparing'), null, { timeout: 20_000 }), 'handoff compare: compare view');
      t.check((await popup.evaluate(() => location.hash)) === '', `handoff ${id}: URL clean`);
      await popup.close();
    }
    const popupPromise = context.waitForEvent('page');
    await partner.locator('#url').click();
    const popup = await popupPromise;
    await t.app.waitEngine(popup);
    t.check(await until(partner, () => document.querySelector('#out')?.textContent.includes('url opened'), null, { timeout: 5000 }), 'handoff #url: partner promise');
    t.check(await popup.evaluate(() => window.opener === null), 'handoff URL: noopener cuts the opener');
    t.check((await waitToast(popup, /Loaded /, { timeout: 20_000 })).some((x) => /Loaded /.test(x)), 'handoff URL: document loaded');
    await popup.close();
  } finally {
    await partner.close();
    await partnerOrigin.close();
  }
});

test('integrate builder: output modes, copying and a working local link', async (t) => {
  const { page, context } = t;
  await context.route(`${LIVE}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(LIVE, t.base) }) }));
  await t.open('/integrate', { tool: false });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  t.assert(await waitBuilder(page), 'builder is ready');
  t.check((await builderOut(page)).startsWith(`[![View in Tool Kumar](${LIVE}/badges/view-in-tool-kumar.svg)](${LIVE}/#a=`), 'builder: Markdown by default');
  await page.getByRole('radio', { name: 'Link' }).click();
  t.check(/^https:\/\/tools\.vikasmaur\.com\/#a=[\w-]+&view=tree$/.test(await builderOut(page)), 'builder: link mode');
  await page.getByRole('radio', { name: 'Compare two' }).click();
  t.check(await until(page, () => /#a=[\w-]+&b=[\w-]+$/.test(document.querySelector('.lb-out textarea')?.value ?? ''), null, { timeout: 10_000 }), 'builder: compare link');
  const compareLink = await builderOut(page);
  await page.getByRole('radio', { name: 'HTML' }).click();
  t.check((await builderOut(page)).includes('<picture>'), 'builder: HTML includes picture');
  await page.getByRole('radio', { name: 'White' }).click();
  t.check((await builderOut(page)).includes('compare-in-tool-kumar-dark.svg') && !(await builderOut(page)).includes('<picture>'), 'builder: white badge');
  await page.locator('.lb-copy').click();
  t.check((await page.evaluate(() => window.__clip)) === (await builderOut(page)), 'builder: copy');
  await page.getByRole('radio', { name: 'HTML' }).focus();
  await page.keyboard.press('ArrowRight');
  t.check((await page.getByRole('radio', { name: 'Link' }).getAttribute('aria-checked')) === 'true', 'builder: radio arrows');
  const popup = await context.newPage();
  await popup.goto(compareLink.replace(LIVE, t.base), { waitUntil: 'commit' });
  await t.app.waitEngine(popup);
  t.check(await waitEditor(popup, /"Ada King"/, '.pane-cmp'), 'builder link opens the comparison');
  await popup.close();
});

test('integrate navigation, language, snippets and logos', async (t) => {
  const { page, context } = t;
  await t.open('/');
  await page.locator('.sb-integrate').click();
  await page.waitForURL(`**/integrate`, { timeout: 10_000 });
  t.check(await until(page, () => location.pathname === '/integrate', null, { timeout: 5000 }), 'footer: Integrate opens /integrate');
  t.check(/Open your JSON in Tool Kumar/.test(await page.locator('.ig-hero h1').innerText()), 'integrate: heading');
  await t.open('/');
  await t.app.command(page, 'integrate');
  t.check(await until(page, () => location.pathname === '/integrate', null, { timeout: 10_000 }), 'palette: opens /integrate');
  await t.open('/de', { tool: false });
  t.check((await page.locator('.sb-integrate').innerText()) === 'Einbinden', 'German footer label');
  await t.app.command(page, 'einbinden');
  t.check(await until(page, () => /\/integrate$/.test(location.pathname), null, { timeout: 10_000 }), 'German palette opens Integrate');

  await t.open('/tools', { tool: false });
  await page.locator('.nav-links a', { hasText: 'Integrate' }).click();
  t.check(await until(page, () => location.pathname === '/integrate', null, { timeout: 10_000 }), 'navbar: Integrate opens /integrate');
  t.check((await page.locator('.content-page:not([style*="none"]) .nav-links a[aria-current="page"]').innerText()) === 'Integrate', 'navbar: Integrate is current');
  await page.setViewportSize({ width: 390, height: 800 });
  await t.open('/tools', { tool: false });
  t.check(!(await page.locator('.nav-links').isVisible()) && (await page.locator('.nav-menu summary').isVisible()), 'phone: inline links hidden and menu shown');
  await page.locator('.nav-menu summary').click();
  t.check(await page.locator('.nav-menu-panel a', { hasText: 'Integrate' }).isVisible(), 'phone: menu opens');
  await page.keyboard.press('Escape');
  t.check(!(await page.locator('.nav-menu').evaluate((d) => d.open)) && await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY'), 'phone: Esc closes and refocuses');
  await page.locator('.nav-menu summary').click();
  await page.locator('.nav-menu-panel a', { hasText: 'Integrate' }).click();
  t.check(await until(page, () => location.pathname === '/integrate', null, { timeout: 10_000 }), 'phone: menu link navigates');
  await t.open('/ru/tools', { tool: false });
  t.check((await page.locator('.nav-links a[href="/integrate"]').textContent()) === 'Интеграция' && (await page.locator('.site-footer a[href="/integrate"]').textContent()) === 'Добавьте Tool Kumar на свой сайт', 'Russian navbar and footer labels');

  await t.open('/integrate', { tool: false });
  await page.locator('.ig-copy').first().click();
  t.check((await page.evaluate(() => window.__clip)).startsWith('// A link that opens `json` in Tool Kumar'), 'snippet copy');
  await page.evaluate(() => localStorage.removeItem('jf:codeLang'));
  await page.reload({ waitUntil: 'load' });
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.ig-snippet')].map((s) => getComputedStyle(s.querySelector('.snip-ts')).display !== 'none' ? 'ts' : 'js').join(','));
  t.check((await shown()) === 'js,js', 'code language: JavaScript default');
  await page.locator('.code-langs [data-lang="ts"]').first().click();
  t.check((await shown()) === 'ts,ts' && (await page.evaluate(() => localStorage.getItem('jf:codeLang'))) === 'ts', 'code language: TypeScript saved');
  await page.locator('.ig-copy').nth(1).click();
  t.check((await page.evaluate(() => window.__clip)).startsWith('interface ToolKumarOptions'), 'code language: TypeScript copy');
  const other = await context.newPage();
  await other.goto(`${t.base}/integrate`, { waitUntil: 'load' });
  t.check(await until(other, () => document.documentElement.dataset.codeLang === 'ts', null, { timeout: 5000 }), 'code language: other tab follows storage');
  await page.locator('.code-langs [data-lang="js"]').first().click();
  t.check(await until(other, () => document.documentElement.dataset.codeLang === 'js', null, { timeout: 5000 }), 'code language: other tab follows changes');
  await other.close();
  const html = await (await page.request.get(`${t.base}/integrate`)).text();
  t.check(html.indexOf('jf:codeLang') > 0 && html.indexOf('jf:codeLang') < html.indexOf('class="ig-snippet"'), 'code language: inline script precedes snippets');
  t.check((await page.request.get(`${t.base}/toolkumar.js`)).status() === 404, 'no hosted toolkumar.js');

  await page.goto(`${t.base}/integrate`, { waitUntil: 'load' });
  for (const color of ['black', 'white']) for (const format of ['svg', 'png', 'webp']) {
    const href = `/brand/tool-kumar-logo-${color}.${format}`;
    const link = page.locator(`.ig-logo-dl a[href="${href}"]`);
    const res = await page.request.get(t.base + href);
    const type = res.headers()['content-type'] ?? '';
    t.check((await link.count()) === 1 && (await link.getAttribute('download')) !== null && res.status() === 200 && type.includes(format === 'svg' ? 'svg' : format) && res.headers()['access-control-allow-origin'] === '*', `logo ${color} ${format}: linked and served`, `${res.status()} ${type}`);
  }
  const download = page.waitForEvent('download');
  await page.locator('.ig-logo-dl a[href="/brand/tool-kumar-logo-black.png"]').click();
  t.check((await download).suggestedFilename() === 'tool-kumar-logo-black.png', 'logo click downloads PNG');
});

test('integrate: long links are copied with reach warnings', { timeout: 240_000 }, async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  const make = (mb) => JSON.stringify(Array.from({ length: Math.round(mb * 1e6 / 820) }, (_, i) => ({ i, d: randomBytes(600).toString('base64') })));
  for (const [mb, warning] of [[1.4, /opens (?:when clicked )?in Chrome, Edge and Safari, but not Firefox/], [2.6, /too long for any browser to open/]]) {
    await t.open('/', { timeout: 120_000 });
    const text = make(mb);
    await page.locator('.app:visible input[type=file]').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    t.assert(await until(page, () => /Opened big\.json/.test(document.querySelector('.toasts')?.textContent ?? ''), null, { timeout: 120_000 }), `share ${mb} MB file opens`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await until(page, (n) => (window.__toasts || []).length >= n, 3, { timeout: 30_000 });
    const seen = await page.evaluate(() => window.__toasts || []);
    const toast = seen.find((x) => warning.test(x));
    const copied = await page.evaluate(() => window.__clip);
    t.check(!!toast, `share ${mb} MB: reach warning`, seen);
    t.check(copied.startsWith(`${t.base}/#a=`) && copied.length > 1024 * 1024, `share ${mb} MB: link copied`, { length: copied.length });
    if (mb > 2) {
      await page.keyboard.press('Alt+6');
      await until(page, () => !!window.__vis('.pane-cmp .ed-body'), null, { timeout: 20_000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy comparison link' }).click();
      t.check(await until(page, () => (window.__toasts || []).some((x) => /Share the documents as files instead/.test(x)), null, { timeout: 30_000 }), 'share too long in Compare: names both documents');
      await page.keyboard.press('Alt+1');
      await until(page, () => !!window.__vis('.pane-ed .ed-body'), null, { timeout: 20_000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy link' }).click();
      t.check(await until(page, () => (window.__toasts || []).some((x) => /Share the JSON as a file instead/.test(x)), null, { timeout: 30_000 }), 'share too long: names file fallback');
      t.check(JSON.stringify(await page.locator('.toasts .toast-act').allInnerTexts()) === '["Download"]', 'share too long: Download offered');
    }
  }
});
