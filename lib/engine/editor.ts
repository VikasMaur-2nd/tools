import { bidiContext, escapeHtml, highlightLine, jwtLine, StringStates, stringState, trimWs, type Mark } from './highlight';
import type { Surface } from './surface';
import { TallScroll } from './tall';
import { LONG_LINE, Wrapper } from './wrap';
import { rt } from '../i18n/ui';

/*
 * The document lives in `text` (the model). Three presentations:
 *
 *  - Edit mode: a native <textarea> (caret, selection, IME, accessibility)
 *    sized to its full content, layered over a virtualized syntax-highlighted
 *    copy of the visible lines. Both share one scroll container, so they move
 *    together natively: no scroll lag.
 *  - Large editable documents: Surface captures input in a bounded textarea,
 *    maps it into the model, and draws the selection over the virtual rows.
 *  - View mode (huge documents): browsers lay out every line of a textarea,
 *    which takes seconds at hundreds of thousands of lines. We drop the
 *    textarea and show only the virtualized highlighted view: instant at any
 *    size, still selectable, formattable and undoable. "Edit anyway" opts in.
 *
 * Undo/redo is ours (browser undo is lost on programmatic changes and is tied
 * to slow DOM editing commands).
 *
 * Folding: a folded block hides its inner lines and its closing line (drawn
 * after the "⋯ N lines" pill, like the output view), so the textarea holds the
 * model minus those lines ("display" text). Offsets map between the two by
 * line; every public API speaks model offsets.
 *
 * Soft wrap: the textarea wraps (CSS), and each display line takes the rows
 * the Wrapper says the browser gives it (see wrap.ts). Lines are drawn whole,
 * so the browser wraps the copy exactly like the textarea; long lines are
 * drawn as the rows on screen only.
 */

export const LH = 20;
const PAD_T = 10;
const PAD_B = 48;
const PAD_L = 16;
const PAD_R = 48;
const OVERSCAN = 40;
/** Right padding while wrapping (the textarea's text ends this far from the edge). */
const PAD_RW = 12;
const H_OVERSCAN = 600;
/** Above these sizes the editor switches to view mode. */
const VIEW_CHARS = 2_000_000;
const VIEW_LINES = 30_000;
/**
 * Loaded documents this big open in view mode too, quietly: laying out a
 * textarea that holds them is most of the time it takes to open them. The
 * first click, edit key or paste loads the textarea (see `wake`).
 */
const LAZY_CHARS = 100_000;
/** Keep native editing for normal documents. */
const SURFACE_CHARS = 250_000;
/** The big-document editor's module: most visits never need it, so it loads on first need (and when the page is idle, see Engine). */
let SurfaceClass: typeof Surface | undefined;
let surfaceLoad: Promise<void> | undefined;
export function loadSurface() {
  return (surfaceLoad ??= import('./surface').then(
    (m) => void (SurfaceClass = m.Surface),
    () => void (surfaceLoad = undefined),
  ));
}
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
  /** A paste replaces the whole document with `text`: true if the listener loads it instead (see Engine.load). */
  fullPaste?(text: string): boolean;
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

/** Smallest changed range between two strings: [start, oldEnd, newEnd]. `hint` is a likely start. */
function diffRange(old: string, now: string, hint: number): [number, number, number] {
  let a = Math.max(0, Math.min(hint, old.length, now.length));
  if (a > 0 && old.charCodeAt(a - 1) !== now.charCodeAt(a - 1)) a = 0;
  for (let pass = 0; pass < 2; pass++) {
    while (a < old.length && a < now.length && old.charCodeAt(a) === now.charCodeAt(a)) a++;
    let eo = old.length;
    let en = now.length;
    while (eo > a && en > a && old.charCodeAt(eo - 1) === now.charCodeAt(en - 1)) {
      eo--;
      en--;
    }
    // The hint was wrong (e.g. autocorrect before the caret): diff from the start.
    if (eo === a && en === a && a > 0 && old !== now) {
      a = 0;
      continue;
    }
    return [a, eo, en];
  }
  return [0, old.length, now.length];
}

/**
 * Changed range of a native edit that replaced the selection [ss, se) or
 * deleted next to it: anchored to the selection, so an insert never slides
 * past equal characters (which would put it on the wrong side of a fold).
 */
function editRange(old: string, now: string, ss: number, se: number): [number, number, number] {
  let eo = old.length;
  let en = now.length;
  const minE = Math.min(se, eo);
  while (eo > minE && en > 0 && old.charCodeAt(eo - 1) === now.charCodeAt(en - 1)) {
    eo--;
    en--;
  }
  let a = Math.min(ss, eo, en);
  if (a > 0 && old.slice(0, a) !== now.slice(0, a)) {
    // Text before the caret changed too (autocorrect, IME): longest common prefix.
    const cap = a;
    a = 0;
    while (a < cap && old.charCodeAt(a) === now.charCodeAt(a)) a++;
  }
  return [a, eo, en];
}

/**
 * Sets `el`'s children (one per string of `old`) to `rows`, rebuilding only
 * the run between the unchanged first and last ones: typing redraws the rows
 * it changed, not the view.
 */
