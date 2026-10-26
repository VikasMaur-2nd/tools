import { Doc } from './doc';
import { bidiContext, escapeHtml, highlightLine, jwtLine, mayReorder, StringStates, stringState, trimWs, type Mark } from './highlight';
import type { Surface } from './surface';
import { TallScroll } from './tall';
import { foldScanner, foldsAround, foldSig, lineEndIn, lineOfIn, lineStarts, maxWidth, patchLines, scanFolds, shiftFoldLines, widest } from './lines';
import { LONG_LINE, Wrapper, type Src } from './wrap';
import { rt } from '../i18n/ui';

/*
 * The document lives in `text` (the model). Three presentations:
 *
 *  - Edit mode: a native <textarea> (caret, selection, IME, accessibility)
 *    sized to its full content, layered over a virtualized syntax-highlighted
 *    copy of the visible lines. Both share one scroll container, so they move
 *    together natively: no scroll lag.
 *  - Big documents (and long or many lines, which the textarea lays out on
 *    every key): Surface captures input in a bounded textarea, maps it into
 *    the model, and draws the selection over the virtual rows. Every document
 *    is editable, at any size.
 *  - The quiet view: the virtualized copy alone, no textarea. A loaded document
 *    the textarea would hold opens in it (laying out that textarea is most of
 *    the time opening it takes), as does a big one while Surface's module is on
 *    its way; the first click, key or paste goes on in the editor (see `wake`).
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
/** The most the native textarea takes, while the big-document editor's module is on its way (see `wait`). */
const NATIVE_CHARS = 2_000_000;
/**
 * Loaded documents this big that the textarea would hold open in the quiet view: laying out a
 * textarea that holds them is most of the time it takes to open them (see `wake`).
 */
const LAZY_CHARS = 100_000;
/** Keep native editing for normal documents: from this size, or this many lines, the big-document editor. */
const SURFACE_CHARS = 250_000;
const SURFACE_LINES = 30_000;
/**
 * From this many lines, a new document's fold structure is found in slices after it shows (see scanFoldsLater):
 * in one go it took 0.3 to 1.2 s of the freeze opening a pretty-printed document of 2 to 4 million lines.
 */
const FOLD_STEP_LINES = 200_000;
/**
 * From this many lines, an edit that may open or close blocks finds the blocks around it that way too (the
 * others stand, see foldsAround): a scan for each such key took 0.4 to 0.5 s on a document of 400K lines.
 */
const FOLD_EDIT_LINES = 20_000;
/**
 * A line this long gets the big-document editor at any size: the textarea lays out the whole line on
 * every key, so a minified document is slow to type in long before it is big.
 */
const LONG_LINE_CHARS = 5_000;
/** The big-document editor's module: most visits never need it, so it loads on first need (and when the page is idle, see Engine). */
let SurfaceClass: typeof Surface | undefined;
let surfaceLoad: Promise<void> | undefined;
export function loadSurface() {
  return (surfaceLoad ??= (async () => {
    // A flaky network can fail a fetch: try again a few times, then give up until the next need.
    for (let k = 0; k < 4; k++) {
      try {
        SurfaceClass = (await import('./surface')).Surface;
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * 2 ** k));
      }
    }
    surfaceLoad = undefined;
  })());
}
/** Edits inserting at most this much patch the line state (see model); bigger ones rescan. */
const PATCH_CHARS = 1 << 16;
/**
 * The document an editor leaves to the next editor on the same textarea. Next.js keeps a page's DOM while the
 * visitor is on another page (hidden in an <Activity>) and the app starts again on it when they come back: the
 * document reopens from here as it was. Written into the hidden textarea instead, a 7 MB document had to be laid
 * out natively on the way back, and the tab died.
 */
const kept = new WeakMap<HTMLTextAreaElement, Doc>();

export type ChangeKind = 'input' | 'paste' | 'set';

export interface EditorEvents {
  change(kind: ChangeKind): void;
  caret(): void;
  /** Caret moved by the user (click / keyboard navigation), not by typing. */
  nav(): void;
  escape(): void;
  /** Copy the whole document (view mode has no textarea to copy from). */
  copyAll(): void;
  /** A paste replaces the whole document with `text`: true if the listener loads it instead (see Engine.load). */
  fullPaste?(text: string): boolean;
  /**
   * Input is about to be handled: a document still on its way to the editor must arrive first.
   * `edit`: the input edits, so the document is editable at once (else it arrives as it would have).
   */
  flush?(edit: boolean): void;
}

/** Colours [a, b) of `text`, which starts at document offset `at`, as escaped HTML: for a document that isn't JSON (see setColors). */
export type Colors = (text: string, a: number, b: number, at: number) => string;

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
 * it changed, not the view. `offs`: each row's model offset, its `data-o`
 * (kept apart: typing moves the offsets of every row after the caret, not
 * their text, so those rows only have the attribute updated).
 */
function patch(el: HTMLElement, old: string[], rows: string[], offs: number[] | null) {
  // (Every row starts with `<div`.)
  const html = (i: number) => (offs ? `<div data-o="${offs[i]}"${rows[i].slice(4)}` : rows[i]);
  let f = 0;
  let a = old.length;
  let b = rows.length;
  while (f < a && f < b && old[f] === rows[f]) f++;
  while (a > f && b > f && old[a - 1] === rows[b - 1]) {
    a--;
    b--;
  }
  const kids = el.children;
  if (kids.length !== old.length || (!f && a === old.length)) return void (el.innerHTML = rows.map((_, i) => html(i)).join(''));
  for (let i = a - 1; i >= f; i--) kids[i].remove();
  let add = '';
  for (let i = f; i < b; i++) add += html(i);
  if (f < kids.length) kids[f].insertAdjacentHTML('beforebegin', add);
  else el.insertAdjacentHTML('beforeend', add);
  if (!offs) return;
  for (let i = 0; i < rows.length; i++) {
    if (i >= f && i < b) continue;
    const o = String(offs[i]);
    if (kids[i].getAttribute('data-o') !== o) kids[i].setAttribute('data-o', o);
  }
}

/** Marks moved into a slice of the text starting at `o`. */
const moved = (ms: Mark[] | null, o: number) => (!ms || !o ? ms : ms.map((m) => ({ a: m.a - o, b: m.b - o, cls: m.cls })));

