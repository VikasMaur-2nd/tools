// A 5 MB file pasted into the editor again and again (Ctrl+V held down: each paste lands at the caret, after the
// last one, so the document grows to `[…][…][…]`, "multiple top-level values"). A user's tab crashed at about
// 150 MB (PR #31's preview). Each check pastes 30 times, 0.7 s apart, with a real paste event at the caret (as
// the harness paste() helper does, without moving the selection), waits for the status to settle, and prints one
// line `PASTES {…}` with what it measured (passing or not):
//   peak / final PSS of the whole browser, and by kind of process (renderer: the page and its workers; gpu;
//   browser: the rest), per paste and overall; in Chromium the JS heaps of the page and its workers (used, with
//   array buffers); whether the tab crashed; the final status; the longest frame gap; the time to settle.
// Two files: ASCII-only (one-byte strings in V8) and big-records-5mb (emoji: two-byte strings). Settings:
// BREAKER_PASTES (30), BREAKER_PASTE_GAP (700 ms). Slow: run it alone, e.g.
//   BREAKER_HEAVY_LOCK=~/.cache/mem-work/heavy.lock pnpm e2e breaker/pastes -e chromium -j 1 --slow
// A run stops pasting when the host has under 0.4 GiB available (a crash of the tab costs nothing; one of the
// host doesn't).
import { readFileSync } from 'node:fs';
import { defaults, test } from '../../lib/api.mjs';
import { bigFixture } from './_gen.mjs';
import { MiB, browserMemoryByKind, hostAvailable } from './_mem.mjs';
import { heavyLock } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['slow', 'breaker', 'pastes'], slots: 'all', width: 1400, height: 900, timeout: 1_800_000, allowErrors: true });

const PASTES = Number(process.env.BREAKER_PASTES || 30);
const GAP = Number(process.env.BREAKER_PASTE_GAP || 700);
const SETTLE_MAX = 180_000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** About 5,000,000 characters of ASCII-only JSON records, one line. */
function asciiDoc(size = 5_000_000) {
  const parts = [];
  let n = 2;
  for (let i = 0; n < size; i++) {
    const r = `{"id":${i},"uuid":"${((i * 2654435761) >>> 0).toString(16)}-${i}","name":"Customer ${i}","active":${i % 2 === 0},"score":${(i * 37) % 1000}.${i % 7},"tags":["alpha","beta-${i % 13}"],"address":{"city":"City ${i % 97}","zip":"${10000 + (i % 89999)}"}}`;
    parts.push(r);
    n += r.length + 1;
  }
  return `[${parts.join(',')}]`;
}

/** Resolves to `p`, or to `fallback` after `ms` (a page busy for long, or gone). */
const within = (p, ms, fallback = null) => Promise.race([p.catch(() => fallback), pause(ms).then(() => fallback)]);

/**
 * Chromium: the JS heaps of the page (its URL under `base`) and of every worker, sampled every 0.5 s over CDP
 * (Runtime.getHeapUsage: used size plus array buffers' backing store). { peaks, stop() }.
 */
async function heapWatch(page, base) {
  const cdp = await page.context().browser().newBrowserCDPSession();
  const sessions = new Map();
  const waiting = new Map();
  let id = 1000;
  cdp.on('Target.receivedMessageFromTarget', (ev) => {
    try {
      const m = JSON.parse(ev.message);
      const done = waiting.get(m.id);
      if (done) {
        waiting.delete(m.id);
        done(m.result ?? null);
      }
    } catch {}
  });
  const ask = (sessionId, method) =>
    new Promise((res) => {
      const i = ++id;
      waiting.set(i, res);
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: i, method }) }).catch(() => res(null));
      setTimeout(() => waiting.delete(i) && res(null), 4000);
    });
  const peaks = { page: 0, worker: 0, workers: 0 };
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        const { targetInfos } = await cdp.send('Target.getTargets');
        for (const ti of targetInfos) {
          if (sessions.has(ti.targetId) || !((ti.type === 'page' && ti.url.startsWith(base)) || ti.type === 'worker')) continue;
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: ti.targetId, flatten: false });
          sessions.set(ti.targetId, { sessionId, type: ti.type });
        }
        let workers = 0;
        for (const [tid, s] of sessions) {
          if (!targetInfos.some((x) => x.targetId === tid)) {
            sessions.delete(tid);
            continue;
          }
          const r = await ask(s.sessionId, 'Runtime.getHeapUsage');
          if (!r) continue;
          const used = r.usedSize + (r.backingStorageSize ?? 0);
          if (s.type === 'page') peaks.page = Math.max(peaks.page, used);
          else {
            peaks.worker = Math.max(peaks.worker, used);
            workers += used;
          }
        }
        peaks.workers = Math.max(peaks.workers, workers);
      } catch {}
      await pause(500);
    }
  })();
  return {
    peaks,
    async stop() {
      stopped = true;
      await within(loop, 6000);
      await cdp.detach().catch(() => {});
    },
  };
}

