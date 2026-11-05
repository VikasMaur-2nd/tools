// Huge mode's editing (lib/huge/edits.ts, components/huge/HugeEdit.tsx): edits from the tree with the edit box
// and the keys, what's typed checked first, undo and redo, edit as text in the normal editor, a document made
// invalid and fixed, saving in place (a file handle from huge mode's Open file: OPFS standing in for the picker's)
// with the saved file's SHA-256 checked, and a kept session restored after a reload.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
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

// Saving without the opened file's handle (opened through the file input). Chromium's save picker may empty a file
// the moment it is picked, so Save asks: "Overwrite" picks the file again with the open picker (stubbed with OPFS
// handles here) and writes only if it is the opened file as opened; "Save as a new file" suggests another name; after
// a save-picker pick, the opened file must still read as it was. (The pickers are Chromium's.)

/** Files in the origin's storage; `window.__h[name]` their handles; the first opened through the file input. */
async function openStored(t, files) {
  const { page } = t;
  await page.evaluate(async (files) => {
    localStorage.setItem('tk:hugeMin', '0');
    localStorage.removeItem('tk:hugeSim');
    const root = await navigator.storage.getDirectory();
    window.__h = {};
    for (const [name, s] of Object.entries(files)) {
      const h = await root.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(s);
      await w.close();
      window.__h[name] = h;
    }
    window.__sha = async (name) => {
      const f = await (await root.getFileHandle(name)).getFile();
      const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(await window.__h[Object.keys(files)[0]].getFile());
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
  t.assert(await until(page, () => !!window.__vis('.hg') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'huge mode opens the stored file');
}

const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent ?? ''));
const toasted = (page, re) => until(page, (s) => [...document.querySelectorAll('.toast')].some((e) => new RegExp(s).test(e.textContent ?? '')), re.source, { timeout: 10_000 });
const shaOf = (page, name) => page.evaluate((n) => window.__sha(n), name);

async function editName(page, i, name) {
  await selectPath(page, `$.users[${i}].name`);
  await page.keyboard.press('F2');
  await until(page, () => !!document.querySelector('.hg-box .hg-box-in.mono'), null);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await until(page, () => /Edited · \d+ change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
}

test('huge edit: without the file\'s handle Save asks; Overwrite writes only into the opened file, picked again and checked', { engines: ['chromium'] }, async (t) => {
  const { page } = t;
  await t.open('/');
  await openStored(t, { 'mine.json': text, 'other.json': text });
  await editName(page, 2, 'Grace');
  const want = structuredClone(doc);
  want.users[2].name = 'Grace';
  t.check(!/Save to the file/.test(await page.evaluate(() => window.__vis('.hg-editbar .btn.primary')?.dataset.tip ?? '')), 'Save doesn\'t say it writes into the file');
  // Asked; Esc: nothing.
  await page.keyboard.press(`${MOD}+s`);
  t.assert(await until(page, () => /Save changes to mine\.json/.test(window.__vis('.hg-modal [role=dialog]')?.textContent ?? ''), null), 'Ctrl+S asks', await page.evaluate(() => window.__vis('.hg-modal')?.textContent));
  t.check(await page.evaluate(() => document.activeElement?.textContent === 'Overwrite mine.json…'), 'Overwrite focused', await page.evaluate(() => document.activeElement?.textContent));
  t.check(/Save as a new file…/.test(await page.evaluate(() => window.__vis('.hg-modal')?.textContent ?? '')), 'and Save as a new file');
  await page.keyboard.press('Escape');
  t.check(await until(page, () => !window.__vis('.hg-modal'), null), 'Esc: closed');
  // Another file picked to overwrite: said so, nothing written anywhere.
  await page.evaluate(() => {
    window.__picks = [];
    window.showOpenFilePicker = async () => (window.__picks.push('open'), [window.__h['other.json']]);
    window.showSaveFilePicker = async () => (window.__picks.push('save'), window.__h['other.json']);
  });
  await page.keyboard.press(`${MOD}+s`);
  await until(page, () => !!window.__vis('.hg-modal'), null);
  await page.locator('.hg-modal .btn', { hasText: 'Overwrite' }).click();
  t.check(await toasted(page, /That isn't mine\.json as it was opened: nothing was written/), 'another file: said so', await toasts(page));
  t.check((await shaOf(page, 'mine.json')) === sha(text) && (await shaOf(page, 'other.json')) === sha(text), 'nothing written to either file');
  t.check(/Edited · 1 change/.test(await edited(page)), 'still edited', await edited(page));
  t.check((await page.evaluate(() => window.__picks.join())) === 'open', 'only the open picker', await page.evaluate(() => window.__picks.join()));
  // The opened file picked: written in place (SHA-256), the document then reads it.
  await page.evaluate(() => (window.showOpenFilePicker = async () => (window.__picks.push('open'), [window.__h['mine.json']])));
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+s`);
  await until(page, () => !!window.__vis('.hg-modal'), null);
  await page.locator('.hg-modal .btn', { hasText: 'Overwrite' }).click();
  t.check(await toasted(page, /Saved mine\.json/), 'saved, said so', await toasts(page));
  t.check(await until(page, () => !window.__vis('.hg-edited') && !window.__vis('.hg-saving'), null, { timeout: 20_000 }), 'nothing unsaved');
  t.check((await shaOf(page, 'mine.json')) === sha(JSON.stringify(want, null, 2)), 'the file holds the edited document (SHA-256)');
  t.check((await shaOf(page, 'other.json')) === sha(text), 'the other file untouched');
  t.check(!(await page.evaluate(() => window.__picks.includes('save'))), 'the save picker never used');
  // Its handle known now: the next Save writes in place without asking.
  await editName(page, 3, 'Linus');
  want.users[3].name = 'Linus';
  t.check(/Save to the file/.test(await page.evaluate(() => window.__vis('.hg-editbar .btn.primary')?.dataset.tip ?? '')), 'Save now says it writes into the file');
  await page.keyboard.press(`${MOD}+s`);
  t.check(await until(page, () => !window.__vis('.hg-edited') && !window.__vis('.hg-saving') && !window.__vis('.hg-modal'), null, { timeout: 20_000 }), 'saved without asking');
  t.check((await shaOf(page, 'mine.json')) === sha(JSON.stringify(want, null, 2)), 'in place again (SHA-256)');
});

test('huge edit: Save as a new file suggests another name; the opened file emptied by the save picker stops the save', { engines: ['chromium'] }, async (t) => {
  const { page } = t;
  await t.open('/');
  await openStored(t, { 'mine.json': text });
  await editName(page, 2, 'Grace');
  const want = structuredClone(doc);
  want.users[2].name = 'Grace';
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.showSaveFilePicker = async (o) => ((window.__suggested = o.suggestedName), root.getFileHandle('new.json', { create: true }));
  });
  await page.keyboard.press(`${MOD}+s`);
  await until(page, () => !!window.__vis('.hg-modal'), null);
  await page.locator('.hg-modal .btn', { hasText: 'Save as a new file' }).click();
  t.check(await toasted(page, /Saved as new\.json/), 'saved as, said so', await toasts(page));
  t.check((await page.evaluate(() => window.__suggested)) === 'mine (edited).json', 'another name suggested', await page.evaluate(() => window.__suggested));
  t.check((await shaOf(page, 'new.json')) === sha(JSON.stringify(want, null, 2)), 'the new file holds the edited document (SHA-256)');
  t.check((await shaOf(page, 'mine.json')) === sha(text), 'the opened file untouched');
  t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), 'still edited (a new file keeps the edits)', await edited(page));
  // The opened file picked in the save picker anyway, not emptied: nothing written, Overwrite is the way to it.
  await page.evaluate(() => (window.showSaveFilePicker = async () => window.__h['mine.json']));
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+s`);
  await until(page, () => !!window.__vis('.hg-modal'), null);
  await page.locator('.hg-modal .btn', { hasText: 'Save as a new file' }).click();
  t.check(await toasted(page, /This is the file you opened: choose Overwrite mine\.json… instead/), 'the opened file picked: said to use Overwrite', await toasts(page));
  t.check((await shaOf(page, 'mine.json')) === sha(text), 'nothing written to it');
  t.check(/Edited · 1 change/.test(await edited(page)), 'still edited', await edited(page));
  // The opened file picked in the save picker anyway, and emptied by it (as Chromium may): nothing written, said why.
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => {
      const h = window.__h['mine.json'];
      const w = await h.createWritable();
      await w.close();
      return h;
    };
  });
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+Shift+s`);
  t.check(await toasted(page, /Nothing was written: mine\.json has changed since it was opened/), 'stopped, said why', await toasts(page));
  t.check(!(await page.evaluate(() => !!window.__vis('.hg-saving'))), 'no save ran');
  t.check((await page.evaluate(async () => (await window.__h['mine.json'].getFile()).size)) === 0, '(the stub emptied it)');
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

// REVIEW-2 (suspicion): the newest key typed in the Format view, then another file opened at once: it is taken in
// before the document closes, and kept with the rest.
test('huge edit: a key typed in the Format view right before another file is opened is kept with the rest', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await editFormatAt(page, '"user 7"');
  const want = text.split('\n').findIndex((l) => l.includes('"user 7"')) + 1;
  await until(page, (n) => new RegExp(`Ln ${n},`).test(window.__vis('.hg .vmain')?.textContent ?? ''), want);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // The key, and in the same task the next file: no frame between them.
  await page.evaluate(() => {
    document.execCommand('insertText', false, 'Q');
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['[2]'], 'other-key.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  t.check(await toasted(page, /Your 1 unsaved change to users\.json is kept/), 'said kept', await toasts(page));
  await openHuge(t, path);
  t.assert(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'offered');
  await page.locator('.hg-restore .btn.primary').click();
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null, { timeout: 10_000 });
  await selectPath(page, '$.users[7].name');
  t.check(/"user 7Q"/.test(await selRow(page)), 'the key is in the kept edits', await selRow(page));
});

// REVIEW-2 #1: a kept session is offered before anything is edited, and never after: Restore would splice its edits
// (made on the file as opened) into the new ones. #3: while the Format view's text is edited, edits from elsewhere
// (the palette, the Restore banner) wait: the window holds the document's bytes as they were.
test('huge edit: the Restore banner goes on the first edit; while the Format view is edited, Restore waits', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await selectPath(page, '$.users[5].name');
  await page.keyboard.press('Delete');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  await page.waitForTimeout(1500);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await openHuge(t, path);
  t.assert(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'offered');
  t.check(/Editing first discards them/.test(await page.evaluate(() => window.__vis('.hg-restore')?.textContent ?? '')), 'and says what editing first does');
  if (process.env.HUGE_SHOTS) await page.screenshot({ path: join(process.env.HUGE_SHOTS, `r9-restore-${t.engine}.png`) });
  // The Format view's text being edited: Restore says why it waits; the banner stays.
  await editFormatAt(page, '"user 9"');
  await page.locator('.hg-restore .btn.primary').click();
  t.check(await toasted(page, /Leave text editing first/), 'Restore waits for text editing to end', await toasts(page));
  t.check(!!(await page.evaluate(() => window.__vis('.hg-restore'))), 'the banner stays');
  t.check(!(await edited(page)), 'nothing restored');
  await page.locator('.hg .vmain .btn.primary', { hasText: 'Done' }).click();
  await until(page, () => !document.querySelector('.hg-fe'), null);
  // An edit of the user's own: the banner goes, the kept edit isn't spliced in.
  await selectPath(page, '$.users[7].name');
  await page.keyboard.press('Delete');
  t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), 'edited', await edited(page));
  t.check(await until(page, () => !window.__vis('.hg-restore'), null), 'the banner goes on the first edit');
  await selectPath(page, '$.users[5]');
  t.check(/\{3\}/.test(await selRow(page)), '$.users[5] as the file has it (the kept edit not put in)', await selRow(page));
  await page.keyboard.press(`${MOD}+z`);
  t.check(await until(page, () => !window.__vis('.hg-edited'), null), 'undone');
  t.check(!(await page.evaluate(() => window.__vis('.hg-restore'))), 'and not offered again');
  // Editing on was the answer: these edits are kept now, not the earlier ones.
  await page.keyboard.press(`${MOD}+Shift+z`);
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  const other = join(dir, 'other-restore.json');
  writeFileSync(other, '[3]');
  await openHuge(t, other);
  t.check(await toasted(page, /Your 1 unsaved change to users\.json is kept/), 'the new edit said kept', await toasts(page));
  await openHuge(t, path);
  t.assert(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'offered on reopening');
  await page.locator('.hg-restore .btn.primary').click();
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null, { timeout: 10_000 });
  await selectPath(page, '$.users[7]');
  t.check(/\{2\}/.test(await selRow(page)), 'the new edit put back ($.users[7] has no name)', await selRow(page));
  await selectPath(page, '$.users[5]');
  t.check(/\{3\}/.test(await selRow(page)), 'not the earlier one', await selRow(page));
});

test('huge edit: while the Format view is edited, the palette\'s edits wait (its next keys land where they should)', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  await editFormatAt(page, '"user 7"');
  // (The caret on the match's line before the keys.)
  const want = text.split('\n').findIndex((l) => l.includes('"user 7"')) + 1;
  t.assert(await until(page, (n) => new RegExp(`Ln ${n},`).test(window.__vis('.hg .vmain')?.textContent ?? ''), want), 'the caret at the match', await page.evaluate(() => window.__vis('.hg .vmain')?.textContent));
  await page.keyboard.press(`${MOD}+k`);
  await until(page, () => !!document.querySelector('dialog.palette')?.open, null);
  await page.keyboard.type('Delete');
  await until(page, () => /Delete/.test(document.querySelector('dialog.palette [role=option][aria-selected=true]')?.textContent ?? ''), null);
  await page.keyboard.press('Enter');
  t.check(await toasted(page, /Leave text editing first/), 'the palette\'s Delete says why it waits', await toasts(page));
  t.check(!(await edited(page)), 'nothing deleted');
  // Typing goes on where the caret is (the palette gives the keys back), at the right bytes.
  t.check(await until(page, () => !!document.activeElement?.closest('.hg-fe'), null), 'the editor has the keys again');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' X');
  await page.keyboard.press('Escape');
  await until(page, () => !document.querySelector('.hg-fe'), null);
  await selectPath(page, '$.users[7].name');
  t.check(/"user 7 X"/.test(await selRow(page)), 'typed where it was', await selRow(page));
  await selectPath(page, '$.users[2]');
  t.check(/\{3\}/.test(await selRow(page)), '$.users[2] still there', await selRow(page));
});

// REVIEW-2 (suspicion): the Shape panel's go-to buttons hold byte offsets of the version it read; after an edit they
// would land on another value. They wait for the shape to be read again.
test('huge edit: after an edit, the Shape panel\'s go-to buttons wait for it to be read again', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, path);
  const tab = (id) => page.evaluate((id) => window.__vis(`.hg [role=tab][aria-controls=${id}]`)?.click(), id);
  await tab('hg-shape');
  t.assert(await until(page, () => /read in/.test(document.querySelector('#hg-shape .hs-status')?.textContent ?? ''), null, { timeout: 30_000 }), 'the shape is read');
  await page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^name$/ }) }).click();
  const first = page.locator('#hg-shape .hs-detail .hs-link', { hasText: 'First' }).first();
  t.check(await first.isEnabled(), 'First, before an edit');
  await first.click();
  t.check(await until(page, () => window.__vis('.hg .vmain .path')?.textContent === '$.users[0].name', null), 'goes to $.users[0].name', await page.evaluate(() => window.__vis('.hg .vmain .path')?.textContent));
  // An edit that moves every byte after it.
  await selectPath(page, '$.meta');
  await page.keyboard.press('Delete');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  await tab('hg-shape');
  t.check(await until(page, () => /edited since/.test(document.querySelector('#hg-shape .hs-status')?.textContent ?? ''), null), 'the panel says it was edited since');
  t.check(await first.isDisabled(), 'First waits for the shape to be read again');
  const vals = await page.evaluate(() => [...document.querySelectorAll('#hg-shape .hs-detail .hs-val')].map((b) => b.disabled));
  t.check(vals.length > 0 && vals.every(Boolean), 'and so do the values', vals);
});

// REVIEW-2 #2: a byte that isn't UTF-8 (Latin-1 é) shifted every position after it; typing in the Format view after
// it wrote at the wrong bytes ("PaXris"). Positions are the bytes' now.
test('huge edit: typed in the Format view after a byte that isn\'t UTF-8: written where it was typed', async (t) => {
  const { page } = t;
  const latin = join(dir, 'latin1.json');
  writeFileSync(latin, Buffer.concat([Buffer.from('{\n  "name": "caf', 'latin1'), Buffer.from([0xe9]), Buffer.from('",\n  "city": "Paris"\n}\n', 'latin1')]));
  await t.open('/');
  await openHuge(t, latin);
  await editFormatAt(page, 'Paris');
  await until(page, () => /Ln 3,/.test(window.__vis('.hg .vmain')?.textContent ?? ''), null);
  // (The caret at the match: before "Paris".)
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  await until(page, () => !document.querySelector('.hg-fe'), null);
  await selectPath(page, '$.city');
  t.check(/"XParis"/.test(await selRow(page)), 'X before Paris', await selRow(page));
  t.check(/Valid JSON/.test(await page.evaluate(() => window.__vis('.hg-sb')?.textContent ?? '')), 'still valid');
});

// REVIEW-2 #6: a broken document all read: the Format view's editing window was cut before the error's line, so it
// couldn't be fixed by typing. It holds the error's line and the lines after it.
test('huge edit: a broken file: Go to error, F2, the error\'s line in the editor, fixed by typing', async (t) => {
  const { page } = t;
  const recs = Array.from({ length: 5000 }, (_, i) => `  {"id": ${i}, "name": "user ${i}"}`);
  recs[20] = '  {"id": 20 "name": "user 20"}';
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '[\n' + recs.join(',\n') + '\n]\n');
  await t.open('/');
  await page.evaluate(() => localStorage.setItem('tk:hugeMin', '0'));
  await page.locator('.app:visible input[type=file]').setInputFiles(broken);
  t.assert(await until(page, () => /(Invalid|Not strict) JSON/.test(window.__vis('.hg .banner')?.textContent ?? ''), null, { timeout: 15_000 }), 'the error said');
  await page.locator('.hg .banner .btn', { hasText: 'Go to error' }).click();
  await page.locator('#hg-format').focus();
  await page.keyboard.press('F2');
  t.assert(await until(page, () => /Editing lines .* · Ln 22,/.test(window.__vis('.hg .vmain')?.textContent ?? ''), null, { timeout: 10_000 }), 'editing at the error\'s line', await page.evaluate(() => window.__vis('.hg .vmain')?.textContent));
  const shown = await page.evaluate(() => document.querySelector('.hg-fe textarea')?.value ?? '');
  t.check(/"id": 20 "name"/.test(await page.evaluate(() => [...document.querySelectorAll('.hg-fe .ed-body')].map((e) => e.textContent).join(''))) || shown.includes('"id": 20 "name"'), 'the error\'s line is in the editor');
  const range = await page.evaluate(() => /Editing lines ([\d,]+)–([\d,]+)/.exec(window.__vis('.hg .vmain')?.textContent ?? '')?.slice(1).map((x) => Number(x.replace(/,/g, ''))));
  t.check(range && range[1] > 122, 'and lines after it', range);
  // The caret at the error: a comma before it fixes it.
  await page.keyboard.type(',');
  await page.keyboard.press('Escape');
  t.check(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? '') && !window.__vis('.hg .banner'), null, { timeout: 10_000 }), 'fixed: valid', await page.evaluate(() => window.__vis('.hg-sb')?.textContent));
});

// REVIEW-2 #7, the UI's part: where a container's name repeats ({"a": {…}, "a": {…}}), an edit in the second "a"
// changes the value selected in the tree, not the one under the first "a" (the tree's index path goes with it).
test('huge edit: duplicate names: an edit inside the second of two members named alike changes that one', async (t) => {
  const { page } = t;
  const dup = join(dir, 'dup.json');
  writeFileSync(dup, '{\n  "a": {"x": 1},\n  "a": {"x": 2}\n}\n');
  await t.open('/');
  await page.evaluate(() => localStorage.setItem('tk:hugeMin', '0'));
  await page.locator('.app:visible input[type=file]').setInputFiles(dup);
  t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'huge mode opens');
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  await until(page, () => !!document.querySelector('#hg-tree .tv-r, #hg-tree [role=treeitem]'), null);
  await page.locator('#hg-tree').focus();
  // root, a, a: the second a, opened, its x.
  await page.keyboard.press('Home');
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
  t.assert(await until(page, () => /^x:\s*2/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'the second a\'s x selected', await selRow(page));
  await page.keyboard.press('F2');
  await until(page, () => !!document.querySelector('.hg-box .hg-box-in'), null);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('99');
  await page.keyboard.press('Enter');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  const doc = await page.evaluate(async () => {
    const tab = window.__vis('.hg [role=tab][aria-controls=hg-format]');
    tab?.click();
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('#hg-format')?.textContent ?? '';
  });
  t.check(/"a": \{"x": 1\}.*"a": \{"x": 99\}/s.test(doc), 'the second a\'s x is 99, the first unchanged', doc.slice(0, 200));
});

// REVIEW-2 #9: a .gz file's decompressed copy is new at every open; its session is keyed on the .gz file's facts, so
// reopening the .gz offers it. Saving a copy never offers to overwrite "the opened file" (it isn't the user's).
const gzPath = join(dir, 'users.json.gz');
writeFileSync(gzPath, gzipSync(text));

test('huge edit: a .json.gz edited, another file opened: reopening the .gz offers the edits; Save makes a new file', async (t) => {
  const page = await storagePage(t);
  try {
    await t.open('/');
    if (t.engine === 'chromium') {
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        window.__picks = [];
        window.showOpenFilePicker = async () => (window.__picks.push('open'), []);
        window.showSaveFilePicker = async (o) => (window.__picks.push(`save ${o.suggestedName}`), root.getFileHandle('gz-out.json', { create: true }));
      });
    }
    await openHuge(t, gzPath);
    t.check((await page.evaluate(() => window.__vis('.hg-file .fname')?.textContent ?? '')).startsWith('users.json'), 'named without .gz', await page.evaluate(() => window.__vis('.hg-file .fname')?.textContent));
    await selectPath(page, '$.users[5].name');
    await page.keyboard.press('Delete');
    await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
    const other = join(dir, 'other-gz.json');
    writeFileSync(other, '[1]');
    await openHuge(t, other);
    t.check(await toasted(page, /Your 1 unsaved change to users\.json is kept/), 'said kept', await toasts(page));
    await openHuge(t, gzPath);
    t.check(await until(page, () => /Restore 1 unsaved change from/.test(window.__vis('.hg-restore')?.textContent ?? ''), null, { timeout: 10_000 }), 'reopening the .gz offers them');
    await page.locator('.hg-restore .btn.primary').click();
    t.check(await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null, { timeout: 10_000 }), 'restored', await edited(page));
    if (t.engine === 'chromium') {
      await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(`${MOD}+s`);
      t.check(await toasted(page, /Saved as gz-out\.json/), 'Save: a new file, not asked to overwrite', await toasts(page));
      t.check((await page.evaluate(() => window.__picks.join())) === 'save users (edited).json', 'the save picker only, another name', await page.evaluate(() => window.__picks.join()));
    }
  } finally {
    await t.cleanup?.();
  }
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
    // Save without the file's handle asks where (round 8).
    await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+s`);
    t.check(await until(page, () => !!window.__vis('.hg-modal [role=dialog]'), null), 'Save asks');
    await shot('save-ask');
    await page.keyboard.press('Escape');
    await until(page, () => !window.__vis('.hg-modal'), null);
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

// REVIEW-3 B2: two lines with Latin-1 bytes selected and indented (Tab) in the Format view, saved in place: only the
// spaces are written; the E9 and EF bytes stay as they were (they were written back as EF BF BD).
test('huge edit: lines with bytes that aren\'t UTF-8 indented in the Format view: only the spaces change', { engines: ['chromium'] }, async (t) => {
  const page = await storagePage(t);
  try {
    await t.open('/');
    const bytes = [...Buffer.from('[\n  {"name": "caf'), 0xe9, ...Buffer.from('"},\n  {"name": "na'), 0xef, ...Buffer.from('ve"},\n  {"name": "x"}\n]\n')];
    await page.evaluate(async (bytes) => {
      localStorage.setItem('tk:hugeMin', '0');
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle('latin.json', { create: true });
      const w = await h.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
      window.showOpenFilePicker = async () => [h];
    }, bytes);
    await openHuge(t, path);
    await page.locator('.hg-file .btn', { hasText: 'Open file' }).click();
    t.assert(await until(page, () => /latin\.json/.test(window.__vis('.hg-file .fname')?.textContent ?? '') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'opened through its handle');
    await editFormatAt(page, 'caf');
    await until(page, () => /Ln 2,/.test(window.__vis('.hg .vmain')?.textContent ?? ''), null);
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Tab');
    await page.keyboard.press(`${MOD}+s`);
    t.check(await toasted(page, /Saved latin\.json/), 'saved', await toasts(page));
    const got = await page.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle('latin.json')).getFile()).arrayBuffer())]);
    const want = [...Buffer.from('[\n    {"name": "caf'), 0xe9, ...Buffer.from('"},\n    {"name": "na'), 0xef, ...Buffer.from('ve"},\n  {"name": "x"}\n]\n')];
    t.check(Buffer.compare(Buffer.from(got), Buffer.from(want)) === 0, 'the two lines indented, E9 and EF as they were', Buffer.from(got).toString('latin1'));
  } finally {
    await t.cleanup?.();
  }
});

