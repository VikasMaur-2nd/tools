/**
 * The editor for big documents (see Editor): the model is the document, only
 * the rows on screen are drawn, and the labelled textarea holds a passage of
 * about PASSAGE characters around the caret. Typing, IME composition, mobile
 * keyboards, autocorrect, the clipboard and Left/Right/Backspace/Delete stay
 * native inside the passage; its changes map back to model offsets. The caret
 * and the selection are drawn over the rows.
 */
export interface SurfaceHost {
  el: HTMLElement;
  ta: HTMLTextAreaElement;
  /** The document's length, text and characters (read where needed: it can be huge). */
  readonly length: number;
  slice(a: number, b: number): string;
  charCodeAt(i: number): number;
  /** Model start and end of the line holding `off`. */
  line(off: number): [number, number];
  edit(a: number, b: number, text: string, kind: string): void;
  /** The caret or selection moved (`nav`: by navigating); `reveal` false: leave the view where it is. */
  moved(nav: boolean, reveal?: boolean): void;
  /** Model offset at a point over the rows. */
  point(x: number, y: number): number;
  /** Visual row showing `off`, and its model start and end. */
  row(off: number): [number, number, number];
  /** Model start and end of visual row `row`. */
  span(row: number): [number, number];
  reveal(off: number): void;
  scroll(dy: number, dx: number): void;
  fold(line: number): void;
}

const PASSAGE = 2048;
/** The caret keeps at least this many characters of the passage on either side (else it moves). */
const EDGE = 128;
/** Text in a drawn row that isn't the row's own (bidi context, fold pills, line-end marks). */
const NOT_TEXT = '.ctx, .ed-fold, .meol';
let words: Intl.Segmenter;

export class Surface {
  anchor = 0;
  head = 0;
  /** The passage: its model offset, its text, and the textarea's text before the pending edit. */
  private start = 0;
  private value = '';
  private before = '';
  /** The textarea's selection when the pending edit began. */
  private selD: [number, number] | null = null;
  /** Model range of the text being composed (an IME session is on). */
  private comp: [number, number] | null = null;
  private x: number | null = null;
  private drag: { x: number; y: number; n: number; a: number; b: number } | null = null;
  private press = { t: 0, x: 0, y: 0, n: 0 };
  private touched = false;
  private frame = 0;
  private ink: HTMLElement;
  private hl: HTMLElement;
  private body: HTMLElement;

  constructor(private h: SurfaceHost) {
    this.hl = h.el.querySelector('.ed-hl')!;
    this.body = h.el.querySelector('.ed-body')!;
    this.ink = this.body.appendChild(document.createElement('div'));
    this.ink.className = 'ed-ink';
    h.el.classList.add('surface');
    h.ta.wrap = 'off';
    h.ta.setAttribute('role', 'textbox');
    h.ta.setAttribute('aria-multiline', 'true');
    this.listen(true);
  }

