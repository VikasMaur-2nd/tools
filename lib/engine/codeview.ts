import { bidiContext, escapeHtml, StringStates, stringState, trimWs } from './highlight';
import { lineEndIn, lineOfIn } from './lines';
import { TallScroll } from './tall';
import { LONG_LINE, Wrapper, asciiRows } from './wrap';
import { rt } from '../i18n/ui';
import { codeChanger, codeIndexer, type CodeChange, type CodeIndex } from '../json/code-index';
import { soon } from './idle';
import { TextSlices } from '../json/text-slices';

/*
 * Virtualized read-only code viewer with lazily highlighted lines.
 * - Long lines soft-wrap (see wrap.ts), so a minified multi-megabyte line
 *   reads like a paragraph and virtualization still works. ASCII rows are
 *   slices of the line; a line of wider glyphs (CJK, emoji…) is laid out by
 *   the browser in one block, or sliced where the browser breaks it if long.
 *   Without wrapping, lines run on and long ones are drawn around the view.
 * - Brace/bracket blocks fold from the gutter (JSON and C-like code).
 * - Find highlights matches and jumps between them, unfolding as needed.
 */

const RH = 20;
const OVERSCAN = 30;
const PAD_X = 16;
const MAX_HITS = 100_000;
/** Columns drawn either side of the view on long lines while not wrapping. */
const H_OVERSCAN = 400;

/**
 * Highlights a slice of a line. `inString` is set when the slice starts inside
 * a JSON string (a wrapped continuation row), `esc` when that string's previous
 * character was a backslash. `src` and `at`: the whole text and where the slice
 * starts in it (for highlighters that read around it).
 */
export type LineHighlighter = (text: string, inString: boolean, esc: boolean, state: number, src?: string, at?: number) => string;

/**
 * Tracks a highlighter's state through the text (CSV: the column and whether
 * it's inside quotes; code: a block scalar, a multi-line string), so a row that
 * starts mid-record or mid-string is coloured right. `scan` returns the state
 * after `s[a, b)`, `s` being the whole text (a line is scanned with its line break).
 */
export interface Scanner {
  start: number;
  scan(s: string, a: number, b: number, state: number): number;
}

const plain: LineHighlighter = (t) => escapeHtml(t);

/** Text the view shows: in slices (see TextSlices), or lines read from elsewhere, never made whole (see setLines). */
interface TextModel {
  readonly length: number;
  slice(a?: number, b?: number): string;
}

/** Lines read one at a time, with their index made beforehand (a big document's pretty form: see pretty.ts). */
export interface LineModel extends TextModel {
  /** `ascii`: per line, 1 if it is printable ASCII only (its rows follow from its length, its text needn't be made). */
  readonly index: CodeIndex & { ascii?: Uint8Array };
  /** Line `k`, without its line break. */
  line(k: number): string;
}

export interface FindResult {
  total: number;
  index: number;
  /** Why a query can't match as written (the tree's path search). */
  note?: string;
}

/** A place in the view kept across layouts: offset `col` of `line`, and `dy` px below the start of its row. */
interface ViewAt {
  line: number;
  col: number;
  dy: number;
}

export class CodeView {
  readonly el: HTMLElement;
  private sizer: HTMLElement;
  private sc: TallScroll;
  private rows: HTMLElement;
  private ro: ResizeObserver;
  private model: TextModel | LineModel = TextSlices.from('');
  private lineText = new Map<number, string>();
  private layoutSeq = 0;
  /** The layout in progress when Find last went to a match (see goto). */
  private jumpSeq = -1;
  private textSeq = 0;
  private wrapTextLength = 0;
  /**
   * The wrapper the rows on screen were laid out with. Drawing reads it, not `wrapper`: a big document's
   * next layout takes several steps, and until it is published the rows are still the old wrapper's.
   */
  private layoutWrap: Wrapper | null = null;
  private layoutCols = -1;
  private layoutCw = 0;
  private pending: { text: string; hl: LineHighlighter; json: boolean; scanner: Scanner | null; index?: CodeIndex; change?: CodeChange; patch?: string; lines?: LineModel } | null = null;
  /** Visible lines (folded blocks removed), in order. */
  private vis = new Int32Array(0);
  /** First visual row of each visible line (length = vis + 1). */
  private rowStart = new Int32Array(1);
  /** For a line that opens a foldable block: the line that closes it, else -1. */
  private close = new Int32Array(0);
  /** Nesting depth of each block opener. */
  private depth = new Int32Array(0);
  private folded = new Set<number>();
  private cw = 7.8;
  /** Soft wrap (null: lines run on and the view scrolls sideways). */
  private wrapper: Wrapper | null;
  /** Per visible line: 1 where the browser decides the breaks, CUT for binary (Wrapper.odd). */
  private odd = new Uint8Array(0);
  /** Offset of each line in `text`. */
  private ls = new Int32Array(0);
  private maxLen = 0;
  /** Columns drawn of long lines while not wrapping. */
  private rColA = 0;
  private rColB = 0;
  private hl: LineHighlighter = plain;
  /** Track JSON string state across wrapped rows. */
  private json = false;
  private scanner: Scanner | null = null;
  /** With a scanner: its state at the start of each line. */
  private lineStates = new Int32Array(0);
  /** Long lines drawn around the view while not wrapping: string state at the first column drawn. */
  private strs = new StringStates();
  /** Per wrapped line: string state at each row start (see stringState). */
  private states = new Map<number, number[]>();
  private html = new Map<number, string>();
  /** Labels drawn after a line's text (not part of it: copy and find ignore them). */
  private notes: Map<number, string> | null = null;
  private rFirst = -1;
  private rLast = -1;
  /** translateY of the drawn rows. */
  private y = NaN;
  private raf = 0;
  private width = 0;
  // find
  private q = '';
  private hits: number[] = []; // flat [line, col, line, col, …]
  private hitLines = new Map<number, number[]>();
  private hi = -1;
  private findSeq = 0;
  onFind: ((result: FindResult) => void) | null = null;
  text = '';
  onReady: (() => void) | null = null;
  private fold = escapeHtml(rt('Fold'));
  private unfold = escapeHtml(rt('Unfold'));

