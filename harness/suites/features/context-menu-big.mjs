// The right-click menu on big documents: a 300 KB minified line (the big-document editor), a 150 KB pretty
// document (the quiet view) and 40,000 short lines. #14 removed the read-only view: every document is
// editable. Ported from selftest/ctxmenu/check2.mjs (24 checks).
import { defaults, test } from '../../lib/api.mjs';
import { MOD, inputText, loadText, pick, pills, poll, resetClip, rightClick, setClipboardRead, until, waitClip, waitMenu } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['menu'] });

const items = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `item number ${i}`, tags: ['a', 'b'], ok: i % 2 === 0 }));
const MIN = JSON.stringify(items);
const PRETTY = JSON.stringify(items.slice(0, 1200), null, 2);
const LINES = '[\n' + Array.from({ length: 40000 }, () => '1').join(',\n') + '\n]';

const edCls = (page) => page.evaluate(() => window.__vis('.pane-ed .ed').className);
const waitCls = (page, re) => until(page, ([s, f]) => new RegExp(s, f).test(window.__vis('.pane-ed .ed')?.className ?? '') && window.__vis('.pane-ed .ed').className, [re.source, re.flags], { timeout: 10_000 });
const cursor = (page) => page.evaluate(() => window.__vis('.statusbar .cursor')?.textContent ?? '');
const waitCursor = (page, re) => until(page, ([s, f]) => { const c = window.__vis('.statusbar .cursor')?.textContent ?? ''; return new RegExp(s, f).test(c) && c; }, [re.source, re.flags], { timeout: 3000 }).then(async (v) => v || cursor(page));
const body = (page) => page.evaluate(() => { const b = window.__vis('.pane-ed .ed-body').getBoundingClientRect(); return { x: b.left, y: b.top }; });
const head = (page, n = 60) => page.evaluate((n) => window.__vis('.pane-ed .ed-hl')?.textContent?.slice(0, n), n);
const waitHead = (page, pred, n = 80) => poll(async () => { const h = await head(page, n); return pred(h ?? '') && h; }, { timeout: 5000 });
const labels = (m) => m?.items ?? [];

async function start(t, name, text) {
  await t.open('/');
  await setClipboardRead(t.page, 'PASTED');
  t.assert(await loadText(t.page, name, text), `${name} is open`);
}

test('a 300 KB minified line: the big-document editor', async (t) => {
  const { page } = t;
  await start(t, 'big.json', MIN);
  let cls = await waitCls(page, /surface/);
  t.check(/surface/.test(cls) && !/vmode/.test(cls), 'a loaded 300 KB line opens in the big-document editor', cls);
  const b = await body(page);
  const at = (col) => b.x + 16 + col * 7.8 + 2;
  // A right click there moves the caret.
  await rightClick(page, at(40), b.y + 20);
  let st = await waitCursor(page, /Col 4[01]\b/);
  t.check(/Col 4[01]\b/.test(st) && /surface/.test(await edCls(page)), 'a right click moves the caret, in the big-document editor', [st, await edCls(page)]);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  await page.mouse.click(at(30), b.y + 20);
  await waitCursor(page, /Col 3[01]\b/);
  t.check(/surface/.test(await edCls(page)), 'a click keeps the big-document editor', await edCls(page));
  // Right click well into the first row: the caret moves there (right presses used to be ignored).
  let m = await rightClick(page, at(40), b.y + 20);
  st = await waitCursor(page, /Col 4[01]\b/);
  t.check(/Col 4[01]\b/.test(st), 'a right click moves the caret to the point', st);
  t.check(labels(m).includes('-Cut') && labels(m).includes('Copy all') && labels(m).includes('Paste'), 'no selection: Cut off, Copy all, Paste', m?.items);
  await pick(page, 'Paste');
  let h = await waitHead(page, (x) => x.includes('PASTED'));
  t.check(/PASTED/.test(h || ''), 'Paste lands at the caret', h || (await head(page, 80)));
  await page.keyboard.press(`${MOD}+z`);
  await waitHead(page, (x) => !x.includes('PASTED'));

  // A selection made with the keyboard: Copy, Cut, Undo.
  for (let k = 0; k < 6; k++) await page.keyboard.press('Shift+ArrowRight');
  await waitCursor(page, /selected/);
  m = await rightClick(page, b.x + 16 + 42 * 7.8, b.y + 20);
  t.check(labels(m).includes('Cut') && labels(m).includes('Copy'), 'a right click inside the selection keeps it: Cut, Copy', m?.items);
  await resetClip(page);
  await pick(page, 'Copy');
  const copied = await waitClip(page);
  t.check(copied?.length === 6 && MIN.includes(copied), 'Copy copies the 6 selected characters', copied);
  // Where the selection was: 6 characters from the caret at column 40 or 41.
  const c = [39, 40, 41].find((i) => MIN.slice(i, i + 6) === copied) ?? -1;
  await rightClick(page, b.x + 16 + 42 * 7.8, b.y + 20);
  await resetClip(page);
  await pick(page, 'Cut');
  t.check((await waitClip(page)) === copied, 'Cut ran (it copies the selection)', await page.evaluate(() => window.__clip));
  const cut = (MIN.slice(0, c) + MIN.slice(c + 6)).slice(0, 60);
  h = await waitHead(page, (x) => x.slice(0, 60) === cut, 60);
  t.check(c >= 0 && h === cut, 'Cut removed it', h || (await head(page)));
  await rightClick(page, b.x + 300, b.y + 200);
  await pick(page, 'Undo');
  h = await waitHead(page, (x) => x === MIN.slice(0, 60), 60);
  t.check(h === MIN.slice(0, 60), 'Undo restores it', h || (await head(page)));
  await rightClick(page, b.x + 300, b.y + 200);
  await pick(page, 'Select all');
  st = await waitCursor(page, /selected/);
  t.check(/selected/.test(st), 'Select all selects the document', st);
  t.check(await page.evaluate(() => document.activeElement === document.getElementById('input')), 'the passage textarea has focus');
  await rightClick(page, b.x + 300, b.y + 200);
  await resetClip(page);
  await pick(page, 'Copy');
  const all = await waitClip(page);
  t.check(all === MIN, 'Copy after Select all copies the whole document', all?.length);
});

