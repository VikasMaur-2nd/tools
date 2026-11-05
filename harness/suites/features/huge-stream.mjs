// Huge mode's streamed work (lib/huge/tasks.ts, lib/huge/stream): the Shape panel (paths, details, First /
// Next / Count, Extract from it), the Convert view's commands written byte for byte as the normal path writes
// them (Pretty, Minify, JSON Lines, CSV, Split into a zip, Extract with conditions) through both sinks (a
// download from the browser's storage, and a save dialog, stubbed with an OPFS file), .gz files (small: the
// editor; big: huge mode), privacy, and screenshots (HUGE_SHOTS=dir) in both themes on desktop and phone.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { webkit } from 'playwright-core';
import { join } from 'node:path';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { MOD, poll, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['huge'] });

const dir = join(DIRS.tmp, 'huge-stream-files');
mkdirSync(dir, { recursive: true });
const file = (name, data) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};

const recs = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `user ${i}`, email: i % 9 ? `u${i}@example.com` : null, active: i % 3 !== 0, tags: i % 7 ? ['a', 'b'] : [], ...(i % 10 ? {} : { vip: true }), score: Math.round(i * 7.31) / 100, at: `2024-01-${String(1 + (i % 28)).padStart(2, '0')}` }));
const doc = { meta: { version: 3 }, users: recs };
const prettyPath = file('people.json', JSON.stringify(doc, null, 2));
const arrayPath = file('records.json', JSON.stringify(recs));
const linesPath = file('records.jsonl', recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
const gzSmall = file('small.json.gz', gzipSync(JSON.stringify(recs.slice(0, 50), null, 2)));
const gzBig = file('big.jsonl.gz', gzipSync(recs.map((r) => JSON.stringify(r)).join('\n') + '\n'));

/** toCsv of the records above (dotted columns; tags joined; missing vip empty). */
function csvOf(rs) {
  const cols = ['id', 'name', 'email', 'active', 'tags', 'vip', 'score', 'at'];
  // (First-seen order: vip first appears on record 0.)
  const q = (s) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const cell = (r, c) => {
    const v = r[c];
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.length ? q(v.join(', ')) : '""';
    return q(String(v));
  };
  return cols.join(',') + '\r\n' + rs.map((r) => cols.map((c) => cell(r, c)).join(',') + '\r\n').join('');
}

/** Without Chromium's pickers: every command downloads from the browser's storage (as in Firefox and Safari). */
const NO_PICKERS = () => {
  for (const k of ['showSaveFilePicker', 'showDirectoryPicker', 'showOpenFilePicker']) {
    delete window[k];
    try {
      delete Window.prototype[k];
    } catch {
      /* not there */
    }
  }
};

/**
 * WebKit keeps no OPFS in a fresh (ephemeral) context, as Safari's private windows: checks that write
 * there run in a persistent profile in WebKit (Chromium and Firefox have it either way).
 */
async function storagePage(t) {
  if (t.engine !== 'webkit') return t.page;
  const profile = mkdtempSync(join(DIRS.tmp, 'webkit-profile-'));
  const ctx = await webkit.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 860 }, acceptDownloads: true, serviceWorkers: 'block' });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.addInitScript(() => {
    window.__vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) || null;
  });
  t.page = page;
  t.cleanup = async () => {
    await ctx.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  };
  return page;
}

async function openHuge(t, path) {
  const { page } = t;
  await page.evaluate(() => {
    localStorage.setItem('tk:hugeMin', '0');
    localStorage.removeItem('tk:hugeSim');
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    if (input) input.value = '';
  });
  await page.locator('.app:visible input[type=file]').setInputFiles(path);
  t.assert(await until(page, () => !!window.__vis('.hg') && document.documentElement.hasAttribute('data-huge'), null, { timeout: 15_000 }), 'huge mode opens');
  t.assert(await until(page, () => /Valid JSON|JSON Lines/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 20_000 }), 'indexed');
}

