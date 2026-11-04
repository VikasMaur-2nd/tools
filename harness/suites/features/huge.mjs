// Huge-file mode (lib/huge, components/huge/HugeTool.tsx), driven by small files forced into it with
// localStorage['tk:hugeMin'] (and an index played slowly with tk:hugeSim): the tree's pages, Go to, the
// Format view's lines, streamed Find, the table, an invalid file's error, JSON Lines, Cancel, leaving huge
// mode, privacy classes, and screenshots in both themes on desktop and phone (HUGE_SHOTS=dir).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { MOD, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['huge'] });

const dir = join(DIRS.tmp, 'huge-files');
mkdirSync(dir, { recursive: true });
const file = (name, text) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

const records = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `user ${i}`, email: `u${i}@example.com`, active: i % 3 !== 0, tags: i % 7 ? ['a', 'b'] : [], score: Math.round(i * 7.31) / 100 }));
const pretty = file('users.json', JSON.stringify({ meta: { version: 3, note: 'x'.repeat(3000) }, users: records(2500) }, null, 2));
const minified = file('min.json', JSON.stringify({ users: records(300), total: 300 }));
const lines = file('events.jsonl', records(1200).map((r) => JSON.stringify(r)).join('\n') + '\n');
// (An extra comma on line 329, column 14: fixable in the editor, an error in huge mode, which reads strict JSON.)
// (Two values on one line, then more: several top-level values, not JSON Lines.)
const several = file('several.json', '{"a": 1} {"b": 2}\n{"c": [1, 2, 3]}\n');
const broken = file('broken.json', JSON.stringify(records(50), null, 2).replace('"id": 31,', '"id": 31,,'));

/** Opens `path` in huge mode (forced) and waits for its viewer. */
async function openHuge(t, path, { sim } = {}) {
  const { page } = t;
  await page.evaluate((sim) => {
    localStorage.setItem('tk:hugeMin', '0');
    if (sim) localStorage.setItem('tk:hugeSim', JSON.stringify(sim));
    else localStorage.removeItem('tk:hugeSim');
    // (As Open file does: the same file chosen again is a change too.)
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    if (input) input.value = '';
  }, sim ?? null);
  await page.locator('.app:visible input[type=file]').setInputFiles(path);
  const ok = await until(page, () => !!window.__vis('.hg') && document.documentElement.hasAttribute('data-huge'), null, { timeout: 15_000 });
  if (!ok) t.log('not opened', await page.evaluate(() => ({ toast: document.querySelector('.toast')?.textContent, min: localStorage.getItem('tk:hugeMin'), files: document.querySelector('.app input[type=file]')?.files?.length })));
  t.assert(ok, 'huge mode opens');
}

const status = (page) => page.evaluate(() => window.__vis('.hg-sb')?.textContent ?? '');
const waitIndexed = (page, timeout = 15_000) => until(page, () => /Valid JSON|JSON Lines|Ln \d/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout });
const rowsText = (page) => page.evaluate(() => [...(window.__vis('#hg-tree')?.querySelectorAll('.tv-r') ?? [])].map((r) => r.textContent));
const selText = (page) => page.evaluate(() => document.querySelector('#hg-tree #htv-sel')?.textContent ?? null);
/** Waits until no placeholder row is drawn in `sel`. */
const loaded = (page, sel) => until(page, (s) => { const v = window.__vis(s); return !!v && !v.querySelector('.hg-ph'); }, sel, { timeout: 10_000 });

