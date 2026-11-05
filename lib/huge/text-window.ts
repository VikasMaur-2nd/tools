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
import { badAfterEdit, utf16Of, utf8Bytes } from './utf8';
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
/** What's typed while the document can't take it ('Not ready') is tried again this often (ms), states or not. */
const RETRY_MS = 250;
/**
 * A window let go with keys not taken in yet tries to send them this long at most (ms; the session waits as long
 * before the core closes: session.ts TYPED_WAIT), then stops (REVIEW-3 C7: it polled for the page's life).
 */
export const LET_GO_MS = 3000;

/** A change of a text: [p, p + del) became `ins`. */
export interface Change {
  p: number;
  del: number;
  ins: string;
}

/** What changed from `a` to `b`: [p, p + del) of `a` became `ins` (null: nothing did). Never between a pair's halves. */
export function diffText(a: string, b: string): Change | null {
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

const fffds = (s: string) => {
  const out: number[] = [];
  for (let i = s.indexOf('\uFFFD'); i >= 0; i = s.indexOf('\uFFFD', i + 1)) out.push(i);
  return out;
};

/** `old` (at `p`) becoming `ins`, as changes around the U+FFFD units both have (as many, in order): those stay. */
function around(old: string, ins: string, p: number): Change[] {
  const po = fffds(old);
  const pn = fffds(ins);
  if (!po.length || po.length !== pn.length) return [{ p, del: old.length, ins }];
  const out: Change[] = [];
  let a = 0;
  let b = 0;
  for (let k = 0; k <= po.length; k++) {
    const ea = k < po.length ? po[k] : old.length;
    const eb = k < pn.length ? pn[k] : ins.length;
    const d = diffText(old.slice(a, ea), ins.slice(b, eb));
    if (d) out.push({ p: p + a + d.p, del: d.del, ins: d.ins });
    a = ea + 1;
    b = eb + 1;
  }
  return out;
}

/**
 * Change `c` of `text` as changes that leave alone every character it didn't change (in order, each at `text`'s
 * offsets): across lines with as many lines after it (an indented selection, keys on several lines), each line's
 * own; within one, around each U+FFFD both sides still have. Such a unit can be an invalid byte sequence of the
 * file: replaced, it would be written back as EF BF BD (REVIEW-3 B2). A pure insert or delete is as it is.
 */
export function splitChange(text: string, c: Change): Change[] {
  if (!c.del || !c.ins) return [c];
  const old = text.slice(c.p, c.p + c.del);
  const ol = old.split('\n');
  const nl = c.ins.split('\n');
  if (ol.length < 2 || ol.length !== nl.length) return around(old, c.ins, c.p);
  const out: Change[] = [];
  let p = c.p;
  for (let k = 0; k < ol.length; k++) {
    const d = diffText(ol[k], nl[k]);
    if (d) out.push(...around(ol[k].slice(d.p, d.p + d.del), d.ins, p + d.p));
    p += ol[k].length + 1;
  }
  return out;
}

/**
 * Deletion `d` of `text` moved back over U+FFFD units to start at `caret` where it can: in a run of them, which one
 * the user deleted (the one at the caret after it) can't be told from the text, and each can stand for other bytes.
 */
export function slideTo(text: string, d: Change, caret: number): Change {
  if (d.ins || caret >= d.p) return d;
  let p = d.p;
  while (p > caret && text.charCodeAt(p - 1) === 0xfffd && text.charCodeAt(p + d.del - 1) === 0xfffd) p--;
  return p === d.p ? d : { p, del: d.del, ins: '' };
}

/** A text with \r\n as the editor has it (\n), and where each \r\n was (`crs`: offsets of those \n in `view`). */
function lfView(text: string): { view: string; crs: number[] } {
  if (text.indexOf('\r') < 0) return { view: text, crs: [] };
  const crs: number[] = [];
  let view = '';
  let from = 0;
  for (let i = text.indexOf('\r\n'); i >= 0; i = text.indexOf('\r\n', i + 2)) {
    view += text.slice(from, i);
    crs.push(view.length);
    from = i + 1;
  }
  return { view: view + text.slice(from), crs };
}

/** The text's offset of view offset `v` (each \r\n before it is a unit longer there). */
function origIn(crs: readonly number[], v: number) {
  let lo = 0;
  let hi = crs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (crs[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return v + lo;
}

export interface WindowEvents {
  /** A change was sent (taken in by the document). */
  sent(): void;
  /** Sending failed (not a wait: the window is then read again). */
  failed(e: unknown): void;
}

/**
 * Why a window can't be read: no lines, its first line is longer than a window, it has a lone CR, or its text
 * doesn't add up to its bytes (never expected: a guard, so no key is written at the wrong bytes).
 */
export type WindowRefusal = 'none' | 'long' | 'cr' | 'bytes';

export class TextWindow {
  /** The window's first line (0-based, as written), its first byte, and how many lines it holds. */
  line = 0;
  start = 0;
  lines = 0;
  /** Its text as the document has it. */
  sent = '';
  /**
   * Which of `sent`'s U+FFFD units stand for invalid UTF-8 bytes, and how many each (utf8.ts: the core's rule):
   * every byte offset is counted with them (REVIEW-2 #2).
   */
  private bad: Float64Array | null = null;
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
  /** Let go (nothing more is read or told), and nothing typed is left to send. */
  private dead = false;
  /** Let go: what's typed and not taken in yet still goes (the newest key, when another file replaces this one). */
  private gone = false;

  constructor(
    private readonly src: HugeSource,
    private readonly ev: WindowEvents,
  ) {}

  /**
   * Lets the window go: nothing more is read or told; what's typed still goes (`flush` resolves once it has), for
   * LET_GO_MS at most.
   */
  destroy() {
    this.gone = true;
    if (!this.pending || this.broken) return this.finish();
    this.giveUp ??= setTimeout(() => this.finish(), LET_GO_MS);
  }

  private giveUp: ReturnType<typeof setTimeout> | undefined;

  private finish() {
    clearTimeout(this.giveUp);
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
    if (!ls.length || this.gone) return 'none';
    const st = this.src.state();
    const end = st.docSize ?? this.src.size;
    const starts = ls.map((l) => l.at);
    let lines = Math.min(n, starts.length);
    // A document all read, with an error: the core's raw lines past it come as it counts them (in steps after
    // `done`; core round 7), and after an edit that breaks the document they stopped at the error (UI-NOTES 24).
    // Lines the core doesn't give yet are found in the text, as far as a window goes, so the error's line can be
    // seen and fixed by typing (REVIEW-2 #6). Once the core gives them all, this reads nothing more.
    if (st.done && st.error && starts.length < WINDOW_LINES + 1) {
      const a = starts[starts.length - 1];
      const b = Math.min(end, Math.max(starts[0] + WINDOW_BYTES, a + LINE_MAX) + 1);
      const { text, bad } = await this.src.textAt(a, b, b - a + 8);
      if (this.gone) return 'none';
      for (let i = text.indexOf('\n'); i >= 0 && starts.length < WINDOW_LINES + 1; i = text.indexOf('\n', i + 1)) {
        const s = a + utf8Bytes(text, 0, i + 1, bad);
        if (s < end) starts.push(s);
      }
      // (Short of the document's end: its last line read may go on; only whole lines.)
      const whole = b >= end || starts.length > WINDOW_LINES ? starts.length : starts.length - 1;
      lines = Math.max(1, Math.min(WINDOW_LINES, whole));
    }
    const endOf = (k: number) => (k < starts.length ? starts[k] : end);
    const start = starts[0];
    let k = lines;
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
    const { text, bad } = await this.src.textAt(start, endOf(k), LINE_MAX + 8);
    if (this.gone) return 'none';
    if (/\r(?!\n)/.test(text)) return 'cr';
    if (utf8Bytes(text, 0, text.length, bad) !== endOf(k) - start) return 'bytes';
    this.line = from;
    this.start = start;
    this.lines = k;
    this.take(text, bad ?? null);
    this.now = this.view;
    this.queue = [];
    return true;
  }

  /** The window's text as the document has it now: `sent`, and `view` with its \r\n as \n. */
  private take(text: string, bad: Float64Array | null) {
    this.sent = text;
    this.bad = bad;
    this.end = this.start + utf8Bytes(text, 0, text.length, bad);
    this.crlf = text.indexOf('\r') >= 0;
    ({ view: this.view, crs: this.crs } = lfView(text));
  }

  /** `sent`'s offset of `view`'s offset `v` (each \r\n before it is a unit longer there). */
  private orig(v: number) {
    return origIn(this.crs, v);
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

  /**
   * Changes typed and not sent yet, in order, each of the text the one before leaves (the first: `view`). Kept
   * apart (not one diff of the window), so that a send never covers what's between two of them (REVIEW-3 B2).
   */
  private queue: Change[] = [];

  /**
   * The editor's text now: what changed is sent when the document takes edits. `caret`: the editor's caret after
   * the change, to tell which of a run of U+FFFD units was deleted (slideTo).
   */
  edited(now: string, caret?: number) {
    let d = diffText(this.now, now);
    if (d && caret !== undefined) d = slideTo(this.now, d, caret);
    this.now = now;
    if (d) this.push(d);
    this.kick();
  }

  private push(d: Change) {
    const last = this.queue[this.queue.length - 1];
    const end = last ? last.p + last.ins.length : -1;
    if (last && !d.del && d.p === end) {
      // (Typed on where the last change ends: one change, longer, which the core joins as typing.)
      last.ins += d.ins;
    } else if (last && !d.ins && d.p + d.del === end && d.p >= last.p) {
      // (Backspace into what the last change typed: shorter.)
      last.ins = last.ins.slice(0, d.p - last.p);
      if (!last.ins && !last.del) this.queue.pop();
    } else this.queue.push(d);
  }

  /** Is anything typed not taken in by the document yet? */
  get pending() {
    return this.busy || this.queue.length > 0;
  }

  /** Resolves once everything typed is taken in (before undo, saving, moving the window, leaving). */
  flush(): Promise<void> {
    if (!this.pending || this.dead || this.broken) return Promise.resolve();
    return new Promise((done) => this.flushed.push(done));
  }

  private kick() {
    if (this.dead || this.busy || this.broken) return;
    if (!this.queue.length) {
      if (this.gone) return this.finish();
      for (const f of this.flushed.splice(0)) f();
      return;
    }
    if (!this.src.state().done) return this.waitReady();
    void this.send();
  }

  /**
   * The document is read again after a change, or saved: what's typed waits for it (sent on its next state that's
   * done, or tried again after RETRY_MS: nothing waits for a state that never comes).
   */
  private waitReady() {
    if (this.waiting) return;
    const stop = this.src.onState((st: IndexState) => {
      if (!st.done) return;
      this.waiting?.();
    });
    const timer = setTimeout(() => this.waiting?.(), RETRY_MS);
    this.waiting = () => {
      stop();
      clearTimeout(timer);
      this.waiting = null;
      this.kick();
    };
  }

  private async send() {
    const changes = this.queue.splice(0);
    if (!changes.length) return this.kick();
    // Each change at the text the one before leaves, each split so that nothing it didn't change is written: ops in
    // that order, each at the document the one before leaves (a change's parts from its last: the ones before it
    // keep their offsets).
    let text = this.sent;
    let bad = this.bad;
    let view = this.view;
    let crs = this.crs;
    let grew = 0;
    let cr = this.crlf;
    const ops: { a: number; b: number; text: string }[] = [];
    for (let j = 0; j < changes.length; j++) {
      const parts = splitChange(view, changes[j]);
      for (let k = parts.length - 1; k >= 0; k--) {
        const q = parts[k];
        const oa = origIn(crs, q.p);
        const ob = origIn(crs, q.p + q.del);
        const ins = this.crlf ? q.ins.replace(/\n/g, '\r\n') : q.ins;
        const a = this.start + utf8Bytes(text, 0, oa, bad);
        const b = a + utf8Bytes(text, oa, ob, bad);
        ops.push({ a, b, text: ins });
        grew += utf8Bytes(ins) - (b - a);
        text = text.slice(0, oa) + ins + text.slice(ob);
        // (What's typed is valid: the invalid bytes in what it replaced go, the ones after it move.)
        bad = badAfterEdit(bad, oa, ob, ins.length);
        if (ins.indexOf('\r') >= 0) cr = true;
      }
      if (j + 1 < changes.length) ({ view, crs } = cr ? lfView(text) : { view: text, crs });
    }
    this.busy = true;
    try {
      if (ops.length) await this.src.edits!.replace(ops, true);
      if (this.dead) return;
      if (cr) this.take(text, bad);
      else {
        // (No CR: the editor's text is the document's; its end moves by what changed.)
        this.end += grew;
        this.sent = this.view = text;
        this.bad = bad;
      }
      if (!this.gone) this.ev.sent();
    } catch (e) {
      if (this.dead) return;
      // (Still reading again after the last change: sent once it's done, with what's typed since.)
      if (e instanceof Error && e.message === 'Not ready') {
        this.queue.unshift(...changes);
        this.busy = false;
        return this.waitReady();
      }
      // (Anything else: nothing more is sent; the window is read again from the document: see `broken`.)
      this.broken = true;
      this.queue = [];
      for (const f of this.flushed.splice(0)) f();
      if (this.gone) this.finish();
      else this.ev.failed(e);
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
    return this.viewOf(utf16Of(this.sent, at - this.start, this.bad));
  }

  /** The document byte of the editor's offset `off` (meaningful once flushed: the editor's text is the document's then). */
  byteOf(off: number): number {
    return this.start + utf8Bytes(this.sent, 0, this.orig(Math.min(off, this.view.length)), this.bad);
  }
}
