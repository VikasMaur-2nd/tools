import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { SchemaSession, validateTexts, keyBefore, type ValidateResult } from '../lib/schema/index';
import { Validator } from '../lib/schema/validator';
import { cmp, dec, isMultiple, isWhole } from '../lib/schema/decimal';
import { resolveUri, normalizeUri } from '../lib/schema/uri';
import { punyDecode, punyEncode } from '../lib/schema/formats';
import { SchemaClient, type Port } from '../lib/schema/client';
import type { WorkerReply, WorkerRequest } from '../lib/schema/schema.worker';
import { SAMPLE_DOC, SAMPLE_SCHEMA } from '../lib/schema/sample';
import { errorText, problemText } from '../components/schema-messages';
import { EN } from '../lib/i18n/ui';
import { TOOL_PAGE_BY_SLUG } from '../lib/tool-pages';

// lib/schema beyond the official suite (tests/schema-suite.test.ts): exact numbers, where errors are, references
// across embedded resources, schema problems, cancellation, and speed on a multi-megabyte document.

const run = (schema: unknown, doc: unknown, opts: { draft?: 4 | 6 | 7 | 2019 | 2020; formats?: boolean } = {}): ValidateResult =>
  validateTexts({ schema: typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2), doc: typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2), draft: opts.draft ?? null, formats: !!opts.formats });
const valid = (schema: unknown, doc: string, draft?: 4 | 6 | 7 | 2019 | 2020) => run(schema, doc, { draft }).valid;
const codes = (r: ValidateResult) => r.errors.map((e) => e.code);
const problems = (r: ValidateResult) => r.problems.map((p) => p.code);

test('decimal: exact comparison and multipleOf on the source digits', () => {
  const d = (s: string) => dec(s)!;
  assert.equal(cmp(d('1'), d('1.0')), 0);
  assert.equal(cmp(d('10e-1'), d('1')), 0);
  assert.equal(cmp(d('-0'), d('0')), 0);
  assert.equal(cmp(d('18446744073709551616'), d('18446744073709551615')), 1);
  assert.equal(cmp(d('-9007199254740993'), d('-9007199254740992')), -1);
  assert.equal(cmp(d('1e308'), d('9.99e307')), 1);
  assert.equal(cmp(d('0.1'), d('0.10000000000000001')), -1);
  assert.ok(isMultiple(d('19.99'), d('0.01')));
  assert.ok(!isMultiple(d('19.999'), d('0.01')));
  assert.ok(isMultiple(d('0.0075'), d('0.0001')));
  assert.ok(isMultiple(d('1e308'), d('0.5')));
  assert.ok(!isMultiple(d('10'), d('4')));
  assert.ok(isMultiple(d('20'), d('4')));
  assert.ok(isMultiple(d('0'), d('0.3')));
  assert.ok(isMultiple(d('4.5'), d('1.5')));
  assert.ok(!isMultiple(d('0.3'), d('0.2')));
  // A billion-digit power of ten is never built.
  const t = performance.now();
  assert.ok(!isMultiple(d('1e999999999'), d('7')));
  assert.ok(isMultiple(d('1e999999999'), d('8')));
  assert.ok(performance.now() - t < 50);
  // Exponents past 2^53 are exact too (review round 1, finding 9).
  assert.equal(cmp(d('1e9007199254740992'), d('1000')), 1);
  assert.equal(cmp(d('9e9007199254740991'), d('11e9007199254740991')), -1);
  assert.equal(cmp(d('1.1e9007199254740992'), d('11e9007199254740991')), 0);
  assert.equal(cmp(d('1e99999999999999999999'), d('1e99999999999999999998')), 1);
  assert.ok(isWhole(d('1e9007199254740992')) && !isWhole(d('1.5e-9007199254740992')));
  assert.equal(isMultiple(d('7e9007199254740993'), d('7')), true);
  assert.equal(isMultiple(d('1'), d('1e-9007199254740993')), true);
  // Any scale gap is worked out (review round 2, finding 9): no "can't tell" any more.
  assert.equal(isMultiple(d('1e' + '1'.repeat(30200)), d('7')), false);
  assert.equal(isMultiple(d('1e' + '1'.repeat(30200)), d('2.5e-3')), true);
});

