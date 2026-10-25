// Share links: long ones opened whole, cut where Chrome's and Edge's address bar cuts a paste (exactly
// 512,000 characters), other broken links, the app's paste warning, /integrate's warning and Open link
// button; and the viewer's Share menu, its right-click row and palette commands (a link, or a "View in
// Tool Kumar" / "Compare in Tool Kumar" button in Markdown or HTML).
// Ported from selftest/sharelink/check.mjs (15 checks) and snippets.mjs (20 checks).
import { defaults, test } from '../../lib/api.mjs';
import { MOD, PASTED, TOAST_RECORDER, docOf, docText, enc, poll, resetClip, setDoc, toastText, until, waitClip, waitLoaded, waitToast } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 900, tags: ['share'] });

// The user's 5.3 MB one-line document behind the 512,000-character cut (regenerated, never committed).
const USER = 'user-5mb.json';
const LIVE = 'https://tools.vikasmaur.com';

/** A full load of url (never a same-document hash change), with toasts recorded from the first paint. */
async function load(t, url) {
  await t.page.goto('about:blank');
  await t.page.goto(url, { waitUntil: 'commit' });
  await t.app.waitEngine(t.page);
}

test('long links: whole, cut at 512,000 characters, broken elsewhere, in German', { timeout: 120_000 }, async (t) => {
  const { page } = t;
  await t.context.addInitScript(TOAST_RECORDER);
  const doc = docText(USER);
  const hash = '#a=' + enc(doc);
  const whole = t.base + '/' + hash;
  t.check(whole.length > PASTED && whole.length < 1024 * 1024, 'the whole link is between 500 KB and 1 MB', whole.length);
  // 1. The whole link opens the document.
  await load(t, whole);
  let got = await waitToast(page, /Loaded|broken|cut/, { timeout: 30_000 });
  t.check(got.some((x) => /Loaded shared JSON/.test(x)) && !got.some((x) => /broken|cut short/.test(x)), 'the whole link opens the document', got);
  const addr = await page.evaluate(() => location.href);
  t.check(addr === t.base + '/', 'the fragment leaves the address bar', addr.slice(0, 60));
  // 2. Cut where the address bar cuts a paste.
  await load(t, whole.slice(0, PASTED));
  got = await waitToast(page, /./, { timeout: 15_000 });
  t.check(got.some((x) => /That link was cut short: Chrome and Edge keep only the first 500 KB/.test(x)), 'a link cut at 512,000 characters says it was cut', got);
  // 3. Broken at another length: the general message.
  await load(t, whole.slice(0, 400_000));
  got = await waitToast(page, /./, { timeout: 15_000 });
  t.check(got.some((x) => /That share link is broken or incomplete/.test(x)) && !got.some((x) => /cut short/.test(x)), 'a link broken elsewhere keeps the general message', got);
  // A cut that lands in the separator before the next pair (the parser says 'broken').
  const odd = t.base + '/#a=' + 'A'.repeat(PASTED - (t.base + '/#a=').length - 2) + '&b';
  t.check(odd.length === PASTED, 'a 512,000-character link cut after &b', odd.length);
  await load(t, odd);
  got = await waitToast(page, /./, { timeout: 15_000 });
  t.check(got.some((x) => /cut short/.test(x)), 'cut inside the pairs: also says it was cut', got);
  // 4. The German page: the translated message.
  const de = t.base + '/de' + whole.slice(t.base.length + 1, PASTED - 2);
  await load(t, de);
  got = await waitToast(page, /./, { timeout: 15_000 });
  t.check(de.length === PASTED && got.some((x) => /Dieser Link wurde gekürzt/.test(x)), 'German: the translated message', { got, len: de.length });
});

