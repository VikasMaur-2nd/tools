import { Doc } from '../engine/doc';
import { formatDoc } from './format';
import { ARR, STR, parse } from './parser';
import type { CodeChange } from './code-index';

interface Text {
  length: number;
  charCodeAt(i: number): number;
  indexOf(ch: string, from: number): number;
  slice(a: number, b: number): string;
}
const space = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
const punctuation = (c: number) => c === 123 || c === 125 || c === 91 || c === 93 || c === 58 || c === 44;
const skip = (text: Text, i: number) => { while (space(text.charCodeAt(i))) i++; return i; };

/** Token boundaries in already validated strict JSON. Escapes may change the output token's length. */
function end(text: Text, i: number): number {
  const c = text.charCodeAt(i);
  if (punctuation(c)) return i + 1;
  if (c === 34) {
    let j = i + 1;
    for (;;) {
      j = text.indexOf('"', j);
      if (j < 0) return text.length;
      let b = j - 1;
      while (text.charCodeAt(b) === 92) b--;
      if ((j - b) & 1) return j + 1;
      j++;
    }
  }
  while (i < text.length && !space(text.charCodeAt(i)) && !punctuation(text.charCodeAt(i))) i++;
  return i;
}

export interface ScalarChange {
  output: Doc;
  change: CodeChange;
  patch: string;
}

/**
 * Sparse source/output checkpoints, one per 16K source units. Only a bounded scalar is reparsed.
 * Containers, ambiguous edits and sorted output use the full formatter. No speculative output
 * is published: both the unchanged document and the replacement token must be strict JSON.
 */
export class ScalarFormatter {
  private source: number[] = [];
  private target: number[] = [];

  constructor(private input: Doc, private output: Doc) {
    const src = input.toString();
    const out = output.toString();
    let a = 0;
    let b = 0;
    let checkpoint = 0;
    while ((a = skip(src, a)) < src.length) {
      b = skip(out, b);
      if (a >= checkpoint) {
        this.source.push(a);
        this.target.push(b);
        checkpoint = a + 16_384;
      }
      a = end(src, a);
      b = end(out, b);
    }
  }

  update(input: Doc): ScalarChange | null {
    const edit = input.changeFrom(this.input, 65_536);
    if (!edit) return null;
    if (edit.a === edit.b && !edit.ins) {
      this.input = input;
      return { output: this.output, change: { prefix: this.output.length, suffix: 0 }, patch: '' };
    }
    let lo = 0;
    let hi = this.source.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.source[mid] <= edit.a) lo = mid;
      else hi = mid - 1;
    }
    let a = this.source[lo] ?? 0;
    let b = this.target[lo] ?? 0;
    const limit = a + 65_536;
    while (a <= edit.a && a < this.input.length && a < limit) {
      a = skip(this.input, a);
      b = skip(this.output, b);
      const ae = end(this.input, a);
      const be = end(this.output, b);
      if (ae - a > 65_536) return null;
      if (edit.a <= ae && edit.b <= ae) {
        if (edit.a < a || punctuation(this.input.charCodeAt(a))) return null;
        const raw = this.input.slice(a, edit.a) + edit.ins + this.input.slice(edit.b, ae);
        const parsed = parse(raw);
        const key = this.input.charCodeAt(skip(this.input, ae)) === 58;
        if (!parsed.root || parsed.error || parsed.issues.length || parsed.multi || parsed.root.t >= ARR || key && parsed.root.t !== STR) return null;
        const patch = formatDoc(raw, parsed, '');
        const change = { prefix: b, suffix: this.output.length - be };
        this.output = this.output.edit(b, be, patch);
        const ds = edit.ins.length - (edit.b - edit.a);
        const dt = patch.length - (be - b);
        for (let i = lo; i < this.source.length; i++) {
          if (this.source[i] >= ae) { this.source[i] += ds; this.target[i] += dt; }
        }
        this.input = input;
        return { output: this.output, change, patch };
      }
      if (ae <= a || be <= b) return null;
      a = ae;
      b = be;
    }
    return null;
  }
}
