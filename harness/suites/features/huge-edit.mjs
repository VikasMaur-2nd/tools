// Huge mode's editing (lib/huge/edits.ts, components/huge/HugeEdit.tsx): edits from the tree with the edit box
// and the keys, what's typed checked first, undo and redo, edit as text in the normal editor, a document made
// invalid and fixed, saving in place (a file handle from huge mode's Open file: OPFS standing in for the picker's)
// with the saved file's SHA-256 checked, and a kept session restored after a reload.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { MOD, storagePage, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['huge', 'huge-edit'] });

const dir = join(DIRS.tmp, 'huge-edit');
mkdirSync(dir, { recursive: true });
const records = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `user ${i}`, tags: ['a', 'b'] }));
const doc = { meta: { version: 1 }, users: records(300) };
const text = JSON.stringify(doc, null, 2);
const path = join(dir, 'users.json');
writeFileSync(path, text);

async function openHuge(t, p) {
  const { page } = t;
  await page.evaluate(() => {
    localStorage.setItem('tk:hugeMin', '0');
    localStorage.removeItem('tk:hugeSim');
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    if (input) input.value = '';
  });
  await page.locator('.app:visible input[type=file]').setInputFiles(p);
  t.assert(await until(page, () => !!window.__vis('.hg') && document.documentElement.hasAttribute('data-huge'), null, { timeout: 15_000 }), 'huge mode opens');
  t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'read');
}

