/**
 * Input in another format (YAML, CSV, XML, TOML): the editor keeps it as typed, and the views show the JSON
 * it converts to, as they show a JWT's decoded document. Loaded only once an input is read as one of them.
 */
import { codeTokens } from '../convert/highlight';
import { detectFormat, importToJson, sniffDelimiter, type CsvOptions } from '../convert/import';
import type { Colors } from './editor';
import { escapeHtml, type Mark } from './highlight';
import type { SourceFormat } from './store';

export type { CsvOptions };

/** The JSON text an input converts to, or where and why it doesn't. */
export type Converted = { json: string } | { error: string; p: number };

/** Converts `text`, read as `format`, to compact JSON (the views format it themselves). */
export function convertSource(text: string, format: Exclude<SourceFormat, 'json'>, csv: CsvOptions): Converted {
  const r = importToJson(text, format, '', csv);
  if ('json' in r) return r;
  return { error: r.error, p: Math.max(0, Math.min(text.length, r.p ?? 0)) };
}

/** What else `text` looks like when it doesn't read as `format`: a format to offer instead, or null. */
export function otherFormat(text: string, format: SourceFormat): SourceFormat | null {
  const f = detectFormat(text);
  const g: SourceFormat | null = f === 'tsv' ? 'csv' : f === 'unknown' ? null : f;
  return g === format ? null : g;
}

/** The separator a CSV document's fields are detected to use. */
export const csvDelimiter = (text: string) => sniffDelimiter(text);

/**
 * HTML for `t[a, b)`, its tokens (pairs of offsets from `o` in `t`, in order) coloured and `marks` underlined, as
 * highlightLine does.
 */
function paint(t: string, a: number, b: number, o: number, tokens: number[], classes: string[], marks: Mark[] | null | undefined): string {
  let out = '';
  const wrap = (s: number, e: number, cls: string) => {
    const x = escapeHtml(t.slice(s, e));
    return cls ? `<span class="${cls}">${x}</span>` : x;
  };
  const put = (s: number, e: number, cls: string) => {
    if (s >= e) return;
    if (!marks?.length) {
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
  let p = a;
  for (let k = 0; k < classes.length; k++) {
    const s = Math.max(o + tokens[2 * k], p);
    const e = Math.min(o + tokens[2 * k + 1], b);
    if (e <= s) continue;
    if (s > p) put(p, s, '');
    put(s, e, classes[k]);
    p = e;
  }
  if (p < b) put(p, b, '');
  return out;
}

/** The line of `t` that holds offset `a`: [start, end). */
function lineOf(t: string, a: number): [number, number] {
  const s = a > 0 ? t.lastIndexOf('\n', a - 1) + 1 : 0;
  const e = t.indexOf('\n', a);
  return [s, e < 0 ? t.length : e];
}

/**
 * The editor's colours for an input read as `format`: each line on its own (a YAML block scalar or a TOML string
 * over several lines colours as the lines it spans). CSV by column, as the Convert view colours it, with `delimiter`;
 * the line at offset `head` bold when it is the header (after Excel's `sep=;` line, which is shown as a comment).
 */
export function sourceColors(format: Exclude<SourceFormat, 'json'>, delimiter = ',', header = true, head = 0): Colors {
  // (A long line soft-wraps into rows, each coloured with the same line: its tokens are found once.)
  let lastLine = '';
  let lastAt = -1;
  let tokens: number[] = [];
  let classes: string[] = [];
  const d = delimiter.charCodeAt(0);
  /** Finds the tokens of the line `t[s, e)` (`t` starts at document offset `at`), at offsets from its start. */
  const scan = (t: string, s: number, e: number, at: number) => {
    const line = t.slice(s, e);
    if (line === lastLine && at + s === lastAt) return;
    lastLine = line;
    lastAt = at + s;
    tokens = [];
    classes = [];
    if (format === 'csv') {
      if (head && at + s === 0) {
        tokens.push(0, line.length);
        classes.push('tc');
        return;
      }
      const bold = header && at + s === head ? ' ch' : '';
      let col = 0;
      let q = false;
      for (let i = 0; i < line.length; ) {
        const c = line.charCodeAt(i);
        if (!q && c === d) {
          tokens.push(i, i + 1);
          classes.push('tp');
          col++;
          i++;
          continue;
        }
        let j = i;
        for (; j < line.length; j++) {
          const x = line.charCodeAt(j);
          if (q) {
            if (x === 34) {
              if (line.charCodeAt(j + 1) === 34) j++;
              else q = false;
            }
          } else if (x === d || x === 13) break;
          else if (x === 34) q = true;
        }
        if (j === i) j++;
        tokens.push(i, j);
        classes.push(`cc${col % 8}${bold}`);
        i = j;
      }
      return;
    }
    codeTokens(line, format, (x, y, cls) => {
      if (!cls || x >= y) return;
      tokens.push(x, y);
      classes.push(cls);
    });
  };
  return (t, a, b, at, marks) => {
    const [s, e] = lineOf(t, a);
    scan(t, s, e, at);
    return paint(t, a, b, s, tokens, classes, marks);
  };
}
