/*
 * Colours for Tool Kumar links (lib/link.ts) wherever /integrate shows one: the
 * builder's code box (the link, or Markdown or HTML around it, in the editor) and
 * the code on the page. A part's class (app/content.css):
 *
 *   lk-o  the site's address (and a path on it)   lk-h  #
 *   lk-k  a name: a, b, view, to, handoff         lk-e  =
 *   lk-s  & between pairs                         lk-d  a document, compressed
 *   lk-u  a document's URL                        lk-v  a view or Convert target
 *   lk-ph a placeholder such as <document>
 *
 * Around a link: lk-p Markdown punctuation and HTML tags, lk-n tag and attribute
 * names, lk-t text. A link can be megabytes long; reading it is one pass.
 * (The code on the page is coloured on the server: lib/link-code.ts.)
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string) => (/[&<>"]/.test(s) ? s.replace(/[&<>"]/g, (c) => ESC[c]) : s);

/** [start, end, class]. */
export type Part = [number, number, string];

const ORIGIN = 'https://tools.vikasmaur.com';
const NAMES = ['view', 'to', 'a', 'b'];

const isPath = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 47 || c === 46 || c === 95 || c === 45;
const isName = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 45;
/** Where a value stops: & (the next pair), quotes, spaces, brackets of the Markdown or HTML around it. */
const ends = (c: number) => c === 38 || c === 34 || c === 39 || c === 96 || c <= 32 || c === 41 || c === 60 || c === 62 || c === 35;

/** Adds a part (joined to the last one when it continues it). */
export function put(out: Part[], a: number, b: number, cls: string) {
  if (b <= a) return;
  const last = out[out.length - 1];
  if (last && last[1] === a && last[2] === cls) last[1] = b;
  else out.push([a, b, cls]);
}

/** The pair name at `i` (`a=`, `view=`…): its length without the `=`, or 0. */
function nameAt(s: string, i: number, end: number) {
  for (const n of NAMES) if (i + n.length < end && s.startsWith(n, i) && s.charCodeAt(i + n.length) === 61) return n.length;
  return 0;
}

/** The separator at `i` before another pair: `&` (or `&amp;` in HTML), its length, or 0. */
function sepAt(s: string, i: number, end: number) {
  if (s.charCodeAt(i) !== 38) return 0;
  const n = s.startsWith('&amp;', i) ? 5 : 1;
  return nameAt(s, i + n, end) || i + n === end ? n : 0;
}

/**
 * Reads a link's parts from `i` up to `end`: the site's address, a fragment from `#`, or its
 * `name=value` pairs (as in code that builds a link: `'&view='`). Returns where they stop, `i`
 * if nothing there is a link part. `whole`: the parts must fill [i, end) (a string literal), or
 * nothing is read.
 */
export function readLink(s: string, i: number, end: number, out: Part[], whole = false): number {
  const mark = out.length;
  let j = i;
  if (s.startsWith(ORIGIN, j) && ORIGIN.length <= end - j) {
    j += ORIGIN.length;
    while (j < end && isPath(s.charCodeAt(j))) j++;
    put(out, i, j, 'lk-o');
  } else if (s.charCodeAt(j) === 47 && s.charCodeAt(j + 1) === 35) {
    // '/#handoff'
    put(out, j, j + 1, 'lk-o');
    j++;
  }
  if (j < end && s.charCodeAt(j) === 35) {
    put(out, j, j + 1, 'lk-h');
    j++;
    if (s.startsWith('handoff', j) && (j + 7 === end || !isName(s.charCodeAt(j + 7)))) {
      put(out, j, j + 7, 'lk-k');
      j += 7;
    }
  }
  for (;;) {
    let k = j;
    const sep = sepAt(s, k, end);
    if (sep) {
      put(out, k, k + sep, 'lk-s');
      k += sep;
    }
    const n = nameAt(s, k, end);
    if (!n) {
      // (A separator is only read before a pair, or closing a string: "'&' + pair".)
      if (sep) j = k;
      break;
    }
    const name = s.slice(k, k + n);
    put(out, k, k + n, 'lk-k');
    put(out, k + n, k + n + 1, 'lk-e');
    let v = k + n + 1;
    const v0 = v;
    if (s.charCodeAt(v) === 60) {
      // A placeholder: <document>
      let e = v + 1;
      while (e < end && isName(s.charCodeAt(e))) e++;
      if (s.charCodeAt(e) === 62 && e > v + 1) {
        put(out, v, e + 1, 'lk-ph');
        v = e + 1;
      }
    }
    if (v === v0) {
      while (v < end && !ends(s.charCodeAt(v))) v++;
      put(out, v0, v, name === 'a' || name === 'b' ? (s.startsWith('http', v0) ? 'lk-u' : 'lk-d') : 'lk-v');
    }
    j = v;
  }
  if (j === i || (whole && j !== end)) {
    out.length = mark;
    return i;
  }
  return j;
}

