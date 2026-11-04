/**
 * Shared by the huge-file tests: a HugeDoc over bytes in memory (or made on the fly), and the normal path's
 * answers for the same document (Engine.statusOf over tape-parser.ts with the worker's options).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lf } from '../lib/engine/doc';
import { MAX_DEPTH } from '../lib/json/parser';
import { parse } from '../lib/json/tape-parser';
import type { ByteSource } from '../lib/json/tape-wasm';
import { HugeDoc } from '../lib/huge/doc';
import { lazyResult } from '../lib/json/lazy';
import { jsonLines } from '../lib/engine/rules';
import type { HugeOptions } from '../lib/huge/types';

export const hugeMod = new WebAssembly.Module(readFileSync(join(__dirname, '..', '..', 'lib', 'huge', 'huge.wasm')));
export const tapeMod = new WebAssembly.Module(readFileSync(join(__dirname, '..', '..', 'lib', 'json', 'tape.wasm')));
export const enc = new TextEncoder();

export const memSource = (b: Uint8Array): ByteSource => ({ size: b.length, read: (at, len) => b.subarray(at, at + len) });

export interface Tune {
  window?: number;
  queryWindow?: number;
  pageBytes?: number;
}

/** A HugeDoc of `bytes`, read whole. */
export function hugeOf(bytes: Uint8Array | ByteSource, options: HugeOptions = {}, tune: Tune = {}, wasm = true): HugeDoc {
  const src = bytes instanceof Uint8Array ? memSource(bytes) : bytes;
  const d = new HugeDoc(src, hugeMod, { wasm: wasm ? tapeMod : null, parse }, options, tune);
  d.step(Infinity);
  return d;
}

const MULTI = 'Multiple top-level values (wrapped in an array)';
const LINES_FILE = /\.(jsonl|ndjson)$/i;

/** The page's text of a file's bytes (read.ts: a UTF-8 BOM dropped, invalid bytes as U+FFFD; doc.ts lf). */
export function pageText(bytes: Uint8Array): string {
  const b = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  return lf(new TextDecoder('utf-8', { ignoreBOM: true }).decode(b));
}

/** The normal path's status problem for a file (several top-level values not counted as one). */
export function normalStatus(bytes: Uint8Array, name = ''): { kind: string; msg: string; p: number; line: number; col: number } | null {
  const text = pageText(bytes);
  const t = parse(text, { lines: LINES_FILE.test(name), maxDepth: MAX_DEPTH, repair: true });
  const issues = t.head.issues.filter((x) => x.m !== MULTI);
  const first = issues[0];
  const err = t.head.error;
  if (!first && !err) return null;
  const pick = err && (!first || err.p <= first.p) ? err : first;
  const kind = err ? 'error' : 'fixable';
  const p = pick.p;
  const nl = text.lastIndexOf('\n', p - 1);
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < p; i = text.indexOf('\n', i + 1)) line++;
  return { kind, msg: pick.m, p, line, col: p - (nl + 1) + 1 };
}

/**
 * The normal path's status bar for a file (Engine.statusOf, or linesStatus for JSON Lines): kind, message and its
 * place, and the records of valid JSON Lines.
 */
export function normalBar(bytes: Uint8Array, name = ''): { kind: string; msg: string | null; line: number; col: number; jsonl: number | null } {
  const text = pageText(bytes);
  const t = parse(text, { lines: LINES_FILE.test(name), maxDepth: MAX_DEPTH, repair: true });
  const res = lazyResult(t, text);
  const place = (p: number) => {
    const nl = text.lastIndexOf('\n', p - 1);
    let line = 1;
    for (let i = text.indexOf('\n'); i >= 0 && i < p; i = text.indexOf('\n', i + 1)) line++;
    return { line, col: p - (nl + 1) + 1 };
  };
  const w = res.warnings[0];
  if (jsonLines(text, res)) return { kind: 'valid', msg: w ? w.m : null, ...(w ? place(w.p) : { line: 0, col: 0 }), jsonl: (res.root!.v as unknown[]).length };
  const first = res.issues[0];
  const err = res.error;
  if (!first && !err) return { kind: 'valid', msg: w ? w.m : null, ...(w ? place(w.p) : { line: 0, col: 0 }), jsonl: null };
  if (err && (!first || err.p <= first.p)) return { kind: 'error', msg: err.m, ...place(err.p), jsonl: null };
  return { kind: err ? 'error' : 'fixable', msg: first.m, ...place(first.p), jsonl: null };
}
