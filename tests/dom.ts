/**
 * Just enough of a DOM to run the editor and the virtual views in Node: elements keep their
 * attributes, classes, styles, listeners and the HTML last set on them (no parsing), a textarea
 * keeps its value and selection, and frames run when a test calls `frames()`. Text is 7.8 px a
 * character. Install it before constructing a view; nothing here lays anything out.
 */

type Listener = (e: Event) => void;

class FakeEvents {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, f: Listener) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(f);
  }
  removeEventListener(type: string, f: Listener) {
    this.listeners.get(type)?.delete(f);
  }
  dispatchEvent(e: Event) {
    for (const f of [...(this.listeners.get(e.type) ?? [])]) f.call(this, e);
    return true;
  }
  /** Listeners added and not removed, of every type. */
  get listening() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

export const CW = 7.8;

export class FakeElement extends FakeEvents {
  tagName: string;
  className = '';
  id = '';
  hidden = false;
  tabIndex = -1;
  textContent = '';
  isConnected = true;
  parentElement: FakeElement | null = null;
  kids: FakeElement[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void } = Object.assign(Object.create(null), {
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
    removeProperty(this: Record<string, string>, k: string) {
      delete this[k];
    },
  });
  private html = '';
  clientHeight = 600;
  clientWidth = 800;
  scrollHeight = 0;
  scrollWidth = 0;
  private top_ = 0;
  scrollLeft = 0;

  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
  }

  get scrollTop() {
    return this.top_;
  }
  set scrollTop(v: number) {
    const max = Math.max(0, parseFloat(this.kids.find((k) => k.style.height)?.style.height ?? '0') - this.clientHeight);
    const was = this.top_;
    this.top_ = Math.round(Math.max(0, Math.min(max || v, v)));
    if (this.top_ !== was) this.dispatchEvent(new Event('scroll'));
  }

  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    const set = (xs: string[]) => (this.className = xs.join(' '));
    return {
      add: (...cs: string[]) => set([...new Set([...list(), ...cs])]),
      remove: (...cs: string[]) => set(list().filter((c) => !cs.includes(c))),
      contains: (c: string) => list().includes(c),
      toggle: (c: string, on?: boolean) => {
        const has = list().includes(c);
        const want = on ?? !has;
        if (want !== has) set(want ? [...list(), c] : list().filter((x) => x !== c));
        return want;
      },
    };
  }

  /** The HTML last set (innerHTML) with what was inserted since. */
  get innerHTML() {
    return this.html;
  }
  set innerHTML(v: string) {
    this.html = v;
  }
  insertAdjacentHTML(_where: string, v: string) {
    this.html += v;
  }
  /** Children made with appendChild (HTML set as text makes none: see `children`). */
  get children(): FakeElement[] {
    return [];
  }
  get firstElementChild() {
    return this.kids[0] ?? null;
  }

  appendChild<T extends FakeElement>(c: T): T {
    c.remove();
    c.parentElement = this;
    this.kids.push(c);
    return c;
  }
  remove() {
    const p = this.parentElement;
    if (p) p.kids.splice(p.kids.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(x: unknown) {
    for (let n = x as FakeElement | null; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  closest(sel: string): FakeElement | null {
    return this.matches(sel) ? this : (this.parentElement?.closest(sel) ?? null);
  }
  matches(sel: string) {
    return sel.split(',').some((s) => {
      s = s.trim();
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('#')) return this.id === s.slice(1);
      return this.tagName === s.toUpperCase();
    });
  }
  querySelector(sel: string): FakeElement | null {
    for (const k of this.kids) {
      if (k.matches(sel)) return k;
      const d = k.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const k of this.kids) {
      if (k.matches(sel)) out.push(k);
      out.push(...k.querySelectorAll(sel));
    }
    return out;
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  focus() {
    fakeDocument.activeElement = this;
  }
  blur() {
    if (fakeDocument.activeElement === this) fakeDocument.activeElement = fakeDocument.body;
  }
  getBoundingClientRect() {
    const w = this.textContent.length * CW;
    return { left: 0, top: 0, right: w, bottom: 20, width: w, height: 20, x: 0, y: 0 } as DOMRect;
  }
  getClientRects() {
    return [] as unknown as DOMRectList;
  }
  get offsetHeight() {
    return 20;
  }
}

export class FakeTextArea extends FakeElement {
  private v = '';
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection: 'forward' | 'backward' | 'none' = 'none';
  wrap = 'off';
  readOnly = false;

  constructor() {
    super('textarea');
  }
  get value() {
    return this.v;
  }
  set value(s: string) {
    this.v = s;
    this.selectionStart = this.selectionEnd = s.length;
  }
  setSelectionRange(a: number, b: number, dir: 'forward' | 'backward' | 'none' = 'none') {
    const n = this.v.length;
    this.selectionStart = Math.min(Math.max(0, a), n);
    this.selectionEnd = Math.min(Math.max(this.selectionStart, b), n);
    this.selectionDirection = dir;
  }
  select() {
    this.setSelectionRange(0, this.v.length);
  }
  setRangeText(s: string, a: number, b: number) {
    this.v = this.v.slice(0, a) + s + this.v.slice(b);
  }
  /** What a user's typing does: the browser edits the value, then tells the editor. */
  type(s: string) {
    const a = this.selectionStart;
    this.dispatchEvent(Object.assign(new Event('beforeinput'), { inputType: 'insertText', data: s }));
    this.v = this.v.slice(0, a) + s + this.v.slice(this.selectionEnd);
    this.selectionStart = this.selectionEnd = a + s.length;
    this.dispatchEvent(Object.assign(new Event('input'), { inputType: 'insertText', data: s }));
  }
  /** Backspace, as the browser does it. */
  backspace() {
    const a = this.selectionStart === this.selectionEnd ? Math.max(0, this.selectionStart - 1) : this.selectionStart;
    this.dispatchEvent(Object.assign(new Event('beforeinput'), { inputType: 'deleteContentBackward' }));
    this.v = this.v.slice(0, a) + this.v.slice(this.selectionEnd);
    this.selectionStart = this.selectionEnd = a;
    this.dispatchEvent(Object.assign(new Event('input'), { inputType: 'deleteContentBackward' }));
  }
}

class FakeDocument extends FakeEvents {
  body = new FakeElement('body');
  activeElement: FakeElement = this.body;
  createElement(tag: string) {
    return tag === 'textarea' ? new FakeTextArea() : new FakeElement(tag);
  }
  createDocumentFragment() {
    return new FakeElement('fragment');
  }
  createTextNode(s: string) {
    const t = new FakeElement('#text');
    t.textContent = s;
    return t;
  }
  execCommand() {
    return false;
  }
}

export const fakeDocument = new FakeDocument();

let queue: FrameRequestCallback[] = [];
let ids = 0;

/** Runs the frames requested so far (and those they request, up to `max` rounds). */
export function frames(max = 10) {
  for (let k = 0; k < max && queue.length; k++) {
    const q = queue;
    queue = [];
    for (const f of q) f(performance.now());
  }
}

/** Puts the fake DOM in the global scope (once). */
export function installDom() {
  const g = globalThis as Record<string, unknown>;
  if (g.__fakeDom) return;
  g.__fakeDom = true;
  g.document = fakeDocument;
  g.window = globalThis;
  g.getSelection = () => null;
  g.Node = { TEXT_NODE: 3 };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.requestAnimationFrame = (f: FrameRequestCallback) => {
    queue.push(f);
    return ++ids;
  };
  g.cancelAnimationFrame = () => {};
  g.getComputedStyle = () => ({ fontStyle: 'normal', fontWeight: '400', fontSize: '13px', fontFamily: 'monospace' });
}

/** The markup the engine gives an editor (components/JsonTool.tsx). */
export function editorElement() {
  const el = new FakeElement();
  el.className = 'ed';
  const gut = el.appendChild(new FakeElement());
  gut.className = 'ed-gut';
  gut.appendChild(new FakeElement()).className = 'ed-gl';
  const body = el.appendChild(new FakeElement());
  body.className = 'ed-body';
  for (const c of ['ed-hl', 'ed-cur', 'ed-scope']) body.appendChild(new FakeElement()).className = c;
  const ta = body.appendChild(new FakeTextArea());
  return { el, ta };
}
