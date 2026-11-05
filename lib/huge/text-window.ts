/*
 * The Format view's free-text editing (As written): a window of the document's lines in the normal editor (its
 * keys, selection, clipboard, screen reader), its changes sent to the core as byte replaces with typing joined into
 * one undo step per pause, the window moved as the view nears its edge (components/huge/HugeFormatEdit.tsx).
 *
 * The editor's text is what the user sees; `sent` is the window as the document has it. A change is found by
 * comparing the two (their common start and end) once the frame is painted, and sent as one replace. While the
 * document is read again after a change it couldn't take in at once (a string or bracket opened: 'Not ready'),
 * what's typed waits, and goes as one replace when it's ready: the editor never waits for the core.
 */
import { utf16Of, utf8Bytes } from './utf8';
import type { HugeSource, IndexState } from './source';

/**
 * Lines and bytes a window holds at most: small enough for the editor's native editing (under its 100,000
 * characters, editor.ts LAZY_CHARS), where a key costs least; a window moves often, and moving is cheap.
 */
export const WINDOW_LINES = 1000;
export const WINDOW_BYTES = 96_000;
/** A line longer than a window gets one of its own, up to this. */
export const LINE_MAX = 1 << 20;
/** Lines kept above the line a window is read for. */
export const WINDOW_ABOVE = 300;
/** Characters a paste may have. */
export const PASTE_MAX = 8 << 20;

/** What changed from `a` to `b`: [p, p + del) of `a` became `ins` (null: nothing did). Never between a pair's halves. */
export function diffText(a: string, b: string): { p: number; del: number; ins: string } | null {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && (a.charCodeAt(p - 1) & 0xfc00) === 0xd800) p--;
  let s = 0;
  const most = n - p;
  while (s < most && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && (a.charCodeAt(a.length - s) & 0xfc00) === 0xdc00) s--;
  return { p, del: a.length - p - s, ins: b.slice(p, b.length - s) };
}

export interface WindowEvents {
  /** A change was sent (taken in by the document). */
  sent(): void;
  /** Sending failed (not a wait: the window is then read again). */
  failed(e: unknown): void;
}

/** Why a window can't be read: no lines, its first line is longer than a window, or it has a lone CR. */
export type WindowRefusal = 'none' | 'long' | 'cr';

export class TextWindow {
  /** The window's first line (0-based, as written), its first byte, and how many lines it holds. */
  line = 0;
  start = 0;
  lines = 0;
  /** Its text as the document has it. */
  sent = '';
  /**
   * The same as the editor shows it: line ends as \n (the editor keeps no \r), with where a \r\n became \n
   * (`crs`: offsets of those \n in `view`), so offsets map both ways; a new line typed is written as \r\n there.
   */
  view = '';
  private crs: number[] = [];
  private crlf = false;
  /** As the editor has it (sent once the document takes edits). */
  private now = '';
  private busy = false;
  private waiting: (() => void) | null = null;
  private flushed: (() => void)[] = [];
  private dead = false;

  constructor(
    private readonly src: HugeSource,
    private readonly ev: WindowEvents,
  ) {}

  destroy() {
    this.dead = true;
    this.waiting?.();
    for (const f of this.flushed.splice(0)) f();
  }

