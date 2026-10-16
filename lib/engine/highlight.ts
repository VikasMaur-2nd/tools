/** Text read in slices and by character: a string, or the editor's document (see Doc). */
interface Text {
  readonly length: number;
  charCodeAt(i: number): number;
  slice(a?: number, b?: number): string;
}

/** A decorated range within the document (absolute offsets). */
export interface Mark {
  a: number;
  b: number;
  cls: string;
}

const ESC_TEST = /[&<>"]/;
const ESC_ALL = /[&<>"]/g;
const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string) => (ESC_TEST.test(s) ? s.replace(ESC_ALL, (c) => ESC_MAP[c]) : s);

const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || isDigit(c) || c === 95 || c === 36 || (c > 127 && c !== 0x201c && c !== 0x201d);

/**
 * JSON string state after `text[a, b)` starting from `state`: 0 outside a
 * string, 1 inside one, 3 inside one right after a backslash. For a wrapped
 * row that starts mid-string.
 */
export function stringState(text: string, a: number, b: number, state = 0): number {
  let s = state;
  for (let i = a; i < b; i++) {
    const c = text.charCodeAt(i);
    if (s === 3) s = 1;
    else if (s === 1) {
      if (c === 92) s = 3;
      else if (c === 34) s = 0;
    } else if (c === 34) s = 1;
  }
  return s;
}

/** Right-to-left letters (Hebrew, Arabic, Syriac, Thaana, NKo... and their supplementary planes) and bidi controls. */
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe\u061c\u200f\u202a-\u202e\u2066-\u2069]|\ud802[\udc00-\udfff]|\ud803[\udc00-\udfff]|\ud83a[\udc00-\udfff]|\ud83b[\udc00-\udfff]/;

/** Can text order differently in `t[a, b)` than it is stored (does it hold anything right-to-left)? */
export const mayReorder = (t: string, a: number, b: number) => RTL.test(t.slice(a, b));

/**
 * `t[a, b)` as invisible, zero-size context for a row of a long line drawn on
 * its own: right-to-left text orders by its neighbours on the line, so this
 * makes the row read as it does wrapped whole. Whole code points only.
 */
export function bidiContext(t: string, a: number, b: number) {
  if ((t.charCodeAt(a) & 0xfc00) === 0xdc00) a++;
  if ((t.charCodeAt(b - 1) & 0xfc00) === 0xd800) b--;
  return b > a ? `<span class="ctx">${escapeHtml(t.slice(a, b))}</span>` : '';
}

/**
 * End of `t[a, b)` without trailing whitespace (bidi classes WS and S, isolate
 * marks). Whitespace ending a row takes the line's direction (rule L1), so it
 * goes after the row's trailing context.
 */
export function trimWs(t: string, a: number, b: number) {
  while (b > a) {
    const c = t.charCodeAt(b - 1);
    if (c === 32 || c === 9 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x205f || c === 0x3000 || (c >= 0x2066 && c <= 0x2069)) b--;
    else break;
  }
  return b;
}

const STEP = 8192;

/** Length of the common prefix of `x` and `y` (compared a block at a time, then by character). */
export function samePrefix(x: Text, y: Text) {
  const max = Math.min(x.length, y.length);
  let p = 0;
  while (p + 4096 <= max && x.slice(p, p + 4096) === y.slice(p, p + 4096)) p += 4096;
  while (p < max && x.charCodeAt(p) === y.charCodeAt(p)) p++;
  return p;
}

/**
 * stringState at offsets deep in long lines, from checkpoints every STEP
 * characters: drawing rows while scrolling never rescans a line from its start.
 */
export class StringStates {
  private text: Text = '';
  private lines = new Map<number, number[]>();
  /** A later text and where it first differs from `text` (told by `edited`, so never compared). */
  private next: Text | null = null;
  private p = 0;

  /** `text` is `old` changed from offset `p` on. */
  edited(old: Text, text: Text, p: number) {
    if (old === this.next) this.p = Math.min(this.p, p);
    else if (old === this.text && this.next === null) this.p = p;
    else return;
    this.next = text;
  }

  /** State at offset `off` of the line of `text` that starts at `a`. */
  at(text: Text, a: number, off: number): number {
    if (text !== this.text) {
      // An edit keeps the checkpoints before it (typing in a long line rescans a step, not the line).
      const p = text === this.next ? this.p : samePrefix(this.text, text);
      for (const [s, cp] of this.lines) {
        if (s > p) this.lines.delete(s);
        else cp.length = Math.min(cp.length, Math.floor((p - s) / STEP) + 1);
      }
      this.text = text;
      this.next = null;
    }
    let cp = this.lines.get(a);
    if (!cp) this.lines.set(a, (cp = [0]));
    const k = Math.floor((off - a) / STEP);
    // (A string's states from slices of it: the editor's document is read in views, not by character.)
    const state = (from: number, to: number, st: number) => (typeof text === 'string' ? stringState(text, from, to, st) : stringState(text.slice(from, to), 0, to - from, st));
    for (let i = cp.length; i <= k; i++) cp.push(state(a + (i - 1) * STEP, a + i * STEP, cp[i - 1]));
    return state(a + k * STEP, off, cp[k]);
  }
}

