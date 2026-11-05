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
import type { HugeNode, HugeOptions } from '../lib/huge/types';
import { PageNodes } from '../lib/huge/page';
import { writeTape } from '../lib/json/pretty';

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

/** Tiny windows, checkpoints and directory sizes for edit tests (huge-edit, huge-editor). */
export interface EditTune {
  every: number;
  big: number;
  window: number;
  pageBytes: number;
}

export const open = (bytes: Uint8Array, name: string, t: EditTune) => {
  const d = new HugeDoc(memSource(bytes), hugeMod, { wasm: tapeMod, parse }, { name, every: t.every, big: t.big }, { window: t.window, queryWindow: t.window, pageBytes: t.pageBytes });
  d.step(Infinity);
  return d;
};

/**
 * Everything the views can ask, as text lines: the summary, every page down to depth 5, every pretty and raw line,
 * locate at `at`. (Pretty lines apart: a broken document's run a value past its last checkpoint before the error,
 * which isn't at the same place in an edited one and a fresh one.)
 */
export function dump(d: HugeDoc, at: number[]): { out: string[]; pretty: string[] } {
  const out: string[] = [];
  const pretty: string[] = [];
  const s = d.summary();
  const { size, done, records, multi, jsonl, nodes, depth, lines, prettyLines, error, status, warnings, moreWarnings } = s;
  out.push(JSON.stringify({ size, done, records, multi, jsonl, nodes, depth, lines, prettyLines, error, status, warnings, moreWarnings }));
  const node = (n: HugeNode | null) => (n ? JSON.stringify([n.kind, n.start, n.end, n.depth, n.key, n.count, !!n.partial, n.pretty, n.prettyLines, n.preview ?? null]) : 'null');
  out.push('root ' + node(s.root));
  const walk = (n: HugeNode, d0: number) => {
    for (let from = 0; ; ) {
      const page = d.children(n, from, 5);
      const view = new PageNodes(page);
      for (const k of view.children) {
        const stub = view.stub(k);
        out.push(`${d0} ${from} ${JSON.stringify(k.key ?? null)} ${JSON.stringify(view.span(k))} ` + (stub ? 'stub ' + node(stub) : writeTape(view.tape, page.text, k.zi!, '')));
        if (stub && stub.kind >= 4 && d0 < 5) walk(stub, d0 + 1);
      }
      if (!page.more || !page.count) break;
      from += page.count;
    }
  };
  if (s.root && s.root.kind >= 4) walk(s.root, 0);
  for (let from = 0; from < s.prettyLines; ) {
    const p = d.prettyLines(from, 40, '  ', 1 << 20);
    if (!p.text.length) break;
    // (A line's close is given when the stretch it's in holds it: where stretches end differs, prettyClose doesn't.)
    for (let j = 0; j < p.text.length; j++) pretty.push(`p${from + j} ${p.text[j]} ${p.depth![j]} ${p.kind![j]} ${p.kind![j] === 1 ? d.prettyClose(from + j) : -1} ${p.pos[j]}`);
    from += p.text.length;
  }
  for (let from = 0; from < s.lines; ) {
    const p = d.rawLines(from, 40, 1 << 20);
    if (!p.text.length) break;
    for (let j = 0; j < p.text.length; j++) out.push(`r${from + j} ${p.text[j]}`);
    from += p.text.length;
  }
  for (const p of at) {
    const l = d.locate(p);
    out.push(`at ${p} ` + (l ? JSON.stringify({ path: l.path, node: [l.node.start, l.node.end, l.node.kind, l.node.count], index: l.index, chain: l.chain.map((c) => [c.node.start, c.node.kind, c.node.count, c.index]), line: l.line, col: l.col }) : 'null'));
  }
  return { out, pretty };
}

