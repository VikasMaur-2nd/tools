// What the page loads once it is idle (the command palette, the shortcuts, the context menu, tooltips, the
// share buttons' markup, the JWT reader) used before it has loaded: right after the page opens, with that
// module held back until the check has acted. The action is taken once it loads, and no key typed meanwhile
// reaches the editor or is lost.
import { defaults, test } from '../../lib/api.mjs';
import { MOD, inputText, menu, poll, resetClip, setDoc, until, waitClip, waitMenu } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 900, tags: ['first-use'], timeout: 90_000 });

/**
 * Opens `path` with the lazily loaded chunks whose code matches `marker` held back until `release()`; the page's
 * own scripts (named in its HTML) load as always. `held()`: how many were held.
 */
async function openHeld(t, marker, path = '/') {
  const html = await (await t.fetch(t.base + path)).text();
  const first = new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), t.base).pathname));
  let release;
  const gate = new Promise((r) => (release = r));
  let held = 0;
  await t.page.route('**/_next/static/chunks/**/*.js', async (route) => {
    if (first.has(new URL(route.request().url()).pathname)) return route.continue();
    const res = await route.fetch();
    const body = await res.text();
    if (marker.test(body)) {
      held++;
      await gate;
    }
    await route.fulfill({ response: res, body });
  });
  await t.open(path);
  return { release: () => release(), held: () => held };
}

/** Waits until the module held back was asked for: it was still to load when it was used. */
const asked = async (t, h) => t.check(!!(await poll(() => h.held() > 0 || null, { timeout: 10_000 }).catch(() => null)), 'the module was still to load when it was used');

/** Puts `text` in the editor as a paste does, without waiting for it to be read. */
const paste = (page, text) =>
  page.evaluate((x) => {
    const ta = document.getElementById('input');
    ta.focus();
    ta.value = x;
    ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  }, text);

const DOC = '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}';

test('the palette opened at once: the command typed meanwhile runs, nothing typed reaches the editor', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Type a command/);
  await setDoc(page, DOC);
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.type('minify input');
  await page.keyboard.press('Enter');
  await asked(t, h);
  t.check((await inputText(page)) === DOC, 'nothing typed went into the editor while the palette loaded', await inputText(page));
  h.release();
  const done = await until(page, () => document.getElementById('input').value === '{"a":1,"b":[2]}' || null, null, { timeout: 15_000 });
  t.check(!!done, 'the command typed ran once the palette loaded (Minify input in place)', await inputText(page));
  t.check(!(await page.evaluate(() => document.querySelector('dialog.palette')?.open)), 'the palette is closed after it');
});

test('the palette opened at once and left with Esc: it never shows, nothing reaches the editor', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Type a command/);
  await setDoc(page, DOC);
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.type('abc');
  await page.keyboard.press('Escape');
  await asked(t, h);
  h.release();
  await page.waitForTimeout(1000);
  t.check(!(await page.evaluate(() => document.querySelector('dialog.palette')?.open)), 'the palette did not open');
  t.check((await inputText(page)) === DOC, 'the editor holds what it held', await inputText(page));
  // The palette works as before afterwards, typed into straight away.
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.type('format input');
  const q = await until(page, () => document.querySelector('dialog.palette[open] input')?.value || null, null, { timeout: 10_000 });
  t.check(q === 'format input', 'and next time it opens and takes what is typed', q);
});

test('the shortcuts opened at once show once loaded; opened and left with Esc they never show', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Type a command/);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('?');
  await asked(t, h);
  h.release();
  const shown = await until(page, () => document.querySelector('dialog.sheet')?.open || null, null, { timeout: 15_000 });
  t.check(!!shown, 'the shortcuts show once loaded');
  await page.keyboard.press('Escape');
  await until(page, () => !document.querySelector('dialog.sheet')?.open || null, null, { timeout: 5000 });
});

test('the shortcuts asked for and left with Esc before they load never show', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Type a command/);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('?');
  await page.keyboard.press('Escape');
  h.release();
  await page.waitForTimeout(1000);
  t.check(!(await page.evaluate(() => document.querySelector('dialog.sheet')?.open)), 'they did not show');
});

