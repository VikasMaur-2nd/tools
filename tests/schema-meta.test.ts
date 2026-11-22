import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META_URLS, metaUrl } from '../lib/schema/meta';
import { SchemaSession, validateTexts, type Draft, type ValidateResult } from '../lib/schema/index';
import type { WorkerReply, WorkerRequest } from '../lib/schema/schema.worker';
import { problemText } from '../components/schema-messages';
import { EN } from '../lib/i18n/ui';

/*
 * The official meta-schemas that come with the validator (lib/schema/meta.ts, lib/schema/meta/meta-schemas.json,
 * copied by scripts/meta-schemas.mjs, which pins the files as json-schema.org serves them).
 */

const FILE = join(process.cwd(), 'lib/schema/meta/meta-schemas.json');
const text = readFileSync(FILE, 'utf8');
const file = JSON.parse(text) as { $comment: string; license: string; schemas: Record<string, Record<string, unknown>> };
const texts = Object.fromEntries(Object.entries(file.schemas).map(([u, s]) => [u, JSON.stringify(s)]));

/** SHA-256 of each minified meta-schema (JSON.stringify of the file served: the same content, its key order kept). */
const MINIFIED: Record<string, string> = {
  'https://json-schema.org/draft-04/schema': '443115904cb0463f3b5740d98a6999326eeb46c57c78d7f6930f8be57ff0761b',
  'https://json-schema.org/draft-06/schema': '74ae8b776c3f884d5b281d28848970dec3ef5066cfc74d5e641206769caa3824',
  'https://json-schema.org/draft-07/schema': 'e98a8c2d5b19186b8580b4375df55a8349313daef6a04f6e84f0c79b4348a2dd',
  'https://json-schema.org/draft/2019-09/schema': '6458c3ee872467927f10de878ef78176802bc14f52c87c72eab8423b0eea4970',
  'https://json-schema.org/draft/2019-09/meta/core': '787e4ddc7a1507825d82759cf0f6b4f464014fd0901aeee82b0e0875f779fb89',
  'https://json-schema.org/draft/2019-09/meta/applicator': 'ae69560626cbe88ea2ced64b2de9ff3460706d72ba9d84daffe8c5588cfbfa1c',
  'https://json-schema.org/draft/2019-09/meta/validation': '525bd92d6adc10808b2db0e7b8b882dd727680aa482f00f90708acb2b2e84e3f',
  'https://json-schema.org/draft/2019-09/meta/meta-data': '9032f5a5eba73a46d6a31f3f3b60bfa331b3b7c049c27f9ead29e95de7c993f8',
  'https://json-schema.org/draft/2019-09/meta/format': 'f2d1391b149333bb84e63eb3e1950f5a52668a26c2728e4ff621d5797c491874',
  'https://json-schema.org/draft/2019-09/meta/content': '503df8b11d759701636097ae6ea18b3f2e278b6e8f5a5c96025e5632b0ebbec5',
  'https://json-schema.org/draft/2020-12/schema': 'b5c4ec400eecde90b235dedfee94bac94d049001ccbbf8a4c3c72a1cb551fa6b',
  'https://json-schema.org/draft/2020-12/meta/core': '41eb0012acf1e4e2b455ed6e8b61898499f415ca0eebd0a635b66acc87358d33',
  'https://json-schema.org/draft/2020-12/meta/applicator': 'bbe84d8909770615b0c96480248472e03b378903a7b1535cb1a8be6576936c53',
  'https://json-schema.org/draft/2020-12/meta/unevaluated': '46c30fa745e481d26c16d5b176d85556c1b92da502e105b98d69bd4ff5a2884d',
  'https://json-schema.org/draft/2020-12/meta/validation': '32c10a1954ca8f4b3c8f7f53d763d02c8952011c59e8cfef22c93660d89083bf',
  'https://json-schema.org/draft/2020-12/meta/meta-data': '0001d863aeabb770a9000608b9ff6bde5056c96bac7af8eef218eb8129b6a39f',
  'https://json-schema.org/draft/2020-12/meta/format-annotation': '970d840f48fa65d6a50c786d52dc374c98e1e85d8d2782117079205fdf55ff41',
  'https://json-schema.org/draft/2020-12/meta/content': 'a66fde6785d3d24983344d8eb809826995468e64125182a1aea461f269528094',
};

