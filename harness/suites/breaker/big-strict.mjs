// The tricky cases of _cases.mjs, repeated into a ~3 MB strict document: from 2 MB a document is parsed
// in the analysis worker (a packed tree, and on t3/optimize-json-memory-performance a WebAssembly parser
// and strings decoded only when read), so every case goes through that path too. Plus long strings full
// of escapes. Expected outputs come from the independent re-indenter (reformat) and JSON.parse; the rest
// from golden/big-strict/*.json, captured on main.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { CASES } from './_cases.mjs';
import { copied, downloaded, golden, hash, load, reformat, settled, svgTexts, tableRows, treeRows, until } from './_helpers.mjs';

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
  // Each target's output starts its own way. A big document converts for a while: Copy right after the switch
  // waits for this target's output (it once gave the previous target's, BREAKER-REPORT F14), and is retried.
  const START = { 'json-schema': '{\n  "$schema"', csv: 'r,case,', yaml: '- r: 0', xml: '<?xml', jsonl: '{"r":0' };
  for (const [target, start] of Object.entries(START)) {
    await select.first().selectOption(target);
    let c = await copied(page, 'Copy converted output', { timeout: 60_000 });
    t.check(c?.startsWith(start), `Copy right after choosing ${target} copies ${target}`, c?.slice(0, 30));
    for (let i = 0; i < 60 && !c?.startsWith(start); i++) {
      await page.waitForTimeout(1000);
      c = await copied(page, 'Copy converted output', { timeout: 60_000 });
    }
    out[target] = c && { hash: hash(c), head: c.slice(0, 300) };
  }
  golden(t, 'big-strict/strict-3mb', out, 'status, sorted output, tree, find, values, table and Convert match the golden file');
});

test('a 2.6 MB document with few cards: the graph and its SVG export are exact', async (t) => {
  // From 2 MB the graph is built from the worker's tree (on t3/optimize-json-memory-performance, the tape).
  const { page } = t;
  await t.open('/');
  const cases = STRICT.map(([, text]) => text).join(',');
  const blobs = [...DOC.longs, ...DOC.longs.map((l) => `"${l.slice(1, -1).repeat(5)}"`)].join(',');
  const text = `{"cases":[${cases}],"blobs":[${blobs}]}`;
  t.assert(await load(page, text, 'cards.json', { timeout: 120_000 }), 'the document loads');
  await view(page, 'graph');
  // (Right after the view shows, an export can find nothing yet: it is retried until the graph is built.)
  let svg = null;
  for (let i = 0; i < 20 && !svg; i++) {
    svg = await downloaded(page, () => command(page, 'Download graph as SVG'), { timeout: 10_000 });
    if (!svg) await page.waitForTimeout(1000);
  }
  t.assert(svg?.bytes, 'an SVG downloads');
  const texts = svgTexts(svg.bytes.toString());
  // (Not its size: coordinates come from each engine's text measuring.)
  golden(t, 'big-strict/graph-cards', { name: svg.name, count: texts.length, texts }, 'the cards match the golden file');
});

test('different big documents one after another each come out exact (nothing left from the one before)', async (t) => {
  // The worker (and on t3/optimize-json-memory-performance its WebAssembly instance) is reused between loads.
  const { page } = t;
  await t.open('/');
  const { readFileSync } = await import('node:fs');
  const { bigFixture } = await import('./_gen.mjs');
  const records = readFileSync(bigFixture('big-records-3mb'), 'utf8');
  const deep = readFileSync(bigFixture('big-deep-3mb'), 'utf8');
  // Just under 2 MB (the page's own parser): records cut at a top-level boundary.
  const small = records.slice(0, records.indexOf(',{"id":', 1_900_000)) + ']';
  const steps = [['strict', DOC.text], ['records', records], ['deep', deep], ['small', small], ['strict again', DOC.text], ['records again', records]];
  for (const [name, text] of steps) {
    const st = await load(page, text, `${name}.json`, { timeout: 120_000 });
    t.check(st?.kind === 'ok', `${name}: valid`, st);
    await view(page, 'format');
    const out = await copied(page, 'Copy formatted output', { timeout: 60_000 });
    // (On main, right after a big document settles, Copy can still give the previous document's output: the deep
    // one, whose 95 MB pretty output takes longest, shows it.)
    const known = name === 'deep' ? { known: 'bug (main; fixed on t3/optimize-json-memory-performance): the Format view and Copy keep the previous document for seconds after the next settles (BREAKER-REPORT F15)' } : {};
    t.check(out !== null && hash(out) === reformat(text, '  ', { hashOnly: true, canonical: true }), `${name}: the pretty output is exactly this document's`, out === null ? null : `${out.length} chars`, known);
  }
});

/** The strict document with a few edits: a changed number, a changed key's value, an item removed, one added. */
function modified() {
  const items = DOC.text.slice(2, -2).split(',\n');
  items[1] = items[1].replace('9007199254740993', '9007199254740994');
  items[7] = items[7].replace('"case":"html"', '"case":"HTML"');
  items.splice(30, 1);
  items.splice(5000, 0, '{"inserted":true,"n":1e400}');
  return '[\n' + items.join(',\n') + '\n]';
}

