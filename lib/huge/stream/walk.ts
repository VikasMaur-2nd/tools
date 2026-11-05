/**
 * Huge mode's streamed passes (shape, convert, split, extract) read a document once, in order, a chunk at a
 * time: this walker tells a visitor every token with its byte offset. It keeps the open containers' kinds
 * (a byte a level) and the one token a chunk's end cuts (bounded: see `keep`), so memory doesn't grow with
 * the document.
 *
 * The index (huge.wasm) is what says whether a document is valid, with the normal path's message; the walker
 * checks the grammar as far as its own work needs (structure, literals, where tokens end) and throws a
 * `WalkError` (a fixed message and the byte) on anything else, so a broken file never yields a broken result.
 *
 * Several top-level values (JSON Lines, `multi`) are read as one array of them, as the normal path views them:
 * the visitor sees an `open(ARR, -1)` first and a `close(ARR, end)` last; whitespace, `,` and `;` may separate
 * them (tape-parser.ts's JSON Lines rules).
 */

export const NUL = 0;
export const BOOL = 1;
export const NUM = 2;
export const STR = 3;
export const ARR = 4;
export const OBJ = 5;

/** String flags: it has a backslash (an escape). */
export const ESC = 1;
/** …a byte of 0x80 or more (not ASCII). */
export const HI = 2;
/** …it was longer than the walker keeps: only its first `keep` bytes are given (`Walker.longBytes`: all of it). */
export const LONG = 4;
/** …it came in parts (Visitor.part, `parts` mode): this is the last one. */
export const PART = 8;

export interface Visitor {
  /** A container opens at byte `at` (-1: the list of several top-level values). */
  open(kind: number, at: number): void;
  /** …and closes: `end` is the byte after its bracket. */
  close(kind: number, end: number): void;
  /** A member's name: its raw bytes b[a, e) between the quotes; `at`: its opening quote. */
  key(b: Uint8Array, a: number, e: number, flags: number, at: number): void;
  /** A string value: raw bytes b[a, e) between the quotes (escapes as written). */
  str(b: Uint8Array, a: number, e: number, flags: number, at: number): void;
  /** A number, as written: b[a, e). */
  num(b: Uint8Array, a: number, e: number, at: number): void;
  /** null (NUL) or true / false (BOOL). */
  lit(kind: number, v: boolean, at: number): void;
  /**
   * `parts` mode: a piece of a string or name too long to keep whole, raw bytes b[a, e) in order (a piece may
   * end inside an escape or a character). The last piece comes to str()/key() with the PART flag.
   */
  part?(b: Uint8Array, a: number, e: number, key: boolean): void;
}

export class WalkError extends Error {
  constructor(readonly at: number) {
    super('Invalid JSON');
  }
}

export interface WalkOptions {
  /** Several top-level values, read as one array of them. */
  multi?: boolean;
  /** Bytes of a string kept whole when chunks cut it (longer: LONG, or parts). Default 64 MiB. */
  keep?: number;
  /** Strings longer than `keep` come in parts (Visitor.part) rather than cut. */
  parts?: boolean;
  /** Bytes of a string read in one go (default SLICE; tests make it small). */
  slice?: number;
}

// States.
/** A value is next (after `:`, or `,` in an array). */
const S_V = 0;
/** After `[`: a value or `]`. */
const S_VA = 1;
/** After `,` in an object: a name. */
const S_K = 2;
/** After `{`: a name or `}`. */
const S_KO = 3;
/** After a name: `:`. */
const S_C = 4;
/** After a value in a container: `,` or its close. */
const S_N = 5;
/** After the top-level value: only whitespace. */
const S_T = 6;
/** Between top-level values of a list: whitespace, `,`, `;`, the next value or the end. */
const S_L = 7;
/** In a token a chunk's end cut: a string (or name), a number, a literal. */
const S_STR = 8;
const S_NUM = 9;
const S_LIT = 10;

/** The list of top-level values, on the stack. */
const LIST = 6;

