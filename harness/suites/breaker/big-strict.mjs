// The tricky cases of _cases.mjs, repeated into a ~3 MB strict document: from 2 MB a document is parsed
// in the analysis worker (a packed tree, and on t3/optimize-json-memory-performance a WebAssembly parser
// and strings decoded only when read), so every case goes through that path too. Plus long strings full
// of escapes. Expected outputs come from the independent re-indenter (reformat) and JSON.parse; the rest
// from golden/big-strict/*.json, captured on main.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { CASES } from './_cases.mjs';
import { copied, golden, hash, load, reformat, tableRows, treeRows, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 240_000 });

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const STRICT = Object.entries(CASES).filter(([name]) => name !== 'loose');

/** A string literal of ~`n` characters dense in escapes (\n \" \\ é 😀 \t \/). */
function escaped(n, seed) {
  const parts = ['ab', '\\n', '\\"', '\\\\', '\\u00e9', '\\ud83d\\ude00', '\\t', '\\/', 'é', '東京', ' '];
  let s = seed;
  let out = '';
  while (out.length < n) out += parts[(s = (s * 1103515245 + 12345) >>> 0) % parts.length];
  return `"${out}"`;
}

/** The document: rounds of every strict case (dupes only in the first 150, so its count stays exact), then long strings. */
function build() {
  const items = [];
  for (let r = 0; items.join(',\n').length < 2_800_000; r++)
    for (const [name, text] of STRICT) if (name !== 'dupes' || r < 150) items.push(`{"r":${r},"case":"${name}","v":${text}}`);
  const longs = [];
  for (let k = 0; k < 4; k++) {
    const lit = escaped(100_000, 7 + k);
    longs.push(lit);
    items.push(`{"long":${lit}}`);
  }
  return { text: '[\n' + items.join(',\n') + '\n]', count: items.length, longs };
}
const DOC = build();

/** Runs a find query with Enter and returns the count's total ("of N", "No results"). */
async function find(page, q) {
  const box = page.locator('.findbar:visible input');
  if (!(await box.count())) await page.keyboard.press(`${MOD}+f`);
  await box.fill(q);
  await box.press('Enter');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => window.__vis('.findbar .count')?.textContent.replace(/^\d+ of /, 'of ') ?? null);
}

test('the tricky cases at 3 MB: exact status, outputs, tree, table, find and Convert', async (t) => {
  const { page } = t;
  await t.open('/');
  const st = await load(page, DOC.text, 'strict-3mb.json', { timeout: 120_000 });
  t.assert(st, 'the document loads', await page.evaluate(() => window.__vis('.sb-l')?.textContent));
  const out = { status: st, items: DOC.count };
  await view(page, 'format');
  const hashOf = async () => {
    await page.evaluate(() => (window.__clip = null));
    await command(page, 'Copy formatted output');
    return until(page, () => {
      const c = window.__clip;
      if (c == null) return null;
      let h = 0x811c9dc5;
      for (let i = 0; i < c.length; i++) h = Math.imul(h ^ c.charCodeAt(i), 0x01000193);
      return `${c.length}:${(h >>> 0).toString(16)}`;
    }, null, { timeout: 60_000 });
  };
  const pretty = reformat(DOC.text, '  ', { hashOnly: true, canonical: true });
  const minified = reformat(DOC.text, '', { hashOnly: true, canonical: true });
  /** Waits until the Format view draws the output `fn` recognises in its first rows. */
  const drawn = (fn) => until(page, fn, null, { timeout: 60_000 });
  const rows = () => window.__vis('#view-format .cv-rows')?.textContent.slice(0, 400) ?? '';
  t.check((await hashOf()) === pretty, 'pretty output is exact (independent re-indenter)');
  await command(page, 'Output: minified');
  await drawn(`(${rows})().includes('[{"r":0,')`);
  t.check((await hashOf()) === minified, 'minified output is exact');
  // Copy right after switching back to Pretty must give Pretty, not the output still on screen.
  await command(page, 'Output: pretty');
  t.check((await hashOf()) === pretty, 'Copy right after switching to Pretty copies the pretty output');
  await drawn(`(${rows})().includes('"r": 0')`);
  await command(page, 'Output: sort keys');
  await drawn(`(() => { const r = (${rows})(); const c = r.indexOf('"case": "proto-keys"'); return c >= 0 && c < r.indexOf('"r": 0'); })()`);
  out.sorted = await hashOf();
  await command(page, 'Output: sort keys');

  await view(page, 'tree');
  await command(page, 'Expand to level 2');
  await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 5 || null, null, { timeout: 30_000 });
  out.tree = (await treeRows(page)).slice(0, 40);
  // (Pairs, not an object: one of the queries is "__proto__".)
  out.find = [];
  for (const q of ['é', '😀', '__proto__', '9007199254740993', 'evil', 'Z͓͑͒', '"', '$[7].v.n']) out.find.push([q, await find(page, q)]);
  // A long escaped string, read whole: what JSON.parse makes of its literal.
  await find(page, `$[${DOC.count - 2}].long`);
  const long = await copied(page, 'Copy selected value', { timeout: 30_000 });
  t.check(long === JSON.parse(DOC.longs[2]), 'Copy value of a 100 KB escaped string gives the decoded text', long === null ? null : `${long.length} vs ${JSON.parse(DOC.longs[2]).length} chars`);
  await find(page, '$[1].v');
  out.value1 = await copied(page, 'Copy selected value', { timeout: 30_000 });
  await page.keyboard.press('Escape');

  await view(page, 'table');
  await until(page, () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || null, null, { timeout: 30_000 });
  const tb = await tableRows(page);
  out.table = { head: tb.head, rows: tb.rows.slice(0, 12) };

  await view(page, 'convert');
  const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
  await select.first().selectOption('typescript');
  await until(page, () => !window.__vis('.pane-view .spin') && (window.__vis('#view-convert .cv-rows')?.textContent.length ?? 0) > 0 || null, null, { timeout: 60_000 });
  const ts = await copied(page, 'Copy converted output', { timeout: 30_000 });
  out.typescript = ts && { hash: hash(ts), head: ts.slice(0, 600) };
  golden(t, 'big-strict/strict-3mb', out, 'status, sorted output, tree, find, values, table and Convert match the golden file');
});