const session = new SchemaSession();
session.setMeta(texts);
const check = (schema: unknown, doc: unknown, draft: Draft | null = null): ValidateResult => session.run({ schema: JSON.stringify(schema), doc: JSON.stringify(doc), draft, formats: false });
/** What a result says, in short: valid, complete, its errors' pointers (every one, nested ones included), its problems' codes. */
const say = (r: ValidateResult) => {
  const at: string[] = [];
  const walk = (es: ValidateResult['errors']) => es.forEach((e) => (e.sub ? walk(e.sub) : at.push(e.pointer)));
  walk(r.errors);
  return { valid: r.valid, complete: r.complete, at: [...new Set(at)].sort(), problems: r.problems.map((p) => p.code), remote: r.remote };
};
const ok = { valid: true, complete: true, at: [], problems: [], remote: undefined };
const bad = (...at: string[]) => ({ valid: false, complete: true, at: at.sort(), problems: [], remote: undefined });

test('the meta-schemas are the official files, minified, pinned, with their source and licence', () => {
  assert.deepEqual(Object.keys(file.schemas), META_URLS);
  assert.equal(META_URLS.length, 18);
  assert.equal(text, JSON.stringify(file) + '\n');
  for (const url of META_URLS) assert.equal(createHash('sha256').update(texts[url]).digest('hex'), MINIFIED[url], url);
  // Each names itself: its id is its URL (http for the drafts before 2019-09, as theirs are).
  for (const [url, s] of Object.entries(file.schemas)) assert.equal(metaUrl(String(s.$id ?? s.id)), url);
  // The script that copies them pins the same files.
  const script = readFileSync(join(process.cwd(), 'scripts/meta-schemas.mjs'), 'utf8');
  assert.deepEqual([...script.matchAll(/^ {2}'(https:[^']+)': '([0-9a-f]{64})',$/gm)].map((m) => m[1]), META_URLS);
  // Source and licence, in the file: the BSD 3-Clause notice in full (copyright, conditions, disclaimer).
  assert.match(file.$comment, /https:\/\/json-schema\.org .*json-schema-org\/json-schema-spec.*BSD 3-Clause License or the Academic Free License v3\.0; used here under the BSD 3-Clause License/);
  assert.match(file.license, /^Copyright \(c\) 2022 JSON Schema Specification Authors\n\nRedistribution and use in source and binary forms/);
  assert.match(file.license, /3\. Neither the name of the copyright holder[\s\S]*THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS[\s\S]*EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE\.$/);
  assert.match(readFileSync(join(process.cwd(), 'lib/schema/meta/LICENSE'), 'utf8'), /Academic Free License version 3\.0/);
});

test('a meta-schema is named by http or https, in any case, with or without # or a fragment', () => {
  const d7 = 'https://json-schema.org/draft-07/schema';
  for (const u of ['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft-07/schema', 'HTTP://JSON-Schema.ORG/draft-07/schema#/definitions/x', ' https://json-schema.org/draft-07/schema# ']) assert.equal(metaUrl(u), d7, u);
  assert.equal(metaUrl('http://json-schema.org/draft/2020-12/meta/core#/$defs/anchorString'), 'https://json-schema.org/draft/2020-12/meta/core');
  for (const u of ['https://json-schema.org/draft-07/schema/', 'https://json-schema.org/draft-03/schema#', 'https://json-schema.org/draft/2020-12/meta/format-assertion', 'https://json-schema.org/draft/2020-12/links', 'https://example.com/draft-07/schema', 'urn:x', '#/$defs/a']) assert.equal(metaUrl(u), null, u);
});

test('a $ref to each meta-schema resolves by http and https, with or without #: nothing offered for fetching', () => {
  for (const url of META_URLS) {
    for (const ref of [url, url + '#', url.replace('https:', 'http:'), url.replace('https:', 'http:') + '#']) {
      assert.deepEqual(say(check({ $ref: ref }, {})), ok, ref);
      assert.deepEqual(say(check({ $ref: ref }, 'not a schema')), bad(''), ref);
    }
  }
  // Into one, by JSON Pointer or anchor, through either scheme (an https id read by http, an http one by https).
  assert.deepEqual([say(check({ $ref: 'https://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger' }, 3)), say(check({ $ref: 'https://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger' }, -1))], [ok, bad('')]);
  assert.deepEqual([say(check({ $ref: 'http://json-schema.org/draft-04/schema#/definitions/positiveInteger' }, 0)), say(check({ $ref: 'http://json-schema.org/draft-04/schema#/definitions/positiveInteger' }, 1.5))], [ok, bad('')]);
  assert.deepEqual([say(check({ $ref: 'http://json-schema.org/draft/2020-12/meta/core#/$defs/anchorString' }, 'a-b')), say(check({ $ref: 'http://json-schema.org/draft/2020-12/meta/core#/$defs/anchorString' }, '1a'))], [ok, bad('')]);
  assert.deepEqual(say(check({ $ref: 'https://json-schema.org/draft/2019-09/meta/validation#/$defs/nonNegativeInteger' }, -1)), bad(''));
  assert.deepEqual(say(check({ $ref: 'HTTPS://JSON-SCHEMA.ORG/draft/2020-12/schema#meta' }, { minLength: -1 })), bad('/minLength'));
  // The same meta-schema by both schemes in one schema, either first: one resource, its anchors included.
  const both = ['https://json-schema.org/draft/2020-12/schema#meta', 'http://json-schema.org/draft/2020-12/schema#meta'];
  for (const refs of [both, [...both].reverse()]) assert.deepEqual(say(check({ allOf: refs.map(($ref) => ({ $ref })) }, { type: 'nope' })), bad('/type'), refs[0]);
  assert.deepEqual(say(check({ allOf: [{ $ref: 'http://json-schema.org/draft-07/schema#' }, { $ref: 'https://json-schema.org/draft-07/schema#/definitions/simpleTypes' }] }, 'string')), bad(''));
  // A fragment that isn't there is still reported, as in any schema.
  assert.deepEqual(say(check({ $ref: 'https://json-schema.org/draft-07/schema#/definitions/nope' }, 1)).problems, ['unresolved']);
});

test('a schema checked against its own draft’s meta-schema through $ref: every draft', () => {
  const cases: [string, Draft, [unknown, string[] | null][]][] = [
    ['http://json-schema.org/draft-04/schema#', 4, [
      [{ id: 'http://x.test/s', type: 'object', properties: { a: { type: ['string', 'null'], minLength: 1 } }, required: ['a'], definitions: { p: { enum: [1] } } }, null],
      [{ maximum: 5, exclusiveMaximum: true }, null],
      [{ type: 'objekt' }, ['/type']],
      [{ exclusiveMaximum: true }, ['']],
      [{ required: [] }, ['/required']],
      [{ minimum: 1, exclusiveMinimum: 5 }, ['/exclusiveMinimum']],
      [{ properties: { a: true } }, ['/properties/a']],
      [{ properties: { a: { items: { minLength: -1 } } } }, ['/properties/a/items/minLength']],
    ]],
    ['http://json-schema.org/draft-06/schema#', 6, [
      [{ exclusiveMinimum: 5, examples: [1], propertyNames: { pattern: '^a' }, contains: true, properties: { a: false } }, null],
      [{ exclusiveMinimum: true }, ['/exclusiveMinimum']],
      [{ examples: 1 }, ['/examples']],
      [{ items: { const: 1, minItems: -2 } }, ['/items/minItems']],
    ]],
    ['http://json-schema.org/draft-07/schema#', 7, [
      [{ if: { const: 1 }, then: true, else: false, contentMediaType: 'application/json', $comment: 'x', readOnly: true }, null],
      [{ if: 1 }, ['/if']],
      [{ readOnly: 'yes' }, ['/readOnly']],
      [{ definitions: { a: { type: 'nope' } } }, ['/definitions/a/type']],
      [{ allOf: [] }, ['/allOf']],
    ]],
    // ($recursiveRef: a subschema is checked against the whole meta-schema, its validation keywords too.)
    ['https://json-schema.org/draft/2019-09/schema', 2019, [
      [{ $defs: { a: { $anchor: 'x', type: 'string' } }, dependentRequired: { a: ['b'] }, unevaluatedProperties: false, $recursiveAnchor: true, items: [{ format: 'date' }] }, null],
      [{ properties: { a: { minLength: -1 } } }, ['/properties/a/minLength']],
      [{ items: [{ type: 'nope' }] }, ['/items/0/type']],
      [{ $anchor: '1bad' }, ['/$anchor']],
      [{ dependentRequired: { a: 'b' } }, ['/dependentRequired/a']],
      [{ unevaluatedItems: { contentEncoding: 1 } }, ['/unevaluatedItems/contentEncoding']],
      [{ allOf: [{ deprecated: 'x' }] }, ['/allOf/0/deprecated']],
    ]],
    // ($dynamicRef: the same, through "#meta".)
    ['https://json-schema.org/draft/2020-12/schema', 2020, [
      [{ prefixItems: [{ type: 'string' }], items: false, $dynamicAnchor: 'x', $defs: { a: { $ref: '#' } }, dependentSchemas: { a: { required: ['b'] } } }, null],
      [{ properties: { a: { minLength: -1 } } }, ['/properties/a/minLength']],
      [{ prefixItems: [] }, ['/prefixItems']],
      [{ items: [{}] }, ['/items']],
      [{ $defs: { a: { $dynamicAnchor: '1bad' } } }, ['/$defs/a/$dynamicAnchor']],
      [{ unevaluatedProperties: { not: { maxContains: -1 } } }, ['/unevaluatedProperties/not/maxContains']],
      [{ propertyNames: { format: 5 }, contentEncoding: 1, deprecated: 'x' }, ['/contentEncoding', '/deprecated', '/propertyNames/format']],
    ]],
  ];
  for (const [url, draft, docs] of cases) {
    // As $schema names it and a $ref to it (from 2019-09 a $ref sits beside other keywords), and as a $ref alone.
    for (const schema of [{ $schema: url, $ref: url }, { $ref: url }]) {
      for (const [doc, at] of docs) {
        const r = check(schema, doc, draft);
        assert.deepEqual(say(r), at ? bad(...at) : ok, `${url} ${JSON.stringify(doc)}`);
      }
    }
  }
});

test('$recursiveRef and $dynamicRef: a meta-schema that extends the official one applies to every subschema', () => {
  const docs = [{ title: 'ok', properties: { a: { title: 'ok' } } }, { properties: { a: { title: 'too long' } } }, { properties: { a: { minLength: -1 } } }];
  const strict = (d: 2019 | 2020, anchor: boolean) => ({
    $schema: `https://json-schema.org/draft/${d}-${d === 2019 ? '09' : '12'}/schema`,
    $id: 'https://example.test/strict',
    ...(anchor && (d === 2019 ? { $recursiveAnchor: true } : { $dynamicAnchor: 'meta' })),
    $ref: `http://json-schema.org/draft/${d}-${d === 2019 ? '09' : '12'}/schema`,
    properties: { title: { maxLength: 5 } },
  });
  for (const d of [2019, 2020] as const) {
    assert.deepEqual(docs.map((doc) => say(check(strict(d, true), doc))), [ok, bad('/properties/a/title'), bad('/properties/a/minLength')], `${d}`);
    // Without the anchor, the official meta-schema's subschemas come back to itself: only the top title is limited.
    assert.deepEqual(docs.map((doc) => say(check(strict(d, false), doc))), [ok, ok, bad('/properties/a/minLength')], `${d} without the anchor`);
  }
});

test('a vocabulary’s meta-schema named by $schema sets its draft, with no warning', () => {
  const r = check({ $schema: 'https://json-schema.org/draft/2019-09/meta/validation', minLength: 2, prefixItems: [false] }, 'x');
  assert.deepEqual([r.draft, r.draftFrom, say(r)], [2019, 'schema', { ...bad(''), problems: ['otherDraft'] }]);
  const h = check({ $schema: 'http://json-schema.org/draft/2020-12/meta/applicator#', items: false }, [1]);
  assert.deepEqual([h.draft, h.draftFrom, say(h)], [2020, 'schema', bad('/0')]);
  // Without the meta-schemas, the same $schema is unknown (read as the picked draft), as before.
  const none = validateTexts({ schema: JSON.stringify({ $schema: 'https://json-schema.org/draft/2019-09/meta/validation' }), doc: '1', draft: null, formats: false });
  assert.deepEqual([none.draft, none.draftFrom, none.problems.map((p) => p.code)], [2020, 'default', ['unknownSchema']]);
});

test('without the meta-schemas, a $ref to one says its copy didn’t load: never offered for fetching', () => {
  const s = new SchemaSession();
  const req = { schema: JSON.stringify({ properties: { a: { $ref: 'http://json-schema.org/draft-07/schema#' } }, $ref: 'https://other.test/s.json' }), doc: '{"a": {}}', draft: null, formats: false };
  assert.equal(s.wantsMeta(req), true);
  const r = s.run(req);
  assert.deepEqual([r.complete, r.remote], [false, ['https://other.test/s.json']]);
  const meta = r.problems.find((p) => p.params.uri === 'http://json-schema.org/draft-07/schema')!;
  assert.equal(problemText('unresolved', meta.params, EN), "Can't resolve $ref http://json-schema.org/draft-07/schema#: the app's copy of the official meta-schema http://json-schema.org/draft-07/schema didn't load. Check your connection; it's tried again with your next change.");
  // Given them, nothing more is wanted, and the same request resolves.
  s.setMeta(texts);
  assert.equal(s.wantsMeta(req), false);
  const after = s.run(req);
  assert.deepEqual([after.remote, after.problems.map((p) => p.params.uri)], [['https://other.test/s.json'], ['https://other.test/s.json']]);
  // A schema that names none wants none, nor does an empty or broken one.
  const plain = new SchemaSession();
  for (const schema of ['{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}', '', '{"$ref": ']) assert.equal(plain.wantsMeta({ schema, doc: '', draft: null, formats: false }), false, schema);
});

test('the worker fetches the meta-schemas from the app the first time a schema names one, and once', async () => {
  const g = globalThis as unknown as { self?: unknown; fetch: typeof fetch };
  const posted: WorkerReply[] = [];
  const port = { onmessage: null as ((e: { data: WorkerRequest }) => Promise<void>) | null, postMessage: (m: WorkerReply) => void posted.push(m) };
  const realFetch = g.fetch;
  const asked: string[] = [];
  let offline = true;
  g.self = port;
  g.fetch = (async (u: string | URL) => {
    asked.push(String(u));
    if (offline) throw new TypeError('Failed to fetch');
    return new Response(readFileSync(FILE));
  }) as typeof fetch;
  try {
    await import('../lib/schema/schema.worker');
    const send = async (id: number, schema: string | null, doc: string | null) => {
      await port.onmessage!({ data: { id, doc, schema, draft: null, formats: false, max: 1000, resources: null } });
      const m = posted.find((p) => p.id === id)!;
      assert.ok('result' in m);
      return m.result;
    };
    // None named: nothing fetched.
    assert.equal((await send(1, '{"type": "object"}', '{}')).valid, true);
    assert.deepEqual(asked, []);
    // Named, but the copy can't load (offline): said so, not offered, and tried again with the next request.
    const off = await send(2, '{"$ref": "http://json-schema.org/draft-07/schema#"}', '{"minLength": -1}');
    assert.deepEqual([off.complete, off.remote, off.problems.map((p) => p.params.why)], [false, undefined, ['meta']]);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /\/lib\/schema\/meta\/meta-schemas\.json$/);
    offline = false;
    const on = await send(3, null, null);
    assert.deepEqual(say(on), bad('/minLength'));
    assert.equal(asked.length, 2);
    // Loaded once for the worker's life.
    assert.deepEqual(say(await send(4, '{"$ref": "https://json-schema.org/draft/2020-12/schema"}', '{"type": 1}')), bad('/type'));
    assert.equal(asked.length, 2);
  } finally {
    g.fetch = realFetch;
    delete g.self;
  }
});