/** Bytes of a string read in one go: a longer one is read (and handed on, in parts mode) a slice at a time. */
export const SLICE = 1 << 20;

/** Bytes a number may have (cut by chunks; longer is refused). */
const NUM_MAX = 64 << 20;

/** Bytes that may be part of a number. */
const NUMCH = new Uint8Array(256);
for (const c of '0123456789+-.eE') NUMCH[c.charCodeAt(0)] = 1;

const WORDS = [new Uint8Array([110, 117, 108, 108]), new Uint8Array([116, 114, 117, 101]), new Uint8Array([102, 97, 108, 115, 101])];

export class Walker {
  /** Byte just past the last value read (a record's end). */
  last = 0;
  /** A LONG string's whole length in bytes (its raw text between the quotes). */
  longBytes = 0;
  /** Set by the visitor to stop `feed` after the current token (it returns where it stopped). */
  pause = false;
  /** Values read at the top (records of a list). */
  records = 0;
  /** Items (members) of a single root read so far, and the root's kind (-1: not yet). */
  items = 0;
  rootKind = -1;

  private st: number;
  private d: number;
  private kinds = new Uint8Array(64);
  private readonly list: boolean;
  private readonly keep: number;
  private readonly parts: boolean;
  private readonly slice: number;
  /** A value was read at the top (a single root: no second may follow). */
  private any = false;
  // A token cut by a chunk's end.
  private carry = new Uint8Array(256);
  private carryLen = 0;
  private tAt = 0;
  private tKey = false;
  private tFlags = 0;
  private tEsc = false;
  private tBytes = 0;
  /** Kept to `keep` bytes (LONG), or handed on in parts (PART). */
  private tMode = 0;
  private word: Uint8Array = WORDS[0];

  constructor(
    private readonly v: Visitor,
    o: WalkOptions = {},
  ) {
    this.list = !!o.multi;
    this.keep = o.keep ?? 64 << 20;
    this.parts = !!o.parts && !!v.part;
    this.slice = Math.max(1, o.slice ?? SLICE);
    if (this.list) {
      this.kinds[0] = LIST;
      this.d = 1;
      this.st = S_L;
      v.open(ARR, -1);
    } else {
      this.d = 0;
      this.st = S_V;
    }
  }

  /** Open containers (the list counts as one). */
  get depth() {
    return this.d;
  }

  /**
   * Reads b[from…], whose first byte is the document's byte `base`. Returns where it stopped: b.length, or
   * earlier if the visitor set `pause` (call again from there). A visitor may pause after any token, and
   * within a long string between its slices (see SLICE): what it writes stays bounded however much a token
   * expands.
   */
  feed(b: Uint8Array, base: number, from = 0): number {
    const n = b.length;
    let i = from;
    for (;;) {
      // (A token in progress: a string the chunk cut, or one too long to read in one go; a number, a literal.)
      while (this.st >= S_STR) {
        i = this.resume(b, base, i);
        if (i < 0) return n;
        if (this.pause) {
          this.pause = false;
          return i;
        }
      }
      if (i >= n) return n;
      i = this.scan(b, base, i);
      if (this.pause) {
        this.pause = false;
        return i;
      }
      if (i >= n) return n;
    }
  }

