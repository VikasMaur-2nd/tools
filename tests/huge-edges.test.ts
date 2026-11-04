/**
 * Huge-file mode at the edges: a document broken at every byte (each error class at each window offset),
 * deep nesting up to and past parser.ts MAX_DEPTH, a very wide object (the duplicate check's table and cap),
 * strings, escapes, surrogate pairs and \r\n cut by every window edge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH } from '../lib/json/parser';
import { PageNodes } from '../lib/huge/page';
import { enc, hugeOf, normalStatus } from './huge-oracle';

const same = (bytes: Uint8Array, name: string, window: number, every: number, big = 48) => {
  const want = normalStatus(bytes, name);
  const got = hugeOf(bytes, { name, every, big }, { window, queryWindow: window }).error;
  const doc = JSON.stringify(new TextDecoder().decode(bytes));
  if (!want) return assert.equal(got, null, `${doc} window ${window}`);
  assert.ok(got, `nothing found: ${doc} want ${JSON.stringify(want)} window ${window}`);
  assert.deepEqual([got!.msg, got!.line, got!.col], [want.msg, want.line, want.col], `${doc} window ${window} every ${every}`);
};

test('a document broken at every byte: deleted, doubled, or replaced by each kind of wrong', () => {
  const doc = '{"name": "é 中 😀 \\u00e9 \\ud83d\\ude00 \\\\ \\"",\r\n "n": [-1.5e3, 0, true, false, null],\r\n "o": {"a": [], "b": {}}}\n';
  const base = enc.encode(doc);
  const repl = ['', 'x', ',', ']', '}', '"', '\\', '\n', '\x01', ' ', '0', '{', '/'];
  for (let i = 0; i <= base.length; i++) {
    for (const r of repl) {
      const s = new Uint8Array([...base.subarray(0, i), ...enc.encode(r), ...base.subarray(r === '' || r === 'x' ? i + 1 : i)]);
      for (const window of [64, 128]) same(s, 'a.json', window, 64);
    }
  }
});

test('every window edge inside strings, escapes, surrogate pairs, multi-byte characters and \\r\\n', () => {
  const unit = '"a\\"b\\\\c\\u00e9\\ud83d\\ude00é中😀",\r\n';
  for (let pad = 0; pad < 70; pad++) {
    const doc = '[' + ' '.repeat(pad) + unit.repeat(6) + '1]';
    same(enc.encode(doc), 'a.json', 64, 64);
    // And broken at the end of the cut string (unterminated), and with a raw control character in it.
    same(enc.encode('[' + ' '.repeat(pad) + unit.repeat(3) + '"abc\\u00'), 'a.json', 64, 64);
    same(enc.encode('[' + ' '.repeat(pad) + unit.repeat(2) + '"ab\tc"]'), 'a.json', 64, 64);
  }
});

test('deep nesting: 5,000 levels browse; past MAX_DEPTH the normal path\'s error', () => {
  const deep = '['.repeat(5000) + '1' + ']'.repeat(5000);
  const d = hugeOf(enc.encode(deep), { name: 'a.json', every: 256, big: 1024 }, { window: 256, queryWindow: 256 });
  const s = d.summary();
  assert.equal(s.error, null);
  assert.equal(s.depth, 5000);
  const loc = d.locate(5000);
  assert.equal(loc!.path.length, 5000);
  assert.equal(d.prettyLines(5000, 1, ' ', 1 << 20).text[0], ' '.repeat(5000) + '1');
  const page = d.children(s.root!, 0, 1);
  assert.equal(page.count, 1);
  // Past the limit (the worker's MAX_DEPTH): the normal path's message and place.
  const over = '['.repeat(MAX_DEPTH + 1) + '1' + ']'.repeat(MAX_DEPTH + 1);
  same(enc.encode(over), 'a.json', 1 << 16, 1 << 16);
});

test('a wide object: 150,000 members paged and found by name; duplicates past the 16-name list and the 4,096 cap', () => {
  const n = 150_000;
  const members: string[] = [];
  for (let i = 0; i < n; i++) members.push(`"k${i}": ${i}`);
  // Duplicates: of an early name late (in the table), and of a name past the cap (not remembered: unchecked).
  members.push('"k3": "again"', `"k${n - 1}": "again"`);
  const bytes = enc.encode('{' + members.join(',') + '}');
  const d = hugeOf(bytes, { name: 'a.json', every: 1 << 14, big: 1 << 12 });
  const s = d.summary();
  assert.equal(s.error, null);
  assert.equal(s.root!.count, n + 2);
  assert.deepEqual(s.warnings.map((w) => w.msg), ['Duplicate key "k3"']);
  assert.ok(s.unchecked >= n - 4096);
  const page = d.children(s.root!, 100_000, 3);
  assert.deepEqual(new PageNodes(page).children.map((c) => c.key), ['k100000', 'k100001', 'k100002']);
  const at = d.resolve(['k123456']);
  assert.equal(new TextDecoder().decode(bytes.subarray(at!.node.start, at!.node.end)), '123456');
  // The first member with a name wins (path.ts resolve).
  assert.equal(new TextDecoder().decode(bytes.subarray(d.resolve(['k3'])!.node.start, d.resolve(['k3'])!.node.end)), '3');
});
