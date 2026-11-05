// Huge mode's Format view editing on a big file: keystroke to paint while typing in the middle of it, and how long
// the document takes to have each change. Tagged slow (the night window: 19:30–00:30 UTC on the shared host);
// HUGE_EDIT_MB sets the size (default 1024: 1 GB; the file is the one huge-big.mjs makes for 1 GB, kept with
// HUGE_KEEP). Chromium only (the target: p95 under 16 ms there).
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { takeEvents } from '../../lib/perf.mjs';

/**
 * Event Timing for keys: each key's duration (keydown → the next frame presented, in 8 ms steps, the wait for the
 * frame included) and its handlers' time (keydown → the end of its handlers: the work a key costs on the main
 * thread). Only keys of 16 ms or more are reported (the API's floor); the others took less.
 */
const recordKeys = (context) =>
  context.addInitScript(() => {
    window.__ev = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__ev.push({ name: e.name, d: e.duration, h: e.processingEnd - e.startTime });
      }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    } catch {}
  });
import { MOD, until } from './_helpers.mjs';

defaults({ engines: ['chromium'], width: 1280, height: 860, tags: ['slow', 'huge-big'], slots: 'all', timeout: 600_000 });

const MB = Number(process.env.HUGE_EDIT_MB || 1024);
const dir = join(DIRS.tmp, 'huge-big');
mkdirSync(dir, { recursive: true });
const path = join(dir, MB === 1024 ? 'records-1gb.json' : `records-${MB}mb.json`);

/** The records huge-big.mjs writes, one a line, about MB megabytes (as made there, so 1 GB is the same file). */
async function make() {
  const want = MB * 1024 ** 2;
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

/** Keys typed as the perf suite types them (120 ms apart), measured with Event Timing (keydown → next paint). */
const KEYS = 60;
async function typeKeys(page) {
  await takeEvents(page);
  for (let i = 0; i < KEYS; i++) {
    await page.keyboard.press(i % 6 === 5 ? 'Backspace' : 'abcdefghij'[i % 10]);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  return takeEvents(page, 'keydown');
}
/** p-quantile over all KEYS keys, those not reported counting as under 16 ms (0 here). */
const pq = (xs, p) => {
  const all = [...xs, ...Array(Math.max(0, KEYS - xs.length)).fill(0)].sort((a, b) => a - b);
  return all[Math.min(all.length - 1, Math.floor(all.length * p))];
};
const report = (t, label, ev) => {
  const d = ev.map((e) => e.d);
  const h = ev.map((e) => e.h);
  t.metric(`${label}: key to paint median ms`, pq(d, 0.5));
  t.metric(`${label}: key to paint p95 ms`, pq(d, 0.95));
  t.metric(`${label}: key to paint max ms`, d.length ? Math.max(...d) : 0);
  t.metric(`${label}: key handlers p95 ms`, pq(h, 0.95));
  t.metric(`${label}: key handlers max ms`, h.length ? Math.max(...h) : 0);
  return { d50: pq(d, 0.5), d95: pq(d, 0.95), h95: pq(h, 0.95) };
};


test('huge edit, a big file: keystroke to paint while typing in the Format view', async (t) => {
  await make();
  const { page } = t;
  await recordKeys(page.context());
  await t.open('/');
  // The baseline: the normal editor, 96 KB of the same records (a huge window's size), typed the same way.
  const recs = Array.from({ length: 500 }, (_, i) => `{"id":${i},"name":"user ${i}","email":"u${i}@example.com","active":${i % 3 !== 0},"tags":["a","b"],"score":${(i * 7.31) % 1000},"note":"${'lorem ipsum '.repeat(1 + (i % 7))}"}`);
  const small = join(dir, 'records-96kb.json');
  writeFileSync(small, '{"meta": {"version": 1},\n"records": [\n' + recs.join(',\n') + '\n]}\n');
  await page.evaluate(() => localStorage.removeItem('tk:hugeMin'));
  await page.locator('.app:visible input[type=file]').setInputFiles(small);
  await until(page, () => /Valid JSON/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30_000 });
  await page.click('.app:visible .pane-ed .ed', { position: { x: 300, y: 200 } });
  // (The engine's warm-up after a page load, 4 s on, is done before measuring.)
  await page.waitForTimeout(9000);
  const base = report(t, 'normal editor 96 KB', await typeKeys(page));
  const opened = Date.now();
  await page.evaluate((small) => (small ? localStorage.setItem('tk:hugeMin', '0') : localStorage.removeItem('tk:hugeMin')), MB < 300);
  await page.locator('.app:visible input[type=file]').setInputFiles(path);
  t.assert(await until(page, () => /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 300_000 }), 'read');
  // The Format view, as written, at its middle line (Go to line), then editing there.
  await page.evaluate(() => window.__vis('.hg [role=tab][aria-controls=hg-format]')?.click());
  const lines = await page.evaluate(() => Number((window.__vis('.hg-sb')?.textContent ?? '').match(/([\d,]+) lines/)?.[1].replace(/,/g, '') ?? 0));
  const middle = Math.floor(lines / 2);
  await page.locator('#hg-format').focus();
  await page.keyboard.press(`${MOD}+g`);
  await page.locator('.hg .hg-ask input').fill(String(middle));
  await page.keyboard.press('Enter');
  await until(page, () => !!document.querySelector('#hg-format .hg-cur'), null);
  await page.locator('#hg-format').focus();
  await page.keyboard.press('F2');
  t.assert(await until(page, () => !!document.querySelector('.hg-fe .ed textarea') && /Editing lines/.test(window.__vis('.hg .vmain')?.textContent ?? ''), null, { timeout: 30_000 }), 'editing the middle of the file');
  // Inside the record's last string ("note": …"},): typing keeps the document valid.
  await page.keyboard.press('End');
  for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - opened)));
  // (HUGE_PROFILE=file: a CPU profile of the typing, for looking into what a key costs.)
  const cdp = process.env.HUGE_PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
  }
  const ev = await typeKeys(page);
  if (cdp) writeFileSync(process.env.HUGE_PROFILE, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  const got = report(t, `huge ${MB} MB`, ev);
  // A key's own work fits a frame; to the paint, no slower than the normal editor (the frame's wait is the browser's).
  t.check(got.h95 < 16, `a key's handlers: p95 under 16 ms (${MB} MB)`, got);
  t.check(got.d50 <= base.d50 + 8 && got.d95 <= base.d95 + 8, 'key to paint: as the normal editor, within one 8 ms step', { huge: got, normal: base });
  t.check(await until(page, () => /Edited · \d+ change/.test(window.__vis('.hg-edited')?.textContent ?? '') && /Valid JSON/.test(window.__vis('.hg-sb')?.textContent ?? ''), null, { timeout: 60_000 }), 'the document has it, still valid', await page.evaluate(() => window.__vis('.hg-file')?.textContent));
  if (!process.env.HUGE_KEEP && MB !== 1024) rmSync(path, { force: true });
});