  get lineCount() {
    return this.ls.length;
  }

  constructor(el: HTMLElement) {
    this.el = el;
    this.sizer = el.querySelector('.cv-sizer') as HTMLElement;
    this.sc = new TallScroll(el);
    this.rows = el.querySelector('.cv-rows') as HTMLElement;
    this.wrapper = this.makeWrapper();
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('click', this.onClick);
    this.ro = new ResizeObserver(() => {
      // Hidden (display: none): no width to wrap to; the observer fires again when shown.
      if (!el.getClientRects().length) return;
      if (this.fontsStale) this.onFonts();
      else if (this.el.clientWidth !== this.width) this.reflow(true);
      else this.render(true);
    });
    this.ro.observe(el);
    document.fonts?.ready.then(this.onFonts);
    document.fonts?.addEventListener('loadingdone', this.onFonts);
  }

  /** The code font (or its subset for another script) arrived: glyph widths and wrapped rows change. */
  private onFonts = () => {
    // Hidden (another view is open): no width to wrap to. Shown again, the observer applies the font.
    if (this.el.isConnected && !this.el.getClientRects().length) {
      this.fontsStale = true;
      return;
    }
    this.fontsStale = false;
    if (this.pending) return this.reflow(true);
    if (!this.el.isConnected || !this.ls.length) return void this.wrapper?.reset();
    const cw = this.cw;
    this.measure();
    // Rows only move if a width changed; otherwise just redraw in the new glyphs.
    if (this.cw !== cw || this.wrapper?.fontsLoaded() || this.el.clientWidth !== this.width) this.reflow(true);
    else {
      this.html.clear();
      this.render(true);
    }
  };

  /** A font arrived while the view was hidden (see onFonts). */
  private fontsStale = false;

  destroy() {
    this.pending = null;
    this.layoutSeq++;
    this.textSeq++;
    this.findSeq++;
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('click', this.onClick);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    this.wrapper?.destroy();
    if (this.layoutWrap !== this.wrapper) this.layoutWrap?.destroy();
  }

  /** A huge line's estimated rows become exact when idle (see Wrapper.refine): lay out again then. */
  private makeWrapper() {
    const w = new Wrapper(this.el, RH, false);
    w.onRows = () => this.reflow(true);
    return w;
  }

  /** Soft-wraps long lines at the view's width, or lets them run on. */
  setWrap(on: boolean) {
    if (on === !!this.wrapper) return;
    // (The rows on screen keep their wrapper until the new layout is published: see layoutWrap.)
    if (this.wrapper !== this.layoutWrap) this.wrapper?.destroy();
    this.wrapper = on ? this.layoutWrap ?? this.makeWrapper() : null;
    this.el.scrollLeft = 0;
    this.reflow(true);
  }

  /** Puts a small label after each given line (line index → HTML), or clears them. */
  setNotes(notes: Map<number, string> | null) {
    if (!notes && !this.notes) return;
    this.notes = notes;
    this.render(true);
  }

  private lineEnd(i: number) {
    return lineEndIn(this.ls, this.model.length, i);
  }

  private line(i: number) {
    let text = this.lineText.get(i);
    if (text === undefined) {
      const m = this.model;
      text = 'line' in m ? m.line(i) : m.slice(this.ls[i], this.lineEnd(i));
      if (this.lineText.size >= 256) this.lineText.clear();
      this.lineText.set(i, text);
    }
    return text;
  }

  /** Pin the currently acknowledged output for a worker's later patch. */
  snapshotText() {
    const model = this.model;
    return (a: number, b: number) => model.slice(a, b);
  }

  /** Scalar patches retain the acknowledged output's fold pairs and depths. */
  inlineIndex(index: Pick<CodeIndex, 'starts' | 'maxLen'>): CodeIndex {
    return { ...index, close: this.close, depth: this.depth };
  }

