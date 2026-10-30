// Documents of 2 MB+ with Windows (CRLF), old Mac (CR) and mixed line ends, opened as files. The editor keeps
// every line end as \n, so every offset (the worker's tree, Show in editor, the caret, an error's position)
// must count the same way: exact input text, Format output, tree values, the node Show in editor selects
// and its Ln/Col, an edit reaching the tree and the output, Undo, and an error's "Ln N, Col M".
// On main a 2 MB+ CRLF file gets shifted values in the tree (BREAKER-REPORT F16; .jsonl and .json).
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { cursor, installHelpers, lineCol } from '../editor/_helpers.mjs';
import { copied, hash, inputText, loadAny, MOD, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 300_000 });

const F16 = { known: 'bug (main): a 2 MB+ file with CRLF line ends gets shifted values in the tree (BREAKER-REPORT F16)' };

/** Records of multi-byte text (BMP, astral, combining-free), about `bytes` long pretty-printed. */
function records(bytes) {
  const recs = [];
  for (let i = 0, size = 0; size < bytes; i++) {
    const r = { i, s: `${'é東😀'.repeat(1 + (i % 5))} ${i}`, n: i * 1.5, tag: `k${i}` };
    recs.push(r);
    size += JSON.stringify(r, null, 2).length + 12;
  }
  return recs;
}
const RECS = records(3_000_000);
const LAST = RECS.length - 1;

// [label, line end after line k]
const EOLS = [
  ['CRLF', () => '\r\n'],
  ['CR', () => '\r'],
  ['mixed CRLF, LF and CR', (k) => ['\r\n', '\n', '\r'][k % 3]],
  ['CR CR LF (a blank line each)', () => '\r\r\n'],
];

/** `lines` joined with `eol(k)` after line k (none after the last). */
const join = (lines, eol) => lines.map((l, k) => l + (k < lines.length - 1 ? eol(k) : '')).join('');

/** The selected tree row's text after a Find for `q` (a path or text), or null. */
async function treeFind(page, q, want = null, timeout = 15_000) {
  const box = page.locator('.findbar:visible input');
  if (!(await box.count())) await page.keyboard.press(`${MOD}+f`);
  let row = null;
  const end = Date.now() + timeout;
  // (After an edit the tree is rebuilt when the analysis comes: search again until it shows `want`.)
  do {
    await box.fill('');
    await box.fill(q);
    await box.press('Enter');
    row = await until(page, () => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent || null, null, { timeout: 5000 });
    if (want === null || row === want) break;
    await page.waitForTimeout(500);
  } while (Date.now() < end);
  await page.keyboard.press('Escape');
  return row;
}

/** Show in editor (Enter in the tree) for the selected row; returns [caret [ln, col], selected text]. */
async function showInEditor(page) {
  await page.evaluate(() => window.__vis('#view-tree').focus());
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 5000 });
  return [await cursor(page), await page.evaluate(() => window.__ed.clip('copy'))];
}

const validNow = (page, re) => until(page, (s) => new RegExp(s).test(window.__vis('.sb-l .st')?.textContent ?? '') && !window.__vis('.sb-l .spin') || null, re.source, { timeout: 120_000 });

