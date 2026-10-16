interface Source { readonly text: string }
interface Slice { source: Source; a: number; b: number }

/** Immutable UTF-16 slices. Small output edits never copy or flatten the whole document. */
export class TextSlices {
  readonly length: number;
  private readonly ends: Int32Array;

  private constructor(private readonly parts: Slice[]) {
    this.ends = new Int32Array(parts.length);
    let length = 0;
    for (let i = 0; i < parts.length; i++) this.ends[i] = length += parts[i].b - parts[i].a;
    this.length = length;
  }

  static from(text: string) {
    return new TextSlices(text ? [{ source: { text }, a: 0, b: text.length }] : []);
  }

  private first(at: number) {
    let lo = 0;
    let hi = this.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ends[mid] <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private range(a: number, b: number): Slice[] {
    const out: Slice[] = [];
    for (let i = this.first(a); i < this.parts.length && a < b; i++) {
      const p = this.parts[i];
      const start = i ? this.ends[i - 1] : 0;
      const end = Math.min(b, this.ends[i]);
      out.push({ source: p.source, a: p.a + a - start, b: p.a + end - start });
      a = end;
    }
    return out;
  }

  patch(prefix: number, suffix: number, text: string): TextSlices {
    const parts = this.range(0, prefix);
    if (text) parts.push({ source: { text }, a: 0, b: text.length });
    for (const p of this.range(this.length - suffix, this.length)) parts.push(p);
    const joined: Slice[] = [];
    for (const p of parts) {
      const last = joined[joined.length - 1];
      if (last && last.source === p.source && last.b === p.a) last.b = p.b;
      else joined.push(p);
    }
    return new TextSlices(joined);
  }

  slice(a = 0, b = this.length): string {
    a = Math.max(0, a);
    b = Math.min(this.length, b);
    let out = '';
    for (let i = this.first(a); i < this.parts.length && a < b; i++) {
      const p = this.parts[i];
      const start = i ? this.ends[i - 1] : 0;
      const end = Math.min(b, this.ends[i]);
      out += p.source.text.slice(p.a + a - start, p.a + end - start);
      a = end;
    }
    return out;
  }
}