const STATUS = () => window.__vis('.sb-l')?.textContent ?? '';
const BUSY = () => {
  const st = window.__vis('.sb-l');
  return !st || !!st.querySelector('.spin') || /^(Ready|Parsing)/.test(st.textContent) || /…/.test(st.textContent) || !!window.__vis('.sizes.stale');
};

async function pastes(t, name, chunk) {
  const { page } = t;
  await heavyLock(t);
  await t.open('/');
  let crashed = false;
  page.on('crash', () => (crashed = true));
  // The longest gap between frames, and every gap over 0.5 s (when, how long).
  await page.evaluate(() => {
    window.__g = { last: performance.now(), max: 0, long: [] };
    const f = () => {
      const now = performance.now();
      const d = now - window.__g.last;
      if (d > window.__g.max) window.__g.max = d;
      if (d > 500) window.__g.long.push([Math.round(window.__g.last / 100) / 10, Math.round(d)]);
      window.__g.last = now;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.evaluate((c) => (window.__chunk = c), chunk);
  // Memory every 250 ms: the peak since the last paste, and overall.
  const zero = () => ({ total: 0, renderer: 0, gpu: 0, browser: 0, rendererMax: 0 });
  let span = zero();
  const peak = zero();
  let low = false;
  const tick = () => {
    const m = browserMemoryByKind();
    for (const k of Object.keys(peak)) {
      if (m[k] > span[k]) span[k] = m[k];
      if (m[k] > peak[k]) peak[k] = m[k];
    }
    if (hostAvailable() < 0.4 * 2 ** 30) low = true;
    return m;
  };
  const before = tick();
  const timer = setInterval(tick, 250);
  const heaps = t.engine === 'chromium' ? await heapWatch(page, t.base).catch(() => null) : null;
  const t0 = Date.now();
  const rows = [];
  let pasted = 0;
  for (let k = 1; k <= PASTES && !crashed && !low; k++) {
    const at = Date.now();
    // Ctrl+V where the caret is (after the last paste): a real paste event; the browser's own insertion if the
    // editor leaves it uncancelled, as the harness paste() helper does.
    const ok = await page
      .evaluate(() => {
        const ta = window.__vis('#input');
        if (document.activeElement !== ta) ta.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', window.__chunk);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
        if (ta.dispatchEvent(ev)) {
          ta.setRangeText(window.__chunk, ta.selectionStart, ta.selectionEnd, 'end');
          ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: window.__chunk, bubbles: true }));
        }
        return true;
      })
      .catch(() => false);
    if (!ok) break;
    pasted = k;
    const took = Date.now() - at;
    await pause(Math.max(0, GAP - took));
    const now = tick();
    rows.push([k, Math.round((Date.now() - t0) / 100) / 10, took, MiB(span.total), MiB(span.renderer), MiB(now.total)]);
    span = zero();
  }
  const pastedMs = Date.now() - t0;
  // Until the status settles (unchanged for 3 s, nothing working), at most SETTLE_MAX.
  let settledMs = null;
  let status = '';
  if (!crashed && !low) {
    let same = 0;
    for (const end = Date.now() + SETTLE_MAX; Date.now() < end && !crashed && !low; ) {
      await pause(1000);
      const s = await within(page.evaluate(STATUS), 20_000);
      const busy = await within(page.evaluate(BUSY), 20_000, true);
      if (s === null) continue;
      same = s === status && !busy ? same + 1 : 0;
      status = s;
      if (same >= 3) {
        settledMs = Date.now() - t0 - pastedMs - 3000;
        break;
      }
    }
  }
  // Where the caret is, to tell the document's length (one-line files: the column).
  const caret = crashed ? null : await within(page.evaluate(() => window.__vis('.sb-r')?.textContent?.match(/Ln ([\d,]+), Col ([\d,]+)/)?.slice(1).map((x) => Number(x.replace(/,/g, ''))) ?? null), 20_000);
  const gaps = crashed ? null : await within(page.evaluate(() => ({ max: Math.round(window.__g.max), long: window.__g.long.slice(-40) })), 20_000);
  await pause(1500);
  const after = tick();
  clearInterval(timer);
  await heaps?.stop();
  const wantMiB = (Buffer.byteLength(chunk) * pasted) / 2 ** 20;
  const raw = Number(/([\d.,]+) MB raw/.exec(status)?.[1]?.replace(/,/g, '') ?? NaN);
  const out = {
    engine: t.engine,
    target: t.target?.name,
    file: name,
    chunkChars: chunk.length,
    pasted,
    crashed,
    hostLow: low,
    pastedS: Math.round(pastedMs / 100) / 10,
    settleS: settledMs === null ? null : Math.round(settledMs / 100) / 10,
    status: status.slice(0, 160),
    caret,
    rawMiB: raw,
    wantMiB: Math.round(wantMiB * 10) / 10,
    peakMiB: { total: MiB(peak.total), renderer: MiB(peak.renderer), rendererMax: MiB(peak.rendererMax), gpu: MiB(peak.gpu), browser: MiB(peak.browser) },
    startMiB: MiB(before.total),
    endMiB: { total: MiB(after.total), renderer: MiB(after.renderer) },
    heapsPeakMiB: heaps ? { page: MiB(heaps.peaks.page), worker: MiB(heaps.peaks.worker), workers: MiB(heaps.peaks.workers) } : null,
    maxGapMs: gaps?.max ?? null,
    longGaps: gaps?.long ?? null,
    // [paste, s since the first, ms the paste event took, peak total MiB since the last, peak renderer MiB, total MiB now]
    rows,
  };
  console.log(`PASTES ${JSON.stringify(out)}`);
  t.metric('peak-pss', MiB(peak.total), 'MiB');
  t.metric('peak-renderer', MiB(peak.renderer), 'MiB');
  if (settledMs !== null) t.metric('settle', settledMs);
  if (gaps) t.metric('max-gap', gaps.max);
  t.check(!crashed, `the tab survived ${pasted} pastes`, { pasted, peak: out.peakMiB });
  t.check(!low, 'the host kept 0.4 GiB available', out.peakMiB);
  t.check(pasted === PASTES, `all ${PASTES} pastes went in`, pasted);
  t.check(settledMs !== null, `the status settled within ${SETTLE_MAX / 1000} s`, status.slice(0, 120));
  t.check(Math.abs(raw - wantMiB) < 0.6, 'the status counts every paste (the document is whole)', { raw, want: out.wantMiB });
  t.check(!!caret && caret[0] === 1 && caret[1] === pasted * chunk.length + 1, 'the caret is after the last paste', { caret, end: pasted * chunk.length + 1 });
}

test('pastes: 5 MB of ASCII-only JSON pasted 30 times at the caret, 0.7 s apart', async (t) => {
  await pastes(t, 'ascii-5mb', asciiDoc());
});

test('pastes: big-records-5mb (emoji, two-byte text) pasted 30 times at the caret, 0.7 s apart', async (t) => {
  await pastes(t, 'big-records-5mb', readFileSync(bigFixture('big-records-5mb'), 'utf8'));
});