/** Selects the value at `p` ($.path) in the tree (Find's $.path), then gives the tree the keys. */
async function selectPath(page, p) {
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill(p);
  // (The tree's path button shows the selection's path.)
  await until(page, (p) => window.__vis('.hg .vmain .path')?.textContent === p, p, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.locator('#hg-tree').focus();
}

const selRow = (page) => page.evaluate(() => document.querySelector('#hg-tree #htv-sel')?.textContent ?? '');
const edited = (page) => page.evaluate(() => window.__vis('.hg-edited')?.textContent ?? '');

test('huge edit: set a value from the tree, what is typed checked first, undo and redo, delete, insert', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  // F2 on a string: the box opens on its text.
  await selectPath(page, '$.users[1].name');
  t.assert(/^name:/.test(await selRow(page)), 'selected', await selRow(page));
  await page.keyboard.press('F2');
  t.assert(await until(page, () => !!document.querySelector('.hg-box textarea, .hg-box input.hg-box-in'), null), 'F2 opens the edit box');
  const start = await page.evaluate(() => document.querySelector('.hg-box .hg-box-in.mono')?.value);
  t.check(start === 'user 1', 'with the value', start);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('Ada');
  await page.keyboard.press('Enter');
  t.check(await until(page, () => /^name:\s*"Ada"/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'Enter saves: the tree shows it, still selected', await selRow(page));
  t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), 'the file bar says edited', await edited(page));
  // A number typed wrong: why, and nothing sent.
  await selectPath(page, '$.users[1].id');
  await page.keyboard.press('F2');
  await until(page, () => !!document.querySelector('.hg-box input.hg-box-in'), null);
  t.check((await page.evaluate(() => document.querySelector('.hg-box select.hg-box-kind')?.value)) === 'number', 'typed as a number');
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('12a');
  await page.keyboard.press('Enter');
  t.check(await until(page, () => /Not a number/.test(document.querySelector('.hg-box-err')?.textContent ?? ''), null), 'says why, the box stays', await page.evaluate(() => document.querySelector('.hg-box-err')?.textContent));
  await page.keyboard.press('Escape');
  t.check(await until(page, () => !document.querySelector('.hg-box'), null), 'Esc closes it');
  t.check(/Edited · 1 change/.test(await edited(page)), 'nothing more edited', await edited(page));
  // Undo, redo (from the tree).
  await page.locator('#hg-tree').focus();
  await page.keyboard.press(`${MOD}+z`);
  t.check(await until(page, () => !window.__vis('.hg-edited'), null), 'Ctrl+Z: not edited any more', await edited(page));
  await selectPath(page, '$.users[1].name');
  t.check(/"user 1"/.test(await selRow(page)), 'the old value is back', await selRow(page));
  await page.keyboard.press(`${MOD}+Shift+z`);
  t.check(await until(page, () => /"Ada"/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'Ctrl+Shift+Z: again', await selRow(page));
  // Delete a record: the next one is selected; the count goes down.
  await selectPath(page, '$.users[0]');
  await page.keyboard.press('Delete');
  t.check(await until(page, () => /\[299\]/.test(document.querySelector('#hg-tree')?.textContent ?? ''), null), 'Delete: 299 users', await page.evaluate(() => document.querySelector('#hg-tree .tv-b')?.textContent));
  t.check(await until(page, () => /^0:/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the next one selected (now the first)', await selRow(page));
  // Insert after it: a number.
  await page.keyboard.press(`${MOD}+Enter`);
  t.assert(await until(page, () => !!document.querySelector('.hg-box'), null), 'Ctrl+Enter: insert');
  await page.locator('.hg-box select.hg-box-kind').selectOption('number');
  await page.locator('.hg-box .hg-box-in.mono').fill('42');
  await page.keyboard.press('Enter');
  t.check(await until(page, () => /^1:\s*42/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'inserted and selected', await selRow(page));
  t.check(await until(page, () => /Edited · 3 changes/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), '3 changes', await edited(page));
  // Closing with unsaved edits asks: Cancel stays; Close without saving goes back to the editor.
  await page.locator('.hg-file .btn.icon[aria-label="Close file"]').click();
  t.check(await until(page, () => /3 unsaved changes/.test(document.querySelector('.hg-confirm')?.textContent ?? ''), null), 'closing asks first', await page.evaluate(() => document.querySelector('.hg-confirm')?.textContent));
  await page.locator('.hg-confirm .btn', { hasText: 'Cancel' }).click();
  t.check(await until(page, () => !document.querySelector('.hg-confirm') && !!window.__vis('.hg'), null), 'Cancel: still open');
  await page.locator('.hg-file .btn.icon[aria-label="Close file"]').click();
  await page.locator('.hg-confirm .btn', { hasText: 'Close without saving' }).click();
  t.check(await until(page, () => !document.documentElement.hasAttribute('data-huge'), null), 'Close without saving: back to the editor');
});

test('huge edit: a value as text in the normal editor; the document made invalid says where, fixed again', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await selectPath(page, '$.meta');
  await page.keyboard.press(`${MOD}+e`);
  t.assert(await until(page, () => !!document.querySelector('.hg-te .ed textarea') && /Valid JSON/.test(document.querySelector('.hg-te-check')?.textContent ?? ''), null, { timeout: 10_000 }), 'Ctrl+E: the editor with the value');
  const shown = await page.evaluate(() => document.querySelector('.hg-te .ed-hl, .hg-te .ed')?.textContent ?? '');
  t.check(/"version"/.test(shown), 'its text', shown.slice(0, 80));
  // Broken: says where; Apply asks first.
  await page.locator('.hg-te .ed textarea').focus();
  await page.keyboard.press(`${MOD}+a`);
  // (Not JSON at all: the core puts it in as it is. A text it can read leniently, `{"a": 1,}`, it writes as JSON.)
  await page.keyboard.type('nul');
  t.check(await until(page, () => /Ln 1, Col/.test(document.querySelector('.hg-te-check')?.textContent ?? ''), null), 'the error, where', await page.evaluate(() => document.querySelector('.hg-te-check')?.textContent));
  await page.locator('.hg-te-f .btn.primary').click();
  t.check(await until(page, () => /Apply anyway/.test(document.querySelector('.hg-te-f .btn.primary')?.textContent ?? ''), null), 'Apply asks first');
  await page.locator('.hg-te-f .btn.primary').click();
  t.check(await until(page, () => !document.querySelector('.hg-te'), null), 'applied');
  t.check(await until(page, () => /(Invalid JSON|Not strict JSON)Ln \d+, Col \d+/.test(window.__vis('.hg .banner')?.textContent ?? ''), null, { timeout: 10_000 }), 'the file says it is wrong, and where', await page.evaluate(() => [window.__vis('.hg .banner')?.textContent, window.__vis('.hg-sb')?.textContent]));
  // Fixed (undo): valid again.
  await page.locator('#hg-tree').focus();
  await page.keyboard.press(`${MOD}+z`);
  t.check(await until(page, () => !window.__vis('.hg .banner') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 10_000 }), 'undone: valid again', await page.evaluate(() => window.__vis('.hg-sb')?.textContent));
  // A valid text: applied as one step, formatted where it goes.
  await selectPath(page, '$.meta');
  await page.keyboard.press(`${MOD}+e`);
  await until(page, () => /Valid JSON/.test(document.querySelector('.hg-te-check')?.textContent ?? ''), null, { timeout: 10_000 });
  await page.locator('.hg-te .ed textarea').focus();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('{"version": 2, "notes": "hi"}');
  await until(page, () => /Valid JSON/.test(document.querySelector('.hg-te-check')?.textContent ?? ''), null);
  await page.keyboard.press(`${MOD}+Enter`);
  t.check(await until(page, () => !document.querySelector('.hg-te'), null), 'Ctrl+Enter applies');
  t.check(await until(page, () => /\{2\}/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the tree shows it', await selRow(page));
  t.check(/Edited · 1 change/.test(await edited(page)), 'one change', await edited(page));
});

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('huge edit: saved in place through the opened file\'s handle, the file\'s SHA-256 the edited document\'s', async (t) => {
  const page = await storagePage(t);
  try {
    await t.open('/');
    // The file in the origin's storage, and huge mode's Open file given its handle (as showOpenFilePicker gives one).
    await page.evaluate(async (text) => {
      localStorage.setItem('tk:hugeMin', '0');
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle('picked.json', { create: true });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      window.showOpenFilePicker = async () => [h];
    }, text);
    await openHuge(t, path);
    await page.locator('.hg-file .btn', { hasText: 'Open file' }).click();
    t.assert(await until(page, () => /picked\.json/.test(window.__vis('.hg-file .fname')?.textContent ?? '') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'opened through its handle');
    await selectPath(page, '$.users[2].name');
    await page.keyboard.press('F2');
    await until(page, () => !!document.querySelector('.hg-box .hg-box-in.mono'), null);
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('Grace');
    await page.keyboard.press('Enter');
    await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
    t.check(/Save to the file/.test(await page.evaluate(() => window.__vis('.hg-editbar .btn.primary')?.dataset.tip ?? '')), 'Save says it writes into the file');
    await page.keyboard.press(`${MOD}+s`);
    t.check(await until(page, () => !window.__vis('.hg-edited') && !window.__vis('.hg-saving'), null, { timeout: 20_000 }), 'saved: nothing unsaved');
    const got = await page.evaluate(async () => {
      const f = await (await (await navigator.storage.getDirectory()).getFileHandle('picked.json')).getFile();
      const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    });
    const want = structuredClone(doc);
    want.users[2].name = 'Grace';
    t.check(got === sha(JSON.stringify(want, null, 2)), 'the file holds the edited document (SHA-256)', got);
    // Still browsable and editable on the saved file.
    await selectPath(page, '$.users[2].name');
    t.check(/"Grace"/.test(await selRow(page)), 'reads the saved file', await selRow(page));
  } finally {
    await t.cleanup?.();
  }
});

test('huge edit: unsaved edits kept, offered again when the file is opened again', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await selectPath(page, '$.users[5].name');
  await page.keyboard.press('Delete');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  // (Kept a second after the last edit.)
  await page.waitForTimeout(1500);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await openHuge(t, path);
  t.assert(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'offered', await page.evaluate(() => window.__vis('.hg')?.textContent?.slice(0, 200)));
  await page.locator('.hg-restore .btn.primary').click();
  t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null, { timeout: 10_000 }), 'restored: edited, one change', await edited(page));
  await selectPath(page, '$.users[5]');
  t.check(await until(page, () => /\{2\}/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the edit is there ($.users[5] has no name)', await selRow(page));
  await page.locator('#hg-tree').focus();
  await page.keyboard.press(`${MOD}+z`);
  t.check(await until(page, () => !window.__vis('.hg-edited'), null), 'and undo goes on from it');
});

const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent ?? ''));
const toasted = (page, re) => until(page, (s) => [...document.querySelectorAll('.toast')].some((e) => new RegExp(s).test(e.textContent ?? '')), re.source, { timeout: 10_000 });

test('huge edit: another file opened right after an edit: the edit is kept (said once it is), offered again', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await selectPath(page, '$.users[5].name');
  await page.keyboard.press('Delete');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  // At once (not a second later, when the core keeps a session anyway): closing keeps it first.
  const other = join(dir, 'other.json');
  writeFileSync(other, JSON.stringify({ other: true }));
  await openHuge(t, other);
  t.check(await toasted(page, /Your 1 unsaved change to users\.json is kept: reopen it to restore it/), 'said kept', await toasts(page));
  await openHuge(t, path);
  t.check(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'offered again');
});

