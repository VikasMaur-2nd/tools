// Tricky small documents, every output exact: the status bar, the Format view (pretty, minified,
// escaped string, sorted keys), the tree (expanded), the root table and its CSV, and all 17 text Convert
// targets. The same golden outputs hold in every engine, so a difference between engines fails too.
// Golden values: golden/inputs/<case>.json (BREAKER_UPDATE=1 pnpm e2e breaker/inputs -e chromium).
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { CASES } from './_cases.mjs';
import { converted, copied, golden, load, tableRows, treeRows, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000 });

// Only an array or object has a table and a CSV; scalars and loose JSON get fewer outputs.
const TARGETS = ['typescript', 'zod', 'json-schema', 'csharp', 'dart', 'java', 'python', 'go', 'kotlin', 'swift', 'php', 'rust', 'csv', 'yaml', 'xml', 'toml', 'jsonl'];

for (const [name, text] of Object.entries(CASES)) {
  test(`${name}: status, every Format style, tree, table, CSV and every Convert target are exact`, async (t) => {
    const { page } = t;
    await t.open('/');
    await page.evaluate(() => (window.__xss = 0));
    const st = await load(page, text, `${name}.json`);
    t.assert(st, 'the document loads and settles', await page.evaluate(() => window.__vis('.sb-l')?.textContent));
    const out = { status: st };
    await view(page, 'format');
    out.pretty = await copied(page, 'Copy formatted output');
    await command(page, 'Output: minified');
    out.minified = await copied(page, 'Copy formatted output');
    await command(page, 'Output: escaped JSON string');
    out.string = await copied(page, 'Copy formatted output');
    await command(page, 'Output: pretty');
    await command(page, 'Output: sort keys');
    out.sorted = await copied(page, 'Copy formatted output');
    await command(page, 'Output: sort keys');
    t.check((await copied(page, 'Copy formatted output')) === out.pretty, 'sorting off again gives the first output back');

    await view(page, 'tree');
    await command(page, 'Expand all');
    out.tree = await until(page, () => {
      const rows = [...(window.__vis('#view-tree')?.querySelectorAll('.tv-rows [role=treeitem]') ?? [])];
      return rows.length ? rows.length : null;
    }).then(() => treeRows(page));

    await view(page, 'table');
    out.table = await until(page, () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || !window.__vis('#view-table .tb-empty')?.hidden || null).then(() => tableRows(page));
    out.csv = await copied(page, 'Copy table as CSV', { timeout: 3000 });

    await view(page, 'convert');
    out.convert = {};
    for (const target of TARGETS) out.convert[target] = await converted(page, target);

    golden(t, `inputs/${name}`, out, `${name}: outputs match the golden file`, name === 'dupes' ? { known: 'bug (main): the Table shows the first of duplicate keys, the rest the last (BREAKER-REPORT F11)' } : {});
    t.check((await page.evaluate(() => window.__xss)) === 0, 'no markup from the document ran');
  });
}