  /** `index` can arrive as transferable arrays from the formatting worker. */
  setText(text: string, hl: LineHighlighter, json = false, scanner: Scanner | null = null, index?: CodeIndex, change?: CodeChange, patch?: string, inline = false) {
    const seq = ++this.textSeq;
    const slices = this.model instanceof TextSlices ? this.model : null;
    const same = !!slices && (change ? text.length === this.text.length && change.prefix === text.length : text === this.text);
    if (same && hl === this.hl) {
      if (this.pending) {
        this.pending = null;
        this.layoutSeq++;
        this.reflow(true);
      }
      soon(() => { if (seq === this.textSeq) this.onReady?.(); });
      return;
    }
    if (slices && inline && index && change && patch !== undefined && !this.pending && !scanner && !this.scanner && hl === this.hl && json === this.json && this.patchInline(slices, text, index, change, patch, seq)) return;
    this.pending = { text, hl, json, scanner, index, change, patch };
    const model = slices && change && patch !== undefined ? slices.patch(change.prefix, change.suffix, patch) : TextSlices.from(text);
    const run = index ? null : codeIndexer(text);
    // A big output that came without its change (drawn here, or by a worker that had nothing to compare
    // it with): find it here, so unchanged lines keep their measured wrapping.
    const diff = !change && !scanner && hl === this.hl && text.length >= 2_000_000 && this.text.length >= 2_000_000 ? codeChanger(this.text, text) : null;
    const prepare = () => {
      if (seq !== this.textSeq) return;
      if (diff && !change) {
        change = diff(performance.now() + 8);
        if (!change) return soon(prepare);
        // (A redraw before this one is shown starts from the change found, against the text itself.)
        if (this.pending) {
          this.pending.change = change;
          this.pending.patch = undefined;
        }
      }
      const ready = index ?? run!(text.length < 2_000_000 ? Infinity : performance.now() + 8);
      if (!ready) return soon(prepare);
      if (this.pending) this.pending.index = ready;
      const folded = this.ls.length === ready.starts.length ? new Set(this.folded) : new Set<number>();
      for (const o of folded) if (ready.close[o] < 0) folded.delete(o);
      this.layout(text, ready, folded, scanner, false, -1, () => this.publish(seq, text, model, hl, json, scanner, ready, folded), change, model);
    };
    prepare();
  }

  /**
   * Shows `lines` (a big document's pretty form read off its tape: see pretty.ts): each line is made when
   * drawn, searched or wrapped, and the whole text never is.
   */
  setLines(lines: LineModel, hl: LineHighlighter, json = false) {
    const seq = ++this.textSeq;
    if (lines === this.model && hl === this.hl) {
      if (this.pending) {
        this.pending = null;
        this.layoutSeq++;
        this.reflow(true);
      }
      soon(() => { if (seq === this.textSeq) this.onReady?.(); });
      return;
    }
    const ready = lines.index;
    this.pending = { text: '', hl, json, scanner: null, index: ready, lines };
    const folded = this.ls.length === ready.starts.length ? new Set(this.folded) : new Set<number>();
    for (const o of folded) if (ready.close[o] < 0) folded.delete(o);
    this.layout('', ready, folded, null, false, -1, () => this.publish(seq, '', lines, hl, json, null, ready, folded), undefined, lines);
  }

  /** Makes a laid-out text the one shown (see layout's `commit`). */
  private publish(seq: number, text: string, model: TextModel, hl: LineHighlighter, json: boolean, scanner: Scanner | null, ready: CodeIndex, folded: Set<number>) {
    if (seq !== this.textSeq) return false;
    const keepScroll = this.model.length && model.slice(0, 64) === this.model.slice(0, 64);
    this.pending = null;
    this.text = text;
    this.model = model;
    this.lineText.clear();
    this.hl = hl;
    this.json = json;
    this.scanner = scanner;
    this.ls = ready.starts;
    this.close = ready.close;
    this.depth = ready.depth;
    this.maxLen = ready.maxLen;
    this.folded = folded;
    this.el.style.setProperty('--cv-gw', `${Math.max(3, String(this.ls.length).length) + 5}ch`);
    if (!keepScroll) this.sc.top = 0;
    soon(() => { if (seq === this.textSeq) this.onReady?.(); });
    return true;
  }

  /** A validated scalar changes one line. Keep every other line's wrapping and fold state. */
  private patchInline(slices: TextSlices, text: string, index: CodeIndex, change: CodeChange, patch: string, seq: number): boolean {
    if (index.starts.length !== this.ls.length || this.folded.size || this.vis.length !== this.ls.length || this.layoutWrap !== this.wrapper || this.layoutCols !== (this.wrapper?.cols ?? 0) || this.layoutCw !== this.cw || this.width !== this.el.clientWidth) return false;
    const line = lineOfIn(this.ls, change.prefix);
    if (this.text.length - change.suffix > this.lineEnd(line)) return false;
    const end = line + 1 < index.starts.length ? index.starts[line + 1] - 1 : text.length;
    if (end - index.starts[line] > 65_536) return false;
    const model = slices.patch(change.prefix, change.suffix, patch);
    let rows = 1;
    let odd = 0;
    if (this.wrapper?.cols) {
      const local = model.slice(index.starts[line], end);
      rows = this.wrapper.rows(local, Int32Array.of(0), Int32Array.of(local.length), [0, this.wrapTextLength, local.length])[0];
      this.wrapTextLength = local.length;
      odd = this.wrapper.odd[0];
    }
    const delta = rows - (this.rowStart[line + 1] - this.rowStart[line]);
    const starts = delta ? this.rowStart.slice() : this.rowStart;
    let i = line + 1;
    const layout = ++this.layoutSeq;
    const finish = () => {
      if (seq !== this.textSeq) return;
      if (layout !== this.layoutSeq) {
        this.setText(text, this.hl, this.json, this.scanner, index, change, patch);
        return;
      }
      if (delta) {
        const until = performance.now() + 8;
        for (; i < starts.length; i++) {
          starts[i] += delta;
          if ((i & 8191) === 8191 && performance.now() >= until) { i++; soon(finish); return; }
        }
      }
      this.text = text;
      this.model = model;
      this.ls = index.starts;
      this.close = index.close;
      this.depth = index.depth;
      this.maxLen = index.maxLen;
      this.rowStart = starts;
      this.odd[line] = odd;
      this.lineText.clear();
      this.states.clear();
      this.html.clear();
      this.sc.fit(starts[starts.length - 1] * RH + 24, this.sizer);
      if (!this.wrapper) this.sizer.style.width = `${Math.ceil((Math.max(3, String(this.ls.length).length) + 5 + index.maxLen + 4) * this.cw + PAD_X * 2)}px`;
      if (this.q) this.runFind(false);
      this.render(true);
      soon(() => { if (seq === this.textSeq) this.onReady?.(); });
    };
    finish();
    return true;
  }