// Screenshots for review (HUGE_SHOTS names a folder): the edit box, the edit menu, the text dialog, the file bar
// with edits, asking before closing; light and dark, desktop and phone.
for (const [name, opts] of [
  ['desktop-light', {}],
  ['desktop-dark', { dark: true }],
  ['mobile-light', { mobile: true, width: 390, height: 844 }],
  ['mobile-dark', { mobile: true, dark: true, width: 390, height: 844 }],
]) {
  test(`huge edit: screenshots ${name}`, { ...opts, engines: ['chromium'], tags: ['shots'] }, async (t) => {
    const out = process.env.HUGE_SHOTS;
    if (!out) return t.log('HUGE_SHOTS not set: no screenshots');
    mkdirSync(out, { recursive: true });
    const { page } = t;
    const shot = async (file) => {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 250))));
      await page.screenshot({ path: join(out, `r5-${name}-${file}.png`) });
    };
    await t.open('/');
    await openHuge(t, path);
    // (A phone has the views in a drop-down.)
    await page.evaluate(() => {
      const tab = window.__vis('.hg [role=tab][aria-controls=hg-tree]');
      if (tab) return tab.click();
      const pick = window.__vis('.hg .tabs-pick select');
      pick.value = 'tree';
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await selectPath(page, '$.users[1].name');
    await page.keyboard.press('F2');
    await until(page, () => !!document.querySelector('.hg-box'), null);
    await shot('box');
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('12a');
    await page.locator('.hg-box select.hg-box-kind').selectOption('number');
    await page.keyboard.press('Enter');
    await until(page, () => !!document.querySelector('.hg-box-err'), null);
    await shot('box-error');
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('.hg-box'), null);
    await page.locator('#hg-tree').focus();
    await page.keyboard.press('Delete');
    t.check(await until(page, () => !!window.__vis('.hg-editbar .btn.primary:not(:disabled)'), null), 'edited');
    await shot('edited');
    await page.locator('#hg-tree').focus();
    await page.keyboard.press('Shift+F10');
    await until(page, () => !!document.querySelector('.hg-menu'), null);
    await shot('menu');
    await page.keyboard.press('Escape');
    await selectPath(page, '$.users[3]');
    await page.keyboard.press(`${MOD}+e`);
    await until(page, () => /Valid JSON/.test(document.querySelector('.hg-te-check')?.textContent ?? ''), null, { timeout: 10_000 });
    await shot('text');
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('.hg-te'), null);
    // The Format view's text edited (round 6).
    await editFormatAt(page, '"user 4"');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' edited');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    await shot('format-edit');
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('.hg-fe'), null);
    await page.locator('.hg-file .btn.icon[aria-label="Close file"]').click();
    t.check(await until(page, () => !!document.querySelector('.hg-confirm'), null), 'closing asks first');
    await shot('confirm');
  });
}

