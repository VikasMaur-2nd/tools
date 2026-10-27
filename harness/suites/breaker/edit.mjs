// Edits that rewrite the input (Format, Minify, Sort keys, Escape, Unescape, Repair, Use output) give
// exact text, and Undo / Redo walk back and forth through every step. Downloads save exact bytes under
// the expected names. Copy path / Copy value give exact text for awkward keys. CSV exports of
// formula-like values.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { copied, downloaded, inputText, load, loadAny, until, watchToasts } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000 });

const DOC = '{"b":[1,2,{"z":null,"a":"é"}],"a":1e400,"c":"x\\ny"}';
const PRETTY = '{\n  "b": [\n    1,\n    2,\n    {\n      "z": null,\n      "a": "é"\n    }\n  ],\n  "a": 1e400,\n  "c": "x\\ny"\n}';
const SORTED = '{\n  "a": 1e400,\n  "b": [\n    1,\n    2,\n    {\n      "a": "é",\n      "z": null\n    }\n  ],\n  "c": "x\\ny"\n}';
const ESCAPED = JSON.stringify('{"a":1e400,"b":[1,2,{"a":"é","z":null}],"c":"x\\ny"}');

test('Format, Minify, Sort keys, Escape and Unescape in place are exact, and Undo / Redo walk every step', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, DOC), 'the document loads');
  const steps = [
    ['Format input in place', PRETTY],
    ['Minify input in place', DOC],
    ['Sort input keys A to Z', SORTED],
    ['Escape: convert to a JSON string', ESCAPED],
    ['Unescape: parse stringified JSON', SORTED],
  ];
  const seen = [DOC];
  for (const [label, want] of steps) {
    await command(page, label);
    const got = await until(page, (w) => (window.__vis('#input')?.value === w ? w : null), want, { timeout: 5000 }).then(() => inputText(page));
    t.check(got === want, `${label}: exact input`, got);
    seen.push(want);
  }
  // Back through every step, then forward again.
  for (let i = seen.length - 2; i >= 0; i--) {
    await command(page, 'Undo');
    const got = await inputText(page);
    t.check(got === seen[i], `Undo to step ${i}`, got);
  }
  for (let i = 1; i < seen.length; i++) {
    await command(page, 'Redo');
    const got = await inputText(page);
    t.check(got === seen[i], `Redo to step ${i}`, got);
  }
});

test('Repair JSON fixes a loose document exactly, Undo restores it, and a valid one is left alone', async (t) => {
  const { page } = t;
  await t.open('/');
  const loose = "{\n  // c\n  name: 'Ada',\n  ok: True,\n  n: NaN,\n  list: [1, 2,],\n}";
  t.assert(await load(page, loose), 'the loose document loads');
  await command(page, 'Repair JSON');
  const fixed = await inputText(page);
  t.check(fixed === '{\n  "name": "Ada",\n  "ok": true,\n  "n": null,\n  "list": [\n    1,\n    2\n  ]\n}', 'the repaired text', fixed);
  await command(page, 'Undo');
  t.check((await inputText(page)) === loose, 'Undo restores the loose text');
  await command(page, 'Redo');
  t.check((await inputText(page)) === fixed, 'Redo repairs again');
  await watchToasts(page);
  await command(page, 'Repair JSON');
  const toasts = await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 5000 });
  t.check(toasts?.includes('Already valid JSON, nothing to repair'), 'a valid document is not repaired', toasts);
  t.check((await inputText(page)) === fixed, 'and its text is unchanged');
});

test('Use formatted output as input takes the sorted, minified output exactly', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, DOC), 'the document loads');
  await view(page, 'format');
  await command(page, 'Output: minified');
  await command(page, 'Output: sort keys');
  await command(page, 'Use formatted output as input');
  t.check((await inputText(page)) === JSON.parse(ESCAPED), 'the input is the sorted, minified output');
  await command(page, 'Undo');
  t.check((await inputText(page)) === DOC, 'Undo brings the original back');
});