function patch(el: HTMLElement, old: string[], rows: string[]) {
  let f = 0;
  let a = old.length;
  let b = rows.length;
  while (f < a && f < b && old[f] === rows[f]) f++;
  while (a > f && b > f && old[a - 1] === rows[b - 1]) {
    a--;
    b--;
  }
  const kids = el.children;
  if (kids.length !== old.length || (!f && a === old.length)) return void (el.innerHTML = rows.join(''));
  for (let i = a - 1; i >= f; i--) kids[i].remove();
  const html = rows.slice(f, b).join('');
  if (f < kids.length) kids[f].insertAdjacentHTML('beforebegin', html);
  else el.insertAdjacentHTML('beforeend', html);
}

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
  /** Scroll offsets in content px (only a huge document in view mode outgrows the browser's height limit). */
  private sc: TallScroll;
  /** Content y of the caret band and the scope band; `shiftAt`: the scroll shift they were drawn with. */
  private curY = 0;
  private scopeY = 0;
  /** Content y of the drawn rows and of their gutter. */
  private hlY = 0;
  private glY = 0;
  private shiftAt = 0;
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

  private surface: Surface | null = null;
  private forceEdit = false;
  /** In view mode only until the first edit (see LAZY_CHARS); `loading`: setValue is loading a document. */
  private lazy = false;
  private loading = false;
  private vcaret = 0;
  /** After Esc, the next Tab moves focus instead of indenting (no keyboard trap). */
  private tabMovesFocus = false;
  /** Text before an IME composition started (recorded as one undo step). */
  private compOld: string | null = null;
  private compSel: [number, number] = [0, 0];
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
  /** The input is one JWT: its part offsets (see jwtLine), coloured instead of JSON tokens. */
  private jwt: readonly number[] | null = null;
  /** Soft wrap (null: off). */
  private wrapper: Wrapper | null = null;
  /** While wrapping: the first visual row of each display line (length rows + 1). */
  private wy: Int32Array | null = null;
  /** While wrapping: 1 for display lines whose breaks the browser decides (Wrapper.odd). */
  private wodd = new Uint8Array(0);
  /** Text or folds changed since rows were last wrapped. */
  private wrapDirty = true;
  private strs = new StringStates();
  private rFirst = -1;
  private rLast = -1;
  private rColA = 0;
  private rColB = 0;
  private raf = 0;
  /** A decoration changed: the next frame redraws even if the visible rows didn't move. */
  private redraw = false;
  private typing = false;
  private selBefore: [number, number] = [0, 0];
  private undo_: Change[] = [];
  private redo_: Change[] = [];
  private histChars = 0;
  private caretLine = 0;
  private ro: ResizeObserver;
  // folding
  /** Closing line of the block each line opens (only blocks spanning 3+ lines), else -1. */
  private close = new Int32Array(1).fill(-1);
  /** Nesting depth of each block opener. */
  private depth = new Int32Array(1);
  /** Folded opener line → its span (closer line - opener line) when folded. */
  private folded = new Map<number, number>();
  /** Model lines shown, in order (null: nothing folded, display = model). */
  private vis: Int32Array | null = null;
  /** Display line starts (offsets into the textarea text) while folded. */
  private dls: Int32Array | null = null;
  /** The textarea text while folded. */
  private dtext = '';
  /** A fold was dropped while syncing a model change (the textarea needs refreshing). */
  private foldsLost = false;
  /** Model selection right after the last user edit. */
  private selAfter: [number, number] = [0, 0];

  constructor(el: HTMLElement, ev: EditorEvents) {
    this.el = el;
    this.ev = ev;
    this.gut = el.querySelector('.ed-gut') as HTMLElement;
    this.gl = el.querySelector('.ed-gl') as HTMLElement;
    this.body = el.querySelector('.ed-body') as HTMLElement;
    this.sc = new TallScroll(el);
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
    ta.addEventListener('copy', this.onCopy);
    ta.addEventListener('cut', this.onCopy);
    ta.addEventListener('mousemove', this.onHover);
    this.gut.addEventListener('mousedown', this.onGutter);
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
    // The code font may arrive after first paint, and its subsets for other
    // scripts when such text appears: re-measure glyphs (and wrapped rows) then.
    document.fonts?.ready.then(this.onFonts);
    document.fonts?.addEventListener('loadingdone', this.onFonts);
  }

  private onFonts = () => {
    if (!this.el.isConnected) return;
    const cw = this.cw;
    this.measure();
    // Rows only move if a width changed (always re-measured while matching a textarea).
    if (this.cw !== cw || !this.wrapper || this.wrapper.fontsLoaded()) {
      if (this.cw !== cw) this.wrapper?.reset();
      this.wrapDirty = true;
      this.layout();
    }
    this.render(true);
  };

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
    ta.removeEventListener('copy', this.onCopy);
    ta.removeEventListener('cut', this.onCopy);
    ta.removeEventListener('mousemove', this.onHover);
    this.gut.removeEventListener('mousedown', this.onGutter);
    this.el.removeEventListener('scroll', this.onScroll);
    this.el.removeEventListener('keydown', this.onViewKey);
    this.el.removeEventListener('mouseup', this.onViewClick);
    this.el.removeEventListener('paste', this.onViewPaste);
    document.removeEventListener('selectionchange', this.onSel);
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.wrapper?.destroy();
    this.surface?.destroy();
    this.el.classList.remove('hl-on', 'vmode', 'wrap');
    if (this.view || this.vis || this.surface) ta.value = this.text;
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
  private model(t: string, fromTa: boolean, defer = false) {
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
    this.scanFolds();
    this.buildDisplay();
    if (this.diagList.length) this.buildDiag();

    // Typing never flips an open editor into view mode; loads and big pastes do.
    const big = t.length > VIEW_CHARS || ls.length > VIEW_LINES;
    const lazy = !big && (this.view ? this.lazy : this.loading && t.length > LAZY_CHARS);
    const view = !this.forceEdit && (big || lazy) && !(fromTa && !this.view);
    const notice = view && !lazy;
    if (notice !== (this.view && !this.lazy)) this.ev.mode(notice);
    this.lazy = view && lazy;
    // A user edit keeps the big-document editor until the text is well under the threshold (no flip-flopping
    // at it), and never leaves it mid-composition (see onCompEnd).
    let custom = !view && (t.length >= SURFACE_CHARS || (!!this.surface && fromTa && (t.length >= SURFACE_CHARS * 0.8 || this.compOld !== null)));
    if (t.length >= SURFACE_CHARS && !SurfaceClass) {
      // Native editing until the module arrives (it is usually cached already), then switch.
      custom = false;
      void loadSurface().then(() => {
        if (SurfaceClass && !this.surface && !this.view && this.el.isConnected && this.text.length >= SURFACE_CHARS) this.model(this.text, false);
      });
    }
    if (custom && !this.surface) {
      const selection = this.selection;
      this.surface = this.makeSurface();
      this.surface.select(...selection);
    } else if (!custom && this.surface) {
      const [sa, sb] = this.surface.selection;
      this.surface.destroy();
      this.surface = null;
      // The textarea held only a passage: give it the document again, with the selection.
      if (!view) {
        this.ta.value = this.shown;
        this.ta.setSelectionRange(this.m2d(sa), this.m2d(sb));
      }
    }
    if (this.surface) {
      // (A user edit places the selection itself, right after.)
      if (!fromTa) this.surface.select(...this.surface.selection);
    } else if (view) {
      if (!this.view) this.vcaret = Math.min(this.caret, t.length);
      if (this.ta.value) this.ta.value = '';
    } else if (!fromTa) {
      this.ta.value = this.shown;
    }
    if (view !== this.view) {
      this.view = view;
      this.el.classList.toggle('vmode', view);
      this.el.tabIndex = view ? 0 : -1;
      this.ev.caret();
    }
    this.wrapDirty = true;
    this.layout();
    this.updateCaret();
    this.placeScope();
    if (this.surface && (fromTa || defer)) this.renderSoon();
    else this.render(true);
  }

  private makeSurface() {
    const readText = () => this.text;
    return new SurfaceClass!({
      el: this.el, ta: this.ta,
      get text() { return readText(); },
      edit: (a, b, text, kind) => this.surfaceEdit(a, b, text, kind),
      moved: (nav) => this.surfaceMoved(nav),
      point: (x, y) => {
        const exact = this.offsetAt(x, y);
        if (exact !== null) return exact;
        const box = this.body.getBoundingClientRect();
        const row = Math.max(0, Math.min(this.vrows - 1, Math.floor((y - box.top - this.sc.shift - PAD_T) / LH)));
        const k = this.kAt(row);
        const [a, b] = this.rowSpan(k, row - this.yOf(k));
        return Math.min(b, a + Math.max(0, Math.round((x - box.left - PAD_L) / this.cw)));
      },
      row: (off) => { const r = this.vrowOf(off); const k = this.kAt(r); return [r, ...this.rowSpan(k, r - this.yOf(k))]; },
      span: (row) => { row = Math.max(0, Math.min(this.vrows - 1, row)); const k = this.kAt(row); return this.rowSpan(k, row - this.yOf(k)); },
      reveal: (off) => this.reveal(off),
      scroll: (dy, dx) => { this.sc.top += dy; this.el.scrollLeft += dx; this.render(false); },
      fold: (ln) => this.toggleFold(ln),
    });
  }

  private surfaceMoved(nav: boolean) {
    this.updateCaret();
    this.reveal(this.caret);
    this.ev.caret();
    if (nav) this.ev.nav();
  }

  /** The input passage reports a bounded replacement in model offsets. */
  private surfaceEdit(a: number, b: number, ins: string, kind: string) {
    const old = this.text;
    if (a === b && !ins) return;
    this.selBefore = this.surface!.selection;
    this.selAfter = [a + ins.length, a + ins.length];
    this.typing = true;
    this.tabMovesFocus = false;
    this.pasteFull = false;
    this.shiftFolds(a, b, ins, true);
    this.shiftDiags(a, b, ins.length);
    this.model(old.slice(0, a) + ins + old.slice(b), true);
    this.surface?.select(...this.selAfter);
    if (this.compOld === null) this.record(old, this.text, kind, [a, b, a + ins.length]);
    this.ev.change('input');
  }

  /** What the textarea holds: the model minus folded lines. */
  private get shown() {
    return this.vis ? this.dtext : this.text;
  }

  /** Sets the initial document (no undo step). */
  init(text: string) {
    this.model(lf(text), false);
  }

  /** Leaves a quiet view mode (see LAZY_CHARS) for the textarea, caret at `at`. True if it did. */
  private wake(at: number) {
    if (!this.view || !this.lazy) return false;
    this.editAnyway();
    this.setCaret(at);
    return true;
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
    this.surface?.adopt();
    return this.surface ? this.surface.head : this.view ? this.vcaret : this.d2m(this.ta.selectionStart);
  }

  get selection(): [number, number] {
    this.surface?.adopt();
    return this.surface ? this.surface.selection : this.view ? [this.vcaret, this.vcaret] : [this.d2m(this.ta.selectionStart), this.d2m(this.ta.selectionEnd)];
  }

  selectedText() {
    if (this.view) return window.getSelection()?.toString() ?? '';
    const [a, b] = this.selection;
    return this.text.slice(a, b);
  }

  // ── Folding ────────────────────────────────────────────────────────────

  /**
   * A line ending in `{` or `[` opens a block that the next line starting with
   * the matching closer ends (same rule as the output view: exact for
   * formatted JSON, linear in lines). A block folds only if its closing line
   * is just the closer (`}` or `},`): that line hides with it. Re-validates
   * folds after edits.
   */
  private scanFolds() {
    const t = this.text;
    const ls = this.ls;
    const n = ls.length;
    const close = new Int32Array(n).fill(-1);
    const depth = new Int32Array(n);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = ls[i];
      const e = this.lineEnd(i);
      let a = s;
      while (a < e && (t.charCodeAt(a) === 32 || t.charCodeAt(a) === 9)) a++;
      if (a === e) continue;
      const first = t.charCodeAt(a);
      if (first === 47 && t.charCodeAt(a + 1) === 47) continue; // a // comment line
      let b = e - 1;
      while (b > a && (t.charCodeAt(b) === 32 || t.charCodeAt(b) === 9 || t.charCodeAt(b) === 13)) b--;
      if ((first === 125 || first === 93) && stack.length) {
        const o = stack.pop() as number;
        if (i > o + 1 && (b === a || (b === a + 1 && t.charCodeAt(b) === 44))) close[o] = i;
      }
      const last = t.charCodeAt(b);
      if ((last === 123 || last === 91) && !(b === a && (first === 125 || first === 93))) {
        depth[i] = stack.length;
        stack.push(i);
      }
    }
    this.close = close;
    this.depth = depth;
    // A fold survives an edit only if its block still spans the same lines.
    for (const [o, span] of this.folded) {
      if (o >= n || close[o] - o !== span) {
        this.folded.delete(o);
        this.foldsLost = true;
      }
    }
  }

  /** Rebuilds the visible-line map and the textarea text from the folds. */
  private buildDisplay() {
    this.wrapDirty = true;
    if (!this.folded.size) {
      this.vis = null;
      this.dls = null;
      this.dtext = '';
      return;
    }
    const t = this.text;
    const n = this.ls.length;
    const vis: number[] = [];
    let out = '';
    let from = 0;
    for (let i = 0; i < n; i++) {
      vis.push(i);
      if (this.folded.has(i)) {
        const c = this.close[i];
        // Hide [end of the opener line, end of the closer line).
        out += t.slice(from, this.lineEnd(i));
        from = this.lineEnd(c);
        i = c;
      }
    }
    out += t.slice(from);
    const dls = new Int32Array(vis.length);
    let p = 0;
    for (let k = 0; k < vis.length; k++) {
      dls[k] = p;
      p += this.lineEnd(vis[k]) - this.ls[vis[k]] + 1;
    }
    this.vis = Int32Array.from(vis);
    this.dls = dls;
    this.dtext = out;
  }

  /** Display row of model line `ln` (a hidden line maps to the row of its fold). */
  private rowOf(ln: number) {
    const vis = this.vis;
    if (!vis) return ln;
    let lo = 0;
    let hi = vis.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (vis[mid] <= ln) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private get rows() {
    return this.vis ? this.vis.length : this.ls.length;
  }

  /** Model line shown on display row `k`. */
  private lineAt(k: number) {
    return this.vis ? this.vis[k] : k;
  }

  /** First visual row of display row `k` (they differ while wrapping). */
  private yOf(k: number) {
    return this.wy ? this.wy[k] : k;
  }

  /** Visual rows in all. */
  private get vrows() {
    return this.wy ? this.wy[this.rows] : this.rows;
  }

  /** Display row shown on visual row `r` (clamped). */
  private kAt(r: number) {
    const n = this.rows;
    const wy = this.wy;
    if (!wy) return Math.max(0, Math.min(n - 1, r));
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (wy[mid] <= r) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Model line at the top of the view. */
  private topLine() {
    return this.lineAt(this.kAt(Math.floor((this.sc.top - PAD_T) / LH)));
  }

  /** Visual row showing model offset `off` (the caret before that character). */
  private vrowOf(off: number) {
    const ln = this.lineOf(off);
    const k = this.rowOf(ln);
    const wy = this.wy;
    if (!wy || !this.wrapper || this.lineAt(k) !== ln) return this.yOf(k);
    return wy[k] + this.wrapper.rowAt(this.text, this.ls[ln], this.lineEnd(ln), off, this.wodd[k] === 1, wy[k + 1] - wy[k]);
  }

  /** Model offsets [start, end) of wrapped row `sub` of display row `k`. */
  private rowSpan(k: number, sub: number): [number, number] {
    const ln = this.lineAt(k);
    const a = this.ls[ln];
    const b = this.lineEnd(ln);
    const wr = this.wrapper;
    if (!wr || !this.wy) return [a, b];
    const rows = this.wy[k + 1] - this.wy[k];
    const odd = this.wodd[k] === 1;
    return [a + wr.rowStart(this.text, a, b, sub, odd), sub + 1 < rows ? a + wr.rowStart(this.text, a, b, sub + 1, odd) : b];
  }

  /** Soft-wraps lines at the editor's width, or stops. */
  setWrap(on: boolean) {
    if (on === !!this.wrapper) return;
    const top = this.topLine();
    this.wrapper?.destroy();
    this.wrapper = on ? new Wrapper(this.body, LH) : null;
    this.wy = null;
    this.wrapDirty = true;
    this.el.classList.toggle('wrap', on);
    this.ta.wrap = on && !this.surface ? 'soft' : 'off';
    this.layout();
    this.sc.top = PAD_T + this.yOf(this.rowOf(top)) * LH;
    this.el.scrollLeft = 0;
    this.updateCaret();
    this.placeScope();
    this.render(true);
  }

  /** Re-wraps rows after a change of text, folds, width or font. */
  private rewrap() {
    const wr = this.wrapper as Wrapper;
    const space = this.el.clientWidth - this.gutW - PAD_L - PAD_RW;
    const resized = wr.fit(space, this.cw);
    if (resized) this.el.style.setProperty('--tw', `${wr.width}px`);
    // Without the textarea (view mode) nothing has to line up with it: long lines can be summed.
    const moded = wr.setExact(!this.view && !this.surface);
    if (!resized && !moded && !this.wrapDirty && this.wy) return;
    this.wrapDirty = false;
    const n = this.rows;
    const A = new Int32Array(n);
    const B = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      const ln = this.lineAt(k);
      A[k] = this.ls[ln];
      B[k] = this.lineEnd(ln);
    }
    const rows = wr.rows(this.text, A, B);
    const wy = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) wy[k + 1] = wy[k] + rows[k];
    this.wy = wy;
    this.wodd = wr.odd;
  }

  /** Display row containing textarea offset `off`. */
  private dRowOf(off: number) {
    const dls = this.dls;
    if (!dls) return this.lineOf(off);
    let lo = 0;
    let hi = dls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (dls[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Textarea offset → model offset. The newline after a folded line stands for
   * the hidden lines plus the newline after the closer: `right` maps its start
   * to the latter (so deleting it never drops hidden lines).
   */
  private d2m(off: number, right = false) {
    const dls = this.dls;
    const vis = this.vis;
    if (!dls || !vis) return off;
    const k = this.dRowOf(off);
    const ln = vis[k];
    const m = this.ls[ln] + Math.max(0, off - dls[k]);
    const end = this.lineEnd(ln);
    if (m >= end) {
      if (right && this.folded.has(ln)) return this.lineEnd(this.close[ln]);
      return end;
    }
    return m;
  }

  /** Model offset → textarea offset (a hidden offset maps to the end of its fold's line). */
  private m2d(off: number) {
    const dls = this.dls;
    const vis = this.vis;
    if (!dls || !vis) return off;
    const ln = this.lineOf(off);
    const k = this.rowOf(ln);
    if (vis[k] !== ln) return dls[k] + this.lineEnd(vis[k]) - this.ls[vis[k]];
    return dls[k] + off - this.ls[ln];
  }

  /** Is `off` inside folded (hidden) lines? */
  private hidden(off: number) {
    return !!this.vis && this.vis[this.rowOf(this.lineOf(off))] !== this.lineOf(off);
  }

  /** Can model line `ln` be folded? */
  canFold(ln: number) {
    return this.close[ln] >= 0;
  }

  get hasFolds() {
    return this.folded.size > 0;
  }

  /** Folds or unfolds the block opened on model line `ln`. */
  toggleFold(ln: number) {
    const c = this.close[ln];
    if (c < 0) return;
    // Its lines enter or leave the textarea as one run: [end of the line, end of the closer line).
    const at = this.m2d(this.lineEnd(ln));
    if (this.folded.has(ln)) {
      this.folded.delete(ln);
      return this.refold(ln, { at, end: () => this.m2d(this.lineEnd(c)), cut: false });
    }
    const end = this.m2d(this.lineEnd(c));
    this.folded.set(ln, c - ln);
    this.refold(ln, { at, end: () => end, cut: true });
  }

  /** Folds the innermost block around the caret (or unfolds it). */
  foldAtCaret(fold: boolean) {
    const ln = this.lineOf(this.caret);
    if (!fold) {
      for (let o = ln; o >= 0; o--) {
        if (this.folded.has(o) && this.close[o] >= ln) {
          this.folded.delete(o);
          return this.refold(o);
        }
      }
      return;
    }
    for (let o = ln; o >= 0; o--) {
      if (this.close[o] >= ln && !this.folded.has(o)) {
        this.folded.set(o, this.close[o] - o);
        return this.refold(o);
      }
    }
  }

  /** Folds every block nested `level` deep or deeper (1 keeps only the outermost block open). */
  foldLevel(level: number) {
    this.folded.clear();
    for (let i = 0; i < this.close.length; i++) if (this.close[i] >= 0 && this.depth[i] >= level) this.folded.set(i, this.close[i] - i);
    this.refold(-1);
  }

  unfoldAll() {
    if (!this.folded.size) return;
    this.folded.clear();
    this.refold(-1);
  }

  /** Unfolds whatever hides model offset `off`. */
  private unhide(off: number) {
    if (!this.vis || !this.hidden(off)) return;
    const ln = this.lineOf(off);
    for (const o of [...this.folded.keys()]) if (o < ln && this.close[o] >= ln) this.folded.delete(o);
    this.refold(-1);
  }

  /**
   * Applies fold changes: keeps the selection (out of hidden lines) and the
   * scroll anchor. `patch`: the one textarea range a single fold removes or
   * restores. Patching it is far cheaper than assigning the whole value, which
   * re-lays out every line of a big document (deleting through the editing
   * pipeline is cheapest of all).
   */
  private refold(anchor: number, patch?: { at: number; end: () => number; cut: boolean }) {
    let [s, e] = this.view ? [this.vcaret, this.vcaret] : this.selection;
    const top = anchor >= 0 ? anchor : this.topLine();
    const y = PAD_T + this.yOf(this.rowOf(top)) * LH - this.sc.top;
    this.buildDisplay();
    // A caret inside a newly folded block moves to the end of its first line.
    const fix = (off: number) => (this.hidden(off) ? this.lineEnd(this.lineAt(this.rowOf(this.lineOf(off)))) : off);
    s = fix(s);
    e = fix(e);
    if (this.surface) this.surface.select(s, e);
    else if (this.view) this.vcaret = s;
    else {
      const ta = this.ta;
      let done = false;
      const end = patch ? patch.end() : 0;
      if (patch?.cut && end > patch.at) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(patch.at, end);
        this.quiet = true;
        try {
          done = document.execCommand('delete');
        } catch {
          done = false;
        }
        this.quiet = false;
      } else if (patch && end > patch.at) {
        ta.setRangeText(this.shown.slice(patch.at, end), patch.at, patch.at, 'preserve');
        done = true;
      }
      if (!done || ta.value.length !== this.shown.length) ta.value = this.shown;
      ta.setSelectionRange(this.m2d(s), this.m2d(e));
    }
    this.layout();
    this.sc.top = Math.max(0, PAD_T + this.yOf(this.rowOf(top)) * LH - y);
    this.updateCaret();
    this.placeScope();
    this.render(true);
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
    this.unhide(off);
    if (this.surface) this.surface.select(off);
    else if (this.view) this.vcaret = off;
    else this.ta.setSelectionRange(this.m2d(off), this.m2d(off));
    if (this.updateCaret()) this.render(true);
    this.reveal(off, true);
    if (this.surface) this.ev.caret();
  }

  // ── Layout & rendering ─────────────────────────────────────────────────

  private layout() {
    const lines = this.ls.length;
    const gw = Math.round(Math.max(3, String(lines).length) * this.cw + 38);
    if (gw !== this.gutW) {
      this.gutW = gw;
      this.el.style.setProperty('--gw', gw + 'px');
    }
    if (this.wrapper) this.rewrap();
    else this.wy = null;
    const h = this.vrows * LH + PAD_T + PAD_B;
    // Wrapped, the body takes the editor's width (CSS); the textarea's text box is --tw wide.
    this.body.style.width = this.wy ? '' : `${Math.ceil(this.maxCols * this.cw) + PAD_L + PAD_R + this.extraW}px`;
    this.sc.fit(h, this.body, this.gut);
    // The textarea overflows its box: it has more rows than we counted. Glyph
    // widths may be stale (a font just arrived); failing that, this browser
    // breaks ASCII its own way, so measure every line.
    const wr = this.wrapper;
    if (wr?.cols && this.wy && !this.view && !this.surface && !this.healing && this.overflows()) {
      this.healing = true;
      this.measure();
      wr.reset();
      this.wrapDirty = true;
      this.layout();
      if (this.overflows() && wr.distrust()) {
        this.wrapDirty = true;
        this.layout();
      }
      this.healing = false;
    }
  }

  private healing = false;

  private overflows() {
    return this.ta.scrollHeight > this.ta.clientHeight + 1;
  }

  private onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private frame = () => {
    this.raf = 0;
    const force = this.redraw;
    this.redraw = false;
    this.render(force);
  };

  /**
   * Decorations (diagnostics, brackets, scope, marks) redraw once in the next
   * frame, however many change together: each immediate redraw reads layout,
   * which costs a full page layout on long pages.
   */
  private renderSoon() {
    this.redraw = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private onTaScroll = () => {
    if (this.surface) return;
    const ta = this.ta;
    // The textarea never scrolls itself; if a line is wider than our estimate
    // (wide glyphs), grow the content instead.
    if (ta.scrollLeft || ta.scrollTop) {
      // Wrapped, nothing is wider than the view: the editor never scrolls sideways.
      const scrollLeft = this.wy ? 0 : ta.scrollLeft;
      const scrollTop = ta.scrollTop;
      if (scrollLeft) this.extraW += scrollLeft + 200;
      ta.scrollLeft = 0;
      ta.scrollTop = 0;
      this.layout();
      this.el.scrollLeft += scrollLeft;
      this.sc.top += scrollTop;
    }
  };

  render(force: boolean) {
    if (force) this.redraw = false;
    if (this.wy) return this.renderWrapped(force);
    const n = this.rows;
    const st = this.sc.top;
    const vh = this.el.clientHeight;
    const vf = Math.max(0, Math.floor((st - PAD_T) / LH));
    const vl = Math.min(n, Math.ceil((st + vh - PAD_T) / LH));
    const wide = this.maxCols > LONG_LINE;
    const vcA = Math.max(0, Math.floor((this.el.scrollLeft - PAD_L) / this.cw));
    const vcB = vcA + Math.ceil(this.el.clientWidth / this.cw);
    if (!force && vf >= this.rFirst && vl <= this.rLast && (!wide || (vcA >= this.rColA && vcB <= this.rColB))) return this.place(false);

    const overscan = this.surface ? 8 : OVERSCAN;
    const margin = this.surface ? 120 : H_OVERSCAN;
    const first = Math.max(0, vf - overscan);
    const last = Math.min(n, vl + overscan);
    const colA = wide ? Math.max(0, vcA - margin) : 0;
    const colB = wide ? vcB + margin : Infinity;
    this.rFirst = first;
    this.rLast = last;
    this.rColA = colA;
    this.rColB = colB;

    const t = this.text;
    const html: string[] = [];
    for (let k = first; k < last; k++) {
      const ln = this.lineAt(k);
      const a = this.ls[ln];
      const b = this.lineEnd(ln);
      const marks = this.marksFor(ln);
      const lm = this.lineMarks ? this.lineMarks[ln] : 0;
      // View mode: where the row's text starts, for clicks (see offsetAt).
      const open = (o: number) => `<div${lm ? ` class="${LINE_MARK[lm]}"` : ''}${this.view || this.surface ? ` data-o="${o}"` : ''}>`;
      const ph = this.folded.has(ln) ? this.foldPill(ln) : '';
      if (b - a > LONG_LINE && wide) {
        let sa = Math.min(b, a + colA);
        const sb = Math.min(b, a + colB);
        sa = this.stringStart(a, sa);
        const pad = (sa - a) * this.cw;
        html.push(`${open(sa)}<i class="ed-sp" style="width:${pad}px"></i>${this.jwt ? jwtLine(t, sa, sb, this.jwt) : highlightLine(t, sa, sb, marks, sb === b)}${sb === b ? ph : ''}</div>`);
      } else {
        html.push(`${open(a)}${this.jwt ? jwtLine(t, a, b, this.jwt) : highlightLine(t, a, b, marks)}${ph}</div>`);
      }
    }
    this.draw(html, this.gutterHtml(first, last));
    this.hlY = first * LH;
    this.glY = PAD_T + first * LH;
    this.place(true);
  }

  /** Positions the drawn rows, gutter and bands; with a scaled scroll offset (see TallScroll) they move as it scrolls. */
  private place(rows: boolean) {
    const s = this.sc.shift;
    if (rows || s !== this.shiftAt) {
      this.hl.style.transform = `translateY(${this.hlY + s}px)`;
      this.gl.style.transform = `translateY(${this.glY + s}px)`;
    }
    if (!this.redraw) this.surface?.paint();
    if (s === this.shiftAt) return;
    this.shiftAt = s;
    this.cur.style.transform = `translateY(${this.curY + s}px)`;
    this.scopeEl.style.transform = `translateY(${this.scopeY + s}px)`;
  }

  /**
   * Draws the visual rows around the view while wrapping. A line is drawn
   * whole (the browser wraps it like the textarea) unless it's long: then
   * just its rows on screen, each a slice of the line.
   */
  private renderWrapped(force: boolean) {
    const wy = this.wy as Int32Array;
    const wr = this.wrapper as Wrapper;
    const n = this.rows;
    const total = wy[n];
    const st = this.sc.top;
    const vf = Math.max(0, Math.floor((st - PAD_T) / LH));
    const vl = Math.min(total, Math.ceil((st + this.el.clientHeight - PAD_T) / LH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return this.place(false);
    const overscan = this.surface ? 8 : OVERSCAN;
    const r0 = Math.max(0, vf - overscan);
    const r1 = Math.min(total, vl + overscan);
    this.rFirst = r0;
    this.rLast = r1;
    const t = this.text;
    const html: string[] = [];
    const gut: string[] = [];
    let top = -1;
    for (let k = this.kAt(r0); k < n && wy[k] < r1; k++) {
      const ln = this.lineAt(k);
      const a = this.ls[ln];
      const b = this.lineEnd(ln);
      const y = wy[k];
      const rows = wy[k + 1] - y;
      const marks = this.marksFor(ln);
      const lm = this.lineMarks ? this.lineMarks[ln] : 0;
      const ph = this.folded.has(ln) ? this.foldPill(ln) : '';
      if (rows > 1 && b - a > LONG_LINE) {
        const odd = this.wodd[k] === 1;
        const s0 = Math.max(0, r0 - y);
        const s1 = Math.min(rows, r1 - y);
        if (top < 0) top = y + s0;
        let sa = a + wr.rowStart(t, a, b, s0, odd);
        let str = this.jwt ? 0 : this.strs.at(t, a, sa);
        for (let sub = s0; sub < s1; sub++) {
          const sb = sub + 1 < rows ? a + wr.rowStart(t, a, b, sub + 1, odd) : b;
          const end = sb === b;
          // Other scripts: the row's neighbours as bidi context (see bidiContext).
          const se = odd && !end ? trimWs(t, sa, sb) : sb;
          let body = this.jwt ? jwtLine(t, sa, se, this.jwt) : highlightLine(t, sa, se, marks, end, str);
          if (odd) {
            // Where the browser keeps a word's letters joined across the break, so does the copy.
            const zl = wr.exact && wr.joinsAt(t, sa) ? '\u200d' : '';
            const zr = wr.exact && se === sb && !end && wr.joinsAt(t, sb) ? '\u200d' : '';
            body = `${bidiContext(t, Math.max(a, sa - 64), sa)}${zl}${body}${zr}${bidiContext(t, sb, Math.min(b, sb + 64))}${escapeHtml(t.slice(se, sb))}`;
          }
          html.push(`<div class="ed-row${lm ? ' ' + LINE_MARK[lm] : ''}"${this.view || this.surface ? ` data-o="${sa}"` : ''}>${body}${end ? ph : ''}</div>`);
          if (!this.jwt) str = stringState(t, sa, sb, str);
          sa = sb;
        }
      } else {
        if (top < 0) top = y;
        html.push(`<div${lm ? ` class="${LINE_MARK[lm]}"` : ''}${this.view || this.surface ? ` data-o="${a}"` : ''}>${this.jwt ? jwtLine(t, a, b, this.jwt) : highlightLine(t, a, b, marks)}${ph}</div>`);
      }
      // Gutter: the number on a line's first row, its bars on every row.
      const cls = this.gutClass(ln);
      const open = cls ? `<div class="${cls}">` : '<div>';
      const f = this.close[ln] >= 0 ? `<b class="ed-f${this.folded.has(ln) ? ' c' : ''}" data-f="${ln}"></b>` : '';
      for (let r = Math.max(r0, y); r < Math.min(r1, y + rows); r++) gut.push(r === y ? `${open}${ln + 1}${f}</div>` : `${open}</div>`);
    }
    this.draw(html, gut);
    this.hlY = Math.max(0, top) * LH;
    this.glY = PAD_T + r0 * LH;
    this.place(true);
  }

  /** The "⋯ N lines" pill and the hidden closer after a folded line (flags errors and Compare changes hidden inside). */
  private foldPill(ln: number) {
    const c = this.close[ln];
    const n = c - ln - 1;
    let cls = '';
    for (const [l, k] of this.diagCls) {
      if (l > ln && l <= c) {
        cls = k;
        if (k === 'e') break;
      }
    }
    const lm = this.lineMarks;
    if (!cls && lm) {
      let kinds = 0;
      for (let l = ln + 1; l <= c && l < lm.length; l++) if (lm[l]) kinds |= 1 << lm[l];
      // Only additions or only removals keep their color; a mix reads as "changed".
      if (kinds) cls = kinds === 2 ? 'dla' : kinds === 4 ? 'dld' : 'dlc';
    }
    const t = this.text;
    let a = this.ls[c];
    while (t.charCodeAt(a) === 32 || t.charCodeAt(a) === 9) a++;
    const closer = highlightLine(t, a, this.lineEnd(c), null);
    return `<span class="ed-fold" data-f="${ln}"><span class="ed-ph${cls ? ' ' + cls : ''}">⋯ ${escapeHtml(rt.n(n, '{n} line', '{n} lines'))}</span>${closer}</span>`;
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
    const g: string[] = [];
    for (let k = first; k < last; k++) {
      const ln = this.lineAt(k);
      const cls = this.gutClass(ln);
      const f = this.close[ln] >= 0 ? `<b class="ed-f${this.folded.has(ln) ? ' c' : ''}" data-f="${ln}"></b>` : '';
      g.push(cls ? `<div class="${cls}">${ln + 1}${f}</div>` : `<div>${ln + 1}${f}</div>`);
    }
    return g;
  }

  /** The drawn rows and gutter, as last set (see patch). */
  private rowsHtml: string[] = [];
  private gutHtml: string[] = [];

  private draw(rows: string[], gut: string[]) {
    patch(this.hl, this.rowsHtml, (this.rowsHtml = rows));
    patch(this.gl, this.gutHtml, (this.gutHtml = gut));
  }

  /** Gutter classes of model line `ln`: diagnostics, Compare marks, caret line, selected node. */
  private gutClass(ln: number) {
    let cls = this.diagCls.get(ln) ?? '';
    const lm = this.lineMarks ? this.lineMarks[ln] : 0;
    if (lm) cls += ' ' + LINE_MARK[lm];
    if (ln === this.caretLine) cls += ' c';
    const s = this.scope;
    if (s && ln >= s[0] && ln <= s[1]) cls += ' s';
    return cls.trim();
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
    this.diagList = list;
    this.buildDiag();
    this.renderSoon();
  }

  private diagList: Diagnostic[] = [];

  private buildDiag() {
    this.diag.clear();
    this.diagCls.clear();
    const t = this.text;
    for (const d of this.diagList) {
      const p = Math.min(d.p, t.length);
      const ln = this.lineOf(p);
      const end = Math.min(this.tokenEnd(p), this.lineEnd(ln));
      const arr = this.diag.get(ln) ?? [];
      if (!arr.some((m) => p < m.b && end > m.a) && !arr.some((m) => m.a === p)) arr.push({ a: p, b: end, cls: d.cls });
      this.diag.set(ln, arr);
      if (d.cls === 'me' || !this.diagCls.has(ln)) this.diagCls.set(ln, d.cls === 'me' ? 'e' : 'w');
    }
    for (const arr of this.diag.values()) arr.sort((x, y) => x.a - y.a);
  }

  /** Keeps squiggles on their text through an edit until the next parse replaces them. */
  private shiftDiags(a: number, b: number, insLen: number) {
    if (!this.diagList.length) return;
    const d = insLen - (b - a);
    this.diagList = this.diagList.filter((x) => x.p < a || x.p >= b).map((x) => (x.p >= b ? { p: x.p + d, cls: x.cls } : x));
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

  /** Colours a JWT input by part (null: back to JSON highlighting). */
  setJwt(at: readonly number[] | null) {
    const cur = this.jwt;
    if (at === cur || (at && cur && at.every((v, i) => v === cur[i]))) return;
    this.jwt = at;
    this.renderSoon();
  }

  /** Compare: tint whole lines as added / removed / changed (null clears). */
  setLineMarks(marks: Uint8Array | null) {
    if (!marks && !this.lineMarks) return;
    this.lineMarks = marks;
    this.renderSoon();
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
    this.renderSoon();
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
      this.placeScope();
    }
    this.renderSoon();
  }

  /** Positions the scope band over the display rows its lines occupy. */
  private placeScope() {
    const sc = this.scope;
    if (!sc || sc[1] >= this.ls.length) return;
    const r1 = this.yOf(this.rowOf(sc[0]));
    const r2 = this.yOf(this.rowOf(sc[1]) + 1);
    this.scopeY = PAD_T + r1 * LH;
    this.scopeEl.style.transform = `translateY(${this.scopeY + this.sc.shift}px)`;
    this.scopeEl.style.height = `${(r2 - r1) * LH}px`;
  }

  private updateCaret() {
    const [s, e] = this.selection;
    const ln = this.lineOf(s);
    // Wrapped, the band marks the caret's row (a minified document is one line).
    this.curY = PAD_T + (this.wy ? this.vrowOf(s) : this.rowOf(ln)) * LH;
    this.cur.style.transform = `translateY(${this.curY + this.sc.shift}px)`;
    this.cur.style.visibility = this.lineOf(e) !== ln ? 'hidden' : '';
    if (ln !== this.caretLine) {
      this.caretLine = ln;
      return true;
    }
    return false;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  /** Our own textarea edits (folding) are not user input. */
  private quiet = false;

  private onBeforeInput = (e: InputEvent) => {
    if (this.quiet) return;
    if (this.surface && e.cancelable && /^(insertLineBreak|insertParagraph)$/.test(e.inputType)) {
      e.preventDefault();
      this.newline();
      return;
    }
    if (this.surface && e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return this.surface.beforeInput(e);
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      if (e.inputType === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    this.selBefore = this.selection;
    this.selD = e.inputType === 'insertFromDrop' || e.inputType === 'deleteByDrag' ? null : [this.ta.selectionStart, this.ta.selectionEnd];
  };

  /** Textarea selection the pending native edit replaces (null: unknown). */
  private selD: [number, number] | null = null;

  private onInput = (e: Event) => {
    if (this.quiet) return;
    if (this.surface) return this.surface.input(e as InputEvent);
    const it = (e as InputEvent).inputType ?? '';
    const old = this.text;
    this.typing = true;
    this.tabMovesFocus = false;
    if (it !== 'insertFromPaste') this.pasteFull = false;
    if (!this.sync()) return;
    // An IME composition is recorded once, when it ends.
    if (this.compOld === null) this.record(old, this.text, it);
    this.ev.change(it === 'insertFromPaste' || it === 'insertFromDrop' ? 'paste' : 'input');
  };

  /**
   * Brings the model up to date with the textarea after a native edit: the
   * changed range of the textarea text maps to a model range (hidden lines
   * included only when the edit spans a fold). Returns false if nothing changed.
   */
  private sync() {
    const ta = this.ta;
    const now = ta.value;
    const sd = this.selD;
    this.selD = null;
    if (!this.vis) {
      const old = this.text;
      if (now === old) return false;
      if (this.diagList.length) {
        const [a, eo, en] = sd ? editRange(old, now, sd[0], sd[1]) : diffRange(old, now, ta.selectionStart);
        this.shiftDiags(a, eo, en - a);
      }
      this.selAfter = [ta.selectionStart, ta.selectionEnd];
      this.model(now, true);
      return true;
    }
    const old = this.dtext;
    if (now === old) return false;
    const [a, eo, en] = sd ? editRange(old, now, sd[0], sd[1]) : diffRange(old, now, ta.selectionStart);
    const am = this.d2m(a, a < eo);
    const bm = Math.max(am, this.d2m(eo));
    const ins = now.slice(a, en);
    // Map the new selection through the edit (old mapping, shifted).
    const dm = ins.length - (bm - am);
    const map = (d: number) => (d < a ? this.d2m(d) : d <= en ? am + (d - a) : this.d2m(d - (en - eo)) + dm);
    const sel: [number, number] = [map(ta.selectionStart), map(ta.selectionEnd)];
    this.foldsLost = false;
    this.shiftFolds(am, bm, ins);
    this.shiftDiags(am, bm, ins.length);
    this.model(this.text.slice(0, am) + ins + this.text.slice(bm), true);
    // A fold that no longer matches its block was opened: show its lines.
    if (this.foldsLost && ta.value !== this.shown) {
      ta.value = this.shown;
      ta.setSelectionRange(this.m2d(sel[0]), this.m2d(sel[1]));
      this.updateCaret();
      this.render(true);
    }
    this.foldsLost = false;
    this.selAfter = sel;
    return true;
  }

  /**
   * Moves folds through a model edit replacing [a, b) with `ins`: folds before
   * or after it shift, folds whose hidden lines it touches open. `keep`: the
   * textarea is rewritten afterwards, so folds inside an edit that keeps the
   * line count (indent, undo of one) can stay if their block still matches.
   */
  private shiftFolds(a: number, b: number, ins: string, keep = false) {
    if (!this.folded.size) return;
    const t = this.text;
    let d = 0;
    for (let i = ins.indexOf('\n'); i !== -1; i = ins.indexOf('\n', i + 1)) d++;
    for (let i = t.indexOf('\n', a); i !== -1 && i < b; i = t.indexOf('\n', i + 1)) d--;
    const next = new Map<number, number>();
    for (const [o, span] of this.folded) {
      const hs = this.lineEnd(o);
      const he = this.lineEnd(o + span);
      if (b <= hs) next.set(o + d, span);
      else if (a > he || (keep && d === 0)) next.set(o, span);
      else if (!(a <= hs && b > he)) this.foldsLost = true;
    }
    this.folded = next;
  }

  private onCompStart = () => {
    if (this.surface) { this.surface.compositionStart(); this.compOld = this.text; this.compSel = this.selBefore = this.selection; return; }
    this.compOld = this.text;
    this.selBefore = this.selection;
  };

  private onCompEnd = () => {
    const old = this.compOld;
    if (this.surface) {
      this.surface.compositionEnd();
      this.compOld = null;
      this.selBefore = this.compSel;
      if (old !== null) this.record(old, this.text, 'insertText');
      // The composition shrank the document: now the native editor can take over.
      if (this.text.length < SURFACE_CHARS * 0.8) this.model(this.text, false);
      return;
    }
    this.compOld = null;
    this.sync();
    if (old !== null) this.record(old, this.text, 'insertText');
  };

  private onPaste = (e: ClipboardEvent) => {
    const ta = this.ta;
    if (this.surface) {
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        const [a, b] = this.selection;
        this.pasteFull = a === 0 && b === this.text.length;
        if (!this.pasteFull || !this.ev.fullPaste?.(lf(text))) this.apply(a, b, text, undefined, undefined, 'paste');
      }
      return;
    }
    this.pasteFull = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
    // Browsers insert multi-line text line by line (slow for big pastes): do it ourselves.
    const text = e.clipboardData?.getData('text/plain');
    if (text && this.pasteFull && this.ev.fullPaste?.(text.replace(/\r\n?/g, '\n'))) return void e.preventDefault();
    if (text && (text.length > 20_000 || countLines(text, 200) >= 200)) {
      e.preventDefault();
      const [a, b] = this.selection;
      // A whole big document opens quietly in view mode, like a loaded file (see LAZY_CHARS).
      this.loading = this.pasteFull;
      try {
        this.apply(a, b, text.replace(/\r\n?/g, '\n'), undefined, undefined, 'paste');
      } finally {
        this.loading = false;
      }
      if (this.view) this.el.focus({ preventScroll: true });
    }
  };

  /** Copy / cut with folds: the clipboard gets the hidden lines too. */
  private onCopy = (e: ClipboardEvent) => {
    if (this.surface && e.clipboardData) {
      e.preventDefault();
      const [a, b] = this.selection;
      e.clipboardData.setData('text/plain', this.text.slice(a, b));
      if (e.type === 'cut') this.replace(a, b, '');
      return;
    }
    if (!this.vis || !e.clipboardData) return;
    const [a, b] = this.selection;
    if (b - a === this.ta.selectionEnd - this.ta.selectionStart) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.text.slice(a, b));
    if (e.type === 'cut') this.replace(a, b, '');
  };

  /** The fold pill sits under the textarea: find it by position. */
  private pillAt(x: number, y: number) {
    if (!this.folded.size) return -1;
    const rg = document.createRange();
    for (const el of this.hl.querySelectorAll<HTMLElement>('.ed-fold')) {
      rg.selectNodeContents(el);
      for (const r of rg.getClientRects()) {
        if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(el.dataset.f);
      }
    }
    return -1;
  }

  private onPointer = (e: MouseEvent) => {
    this.typing = false;
    const ln = e.button === 0 ? this.pillAt(e.clientX, e.clientY) : -1;
    if (ln >= 0) {
      e.preventDefault();
      this.toggleFold(ln);
    }
  };

  private onHover = (e: MouseEvent) => {
    if (!this.folded.size && !this.ta.style.cursor) return;
    const on = this.pillAt(e.clientX, e.clientY) >= 0;
    this.ta.style.cursor = on ? 'pointer' : '';
  };

  private onGutter = (e: MouseEvent) => {
    const f = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
    if (!f || e.button !== 0) return;
    e.preventDefault();
    this.toggleFold(Number(f.dataset.f));
  };

  private onFocus = () => {
    this.el.classList.toggle('focused', document.activeElement === this.ta);
  };

  private onSel = () => {
    if (document.activeElement !== this.ta) return;
    if (this.surface) return void (this.surface.adopt() && this.surfaceMoved(true));
    if (this.updateCaret()) this.render(true);
    this.ev.caret();
    if (this.typing) this.typing = false;
    else this.ev.nav();
  };

  /** View mode: clicking a line moves the (virtual) caret there. */
  private onViewClick = (e: MouseEvent) => {
    if (!this.view) return;
    const pill = (e.target as HTMLElement).closest('.ed-fold') as HTMLElement | null;
    if (pill) return this.toggleFold(Number(pill.dataset.f));
    if (window.getSelection()?.toString()) return;
    const r = this.body.getBoundingClientRect();
    const vr = Math.max(0, Math.min(this.vrows - 1, Math.floor((e.clientY - r.top - this.sc.shift - PAD_T) / LH)));
    const k = this.kAt(vr);
    const [a, b] = this.rowSpan(k, vr - this.yOf(k));
    const col = Math.max(0, Math.round((e.clientX - r.left - PAD_L) / this.cw));
    // The browser knows which character is under the pointer (wide glyphs, clusters).
    this.vcaret = this.offsetAt(e.clientX, e.clientY) ?? Math.min(a + col, b);
    if (this.wake(this.vcaret)) return;
    if (this.updateCaret()) this.render(true);
    this.ev.caret();
    this.ev.nav();
  };

  /** View mode: model offset of the caret position at a point over the drawn text, if any. */
  private offsetAt(x: number, y: number): number | null {
    const d = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
    let node: Node | null = null;
    let off = 0;
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      if (p) [node, off] = [p.offsetNode, p.offset];
    } else {
      const rg = d.caretRangeFromPoint?.(x, y);
      if (rg) [node, off] = [rg.startContainer, rg.startOffset];
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const row = node.parentElement?.closest<HTMLElement>('[data-o]');
    if (!row || row.parentElement !== this.hl || (node.parentElement as HTMLElement).closest('.ctx, .ed-fold, .meol')) return null;
    let o = Number(row.dataset.o);
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n && n !== node; n = walk.nextNode()) if (!(n.parentElement as HTMLElement).closest('.ctx, .ed-fold, .meol')) o += (n as Text).length;
    o = Math.min(o + off, this.text.length);
    return (this.text.charCodeAt(o) & 0xfc00) === 0xdc00 ? o - 1 : o;
  }

  /** View mode keys (the scroller has focus). */
  private onViewKey = (e: KeyboardEvent) => {
    if (!this.view || e.target !== this.el) return;
    const mod = e.metaKey || e.ctrlKey;
    // An editing key: the textarea takes focus now, so the key's input lands in it.
    if (this.lazy && !mod && !e.altKey && (e.key.length === 1 || e.isComposing || /^(Backspace|Delete|Enter|Process)$/.test(e.key))) {
      this.wake(this.vcaret);
      return;
    }
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
    // Quiet view mode is an editor: paste at the caret.
    const at = this.vcaret;
    if (this.wake(at)) return this.replace(at, at, text.replace(/\r\n?/g, '\n'));
    this.pasteFull = true;
    this.apply(0, this.text.length, text, 0, 0, 'paste');
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (this.surface?.key(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && !e.metaKey))) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    // Fold / unfold the block around the caret: Ctrl+Shift+[ ] (⌥⌘[ ] on macOS, like VS Code).
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && ((mod && e.shiftKey && !e.altKey) || (e.metaKey && e.altKey))) {
      e.preventDefault();
      this.foldAtCaret(e.code === 'BracketLeft');
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

  /** `r`: the changed range [start, old end, new end] when known (no diffing a big document). */
  private record(old: string, now: string, kind: string, r?: [number, number, number]) {
    if (old === now) return;
    const sb = this.selBefore;
    const [a, eo, en] = r ?? diffRange(old, now, Math.min(sb[0], this.selAfter[0]));
    const ch: Change = {
      a,
      del: old.slice(a, eo),
      ins: now.slice(a, en),
      selB: sb,
      selA: this.selAfter,
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
    this.shiftFolds(a, b, text, true);
    this.shiftDiags(a, b, text.length);
    this.model(v.slice(0, a) + text + v.slice(b), false, !!this.surface);
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
    const da = this.m2d(a);
    const db = this.m2d(b);
    // Through the textarea only when [a, b) holds no hidden lines.
    const plain = this.d2m(da) === a && this.d2m(db) === b && db - da === b - a;
    if (!this.view && !this.surface && plain && text.length + (b - a) < 4000 && countLines(text, 40) < 40) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(da, db);
      this.selBefore = [a, b];
      this.selD = [da, db];
      let ok = false;
      try {
        ok = text ? document.execCommand('insertText', false, text) : a === b || document.execCommand('delete');
      } catch {
        ok = false;
      }
      if (ok) {
        if (selA !== undefined) ta.setSelectionRange(this.m2d(selA), this.m2d(selB ?? selA));
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
    this.shiftFolds(a, b, text, true);
    this.shiftDiags(a, b, text.length);
    this.model(v.slice(0, a) + text + v.slice(b), false, !!this.surface);
    this.select(s1, s2, false);
    this.ev.change(kind);
  }

  /** Replaces the whole document as one undoable step. `load`: a new document (see LAZY_CHARS). */
  setValue(next: string, caret = 0, load = false) {
    next = lf(next);
    if (next !== this.text) {
      this.forceEdit = false;
      this.loading = load;
      try {
        this.apply(0, this.text.length, next, caret, caret, 'set');
      } finally {
        this.loading = false;
      }
    }
    this.select(caret, caret, true);
  }

  select(a: number, b: number, center = true) {
    this.unhide(a);
    this.unhide(b);
    if (this.surface) {
      this.ta.focus({ preventScroll: true });
      this.surface.select(a, b);
    } else if (this.view) {
      this.vcaret = a;
      if (b > a) this.setScope(a, b);
    } else {
      this.ta.focus({ preventScroll: true });
      this.ta.setSelectionRange(this.m2d(a), this.m2d(b));
    }
    if (this.updateCaret() && !this.surface) this.render(true);
    this.reveal(a, center);
    if (this.surface) this.ev.caret();
  }

  /** Scrolls so that `off` is visible. */
  reveal(off: number, center = false) {
    this.unhide(off);
    const ln = this.lineOf(off);
    const el = this.el;
    const vh = el.clientHeight;
    const y = PAD_T + this.vrowOf(off) * LH;
    const st = this.sc.top;
    if (y < st + LH || y + LH * 2 > st + vh) {
      this.sc.top = center ? y - vh / 2 + LH : y < st ? y - LH : y - vh + LH * 3;
    }
    if (!this.wy) {
      const x = PAD_L + (off - this.ls[ln]) * this.cw;
      const vw = el.clientWidth - this.gutW;
      if (x < el.scrollLeft || x > el.scrollLeft + vw - 40) el.scrollLeft = Math.max(0, x - vw / 2);
    }
    this.render(false);
  }

  /** Is `off` currently on screen (vertically and horizontally)? */
  isVisible(off: number) {
    if (this.hidden(off)) return false;
    const y = PAD_T + this.vrowOf(off) * LH;
    const el = this.el;
    const st = this.sc.top;
    if (y < st || y + LH > st + el.clientHeight) return false;
    if (this.wy) return true;
    const x = PAD_L + (off - this.ls[this.lineOf(off)]) * this.cw;
    return x >= el.scrollLeft && x <= el.scrollLeft + el.clientWidth - this.gutW - 24;
  }

  private indent(dir: 1 | -1) {
    const v = this.text;
    const [s, e] = this.selection;
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
    const v = this.text;
    const [s, e] = this.selection;
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
    this.reveal(this.caret);
  }

  /** Typing a closer on a whitespace-only line removes one indent level first. */
  private dedentCloser(ch: string) {
    const [s, e] = this.selection;
    if (s !== e) return false;
    const v = this.text;
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
    if (this.wy) {
      // By visual rows, keeping the column within the row.
      const back = ta.selectionDirection === 'backward';
      const [s, e] = this.selection;
      const focus = back ? s : e;
      const anchor = back ? e : s;
      const vr = this.vrowOf(focus);
      const k = this.kAt(vr);
      const col = focus - this.rowSpan(k, vr - this.yOf(k))[0];
      const target = Math.max(0, Math.min(this.vrows - 1, vr + dir * lines));
      const k2 = this.kAt(target);
      const sub = target - this.yOf(k2);
      const [a, b] = this.rowSpan(k2, sub);
      // A row's end is the next row's start, except on the line's last row.
      const off = Math.max(a, Math.min(a + col, sub + 1 < this.yOf(k2 + 1) - this.yOf(k2) ? b - 1 : b));
      if (extend) ta.setSelectionRange(this.m2d(Math.min(anchor, off)), this.m2d(Math.max(anchor, off)), off < anchor ? 'backward' : 'forward');
      else ta.setSelectionRange(this.m2d(off), this.m2d(off));
      this.sc.top += dir * lines * LH;
      this.typing = false;
      return;
    }
    const focus = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const anchor = ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart;
    // Rows of the textarea text (folded lines excluded).
    const start = (k: number) => (this.dls ? this.dls[k] : this.ls[k]);
    const end = (k: number) => (k + 1 < this.rows ? start(k + 1) - 1 : this.shown.length);
    const k = this.dRowOf(focus);
    const col = focus - start(k);
    const target = Math.max(0, Math.min(this.rows - 1, k + dir * lines));
    const off = Math.min(start(target) + col, end(target));
    if (extend) ta.setSelectionRange(Math.min(anchor, off), Math.max(anchor, off), off < anchor ? 'backward' : 'forward');
    else ta.setSelectionRange(off, off);
    this.sc.top += dir * lines * LH;
    this.typing = false;
  }
}
