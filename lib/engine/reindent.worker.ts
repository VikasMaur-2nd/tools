/** Re-indents big documents off the main thread (see Engine.outputFirst), and parses them after typing. */
import { reindent } from '../json/format';
import { parse } from '../json/parser';

/** A lone surrogate: UTF-16 decoding would replace it, so such output goes as a plain string. */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Below this, a structured-cloned string is as cheap as a transferred buffer. */
const BUF_MIN = 1 << 20;
/** Uint16Array is in platform byte order; the page decodes it as UTF-16LE. */
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

self.onmessage = (e: MessageEvent<{ id: number; text: string; indent: string; warm?: number; parse?: boolean }>) => {
  const { id, text, indent, warm } = e.data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  // The parse goes first, on its own: the page takes each message in its own task.
  if (e.data.parse) self.postMessage({ id, res: parse(text) });
  const out = reindent(text, indent);
  // A big output goes as UTF-16 code units in a transferred buffer: no copy, no string clone on the page.
  if (out !== null && LE && out.length >= BUF_MIN && !LONE.test(out)) {
    const u = new Uint16Array(out.length);
    for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i);
    (self as unknown as Worker).postMessage({ id, out: null, buf: u.buffer }, [u.buffer]);
    return;
  }
  self.postMessage({ id, out });
};