test('round 2, finding 9: multipleOf costs the digits, not the exponents; the powers of 2 and 5 and the rest', () => {
  const d = (s: string) => dec(s)!;
  // Exact against plain rational arithmetic on every pair of a few hundred numbers.
  const nums = ['0', '1', '2', '3', '5', '7', '10', '12', '25', '0.5', '0.25', '0.01', '0.2', '1.5', '19.99', '19.999', '4e3', '8e-2', '125', '0.0016', '1e-5', '3e2', '6.25', '640', '0.008', '13', '1.3e1', '7e10', '2.8e-3', '96', '1e20', '3.2e-7'];
  const exact = (a: string, b: string) => {
    const [x, y] = [d(a), d(b)];
    if (x.digits === '') return true;
    const k = x.exp - y.exp;
    return (BigInt(x.digits) * (k >= 0n ? 10n ** k : 1n)) % (BigInt(y.digits) * (k < 0n ? 10n ** -k : 1n)) === 0n;
  };
  for (const a of nums) for (const b of nums) if (b !== '0') assert.equal(isMultiple(d(a), d(b)), exact(a, b), `${a} / ${b}`);
  // A 1,000-digit exponent against a 1,000-digit divisor: was 82 ms (modular exponentiation over the gap).
  let x = 7;
  const digits = (n: number) => Array.from({ length: n }, (_, i) => (i ? (x = (x * 1103515245 + 12345) % 2147483648) % 10 : 1 + (x % 9))).join('');
  const exp = digits(1000);
  const div = digits(1000) + '7';
  const t = performance.now();
  assert.equal(isMultiple(d(`7e${exp}`), d(div)), false);
  assert.equal(isMultiple(d(`${div}e${exp}`), d(div)), true);
  assert.equal(isMultiple(d(`${digits(1000)}e${exp}`), d(`0.${'0'.repeat(500)}${div}`)), false);
  assert.equal(isMultiple(d(`3e${exp}`), d(`1.6e-${exp}`)), true);
  const ms = performance.now() - t;
  console.log(`multipleOf, 1,000-digit exponents and divisors: ${ms.toFixed(2)} ms`);
  assert.ok(ms < 20, `${ms.toFixed(1)} ms`);
});

test('round 2, finding 9: a problem of one check (a $ref loop) isn\'t kept for the next document', () => {
  const session = new SchemaSession();
  // (It loops only through property a.)
  const schema = JSON.stringify({ properties: { a: { $ref: '#/$defs/x' } }, $defs: { x: { $ref: '#/$defs/x' } } });
  const loop = session.run({ schema, doc: '{"a": 1}', draft: null, formats: false });
  assert.deepEqual(loop.problems.map((p) => [p.code, p.reached]), [['loop', true]]);
  const next = session.run({ schema, doc: '14', draft: null, formats: false });
  assert.deepEqual([next.valid, next.complete, next.problems], [true, true, []]);
});

test('numbers: lossless checks through the whole validator', () => {
  assert.ok(valid({ multipleOf: 0.01 }, '19.99'));
  assert.ok(!valid({ multipleOf: 0.01 }, '19.999'));
  const big = '{ "maximum": 18446744073709551615 }';
  assert.ok(run(big, '18446744073709551615').valid);
  assert.ok(!run(big, '18446744073709551616').valid);
  assert.deepEqual(codes(run(big, '18446744073709551616')), ['maximum']);
  assert.equal(errorText('maximum', run(big, '18446744073709551616').errors[0].params, EN), 'Must be at most 18446744073709551615');
  assert.ok(run('{ "exclusiveMinimum": -9007199254740993 }', '-9007199254740992').valid);
  assert.ok(!run('{ "exclusiveMinimum": -9007199254740992 }', '-9007199254740992').valid);
  assert.ok(run('{ "type": "integer" }', '1e308').valid);
  assert.ok(run('{ "type": "integer", "multipleOf": 0.5 }', '1e308').valid);
  assert.ok(!run('{ "type": "integer" }', '1.5').valid);
  // 1.0 is an integer from draft-06 on; draft-04 counts a fraction or exponent part as not one.
  assert.ok(run('{ "type": "integer" }', '1.0').valid);
  assert.ok(!run('{ "type": "integer" }', '1.0', { draft: 4 }).valid);
  // JSON equality: 1 and 1.0 are the same value; object member order doesn't matter.
  assert.ok(run('{ "const": 1 }', '1.0').valid);
  assert.ok(run('{ "enum": [1.0, "a"] }', '1').valid);
  assert.ok(!run('{ "uniqueItems": true }', '[1, 1.0]').valid);
  assert.ok(run('{ "uniqueItems": true }', '[1, "1", true, null, [1], {"a": 1}]').valid);
  assert.ok(!run('{ "uniqueItems": true }', '[{"a": 1, "b": 2}, {"b": 2, "a": 1.00}]').valid);
  assert.ok(run('{ "const": 12345678901234567890 }', '12345678901234567890').valid);
  assert.ok(!run('{ "const": 12345678901234567890 }', '12345678901234567891').valid);
});

