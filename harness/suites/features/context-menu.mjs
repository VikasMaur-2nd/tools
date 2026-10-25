// The right-click menu in the viewer's editors and views (PR #15): what it offers where, what each item
// does, the keyboard, closing, placement, translations, a narrow window, a tool page, and /integrate
// (which keeps the browser's menu). Ported from selftest/ctxmenu/check.mjs (80 checks) and check3.mjs (6).
import { defaults, test } from '../../lib/api.mjs';
import {
  MOD, edBox, inputText, lineY, menu, pick, pickChoice, pills, poll, prevented, resetClip, rightClick, rightClickOn, setClipboardRead, setDoc, taSel, until, waitClip, waitMenu, watchContextMenu,
} from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['menu'] });

const DOC = `{
  "name": "Tool Kumar",
  "tags": [
    "json",
    "viewer"
  ],
  "nested": {
    "a": 1,
    "b": {
      "c": true
    }
  }
}`;
const INPUT_ITEMS = ['Fold', 'Collapse all', 'Expand all', 'Show levels', 'Wrap lines✓', 'Format', 'Download input', 'Share', 'Undo', '-Redo', '-Cut', 'Copy all', 'Paste', 'Select all', 'All commands'];

/** Opens the viewer with DOC (or `doc`) in the input; returns the input editor's box. */
async function start(t, doc = DOC, path = '/') {
  await t.open(path);
  await watchContextMenu(t.page);
  await setClipboardRead(t.page, 'PASTED');
  t.assert(await setDoc(t.page, doc), 'the document is in');
  return edBox(t.page);
}
/** Item labels without the disabled / checked / choice marks. */
const labels = (m) => (m?.items ?? []).map((s) => s.replace(/^-/, '').replace(/✓$/, '').replace(/\[.*\]$/, ''));
/** Waits two frames: long enough for a menu that is going to open to be in the DOM. */
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Waits for the menu's focused item to be `label`; returns menu(). */
const focusOn = async (page, label) => (await until(page, (l) => document.activeElement?.closest('.menu.ctx') && (document.activeElement.querySelector('span')?.textContent ?? document.activeElement.textContent).trim() === l, label, { timeout: 3000 }), menu(page));
/** Waits until the editor's text passes pred; returns it (or false). */
const waitText = (page, pred, which = 'input') => poll(async () => { const v = await inputText(page, which); return pred(v) && v; }, { timeout: 5000 });
const waitPills = (page, n, sel = '.pane-ed .ed-fold') => until(page, ([s, n]) => { const p = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length); return (n < 0 ? p.length > 0 : p.length === n) && p.map((e) => e.dataset.f); }, [sel, n], { timeout: 3000 }).then(() => pills(page, sel));