/** The Format view's text being edited: its lines' numbers in the gutter, and the editor's text. */
const feGutter = (page) => page.evaluate(() => [...document.querySelectorAll('.hg-fe .ed-gl > div')].map((d) => Number(d.textContent)));
const feText = (page) => page.evaluate(() => document.querySelector('.hg-fe .ed textarea')?.value ?? '');

/** The Format view (As written), at the line of `needle`, then editing its text there (F2): the caret at that line's start. */
async function editFormatAt(page, needle) {
  // (A phone has the views in a drop-down.)
  await page.evaluate(() => {
    const tab = window.__vis('.hg [role=tab][aria-controls=hg-format]');
    if (tab) return tab.click();
    const pick = window.__vis('.hg .tabs-pick select');
    pick.value = 'format';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill(needle);
  await until(page, () => !!document.querySelector('#hg-format .hg-cur'), null);
  await page.keyboard.press('Escape');
  await page.locator('#hg-format').focus();
  await page.keyboard.press('F2');
  // (Its keys once the editor has them.)
  await until(page, () => !!document.activeElement?.closest('.hg-fe') && /Editing lines/.test(window.__vis('.hg .vmain')?.textContent ?? ''), null, { timeout: 10_000 });
}

test('huge edit: the Format view\'s text edited in place: numbered as the file, typing one change, undo, the error marked', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  const lineOf = (s) => text.split('\n').findIndex((l) => l.includes(s)) + 1;
  await editFormatAt(page, '"user 120"');
  const nums = await feGutter(page);
  const want = lineOf('"user 120"');
  t.check(nums.length > 0 && nums.includes(want) && Math.min(...nums) > 1, 'the gutter numbers the file\'s lines', `${want} in ${nums.slice(0, 3)}…`);
  t.check(new RegExp(`Ln ${want.toLocaleString('en-US')}, Col 1`).test(await page.evaluate(() => window.__vis('.hg .vmain')?.textContent ?? '')), 'the caret at that line', await page.evaluate(() => window.__vis('.hg .vmain')?.textContent));
  // Typing at the end of the name: one change (joined), the document has it.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('XYZ');
  t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null, { timeout: 10_000 }), 'one change', await edited(page));
  t.check(/"user 120XYZ",/.test(await feText(page)), 'the editor shows it');
  // Undo (Ctrl+Z in the editor: the document's undo), redo.
  await page.keyboard.press(`${MOD}+z`);
  t.check(await until(page, () => /"user 120",/.test(document.querySelector('.hg-fe .ed textarea')?.value ?? '') && !window.__vis('.hg-edited'), null, { timeout: 10_000 }), 'undone at once (the typing was one step)', (await feText(page)).match(/"user 120[^"]*"/)?.[0]);
  await page.keyboard.press(`${MOD}+Shift+z`);
  t.check(await until(page, () => /"user 120XYZ",/.test(document.querySelector('.hg-fe .ed textarea')?.value ?? ''), null, { timeout: 10_000 }), 'redone');
  // Broken: a comma removed at the line's end. The file says where; the editor marks it.
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  t.check(await until(page, () => /(Invalid JSON|Not strict JSON)Ln \d+, Col \d+/.test(window.__vis('.hg .banner')?.textContent ?? ''), null, { timeout: 10_000 }), 'the error, where', await page.evaluate(() => window.__vis('.hg .banner')?.textContent));
  t.check(await until(page, () => !!document.querySelector('.hg-fe .ed .me'), null), 'marked in the editor');
  await page.keyboard.type(',');
  t.check(await until(page, () => !window.__vis('.hg .banner') && !document.querySelector('.hg-fe .ed .me'), null, { timeout: 10_000 }), 'fixed: valid again');
  // A paste too big for the window: said why, nothing pasted.
  // (A paste event with its data, on what has the keys, as harness/lib/app.mjs `paste` does: headless browsers
  // don't hand a written clipboard to Ctrl+V.)
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'x'.repeat(9 << 20));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
    (document.activeElement ?? document.querySelector('.hg-fe .ed textarea')).dispatchEvent(ev);
  });
  t.check(await until(page, () => [...document.querySelectorAll('.toast')].some((e) => /Paste up to 8\.0\sMB at a time here \(this is 9\.0\sMB\)/.test(e.textContent ?? '')), null), 'a paste over 8 MB: said why', await page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent)));
  // Done (Esc): the views read the document again; the tree has the edit.
  await page.keyboard.press('Escape');
  t.check(await until(page, () => !document.querySelector('.hg-fe') && !!window.__vis('#hg-format'), null), 'Esc: back to the view');
  await selectPath(page, '$.users[120].name');
  t.check(/"user 120XYZ"/.test(await selRow(page)), 'the tree reads the edit', await selRow(page));
});

