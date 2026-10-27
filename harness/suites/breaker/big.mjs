// Extreme documents, exact results: a million keys, ten million numbers, a million duplicate keys, 50 MB
// one-line and pretty records, a 50 MB string, 50 MB of random bytes, and the 300 MiB size limit. The
// expected Format output comes from an independent re-indenter (reformat in _helpers), not the app.
// Tagged slow: `pnpm e2e breaker/big --slow` (documents from 50 MB take the heavy lock when
// BREAKER_HEAVY_LOCK names it; run alone on a shared machine).
import { closeSync, ftruncateSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { DIRS } from '../../lib/env.mjs';
import { bigFixture } from './_gen.mjs';
import { clear, golden, hash, heavyLock, reformat, settled, slow, tableRows, treeRows, until, watchToasts } from './_helpers.mjs';

// (With the heavy lock a check may first wait in its queue for a long time: an hour then.)
defaults({ engines: 'all', tags: ['slow', 'breaker'], slots: 'all', timeout: process.env.BREAKER_HEAVY_LOCK ? 3_600_000 : 600_000 });

/** Opens fixture `name` through Open file and waits (scaled per engine) until the status settles. */
async function open(t, name, { minutes = 3, reopen = true } = {}) {
  const { page } = t;
  if (reopen) await t.open('/');
  await clear(page);
  await watchToasts(page);
  await page.locator('.app:visible input[type=file]').setInputFiles(bigFixture(name));
  return settled(page, { timeout: minutes * 60_000 * slow(t) });
}

/** Hash of the Format view's output (Copy formatted output), hashed in the page so it never crosses the protocol. */
async function outputHash(page, timeout = 120_000) {
  await page.evaluate(() => (window.__clip = null));
  await command(page, 'Copy formatted output');
  return until(page, () => {
    const t = window.__clip;
    if (t == null) return null;
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
    window.__clip = null;
    return `${t.length}:${(h >>> 0).toString(16)}`;
  }, null, { timeout, polling: 250 });
}

const shown = (page, v) => until(page, (v) => (window.__vis(`#view-${v} ${v === 'tree' ? '.tv-rows' : '.tb-rows'}`)?.childElementCount ?? 0) > 0 || null, v, { timeout: 120_000 });

test('a million keys in one object: exact status, output, tree, table and find', async (t) => {
  const { page } = t;
  const st = await open(t, 'wide-keys-1000k');
  t.assert(st?.msg === 'Valid JSON', 'valid', st);
  t.check(st.stats === '1 line · 1,000,001 nodes · depth 1', 'counts', st.stats);
  const text = readFileSync(bigFixture('wide-keys-1000k'), 'utf8');
  t.check((await outputHash(page)) === reformat(text, '  ', { hashOnly: true }), 'pretty output is exact');
  await view(page, 'tree');
  await shown(page, 'tree');
  const rows = await treeRows(page);
  t.check(JSON.stringify(rows.slice(0, 4)) === JSON.stringify(['root{1000000}', '  key_0:0', '  key_1:1', '  key_2:2']), 'tree rows', rows.slice(0, 4));
  await view(page, 'table');
  await shown(page, 'table');
  const tb = await tableRows(page);
  t.check(JSON.stringify(tb.rows.slice(0, 3)) === JSON.stringify(['key_0 | 0', 'key_1 | 1', 'key_2 | 2']), 'table rows', tb.rows.slice(0, 3));
  await view(page, 'tree');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+f`);
  const box = page.locator('.findbar:visible input');
  await box.fill('key_999999');
  await box.press('Enter');
  const count = await until(page, () => /\d of \d/.test(window.__vis('.findbar .count')?.textContent ?? '') ? window.__vis('.findbar .count').textContent : null, null, { timeout: 60_000 });
  t.check(count?.replace(/^\d+ of /, 'of ') === 'of 1', 'find reaches the last key', count);
});

test('ten million numbers in one array: exact status, minified output and tree', async (t) => {
  const { page } = t;
  const st = await open(t, 'flat-nums-10m');
  t.assert(st?.msg === 'Valid JSON', 'valid', st);
  t.check(st.stats === '1 line · 10,000,001 nodes · depth 1', 'counts', st.stats);
  await command(page, 'Output: minified', { timeout: 60_000 });
  t.check((await outputHash(page)) === hash(readFileSync(bigFixture('flat-nums-10m'), 'utf8')), 'minified output is the input');
  await page.evaluate(() => {
    window.__gap = { last: performance.now(), max: 0 };
    const f = () => { const n = performance.now(); window.__gap.max = Math.max(window.__gap.max, n - window.__gap.last); window.__gap.last = n; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await view(page, 'tree');
  await shown(page, 'tree');
  // Main took 10–30 s with stalls of 0.9–3.9 s; t3/optimize-json-memory-performance (54ae42d) showed it in one
  // task: 7.9–9.4 s frozen in Chromium, 18.1 s in Firefox (BREAKER-REPORT R5).
  const gap = await page.evaluate(() => Math.max(window.__gap.max, performance.now() - window.__gap.last));
  t.check(gap < t.budget(5000 * slow(t)), 'switching to the tree never stalls the page 5 s', `${Math.round(gap)} ms`);
  t.check(JSON.stringify((await treeRows(page)).slice(0, 3)) === JSON.stringify(['root[10000000]', '  0:0', '  1:1']), 'tree rows', (await treeRows(page)).slice(0, 3));
});

test('a million duplicate keys: the status counts them', async (t) => {
  const st = await open(t, 'dupes-1000k');
  t.assert(st?.kind === 'ok', 'valid', st);
  t.check(st.msg === 'Valid JSON· 999,999 duplicate keys', 'the status counts every duplicate (or says it stopped counting)', st.msg, { known: 'bug: the duplicate count stops at 500 and reads as exact (BREAKER-REPORT F10)' });
});

for (const [shape, indent] of [['records', '  '], ['pretty', '']]) {
  test(`50 MB of ${shape}: exact status, ${indent ? 'pretty' : 'minified'} output, tree, table and find`, async (t) => {
    await heavyLock(t);
    const { page } = t;
    const name = `big-${shape}-50mb`;
    const st = await open(t, name, { minutes: 5 });
    t.assert(st?.msg === 'Valid JSON', 'valid', st);
    if (!indent) await command(page, 'Output: minified');
    const want = reformat(readFileSync(bigFixture(name), 'utf8'), indent, { hashOnly: true });
    t.check((await outputHash(page, 300_000)) === want, 'the output is exact');
    const out = { status: st };
    await view(page, 'tree');
    await shown(page, 'tree');
    // How many levels a new tree opens is a choice: main opened every level of a document loaded in the
    // Format view, t3/optimize-json-memory-performance (70a020b) at most 500,000 rows, so only the root here.
    // Record 0 opened all the way down reads the same either way.
    const first = '#view-tree .tv-rows [role=treeitem][aria-level="2"]';
    const closed = await page.evaluate((s) => window.__vis(s)?.getAttribute('aria-expanded') !== 'true', first);
    if (closed) {
      await page.locator('#view-tree:visible .tv-rows [role=treeitem][aria-level="2"]').first().click();
      await page.keyboard.press('*');
      await until(page, (s) => window.__vis(s)?.getAttribute('aria-expanded') === 'true' || null, first, { timeout: 30_000 });
    }
    const rows = await treeRows(page);
    out.tree = rows.slice(0, 26);
    t.check(rows[26]?.startsWith('  1:{9}'), 'record 1 follows record 0 in the tree', rows[26]?.slice(0, 40));
    // (The table shows the tree's selection: back to the root.)
    if (closed) {
      await page.locator('#view-tree:visible .tv-rows [role=treeitem][aria-level="1"] .tv-root').click();
      await until(page, () => window.__vis('#view-tree .tv-rows [role=treeitem][aria-level="1"]')?.getAttribute('aria-selected') === 'true' || null, null, { timeout: 10_000 });
    }
    await view(page, 'table');
    await shown(page, 'table');
    const tb = await tableRows(page);
    out.table = { head: tb.head, rows: tb.rows.slice(0, 10) };
    golden(t, `big/${name}`, out, 'status, tree and table match the golden file');
  });
}

test('over 48M characters: two quick edits reach the tree and the output, and Undo brings both back', async (t) => {
  // Past 48M characters the analysis worker lets its copy of the text go once it is analysed (6eb4c63): the
  // next edit gets a reset and the page sends the whole document again. The second edit comes inside the
  // analysis wait, so that reset meets a newer edit.
  await heavyLock(t);
  const { page } = t;
  const name = 'big-pretty-50mb';
  const text = readFileSync(bigFixture(name), 'utf8');
  t.assert(text.length > 48_000_000, 'the document is over 48M characters', text.length);
  const st = await open(t, name, { minutes: 5 });
  t.assert(st?.msg === 'Valid JSON', 'valid', st);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const idRow = async (want) => {
    await view(page, 'tree');
    await shown(page, 'tree');
    const box = page.locator('.findbar:visible input');
    if (!(await box.count())) await page.keyboard.press(`${mod}+f`);
    let row = null;
    for (const end = Date.now() + 120_000 * slow(t); row !== want && Date.now() < end; ) {
      await box.fill('');
      await box.fill('$[5].id');
      await box.press('Enter');
      row = await until(page, () => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent || null, null, { timeout: 30_000 });
      if (row !== want) await page.waitForTimeout(1000);
    }
    await page.keyboard.press('Escape');
    return row;
  };
  t.check((await idRow('id:5')) === 'id:5', 'the tree shows $[5].id');
  // Show in editor, then type over the value.
  await page.evaluate(() => window.__vis('#view-tree').focus());
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 10_000 });
  await page.keyboard.type('777');
  await page.waitForTimeout(600);
  await page.keyboard.type('8');
  const edited = text.replace('"id": 5,', '"id": 7778,');
  const row = await idRow('id:7778');
  t.check(row === 'id:7778', 'both edits reach the tree', row);
  await view(page, 'format');
  const want = reformat(edited, '  ', { hashOnly: true });
  let got = null;
  for (let k = 0; k < 30 && got !== want; k++) {
    got = await outputHash(page, 300_000);
    if (got !== want) await page.waitForTimeout(2000);
  }
  t.check(got === want, 'both edits reach the Format output');
  // (Typing over a selection is two Undo steps: BREAKER-REPORT F19.)
  let back = null;
  for (let k = 0; k < 2 && back !== 'id:5'; k++) {
    await command(page, 'Undo');
    back = await idRow('id:5');
  }
  t.check(back === 'id:5', 'Undo brings the tree back', back);
  await view(page, 'format');
  const original = reformat(text, '  ', { hashOnly: true });
  got = null;
  for (let k = 0; k < 30 && got !== original; k++) {
    got = await outputHash(page, 300_000);
    if (got !== original) await page.waitForTimeout(2000);
  }
  t.check(got === original, 'Undo brings the Format output back');
});

test('a 50 MB string: valid, and the tree shows it without freezing the page', async (t) => {
  await heavyLock(t);
  const { page } = t;
  const st = await open(t, 'one-string-50mb', { minutes: 5 });
  t.assert(st?.msg === 'Valid JSON' && st.stats === '1 line · 1 node · depth 0', 'valid, one node', st);
  await page.evaluate(() => {
    window.__gap = { last: performance.now(), max: 0 };
    const f = () => { const n = performance.now(); window.__gap.max = Math.max(window.__gap.max, n - window.__gap.last); window.__gap.last = n; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await view(page, 'tree');
  await shown(page, 'tree');
  const gap = await page.evaluate(() => window.__gap.max);
  t.check(gap < t.budget(1000), 'switching to the tree stalls the page under 1 s', `${Math.round(gap)} ms`, { known: 'bug: the tree lays out a huge string whole (BREAKER-REPORT, tree stall on big strings)' });
  const row = (await treeRows(page))[0] ?? '';
  t.check(row.startsWith('root"abcdefghij ÄÖÜ 東京 \\n \\"q\\" 🚀 abcdefghij'), 'the row starts with the string', row.slice(0, 60));
});

test('a 200 MB string of non-ASCII text opens as valid JSON', { known: (engine) => (engine === 'chromium' ? 'bug: V8 Zone OOM in a worker kills the tab (BREAKER-REPORT F3)' : undefined) }, async (t) => {
  await heavyLock(t);
  const { page } = t;
  let crashed = false;
  page.on('crash', () => (crashed = true));
  const st = await open(t, 'one-text-200mb', { minutes: 5 }).catch((e) => ({ error: String(e).slice(0, 120) }));
  t.check(!crashed, 'the tab survives');
  t.check(st?.msg === 'Valid JSON' && st.stats === '1 line · 1 node · depth 0', 'valid, one node', st);
});

test('5 MB of random bytes: an error within seconds, and the page stays responsive', async (t) => {
  // (50 MB of random bytes runs Chromium out of memory on main: 6.8 GiB after 3 minutes. Not opened here.)
  const { page } = t;
  await page.goto(t.base + '/', { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  await page.evaluate(() => {
    window.__gap = { last: performance.now(), max: 0 };
    const f = () => { const n = performance.now(); window.__gap.max = Math.max(window.__gap.max, n - window.__gap.last); window.__gap.last = n; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const t0 = Date.now();
  const st = await open(t, 'blob-5mb', { minutes: 3, reopen: false });
  const ms = Date.now() - t0;
  const gap = await page.evaluate(() => Math.round(window.__gap.max));
  t.log('random 5 MB:', { ms, gap, st });
  t.check(st?.kind === 'err', 'an error status', st);
  const known = { known: 'bug: binary text makes the editor measure every line in the DOM (BREAKER-REPORT, binary files)' };
  t.check(ms < t.budget(15_000) * slow(t), 'the error shows within 15 s', `${ms} ms`, known);
  t.check(gap < t.budget(2000), 'no frame gap over 2 s', `${gap} ms`, known);
});

test('the 300 MiB limit: one byte more is refused before reading', async (t) => {
  // A sparse file: 314,572,801 bytes on paper, almost nothing on disk.
  const file = join(DIRS.tmp, 'breaker-300mib-plus-1.json');
  const fd = openSync(file, 'w');
  ftruncateSync(fd, 300 * 1024 * 1024 + 1);
  closeSync(fd);
  const { page } = t;
  await t.open('/');
  await watchToasts(page);
  await page.locator('.app:visible input[type=file]').setInputFiles(file);
  const toasts = await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 30_000 });
  t.check(toasts?.includes('That file is too large to open in a browser tab'), 'the too-large message', toasts);
  t.check(/^Ready/.test(await page.evaluate(() => window.__vis('.sb-l')?.textContent ?? '')), 'nothing was opened');
});

/** A share link (#a=…) whose document inflates to `mb` MB of "0," (half a million values per MB). */
function zeroLink(mb) {
  const text = '[' + '0,'.repeat(Math.floor((mb * 1e6) / 2)) + '0]';
  const data = deflateRawSync(Buffer.from(text), { level: 9 }).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { text, fragment: `#a=${data}` };
}

test('a 26 KB share link that inflates to 10 million values opens', async (t) => {
  const { page } = t;
  const { text, fragment } = zeroLink(20);
  t.log(`link fragment ${fragment.length} chars`);
  await page.goto(t.base + '/' + fragment, { waitUntil: 'commit' });
  await t.app.waitEngine(page);
  const st = await settled(page, { raw: text.length, timeout: 180_000 * slow(t) });
  t.check(st?.msg === 'Valid JSON' && st.stats === '1 line · 10,000,002 nodes · depth 1', 'valid, 10,000,002 nodes', st);
});