test('downloads: input, formatted output, converted code and CSV are exact files with the right names', async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await load(page, DOC, 'orders.json'), 'the document loads');
  const input = await downloaded(page, () => command(page, 'Download input as .json'));
  t.check(input?.name === 'orders.json' && input.bytes?.toString() === DOC, 'Download input: orders.json, the exact text', input && { name: input.name, text: input.bytes?.toString().slice(0, 80) });
  await view(page, 'format');
  const out = await downloaded(page, () => command(page, 'Download formatted output'));
  t.check(out?.bytes?.toString() === PRETTY, 'Download formatted output: the pretty text', out && { name: out.name, text: out.bytes?.toString().slice(0, 80) });
  t.check(/^orders.*\.json$/.test(out?.name ?? ''), 'its name comes from the file', out?.name);
  await view(page, 'convert');
  for (const [target, name] of [['typescript', 'orders.ts'], ['java', 'Root.java'], ['zod', 'orders.schema.ts'], ['yaml', 'orders.yaml'], ['csv', 'orders.csv']]) {
    const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
    await select.first().selectOption(target);
    await until(page, () => !window.__vis('.pane-view .spin') && (window.__vis('#view-convert .cv-rows')?.textContent.length ?? 0) > 0 || null, null, { timeout: 20_000 });
    const shown = await copied(page, 'Copy converted output');
    const file = await downloaded(page, () => command(page, 'Download converted output'));
    t.check(file?.name === name, `${target}: saved as ${name}`, file?.name);
    t.check(file?.bytes?.toString() === shown, `${target}: the file is what Copy gives`, file?.bytes?.toString().slice(0, 80));
  }
  const xlsx = await (async () => {
    const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
    await select.first().selectOption('xlsx');
    return downloaded(page, () => command(page, 'Export to Excel (.xlsx)'));
  })();
  t.check(xlsx?.name === 'orders.xlsx' && xlsx.bytes?.subarray(0, 2).toString() === 'PK' && xlsx.bytes.includes('xl/worksheets/sheet1.xml'), 'Excel: orders.xlsx, a zip with a worksheet', xlsx && { name: xlsx.name, size: xlsx.bytes?.length });
});

test('Copy path and Copy value of awkward keys in the tree are exact', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = '{"a.b":{"c\\"d":[{"é 1":[10,{"":"deep"}]}]}}';
  t.assert(await load(page, doc), 'the document loads');
  await view(page, 'tree');
  await command(page, 'Expand all');
  await until(page, () => [...(window.__vis('#view-tree')?.querySelectorAll('[role=treeitem]') ?? [])].some((r) => r.textContent.startsWith(':"deep"') || r.textContent.includes('"deep"')) || null);
  // The deepest row (the empty key) is selected by a click.
  await page.locator('#view-tree:visible [role=treeitem]').filter({ hasText: '"deep"' }).first().click();
  const path = await copied(page, 'Copy selected path');
  t.check(path === '$["a.b"]["c\\"d"][0]["é 1"][1][""]', 'Copy path', path);
  const value = await copied(page, 'Copy selected value');
  t.check(value === 'deep', 'Copy value of a string is its text', value);
  await page.locator('#view-tree:visible [role=treeitem]').filter({ hasText: /^é 1/ }).first().click();
  t.check((await copied(page, 'Copy selected value')) === '[\n  10,\n  {\n    "": "deep"\n  }\n]', 'Copy value of an array is pretty JSON');
});

