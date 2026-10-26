/**
 * Shared by the tape parsers' tests: a field-by-field comparison of two tapes, a generator of strict
 * JSON (and of strict JSON broken here and there), and the corpora on this host.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VALUE_EXTRA, W, keyKindOf, sizeOf, valueKindOf, valueOf, type Tape } from '../../lib/json/tape';
import { mutate, type Rng } from './compare';

/**
 * The first difference between the tape parser's tape and the tape of parser.ts's tree (null if
 * none): the head, every node (kind, size, offsets, parent, key) and its value as JNode.v has it.
 * Value kinds may differ only where tapeOf keeps the value aside (VALUE_EXTRA) and the tape parser
 * reads it back from the source.
 */
export function diffTape(want: Tape, got: Tape, src: string): string | null {
  const a = want.head;
  const b = got.head;
  for (const k of ['nodes', 'depth', 'exact', 'multi'] as const) if (a[k] !== b[k]) return `head.${k}: ${a[k]} vs ${b[k]}`;
  for (const k of ['issues', 'warnings'] as const) {
    if (a[k].length !== b[k].length) return `head.${k}.length: ${a[k].length} vs ${b[k].length}`;
    for (let j = 0; j < a[k].length; j++) {
      if (a[k][j].p !== b[k][j].p || a[k][j].m !== b[k][j].m) return `head.${k}[${j}]: ${JSON.stringify(a[k][j])} vs ${JSON.stringify(b[k][j])}`;
    }
  }
  if (JSON.stringify(a.error) !== JSON.stringify(b.error)) return `head.error: ${JSON.stringify(a.error)} vs ${JSON.stringify(b.error)}`;
  if (Object.keys(b).join() !== 'issues,warnings,error,nodes,depth,exact,multi') return `head fields: ${Object.keys(b)}`;
  if (want.count !== got.count) return `count: ${want.count} vs ${got.count}`;
  if (got.nodes.length < got.count * W) return `nodes buffer too short: ${got.nodes.length}`;
  if (want.keys.length !== got.keys.length) return `keys.length: ${want.keys.length} vs ${got.keys.length}`;
  for (let k = 0; k < want.keys.length; k++) if (want.keys[k] !== got.keys[k]) return `keys[${k}]: ${JSON.stringify(want.keys[k])} vs ${JSON.stringify(got.keys[k])}`;
  const x = want.nodes;
  const y = got.nodes;
  for (let i = 0; i < want.count; i++) {
    const o = i * W;
    if ((x[o] & 0x1f) !== (y[o] & 0x1f) || x[o + 1] !== y[o + 1] || x[o + 2] !== y[o + 2] || x[o + 3] !== y[o + 3] || x[o + 4] !== y[o + 4] || sizeOf(want, i) !== sizeOf(got, i)) {
      const f = (t: Tape) => JSON.stringify([t.nodes[o] & 7, keyKindOf(t, i), sizeOf(t, i), t.nodes[o + 1], t.nodes[o + 2], t.nodes[o + 3], t.nodes[o + 4]]);
      return `node ${i} [kind, keyKind, size, start, end, parent, key]: ${f(want)} vs ${f(got)}`;
    }
    const vw = valueKindOf(want, i);
    const vg = valueKindOf(got, i);
    if (vw !== vg && vw !== VALUE_EXTRA) return `node ${i} value kind: ${vw} vs ${vg}`;
    const v1 = valueOf(want, i, src);
    const v2 = valueOf(got, i, src);
    if (v1 !== v2) return `node ${i} value: ${JSON.stringify(v1)} vs ${JSON.stringify(v2)}`;
  }
  return null;
}

// ── Generators ───────────────────────────────────────────────────────────

const KEYS = ['id', 'name', 'type', 'value', 'a', 'b', 'x', '', 'é', '中', '😀', 'k\\n', 'q\\"', '\\u0041b', '0', '12', '01', '4294967295', '12345678901', 'dup', 'long key with spaces'];
const STRS = ['', 'a', 'hello world', 'é', '中文', '😀', '\\"', '\\\\', '\\/', '\\b\\f\\n\\r\\t', '\\u0041', '\\uD83D\\uDE00', '\\ud800', '\\uDFFF', ' ', '\u007f', 'x'.repeat(40)];
const NUMBERS = ['0', '-0', '1', '-12', '3.5', '1e5', '1E-7', '-2.5e+10', '9007199254740993', '123456789012345678901234567890', '0.1', '1.0', '100', '5e-324', '1e400', '0.0000001', '0.000001', '-0.0', '123456789012345', '1234567890123456', '-123456789012345'];
const SPACE = ['', '', '', ' ', '\n', '\r\n', '\t', '\n  '];

/** Strict JSON (mostly: what the fast path takes), occasionally deep, wide or with duplicate keys. */
export function genStrict(r: Rng, maxDepth: number): string {
  const ws = () => r.pick(SPACE);
  const value = (d: number): string => {
    const k = d >= maxDepth ? r.int(8) : r.int(12);
    if (k < 1) return r.pick(['null', 'true', 'false']);
    if (k < 4) return r.pick(NUMBERS);
    if (k < 8) return '"' + r.pick(STRS) + (r.chance(0.2) ? r.pick(STRS) : '') + '"';
    if (k < 10) {
      const len = r.chance(0.1) ? 17 + r.int(30) : r.int(5);
      const items = Array.from({ length: len }, () => ws() + value(d + 1) + ws());
      return '[' + ws() + items.join(',') + ']';
    }
    const len = r.chance(0.1) ? 14 + r.int(30) : r.int(6);
    const items = Array.from({ length: len }, () => ws() + '"' + (r.chance(0.7) ? r.pick(KEYS) : 'k' + r.int(40)) + '"' + ws() + ':' + ws() + value(d + 1) + ws());
    return '{' + ws() + items.join(',') + '}';
  };
  return ws() + value(0) + ws();
}

const LOOSE_BITS = ['//c\n', '/*c*/', '#h\n', ',', ',,', "'s'", '`t`', '“q”', 'NaN', '+1', '.5', '1.', '007', '0x1F', 'True', 'None', 'undefined', 'abc', 'f(', ')', 'cb(1)', ' ', '\u000b', '﻿', '}', ']', ':', '=', '"\n"', '"\\q"', '"\\x41"', '\u0001', '\ud800', '\\', '"'];

/** Breaks a strict document in a few places with loose constructs or broken bytes: the fast path hands over there. */
export function loosen(r: Rng, s: string): string {
  for (let ops = 1 + r.int(3); ops > 0; ops--) {
    const p = r.int(s.length + 1);
    const k = r.int(10);
    if (k < 6) s = s.slice(0, p) + r.pick(LOOSE_BITS) + s.slice(p);
    else if (k < 8) s = s.slice(0, p) + s.slice(p + 1 + r.int(3));
    else s = mutate(r, s);
  }
  return s;
}

// ── Corpora on this host (skipped where missing) ─────────────────────────

export const CORPUS = process.env.TAPE_CORPUS || join(homedir(), '.cache/selftest/pbench-data');
export const FIXTURES = process.env.TAPE_FIXTURES || join(homedir(), '.cache/tool-kumar-harness/fixtures/v1');

export function files(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

