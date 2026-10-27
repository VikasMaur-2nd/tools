import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DEPTH } from '../lib/json/parser';
import { parse, type TapeOptions } from '../lib/json/tape-parser';
import { wasmTape } from '../lib/json/tape-wasm';
import { TRIM_MAX, W, sizeOf, type Tape } from '../lib/json/tape';
import { genLoose, mutate, rng, type Rng } from './oracle/compare';
import { lf } from '../lib/engine/doc';
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
/** Whether this engine lets WebAssembly read a string (JS String Builtins): text with characters beyond ASCII then goes as UTF-16 units. */
const WIDE = (() => {
  // (A module importing wasm:js-string length and nothing else.)
  const bin = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 111, 1, 127, 2, 25, 1, 14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0]);
  try {
    new WebAssembly.Instance(new (WebAssembly.Module as unknown as new (b: BufferSource, o: object) => WebAssembly.Module)(bin, { builtins: ['js-string'] }), {});
    return true;
  } catch {
    return false;
  }
})();

const show = (s: string) => {
  const j = JSON.stringify(s.length > 300 ? s.slice(0, 300) : s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s.length > 300 ? `${j}… (${s.length} chars)` : j;
};

/** Strict JSON with one top-level value: what the Wasm parser takes. */
const strictOf = (t: Tape) => t.count > 0 && !t.head.issues.length && !t.head.error && !t.head.multi;

/** From a JS string encoded to UTF-8, a name with U+FFFD or a lone surrogate can't be told from another (encodeInto makes both U+FFFD): it may refuse those. */
const mayRefuse = (t: Tape) => t.keys.some((k) => /[�\ud800-\udfff]/.test(k));

interface Check {
  /** Give it the UTF-8 bytes (and the text decoded from them) instead of the text: whole, or read a window at a time ('read'). */
  bytes?: boolean | 'read';
  window?: number;
  options?: TapeOptions;
  /** Text: false to encode it to UTF-8 where it would go as UTF-16 units (wasmTape's `units`). */
  units?: boolean;
}

/** The Wasm parser gives the JS tape parser's tape, or null where that one finds anything not strict. */
function same(src: string, { bytes = false, window, options = {}, units = true }: Check = {}): 'strict' | 'not strict' | 'refused' {
  let b: Uint8Array | undefined;
  if (bytes) {
    b = encoder.encode(src);
    // (What a page has from a file: the text decoded from its bytes, line ends as \n.)
    src = lf(new TextDecoder().decode(b));
  }
  const js = parse(src, options);
  const w = wasmTape(mod, src, options, bytes === 'read' ? { size: b!.length, read: (at, len) => b!.slice(at, at + len) } : b, window, units);
  const where = `\ninput: ${show(src)} ${JSON.stringify({ bytes, window, options, units })}`;
  if (!strictOf(js) || options.lines) {
    assert.equal(w, null, `Wasm took what isn't strict JSON${where}`);
    return 'not strict';
  }
  if (!w) {
    // (As UTF-16 units, names are read as they are: none refused.)
    if (!bytes && mayRefuse(js) && !(units && WIDE && /[^\0-\x7f]/.test(src.slice(0, 4096)))) return 'refused';
    assert.fail(`Wasm refused strict JSON${where}`);
  }
  const d = diffTape(js, w, src);
  if (d) assert.fail(`Wasm differs: ${d}${where}`);
  assert.ok(w.nodes.length >= w.count * W);
  assert.equal(w.extra, null);
  assert.deepEqual(w.big ? [...w.big] : [], js.big ? [...js.big] : []);
  return 'strict';
}

/** A way in at random: bytes, or text as UTF-16 units or encoded. */
const way = (r: Rng): Check => (r.chance(0.5) ? { bytes: true } : { units: r.chance(0.5) });

/** Every way: text (as UTF-16 units and encoded) and bytes, the default window and a few small ones (tokens cut at every place). */
function everyWay(src: string, windows = [64, 100, 257], options: TapeOptions = {}) {
  for (const [bytes, units] of [[false, true], [false, false], [true, true], ['read', true]] as const) {
    same(src, { bytes, options, units });
    for (const window of windows) same(src, { bytes, window, options, units });
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
        if (same(src, { ...way(r), window }) === 'strict') strict++;
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
        same(src, { ...way(r), window: r.chance(0.5) ? undefined : 64 + r.int(200) });
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
        same(src, { ...way(r), window: r.chance(0.5) ? undefined : 64 + r.int(300) });
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
      for (let p = 0; p <= doc.length; p++) same(doc.slice(0, p), { bytes: p % 2 === 0, units: p % 4 === 1, window: 64 + (p % 7) });
      for (let p = 0; p < doc.length; p++) same(doc.slice(0, p) + doc.slice(p + 1), { bytes: p % 2 === 1, units: p % 4 === 0 });
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

  test(`text as UTF-16 units: names beyond ASCII, raw or escaped, lone surrogates and pairs split across escapes, every window (${cases(1500)} cases)`, (t) => {
    if (!WIDE) return t.skip('no JS String Builtins in this engine');
    const r = rng((SEED || 1) + 23);
    // Raw (as the text has them: lone surrogates too) and escaped.
    const PIECES = ['a', 'A', 'é', 'ÿ', 'Ā', '東', '😀', '\ud83d', '\ude00', '\ud800', '\udc00', '�', '\\u00e9', '\\u00E9', '\\ud83d\\ude00', '\\uD83D', '\\uDE00', '\\ud800', '\\n', '\\\\', '\\"', '\\u0041', '\\u00ff', '\\u0100', '\\/'];
    const piece = () => r.pick(PIECES);
    let strict = 0;
    for (let it = 0; it < cases(1500); it++) {
      const name = () => Array.from({ length: 1 + r.int(3) }, piece).join('');
      const obj = (d: number): string => {
        const parts: string[] = [];
        for (let k = 1 + r.int(5); k > 0; k--) parts.push(`"${name()}":${d < 2 && r.chance(0.3) ? obj(d + 1) : `"${name()}"`}`);
        return '{' + parts.join(r.pick([',', ', ', ',\n '])) + '}';
      };
      // (Starting beyond ASCII, so the text goes as units from its first window.)
      const doc = `{"é":0,"l":[${Array.from({ length: 1 + r.int(4) }, () => obj(0)).join(',')}]}`;
      for (const window of [undefined, 64, 100, 257]) {
        const res = same(doc, { window });
        // (Names that encoding can't tell apart are read as they are.)
        assert.equal(res, 'strict', `refused as units: ${show(doc)}`);
        strict++;
      }
    }
    assert.ok(strict > 0);
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

  test(`from bytes, \\r\\n is one unit and a lone \\r one, as in the LF text the page keeps: every window (${cases(1500)} cases)`, () => {
    // (BREAKER-REPORT F16: offsets must be the editor's. From text, the text's own line ends count.)
    const r = rng((SEED || 1) + 51);
    const ENDS = ['\r\n', '\r', '\n', '\r\r\n', '\n\r', '\r\n\r\n'];
    for (let it = 0; it < cases(1500); it++) {
      const doc = JSON.stringify(JSON.parse(genStrict(r, 4)), null, r.pick([1, 2, '\t']));
      const end = r.chance(0.5) ? r.pick(ENDS) : '';
      const src = (r.chance(0.2) ? end : '') + doc.replace(/\n/g, () => (end || r.pick(ENDS))) + (r.chance(0.3) ? r.pick(ENDS) : '');
      for (const window of [undefined, 64, 65 + r.int(100), 64 + r.int(400)]) {
        assert.equal(same(src, { bytes: r.chance(0.5) || 'read', window }), 'strict', show(src));
        same(src, { window, units: r.chance(0.5) });
      }
    }
    // A pair cut by a block (64 bytes) or a window, at every place: the \r last in one, the \n first in the next.
    for (let pad = 0; pad < 140; pad++) {
      const src = '[' + '1,'.repeat(pad >> 1) + (pad & 1 ? ' ' : '') + '\r\n"é",\r\r\n\r 2]';
      for (const window of [64, 65, 66, 128, 129]) for (const bytes of [true, 'read'] as const) assert.equal(same(src, { bytes, window }), 'strict');
    }
  });

  test('a big array of multi-byte strings with CRLF between items, from bytes: the offsets of its LF text', () => {
    // (As the breaker's 1.5 MB files: every item on its own line.)
    const r = rng(53);
    const items: string[] = [];
    for (let n = 0; n < 1_500_000; ) {
      const s = Array.from({ length: 1 + r.int(30) }, () => r.pick(['é', '東', '😀', 'a', ' ', '\\n', '\\u00e9', 'Ж'])).join('');
      items.push(`  "${s}"`);
      n += s.length + 6;
    }
    for (const eol of ['\r\n', '\r', '\n']) {
      const src = '[' + eol + items.join(',' + eol) + eol + ']' + eol;
      const b = encoder.encode(src);
      const text = lf(decoder.decode(b));
      const w = wasmTape(mod, text, {}, b)!;
      assert.ok(w, eol === '\r' ? 'CR' : eol);
      assert.equal(diffTape(parse(text), w, text), null);
    }
    const mixed = '[' + items.slice(0, 20_000).map((x, k) => x + (k % 3 === 0 ? ',\r\n' : k % 3 === 1 ? ',\r' : ',\n')).join('') + '1]';
    const b = encoder.encode(mixed);
    const text = lf(decoder.decode(b));
    assert.equal(diffTape(parse(text), wasmTape(mod, text, {}, b)!, text), null);
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