// REVIEW-3 B3: the second of two members named alike, reached by Find (not the tree's cursor): its edits and the
// insert into it go there, not to the first of that name.
test('huge edit: duplicate names: a value found with Find, deleted; a value inserted into the second "a"', async (t) => {
  const { page } = t;
  const dup = join(dir, 'dup-find.json');
  writeFileSync(dup, '{\n  "a": {"v": 1},\n  "a": {"v": 22}\n}\n');
  await t.open('/');
  await page.evaluate(() => localStorage.setItem('tk:hugeMin', '0'));
  await page.locator('.app:visible input[type=file]').setInputFiles(dup);
  t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'huge mode opens');
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  await until(page, () => !!document.querySelector('#hg-tree [role=treeitem], #hg-tree .tv-r'), null);
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill('22');
  t.assert(await until(page, () => /^v:\s*22/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null), 'Find selects the second a\'s v', await selRow(page));
  await page.keyboard.press('Escape');
  await page.locator('#hg-tree').focus();
  // Insert after it (in the second "a"), then delete it.
  await page.keyboard.press(`${MOD}+Enter`);
  await until(page, () => !!document.querySelector('.hg-box'), null);
  await page.locator('.hg-box input[aria-label="Name"]').fill('n');
  await page.locator('.hg-box .hg-box-kind').selectOption('number');
  await page.locator('.hg-box [aria-label="Value"]').fill('3');
  await page.locator('.hg-box [aria-label="Value"]').press('Enter');
  await until(page, () => /Edited · 1 change/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.hg .findbar input').fill('22');
  await until(page, () => /^v:\s*22/.test(document.querySelector('#hg-tree #htv-sel')?.textContent ?? ''), null);
  await page.keyboard.press('Escape');
  await page.locator('#hg-tree').focus();
  await page.keyboard.press('Delete');
  await until(page, () => /Edited · 2 changes/.test(window.__vis('.hg-edited')?.textContent ?? ''), null);
  const doc = await page.evaluate(async () => {
    window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('#hg-format')?.textContent ?? '';
  });
  t.check(/"a": \{"v": 1\}.*"a": \{\s*"n": 3\s*\}/s.test(doc), 'the first "a" as it was; the second has n, not v', doc.slice(0, 200));
});
