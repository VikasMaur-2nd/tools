// Loose JSON at 3 MB: comments, trailing commas, single quotes, unquoted keys, Python and JavaScript
// literals, NaN / Infinity, hex, a missing comma, smart quotes. From 2 MB the analysis runs in the worker
// (on t3/optimize-json-memory-performance the tape parser's repair mode), so repairs of a big document
// must give what the small-document path gives. Golden values captured on main.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { copied, golden, hash, load, tableRows, treeRows, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 240_000 });

const RECORD = (i) =>
  `  // record ${i}\n  {id: ${i}, 'name': 'user ${i}', "ok": True, "none": None, n: NaN, inf: -Infinity, hex: 0x${(i % 4096).toString(16)},` +
  ` tags: ['a', "b",], "u": undefined, /* block */ "q": “smart”, "m": 1 "k": 2, 'nested': {'x': [1, 2,],},},`;

/** ~3 MB of loose records in a top-level array (with a trailing comma before the closing bracket). */
function build() {
  const parts = [];
  let size = 0;
  for (let i = 0; size < 3_000_000; i++) {
    const r = RECORD(i);
    parts.push(r);
    size += r.length + 1;
  }
  return '[\n' + parts.join('\n') + '\n]';
}
const DOC = build();

test('3 MB of loose JSON: the same issues, repaired text and views as a small document gets', async (t) => {
  const { page } = t;
  await t.open('/');
  const st = await load(page, DOC, 'loose-3mb.json', { timeout: 120_000 });
  t.assert(st, 'the document loads', await page.evaluate(() => window.__vis('.sb-l')?.textContent));
  const out = { status: st };
  await view(page, 'format');
  const formatted = await copied(page, 'Copy formatted output', { timeout: 60_000 });
  out.formatted = formatted && { hash: hash(formatted), head: formatted.slice(0, 400) };
  await view(page, 'tree');
  await command(page, 'Expand to level 2');
  await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 5 || null, null, { timeout: 30_000 });
  out.tree = (await treeRows(page)).slice(0, 24);
  await view(page, 'table');
  await until(page, () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || null, null, { timeout: 30_000 });
  const tb = await tableRows(page);
  out.table = { head: tb.head, rows: tb.rows.slice(0, 6) };
  await command(page, 'Repair JSON');
  const repaired = await until(page, () => /^Valid JSON/.test(window.__vis('.sb-l')?.textContent ?? '') || null, null, { timeout: 120_000 }).then(() => copied(page, 'Copy input to clipboard', { timeout: 60_000 }));
  out.repaired = repaired && { hash: hash(repaired), head: repaired.slice(0, 400) };
  t.check(repaired !== null && hash(repaired) === out.formatted?.hash, 'Repair gives the text the Format view showed');
  let parsed = null;
  try {
    parsed = JSON.parse(repaired ?? '');
  } catch {}
  t.check(Array.isArray(parsed) && parsed.length > 1000 && parsed[3].id === 3 && parsed[3].hex === 3, 'the repaired text is strict JSON with the records', repaired?.slice(0, 120));
  await command(page, 'Undo');
  const back = await copied(page, 'Copy input to clipboard', { timeout: 60_000 });
  t.check(back !== null && hash(back) === hash(DOC), 'Undo brings the loose text back');
  golden(t, 'big-loose/loose-3mb', out, 'status, outputs, tree and table match the golden file');
});
