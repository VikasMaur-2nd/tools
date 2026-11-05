/*
 * Huge mode's entry, loaded only when a file is too big for the editor (Engine.loadFile): starts the core's
 * worker at once (its modules and Wasm load while the rest of huge mode's code does), then hands over to
 * ./open-rest.ts (the binary check, the source, the session and its viewer).
 */
import { MAX_DOCUMENT } from '../link';
import type { InputSource } from '../analytics/events';
import { reportError } from '../analytics';
import { HugeClient } from './client';
import type { HugeHook, HugeHost } from './session';
import type { SmallOptions } from './small-source';
import type { Started } from './open-rest';
import type { HugeProgress } from './types';
import type { kit } from './kit';

/** Formats the normal path converts to JSON: not in huge mode yet (a streamed conversion comes later). */
const CONVERTED = /\.(csv|tsv|ya?ml|xml|toml)$/i;

/**
 * For trying the UI: `tk:hugeSim` ({"speed": bytes/s, "latency": ms}) plays an index over a small file parsed
 * whole instead of the core's (null: the core, any size).
 */
function simOf(file: File): SmallOptions | null {
  try {
    const sim = JSON.parse(localStorage.getItem('tk:hugeSim') ?? 'null') as SmallOptions | null;
    return sim && file.size <= MAX_DOCUMENT ? { speed: Number(sim.speed) || undefined, latency: Number(sim.latency) || 0 } : null;
  } catch {
    return null;
  }
}

/** The core's worker, started now: its progress is kept until the source takes it. */
function start(file: File): Started {
  let taker: ((p: HugeProgress) => void) | null = null;
  const early: HugeProgress[] = [];
  const client = new HugeClient(file, { name: file.name }, (p) => (taker ? taker(p) : early.push(p)));
  performance.mark('tk:huge:worker');
  return {
    client,
    take(f) {
      taker = f;
      for (const p of early.splice(0)) f(p);
    },
  };
}

/**
 * Opens `file` in huge mode. `signal`: aborted when another document replaces it (before it opens, or while
 * it is open: the session closes). `asText`: opened whatever it looks like ("Open as text" on a file that
 * looks binary). `Scroll`: the first load's TallScroll (see kit.ts).
 */
export async function openHuge(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, asText: boolean, Scroll: (typeof kit)['Scroll'], closed?: () => void): Promise<HugeHook | null> {
  if (signal.aborted) return null;
  // A .gz file: decompressed first (to the editor when small, else to huge mode from the browser's storage,
  // the copy removed when its session closes: `closed`).
  if (!closed && /\.gz$/i.test(file.name)) {
    try {
      const { openGz } = await import('./gz');
      // (The decompressed file's session, if it opened in huge mode: its hook goes to the engine.)
      return await openGz(host, file, source, signal, editorLimit(), async (plain, done) => {
        const hook = await openHuge(host, plain, source, signal, false, Scroll, done);
        // (Not opened: the copy goes now.)
        if (!hook) done();
        return hook;
      });
    } catch (e) {
      reportError(e, 'huge');
      if (!signal.aborted) host.toast(`Couldn't read ${file.name}`, 'err');
    }
    return null;
  }
  if (!asText && CONVERTED.test(file.name)) {
    host.toast(`Converting ${file.name} to JSON isn't available for files this large yet`, 'err');
    return null;
  }
  for (const m of ['open', 'worker', 'rest', 'root', 'rows', 'lines']) performance.clearMarks('tk:huge:' + m);
  performance.mark('tk:huge:open');
  const sim = simOf(file);
  const started = sim ? null : start(file);
  try {
    const { openRest } = await import('./open-rest');
    // (How much sooner the worker started than it would have after all of this.)
    performance.mark('tk:huge:rest');
    return await openRest(host, file, source, signal, asText, Scroll, started, sim, closed);
  } catch {
    // (The rest of huge mode's code didn't load: offline, say.)
    started?.client.close();
    if (!signal.aborted) host.toast(`Couldn't read ${file.name}`, 'err');
    return null;
  }
}

/** The largest file the editor opens (Engine.loadFile's threshold: 300 MiB, less on a device with little memory, or tk:hugeMin). */
function editorLimit(): number {
  let forced: string | null = null;
  try {
    forced = localStorage.getItem('tk:hugeMin');
  } catch {
    /* storage refused */
  }
  return Math.min(MAX_DOCUMENT, forced ? +forced : ((navigator as { deviceMemory?: number }).deviceMemory || 8) * 2 ** 26);
}
