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
 * Syntax-highlights `text[a, b)` (one line, JSON never spans lines) into HTML.
 * Tolerant of loose JSON so the editor stays readable while it's invalid.
 * Marks (diagnostics, bracket matches) are merged into the token spans so they
 * line up with the glyphs exactly.
 */
export function highlightLine(text: string, a: number, b: number, marks: Mark[] | null, lineEnd = true): string {
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
