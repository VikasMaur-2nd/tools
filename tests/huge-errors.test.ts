import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genStrict, loosen } from './oracle/tape';
import { rng } from './oracle/compare';
import { enc, hugeOf, normalStatus, pageText } from './huge-oracle';
import { parse } from '../lib/json/tape-parser';
import { MAX_DEPTH } from '../lib/json/parser';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);

const show = (s: string) => JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);

/** Line ends and a byte order mark as files have them. */
function asFile(r: ReturnType<typeof rng>, doc: string): Uint8Array {
  if (r.chance(0.3)) doc = doc.replace(/\n/g, '\r\n');
  const b = enc.encode(doc);
  if (!r.chance(0.1)) return b;
  const out = new Uint8Array(b.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(b, 3);
  return out;
}

function check(bytes: Uint8Array, name: string, every: number, big: number, window: number) {
  const want = normalStatus(bytes, name);
  const d = hugeOf(bytes, { name, every, big }, { window, queryWindow: window });
  const got = d.error;
  const where = `\ndoc: ${show(new TextDecoder().decode(bytes))}\nname ${name} every ${every} big ${big} window ${window}`;
  if (!want) {
    assert.equal(got, null, `huge found ${JSON.stringify(got)} in a valid document${where}`);
    return;
  }
  assert.ok(got, `huge found nothing; normal: ${JSON.stringify(want)}${where}`);
  assert.deepEqual({ msg: got!.msg, line: got!.line, col: got!.col }, { msg: want.msg, line: want.line, col: want.col }, `normal: ${JSON.stringify(want)}${where}`);
}

test('errors: the normal path\'s first problem, message, line and column, on broken documents', () => {
  const r = rng(SEED + 11);
  for (let k = 0; k < 1500 * SCALE; k++) {
    const doc = loosen(r, genStrict(r, 4));
    const bytes = asFile(r, doc);
    const name = r.chance(0.2) ? 'a.jsonl' : 'a.json';
    check(bytes, name, 64 + r.int(4) * 64, 32 + r.int(200), 64 * (1 + r.int(3)));
  }
});

test('errors: strict documents have none', () => {
  const r = rng(SEED + 12);
  for (let k = 0; k < 500 * SCALE; k++) {
    const bytes = asFile(r, genStrict(r, 5));
    check(bytes, 'a.json', 64, 48, 64);
  }
});

test('errors: chosen cases', () => {
  const cases = [
    '[1,2,]',
    '{"a":1,}',
    '{"a" 1}',
    '[1 2]',
    '{"a":tru}',
    '"abc',
    '[1,2',
    '{"a":[1,{"b":"x\ny"}]}',
    '[' + '1,'.repeat(200) + ']',
    '{"k":"' + 'x'.repeat(500) + '\\q"}',
    '[' + '"' + 'é'.repeat(300) + '",'.repeat(3) + ' nul]',
    '1 2 ,',
    '1,',
    '{"a":1}\n{"b":2}\n{"c":}',
    '{"a":1}\n{"b":2},\n{"c":3}',
    '[1]]',
    '{}}',
    '',
    '   ',
    '[\r\n1,\r\n2,\r\n]',
    '﻿[1,]',
    '[1,2,3' + ' '.repeat(300),
    '{"a":"\\u12"}',
    '{"a":"\\ud800"}',
    '[01]',
    '[-]',
    '[1.]',
    '[1e]',
    '{"a":1,"a":2}',
  ];
  for (const doc of cases) {
    for (const every of [64, 128, 1 << 20]) for (const window of [64, 128, 4096]) check(enc.encode(doc), 'a.json', every, 64, window);
  }
});

test('warnings: duplicate property names, as the normal path lists them (message, line, column)', () => {
  const r = rng(SEED + 13);
  for (let k = 0; k < 600 * SCALE; k++) {
    let doc = genStrict(r, 4);
    // More duplicates: objects with names from a small set, some escaped (a is "a"), some long.
    if (r.chance(0.5)) {
      const names = ['"a"', '"\\u0061"', '"b"', '"' + 'k'.repeat(70) + '"', '"é"', '"\\u00e9"'];
      const obj = () => '{' + Array.from({ length: 1 + r.int(30) }, () => r.pick(names) + ':' + r.int(9)).join(',') + '}';
      doc = '[' + Array.from({ length: 1 + r.int(6) }, obj).join(',\n') + ']';
    }
    const bytes = asFile(r, doc);
    const text = pageText(bytes);
    const t = parse(text, { maxDepth: MAX_DEPTH });
    if (t.head.error || t.head.issues.length) continue;
    const d = hugeOf(bytes, { name: 'a.json', every: 64, big: 64 }, { window: 64, queryWindow: 64 });
    const got = d.summary().warnings.map((w) => `${w.msg} ${w.line}:${w.col}`);
    const want = t.head.warnings.map((w) => {
      const nl = text.lastIndexOf('\n', w.p - 1);
      let line = 1;
      for (let i = text.indexOf('\n'); i >= 0 && i < w.p; i = text.indexOf('\n', i + 1)) line++;
      return `${w.m} ${line}:${w.p - nl}`;
    });
    assert.deepEqual(got, want, `doc: ${show(doc)}`);
  }
});
