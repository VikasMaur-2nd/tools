/*
 * Huge mode's entry, loaded only when a file is too big for the editor (Engine.loadFile, see ./min.ts):
 * checks the file is JSON text, makes its source and opens a session on it.
 */
import { looksBinary, binaryFile } from '../engine/asks';
import { MAX_DOCUMENT } from '../link';
import type { InputSource } from '../analytics/events';
import { SmallSource, type SmallOptions } from './small-source';
import { HugeSession, type HugeHost } from './session';
import type { HugeSource } from './source';

/** Formats the normal path converts to JSON: not in huge mode yet (a streamed conversion comes later). */
const CONVERTED = /\.(csv|tsv|ya?ml|xml|toml)$/i;

/**
 * The source for `file`: the core's index once it is wired in; until then the small-document adapter, for
 * files a tab can parse whole (the debug override forcing huge mode on them). Null: none can read it.
 */
async function sourceFor(file: File): Promise<HugeSource | null> {
  if (file.size > MAX_DOCUMENT) return null;
  let sim: SmallOptions = {};
  try {
    // Debug: an index played at a set speed, reads with a latency (tk:hugeSim = {"speed": bytes/s, "latency": ms}).
    sim = JSON.parse(localStorage.getItem('tk:hugeSim') ?? '{}') as SmallOptions;
  } catch {
    /* none */
  }
  return new SmallSource(await file.text(), file.name, { speed: Number(sim.speed) || undefined, latency: Number(sim.latency) || 0 });
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
