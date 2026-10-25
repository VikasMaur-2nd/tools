// How fast the tool opens documents, answers typing and switches views. One sample per round; the
// runner interleaves rounds across builds (`pnpm perf --base origin/main`).
import { defaults, test } from '../../lib/api.mjs';
import { cpuDuring, heapAfterGC, OPEN_PHASES, phases, recordEvents, stalls, takeEvents } from '../../lib/perf.mjs';
import { median, quantile } from '../../lib/stats.mjs';

defaults({ tags: ['perf'], engines: ['chromium', 'firefox'], timeout: 180_000 });

// Phases from choosing the file: text shown, "Valid JSON", sizes measured, Format output drawn.
for (const doc of ['bench-1mb', 'mix-3mb', 'bench-10mb', 'bench-50mb']) {
  const big = doc === 'bench-50mb';
  test(`open ${doc}`, { ...(big ? { tags: ['slow'], slots: 'all', engines: ['chromium'] } : {}) }, async (t) => {
    await t.open('/');
    const { result: ph, cpu, maxGap, stalls: blocked } = await stallsAndCpu(t, () => phases(t.page, OPEN_PHASES, () => t.app.openFile(t.page, doc)));
    for (const [k, v] of Object.entries(ph)) t.check(v != null, `${k} reached`) && t.metric(`${k} ms`, v);
    t.metric('main-thread CPU ms', cpu);
    t.metric('longest stall ms', maxGap);
    t.metric('blocking ms', blocked);
  });
}

async function stallsAndCpu(t, fn) {
  const { result: inner, maxGap, stalls: blocked } = await stalls(t.page, () => cpuDuring(t, fn));
  return { result: inner.result, cpu: inner.cpu, maxGap, stalls: blocked };
}

// keydown → next paint (Event Timing) for 40 keys typed 120 ms apart, after the document is ready.
for (const doc of ['bench-100kb-pretty', 'line-20k', 'bench-10mb']) {
  test(`typing in ${doc}`, async (t) => {
    await recordEvents(t.context);
    await t.open('/');
    await t.app.openFile(t.page, doc);
    await t.app.waitStatus(t.page, /^Valid JSON(?!.*…)/, { timeout: 120_000 });
    await t.page.click('.app:visible .ed', { position: { x: 300, y: 200 } });
    await takeEvents(t.page);
    for (let i = 0; i < 40; i++) {
      await t.page.keyboard.press(i % 5 === 4 ? 'Backspace' : 'a');
      await t.page.waitForTimeout(120);
    }
    await t.page.waitForTimeout(500); // the last keys' entries arrive after their paint
    const keys = (await takeEvents(t.page, 'keydown')).map((e) => e.d);
    t.check(keys.length >= 20, 'Event Timing reported the keys', keys.length);
    t.metric('key median ms', median(keys));
    t.metric('key p95 ms', quantile(keys, 0.95));
  });
}

// From the tab click until the view shows its content, on a 10 MB document.
test('switch views on bench-10mb', { engines: ['chromium'] }, async (t) => {
  await t.open('/');
  await t.app.openFile(t.page, 'bench-10mb');
  await t.app.waitStatus(t.page, /^Valid JSON(?!.*…)/, { timeout: 120_000 });
  const ready = {
    tree: () => (window.__vis('#view-tree')?.querySelectorAll('[role=treeitem]').length ?? 0) > 3,
    table: () => (window.__vis('#view-table')?.textContent.length ?? 0) > 100,
    graph: () => (window.__vis('#view-graph')?.childElementCount ?? 0) > 0,
    format: () => (window.__vis('#view-format .cv-rows')?.textContent.length ?? 0) > 20,
  };
  for (const [v, done] of Object.entries(ready)) {
    const { result: ph, maxGap } = await stalls(t.page, () => phases(t.page, { shown: done }, () => t.page.locator(`.app:visible [role=tab][aria-controls="view-${v}"]`).click()));
    if (t.check(ph.shown != null, `${v} view shows`)) t.metric(`${v} ms`, ph.shown);
    t.metric(`${v} longest stall ms`, maxGap);
  }
});

// JS heap after opening a 10 MB document, and after five cut/paste cycles (a leak shows as growth).
test('memory with bench-10mb', { engines: ['chromium'] }, async (t) => {
  await t.open('/');
  const empty = await heapAfterGC(t);
  await t.app.openFile(t.page, 'bench-10mb');
  await t.app.waitStatus(t.page, /^Valid JSON(?!.*…)/, { timeout: 120_000 });
  const open = await heapAfterGC(t);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await t.page.click('.app:visible .ed', { position: { x: 300, y: 200 } });
  for (let i = 0; i < 5; i++) {
    // Real shortcuts: the browser's own clipboard carries the 10 MB (navigator.clipboard is stubbed).
    await t.page.keyboard.press(`${mod}+a`);
    await t.page.keyboard.press(`${mod}+x`);
    await t.page.keyboard.press(`${mod}+v`);
    await t.app.waitStatus(t.page, /^Valid JSON(?!.*…)/, { timeout: 120_000 });
  }
  const cycled = await heapAfterGC(t);
  t.metric('heap empty MB', empty, 'MB');
  t.metric('heap open MB', open, 'MB');
  t.metric('heap after 5 cut/paste MB', cycled, 'MB');
});