test('strings count code points; patterns are unicode regexes', () => {
  assert.ok(run('{ "maxLength": 2 }', '"😀😀"').valid);
  assert.ok(!run('{ "maxLength": 1 }', '"😀😀"').valid);
  assert.ok(run('{ "minLength": 3 }', '"aé😀"').valid);
  assert.ok(run('{ "pattern": "^\\\\p{L}+$" }', '"ñandú"').valid);
  assert.ok(!run('{ "pattern": "^[a-z]+$" }', '"abc1"').valid);
  assert.equal(errorText('pattern', run('{ "pattern": "^[a-z]+$" }', '"abc1"').errors[0].params, EN), 'Must match the pattern ^[a-z]+$');
});

test('error locations: JSON Pointer, line and column, escaped and Unicode keys', () => {
  const doc = '{\n  "a/b": 1,\n  "m~n": "x",\n  "é😀": [true, {"deep": null}],\n  "ok": 2\n}';
  const schema = { properties: { 'a/b': { type: 'string' }, 'm~n': { type: 'integer' }, 'é😀': { items: [{}, { properties: { deep: { type: 'string' } } }] } } };
  const r = run(schema, doc, { draft: 2019 });
  const by = Object.fromEntries(r.errors.map((e) => [e.pointer, e]));
  assert.deepEqual(Object.keys(by), ['/a~1b', '/m~0n', '/é😀/1/deep']);
  assert.deepEqual([by['/a~1b'].loc!.line, by['/a~1b'].loc!.col], [2, 10]);
  assert.deepEqual([by['/m~0n'].loc!.line, by['/m~0n'].loc!.col], [3, 10]);
  assert.equal(doc.slice(by['/m~0n'].loc!.p, by['/m~0n'].loc!.e), '"x"');
  const deep = by['/é😀/1/deep'].loc!;
  // (Columns count UTF-16 units, as the editor's do: 😀 is two.)
  assert.deepEqual([deep.line, deep.col], [4, 26]);
  assert.equal(doc.slice(deep.p, deep.e), 'null');
  // The keyword path goes through the schema; its location is the keyword in the schema text.
  assert.equal(by['/m~0n'].path, '/properties/m~0n/type');
  const s = JSON.stringify(schema, null, 2);
  assert.equal(s.slice(by['/m~0n'].schemaLoc!.p, by['/m~0n'].schemaLoc!.e), '"type"');
  // A property that isn't allowed is selected by its name, quotes included.
  const extra = run({ additionalProperties: false, properties: { ok: {} } }, '{"ok": 1, "bad \\"name\\"": 2}');
  const e = extra.errors[0];
  assert.equal(e.code, 'additionalProperties');
  assert.ok(e.key);
  assert.equal('{"ok": 1, "bad \\"name\\"": 2}'.slice(e.loc!.p, e.loc!.e), '"bad \\"name\\""');
  assert.equal(errorText(e.code, e.params, EN), 'Property "bad \\"name\\"" is not allowed');
  // A container's location is its opening bracket.
  const req = run({ required: ['email'] }, '\n\n  { "a": 1 }');
  assert.deepEqual([req.errors[0].loc!.line, req.errors[0].loc!.col, req.errors[0].pointer], [3, 3, '']);
  assert.equal(keyBefore('{"a\\\\": 1}', 8)?.join(), '1,6');
});

test('the sample: the page and Try an example show the same one', () => {
  const page = TOOL_PAGE_BY_SLUG.get('json-schema-validator')!;
  assert.equal(page.sample, SAMPLE_DOC);
  assert.equal(page.exampleSchema?.text, SAMPLE_SCHEMA);
  assert.equal(page.preset.schema, SAMPLE_SCHEMA);
  assert.equal(page.preset.initialText, SAMPLE_DOC);
});

test('the sample: six errors, in document order, with their messages', () => {
  const r = validateTexts({ doc: SAMPLE_DOC, schema: SAMPLE_SCHEMA, draft: null, formats: false });
  assert.equal(r.draft, 2020);
  assert.equal(r.draftFrom, 'schema');
  assert.deepEqual(
    r.errors.map((e) => `${e.pointer} ${e.loc!.line}:${e.loc!.col} ${errorText(e.code, e.params, EN)} ${e.path}`),
    [
      ' 1:1 Missing required property "email" /required',
      '/age 4:10 Expected integer, got string /properties/age/type',
      '/role 5:11 Must be one of: "admin", "editor", "viewer" /properties/role/enum',
      '/tags 6:11 Items 0 and 1 are equal: items must be unique /properties/tags/uniqueItems',
      '/balance 7:14 Must be a multiple of 0.01 /properties/balance/multipleOf',
      '/nickname 8:3 Property "nickname" is not allowed /additionalProperties',
    ],
  );
  assert.deepEqual(r.problems, []);
});