test('Compare at 3 MB: the changes and the JSON Patch are exact', { width: 1280, height: 900, allowErrors: true }, async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, DOC.text, 'original.json', { timeout: 120_000 }), 'the original loads');
  await page.keyboard.press('Alt+6');
  await until(page, () => !!window.__vis('.pane-cmp .ed-body') || null, null, { timeout: 30_000 });
  const right = modified();
  await page.evaluate((text) => {
    const ta = document.getElementById('input2');
    ta.focus();
    ta.value = text;
    ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  }, right);
  const result = await until(page, () => {
    const c = window.__vis('.cmp');
    if (!c || c.classList.contains('stale')) return null;
    const rows = [...c.querySelectorAll('.cmp-list [data-i]')];
    const empty = c.querySelector('.cmp-empty.ok, .cmp-empty.err');
    if (!rows.length && !empty) return null;
    return { rows: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()), empty: empty?.textContent.replace(/\s+/g, ' ').trim() ?? null };
  }, null, { timeout: 120_000 });
  t.assert(result, 'Compare shows a result');
  await page.evaluate(() => (window.__clip = null));
  await page.locator('.cmp:visible button[aria-label="Copy JSON Patch"]').click();
  const patch = await until(page, () => window.__clip, null, { timeout: 30_000 });
  golden(t, 'big-strict/compare', { ...result, patch }, 'the changes and the patch match the golden file');
});

test('WebMCP tools on a 3 MB document answer exactly', { engines: ['chromium'], launch: { channel: 'chromium', args: ['--enable-features=WebMCPTesting', '--enable-blink-features=WebMCP'] }, tags: ['webmcp'] }, async (t) => {
  const { page } = t;
  await t.open('/');
  for (let i = 0; i < 200 && (await page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)) < 12; i++) await page.waitForTimeout(100);
  t.assert(await load(page, DOC.text, 'agent.json', { timeout: 120_000 }), 'the document loads');
  const exec = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const tool = (await document.modelContext.getTools()).find((x) => x.name === name);
      try {
        return String(await document.modelContext.executeTool(tool, args));
      } catch (e) {
        return 'threw: ' + String(e).slice(0, 200);
      }
    }, [name, args]);
  const out = [];
  for (const [name, args] of [
    ['check_json', {}],
    ['get_json_value', { path: '$[1].v' }],
    ['get_json_value', { path: `$[${DOC.count - 1}]` }],
    ['get_json_value', { path: '$[4].v' }],
    ['convert_json', { to: 'typescript' }],
    ['compare_json', { modified: modified() }],
    ['format_json', { style: 'minified' }],
  ]) {
    const r = await exec(name, args);
    out.push([name, JSON.stringify(args).slice(0, 60), r.length > 1500 ? { hash: hash(r), head: r.slice(0, 1500) } : r]);
  }
  golden(t, 'big-strict/webmcp', out, 'every answer matches the golden file');
});

test('typing into a 3 MB document: the status, tree and output follow each edit, and Undo restores it', async (t) => {
  const { page } = t;
  await t.open('/');
  const { readFileSync } = await import('node:fs');
  const { bigFixture } = await import('./_gen.mjs');
  const text = readFileSync(bigFixture('big-records-3mb'), 'utf8');
  t.assert(await load(page, text, 'edit.json', { timeout: 120_000 }), 'the document loads');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('.app:visible .ed').first().click({ position: { x: 300, y: 60 } });
  // (The raw size reads "2.9 MB" before and after these edits: each step waits for its own state.)
  const state = async (want) => {
    const end = Date.now() + 120_000;
    let st = null;
    while (Date.now() < end) {
      st = await settled(page, { timeout: 120_000 });
      if (st && want(st)) return st;
      await page.waitForTimeout(250);
    }
    return st;
  };
  const out = {};
  // 1. An item added before the closing bracket: valid, one more record.
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(',null');
  out.added = await state((st) => st.kind === 'ok' && st.stats?.includes('216,024 nodes'));
  // 2. A stray letter at the very start: an error at Ln 1, Col 1.
  await page.keyboard.press(`${mod}+Home`);
  await page.keyboard.type('x');
  out.broken = await state((st) => st.kind === 'err');
  await view(page, 'tree');
  out.treeBroken = await page.evaluate(() => window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0);
  // 3. Undo both: the original document, exactly.
  await page.locator('.app:visible .ed').first().click({ position: { x: 300, y: 60 } });
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`);
  out.undone = await state((st) => st.kind === 'ok' && st.stats?.includes('216,023 nodes'));
  const back = await copied(page, 'Copy input to clipboard', { timeout: 60_000 });
  t.check(back !== null && hash(back) === hash(text), 'after two Undos the text is the original', back?.length);
  await view(page, 'tree');
  out.tree = await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 2 || null, null, { timeout: 30_000 }).then(() => treeRows(page).then((r) => r.slice(0, 2)));
  golden(t, 'big-strict/edits', out, 'the status after each edit matches the golden file');
});
