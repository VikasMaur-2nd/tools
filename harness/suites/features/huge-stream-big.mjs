// Huge mode's streamed commands on a real big file (no override: over the 300 MiB threshold): for the Shape
// pass and each command, its time and throughput (input bytes / time from the click to "done"), and the
// browser's memory (PSS over all its processes) before and at its peak. Outputs go through Chromium's real
// sink (createWritable on a file handle), here an OPFS file standing in for the save dialog's, deleted after
// each command. Also a .jsonl.gz of the same records decompressed to the browser's storage and indexed.
// Tagged slow (the night window on the shared host); HUGE_GB sets the size (default 1); the files are made once
// and deleted with HUGE_KEEP unset. Results: the log, and HUGE_STREAM_JSON (a file) if set.
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { browserMemory } from '../breaker/_mem.mjs';
import { until } from './_helpers.mjs';

defaults({ engines: ['chromium'], width: 1280, height: 860, tags: ['slow', 'huge-big'], slots: 'all', timeout: 3_600_000 });

const GB = Number(process.env.HUGE_GB || 1);
const dir = join(DIRS.tmp, 'huge-big');
mkdirSync(dir, { recursive: true });
const path = join(dir, `records-${GB}gb.json`);
const gzPath = join(dir, `records-${GB}gb.jsonl.gz`);

/** As huge-big.mjs makes it: `{"meta": …, "records": [` one record a line `]}`. */
async function make() {
  const want = GB * 1024 ** 3;
  if (existsSync(path) && statSync(path).size >= want) return;
  const out = createWriteStream(path);
  const write = (s) => (out.write(s) ? undefined : new Promise((r) => out.once('drain', r)));
  await write('{"meta": {"version": 1, "about": "generated for huge-file mode"},\n"records": [\n');
  let bytes = 0;
  let i = 0;
  let chunk = '';
  while (bytes < want) {
    const r = `{"id":${i},"name":"user ${i}","email":"u${i}@example.com","active":${i % 3 !== 0},"tags":["a","b"],"score":${(i * 7.31) % 1000},"note":"${'lorem ipsum '.repeat(1 + (i % 7))}"}`;
    chunk += (i ? ',\n' : '') + r;
    bytes += r.length + 2;
    i++;
    if (chunk.length > 1 << 20) {
      await write(chunk);
      chunk = '';
    }
  }
  await write(chunk + '\n]}\n');
  await new Promise((r) => out.end(r));
}

/** The same records as JSON Lines, gzipped. */
async function makeGz() {
  if (existsSync(gzPath)) return;
  const want = GB * 1024 ** 3;
  const gz = createGzip({ level: 6 });
  const out = createWriteStream(gzPath);
  const done = pipeline(gz, out);
  let bytes = 0;
  let chunk = '';
  for (let i = 0; bytes < want; i++) {
    const r = `{"id":${i},"name":"user ${i}","email":"u${i}@example.com","active":${i % 3 !== 0},"tags":["a","b"],"score":${(i * 7.31) % 1000},"note":"${'lorem ipsum '.repeat(1 + (i % 7))}"}\n`;
    chunk += r;
    bytes += r.length;
    if (chunk.length > 1 << 20) {
      if (!gz.write(chunk)) await new Promise((r) => gz.once('drain', r));
      chunk = '';
    }
  }
  gz.end(chunk);
  await done;
  void createReadStream;
}

/** Chromium's save dialog and folder picker, answered with OPFS handles (createWritable, as a real file). */
const PICKERS = () => {
  window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('bench-out', { create: true });
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('bench-parts', { create: true });
};