test('a right-click at once opens the menu once loaded, and a key pressed meanwhile moves in it', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Shift\+right-click: browser menu/);
  await setDoc(page, DOC);
  const box = await page.evaluate(() => window.__vis('.pane-ed .ed')?.getBoundingClientRect().toJSON());
  await page.mouse.click(box.left + 60, box.top + 30, { button: 'right' });
  await page.keyboard.press('ArrowDown');
  await asked(t, h);
  t.check((await inputText(page)) === DOC, 'the key did not reach the editor');
  h.release();
  const m = await waitMenu(page, true, { timeout: 15_000 });
  t.check(!!m?.open, 'the menu shows once loaded', m);
  const first = m?.items.find((x) => !x.startsWith('-'));
  t.check(!!first && m.focus === first.replace(/[✓[].*$/, ''), 'the arrow pressed meanwhile moved to its first item', m && { focus: m.focus, first });
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
});

test('the menu key and Esc before the menu loads: no menu, nothing reaches the editor', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /Shift\+right-click: browser menu/);
  await setDoc(page, DOC);
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  h.release();
  await page.waitForTimeout(1000);
  t.check(!(await menu(page)), 'no menu');
  t.check((await inputText(page)) === DOC, 'the keys reached nothing', await inputText(page));
});

test('a hover at once shows its tooltip once tooltips load', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /"tooltip"/);
  const btn = page.locator('button[aria-label="All commands"]').first();
  await t.app.hoverExposed(page, btn);
  await asked(t, h);
  h.release();
  const tip = await until(page, () => (document.querySelector('.tip.in')?.textContent || null), null, { timeout: 15_000 });
  t.check(tip === 'All commands', 'the tooltip of what was hovered shows', tip);
});

test('Copy Markdown button at once: the button is copied once its markup loads', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /View in Tool Kumar/);
  await setDoc(page, '{"a":1}');
  await resetClip(page);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy Markdown button' }).click();
  await asked(t, h);
  h.release();
  const md = await waitClip(page, { timeout: 15_000 });
  t.check(/^\[!\[View in Tool Kumar\]\(/.test(md ?? ''), 'the Markdown button is copied', md?.slice(0, 80));
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'early', exp: Math.floor(Date.now() / 1000) + 7200 })}.c2ln`;

test('a JWT pasted at once is read as one once the reader loads (never as invalid JSON)', async (t) => {
  const { page } = t;
  const h = await openHeld(t, /\[Bb\]earer/);
  const statuses = [];
  await page.evaluate(() => {
    window.__st = [];
    new MutationObserver(() => window.__st.push(window.__vis('.sb-l')?.textContent ?? '')).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await paste(page, JWT);
  await asked(t, h);
  h.release();
  const st = await until(page, () => (/^JWT · HS256/.test(window.__vis('.sb-l')?.textContent ?? '') ? window.__vis('.sb-l').textContent : null), null, { timeout: 15_000 });
  t.check(!!st, 'the status says JWT · HS256 once the reader loads', st ?? (await page.evaluate(() => window.__vis('.sb-l')?.textContent)));
  statuses.push(...(await page.evaluate(() => window.__st)));
  t.check(!statuses.some((s) => /^Invalid JSON/.test(s)), 'it never said Invalid JSON meanwhile', statuses.filter((s) => /Invalid/.test(s)).slice(0, 2));
});

test('a share link holding a JWT, opened as the page opens, is read as one', async (t) => {
  const { page } = t;
  const { deflateRawSync } = await import('node:zlib');
  const h = await openHeld(t, /\[Bb\]earer/, `/#a=${deflateRawSync(Buffer.from(JWT)).toString('base64url')}`);
  await asked(t, h);
  h.release();
  const st = await until(page, () => (/^JWT · HS256/.test(window.__vis('.sb-l')?.textContent ?? '') ? window.__vis('.sb-l').textContent : null), null, { timeout: 15_000 });
  t.check(!!st, 'the status says JWT · HS256', st ?? (await page.evaluate(() => window.__vis('.sb-l')?.textContent)));
});
