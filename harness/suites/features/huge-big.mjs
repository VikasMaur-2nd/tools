// Huge-file mode on a real big file (over the 300 MiB threshold, no override): time to the first lines and
// tree rows, indexing throughput, the browser's memory (PSS) while indexing and browsing, a seek deep into a
// big array, Find's first match near the end, and frame times while scrolling the Format view. Tagged slow
// (the night window: 19:30–00:30 UTC on the shared host); HUGE_GB sets the size (default 1). The file is
// made once, streamed, and deleted with HUGE_KEEP unset.
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { browserMemory } from '../breaker/_mem.mjs';
import { MOD, until } from './_helpers.mjs';

defaults({ engines: 'all', width: 1280, height: 860, tags: ['slow', 'huge-big'], slots: 'all', timeout: 600_000 });

const GB = Number(process.env.HUGE_GB || 1);
const dir = join(DIRS.tmp, 'huge-big');
mkdirSync(dir, { recursive: true });
const path = join(dir, `records-${GB}gb.json`);

/** `{"meta": …, "records": [` one record a line `]}` of about GB gigabytes. Returns the record count. */
async function make() {
  const want = GB * 1024 ** 3;
  if (existsSync(path) && statSync(path).size >= want) return null;
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
  return i;
}

test('huge mode, a real big file: first rows, indexing, memory, seek, find, scrolling', async (t) => {
  const made = await make();
  if (made) t.log(`made ${path}: ${made} records`);
  const size = statSync(path).size;
  const { page } = t;
  await t.open('/');
  await page.evaluate(() => {
    localStorage.removeItem('tk:hugeMin');
    localStorage.removeItem('tk:hugeSim');
  });
  const idle = browserMemory();
  const t0 = Date.now();
  await page.locator('.app:visible input[type=file]').setInputFiles(path);
  t.assert(await until(page, () => !!window.__vis('.hg'), null, { timeout: 30_000 }), 'huge mode opens with no override');
  const shown = Date.now() - t0;
  // The Format view's first lines (as written: one record a line).
  t.check(await until(page, () => { const v = window.__vis('#hg-format'); return v && v.querySelectorAll('.cv-l[data-l]').length > 20; }, null, { timeout: 30_000 }), 'first lines');
  const firstLines = Date.now() - t0;
  // The tree's first rows, while indexing goes on: the root's, then the big array's.
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-tree]')?.click());
  t.check(await until(page, () => /root/.test(window.__vis('#hg-tree .tv-r')?.textContent ?? ''), null, { timeout: 30_000 }), 'tree root');
  const firstRows = Date.now() - t0;
  t.check(await until(page, () => [...(window.__vis('#hg-tree')?.querySelectorAll('.tv-r') ?? [])].some((r) => /records/.test(r.textContent)), null, { timeout: 30_000 }), 'the root\'s items while indexing');
  const rootItems = Date.now() - t0;
  const indexingWhenOpened = await page.evaluate(() => /Indexing/.test(window.__vis('.hg-sb')?.textContent ?? ''));
  const r0 = Date.now();
  await page.locator('#hg-tree .tv-r', { hasText: 'records' }).first().click();
  t.check(await until(page, () => [...(window.__vis('#hg-tree')?.querySelectorAll('.tv-r[aria-level="3"]') ?? [])].filter((r) => !r.classList.contains('hg-ph')).length > 10, null, { timeout: 30_000 }), 'the big array\'s first rows while indexing');
  const bigArrayRows = Date.now() - r0;
  const marks = await page.evaluate(() => {
    const at = (n) => performance.getEntriesByName('tk:huge:' + n)[0]?.startTime;
    const o = at('open');
    const input = performance.getEntriesByName('tk:input').at(-1)?.startTime;
    return Object.fromEntries([['input→open', o - input], ...['worker', 'root', 'lines', 'rows'].map((n) => [`open→${n}`, at(n) - o])].map(([k, v]) => [k, Math.round(v)]));
  });
  // Memory while indexing (sampled), and when it ends.
  let peak = 0;
  let done = false;
  const sample = setInterval(() => (peak = Math.max(peak, browserMemory().pss)), 250);
  done = !!(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 300_000 }));
  clearInterval(sample);
  const indexed = Date.now() - t0;
  t.check(done, 'indexed and valid', await page.evaluate(() => window.__vis('.hg-sb')?.textContent));
  const status = await page.evaluate(() => window.__vis('.hg-sb')?.textContent);
  const afterIndex = browserMemory();
  // Seek: go to an item deep in records.
  const records = page.locator('#hg-tree .tv-r', { hasText: 'records' }).first();
  const count = Number((await records.textContent()).match(/\[([\d,]+)\]/)?.[1].replace(/,/g, '') ?? 0);
  const target = Math.floor(count * 0.83);
  await page.locator('#hg-tree').focus();
  await page.keyboard.press(`${MOD}+g`);
  await page.locator('.hg-ask input').fill(`$.records[${target}].email`);
  const s0 = Date.now();
  await page.locator('.hg-ask input').press('Enter');
  const sought = await until(page, (w) => (document.querySelector('#hg-tree #htv-sel')?.textContent ?? '').includes(w), `u${target}@`, { timeout: 30_000 });
  const seekMs = Date.now() - s0;
  t.check(!!sought, `go to $.records[${target}].email`, await page.evaluate(() => document.querySelector('#hg-tree #htv-sel')?.textContent));
  // Find: a match near the end (the search reads the whole file up to it).
  const needle = `u${count - 5}@`;
  await page.keyboard.press(`${MOD}+f`);
  const f0 = Date.now();
  await page.locator('.hg .findbar input').fill(needle);
  const found = await until(page, (w) => (document.querySelector('#hg-tree #htv-sel')?.textContent ?? '').includes(w), needle, { timeout: 120_000 });
  const findMs = Date.now() - f0;
  t.check(!!found, 'Find reaches a match near the end', await page.evaluate(() => document.querySelector('.hg .findbar .count')?.textContent));
  await page.keyboard.press('Escape');
  // Scrolling the Format view: wheel steps for two seconds, frame times measured in the page.
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click());
  await until(page, () => !!window.__vis('#hg-format .cv-l[data-l]'), null);
  const box = await page.locator('#hg-format').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 2000) window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  const end = Date.now() + 2000;
  while (Date.now() < end) await page.mouse.wheel(0, 900);
  const frames = await page.evaluate(() => (cancelAnimationFrame(window.__raf), window.__frames.slice(2)));
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const slow = frames.filter((f) => f > 20).length / Math.max(1, frames.length);
  const placeholders = await page.evaluate(() => window.__vis('#hg-format').querySelectorAll('.hg-ph').length);
  await until(page, () => !window.__vis('#hg-format').querySelector('.hg-ph'), null, { timeout: 10_000 });
  // A far jump in the Format view: Go to a line near the end, until its text is there.
  const lines = await page.evaluate(() => Number((window.__vis('.hg-sb')?.textContent ?? '').match(/([\d,]+) lines/)?.[1].replace(/,/g, '') ?? 0));
  const far = Math.floor(lines * 0.9);
  await page.locator('#hg-format').focus();
  await page.keyboard.press(`${MOD}+g`);
  await page.locator('.hg-ask input').fill(String(far));
  const j0 = Date.now();
  await page.locator('.hg-ask input').press('Enter');
  const farOk = await until(page, (n) => { const c = document.querySelector('#hg-format .hg-cur'); return !!c && c.querySelector('.cv-n')?.textContent === String(n) && !c.classList.contains('hg-ph'); }, far, { timeout: 30_000 });
  const farLineMs = Date.now() - j0;
  t.check(!!farOk, `Go to line ${far}`);
  const mb = (b) => Math.round(b / 1048576);
  const report = {
    sizeMB: mb(size), shownMs: shown, firstLinesMs: firstLines, firstTreeRowsMs: firstRows, rootItemsMs: rootItems, bigArrayRowsWhileIndexingMs: bigArrayRows, stillIndexing: indexingWhenOpened, indexedMs: indexed, farLineMs, marks,
    indexMBps: Math.round(size / 1048576 / (indexed / 1000)), seekMs, findNearEndMs: findMs,
    pssIdleMB: mb(idle.pss), pssPeakIndexingMB: mb(peak), pssAfterMB: mb(afterIndex.pss), pssNowMB: mb(browserMemory().pss),
    frames: frames.length, frameP95ms: Math.round(p95 * 10) / 10, framesOver20msPct: Math.round(slow * 1000) / 10, placeholdersAfterScroll: placeholders,
    status,
  };
  t.log(JSON.stringify(report));
  for (const [k, v] of Object.entries(report)) if (typeof v === 'number') t.metric(k, v, /Ms$|ms$/.test(k) ? 'ms' : '');
  if (!process.env.HUGE_KEEP) rmSync(path, { force: true });
});
