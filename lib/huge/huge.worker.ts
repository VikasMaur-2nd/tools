/**
 * Huge-file mode's worker (client.ts starts it): reads a File through huge.wasm and answers the page's
 * queries (serve.ts). Readers per engine (RESEARCH-REPORT.md §4, a 5 GiB read; never streams): the indexing pass
 * reads 16 MiB chunks, two in flight with `slice().arrayBuffer()` (Chromium, WebKit) or with FileReaderSync
 * (Firefox: flat memory); queries read 1 MiB with FileReaderSync (Firefox, WebKit) or async blocks (Chromium,
 * whose FileReaderSync garbage keeps growing). Every async read is watched for a stall.
 */
import { BlockSource } from './bytes';
import { Prefetch, SyncChunks } from './prefetch';
import { serve } from './serve';
import { IdbSessionStore } from './session-store';
import type { Parsers } from './doc';
import type { Parse } from './errors';
import { Wait } from './wait';

const compile = async (url: URL) => {
  // (compileStreaming needs the application/wasm type: a server that sends another gets the bytes compiled instead.)
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }
};

// The JS tape parser (errors, JSON Lines pages, no Wasm): loaded after the document is made, so the first rows
// don't wait for it; a query that needs it before waits (wait.ts).
let js: typeof import('../json/tape-parser') | null = null;
let jsReady: Promise<void> | null = null;
const loadJs = () =>
  (jsReady ??= import('../json/tape-parser').then((m) => {
    m.warmUp();
    js = m;
  }));
const parse: Parse = (text, options) => {
  if (!js) throw new Wait(loadJs);
  return js.parse(text, options);
};

let loaded: Promise<{ huge: WebAssembly.Module; parsers: Parsers }> | null = null;
const load = () =>
  (loaded ??= (async () => {
    const [huge, wasm] = await Promise.all([compile(new URL('./huge.wasm', import.meta.url)), compile(new URL('../json/tape.wasm', import.meta.url)).catch(() => null)]);
    setTimeout(() => void loadJs(), 0);
    return { huge, parsers: { wasm, parse } };
  })());

declare const FileReaderSync: { new (): { readAsArrayBuffer(blob: Blob): ArrayBuffer } };
const reader = new FileReaderSync();
const readSync = (b: Blob) => reader.readAsArrayBuffer(b);
const ua = navigator.userAgent;
const firefox = /Firefox\//.test(ua);
const webkit = /AppleWebKit\//.test(ua) && !/(Chrome|Chromium)\//.test(ua);

// (The read-ahead of the file being opened: query blocks take what it has read.)
let ahead: Prefetch | null = null;
let aheadOf: Blob | null = null;

serve(
  self as unknown as Parameters<typeof serve>[0],
  load,
  // Queries: FileReaderSync in Firefox and WebKit (as fast as an async read there; nothing to wait for and ask
  // again), async blocks in Chromium (its FileReaderSync garbage keeps growing).
  (file) =>
    firefox || webkit
      ? { size: file.size, read: (at, len) => new Uint8Array(readSync(file.slice(at, at + len))) }
      : // (The read-ahead's chunks are its file's: a file saved in place is another.)
        Object.assign(new BlockSource(file, 1 << 20, 24, ahead && aheadOf === file ? ahead : undefined), { cached: true }),
  // Indexing: FileReaderSync 16 MiB at a time in Firefox (flat memory), 16 MiB arrayBuffer() two in flight elsewhere.
  (file) => (firefox ? new SyncChunks(file, readSync) : ((aheadOf = file), (ahead = new Prefetch(file)))),
  // Edits kept between visits, where there is IndexedDB.
  typeof indexedDB === 'undefined' ? undefined : new IdbSessionStore(),
);
