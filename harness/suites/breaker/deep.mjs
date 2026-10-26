// Deep nesting, from what every feature handles (1,000 levels) to the parser's limit (100,000) and one
// past it. Exact status, Format output (by hash), tree rows, table and Convert messages.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { copied, hash, loadAny, seenToasts, tableRows, treeRows, until, watchToasts } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000 });

const arrays = (n) => '['.repeat(n) + '1' + ']'.repeat(n);
const objects = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
/** Pretty output of `arrays(n)` with two-space indents, as Node makes it. */
const prettyArrays = (n) => JSON.stringify(JSON.parse(arrays(n)), null, 2);
const prettyObjects = (n) => JSON.stringify(JSON.parse(objects(n)), null, 2);

/** The Convert view's text for `target` (the output, or the note it shows instead). */
async function convertText(page, target) {
  const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
  await select.first().selectOption(target);
  return until(page, () => {
    const v = window.__vis('#view-convert');
    if (!v || window.__vis('.pane-view .spin')) return null;
    return v.innerText.trim() || null;
  }, null, { timeout: 30_000 });
}

for (const [kind, make, pretty] of [['arrays', arrays, prettyArrays], ['objects', objects, prettyObjects]]) {
  test(`1,000 nested ${kind}: exact status, outputs, tree and a TypeScript type`, async (t) => {
    const { page } = t;
    await t.open('/');
    const text = make(1000);
    const st = await loadAny(page, text, `deep-${kind}.json`);
    t.check(st?.msg === 'Valid JSON' && st.stats === '1 line · 1,001 nodes · depth 1000', 'valid, 1,001 nodes, depth 1000', st);
    t.check((await copied(page, 'Copy formatted output')) === pretty(1000), 'pretty output is exact');
    await command(page, 'Output: minified');
    t.check((await copied(page, 'Copy formatted output')) === text, 'minified output is the input');
    await command(page, 'Output: pretty');
    await view(page, 'tree');
    const rows = await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 2 || null).then(() => treeRows(page));
    const first = kind === 'arrays' ? ['root[1]', '  0:[1]', '    0:[1]'] : ['root{1}', '  a:{1}', '    a:{1}'];
    t.check(JSON.stringify(rows.slice(0, 3)) === JSON.stringify(first), 'the tree starts at the root, one level per row', rows.slice(0, 4));
    await view(page, 'convert');
    const ts = await convertText(page, 'typescript');
    t.check(!!ts && !/too deep/i.test(ts), 'Convert makes a TypeScript type at 1,000 levels', ts?.slice(0, 120));
  });
}

test('2,001 nested objects: Convert says the nesting is too deep (its limit is 2,000)', async (t) => {
  const { page } = t;
  await t.open('/');
  const st = await loadAny(page, objects(2001), 'deep-2001.json');
  t.check(st?.msg === 'Valid JSON', 'valid', st);
  await view(page, 'convert');
  const ts = await convertText(page, 'typescript');
  t.check(/^Nesting is too deep to convert/.test(ts ?? ''), 'Convert refuses with a message', ts?.slice(0, 160));
});

test('5,200 nested arrays: Pretty is too large to make, and the view and Copy say so', async (t) => {
  // Pretty output would be 2·5,200² ≈ 54M characters; the formatter throws "Invalid string length" there.
  const { page } = t;
  await t.open('/');
  const st = await loadAny(page, arrays(5200), 'deep-5200.json');
  t.check(st?.msg === 'Valid JSON' && /depth 5200$/.test(st.stats ?? ''), 'valid, depth 5200', st);
  await view(page, 'format');
  const shown = await until(page, () => window.__vis('#view-format')?.innerText.trim() || null, null, { timeout: 20_000 });
  t.check(/too large/i.test(shown ?? '') || (shown ?? '').length > 1000, 'the Format view shows the output or says it is too large', shown?.slice(0, 80) ?? 'blank');
  await watchToasts(page);
  const c = await copied(page, 'Copy formatted output', { timeout: 5000 });
  const toasts = await seenToasts(page);
  t.check(c !== null || toasts.some((x) => /too large/i.test(x)), 'Copy formatted output copies it or says it is too large', { copied: c?.length ?? null, toasts });
  await command(page, 'Output: minified');
  t.check((await copied(page, 'Copy formatted output')) === arrays(5200), 'minified output still works');
});

test('100,000 nested arrays (the limit): valid, a tree and a clear Convert message', async (t) => {
  const { page } = t;
  await t.open('/');
  const text = arrays(100_000);
  const st = await loadAny(page, text, 'deep-100k.json');
  t.check(st?.msg === 'Valid JSON' && st.stats === '1 line · 100,001 nodes · depth 100000', 'valid, depth 100000', st);
  await command(page, 'Output: minified');
  const min = await copied(page, 'Copy formatted output');
  t.check(min !== null && hash(min) === hash(text), 'minified output is the input', min?.length);
  await view(page, 'tree');
  const rows = await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 2 || null).then(() => treeRows(page));
  t.check(rows[0] === 'root[1]' && rows[1] === '  0:[1]', 'the tree draws the top levels', rows.slice(0, 3));
  await view(page, 'table');
  const tb = await until(page, () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || null).then(() => tableRows(page));
  t.check(JSON.stringify(tb?.rows) === JSON.stringify(['0 | [1]']), 'the table shows the root array', tb);
  await view(page, 'convert');
  const ts = await convertText(page, 'typescript');
  t.check(/^Nesting is too deep to convert/.test(ts ?? ''), 'Convert refuses with a message', ts?.slice(0, 160));
});

test('100,001 nested arrays: "Nesting is too deep to parse" at the exact column', async (t) => {
  const { page } = t;
  await t.open('/');
  const st = await loadAny(page, arrays(100_001), 'deep-100001.json');
  t.check(st?.kind === 'err' && st.msg === 'Ln 1, Col 100002: Nesting is too deep to parse', 'the error and its position', st);
  await view(page, 'tree');
  t.check((await page.evaluate(() => window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0)) === 0, 'no tree for a document that did not parse');
});