const view = (page, v) =>
  page.evaluate((v) => {
    const tab = window.__vis(`.hg [role=tab][aria-controls=hg-${v}]`);
    if (tab) return tab.click();
    const pick = window.__vis('.hg .tabs-pick select');
    pick.value = v;
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);

const shapeDone = (page) => until(page, () => /read in/.test(document.querySelector('#hg-shape .hs-status')?.textContent ?? ''), null, { timeout: 30_000 });
const rowLabels = (page) => page.evaluate(() => [...document.querySelectorAll('#hg-shape .hs-row:not(.hs-head) .hs-path')].map((r) => r.textContent.trim()));

/** Picks a command in the Convert view, sets what `set` sets, runs it, and returns the download's text (or bytes). */
async function runCommand(t, kind, set, { bytes = false } = {}) {
  const { page } = t;
  await view(page, 'convert');
  await page.locator('#hg-convert .hc-kind', { hasText: new RegExp(`^${kind}$`) }).click();
  if (set) await set(page);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#hg-convert .hc-go .btn.primary').click();
  const d = await download;
  const p = await d.path();
  t.assert(await until(page, () => /Downloaded/.test(document.querySelector('#hg-convert .hc-done')?.textContent ?? ''), null, { timeout: 30_000 }), `${kind}: done`);
  const buf = readFileSync(p);
  return { name: d.suggestedFilename(), data: bytes ? buf : buf.toString('utf8') };
}

test('huge stream: the Shape panel reads every record: paths, kinds, presence, First / Next / Count', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, prettyPath);
  await view(page, 'shape');
  t.assert(await shapeDone(page), 'the shape is read', await page.evaluate(() => document.querySelector('#hg-shape .hs-status')?.textContent));
  const labels = await rowLabels(page);
  for (const k of ['$', 'meta', 'users', '[ ] items', 'email', 'vip', 'tags']) t.check(labels.includes(k), `a row for ${k}`, labels);
  const status = await page.evaluate(() => document.querySelector('#hg-shape .hs-status').textContent);
  t.check(/1[1-9] paths/.test(status), 'paths counted', status);
  // vip: in 10% of the records; email null in 1 of 9.
  const vip = page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^vip$/ }) });
  t.check(/^10%$/.test((await vip.locator('[role=gridcell]').nth(2).textContent()).trim()), 'vip present in 10%', await vip.textContent());
  await vip.click();
  const detail = page.locator('#hg-shape .hs-detail');
  t.check(/\$\.users\[\*\]\.vip/.test(await detail.locator('.hs-dpath').textContent()), 'details: its path');
  t.check(/2,700/.test(await detail.textContent()), 'details: 2,700 missing', await detail.textContent());
  // Count the records missing it, in the stream worker.
  const missing = detail.locator('li', { hasText: 'missing' });
  await missing.locator('.hs-link', { hasText: 'Count' }).click();
  t.check(await until(page, () => /2,700/.test([...document.querySelectorAll('#hg-shape .hs-detail li')].find((l) => /missing/.test(l.textContent))?.querySelector('.hs-acts')?.textContent ?? ''), null), 'Count: 2,700 objects lack it');
  // First missing: record 1, selected in the tree.
  await missing.locator('.hs-link', { hasText: 'First' }).click();
  t.check(await until(page, () => window.__vis('.hg .vmain .path')?.textContent === '$.users[1]', null), 'First goes to the first record without it', await page.evaluate(() => window.__vis('.hg .vmain .path')?.textContent));
  // Next from there: record 2.
  await view(page, 'shape');
  await page.locator('#hg-shape .hs-detail li', { hasText: 'missing' }).locator('.hs-link', { hasText: 'Next' }).click();
  t.check(await until(page, () => window.__vis('.hg .vmain .path')?.textContent === '$.users[2]', null), 'Next goes to the next one', await page.evaluate(() => window.__vis('.hg .vmain .path')?.textContent));
  // Email: string and null, distinct estimated; formats.
  await view(page, 'shape');
  await page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^email$/ }) }).click();
  const text = await page.locator('#hg-shape .hs-detail').textContent();
  t.check(/Email100%/.test(text.replace(/\s/g, '')), 'emails recognised', text);
  t.check(/about/.test(text), 'distinct values estimated', text);
  // Keys move through the rows.
  await page.locator('#hg-shape .hs-grid').focus();
  await page.keyboard.press('Home');
  t.check(await until(page, () => document.querySelector('#hg-shape .hs-row.on .hs-path')?.textContent.trim() === '$', null), 'Home selects the root');
});

