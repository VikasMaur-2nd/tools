// Offline after one visit, big documents still open: from 2 MB the analysis runs in a worker, and on
// t3/optimize-json-memory-performance its tape parser (and WebAssembly) load only when a big document
// arrives, so they must be in the service worker's cache before the network goes. A strict 3 MB file and a
// loose one (the repair path) must parse, show in the tree and format exactly, with the network cut.
import { readFileSync } from 'node:fs';
import { defaults } from '../../lib/api.mjs';
import { view } from '../../lib/app.mjs';
import { WATCH_POSTS, opened, startProxy, swIdle, test } from '../platform/_helpers.mjs';
import { bigFixture } from './_gen.mjs';
import { copied, hash, reformat, settled, treeRows, until } from './_helpers.mjs';

defaults({ engines: 'all', serviceWorkers: 'allow', allowErrors: true, tags: ['breaker', 'offline'], timeout: 300_000 });

test('offline after one visit: a 3 MB strict file and a 3 MB loose file open, format and show', async (t) => {
  const proxy = await startProxy({ A: t.base });
  try {
    await t.context.addInitScript(WATCH_POSTS);
    await t.page.goto(proxy.origin + '/', { waitUntil: 'load' });
    await swIdle(t.page, { posted: true, timeout: 90_000 });
    proxy.offline();
    const page = await t.context.newPage();
    const home = await opened(page, proxy.origin, '/');
    t.assert(home.ok && home.tool === 1, 'offline: / opens with the tool', home);
    await t.app.waitEngine(page);

    const strict = readFileSync(bigFixture('big-records-3mb'), 'utf8');
    await page.locator('.app:visible input[type=file]').setInputFiles({ name: 'strict.json', mimeType: 'application/json', buffer: Buffer.from(strict) });
    const st = await settled(page, { raw: Buffer.byteLength(strict), timeout: 120_000 });
    t.check(st?.msg === 'Valid JSON', 'offline: the strict file is valid', st ?? (await page.evaluate(() => window.__vis('.sb-l')?.textContent)));
    const out = await copied(page, 'Copy formatted output', { timeout: 60_000 });
    t.check(out !== null && hash(out) === reformat(strict, '  ', { hashOnly: true, canonical: true }), 'offline: its pretty output is exact');
    await view(page, 'tree');
    const rows = await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 2 || null, null, { timeout: 30_000 }).then(() => treeRows(page));
    t.check(/^root\[\d+\]$/.test(rows[0] ?? '') && (rows[1] ?? '').startsWith('  0:{9}'), 'offline: the tree shows it', rows.slice(0, 3));

    // The same records with a comment in front: loose, so the repairing parse runs.
    const loose = '// exported\n' + strict.replace('},{', '},\n// one record\n{');
    await view(page, 'format');
    await page.locator('.app:visible input[type=file]').setInputFiles({ name: 'loose.json', mimeType: 'application/json', buffer: Buffer.from(loose) });
    const st2 = await settled(page, { raw: Buffer.byteLength(loose), timeout: 120_000 });
    t.check(st2?.kind === 'warn' && /Comments are not allowed in JSON/.test(st2.msg), 'offline: the loose file reports its comment', st2);
    const out2 = await copied(page, 'Copy formatted output', { timeout: 60_000 });
    t.check(out2 !== null && hash(out2) === hash(out ?? ''), 'offline: the loose file formats to the same output');
    const errs = t.errors.filter((e) => !/_vercel\/insights|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to load resource|net::/i.test(e));
    t.check(!errs.length, 'offline: no other page errors', errs.slice(0, 3));
  } finally {
    proxy.close();
  }
});
