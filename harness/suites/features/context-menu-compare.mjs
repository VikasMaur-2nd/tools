// The right-click menu in Compare's differences panel: the Changes list, the line Diff, and the Diff
// layout choice on a wide window. Ported from selftest/ctxmenu/check4.mjs (28 checks).
import { defaults, test } from '../../lib/api.mjs';
import { inputText, menu, pick, pickChoice, poll, prevented, resetClip, rightClickOn, setDoc, until, waitClip, waitMenu, watchContextMenu } from './_helpers.mjs';

// WebKit logs "ResizeObserver loop completed with undelivered notifications" on opening Compare, on main
// too (PR #15's notes): each test checks page errors itself, without that one.
defaults({ engines: 'all', width: 1280, height: 900, tags: ['menu'], allowErrors: true });

const L = { name: 'Tool Kumar', tags: ['json', 'viewer'], a: 1, keep: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])), tail: 'x' };
const R = { name: 'Tool K', tags: ['json', 'viewer', 'diff'], keep: L.keep, tail: 'y' };
const LT = JSON.stringify(L, null, 2);
const RT = JSON.stringify(R, null, 2);
const ROW = '.cmp-list [data-i]';

async function start(t) {
  const { page } = t;
  await t.open('/');
  await watchContextMenu(page);
  t.assert(await setDoc(page, LT), 'the original is in');
  await page.keyboard.press('Alt+6');
  await until(page, () => !!window.__vis('.pane-cmp .ed-body'), null, { timeout: 15_000 });
  await page.evaluate(() => document.getElementById('input2').focus());
  await setDoc(page, RT, 'input2');
  await until(page, (sel) => document.querySelectorAll(sel).length >= 3, ROW, { timeout: 15_000 });
}
const errorsOk = (t) => {
  const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e));
  t.check(!errs.length, 'no page errors', errs.slice(0, 3));
};
const selected = (page) => page.evaluate(() => document.querySelector('.cmp-list [data-i][aria-current="true"], .cmp-list [data-i].sel')?.getAttribute('data-i'));

test('the Changes list', async (t) => {
  const { page } = t;
  await start(t);
  const rows = await page.evaluate((s) => [...document.querySelectorAll(s)].map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)), ROW);
  t.check(rows.length >= 3, 'the changes list', rows);
  let m = await rightClickOn(page, ROW);
  t.check(m?.label === 'Differences', 'right click in the differences opens the menu', m?.label);
  t.check((await prevented(page)) === true, "the browser's menu is cancelled");
  t.check((await selected(page)) === '0', 'the row under the pointer is selected', await selected(page));
  t.check(
    JSON.stringify(m?.items) === JSON.stringify(['Copy path', 'Copy original value', 'Copy modified value', 'Show in editors', 'View[Changes]', 'Previous difference', 'Next difference', 'Ignore key order✓', 'Ignore array order', 'Ignore case', 'Swap original and modified', 'Copy JSON Patch', 'All commands']),
    'items for a changed value',
    m?.items,
  );
  const copy = async (label) => {
    await rightClickOn(page, ROW);
    await resetClip(page);
    await pick(page, label);
    return waitClip(page);
  };
  // (The first menu is still open.)
  await resetClip(page);
  await pick(page, 'Copy path');
  let c = await waitClip(page);
  t.check(c === '$.name', 'Copy path', c);
  c = await copy('Copy original value');
  t.check(c === 'Tool Kumar', 'Copy original value', c);
  c = await copy('Copy modified value');
  t.check(c === 'Tool K', 'Copy modified value', c);
  await rightClickOn(page, ROW);
  await pick(page, 'Show in editors');
  // (As a click on the row does: both editors mark that line, here line 2.)
  const marks = await until(page, () => { const m = ['.pane-ed', '.pane-cmp'].map((p) => window.__vis(p + ' .ed-scope')?.style.transform); return m.every((x) => x === 'translateY(30px)') && m; }, null, { timeout: 3000 }).then(async (v) => v || page.evaluate(() => ['.pane-ed', '.pane-cmp'].map((p) => window.__vis(p + ' .ed-scope')?.style.transform)));
  t.check(marks.every((x) => x === 'translateY(30px)'), 'Show in editors marks it in both editors', marks);
  // A removed value: no modified value to copy.
  const removedAt = await page.evaluate((s) => [...document.querySelectorAll(s)].findIndex((r) => r.textContent.includes('$.a')), ROW);
  m = await rightClickOn(page, ROW, { i: removedAt });
  t.check(m && m.items.includes('Copy original value') && !m.items.includes('Copy modified value'), 'a removed value: only its original', m?.items);
  await pick(page, 'Ignore array order');
  const pressed = await until(page, () => document.querySelectorAll('.cmp-opt')[1]?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 }).then(() => page.evaluate(() => [...document.querySelectorAll('.cmp-opt')].map((b) => b.getAttribute('aria-pressed'))));
  t.check(pressed[1] === 'true', 'Ignore array order turns the option on', pressed);
  m = await rightClickOn(page, ROW);
  t.check(m?.items.includes('Ignore array order✓'), 'and the menu shows it checked', m?.items);
  await pick(page, 'Ignore array order');
  await until(page, () => document.querySelectorAll('.cmp-opt')[1]?.getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
  // (The list from before has 3 rows too: wait for the comparison with the new option, or the one it makes after
  // Next difference starts again at the first row.)
  await until(page, (s) => !document.querySelector('.cmp.stale') && document.querySelectorAll(s).length >= 3, ROW, { timeout: 5000 });
  await rightClickOn(page, ROW);
  await pick(page, 'Next difference');
  const selN = await until(page, () => document.querySelector('.cmp-list [aria-current="true"], .cmp-list .sel')?.getAttribute('data-i') === '1' && '1', null, { timeout: 3000 }).then(async (v) => v || selected(page));
  t.check(selN === '1', 'Next difference', selN);
  c = await copy('Copy JSON Patch');
  t.check(/"op": "replace"/.test(c ?? ''), 'Copy JSON Patch', (c ?? '').slice(0, 60));
  // Keyboard: Shift+F10 in the list.
  await page.evaluate(() => document.querySelector('.cmp-list').focus());
  await page.keyboard.press('Shift+F10');
  await waitMenu(page);
  m = await until(page, () => (document.activeElement?.querySelector('span')?.textContent ?? document.activeElement?.textContent)?.trim() === 'Copy path', null, { timeout: 3000 }).then(() => menu(page));
  t.check(m?.focus === 'Copy path', 'Shift+F10 in the list: the selected row’s menu, first item focused', m?.focus);
  await page.keyboard.press('Escape');
  m = await waitMenu(page, false);
  t.check(!m && (await until(page, () => document.activeElement?.classList.contains('cmp-list'), null, { timeout: 3000 })) === true, 'Esc gives focus back to the list');
  // The options row keeps the browser's menu (a text field is there).
  await page.evaluate(() => (window.__prevented = undefined));
  await rightClickOn(page, '.cmp-ign', { wait: false });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  t.check(!(await menu(page)) && (await prevented(page)) !== true, "the options row keeps the browser's menu", await prevented(page));
  await page.keyboard.press('Escape');
  errorsOk(t);
});