test('input editor: opens at the pointer with our items first; Fold, levels, Wrap lines', async (t) => {
  const { page } = t;
  const box = await start(t);
  const X = box.bx + 120;
  let m = await rightClick(page, X, lineY(box, 4));
  t.check(!!m, 'right click in the input editor opens the menu');
  t.check((await prevented(page)) === true, "the browser's own menu is cancelled");
  t.check(m && Math.abs(m.x - X) <= 2 && Math.abs(m.y - lineY(box, 4)) <= 2, 'it opens at the pointer', m && [m.x, m.y]);
  t.check(m?.open !== false, 'it is in the top layer (popover)', m?.open);
  t.check(m?.label === 'JSON input', 'named for the area', m?.label);
  t.check(m?.focus === 'menu', 'the menu has focus (arrows pick items)', m?.focus);
  // (Undo: the document was set by an input event.)
  t.check(JSON.stringify(m?.items) === JSON.stringify(INPUT_ITEMS), 'input editor items, our options first', m?.items);
  t.check(m?.foot === 'Shift+right-click: browser menu', 'the footer names the way to the browser menu', m?.foot);

  // Fold the block around line 4 ("json" inside "tags": [ … ]): folds the array opened on line 3.
  await pick(page, 'Fold');
  let p = await waitPills(page, -1);
  t.check(JSON.stringify(p) === '["2"]', 'Fold folds the innermost block around the line', p);
  t.check(!(await menu(page)), 'the menu closed');
  t.check((await until(page, () => document.activeElement?.id === 'input', null, { timeout: 3000 })) === true, 'focus is back in the editor');
  m = await rightClick(page, X, lineY(box, 3));
  t.check(m?.items[0] === 'Unfold', 'on a folded line: Unfold', m?.items[0]);
  await pick(page, 'Unfold');
  p = await waitPills(page, 0);
  t.check(p.length === 0, 'Unfold opens it again', p);

  await rightClick(page, X, lineY(box, 2));
  await pick(page, 'Collapse all');
  p = await waitPills(page, -1);
  t.check(p.length >= 1, 'Collapse all folds', p.length);
  await rightClick(page, X, lineY(box, 1));
  await pick(page, 'Expand all');
  p = await waitPills(page, 0);
  t.check(p.length === 0, 'Expand all unfolds', p.length);
  await rightClick(page, X, lineY(box, 1));
  await pickChoice(page, '2');
  p = await waitPills(page, -1);
  t.check(JSON.stringify(p) === '["8"]', 'Show levels 2 folds what is deeper than two levels', p);
  await rightClick(page, X, lineY(box, 1));
  await pick(page, 'Expand all');
  await waitPills(page, 0);

  const wrapped = () => page.evaluate(() => window.__vis('.pane-ed .ed').classList.contains('wrap'));
  await rightClick(page, X, lineY(box, 1));
  await pick(page, 'Wrap lines');
  t.check((await until(page, () => !window.__vis('.pane-ed .ed').classList.contains('wrap'), null, { timeout: 3000 })) === true, 'Wrap lines turns wrapping off');
  m = await rightClick(page, X, lineY(box, 1));
  t.check(m?.items.includes('Wrap lines'), 'unchecked now', m?.items);
  await pick(page, 'Wrap lines');
  t.check((await until(page, () => window.__vis('.pane-ed .ed').classList.contains('wrap'), null, { timeout: 3000 })) && (await wrapped()), 'and on again');
});