test('huge stream, a real big file: each command’s throughput and memory', async (t) => {
  await make();
  const size = statSync(path).size;
  const { page } = t;
  await page.addInitScript(PICKERS);
  await t.open('/');
  await page.evaluate(() => {
    localStorage.removeItem('tk:hugeMin');
    localStorage.removeItem('tk:hugeSim');
  });
  const idle = browserMemory().pss;
  await page.locator('.app:visible input[type=file]').setInputFiles(path);
  t.assert(await until(page, () => !!window.__vis('.hg'), null, { timeout: 30_000 }), 'huge mode opens');
  t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 600_000 }), 'indexed');
  const results = { size, idle, commands: {} };
  const view = (v) => page.evaluate((v) => window.__vis(`.hg [role=tab][aria-controls=hg-${v}]`)?.click(), v);
  const clean = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('bench-out').catch(() => {});
      await root.removeEntry('bench-parts', { recursive: true }).catch(() => {});
    });
  /** Runs `fn` (which starts the work) until `done()` in the page; times it and samples PSS. */
  const measure = async (name, start, done, input = size) => {
    await clean();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    const before = browserMemory().pss;
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, browserMemory().pss)), 200);
    const t0 = Date.now();
    await start();
    const ok = !!(await until(page, done, null, { timeout: 1_800_000 }));
    const ms = Date.now() - t0;
    clearInterval(timer);
    const out = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const f = await root
        .getFileHandle('bench-out')
        .then((h) => h.getFile())
        .catch(() => null);
      return f ? f.size : -1;
    });
    const r = { ok, ms, mbs: +(input / 1e6 / (ms / 1000)).toFixed(1), pssBefore: before, pssPeak: peak, peakAbove: peak - before, out };
    results.commands[name] = r;
    t.log(`${name}: ${ok ? 'ok' : 'FAILED'} ${(ms / 1000).toFixed(1)} s, ${r.mbs} MB/s, PSS ${Math.round(before / 2 ** 20)} → ${Math.round(peak / 2 ** 20)} MiB (+${Math.round((peak - before) / 2 ** 20)}), out ${out}`);
    t.check(ok, `${name} finished`);
    await clean();
  };
  // Shape: the whole file.
  await measure(
    'shape',
    () => view('shape'),
    () => /read in/.test(document.querySelector('#hg-shape .hs-status')?.textContent ?? ''),
  );
  const status = await page.evaluate(() => document.querySelector('#hg-shape .hs-status')?.textContent);
  t.log('shape', status);
  const cmd = async (name, kind, set) => {
    await measure(
      name,
      async () => {
        await view('convert');
        await page.locator('#hg-convert .hc-kind', { hasText: new RegExp(`^${kind}$`) }).click();
        if (set) await set();
        await page.locator('#hg-convert .hc-go .btn.primary').click();
      },
      () => /Saved|Downloaded/.test(document.querySelector('#hg-convert .hc-done')?.textContent ?? '') || /went wrong|error|space/i.test(document.querySelector('#hg-convert .hc-done')?.textContent ?? ''),
    );
    const done = await page.evaluate(() => document.querySelector('#hg-convert .hc-done')?.textContent);
    t.log(name, done);
  };
  const gz = (on) => page.locator('#hg-convert .hc-check', { hasText: 'gzip' }).locator('input').setChecked(on);
  await cmd('minify', 'Minify');
  await cmd('pretty', 'Pretty');
  await cmd('csv', 'CSV');
  // JSON Lines of $.records (selected through Find's $.path in the tree).
  await view('tree');
  await page.keyboard.press('Control+f');
  await page.locator('.hg .findbar input').fill('$.records');
  await page.locator('.hg .findbar input').press('Enter');
  t.check(await until(page, () => window.__vis('.hg .vmain .path')?.textContent === '$.records', null, { timeout: 30_000 }), '$.records selected');
  await cmd('jsonl-of-records', 'JSON Lines', () => page.locator('#hg-convert [role=radio]', { hasText: 'Selected value' }).click());
  await view('convert');
  await page.locator('#hg-convert [role=radio]', { hasText: 'Whole file' }).click();
  await cmd('extract-inactive', 'Extract', async () => {
    const c = page.locator('#hg-convert .hc-cond').first();
    await c.locator('.hc-path').fill('active');
    await c.locator('select').selectOption('eq');
    await c.locator('.hc-val').fill('false');
  });
  await cmd('split-256mb', 'Split', async () => {
    await page.locator('#hg-convert .hc-num').first().fill('256');
    await page.locator('#hg-convert select').first().selectOption('mb');
  });
  await cmd('minify-gzip', 'Minify', () => gz(true));
  await gz(false);
  // A .jsonl.gz of the same records: decompressed into the browser's storage, then indexed.
  await makeGz();
  const gzSize = statSync(gzPath).size;
  await measure(
    'gz-open',
    async () => {
      await page.evaluate(() => {
        const input = window.__vis('.app')?.querySelector('input[type=file]');
        if (input) input.value = '';
      });
      await page.locator('.app:visible input[type=file]').setInputFiles(gzPath);
    },
    () => /JSON Lines · [\d,]+ records/.test(window.__vis('.hg-sb')?.textContent ?? ''),
    gzSize,
  );
  results.gzSize = gzSize;
  if (process.env.HUGE_STREAM_JSON) writeFileSync(process.env.HUGE_STREAM_JSON, JSON.stringify(results, null, 2));
  if (!process.env.HUGE_KEEP) {
    rmSync(gzPath, { force: true });
    rmSync(path, { force: true });
  }
});
