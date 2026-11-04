/*
 * Huge mode's entry, loaded only when a file is too big for the editor (Engine.loadFile, see ./min.ts):
 * checks the file is JSON text, makes its source and opens a session on it.
 */
import { looksBinary, binaryFile } from '../engine/asks';
import { MAX_DOCUMENT } from '../link';
import type { InputSource } from '../analytics/events';
import { CoreSource } from './core-source';
import { SmallSource, type SmallOptions } from './small-source';
import { HugeSession, type HugeHost } from './session';
import type { HugeSource } from './source';

/** Formats the normal path converts to JSON: not in huge mode yet (a streamed conversion comes later). */
const CONVERTED = /\.(csv|tsv|ya?ml|xml|toml)$/i;

/**
 * The source for `file`: the core's index in a worker (any size). For trying the UI, `tk:hugeSim`
 * ({"speed": bytes/s, "latency": ms}) plays an index over the file parsed whole instead (small files only).
 */
async function sourceFor(file: File): Promise<HugeSource | null> {
  let sim: SmallOptions | null = null;
  try {
    sim = JSON.parse(localStorage.getItem('tk:hugeSim') ?? 'null') as SmallOptions | null;
  } catch {
    /* none */
  }
  if (sim && file.size <= MAX_DOCUMENT) return new SmallSource(await file.text(), file.name, { speed: Number(sim.speed) || undefined, latency: Number(sim.latency) || 0 });
  return new CoreSource(file, file.name);
}

export interface OpenOptions {
  /** Opened by the debug override (localStorage['tk:hugeMin']). */
  forced: boolean;
  /** Opened as text whatever it looks like ("Open as text" on a file that looks binary). */
  asText: boolean;
  /** Opens it again as text. */
  again: () => void;
}

/**
 * Opens `file` in huge mode. `signal`: aborted when another document replaces it (before it opens, or while
 * it is open: the session closes).
 */
export async function openHuge(host: HugeHost, file: File, source: InputSource, signal: AbortSignal, { forced, asText, again }: OpenOptions): Promise<void> {
  if (!asText && CONVERTED.test(file.name)) {
    host.toast(`Converting ${file.name} to JSON isn't available for files this large yet`, 'err');
    return;
  }
  // (Its first 64 KB tell whether it is text at all.)
  const head = asText ? '' : await file.slice(0, 65_536).text();
  if (signal.aborted) return;
  if (looksBinary(head)) {
    host.toast(...binaryFile(file.name, again));
    return;
  }
  const src = await sourceFor(file);
  if (signal.aborted) return src?.destroy();
  if (!src) {
    host.toast('That file is too large to open in a browser tab', 'err');
    return;
  }
  const session = new HugeSession(host, src, { name: file.name, source, forced });
  signal.addEventListener('abort', () => session.close(), { once: true });
  await session.start();
}