test('huge edit: typed in the Format view, saved in place: the file\'s SHA-256 is the edited text\'s', async (t) => {
  const page = await storagePage(t);
  try {
    await t.open('/');
    await page.evaluate(async (text) => {
      localStorage.setItem('tk:hugeMin', '0');
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle('typed.json', { create: true });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      window.showOpenFilePicker = async () => [h];
    }, text);
    await openHuge(t, path);
    await page.locator('.hg-file .btn', { hasText: 'Open file' }).click();
    t.assert(await until(page, () => /typed\.json/.test(window.__vis('.hg-file .fname')?.textContent ?? '') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'opened through its handle');
    await editFormatAt(page, '"user 7"');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' é😀');
    // (Saved at once, as a user might: what was typed since the last paint goes first.)
    await page.keyboard.press(`${MOD}+s`);
    t.check(await until(page, () => [...document.querySelectorAll('.toast')].some((e) => /Saved typed\.json/.test(e.textContent ?? '')), null, { timeout: 10_000 }), 'saved, said so', await page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent)));
    t.check(await until(page, () => !window.__vis('.hg-edited') && !window.__vis('.hg-saving'), null, { timeout: 20_000 }), 'saved');
    const [got, near] = await page.evaluate(async () => {
      const f = await (await (await navigator.storage.getDirectory()).getFileHandle('typed.json')).getFile();
      const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      const s = await f.text();
      const i = s.indexOf('"user 7');
      return [[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''), s.slice(i - 40, i + 40)];
    });
    t.check(got === sha(text.replace('"user 7"', '"user 7 é😀"')), 'the file holds the edited text (SHA-256)', near);
  } finally {
    await t.cleanup?.();
  }
});
