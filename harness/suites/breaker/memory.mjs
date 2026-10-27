// Memory and time for big documents, per engine: 50, 100 and 200 MB of five shapes (one-line records,
// pretty records, deep records, string-heavy, number-heavy). Each run opens the file through Open file
// and records, as perf metrics:
//   valid / formatted / settled   ms from choosing the file to "Valid JSON", to the Format view's output,
//                                 to a settled status bar (in-page, stamped every frame)
//   open-cpu                      CPU ms the browser spent opening it (robust on a busy host)
//   max-stall                     the longest gap between animation frames while it opened (main-thread stall)
//   peak-pss / peak-rss           the whole browser's peak memory while it opened (PSS sum is the real
//                                 footprint; RSS counts shared pages per process), MiB
//   open-pss                      what it holds once settled
//   tree-ms / table-ms / graph-ms time to show each view after the switch; *-pss after it, *-peak during it
//   find-hit-* / find-miss-*      Find in the tree: "e" (many matches), then a query matching nothing
// Run it alone, under the shared heavy-document lock, e.g.:
//   flock ~/.cache/mem-work/heavy.lock pnpm perf breaker/memory -e chromium --rounds 1
//   flock ~/.cache/mem-work/heavy.lock pnpm perf "breaker/memory › records 100mb" --base origin/main --rounds 3
// or with BREAKER_HEAVY_LOCK=~/.cache/mem-work/heavy.lock, each run takes the lock itself (others' runs go
// between). BREAKER_MEM_VIEWS=tree,table picks the views switched to (default tree,table,graph; empty for
// none), BREAKER_MEM_FIND=0 skips Find. A run stops (and fails) when the host's available memory falls
// under 1.5 GiB.
import { defaults, test } from '../../lib/api.mjs';
import { view } from '../../lib/app.mjs';
import { OPEN_PHASES, cpuDuring, phases } from '../../lib/perf.mjs';
import { bigFixture, fixtureSize } from './_gen.mjs';
import { MiB, memorySampler } from './_mem.mjs';
import { heavyLock } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['perf', 'slow', 'breaker'], slots: 'all', rounds: 1, timeout: process.env.BREAKER_HEAVY_LOCK ? 3_600_000 : 900_000, allowErrors: true });

const VIEWS = (process.env.BREAKER_MEM_VIEWS ?? 'tree,table,graph').split(',').filter(Boolean);
const FIND = process.env.BREAKER_MEM_FIND !== '0';

const SHAPES = ['records', 'pretty', 'deep', 'strings', 'numbers'];
// BREAKER_MEM_SIZES=5,20 for other sizes (MB), e.g. a quick try of the check itself.
const SIZES = (process.env.BREAKER_MEM_SIZES || '50,100,200').split(',').map(Number);

const SETTLED = () => {
  const st = window.__vis('.sb-l');
  return !!st?.querySelector('.st') && !st.querySelector('.spin') && !/^Ready/.test(st.textContent) && !window.__vis('.sizes.stale, .sizes .sz[aria-hidden="true"]') && performance.getEntriesByName('tk:input').length > 0;
};

/** Starts recording the longest gap between animation frames (window.__gap.max). */
const watchFrames = (page) =>
  page.evaluate(() => {
    cancelAnimationFrame(window.__gapF);
    window.__gap = { last: performance.now(), max: 0 };
    const f = () => {
      const now = performance.now();
      window.__gap.max = Math.max(window.__gap.max, now - window.__gap.last);
      window.__gap.last = now;
      window.__gapF = requestAnimationFrame(f);
    };
    window.__gapF = requestAnimationFrame(f);
  });
const frameGap = (page) => page.evaluate(() => Math.max(window.__gap.max, performance.now() - window.__gap.last));

/** Whether view `v` shows the document. */
const SHOWN = {
  tree: () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 0,
  table: () => (window.__vis('#view-table .tb-rows')?.childElementCount ?? 0) > 0 || window.__vis('#view-table .tb-empty')?.hidden === false,
  graph: () => !!window.__vis('#view-graph canvas') && !/Building|Laying out/.test(window.__vis('#view-graph')?.innerText ?? ''),
};