/** The links in free text (every one starts with the site's address). */
export function textParts(s: string, from = 0, to = s.length, out: Part[] = []): Part[] {
  for (let i = s.indexOf(ORIGIN, from); i >= 0 && i < to; i = s.indexOf(ORIGIN, i)) {
    const j = readLink(s, i, to, out);
    i = j > i ? j : i + ORIGIN.length;
  }
  return out;
}

/** The builder's code box: Markdown or HTML around a link, or the link alone. */
export function snippetParts(s: string): Part[] {
  const out: Part[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 104 && s.startsWith(ORIGIN, i)) {
      const j = readLink(s, i, n, out);
      if (j > i) {
        i = j;
        continue;
      }
    }
    if (c === 60) {
      // An HTML tag: <name attr="value" …> or </name>
      let j = i + 1;
      if (s.charCodeAt(j) === 47) j++;
      put(out, i, j, 'lk-p');
      const a = j;
      while (j < n && isName(s.charCodeAt(j))) j++;
      put(out, a, j, 'lk-n');
      while (j < n && s.charCodeAt(j) !== 62) {
        const d = s.charCodeAt(j);
        if (d === 34) {
          // "value": a link in it is coloured as one
          const close = s.indexOf('"', j + 1);
          const e = close < 0 ? n : close;
          put(out, j, j + 1, 'lk-p');
          let k = j + 1;
          if (s.startsWith(ORIGIN, k)) k = readLink(s, k, e, out);
          put(out, k, e, 'lk-t');
          put(out, e, Math.min(n, e + 1), 'lk-p');
          j = e + 1;
        } else if (isName(d)) {
          const a2 = j;
          while (j < n && isName(s.charCodeAt(j))) j++;
          put(out, a2, j, 'lk-n');
        } else {
          if (d === 61 || d === 47) put(out, j, j + 1, 'lk-p');
          j++;
        }
      }
      put(out, j, Math.min(n, j + 1), 'lk-p');
      i = j + 1;
    } else if (c === 91 || c === 93 || c === 40 || c === 41 || (c === 33 && s.charCodeAt(i + 1) === 91)) {
      // Markdown: [![label](image)](link)
      put(out, i, i + 1, 'lk-p');
      i++;
    } else {
      let j = i + 1;
      while (j < n && !/[[\]()<!h]/.test(s[j])) j++;
      put(out, i, j, 'lk-t');
      i = j;
    }
  }
  return out;
}

/** HTML for text[a, b) split into `parts` (sorted, not overlapping); the text starts at offset `at`. */
export function partsHtml(parts: readonly Part[], text: string, a: number, b: number, at = 0): string {
  const A = at + a;
  const B = at + b;
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (parts[m][1] <= A) lo = m + 1;
    else hi = m;
  }
  let out = '';
  let p = A;
  for (let k = lo; k < parts.length && parts[k][0] < B; k++) {
    const s = Math.max(parts[k][0], A);
    const e = Math.min(parts[k][1], B);
    if (s > p) out += escapeHtml(text.slice(p - at, s - at));
    out += `<span class="${parts[k][2]}">${escapeHtml(text.slice(s - at, e - at))}</span>`;
    p = e;
  }
  return p < B ? out + escapeHtml(text.slice(p - at, B - at)) : out;
}