test('a 150 KB pretty document: the quiet view', async (t) => {
  const { page } = t;
  await start(t, 'pretty.json', PRETTY);
  const cls = await waitCls(page, /vmode/);
  t.check(/vmode/.test(cls), `a ${PRETTY.length} char pretty document opens in the quiet view`, cls);
  const b = await body(page);
  const m = await rightClick(page, b.x + 100, b.y + 10 + 20 * 3 + 10);
  t.check(labels(m).includes('-Cut') && labels(m).includes('Paste') && labels(m).includes('Fold'), 'quiet view: Cut off, Paste on, Fold', m?.items);
  await pick(page, 'Fold');
  const p = await until(page, () => document.querySelectorAll('.pane-ed .ed-fold').length || null, null, { timeout: 3000 }).then(() => pills(page));
  t.check(p.length === 1, 'Fold works in the view', p.length);
  await rightClick(page, b.x + 100, b.y + 10 + 20 * 1 + 10);
  await pick(page, 'Expand all');
  await until(page, () => document.querySelectorAll('.pane-ed .ed-fold').length === 0, null, { timeout: 3000 });
  await rightClick(page, b.x + 100, b.y + 10 + 20 * 2 + 10);
  await pick(page, 'Paste');
  const top = await poll(async () => { const v = (await inputText(page)).slice(0, 40); return /PASTED/.test(v) && v; }, { timeout: 5000 });
  t.check(/PASTED/.test(top || '') && !/vmode/.test(await edCls(page)), 'Paste wakes the view and inserts at the point', [top || (await inputText(page)).slice(0, 40), await edCls(page)]);
});

test('40,000 short lines: the big-document editor, editable', async (t) => {
  const { page } = t;
  await start(t, 'lines.json', LINES);
  const cls = await waitCls(page, /surface/);
  t.check(/surface/.test(cls) && !(await page.evaluate(() => !!window.__vis('.ed-notice'))), 'many short lines: the big-document editor, no read-only notice', cls);
  const b = await body(page);
  let m = await rightClick(page, b.x + 100, b.y + 60);
  t.check(labels(m).includes('-Cut') && labels(m).includes('Paste') && labels(m).includes('Copy all'), 'many short lines, nothing selected: Cut off, Paste, Copy all', m?.items);
  await pick(page, 'Select all');
  await waitCursor(page, /selected/);
  m = await rightClick(page, b.x + 100, b.y + 60);
  t.check(labels(m).includes('Copy'), 'after Select all: Copy', m?.items);
  await resetClip(page);
  await pick(page, 'Copy');
  const all = await waitClip(page);
  t.check(all === LINES, 'Copy copies the whole document', all?.length);
  // Paste over the selection (all of it) replaces the document, as Ctrl+V does.
  await setClipboardRead(page, '{"replaced":true}');
  await rightClick(page, b.x + 100, b.y + 60);
  await pick(page, 'Paste');
  const v = await poll(async () => (await inputText(page)) === '{"replaced":true}', { timeout: 5000 });
  t.check(v, 'Paste over Select all replaces the document', (await inputText(page)).slice(0, 40));
});
