// Huge-file mode (lib/huge, components/huge/HugeTool.tsx), driven by small files forced into it with
// localStorage['tk:hugeMin'] (and an index played slowly with tk:hugeSim): the tree's pages, Go to, the
// Format view's lines, streamed Find, the table, an invalid file's error, JSON Lines, Cancel, leaving huge
// mode, privacy classes, and screenshots in both themes on desktop and phone (HUGE_SHOTS=dir).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { quantile } from '../../lib/stats.mjs';
import { MOD, storagePage, until } from './_helpers.mjs';

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
// (100 records of 10 objects of 5 values: the graph's first read alone reaches its limit of 2,000 values.)
const wide = file('wide.json', JSON.stringify(Array.from({ length: 100 }, (_, i) => Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`part${k}`, { id: i * 10 + k, name: `n${i}.${k}`, on: k % 2 === 0, at: null, v: i * k }])))));
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
  // (The root comes first as it is while indexing, then with its count.)
  await until(page, () => /\{2\}/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null);
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
  // (The list comes first as it is while indexing: its columns once rows are read.)
  await until(page, () => document.querySelectorAll('#hg-table .tb-th').length > 1, null);
  await until(page, () => /1,200 ×/.test(window.__vis('.hg .vmain .dims')?.textContent ?? ''), null);
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

test('huge mode: a file with a problem says what and where, as the normal path, and Go to error shows its line', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, broken);
  await waitIndexed(page);
  // (An extra comma: the normal path's status calls it fixable, "Not strict JSON"; huge mode reads up to it.)
  const banner = await until(page, () => window.__vis('.hg .banner.warn')?.textContent, null);
  t.check(/Not strict JSON/.test(banner ?? '') && /Ln 329, Col 14: Unexpected extra comma/.test(banner ?? ''), 'the issue and its place', banner);
  await page.locator('.hg .banner.warn .btn').click();
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
  t.check(/Not strict JSON/.test(banner ?? '') && /Ln 1, Col 10: Multiple top-level values \(wrapped in an array\)/.test(banner ?? ''), 'the normal path\'s notice, at the second value', banner);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  t.check(await until(page, () => /\[3\]/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null), 'the root lists the three values', await page.evaluate(() => window.__vis('#hg-tree .tv-r')?.textContent));
  await page.locator('.hg .banner.warn .btn').click();
  t.check(await until(page, () => document.querySelector('#hg-format .hg-errl .cv-n')?.textContent === '1' && !!document.querySelector('#hg-format .hg-errc'), null), 'Go to error marks where the second value starts', await page.evaluate(() => document.querySelector('#hg-format .hg-cur')?.textContent));
});

test('huge mode: progress while indexing, browse meanwhile, Cancel', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty, { sim: { speed: 120_000, latency: 10 } });
  const st = await until(page, () => /Indexing [\d.]+ KB of/.test(window.__vis('.hg-sb')?.textContent ?? '') && window.__vis('.hg-sb')?.textContent, null);
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

