import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { stringify } from '../lib/json/format';
import { FLAT_DEFAULTS, flatOptions, flatten, flattenSteps, pathParts, unflatten, unflattenSteps, validSep, type FlatArrays, type FlatOptions, type FlatResult, type Part, type Steps } from '../lib/convert/flat';
import { convert } from '../lib/convert';
import { TOOL_PAGE_BY_SLUG } from '../lib/tool-pages';
import { cpuNow } from './timing';

/*
 * Flatten and unflatten (lib/convert/flat.ts): golden outputs, every edge case the module comment defines, an
 * independent reference implementation written from the same rules, and the round-trip property fuzzed over
 * thousands of random documents: unflatten(flatten(x)) is x exactly when flatten doesn't warn.
 */

const doc = (text: string): JNode => {
  const r = parse(text);
  assert.ok(r.root && !r.error, `parses: ${text.slice(0, 80)}`);
  return r.root;
};
/** Compact text of a document, as written: numbers' digits, key order and duplicate keys included. */
const canon = (text: string) => stringify(doc(text), '');
const flat = (text: string, o?: Partial<FlatOptions>) => flatten(doc(text), o);
const unflat = (text: string, o?: Partial<FlatOptions>) => unflatten(doc(text), o);
const back = (text: string, o?: Partial<FlatOptions>) => {
  const f = flat(text, o);
  assert.equal(f.error, '');
  const u = unflat(f.text, o);
  return { f, u, ok: !u.error && canon(u.text) === canon(text) };
};
const lines = (...l: string[]) => l.join('\n');

// ── Golden outputs ───────────────────────────────────────────────────────────

const SAMPLE = '{"id":9007199254740993,"user":{"name":"Ada","email":null,"roles":["admin","editor"],"address":{"city":"London","zip":"N1"}},"orders":[{"sku":"A1","price":12.50,"gift":false},{"sku":"B2","price":7}],"tags":[],"meta":{}}';

test('flatten: default options (dot separator, a[0] indexes) keep every leaf, empty containers and digits', () => {
  const r = flat(SAMPLE);
  assert.deepEqual({ note: r.note, warn: r.warn, flip: r.flip, error: r.error }, { note: '', warn: false, flip: false, error: '' });
  assert.equal(
    r.text,
    lines(
      '{',
      '  "id": 9007199254740993,',
      '  "user.name": "Ada",',
      '  "user.email": null,',
      '  "user.roles[0]": "admin",',
      '  "user.roles[1]": "editor",',
      '  "user.address.city": "London",',
      '  "user.address.zip": "N1",',
      '  "orders[0].sku": "A1",',
      '  "orders[0].price": 12.50,',
      '  "orders[0].gift": false,',
      '  "orders[1].sku": "B2",',
      '  "orders[1].price": 7,',
      '  "tags": [],',
      '  "meta": {}',
      '}',
    ),
  );
  const u = unflat(r.text);
  assert.equal(u.error, '');
  assert.equal(u.note, '');
  assert.equal(canon(u.text), canon(SAMPLE));
  // Pretty, two spaces, like the input's own format.
  assert.equal(u.text, stringify(doc(SAMPLE), '  '));
});

test('flatten: separators, array styles and depth', () => {
  const x = '{"a":{"b":[1,{"c":2}],"d":{"e":true}}}';
  const cases: [Partial<FlatOptions>, string][] = [
    [{}, '{\n  "a.b[0]": 1,\n  "a.b[1].c": 2,\n  "a.d.e": true\n}'],
    [{ arrays: 'dot' }, '{\n  "a.b.0": 1,\n  "a.b.1.c": 2,\n  "a.d.e": true\n}'],
    [{ arrays: 'keep' }, '{\n  "a.b": [\n    1,\n    {\n      "c": 2\n    }\n  ],\n  "a.d.e": true\n}'],
    [{ sep: '/' }, '{\n  "a/b[0]": 1,\n  "a/b[1]/c": 2,\n  "a/d/e": true\n}'],
    [{ sep: '_', arrays: 'dot' }, '{\n  "a_b_0": 1,\n  "a_b_1_c": 2,\n  "a_d_e": true\n}'],
    [{ sep: '__' }, '{\n  "a__b[0]": 1,\n  "a__b[1]__c": 2,\n  "a__d__e": true\n}'],
    [{ sep: ' → ', arrays: 'dot' }, '{\n  "a → b → 0": 1,\n  "a → b → 1 → c": 2,\n  "a → d → e": true\n}'],
    [{ depth: 1 }, '{\n  "a.b": [\n    1,\n    {\n      "c": 2\n    }\n  ],\n  "a.d": {\n    "e": true\n  }\n}'],
    [{ depth: 2 }, '{\n  "a.b[0]": 1,\n  "a.b[1]": {\n    "c": 2\n  },\n  "a.d.e": true\n}'],
    [{ depth: 3 }, '{\n  "a.b[0]": 1,\n  "a.b[1].c": 2,\n  "a.d.e": true\n}'],
  ];
  for (const [o, want] of cases) {
    const r = flat(x, o);
    assert.equal(r.text, want, JSON.stringify(o));
    assert.equal(r.note, '', JSON.stringify(o));
    assert.ok(back(x, o).ok, JSON.stringify(o));
  }
});

test('options: defaults, and invalid separators fall back to "."', () => {
  assert.deepEqual(FLAT_DEFAULTS, { sep: '.', arrays: 'bracket', escape: true, depth: 0 });
  assert.deepEqual(flatOptions(), FLAT_DEFAULTS);
  assert.deepEqual(flatOptions({ sep: '', arrays: 'nope' as FlatArrays, escape: 'x' as unknown as boolean, depth: -3 }), { ...FLAT_DEFAULTS, escape: true });
  for (const bad of ['', 'a1', '\\', '[', ']', '.[', '123456789', 'x'.repeat(9)]) {
    assert.equal(validSep(bad), false, bad);
    assert.equal(flatOptions({ sep: bad }).sep, '.', bad);
  }
  for (const good of ['.', '/', '_', '__', ':', '->', ' ', '🔹', 'é', '"', '12345678'.replace(/\d/g, 'x')]) assert.equal(validSep(good), true, good);
  assert.equal(flat('{"a":{"b":1}}', { sep: '1' }).text, '{\n  "a.b": 1\n}');
});

// ── Roots ────────────────────────────────────────────────────────────────────