  private listen(on: boolean) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    this.h.el[f]('pointerdown', this.down as EventListener);
    this.h.el[f]('click', this.tap as EventListener);
    for (const [type, fn] of [['pointermove', this.move], ['pointerup', this.up], ['pointercancel', this.up]] as const) document[f](type, fn as EventListener);
  }

  destroy() {
    this.up();
    this.listen(false);
    const ta = this.h.ta;
    this.h.el.classList.remove('surface');
    ta.wrap = this.h.el.classList.contains('wrap') ? 'soft' : 'off';
    ta.style.left = ta.style.top = '';
    ta.removeAttribute('role');
    ta.removeAttribute('aria-multiline');
    this.ink.remove();
  }

  get selection(): [number, number] {
    return [Math.min(this.anchor, this.head), Math.max(this.anchor, this.head)];
  }

  select(a: number, b = a, backward = false) {
    const n = this.h.length;
    a = Math.max(0, Math.min(n, a));
    b = Math.max(0, Math.min(n, b));
    this.anchor = backward ? b : a;
    this.head = backward ? a : b;
    this.x = null;
    this.sync();
  }

  /** Is the model selection inside the passage (so the textarea's selection is all of it)? */
  private inside() {
    const [a, b] = this.selection;
    return a >= this.start && b <= this.start + this.value.length;
  }

  /**
   * Takes the textarea's selection if it moved (native Left/Right, assistive
   * technology) and the model's fits in the passage; selectionchange comes
   * later, so readers call this first. True if it moved.
   */
  adopt() {
    const ta = this.h.ta;
    // Only a selection the textarea made itself (ours is set in sync).
    const k = this.mark();
    if (k === this.native) return false;
    this.native = k;
    const a = this.start + ta.selectionStart;
    const b = this.start + ta.selectionEnd;
    const [s, e] = this.selection;
    if (this.selD || this.comp || !this.inside() || (a === s && b === e)) return false;
    const back = ta.selectionDirection === 'backward';
    this.anchor = back ? b : a;
    this.head = back ? a : b;
    this.x = null;
    return true;
  }

  /** Moves the passage to the caret when it nears an edge (or the text changed under it), and selects in it. */
  private sync() {
    if (this.comp) return;
    const ta = this.h.ta;
    const h = this.h;
    const end = this.start + this.value.length;
    if ((this.start && this.head < this.start + EDGE) || (end < h.length && this.head > end - EDGE) || this.value.length > 2 * PASSAGE || h.slice(this.start, end) !== this.value) {
      this.start = this.boundary(this.head - PASSAGE / 2, -1);
      this.value = this.before = h.slice(this.start, this.boundary(this.start + PASSAGE, 1));
      if (ta.value !== this.value) ta.value = this.value;
    }
    const at = (o: number) => Math.max(0, Math.min(this.value.length, o - this.start));
    const [a, b] = this.selection;
    const dir = this.head < this.anchor ? 'backward' : 'forward';
    if (ta.selectionStart !== at(a) || ta.selectionEnd !== at(b) || ta.selectionDirection !== dir) ta.setSelectionRange(at(a), at(b), dir);
    this.native = this.mark();
  }

  /** The textarea's selection, where the passage is. */
  private native = '';
  private mark() {
    const ta = this.h.ta;
    return `${this.start} ${ta.selectionStart} ${ta.selectionEnd} ${ta.selectionDirection}`;
  }

  beforeInput(e: InputEvent) {
    const ta = this.h.ta;
    this.adopt();
    this.before = ta.value;
    // Deleting a selection: the model's, which may be bigger than the passage.
    if (this.anchor !== this.head && !this.comp && e.cancelable && e.inputType.startsWith('delete')) {
      e.preventDefault();
      this.h.edit(...this.selection, '', e.inputType);
      return this.h.moved(false);
    }
    this.selD = [ta.selectionStart, ta.selectionEnd];
  }

  /** The textarea's text changed: the same change, in model offsets. */
  input(e: InputEvent) {
    const ta = this.h.ta;
    const old = this.before || this.value;
    const now = ta.value;
    // Anchored to the selection the edit replaced (an insert never slides past equal characters).
    const [ss, se] = this.selD ?? [old.length, 0];
    this.selD = null;
    if (old === now) return;
    let a = 0;
    let b = old.length;
    let c = now.length;
    while (a < ss && a < c && old.charCodeAt(a) === now.charCodeAt(a)) a++;
    while (b > a && b > se && c > a && old.charCodeAt(b - 1) === now.charCodeAt(c - 1)) {
      b--;
      c--;
    }
    const [s, e2] = this.selection;
    // A model selection bigger than the passage is what the edit replaced.
    const big = s < e2 && !this.inside();
    if (big) this.start = s - a;
    this.value = this.before = now;
    const sel = [this.start + ta.selectionStart, this.start + ta.selectionEnd];
    if (this.comp) this.comp = [this.comp[0], sel[1]];
    this.h.edit(big ? s : this.start + a, big ? e2 : this.start + b, now.slice(a, c), e.inputType || 'insertText');
    this.select(sel[0], sel[1], ta.selectionDirection === 'backward');
    this.h.moved(false);
  }

  compositionStart() {
    this.before = this.h.ta.value;
    this.comp = this.selection;
  }

  compositionEnd() {
    // Some browsers commit the final text before (or without) its input event.
    if (this.h.ta.value !== this.value) {
      this.before = this.value;
      this.input(new InputEvent('input', { inputType: 'insertCompositionText' }));
    }
    this.comp = this.selD = null;
    this.sync();
    this.paint();
  }

  /** The word boundary (Intl.Segmenter) or code point boundary at or before (dir < 0) / after `off`. */
  private boundary(off: number, dir: number, word = false) {
    const h = this.h;
    off = Math.max(0, Math.min(h.length, off));
    if (word) {
      const a = Math.max(0, off - 2048);
      const part = (words ??= new Intl.Segmenter(undefined, { granularity: 'word' })).segment(h.slice(a, off + 2048)).containing(off - a);
      return part ? a + part.index + (dir > 0 ? part.segment.length : 0) : off;
    }
    return (h.charCodeAt(off) & 0xfc00) === 0xdc00 ? off + dir : off;
  }

  /**
   * Keys the passage can't answer for the model: rows, pages, the document's
   * ends, select all, and moving a selection bigger than the passage.
   */
  key(e: KeyboardEvent): boolean {
    if (e.isComposing || this.comp) return false;
    this.adopt();
    const h = this.h;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const [a, b] = this.selection;
    const left = k === 'ArrowLeft';
    const side = left || k === 'ArrowRight';
    const vert = /^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(k);
    const home = k === 'Home' || k === 'End';
    let off = this.head;
    if (mod && !e.altKey && e.code === 'KeyA') {
      this.select(0, h.length);
      h.moved(true);
    } else if (e.metaKey && (k === 'Backspace' || k === 'Delete')) {
      // ⌘⌫ (macOS): to the row's start; ⌘⌦: to its end.
      const row = h.row(off);
      const to = a < b ? off : k === 'Delete' ? row[2] : row[1];
      h.edit(Math.min(a, to), Math.max(b, to), '', 'deleteSoftLine');
      h.moved(false);
    } else if ((side && (e.metaKey || !this.inside())) || vert || home) {
      if ((home && mod) || (e.metaKey && /^Arrow(Up|Down)$/.test(k))) {
        off = k === 'End' || k === 'ArrowDown' ? h.length : 0;
        this.x = null;
      } else if (home || e.metaKey) {
        // The row's start or end (⌘← and ⌘→ on macOS). A wrapped row ends before its next row's first character.
        const row = h.row(off);
        off = k === 'Home' || left ? row[1] : h.row(row[2])[0] > row[0] ? this.boundary(row[2] - 1, -1) : row[2];
        this.x = null;
      } else if (side) {
        const dir = left ? -1 : 1;
        off = !e.shiftKey && a < b ? (left ? a : b) : this.boundary(dir < 0 ? off - 1 : off + 1, dir, e.ctrlKey || e.altKey);
        this.x = null;
      } else {
        // Up and down keep the caret's x (by the drawn glyphs: any script, any width).
        const step = k[0] === 'P' ? Math.max(1, Math.floor(h.el.clientHeight / 20) - 2) : 1;
        const [row, start] = h.row(off);
        this.x ??= this.rect(off)?.left ?? this.body.getBoundingClientRect().left;
        const [s, end] = h.span(row + (k === 'ArrowUp' || k === 'PageUp' ? -step : step));
        off = Math.min(end, s + off - start);
        h.reveal(off);
        const r = this.rect(s);
        if (r) off = Math.max(s, Math.min(end, h.point(this.x, r.top + 10)));
      }
      if (!e.shiftKey) this.anchor = off;
      this.head = off;
      this.sync();
      h.moved(true);
    } else return false;
    e.preventDefault();
    return true;
  }

  /** The drawn rows (each knows its model start). */
  private rows() {
    return this.hl.querySelectorAll<HTMLElement>('[data-o]');
  }

  /** A drawn row's own text nodes. */
  private texts(row: HTMLElement) {
    const out: Text[] = [];
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement!.closest(NOT_TEXT)) out.push(n as Text);
    return out;
  }

  /** Where model offset `off` is drawn (the caret before that character), if it is. */
  private rect(off: number) {
    let row: HTMLElement | undefined;
    for (const r of this.rows()) {
      if (+r.dataset.o! > off) break;
      row = r;
    }
    if (!row) return null;
    let at = +row.dataset.o!;
    let hit: [Node, number] = [row, row.childNodes.length];
    for (const n of this.texts(row)) {
      if (off <= at + n.length) {
        hit = [n, off - at];
        break;
      }
      at += n.length;
    }
    if (hit[0] === row && off !== at) return null;
    const r = document.createRange();
    r.setStart(...hit);
    const rect = r.getClientRects()[0];
    return rect?.height ? rect : row.getBoundingClientRect();
  }

  /** Draws the selection, the composition's underline and the caret, and puts the textarea under the caret (IME windows open there). */
  paint() {
    // The textarea moved its selection (Shift+Arrow) and its selectionchange hasn't come yet: take it
    // rather than put the old one back, and tell the editor as that event would have.
    if (this.adopt()) queueMicrotask(() => this.h.moved(true));
    this.sync();
    const box = this.body.getBoundingClientRect();
    const [a, b] = this.selection;
    const h = this.h;
    let html = '';
    const draw = (r: DOMRect, cls: string, w = r.width) => {
      if (r.height) html += `<i class="${cls}" style="left:${r.left - box.left}px;top:${r.top - box.top}px;width:${w}px;height:${r.height}px"></i>`;
    };
    const spans: [number, number, string][] = [[a, b, 's']];
    if (this.comp) spans.push([...this.comp, 'u']);
    if (a < b || this.comp) for (const row of this.rows()) {
      let at = +row.dataset.o!;
      for (const n of this.texts(row)) {
        for (const [s, e, cls] of spans) {
          if (e > at && s < at + n.length) {
            const rg = document.createRange();
            rg.setStart(n, Math.max(0, s - at));
            rg.setEnd(n, Math.min(n.length, e - at));
            for (const r of rg.getClientRects()) draw(r, cls);
          }
        }
        at += n.length;
      }
      // A selected line break: up to the row's end.
      if (a <= at && b > at && h.charCodeAt(at) === 10) {
        const r = this.rect(at);
        const end = row.getBoundingClientRect().right;
        if (r) draw(r, 's', Math.max(8, end - r.left));
      }
    }
    const caret = this.rect(this.head);
    if (caret) {
      draw(caret, 'c', 1.5);
      this.h.ta.style.left = `${caret.left - box.left}px`;
      this.h.ta.style.top = `${caret.top - box.top}px`;
    }
    this.ink.innerHTML = html;
  }

  /** The selection unit around `off`: a character, a word (double click) or a line (triple). */
  private unit(off: number, n: number): [number, number] {
    if (n > 2) {
      // The line with its line break.
      const [a, e] = this.h.line(off);
      return [a, Math.min(this.h.length, e + 1)];
    }
    return n > 1 ? [this.boundary(off, -1, true), this.boundary(off, 1, true)] : [off, off];
  }

  private at(x: number, y: number) {
    return this.boundary(this.h.point(x, y), -1);
  }

  private down = (e: PointerEvent) => {
    const el = e.target as Element;
    if (e.button || !el.closest('.ed-body')) return;
    const pill = el.closest<HTMLElement>('[data-f]');
    if (pill) {
      e.preventDefault();
      return this.h.fold(Number(pill.dataset.f));
    }
    // A finger may be starting to scroll: its tap places the caret on click.
    this.touched = e.pointerType === 'touch';
    if (this.touched) return;
    e.preventDefault();
    // Pointer events carry no click count in every browser: count presses ourselves.
    const p = this.press;
    p.n = e.timeStamp - p.t < 500 && Math.abs(e.clientX - p.x) < 5 && Math.abs(e.clientY - p.y) < 5 ? Math.min(3, p.n + 1) : 1;
    Object.assign(p, { t: e.timeStamp, x: e.clientX, y: e.clientY });
    const [a, b] = this.unit(this.at(e.clientX, e.clientY), p.n);
    const from = e.shiftKey ? this.anchor : a;
    this.drag = { x: e.clientX, y: e.clientY, n: p.n, a: from, b: e.shiftKey ? from : b };
    this.anchor = from;
    this.head = b;
    this.h.ta.focus({ preventScroll: true });
    // (Not scrolled to: it is on screen, and text moved under the held button would join the selection.)
    this.h.moved(true, false);
  };

  private tap = (e: MouseEvent) => {
    if (!this.touched || (e.target as Element).closest('[data-f]')) return;
    this.touched = false;
    this.select(this.at(e.clientX, e.clientY));
    this.h.ta.focus({ preventScroll: true });
    this.h.moved(true);
  };

  private move = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    // Only a drag scrolls at the edges, not a press on the first or last row (or its jitter).
    const p = this.press;
    if (!this.frame && Math.abs(d.x - p.x) + Math.abs(d.y - p.y) > 4) this.frame = requestAnimationFrame(this.scrollOut);
    this.extend();
  };

  /** The drag's selection: from where it began, in its units, to the pointer. */
  private extend() {
    const d = this.drag!;
    const [a, b] = this.unit(this.at(d.x, d.y), d.n);
    this.anchor = a < d.a ? d.b : d.a;
    this.head = a < d.a ? a : b;
    // (Nor is the head: it is under the pointer, or past an edge, where scrollOut scrolls.)
    this.h.moved(false, false);
  }

  /** Dragging past an edge scrolls, faster the farther out. */
  private scrollOut = () => {
    const d = this.drag;
    if (!d) return;
    const r = this.h.el.getBoundingClientRect();
    const out = (v: number, lo: number, hi: number) => Math.max(-80, Math.min(80, (v < lo ? v - lo : v > hi ? v - hi : 0) / 3));
    const dy = out(d.y, r.top + 20, r.bottom - 20);
    const dx = this.h.el.classList.contains('wrap') ? 0 : out(d.x, r.left + 80, r.right - 20);
    if (dy || dx) {
      this.h.scroll(dy, dx);
      this.extend();
    }
    this.frame = requestAnimationFrame(this.scrollOut);
  };

  private up = () => {
    this.drag = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };
}