test('huge mode: Graph shows the part explored, "+N more" reads the next items, Up and From selected, export', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, pretty);
  await waitIndexed(page);
  // Alt+4 is Graph, as in the normal tool; Alt+7 is Shape.
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+4');
  t.check(await until(page, () => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent === 'Graph', null), 'Alt+4 opens Graph');
  t.assert(await until(page, () => !!window.__vis('#hg-graph .gv-ctl:not([hidden])') && /\d+ values/.test(window.__vis('.hg .hg-gwhere')?.textContent ?? ''), null, { timeout: 15_000 }), 'the graph is drawn', await page.evaluate(() => window.__vis('.hg .hg-gwhere')?.textContent));
  const where = () => page.evaluate(() => window.__vis('.hg .hg-gwhere')?.textContent ?? '');
  const shown = async () => Number(((await where()).match(/([\d,]+) values?/)?.[1] ?? '0').replace(/,/g, ''));
  t.check(/\$/.test(await where()), 'from the root, nothing selected', await where());
  const before = await shown();
  t.check(before > 0 && before <= 2000, 'a bounded part', before);
  // Down the root card's rows to "+N more" (users is shown from its first 20), Enter reads the next ones.
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+2');
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill('$.users');
  await until(page, () => /^users:/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+4');
  // The graph shows $.users already (the root's item): it is selected there.
  const live = () => page.evaluate(() => window.__vis('#hg-graph .gv-live')?.textContent ?? '');
  t.check(await until(page, () => /\$\.users$/.test(window.__vis('#hg-graph .gv-live')?.textContent ?? ''), null), 'the tree\'s selection is selected in the graph', await live());
  await page.locator('#hg-graph').focus();
  await page.keyboard.press('r');
  t.check(await until(page, () => (window.__vis('.hg .hg-gwhere .hg-gpath')?.textContent ?? '') === '$.users', null), 'R: the graph from the selected value', await where());
  await page.keyboard.press('Home');
  let found = false;
  for (let k = 0; k < 40 && !found; k++) {
    await page.keyboard.press('ArrowDown');
    found = /more/.test(await live());
  }
  t.check(found && /^\[50\], \+2,450 more, \$…\[50\]$/.test(await live()), 'a "+N more" row, announced as such', await live());
  const n0 = await shown();
  await page.keyboard.press('Enter');
  t.check(await until(page, (n) => Number(((window.__vis('.hg .hg-gwhere')?.textContent ?? '').match(/([\d,]+) values?/)?.[1] ?? '0').replace(/,/g, '')) > n, n0), 'Enter reads the next items', await where());
  // (From $.users the root reads 50 at a time: the first new one is [50]; not read yet, it says its size.)
  t.check(await until(page, () => /^\[50\], \{\d+\}, \$…\[50\]$/.test(window.__vis('#hg-graph .gv-live')?.textContent ?? ''), null), 'and selects the first of them', await live());
  // The tree follows the graph.
  await page.keyboard.press('Alt+2');
  t.check(await until(page, () => /^50:/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the tree shows the value chosen in the graph', await page.evaluate(() => document.querySelector('#hg-tree #htv-sel')?.textContent));
  // R: from the selected value; U: a level up.
  await page.keyboard.press('Alt+4');
  await page.locator('#hg-graph').focus();
  await page.keyboard.press('r');
  t.check(await until(page, () => /\$\.users\[50\]/.test(window.__vis('.hg .hg-gwhere .hg-gpath')?.textContent ?? ''), null), 'R from an item read by "+N more"', await where());
  await page.keyboard.press('u');
  t.check(await until(page, () => (window.__vis('.hg .hg-gwhere .hg-gpath')?.textContent ?? '') === '$.users', null), 'U a level up', await where());
  // Export PNG of what is shown.
  // (The menu open first; then up to a minute for the image, as the normal tool's big exports: Firefox on a CI runner
  // gave no download in 15 s, where it takes ~1 s here. What went wrong, if anything: the toast says.)
  // (CI Firefox twice showed no menu after this click, which no local run does (30+ runs, 2 and 4 at a time). If
  // the menu isn't open in 3 s, what was under the pointer is logged and the menu is opened from the keyboard: the
  // export is what this checks; the log says what happened to the click.)
  const more = page.locator('.hg .vicons button[aria-label="More options"]');
  await more.click();
  const item = page.getByRole('menuitem', { name: 'Export PNG' });
  if (!(await item.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
    t.log(
      'the click left the menu closed',
      await page.evaluate(() => {
        const b = document.querySelector('.hg .vicons button[aria-label="More options"]');
        const r = b?.getBoundingClientRect();
        const at = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        const name = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ').join('.')}` : 'none');
        return JSON.stringify({ expanded: b?.getAttribute('aria-expanded'), under: name(at), focus: name(document.activeElement), menus: document.querySelectorAll('.menu').length });
      }),
    );
    await more.focus();
    await page.keyboard.press('Enter');
    await item.waitFor({ timeout: 10_000 });
  }
  const t0 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }).catch(() => null), item.click()]);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent ?? ''));
  t.check(!!dl && /-graph\.png$/.test(dl.suggestedFilename()), 'Export PNG saves the graph', dl ? `${dl.suggestedFilename()} in ${Date.now() - t0} ms` : await toasts());
  // Find from the Graph: a match outside the part shows the part around it, the match selected.
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill('u2400@');
  t.check(await until(page, () => (window.__vis('.hg .hg-gwhere .hg-gpath')?.textContent ?? '') === '$.users[2400]', null, { timeout: 10_000 }), 'Find: the graph around a match outside its part', await where());
  t.check(await until(page, () => /^email, string, "u2400@example\.com", \$…\.email$/.test(window.__vis('#hg-graph .gv-live')?.textContent ?? ''), null), 'with the match selected', await live());
  // A $.path in Find: the Graph stays, around that value.
  await page.locator('.hg .findbar input').fill('$.users[1234].tags');
  t.check(await until(page, () => (window.__vis('.hg .hg-gwhere .hg-gpath')?.textContent ?? '') === '$.users[1234].tags', null, { timeout: 10_000 }), 'Find $.path: the graph from there', await where());
  const tab = await page.evaluate(() => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent);
  t.check(tab === 'Graph', 'and the Graph stays open', tab);
  await page.keyboard.press('Escape');
  // Alt+7: Shape.
  await page.keyboard.press('Alt+7');
  t.check(await until(page, () => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent === 'Shape', null), 'Alt+7 opens Shape');
  const tips = await page.evaluate(() => [...document.querySelectorAll('.hg [role=tab]')].map((b) => `${b.textContent}=${b.dataset.tip}`).join(' '));
  t.check(tips === 'Format=Alt+1 Tree=Alt+2 Table=Alt+3 Graph=Alt+4 Convert=Alt+5 Compare=Alt+6 Shape=Alt+7', 'tabs numbered as the normal tool, Shape seventh', tips);
});

