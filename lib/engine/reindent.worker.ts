/** Re-indents big documents off the main thread (see Engine.outputFirst). */
import { reindent } from '../json/format';

self.onmessage = (e: MessageEvent<{ id: number; text: string; indent: string; warm?: number }>) => {
  const { id, text, indent, warm } = e.data;
  // A warm-up: the engine optimizes the loop now, so a first big document runs at full speed.
  if (warm) {
    for (let k = 0; k < warm; k++) reindent(text, k & 1 ? '' : indent);
    self.postMessage({ id, out: null });
    return;
  }
  self.postMessage({ id, out: reindent(text, indent) });
};