test('$id and $anchor resolve across embedded resources; relative refs use the nearest base', () => {
  const schema = {
    $id: 'https://example.com/root.json',
    type: 'object',
    properties: {
      home: { $ref: 'address.json' },
      work: { $ref: 'https://example.com/address.json#/properties/zip' },
      tag: { $ref: '#tag' },
      nested: { $ref: 'https://other.example/n/inner.json' },
      viaPointer: { $ref: '#/$defs/address/properties/zip' },
    },
    $defs: {
      address: { $id: 'address.json', type: 'object', required: ['zip'], properties: { zip: { $ref: '#zipcode' } }, $defs: { zip: { $anchor: 'zipcode', type: 'string', pattern: '^[0-9]{5}$' } } },
      tag: { $anchor: 'tag', enum: ['a', 'b'] },
      inner: { $id: 'https://other.example/n/inner.json', $ref: 'sibling.json' },
      sibling: { $id: 'https://other.example/n/sibling.json', type: 'boolean' },
    },
  };
  const ok = run(schema, { home: { zip: '12345' }, work: '54321', tag: 'a', nested: true, viaPointer: '00000' });
  assert.ok(ok.valid, JSON.stringify(ok.errors));
  assert.deepEqual(problems(ok), []);
  const bad = run(schema, { home: { zip: 'x' }, work: 5, tag: 'c', nested: 1, viaPointer: '1' });
  assert.deepEqual(bad.errors.map((e) => e.pointer).sort(), ['/home/zip', '/nested', '/tag', '/viaPointer', '/work'].sort());
  assert.equal(bad.errors.find((e) => e.pointer === '/home/zip')!.path, '/properties/home/$ref/properties/zip/$ref/pattern');
  // draft-07: plain-name fragments in $id, and $ref replaces its siblings.
  const d7 = { $schema: 'http://json-schema.org/draft-07/schema#', definitions: { a: { $id: '#foo', type: 'integer' } }, properties: { x: { $ref: '#foo', type: 'string' } } };
  assert.ok(run(d7, { x: 1 }).valid);
  assert.ok(!run(d7, { x: 'a' }).valid);
});

test('remote references are never fetched: reported as unresolved, the rest still checked', () => {
  const r = run({ properties: { a: { $ref: 'https://example.com/missing.json' }, b: { type: 'string' }, c: { $ref: '#/$defs/nope' }, d: { $ref: '#nowhere' } } }, { a: 1, b: 2, c: 3, d: 4 });
  assert.deepEqual(problems(r), ['unresolved', 'unresolved', 'unresolved']);
  assert.deepEqual(r.problems.map((p) => p.params.why), ['remote', 'pointer', 'anchor']);
  assert.equal(problemText('unresolved', r.problems[0].params, EN), "Can't resolve $ref https://example.com/missing.json: remote schemas are never fetched. Add it under $defs with its $id.");
  assert.deepEqual(codes(r), ['type']);
  assert.ok(r.problems.every((p) => !p.warn && p.loc));
  // The official meta-schemas aren't bundled either.
  assert.deepEqual(problems(run({ $ref: 'https://json-schema.org/draft/2020-12/schema' }, {})), ['unresolved']);
});

test('invalid schemas: each problem is located in the schema; the keyword is skipped', () => {
  const schema = '{\n  "minLength": -1,\n  "pattern": "(",\n  "type": "strng",\n  "required": "email",\n  "properties": 5,\n  "patternProperties": { "[": {} },\n  "multipleOf": 0,\n  "items": [true],\n  "nullable": true,\n  "prefixItem": [],\n  "prefixItem2": []\n}';
  const r = validateTexts({ schema, doc: '"x"', draft: null, formats: false });
  const got = r.problems.map((p) => `${p.code}:${p.params.kw ?? ''}:${p.loc?.line}:${p.warn ? 'w' : 'e'}`);
  assert.deepEqual([...got], ['badValue:minLength:2:e', 'badRegex:pattern:3:e', 'badValue:type:4:e', 'badValue:required:5:e', 'badValue:properties:6:e', 'badRegex:patternProperties:7:e', 'badValue:multipleOf:8:e', 'itemsArray2020::9:e', 'nullable::10:w', 'unknownKeyword:prefixItem:11:w', 'unknownKeyword:prefixItem2:12:w']);
  // Nothing failed, but the broken keywords weren't applied: not valid, not complete (review round 1, finding 2).
  assert.equal(r.total, 0);
  assert.ok(!r.valid && !r.complete);
  // A broken schema's JSON is its own state.
  const syn = validateTexts({ schema: '{ "type": }', doc: '1', draft: null, formats: false });
  assert.equal(syn.state, 'schema-syntax');
  assert.deepEqual([syn.schemaError!.loc.line, syn.schemaError!.loc.col], [1, 11]);
});

