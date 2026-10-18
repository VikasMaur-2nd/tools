import test from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../lib/engine/doc';
import { ScalarFormatter } from '../lib/json/incremental-format';
import { formatDoc, reindent } from '../lib/json/format';
import { parse } from '../lib/json/parser';
import { applyCodeChange, codeIndexer, inlineCodeIndexer } from '../lib/json/code-index';

const fixture = '{"z":[' + Array.from({ length: 80 }, (_, i) => `{"id":${i},"n":9007199254740993123456789,"n":-0,"dec":1.2300e+99,"str":"Zoë 😀 東京 \\u0061 \\n \\" \\\\ \\ud800","__proto__":false,"arr":[null,true,{},[]]}`).join(',') + '],"a":1}';

for (const indent of ['  ', '    ', '\t']) for (const minify of [false, true]) for (const sortKeys of [false, true]) for (const escape of [false, true]) {
  test(`incremental format matches full format: ${JSON.stringify({ indent, minify, sortKeys, escape })}`, () => {
    let seed = 491;
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
    const unit = minify || escape ? '' : indent;
    let input = Doc.of(fixture);
    let text = fixture;
    let output = formatDoc(text, parse(text), unit, sortKeys);
    let scalar = !sortKeys && !escape ? new ScalarFormatter(input, Doc.of(output)) : null;
    let fast = 0;
    const check = (next: Doc) => {
      const src = next.toString();
      const res = parse(src);
      const expected = res.root ? formatDoc(src, res, unit, sortKeys) : null;
      const patch = scalar?.update(next);
      if (patch) {
        fast++;
        assert.equal(patch.output.toString(), expected, `scalar result for ${src.slice(0, 100)}`);
        assert.equal(applyCodeChange(output, patch.patch, patch.change), expected);
        const index = inlineCodeIndexer(codeIndexer(output)(Infinity)!, output.length, patch.change, patch.patch)(Infinity)!;
        assert.deepEqual(index, codeIndexer(expected!)(Infinity));
        output = patch.output.toString();
      } else if (expected !== null) {
        output = expected;
        scalar = !sortKeys && !escape && !res.error && !res.issues.length && !res.multi ? new ScalarFormatter(next, Doc.of(output)) : null;
      }
      if (expected !== null) assert.equal(escape ? JSON.stringify(output) : output, escape ? JSON.stringify(expected) : expected);
      input = next;
      text = src;
    };
    for (let i = 0; i < 120; i++) {
      // Insert inside randomly chosen keys and string values. Canonicalization changes their lengths.
      const strings = [...text.matchAll(/"(?:[^"\\]|\\.)*"/g)];
      const token = strings[rnd(strings.length)];
      const at = token.index! + 1;
      const insert = ['é', '😀', '東京', '\\u0062', '\\"', '\\\\', '\\udfff', '\\t', '123'][rnd(9)];
      check(input.edit(at, at, insert));
      if (i % 8 === 0) {
        const before = input;
        // Break and repair JSON, including edits spanning tokens and containers.
        const a = rnd(text.length);
        check(input.edit(a, Math.min(text.length, a + 1 + rnd(5)), ['"', '}', '\n', '\\', ''][rnd(5)]));
        check(before);
      }
      if (i % 11 === 0) {
        const before = input;
        check(input.edit(0, 0, '/*comment*/'));
        check(before);
      }
      if (i % 17 === 0) {
        const before = input;
        check(input.edit(0, input.length, '["structural",123456789012345678901234567890,{}]'));
        check(before);
      }
    }
    if (!sortKeys && !escape) assert.ok(fast > 80, `exercised ${fast} scalar edits`);
  });
}

test('scalar formatting preserves numbers, duplicate keys, deep nesting and invalid-to-valid edits', () => {
  for (const source of ['123456789012345678901234567890', '{"a":1,"a":2}', '[1.2300e+100,-0,true,null]', '['.repeat(300) + '"😀\\ud800"' + ']'.repeat(300)]) {
    for (const indent of ['', '  ', '    ', '\t']) {
      let input = Doc.of(source);
      let output = reindent(source, indent)!;
      const scalar = new ScalarFormatter(input, Doc.of(output));
      const a = source.indexOf('1') >= 0 ? source.indexOf('1') : source.indexOf('😀');
      for (const ins of ['9', '\\', '', '😀', '']) {
        input = input.edit(a, a, ins);
        const result = scalar.update(input);
        if (result) {
          output = result.output.toString();
          assert.equal(output, formatDoc(input.toString(), parse(input.toString()), indent));
        }
      }
      assert.ok(output);
    }
  }
});

test('source checkpoints remain correct after edits on both sides and escaped token normalization', () => {
  let input = Doc.of('["\\u0061",' + '"日本語😀",'.repeat(10_000) + '90071992547409931234]');
  let output = reindent(input.toString(), '  ')!;
  const scalar = new ScalarFormatter(input, Doc.of(output));
  for (const pos of [5, 30_000, 70_000, 7, 40_000, 60_000]) {
    const at = input.indexOf('日', pos);
    input = input.edit(at, at, '\\u0062');
    const change = scalar.update(input)!;
    assert.ok(change);
    output = applyCodeChange(output, change.patch, change.change);
    assert.equal(output, formatDoc(input.toString(), parse(input.toString()), '  '));
  }
});

test('scalar append after trailing whitespace requires a full format', () => {
  const input = Doc.of('[1,2]\n');
  const scalar = new ScalarFormatter(input, Doc.of('[\n  1,\n  2\n]'));
  assert.equal(scalar.update(input.edit(input.length, input.length, '5')), null);
});

test('random scalar edits at document boundaries agree with a fresh format', () => {
  let seed = 731;
  const rnd = (n: number) => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) % n);
  for (const trailing of ['', '\n', ' \t\r\n']) for (const leading of ['', '\n \t']) {
    for (let i = 0; i < 120; i++) {
      const text = leading + ['[1,2]', '{"a":true}', '123', '"hello"', 'null'][rnd(5)] + trailing;
      const input = Doc.of(text);
      const indent = ['', '  ', '\t'][rnd(3)];
      const scalar = new ScalarFormatter(input, Doc.of(reindent(text, indent)!));
      const at = rnd(2) ? input.length : 0;
      const next = input.edit(at, Math.min(input.length, at + rnd(2)), ['5', ' ', '\n', '"', '[', ']', 'false', ''][rnd(8)]);
      const got = scalar.update(next);
      if (got) {
        const res = parse(next.toString());
        assert.equal(got.output.toString(), res.root ? formatDoc(next.toString(), res, indent) : null, next.toString());
      }
    }
  }
});