test('roots: scalars and empty containers stay as they are; a top-level array is a list of records', () => {
  for (const s of ['42', '"text"', 'null', 'true', '9007199254740993', '-0.000000000000000000001']) {
    const r = flat(s);
    assert.equal(r.text, s);
    assert.equal(r.note, 'A single value has no keys to flatten');
    assert.equal(r.warn, false);
    const u = unflat(s);
    assert.equal(u.text, s);
    assert.equal(u.note, 'A single value has no keys to unflatten');
  }
  for (const s of ['{}', '[]']) {
    assert.deepEqual(flat(s), { text: s, note: '', warn: false, flip: false, error: '' });
    assert.deepEqual(unflat(s), { text: s, note: '', warn: false, flip: false, error: '' });
  }
  const records = '[{"id":1,"address":{"city":"London"}},{"id":2,"address":{"city":"Oslo","zip":"0150"}},7,[],[1,[2]],{}]';
  const r = flat(records);
  assert.equal(r.text, lines('[', '  {', '    "id": 1,', '    "address.city": "London"', '  },', '  {', '    "id": 2,', '    "address.city": "Oslo",', '    "address.zip": "0150"', '  },', '  7,', '  [],', '  {', '    "[0]": 1,', '    "[1][0]": 2', '  },', '  {}', ']'));
  assert.ok(back(records).ok);
  for (const arrays of ['dot', 'keep'] as const) assert.ok(back(records, { arrays }).ok, arrays);
  // Keep: an item that is an array stays whole.
  assert.match(flat('[[1,2]]', { arrays: 'keep' }).text, /^\[\n {2}\[\n {4}1,/);
  // Flat records, as CSV rows with dotted columns give, unflatten one by one.
  assert.equal(canon(unflat('[{"id":1,"address.city":"London"},{"id":2,"address.city":"Oslo"},3]').text), '[{"id":1,"address":{"city":"London"}},{"id":2,"address":{"city":"Oslo"}},3]');
  // A flat object whose paths all start with an index is a top-level array (other tools write those).
  assert.equal(canon(unflat('{"[0].name":"Ada","[1].name":"Lin"}').text), '[{"name":"Ada"},{"name":"Lin"}]');
  assert.equal(canon(unflat('{"0.name":"Ada","1.name":"Lin"}', { arrays: 'dot' }).text), '[{"name":"Ada"},{"name":"Lin"}]');
});

// ── Keys that paths could misread ────────────────────────────────────────────

test('escapes: separators, brackets, backslashes and all-digit keys get a backslash, and unflatten restores them', () => {
  const x = '{"user.name":"Ada","a[0]":1,"C:\\\\temp":2,"end\\\\":{"x":3},"a]":4,"[0]":5,"":{"":6,"k":[7]}}';
  const r = flat(x);
  assert.equal(r.text, lines('{', '  "user\\\\.name": "Ada",', '  "a\\\\[0]": 1,', '  "C:\\\\\\\\temp": 2,', '  "end\\\\\\\\.x": 3,', '  "a]": 4,', '  "\\\\[0]": 5,', '  ".": 6,', '  ".k[0]": 7', '}'));
  assert.equal(r.note, 'Escaped 5 keys with a backslash so that Unflatten restores them');
  assert.equal(r.warn, false);
  assert.ok(back(x).ok);
  // Dot style: a.0 reads as an array, so an object whose keys are all digits escapes them; mixed keys need nothing.
  const d = '{"years":{"2024":1,"2025":2},"mixed":{"0":"x","k":"y"},"list":["a"],"big":{"1000000000":1}}';
  const rd = flat(d, { arrays: 'dot' });
  assert.equal(rd.text, lines('{', '  "years.\\\\2024": 1,', '  "years.\\\\2025": 2,', '  "mixed.0": "x",', '  "mixed.k": "y",', '  "list.0": "a",', '  "big.1000000000": 1', '}'));
  assert.ok(back(d, { arrays: 'dot' }).ok);
  // Bracket style needs no digit escapes: a.0 is a key, a[0] an index.
  assert.equal(flat(d).text.includes('"years.2024": 1'), true);
  assert.ok(back(d).ok);
  // Keep: brackets and digits are plain characters.
  assert.equal(flat('{"a[0]":{"0":1}}', { arrays: 'keep' }).text, '{\n  "a[0].0": 1\n}');
});

test('escapes: separators of several characters, including one that a key would complete', () => {
  const x = '{"a_":{"b":1},"c__d":{"e":2},"f___g":3,"_":{"_":4},"h":{"_i":5}}';
  const r = flat(x, { sep: '__' });
  assert.equal(r.text, lines('{', '  "a\\\\___b": 1,', '  "c\\\\__d__e": 2,', '  "f\\\\_\\\\__g": 3,', '  "\\\\___\\\\_": 4,', '  "h___i": 5', '}'));
  assert.ok(back(x, { sep: '__' }).ok);
  // (h + __ + _i reads as h, then _i: the separator is matched from the left, and _i starts no separator.)
  assert.deepEqual(pathParts('h___i', { sep: '__' }), ['h', '_i']);
  for (const sep of ['->', '::', '🔹', ' / ']) {
    const k = `{"x${sep}y":{"${sep}":{"z${sep.slice(0, 1)}":1}}}`;
    assert.ok(back(k, { sep }).ok, sep);
    assert.ok(back(k, { sep, arrays: 'dot' }).ok, sep);
  }
});

test('without escapes, keys stay as written and flatten counts the ones that would unflatten elsewhere', () => {
  const x = '{"user.name":"Ada","user":{"id":1},"plain":{"x":1},"a[0]":2,"a[x]":3,"C:\\\\temp":4}';
  const r = flat(x, { escape: false });
  assert.equal(r.text, lines('{', '  "user.name": "Ada",', '  "user.id": 1,', '  "plain.x": 1,', '  "a[0]": 2,', '  "a[x]": 3,', '  "C:\\\\temp": 4', '}'));
  assert.equal(r.note, '2 keys won\'t unflatten to the same place, such as "user.name" · Turn on Escape keys to keep them apart');
  assert.equal(r.warn, true);
  assert.equal(back(x, { escape: false }).ok, false);
  // Backslashes are plain characters both ways, so "C:\temp" comes back; "a[x]" isn't an index.
  assert.equal(back('{"C:\\\\temp":{"a[x]":1}}', { escape: false }).ok, true);
  assert.equal(flat('{"C:\\\\temp":{"a[x]":1}}', { escape: false }).note, '');
  // Dot style: an all-digit object would come back as an array.
  const d = flat('{"a":{"0":"x","1":"y"}}', { arrays: 'dot', escape: false });
  assert.equal(d.note, '2 keys won\'t unflatten to the same place, such as "a.0" · Turn on Escape keys to keep them apart');
  assert.equal(canon(unflat(d.text, { arrays: 'dot', escape: false }).text), '{"a":["x","y"]}');
  // A separator key that is the last part reads fine: only paths that read differently count.
  assert.equal(flat('{"a":{"b_":1}}', { sep: '__', escape: false }).note, '');
  assert.equal(flat('{"a_":{"b":1}}', { sep: '__', escape: false }).warn, true);
  // Unflatten without escapes keeps backslashes.
  assert.equal(canon(unflat('{"a\\\\.b":1}', { escape: false }).text), '{"a\\\\":{"b":1}}');
  assert.equal(canon(unflat('{"a\\\\.b":1}').text), '{"a.b":1}');
});

test('an array under an empty top-level key stays whole in bracket style, so it comes back', () => {
  // ("[0]" would read as a top-level array: {"":[1],"other":2} flattened to {"[0]":1,"other":2}, which unflatten refused.)
  for (const escape of [true, false]) {
    const r = flat('{"":[1,{"a":2}],"other":2}', { escape });
    assert.equal(r.text, '{\n  "": [\n    1,\n    {\n      "a": 2\n    }\n  ],\n  "other": 2\n}');
    assert.deepEqual([r.note, r.warn], ['', false]);
    assert.ok(back('{"":[1,{"a":2}],"other":2}', { escape }).ok);
  }
  assert.equal(flat('[{"":[1]},{"":[]}]').text, '[\n  {\n    "": [\n      1\n    ]\n  },\n  {\n    "": []\n  }\n]');
  // Elsewhere, or in the other styles, its items flatten as usual.
  assert.equal(flat('{"a":{"":[1]}}').text, '{\n  "a.[0]": 1\n}');
  assert.equal(flat('{"":[1]}', { arrays: 'dot' }).text, '{\n  ".0": 1\n}');
  for (const [x, o] of [['{"a":{"":[1]}}', {}], ['{"":[1]}', { arrays: 'dot' }], ['{"":[1]}', { arrays: 'keep' }], ['{"":[]}', {}], ['{"":{"a":1}}', {}], ['{"":[1],"other":2}', {}]] as const) {
    assert.equal(flat(x, o).warn, false, x);
    assert.ok(back(x, o).ok, x);
  }
});

test('the count of keys that won\'t come back is exact (every all-digit object spends unflatten\'s budget)', () => {
  // (Under a misread object, its all-digit children didn't spend the budget, so b looked like an array too.)
  const o = { arrays: 'dot', escape: false } as const;
  const x = '{"a":{"0":{"700000":1}},"b":{"600000":2}}';
  const r = flat(x, o);
  assert.equal(r.note, '1 key won\'t unflatten to the same place: "a.0.700000" · Turn on Escape keys to keep them apart');
  const u = unflat(r.text, o);
  assert.match(canon(u.text), /^\{"a":\[\[null,/);
  assert.match(canon(u.text), /"b":\{"600000":2\}\}$/);
});

test('the count is exact across records: once a record looks misread, every later one is placed by unflatten', () => {
  // (The first record's guessed gaps used up the budget, though unflatten kept "a" an object: the second record's
  // {"2":3}, which does become [null,null,3], wasn't counted.)
  const o = { arrays: 'dot', escape: false } as const;
  const x = '[{"a":{"999999":1},"a.x":2},{"2":3}]';
  const r = flat(x, o);
  assert.equal(r.note, '2 keys won\'t unflatten to the same place, such as "a.x" · Turn on Escape keys to keep them apart');
  assert.equal(canon(unflat(r.text, o).text), '[{"a":{"999999":1,"x":2}},[null,null,3]]');
});

test('sparse huge indexes: their gaps are counted, not walked', () => {
  // (Placing {"a":{"1000000":1}} visited a million empty slots: 976 steps and 130 ms for 19 bytes.)
  const o = { arrays: 'dot', escape: false } as const;
  const x = doc('{"a":{"1000000":1},"b":{"999999999":2}}');
  const t = cpuNow();
  const r = stepped(flattenSteps(x, o));
  const ms = cpuNow() - t;
  assert.equal(r.result.note, '1 key won\'t unflatten to the same place: "a.1000000" · Turn on Escape keys to keep them apart');
  assert.ok(r.count < 5, `${r.count} steps`);
  assert.ok(ms < 50, `${ms} ms of CPU time`);
});

test('messages put keys in as they are, {b} and $& included', () => {
  // (Filled one placeholder after the other, "{b}" in the first key took the second's place, and String.replace read
  // "$&" as the text it replaced.)
  assert.equal(unflat('{"{b}":1,"{b}.x":2}').error, 'Keys "{b}" and "{b}.x" conflict: one holds a value, the other goes inside it');
  assert.equal(unflat('{"$&":1,"$&.x":2}').error, 'Keys "$&" and "$&.x" conflict: one holds a value, the other goes inside it');
  assert.equal(unflat("{\"$'\":1,\"$'\":2}").error, `Keys "$'" and "$'" give the same path`);
  assert.equal(unflat('{"a[0]":1,"a.{a}":2}').error, 'Keys "a[0]" and "a.{a}" conflict: one makes an array, the other an object');
  assert.equal(flat('{"$&.{key}":{"x":1}}', { escape: false }).note, '1 key won\'t unflatten to the same place: "$&.{key}.x" · Turn on Escape keys to keep them apart');
  assert.equal(flat('{"{n}.x":{"y":1},"{n}.y":{"z":2}}', { escape: false }).note, '2 keys won\'t unflatten to the same place, such as "{n}.x.y" · Turn on Escape keys to keep them apart');
});

test('duplicate keys: flatten keeps them all and warns, unflatten names the clash', () => {
  const r = flat('{"a":1,"a":2,"b":{"c":1},"b":{"d":2}}');
  assert.equal(r.text, '{\n  "a": 1,\n  "a": 2,\n  "b.c": 1,\n  "b.d": 2\n}');
  assert.equal(r.note, "2 duplicate keys: the result won't unflatten to the same document");
  assert.equal(r.warn, true);
  const wide = `{${Array.from({ length: 20 }, (_, i) => `"k${i % 15}":${i}`).join(',')}}`;
  assert.equal(flat(wide).note, "5 duplicate keys: the result won't unflatten to the same document");
  assert.equal(unflat('{"a.b":1,"a.b":2}').error, 'Keys "a.b" and "a.b" give the same path');
});

// ── Unflatten ────────────────────────────────────────────────────────────────

test('unflatten: conflicts are errors that name both keys, never a dropped value', () => {
  const cases: [string, string, Partial<FlatOptions>?][] = [
    ['{"a":1,"a.b":2}', 'Keys "a" and "a.b" conflict: one holds a value, the other goes inside it'],
    ['{"a.b":2,"a":1}', 'Keys "a.b" and "a" conflict: one holds a value, the other goes inside it'],
    ['{"a.b.c":1,"a.b":{}}', 'Keys "a.b.c" and "a.b" conflict: one holds a value, the other goes inside it'],
    ['{"a":{},"a.b":1}', 'Keys "a" and "a.b" conflict: one holds a value, the other goes inside it'],
    ['{"tags[0]":1,"tags.name":2}', 'Keys "tags[0]" and "tags.name" conflict: one makes an array, the other an object'],
    ['{"[0]":1,"x":2}', 'Keys "[0]" and "x" conflict: one makes an array, the other an object'],
    ['{"a\\\\b":1,"a\\\\\\\\b":2}', 'Keys "a\\\\b" and "a\\\\\\\\b" give the same path'],
    ['{"a.0.x":1,"a.\\\\0.y":2,"a.0":3}', 'Keys "a.0.x" and "a.0" conflict: one holds a value, the other goes inside it', { arrays: 'dot' }],
  ];
  for (const [x, msg, o] of cases) {
    const u = unflat(x, o);
    assert.deepEqual(u, { text: '', note: '', warn: false, flip: false, error: msg }, x);
  }
  // Dot style mixes indexes and keys under one parent into an object; bracket style can't.
  assert.equal(canon(unflat('{"a.0":1,"a.x":2}', { arrays: 'dot' }).text), '{"a":{"0":1,"x":2}}');
  assert.equal(canon(unflat('{"a.0":1,"a.x":2}').text), '{"a":{"0":1,"x":2}}');
  assert.equal(unflat('{"a":1,"a.b":2,"c[0]":1,"c.d":2,"e":1,"e":2,"f":1,"f":2}').error, 'Keys "a" and "a.b" conflict: one holds a value, the other goes inside it · 3 more conflicts');
  assert.equal(unflat('{"a":1,"a.b":2,"e":1,"e":2}').error, 'Keys "a" and "a.b" conflict: one holds a value, the other goes inside it · 1 more conflict');
  // A long key is cut short in the message.
  assert.match(unflat(`{"${'k'.repeat(500)}":1,"${'k'.repeat(500)}.b":2}`).error, /^Keys "k{60}…" and "k{60}…" conflict/);
});

test('unflatten: arrays are rebuilt in index order, holes become null, sparse indexes stay keys', () => {
  assert.equal(canon(unflat('{"a[1]":"b","a[0]":"a"}').text), '{"a":["a","b"]}');
  const h = unflat('{"a[2]":1,"a[0]":0,"b[999999999]":1,"c[3]":{}}');
  assert.equal(canon(h.text), '{"a":[0,null,1],"b":{"999999999":1},"c":[null,null,null,{}]}');
  assert.equal(h.note, 'Filled 4 missing array items with null · 1 array has indexes too far apart and stays an object');
  assert.equal(h.warn, true);
  // Not indexes: leading zeros, signs, ten digits, non-digits, a bracket not closed at the end of a part.
  assert.equal(canon(unflat('{"a[01]":1,"b[-1]":2,"c[1000000000]":3,"d[x]":4,"e[0]f":5,"g[":6,"h[]":7}').text), '{"a[01]":1,"b[-1]":2,"c[1000000000]":3,"d[x]":4,"e[0]f":5,"g[":6,"h[]":7}');
  assert.equal(canon(unflat('{"a.01":1,"a.-1":2}', { arrays: 'dot' }).text), '{"a":{"01":1,"-1":2}}');
  assert.equal(canon(unflat('{"a.1":1}', { arrays: 'dot' }).text), '{"a":[null,1]}');
  // None: digits and brackets are keys.
  assert.equal(canon(unflat('{"a.0":1,"b[0]":2}', { arrays: 'keep' }).text), '{"a":{"0":1},"b[0]":2}');
  // [0][x]: the bracket that is no index starts a key.
  assert.deepEqual(pathParts('a[0][x]'), ['a', 0, '[x]']);
  assert.deepEqual(pathParts('[0][1].b[2]'), [0, 1, 'b', 2]);
  assert.deepEqual(pathParts('a.[0]'), ['a', '', 0]);
  assert.deepEqual(pathParts('a..b.'), ['a', '', 'b', '']);
  assert.deepEqual(pathParts(''), ['']);
  assert.deepEqual(pathParts('a\\.b\\\\.c\\q'), ['a.b\\', 'c\\q']);
});

test('unflatten: values that are objects or arrays stay whole, key order is first-seen order', () => {
  assert.equal(canon(unflat('{"b.x":1,"a":[1,{"k.j":2}],"b.y":{"z.w":3}}').text), '{"b":{"x":1,"y":{"z.w":3}},"a":[1,{"k.j":2}]}');
  const u = unflat('{"a":{"b":1}}');
  assert.equal(u.note, 'This JSON has no flat keys to unflatten');
  assert.equal(u.flip, true);
  assert.equal(unflat('{"a":1,"b":[]}').flip, false);
});

test('flatten: JSON that is already flat gets a hint to unflatten it', () => {
  const r = flat('{"user.name":"Ada","user.id":1}');
  assert.equal(r.flip, true);
  assert.equal(r.note, 'This looks like flat JSON already');
  assert.equal(r.warn, false);
  assert.equal(flat('[{"address.city":"Oslo"},{"id":2}]').flip, true);
  assert.equal(flat('{"name":"Ada","id":1}').flip, false);
  assert.equal(flat('{"a.b":{"c":1}}').flip, false);
  // Still warns when it wouldn't come back.
  assert.equal(flat('{"a.b":1,"a.b":2}').warn, true);
});

test('keys such as __proto__ and constructor are only keys: output is text, nothing is polluted', () => {
  const x = '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":1}},"toString":1,"hasOwnProperty":{"a":[1]}}';
  const r = flat(x);
  assert.equal(r.text, lines('{', '  "__proto__.polluted": "yes",', '  "constructor.prototype.x": 1,', '  "toString": 1,', '  "hasOwnProperty.a[0]": 1', '}'));
  const u = unflat(r.text);
  assert.equal(canon(u.text), canon(x));
  const u2 = unflat('{"__proto__.polluted":"yes","constructor.prototype.polluted":"yes","__proto__":1}');
  assert.match(u2.error, /^Keys "__proto__.polluted" and "__proto__" conflict/);
  assert.equal(canon(unflat('{"__proto__.polluted":"yes","constructor.prototype.polluted":"yes"}').text), '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('Unicode, surrogate pairs and lone surrogates in keys and values survive both ways', () => {
  const x = '{"日本":{"東京":"✓"},"\\ud83d\\ude00":{"\\ud800":"\\udfff"},"é.ü":{"a🔹b":"x"},"\\u0000":{"\\n":"\\t"}}';
  const r = flat(x);
  assert.equal(r.text, lines('{', '  "日本.東京": "✓",', '  "😀.\\ud800": "\\udfff",', '  "é\\\\.ü.a🔹b": "x",', '  "\\u0000.\\n": "\\t"', '}'));
  assert.ok(back(x).ok);
  for (const sep of ['🔹', '\ud83d', 'é']) {
    assert.ok(back(x, { sep }).ok, sep);
    assert.ok(back(x, { sep, escape: false }).ok === !flat(x, { sep, escape: false }).warn, sep);
  }
});

test('numbers keep their exact digits both ways', () => {
  const x = '{"n":{"big":9007199254740993,"neg":-9223372036854775809,"dec":0.1000000000000000055511151231257827,"exp":1E+400,"tiny":-1.5e-7,"zero":-0,"trail":12.50}}';
  const r = flat(x);
  assert.equal(r.text, lines('{', '  "n.big": 9007199254740993,', '  "n.neg": -9223372036854775809,', '  "n.dec": 0.1000000000000000055511151231257827,', '  "n.exp": 1E+400,', '  "n.tiny": -1.5e-7,', '  "n.zero": -0,', '  "n.trail": 12.50', '}'));
  assert.equal(back(x).u.text, stringify(doc(x), '  '));
});

test('deep nesting: no stack overflow either way', () => {
  const depth = 100_000;
  const deepArr = '['.repeat(depth) + '1' + ']'.repeat(depth);
  const r = flat(deepArr);
  // (A top-level array is a list of records: its one item, flattened.)
  assert.equal(r.text.length, '[\n  {\n    "'.length + '[0]'.repeat(depth - 1).length + '": 1\n  }\n]'.length);
  const deepObj = '{"a":'.repeat(20_000) + '1' + '}'.repeat(20_000);
  assert.equal(flat(deepObj).text, `{\n  "${Array(20_000).fill('a').join('.')}": 1\n}`);
  const two = '{"a":'.repeat(1990) + '[1,{"b":[]}]' + '}'.repeat(1990);
  assert.ok(back(two).ok);
  // Paths of more than 2,000 parts are refused, as the other converters refuse deeper documents.
  assert.equal(unflat(`{"${Array(2001).fill('a').join('.')}":1}`).error, 'Nesting is too deep to convert');
  assert.equal(unflat(`{"${Array(2000).fill('a').join('.')}":1}`).error, '');
  // Depth limit: deep values stay nested.
  const lim = flat(deepObj.slice(0, 5 * 5) + '1' + '}'.repeat(5), { depth: 2 });
  assert.equal(lim.text, '{\n  "a.a.a": {\n    "a": {\n      "a": 1\n    }\n  }\n}');
});

test('convert(): flatten and unflatten report notes and errors beside their text', () => {
  const seen: unknown[] = [];
  const out = convert(doc('{"a.b":1,"c":{"d":2}}'), 'flatten', { rootName: 'Root', report: (r) => seen.push(r) });
  assert.equal(out, '{\n  "a\\\\.b": 1,\n  "c.d": 2\n}');
  assert.deepEqual(seen, [{ note: 'Escaped 1 key with a backslash so that Unflatten restores it', warn: false, flip: false, error: '' }]);
  const err = convert(doc('{"a":1,"a.b":2}'), 'unflatten', { rootName: 'Root', report: (r) => seen.push(r) });
  assert.equal(err, '');
  assert.equal((seen[1] as { error: string }).error, 'Keys "a" and "a.b" conflict: one holds a value, the other goes inside it');
  assert.equal(convert(doc('{"a/b":[1]}'), 'unflatten', { rootName: 'Root', flat: { sep: '/', arrays: 'keep' } }), '{\n  "a": {\n    "b": [\n      1\n    ]\n  }\n}');
});

test('the json-flatten page: its preset, worked examples and notices are what the converter gives', () => {
  const page = TOOL_PAGE_BY_SLUG.get('json-flatten')!;
  assert.ok(`${page.title} | Tool Kumar`.length <= 60);
  assert.ok(page.description.length <= 155);
  assert.deepEqual(page.preset.settings, { view: 'convert', target: 'flatten', rootName: 'Root' });
  assert.equal(page.preset.initialText, page.sample);
  assert.equal(canon(page.sample), canon(SAMPLE));
  assert.equal(flat(page.sample).text, flat(SAMPLE).text);
  for (const slug of ['json-to-csv', 'json-to-table', 'json-path-finder', 'csv-to-json']) assert.ok(TOOL_PAGE_BY_SLUG.get(slug)!.related.includes('json-flatten'), slug);
  assert.deepEqual(page.related, ['json-to-csv', 'json-to-table', 'json-path-finder', 'home']);
  const [unflattenCode, escapeCode, conflictCode] = page.sections!.map((s) => s.code!);
  const [, flatIn, nested] = /^Flat JSON:\n(.*)\n\nUnflattened:\n([\s\S]*)$/.exec(unflattenCode)!;
  assert.deepEqual(unflat(flatIn), { text: nested, note: '', warn: false, flip: false, error: '' });
  const [, keysIn, flattened, notice] = /^Input:\n(.*)\n\nFlattened:\n([\s\S]*)\n\nNotice: (.*)$/.exec(escapeCode)!;
  assert.deepEqual(flat(keysIn), { text: flattened, note: notice, warn: false, flip: false, error: '' });
  assert.ok(back(keysIn).ok);
  const [, clash, error] = /^Flat JSON:\n(.*)\n\nUnflatten error:\n(.*)$/.exec(conflictCode)!;
  assert.equal(unflat(clash).error, error);
});

// ── An independent reference ─────────────────────────────────────────────────
// The module's rules written again from its comment, as plain recursive code over plain values with its own
// JSON reader and writer, sharing nothing with lib/convert/flat.ts or lib/json.

type V = { t: 'o'; e: [string, V][] } | { t: 'a'; e: V[] } | { t: 's'; s: string } | { t: 'raw'; raw: string };

function jparse(text: string): V {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \n\r\t'.includes(text[i])) i++;
  };
  const str = () => {
    const m = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i))!;
    i += m[0].length;
    return JSON.parse(m[0]) as string;
  };
  const val = (): V => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const e: [string, V][] = [];
      ws();
      if (text[i] === '}') return i++, { t: 'o', e };
      for (;;) {
        ws();
        const k = str();
        ws();
        i++;
        e.push([k, val()]);
        ws();
        if (text[i++] === '}') return { t: 'o', e };
      }
    }
    if (c === '[') {
      i++;
      const e: V[] = [];
      ws();
      if (text[i] === ']') return i++, { t: 'a', e };
      for (;;) {
        e.push(val());
        ws();
        if (text[i++] === ']') return { t: 'a', e };
      }
    }
    if (c === '"') return { t: 's', s: str() };
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(text.slice(i))!;
    i += m[0].length;
    return { t: 'raw', raw: m[0] };
  };
  return val();
}