test('CSV exports of formula-like text: what a spreadsheet would run', async (t) => {
  // OWASP "CSV injection": a cell starting with = + - @ (or a tab / CR before them) runs as a formula when
  // the CSV is opened in Excel or Sheets, unless it is prefixed (usually with ').
  const { page } = t;
  await t.open('/');
  const doc = JSON.stringify([{ v: '=HYPERLINK("http://x.invalid","click")' }, { v: '+1+1' }, { v: '-2+3' }, { v: '@SUM(A1)' }, { v: '\t=1' }, { v: 'plain' }, { v: -5 }]);
  t.assert(await load(page, doc), 'the document loads');
  await view(page, 'table');
  await until(page, () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || null);
  const table = await copied(page, 'Copy table as CSV');
  await view(page, 'convert');
  const select = page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') });
  await select.first().selectOption('csv');
  await until(page, () => !window.__vis('.pane-view .spin') && (window.__vis('#view-convert .cv-rows')?.textContent.length ?? 0) > 0 || null, null, { timeout: 20_000 });
  const conv = await copied(page, 'Copy converted output');
  const live = (csv) => (csv ?? '').split(/\r?\n/).slice(1).filter((l) => /^"?[\t\r]?[=+@-]/.test(l) && !/^-?\d/.test(l));
  t.log('table CSV', table, 'convert CSV', conv);
  t.check(!live(table).length, 'Copy table as CSV neutralises formula cells', live(table));
  t.check(!live(conv).length, 'Convert → CSV neutralises formula cells', live(conv));
  t.check((table ?? '').includes('plain') && (conv ?? '').includes('plain'), 'other cells are unchanged');
});

for (const pad of [0, 3_000_000]) {
  test(`Expand nested JSON string${pad ? ' in a 3 MB document' : ''}: the string becomes its JSON, digits kept, and Undo restores it`, async (t) => {
    const { page } = t;
    await t.open('/');
    const inner = '{"deep":{"list":[1,2,{"x":"y"}],"big":9007199254740993,"e":1e400,"f":1.0000000000000000000001}}';
    const items = [`{"id":1,"payload":${JSON.stringify(inner)}}`, '{"id":2,"payload":"not json {"}'];
    for (let i = 0, s = 0; s < pad; i++) {
      items.push(`{"id":${3 + i},"filler":"${'x'.repeat(100)}"}`);
      s += 120;
    }
    const text = `[${items.join(',')}]`;
    t.assert(await load(page, text, 'nested.json', { timeout: 120_000 }), 'the document loads');
    await view(page, 'tree');
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+f`);
    const box = page.locator('.findbar:visible input');
    await box.fill('$[0].payload');
    await box.press('Enter');
    await until(page, () => /payload/.test(window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent ?? '') || null, null, { timeout: 10_000 });
    await watchToasts(page);
    await command(page, 'Expand nested JSON string');
    const toasts = await until(page, () => (window.__toasts?.some((x) => /Expanded nested JSON/.test(x)) ? window.__toasts : null), null, { timeout: 30_000 });
    t.check(!!toasts, 'it says it expanded the value', await page.evaluate(() => window.__toasts));
    const want = text.replace(JSON.stringify(inner), inner);
    const got = await until(page, (n) => (window.__vis('.sb-l')?.textContent.startsWith('Valid JSON') ? n : null), want.length, { timeout: 60_000 }).then(() => inputText(page));
    t.check(got === want, 'the input holds the expanded JSON with every digit', got?.slice(0, 160));
    await command(page, 'Undo');
    t.check((await inputText(page)) === text, 'Undo brings the string back');
  });
}

test('the tree: a click selects a row, a double-click on a value shows it in the editor', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = JSON.stringify([{ id: 1, tag: 'a' }, { id: 2, tag: 'b' }], null, 2);
  t.assert(await load(page, doc, 'tags.json'), 'the document loads');
  await view(page, 'tree');
  const row = page.locator('#view-tree .tv-rows [role=treeitem]').filter({ hasText: /^tag:"b"$/ });
  await row.click();
  t.check((await row.getAttribute('aria-selected')) === 'true', 'a click selects the row');
  t.check((await page.evaluate(() => document.activeElement?.id)) !== 'input', 'a click leaves the focus in the tree');
  await row.dblclick();
  const moved = await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 5000 });
  t.check(!!moved, 'a double-click moves to the editor (BREAKER-REPORT F17)');
  // The value is what the editor selected: typing replaces exactly it.
  if (moved) await page.keyboard.type('"Z"');
  t.check((await inputText(page)) === doc.replace('"b"', '"Z"'), 'the editor selected the value', await inputText(page));
});

test('a JWT opened as the page loads is read as one (its reader loads on first use)', async (t) => {
  const { page } = t;
  await t.open('/');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'abc', exp })}.c2lnbmF0dXJl`;
  t.assert(await load(page, jwt, 'token.txt'), 'the token loads');
  const st = await until(page, () => (/^JWT · HS256/.test(window.__vis('.sb-l')?.textContent ?? '') ? window.__vis('.sb-l').textContent : null), null, { timeout: 10_000 });
  t.check(!!st, 'the status says JWT · HS256', st ?? (await page.evaluate(() => window.__vis('.sb-l')?.textContent)));
  const out = await copied(page, 'Copy formatted output');
  t.check(!!out && out.includes('"alg": "HS256"') && out.includes('"sub": "abc"'), 'the output is the decoded token', out?.slice(0, 200));
});

test('typing over a selection is one Undo step with the typing that follows', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = JSON.stringify([{ id: 1, tag: 'a' }, { id: 2, tag: 'b' }], null, 2);
  t.assert(await load(page, doc, 'tags.json'), 'the document loads');
  await view(page, 'tree');
  await page.locator('#view-tree .tv-rows [role=treeitem]').filter({ hasText: /^tag:"b"$/ }).dblclick();
  t.assert(!!(await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 5000 })), 'the value is selected in the editor');
  await page.keyboard.type('"EDITED"');
  t.check((await inputText(page)) === doc.replace('"b"', '"EDITED"'), 'typed over the value');
  await command(page, 'Undo');
  t.check((await inputText(page)) === doc, 'one Undo brings the value back (BREAKER-REPORT F19)', await inputText(page));
  await command(page, 'Redo');
  t.check((await inputText(page)) === doc.replace('"b"', '"EDITED"'), 'Redo types it again');
});

