import { highlightLine, type Mark } from './highlight';

/*
 * The document lives in `text` (the model). Two presentations:
 *
 *  - Edit mode: a native <textarea> (caret, selection, IME, accessibility)
 *    sized to its full content, layered over a virtualized syntax-highlighted
 *    copy of the visible lines. Both share one scroll container, so they move
 *    together natively: no scroll lag.
 *  - View mode (huge documents): browsers lay out every line of a textarea,
 *    which takes seconds at hundreds of thousands of lines. We drop the
 *    textarea and show only the virtualized highlighted view: instant at any
 *    size, still selectable, formattable and undoable. "Edit anyway" opts in.
 *
 * Undo/redo is ours (browser undo is lost on programmatic changes and is tied
 * to slow DOM editing commands).
 */

export const LH = 20;
const PAD_T = 10;
const PAD_B = 48;
const PAD_L = 16;
const PAD_R = 48;
const OVERSCAN = 40;
const LONG_LINE = 3000;
const H_OVERSCAN = 600;
/** Above these sizes the editor switches to view mode. */
const VIEW_CHARS = 2_000_000;
const VIEW_LINES = 30_000;
/** Must match `tab-size` in CSS. */
const TAB = 4;

export type ChangeKind = 'input' | 'paste' | 'set';

export interface EditorEvents {
  change(kind: ChangeKind): void;
  caret(): void;
  /** Caret moved by the user (click / keyboard navigation), not by typing. */
  nav(): void;
  escape(): void;
  /** Entered / left view mode. */
  mode(view: boolean): void;
  /** Copy the whole document (view mode has no textarea to copy from). */
  copyAll(): void;
}

export interface Diagnostic {
  p: number;
  cls: 'me' | 'mw';
}

interface Change {
  a: number;
  del: string;
  ins: string;
  selB: [number, number];
  selA: [number, number];
  t: number;
  kind: 'type' | 'del' | 'other';
}

const LINE_MARK = ['', 'dla', 'dld', 'dlc'];

/** Textareas normalize line endings; the model must match them offset for offset. */
const lf = (s: string) => (s.indexOf('\r') === -1 ? s : s.replace(/\r\n?/g, '\n'));

/** Counts line breaks in `s`, stopping early at `cap`. */
function countLines(s: string, cap: number) {
  let n = 0;
  for (let p = s.indexOf('\n'); p !== -1 && n < cap; p = s.indexOf('\n', p + 1)) n++;
  return n;
}

export class Editor {
  readonly el: HTMLElement;
  readonly ta: HTMLTextAreaElement;
  private gut: HTMLElement;
  private gl: HTMLElement;
  private body: HTMLElement;
  private hl: HTMLElement;
  private cur: HTMLElement;
  private scopeEl: HTMLElement;
  private ev: EditorEvents;

  /** The document. */
  text = '';
  /** Line start offsets. */
  ls: number[] = [0];
  /** Read-only virtualized presentation for huge documents. */
  view = false;
  indentUnit = '  ';
  /** Last paste replaced the whole document. */
  pasteFull = false;

  private forceEdit = false;
  private vcaret = 0;
  /** After Esc, the next Tab moves focus instead of indenting (no keyboard trap). */
  private tabMovesFocus = false;
  /** Text before an IME composition started (recorded as one undo step). */
  private compOld: string | null = null;
  private cw = 7.8;
  private maxCols = 0;
  private extraW = 0;
  private gutW = 0;
  private diag = new Map<number, Mark[]>();
  private diagCls = new Map<number, string>();
  private brackets: Mark[] = [];
  private scope: [number, number] | null = null;
  /** Exact offsets of the selected node when it sits on one line (minified docs). */
  private scopeMark: Mark | null = null;
  /** Compare: per-line diff marks (1 added, 2 removed, 3 changed). */
  private lineMarks: Uint8Array | null = null;
  private rFirst = -1;
  private rLast = -1;
  private rColA = 0;
  private rColB = 0;
  private raf = 0;
  private typing = false;
  private selBefore: [number, number] = [0, 0];
  private undo_: Change[] = [];
  private redo_: Change[] = [];
  private histChars = 0;
  private caretLine = 0;
  private ro: ResizeObserver;