test('huge mode: tree pages of 1,000, Show next, Go to index, keys, copy value and path', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty);
  t.check(/Valid JSON/.test(await waitIndexed(page) ? await status(page) : ''), 'valid', await status(page));
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  t.assert(await loaded(page, '#hg-tree'), 'tree rows read');
  let rows = await rowsText(page);
  t.check(rows[0]?.includes('root') && rows[0]?.includes('{2}'), 'the root and its count', rows.slice(0, 3));
  // Open users: 2,500 items, a page of 1,000 listed.
  const users = page.locator('#hg-tree .tv-r', { hasText: 'users' }).first();
  await users.click();
  // (The paging row is after the 1,000 items: drawn once scrolled to.)
  await page.evaluate(() => { const el = window.__vis('#hg-tree'); el.scrollTop = el.scrollHeight; });
  t.assert(await until(page, () => [...document.querySelectorAll('#hg-tree .hg-page')].some((r) => /Show next 1,000/.test(r.textContent)), null), 'a Show next row after 1,000 items');
  const pageRow = await page.evaluate(() => [...document.querySelectorAll('#hg-tree .hg-page')].map((r) => r.textContent).join(' | '));
  t.check(/1,500 more/.test(pageRow), 'how many more', pageRow);
  // Scroll to the end and show the next page.
  await page.evaluate(() => { const el = window.__vis('#hg-tree'); el.scrollTop = el.scrollHeight; });
  await page.locator('#hg-tree .hg-pg[data-a=next]').first().click();
  t.check(await until(page, () => /500 more/.test([...document.querySelectorAll('#hg-tree .hg-page')].map((r) => r.textContent).join()), null), 'the next 1,000 listed', await page.evaluate(() => [...document.querySelectorAll('#hg-tree .hg-page')].map((r) => r.textContent).join()));
  // Go to index 2,345 (the bar opened from the paging row).
  await page.locator('#hg-tree .hg-go').first().click();
  const ask = page.locator('.hg-ask input');
  t.assert(await until(page, () => !!document.querySelector('.hg-ask input'), null), 'the Go to index bar');
  await ask.fill('2345');
  await ask.press('Enter');
  t.check(await until(page, () => /^2345/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'item 2,345 selected', await selText(page));
  const path = await page.evaluate(() => window.__vis('.hg .vmain .path')?.textContent);
  t.check(path === '$.users[2345]', 'its path in the toolbar', path);
  // Keys: down to the next item, right opens it, copy value and path.
  await page.keyboard.press('ArrowDown');
  t.check(await until(page, () => /^2346/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'ArrowDown', await selText(page));
  await page.keyboard.press('ArrowRight');
  t.check(await until(page, () => document.querySelector('#hg-tree #htv-sel')?.getAttribute('aria-expanded') === 'true', null), 'ArrowRight opens it');
  await page.keyboard.press('c');
  const clip = await until(page, () => window.__clip, null);
  let value = null;
  try {
    value = JSON.parse(clip);
  } catch {}
  t.check(value?.id === 2346 && value?.email === 'u2346@example.com', 'C copies the value as JSON', String(clip).slice(0, 80));
  await page.keyboard.press('p');
  t.check(await until(page, () => window.__clip === '$.users[2346]', null), 'P copies the path', await page.evaluate(() => window.__clip));
  const sr = await page.evaluate(() => {
    const el = document.querySelector('#hg-tree');
    const sel = el.querySelector('#htv-sel');
    return { role: el.getAttribute('role'), active: el.getAttribute('aria-activedescendant'), level: sel?.getAttribute('aria-level'), pos: sel?.getAttribute('aria-posinset'), size: sel?.getAttribute('aria-setsize') };
  });
  t.check(sr.role === 'tree' && sr.active === 'htv-sel' && sr.level === '3' && sr.pos === '2347' && sr.size === '2500', 'screen-reader attributes', sr);
  // A long string: its start, and its size.
  await page.keyboard.press('Home');
  rows = await rowsText(page);
  t.check(rows.length > 0, 'rows drawn');
});

