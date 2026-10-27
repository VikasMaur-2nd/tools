import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DEPTH } from '../lib/json/parser';
import { parse, type TapeOptions } from '../lib/json/tape-parser';
import { wasmTape } from '../lib/json/tape-wasm';
import { TRIM_MAX, W, sizeOf, type Tape } from '../lib/json/tape';
import { genLoose, mutate, rng, type Rng } from './oracle/compare';
import { CORPUS, FIXTURES, diffTape, files, genStrict, loosen } from './oracle/tape';

// FUZZ_SEED / FUZZ_SCALE as in the other parser tests; `pnpm test --slow` runs 50x more and the big corpora.
const SEED = Number(process.env.FUZZ_SEED) || 0;
const SLOW = !!process.env.TEST_SLOW;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (SLOW ? 50 : 1);
const cases = (k: number) => Math.round(k * SCALE);

/** The committed build (`pnpm wasm` makes it from lib/json/wasm). */
const mod = new WebAssembly.Module(readFileSync(join(__dirname, '..', '..', 'lib', 'json', 'tape.wasm')));
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const show = (s: string) => {
  const j = JSON.stringify(s.length > 300 ? s.slice(0, 300) : s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > 300 ? `${j}… (${s.length} chars)` : j;
};

/** Strict JSON with one top-level value: what the Wasm parser takes. */
const strictOf = (t: Tape) => t.count > 0 && !t.head.issues.length && !t.head.error && !t.head.multi;

/** From a JS string, a name with U+FFFD or a lone surrogate can't be told from another (encodeInto makes both U+FFFD): it may refuse those. */
const mayRefuse = (t: Tape) => t.keys.some((k) => /[�\ud800-\udfff]/.test(k));

interface Check {
  /** Give it the UTF-8 bytes (and the text decoded from them) instead of the text. */
  bytes?: boolean;
  window?: number;
  options?: TapeOptions;
}

/** The Wasm parser gives the JS tape parser's tape, or null where that one finds anything not strict. */
function same(src: string, { bytes = false, window, options = {} }: Check = {}): 'strict' | 'not strict' | 'refused' {
  let b: Uint8Array | undefined;
  if (bytes) {
    b = encoder.encode(src);
    // (What a page has from a file: the text decoded from its bytes.)
    src = new TextDecoder().decode(b);
  }
  const js = parse(src, options);
  const w = wasmTape(mod, src, options, b, window);
  const where = `\ninput: ${show(src)} ${JSON.stringify({ bytes, window, options })}`;
  if (!strictOf(js) || options.lines) {
    assert.equal(w, null, `Wasm took what isn't strict JSON${where}`);
    return 'not strict';
  }
  if (!w) {
    if (!bytes && mayRefuse(js)) return 'refused';
    assert.fail(`Wasm refused strict JSON${where}`);
  }
  const d = diffTape(js, w, src);
  if (d) assert.fail(`Wasm differs: ${d}${where}`);
  assert.ok(w.nodes.length >= w.count * W);
  assert.equal(w.extra, null);
  assert.deepEqual(w.big ? [...w.big] : [], js.big ? [...js.big] : []);
  return 'strict';
}

/** Every way: text and bytes, the default window and a few small ones (tokens cut at every place). */
function everyWay(src: string, windows = [64, 100, 257], options: TapeOptions = {}) {
  for (const bytes of [false, true]) {
    same(src, { bytes, options });
    for (const window of windows) same(src, { bytes, window, options });
  }
}

/** A strict document whose names are written several ways: escaped and not, pairs, lone surrogates, duplicates. */
function genNames(r: Rng): string {
  const NAMES = ['A', '\\u0041', 'é', '\\u00e9', '\\u00E9', '😀', '\\ud83d\\ude00', '\\uD83D\\uDE00', '\\ud800', '\\udc00', 'a\\nb', 'a\\\\nb', '\\/', '/', 'x', 'id', '0', '7', '\\u0037', '12', '012'];
  const obj = (d: number): string => {
    const n = r.chance(0.2) ? 17 + r.int(20) : 1 + r.int(6);
    const parts: string[] = [];
    for (let k = 0; k < n; k++) {
      const v = d < 3 && r.chance(0.25) ? obj(d + 1) : r.pick(['1', '"s"', 'null', '[1,2]', '{}', '1.5', '"\\n"']);
      parts.push(`"${r.pick(NAMES)}${r.chance(0.3) ? r.pick(NAMES) : ''}":${v}`);
    }
    return '{' + parts.join(',') + '}';
  };
  return r.chance(0.5) ? obj(0) : '[' + Array.from({ length: 1 + r.int(5) }, () => obj(0)).join(',') + ']';
}

describe('Wasm tape parser: the JS tape parser\'s tape, or null', () => {
  test('small documents, strict and not, through windows of every size', () => {
    const docs = [
      '1',
      '-0',
      '"a"',
      'true',
      'null',
      '[]',
      '{}',
      ' [ ] ',
      '[1,2,3]',
      '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
      '{"a":1,"a":2}',
      '{"a":{"a":1},"a":2}',
      '{"0":1,"1":2}',
      '{"a\\n":1}',
      '"\\u0041\\n\\ud800"',
      '[1e5, -0, 0.5, 1.50, 0.0000001, 12345678901234567, 1E+2, 2e-1]',
      '{"é":"ü","😀":["中文"]}',
      '\n\t{\r\n "a" : [ 1 , 2 ] }\n',
      // Not strict: refused.
      '',
      '  ',
      '[1,]',
      '{"a":1,}',
      '[01]',
      '[1.]',
      '[.5]',
      '[+1]',
      '[-]',
      '[1e]',
      '[truex]',
      '[nul]',
      '["a\tb"]',
      '["\\x41"]',
      '["\\u12"]',
      '{"a" 1}',
      '{a:1}',
      "{'a':1}",
      '[1 2]',
      '1 2',
      '1\n2',
      '[1] x',
      '﻿[1]',
      '// c\n1',
      '[1',
      '{"a":',
      '"abc',
      '[NaN]',
      '{"a":1}}',
    ];
    for (const src of docs) everyWay(src);
    for (const src of ['[1]', '{"a":1}']) assert.equal(wasmTape(mod, src, { lines: true }), null);
  });

  test(`strict documents, and strict ones broken in a few places (${cases(4000)} cases, random windows)`, () => {
    const r = rng((SEED || 1) + 11);
    let strict = 0;
    for (let it = 0, total = cases(4000); it < total; it++) {
      let src = genStrict(r, 1 + r.int(7));
      if (r.chance(0.4)) src = loosen(r, src);
      const window = r.chance(0.3) ? undefined : 64 + r.int(400);
      try {
        if (same(src, { bytes: r.chance(0.5), window }) === 'strict') strict++;
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
    }
    assert.ok(strict > cases(1500), `strict: ${strict}`);
  });

  test(`loose and broken documents are refused (${cases(4000)} cases)`, () => {
    const r = rng((SEED || 1) + 12);
    for (let it = 0, total = cases(4000); it < total; it++) {
      let src = genLoose(r, 1 + r.int(5));
      if (r.chance(0.4)) src = mutate(r, src);
      try {
        same(src, { bytes: r.chance(0.5), window: r.chance(0.5) ? undefined : 64 + r.int(200) });
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
    }
  });

  test(`names written several ways: escapes, pairs, lone surrogates, duplicates in wide and nested objects (${cases(3000)} cases)`, () => {
    const r = rng((SEED || 1) + 13);
    let dups = 0;
    for (let it = 0, total = cases(3000); it < total; it++) {
      const src = genNames(r);
      try {
        same(src, { bytes: r.chance(0.5), window: r.chance(0.5) ? undefined : 64 + r.int(300) });
      } catch (e) {
        throw new Error(`iteration ${it}: ${(e as Error).message}`, { cause: e });
      }
      if (parse(src).head.warnings.length) dups++;
    }
    assert.ok(dups > cases(500), `documents with duplicates: ${dups}`);
    // More than 500 duplicates: the same first 500 warnings.
    everyWay('{' + Array.from({ length: 1200 }, (_, k) => `"k${k % 300}": ${k}`).join(',') + '}', [4096]);
  });

  test('every truncation and every byte of small documents', () => {
    const r = rng((SEED || 1) + 14);
    const docs = ['{"a":[1,2.5e3,"x\\ny",true,null],"b":{"c":"d","e":[]},"f":{}}', '[{"id":1,"name":"é😀"},{"id":2,"name":"b","id":3}]'];
    for (let k = 0; k < cases(20); k++) docs.push(genStrict(r, 4));
    for (const doc of docs) {
      for (let p = 0; p <= doc.length; p++) same(doc.slice(0, p), { bytes: p % 2 === 0, window: 64 + (p % 7) });
      for (let p = 0; p < doc.length; p++) same(doc.slice(0, p) + doc.slice(p + 1), { bytes: p % 2 === 1 });
    }
  });

  test('UTF-8 from bytes: valid sequences are read, invalid ones refused', () => {
    const r = rng((SEED || 1) + 15);
    const SEQS = [
      [0xc3, 0xa9],
      [0xe4, 0xb8, 0xad],
      [0xf0, 0x9f, 0x98, 0x80],
      [0xef, 0xbf, 0xbd],
      [0xc0, 0x80], // overlong
      [0xe0, 0x80, 0xaf], // overlong
      [0xed, 0xa0, 0x80], // surrogate
      [0xf4, 0x90, 0x80, 0x80], // > U+10FFFF
      [0xc3], // cut
      [0xe4, 0xb8],
      [0x80], // lone continuation
      [0xff],
      [0xf8, 0x88, 0x80, 0x80, 0x80],
    ];
    let valid = 0;
    let invalid = 0;
    for (let it = 0; it < cases(3000); it++) {
      const parts: number[] = [];
      const str = () => {
        parts.push(0x22);
        for (let k = r.int(4); k > 0; k--) {
          if (r.chance(0.5)) parts.push(...r.pick(SEQS));
          else parts.push(0x61 + r.int(26));
        }
        parts.push(0x22);
      };
      parts.push(0x7b);
      for (let k = 1 + r.int(4); k > 0; k--) {
        str();
        parts.push(0x3a);
        str();
        if (k > 1) parts.push(0x2c);
      }
      parts.push(0x7d);
      const bytes = new Uint8Array(parts);
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        invalid++;
        assert.equal(wasmTape(mod, new TextDecoder().decode(bytes), {}, bytes, r.chance(0.5) ? 64 : undefined), null, `invalid UTF-8 taken: ${[...bytes]}`);
        continue;
      }
      valid++;
      const js = parse(text);
      const w = wasmTape(mod, text, {}, bytes, r.chance(0.5) ? 64 : undefined);
      assert.ok(w, `valid UTF-8 refused: ${show(text)}`);
      assert.equal(diffTape(js, w, text), null);
    }
    assert.ok(valid > cases(300) && invalid > cases(300), `valid ${valid}, invalid ${invalid}`);
  });

  test('tokens longer than the window (it grows), and windows ending in a surrogate pair', () => {
    everyWay('["' + 'x'.repeat(10_000) + '"]', [64]);
    everyWay('{"' + 'k'.repeat(5000) + '":' + '1'.repeat(3000) + '}', [64]);
    everyWay('[' + '"😀",'.repeat(200) + '1]', [64, 65, 66, 67]);
    everyWay('[' + '"é",'.repeat(300) + '"\\ud83d\\ude00"]', [64, 65]);
  });

  test('deep documents: MAX_DEPTH as the JS parser, and deeper without a limit', () => {
    for (const levels of [MAX_DEPTH, MAX_DEPTH + 1]) {
      const options = { maxDepth: MAX_DEPTH };
      same('['.repeat(levels) + ']'.repeat(levels), { options });
      same('{"a":'.repeat(levels) + '1' + '}'.repeat(levels), { options, bytes: true });
    }
    const levels = 1_000_000;
    same('['.repeat(levels) + '1' + ']'.repeat(levels));
  });

  test('a tape of up to TRIM_MAX bytes keeps no room to grow; a bigger one keeps it (no copy)', () => {
    const r = rng((SEED || 1) + 41);
    for (let it = 0; it < cases(300); it++) {
      const src = genStrict(r, 5);
      const t = wasmTape(mod, src, {}, r.chance(0.5) ? encoder.encode(src) : undefined);
      assert.ok(t, show(src));
      assert.equal(t.nodes.length, t.count * W, show(src));
    }
    for (const n of [1, 2, 4095, 4096, 4097, 9000, 100_000, 400_000]) {
      const t = wasmTape(mod, '[' + '0,'.repeat(n - 1) + '0]')!;
      assert.equal(t.count, n + 1);
      assert.equal(t.nodes.length, t.count * W);
    }
    const n = Math.ceil(TRIM_MAX / 4 / W) + 1000;
    const big = wasmTape(mod, '[' + '0,'.repeat(n - 2) + '0]')!;
    assert.equal(big.count, n);
    assert.ok(big.nodes.length > big.count * W, `${big.nodes.length} for ${big.count} nodes`);
  });

  test('JSONTestSuite, the simdjson corpus and the harness fixtures (where present)', (t) => {
    const suite = files(join(CORPUS, 'jts'), (f) => f.endsWith('.json'));
    const simd = files(join(CORPUS, 'simd'), (f) => f.endsWith('.json'));
    const fixtures = files(FIXTURES, (f) => /\.(json|jsonl|ndjson|txt)$/.test(f));
    if (!suite.length && !simd.length && !fixtures.length) return t.skip('no corpus on this host');
    let count = 0;
    for (const f of [...suite, ...simd, ...fixtures]) {
      const size = statSync(f).size;
      if (!SLOW && size > 2_000_000) continue;
      const bytes = new Uint8Array(readFileSync(f));
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        // Not UTF-8: refused from bytes.
        assert.equal(wasmTape(mod, new TextDecoder().decode(bytes), {}, bytes), null, f);
        continue;
      }
      same(text);
      same(text, { bytes: true });
      if (size < 20_000) same(text, { window: 64 });
      else if (SLOW || size < 500_000) same(text, { bytes: true, window: 4096 });
      count++;
    }
    assert.ok(count > 300, `files: ${count}`);
  });

  test('sizes too big for a node (slow)', { skip: !SLOW && 'pnpm test --slow' }, () => {
    const n = 0x1000010;
    const src = '[' + '0,'.repeat(n) + '0]';
    const js = parse(src);
    const w = wasmTape(mod, src)!;
    assert.equal(w.count, js.count);
    assert.equal(sizeOf(w, 0), n + 2);
    assert.deepEqual([...w.big!], [...js.big!]);
  });
});