test('drafts: $schema decides, else the picker; keywords of another draft are named', () => {
  assert.equal(run({ $schema: 'http://json-schema.org/draft-07/schema#' }, 1).draft, 7);
  assert.equal(run({ $schema: 'http://json-schema.org/draft-04/schema' }, 1).draft, 4);
  assert.equal(run({}, 1, { draft: 6 }).draft, 6);
  assert.equal(run({}, 1, { draft: 6 }).draftFrom, 'picked');
  assert.equal(run({}, 1).draftFrom, 'default');
  const unknown = run({ $schema: 'https://example.com/my-meta' }, 1);
  assert.deepEqual(problems(unknown), ['unknownSchema']);
  assert.deepEqual(problems(run({ $schema: 'http://json-schema.org/draft-03/schema#' }, 1)), ['draft3']);
  const d7 = run({ $schema: 'http://json-schema.org/draft-07/schema#', prefixItems: [{ type: 'string' }], dependentRequired: { a: ['b'] } }, [1]);
  assert.deepEqual(d7.problems.map((p) => `${p.code} ${p.params.kw} ${p.params.draft}`), ['otherDraft prefixItems 2020-12', 'otherDraft dependentRequired 2019-09']);
  assert.ok(d7.valid, 'ignored in draft-07');
  assert.ok(!run({ prefixItems: [{ type: 'string' }] }, [1]).valid, 'read in 2020-12');
});

test('anyOf and oneOf that match nothing list the closest branch', () => {
  const schema = { anyOf: [{ type: 'string' }, { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }] };
  const r = run(schema, { id: 'x' });
  assert.deepEqual(codes(r), ['anyOf']);
  assert.deepEqual(r.errors[0].sub!.map((e) => `${e.code} ${e.pointer}`), ['type /id']);
  assert.equal(errorText('anyOf', r.errors[0].params, EN), 'Matches none of the 2 schemas in anyOf');
  const many = run({ oneOf: [{ type: 'integer' }, { minimum: 0 }] }, 3);
  assert.deepEqual(codes(many), ['oneOfMany']);
  assert.equal(errorText('oneOfMany', many.errors[0].params, EN), 'Matches more than one schema in oneOf (#0 and #1): it must match exactly one');
});

test('pathological schemas: $ref loops are problems, deep documents are refused, not crashes', () => {
  const loop = run({ $ref: '#' }, { a: 1 });
  assert.equal(loop.state, 'ok');
  assert.deepEqual(problems(loop), ['loop']);
  const mutual = run({ $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }, 1);
  assert.deepEqual(problems(mutual), ['loop']);
  // Recursion that moves into the document is no loop.
  const tree = { type: 'object', properties: { kids: { type: 'array', items: { $ref: '#' } } } };
  assert.ok(run(tree, { kids: [{ kids: [{ kids: [] }] }] }).valid);
  assert.ok(!run(tree, { kids: [{ kids: [{ kids: 'x' }] }] }).valid);
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  const r = validateTexts({ doc: deep, schema: JSON.stringify({ items: { $ref: '#' } }), draft: null, formats: false });
  assert.equal(r.state, 'too-deep');
  // uniqueItems on 200,000 items is linear (canonical keys in a map), not a pairwise comparison.
  const items = JSON.stringify(Array.from({ length: 200_000 }, (_, i) => ({ id: i, v: [i, String(i)] })));
  const t = performance.now();
  assert.ok(validateTexts({ doc: items, schema: '{"uniqueItems": true}', draft: null, formats: false }).valid);
  assert.ok(performance.now() - t < 5000);
});

test('JSON Lines are validated record by record; loose JSON is validated as repaired', () => {
  const r = validateTexts({ doc: '{"a":1}\n{"a":"x"}\n{"a":3}\n', schema: '{"properties":{"a":{"type":"integer"}}}', draft: null, formats: false });
  assert.equal(r.records, 3);
  assert.deepEqual(r.errors.map((e) => [e.record, e.pointer, e.loc!.line]), [[2, '/a', 2]]);
  const loose = validateTexts({ doc: '{\n  // note\n  "a": 1,\n}', schema: '{"required":["a"]}', draft: null, formats: false });
  assert.equal(loose.loose, 2);
  assert.ok(loose.valid);
  assert.equal(validateTexts({ doc: '{"a": }', schema: '{}', draft: null, formats: false }).state, 'doc-syntax');
});

