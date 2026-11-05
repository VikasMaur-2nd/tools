/** Shared by the huge stream tests: documents, the normal path's parse of them, a walk in random chunks. */
import { parse, type ParseResult } from '../lib/json/parser';
import { Walker, type Visitor } from '../lib/huge/stream/walk';
import { genStrict } from './oracle/tape';
import type { Rng } from './oracle/compare';
import { pageText } from './huge-oracle';

/** A strict document: random, records as JSON Lines or an array, or records under a key. */
export function docOf(r: Rng): { doc: string; name: string } {
  const k = r.int(4);
  if (k === 0) return { doc: genStrict(r, 5), name: 'a.json' };
  const rec = () => {
    const long = r.chance(0.1) ? '"' + 'é'.repeat(50 + r.int(400)) + '"' : '"s' + r.int(100) + '"';
    return genStrict(r, 2).trim() ? `{"id": ${r.int(1000)}, "v": ${long}, "x": ${genStrict(r, 2).trim()}}` : '{}';
  };
  const n = 1 + r.int(30);
  const recs = Array.from({ length: n }, rec);
  if (k === 1) return { doc: recs.join(r.chance(0.2) ? ' , ' : '\n') + (r.chance(0.5) ? '\n' : ''), name: r.chance(0.5) ? 'a.jsonl' : 'a.json' };
  if (k === 2) return { doc: '[\n' + recs.join(',\n') + '\n]', name: 'a.json' };
  return { doc: '{"meta": {"n": ' + n + '}, "records": [' + recs.join(',') + '], "tail": "' + 'x'.repeat(r.int(600)) + '"}', name: 'a.json' };
}

/** The normal path's parse of a file's bytes (null if it has a problem the huge index reports: commands refuse those). */
export function normal(bytes: Uint8Array, name: string): { text: string; res: ParseResult } | null {
  const text = pageText(bytes);
  const res = parse(text, { lines: /\.(jsonl|ndjson)$/i.test(name) });
  if (res.error || !res.root || res.issues.some((x) => x.m !== 'Multiple top-level values (wrapped in an array)')) return null;
  return { text, res };
}

/** Feeds `bytes` to a walker over `v` in random chunks (1 to `max` bytes), pausing now and then. */
export function walkAll(r: Rng, bytes: Uint8Array, v: Visitor, multi: boolean, max = 64, keep?: number, parts = false): Walker {
  // (Strings are read a slice at a time: small slices now and then, so that path is walked too.)
  const w = new Walker(v, { multi, keep, parts, slice: r.chance(0.4) ? 1 + r.int(8) : undefined });
  let at = 0;
  while (at < bytes.length) {
    const len = 1 + r.int(max);
    const b = bytes.slice(at, at + len);
    let i = 0;
    // (A pause now and then, as output pressure makes one.)
    while (i < b.length) {
      if (r.chance(0.05)) w.pause = true;
      i = w.feed(b, at, i);
    }
    at += b.length;
  }
  w.finish(bytes.length);
  return w;
}

