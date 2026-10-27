// Extreme documents, exact results: a million keys, ten million numbers, a million duplicate keys, 50 MB
// one-line and pretty records, a 50 MB string, 50 MB of random bytes, and the 300 MiB size limit. The
// expected Format output comes from an independent re-indenter (reformat in _helpers), not the app.
// Tagged slow: `pnpm e2e breaker/big --slow` (documents from 50 MB take the heavy lock when
// BREAKER_HEAVY_LOCK names it; run alone on a shared machine).
import { closeSync, ftruncateSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { DIRS } from '../../lib/env.mjs';
import { bigFixture } from './_gen.mjs';
import { clear, golden, hash, heavyLock, reformat, settled, slow, tableRows, treeRows, until, watchToasts } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['slow', 'breaker'], slots: 'all', timeout: 600_000 });

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
  await command(page, 'Output: minified');
  t.check((await outputHash(page)) === hash(readFileSync(bigFixture('flat-nums-10m'), 'utf8')), 'minified output is the input');
  await view(page, 'tree');
  await shown(page, 'tree');
  t.check(JSON.stringify((await treeRows(page)).slice(0, 3)) === JSON.stringify(['root[10000000]', '  0:0', '  1:1']), 'tree rows', (await treeRows(page)).slice(0, 3));
});

test('a million duplicate keys: the status counts them', async (t) => {
  const st = await open(t, 'dupes-1000k');
  t.assert(st?.kind === 'ok', 'valid', st);
  t.check(st.msg === 'Valid JSON· 999,999 duplicate keys', 'the status counts every duplicate (or says it stopped counting)', st.msg, { known: 'bug: the duplicate count stops at 500 and reads as exact (BREAKER-REPORT F4)' });
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
    out.tree = (await treeRows(page)).slice(0, 30);
    await view(page, 'table');
    await shown(page, 'table');
    const tb = await tableRows(page);
    out.table = { head: tb.head, rows: tb.rows.slice(0, 10) };
    golden(t, `big/${name}`, out, 'status, tree and table match the golden file');
  });
}

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
  t.check(gap < t.budget(1000), 'switching to the tree stalls the page under 1 s', `${Math.round(gap)} ms`);
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