test('input editor: Copy, Cut, Undo, Redo, Paste, Select all, Format', async (t) => {
  const { page } = t;
  const box = await start(t);
  const X = box.bx + 120;
  await rightClick(page, X, lineY(box, 2));
  await resetClip(page);
  await pick(page, 'Copy all');
  let c = await waitClip(page);
  t.check(c === DOC, 'Copy all copies the document', c?.slice(0, 30));

  // Select "Tool Kumar" on line 2 with the keyboard, then right-click inside the selection.
  await page.mouse.click(box.bx + 400, lineY(box, 2));
  await page.keyboard.press('End');
  for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowLeft');
  for (let k = 0; k < 10; k++) await page.keyboard.press('Shift+ArrowLeft');
  const sel0 = await taSel(page);
  const inSel = box.bx + 16 + 13 * 7.8;
  let m = await rightClick(page, inSel, lineY(box, 2));
  t.check(m?.items.includes('Cut') && m?.items.includes('Copy'), 'with a selection: Cut and Copy', m?.items);
  const sel1 = await taSel(page);
  t.check(JSON.stringify(sel1.slice(0, 2)) === JSON.stringify(sel0.slice(0, 2)) && sel0[1] - sel0[0] === 10, 'a right click inside the selection keeps it', [sel1, sel0]);
  await resetClip(page);
  await pick(page, 'Copy');
  c = await waitClip(page);
  t.check(c === 'Tool Kumar', 'Copy copies the selection', c);
  await rightClick(page, inSel, lineY(box, 2));
  await resetClip(page);
  await pick(page, 'Cut');
  c = await waitClip(page);
  let text = await waitText(page, (v) => v.includes('"name": ""'));
  t.check(c === 'Tool Kumar' && !!text, 'Cut copies and removes it', [c, (await inputText(page)).split('\n')[1]]);
  m = await rightClick(page, X, lineY(box, 5));
  t.check(m?.items.includes('Undo') && m?.items.includes('-Redo'), 'Undo is on, Redo off', m?.items);
  await pick(page, 'Undo');
  text = await waitText(page, (v) => v.includes('"Tool Kumar"'));
  t.check(text === DOC, 'Undo brings it back', (await inputText(page)).split('\n')[1]);
  m = await rightClick(page, X, lineY(box, 5));
  t.check(m?.items.includes('Redo'), 'Redo is on', m?.items);
  await pick(page, 'Redo');
  text = await waitText(page, (v) => v.includes('"name": ""'));
  t.check(!!text, 'Redo cuts again', (await inputText(page)).split('\n')[1]);
  await page.keyboard.press(`${MOD}+z`);
  await waitText(page, (v) => v.includes('"Tool Kumar"'));

  // Paste at the caret, a refused read, Select all.
  await page.mouse.click(box.bx + 400, lineY(box, 2));
  await page.keyboard.press('End');
  await rightClick(page, box.bx + 400, lineY(box, 2));
  await pick(page, 'Paste');
  text = await waitText(page, (v) => v.includes('PASTED'));
  t.check(text && text.split('\n')[1] === '  "name": "Tool Kumar",PASTED', 'Paste inserts at the caret', (await inputText(page)).split('\n')[1]);
  t.check(await page.evaluate(() => document.activeElement === document.getElementById('input')), 'focus stays in the editor after Paste');
  await page.keyboard.press(`${MOD}+z`);
  text = await waitText(page, (v) => !v.includes('PASTED'));
  t.check(text === DOC, 'the paste is one undo step', (await inputText(page)).split('\n')[1]);
  await setClipboardRead(page, null);
  await rightClick(page, X, lineY(box, 2));
  await pick(page, 'Paste');
  const toast = await until(page, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /Ctrl\+V/.test(t)), null, { timeout: 3000 });
  t.check(/Press Ctrl\+V to paste/.test(toast ?? ''), 'a refused clipboard read says to press Ctrl+V', toast);
  await setClipboardRead(page, 'PASTED');
  await rightClick(page, X, lineY(box, 2));
  await pick(page, 'Select all');
  const sa = await until(page, (n) => { const t = document.getElementById('input'); return t.selectionStart === 0 && t.selectionEnd === n && document.activeElement === t; }, DOC.length, { timeout: 3000 }).then(() => taSel(page));
  t.check(sa[0] === 0 && sa[1] === DOC.length && sa[2], 'Select all selects the document', sa);
  // Paste over everything replaces the document.
  await rightClick(page, box.bx + 200, lineY(box, 3));
  await setClipboardRead(page, '[1,2,3]');
  await pick(page, 'Paste');
  text = await waitText(page, (v) => v === '[1,2,3]');
  t.check(text === '[1,2,3]', 'Paste over a full selection replaces the document', (await inputText(page)).slice(0, 30));
  await page.keyboard.press(`${MOD}+z`);
  text = await waitText(page, (v) => v !== '[1,2,3]');
  t.check(text === DOC, 'and undoes in one step', (await inputText(page)).slice(0, 30));
  await setClipboardRead(page, 'PASTED');

  // Format
  await setDoc(page, '{"a":1,"b":[1,2]}');
  await rightClick(page, X, lineY(box, 1));
  await pick(page, 'Format');
  text = await waitText(page, (v) => v.includes('\n'));
  t.check(text && text.startsWith('{\n  "a": 1'), 'Format formats the input', (await inputText(page)).slice(0, 20));
});

