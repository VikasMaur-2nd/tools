import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { asciiCells, asciiRows, leadOf } from '../lib/engine/wrap';
import { highlightLine, stringState } from '../lib/engine/highlight';

describe('soft wrap arithmetic', () => {
  test('printable ASCII takes one cell per character', () => {
    assert.equal(asciiCells('  "a": 1', 0, 8), 8);
    assert.equal(asciiCells('x{"k":"v"}y', 1, 10), 9);
  });

  test('leading tabs indent to the next tab stop', () => {
    assert.deepEqual(leadOf('\t\tx', 0, 3), [8, 2]);
    assert.deepEqual(leadOf('  \tx', 0, 4), [4, 3]);
    assert.equal(asciiCells('\t"a"', 0, 4), 7);
  });

  test('anything else is for the browser to size', () => {
    for (const s of ['"é"', '"中"', '"😀"', 'a\tb', 'a\u0001b', '" "']) assert.equal(asciiCells(s, 0, s.length), -1, s);
  });

  test('rows: full rows plus the rest, at least one', () => {
    assert.equal(asciiRows(0, 80), 1);
    assert.equal(asciiRows(80, 80), 1);
    assert.equal(asciiRows(81, 80), 2);
    assert.equal(asciiRows(800, 80), 10);
  });
});

describe('rows that start inside a string', () => {
  test('stringState follows quotes and escapes', () => {
    const t = '{"a": "x\\"y", "b": 1}';
    assert.equal(stringState(t, 0, 0), 0);
    assert.equal(stringState(t, 0, 2), 1);
    assert.equal(stringState(t, 0, 4), 0);
    assert.equal(stringState(t, 0, 9), 3);
    assert.equal(stringState(t, 0, 10), 1);
    assert.equal(stringState(t, 0, 12), 0);
    assert.equal(stringState(t, 4, 9, 0), stringState(t, 0, 9));
  });

  test('a row that continues a string highlights its rest as a string', () => {
    const t = '"hello world", 1';
    const html = highlightLine(t, 7, t.length, null, true, 1);
    assert.match(html, /^<span class="ts">world&quot;<\/span>/);
    assert.match(html, /<span class="tn">1<\/span>/);
  });

  test('a continued key keeps the key colour', () => {
    const t = '"long key": 1';
    assert.match(highlightLine(t, 6, t.length, null, true, 1), /^<span class="tk">key&quot;<\/span>/);
  });

  test('an escape pending at the row start is skipped', () => {
    const t = '"a\\"b" 2';
    assert.match(highlightLine(t, 3, t.length, null, true, 3), /^<span class="ts">&quot;b&quot;<\/span>/);
  });
});