for (const [label, eol] of EOLS) {
  test(`3 MB .json with ${label} line ends: input, output, tree, Show in editor, an edit and Undo, all at the right place`, async (t) => {
    const { page } = t;
    await installHelpers(page);
    await t.open('/');
    const lf = JSON.stringify(RECS, null, 2);
    const raw = join(lf.split('\n'), eol);
    const want = raw.replace(/\r\n?/g, '\n');
    const st = await loadAny(page, Buffer.from(raw, 'utf8'), 'records.json', { timeout: 120_000 });
    t.check(st?.kind === 'ok' && st.msg === 'Valid JSON' && st.stats?.startsWith(`${want.split('\n').length.toLocaleString('en-US')} lines · `), 'valid, every line counted once', st);
    t.check(hash((await inputText(page)) ?? '') === hash(want), 'the input holds the text with \\n line ends');
    t.check(hash((await copied(page, 'Copy formatted output', { timeout: 60_000 })) ?? '') === hash(lf), 'the Format output is exact');
    await view(page, 'tree');
    // (Main reads lone CRs right: only files with CRLF were shifted.)
    const known = label === 'CR' ? {} : F16;
    const firstRow = await treeFind(page, '$[1].tag');
    t.check(firstRow === 'tag:"k1"', 'the tree shows record 1 exactly', firstRow, known);
    const lastRow = await treeFind(page, `$[${LAST}].tag`);
    t.check(lastRow === `tag:"k${LAST}"`, 'the tree shows the last record exactly', lastRow, known);
    const [at, sel] = await showInEditor(page);
    const off = want.lastIndexOf(`"k${LAST}"`);
    t.check(sel === `"k${LAST}"` && JSON.stringify(at) === JSON.stringify(lineCol(want, off)), 'Show in editor selects the value, caret at its Ln/Col', { at, want: lineCol(want, off), sel: sel?.slice(0, 40) });
    // An edit over the selection reaches the output and the tree.
    await page.keyboard.type('"EDITED"');
    await validNow(page, /^Valid JSON/);
    const edited = JSON.stringify(RECS.map((r, i) => (i === LAST ? { ...r, tag: 'EDITED' } : r)), null, 2);
    const editedRow = await treeFind(page, `$[${LAST}].tag`, 'tag:"EDITED"', 30_000);
    t.check(editedRow === 'tag:"EDITED"', 'the edit reaches the tree', editedRow);
    // (In the Format view: from the others, Copy formatted output gives the output before the edit, BREAKER-REPORT F18.)
    await view(page, 'format');
    let out = null;
    for (let k = 0; k < 30 && hash(out ?? '') !== hash(edited); k++) {
      out = await copied(page, 'Copy formatted output', { timeout: 60_000 });
      if (hash(out ?? '') !== hash(edited)) await page.waitForTimeout(1000);
    }
    t.check(hash(out ?? '') === hash(edited), 'the edit reaches the Format output', out?.length);
    // (Typing over a selection is one Undo step: BREAKER-REPORT F19.)
    await command(page, 'Undo');
    const back = await inputText(page);
    t.check(hash(back ?? '') === hash(want), 'one Undo brings the text back');
    await validNow(page, /^Valid JSON/);
    await view(page, 'tree');
    const undoneRow = await treeFind(page, `$[${LAST}].tag`, `tag:"k${LAST}"`, 30_000);
    t.check(undoneRow === `tag:"k${LAST}"`, 'Undo reaches the tree', undoneRow);
  });
}

for (const [label, eol] of EOLS) {
  test(`3 MB .json with ${label} line ends and an error in the last record: its Ln and Col`, async (t) => {
    const { page } = t;
    await t.open('/');
    // The last record's "tag" loses its colon: the error is at its value.
    const lf = JSON.stringify(RECS, null, 2).replace(`"tag": "k${LAST}"`, `"tag" "k${LAST}"`);
    const want = join(lf.split('\n'), eol).replace(/\r\n?/g, '\n');
    const st = await loadAny(page, Buffer.from(join(lf.split('\n'), eol), 'utf8'), 'broken.json', { timeout: 120_000 });
    const [ln, col] = lineCol(want, want.lastIndexOf(`"k${LAST}"`));
    t.check(!!st?.msg.startsWith(`Ln ${ln}, Col ${col}: Expected ':' after property name`), `the error is at Ln ${ln}, Col ${col}`, st);
  });
}

for (const [label, eol] of EOLS.filter(([l]) => l !== 'CRLF')) {
  // (CRLF JSON Lines: files.mjs.)
  test(`3 MB of JSON Lines with ${label} line ends: every record, exactly`, async (t) => {
    const { page } = t;
    await t.open('/');
    const lines = RECS.map((r) => JSON.stringify(r));
    const raw = join(lines, eol) + eol(lines.length - 1);
    const st = await loadAny(page, Buffer.from(raw, 'utf8'), 'records.jsonl', { timeout: 120_000 });
    const known = label === 'CR' ? {} : F16;
    t.check(st?.kind === 'ok' && st.msg === `JSON Lines · ${RECS.length.toLocaleString('en-US')} records`, 'JSON Lines with every record', st);
    t.check(hash((await copied(page, 'Copy formatted output', { timeout: 60_000 })) ?? '') === hash(JSON.stringify(RECS, null, 2)), 'the Format view holds the records as one exact array', null, known);
    await view(page, 'tree');
    const firstRow = await treeFind(page, '$[1].tag');
    t.check(firstRow === 'tag:"k1"', 'the tree shows record 1 exactly', firstRow, known);
    const lastRow = await treeFind(page, `$[${LAST}].s`);
    t.check(lastRow === `s:${JSON.stringify(RECS[LAST].s)}`, 'the tree shows the last record exactly', lastRow, known);
  });
}