test('format is an annotation unless asked; then the common formats are checked', () => {
  const s = { properties: { when: { format: 'date-time' }, mail: { format: 'email' }, ip: { format: 'ipv6' }, id: { format: 'uuid' }, at: { format: 'phone' } } };
  const doc = { when: '2026-02-30T10:00:00Z', mail: 'a..b@example.com', ip: '1::2::3', id: 'nope', at: 'x' };
  assert.ok(run(s, doc).valid);
  const r = run(s, doc, { formats: true });
  assert.deepEqual(r.errors.map((e) => e.params.format), ['date-time', 'email', 'ipv6', 'uuid']);
  assert.deepEqual(problems(r), ['unknownFormat']);
  assert.ok(run(s, { when: '2016-12-31T23:59:60Z', mail: '"a b"@[IPv6:::1]', ip: '::ffff:192.0.2.1', id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }, { formats: true }).valid);
  assert.equal(punyEncode([...'bücher'].map((c) => c.codePointAt(0)!)), 'bcher-kva');
  assert.equal(String.fromCodePoint(...punyDecode('bcher-kva')!), 'bücher');
});

test('URIs resolve as RFC 3986 says', () => {
  const base = 'http://a/b/c/d;p?q';
  for (const [ref, want] of [['g', 'http://a/b/c/g'], ['./g', 'http://a/b/c/g'], ['g/', 'http://a/b/c/g/'], ['/g', 'http://a/g'], ['//g', 'http://g'], ['?y', 'http://a/b/c/d;p?y'], ['#s', 'http://a/b/c/d;p?q#s'], ['../g', 'http://a/b/g'], ['../../../g', 'http://a/g'], ['g;x?y#s', 'http://a/b/c/g;x?y#s'], ['', 'http://a/b/c/d;p?q']]) {
    assert.equal(resolveUri(base, ref), want, ref);
  }
  assert.equal(resolveUri('urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed', '#/$defs/a'), 'urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed#/$defs/a');
  assert.equal(normalizeUri('HTTP://Example.COM/%7euser#'), 'http://example.com/~user');
});

test('compiling once: a validator answers many documents with its own state reset', () => {
  const v = new Validator(parse('{"type":"object","required":["a"],"unevaluatedProperties":false,"properties":{"a":{}}}').root!);
  assert.ok(v.validate(parse('{"a":1}').root!).valid);
  const r = v.validate(parse('{"b":1}').root!);
  assert.deepEqual(r.errors.map((e) => e.code), ['required', 'unevaluatedProperties']);
  assert.ok(v.validate(parse('{"a":2}').root!).valid);
  // Thousands of errors: the first `max` are kept, all are counted.
  const many = v.validate(parse(JSON.stringify(Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`k${i}`, i])))).root!, 100);
  assert.equal(many.errors.length, 100);
  assert.equal(many.total, 3001);
});

/** A fake worker: answers when the test says so. */
class FakePort implements Port {
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: WorkerRequest[] = [];
  dead = false;
  postMessage(m: WorkerRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.dead = true;
  }
  answer(i = this.sent.length - 1) {
    const m = this.sent[i];
    this.onmessage?.({ data: { id: m.id, result: { state: 'ok', valid: true, complete: true, errors: [], total: 0, problems: [], draft: 2020, draftFrom: 'default', ms: { parse: 0, compile: 0, validate: 0 }, ...({ tag: `${m.doc}|${m.schema}` } as object) } } as WorkerReply });
  }
}

test('client: the latest request wins, unchanged texts are not sent again, long runs give way, timeouts end', async () => {
  const ports: FakePort[] = [];
  let now = 0;
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  try {
    const c = new SchemaClient({ create: () => (ports.push(new FakePort()), ports.at(-1)!), yieldAfter: 300, limit: () => 1000 });
    const got: string[] = [];
    const req = (doc: string, schema = 'S') => ({ doc, schema, draft: null, formats: false });
    c.validate(req('D1'), (o) => got.push(typeof o === 'string' ? o : (o as unknown as { tag: string }).tag));
    // A second request while the first runs briefly: it waits; the first's result is dropped (out of date).
    now = 100;
    c.validate(req('D2'), (o) => got.push(typeof o === 'string' ? o : (o as unknown as { tag: string }).tag));
    assert.equal(ports.length, 1);
    assert.equal(ports[0].sent.length, 1);
    ports[0].answer(0);
    assert.deepEqual([...got], []);
    assert.equal(ports[0].sent.length, 2);
    // The schema didn't change: it isn't sent again.
    assert.equal(ports[0].sent[1].schema, null);
    ports[0].answer(1);
    assert.deepEqual([...got], ['D2|null']);
    // Same document, new schema: the document stays in the worker.
    c.validate(req('D2', 'S2'), (o) => got.push(typeof o === 'string' ? o : (o as unknown as { tag: string }).tag));
    assert.equal(ports[0].sent[2].doc, null);
    assert.equal(ports[0].sent[2].schema, 'S2');
    // A long run (past yieldAfter) gives way: the worker is ended and a new one gets the latest texts in full.
    now = 1000;
    c.validate(req('D3', 'S2'), (o) => got.push(typeof o === 'string' ? o : (o as unknown as { tag: string }).tag));
    assert.ok(ports[0].dead);
    assert.equal(ports.length, 2);
    assert.deepEqual([ports[1].sent[0].doc, ports[1].sent[0].schema], ['D3', 'S2']);
    ports[1].answer();
    assert.deepEqual([...got], ['D2|null', 'D3|S2']);
    // A run past its time limit is stopped and reported.
    c.validate(req('slow'), (o) => got.push(typeof o === 'string' ? o : 'result'));
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok(ports[1].dead);
    assert.equal(got.at(-1), 'timeout');
    // A crash is reported as a failure.
    c.validate(req('boom'), (o) => got.push(typeof o === 'string' ? o : 'result'));
    ports[2].onerror?.(new Error('x'));
    assert.equal(got.at(-1), 'failed');
    c.destroy();
    assert.equal(c.starts, 3);
  } finally {
    performance.now = realNow;
  }
});