  // ── Folding ────────────────────────────────────────────────────────────

  toggle(line: number) {
    if (this.close[line] < 0) return;
    if (this.folded.has(line)) this.folded.delete(line);
    else this.folded.add(line);
    this.reflow(true, line);
  }

  /** The line drawn at a point's height (-1: none), for the context menu. */
  lineAt(y: number) {
    if (!this.vis.length) return -1;
    return this.lineAtRow(Math.max(0, this.rFirst + Math.floor((y - this.rows.getBoundingClientRect().top) / RH)));
  }

  /** The block Fold or Unfold acts on at `line`: the innermost one around it (null: none). */
  foldTarget(line: number): { line: number; folded: boolean } | null {
    if (line < 0) return null;
    if (this.folded.has(line)) return { line, folded: true };
    const close = this.close;
    for (let o = Math.min(line, close.length - 1); o >= 0; o--) if (close[o] >= line) return { line: o, folded: false };
    return null;
  }

  /** Folds every block nested `level` deep or deeper (1 keeps only the outermost block open). */
  foldLevel(level: number) {
    this.folded.clear();
    for (let i = 0; i < this.close.length; i++) if (this.close[i] >= 0 && this.depth[i] >= level) this.folded.add(i);
    this.sc.top = 0;
    this.reflow(false);
  }

  unfoldAll() {
    this.folded.clear();
    this.reflow(true);
  }

