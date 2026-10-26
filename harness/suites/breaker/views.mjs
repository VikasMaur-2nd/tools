// What the Tree, Table, Graph and Find show for a known document, exactly: the rows drawn after loading
// and after expanding, the table at the root and inside the records array, table sorting of lossless
// numbers, the graph as an SVG export (every card's text), and find results. The rework of the views
// (reading nodes from the packed tree) must keep all of it.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { downloaded, golden, load, settled, svgTexts, tableRows, treeRows, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000 });

const waitRows = (page, sel, n = 1) => until(page, ([s, n]) => (window.__vis(s)?.childElementCount ?? 0) >= n || null, [sel, n], { timeout: 20_000 });

test('the 1 MB benchmark export: tree rows, table at the root and in data, and find are exact', async (t) => {
  const { page } = t;
  await t.open('/');
  await t.app.openFile(page, 'bench-1mb');
  t.assert(await settled(page, { raw: 999_554 }), 'the file loads');
  const out = {};
  await view(page, 'tree');
  await waitRows(page, '#view-tree .tv-rows', 3);
  out.treeLoaded = await treeRows(page);
  await command(page, 'Expand to level 2');
  await until(page, (n) => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) !== n || null, out.treeLoaded.length, { timeout: 5000 });
  out.treeLevel2 = await treeRows(page);
  await command(page, 'Collapse all');
  out.treeCollapsed = await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount === 1 ? 1 : null), null, { timeout: 5000 }).then(() => treeRows(page));

  await view(page, 'table');
  await waitRows(page, '#view-table .tb-rows');
  out.tableRoot = await tableRows(page);
  // Into the records: the [n] button in the data row.
  await page.locator('#view-table:visible .tb-r').filter({ hasText: /^data/ }).locator('.tb-dr').first().click();
  await until(page, () => window.__vis('#view-table .tb-head')?.textContent.includes('uuid') || null, null, { timeout: 10_000 });
  const records = await tableRows(page);
  out.tableData = { head: records.head, rows: records.rows.slice(0, 12) };
  // Sorted by score, descending (two clicks on the header).
  const th = page.locator('#view-table:visible [role=columnheader]', { hasText: /^score$/ });
  await th.click();
  await th.click();
  await until(page, () => window.__vis('#view-table [aria-sort="descending"]') || null, null, { timeout: 5000 });
  const sorted = await tableRows(page);
  out.tableByScore = sorted.rows.slice(0, 8);

  await view(page, 'tree');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+f`);
  const box = page.locator('.findbar:visible input');
  // Enter runs the query at once (typing waits 80 ms, and the count shows the previous query's total
  // meanwhile); the count is read after React has drawn it.
  const find = async (q) => {
    await box.fill(q);
    await box.press('Enter');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // (Only the total: when the typed query already ran, Enter steps to the next match.)
    return page.evaluate(() => window.__vis('.findbar .count')?.textContent.replace(/^\d+ of /, 'of ') ?? null);
  };
  out.findNeedle = await find('TKLB-NEEDLE-LAST');
  out.findCity = await find('München');
  out.findPath = await find('$.data[2].name.first');
  out.findPathSelected = await page.evaluate(() => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent ?? null);
  golden(t, 'views/bench-1mb', out, 'tree, table and find match the golden file');
});

test('table sorting keeps lossless numbers in value order, other types after them', async (t) => {
  const { page } = t;
  await t.open('/');
  const vals = ['9007199254740993', '9007199254740992', '2e400', '1e400', '3e400', '-1e-400', '1e-400', '0', '-0.0', '"str"', 'null', 'true', '1.0000000000000000000001', '1.0000000000000000000002'];
  const doc = '[' + vals.map((v) => `{"n":${v}}`).join(',') + ',{}]';
  t.assert(await load(page, doc), 'the document loads');
  await view(page, 'table');
  await waitRows(page, '#view-table .tb-rows');
  const th = page.locator('#view-table:visible [role=columnheader]', { hasText: /^n$/ });
  await th.click();
  await until(page, () => window.__vis('#view-table [aria-sort="ascending"]') || null);
  const asc = (await tableRows(page)).rows;
  await th.click();
  await until(page, () => window.__vis('#view-table [aria-sort="descending"]') || null);
  const desc = (await tableRows(page)).rows;
  golden(t, 'views/sort-numbers', { asc, desc }, 'ascending and descending orders match the golden file');
  const nums = (rows) => rows.map((r) => r.split(' | ')[1]).filter((v) => /^-?\d/.test(v));
  t.check(JSON.stringify(nums(asc)) === JSON.stringify(['-1e-400', '0', '-0.0', '1e-400', '1.0000000000000000000001', '1.0000000000000000000002', '9007199254740992', '9007199254740993', '1e400', '2e400', '3e400']), 'numbers ascend by exact value', nums(asc));
});

test('graph: the SVG export holds every card of a small document, exactly', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = '{"name":"Ada","tags":["x","<b>y</b>"],"addr":{"city":"東京","geo":{"lat":35.68,"lng":139.69}},"n":9007199254740993,"empty":{},"list":[],"ok":true,"none":null}';
  t.assert(await load(page, doc), 'the document loads');
  await view(page, 'graph');
  await until(page, () => !!window.__vis('#view-graph canvas') && !/Building|Laying out/.test(window.__vis('#view-graph')?.innerText ?? '') || null, null, { timeout: 20_000 });
  const svg = await downloaded(page, () => command(page, 'Download graph as SVG'));
  t.assert(svg?.bytes, 'an SVG downloads', svg?.name);
  const text = svg.bytes.toString();
  golden(t, 'views/graph-small', { name: svg.name, texts: svgTexts(text) }, 'the cards match the golden file');
  t.check(!/<script|onerror|onload/i.test(text), 'no markup from the document in the SVG');
});

test('graph: 100 records lay out, and the SVG has a card per object', async (t) => {
  const { page } = t;
  await t.open('/');
  await t.app.openFile(page, 'rows-100');
  t.assert(await settled(page, { raw: 10_997 }), 'the file loads');
  await view(page, 'graph');
  await until(page, () => !!window.__vis('#view-graph canvas') && !/Building|Laying out/.test(window.__vis('#view-graph')?.innerText ?? '') || null, null, { timeout: 20_000 });
  const svg = await downloaded(page, () => command(page, 'Download graph as SVG'));
  const texts = svgTexts(svg?.bytes?.toString() ?? '');
  golden(t, 'views/graph-rows-100', { count: texts.length, first: texts.slice(0, 40), last: texts.slice(-20) }, 'the cards match the golden file');
});