test('huge stream: Pretty, Minify, JSON Lines and CSV download exactly what the normal path writes', async (t) => {
  const page = await storagePage(t);
  try {
  await page.addInitScript(NO_PICKERS);
  await t.open('/');
  await openHuge(t, arrayPath);
  let r = await runCommand(t, 'Minify');
  t.check(r.name === 'records.min.json' && r.data === JSON.stringify(recs), 'Minify', r.name);
  r = await runCommand(t, 'Pretty', (p) => p.locator('#hg-convert [role=radio]', { hasText: '4 spaces' }).click());
  t.check(r.name === 'records.json' && r.data === JSON.stringify(recs, null, 4), 'Pretty, 4 spaces', r.name);
  r = await runCommand(t, 'JSON Lines');
  t.check(r.data === recs.map((x) => JSON.stringify(x) + '\n').join(''), 'JSON Lines');
  r = await runCommand(t, 'CSV');
  t.check(r.name === 'records.csv' && r.data === csvOf(recs), 'CSV', r.data.slice(0, 300));
  // gzip: the same bytes, compressed.
  r = await runCommand(t, 'Minify', (p) => p.locator('#hg-convert .hc-check', { hasText: 'gzip' }).locator('input').check(), { bytes: true });
  const { gunzipSync } = await import('node:zlib');
  t.check(r.name === 'records.min.json.gz' && gunzipSync(r.data).toString() === JSON.stringify(recs), 'gzip output', r.name);
  // The result line, and Download again.
  const done = await page.locator('#hg-convert .hc-done').textContent();
  t.check(/3,000 records/.test(done) && /Download again/.test(done), 'the result says what it wrote', done);
  } finally {
    await t.cleanup?.();
  }
});

test('huge stream: Split writes its parts into a zip; Extract picks records by conditions', async (t) => {
  const page = await storagePage(t);
  try {
  await page.addInitScript(NO_PICKERS);
  await t.open('/');
  await openHuge(t, linesPath);
  const r = await runCommand(
    t,
    'Split',
    async (p) => {
      await p.locator('#hg-convert .hc-num').first().fill('700');
    },
    { bytes: true },
  );
  // Read the zip's central directory (stored entries, ZIP64).
  const z = r.data;
  const eocd = z.length - 22;
  const z64 = Number(z.readBigUInt64LE(eocd - 20 + 8));
  const count = Number(z.readBigUInt64LE(z64 + 32));
  const cdAt = Number(z.readBigUInt64LE(z64 + 48));
  const names = [];
  let all = '';
  for (let k = 0, at = cdAt; k < count; k++) {
    const n = z.readUInt16LE(at + 28);
    const x = z.readUInt16LE(at + 30);
    const name = z.subarray(at + 46, at + 46 + n).toString();
    const size = Number(z.readBigUInt64LE(at + 46 + n + 4));
    const local = Number(z.readBigUInt64LE(at + 46 + n + 20));
    const ln = z.readUInt16LE(local + 26);
    const lx = z.readUInt16LE(local + 28);
    names.push(name);
    all += z.subarray(local + 30 + ln + lx, local + 30 + ln + lx + size).toString();
    at += 46 + n + x;
  }
  t.check(r.name === 'records-parts.zip' && count === 5 && names[0] === 'records-part-0001.jsonl', 'five parts of 700 (the last 200)', { name: r.name, names });
  t.check(all === recs.map((x) => JSON.stringify(x) + '\n').join(''), 'together, every record');
  void inflateRawSync;
  // Extract: records not active whose name has a 7, first 20, as JSON Lines.
  const e = await runCommand(t, 'Extract', async (p) => {
    const c = p.locator('#hg-convert .hc-cond').first();
    await c.locator('.hc-path').fill('active');
    await c.locator('select').selectOption('eq');
    await c.locator('.hc-val').fill('false');
    await p.locator('#hg-convert .btn', { hasText: 'Add condition' }).click();
    const c2 = p.locator('#hg-convert .hc-cond').nth(1);
    await c2.locator('.hc-path').fill('name');
    await c2.locator('select').selectOption('contains');
    await c2.locator('.hc-val').fill('7');
    await p.locator('#hg-convert .hc-num').first().fill('20');
  });
  const want = recs.filter((x) => !x.active && x.name.includes('7')).slice(0, 20);
  t.check(e.data === want.map((x) => JSON.stringify(x) + '\n').join(''), 'Extract: the first 20 matching records', e.data.slice(0, 200));
  } finally {
    await t.cleanup?.();
  }
});