test('huge mode: Format view reads lines as they come into view; a one-line file opens Pretty; Go to line', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, minified);
  await waitIndexed(page);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click());
  t.assert(await loaded(page, '#hg-format'), 'lines read');
  const mode = await page.evaluate(() => window.__vis('.hg [role=radio][aria-checked=true]')?.textContent);
  t.check(mode === 'Pretty', 'a one-line file opens Pretty', mode);
  const first = await page.evaluate(() => [...window.__vis('#hg-format').querySelectorAll('.cv-l')].slice(0, 3).map((l) => l.textContent));
  t.check(first[0] === '1{' && /^2\s+"users": \[$/.test(first[1]), 'pretty lines with numbers', first);
  await page.locator('#hg-format').focus();
  await page.keyboard.press(`${MOD}+g`);
  t.assert(await until(page, () => !!document.querySelector('.hg-ask input'), null), 'Go to line');
  await page.locator('.hg-ask input').fill('2000');
  await page.locator('.hg-ask input').press('Enter');
  t.check(await until(page, () => document.querySelector('#hg-format .hg-cur .cv-n')?.textContent === '2000', null), 'line 2,000 is current and in view');
  t.check(await loaded(page, '#hg-format'), 'its lines read');
  // As written: one long line, cut, saying how much more.
  await page.locator('.hg [role=radio]', { hasText: 'As written' }).click();
  t.check(await until(page, () => /more$/.test(window.__vis('#hg-format .cv-l')?.textContent ?? ''), null, { timeout: 8000 }), 'the line is cut and says how much more', await page.evaluate(() => window.__vis('#hg-format .cv-l')?.textContent?.slice(-30)));
});

test('huge mode: Find streams matches, steps through them, and $.path goes to a value', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty);
  await waitIndexed(page);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  await loaded(page, '#hg-tree');
  await page.locator('#hg-tree').focus();
  await page.keyboard.press(`${MOD}+f`);
  const input = page.locator('.hg .findbar input');
  t.assert(await until(page, () => document.activeElement?.matches('.hg .findbar input'), null), 'Ctrl+F opens Find in the file');
  await input.fill('u2222@');
  t.check(await until(page, () => /^1 of 1$/.test(document.querySelector('.hg .findbar .count')?.textContent ?? ''), null), 'one match', await page.evaluate(() => document.querySelector('.hg .findbar .count')?.textContent));
  t.check(await until(page, () => /u2222@/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the tree goes to it', await selText(page));
  await input.fill('user 12');
  t.check(await until(page, () => /of 111$/.test(document.querySelector('.hg .findbar .count')?.textContent ?? ''), null, { timeout: 15_000 }), 'every match counted (user 12, 120–129, 1200–1299…)', await page.evaluate(() => document.querySelector('.hg .findbar .count')?.textContent));
  // (The first match: user 12, the selection being past every other.)
  const before = await until(page, () => { const s = document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''; return /"user 12"$/.test(s) && s; }, null);
  t.check(!!before, 'the first match is selected', await selText(page));
  await input.press('Enter');
  t.check(await until(page, (b) => (document.querySelector('#hg-tree #htv-sel')?.textContent ?? '') !== b, before), 'Enter goes to the next', await selText(page));
  await input.press('Shift+Enter');
  t.check(await until(page, (b) => document.querySelector('#hg-tree #htv-sel')?.textContent === b, before), 'Shift+Enter back', await selText(page));
  await input.fill('$.users[1999].email');
  t.check(await until(page, () => /u1999@example.com/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), '$.path goes to the value', await selText(page));
  // Find in the Format view: the match's line becomes current.
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click());
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill('u777@');
  t.check(await until(page, () => /u777@/.test(document.querySelector('#hg-format .hg-cur')?.textContent ?? ''), null), 'the Format view goes to the line', await page.evaluate(() => document.querySelector('#hg-format .hg-cur')?.textContent));
  t.check(await page.evaluate(() => !!document.querySelector('#hg-format .hg-cur .cv-hit.cur')), 'the match is marked');
});