test('huge mode: Graph at its limit (2,000 values) pans within a frame', async (t) => {
  const { page } = t;
  // Each animation frame's work, timed in the page (a busy machine changes how many frames are painted more than
  // how long each one takes).
  await page.addInitScript(() => {
    const b = (window.__zp = { cb: [], on: false });
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) =>
      raf((ts) => {
        const s = performance.now();
        try {
          return fn(ts);
        } finally {
          if (b.on) b.cb.push(performance.now() - s);
        }
      });
  });
  await t.open('/');
  await openHuge(t, wide);
  await waitIndexed(page);
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-graph]')?.click());
  const where = () => page.evaluate(() => window.__vis('.hg .hg-gwhere')?.textContent ?? '');
  t.assert(await until(page, () => /values \(all it shows\)/.test(window.__vis('.hg .hg-gwhere')?.textContent ?? ''), null, { timeout: 15_000 }), 'the part is read up to the limit', await where());
  t.metric('values shown', Number((await where()).match(/([\d,]+) values/)[1].replace(/,/g, '')), 'values', { better: 'higher' });
  const box = await page.locator('#hg-graph canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const [zoom, keys] of [['100%', []], ['Fit', ['0']]]) {
    await page.locator('#hg-graph').focus();
    for (const k of keys) await page.keyboard.press(k);
    await page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 400)));
    await page.evaluate(() => {
      window.__zp.cb = [];
      window.__zp.on = true;
    });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 120; i++) {
      const f = i / 120;
      await page.mouse.move(cx + Math.sin(f * Math.PI * 4) * 200, cy + (Math.cos(f * Math.PI * 4) - 1) * 150);
    }
    await page.mouse.up();
    const cb = (await page.evaluate(() => ((window.__zp.on = false), window.__zp.cb))).filter((x) => x > 0.05);
    const p95 = quantile(cb, 0.95);
    t.metric(`${zoom} frame p50 ms`, quantile(cb, 0.5));
    t.metric(`${zoom} frame p95 ms`, p95);
    // (Linux WebKit headless paints a few frames for Playwright's back-to-back moves (1–11 here), and one slow one
    // among them swings p95: there the pan must paint, and the frame times are recorded, not judged. Linux WebKit
    // isn't Safari; the perf suite judges the normal graph's panning in Chromium only.)
    if (t.engine === 'webkit') t.check(cb.length > 0, `${zoom}: frames painted while panning`, { frames: cb.length, p50: quantile(cb, 0.5), p95 });
    else t.check(cb.length > 10 && p95 < 16, `${zoom}: frames painted while panning, each within a 60 fps frame`, { frames: cb.length, p50: quantile(cb, 0.5), p95 });
  }
});