const jwrite = (v: V): string =>
  v.t === 'raw' ? v.raw : v.t === 's' ? JSON.stringify(v.s) : v.t === 'a' ? `[${v.e.map(jwrite).join(',')}]` : `{${v.e.map(([k, x]) => JSON.stringify(k) + ':' + jwrite(x)).join(',')}}`;

const IDX = /^(0|[1-9][0-9]{0,8})$/;
const isBox = (v: V): v is Extract<V, { t: 'o' | 'a' }> => v.t === 'o' || v.t === 'a';

function refEscape(k: string, o: FlatOptions) {
  let r = '';
  for (let i = 0; i < k.length; i++) {
    const tail = k.slice(i);
    const sepHere = tail.startsWith(o.sep) || (tail.length < o.sep.length && o.sep.startsWith(tail));
    if (k[i] === '\\' || (k[i] === '[' && o.arrays === 'bracket') || sepHere) r += '\\';
    r += k[i];
  }
  return r;
}

/** A leaf's place: object keys and array indexes, each with its container's kind. */
type Place = (['o', string] | ['a', number])[];

/** The leaves the reference flattens to (one per flat key), each with its place in the document and its compact JSON. */
function refLeaves(v: V, o: FlatOptions): [Place, string][] {
  const out: [Place, string][] = [];
  const one = (root: V, at: Place) => {
    if (!isBox(root) || !root.e.length || (root.t === 'a' && o.arrays === 'keep')) return;
    const walk = (n: Extract<V, { t: 'o' | 'a' }>, place: Place, level: number) => {
      const items: [string | number, V][] = n.t === 'o' ? n.e : n.e.map((x, i) => [i, x]);
      for (const [k, c] of items) {
        const p: Place = [...place, typeof k === 'string' ? ['o', k] : ['a', k]];
        const emptyTop = o.arrays === 'bracket' && level === 0 && n.t === 'o' && k === '' && c.t === 'a';
        if (isBox(c) && c.e.length && !(c.t === 'a' && o.arrays === 'keep') && !emptyTop && (!o.depth || level < o.depth)) walk(c, p, level + 1);
        else out.push([p, jwrite(c)]);
      }
    };
    walk(root, at, 0);
  };
  if (v.t === 'a' && v.e.length) v.e.forEach((x, i) => one(x, [['a', i]]));
  else one(v, []);
  return out;
}