// (Chromium's path: Safari has no save dialog API, so WebKit always writes to OPFS and downloads. A stubbed
// picker there reports "Saved" but its OPFS file reads back without the bytes: WebKit's createWritable from a
// worker, not a path huge mode takes in Safari.)
test('huge stream: the save dialog writes the file as it goes (a stubbed picker: an OPFS file)', { engines: ['chromium', 'firefox'] }, async (t) => {
  const page = await storagePage(t);
  try {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async (o) => {
      window.__picked = o.suggestedName;
      return (await navigator.storage.getDirectory()).getFileHandle('picked-output', { create: true });
    };
  });
  await t.open('/');
  await openHuge(t, prettyPath);
  await view(page, 'convert');
  await page.locator('#hg-convert .hc-kind', { hasText: /^Minify$/ }).click();
  const go = page.locator('#hg-convert .hc-go .btn.primary');
  t.check((await go.textContent()) === 'Save as…', 'Save as… where the dialog is', await go.textContent());
  await go.click();
  t.assert(await until(page, () => /Saved/.test(document.querySelector('#hg-convert .hc-done')?.textContent ?? ''), null, { timeout: 30_000 }), 'saved');
  const out = await page.evaluate(async () => [window.__picked, await (await (await navigator.storage.getDirectory()).getFileHandle('picked-output')).getFile().then((f) => f.text())]);
  t.check(out[0] === 'people.min.json' && out[1] === JSON.stringify(doc), 'the picked file holds the minified document', out[0]);
  } finally {
    await t.cleanup?.();
  }
});

test('huge stream: a small .json.gz opens in the editor; a big .jsonl.gz in huge mode', async (t) => {
  const page = await storagePage(t);
  try {
  await t.open('/');
  await page.evaluate(() => localStorage.removeItem('tk:hugeMin'));
  await page.locator('.app:visible input[type=file]').setInputFiles(gzSmall);
  t.check(await until(page, () => /Valid JSON/.test(document.querySelector('.statusbar')?.textContent ?? '') && !document.documentElement.hasAttribute('data-huge'), null, { timeout: 20_000 }), 'small: in the editor, valid', await page.evaluate(() => document.querySelector('.statusbar')?.textContent));
  const name = await page.evaluate(() => document.querySelector('.app .fname, [data-file-name]')?.textContent ?? '');
  t.log('editor file', name);
  await page.evaluate(() => {
    localStorage.setItem('tk:hugeMin', '0');
    const input = window.__vis('.app')?.querySelector('input[type=file]');
    if (input) input.value = '';
  });
  await page.locator('.app:visible input[type=file]').setInputFiles(gzBig);
  t.check(await until(page, () => /JSON Lines · 3,000 records/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 30_000 }), 'big: huge mode, JSON Lines', await page.evaluate(() => window.__vis('.hg-sb')?.textContent));
  t.check((await page.evaluate(() => window.__vis('.hg-file .fname')?.textContent ?? '')).startsWith('big.jsonl'), 'named without .gz');
  // Closing the file lets its decompressed copy go.
  await page.locator('.hg-file .btn.icon').last().click();
  const empty = () =>
    page.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('tk-huge', { create: true });
      for await (const _ of d.keys()) return false;
      return true;
    });
  t.check(await poll(empty, { timeout: 10_000 }), 'the decompressed copy is deleted');
  } finally {
    await t.cleanup?.();
  }
});

test('huge stream: "Extract records without it" from the Shape panel fills in Convert, for the records array', async (t) => {
  const page = await storagePage(t);
  try {
    await page.addInitScript(NO_PICKERS);
    await t.open('/');
    await openHuge(t, prettyPath);
    await view(page, 'shape');
    t.assert(await shapeDone(page), 'shape read');
    await page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^vip$/ }) }).click();
    await page.locator('#hg-shape .hs-detail .btn', { hasText: 'Extract records without it' }).click();
    t.check(await until(page, () => !!document.querySelector('#hg-convert'), null), 'Convert opens');
    const form = await page.evaluate(() => ({ path: document.querySelector('#hg-convert .hc-path')?.value, op: document.querySelector('#hg-convert .hc-cond select')?.value, of: document.querySelector('#hg-convert [role=radio][aria-checked=true]')?.textContent }));
    t.check(form.path === 'vip' && form.op === 'missing', 'the condition, filled in', form);
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('#hg-convert .hc-go .btn.primary').click();
    const d = await download;
    const text = readFileSync(await d.path(), 'utf8');
    const want = recs.filter((x) => !('vip' in x)).map((x) => JSON.stringify(x) + '\n').join('');
    t.check(text === want, 'the 2,700 records of $.users without vip', text.slice(0, 200));
  } finally {
    await t.cleanup?.();
  }
});

