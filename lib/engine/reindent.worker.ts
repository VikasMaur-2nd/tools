/** Re-indents big documents off the main thread (see Engine.outputFirst), and parses them after typing. */
import { reindent } from '../json/format';
import { packTree } from '../json/pack';
import { parse } from '../json/parser';

self.onmessage = (e: MessageEvent<{ id: number; text: string; indent: string; warm?: number; parse?: boolean }>) => {
  const { id, text, indent, warm } = e.data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  // The parse goes first, on its own (the page takes each message in its own task), packed: cloning a
  // big tree would block the page for about a second per 10 MB; the page rebuilds it in slices.
  if (e.data.parse) {
    const tree = packTree(parse(text), text);
    (self as unknown as Worker).postMessage({ id, tree }, [tree.nodes.buffer]);
  }
  self.postMessage({ id, out: reindent(text, indent) });
};