test('an edit made while the Tree shows: Copy formatted output, Copy converted output and Download formatted output give the edited document', async (t) => {
  const { page } = t;
  await t.open('/');
  const doc = JSON.stringify([{ id: 1, tag: 'a' }, { id: 2, tag: 'b' }], null, 2);
  t.assert(await load(page, doc, 'tags.json'), 'the document loads');
  await view(page, 'convert');
  await page.locator('.app:visible .pane-view select').filter({ has: page.locator('option[value="typescript"]') }).first().selectOption('csv');
  t.check((await copied(page, 'Copy converted output')) === 'id,tag\r\n1,a\r\n2,b\r\n', 'CSV before the edit');
  // Show in editor from the tree, then type over the value.
  await view(page, 'tree');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+f`);
  const box = page.locator('.findbar:visible input');
  await box.fill('$[1].tag');
  await box.press('Enter');
  await until(page, () => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent === 'tag:"b"' || null, null, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__vis('#view-tree').focus());
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 5000 });
  await page.keyboard.type('"EDITED"');
  const want = doc.replace('"b"', '"EDITED"');
  t.check(!!(await until(page, () => [...document.querySelectorAll('#view-tree .tv-rows [role=treeitem]')].some((r) => r.textContent === 'tag:"EDITED"') || null, null, { timeout: 10_000 })), 'the tree shows the edit');
  t.check((await inputText(page)) === want, 'the input holds the edit');
  const known = { known: 'bug (main and branch): from a view other than Format/Convert, output commands give the output from before the edit (BREAKER-REPORT F18)' };
  const out = await copied(page, 'Copy formatted output');
  t.check(out === want, 'Copy formatted output, from the Tree: the edited document', out?.slice(0, 80), known);
  const csv = await copied(page, 'Copy converted output');
  t.check(csv === 'id,tag\r\n1,a\r\n2,EDITED\r\n', 'Copy converted output, from the Tree: the edited CSV', csv, known);
  const file = await downloaded(page, () => command(page, 'Download formatted output'));
  t.check(file?.bytes?.toString() === want, 'Download formatted output, from the Tree: the edited document', file?.bytes?.toString().slice(0, 80), known);
});

test('Repair keeps ordinary JSON\'s escaped quotes: an error elsewhere is not read as JSON written as a string', async (t) => {
  // Ordinary JSON holding an escaped quote, with an error repair can't fix. Main says where the error is and
  // refuses to repair it; a repair may drop the stray text, but each string must keep its value.
  const { page } = t;
  await t.open('/');
  for (const [doc, kept] of [
    ['{"a":"q\\"x"} @', (v) => v?.a === 'q"x' && Object.keys(v).length === 1],
    ['{"a": "\\"", "b": ~}', (v) => v?.a === '"'],
  ]) {
    const st = await loadAny(page, doc, 'doc.json');
    t.check(!!st && !/JSON written as a string/.test(st.msg), `${doc}: the status names the real error`, st?.msg);
    await watchToasts(page);
    await command(page, 'Repair JSON');
    await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 5000 });
    const after = await inputText(page);
    let value = null;
    try {
      value = JSON.parse(after);
    } catch {}
    t.check(after === doc || kept(value), `${doc}: Repair leaves it alone or keeps every string's value`, after);
  }
});