  /**
   * Reads the window for line `at` (from `above` lines before it): whole lines, at most WINDOW_LINES and
   * WINDOW_BYTES. False: there are no lines, or the first one alone is longer than a window (a minified file).
   */
  async load(at: number, above = WINDOW_ABOVE): Promise<true | WindowRefusal> {
    const count = this.src.lineCount('raw');
    if (count < 1) return 'none';
    const from = Math.max(0, Math.min(at - above, count - 1));
    const n = Math.min(WINDOW_LINES, count - from);
    // (Where each line starts: one column of each is enough. One line more: where the last one ends.)
    const ls = await this.src.lines('raw', from, n + 1, 1, '');
    if (!ls.length || this.dead) return 'none';
    const end = this.src.state().docSize ?? this.src.size;
    const endOf = (k: number) => (k < ls.length ? ls[k].at : end);
    const start = ls[0].at;
    let k = Math.min(n, ls.length);
    // (A long line: a window of its own, up to LINE_MAX.)
    if (endOf(1) - start > WINDOW_BYTES) {
      if (endOf(1) - start > LINE_MAX) return 'long';
      k = 1;
    } else if (endOf(k) - start > WINDOW_BYTES) {
      // (The most lines within WINDOW_BYTES: line starts only grow.)
      let lo = 1;
      let hi = k;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (endOf(mid) - start <= WINDOW_BYTES) lo = mid;
        else hi = mid - 1;
      }
      k = lo;
    }
    const { text } = await this.src.textAt(start, endOf(k), LINE_MAX + 8);
    if (this.dead) return 'none';
    if (/\r(?!\n)/.test(text)) return 'cr';
    this.line = from;
    this.start = start;
    this.lines = k;
    this.take(text);
    this.now = this.view;
    return true;
  }

  /** The window's text as the document has it now: `sent`, and `view` with its \r\n as \n. */
  private take(text: string) {
    this.sent = text;
    this.end = this.start + utf8Bytes(text);
    this.crs = [];
    if (text.indexOf('\r') < 0) {
      this.view = text;
      this.crlf = false;
      return;
    }
    this.crlf = true;
    let view = '';
    let from = 0;
    for (let i = text.indexOf('\r\n'); i >= 0; i = text.indexOf('\r\n', i + 2)) {
      view += text.slice(from, i);
      this.crs.push(view.length);
      from = i + 1;
    }
    this.view = view + text.slice(from);
  }

  /** `sent`'s offset of `view`'s offset `v` (each \r\n before it is a unit longer there). */
  private orig(v: number) {
    let lo = 0;
    let hi = this.crs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.crs[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return v + lo;
  }

  /** `view`'s offset of `sent`'s offset `o`. */
  private viewOf(o: number) {
    let lo = 0;
    let hi = this.crs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.crs[mid] + mid < o) lo = mid + 1;
      else hi = mid;
    }
    return o - lo;
  }

  /** The window's last byte (exclusive), as the document has it. */
  end = 0;

  /** The editor's text now: what changed is sent when the document takes edits. */
  edited(now: string) {
    this.now = now;
    this.kick();
  }

  /** Is anything typed not taken in by the document yet? */
  get pending() {
    return this.busy || this.now !== this.view;
  }

  /** Resolves once everything typed is taken in (before undo, saving, moving the window, leaving). */
  flush(): Promise<void> {
    if (!this.pending || this.dead || this.broken) return Promise.resolve();
    return new Promise((done) => this.flushed.push(done));
  }

  private kick() {
    if (this.dead || this.busy || this.broken) return;
    if (this.now === this.view) {
      for (const f of this.flushed.splice(0)) f();
      return;
    }
    if (!this.src.state().done) return this.waitReady();
    void this.send();
  }

  /** The document is read again after a change: what's typed waits for it. */
  private waitReady() {
    if (this.waiting) return;
    const stop = this.src.onState((st: IndexState) => {
      if (!st.done) return;
      this.waiting?.();
    });
    this.waiting = () => {
      stop();
      this.waiting = null;
      this.kick();
    };
  }

  private async send() {
    const now = this.now;
    const d = diffText(this.view, now);
    if (!d) return this.kick();
    const oa = this.orig(d.p);
    const ob = this.orig(d.p + d.del);
    const ins = this.crlf ? d.ins.replace(/\n/g, '\r\n') : d.ins;
    const a = this.start + utf8Bytes(this.sent, 0, oa);
    const b = a + utf8Bytes(this.sent, oa, ob);
    this.busy = true;
    try {
      await this.src.edits!.replace([{ a, b, text: ins }], true);
      if (this.dead) return;
      const next = this.sent.slice(0, oa) + ins + this.sent.slice(ob);
      if (this.crlf || ins.indexOf('\r') >= 0) this.take(next);
      else {
        // (No CR: the editor's text is the document's; its end moves by what changed.)
        this.end += utf8Bytes(ins) - (b - a);
        this.sent = this.view = next;
      }
      this.ev.sent();
    } catch (e) {
      if (this.dead) return;
      // (Still reading again after the last change: sent once it's done.)
      if (e instanceof Error && e.message === 'Not ready') {
        this.busy = false;
        return this.waitReady();
      }
      // (Anything else: nothing more is sent; the window is read again from the document: see `broken`.)
      this.broken = true;
      for (const f of this.flushed.splice(0)) f();
      this.ev.failed(e);
      return;
    } finally {
      this.busy = false;
    }
    this.kick();
  }

  /** A change couldn't be sent: the window must be read again (what the editor shows isn't the document). */
  broken = false;

  /** The editor's offset of document byte `at`; -1 outside the window. */
  offsetOf(at: number): number {
    if (at < this.start || at > this.end) return -1;
    return this.viewOf(utf16Of(this.sent, at - this.start));
  }

  /** The document byte of the editor's offset `off` (meaningful once flushed: the editor's text is the document's then). */
  byteOf(off: number): number {
    return this.start + utf8Bytes(this.sent, 0, this.orig(Math.min(off, this.view.length)));
  }
}
