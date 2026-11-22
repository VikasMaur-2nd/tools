/**
 * Where a schema check's errors are in an input in another format (YAML, CSV, XML, TOML), for the Schema view:
 * lib/convert/import.ts locateImport, with the engine's reader. A big input's are found in the engine's source worker
 * (where the engine converts it), never holding up the page; a small one's here.
 */
import type { CsvOptions, ImportFormat, Place, locateImport } from '../convert/import';
import type { SourceRequest } from '../engine/source.worker';

/** From this size an input is read in the worker (the size the engine converts it there from: SOURCE_WORKER_MIN). */
export const PLACES_WORKER_MIN = 100_000;

/** What this needs of the engine (lib/engine/engine.ts). */
export interface PlacesHost {
  ed: { text: string };
  source: { locateImport: typeof locateImport } | null;
  sourceWorker(): { postMessage(m: SourceRequest): void } | null;
  placesIn?: ((d: { seq: number; places: Place[] | null } | null) => void) | null;
}

/** Places asked of a worker, by request: answered null if it ends first. */
const waiting = new Map<number, (p: Place[] | null) => void>();
let asked = 0;

/** Where the values at `pointers` (with `keys[i]`, property names) of what the engine's input converts to are in it. */
export function locateSource(e: PlacesHost, format: ImportFormat, options: CsvOptions, pointers: string[], keys: boolean[]): Promise<Place[] | null> {
  const text = e.ed.text;
  if (text.length < PLACES_WORKER_MIN) return Promise.resolve(e.source?.locateImport(text, format, options, pointers, keys) ?? null);
  const w = e.sourceWorker();
  if (!w) return Promise.resolve(null);
  e.placesIn = (d) => {
    if (d) {
      waiting.get(d.seq)?.(d.places);
      waiting.delete(d.seq);
      return;
    }
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
  const seq = ++asked;
  return new Promise((resolve) => {
    waiting.set(seq, resolve);
    w.postMessage({ seq, text, format, csv: options, locate: { pointers, keys } });
  });
}
