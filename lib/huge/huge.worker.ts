/**
 * Huge-file mode's worker (client.ts starts it): reads a File through huge.wasm and answers the page's
 * queries (serve.ts). Readers per engine (RESEARCH-REPORT.md §4, a 5 GiB read): Firefox reads with
 * FileReaderSync (flat memory, its fastest single reader); Chromium and WebKit with `slice().arrayBuffer()`,
 * 16 MiB chunks two in flight for the indexing pass and 1 MiB blocks for queries (FileReaderSync's garbage keeps
 * growing in Chromium; WebKit's streams grow without bound). Every async read is watched for a stall.
 */
import { BlockSource } from './bytes';
import { Prefetch, SyncChunks } from './prefetch';
import { serve } from './serve';
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
const firefox = /Firefox\//.test(navigator.userAgent);

serve(
  self as unknown as Parameters<typeof serve>[0],
  load,
  (file) =>
    firefox
      ? { size: file.size, read: (at, len) => new Uint8Array(readSync(file.slice(at, at + len))) }
      : Object.assign(new BlockSource(file), { cached: true }),
  (file) => (firefox ? new SyncChunks(file, readSync) : new Prefetch(file)),
);
