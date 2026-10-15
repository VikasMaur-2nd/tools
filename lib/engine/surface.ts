/** Virtual editor input. The textarea holds a bounded passage, never the document. */
export interface SurfaceHost {
  el: HTMLElement;
  ta: HTMLTextAreaElement;
  text: string;
  edit(a: number, b: number, text: string, kind: string): void;
  moved(nav: boolean): void;
  point(x: number, y: number): number;
  row(off: number): [number, number, number];
  span(row: number): [number, number];
  reveal(off: number): void;
  scroll(dy: number, dx: number): void;
  fold(line: number): void;
}

const PASSAGE = 2048;
const ignored = '.ctx, .ed-fold, .meol';
let graphemes: Intl.Segmenter;
let words: Intl.Segmenter;

export class Surface {
  anchor = 0;
  head = 0;
  private start = 0;
  private value = '';
  private before = '';
  private composing = false;
  private composition: [number, number] | null = null;
  private preferredX: number | null = null;
  private drag: { x: number; y: number; unit: number; a: number; b: number } | null = null;
  private dragFrame = 0;
  private ink: HTMLElement;
  private hl: HTMLElement;
  private body: HTMLElement;

  constructor(private h: SurfaceHost) {
    this.hl = h.el.querySelector('.ed-hl')!;
    this.body = h.el.querySelector('.ed-body')!;
    this.ink = document.createElement('div');
    this.ink.className = 'ed-ink';
    this.ink.setAttribute('aria-hidden', 'true');
    this.body.appendChild(this.ink);
    h.el.classList.add('surface');
    h.ta.wrap = 'off';
    h.ta.setAttribute('role', 'textbox');
    h.ta.setAttribute('aria-multiline', 'true');
    h.el.addEventListener('pointerdown', this.down);
    document.addEventListener('pointermove', this.move);
    document.addEventListener('pointerup', this.up);
    document.addEventListener('pointercancel', this.up);
  }