  /** The tokens of b[i…] until its end, a pause, or a string cut there or too long for one go (then `st` is S_STR). */
  private scan(b: Uint8Array, base: number, i: number): number {
    const n = b.length;
    const slice = this.slice;
    const v = this.v;
    let st = this.st;
    let d = this.d;
    let kinds = this.kinds;
    const lb = this.list ? 1 : 0;
    const top = this.list ? S_L : S_T;
    loop: while (i < n) {
      const c = b[i];
      if (c <= 32) {
        if (c === 32 || c === 10 || c === 13 || c === 9) {
          i++;
          continue;
        }
        throw new WalkError(base + i);
      }
      switch (st) {
        case S_N:
          if (c === 44) {
            st = kinds[d - 1] === OBJ ? S_K : S_V;
            i++;
            continue;
          }
          if (c === 93 || c === 125) {
            const k = kinds[d - 1];
            if ((c === 93 ? ARR : OBJ) !== k) throw new WalkError(base + i);
            d--;
            i++;
            this.last = base + i;
            v.close(k, base + i);
            st = d > lb ? S_N : top;
            if (d === lb) this.records++;
            else if (d === 1) this.items++;
            if (this.pause) break loop;
            continue;
          }
          throw new WalkError(base + i);
        case S_K:
        case S_KO:
          if (c === 34) {
            // A name: to its closing quote (escapes skipped), within this chunk (and SLICE) if it can.
            let j = i + 1;
            let hi = 0;
            let fl = 0;
            const lim = j + slice < n ? j + slice : n;
            while (j < lim) {
              const x = b[j];
              if (x === 34) break;
              if (x === 92) {
                fl = ESC;
                j += 2;
                continue;
              }
              hi |= x;
              j++;
            }
            if (j < lim) {
              v.key(b, i + 1, j, fl | (hi & 0x80 ? HI : 0), base + i);
              i = j + 1;
              st = S_C;
              // (The colon usually follows at once.)
              while (i < n) {
                const x = b[i];
                if (x === 58) {
                  i++;
                  st = S_V;
                  break;
                }
                if (x !== 32 && x !== 10 && x !== 13 && x !== 9) throw new WalkError(base + i);
                i++;
              }
              if (this.pause) break loop;
              continue;
            }
            this.st = st;
            this.d = d;
            this.cut(base + i, true);
            return i + 1;
          }
          if (c === 125 && st === S_KO) {
            d--;
            i++;
            this.last = base + i;
            v.close(OBJ, base + i);
            st = d > lb ? S_N : top;
            if (d === lb) this.records++;
            else if (d === 1) this.items++;
            if (this.pause) break loop;
            continue;
          }
          throw new WalkError(base + i);
        case S_C:
          if (c !== 58) throw new WalkError(base + i);
          st = S_V;
          i++;
          continue;
        case S_T:
          throw new WalkError(base + i);
        case S_L:
          if (c === 44 || c === 59) {
            i++;
            continue;
          }
          break;
        case S_VA:
          if (c === 93) {
            d--;
            i++;
            this.last = base + i;
            v.close(ARR, base + i);
            st = d > lb ? S_N : top;
            if (d === lb) this.records++;
            else if (d === 1) this.items++;
            if (this.pause) break loop;
            continue;
          }
          break;
      }
      // A value starts at i.
      if (d === 0) {
        if (this.any) throw new WalkError(base + i);
        this.any = true;
      }
      if (c === 34) {
        let j = i + 1;
        let hi = 0;
        let fl = 0;
        const lim = j + slice < n ? j + slice : n;
        while (j < lim) {
          const x = b[j];
          if (x === 34) break;
          if (x === 92) {
            fl = ESC;
            j += 2;
            continue;
          }
          hi |= x;
          j++;
        }
        if (j < lim) {
          this.last = base + j + 1;
          v.str(b, i + 1, j, fl | (hi & 0x80 ? HI : 0), base + i);
          i = j + 1;
          st = d > lb ? S_N : top;
          if (d === lb) this.records++;
          else if (d === 1) this.items++;
          if (this.pause) break loop;
          continue;
        }
        this.st = st;
        this.d = d;
        this.cut(base + i, false);
        return i + 1;
      }
      if (c === 123 || c === 91) {
        if (d === kinds.length) kinds = this.grow();
        const k = c === 123 ? OBJ : ARR;
        if (d === 0) this.rootKind = k;
        kinds[d++] = k;
        v.open(k, base + i);
        i++;
        st = k === OBJ ? S_KO : S_VA;
        if (this.pause) break loop;
        continue;
      }
      if (NUMCH[c] && c !== 43 && c !== 46 && c !== 101 && c !== 69) {
        let j = i + 1;
        while (j < n && NUMCH[b[j]]) j++;
        if (j === n) {
          this.st = st;
          this.d = d;
          this.tAt = base + i;
          this.carryLen = 0;
          this.append(b, i, n, NUM_MAX);
          this.st = S_NUM;
          return n;
        }
        this.last = base + j;
        v.num(b, i, j, base + i);
        i = j;
        st = d > lb ? S_N : top;
        if (d === lb) this.records++;
        else if (d === 1) this.items++;
        if (this.pause) break loop;
        continue;
      }
      const w = c === 110 ? 0 : c === 116 ? 1 : c === 102 ? 2 : -1;
      if (w < 0) throw new WalkError(base + i);
      const word = WORDS[w];
      const len = word.length;
      if (i + len > n) {
        // (Cut by the chunk: the rest comes first in the next.)
        for (let k = i + 1; k < n; k++) if (b[k] !== word[k - i]) throw new WalkError(base + i);
        this.st = st;
        this.d = d;
        this.tAt = base + i;
        this.word = word;
        this.tBytes = n - i;
        this.st = S_LIT;
        return n;
      }
      for (let k = 1; k < len; k++) if (b[i + k] !== word[k]) throw new WalkError(base + i);
      this.last = base + i + len;
      v.lit(w === 0 ? NUL : BOOL, w === 1, base + i);
      i += len;
      st = d > lb ? S_N : top;
      if (d === lb) this.records++;
      else if (d === 1) this.items++;
      if (this.pause) break loop;
    }
    this.st = st;
    this.d = d;
    return i;
  }