test('huge mode: the command palette lists its commands, Shape among them, and runs them (REVIEW-GPT 7)', async (t) => {
  const { page } = t;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await t.open('/');
  await openHuge(t, pretty);
  await waitIndexed(page);
  const palette = async () => {
    await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+k`);
    return until(page, () => !!document.querySelector('dialog.palette')?.open && document.querySelectorAll('dialog.palette [role=option]').length > 5, null);
  };
  t.assert(await palette(), `${MOD}+K opens the palette with huge mode's commands`, errors.join(' | '));
  const shape = await page.evaluate(() => document.querySelector('dialog.palette #pl-shape')?.textContent ?? '');
  t.check(/Shape view/.test(shape) && /(Alt|⌥)7/.test(shape), 'Shape is listed, with Alt+7', shape);
  await page.keyboard.type('shape');
  t.check(await until(page, () => document.querySelector('dialog.palette [role=option][aria-selected=true]')?.id === 'pl-shape', null), 'typing finds it');
  await page.keyboard.press('Enter');
  const tab = () => page.evaluate(() => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent);
  t.check(await until(page, () => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent === 'Shape', null), 'Enter runs it: Shape opens', await tab());
  t.check(!(await page.evaluate(() => document.querySelector('dialog.palette')?.open)), 'and the palette closes');
  // One of the normal tool's: Tree view.
  t.assert(await palette(), 'the palette opens again');
  await page.keyboard.type('tree view');
  await page.keyboard.press('Enter');
  t.check(await until(page, () => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent === 'Tree', null), 'Tree view from the palette', await tab());
  t.check(!errors.length, 'no errors on the page', errors.join(' | '));
});

// (The pretty document compressed: a .json.gz huge mode opens once decompressed to the browser's storage.)
const gzPretty = file('big.json.gz', gzipSync(readFileSync(pretty)));

test('huge mode: a big .json.gz opens in huge mode; Find, the palette and Ctrl+S act on it (REVIEW-GPT 8)', async (t) => {
  const page = await storagePage(t);
  try {
    await t.open('/');
    await openHuge(t, gzPretty);
    t.assert(await waitIndexed(page, 30_000), 'decompressed and indexed', await status(page));
    const fname = await page.evaluate(() => window.__vis('.hg-file .fname')?.textContent ?? '');
    t.check(fname.startsWith('big.json') && !fname.includes('.gz'), 'named without .gz', fname);
    // Ctrl+F: huge mode's Find, on the decompressed file; a $.path selects that value (in the Tree, opened by its
    // tab, which works with or without the session's hook).
    await page.locator('.hg [role=tab][aria-controls=hg-tree]').click();
    await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+f`);
    t.assert(await until(page, () => !!window.__vis('.hg .findbar input'), null), `${MOD}+F opens huge mode's find bar`);
    await page.locator('.hg .findbar input').fill('u777@');
    t.check(await until(page, () => /1 of 1/.test(window.__vis('.hg .findbar .count')?.textContent ?? ''), null, { timeout: 15_000 }), 'Find finds the one match', await page.evaluate(() => window.__vis('.hg .findbar .count')?.textContent));
    await page.locator('.hg .findbar input').fill('$.users[3]');
    t.check(await until(page, () => /^3:/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'a $.path selects that value', await selText(page));
    await page.keyboard.press('Escape');
    // Ctrl+S: huge mode's Save (nothing edited yet: it says so; the editor's would download its own document).
    await page.keyboard.press(`${MOD}+s`);
    t.check(await until(page, () => [...document.querySelectorAll('.toast')].some((e) => /No changes to save/.test(e.textContent ?? '')), null), `${MOD}+S is huge mode's Save`);
    // Save value as file: the selected record, from the decompressed document.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.locator('.hg .vicons button[aria-label="Save value as file"]').click()]);
    const saved = readFileSync(await dl.path(), 'utf8');
    t.check(dl.suggestedFilename() === 'big-3.json' && JSON.parse(saved).id === 3, 'Save value as file saves the selected value', `${dl.suggestedFilename()}: ${saved.slice(0, 80)}`);
    // The palette's view commands reach the session too (last: a palette that throws, REVIEW-GPT 7, stops the check).
    await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+k`);
    t.assert(await until(page, () => !!document.querySelector('dialog.palette')?.open, null), 'the palette opens');
    await page.keyboard.type('format view');
    await page.keyboard.press('Enter');
    t.check(await until(page, () => document.querySelector('.hg [role=tab][aria-selected=true]')?.textContent === 'Format', null), 'Format view from the palette switches huge mode\'s view');
  } finally {
    await t.cleanup?.();
  }
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
    // (A phone has the views in a drop-down instead of tabs.)
    const view = (v) =>
      page.evaluate((v) => {
        const tab = window.__vis(`.hg [role=tab][aria-controls=hg-${v}]`);
        if (tab) return tab.click();
        const pick = window.__vis('.hg .tabs-pick select');
        pick.value = v;
        pick.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
    const shot = async (file) => {
      // (The mouse out of the way: a click left it over whatever the next view puts there, hovered.)
      await page.mouse.move(1, 300);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 250))));
      await page.screenshot({ path: join(out, file) });
    };
    await t.open('/');
    await openHuge(t, pretty, { sim: { speed: 60_000 } });
    await view('tree');
    await until(page, () => /root/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null);
    await until(page, () => /left/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 5000 });
    await shot(`${name}-indexing.png`);
    await waitIndexed(page, 30_000);
    await page.locator('#hg-tree .tv-r', { hasText: 'users' }).first().click();
    await loaded(page, '#hg-tree');
    await page.evaluate(() => { const el = window.__vis('#hg-tree'); el.scrollTop = 1000 * 24 - el.clientHeight + 60; });
    await loaded(page, '#hg-tree');
    await shot(`${name}-tree-pages.png`);
    await view('format');
    await page.keyboard.press(`${MOD}+f`);
    await page.locator('.hg .findbar input').fill('u777@');
    await until(page, () => !!document.querySelector('#hg-format .hg-cur'), null);
    await loaded(page, '#hg-format');
    await shot(`${name}-format-find.png`);
    await view('graph');
    await until(page, () => !!window.__vis('#hg-graph .gv-ctl:not([hidden])'), null, { timeout: 15_000 });
    await shot(`r3-${name}-graph.png`);
    // (Shape and Convert read the file itself, which the simulated index doesn't have: the file again, as it is.)
    await openHuge(t, pretty);
    await waitIndexed(page);
    await view('shape');
    t.check(await until(page, () => !!window.__vis('#hg-shape .hs-grid'), null, { timeout: 20_000 }), 'shape read');
    await shot(`r3-${name}-shape.png`);
    await view('convert');
    await until(page, () => !!window.__vis('.hg .view button, .hg .view [role=radio]'), null, { timeout: 10_000 });
    await shot(`r3-${name}-convert.png`);
    await openHuge(t, broken);
    await waitIndexed(page);
    await view('table');
    await loaded(page, '#hg-table');
    await shot(`${name}-error-table.png`);
  });
}