/**
 * Syntax-highlights `text[a, b)` (one line, JSON never spans lines) into HTML.
 * Tolerant of loose JSON so the editor stays readable while it's invalid.
 * Marks (diagnostics, bracket matches) are merged into the token spans so they
 * line up with the glyphs exactly. `str`: the slice starts inside a string
 * (see stringState).
 */
export function highlightLine(text: string, a: number, b: number, marks: Mark[] | null, lineEnd = true, str = 0): string {
  let out = '';

  const wrap = (s: number, e: number, cls: string) => {
    const t = escapeHtml(text.slice(s, e));
    return cls ? `<span class="${cls}">${t}</span>` : t;
  };
  const emit = (s: number, e: number, cls: string) => {
    if (!marks) {
      out += wrap(s, e, cls);
      return;
    }
    let p = s;
    for (const m of marks) {
      if (m.b <= p || m.a >= e) continue;
      if (m.a > p) {
        out += wrap(p, m.a, cls);
        p = m.a;
      }
      const q = Math.min(e, m.b);
      out += wrap(p, q, cls ? `${cls} ${m.cls}` : m.cls);
      p = q;
    }
    if (p < e) out += wrap(p, e, cls);
  };

  let i = a;
  if (str) {
    // The rest of a string begun on an earlier row.
    let j = str === 3 ? a + 1 : a;
    while (j < b) {
      const d = text.charCodeAt(j);
      if (d === 92) j += 2;
      else if (d === 34) {
        j++;
        break;
      } else j++;
    }
    j = Math.min(j, b);
    let k = j;
    while (k < b && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9)) k++;
    emit(a, j, text.charCodeAt(k) === 58 ? 'tk' : 'ts');
    i = j;
  }
  while (i < b) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9) {
      let j = i + 1;
      while (j < b && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
      emit(i, j, '');
      i = j;
    } else if (c === 34 || c === 39 || c === 0x201c) {
      const close = c === 0x201c ? 0x201d : c;
      let j = i + 1;
      while (j < b) {
        const d = text.charCodeAt(j);
        if (d === 92) j += 2;
        else if (d === close) {
          j++;
          break;
        } else j++;
      }
      if (j > b) j = b;
      let k = j;
      while (k < b && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9)) k++;
      emit(i, j, text.charCodeAt(k) === 58 ? 'tk' : 'ts');
      i = j;
    } else if (isDigit(c) || c === 45 || c === 43 || (c === 46 && isDigit(text.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < b) {
        const d = text.charCodeAt(j);
        if (isDigit(d) || d === 46 || d === 101 || d === 69 || d === 43 || d === 45 || d === 120 || d === 88 || (d >= 97 && d <= 102) || (d >= 65 && d <= 70)) j++;
        else break;
      }
      emit(i, j, 'tn');
      i = j;
    } else if (c === 123 || c === 125 || c === 91 || c === 93) {
      emit(i, i + 1, 'tb');
      i++;
    } else if (c === 58 || c === 44) {
      emit(i, i + 1, 'tp');
      i++;
    } else if (c === 47 && text.charCodeAt(i + 1) === 47) {
      emit(i, b, 'tc');
      i = b;
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const end = text.indexOf('*/', i + 2);
      const j = end < 0 || end + 2 > b ? b : end + 2;
      emit(i, j, 'tc');
      i = j;
    } else if (c === 35) {
      emit(i, b, 'tc');
      i = b;
    } else if (isWord(c)) {
      let j = i + 1;
      while (j < b && isWord(text.charCodeAt(j))) j++;
      const w = text.slice(i, j);
      let cls = '';
      if (w === 'true' || w === 'false' || w === 'True' || w === 'False') cls = 'tl';
      else if (w === 'null' || w === 'None' || w === 'undefined' || w === 'NaN') cls = 'tz';
      else {
        let k = j;
        while (k < b && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9)) k++;
        if (text.charCodeAt(k) === 58) cls = 'tk';
      }
      emit(i, j, cls);
      i = j;
    } else {
      emit(i, i + 1, '');
      i++;
    }
  }

  // Zero-width / end-of-line marks (e.g. "missing '}'" at end of input).
  if (marks && lineEnd) {
    for (const m of marks) {
      if (m.a >= b) out += `<span class="${m.cls} meol"> </span>`;
    }
  }
  return out;
}

const JWT_CLS = ['jw-b', 'jw-h', 'jw-d', 'jw-p', 'jw-d', 'jw-s'];

/**
 * `text[a, b)` of a JWT input, coloured by part: the optional "Bearer " prefix,
 * header, payload and signature, with the dots muted. `at` is the prefix start,
 * header, payload and signature starts and the signature end.
 */
export function jwtLine(text: string, a: number, b: number, at: readonly number[]): string {
  const cut = [at[0], at[1], at[2] - 1, at[2], at[3] - 1, at[3], at[4]];
  let out = escapeHtml(text.slice(a, Math.max(a, Math.min(b, cut[0]))));
  for (let k = 0; k < JWT_CLS.length; k++) {
    const s = Math.max(a, cut[k]);
    const e = Math.min(b, cut[k + 1]);
    // Escaped anyway: offsets lag an edit until the next analysis.
    if (e > s) out += `<span class="${JWT_CLS[k]}">${escapeHtml(text.slice(s, e))}</span>`;
  }
  return out + escapeHtml(text.slice(Math.min(b, Math.max(a, cut[6])), b));
}