test("sharing a 509 KB link warns about pasting; /integrate's warning and Open link", { timeout: 120_000 }, async (t) => {
  const { page, context } = t;
  await context.addInitScript(TOAST_RECORDER);
  // Open link points at the live site: serve it from this build instead.
  await context.route(`${LIVE}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(LIVE, t.base) }) }));
  const doc = docText(USER);
  await load(t, t.base + '/#a=' + enc(doc));
  await waitToast(page, /Loaded/, { timeout: 30_000 });
  t.assert(await waitLoaded(page, doc, { timeout: 30_000 }), 'the shared document is open');
  // 5. Share it from the app: the paste warning.
  await page.evaluate(() => (window.__toasts.length = 0));
  await resetClip(page);
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  let got = await waitToast(page, /address bar/, { timeout: 15_000 });
  t.check(got.some((x) => /Link copied \(\d+ KB\)\. It opens when clicked, but pasted into Chrome's or Edge's address bar it gets cut at 500 KB\./.test(x)), 'sharing a 509 KB link warns about pasting', got);
  const shared = await waitClip(page);

  // 6. /integrate: the warning and Open link.
  await t.open('/integrate', { tool: false });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  await until(page, () => document.querySelectorAll('.link-builder .ed.hl-on').length >= 2, null, { timeout: 20_000 });
  const openBtn = () => page.evaluate(() => { const a = document.querySelector('.lb-open'); return a ? { tag: a.tagName, href: a.getAttribute('href')?.length ?? 0, text: a.textContent.trim(), target: a.target, rel: a.rel } : null; });
  const small = await poll(async () => { const b = await openBtn(); return b?.href ? b : null; }, { timeout: 10_000 });
  t.check(small?.tag === 'A' && small.href > 30 && small.target === '_blank' && /noopener/.test(small.rel) && small.text === 'Open link', 'Open link opens the sample in a new tab', small);
  await page.getByRole('radio', { name: 'Link' }).click();
  await page.locator('.link-builder .ed').first().click({ position: { x: 300, y: 40 } });
  await page.keyboard.press(`${MOD}+a`);
  await page.evaluate((d) => {
    const ta = document.querySelector('.link-builder .ed textarea');
    const dt = new DataTransfer();
    dt.setData('text/plain', d);
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    ta.dispatchEvent(e);
  }, doc);
  await poll(async () => (await openBtn())?.href > PASTED, { timeout: 30_000 });
  const outLink = await page.evaluate(() => document.querySelector('.lb-open')?.getAttribute('href') ?? '');
  let back = null;
  try {
    back = docOf(outLink);
  } catch {}
  // (Each browser's compressor makes its own link; the old check compared Chromium's with the user's
  // Chromium-made link byte for byte. Here: the builder's link equals the app's Share link in every engine.)
  const param = (u) => new URLSearchParams(u.slice(u.indexOf('#') + 1)).get('a');
  t.check(back === doc && !!shared && param(outLink) === param(shared), 'Open link carries the whole link, which opens to the document', { open: outLink.length, share: shared?.length });
  const warn = await page.evaluate(() => [...document.querySelectorAll('.lb-warn')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()));
  t.check(warn.some((w) => /^At \d+ KB, this link opens when clicked, but pasted into Chrome's or Edge's address bar it gets cut at 500 KB\.$/.test(w)), 'the builder warns about pasting', warn);
  const hint = await page.evaluate(() => [...document.querySelectorAll('.lb-hint')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).find((x) => /long\./.test(x)));
  t.check(/Chrome and Edge cut a pasted link at 500 KB/.test(hint ?? ''), 'the hint names the paste limit', hint);
  // Click it: a new tab opens the document.
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15_000 }), page.locator('a.lb-open').click()]);
  const pt = await waitToast(popup, /Loaded|broken|cut/, { timeout: 45_000 });
  t.check(pt.some((x) => /Loaded shared JSON/.test(x)), 'clicking Open link opens the document in a new tab', { toasts: pt, url: popup.url().slice(0, 50) });
  await popup.close();
  // The Open link button sits next to Copy.
  const geo = await page.evaluate(() => { const r = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }; return { open: r('.lb-open'), copy: r('.lb-copy') }; });
  t.check(geo.open[1] === geo.copy[1] && geo.open[0] + geo.open[2] <= geo.copy[0], 'Open link sits left of Copy, on one line', geo);
});

// ── snippets.mjs: the Share menu, its right-click row and the palette ──────────────────────────

const A = '{"name":"Ada","roles":["author","mathematician"]}';
const B = '{"name":"Ada King","roles":["author"]}';

/** Types `text` into an editor (a real typing path) and waits until the tool has it. */
async function type(page, which, text) {
  await page.locator(`#${which}`).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(text);
  if (which === 'input') return waitLoaded(page, text);
  return poll(async () => (await page.evaluate(() => document.getElementById('input2').value)) === text, { timeout: 10_000 });
}
/** What the next copy is, after `action`. */
async function copied(page, action) {
  await resetClip(page);
  await action();
  return (await waitClip(page)) ?? '';
}
const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].filter((i) => i.getClientRects().length).map((i) => [i.textContent.trim(), i.tagName, i.getAttribute('href'), i.getAttribute('target')]));
const waitMenuItems = (page) => until(page, () => [...document.querySelectorAll('.menu [role="menuitem"]')].some((i) => i.getClientRects().length), null, { timeout: 5000 });