  /** The document ended (after its last byte was fed): closes the list; throws if a value is unfinished. */
  finish(end: number) {
    if (this.st === S_NUM) {
      this.st = this.after();
      this.last = end;
      this.v.num(this.carry, 0, this.carryLen, this.tAt);
      this.counted();
    }
    if (this.st === S_STR || this.st === S_LIT) throw new WalkError(end);
    if (this.list) {
      if (this.d !== 1) throw new WalkError(end);
      this.d = 0;
      this.last = end;
      this.v.close(ARR, end);
      return;
    }
    if (this.d !== 0 || !this.any) throw new WalkError(end);
  }

  private grow() {
    const k = new Uint8Array(this.kinds.length * 2);
    k.set(this.kinds);
    return (this.kinds = k);
  }

  /** The state after a value, at the current depth. */
  private after() {
    return this.d > (this.list ? 1 : 0) ? S_N : this.list ? S_L : S_T;
  }

  private counted() {
    if (this.d === (this.list ? 1 : 0)) this.records++;
    else if (this.d === 1) this.items++;
  }

  /** Appends b[a, e) to the carried token (refused past `max` bytes). */
  private append(b: Uint8Array, a: number, e: number, max: number) {
    const len = e - a;
    if (this.carryLen + len > this.carry.length) {
      if (this.carryLen + len > max) throw new WalkError(this.tAt);
      let size = this.carry.length;
      while (size < this.carryLen + len) size *= 2;
      const c = new Uint8Array(Math.min(size, Math.max(max, this.carryLen + len)));
      c.set(this.carry.subarray(0, this.carryLen));
      this.carry = c;
    }
    this.carry.set(b.subarray(a, e), this.carryLen);
    this.carryLen += len;
  }

  /**
   * A string (or name) whose quote is at byte `at` runs past the chunk, or past SLICE: read from the byte after
   * its quote as a token in progress (kept, or handed on in parts, until it ends).
   */
  private cut(at: number, key: boolean) {
    this.tAt = at;
    this.tKey = key;
    this.tFlags = 0;
    this.tEsc = false;
    this.tBytes = 0;
    this.tMode = 0;
    this.carryLen = 0;
    this.st = S_STR;
  }

  /** The cut string's bytes b[a, e): kept, counted (LONG), or handed on (PART). */
  private take(b: Uint8Array, a: number, e: number) {
    this.tBytes += e - a;
    this.hold(b, a, e);
  }

