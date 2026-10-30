// The page stays responsive after a 2 MB file opens, until its compressed sizes are measured. On main,
// Firefox measures brotli on the main thread and freezes for 2-4 s (BREAKER-REPORT F1).
import { readFileSync } from 'node:fs';
import { defaults, test } from '../../lib/api.mjs';
import { bigFixture } from './_gen.mjs';
import { load, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], slots: 2, timeout: 180_000 });

test('a 2 MB file: no frame gap over 1 s from opening it until its sizes are measured', async (t) => {
  const { page } = t;
  await t.open('/');
  const text = readFileSync(bigFixture('big-records-2mb'), 'utf8');
  await page.evaluate(() => {
    window.__gap = { last: performance.now(), max: 0 };
    const f = () => { const n = performance.now(); window.__gap.max = Math.max(window.__gap.max, n - window.__gap.last); window.__gap.last = n; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  t.assert(await load(page, text, 'records-2mb.json', { timeout: 120_000 }), 'the document loads');
  // Every size the browser can measure (gzip everywhere, brotli in Firefox) is shown, or 20 s pass.
  await until(page, () => (window.__vis('.statusbar .sizes')?.querySelectorAll('.sz').length ?? 0) >= (typeof CompressionStream === 'undefined' ? 2 : 3) && !window.__vis('.sizes.stale') || null, null, { timeout: 20_000 });
  const gap = await page.evaluate(() => Math.round(Math.max(window.__gap.max, performance.now() - window.__gap.last)));
  t.log('longest frame gap', gap, 'ms');
  const known = t.engine === 'firefox' ? { known: 'bug (main; fixed on t3/optimize-json-memory-performance): Firefox measures brotli on the main thread (BREAKER-REPORT F1)' } : {};
  t.check(gap < t.budget(1000), 'no frame gap over 1 s', `${gap} ms`, known);
});
