// Measuring inside the page and around it. On a busy machine wall-clock times swing several-fold, so
// every helper here reports what the page itself saw (frame-accurate phase stamps, the browser's Event
// Timing, heartbeat gaps) or CPU time, which other programs on the machine barely move.
import { readdirSync, readFileSync } from 'node:fs';
import { DIRS } from './env.mjs';

/**
 * Stamps when each phase is first seen, polled every frame inside the page, relative to the moment
 * `action` starts. `phases` maps a name to a page function returning true once the phase is reached.
 * Returns { name: ms } (null for a phase not reached within `timeout`).
 */
export async function phases(page, phases, action, { timeout = 120_000 } = {}) {
  const names = Object.keys(phases);
  // One script with the phase tests inlined (page.evaluate takes one function, so build the source).
  await page.evaluate(`(() => {
    const names = ${JSON.stringify(names)};
    const tests = [${names.map((n) => phases[n].toString()).join(',')}];
    window.__ph = Object.fromEntries(names.map((n) => [n, null]));
    window.__phT0 = performance.now();
    const tick = () => {
      const now = performance.now() - window.__phT0;
      let left = 0;
      names.forEach((n, i) => {
        if (window.__ph[n] == null && tests[i]()) window.__ph[n] = now;
        if (window.__ph[n] == null) left++;
      });
      if (left) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  await page.evaluate(() => (window.__phT0 = performance.now()));
  await action();
  await page.waitForFunction(() => Object.values(window.__ph).every((v) => v != null), null, { timeout, polling: 100 }).catch(() => {});
  return page.evaluate(() => window.__ph);
}

/** Phase tests for opening a document in the tool. */
export const OPEN_PHASES = {
  // the text is in the editor (native textarea or the big-document surface)
  text: () => (window.__vis('.ed-hl')?.textContent.length ?? 0) > 20 || (window.__vis('#input')?.value.length ?? 0) > 20,
  valid: () => /^(Valid JSON|JSON Lines)/.test(window.__vis('.sb-l')?.textContent ?? ''),
  sizes: () => /^(Valid JSON|JSON Lines)(?!.*…)/.test(window.__vis('.sb-l')?.textContent ?? ''),
  output: () => (window.__vis('#view-format .cv-rows')?.textContent.length ?? 0) > 20,
};

/** Records the browser's Event Timing entries (keydown → next paint, etc.) from page start. Call before open(). */
export async function recordEvents(context) {
  await context.addInitScript(() => {
    window.__ev = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__ev.push({ name: e.name, d: e.duration, delay: e.processingStart - e.startTime });
      }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    } catch {}
  });
}
export const takeEvents = (page, name) => page.evaluate((n) => window.__ev.splice(0).filter((e) => !n || e.name === n), name);

/**
 * The longest main-thread stall while `fn` runs: a 10 ms heartbeat inside the page, so it works in
 * every engine (long-task entries are Chromium only). Returns { result, maxGap, stalls } (ms; stalls =
 * total time beyond 50 ms per gap, like Total Blocking Time).
 */
export async function stalls(page, fn) {
  await page.evaluate(() => {
    window.__hb = { last: performance.now(), max: 0, sum: 0 };
    window.__hbTimer = setInterval(() => {
      const now = performance.now();
      const gap = now - window.__hb.last;
      window.__hb.last = now;
      if (gap > window.__hb.max) window.__hb.max = gap;
      if (gap > 50) window.__hb.sum += gap - 50;
    }, 10);
  });
  const result = await fn();
  const hb = await page.evaluate(() => {
    clearInterval(window.__hbTimer);
    const now = performance.now();
    const gap = now - window.__hb.last;
    return { max: Math.max(window.__hb.max, gap), sum: window.__hb.sum + Math.max(0, gap - 50) };
  });
  return { result, maxGap: hb.max, stalls: hb.sum };
}

/**
 * Main-thread CPU time of the page while `fn` runs, in ms. Chromium: the renderer's TaskDuration
 * (DevTools Performance domain). Firefox/WebKit: CPU time of every browser process this harness
 * started (Linux /proc), so measure with nothing else running (perf mode runs one test at a time).
 */
export async function cpuDuring(t, fn) {
  if (t.engine === 'chromium') {
    const cdp = await t.page.context().newCDPSession(t.page);
    await cdp.send('Performance.enable');
    const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value * 1000;
    const before = await task();
    const result = await fn();
    const cpu = (await task()) - before;
    await cdp.detach().catch(() => {});
    return { result, cpu };
  }
  const before = browserCpu();
  const result = await fn();
  return { result, cpu: browserCpu() - before };
}

const TICK_MS = 10; // USER_HZ is 100 on Linux
/** CPU ms used so far by browser processes under this harness (descendants whose binary is in the harness's browser folder). */
export function browserCpu() {
  let procs;
  try {
    procs = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return NaN;
  }
  const info = new Map();
  for (const pid of procs) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      info.set(Number(pid), { ppid: Number(f[1]), cpu: (Number(f[11]) + Number(f[12])) * TICK_MS, pid: Number(pid) });
    } catch {}
  }
  const mine = (pid) => {
    for (let p = pid, i = 0; p > 1 && i < 50; p = info.get(p)?.ppid, i++) if (p === process.pid) return true;
    return false;
  };
  let sum = 0;
  for (const p of info.values()) {
    if (!mine(p.pid)) continue;
    try {
      if (readFileSync(`/proc/${p.pid}/cmdline`, 'utf8').includes(DIRS.browsers)) sum += p.cpu;
    } catch {}
  }
  return sum;
}

/** JS heap in use after a full garbage collection (Chromium only; null elsewhere), in MB. */
export async function heapAfterGC(t) {
  if (t.engine !== 'chromium') return null;
  const cdp = await t.page.context().newCDPSession(t.page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach().catch(() => {});
  return usedSize / 1e6;
}

/**
 * First-load JavaScript of a page, the way Next.js counts it: every script the server-rendered HTML
 * references, fetched and compressed like a CDN serves them. Exact bytes, no browser, no noise.
 * `fetcher` is t.fetch (it adds the target's extra headers). Returns { gzip, brotli, raw, files };
 * brotli (quality 11, slow) only unless { brotli: false }.
 */
export async function firstLoadJs(fetcher, base, path, { brotli: withBrotli = true } = {}) {
  const { gzipSync, brotliCompressSync, constants } = await import('node:zlib');
  const html = await (await fetcher(base + path)).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), base + path).href))];
  const bodies = await Promise.all(srcs.map(async (u) => Buffer.from(await (await fetcher(u)).arrayBuffer())));
  let gzip = 0;
  let brotli = 0;
  let raw = 0;
  for (const b of bodies) {
    raw += b.length;
    gzip += gzipSync(b, { level: 9 }).length;
    if (withBrotli) brotli += brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  }
  return { gzip, brotli, raw, files: srcs.length };
}