  private hold(b: Uint8Array, a: number, e: number) {
    if (this.tMode === PART) {
      if (e > a) this.v.part!(b, a, e, this.tKey);
      return;
    }
    if (this.tMode === LONG) {
      const room = this.keep - this.carryLen;
      if (room > 0) this.append(b, a, a + Math.min(room, e - a), Infinity);
      return;
    }
    if (this.carryLen + (e - a) <= this.keep) {
      this.append(b, a, e, Infinity);
      return;
    }
    if (this.parts) {
      this.tMode = PART;
      if (this.carryLen) this.v.part!(this.carry, 0, this.carryLen, this.tKey);
      this.carryLen = 0;
      if (e > a) this.v.part!(b, a, e, this.tKey);
      return;
    }
    this.tMode = LONG;
    this.hold(b, a, e);
  }

  /** The rest of the token a chunk's end cut, from b[i]: where reading goes on (-1: the token goes on past b). */
  private resume(b: Uint8Array, base: number, i: number): number {
    const n = b.length;
    if (this.st === S_NUM) {
      let j = i;
      while (j < n && NUMCH[b[j]]) j++;
      this.append(b, i, j, NUM_MAX);
      if (j === n) return -1;
      this.st = this.after();
      this.last = base + j;
      this.v.num(this.carry, 0, this.carryLen, this.tAt);
      this.counted();
      return j;
    }
    if (this.st === S_LIT) {
      const word = this.word;
      let k = this.tBytes;
      let j = i;
      for (; k < word.length && j < n; k++, j++) if (b[j] !== word[k]) throw new WalkError(this.tAt);
      this.tBytes = k;
      if (k < word.length) return -1;
      this.st = this.after();
      this.last = base + j;
      this.v.lit(word.length === 4 && word[0] === 110 ? NUL : BOOL, word[0] === 116, this.tAt);
      this.counted();
      return j;
    }
    // A string: at most SLICE bytes of it at a time (a visitor may pause between them).
    let j = i;
    let hi = 0;
    let fl = this.tFlags;
    if (this.tEsc) {
      j++;
      this.tEsc = false;
    }
    const lim = j + this.slice < n ? j + this.slice : n;
    while (j < lim) {
      const x = b[j];
      if (x === 34) break;
      if (x === 92) {
        fl |= ESC;
        j += 2;
        continue;
      }
      hi |= x;
      j++;
    }
    if (hi & 0x80) fl |= HI;
    this.tFlags = fl;
    if (j >= lim) {
      if (lim === n || j >= n) {
        this.tEsc = j > n;
        this.take(b, i, n);
        return -1;
      }
      // (Its next slice comes next: no escape is cut, the loop stepped over each whole.)
      this.take(b, i, j);
      return j;
    }
    const key = this.tKey;
    const at = this.tAt;
    const st = key ? S_C : this.after();
    this.st = st;
    if (this.tMode === PART) {
      this.tBytes += j - i;
      if (key) this.v.key(b, i, j, fl | PART, at);
      else {
        this.last = base + j + 1;
        this.v.str(b, i, j, fl | PART, at);
      }
    } else {
      this.take(b, i, j);
      if (this.tMode === PART) {
        // (Turned to parts by this last piece: it went with them.)
        if (key) this.v.key(b, j, j, fl | PART, at);
        else {
          this.last = base + j + 1;
          this.v.str(b, j, j, fl | PART, at);
        }
      } else {
        if (this.tMode === LONG) {
          fl |= LONG;
          this.longBytes = this.tBytes;
        }
        if (key) this.v.key(this.carry, 0, this.carryLen, fl, at);
        else {
          this.last = base + j + 1;
          this.v.str(this.carry, 0, this.carryLen, fl, at);
        }
      }
    }
    if (!key) this.counted();
    this.carryLen = 0;
    if (this.carry.length > 1 << 20) this.carry = new Uint8Array(256);
    return j + 1;
  }
}