test('input editor: the native menu, the keyboard, closing and placement', async (t) => {
  const { page } = t;
  const box = await start(t);
  const X = box.bx + 120;
  // Shift+right-click: the browser's menu (ours stays shut, nothing cancelled).
  await page.evaluate(() => (window.__prevented = undefined));
  await page.keyboard.down('Shift');
  await page.mouse.click(X, lineY(box, 3), { button: 'right' });
  await page.keyboard.up('Shift');
  await frames(page);
  t.check(!(await menu(page)) && (await prevented(page)) !== true, "Shift+right-click leaves the browser's menu (Firefox doesn't even tell the page)");
  // (Headless Chromium's own menu would take the next click.)
  await page.keyboard.press('Escape');
  // A long press on a touch screen: the phone's own menu.
  await page.evaluate(
    ({ x, y }) => {
      const t = document.getElementById('input');
      t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }));
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    { x: X, y: lineY(box, 3) },
  );
  await frames(page);
  t.check(!(await menu(page)) && (await prevented(page)) === false, 'a touch long press keeps the native menu');
  await page.evaluate(() => document.getElementById('input').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })));

  // Keyboard: Shift+F10 at the caret, arrows, End, a letter, Esc, the menu key, Enter, Tab.
  await page.mouse.click(box.bx + 200, lineY(box, 8));
  await until(page, () => /Ln 8,/.test(window.__vis('.statusbar .cursor')?.textContent ?? ''), null, { timeout: 3000 });
  await page.keyboard.press('Shift+F10');
  await waitMenu(page);
  let m = await focusOn(page, 'Fold');
  t.check(!!m && m.focus === 'Fold', 'Shift+F10 opens it with the first item focused', m?.focus);
  t.check(m && m.y >= lineY(box, 8) - 2 && m.y <= lineY(box, 8) + 30, 'under the caret row', m && [m.y, lineY(box, 8)]);
  t.check(m && m.foot === null, 'no mouse footer from the keyboard', m?.foot);
  await page.keyboard.press('ArrowDown');
  m = await focusOn(page, 'Collapse all');
  t.check(m?.focus === 'Collapse all', 'ArrowDown moves', m?.focus);
  await page.keyboard.press('End');
  m = await focusOn(page, 'All commands');
  t.check(m?.focus === 'All commands', 'End goes to the last item', m?.focus);
  await page.keyboard.press('ArrowDown');
  m = await focusOn(page, 'Fold');
  t.check(m?.focus === 'Fold', 'and wraps around', m?.focus);
  await page.keyboard.press('s');
  m = await focusOn(page, 'Select all');
  t.check(m?.focus === 'Select all', 'a letter jumps to the next item starting with it', m?.focus);
  await page.keyboard.press('Escape');
  m = await waitMenu(page, false);
  t.check(!m && (await until(page, () => document.activeElement?.id === 'input', null, { timeout: 3000 })) === true, 'Esc closes it and the editor has focus again');
  await page.keyboard.press('ContextMenu');
  m = await waitMenu(page);
  t.check(!!m, 'the menu key opens it', !!m);
  await focusOn(page, 'Fold');
  await page.keyboard.press('ArrowDown');
  await focusOn(page, 'Collapse all');
  await page.keyboard.press('Enter');
  m = await waitMenu(page, false);
  let p = await waitPills(page, -1);
  t.check(!m && p.length >= 1, 'Enter runs the item (Collapse all)', p.length);
  await page.evaluate(() => (window.__vis('.pane-ed .ed').scrollTop = 0));
  await page.keyboard.press('Shift+F10');
  await waitMenu(page);
  await page.keyboard.press('Tab');
  t.check(!(await waitMenu(page, false)), 'Tab closes it');
  await rightClick(page, X, lineY(box, 1));
  await pick(page, 'Expand all');
  await waitPills(page, 0);

  // Closing: a press elsewhere, the wheel.
  await rightClick(page, X, lineY(box, 3));
  await page.mouse.click(box.x + box.w + 200, box.y + 300);
  t.check(!(await waitMenu(page, false)), 'a press elsewhere closes it');
  await rightClick(page, X, lineY(box, 3));
  await page.mouse.move(X, lineY(box, 3));
  await page.mouse.wheel(0, 100);
  t.check(!(await waitMenu(page, false)), 'the wheel closes it');
  // (The wheel may scroll the page, which has the guide below the tool: wait for it to stop, go back up.)
  await until(page, () => new Promise((r) => { const y = scrollY; requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY === y)))); }), null, { timeout: 3000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await until(page, ([x, y]) => { const r = window.__vis('.pane-ed .ed').getBoundingClientRect(); return scrollY === 0 && r.left === x && r.top === y; }, [box.x, box.y], { timeout: 3000 });
  // Right click again elsewhere: it moves there.
  await rightClick(page, X, lineY(box, 3));
  await page.mouse.click(X + 300, lineY(box, 6), { button: 'right' });
  m = await until(page, ([x, y]) => { const r = document.querySelector('.menu.ctx')?.getBoundingClientRect(); return r && Math.abs(r.top - y) < 3 && Math.abs(r.left - x) < 3; }, [X + 300, lineY(box, 6)], { timeout: 3000 }).then(() => menu(page));
  t.check(m && Math.abs(m.y - lineY(box, 6)) < 3 && Math.abs(m.x - X - 300) < 3, 'a second right click (outside the menu) opens it at the new point', m && [m.x, m.y]);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  // Near the window's edges it opens inward.
  const fr = await page.evaluate(() => { const r = window.__vis('#view-format').getBoundingClientRect(); return { x: r.right, y: r.top }; });
  m = await rightClick(page, fr.x - 12, fr.y + 40);
  t.check(m && m.x + m.w <= fr.x - 12 + 1 && m.x + m.w <= 1280 - 7, 'at the window’s right edge it opens to the left', m && [m.x, m.w, fr.x]);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  const lowY = box.y + box.h - 20;
  m = await rightClick(page, X, lowY);
  t.check(m && m.y + m.h <= 860 - 7 && m.y + m.h <= lowY + 2, 'near the bottom it opens upward', m && [m.y, m.h, lowY]);
  await page.keyboard.press('Escape');
});