  /** Unfolds every block hiding `line`. */
  private reveal(line: number) {
    let changed = false;
    for (const o of this.folded) {
      if (o < line && this.close[o] >= line) {
        this.folded.delete(o);
        changed = true;
      }
    }
    if (changed) this.reflow(true);
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  /** Recomputes visible lines and wrapping (on text, fold or width changes). */
  private reflow(keepPosition: boolean, anchor = -1) {
    if (this.pending) {
      const p = this.pending;
      if (p.lines) this.setLines(p.lines, p.hl, p.json);
      else this.setText(p.text, p.hl, p.json, p.scanner, p.index, p.change, p.patch);
      return;
    }
    this.layout(this.text, { starts: this.ls, close: this.close, depth: this.depth, maxLen: this.maxLen }, this.folded, this.scanner, keepPosition, anchor);
  }

  /** Prepare a replacement away from the live model, then publish it in one short task. */
  private layout(text: string, index: CodeIndex, folded: Set<number>, scanner: Scanner | null, keepPosition: boolean, anchor: number, commit = () => true, change?: CodeChange, model: TextModel = this.model) {
    const seq = ++this.layoutSeq;
    // Where the view is, read before the wrapper is fitted to a new width: the rows on screen are its.
    const top = this.sc.top;
    let at = keepPosition || anchor >= 0 ? this.viewAt(anchor) : null;
    this.width = this.el.clientWidth;
    this.measure();
    const gutter = (Math.max(3, String(index.starts.length).length) + 5) * this.cw;
    const wr = this.wrapper;
    const resized = wr?.fit(this.width - gutter - PAD_X * 2, this.cw);
    if (resized && wr) this.el.style.setProperty('--cv-tw', `${wr.width}px`);
    const cols = wr?.cols ?? 0;
    const cw = this.cw;
    const reuse = change && !scanner && !resized && cols === this.layoutCols && cw === this.layoutCw && wr === this.layoutWrap && !folded.size && !this.folded.size && this.vis.length === this.ls.length ? change : null;
    const n = index.starts.length;
    const size = model.length;
    const small = size < 2_000_000;
    const vis = new Int32Array(n);
    const rs = new Int32Array(n + 1);
    const odd = new Uint8Array(n);
    const states = scanner ? new Int32Array(n) : this.lineStates;
    let i = 0;
    let count = 0;
    let rows = 0;
    let state = scanner?.start ?? 0;
    const endOf = (ln: number) => ln + 1 < n ? index.starts[ln + 1] - 1 : size;
    const ascii = 'line' in model ? (model as LineModel).index.ascii : undefined;
    const batchMax = ascii ? 8192 : 512;
    const step = () => {
      if (seq !== this.layoutSeq) return;
      const until = small ? Infinity : performance.now() + 8;
      do {
        const batch: number[] = [];
        const base = index.starts[i];
        // Large outputs bound each wrapper call; small documents keep one shared glyph/layout pass.
        // (Lines read one at a time with ASCII marks are mostly counted, not measured: bigger batches, bound
        // by the text of the others, which is made and measured.)
        let made = 0;
        for (; i < n && (small || batch.length < batchMax); i++) {
          if (!small && !ascii && batch.length && endOf(i) - base > 64_000) break;
          if (!small && ascii && !ascii[i] && batch.length && (made += endOf(i) - index.starts[i]) > 64_000) break;
          if (scanner) {
            states[i] = state;
            state = scanner.scan(text, index.starts[i], Math.min(text.length, endOf(i) + 1), state);
          }
          batch.push(i);
          if (folded.has(i)) {
            const close = index.close[i];
            if (scanner) for (let k = i + 1; k <= close; k++) {
              states[k] = state;
              state = scanner.scan(text, index.starts[k], Math.min(text.length, endOf(k) + 1), state);
            }
            i = close;
          }
        }
        if (!batch.length) break;
        const cached = reuse ? batch.map((ln) => {
          const old = endOf(ln) < reuse.prefix ? ln : index.starts[ln] >= size - reuse.suffix ? ln + this.ls.length - n : -1;
          if (old < 0 || old >= this.ls.length) return -1;
          return this.lineEnd(old) - this.ls[old] === endOf(ln) - index.starts[ln] ? old : -1;
        }) : null;
        const missing = cached ? batch.filter((_, k) => cached[k] < 0) : batch;
        let wrapped: Int32Array | null = null;
        let wodd: Uint8Array | null = null;
        if (wr?.cols && missing.length && ascii) {
          // Lines made one at a time: a printable ASCII one's rows follow from its length (as Wrapper.rows
          // counts them); only the others are made and measured.
          wrapped = new Int32Array(missing.length);
          wodd = new Uint8Array(missing.length);
          const slow: number[] = [];
          for (let k = 0; k < missing.length; k++) {
            const ln = missing[k];
            if (ascii[ln]) wrapped[k] = asciiRows(endOf(ln) - index.starts[ln], wr.cols);
            else slow.push(k);
          }
          if (slow.length) {
            const parts = slow.map((k) => (model as LineModel).line(missing[k]));
            const local = parts.join('\n');
            const a = new Int32Array(slow.length);
            const b = new Int32Array(slow.length);
            for (let j = 0, at = 0; j < slow.length; j++) {
              a[j] = at;
              b[j] = at += parts[j].length;
              at++;
            }
            const got = wr.rows(local, a, b, [0, this.wrapTextLength, local.length]);
            this.wrapTextLength = local.length;
            for (let j = 0; j < slow.length; j++) {
              wrapped[slow[j]] = got[j];
              wodd[slow[j]] = wr.odd[j];
            }
          }
        } else if (wr?.cols && missing.length) {
          const local = model.slice(base, endOf(batch[batch.length - 1]));
          const a = Int32Array.from(missing, (ln) => index.starts[ln] - base);
          const b = Int32Array.from(missing, (ln) => endOf(ln) - base);
          wrapped = wr.rows(local, a, b, [0, this.wrapTextLength, local.length]);
          wodd = wr.odd;
          this.wrapTextLength = local.length;
        }
        let measured = 0;
        for (let k = 0; k < batch.length; k++) {
          const ln = batch[k];
          const old = cached ? cached[k] : -1;
          vis[count] = ln;
          rs[count] = rows;
          if (old >= 0) {
            odd[count++] = this.odd[old];
            rows += this.rowStart[old + 1] - this.rowStart[old];
          } else {
            odd[count++] = wodd ? wodd[measured] : 0;
            rows += wrapped && !folded.has(ln) ? wrapped[measured] : 1;
            measured++;
          }
        }
      } while (i < n && performance.now() < until);
      if (i < n) return soon(step);
      // (Scrolled while this layout was made, at the same width: kept from where it is now.)
      if (at && !resized && this.sc.top !== top) at = this.viewAt(anchor);
      if (!commit()) return;
      rs[count] = rows;
      if (this.layoutWrap !== wr && this.layoutWrap !== this.wrapper) this.layoutWrap?.destroy();
      this.layoutWrap = wr;
      this.el.classList.toggle('cv-nowrap', !wr);
      this.layoutCols = cols;
      this.layoutCw = cw;
      this.vis = vis.subarray(0, count);
      this.rowStart = rs.subarray(0, count + 1);
      this.odd = odd.subarray(0, count);
      this.lineStates = states;
      this.states.clear();
      this.html.clear();
      this.sc.fit(rows * RH + 24, this.sizer);
      this.sizer.style.width = wr ? '' : `${Math.ceil(gutter + (index.maxLen + 4) * this.cw + PAD_X * 2)}px`;
      if (at) this.scrollBack(at);
      // (Find went to a match while these rows were made: it goes to it again in them.)
      if (this.q) this.runFind(this.jumpSeq === seq, true);
      this.render(true);
    };
    step();
  }

  private measure() {
    const probe = document.createElement('span');
    probe.className = 'cv-c';
    probe.textContent = '0'.repeat(200);
    // (Without the code's right padding, which is no character's width: counted in, every column drifted.)
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;padding:0';
    this.rows.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 200;
    probe.remove();
    if (w > 0) this.cw = w;
  }

  /** Index into `vis` of the visible line containing visual row `row`. */
  private visOfRow(row: number) {
    const rs = this.rowStart;
    let lo = 0;
    let hi = this.vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rs[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  private lineAtRow(row: number) {
    return this.vis.length ? this.vis[this.visOfRow(row)] : 0;
  }

  /** Index into `vis` of `line` (or of the folded block that contains it). */
  private visIndex(line: number) {
    const vis = this.vis;
    let lo = 0;
    let hi = vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (vis[mid] <= line) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** First visual row of `line` (or of the folded block that contains it). */
  private rowOfLine(line: number) {
    return this.rowStart[this.visIndex(line)] ?? 0;
  }

  /** The wrapped row of visible line `vi` holding offset `col`: the last row starting at or before it. */
  private subOf(vi: number, col: number) {
    let sub = 0;
    let hi = this.rowStart[vi + 1] - this.rowStart[vi] - 1;
    while (sub < hi && col > 0) {
      const mid = (sub + hi + 1) >> 1;
      if (this.subStart(vi, mid) <= col) sub = mid;
      else hi = mid - 1;
    }
    return sub;
  }

  /**
   * Where the view is, to keep across a new layout: line `anchor` where it is on screen; else the character
   * the top row starts with (rows above it inside a wrapped line may change) and how far into that row.
   */
  private viewAt(anchor: number): ViewAt | null {
    const top = this.sc.top;
    if (anchor >= 0) return { line: anchor, col: 0, dy: top - this.rowOfLine(anchor) * RH };
    if (!this.vis.length) return null;
    const row = Math.floor(top / RH);
    const vi = this.visOfRow(row);
    const sub = row - this.rowStart[vi];
    // (A block's rows are the browser's: kept by height.)
    if (sub > 0 && this.isBlock(vi)) return { line: this.vis[vi], col: 0, dy: top - this.rowStart[vi] * RH };
    return { line: this.vis[vi], col: sub > 0 ? this.subStart(vi, sub) : 0, dy: top - row * RH };
  }

  /** Scrolls to `at` (see viewAt) in the rows now laid out. */
  private scrollBack(at: ViewAt) {
    const vi = this.visIndex(at.line);
    const sub = this.subOf(vi, at.col);
    const rest = (this.rowStart[vi + 1] - this.rowStart[vi] - sub) * RH;
    this.sc.top = Math.max(0, (this.rowStart[vi] + sub) * RH + Math.min(at.dy, rest));
  }

  /** Offset in visible line `vi` where its wrapped row `sub` starts. */
  private subStart(vi: number, sub: number) {
    const ln = this.vis[vi];
    const len = this.line(ln).length;
    if (sub <= 0) return 0;
    if (sub >= this.rowStart[vi + 1] - this.rowStart[vi]) return len;
    const line = this.line(ln);
    // (With the row width the rows on screen were counted at: the wrapper may already have a new one.)
    return (this.layoutWrap as Wrapper).rowStart(line, 0, len, sub, this.odd[vi], this.layoutCols);
  }

  /** Is visible line `vi` drawn as one block the browser wraps (wide glyphs, not long, not garbage: see Wrapper.summed)? */
  private isBlock(vi: number) {
    return this.odd[vi] === 1 && this.rowStart[vi + 1] - this.rowStart[vi] > 1 && this.line(this.vis[vi]).length <= LONG_LINE;
  }

  /** Highlighter state at the start of wrapped row `sub` of visible line `vi` (JSON strings, or the scanner's). */
  private stateAt(vi: number, sub: number): number {
    const sc = this.scanner;
    const ln = this.vis[vi];
    if (!sc && (!this.json || sub === 0)) return 0;
    let st = this.states.get(ln);
    if (!st) this.states.set(ln, (st = [sc ? this.lineStates[ln] : 0]));
    const line = this.line(ln);
    const at = this.ls[ln];
    for (let k = st.length; k <= sub; k++) {
      const a = this.subStart(vi, k - 1);
      const b = this.subStart(vi, k);
      st.push(sc ? sc.scan(this.text, at + a, at + b, st[k - 1]) : stringState(line, a, b, st[k - 1]));
    }
    return st[sub];
  }

  private onScroll = () => {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
  };

  private onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
    if (t) this.toggle(Number(t.dataset.f));
  };

  render(force: boolean) {
    const el = this.el;
    const st = this.sc.top;
    const vh = el.clientHeight;
    const total = this.rowStart[this.vis.length] ?? 0;
    const vf = Math.floor(st / RH);
    const vl = Math.min(total, Math.ceil((st + vh) / RH));
    // Not wrapping: long lines are drawn only around the columns in view.
    const wide = !this.layoutWrap && this.maxLen > LONG_LINE;
    const vcA = wide ? Math.max(0, Math.floor(el.scrollLeft / this.cw) - 12) : 0;
    const vcB = vcA + Math.ceil(el.clientWidth / this.cw) + 12;
    if (!force && vf >= this.rFirst && vl <= this.rLast && (!wide || (vcA >= this.rColA && vcB <= this.rColB))) return this.place();
    let first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(total, vl + OVERSCAN);
    let vi = total ? this.visOfRow(first) : 0;
    // A line drawn as one block starts at its first row.
    if (total && this.isBlock(vi)) first = this.rowStart[vi];
    // Rows drawn earlier are kept for scrolling back, within reason.
    if ((wide && (vcA < this.rColA || vcB > this.rColB)) || this.html.size > 4000) this.html.clear();
    this.rFirst = first;
    this.rLast = last;
    this.rColA = wide ? Math.max(0, vcA - H_OVERSCAN) : 0;
    this.rColB = wide ? vcB + H_OVERSCAN : Infinity;
    const cur = this.hi >= 0 ? this.hits[this.hi * 2] : -1;
    const curCol = this.hi >= 0 ? this.hits[this.hi * 2 + 1] : -1;
    const qn = this.q.length;
    let out = '';
    let place = false;
    for (let row = first; row < last; row++) {
      while (vi + 1 < this.vis.length && this.rowStart[vi + 1] <= row) vi++;
      const ln = this.vis[vi];
      const sub = row - this.rowStart[vi];
      const rows = this.rowStart[vi + 1] - this.rowStart[vi];
      const foldedHere = this.folded.has(ln);
      const line = this.line(ln);
      const block = this.isBlock(vi);
      // This row's slice of the line: [a, b).
      let a = 0;
      let b = line.length;
      if (rows > 1 && !block) {
        a = this.subStart(vi, sub);
        b = this.subStart(vi, sub + 1);
      } else if (wide && b > LONG_LINE) {
        a = Math.min(b, this.rColA);
        b = Math.min(b, this.rColB);
      }
      // A row of other scripts drawn alone gets its neighbours as bidi context.
      const ctx = rows > 1 && !block && this.odd[vi] !== 0;
      let h = this.html.get(row);
      if (h === undefined) {
        const sc = this.scanner;
        const s = sc
          ? rows > 1 ? this.stateAt(vi, sub) : sc.scan(this.text, this.ls[ln], this.ls[ln] + a, this.lineStates[ln])
          : !this.json || !a ? 0 : rows > 1 ? this.stateAt(vi, sub) : this.strs.at(line, 0, a);
        const se = ctx && b < line.length ? trimWs(line, a, b) : b;
        h = this.hl(a || se < line.length ? line.slice(a, se) : line, (s & 1) === 1, (s & 2) === 2, s, this.text, this.ls[ln] + a);
        if (ctx) h = `${bidiContext(line, Math.max(0, a - 64), a, true)}${h}${bidiContext(line, b, Math.min(line.length, b + 64), false)}${escapeHtml(line.slice(se, b))}`;
        if (foldedHere) {
          const end = this.close[ln];
          const n = end - ln - 1;
          h += `<button type="button" class="cv-ph" data-f="${ln}" title="${this.unfold}">⋯ ${escapeHtml(rt.n(n, '{n} line', '{n} lines'))}</button>${this.hl(this.line(end).trim(), false, false, 0)}`;
        }
        this.html.set(row, h);
      }
      // Find highlights for this row's part of each match. Wide glyphs: placed
      // by their rects once drawn (a block's match may span rows).
      const pad = rows === 1 && a ? a * this.cw : 0;
      let marks = '';
      const lh = this.q ? this.hitLines.get(ln) : undefined;
      if (lh) {
        for (const col of lh) {
          if (col >= b || col + qn <= a) continue;
          const from = Math.max(col, a);
          const to = Math.min(col + qn, b);
          const cls = `cv-hit${ln === cur && col === curCol ? ' cur' : ''}`;
          if (this.odd[vi] !== 0 && this.layoutWrap) {
            marks += `<i class="${cls}" data-h="${from - a}" data-n="${to - from}"></i>`;
            place = true;
          } else marks += `<i class="${cls}" style="left:${(pad + (from - a) * this.cw).toFixed(1)}px;width:${((to - from) * this.cw).toFixed(1)}px"></i>`;
        }
      }
      let gut: string;
      if (sub) gut = '';
      else if (this.close[ln] >= 0) gut = `<b class="cv-f${foldedHere ? ' c' : ''}" data-f="${ln}" title="${foldedHere ? this.unfold : this.fold}"></b>${ln + 1}`;
      else gut = String(ln + 1);
      const note = this.notes?.get(ln);
      const tail = note && b >= line.length ? note : '';
      const sp = pad ? `<i class="cv-sp" style="width:${pad.toFixed(1)}px"></i>` : '';
      out += `<div class="cv-l${block ? ' cv-b' : ''}"><span class="cv-n">${gut}</span><span class="cv-c">${sp}${marks}${h || ' '}${tail}</span></div>`;
      if (block) row += rows - 1;
    }
    this.rows.innerHTML = out;
    this.place();
    if (place) this.placeHits();
  }

  /** Positions the drawn rows (they move with the scroll offset when it's scaled, see TallScroll). */
  private place() {
    const y = this.rFirst * RH + this.sc.shift;
    if (y !== this.y) this.rows.style.transform = `translateY(${(this.y = y)}px)`;
  }

  /** Puts find highlights on text the browser lays out (wide glyphs) over the matched characters, one box per row. */
  private placeHits() {
    const rg = document.createRange();
    for (const mark of this.rows.querySelectorAll<HTMLElement>('i[data-h]')) {
      const c = mark.parentElement as HTMLElement;
      if (!textRange(rg, c, Number(mark.dataset.h), Number(mark.dataset.n))) continue;
      const box = c.getBoundingClientRect();
      let at: Element = mark;
      for (const r of rg.getClientRects()) {
        if (!r.width) continue;
        const el = at === mark && !mark.style.cssText ? mark : (mark.cloneNode() as HTMLElement);
        el.style.cssText = `left:${(r.left - box.left).toFixed(1)}px;top:${(r.top - box.top).toFixed(1)}px;width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px;bottom:auto`;
        if (el !== mark) at.after(el);
        at = el;
      }
    }
  }

  // ── Find ───────────────────────────────────────────────────────────────

  find(q: string): FindResult {
    this.q = q;
    this.runFind(true);
    this.render(true);
    return { total: this.hits.length / 2, index: this.hi };
  }

  step(dir: 1 | -1): FindResult {
    const n = this.hits.length / 2;
    if (n) {
      this.hi = (this.hi + dir + n) % n;
      this.goto();
    }
    return { total: n, index: this.hi };
  }

  /** `keep`: run again (a new layout or text), the match that was current stays so if it is still there. */
  private runFind(jump: boolean, keep = !jump) {
    const seq = ++this.findSeq;
    const was = keep && this.hi >= 0 ? this.hits.slice(this.hi * 2, this.hi * 2 + 2) : null;
    this.hits = [];
    this.hitLines.clear();
    this.hi = -1;
    const q = this.q;
    if (!q) return;
    // Smart case: lowercase queries match any case.
    const cs = q !== q.toLowerCase();
    // (İ is the one character whose lowercase is longer: as i, every offset still maps.)
    const fold = (t: string) => t.replace(/\u0130/g, 'i').toLowerCase();
    const qn = cs ? q : fold(q);
    const n = this.model.length;
    const ls = this.ls;
    const hits = this.hits;
    let next = 0;
    const add = (at: number) => {
      // (Matches don't overlap, across chunk edges too.)
      if (at < next) return;
      next = at + qn.length;
      // The line holding offset `at` (a query has no line break, so a match stays in one line).
      const ln = lineOfIn(ls, at);
      hits.push(ln, at - ls[ln]);
      let cols = this.hitLines.get(ln);
      if (!cols) this.hitLines.set(ln, (cols = []));
      cols.push(at - ls[ln]);
    };
    // Big chunks of the whole text with the native search (a line at a time costs a slice and a
    // lowercase copy per line); in 8 ms steps for a big output, so typing is never held up.
    const CHUNK = 1 << 20;
    let pos = 0;
    const run = () => {
      if (seq !== this.findSeq) return;
      const until = n < 2_000_000 ? Infinity : performance.now() + 8;
      while (pos < n && hits.length < MAX_HITS * 2) {
        const end = Math.min(n, pos + CHUNK);
        const raw = this.model.slice(pos, Math.min(n, end + qn.length - 1));
        const part = cs ? raw : fold(raw);
        for (let p = part.indexOf(qn); p >= 0 && pos + p < end && hits.length < MAX_HITS * 2; p = part.indexOf(qn, p + qn.length)) add(pos + p);
        pos = end;
        if (performance.now() >= until) return void soon(run);
      }
      if (hits.length) {
        let i = 0;
        if (was) while (i * 2 < hits.length && (hits[i * 2] < was[0] || (hits[i * 2] === was[0] && hits[i * 2 + 1] < was[1]))) i++;
        if (!was || hits[i * 2] !== was[0] || hits[i * 2 + 1] !== was[1]) {
          // Start from the first match at or below the top of the view.
          const top = this.lineAtRow(Math.floor(this.sc.top / RH));
          i = 0;
          while (i * 2 < hits.length && hits[i * 2] < top) i++;
        }
        this.hi = i * 2 < hits.length ? i : 0;
        if (jump) this.goto();
      }
      this.render(true);
      this.onFind?.({ total: hits.length / 2, index: this.hi });
    };
    run();
  }

  private goto() {
    this.jumpSeq = this.layoutSeq;
    const ln = this.hits[this.hi * 2];
    const col = this.hits[this.hi * 2 + 1];
    this.reveal(ln);
    const vi = this.visIndex(ln);
    const y = (this.rowStart[vi] + this.subOf(vi, col)) * RH;
    const el = this.el;
    const vh = el.clientHeight;
    const st = this.sc.top;
    if (y < st || y + RH > st + vh) this.sc.top = Math.max(0, y - vh / 2 + RH);
    if (!this.layoutWrap) {
      const x = col * this.cw;
      const view = el.clientWidth - 80;
      if (x < el.scrollLeft || x > el.scrollLeft + view) el.scrollLeft = Math.max(0, x - view / 3);
    }
    this.render(true);
  }
}

/** Sets `rg` to `len` characters of `el`'s text from offset `from` (text nodes in order, bidi context aside). */
function textRange(rg: Range, el: HTMLElement, from: number, len: number) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement as HTMLElement).closest('.ctx') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  let pos = 0;
  let started = false;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const end = pos + n.length;
    if (!started && from < end) {
      rg.setStart(n, from - pos);
      started = true;
    }
    if (started && from + len <= end) {
      rg.setEnd(n, from + len - pos);
      return true;
    }
    pos = end;
  }
  return false;
}
