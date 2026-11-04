/**
 * What the normal path would say is wrong with a huge document: the skeleton only says where the document stops
 * being strict JSON; here the JS tape parser (the normal path's, with its options) parses again from the
 * checkpoint before that, starting from a text that opens the same containers (see `prefixOf`), and its first
 * problem is placed in the document: the same message, line and column as the normal path's status.
 */
import { lf } from '../engine/doc';
import { MAX_DEPTH } from '../json/parser';
import type { Tape } from '../json/tape';
import type { TapeOptions } from '../json/tape-parser';
import type { ByteSource } from '../json/tape-wasm';
import { byteAfterUnits, count, textOf } from './bytes';
import type { HugeIndex } from './index';
import { S_AFTER, S_TOP, type State } from './skeleton';
import { ARR, type HugeError, type HugeProblem } from './types';
import { decodeString } from '../json/decode';

/** The JS tape parser's parse (tape-parser.ts), loaded by whoever has it. */
export type Parse = (text: string, options?: TapeOptions) => Tape;

/** rules.ts MULTI: several top-level values are JSON Lines here, not a problem. */
const MULTI = 'Multiple top-level values (wrapped in an array)';

/** Bytes after the failure parsed first (more if the parser's first problem is at the end of what it got). */
const LOOK = 1 << 16;
/** At most this much is parsed again; past it, the middle of the long token in between is left out. */
const CAP = 1 << 26;
/** What is kept of each side of a long token left out. */
const SIDE = 1 << 20;

/**
 * A text the JS parser takes where checkpoint state `s` is: its open containers, outermost first (an array, or
 * an object with a member whose value is the next), and, after a value (S_AFTER), a value in the innermost
 * standing for it; after a top-level value (S_TOP), a top-level value standing for it. The stand-in ends as the
 * real value did (`prev`: the byte before the checkpoint), so what follows reads the same: a `#` after a space
 * is a comment, after a value it isn't; a number right after a string is two tokens, after a number one.
 */
export function prefixOf(s: State, prev: number): string {
  const f = s.frames;
  const after = s.state === S_AFTER || s.state === S_TOP;
  let stand = '';
  if (after) {
    if (prev === 32 || prev === 9) stand = '0' + String.fromCharCode(prev);
    else if (prev === 10 || prev === 13) stand = '0\n';
    else if (prev === 34) stand = '""';
    else if (prev === 93) stand = '[]';
    else if (prev === 125) stand = '{}';
    else if (prev === 101) stand = 'true';
    else if (prev === 108) stand = 'null';
    else stand = '0';
  }
  let out = '';
  for (let j = 0; j < f.length; j++) {
    const inner = j === f.length - 1 && s.state === S_AFTER;
    out += f[j].kind === ARR ? (inner ? '[' + stand : '[') : inner ? '{"":' + stand : '{"":';
  }
  if (s.state === S_TOP) out += stand;
  return out;
}

/** The byte before `pos` (-1 at the start). */
export const byteBefore = (src: ByteSource, pos: number) => (pos > 0 ? src.read(pos - 1, 1)[0] : -1);

/** The first problem of a parse (as Engine.statusOf picks it), ignoring several top-level values and anything before `from`. */
function firstProblem(t: Tape, from: number): { p: number; m: string; fatal: boolean } | null {
  const err = t.head.error;
  const first = t.head.issues.find((x) => x.m !== MULTI && x.p >= from);
  if (err && err.p >= from && (!first || err.p <= first.p)) return { p: err.p, m: err.m, fatal: true };
  if (first) return { p: first.p, m: first.m, fatal: !!err };
  return null;
}

/** Line and column (1-based, as the status bar) of byte `pos`, counting from checkpoint `k` (at or before it). */
export function lineCol(src: ByteSource, index: HugeIndex, pos: number, k = index.at(pos)): { line: number; col: number } {
  const at = index.pos[k];
  const b = src.read(at, pos - at);
  // Breaks counted natively; units only after the last one (or all, if none).
  let breaks = 0;
  let last = -1;
  for (let i = b.indexOf(10); i >= 0; i = b.indexOf(10, i + 1)) breaks++, (last = i);
  for (let i = b.indexOf(13); i >= 0; i = b.indexOf(13, i + 1)) {
    if (b[i + 1] !== 10) breaks++;
    if (i > last) last = i;
  }
  if (last >= 0) {
    const c = count(b, last + 1, b.length, b[last] === 13);
    return { line: index.lines[k] + breaks + 1, col: c.units + 1 };
  }
  return { line: index.lines[k] + 1, col: index.u16[k] - index.lineU16[k] + count(b, 0, b.length).units + 1 };
}

/**
 * The normal path's first problem in the document, which the skeleton found isn't strict JSON at byte
 * `failPos` (`anchor`: the skeleton's [UTF-16 units, line breaks, line start] there). `lines`: read as JSON Lines
 * (the file's name says so, as Engine.load decides).
 */