test('huge mode: Table pages an array of records; Go to row', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, lines);
  await waitIndexed(page);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-table]')?.click());
  t.assert(await loaded(page, '#hg-table'), 'rows read');
  const head = await page.evaluate(() => [...document.querySelectorAll('#hg-table .tb-th')].map((h) => h.textContent));
  t.check(head.join() === '#,id,name,email,active,tags,score', 'columns from the records', head);
  const dims = await page.evaluate(() => window.__vis('.hg .vmain .dims')?.textContent);
  t.check(/1,200 × 6/.test(dims ?? ''), 'rows × columns', dims);
  await page.locator('#hg-table').focus();
  await page.keyboard.press(`${MOD}+g`);
  await page.locator('.hg-ask input').fill('1150');
  await page.locator('.hg-ask input').press('Enter');
  t.check(await until(page, () => document.querySelector('#hg-table .tb-r.sel .tb-c0')?.textContent === '1150', null), 'row 1,150', await page.evaluate(() => document.querySelector('#hg-table .tb-r.sel')?.textContent));
  t.check(await loaded(page, '#hg-table'), 'its rows read');
  const st = await status(page);
  t.check(/JSON Lines · 1,200 records/.test(st), 'JSON Lines status', st);
});

test('huge mode: an invalid file says where, and Go to error shows its line', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, broken);
  await waitIndexed(page);
  const banner = await until(page, () => window.__vis('.hg .banner.err')?.textContent, null);
  t.check(/Invalid JSON/.test(banner ?? '') && /Ln 329, Col 14/.test(banner ?? ''), 'the error and its place', banner);
  await page.locator('.hg .banner.err .btn').click();
  t.check(await until(page, () => document.querySelector('#hg-format .hg-cur .cv-n')?.textContent === '329', null), 'Go to error shows line 329 as written', await page.evaluate(() => document.querySelector('#hg-format .hg-cur')?.textContent));
  const sb = await status(page);
  t.check(/Ln 329, Col 14/.test(sb), 'the status bar says it too', sb);
});

test('huge mode: several top-level values are a list, with the normal path\'s notice', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, several);
  await until(page, () => /Multiple top-level values/.test(window.__vis('.hg-sb')?.textContent ?? ''), null);
  const banner = await page.evaluate(() => window.__vis('.hg .banner.warn')?.textContent);
  t.check(/Not strict JSON/.test(banner ?? '') && /Multiple top-level values \(wrapped in an array\)/.test(banner ?? ''), 'the notice', banner);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  t.check(await until(page, () => /\[3\]/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null), 'the root lists the three values', await page.evaluate(() => window.__vis('#hg-tree .tv-r')?.textContent));
  await page.locator('.hg .banner.warn .btn').click();
  t.check(await until(page, () => /^1:/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'Go to the second value', await page.evaluate(() => document.querySelector('#hg-tree #htv-sel')?.textContent));
});

test('huge mode: progress while indexing, browse meanwhile, Cancel', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty, { sim: { speed: 120_000, latency: 10 } });
  const st = await until(page, () => /Indexing .* of .*/.test(window.__vis('.hg-sb')?.textContent ?? '') && window.__vis('.hg-sb')?.textContent, null);
  t.check(/Indexing [\d.]+ KB of [\d.]+ KB/.test(st ?? ''), 'progress in the status bar', st);
  t.check(await page.evaluate(() => !!window.__vis('.hg-bar[role=progressbar]')), 'a progress bar');
  // Browse while indexing: the tree is there, its counts growing.
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  t.check(await until(page, () => /root/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null), 'the tree while indexing');
  t.check(await until(page, () => /left/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 8000 }), 'time left', await status(page));
  await page.locator('.hg-sb .hg-cancel').click();
  t.check(await until(page, () => /Indexing stopped at/.test(window.__vis('.hg-sb')?.textContent ?? ''), null), 'Cancel stops it', await status(page));
  t.check(await page.evaluate(() => !window.__vis('.hg-bar')), 'no progress bar after');
});