/** nodeAt for a parsed document: the node at `place` (the same kinds of containers all the way), or null. */
function nodeAt(root: JNode, place: Place): JNode | null {
  let n: JNode | undefined = root;
  for (const [kind, k] of place) {
    if (!n || n.t !== (kind === 'o' ? 5 : 4)) return null;
    const list = n.v as JNode[];
    n = kind === 'o' ? list.find((c) => c.key === k) : list[k as number];
  }
  return n ?? null;
}

/** The value at `place` in `v` (the same kinds of containers all the way), or null. */
function at(v: V, place: Place): V | null {
  let n: V | undefined = v;
  for (const [kind, k] of place) {
    if (!n || n.t !== kind) return null;
    n = n.t === 'o' ? n.e.find(([key]) => key === k)?.[1] : n.e[k as number];
  }
  return n ?? null;
}

function refFlatten(v: V, o: FlatOptions): V {
  const one = (root: V): V => {
    if (!isBox(root) || !root.e.length || (root.t === 'a' && o.arrays === 'keep')) return root;
    const out: [string, V][] = [];
    const walk = (n: Extract<V, { t: 'o' | 'a' }>, path: string | null, level: number) => {
      const digits = n.t === 'o' && o.arrays === 'dot' && n.e.every(([k]) => IDX.test(k));
      const items: [string | number, V][] = n.t === 'o' ? n.e : n.e.map((x, i) => [i, x]);
      for (const [k, c] of items) {
        let p: string;
        if (typeof k === 'string') {
          const seg = !o.escape ? k : digits ? '\\' + k : refEscape(k, o);
          p = path === null ? seg : path + o.sep + seg;
        } else p = o.arrays === 'bracket' ? `${path ?? ''}[${k}]` : path === null ? `${k}` : `${path}${o.sep}${k}`;
        // (Bracket style: an array under an empty top-level key stays whole, see the module comment.)
        const emptyTop = o.arrays === 'bracket' && level === 0 && n.t === 'o' && k === '' && c.t === 'a';
        if (isBox(c) && c.e.length && !(c.t === 'a' && o.arrays === 'keep') && !emptyTop && (!o.depth || level < o.depth)) walk(c, p, level + 1);
        else out.push([p, c]);
      }
    };
    walk(root, null, 0);
    return { t: 'o', e: out };
  };
  return v.t === 'a' && v.e.length ? { t: 'a', e: v.e.map(one) } : one(v);
}