export function exactError(src: ByteSource, index: HugeIndex, failPos: number, anchor: [number, number, number], parse: Parse, lines: boolean): HugeError {
  // (One checkpoint back: repairing, the JS parser may place the problem in the string before the failure,
  // which can end right before the last checkpoint: `"a" b` is the string "a\" b".)
  const k = Math.max(0, index.at(failPos) - 1);
  const s = index.state(k);
  const prefix = prefixOf(s, byteBefore(src, s.pos));
  const start = s.pos;
  for (let look = LOOK; ; look *= 8) {
    const end = Math.min(src.size, failPos + look);
    // The region: whole, or (a long token in between) its start and the part around the failure.
    const cut = end - start > CAP;
    const headEnd = cut ? safeCut(src, start + SIDE) : end;
    const tailStart = cut ? safeCut(src, failPos - SIDE) : end;
    const head = lf(textOf(src, start, headEnd - start));
    const tail = cut ? lf(textOf(src, tailStart, end - tailStart)) : '';
    const text = prefix + head + tail;
    const t = parse(text, { lines, maxDepth: MAX_DEPTH, repair: true });
    const pb = firstProblem(t, prefix.length);
    const atEnd = !!pb && end < src.size && (pb.p >= text.length - 64 || /end of input/.test(pb.m));
    if ((pb && !atEnd) || end >= src.size || look >= CAP) {
      if (!pb) {
        // (The JS parser takes what the skeleton didn't: shouldn't happen; say where.)
        const lc = lineCol(src, index, failPos, k);
        return { msg: 'Invalid JSON', ...lc, pos: failPos, kind: 'error' };
      }
      const local = pb.p - prefix.length;
      const kind = pb.fatal ? 'error' : 'fixable';
      if (local <= head.length) {
        const b = src.read(start, headEnd - start);
        const pos = start + byteAfterUnits(b, 0, headEnd - start, local);
        return { msg: pb.m, ...placeIn(head, local, index, k), pos, kind };
      }
      // In the tail: placed from the failure (whose place the skeleton knew).
      const off = local - head.length;
      const b = src.read(tailStart, end - tailStart);
      const pos = tailStart + byteAfterUnits(b, 0, end - tailStart, off);
      const [u16, brk, lineU16] = anchor;
      const between = pos >= failPos ? count(src.read(failPos, pos - failPos), 0, pos - failPos) : null;
      if (between) {
        const line = brk + between.breaks + 1;
        const col = between.sinceBreak >= 0 ? between.sinceBreak + 1 : u16 + between.units - lineU16 + 1;
        return { msg: pb.m, line, col, pos, kind };
      }
      const back = count(src.read(pos, failPos - pos), 0, failPos - pos);
      return { msg: pb.m, line: brk - back.breaks + 1, col: u16 - back.units - lineU16 + 1, pos, kind };
    }
  }
}

/** Line and column of offset `local` of `text` (the document from checkpoint `k`, as the page's text: \n line ends). */
function placeIn(text: string, local: number, index: HugeIndex, k: number): { line: number; col: number } {
  let breaks = 0;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < local; i = text.indexOf('\n', i + 1)) {
    breaks++;
    last = i;
  }
  const line = index.lines[k] + breaks + 1;
  const col = last >= 0 ? local - last : index.u16[k] - index.lineU16[k] + local + 1;
  return { line, col };
}

/** A byte near `at` where a text can be cut without cutting a character or an escape (\uXXXX). */
function safeCut(src: ByteSource, at: number): number {
  const b = src.read(Math.max(0, at - 8), 16);
  const base = Math.max(0, at - 8);
  let p = at;
  for (let tries = 0; tries < 8; tries++, p++) {
    const i = p - base;
    if (i >= b.length) break;
    if (b[i] >= 0x80 && b[i] < 0xc0) continue;
    // (No backslash in the 6 bytes before: not in an escape.)
    let esc = false;
    for (let j = Math.max(0, i - 6); j < i; j++) if (b[j] === 92) esc = true;
    if (!esc) return p;
  }
  return p;
}

/** The name (a string token) at byte `pos`, decoded; at most `max` bytes are read. */
export function nameAt(src: ByteSource, pos: number, max = 1 << 16): string {
  const b = src.read(pos, Math.min(max, src.size - pos));
  let i = 1;
  for (; i < b.length; i++) {
    if (b[i] === 92) i++;
    else if (b[i] === 34) break;
  }
  return decodeString(new TextDecoder().decode(b.subarray(0, i + 1)), 0);
}

/** The duplicate-name warnings of [pos, first pos] pairs (each confirmed by reading both names), placed. */
export function duplicates(src: ByteSource, index: HugeIndex, pairs: number[]): HugeProblem[] {
  const out: HugeProblem[] = [];
  for (let j = 0; j < pairs.length; j += 2) {
    const key = nameAt(src, pairs[j]);
    if (key !== nameAt(src, pairs[j + 1])) continue;
    const m = `Duplicate key "${key.length > 40 ? key.slice(0, 40) + '…' : key}"`;
    out.push({ msg: m, ...lineCol(src, index, pairs[j]), pos: pairs[j] });
  }
  return out;
}
