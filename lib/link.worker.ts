/*
 * Makes a link's fragment (lib/link.ts linkHash) off the page's thread, for /integrate's builder:
 * browsers compress on the thread that asks, and a big document takes a second or more.
 */
import { linkHash, type LinkRequest } from './link';

self.onmessage = async (e: MessageEvent<{ id: number; r: LinkRequest }>) => {
  const { id, r } = e.data;
  try {
    self.postMessage({ id, hash: await linkHash(r) });
  } catch {
    self.postMessage({ id, hash: null });
  }
};