/** Lexes a path into escaped characters, separators, indexes and characters, then reads the parts. */
function refParts(p: string, o: FlatOptions): Part[] {
  type Tok = { k: 'lit' | 'ch'; c: string } | { k: 'sep' } | { k: 'idx'; n: number };
  const toks: Tok[] = [];
  const esc = (c: string | undefined) => c !== undefined && (c === '\\' || c === '[' || c === ']' || /[0-9]/.test(c) || o.sep.includes(c));
  for (let i = 0; i < p.length; ) {
    const m = o.arrays === 'bracket' ? /^\[(0|[1-9][0-9]{0,8})\]/.exec(p.slice(i)) : null;
    const after = m ? p.slice(i + m[0].length) : '';
    if (o.escape && p[i] === '\\' && esc(p[i + 1])) {
      toks.push({ k: 'lit', c: p[i + 1] });
      i += 2;
    } else if (p.startsWith(o.sep, i)) {
      toks.push({ k: 'sep' });
      i += o.sep.length;
    } else if (m && (after === '' || after.startsWith('[') || after.startsWith(o.sep))) {
      toks.push({ k: 'idx', n: Number(m[1]) });
      i += m[0].length;
    } else toks.push({ k: 'ch', c: p[i++] });
  }
  const parts: Part[] = [];
  let key: string | null = null;
  let lit = false;
  const end = () => {
    parts.push(o.arrays === 'dot' && !lit && IDX.test(key!) ? Number(key) : key!);
    key = null;
    lit = false;
  };
  let afterIdx = false;
  if (toks[0]?.k !== 'idx') key = '';
  for (const t of toks) {
    if (t.k === 'idx') {
      if (key !== null) end();
      parts.push(t.n);
      afterIdx = true;
    } else if (t.k === 'sep') {
      if (key !== null) end();
      key = '';
      afterIdx = false;
    } else {
      if (afterIdx) key = '';
      afterIdx = false;
      key += t.c;
      if (t.k === 'lit') lit = true;
    }
  }
  if (key !== null) end();
  return parts;
}