  destroy() {
    this.up();
    this.h.el.classList.remove('surface');
    this.h.ta.wrap = this.h.el.classList.contains('wrap') ? 'soft' : 'off';
    this.h.el.removeEventListener('pointerdown', this.down);
    document.removeEventListener('pointermove', this.move);
    document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.up);
    this.h.ta.style.removeProperty('left');
    this.h.ta.style.removeProperty('top');
    this.h.ta.removeAttribute('role');
    this.h.ta.removeAttribute('aria-multiline');
    this.ink.remove();
  }

  get selection(): [number, number] {
    return [Math.min(this.anchor, this.head), Math.max(this.anchor, this.head)];
  }

  select(a: number, b = a, backward = false) {
    const end = this.h.text.length;
    a = Math.max(0, Math.min(end, a));
    b = Math.max(0, Math.min(end, b));
    this.anchor = backward ? b : a;
    this.head = backward ? a : b;
    this.preferredX = null;
    this.sync();
  }

  /** Native accessibility selection and autocorrection refer to this passage. */
  nativeSelection() {
    if (this.composing) return;
    const ta = this.h.ta;
    const a = this.start + ta.selectionStart;
    const b = this.start + ta.selectionEnd;
    const [s, e] = this.selection;
    // A selection bigger than the passage belongs to the model, not this clipped proxy.
    if (s < this.start || e > this.start + this.value.length || (a === s && b === e)) return;
    this.anchor = ta.selectionDirection === 'backward' ? b : a;
    this.head = ta.selectionDirection === 'backward' ? a : b;
    this.h.moved(true);
  }

  private sync() {
    if (this.composing) return;
    const h = this.h;
    const t = h.text;
    const [a, b] = this.selection;
    // Keep the existing passage during ordinary typing. Recenter near its edges.
    if (this.value.length > PASSAGE * 2 || this.head < this.start + 128 || this.head > this.start + this.value.length - 128 || t.slice(this.start, this.start + this.value.length) !== this.value) {
      this.start = this.boundary(Math.max(0, this.head - PASSAGE / 2), -1);
      const end = this.boundary(Math.min(t.length, this.start + PASSAGE), 1);
      this.value = t.slice(this.start, end);
      this.before = this.value;
      if (h.ta.value !== this.value) h.ta.value = this.value;
    }
    const s = Math.max(0, Math.min(this.value.length, a - this.start));
    const e = Math.max(0, Math.min(this.value.length, b - this.start));
    const dir = this.head < this.anchor ? 'backward' : 'forward';
    if (h.ta.selectionStart !== s || h.ta.selectionEnd !== e || h.ta.selectionDirection !== dir) h.ta.setSelectionRange(s, e, dir);
  }

  beforeInput(e: InputEvent) {
    this.before = this.h.ta.value;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') return;
    if (this.anchor !== this.head && !this.composing && e.cancelable && e.inputType.startsWith('delete')) {
      e.preventDefault();
      const [a, b] = this.selection;
      this.h.edit(a, b, '', e.inputType);
      this.h.moved(false);
    }
  }

  input(e: InputEvent) {
    const ta = this.h.ta;
    const old = this.before || this.value;
    const now = ta.value;
    if (old === now) return;
    let a = 0, b = old.length, c = now.length;
    while (a < b && a < c && old.charCodeAt(a) === now.charCodeAt(a)) a++;
    while (b > a && c > a && old.charCodeAt(b - 1) === now.charCodeAt(c - 1)) { b--; c--; }
    let start = this.start;
    let sel: [number, number] = [start + ta.selectionStart, start + ta.selectionEnd];
    const range = this.selection;
    this.value = now;
    this.before = now;
    // A proxy cannot contain a large model selection. Replace the actual selection.
    const clipped = range[0] !== range[1] && (range[0] < start || range[1] > start + old.length);
    if (clipped) {
      this.start = start = range[0] - a;
      sel = [start + ta.selectionStart, start + ta.selectionEnd];
    }
    if (this.composing) this.composition = [this.composition?.[0] ?? start + a, sel[1]];
    this.h.edit(clipped ? range[0] : start + a, clipped ? range[1] : start + b, now.slice(a, c), e.inputType || 'insertText');
    this.select(sel[0], sel[1], ta.selectionDirection === 'backward');
    this.h.moved(false);
  }

  compositionStart() {
    this.before = this.h.ta.value;
    this.composing = true;
    this.composition = this.selection;
  }

  compositionEnd() {
    // Some browsers commit the native value before their final input event.
    if (this.h.ta.value !== this.value) {
      this.before = this.value;
      this.input(new InputEvent('input', { inputType: 'insertCompositionText' }));
    }
    this.composing = false;
    this.composition = null;
    this.sync();
    this.paint();
  }

  private boundary(off: number, dir: number, word = false) {
    const t = this.h.text;
    if (off < 0 || (off === 0 && dir < 0)) return 0;
    if (off >= t.length) return t.length;
    const a = Math.max(0, off - (word ? 2048 : 128));
    const b = Math.min(t.length, off + (word ? 2048 : 128));
    const segmenter = word ? words ??= new Intl.Segmenter(undefined, { granularity: 'word' }) : graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = segmenter.segment(t.slice(a, b));
    const part = segments.containing(off - a);
    if (!part) return off;
    if (dir < 0) return a + part.index;
    return a + part.index + part.segment.length;
  }

  private adjacent(off: number, dir: number, word = false) {
    return dir < 0 ? this.boundary(off - 1, -1, word) : this.boundary(off, 1, word);
  }

  key(e: KeyboardEvent): boolean {
    if (e.isComposing || this.composing) return false;
    const mod = e.ctrlKey || e.metaKey;
    const word = e.altKey || e.ctrlKey;
    const h = this.h;
    const [a, b] = this.selection;
    let off = this.head;
    if (mod && !e.altKey && e.code === 'KeyA') {
      this.select(0, h.text.length);
      h.moved(true);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      const dir = e.key === 'Backspace' ? -1 : 1;
      const next = a === b ? this.adjacent(off, dir, word) : dir < 0 ? a : b;
      h.edit(Math.min(a, next), Math.max(b, next), '', dir < 0 ? 'deleteContentBackward' : 'deleteContentForward');
      h.moved(false);
    } else if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) {
      const left = e.key === 'ArrowLeft';
      const right = e.key === 'ArrowRight';
      if (left || right) {
        const dir = left ? -1 : 1;
        off = !e.shiftKey && a !== b && !word ? dir < 0 ? a : b : this.visualMove(off, left ? 'left' : 'right', word) ?? this.adjacent(off, dir, word);
        if (e.metaKey) { const row = h.row(off); off = left ? row[1] : row[2]; }
        this.preferredX = null;
      } else if (e.key === 'Home' || e.key === 'End') {
        const end = e.key === 'End';
        const row = h.row(off);
        off = mod ? end ? h.text.length : 0 : end ? h.row(row[2])[0] > row[0] ? this.adjacent(row[2], -1) : row[2] : row[1];
        this.preferredX = null;
      } else {
        const page = e.key.startsWith('Page');
        const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1;
        const step = page ? Math.max(1, Math.floor(h.el.clientHeight / 20) - 2) : 1;
        const [row, start] = h.row(off);
        const rect = this.rectAt(off);
        this.preferredX ??= rect?.left ?? this.body.getBoundingClientRect().left + 16;
        const [s, end] = h.span(row + dir * step);
        off = Math.min(end, s + off - start);
        h.reveal(off);
        const target = this.rectAt(s);
        if (target) off = Math.max(s, Math.min(end, h.point(this.preferredX, target.top + 10)));
      }
      if (!e.shiftKey) this.anchor = off;
      this.head = off;
      this.sync();
      h.moved(true);
    } else return false;
    e.preventDefault();
    return true;
  }

  private nodes(row: HTMLElement) {
    const out: Text[] = [];
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest(ignored)) out.push(n as Text);
    return out;
  }

  private domAt(off: number): [Node, number] | null {
    for (const row of Array.from(this.hl.querySelectorAll<HTMLElement>('[data-o]')).reverse()) {
      const start = Number(row.dataset.o);
      if (start > off) continue;
      const nodes = this.nodes(row);
      let at = start;
      for (const n of nodes) {
        if (off <= at + n.length) return [n, off - at];
        at += n.length;
      }
      if (off === at) return [row, row.childNodes.length];
    }
    return null;
  }

  private modelAt(node: Node, off: number) {
    const row = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>('[data-o]');
    if (!row || row.parentElement !== this.hl) return null;
    let at = Number(row.dataset.o);
    if (node === row) {
      const range = document.createRange();
      range.setStart(row, 0); range.setEnd(node, off);
      return at + range.toString().length;
    }
    for (const n of this.nodes(row)) { if (n === node) return at + off; at += n.length; }
    return null;
  }

  /** The browser orders bidi runs and grapheme clusters in the drawn row. */
  private visualMove(off: number, dir: 'left' | 'right', word: boolean) {
    const point = this.domAt(off);
    const sel = window.getSelection();
    if (!point || !sel?.modify) return null;
    sel.collapse(...point);
    sel.modify('move', dir, word ? 'word' : 'character');
    const next = sel.focusNode ? this.modelAt(sel.focusNode, sel.focusOffset) : null;
    sel.removeAllRanges();
    this.h.ta.focus({ preventScroll: true });
    return next === off ? null : next;
  }

  private rectAt(off: number) {
    const p = this.domAt(off);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(...p); r.collapse(true);
    const rect = r.getClientRects()[0];
    if (rect?.height) return rect;
    const row = (p[0].nodeType === 1 ? p[0] as Element : p[0].parentElement)?.closest('[data-o]');
    return row?.getBoundingClientRect() ?? null;
  }

  paint() {
    this.sync();
    const box = this.body.getBoundingClientRect();
    const [a, b] = this.selection;
    let html = '';
    const draw = (r: DOMRect, cls: string) => {
      if (r.height && (r.width || cls === 'ed-caret')) html += `<i class="${cls}" style="left:${r.left - box.left}px;top:${r.top - box.top}px;width:${cls === 'ed-caret' ? 1.5 : r.width}px;height:${r.height}px"></i>`;
    };
    if (a !== b || this.composition) for (const row of this.hl.querySelectorAll<HTMLElement>('[data-o]')) {
      const start = Number(row.dataset.o);
      let at = start;
      for (const n of this.nodes(row)) {
        const end = at + n.length;
        for (const [s, e, cls] of [[a, b, 'ed-selection'], ...(this.composition ? [[...this.composition, 'ed-composition']] : [])] as [number, number, string][]) {
          if (e > at && s < end) {
            const rg = document.createRange();
            rg.setStart(n, Math.max(0, s - at)); rg.setEnd(n, Math.min(n.length, e - at));
            for (const r of rg.getClientRects()) draw(r, cls);
          }
        }
        at = end;
      }
      if (a <= at && b > at && this.h.text.charCodeAt(at) === 10) {
        const end = this.rectAt(at) ?? row.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        draw(new DOMRect(end.left, end.top, Math.max(8, box.right - end.left), 20), 'ed-selection');
      }
    }
    const caret = this.rectAt(this.head);
    if (caret) {
      draw(caret, 'ed-caret');
      this.h.ta.style.left = `${caret.left - box.left}px`;
      this.h.ta.style.top = `${caret.top - box.top}px`;
    }
    this.ink.innerHTML = html;
  }

  private extent(off: number, unit: number): [number, number] {
    if (unit >= 3) {
      const t = this.h.text;
      const a = t.lastIndexOf('\n', off - 1) + 1;
      const b = t.indexOf('\n', off);
      return [a, b < 0 ? t.length : b + 1];
    }
    if (unit === 2) return [this.boundary(off, -1, true), this.boundary(off, 1, true)];
    return [off, off];
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target as Element).closest('.ed-body')) return;
    const pill = (e.target as Element).closest<HTMLElement>('[data-f]');
    if (pill) { e.preventDefault(); this.h.fold(Number(pill.dataset.f)); return; }
    e.preventDefault();
    const at = this.boundary(this.h.point(e.clientX, e.clientY), -1);
    const [a, b] = this.extent(at, e.detail);
    if (!e.shiftKey) this.anchor = a;
    this.head = b;
    this.drag = { x: e.clientX, y: e.clientY, unit: e.detail, a: e.shiftKey ? this.anchor : a, b: e.shiftKey ? this.anchor : b };
    this.h.ta.focus({ preventScroll: true });
    this.h.moved(true);
    this.dragFrame = requestAnimationFrame(this.autoscroll);
  };

  private move = (e: PointerEvent) => {
    if (!this.drag) return;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    this.dragTo();
  };

  private dragTo() {
    const d = this.drag;
    if (!d) return;
    const [a, b] = this.extent(this.boundary(this.h.point(d.x, d.y), -1), d.unit);
    if (a < d.a) { this.anchor = d.b; this.head = a; }
    else { this.anchor = d.a; this.head = b; }
    this.h.moved(false);
  }

  private autoscroll = () => {
    if (!this.drag) return;
    const r = this.h.el.getBoundingClientRect();
    const y = this.drag.y;
    const dy = y < r.top + 20 ? y - r.top - 20 : y > r.bottom - 20 ? y - r.bottom + 20 : 0;
    const x = this.drag.x;
    const dx = this.h.el.classList.contains('wrap') ? 0 : x < r.left + 80 ? x - r.left - 80 : x > r.right - 20 ? x - r.right + 20 : 0;
    if (dy || dx) { this.h.scroll(Math.max(-80, Math.min(80, dy / 3)), Math.max(-80, Math.min(80, dx / 3))); this.dragTo(); }
    this.dragFrame = requestAnimationFrame(this.autoscroll);
  };

  private up = () => { this.drag = null; cancelAnimationFrame(this.dragFrame); };
}
