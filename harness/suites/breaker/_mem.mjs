// Memory of the whole browser: every process this harness started from its browser folder (the browser,
// its renderers, GPU and network processes, Firefox's content processes, WebKit's web processes). RSS
// counts shared pages once per process; PSS splits them, so its sum is the browser's real footprint.
// Linux only (/proc); elsewhere the sampler reports nothing.
import { readdirSync, readFileSync } from 'node:fs';
import { DIRS } from '../../lib/env.mjs';

const PAGE = 4096;

/** PIDs of the browser processes under this harness process. */
function browserPids() {
  const info = new Map();
  let names;
  try {
    names = readdirSync('/proc');
  } catch {
    return [];
  }
  for (const d of names) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      info.set(+d, +stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {}
  }
  const pids = [];
  for (const pid of info.keys()) {
    let mine = false;
    for (let p = pid, i = 0; p > 1 && i < 50; p = info.get(p), i++) if (p === process.pid) mine = pid !== process.pid;
    if (!mine) continue;
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(DIRS.browsers)) pids.push(pid);
    } catch {}
  }
  return pids;
}

/** { rss, pss } in bytes, summed over the browser's processes, and the process count. */
export function browserMemory() {
  let rss = 0;
  let pss = 0;
  const pids = browserPids();
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      rss += +stat.slice(stat.lastIndexOf(')') + 2).split(' ')[21] * PAGE;
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      if (m) pss += +m[1] * 1024;
    } catch {}
  }
  return { rss, pss, n: pids.length };
}

/** MemAvailable of the host, in bytes (Infinity where /proc/meminfo is missing). */
export function hostAvailable() {
  try {
    return +/MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))[1] * 1024;
  } catch {
    return Infinity;
  }
}

/**
 * Samples the browser's memory every `ms` until stopped: { peak: { rss, pss }, last }. `onLow` runs once
 * when the host's available memory falls under `minAvailable` (a run must not push the host into swap).
 */
export function memorySampler({ ms = 200, minAvailable = 1.5 * 2 ** 30, onLow } = {}) {
  let peak = { rss: 0, pss: 0 };
  let last = browserMemory();
  let low = false;
  const tick = () => {
    last = browserMemory();
    if (last.rss > peak.rss) peak.rss = last.rss;
    if (last.pss > peak.pss) peak.pss = last.pss;
    if (!low && hostAvailable() < minAvailable) {
      low = true;
      onLow?.();
    }
  };
  tick();
  const timer = setInterval(tick, ms);
  return {
    get low() {
      return low;
    },
    /** Starts a new peak from now. */
    reset() {
      tick();
      peak = { rss: last.rss, pss: last.pss };
    },
    stop() {
      clearInterval(timer);
      tick();
      return { peak: { ...peak }, last };
    },
    now: () => browserMemory(),
  };
}

export const MiB = (b) => Math.round(b / 2 ** 20);

/** What kind of browser process `cmdline` is: renderer (page and its workers), gpu, or browser (the rest). */
function kindOf(cmd) {
  if (/--type=renderer|-contentproc.*\btab\b|WebKitWebProcess/.test(cmd)) return 'renderer';
  if (/--type=gpu-process|-contentproc.*\bgpu\b|WebKitGPUProcess/.test(cmd)) return 'gpu';
  return 'browser';
}

/**
 * PSS in bytes by kind of process (see kindOf): { total, renderer, gpu, browser, rendererMax } (rendererMax: the
 * biggest renderer alone, the page's own where others are idle).
 */
export function browserMemoryByKind() {
  const out = { total: 0, renderer: 0, gpu: 0, browser: 0, rendererMax: 0 };
  for (const pid of browserPids()) {
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      if (!m) continue;
      const pss = +m[1] * 1024;
      const kind = kindOf(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '));
      out[kind] += pss;
      out.total += pss;
      if (kind === 'renderer' && pss > out.rendererMax) out.rendererMax = pss;
    } catch {}
  }
  return out;
}
