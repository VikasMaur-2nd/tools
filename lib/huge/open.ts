/*
 * Huge mode's entry, loaded only when a file is too big for the editor (Engine.loadFile, see ./min.ts):
 * checks the file is JSON text, makes its source and opens a session on it.
 */
import { looksBinary, binaryFile } from '../engine/asks';
import { MAX_DOCUMENT } from '../link';
import type { InputSource } from '../analytics/events';
import { reportError } from '../analytics';
import { createElement, type ReactNode } from 'react';
import { kit } from './kit';
import { HUGE_MIN } from './min';
import { CoreSource } from './core-source';
import { SmallSource, type SmallOptions } from './small-source';
import { HugeSession, type HugeHook, type HugeHost } from './session';

/** Formats the normal path converts to JSON: not in huge mode yet (a streamed conversion comes later). */
const CONVERTED = /\.(csv|tsv|ya?ml|xml|toml)$/i;

type Kit = typeof kit;

/** Files opened: each one's viewer is a new one (its React key). */
let opened = 0;

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

/**
 * Opens `file` in huge mode. `signal`: aborted when another document replaces it (before it opens, or while
 * it is open: the session closes). `asText`: opened whatever it looks like ("Open as text" on a file that
 * looks binary). `Scroll`: the first load's TallScroll (see kit.ts).
 */
export async function openHuge(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, asText: boolean, Scroll: Kit['Scroll']): Promise<HugeHook | null> {
  try {
    kit.Scroll = Scroll;
    let forced = false;
    try {
      // (Opened by the debug override, not by its size: said so in the huge_opened event.)
      forced = !!localStorage.getItem('tk:hugeMin') && file.size <= HUGE_MIN;
    } catch {
      /* storage refused */
    }
    return await open(host, file, source, signal, forced, asText);
  } catch (e) {
    reportError(e, 'huge');
    if (!signal.aborted) host.toast(`Couldn't read ${file.name}`, 'err');
    return null;
  }
}

/**
 * The open session's hook for the engine (null: nothing opened). The worker starts first (its modules and
 * Wasm load meanwhile), the 64 KB binary check and the viewer's code load alongside it.
 */
async function open(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, forced: boolean, asText: boolean): Promise<HugeHook | null> {
  if (signal.aborted) return null;
  if (!asText && CONVERTED.test(file.name)) {
    host.toast(`Converting ${file.name} to JSON isn't available for files this large yet`, 'err');
    return null;
  }
  for (const m of ['open', 'worker', 'root', 'rows', 'lines']) performance.clearMarks('tk:huge:' + m);
  performance.mark('tk:huge:open');
  const sim = simOf(file);
  const src = sim ? null : new CoreSource(file, file.name);
  const ui = import('@/components/huge/HugeTool');
  // (Its first 64 KB tell whether it is text at all.)
  const head = asText ? '' : await file.slice(0, 65_536).text();
  if (signal.aborted || looksBinary(head)) {
    src?.destroy();
    if (!signal.aborted) host.toast(...binaryFile(file.name, () => void host.loadFile(file, source, true)));
    return null;
  }
  const [source_, { default: HugeTool }] = await Promise.all([src ?? new SmallSource(await file.text(), file.name, sim!), ui]);
  if (signal.aborted) {
    source_.destroy();
    return null;
  }
  const key = String(++opened);
  const session: HugeSession = new HugeSession(host, source_, { name: file.name, source, forced }, (portal): ReactNode => createElement(HugeTool, { key, portal }));
  signal.addEventListener('abort', () => session.close(), { once: true });
  // (Shown at once; its root comes as the index reads it.)
  void session.start();
  return session.hook;
}