test('the Share menu: link, Markdown and HTML buttons, the keyboard, the right-click row, the palette', async (t) => {
  const { page } = t;
  const base = t.base;
  await t.open('/');
  t.assert(await type(page, 'input', A), 'the document is in');
  const share = page.getByRole('button', { name: 'Share', exact: true });
  t.check((await share.getAttribute('aria-haspopup')) === 'menu', 'Share is a menu button');
  await share.click();
  await waitMenuItems(page);
  const items = await menuItems(page);
  t.check(JSON.stringify(items.map((i) => i[0])) === JSON.stringify(['Copy link', 'Copy Markdown button', 'Copy HTML button', 'Make a button', 'Handoff docs (JSON of any size)']), 'the menu: link, Markdown, HTML, builder, handoff docs', items);
  t.check(items[3]?.[2] === '/integrate#builder' && items[4]?.[2] === '/integrate#handoff' && items[4]?.[3] === '_blank', 'the docs open on /integrate in a new tab', items.slice(3));
  const focused = await until(page, () => document.activeElement?.textContent?.trim() === 'Copy link' && 'Copy link', null, { timeout: 3000 }).then(async (v) => v || page.evaluate(() => document.activeElement?.textContent?.trim()));
  t.check(focused === 'Copy link', 'the first item has focus', focused);
  let md = await copied(page, () => page.getByRole('menuitem', { name: 'Copy Markdown button' }).click());
  t.check(md.startsWith(`[![View in Tool Kumar](${base}/badges/view-in-tool-kumar.svg)](${base}/#a=`) && md.endsWith('&view=format)'), 'Markdown: the View button around the link', md.slice(0, 120));
  let opens = false;
  try {
    opens = docOf(md.slice(md.indexOf('](' + base + '/#') + 2, -1)) === A;
  } catch {}
  t.check(opens, 'its link opens this JSON');
  const toast = await until(page, () => [...document.querySelectorAll('.toast')].map((x) => x.textContent).find((x) => /Markdown button copied/.test(x)), null, { timeout: 3000 });
  t.check(/Markdown button copied\. The data lives in its link/.test(toast ?? ''), 'it says what was copied', toast ?? (await toastText(page)));
  await share.click();
  const html = await copied(page, () => page.getByRole('menuitem', { name: 'Copy HTML button' }).click());
  t.check(/^<a href="[^"]+&amp;view=format"><picture><source media="\(prefers-color-scheme: dark\)" srcset="[^"]+view-in-tool-kumar-dark\.svg"><img src="[^"]+view-in-tool-kumar\.svg" alt="View in Tool Kumar" width="158" height="28"><\/picture><\/a>$/.test(html), 'HTML: the button, light or dark by the reader', html.slice(0, 120));
  await share.click();
  const link = await copied(page, () => page.getByRole('menuitem', { name: 'Copy link' }).click());
  let linkDoc = null;
  try {
    linkDoc = docOf(link);
  } catch {}
  t.check(link.startsWith(base + '/#a=') && linkDoc === A, 'Copy link: the link alone', link.slice(0, 60));
  // From the keyboard: Enter opens, ↓ ↓ Enter picks HTML.
  const kb = await copied(page, async () => {
    await share.focus();
    await page.keyboard.press('Enter');
    await until(page, () => document.activeElement?.textContent?.trim() === 'Copy link', null, { timeout: 3000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await until(page, () => document.activeElement?.textContent?.trim() === 'Copy HTML button', null, { timeout: 3000 });
    await page.keyboard.press('Enter');
  });
  t.check(kb.startsWith('<a href='), 'keyboard: Enter, ↓ ↓, Enter copies the HTML button', kb.slice(0, 40));

  // The right-click menu of the input.
  await page.locator('#input').click({ button: 'right' });
  await until(page, () => !!document.querySelector('.menu.ctx'), null, { timeout: 5000 });
  const row = await page.evaluate(() => { const g = [...document.querySelectorAll('.menu.ctx .mi-row')].find((r) => r.firstElementChild.textContent === 'Share'); return g ? { text: g.firstElementChild.textContent, opts: [...g.querySelectorAll('[role=menuitemradio]')].map((b) => b.textContent) } : null; });
  t.check(row?.text === 'Share' && JSON.stringify(row.opts) === '["Link","Markdown","HTML"]', 'right-click: Share · Link · Markdown · HTML', row);
  md = await copied(page, () => page.locator('.menu.ctx [role=menuitemradio]', { hasText: 'Markdown' }).click());
  t.check(md.startsWith('[![View in Tool Kumar]('), 'right-click Markdown copies the button', md.slice(0, 40));

  // The palette.
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+k`);
  await page.locator('.palette input').waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.type('html button');
  const hit = await until(page, () => { const x = document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim(); return /Copy share link as an HTML button/.test(x ?? '') && x; }, null, { timeout: 5000 }).then(async (v) => v || page.evaluate(() => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim()));
  const pal = await copied(page, () => page.keyboard.press('Enter'));
  t.check(/Copy share link as an HTML button/.test(hit ?? '') && pal.startsWith('<a href='), 'palette: "Copy share link as an HTML button"', { hit, pal: pal.slice(0, 30) });
});

test('Compare: the comparison link and the Compare button', { allowErrors: true }, async (t) => {
  const { page } = t;
  const base = t.base;
  await t.open('/');
  t.assert(await type(page, 'input', A), 'the original is in');
  await page.getByRole('tab', { name: 'Compare' }).click();
  await until(page, () => document.querySelector('.pane-cmp') && !document.querySelector('.pane-cmp').hidden, null, { timeout: 10_000 });
  t.assert(await type(page, 'input2', B), 'the modified document is in');
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await share.click();
  await waitMenuItems(page);
  const first = (await menuItems(page))[0]?.[0];
  t.check(first === 'Copy comparison link', 'in Compare: Copy comparison link', first);
  const md = await copied(page, () => page.getByRole('menuitem', { name: 'Copy Markdown button' }).click());
  const cl = md.slice(md.indexOf('](' + base + '/#') + 2, -1);
  let both = false;
  try {
    both = docOf(cl, 'a') === A && docOf(cl, 'b') === B;
  } catch {}
  t.check(md.startsWith('[![Compare in Tool Kumar](') && both, 'Compare: the Compare button, both documents in its link', md.slice(0, 80));
  const toast = await until(page, () => [...document.querySelectorAll('.toast')].map((x) => x.textContent).find((x) => /Both documents live in its link/.test(x)), null, { timeout: 3000 });
  t.check(!!toast, 'it says both documents are in it', toast ?? (await toastText(page)));
  await page.locator('#input2').click({ button: 'right' });
  await until(page, () => !!document.querySelector('.menu.ctx'), null, { timeout: 5000 });
  const row2 = await page.evaluate(() => [...document.querySelectorAll('.menu.ctx .mi-row')].map((r) => r.firstElementChild.textContent).find((x) => x === 'Share'));
  t.check(row2 === 'Share', 'right-click in the Compare editor: Share', row2);
  const h2 = await copied(page, () => page.locator('.menu.ctx [role=menuitemradio]', { hasText: 'HTML' }).click());
  t.check(/alt="Compare in Tool Kumar" width="180"/.test(h2), 'its HTML is the Compare button', h2.slice(-120));
  await page.keyboard.press('Escape');
  // (WebKit's "ResizeObserver loop" warning on opening Compare is on main too.)
  const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e));
  t.check(!errs.length, 'no page errors', errs.slice(0, 3));
});

test('German: the Share menu and its message', async (t) => {
  const { page } = t;
  await t.open('/de');
  t.assert(await setDoc(page, A), 'the document is in');
  await page.getByRole('button', { name: 'Teilen', exact: true }).click();
  await waitMenuItems(page);
  const deItems = (await menuItems(page)).map((i) => i[0]);
  t.check(deItems.includes('Markdown-Button kopieren') && deItems.includes('Handoff-Doku (JSON jeder Größe)'), 'German: the menu is translated', deItems);
  await copied(page, () => page.getByRole('menuitem', { name: 'Markdown-Button kopieren' }).click());
  const toast = await until(page, () => [...document.querySelectorAll('.toast')].map((x) => x.textContent).find((x) => /Markdown-Button kopiert/.test(x)), null, { timeout: 3000 });
  t.check(!!toast, 'German: the message too', toast ?? (await toastText(page)));
});
