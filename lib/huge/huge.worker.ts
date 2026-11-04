/**
 * Huge-file mode's worker (client.ts starts it): reads a File through huge.wasm and answers the page's
 * queries (serve.ts). Its File is read with FileReaderSync, a slice at a time: never all of it.
 */
import { serve } from './serve';
import type { Parsers } from './doc';

const compile = async (url: URL) => {
  // (compileStreaming needs the application/wasm type: a server that sends another gets the bytes compiled instead.)
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }
};

let loaded: Promise<{ huge: WebAssembly.Module; parsers: Parsers }> | null = null;
const load = () =>
  (loaded ??= (async () => {
    const [huge, wasm, js] = await Promise.all([
      compile(new URL('./huge.wasm', import.meta.url)),
      compile(new URL('../json/tape.wasm', import.meta.url)).catch(() => null),
      import('../json/tape-parser'),
    ]);
    js.warmUp();
    return { huge, parsers: { wasm, parse: js.parse } };
  })());

const reader = new FileReaderSync();

serve(self as unknown as Parameters<typeof serve>[0], load, (file) => ({
  size: file.size,
  read: (at, len) => new Uint8Array(reader.readAsArrayBuffer(file.slice(at, at + len))),
}));
