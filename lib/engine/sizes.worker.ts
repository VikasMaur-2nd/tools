/** Compressed sizes off the page (Firefox's brotli encoder runs on the thread that calls it: seconds for a few MB). */
import { compressedSizes } from './sizes';

/** The newest request: an older one stops after its current encoder. */
let latest = 0;
self.onmessage = (e: MessageEvent<{ seq: number; blob: Blob }>) => {
  const { seq, blob } = e.data;
  latest = seq;
  void compressedSizes(blob, () => latest === seq).then((sizes) => {
    if (latest === seq) self.postMessage({ seq, sizes });
  });
};
