/*
 * The code on /integrate, coloured on the server: as highlightCode colours it, with Tool Kumar
 * links and link parts in it coloured as links (lib/link-colors.ts).
 */
import { codeTokens } from './convert/highlight';
import { escapeHtml, put, readLink, textParts, type Part } from './link-colors';

/**
 * Code as HTML, coloured as highlightCode colours it, with Tool Kumar links and link parts in
 * its strings coloured as links (`lang` 'text': links in plain text). No span crosses a line break.
 */
export function codeWithLinks(src: string, lang: string): string {
  const parts: Part[] = [];
  if (lang === 'text') textParts(src, 0, src.length, parts);
  else {
    codeTokens(src, lang, (a, b, cls) => {
      if (!cls || a >= b) return;
      const q = src.charCodeAt(a);
      // A string literal holding a link or link parts: its quotes stay a string's, the inside a link's.
      if (cls === 'ts' && (q === 39 || q === 34 || q === 96) && b - a >= 2 && src.charCodeAt(b - 1) === q) {
        const inner: Part[] = [];
        if (readLink(src, a + 1, b - 1, inner, true) > a + 1) {
          put(parts, a, a + 1, cls);
          for (const p of inner) put(parts, p[0], p[1], p[2]);
          put(parts, b - 1, b, cls);
          return;
        }
      }
      // Links in comments and other strings.
      const before = parts.length;
      textParts(src, a, b, parts);
      if (parts.length === before) put(parts, a, b, cls);
      else {
        // The token's own colour around the links in it.
        const found = parts.splice(before);
        let p = a;
        for (const f of found) {
          put(parts, p, f[0], cls);
          parts.push(f);
          p = f[1];
        }
        put(parts, p, b, cls);
      }
    });
  }
  // Rendered line by line: a span never holds a line break.
  let out = '';
  let p = 0;
  const span = (a: number, b: number, cls: string) =>
    src
      .slice(a, b)
      .split('\n')
      .map((t) => (t ? `<span class="${cls}">${escapeHtml(t)}</span>` : ''))
      .join('\n');
  for (const [a, b, cls] of parts) {
    if (a > p) out += escapeHtml(src.slice(p, a));
    out += span(a, b, cls);
    p = b;
  }
  return out + escapeHtml(src.slice(p));
}
