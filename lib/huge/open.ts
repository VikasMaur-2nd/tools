/*
 * Huge mode's entry, loaded only when a file is too big for the editor (Engine.loadFile, see ./min.ts):
 * checks the file is JSON text, makes its source and opens a session on it.
 */
import { looksBinary, binaryFile } from '../engine/asks';
import { MAX_DOCUMENT } from '../link';
import type { InputSource } from '../analytics/events';
import { reportError } from '../analytics';
import { createElement, type ReactNode } from 'react';
import HugeTool from '@/components/huge/HugeTool';
import { kit } from './kit';
import { HUGE_MIN } from './min';
import { CoreSource } from './core-source';
import { SmallSource, type SmallOptions } from './small-source';
import { HugeSession, type HugeHook, type HugeHost } from './session';
import type { HugeSource } from './source';

/** Formats the normal path converts to JSON: not in huge mode yet (a streamed conversion comes later). */
const CONVERTED = /\.(csv|tsv|ya?ml|xml|toml)$/i;

type Kit = typeof kit;

/** Files opened: each one's viewer is a new one (its React key). */
let opened = 0;

/**
 * The source for `file`: the core's index in a worker (any size). For trying the UI, `tk:hugeSim`
 * ({"speed": bytes/s, "latency": ms}) plays an index over the file parsed whole instead (small files only).
 */
async function sourceFor(file: File): Promise<HugeSource> {
  let sim: SmallOptions | null = null;
  try {
    sim = JSON.parse(localStorage.getItem('tk:hugeSim') ?? 'null') as SmallOptions | null;
  } catch {
    /* none */
  }
  if (sim && file.size <= MAX_DOCUMENT) return new SmallSource(await file.text(), file.name, { speed: Number(sim.speed) || undefined, latency: Number(sim.latency) || 0 });
  return new CoreSource(file, file.name);
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

/** The open session's hook for the engine (null: nothing opened). */
async function open(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, forced: boolean, asText: boolean): Promise<HugeHook | null> {
  if (signal.aborted) return null;
  if (!asText && CONVERTED.test(file.name)) {
    host.toast(`Converting ${file.name} to JSON isn't available for files this large yet`, 'err');
    return null;
  }
  // (Its first 64 KB tell whether it is text at all.)
  const head = asText ? '' : await file.slice(0, 65_536).text();
  if (signal.aborted) return null;
  if (looksBinary(head)) {
    host.toast(...binaryFile(file.name, () => void host.loadFile(file, source, true)));
    return null;
  }
  const src = await sourceFor(file);
  if (signal.aborted) {
    src.destroy();
    return null;
  }
  const key = String(++opened);
  const session: HugeSession = new HugeSession(host, src, { name: file.name, source, forced }, (portal): ReactNode => createElement(HugeTool, { key, portal }));
  signal.addEventListener('abort', () => session.close(), { once: true });
  // (Shown at once; its root comes as the index reads it.)
  void session.start();
  return session.hook;
}