test('Repair of JSON written as a string: read exactly, or left alone', async (t) => {
  // Main leaves these alone; t3/optimize-json-memory-performance reads them with their escapes undone. Either
  // is fine, anything else isn't (a half-undone escape, a lost character).
  const { page } = t;
  await t.open('/');
  for (const [doc, value] of [
    ['{\\"a\\": 1, \\"b\\": [true, null]}', { a: 1, b: [true, null] }],
    ['[\\"x\\", \\"y z\\"]', ['x', 'y z']],
    ['{\\"s\\": \\"l1\\\\nl2 \\\\u00e9 \\\\\\"q\\\\\\"\\", \\"p\\": \\"C:\\\\\\\\dir\\"}', { s: 'l1\nl2 é "q"', p: 'C:\\dir' }],
    ['{\\"a\\": 1,}', { a: 1 }],
  ]) {
    await loadAny(page, doc, 'doc.json');
    await watchToasts(page);
    await command(page, 'Repair JSON');
    await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 5000 });
    const after = await inputText(page);
    let got;
    try {
      got = JSON.parse(after);
    } catch {}
    t.check(after === doc || JSON.stringify(got) === JSON.stringify(value), `${doc}: read exactly or left alone`, after);
  }
});

test('Repair of a single-quoted string left open: the members after it survive, or it is left alone', async (t) => {
  // Main says "Unterminated string" and leaves it. The branch (since c355336) closes the string at the end of the
  // input, swallowing every member after it, and an apostrophe inside a single-quoted string makes up a key
  // (BREAKER-REPORT R7). Double quotes are closed before the next ',' instead, which keeps them.
  const { page } = t;
  await t.open('/');
  for (const [doc, kept] of [
    ["{\"name\": 'O'Brien', \"age\": 3}", (v) => v?.age === 3 && Object.keys(v).length === 2],
    ["{\"a\": 'x, \"b\": 2, \"c\": [1, 2]}", (v) => v?.b === 2 && JSON.stringify(v.c) === '[1,2]'],
    ['{"a": 1, "b": "unclosed, "c": 3}', (v) => v?.c === 3 && v.a === 1],
  ]) {
    await loadAny(page, doc, 'doc.json');
    await watchToasts(page);
    await command(page, 'Repair JSON');
    await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 5000 });
    const after = await inputText(page);
    let value;
    try {
      value = JSON.parse(after);
    } catch {}
    t.check(after === doc || kept(value), `${doc}: the members after it survive, or it is left alone`, after);
  }
});