/** The changed range `r` ([start, old end, new end]) grown by replacing [a, b) of its new text with `n` characters. */
function grow(r: [number, number, number] | null, a: number, b: number, n: number): [number, number, number] {
  if (!r) return [a, b, a + n];
  let [lo, eo, en] = r;
  if (a < lo) lo = a;
  if (b > en) {
    eo += b - en;
    en = b;
  }
  return [lo, eo, en + n - (b - a)];
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

  /** The document: an edit makes a new version without copying a big text (see Doc). */
  private doc = Doc.of('');
  /** The document as one string (built when first read after an edit: per-key code reads `doc`). */
  get text(): string {
    return this.doc.toString();
  }
  /**
   * The document for the wrapper and the string states, which tell versions
   * apart by identity: the string itself while it is one (as the native
   * textarea's always is), else the Doc.
   */
  private get src(): Src {
    return this.doc.flat ?? this.doc;
  }
  /** The document's version: a new object after every edit (compare by identity, without building the text). */
  get version(): object {
    return this.doc;
  }
  /** Characters in the document (without building it). */
  get length(): number {
    return this.doc.length;
  }
  /** Is the document empty or only whitespace? (Without building it.) */
  get blank(): boolean {
    let ink = false;
    this.doc.each(0, this.doc.length, (s, i, j) => (ink = /\S/.test(i === 0 && j === s.length ? s : s.slice(i, j))));
    return !ink;
  }
  /** Line start offsets. */
  ls: number[] = [0];
  /** The quiet view (see the top of this file): the virtualized copy without a textarea. */
  view = false;
  indentUnit = '  ';
  /** Last paste replaced the whole document. */
  pasteFull = false;

  private surface: Surface | null = null;
  /** Asked to edit (a click, key or paste in the quiet view): it ends, unless the module it waits for is still coming. */
  private forceEdit = false;
  /** In the quiet view (see LAZY_CHARS); `loading`: setValue is loading a document. */
  private lazy = false;
  private loading = false;
  private vcaret = 0;
  /** After Esc, the next Tab moves focus instead of indenting (no keyboard trap). */
  private tabMovesFocus = false;
  /** Text before an IME composition started (recorded as one undo step). */
  private compOld: Doc | null = null;
  /** What the composition changed so far: [start, end before it, end now] (null: nothing yet). */
  private compR: [number, number, number] | null = null;
  private compSel: [number, number] = [0, 0];
  private cw = 7.8;
  private maxCols = 0;
  /** maxCols may be out of date (edits while soft-wrapped don't measure lines). */
  private maxStale = false;
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
  /** Colours for a document that isn't JSON (null: JSON highlighting). */
  private colors: Colors | null = null;
  /** Shown, selected and copied, never edited by the user (see setReadOnly). */
  private locked = false;
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
  private close: Int32Array = new Int32Array(1).fill(-1);
  /** Nesting depth of each block opener. */
  private depth: Int32Array = new Int32Array(1);
  /** Folded opener line → its span (closer line - opener line) when folded. */
  private folded = new Map<number, number>();
  /** Model lines shown, in order (null: nothing folded, display = model). */
  private vis: Int32Array | null = null;
  /** Display line starts (offsets into the textarea text) while folded. */
  private dls: Int32Array | null = null;
  /** The textarea text while folded (built when first needed: the big-document editor never needs it). */
  private dtextCache: string | null = null;
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
    el.addEventListener('pointerdown', this.onPress, true);
    el.addEventListener('mouseup', this.onViewClick);
    el.addEventListener('paste', this.onViewPaste);
    document.addEventListener('selectionchange', this.onSel);
    this.ro = new ResizeObserver(() => {
      // Hidden (display: none): nothing to lay out, and no width would rewrap the whole document into one
      // column. Shown again, the observer fires again.
      if (!el.getClientRects().length) return;
      if (this.fontsStale) this.fontsChanged();
      else if (!this.measured) this.measure();
      this.layout();
      this.render(true);
    });
    this.ro.observe(el);
    const left = kept.get(ta);
    kept.delete(ta);
    // A document left on this textarea by the editor before (see kept) opens like a restored one.
    if (left?.length) this.model(left, false);
    else this.model(ta.value, true);
    // The code font may arrive after first paint, and its subsets for other
    // scripts when such text appears: re-measure glyphs (and wrapped rows) then.
    document.fonts?.ready.then(this.onFonts);
    document.fonts?.addEventListener('loadingdone', this.onFonts);
  }

  private onFonts = () => {
    if (this.gone || !this.el.isConnected) return;
    // Hidden (Compare's editor in another view): it has no width to wrap to, so a long line would be laid
    // out as one row and drawn whole. Shown again, the observer applies the font.
    if (!this.el.getClientRects().length) {
      this.fontsStale = true;
      return;
    }
    if (this.fontsChanged()) this.layout();
    this.render(true);
  };

  /** A font arrived while the editor was hidden (see onFonts). */
  private fontsStale = false;

  /** Re-measures glyphs for a font that arrived: true if rows must be laid out again. */
  private fontsChanged() {
    this.fontsStale = false;
    const cw = this.cw;
    this.measure();
    // Rows only move if a width changed (always re-measured while matching a textarea).
    if (this.cw === cw && this.wrapper && !this.wrapper.fontsLoaded()) return false;
    if (this.cw !== cw) this.wrapper?.reset();
    this.wrapDirty = true;
    return true;
  }

  /**
   * Destroyed: work it started that ends later (the big-document editor's module, the code font, a fold
   * scan) must leave the element alone, which a new editor may have by then.
   */
  private gone = false;

  destroy() {
    this.gone = true;
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
    this.el.removeEventListener('pointerdown', this.onPress, true);
    this.el.removeEventListener('mouseup', this.onViewClick);
    this.el.removeEventListener('paste', this.onViewPaste);
    document.removeEventListener('selectionchange', this.onSel);
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    this.ro.disconnect();
    this.sc.destroy();
    cancelAnimationFrame(this.raf);
    this.wrapper?.destroy();
    this.surface?.destroy();
    this.el.classList.remove('hl-on', 'vmode', 'wrap');
    // The next editor on this textarea takes the document from memory (see kept), not from the textarea.
    kept.set(ta, this.doc);
    ta.value = '';
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
   * `fromTa`: the textarea already holds `t` (user input). `edit`: what changed
   * from the last document (a bounded edit patches what derives from it).
   */
  private model(t: string | Doc, fromTa: boolean, defer = false, edit?: { a: number; b: number; ins: string }) {
    const old = this.doc;
    const doc = typeof t === 'string' ? Doc.of(t) : t;
    const fits = !!edit && old.length - (edit.b - edit.a) + edit.ins.length === doc.length;
    /** A new document (loaded, or all of it replaced), not an edit of this one. */
    const fresh = !edit || this.loading || (edit.a === 0 && edit.b === old.length);
    this.lineEdit = null;
    // The wrapper may reuse rows outside this edit, in the rows() call this model() makes (see rewrap).
    this.wrapEdit = edit && fits && old === this.wrapText ? [edit.a, edit.b, edit.a + edit.ins.length] : null;
    this.doc = doc;
    // String states before the edit stand (see StringStates).
    if (edit && fits) this.strs.edited(old.flat ?? old, this.src, edit.a);
    let folds: { close: Int32Array; depth: Int32Array } | null = null;
    /** The edit may have opened or closed blocks in a long document: `folds` is what stands, the rest is found later. */
    let around = false;
    /** The edit kept every line's part in the fold structure, and the line count. */
    let kept = false;
    if (edit && fits && edit.ins.length <= PATCH_CHARS) {
      // A bounded edit: patch the line starts and the widest line instead of rescanning the document.
      const { a, b, ins } = edit;
      const ls = this.ls;
      const n0 = ls.length;
      const la = lineOfIn(ls, a);
      const lb = lineOfIn(ls, b);
      // The fold structure stands if the edited lines keep their parts in it, or neither open nor close a block
      // before or after the edit (then the lines after them only move).
      const known = this.close.length === n0;
      const few = lb - la <= 64 && known;
      const was = few ? Array.from({ length: lb - la + 1 }, (_, k) => foldSig(old, ls[la + k], lineEndIn(ls, old.length, la + k))) : [];
      // Soft-wrapped, the widest line only matters once wrapping is off (see layout): skip measuring it.
      const widths = !this.el.classList.contains('wrap');
      const r = patchLines(ls, old, doc, a, b, ins, this.maxCols, widths, doc.tabs);
      this.lineEdit = [la, la + r.added + 1];
      this.maxCols = r.max;
      if (!widths) this.maxStale = true;
      if (few && r.added <= 64) {
        const now = Array.from({ length: r.added + 1 }, (_, k) => foldSig(doc, ls[la + k], lineEndIn(ls, doc.length, la + k)));
        const plain = (s: number) => (s & 10) === 0;
        if (now.length === was.length && now.every((s, k) => s === was[k])) {
          folds = { close: this.close, depth: this.depth };
          kept = true;
        }
        else if (was.every(plain) && now.every(plain)) folds = shiftFoldLines(this.close, this.depth, la, lb, r.added);
      }
      if (!folds && !fresh && known && ls.length >= FOLD_EDIT_LINES) {
        folds = foldsAround(this.close, this.depth, la, lb, r.added);
        around = true;
      }
    } else if (doc === old) {
      // The same document, presented another way (the quiet view ends, the big-document editor arrives): its
      // lines and folds stand. Scanning them again took 0.1 to 0.5 s on documents of a million lines and more.
      folds = { close: this.close, depth: this.depth };
    } else {
      // (A long edit of a long document: its lines are found again, the blocks around it after it shows.)
      const near = edit && fits && !fresh && this.close.length === this.ls.length;
      const la = near ? lineOfIn(this.ls, edit.a) : -1;
      const lb = near ? lineOfIn(this.ls, edit.b) : -1;
      const { ls, max, tabs } = lineStarts(doc.toString());
      doc.knowTabs(tabs);
      this.maxStale = false;
      if (near && ls.length >= FOLD_EDIT_LINES) {
        folds = foldsAround(this.close, this.depth, la, lb, countLines(edit.ins, Infinity));
        around = true;
      }
      this.ls = ls;
      this.maxCols = max;
    }
    if (doc !== old) {
      // A big new document's folds are found after it shows, as are the blocks around an edit of a long one
      // that may have opened or closed some; an edit meanwhile starts that over, from what it leaves standing,
      // unless it kept the structure (then the scan goes on). (Folds the user made in blocks the edit can't
      // change survive it.)
      const pending = this.foldsFor !== null;
      if (fresh ? this.ls.length >= FOLD_STEP_LINES && (pending || !folds) : around || (pending && folds && !kept)) folds = this.scanFoldsLater(fresh ? null : folds);
      else if (pending && !kept) {
        this.foldsFor = null;
        folds = null;
      }
    }
    this.extraW = 0;
    this.scanFolds(folds);
    this.buildDisplay();
    if (this.diagList.length) this.buildDiag();

    // Every document is editable. The quiet view is only for a loaded document the textarea would hold (see
    // LAZY_CHARS), or that waits for the big-document editor's module (it is usually cached already; see
    // loadSurface below): laying a long line out in the textarea meanwhile took seconds. Typing never enters it.
    const len = doc.length;
    const want = this.wantsSurface(1);
    const wait = len > NATIVE_CHARS && !SurfaceClass;
    const quiet = wait || ((!want || !SurfaceClass) && (this.view ? this.lazy : this.loading && len > LAZY_CHARS));
    const view = (wait || !this.forceEdit) && quiet && !(fromTa && !this.view);
    this.lazy = view;
    // A user edit keeps the big-document editor until the text (or its longest line) is well under the
    // threshold (no flip-flopping at it), and never leaves it mid-composition (see onCompEnd).
    let custom = !view && (want || (!!this.surface && fromTa && (this.wantsSurface(0.8) || this.compOld !== null)));
    if (want && !SurfaceClass) {
      // Native editing until the module arrives (it is usually cached already), then switch.
      custom = false;
      void loadSurface().then(() => {
        if (this.gone || !SurfaceClass || this.surface || !this.el.isConnected || !this.wantsSurface(1)) return;
        // Switch to it, from the textarea or from the quiet view it was waiting in. Focus in that view (a big
        // paste moves it there) goes on in the editor at its caret, as when the user asked to edit meanwhile:
        // keys would otherwise land on the scroller and be lost.
        const asked = this.view && (this.forceEdit || document.activeElement === this.el);
        const at = this.vcaret;
        this.model(this.doc, false);
        if (asked) {
          this.focus();
          this.setCaret(at);
        }
      });
    }
    // (Switching editors keeps the selection: the status bar is told, as no caret event follows.)
    const switched = custom !== !!this.surface;
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
      if (!this.view) this.vcaret = Math.min(this.caret, len);
      if (this.ta.value) this.ta.value = '';
    } else if (!fromTa) {
      this.ta.value = this.shown;
    }
    if (view !== this.view) {
      this.view = view;
      this.el.classList.toggle('vmode', view);
      this.el.tabIndex = view ? 0 : -1;
      this.ev.caret();
    } else if (switched) this.ev.caret();
    this.wrapDirty = true;
    this.layout();
    this.updateCaret();
    this.placeScope();
    if (this.surface && (fromTa || defer)) this.renderSoon();
    else this.render(true);
  }

  private makeSurface() {
    const doc = () => this.doc;
    return new SurfaceClass!({
      el: this.el, ta: this.ta,
      get length() { return doc().length; },
      slice: (a, b) => this.doc.slice(a, b),
      charCodeAt: (i) => this.doc.charCodeAt(i),
      line: (off) => { const ln = this.lineOf(off); return [this.ls[ln], this.lineEnd(ln)]; },
      edit: (a, b, text, kind) => this.surfaceEdit(a, b, text, kind),
      moved: (nav, reveal) => this.surfaceMoved(nav, reveal),
      point: (x, y) => this.pointAt(x, y),
      row: (off) => { const r = this.vrowOf(off); const k = this.kAt(r); return [r, ...this.rowSpan(k, r - this.yOf(k))]; },
      span: (row) => { row = Math.max(0, Math.min(this.vrows - 1, row)); const k = this.kAt(row); return this.rowSpan(k, row - this.yOf(k)); },
      reveal: (off) => this.reveal(off),
      scroll: (dy, dx) => { this.sc.top += dy; this.el.scrollLeft += dx; this.render(false); },
      fold: (ln) => this.toggleFold(ln),
    });
  }

  private surfaceMoved(nav: boolean, reveal = true) {
    this.updateCaret();
    if (reveal) this.reveal(this.caret);
    else this.render(false);
    this.ev.caret();
    if (nav) this.ev.nav();
  }

  /** The input passage reports a bounded replacement in model offsets. */
  private surfaceEdit(a: number, b: number, ins: string, kind: string) {
    if (this.locked) return;
    const old = this.doc;
    if (a === b && !ins) return;
    this.selBefore = this.surface!.selection;
    this.selAfter = [a + ins.length, a + ins.length];
    this.typing = true;
    this.tabMovesFocus = false;
    this.pasteFull = false;
    this.shiftFolds(a, b, ins, true);
    this.shiftDiags(a, b, ins.length);
    this.model(old.edit(a, b, ins), true, false, { a, b, ins });
    this.surface?.select(...this.selAfter);
    if (this.compOld === null) this.record(old, this.doc, kind, [a, b, a + ins.length]);
    else this.compR = grow(this.compR, a, b, ins.length);
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

  /** Leaves the quiet view for the editor, caret at `at`. True if it did. */
  private wake(at: number) {
    if (!this.view) return false;
    this.edit();
    this.setCaret(at);
    return true;
  }

  /** A press in the editor: a document still on its way arrives first (see EditorEvents.flush). */
  private onPress = () => {
    this.ev.flush?.(false);
  };

  /** The user is working in the editor: a document waiting in the quiet view becomes editable now. */
  takeOver() {
    if (this.view) this.edit();
  }

  /** Is the document (by `share` of the thresholds) one for the big-document editor: big, or with many or long lines? */
  private wantsSurface(share: number) {
    const len = this.doc.length;
    return len >= SURFACE_CHARS * share || this.ls.length >= SURFACE_LINES * share || widest(this.ls, len) >= LONG_LINE_CHARS * share;
  }

  /** Leaves the quiet view for the editor (see `wake`), caret where it was. */
  private edit() {
    this.forceEdit = true;
    const caret = this.vcaret;
    this.model(this.doc, false);
    this.focus();
    this.setCaret(caret);
  }

  lineEnd(ln: number) {
    return lineEndIn(this.ls, this.doc.length, ln);
  }

  lineOf(off: number) {
    return lineOfIn(this.ls, off);
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
    return this.doc.slice(a, b);
  }

  // ── Context menu (components/ContextMenu.tsx): what the keys would do ───

  get canUndo() {
    return !this.locked && this.undo_.length > 0;
  }

  get canRedo() {
    return !this.locked && this.redo_.length > 0;
  }

  /** Cut can remove the selection: an editable document with one. */
  get canCut() {
    if (this.locked || this.view) return false;
    const [a, b] = this.selection;
    return a < b;
  }

  /** Paste can land (in the quiet view at its caret, as Ctrl+V does). */
  get canPaste() {
    return !this.locked;
  }

  /** Model offset of the character nearest a point over the rows. */
  private pointAt(x: number, y: number) {
    const exact = this.offsetAt(x, y);
    if (exact !== null) return exact;
    const box = this.body.getBoundingClientRect();
    const row = Math.max(0, Math.min(this.vrows - 1, Math.floor((y - box.top - this.sc.shift - PAD_T) / LH)));
    const k = this.kAt(row);
    const [a, b] = this.rowSpan(k, row - this.yOf(k));
    return Math.min(b, a + Math.max(0, Math.round((x - box.left - PAD_L) / this.cw)));
  }

  /**
   * A right click at a point: returns the model line under it. Like a textarea's own right click, it
   * moves the caret there unless it lands in the selection (the big-document editor and the view leave
   * right presses to this). The quiet view stays asleep: Paste and the edit keys wake it.
   */
  menuAt(x: number, y: number) {
    const off = this.pointAt(x, y);
    if (this.surface) {
      const [a, b] = this.surface.selection;
      if (off < a || off > b) {
        this.surface.select(off);
        this.surfaceMoved(true, false);
      }
    } else if (this.view && !this.shownSelection()) {
      this.vcaret = off;
      if (this.updateCaret()) this.render(true);
      this.ev.caret();
    }
    return this.lineOf(off);
  }

  /** View mode: the text selected on screen in this editor. */
  private shownSelection() {
    const s = window.getSelection();
    return s?.rangeCount && this.el.contains(s.anchorNode) ? s.toString() : '';
  }

  /** The caret's row on screen: where a menu opened from the keyboard goes. */
  caretBox() {
    const box = this.body.getBoundingClientRect();
    const view = this.el.getBoundingClientRect();
    const row = this.cur.getBoundingClientRect();
    const [s] = this.selection;
    const ln = this.lineOf(s);
    const k = this.rowOf(ln);
    // (A line wrapped onto more rows: its row's start, the column being the line's.)
    const x = box.left + PAD_L + (this.wy && this.wy[k + 1] - this.wy[k] > 1 ? 0 : (s - this.ls[ln]) * this.cw);
    const top = Math.max(view.top, Math.min(row.top, view.bottom - LH));
    return { x: Math.max(view.left + this.gutW, Math.min(x, view.right - 24)), top, bottom: top + LH };
  }

  /** The block Fold or Unfold acts on at model line `ln`: the innermost one around it (null: none). */
  foldTarget(ln: number): { line: number; folded: boolean } | null {
    if (this.folded.has(ln)) return { line: ln, folded: true };
    const close = this.close;
    for (let o = Math.min(ln, close.length - 1); o >= 0; o--) if (close[o] >= ln) return { line: o, folded: false };
    return null;
  }

  /** What Copy copies, read when the menu opens (null: nothing is selected). */
  clip(): (() => string) | null {
    if (this.view) {
      const text = this.shownSelection();
      return text ? () => text : null;
    }
    const [a, b] = this.selection;
    return a < b ? () => this.doc.slice(a, b) : null;
  }

  /** Removes the selection as one undoable step (the caller copied it). */
  cut() {
    if (!this.canCut) return;
    const [a, b] = this.selection;
    this.replace(a, b, '');
  }

  /** Pastes `text` where Ctrl+V would put it (see onPaste and viewPaste). */
  paste(text: string) {
    if (this.locked || !text) return;
    this.ev.flush?.(true);
    text = lf(text);
    if (this.view) {
      const at = this.vcaret;
      this.wake(at);
      return this.replace(at, at, text);
    }
    const [a, b] = this.selection;
    this.pasteFull = (a === 0 && b === this.doc.length) || (!this.surface && this.blank);
    if (this.pasteFull && this.ev.fullPaste?.(text)) return;
    // A whole big document opens quietly in view mode, like a loaded file (see LAZY_CHARS).
    this.loading = this.pasteFull && !this.surface;
    try {
      this.apply(a, b, text, undefined, undefined, 'paste');
    } finally {
      this.loading = false;
    }
    if (this.view) this.el.focus({ preventScroll: true });
  }

  /** Selects the whole document as Ctrl+A does, without scrolling. */
  selectEverything() {
    this.ev.flush?.(false);
    if (this.view) {
      // (The quiet view goes on in the editor, as Ctrl+A does there.)
      this.wake(this.vcaret);
      this.select(0, this.doc.length, false);
      this.ev.caret();
    } else if (this.surface) {
      this.ta.focus({ preventScroll: true });
      this.surface.select(0, this.doc.length);
      this.surfaceMoved(true, false);
    } else {
      this.ta.focus({ preventScroll: true });
      this.ta.select();
    }
  }

  // ── Folding ────────────────────────────────────────────────────────────

  /**
   * A line ending in `{` or `[` opens a block that the next line starting with
   * the matching closer ends (same rule as the output view: exact for
   * formatted JSON, linear in lines). A block folds only if its closing line
   * is just the closer (`}` or `},`): that line hides with it. Re-validates
   * folds after edits. `known`: the structure, worked out from the last one.
   */
  private scanFolds(known: { close: Int32Array; depth: Int32Array } | null = null) {
    const { close, depth } = known ?? scanFolds(this.doc, this.ls);
    const n = this.ls.length;
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

  /** The scan finding the fold structure (see scanFoldsLater); null: it is known. */
  private foldsFor: object | null = null;
  /** The arrays of the scan in progress, and those of one given up (the next one fills them: no megabytes per key). */
  private scanning: { close: Int32Array; depth: Int32Array } | null = null;
  private spare: { close: Int32Array; depth: Int32Array } | null = null;

  /**
   * Finds the document's fold structure in slices, then shows its fold markers. Returns the structure until
   * then: `known` (what an edit leaves standing), else no blocks at all.
   */
  private scanFoldsLater(known: { close: Int32Array; depth: Int32Array } | null) {
    const n = this.ls.length;
    const scanFor = {};
    if (this.scanning) this.spare = this.scanning;
    this.scanning = null;
    this.foldsFor = scanFor;
    // (Made when it starts: typing restarts it at every key that opens or closes a block.)
    let scan: ReturnType<typeof foldScanner> | null = null;
    const run = () => {
      // (An edit or another document since: this scan is stale, and the lines it reads may have changed.)
      if (this.gone || this.foldsFor !== scanFor || !this.el.isConnected) return;
      if (!scan) {
        this.scanning = this.spare?.close.length === n ? this.spare : { close: new Int32Array(n), depth: new Int32Array(n) };
        this.spare = null;
        scan = foldScanner(this.doc, this.ls, this.scanning);
      }
      const res = scan(performance.now() + 8, this.doc);
      if (!res) return void setTimeout(run, 0);
      this.foldsFor = null;
      this.scanning = null;
      const had = this.folded.size;
      this.scanFolds(res);
      // (A fold that no longer matches its block opens.)
      if (this.folded.size !== had) this.refold(-1);
      else this.renderSoon();
    };
    setTimeout(run, 0);
    return known ?? { close: new Int32Array(n).fill(-1), depth: new Int32Array(n) };
  }

  /** Rebuilds the visible-line map and the textarea text from the folds. */
  private buildDisplay() {
    this.wrapDirty = true;
    this.dtextCache = null;
    if (!this.folded.size) {
      this.vis = null;
      this.dls = null;
      return;
    }
    const n = this.ls.length;
    const vis: number[] = [];
    for (let i = 0; i < n; i++) {
      vis.push(i);
      // Hide [end of the opener line, end of the closer line).
      if (this.folded.has(i)) i = this.close[i];
    }
    const dls = new Int32Array(vis.length);
    let p = 0;
    for (let k = 0; k < vis.length; k++) {
      dls[k] = p;
      p += this.lineEnd(vis[k]) - this.ls[vis[k]] + 1;
    }
    this.vis = Int32Array.from(vis);
    this.dls = dls;
  }

  /** The textarea text while folded: the model minus folded lines. */
  private get dtext(): string {
    if (this.dtextCache !== null) return this.dtextCache;
    const vis = this.vis;
    if (!vis) return '';
    const t = this.doc;
    let out = '';
    let from = 0;
    for (let k = 0; k < vis.length; k++) {
      const i = vis[k];
      if (!this.folded.has(i)) continue;
      out += t.slice(from, this.lineEnd(i));
      from = this.lineEnd(this.close[i]);
    }
    return (this.dtextCache = out + t.slice(from));
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
    return wy[k] + this.wrapper.rowAt(this.src, this.ls[ln], this.lineEnd(ln), off, this.wodd[k] === 1, wy[k + 1] - wy[k]);
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
    const t = this.src;
    return [a + wr.rowStart(t, a, b, sub, odd), sub + 1 < rows ? a + wr.rowStart(t, a, b, sub + 1, odd) : b];
  }

  /** Soft-wraps lines at the editor's width, or stops. */
  setWrap(on: boolean) {
    if (on === !!this.wrapper) return;
    const top = this.topLine();
    this.wrapper?.destroy();
    this.wrapper = on ? new Wrapper(this.body, LH) : null;
    // (rewrap copies the counts, and `wodd` is replaced on every call.)
    if (this.wrapper) this.wrapper.recycle = true;
    // A huge line's rows past an edit are estimated, then exact when idle: lay out again with them.
    if (this.wrapper)
      this.wrapper.onRows = () => {
        this.wrapDirty = true;
        this.layout();
        this.render(true);
      };
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
  /** The edit since the last rows() call, when model() knows it (null: compare the texts). */
  private wrapEdit: [number, number, number] | null = null;
  /** The text the wrapper last measured rows for (an edit hint is only valid against it). */
  private wrapText: Doc | null = null;

  /** The line range [la, end) of `ls` the last model() edit rewrote (lines after it only moved), or null. */
  private lineEdit: [number, number] | null = null;
  /**
   * Arrays for rewrap, two of each in turn (the wrapper keeps the last call's
   * lines): a document of a million lines would otherwise allocate megabytes
   * per key.
   */
  private bufs: Int32Array[] = [];
  private flip = 0;

  private buf(i: number, n: number) {
    const b = this.bufs[i];
    return b && b.length === n ? b : (this.bufs[i] = new Int32Array(n));
  }

  private rewrap() {
    const wr = this.wrapper as Wrapper;
    const space = this.sc.width - this.gutW - PAD_L - PAD_RW;
    const resized = wr.fit(space, this.cw);
    if (resized) this.el.style.setProperty('--tw', `${wr.width}px`);
    // Without the textarea (view mode) nothing has to line up with it: long lines can be summed.
    const moded = wr.setExact(!this.view && !this.surface);
    if (!resized && !moded && !this.wrapDirty && this.wy) return;
    this.wrapDirty = false;
    const n = this.rows;
    this.flip ^= 1;
    const A = this.buf(this.flip * 3, n);
    const B = this.buf(this.flip * 3 + 1, n);
    const ls = this.ls;
    if (!this.vis) {
      for (let k = 0; k + 1 < n; k++) {
        A[k] = ls[k];
        B[k] = ls[k + 1] - 1;
      }
      A[n - 1] = ls[n - 1];
      B[n - 1] = this.doc.length;
    } else {
      for (let k = 0; k < n; k++) {
        const ln = this.lineAt(k);
        A[k] = ls[ln];
        B[k] = this.lineEnd(ln);
      }
    }
    // An edit of lines [la, end) of an unfolded text: the wrapper needn't compare the others to find them.
    const edit = this.wrapEdit ?? undefined;
    const rows = wr.rows(this.src, A, B, edit, edit && !this.vis && this.lineEdit ? this.lineEdit : undefined);
    this.wrapEdit = null;
    this.lineEdit = null;
    this.wrapText = this.doc;
    const wy = this.buf(this.flip * 3 + 2, n + 1);
    wy[0] = 0;
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
    off = Math.max(0, Math.min(off, this.doc.length));
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
    if (!this.wy && this.maxStale) {
      this.maxCols = maxWidth(this.doc, this.ls);
      this.maxStale = false;
    }
    const bw = this.wy ? '' : `${Math.ceil(this.maxCols * this.cw) + PAD_L + PAD_R + this.extraW}px`;
    // (Only when it changes: any style write makes the next layout read lay the page out.)
    if (bw !== this.bodyW) this.body.style.width = this.bodyW = bw;
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
  private bodyW = '';

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
    const vh = this.sc.height;
    const vf = Math.max(0, Math.floor((st - PAD_T) / LH));
    const vl = Math.min(n, Math.ceil((st + vh - PAD_T) / LH));
    const wide = this.maxCols > LONG_LINE;
    const vcA = Math.max(0, Math.floor((this.el.scrollLeft - PAD_L) / this.cw));
    const vcB = vcA + Math.ceil(this.sc.width / this.cw);
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

    const html: string[] = [];
    // View mode and the big-document editor: where each row's text starts, for clicks (see offsetAt).
    const offs: number[] | null = this.view || this.surface ? [] : null;
    for (let k = first; k < last; k++) {
      const ln = this.lineAt(k);
      const a = this.ls[ln];
      const b = this.lineEnd(ln);
      const marks = this.marksFor(ln);
      const lm = this.lineMarks ? this.lineMarks[ln] : 0;
      const open = (o: number) => (offs?.push(o), `<div${lm ? ` class="${LINE_MARK[lm]}"` : ''}>`);
      const ph = this.folded.has(ln) ? this.foldPill(ln) : '';
      if (b - a > LONG_LINE && wide) {
        let sa = Math.min(b, a + colA);
        const sb = Math.min(b, a + colB);
        sa = this.stringStart(a, sa);
        const pad = (sa - a) * this.cw;
        const [t, o] = this.win(sa, sb + 1);
        html.push(`${open(sa)}<i class="ed-sp" style="width:${pad}px"></i>${this.jwt ? jwtLine(t, sa - o, sb - o, this.jwtAt(o)) : this.colors ? this.colors(t, sa - o, sb - o, o) : highlightLine(t, sa - o, sb - o, moved(marks, o), sb === b)}${sb === b ? ph : ''}</div>`);
      } else {
        const [t, o] = this.win(a, b + 1);
        html.push(`${open(a)}${this.jwt ? jwtLine(t, a - o, b - o, this.jwtAt(o)) : this.colors ? this.colors(t, a - o, b - o, o) : highlightLine(t, a - o, b - o, moved(marks, o))}${ph}</div>`);
      }
    }
    this.draw(html, this.gutterHtml(first, last), offs);
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
    this.cur.style.transform = this.curTf = `translateY(${this.curY + s}px)`;
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
    const vl = Math.min(total, Math.ceil((st + this.sc.height - PAD_T) / LH));
    if (!force && vf >= this.rFirst && vl <= this.rLast) return this.place(false);
    const overscan = this.surface ? 8 : OVERSCAN;
    const r0 = Math.max(0, vf - overscan);
    const r1 = Math.min(total, vl + overscan);
    this.rFirst = r0;
    this.rLast = r1;
    const doc = this.src;
    const html: string[] = [];
    const gut: string[] = [];
    const offs: number[] | null = this.view || this.surface ? [] : null;
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
        let sa = a + wr.rowStart(doc, a, b, s0, odd);
        // The rows on screen and the neighbours read around them, from one string at offset `o`.
        const ea = s1 < rows ? a + wr.rowStart(doc, a, b, s1, odd) : b;
        const [t, o] = this.win(Math.max(a, sa - 64), Math.min(b, ea + 64) + 1);
        const ms = moved(marks, o);
        let str = this.jwt || this.colors ? 0 : this.strs.at(doc, a, sa);
        for (let sub = s0; sub < s1; sub++) {
          const sb = sub + 1 < rows ? a + wr.rowStart(doc, a, b, sub + 1, odd) : b;
          const end = sb === b;
          // Other scripts: the row's neighbours as bidi context (see bidiContext).
          const se = odd && !end ? trimWs(t, sa - o, sb - o) + o : sb;
          let body = this.jwt ? jwtLine(t, sa - o, se - o, this.jwtAt(o)) : this.colors ? this.colors(t, sa - o, se - o, o) : highlightLine(t, sa - o, se - o, ms, end, str);
          if (odd) {
            // Where the browser keeps a word's letters joined across the break, so does the copy.
            const zl = wr.exact && wr.joinsAt(t, sa - o) ? '\u200d' : '';
            const zr = wr.exact && se === sb && !end && wr.joinsAt(t, sb - o) ? '\u200d' : '';
            // (Only right-to-left text orders by its neighbours: without any, the context changes nothing, and
            // laying it out costs as much again as the row.)
            const ctx = mayReorder(t, Math.max(a, sa - 64) - o, Math.min(b, sb + 64) - o);
            body = `${ctx ? bidiContext(t, Math.max(a, sa - 64) - o, sa - o) : ''}${zl}${body}${zr}${ctx ? bidiContext(t, sb - o, Math.min(b, sb + 64) - o) : ''}${escapeHtml(t.slice(se - o, sb - o))}`;
          }
          html.push(`<div class="ed-row${lm ? ' ' + LINE_MARK[lm] : ''}">${body}${end ? ph : ''}</div>`);
          offs?.push(sa);
          if (!this.jwt && !this.colors) str = stringState(t, sa - o, sb - o, str);
          sa = sb;
        }
      } else {
        if (top < 0) top = y;
        const [t, o] = this.win(a, b + 1);
        html.push(`<div${lm ? ` class="${LINE_MARK[lm]}"` : ''}>${this.jwt ? jwtLine(t, a - o, b - o, this.jwtAt(o)) : this.colors ? this.colors(t, a - o, b - o, o) : highlightLine(t, a - o, b - o, moved(marks, o))}${ph}</div>`);
        offs?.push(a);
      }
      // Gutter: the number on a line's first row, its bars on every row.
      const cls = this.gutClass(ln);
      const open = cls ? `<div class="${cls}">` : '<div>';
      const f = this.close[ln] >= 0 ? `<b class="ed-f${this.folded.has(ln) ? ' c' : ''}" data-f="${ln}"></b>` : '';
      for (let r = Math.max(r0, y); r < Math.min(r1, y + rows); r++) gut.push(r === y ? `${open}${ln + 1}${f}</div>` : `${open}</div>`);
    }
    this.draw(html, gut, offs);
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
    const d = this.doc;
    let a = this.ls[c];
    const e = this.lineEnd(c);
    while (a < e && (d.charCodeAt(a) === 32 || d.charCodeAt(a) === 9)) a++;
    const [t, o] = this.win(a, e + 1);
    const closer = highlightLine(t, a - o, e - o, null);
    return `<span class="ed-fold" data-f="${ln}"><span class="ed-ph${cls ? ' ' + cls : ''}">⋯ ${escapeHtml(rt.n(n, '{n} line', '{n} lines'))}</span>${closer}</span>`;
  }

  /** If `sa` falls inside a string, start the slice at the string's opening quote (bounded). */
  private stringStart(a: number, sa: number) {
    // A string open where the scan starts opened 4000 or more characters before `sa`: too far.
    const from = Math.max(a, sa - 3999);
    let s = from > a ? this.strs.at(this.src, a, from) : 0;
    let start = -1;
    const [t, o] = this.win(from, sa);
    for (let i = from - o; i < sa - o; i++) {
      const c = t.charCodeAt(i);
      if (s === 3) s = 1;
      else if (s === 1) {
        if (c === 92) s = 3;
        else if (c === 34) s = 0;
      } else if (c === 34) {
        s = 1;
        start = i + o;
      }
    }
    return s && start >= 0 ? start : sa;
  }

  /**
   * The text [a, b) to draw from, at the offset of its first character: the
   * document itself while it is one string, else a slice (a view of one
   * piece, or a copy where edits cut it).
   */
  private win(a: number, b: number): [string, number] {
    const flat = this.doc.flat;
    if (flat !== null) return [flat, 0];
    a = Math.max(0, a);
    return [this.doc.slice(a, b), a];
  }

  /** The JWT part offsets in a slice from `o`. */
  private jwtAt(o: number): readonly number[] {
    const j = this.jwt as readonly number[];
    return o ? j.map((x) => x - o) : j;
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

  private draw(rows: string[], gut: string[], offs: number[] | null) {
    patch(this.hl, this.rowsHtml, (this.rowsHtml = rows), offs);
    patch(this.gl, this.gutHtml, (this.gutHtml = gut), null);
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
    for (const d of this.diagList) {
      const p = Math.min(d.p, this.doc.length);
      const ln = this.lineOf(p);
      const end = this.tokenEnd(p, this.lineEnd(ln));
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

  /** Extent of the token starting at `p`, for squiggles (at most `lim`, the end of its line). */
  private tokenEnd(p: number, lim: number) {
    const t = this.doc;
    if (p >= t.length) return p;
    const c = t.charCodeAt(p);
    if (c === 34 || c === 39) {
      for (let i = p + 1; i < lim; i++) {
        const d = t.charCodeAt(i);
        if (d === 92) i++;
        else if (d === c) return i + 1;
      }
      return lim;
    }
    if (c === 47 || c === 35) return lim;
    let i = p;
    while (i < lim) {
      const d = t.charCodeAt(i);
      if ((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95 || d === 36 || d === 46 || d === 43 || d === 45 || d > 127) i++;
      else break;
    }
    return Math.min(lim, i > p ? i : p + 1);
  }

  /** Colours a JWT input by part (null: back to JSON highlighting). */
  setJwt(at: readonly number[] | null) {
    const cur = this.jwt;
    if (at === cur || (at && cur && at.every((v, i) => v === cur[i]))) return;
    this.jwt = at;
    this.renderSoon();
  }

  /** Colours the document with `colors` instead of as JSON (null: back to JSON). */
  setColors(colors: Colors | null) {
    if (colors === this.colors) return;
    this.colors = colors;
    this.renderSoon();
  }

  /** Read-only: the user can select and copy the document but not change it (setValue and init still do). */
  setReadOnly(on: boolean) {
    this.locked = on;
    this.ta.readOnly = on;
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

  private curTf = '';
  private curVis = '';

  private updateCaret() {
    const [s, e] = this.selection;
    const ln = this.lineOf(s);
    // Wrapped, the band marks the caret's row (a minified document is one line).
    this.curY = PAD_T + (this.wy ? this.vrowOf(s) : this.rowOf(ln)) * LH;
    // (Written only when they change: each style write costs the next layout read a style pass.)
    const tf = `translateY(${this.curY + this.sc.shift}px)`;
    const vis = this.lineOf(e) !== ln ? 'hidden' : '';
    if (tf !== this.curTf) this.cur.style.transform = this.curTf = tf;
    if (vis !== this.curVis) this.cur.style.visibility = this.curVis = vis;
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
    if (this.locked) {
      if (e.cancelable) e.preventDefault();
      return;
    }
    this.ev.flush?.(true);
    // (The quiet view's textarea is empty: nothing in it is the document. Keys wake it first, see onKey.)
    if (this.view) {
      if (e.cancelable) e.preventDefault();
      return;
    }
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
    if (this.view) {
      this.ta.value = '';
      return;
    }
    if (this.surface) return this.surface.input(e as InputEvent);
    const it = (e as InputEvent).inputType ?? '';
    const old = this.doc;
    this.typing = true;
    this.tabMovesFocus = false;
    if (it !== 'insertFromPaste') this.pasteFull = false;
    if (!this.sync()) return;
    // An IME composition is recorded once, when it ends.
    if (this.compOld === null) this.record(old, this.doc, it);
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
    let d = 0;
    for (let i = ins.indexOf('\n'); i !== -1; i = ins.indexOf('\n', i + 1)) d++;
    // (Lines [a, b) ends on, from the line starts: the text isn't searched.)
    d -= lineOfIn(this.ls, b) - lineOfIn(this.ls, a);
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
    this.compR = null;
    if (this.surface) { this.surface.compositionStart(); this.compOld = this.doc; this.compSel = this.selBefore = this.selection; return; }
    this.compOld = this.doc;
    this.selBefore = this.selection;
  };

  private onCompEnd = () => {
    const old = this.compOld;
    if (this.surface) {
      this.surface.compositionEnd();
      this.compOld = null;
      this.selBefore = this.compSel;
      if (old !== null) this.record(old, this.doc, 'insertText', this.compR ?? undefined);
      this.compR = null;
      // The composition shrank the document: now the native editor can take over.
      if (!this.wantsSurface(0.8)) this.model(this.doc, false);
      return;
    }
    this.compOld = null;
    this.sync();
    if (old !== null) this.record(old, this.doc, 'insertText');
  };

  private onPaste = (e: ClipboardEvent) => {
    if (this.locked) return void e.preventDefault();
    this.ev.flush?.(true);
    // (The quiet view: the paste goes in at its caret, in the editor.)
    if (this.view) return this.viewPaste(e);
    const ta = this.ta;
    if (this.surface) {
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        const [a, b] = this.selection;
        this.pasteFull = a === 0 && b === this.doc.length;
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
    if (this.locked && e.type === 'cut') return void e.preventDefault();
    this.ev.flush?.(e.type === 'cut');
    if (this.view) {
      if (e.type === 'cut') e.preventDefault();
      return;
    }
    if (this.surface && e.clipboardData) {
      e.preventDefault();
      const [a, b] = this.selection;
      e.clipboardData.setData('text/plain', this.doc.slice(a, b));
      if (e.type === 'cut') this.replace(a, b, '');
      return;
    }
    if (!e.clipboardData) return;
    const [a, b] = this.selection;
    // The textarea's own copy would do, unless the selection hides folded lines, or holds no-break
    // spaces (WebKit's copy turns them into spaces, changing a string's value).
    if ((!this.vis || b - a === this.ta.selectionEnd - this.ta.selectionStart) && this.doc.indexOf('\u00a0', a, b) < 0) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.doc.slice(a, b));
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
    // (A right click opens the context menu, which places the caret: see menuAt.)
    if (!this.view || e.button === 2) return;
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
    o = Math.min(o + off, this.doc.length);
    return (this.doc.charCodeAt(o) & 0xfc00) === 0xdc00 ? o - 1 : o;
  }

  /** View mode keys (the scroller has focus). */
  private onViewKey = (e: KeyboardEvent) => {
    const view = this.view;
    // (It arrives as it would have: the view's own keys wake the quiet view to edit.)
    this.ev.flush?.(false);
    // The document this key was for just arrived editable: the editor answers it.
    if (view && !this.view && e.target === this.el) return this.onKey(e);
    if (!this.view || e.target !== this.el) return;
    const mod = e.metaKey || e.ctrlKey;
    // In the quiet view, select all selects the document for editing (cut, paste and typing then act on all of it).
    if (this.lazy && mod && !e.altKey && e.code === 'KeyA') {
      e.preventDefault();
      this.wake(this.vcaret);
      this.select(0, this.doc.length, false);
      this.ev.caret();
      return;
    }
    // An editing key: the textarea takes focus now, so the key's input lands in it.
    if (this.lazy && !mod && !e.altKey && (e.key.length === 1 || e.isComposing || /^(Backspace|Delete|Enter|Process)$/.test(e.key))) {
      this.wake(this.vcaret);
      return;
    }
    // The start or the end of the document (⌘↑ ⌘↓ on macOS): the caret the editor goes on at.
    if ((mod && !e.altKey && (e.key === 'Home' || e.key === 'End')) || (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) {
      e.preventDefault();
      this.vcaret = e.key === 'Home' || e.key === 'ArrowUp' ? 0 : this.doc.length;
      this.reveal(this.vcaret);
      if (this.updateCaret()) this.render(true);
      this.ev.caret();
      this.ev.nav();
      return;
    }
    if (mod && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && !e.metaKey))) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && !e.altKey && e.code === 'KeyC' && !window.getSelection()?.toString()) {
      // (Nothing selected in the drawn rows: the document.)
      e.preventDefault();
      this.ev.copyAll();
    } else if (e.key === 'Escape') this.ev.escape();
  };

  /** The quiet view: a paste goes in at its caret, in the editor. */
  private onViewPaste = (e: ClipboardEvent) => {
    if (e.target === this.ta) return;
    this.ev.flush?.(false);
    if (this.view) this.viewPaste(e);
  };

  private viewPaste(e: ClipboardEvent) {
    if (this.locked) return void e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const at = this.vcaret;
    this.wake(at);
    this.replace(at, at, text.replace(/\r\n?/g, '\n'));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    // (A document still on its way arrives first: the key acts on what is shown.)
    this.ev.flush?.(true);
    const mod = e.metaKey || e.ctrlKey;
    // The quiet view shows while the textarea has focus (a document arrived meanwhile): the editor takes over, and
    // the key acts there.
    if (this.view && e.target === this.ta) this.wake(this.vcaret);
    if (this.surface?.key(e)) return;
    // Read-only: the keys below edit; Tab moves focus. Undo and redo stop here, or the browser's own would undo another box on the page.
    if (this.locked) {
      if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) e.preventDefault();
      return;
    }
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
        if (mod || e.altKey || this.tabMovesFocus || !this.doc.length) return;
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
  private record(old: Doc, now: Doc, kind: string, r?: [number, number, number]) {
    if (old === now) return;
    const sb = this.selBefore;
    if (!r && old.length === now.length && old.toString() === now.toString()) return;
    const [a, eo, en] = r ?? diffRange(old.toString(), now.toString(), Math.min(sb[0], this.selAfter[0]));
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
      this.grew(ch.ins.length);
    } else if (recent && ch.kind === 'del' && last.kind === 'del' && !ch.ins && !last.ins && ch.a + ch.del.length === last.a) {
      last.a = ch.a;
      last.del = ch.del + last.del;
      last.selA = ch.selA;
      last.t = ch.t;
      this.grew(ch.del.length);
    } else this.push(ch);
    this.redo_ = [];
  }

  private push(ch: Change) {
    this.undo_.push(ch);
    this.grew(ch.del.length + ch.ins.length);
  }

  /** The undo steps hold `n` more characters: the oldest go past 500 steps or 60M characters. */
  private grew(n: number) {
    this.histChars += n;
    while (this.undo_.length > 1 && (this.undo_.length > 500 || this.histChars > 60_000_000)) {
      const x = this.undo_.shift() as Change;
      this.histChars -= x.del.length + x.ins.length;
    }
  }

  undo() {
    if (this.locked) return;
    const ch = this.undo_.pop();
    if (!ch) return;
    this.histChars -= ch.del.length + ch.ins.length;
    this.redo_.push(ch);
    this.write(ch.a, ch.a + ch.ins.length, ch.del, ch.selB);
  }

  redo() {
    if (this.locked) return;
    const ch = this.redo_.pop();
    if (!ch) return;
    this.push(ch);
    this.write(ch.a, ch.a + ch.del.length, ch.ins, ch.selA);
  }

  /** Low-level replace without recording history. */
  private write(a: number, b: number, text: string, sel: [number, number]) {
    this.typing = true;
    this.shiftFolds(a, b, text, true);
    this.shiftDiags(a, b, text.length);
    this.model(this.edited(a, b, text), false, !!this.surface, { a, b, ins: text });
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
    const sb = this.selection;
    const del = this.doc.slice(a, b);
    const s1 = selA ?? a + text.length;
    const s2 = selB ?? s1;
    this.push({ a, del, ins: text, selB: sb, selA: [s1, s2], t: 0, kind: 'other' });
    this.redo_ = [];
    this.typing = true;
    this.shiftFolds(a, b, text, true);
    this.shiftDiags(a, b, text.length);
    this.model(this.edited(a, b, text), false, !!this.surface, { a, b, ins: text });
    this.select(s1, s2, false);
    this.ev.change(kind);
  }

  /**
   * The document with [a, b) replaced by `text`: a new version of it for the
   * big-document editor, else one string (the native textarea's).
   */
  private edited(a: number, b: number, text: string) {
    const d = this.doc;
    return this.surface ? d.edit(a, b, text) : Doc.of(d.slice(0, a) + text + d.slice(b));
  }

  /** Replaces the whole document as one undoable step. `load`: a new document (see LAZY_CHARS). */
  setValue(next: string, caret = 0, load = false) {
    next = lf(next);
    if (next.length !== this.doc.length || next !== this.text) {
      // (A new document may open in the quiet view: see LAZY_CHARS.)
      this.forceEdit = false;
      this.loading = load;
      try {
        this.apply(0, this.doc.length, next, caret, caret, 'set');
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
    const vh = this.sc.height;
    const y = PAD_T + this.vrowOf(off) * LH;
    const st = this.sc.top;
    if (y < st + LH || y + LH * 2 > st + vh) {
      this.sc.top = center ? y - vh / 2 + LH : y < st + LH ? y - LH : y - vh + LH * 3;
    }
    if (!this.wy) {
      const x = PAD_L + (off - this.ls[ln]) * this.cw;
      const vw = this.sc.width - this.gutW;
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
    if (y < st || y + LH > st + this.sc.height) return false;
    if (this.wy) return true;
    const x = PAD_L + (off - this.ls[this.lineOf(off)]) * this.cw;
    return x >= el.scrollLeft && x <= el.scrollLeft + this.sc.width - this.gutW - 24;
  }

  private indent(dir: 1 | -1) {
    const v = this.doc;
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
    const v = this.doc;
    const [s, e] = this.selection;
    // Line starts are known: no scanning back (a minified document is one long line).
    const lineStart = this.ls[this.lineOf(s)];
    let w = lineStart;
    while (w < s && (v.charCodeAt(w) === 32 || v.charCodeAt(w) === 9)) w++;
    const indent = v.slice(lineStart, w);
    let k = s - 1;
    while (k >= lineStart && (v.charCodeAt(k) === 32 || v.charCodeAt(k) === 9)) k--;
    const before = k >= 0 ? v.charCodeAt(k) : 0;
    if (before === 123 || before === 91) {
      const inner = indent + this.indentUnit;
      const after = v.charCodeAt(e);
      if ((before === 123 && after === 125) || (before === 91 && after === 93)) {
        this.replace(s, e, '\n' + inner + '\n' + indent, s + 1 + inner.length);
      } else this.replace(s, e, '\n' + inner);
    } else this.replace(s, e, '\n' + indent);
    // The big-document editor's edit already revealed the caret (select); reveal draws again.
    if (!this.surface) this.reveal(this.caret);
  }

  /** Typing a closer on a whitespace-only line removes one indent level first. */
  private dedentCloser(ch: string) {
    const [s, e] = this.selection;
    if (s !== e) return false;
    const v = this.doc;
    const lineStart = this.ls[this.lineOf(s)];
    // Only whitespace before the caret: check without copying a long line.
    for (let i = lineStart; i < s; i++) if (v.charCodeAt(i) !== 32 && v.charCodeAt(i) !== 9) return false;
    const lead = v.slice(lineStart, s);
    if (!lead) return false;
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
    const lines = Math.max(1, Math.floor(this.sc.height / LH) - 2);
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