test('the line Diff', async (t) => {
  const { page } = t;
  await start(t);
  await rightClickOn(page, ROW);
  await pickChoice(page, 'Diff');
  const diff = await until(page, () => !!document.querySelector('.cmp-ds [data-r]'), null, { timeout: 10_000 });
  t.check(diff === true, 'View → Diff switches to the line diff');
  const lineI = await page.evaluate(() => [...document.querySelectorAll('.cmp-ds [data-r]')].findIndex((r) => !r.classList.contains('gap') && r.textContent.includes('Tool')));
  let m = await rightClickOn(page, '.cmp-ds [data-r]', { i: lineI });
  t.check(JSON.stringify(m?.items) === JSON.stringify(['Show in editors', 'View[Diff]', 'Previous change', 'Next change', 'Ignore key order✓', 'Swap original and modified', 'Copy JSON Patch', 'All commands']), 'items for a line (narrow panel: no layout)', m?.items);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  const gapI = await page.evaluate(() => [...document.querySelectorAll('.cmp-ds [data-r]')].findIndex((r) => r.classList.contains('gap')));
  t.check(gapI >= 0, 'the diff folds unchanged lines', gapI);
  const rowsBefore = await page.evaluate(() => document.querySelector('.cmp-dz').style.height);
  m = await rightClickOn(page, '.cmp-ds [data-r]', { i: gapI });
  t.check(m?.items[0] === 'Show unchanged lines', 'on folded lines: Show unchanged lines', m?.items);
  await pick(page, 'Show unchanged lines');
  const rowsAfter = await until(page, (b) => parseInt(document.querySelector('.cmp-dz').style.height) > parseInt(b) && document.querySelector('.cmp-dz').style.height, rowsBefore, { timeout: 3000 }).then(async (v) => v || page.evaluate(() => document.querySelector('.cmp-dz').style.height));
  t.check(parseInt(rowsAfter) > parseInt(rowsBefore), 'it shows them', [rowsBefore, rowsAfter]);
  await rightClickOn(page, '.cmp-ds [data-r]');
  await pick(page, 'Swap original and modified');
  const swapped = await poll(async () => (await inputText(page)) === RT, { timeout: 5000 });
  t.check(swapped, 'Swap swaps the documents', (await inputText(page)).slice(0, 40));
  errorsOk(t);
});

test('a wide window: the Diff layout choice', { width: 2600 }, async (t) => {
  const { page } = t;
  await start(t);
  await rightClickOn(page, ROW);
  await pickChoice(page, 'Diff');
  await until(page, () => document.querySelectorAll('.cmp-ds [data-r]').length > 3, null, { timeout: 10_000 });
  let m = await rightClickOn(page, '.cmp-ds [data-r]', { i: 3 });
  t.check(m?.items.includes('Diff layout[Unified]'), 'wide panel: Diff layout', m?.items);
  await pickChoice(page, 'Split');
  const split = await until(page, () => !!document.querySelector('.cmp-dv.split'), null, { timeout: 5000 });
  t.check(split === true, 'Split shows the documents side by side');
  await until(page, () => document.querySelectorAll('.cmp-ds [data-r]').length > 3, null, { timeout: 5000 });
  m = await rightClickOn(page, '.cmp-ds [data-r]', { i: 3 });
  t.check(m?.items.includes('Diff layout[Split]'), 'and the menu shows Split', m?.items);
  await pickChoice(page, 'Unified');
  errorsOk(t);
});