type Node = { leaf: V } | { kids: Map<string, Node>; order: string[]; num: boolean; str: boolean };

function refUnflatten(v: V, o: FlatOptions): V | null {
  // Missing items filled with null, at most a million in all, in output order; an array past that stays an object.
  let budget = 1_000_000;
  const one = (obj: Extract<V, { t: 'o' }>): V | null => {
    const top: Node = { kids: new Map(), order: [], num: false, str: false };
    for (const [k, val] of obj.e) {
      const parts = refParts(k, o);
      if (parts.length > 2000) return null;
      let box = top;
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        const num = typeof part === 'number';
        if (o.arrays === 'bracket' && (num ? box.str : box.num)) return null;
        if (num) box.num = true;
        else box.str = true;
        const name = String(part);
        const have = box.kids.get(name);
        const last = j === parts.length - 1;
        if (!have) {
          const n: Node = last ? { leaf: val } : { kids: new Map(), order: [], num: false, str: false };
          box.kids.set(name, n);
          box.order.push(name);
          if (last) break;
          box = n as Exclude<Node, { leaf: V }>;
        } else {
          if ('leaf' in have || last) return null;
          box = have;
        }
      }
    }
    const out = (n: Node): V => {
      if ('leaf' in n) return n.leaf;
      const arr = n.order.length > 0 && (o.arrays === 'bracket' ? n.num : o.arrays === 'dot' && !n.str);
      const len = arr ? Math.max(...n.order.map(Number)) + 1 : 0;
      if (!arr || len - n.order.length > budget) return { t: 'o', e: n.order.map((k) => [k, out(n.kids.get(k)!)]) };
      budget -= len - n.order.length;
      return { t: 'a', e: Array.from({ length: len }, (_, i) => (n.kids.has(String(i)) ? out(n.kids.get(String(i))!) : { t: 'raw', raw: 'null' })) };
    };
    return out(top);
  };
  if (v.t === 'a' && v.e.length) {
    const items = v.e.map((x) => (x.t === 'o' ? one(x) : x));
    return items.includes(null) ? null : { t: 'a', e: items as V[] };
  }
  return v.t === 'o' ? one(v) : v;
}

// ── Random documents ─────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = [
  'a', 'b', 'name', 'id', 'user.name', 'a.b', '.', '..', 'x/y', '/', 'snake_case', '_', '__', '___', 'a_', '_a', 'dunder__key', 'arrow->key', '->', '-', '>',
  '0', '1', '2', '12', '01', '007', '-1', '1.5', '999999999', '1000000000', '[0]', 'a[0]', 'a[1]b', '[', ']', 'x]', '[x]', '[01]', '[0][1]',
  '\\', 'back\\slash', 'trail\\', '\\.', '\\[0]', '', ' ', 'é', '日本', '🔹', 'a🔹b', '\ud800', '\udfff', '__proto__', 'constructor', 'toString', 'k\n',
];
const SCALARS = ['null', 'true', 'false', '0', '-0', '7', '12.50', '9007199254740993', '-9223372036854775809', '1E+400', '-1.5e-7', '0.1000000000000000055511151231257827', '"s"', '"a.b"', '""', '"\\ud83d"', '"日本"', '"\\\\"'];
const SEPS = ['.', '/', '_', '__', '->', '🔹', ': '];
const STYLES: FlatArrays[] = ['bracket', 'dot', 'keep'];