  constructor(el: HTMLElement, ev: EditorEvents) {
    this.el = el;
    this.ev = ev;
    this.gut = el.querySelector('.ed-gut') as HTMLElement;
    this.gl = el.querySelector('.ed-gl') as HTMLElement;
    this.body = el.querySelector('.ed-body') as HTMLElement;
    this.hl = el.querySelector('.ed-hl') as HTMLElement;
    this.cur = el.querySelector('.ed-cur') as HTMLElement;
    this.scopeEl = el.querySelector('.ed-scope') as HTMLElement;
    this.ta = el.querySelector('textarea') as HTMLTextAreaElement;
    this.measure();
    el.classList.add('hl-on');

    const ta = this.ta;
    ta.addEventListener('beforeinput', this.onBeforeInput);
    ta.addEventListener('input', this.onInput);
    ta.addEventListener('keydown', this.onKey);
    ta.addEventListener('paste', this.onPaste);
    ta.addEventListener('mousedown', this.onPointer);
    ta.addEventListener('scroll', this.onTaScroll);
    ta.addEventListener('focus', this.onFocus);
    ta.addEventListener('blur', this.onFocus);
    ta.addEventListener('compositionstart', this.onCompStart);
    ta.addEventListener('compositionend', this.onCompEnd);
    el.addEventListener('scroll', this.onScroll, { passive: true });
    el.addEventListener('keydown', this.onViewKey);
    el.addEventListener('mouseup', this.onViewClick);
    el.addEventListener('paste', this.onViewPaste);
    document.addEventListener('selectionchange', this.onSel);
    this.ro = new ResizeObserver(() => {
      if (!this.measured) this.measure();
      this.layout();
      this.render(true);
    });
    this.ro.observe(el);
    this.model(ta.value, true);
    // The code font may arrive after first paint: re-measure glyph width then.
    document.fonts?.ready.then(() => {
      if (!this.el.isConnected) return;
      this.measure();
      this.layout();
      this.render(true);
    });
  }

  destroy() {
    const ta = this.ta;
    ta.removeEventListener('beforeinput', this.onBeforeInput);
    ta.removeEventListener('input', this.onInput);
    ta.removeEventListener('keydown', this.onKey);
    ta.removeEventListener('paste', this.onPaste);
    ta.removeEventListener('mousedown', this.onPointer);
    ta.removeEventListener('scroll', this.onTaScroll);
    ta.removeEventListener('focus', this.onFocus);
    ta.removeEventListener('blur', this.onFocus);
    ta.removeEventListener('compositionstart', this.onCompStart);
    ta.removeEventListener('compositionend', this.onCompEnd);
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('keydown', this.onViewKey);
    this.el.removeEventListener('mouseup', this.onViewClick);
    this.el.removeEventListener('paste', this.onViewPaste);
    document.removeEventListener('selectionchange', this.onSel);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('hl-on', 'vmode');
    if (this.view) ta.value = this.text;
  }

  private measured = false;

  private measure() {
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(400);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    this.hl.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 400;
    probe.remove();
    // A hidden editor (e.g. Compare's, before its tab opens) measures 0: retry when shown.
    this.measured = w > 0;
    if (w > 0) this.cw = w;
  }

  // ── Model ──────────────────────────────────────────────────────────────

  /**
   * Sets the document and refreshes everything derived from it.
   * `fromTa`: the textarea already holds `t` (user input).
   */
  private model(t: string, fromTa: boolean) {
    this.text = t;
    const ls = [0];
    let maxLen = 0;
    let prev = 0;
    for (let p = t.indexOf('\n'); p !== -1; p = t.indexOf('\n', p + 1)) {
      if (p - prev > maxLen) maxLen = p - prev;
      ls.push(p + 1);
      prev = p + 1;
    }
    if (t.length - prev > maxLen) maxLen = t.length - prev;
    this.ls = ls;
    if (maxLen && t.indexOf('\t') !== -1) maxLen = this.visualMax();
    this.maxCols = maxLen;
    this.extraW = 0;

    // Typing never flips an open editor into view mode; loads and big pastes do.
    const big = t.length > VIEW_CHARS || ls.length > VIEW_LINES;
    const view = !this.forceEdit && big && !(fromTa && !this.view);
    if (view) {
      if (!this.view) this.vcaret = Math.min(this.ta.selectionStart, t.length);
      if (this.ta.value) this.ta.value = '';
    } else if (!fromTa) {
      this.ta.value = t;
    }
    if (view !== this.view) {
      this.view = view;
      this.el.classList.toggle('vmode', view);
      this.el.tabIndex = view ? 0 : -1;
      this.ev.mode(view);
      this.ev.caret();
    }
    this.updateCaret();
    this.layout();
    this.render(true);
  }