test('huge mode: Close goes back to the editor; another document leaves huge mode; normal files stay normal', async (t) => {
  const { page } = t;
  await t.open('/');
  await t.app.setText(page, '{"kept": true}');
  await t.app.waitValid(page);
  await openHuge(t, minified);
  t.check(await page.evaluate(() => !window.__vis('.pane-ed')), 'the editor is hidden');
  await page.locator('.hg-file button[aria-label="Close file"]').click();
  t.check(await until(page, () => !document.querySelector('.hg') && !document.documentElement.hasAttribute('data-huge'), null), 'Close leaves huge mode');
  t.check((await page.evaluate(() => document.getElementById('input').value)) === '{"kept": true}', 'the editor has its document back');
  // A huge file, then a normal one: huge mode goes.
  await openHuge(t, minified);
  await page.evaluate(() => localStorage.removeItem('tk:hugeMin'));
  await page.locator('.app:visible input[type=file]').setInputFiles(broken);
  t.check(await until(page, () => !document.querySelector('.hg') && !!window.__vis('.pane-ed'), null), 'another file leaves huge mode');
  t.check(await until(page, () => /Ln 329/.test(window.__vis('.sb-l')?.textContent ?? ''), null), 'and opens in the editor as usual', await t.app.status(page));
});

test('huge mode: what shows the document is private (session replay records an empty box)', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty);
  await waitIndexed(page);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  await loaded(page, '#hg-tree');
  const leaks = await page.evaluate(() => {
    const priv = (el) => !!el.closest('.ph-no-capture');
    const out = [];
    for (const sel of ['.hg-file .fname', '.hg .view', '.hg-sb', '.hg .vmain .path', '#hg-tree .tv-r', '.hg-ask', '.hg .findbar .count']) {
      for (const el of document.querySelectorAll(sel)) if (!priv(el)) out.push(sel);
    }
    return out;
  });
  t.check(leaks.length === 0, 'file name, views, status and paths are private', leaks);
});

// Screenshots for review: light and dark, desktop and phone (only when HUGE_SHOTS names a folder).
for (const [name, opts] of [
  ['desktop-light', {}],
  ['desktop-dark', { dark: true }],
  ['mobile-light', { mobile: true, width: 390, height: 844 }],
  ['mobile-dark', { mobile: true, dark: true, width: 390, height: 844 }],
]) {
  test(`huge mode: screenshots ${name}`, { ...opts, engines: ['chromium'], tags: ['shots'] }, async (t) => {
    const out = process.env.HUGE_SHOTS;
    if (!out) return t.log('HUGE_SHOTS not set: no screenshots');
    mkdirSync(out, { recursive: true });
    const { page } = t;
    // (Tabs and rows fade their highlight: a shot waits for it.)
    const shot = async (file) => {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 250))));
      await page.screenshot({ path: join(out, file) });
    };
    await t.open('/');
    await openHuge(t, pretty, { sim: { speed: 60_000 } });
    await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
    await until(page, () => /root/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null);
    await until(page, () => /left/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 5000 });
    await shot(`${name}-indexing.png`);
    await waitIndexed(page, 30_000);
    await page.locator('#hg-tree .tv-r', { hasText: 'users' }).first().click();
    await loaded(page, '#hg-tree');
    await page.evaluate(() => { const el = window.__vis('#hg-tree'); el.scrollTop = 1000 * 24 - el.clientHeight + 60; });
    await loaded(page, '#hg-tree');
    await shot(`${name}-tree-pages.png`);
    await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click());
    await page.keyboard.press(`${MOD}+f`);
    await page.locator('.hg .findbar input').fill('u777@');
    await until(page, () => !!document.querySelector('#hg-format .hg-cur'), null);
    await loaded(page, '#hg-format');
    await shot(`${name}-format-find.png`);
    await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-graph]')?.click());
    await shot(`${name}-graph-notyet.png`);
    await openHuge(t, broken);
    await waitIndexed(page);
    await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-table]')?.click());
    await loaded(page, '#hg-table');
    await shot(`${name}-error-table.png`);
  });
}