function generator(seed: number) {
  const r = mulberry32(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const kinds: Record<string, number> = {};
  const saw = (k: string) => (kinds[k] = (kinds[k] ?? 0) + 1);
  const value = (d: number): string => {
    const x = r();
    if (d >= 5 || x < 0.4) {
      const s = pick(SCALARS);
      if (/\d{16}|E\+|e-|0\.1000/.test(s)) saw('big or exact number');
      return s;
    }
    if (x < 0.7) {
      const n = Math.floor(r() * 5);
      if (!n) saw('empty object');
      const keys: string[] = [];
      while (keys.length < n) {
        const k = pick(KEYS);
        if (!keys.includes(k)) keys.push(k);
      }
      // Now and then a key twice.
      if (n > 1 && r() < 0.05) {
        keys[n - 1] = keys[0];
        saw('duplicate key');
      }
      // Sometimes an object whose keys are all digits (dot style escapes them).
      if (n && r() < 0.08) {
        keys.length = 0;
        for (let i = 0; i < n; i++) keys.push(String(i * Math.floor(1 + r() * 3)));
        saw('all-digit object');
      }
      for (const k of keys) {
        if (SEPS.some((s) => k.includes(s))) saw('key with a separator');
        if (k.includes('[')) saw('key with a bracket');
        if (k.includes('\\')) saw('key with a backslash');
        if (IDX.test(k)) saw('index-like key');
        if (k === '') saw('empty key');
        if (/[^\x00-\x7f]/.test(k)) saw('non-ASCII key');
        if (k === '__proto__' || k === 'constructor') saw('__proto__ or constructor');
      }
      return `{${keys.map((k) => JSON.stringify(k) + ':' + value(d + 1)).join(',')}}`;
    }
    const n = Math.floor(r() * 4);
    if (!n) saw('empty array');
    return `[${Array.from({ length: n }, () => value(d + 1)).join(',')}]`;
  };
  const options = (): FlatOptions => ({ sep: pick(SEPS), arrays: pick(STYLES), escape: r() < 0.7, depth: r() < 0.75 ? 0 : 1 + Math.floor(r() * 3) });
  return { r, pick, value, options, kinds, saw };
}

test('fuzz: unflatten(flatten(x)) is x exactly when flatten does not warn, and matches the reference', () => {
  const g = generator(0x5eed);
  const counts: Record<string, number> = {};
  const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const DOCS = 4000;
  for (let n = 0; n < DOCS; n++) {
    const text = n % 10 === 0 ? `[${g.value(1)},${g.value(1)}]` : g.value(0);
    const x = doc(text);
    // Every document under a few random options, and one in four under all 6 × 3 × 2 core combinations.
    const combos: FlatOptions[] = [g.options(), g.options()];
    if (n % 4 === 0) for (const sep of ['.', '__']) for (const arrays of STYLES) for (const escape of [true, false]) combos.push({ sep, arrays, escape, depth: 0 });
    for (const o of combos) {
      add(`options: arrays ${o.arrays}, escape ${o.escape}${o.depth ? ', depth' : ''}`);
      const f = flatten(x, o);
      assert.equal(f.error, '');
      const u = unflatten(doc(f.text), o);
      // Written exactly as the formatter indents (kept and nested values are written in steps of their own).
      assert.equal(f.text, stringify(doc(f.text), '  '));
      if (u.text) assert.equal(u.text, stringify(doc(u.text), '  '));
      const ok = !u.error && canon(u.text) === canon(text);
      add(f.warn ? (ok ? 'BUG: warned but came back' : 'warned, does not come back') : ok ? 'came back' : 'BUG: silent loss');
      if (ok === f.warn) assert.fail(`${JSON.stringify(o)}\n${text}\nflat: ${f.text}\nnote: ${f.note}\nback: ${u.text || u.error}`);
      // With escapes, only duplicate keys keep a document from coming back.
      if (o.escape && f.warn) assert.ok(/duplicate keys?:/.test(f.note) && !f.note.includes('same place'), `${JSON.stringify(o)}\n${text}\nnote: ${f.note}`);
      if (f.note.includes('Escaped')) add('escaped keys');
      if (f.flip) add('looked flat');
      // The reference: the same flat JSON, and the same verdict found by actually converting back.
      const v = jparse(text);
      const rf = refFlatten(v, o);
      assert.equal(jwrite(jparse(f.text)), jwrite(rf), `${JSON.stringify(o)}\n${text}`);
      const ru = refUnflatten(rf, o);
      assert.equal(!!ru && jwrite(ru) === jwrite(v), ok, `${JSON.stringify(o)}\n${text}`);
      if (ru && !u.error) assert.equal(jwrite(jparse(u.text)), jwrite(ru));
      // The count it warns of is exactly the number of keys that don't come back to their place (with escapes off;
      // without duplicate keys, which merge or clash).
      if (!o.escape && !u.error && !f.note.includes('duplicate')) {
        const back = jparse(u.text);
        const moved = refLeaves(v, o).filter(([place, json]) => at(back, place) === null || jwrite(at(back, place)!) !== json).length;
        const said = Number(/^(?:.* · )?([\d,]+) keys? won't unflatten/.exec(f.note)?.[1].replace(/,/g, '') ?? 0);
        assert.equal(said, moved, `${JSON.stringify(o)}\n${text}\nnote: ${f.note}`);
        add(moved ? 'counted moved keys' : 'nothing moved');
      }
    }
  }
  console.log(`flatten fuzz over ${DOCS} documents: documents with ${JSON.stringify(g.kinds)}\nresults: ${JSON.stringify(counts)}`);
  assert.equal(counts['BUG: silent loss'] ?? 0, 0);
  for (const k of ['came back', 'warned, does not come back', 'escaped keys', 'looked flat']) assert.ok(counts[k] > 20, k);
  for (const k of ['duplicate key', 'all-digit object', 'key with a separator', 'key with a bracket', 'key with a backslash', 'empty key', 'non-ASCII key', '__proto__ or constructor', 'empty object', 'empty array', 'big or exact number']) assert.ok(g.kinds[k] > 20, k);
});

test('fuzz: lists of records whose all-digit objects compete for the gap budget: the count is exact', () => {
  const r = mulberry32(0xb0d9e7);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const BIG = [600000, 700000, 999990, 999999, 1000000];
  const SMALL = [0, 1, 2, 5, 30];
  const counts: Record<string, number> = {};
  for (let n = 0; n < 400; n++) {
    const sep = pick(['.', '_']);
    const o: FlatOptions = { sep, arrays: r() < 0.8 ? 'dot' : 'bracket', escape: false, depth: 0 };
    const rec = () => {
      const x = r();
      // Looks like an array with a big gap, but its other key keeps it an object: unflatten spends nothing on it.
      if (x < 0.3) return `{"a":{"${pick(BIG)}":1},"a${sep}x":2}`;
      // A small real gap, filled or kept as keys depending on what is left of the budget.
      if (x < 0.65) return r() < 0.5 ? `{"${pick(SMALL)}":3}` : `{"k":{"${pick(SMALL)}":4,"${pick(SMALL)}":5}}`;
      return pick(['{"a":{"b":1}}', `{"x${sep}y":1}`, '{"0":"z","q":1}', '{"n":[1,2]}']);
    };
    const recs = Array.from({ length: 2 + Math.floor(r() * 3) }, rec);
    // Now and then a real gap of nearly all the budget first (written out: a million nulls, so not often), leaving
    // too little for the gap of a record after it.
    if (n % 20 === 0) {
      recs.unshift(`{"${pick([999999, 1000000])}":6}`);
      recs.push('{"30":3}');
    }
    const text = `[${recs.join(',')}]`;
    const f = flat(text, o);
    const u = unflat(f.text, o);
    // (The output can hold a million nulls: read once, by the fast parser.)
    const back = u.error ? null : doc(u.text);
    const ok = !!back && stringify(back, '') === canon(text);
    assert.equal(ok, !f.warn, `${JSON.stringify(o)}\n${text}\nnote: ${f.note}`);
    if (!back) continue;
    const moved = refLeaves(jparse(text), o).filter(([place, json]) => {
      const n = nodeAt(back, place);
      return !n || stringify(n, '') !== json;
    }).length;
    const said = Number(/^(?:.* · )?([\d,]+) keys? won't unflatten/.exec(f.note)?.[1].replace(/,/g, '') ?? 0);
    assert.equal(said, moved, `${JSON.stringify(o)}\n${text}\nnote: ${f.note}`);
    const k = !moved ? 'none moved' : u.note.includes('far apart') ? 'moved, a gap too big' : u.note.includes('missing') ? 'moved, with gaps filled' : 'moved';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log(`records fuzz: ${JSON.stringify(counts)}`);
  for (const k of ['moved, with gaps filled', 'moved, a gap too big', 'none moved']) assert.ok(counts[k] > 10, k);
});

test('fuzz: unflatten of random flat keys matches the reference (results, conflicts, holes)', () => {
  const g = generator(0xf1a7);
  const counts: Record<string, number> = {};
  const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const PARTS = ['a', 'b', 'c', '0', '1', '2', '01', '', 'x.y', '\\.', '\\\\', '\\0', '\\[0]', '[0]', '[1]', '[3]', '[01]', '[x]', '_', '🔹', '__proto__'];
  for (let n = 0; n < 3000; n++) {
    const o = g.options();
    const keys = Array.from({ length: 1 + Math.floor(g.r() * 6) }, () => {
      let k = '';
      const len = 1 + Math.floor(g.r() * 4);
      for (let i = 0; i < len; i++) {
        const p = g.pick(PARTS);
        k += i && !p.startsWith('[') ? o.sep + p : p;
      }
      return k;
    });
    const text = `{${keys.map((k) => JSON.stringify(k) + ':' + g.value(3)).join(',')}}`;
    const u = unflatten(doc(text), o);
    const ru = refUnflatten(jparse(text), o);
    assert.equal(!u.error, !!ru, `${JSON.stringify(o)}\n${text}\n${u.error}`);
    if (ru) assert.equal(jwrite(jparse(u.text)), jwrite(ru), `${JSON.stringify(o)}\n${text}`);
    for (const k of keys) assert.deepEqual(pathParts(k, o), refParts(k, o), `${JSON.stringify(o)} ${JSON.stringify(k)}`);
    add(u.error ? (u.error.includes('same path') ? 'same path' : u.error.includes('array') ? 'array and object' : 'value and inside') : u.note.includes('missing') ? 'holes filled' : 'clean');
  }
  console.log(`unflatten fuzz: ${JSON.stringify(counts)}`);
  for (const k of ['clean', 'same path', 'array and object', 'value and inside', 'holes filled']) assert.ok(counts[k] > 20, k);
});

// ── Speed ────────────────────────────────────────────────────────────────────

/**
 * A conversion's steps: how many, the 95th percentile and longest of their times (ms of CPU time: other processes
 * taking the machine don't count, see ./timing.ts), and its result.
 */
function stepped(steps: Steps<FlatResult>) {
  const times: number[] = [];
  for (;;) {
    const t = cpuNow();
    const r = steps.next();
    times.push(cpuNow() - t);
    if (r.done) {
      const sorted = times.slice().sort((a, b) => a - b);
      return { count: times.length, p95: sorted[Math.floor(sorted.length * 0.95)], slow: times.filter((t) => t > 20).length, longest: sorted[sorted.length - 1], result: r.value };
    }
  }
}

test('steps stay short for long lists of small records, scalars and values kept whole', () => {
  const N = 60_000;
  const big = `[${Array.from({ length: N }, (_, i) => `{"i":${i},"tags":["a","b"],"n":null}`).join(',')}]`;
  const medium = `{${Array.from({ length: 128 }, (_, a) => `"a${a}":[${Array.from({ length: 1000 }, (_, i) => i).join(',')}]`).join(',')}}`;
  const cases: [string, string, (r: JNode, o?: Partial<FlatOptions>) => Steps<FlatResult>, Partial<FlatOptions>?][] = [
    // (Each record or scalar is one item: none of them yielded, 191 ms and 125 ms in one step for 750 KB.)
    ['a top-level array of empty objects, flattened', `[${'{},'.repeat(N - 1)}{}]`, flattenSteps],
    ['a top-level array of empty objects, unflattened', `[${'{},'.repeat(N - 1)}{}]`, unflattenSteps],
    ['a top-level array of scalars, flattened', `[${Array.from({ length: N }, (_, i) => (i % 2 ? `"s${i}"` : i)).join(',')}]`, flattenSteps],
    ['a top-level array of scalars, unflattened', `[${Array.from({ length: N }, (_, i) => (i % 2 ? `"s${i}"` : i)).join(',')}]`, unflattenSteps],
    // (Values kept whole were written in one go.)
    ['a big array under the empty key', `{"":${big},"x":1}`, flattenSteps],
    ['a big array kept whole (None)', `{"rows":${big}}`, flattenSteps, { arrays: 'keep' }],
    ['a depth-1 flatten of a big nested value', `{"data":{"rows":${big}}}`, flattenSteps, { depth: 1 }],
    ['a flat key holding a big array, unflattened', `{"data.rows":${big}}`, unflattenSteps],
    // (Each kept container counted its own items from 0: 128 arrays of 1,000 numbers converted in one step.)
    ['many medium arrays kept whole (None)', medium, flattenSteps, { arrays: 'keep' }],
    ['many medium arrays as flat values, unflattened', medium, unflattenSteps],
    ['many medium arrays rebuilt from indexes, unflattened', `{${Array.from({ length: 128 }, (_, a) => Array.from({ length: 1000 }, (_, i) => `"a${a}[${i}]":${i}`).join(',')).join(',')}}`, unflattenSteps],
    ['a big object, its keys checked for duplicates', `{${Array.from({ length: N }, (_, i) => `"k${i}":${i}`).join(',')}}`, flattenSteps],
  ];
  for (const [what, text, run, o] of cases) {
    const x = doc(text);
    const r = stepped(run(x, o));
    assert.equal(r.result.text, (run === flattenSteps ? flatten : unflatten)(x, o).text, what);
    console.log(`steps: ${what}: ${r.count} steps, 95% within ${r.p95.toFixed(2)} ms, the longest ${r.longest.toFixed(1)} ms`);
    assert.ok(r.count > 20, `${what}: ${r.count} steps`);
    // About 1,024 items a step: well under a millisecond. A garbage collection lands in a step now and then (tens of
    // ms, more on a busy machine), never the whole job.
    assert.ok(r.p95 < 5, `${what}: 95% of the steps within ${r.p95.toFixed(2)} ms`);
    assert.ok(r.slow <= 3, `${what}: ${r.slow} steps over 20 ms`);
    assert.ok(r.longest < 250, `${what}: a step took ${r.longest.toFixed(1)} ms`);
  }
});

/** A big API response: `n` records of nested objects, arrays and numbers. */
function records(n: number, seed = 42) {
  const r = mulberry32(seed);
  const rec = (i: number) => `{"id":${9007199254740000 + i},"name":"user ${i}","active":${i % 2 === 0},"profile":{"city":"City ${i % 97}","zip":"${10000 + i}","geo":{"lat":${(r() * 180 - 90).toFixed(6)},"lng":${(r() * 360 - 180).toFixed(6)}}},"tags":["t${i % 7}","t${i % 11}"],"orders":[{"sku":"S${i}","qty":${i % 5},"price":${(r() * 100).toFixed(2)}}],"meta":{}}`;
  return `{"data":[${Array.from({ length: n }, (_, i) => rec(i)).join(',')}],"total":${n}}`;
}

test('convert with live (the page): the same output in slices of about 8 ms, the page free in between, and stops when not wanted', async () => {
  const text = records(4600); // about 1 MB
  const x = doc(text);
  // Slices: the longest stretch of work between two yields to the page.
  const RealChannel = globalThis.MessageChannel;
  let longest = 0;
  let last = performance.now();
  let slices = 0;
  globalThis.MessageChannel = class extends RealChannel {
    constructor() {
      super();
      const t = performance.now();
      longest = Math.max(longest, t - last);
      slices++;
      const p1 = this.port1;
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(p1), 'onmessage')!.set!;
      Object.defineProperty(p1, 'onmessage', { set: (f: (e: MessageEvent) => void) => set.call(p1, (e: MessageEvent) => ((last = performance.now()), f(e))) });
    }
  } as typeof MessageChannel;
  try {
    for (const target of ['flatten', 'unflatten'] as const) {
      const input = target === 'flatten' ? x : doc(flatten(x).text);
      const notes: unknown[] = [];
      [longest, slices, last] = [0, 0, performance.now()];
      const t0 = performance.now();
      const out = await convert(input, target, { rootName: 'Root', live: () => true, report: (n) => notes.push(n) });
      longest = Math.max(longest, performance.now() - last);
      assert.equal(out, convert(input, target, { rootName: 'Root' }), target);
      assert.deepEqual(notes, [{ note: '', warn: false, flip: false, error: '' }]);
      console.log(`sliced ${target}, 1 MB: ${slices} slices in ${Math.round(performance.now() - t0)} ms, the longest ${longest.toFixed(1)} ms`);
      assert.ok(slices > 3, `${target}: ${slices} slices`);
      // 8 ms a slice, plus the work between two checks (1,024 items) on a busy machine.
      assert.ok(longest < 60, `${target}: a slice took ${longest} ms`);
    }
  } finally {
    globalThis.MessageChannel = RealChannel;
  }
  // Not wanted any more: it stops at the next slice, reporting nothing.
  const notes: unknown[] = [];
  let asked = 0;
  assert.equal(await convert(x, 'flatten', { rootName: 'Root', live: () => ++asked < 2, report: (n) => notes.push(n) }), '');
  assert.deepEqual([asked, notes], [2, []]);
  // Other targets convert at once; small documents in one slice.
  assert.equal(convert(doc('{"a":1}'), 'yaml', { rootName: 'Root', live: () => false }), 'a: 1\n');
  assert.equal(await convert(doc('{"a":{"b":1}}'), 'flatten', { rootName: 'Root', live: () => false }), '{\n  "a.b": 1\n}');
});

test('speed: a 5 MB document flattens and unflattens within 3 s of CPU time each', () => {
  const r = mulberry32(42);
  const rec = (i: number) => `{"id":${9007199254740000 + i},"name":"user ${i}","active":${i % 2 === 0},"profile":{"city":"City ${i % 97}","zip":"${10000 + i}","geo":{"lat":${(r() * 180 - 90).toFixed(6)},"lng":${(r() * 360 - 180).toFixed(6)}}},"tags":["t${i % 7}","t${i % 11}"],"orders":[{"sku":"S${i}","qty":${i % 5},"price":${(r() * 100).toFixed(2)}}],"meta":{}}`;
  const items: string[] = [];
  let size = 0;
  for (let i = 0; size < 5_000_000; i++) {
    const s = rec(i);
    items.push(s);
    size += s.length + 1;
  }
  const text = `{"data":[${items.join(',')}],"total":${items.length}}`;
  const x = doc(text);
  // (CPU time, not the clock: see ./timing.ts.)
  const [w0, c0] = [performance.now(), cpuNow()];
  const f = flatten(x);
  const [w1, c1] = [performance.now(), cpuNow()];
  const fx = doc(f.text);
  const [w2, c2] = [performance.now(), cpuNow()];
  const u = unflatten(fx);
  const [w3, c3] = [performance.now(), cpuNow()];
  console.log(`speed: ${(text.length / 1e6).toFixed(1)} MB, ${items.length} records: flatten ${Math.round(w1 - w0)} ms (${Math.round(c1 - c0)} ms CPU, ${(f.text.length / 1e6).toFixed(1)} MB out), unflatten ${Math.round(w3 - w2)} ms (${Math.round(c3 - c2)} ms CPU)`);
  assert.equal(f.note, '');
  assert.equal(canon(u.text), canon(text));
  // (Measured on a busy 4-core host: about 0.5 s and 1.0–1.4 s, garbage collection included. A slip to quadratic
  // work over the 450,000 keys would take minutes.)
  assert.ok(c1 - c0 < 3000, `flatten took ${c1 - c0} ms of CPU time`);
  assert.ok(c3 - c2 < 3000, `unflatten took ${c3 - c2} ms of CPU time`);
});