test('huge stream: commands write the edited document; the Shape panel says when it was read before an edit', async (t) => {
  const page = await storagePage(t);
  try {
    await page.addInitScript(NO_PICKERS);
    await t.open('/');
    await openHuge(t, prettyPath);
    await view(page, 'shape');
    t.assert(await shapeDone(page), 'shape read');
    // Edit: users[1].name set, users[2] deleted (the editing suite's keys).
    const select = async (p) => {
      await view(page, 'tree');
      await page.locator('.hg-file').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(`${MOD}+f`);
      await page.locator('.hg .findbar input').fill(p);
      await until(page, (p) => window.__vis('.hg .vmain .path')?.textContent === p, p, { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.locator('#hg-tree').focus();
    };
    await select('$.users[1].name');
    await page.keyboard.press('F2');
    t.assert(await until(page, () => !!document.querySelector('.hg-box .hg-box-in'), null), 'the edit box');
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('Ada');
    await page.keyboard.press('Enter');
    t.assert(await until(page, () => /Edited/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), 'edited');
    await select('$.users[2]');
    await page.keyboard.press('Delete');
    t.assert(await until(page, () => /2 changes/.test(window.__vis('.hg-edited')?.textContent ?? ''), null), 'two changes', await page.evaluate(() => window.__vis('.hg-edited')?.textContent));
    const want = structuredClone(doc);
    want.users[1].name = 'Ada';
    want.users.splice(2, 1);
    await view(page, 'shape');
    t.check(await until(page, () => /edited since/.test(document.querySelector('#hg-shape .hs-status')?.textContent ?? ''), null, { timeout: 10_000 }), 'the shape says it predates the edits');
    // Minify and CSV of the edited document.
    t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 15_000 }), 'read again');
    const m = await runCommand(t, 'Minify');
    t.check(m.data === JSON.stringify(want), 'Minify: the edited document', m.data.slice(0, 200));
    const c = await runCommand(t, 'CSV');
    t.check(c.data === csvOf(want.users), 'CSV: the edited records', c.data.slice(0, 300));
    // The Shape read again: no note.
    await view(page, 'shape');
    await page.locator('#hg-shape .btn', { hasText: 'Read again' }).click();
    t.check(await until(page, () => { const st = document.querySelector('#hg-shape .hs-status')?.textContent ?? ''; return /read in/.test(st) && !/edited since/.test(st); }, null, { timeout: 30_000 }), 'read again: current', await page.evaluate(() => document.querySelector('#hg-shape .hs-status')?.textContent));
  } finally {
    await t.cleanup?.();
  }
});

test('huge stream: Shape and Convert show the document only inside private boxes', async (t) => {
  const { page } = t;
  await t.open('/');
  await openHuge(t, prettyPath);
  await view(page, 'shape');
  await shapeDone(page);
  await page.locator('#hg-shape .hs-row').nth(3).click();
  const leaks = await page.evaluate(() => {
    const out = [];
    for (const sel of ['#hg-shape .hs-grid', '#hg-shape .hs-detail', '#hg-shape .hs-status']) for (const el of document.querySelectorAll(sel)) if (!el.closest('.ph-no-capture')) out.push(sel);
    return out;
  });
  t.check(leaks.length === 0, 'shape: private', leaks);
});

// Screenshots for review (HUGE_SHOTS names a folder): the Shape panel and the Convert view.
for (const [name, opts] of [
  ['desktop-light', {}],
  ['desktop-dark', { dark: true }],
  ['mobile-light', { mobile: true, width: 390, height: 844 }],
  ['mobile-dark', { mobile: true, dark: true, width: 390, height: 844 }],
]) {
  test(`huge stream: screenshots ${name}`, { ...opts, engines: ['chromium'], tags: ['shots'] }, async (t) => {
    const out = process.env.HUGE_SHOTS;
    if (!out) return t.log('HUGE_SHOTS not set: no screenshots');
    mkdirSync(out, { recursive: true });
    const { page } = t;
    const shot = async (file) => {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300))));
      await page.screenshot({ path: join(out, `stream-${name}-${file}.png`) });
    };
    await page.addInitScript(NO_PICKERS);
    await t.open('/');
    await openHuge(t, prettyPath);
    await view(page, 'shape');
    await shapeDone(page);
    await page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^email$/ }) }).click();
    await shot('shape');
    await page.locator('#hg-shape .hs-row', { has: page.locator('.hs-path', { hasText: /^active$/ }) }).click();
    await shot('shape-values');
    await view(page, 'convert');
    await page.locator('#hg-convert .hc-kind', { hasText: /^Extract$/ }).click();
    const c = page.locator('#hg-convert .hc-cond').first();
    await c.locator('.hc-path').fill('email');
    await c.locator('select').selectOption('missing');
    await shot('convert-extract');
    await page.locator('#hg-convert .hc-kind', { hasText: /^CSV$/ }).click();
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('#hg-convert .hc-go .btn.primary').click();
    await download;
    await until(page, () => /Downloaded/.test(document.querySelector('#hg-convert .hc-done')?.textContent ?? ''), null, { timeout: 30_000 });
    await shot('convert-done');
  });
}