test('speed: a 7.5 MB document (16,000 records) against a realistic schema, formats checked', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: { $ref: '#/$defs/order' },
    $defs: {
      order: {
        type: 'object',
        required: ['id', 'customer', 'items', 'total', 'status', 'created'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer', minimum: 1 },
          customer: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string', format: 'email' }, tags: { type: 'array', items: { type: 'string' }, uniqueItems: true } } },
          items: { type: 'array', minItems: 1, items: { type: 'object', required: ['sku', 'qty', 'price'], properties: { sku: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{4}$' }, qty: { type: 'integer', minimum: 1 }, price: { type: 'number', multipleOf: 0.01, exclusiveMinimum: 0 } } } },
          total: { type: 'number', multipleOf: 0.01 },
          status: { enum: ['new', 'paid', 'shipped', 'cancelled'] },
          created: { type: 'string', format: 'date-time' },
          note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  };
  const orders = Array.from({ length: 16_000 }, (_, i) => ({
    id: i + 1,
    customer: { name: `Customer ${i}`, email: `c${i}@example.com`, tags: ['a', 'b', `t${i % 7}`] },
    items: [{ sku: 'ABC-' + String(1000 + (i % 9000)).padStart(4, '0'), qty: 1 + (i % 5), price: 12.34 }, { sku: 'XYZ-0001', qty: 2, price: 0.99 }],
    total: 14.32,
    status: ['new', 'paid', 'shipped', 'cancelled'][i % 4],
    created: '2026-11-21T10:00:00Z',
    note: i % 3 ? null : 'gift',
  }));
  orders[9000].items[1].price = 0.999;
  const doc = JSON.stringify(orders, null, 2);
  const t = performance.now();
  const r = validateTexts({ doc, schema: JSON.stringify(schema), draft: null, formats: true });
  const ms = performance.now() - t;
  console.log(`speed: ${(doc.length / 1e6).toFixed(1)} MB, ${orders.length} records: ${ms.toFixed(0)} ms (parse ${r.ms.parse.toFixed(0)}, compile ${r.ms.compile.toFixed(1)}, validate ${r.ms.validate.toFixed(0)})`);
  assert.deepEqual(r.errors.map((e) => `${e.pointer} ${e.code}`), ['/9000/items/1/price multipleOf']);
  assert.ok(ms < 6000, `${ms.toFixed(0)} ms`);
});

// ── Review round 1 ──────────────────────────────────────────────────────────

test('finding 2: a schema that can\'t be applied gives no success: not fully checked, the skipped parts named', () => {
  const remote = run({ $ref: 'https://example.test/missing' }, { a: 1 });
  assert.equal(remote.state, 'ok');
  assert.deepEqual([remote.valid, remote.complete, remote.total], [false, false, 0]);
  assert.deepEqual(remote.problems.map((p) => [p.code, p.reached]), [['unresolved', true]]);
  const number = run('42', '{}');
  assert.deepEqual([number.valid, number.complete], [false, false]);
  assert.deepEqual(number.problems.map((p) => [p.code, p.reached]), [['notSchema', true]]);
  // An unresolved ref in one anyOf branch: incomplete only when that branch decides.
  const branch = { anyOf: [{ type: 'string' }, { $ref: 'https://example.test/missing' }] };
  assert.deepEqual([run(branch, '"a"').valid, run(branch, '"a"').complete], [true, true]);
  assert.deepEqual([run(branch, '1').valid, run(branch, '1').complete, run(branch, '1').total], [false, false, 0]);
  // Where a pass decides against the document, a skipped part is no evidence: no false error.
  const not = run({ not: { $ref: 'https://example.test/missing' } }, '1');
  assert.deepEqual([not.total, not.valid, not.complete], [0, false, false]);
  const iff = run({ if: { $ref: 'https://example.test/missing' }, then: { type: 'string' }, else: { type: 'number' } }, 'true');
  assert.deepEqual([iff.total, iff.complete], [0, false]);
  const one = run({ oneOf: [{ type: 'number' }, { $ref: 'https://example.test/missing' }] }, '1');
  assert.deepEqual([one.total, one.complete], [0, false]);
  const contains = run({ contains: { $ref: 'https://example.test/missing' } }, '[1]');
  assert.deepEqual([contains.total, contains.complete], [0, false]);
  const uneval = run({ $ref: 'https://example.test/missing', unevaluatedProperties: false }, '{"a": 1}');
  assert.deepEqual([uneval.total, uneval.complete], [0, false]);
  // A definite failure is still reported past a skipped part.
  const both = run({ allOf: [{ $ref: 'https://example.test/missing' }, { type: 'string' }] }, '1');
  assert.deepEqual([both.errors.map((e) => e.code), both.complete], [['type'], false]);
  // A broken keyword counts only for the values it applies to.
  const broken = { properties: { s: { minLength: -1 }, n: { minLength: -1 } } };
  assert.deepEqual([run(broken, '{"n": 1}').valid, run(broken, '{"n": 1}').complete], [true, true]);
  assert.deepEqual([run(broken, '{"s": "x"}').valid, run(broken, '{"s": "x"}').complete], [false, false]);
  // A $ref loop. (A multipleOf far in scale is worked out since round 2: see finding 9's test.)
  assert.deepEqual([run({ $ref: '#' }, '1').valid, run({ $ref: '#' }, '1').complete], [false, false]);
  const far = run({ multipleOf: 7 }, '1e' + '1'.repeat(30200));
  assert.deepEqual([far.valid, far.complete, far.errors.map((e) => e.code), far.problems], [false, true, ['multipleOf'], []]);
});

test('finding 10: required with 24,000 keys is linear, not quadratic', () => {
  const keys = Array.from({ length: 24_000 }, (_, i) => `k${i}`);
  const v = new Validator(parse(JSON.stringify({ required: keys, dependentRequired: { k0: keys.slice(0, 2000) } })).root!);
  const doc = parse(JSON.stringify(Object.fromEntries(keys.map((k, i) => [k, i])))).root!;
  const t = performance.now();
  const r = v.validate(doc);
  const ms = performance.now() - t;
  console.log(`required × 24,000: ${ms.toFixed(1)} ms`);
  assert.ok(r.valid);
  // (Measured 2.33 s before the per-object lookup; about 10 ms after.)
  assert.ok(ms < 300, `${ms.toFixed(0)} ms`);
});

test('finding 12: errors from failed applications and the unevaluated* errors they no longer hide', () => {
  const props = run({ allOf: [{ properties: { x: { type: 'number' } } }], unevaluatedProperties: false }, { x: 's' });
  assert.deepEqual(props.errors.map((e) => `${e.code} ${e.pointer}`), ['type /x', 'unevaluatedProperties /x']);
  const items = run({ allOf: [{ prefixItems: [{ type: 'number' }] }], unevaluatedItems: false }, ['s']);
  assert.deepEqual(items.errors.map((e) => `${e.code} ${e.pointer}`), ['type /0', 'unevaluatedItems /0']);
  const ref = run({ $defs: { x: { properties: { x: { type: 'number' } } } }, $ref: '#/$defs/x', unevaluatedProperties: false }, { x: 's' });
  assert.deepEqual(ref.errors.map((e) => e.code), ['type', 'unevaluatedProperties']);
});

test('finding 13: a false subschema is located at itself, with its keyword\'s message', () => {
  const schema = JSON.stringify({ properties: { x: false }, additionalProperties: false, prefixItems: [true, false] }, null, 2);
  const r = validateTexts({ schema, doc: '{"x": 0, "y": 1}', draft: null, formats: false });
  assert.deepEqual(r.errors.map((e) => [e.path, e.code, schema.slice(e.schemaLoc!.p, e.schemaLoc!.e)]), [
    ['/properties/x', 'false', '"x"'],
    ['/additionalProperties', 'additionalProperties', '"additionalProperties"'],
  ]);
  const arr = validateTexts({ schema, doc: '[1, 2]', draft: null, formats: false });
  assert.deepEqual(arr.errors.map((e) => [e.path, e.code, schema.slice(e.schemaLoc!.p, e.schemaLoc!.e)]), [['/prefixItems/1', 'false', 'false']]);
});