for (const size of SIZES) {
  for (const shape of SHAPES) {
    test(`${shape} ${size}mb`, async (t) => {
      const { page } = t;
      const name = `big-${shape}-${size}mb`;
      const file = bigFixture(name); // generated (streamed) before anything is timed
      await heavyLock(t);
      await t.open('/');
      await watchFrames(page);
      let crashed = false;
      page.on('crash', () => (crashed = true));
      const mem = memorySampler({ onLow: () => void t.context.close().catch(() => {}) });
      const before = mem.now();
      t.log(`${name}: ${fixtureSize(name)} bytes; browser before: ${MiB(before.pss)} MiB PSS in ${before.n} processes`);
      let ph = null;
      let cpu = NaN;
      try {
        ({ result: ph, cpu } = await cpuDuring(t, async () => {
          const run = phases(page, { ...OPEN_PHASES, settled: SETTLED }, () => page.locator('.app:visible input[type=file]').setInputFiles(file), { timeout: 600_000 });
          // Done once the status settles, valid or not: phases not reached by then are -1.
          await page.waitForFunction(() => window.__ph?.settled != null, null, { timeout: 600_000, polling: 250 });
          await page.evaluate(() => { for (const k in window.__ph) window.__ph[k] ??= -1; });
          return run;
        }));
      } catch (e) {
        t.log('open failed:', String(e).slice(0, 200));
      }
      const open = mem.stop();
      t.assert(!mem.low, 'the host kept 1.5 GiB available (the run was stopped)', `peak ${MiB(open.peak.pss)} MiB PSS`);
      t.assert(!crashed && ph, 'the tab survived opening it', { crashed, peakPss: MiB(open.peak.pss) });
      const status = await page.evaluate(() => window.__vis('.sb-l .st')?.textContent ?? '');
      t.check(status === 'Valid JSON', 'it is valid JSON', status);
      for (const [k, v] of Object.entries(ph)) if (v >= 0) t.metric(k, Math.round(v));
      t.metric('open-cpu', Math.round(cpu));
      t.metric('max-stall', Math.round(await frameGap(page)));
      t.metric('peak-pss', MiB(open.peak.pss), 'MiB');
      t.metric('peak-rss', MiB(open.peak.rss), 'MiB');
      t.metric('open-pss', MiB(open.last.pss), 'MiB');
      for (const v of VIEWS) {
        const m = memorySampler({ onLow: () => void t.context.close().catch(() => {}) });
        await watchFrames(page);
        const t0 = Date.now();
        let ok = true;
        try {
          await view(page, v, { timeout: 300_000 });
          await page.waitForFunction(SHOWN[v], null, { timeout: 300_000, polling: 100 });
        } catch (e) {
          ok = false;
          t.log(`${v}: ${String(e).slice(0, 160)}`);
        }
        const ms = Date.now() - t0;
        const r = m.stop();
        t.assert(!m.low && !crashed, `the host kept 1.5 GiB available and the tab survived the ${v} view`, `peak ${MiB(r.peak.pss)} MiB PSS`);
        t.check(ok, `the ${v} view shows it`);
        t.metric(`${v}-ms`, ms);
        t.metric(`${v}-stall`, Math.round(await frameGap(page)));
        t.metric(`${v}-peak`, MiB(r.peak.pss), 'MiB');
        t.metric(`${v}-pss`, MiB(r.last.pss), 'MiB');
      }
      // Find in the tree: a query with many matches, then one matching nothing (a whole-document search).
      // Enter runs a query at once; the count keeps the previous total until the new search is done.
      if (FIND) await view(page, 'tree');
      if (FIND) await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+f`);
      const box = page.locator('.findbar:visible input');
      for (const [metric, q, done] of FIND ? [['find-hit', 'e', /\d of /], ['find-miss', 'no-such-needle-7f3a', /No results/]] : []) {
        await watchFrames(page);
        await box.fill(q);
        const f0 = Date.now();
        await box.press('Enter');
        const ok = await page
          .waitForFunction((src) => new RegExp(src).test(window.__vis('.findbar .count')?.textContent ?? ''), done.source, { timeout: 300_000, polling: 100 })
          .then(() => true, () => false);
        t.check(ok, `${metric}: find answers`);
        t.metric(`${metric}-ms`, Date.now() - f0);
        t.metric(`${metric}-stall`, Math.round(await frameGap(page)));
      }
      t.check(!t.errors.length, 'no page errors', t.errors.slice(0, 3));
    });
  }
}