test('Format and Convert views', async (t) => {
  const { page } = t;
  await start(t);
  const fmt = await page.evaluate(() => { const r = window.__vis('#view-format .cv-rows').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  let m = await rightClick(page, fmt.x + 140, fmt.y + 20 * 3 + 10);
  t.check(JSON.stringify(m?.items) === JSON.stringify(['Fold', 'Collapse all', 'Expand all', 'Show levels', 'Wrap lines✓', 'Use as input', 'Download', 'Copy all', 'All commands']), 'Format view items', m?.items);
  t.check(m?.label === 'Formatted output', 'named for the output', m?.label);
  await pick(page, 'Fold');
  const cv = await waitPills(page, -1, '#view-format .cv-ph');
  t.check(JSON.stringify(cv) === '["2"]', 'Fold in the output folds the block around the line', cv);
  t.check((await until(page, () => document.activeElement?.id === 'view-format', null, { timeout: 3000 })) === true, 'focus back on the output');
  m = await rightClick(page, fmt.x + 140, fmt.y + 20 * 2 + 10);
  t.check(m?.items[0] === 'Unfold', 'Unfold on the folded line', m?.items[0]);
  await pick(page, 'Unfold');
  await waitPills(page, 0, '#view-format .cv-ph');
  await rightClick(page, fmt.x + 140, fmt.y + 10);
  await resetClip(page);
  await pick(page, 'Copy all');
  let c = await waitClip(page);
  t.check(c === DOC, 'Copy all copies the output', c?.slice(0, 20));
  // A selection in the output: Copy.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#view-format .cv-rows > *')].find((r) => r.textContent.includes('Tool Kumar'));
    const tn = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tn.nextNode()) && !n.data.includes('Tool')) {}
    const r = document.createRange();
    r.setStart(n, n.data.indexOf('Tool'));
    r.setEnd(n, n.data.indexOf('Tool') + 4);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const selR = await page.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  m = await rightClick(page, selR.x, selR.y);
  t.check(m?.items.includes('Copy'), 'with text selected: Copy', m?.items);
  await resetClip(page);
  await pick(page, 'Copy');
  c = await waitClip(page);
  t.check(c === 'Tool', 'Copy copies the selected text', c);

  // Convert
  await page.keyboard.press('Alt+5');
  await until(page, () => /interface|type/.test(window.__vis('#view-convert .cv-rows')?.textContent ?? ''), null, { timeout: 15_000 });
  const cr = await page.evaluate(() => { const r = window.__vis('#view-convert .cv-rows').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  m = await rightClick(page, cr.x + 140, cr.y + 10);
  t.check(m && m.items.includes('Download') && m.items.includes('Copy all') && !m.items.includes('Use as input'), 'convert items', m?.items);
  await resetClip(page);
  await pick(page, 'Copy all');
  c = await waitClip(page);
  t.check(/interface|type/.test(c ?? ''), 'Copy all copies the converted code', c?.slice(0, 30));
});

test('Tree and Table views', async (t) => {
  const { page } = t;
  await start(t);
  await page.keyboard.press('Alt+2');
  const rowAt = (i) => until(page, (i) => { const r = window.__vis(`#view-tree .tv-r[data-i="${i}"]`)?.getBoundingClientRect(); return r && { x: r.left + 60, y: r.top + r.height / 2 }; }, i, { timeout: 10_000 });
  let r = await rowAt(2);
  let m = await rightClick(page, r.x, r.y);
  const tsel = await page.evaluate(() => window.__vis('#view-tree .tv-r.sel')?.dataset.i);
  t.check(tsel === '2', 'right click selects the row under the pointer', tsel);
  t.check(JSON.stringify(m?.items) === JSON.stringify(['Copy value', 'Copy path', 'Collapse', 'Show in editor', 'Collapse all', 'Expand all', 'Show levels', 'Download', 'All commands']), 'tree items for an open array', m?.items);
  await resetClip(page);
  await pick(page, 'Copy path');
  let c = await waitClip(page);
  t.check(c === '$.tags', 'Copy path', c);
  await rightClick(page, r.x, r.y);
  await pick(page, 'Collapse');
  const exp = await until(page, () => window.__vis('#view-tree .tv-r[data-i="2"]')?.getAttribute('aria-expanded') === 'false' && 'false', null, { timeout: 3000 });
  t.check(exp === 'false', 'Collapse closes that node', exp);
  m = await rightClick(page, r.x, r.y);
  t.check(m?.items.includes('Expand'), 'then Expand', m?.items);
  await pick(page, 'Expand');
  r = await rowAt(1);
  await rightClick(page, r.x, r.y);
  await resetClip(page);
  await pick(page, 'Copy value');
  c = await waitClip(page);
  t.check(c === 'Tool Kumar', 'Copy value', c);
  await rightClick(page, r.x, r.y);
  await pick(page, 'Show in editor');
  const edSel = await until(page, () => { const t = document.getElementById('input'); return t.selectionEnd > t.selectionStart && [t.selectionStart, t.selectionEnd]; }, null, { timeout: 3000 });
  t.check(edSel && DOC.slice(edSel[0], edSel[1]) === '"Tool Kumar"', 'Show in editor selects it in the input', edSel && DOC.slice(edSel[0], edSel[1]));
  // Keyboard in the tree: at the selected row.
  await page.keyboard.press('Alt+2');
  await page.evaluate(() => window.__vis('#view-tree').focus());
  await page.keyboard.press('Shift+F10');
  await waitMenu(page);
  m = await focusOn(page, 'Copy value');
  t.check(m?.focus === 'Copy value', 'Shift+F10 in the tree: the selected node’s menu', m?.focus);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  t.check((await until(page, () => document.activeElement?.id === 'view-tree', null, { timeout: 3000 })) === true, 'Esc: focus back on the tree');

  // Table
  await page.evaluate(() => document.getElementById('input').focus());
  await setDoc(page, '[{"id":1,"name":"a"},{"id":2,"name":"b"}]');
  await page.keyboard.press('Alt+3');
  const cell = await until(page, () => { const c = [...document.querySelectorAll('#view-table .tb-r [data-c]')].find((e) => e.textContent.trim() === 'b' && e.getClientRects().length); const r = c?.getBoundingClientRect(); return r && { x: r.left + 5, y: r.top + r.height / 2 }; }, null, { timeout: 10_000 });
  m = await rightClick(page, cell.x, cell.y);
  t.check(JSON.stringify(m?.items) === JSON.stringify(['Copy value', 'Copy path', 'Copy as CSV', 'Download CSV', 'Download Excel (.xlsx)', 'All commands']), 'table items', m?.items);
  await resetClip(page);
  await pick(page, 'Copy path');
  c = await waitClip(page);
  t.check(c === '$[1].name', 'Copy path of the cell', c);
});

test('Graph view and the Compare editor', { allowErrors: true }, async (t) => {
  const { page } = t;
  // Moves are instant with reduced motion, so a card stays where the probe looks for it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(t);
  await page.keyboard.press('Alt+4');
  await until(page, () => !!window.__vis('#view-graph .gv-ctl:not([hidden])'), null, { timeout: 15_000 });
  const g = await page.evaluate(() => { const r = window.__vis('#view-graph').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let m = await rightClick(page, g.x + g.w / 2, g.y + g.h / 2);
  t.check(m && m.items.includes('Fit to screen') && m.items.includes('Export image…'), 'graph items', m?.items);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  // The root card is near the start: show it, then right-click across the view until a card answers.
  await page.evaluate(() => window.__vis('#view-graph').focus());
  await page.keyboard.press('Home');
  await frames(page);
  let hit = null;
  for (const fy of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    for (const fx of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5]) {
      const mm = await rightClick(page, g.x + g.w * fx, g.y + g.h * fy);
      if (mm?.items[0] === 'Copy value') {
        hit = mm;
        break;
      }
      await page.keyboard.press('Escape');
      await waitMenu(page, false);
    }
    if (hit) break;
  }
  t.check(!!hit, 'right click on a card selects it and offers its value and path', hit?.items);
  if (hit) await page.keyboard.press('Escape');
  await waitMenu(page, false);
  await page.keyboard.press('Shift+F10');
  await waitMenu(page);
  m = await focusOn(page, 'Copy value');
  t.check(m?.focus === 'Copy value', 'Shift+F10 in the graph: the selected card’s menu', m?.items);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);

  // Compare: the modified document's editor.
  await page.keyboard.press('Alt+6');
  await until(page, () => !!window.__vis('.pane-cmp .ed-body'), null, { timeout: 15_000 });
  await page.evaluate(() => document.getElementById('input2').focus());
  await setDoc(page, '{"x":1}', 'input2');
  const e2 = await page.evaluate(() => { const b = window.__vis('.pane-cmp .ed-body').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  m = await rightClick(page, e2.x + 60, e2.y + 20);
  t.check(m && m.label === 'Modified JSON' && m.items.includes('Swap with original') && m.items.includes('Format'), 'the modified editor’s items', m?.items);
  await page.keyboard.press('Escape');
  // (WebKit's "ResizeObserver loop" warning on opening Compare is on main too: PR #15's notes.)
  const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e));
  t.check(!errs.length, 'no page errors', errs.slice(0, 3));
});

// ── check3.mjs: German, a narrow dark window, a tool page, /integrate ──────────────────────────

test('German page: translated items and footer', async (t) => {
  const { page } = t;
  await t.open('/de');
  t.assert(await setDoc(page, '{\n  "a": [\n    1\n  ]\n}'), 'the document is in');
  let m = await rightClickOn(page, '.pane-ed .ed-body', { dx: 100, dy: 50 });
  let names = labels(m);
  t.check(names.includes('Ausschneiden') && names.includes('Alles kopieren') && names.includes('Alles auswählen') && names.includes('Zuklappen'), 'German labels', m?.items);
  t.check(m?.foot === 'Umschalt+Rechtsklick: Browsermenü', 'German footer', m?.foot);
  await page.keyboard.press('Escape');
  await waitMenu(page, false);
  await page.keyboard.press('Alt+2');
  await until(page, () => !!window.__vis('#view-tree .tv-r[data-i="1"]'), null, { timeout: 10_000 });
  m = await rightClickOn(page, '#view-tree .tv-r[data-i="1"]', { dx: 60, dy: 10 });
  // (The old check's "Wert kopieren" test was always true; it is a real check here.)
  names = labels(m);
  t.check(names.includes('Wert kopieren') && names.includes('Zuklappen'), 'German tree labels', m?.items);
});

test('a narrow dark window: the menu stays inside it', { width: 390, height: 760, dark: true }, async (t) => {
  const { page } = t;
  await t.open('/');
  t.assert(await setDoc(page, '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x"\n}'), 'the document is in');
  const m = await rightClickOn(page, '.pane-ed .ed-body', { dx: 200, dy: 30 });
  t.check(m && m.x >= 7 && m.right <= 390 - 7 && m.y >= 7 && m.bottom <= 760 - 7, 'a narrow window: the menu stays inside it', m && [m.x, m.y, m.right, m.bottom]);
});

test('a tool page and /integrate', async (t) => {
  const { page } = t;
  await t.open('/tools/json-to-typescript');
  await until(page, () => (window.__vis('#view-convert .cv-rows')?.textContent ?? '').length > 10, null, { timeout: 15_000 });
  let m = await rightClickOn(page, '#view-convert .cv-rows', { dx: 120, dy: 30 });
  t.check(m && m.items.includes('Download') && m.items.includes('Copy all'), 'a tool page: the Convert menu', m?.items);
  await page.keyboard.press('Escape');

  // /integrate: its boxes keep the browser's menu.
  await t.open('/integrate', { tool: false });
  await page.locator('.link-builder').scrollIntoViewIfNeeded();
  await until(page, () => document.querySelectorAll('.link-builder .ed.hl-on').length >= 1, null, { timeout: 15_000 });
  await watchContextMenu(page);
  m = await rightClickOn(page, '.link-builder .ed', { dx: 120, dy: 30, wait: false });
  await frames(page);
  t.check(!(await menu(page)) && (await prevented(page)) === false, "/integrate's editor keeps the browser's menu", await prevented(page));
  await page.keyboard.press('Escape');
});
