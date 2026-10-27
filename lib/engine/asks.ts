/*
 * What the tool asks before opening something unusual: a file that isn't text, a share link whose
 * document is past LINK_DOCUMENT. Loaded with the file reader, or when a link turns out that big, so
 * the first load doesn't carry it.
 */

/** A toast's message, kind and action (see Engine.toast). */
type Ask = [msg: string, kind: 'err', action: { label: string; run: () => void }];

/**
 * Is this text a binary file read as UTF-8 (a zip, an image, a video or a PDF opened by mistake)? No text
 * file holds NUL, and where the bytes aren't text most past ASCII decode to U+FFFD, with control characters
 * among them. Looks at the first 64K characters; NUL padding at the very end (as some tools write) doesn't count.
 */
export function looksBinary(text: string): boolean {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
  const n = Math.min(end, 65_536);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return true;
    // (Tabs, line breaks and form feeds are text.)
    if ((c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) || c === 0x7f || c === 0xfffd) odd++;
  }
  return odd > 16 && odd >= n * 0.1;
}

/** File `name` looks binary: said so, and `open` only when asked. */
export const binaryFile = (name: string, open: () => void): Ask => [`${name} looks like a binary file, not JSON`, 'err', { label: 'Open as text', run: open }];

/** A share link's document is past LINK_DOCUMENT: `open` it only when asked. */
export const bigLink = (open: () => void): Ask => ["This link's document is over 32 MB: opening it can slow down or crash this tab", 'err', { label: 'Open anyway', run: open }];