  /** Sets the initial document (no undo step). */
  init(text: string) {
    this.model(lf(text), false);
  }

  /** Loads a huge document into the textarea anyway (slow once, then editable). */
  editAnyway() {
    this.forceEdit = true;
    const caret = this.vcaret;
    this.model(this.text, false);
    this.focus();
    this.setCaret(caret);
  }

  private visualMax() {
    const t = this.text;
    let max = 0;
    for (let ln = 0; ln < this.ls.length; ln++) {
      const a = this.ls[ln];
      const b = this.lineEnd(ln);
      let col = 0;
      for (let i = a; i < b; i++) col = t.charCodeAt(i) === 9 ? col + TAB - (col % TAB) : col + 1;
      if (col > max) max = col;
    }
    return max;
  }

  lineEnd(ln: number) {
    return ln + 1 < this.ls.length ? this.ls[ln + 1] - 1 : this.text.length;
  }

  lineOf(off: number) {
    const ls = this.ls;
    let lo = 0;
    let hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  lineCol(off: number) {
    const line = this.lineOf(off);
    return { line: line + 1, col: off - this.ls[line] + 1 };
  }

  get caret() {
    return this.view ? this.vcaret : this.ta.selectionStart;
  }

  get selection(): [number, number] {
    return this.view ? [this.vcaret, this.vcaret] : [this.ta.selectionStart, this.ta.selectionEnd];
  }

  selectedText() {
    if (this.view) return window.getSelection()?.toString() ?? '';
    return this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
  }

  focus() {
    if (this.view) this.el.focus({ preventScroll: true });
    else this.ta.focus({ preventScroll: true });
  }

  hasFocus() {
    const a = document.activeElement;
    return a === this.ta || a === this.el;
  }

  setCaret(off: number) {
    off = Math.max(0, Math.min(off, this.text.length));
    if (this.view) this.vcaret = off;
    else this.ta.setSelectionRange(off, off);
    if (this.updateCaret()) this.render(true);
    this.reveal(off, true);
  }

  // ── Layout & rendering ─────────────────────────────────────────────────

  private layout() {
    const lines = this.ls.length;
    const gw = Math.round(Math.max(3, String(lines).length) * this.cw + 32);
    if (gw !== this.gutW) {
      this.gutW = gw;
      this.el.style.setProperty('--gw', gw + 'px');
    }
    const w = Math.ceil(this.maxCols * this.cw) + PAD_L + PAD_R + this.extraW;
    const h = lines * LH + PAD_T + PAD_B;
    this.body.style.width = w + 'px';
    this.body.style.height = h + 'px';
    this.gut.style.height = h + 'px';
  }

  private onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private frame = () => {
    this.raf = 0;
    this.render(false);
  };

  private onTaScroll = () => {
    const ta = this.ta;
    // The textarea never scrolls itself; if a line is wider than our estimate
    // (wide glyphs), grow the content instead.
    if (ta.scrollLeft || ta.scrollTop) {
      if (ta.scrollLeft) this.extraW += ta.scrollLeft + 200;
      const { scrollLeft, scrollTop } = ta;
      ta.scrollLeft = 0;
      ta.scrollTop = 0;
      this.layout();
      this.el.scrollLeft += scrollLeft;
      this.el.scrollTop += scrollTop;
    }
  };

  render(force: boolean) {
    const n = this.ls.length;
    const st = this.el.scrollTop;
    const vh = this.el.clientHeight;
    const vf = Math.max(0, Math.floor((st - PAD_T) / LH));
    const vl = Math.min(n, Math.ceil((st + vh - PAD_T) / LH));
    const wide = this.maxCols > LONG_LINE;
    const vcA = Math.max(0, Math.floor((this.el.scrollLeft - PAD_L) / this.cw));
    const vcB = vcA + Math.ceil(this.el.clientWidth / this.cw);
    if (!force && vf >= this.rFirst && vl <= this.rLast && (!wide || (vcA >= this.rColA && vcB <= this.rColB))) return;

    const first = Math.max(0, vf - OVERSCAN);
    const last = Math.min(n, vl + OVERSCAN);
    const colA = wide ? Math.max(0, vcA - H_OVERSCAN) : 0;
    const colB = wide ? vcB + H_OVERSCAN : Infinity;
    this.rFirst = first;
    this.rLast = last;
    this.rColA = colA;
    this.rColB = colB;

    const t = this.text;
    let html = '';
    for (let ln = first; ln < last; ln++) {
      const a = this.ls[ln];
      const b = this.lineEnd(ln);
      const marks = this.marksFor(ln);
      const lm = this.lineMarks ? this.lineMarks[ln] : 0;
      const open = lm ? `<div class="${LINE_MARK[lm]}">` : '<div>';
      if (b - a > LONG_LINE && wide) {
        let sa = Math.min(b, a + colA);
        const sb = Math.min(b, a + colB);
        sa = this.stringStart(a, sa);
        const pad = (sa - a) * this.cw;
        html += `${open}<i class="ed-sp" style="width:${pad}px"></i>${highlightLine(t, sa, sb, marks, sb === b)}</div>`;
      } else {
        html += `${open}${highlightLine(t, a, b, marks)}</div>`;
      }
    }
    this.hl.style.transform = `translateY(${first * LH}px)`;
    this.hl.innerHTML = html;
    this.gl.style.transform = `translateY(${PAD_T + first * LH}px)`;
    this.gl.innerHTML = this.gutterHtml(first, last);
  }

  /** If `sa` falls inside a string, start the slice at the string's opening quote (bounded). */
  private stringStart(a: number, sa: number) {
    const t = this.text;
    let inStr = false;
    let start = a;
    for (let i = a; i < sa; i++) {
      const c = t.charCodeAt(i);
      if (inStr) {
        if (c === 92) i++;
        else if (c === 34) inStr = false;
      } else if (c === 34) {
        inStr = true;
        start = i;
      }
    }
    return inStr && sa - start < 4000 ? start : sa;
  }

  private gutterHtml(first: number, last: number) {
    const s = this.scope;
    const l1 = s ? s[0] : -1;
    const l2 = s ? s[1] : -1;
    let g = '';
    for (let ln = first; ln < last; ln++) {
      let cls = this.diagCls.get(ln) ?? '';
      const lm = this.lineMarks ? this.lineMarks[ln] : 0;
      if (lm) cls += ' ' + LINE_MARK[lm];
      if (ln === this.caretLine) cls += ' c';
      if (ln >= l1 && ln <= l2) cls += ' s';
      g += cls ? `<div class="${cls.trim()}">${ln + 1}</div>` : `<div>${ln + 1}</div>`;
    }
    return g;
  }

  private marksFor(ln: number): Mark[] | null {
    const d = this.diag.get(ln);
    const a = this.ls[ln];
    const b = this.lineEnd(ln);
    const extra = this.brackets.filter((m) => m.a >= a && m.a < b);
    const sm = this.scopeMark;
    if (sm && sm.a >= a && sm.a < b && !extra.some((m) => m.a < sm.b && m.b > sm.a)) extra.push(sm);
    if (!extra.length) return d ?? null;
    if (!d) return extra.sort((x, y) => x.a - y.a);
    return [...d, ...extra.filter((m) => !d.some((x) => m.a < x.b && m.b > x.a))].sort((x, y) => x.a - y.a);
  }

  // ── Decorations ────────────────────────────────────────────────────────

  setDiagnostics(list: Diagnostic[]) {
    this.diag.clear();
    this.diagCls.clear();
    const t = this.text;
    for (const d of list) {
      const p = Math.min(d.p, t.length);
      const ln = this.lineOf(p);
      const end = Math.min(this.tokenEnd(p), this.lineEnd(ln));
      const arr = this.diag.get(ln) ?? [];
      if (!arr.some((m) => p < m.b && end > m.a) && !arr.some((m) => m.a === p)) arr.push({ a: p, b: end, cls: d.cls });
      this.diag.set(ln, arr);
      if (d.cls === 'me' || !this.diagCls.has(ln)) this.diagCls.set(ln, d.cls === 'me' ? 'e' : 'w');
    }
    for (const arr of this.diag.values()) arr.sort((x, y) => x.a - y.a);
    this.render(true);
  }

  /** Extent of the token starting at `p`, for squiggles. */
  private tokenEnd(p: number) {
    const t = this.text;
    const c = t.charCodeAt(p);
    if (p >= t.length) return p;
    if (c === 34 || c === 39) {
      const nl = t.indexOf('\n', p);
      const lim = nl < 0 ? t.length : nl;
      for (let i = p + 1; i < lim; i++) {
        const d = t.charCodeAt(i);
        if (d === 92) i++;
        else if (d === c) return i + 1;
      }
      return lim;
    }
    if (c === 47 || c === 35) {
      const nl = t.indexOf('\n', p);
      return nl < 0 ? t.length : nl;
    }
    let i = p;
    while (i < t.length) {
      const d = t.charCodeAt(i);
      if ((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95 || d === 36 || d === 46 || d === 43 || d === 45 || d > 127) i++;
      else break;
    }
    return i > p ? i : p + 1;
  }

  /** Compare: tint whole lines as added / removed / changed (null clears). */
  setLineMarks(marks: Uint8Array | null) {
    if (!marks && !this.lineMarks) return;
    this.lineMarks = marks;
    this.render(true);
  }

  /** Briefly point at a location without taking focus (used by Compare). */
  point(off: number) {
    this.setScope(off, off + 1);
    this.reveal(off, true);
  }

  setBrackets(a: number, b: number) {
    const next = a < 0 ? [] : [{ a, b: a + 1, cls: 'mbr' }, { a: b, b: b + 1, cls: 'mbr' }];
    if (next.length === this.brackets.length && next.every((m, i) => m.a === this.brackets[i].a)) return;
    this.brackets = next;
    this.render(true);
  }

  /** Highlights the lines spanned by a selected node. */
  setScope(s: number, e: number) {
    this.scopeMark = null;
    if (s < 0) {
      this.scope = null;
      this.scopeEl.style.display = 'none';
    } else {
      const l1 = this.lineOf(s);
      const l2 = this.lineOf(Math.max(s, e - 1));
      this.scope = [l1, l2];
      if (l1 === l2 && e > s) this.scopeMark = { a: s, b: e, cls: 'msel' };
      this.scopeEl.style.display = 'block';
      this.scopeEl.style.transform = `translateY(${PAD_T + l1 * LH}px)`;
      this.scopeEl.style.height = `${(l2 - l1 + 1) * LH}px`;
    }
    this.render(true);
  }

  private updateCaret() {
    const [s, e] = this.selection;
    const ln = this.lineOf(s);
    this.cur.style.transform = `translateY(${PAD_T + ln * LH}px)`;
    this.cur.style.visibility = this.lineOf(e) !== ln ? 'hidden' : '';
    if (ln !== this.caretLine) {
      this.caretLine = ln;
      return true;
    }
    return false;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  private onBeforeInput = (e: InputEvent) => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      if (e.inputType === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    this.selBefore = [this.ta.selectionStart, this.ta.selectionEnd];
  };

  private onInput = (e: Event) => {
    const it = (e as InputEvent).inputType ?? '';
    const old = this.text;
    this.typing = true;
    this.tabMovesFocus = false;
    if (it !== 'insertFromPaste') this.pasteFull = false;
    this.model(this.ta.value, true);
    // An IME composition is recorded once, when it ends.
    if (this.compOld === null) this.record(old, this.text, it);
    this.ev.change(it === 'insertFromPaste' || it === 'insertFromDrop' ? 'paste' : 'input');
  };

  private onCompStart = () => {
    this.compOld = this.text;
    this.selBefore = [this.ta.selectionStart, this.ta.selectionEnd];
  };

  private onCompEnd = () => {
    const old = this.compOld;
    this.compOld = null;
    if (old !== null) this.record(old, this.ta.value, 'insertText');
  };

  private onPaste = (e: ClipboardEvent) => {
    const ta = this.ta;
    this.pasteFull = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
    // Browsers insert multi-line text line by line (slow for big pastes): do it ourselves.
    const text = e.clipboardData?.getData('text/plain');
    if (text && (text.length > 20_000 || countLines(text, 200) >= 200)) {
      e.preventDefault();
      this.apply(ta.selectionStart, ta.selectionEnd, text.replace(/\r\n?/g, '\n'), undefined, undefined, 'paste');
    }
  };

  private onPointer = () => {
    this.typing = false;
  };

  private onFocus = () => {
    this.el.classList.toggle('focused', document.activeElement === this.ta);
  };

  private onSel = () => {
    if (document.activeElement !== this.ta) return;
    if (this.updateCaret()) this.render(true);
    this.ev.caret();
    if (this.typing) this.typing = false;
    else this.ev.nav();
  };

  /** View mode: clicking a line moves the (virtual) caret there. */
  private onViewClick = (e: MouseEvent) => {
    if (!this.view || window.getSelection()?.toString()) return;
    const r = this.body.getBoundingClientRect();
    const ln = Math.max(0, Math.min(this.ls.length - 1, Math.floor((e.clientY - r.top - PAD_T) / LH)));
    const col = Math.max(0, Math.round((e.clientX - r.left - PAD_L) / this.cw));
    this.vcaret = Math.min(this.ls[ln] + col, this.lineEnd(ln));
    if (this.updateCaret()) this.render(true);
    this.ev.caret();
    this.ev.nav();
  };

  /** View mode keys (the scroller has focus). */
  private onViewKey = (e: KeyboardEvent) => {
    if (!this.view || e.target !== this.el) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && !e.metaKey))) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && !e.altKey && e.code === 'KeyA') {
      // Only the visible lines exist in the DOM: "select all" means the document.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      this.selectAll = true;
    } else if (mod && !e.altKey && e.code === 'KeyC' && (this.selectAll || !window.getSelection()?.toString())) {
      e.preventDefault();
      this.ev.copyAll();
    } else if (e.key === 'Escape') this.ev.escape();
    else if (!mod) this.selectAll = false;
  };

  private selectAll = false;

  /** View mode: pasting replaces the document (there is no caret to insert at). */
  private onViewPaste = (e: ClipboardEvent) => {
    if (!this.view || e.target === this.ta) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    this.pasteFull = true;
    this.apply(0, this.text.length, text, 0, 0, 'paste');
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && !e.metaKey))) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    switch (e.key) {
      case 'Tab':
        // Empty editor, or Esc pressed first: Tab moves focus like everywhere else.
        if (mod || e.altKey || this.tabMovesFocus || !this.text) return;
        e.preventDefault();
        this.indent(e.shiftKey ? -1 : 1);
        return;
      case 'Enter':
        if (mod || e.altKey || e.shiftKey) return;
        e.preventDefault();
        this.newline();
        return;
      case 'Escape':
        this.tabMovesFocus = true;
        this.ev.escape();
        return;
      case 'PageDown':
      case 'PageUp':
        if (mod || e.altKey) return;
        e.preventDefault();
        this.page(e.key === 'PageDown' ? 1 : -1, e.shiftKey);
        return;
      case '}':
      case ']':
        if (!mod && !e.altKey && this.dedentCloser(e.key)) e.preventDefault();
        return;
    }
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') this.typing = false;
  };

  // ── History ────────────────────────────────────────────────────────────
  // Every edit is stored as a minimal replacement; consecutive typing /
  // deleting is grouped like in IDEs.

  private record(old: string, now: string, kind: string) {
    if (old === now) return;
    const sb = this.selBefore;
    let a = Math.min(sb[0], this.ta.selectionStart, old.length, now.length);
    if (a > 0 && old.charCodeAt(a - 1) !== now.charCodeAt(a - 1)) a = 0;
    while (a < old.length && a < now.length && old.charCodeAt(a) === now.charCodeAt(a)) a++;
    let eo = old.length;
    let en = now.length;
    while (eo > a && en > a && old.charCodeAt(eo - 1) === now.charCodeAt(en - 1)) {
      eo--;
      en--;
    }
    if (eo === a && en === a && a > 0) {
      // The hint was wrong (e.g. autocorrect before the caret): diff from the start.
      a = 0;
      while (a < old.length && a < now.length && old.charCodeAt(a) === now.charCodeAt(a)) a++;
      eo = old.length;
      en = now.length;
      while (eo > a && en > a && old.charCodeAt(eo - 1) === now.charCodeAt(en - 1)) {
        eo--;
        en--;
      }
    }
    const ch: Change = {
      a,
      del: old.slice(a, eo),
      ins: now.slice(a, en),
      selB: sb,
      selA: [this.ta.selectionStart, this.ta.selectionEnd],
      t: Date.now(),
      kind: kind === 'insertText' || kind === 'insertCompositionText' ? 'type' : kind.startsWith('delete') ? 'del' : 'other',
    };
    const last = this.undo_[this.undo_.length - 1];
    const recent = last && ch.t - last.t < 1200;
    if (recent && ch.kind === 'type' && last.kind === 'type' && !ch.del && !last.del && last.a + last.ins.length === ch.a && !ch.ins.includes('\n')) {
      last.ins += ch.ins;
      last.selA = ch.selA;
      last.t = ch.t;
    } else if (recent && ch.kind === 'del' && last.kind === 'del' && !ch.ins && !last.ins && ch.a + ch.del.length === last.a) {
      last.a = ch.a;
      last.del = ch.del + last.del;
      last.selA = ch.selA;
      last.t = ch.t;
    } else this.push(ch);
    this.redo_ = [];
  }

  private push(ch: Change) {
    this.undo_.push(ch);
    this.histChars += ch.del.length + ch.ins.length;
    while (this.undo_.length > 1 && (this.undo_.length > 500 || this.histChars > 60_000_000)) {
      const x = this.undo_.shift() as Change;
      this.histChars -= x.del.length + x.ins.length;
    }
  }

  undo() {
    const ch = this.undo_.pop();
    if (!ch) return;
    this.histChars -= ch.del.length + ch.ins.length;
    this.redo_.push(ch);
    this.write(ch.a, ch.a + ch.ins.length, ch.del, ch.selB);
  }

  redo() {
    const ch = this.redo_.pop();
    if (!ch) return;
    this.push(ch);
    this.write(ch.a, ch.a + ch.del.length, ch.ins, ch.selA);
  }

  /** Low-level replace without recording history. */
  private write(a: number, b: number, text: string, sel: [number, number]) {
    const v = this.text;
    this.typing = true;
    this.model(v.slice(0, a) + text + v.slice(b), false);
    this.select(sel[0], sel[1], false);
    this.ev.change('input');
  }

  // ── Editing ────────────────────────────────────────────────────────────

  /**
   * Replaces [a, b) with `text` as one undoable step. Small edits go through
   * the browser (keeps IME/autocorrect happy); large ones are applied
   * directly, which is orders of magnitude faster for multi-line text.
   */
  replace(a: number, b: number, text: string, selA?: number, selB?: number) {
    const ta = this.ta;
    if (!this.view && text.length + (b - a) < 4000 && countLines(text, 40) < 40) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(a, b);
      this.selBefore = [a, b];
      let ok = false;
      try {
        ok = text ? document.execCommand('insertText', false, text) : a === b || document.execCommand('delete');
      } catch {
        ok = false;
      }
      if (ok) {
        if (selA !== undefined) ta.setSelectionRange(selA, selB ?? selA);
        return;
      }
    }
    this.apply(a, b, text, selA, selB, 'input');
  }

  private apply(a: number, b: number, text: string, selA: number | undefined, selB: number | undefined, kind: ChangeKind) {
    text = lf(text);
    const v = this.text;
    const sb = this.selection;
    const del = v.slice(a, b);
    const s1 = selA ?? a + text.length;
    const s2 = selB ?? s1;
    this.push({ a, del, ins: text, selB: sb, selA: [s1, s2], t: 0, kind: 'other' });
    this.redo_ = [];
    this.typing = true;
    this.model(v.slice(0, a) + text + v.slice(b), false);
    this.select(s1, s2, false);
    this.ev.change(kind);
  }

  /** Replaces the whole document as one undoable step. */
  setValue(next: string, caret = 0) {
    next = lf(next);
    if (next !== this.text) {
      this.forceEdit = false;
      this.apply(0, this.text.length, next, caret, caret, 'set');
    }
    this.select(caret, caret, true);
  }

  select(a: number, b: number, center = true) {
    if (this.view) {
      this.vcaret = a;
      if (b > a) this.setScope(a, b);
    } else {
      this.ta.focus({ preventScroll: true });
      this.ta.setSelectionRange(a, b);
    }
    if (this.updateCaret()) this.render(true);
    this.reveal(a, center);
  }

  /** Scrolls so that `off` is visible. */
  reveal(off: number, center = false) {
    const ln = this.lineOf(off);
    const el = this.el;
    const vh = el.clientHeight;
    const y = PAD_T + ln * LH;
    if (y < el.scrollTop + LH || y + LH * 2 > el.scrollTop + vh) {
      el.scrollTop = center ? y - vh / 2 + LH : y < el.scrollTop ? y - LH : y - vh + LH * 3;
    }
    const x = PAD_L + (off - this.ls[ln]) * this.cw;
    const vw = el.clientWidth - this.gutW;
    if (x < el.scrollLeft || x > el.scrollLeft + vw - 40) el.scrollLeft = Math.max(0, x - vw / 2);
    this.render(false);
  }

  /** Is `off` currently on screen (vertically and horizontally)? */
  isVisible(off: number) {
    const ln = this.lineOf(off);
    const y = PAD_T + ln * LH;
    const x = PAD_L + (off - this.ls[ln]) * this.cw;
    const el = this.el;
    return y >= el.scrollTop && y + LH <= el.scrollTop + el.clientHeight && x >= el.scrollLeft && x <= el.scrollLeft + el.clientWidth - this.gutW - 24;
  }

  private indent(dir: 1 | -1) {
    const ta = this.ta;
    const v = ta.value;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const unit = this.indentUnit;
    const l1 = this.lineOf(s);
    const l2 = this.lineOf(e > s && v.charCodeAt(e - 1) === 10 ? e - 1 : e);
    if (dir > 0 && l1 === l2 && s === e) {
      this.replace(s, e, unit);
      return;
    }
    const a = this.ls[l1];
    const b = this.lineEnd(l2);
    const lines = v.slice(a, b).split('\n');
    let firstDelta = 0;
    const out = lines.map((l, i) => {
      let r: string;
      if (dir > 0) r = l ? unit + l : l;
      else if (l.startsWith('\t')) r = l.slice(1);
      else r = l.replace(new RegExp(`^ {1,${unit === '\t' ? 4 : unit.length}}`), '');
      if (i === 0) firstDelta = r.length - l.length;
      return r;
    });
    const text = out.join('\n');
    this.replace(a, b, text, Math.max(a, s + firstDelta), l1 === l2 && s === e ? Math.max(a, s + firstDelta) : a + text.length);
  }

  private newline() {
    const ta = this.ta;
    const v = ta.value;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const indent = /^[ \t]*/.exec(v.slice(lineStart, s))?.[0] ?? '';
    let k = s - 1;
    while (k >= lineStart && (v.charCodeAt(k) === 32 || v.charCodeAt(k) === 9)) k--;
    const before = v[k];
    if (before === '{' || before === '[') {
      const inner = indent + this.indentUnit;
      const after = v[e];
      if ((before === '{' && after === '}') || (before === '[' && after === ']')) {
        this.replace(s, e, '\n' + inner + '\n' + indent, s + 1 + inner.length);
      } else this.replace(s, e, '\n' + inner);
    } else this.replace(s, e, '\n' + indent);
    this.reveal(ta.selectionStart);
  }

  /** Typing a closer on a whitespace-only line removes one indent level first. */
  private dedentCloser(ch: string) {
    const ta = this.ta;
    const s = ta.selectionStart;
    if (s !== ta.selectionEnd) return false;
    const v = ta.value;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const lead = v.slice(lineStart, s);
    if (!lead || /[^ \t]/.test(lead)) return false;
    const unit = this.indentUnit;
    let cut = 0;
    if (lead.endsWith('\t')) cut = 1;
    else if (lead.endsWith(unit)) cut = unit.length;
    if (!cut) return false;
    this.replace(s - cut, s, ch);
    return true;
  }

  private page(dir: 1 | -1, extend: boolean) {
    const ta = this.ta;
    const lines = Math.max(1, Math.floor(this.el.clientHeight / LH) - 2);
    const focus = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const anchor = ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart;
    const ln = this.lineOf(focus);
    const col = focus - this.ls[ln];
    const target = Math.max(0, Math.min(this.ls.length - 1, ln + dir * lines));
    const off = Math.min(this.ls[target] + col, this.lineEnd(target));
    if (extend) ta.setSelectionRange(Math.min(anchor, off), Math.max(anchor, off), off < anchor ? 'backward' : 'forward');
    else ta.setSelectionRange(off, off);
    this.el.scrollTop += dir * lines * LH;
    this.typing = false;
  }
}
