import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOTE_MAX_BYTES, REMOTE_MAX_COUNT, fetchSchemas, type FetchEnv } from '../lib/schema/remote';
import { validateTexts, type ValidateResult } from '../lib/schema/index';
import { SchemaClient, type Port } from '../lib/schema/client';
import type { WorkerRequest } from '../lib/schema/schema.worker';
import { problemText } from '../components/schema-messages';
import { EN } from '../lib/i18n/ui';

// Remote $refs (lib/schema/remote.ts, lib/schema/index.ts): fetched only when asked (the controller's tests), each
// document once, with a reason for each failure; what came resolves as a resource of the schema, for every draft.

type Reply = Response | Error | ((init?: RequestInit) => Promise<Response>);
/** A page's fetch answering from `site` (URL → reply), noting what was asked. */
function env(site: Record<string, Reply>, more: Partial<FetchEnv> = {}) {
  const asked: { url: string; mode?: string; credentials?: string; cache?: string }[] = [];
  const e: FetchEnv = {
    fetch: (async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      asked.push({ url, mode: init?.mode, credentials: init?.credentials, cache: init?.cache });
      const r = site[url];
      if (r === undefined) throw new TypeError('Failed to fetch');
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return r(init);
      return r.clone();
    }) as typeof fetch,
    online: () => true,
    protocol: 'https:',
    ...more,
  };
  return { env: e, asked };
}
const json = (v: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(v), { status: 200, ...init });
const run = (urls: string[], e: FetchEnv, signal = new AbortController().signal) => fetchSchemas(urls, signal, () => undefined, e);

test('each document once (fragments stripped), in the order asked, without cookies', async () => {
  const { env: e, asked } = env({ 'https://a.test/s.json': json({ type: 'string' }), 'https://b.test/t.json': json({ minimum: 0 }) });
  const got = await run(['https://a.test/s.json#/$defs/x', 'https://b.test/t.json', 'https://a.test/s.json'], e);
  assert.deepEqual(got, [
    { url: 'https://a.test/s.json', text: '{"type":"string"}' },
    { url: 'https://b.test/t.json', text: '{"minimum":0}' },
  ]);
  assert.deepEqual(asked.map((a) => [a.url, a.credentials]), [['https://a.test/s.json', 'omit'], ['https://b.test/t.json', 'omit']]);
});

test('schemas are fetched past the service worker\'s cache (no-store), the CORS probe too (review 2, finding 2)', async () => {
  const { env: e, asked } = env({
    'https://a.test/s.json': json({}),
    'https://cors.test/s': (init) => (init?.mode === 'no-cors' ? Promise.resolve(new Response(null, { status: 200 })) : Promise.reject(new TypeError('Failed to fetch'))),
  });
  await run(['https://a.test/s.json', 'https://cors.test/s'], e);
  assert.deepEqual(asked.map((a) => [a.url, a.mode, a.cache]), [['https://a.test/s.json', undefined, 'no-store'], ['https://cors.test/s', undefined, 'no-store'], ['https://cors.test/s', 'no-cors', 'no-store']]);
});

test('why each failed: a status, CORS, unreachable, offline, http on an https page, not JSON, too big, cut short', async () => {
  const big = 'x'.repeat(1024);
  const { env: e } = env({
    'https://a.test/404': new Response('no', { status: 404, statusText: 'Not Found' }),
    'https://cors.test/s': (init) => (init?.mode === 'no-cors' ? Promise.resolve(new Response(null, { status: 200 })) : Promise.reject(new TypeError('Failed to fetch'))),
    'https://a.test/html': new Response('<!doctype html><p>hi'),
    'https://a.test/big': new Response(big, { headers: { 'content-length': String(REMOTE_MAX_BYTES + 1) } }),
    'https://a.test/stream': () => Promise.resolve(new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); } }))),
    'https://a.test/cut': () => Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a"')); c.error(new TypeError('network')); } }))),
  });
  const got = await run(['https://a.test/404', 'https://cors.test/s', 'https://down.test/s', 'http://plain.test/s', 'https://a.test/html', 'https://a.test/big', 'https://a.test/stream', 'https://a.test/cut'], e);
  assert.deepEqual(got!.map((r) => ('failure' in r ? r.failure : 'ok')), [
    { kind: 'status', status: 404, statusText: 'Not Found' },
    { kind: 'cors' },
    { kind: 'unreachable' },
    { kind: 'mixed' },
    { kind: 'notJson' },
    { kind: 'tooBig' },
    { kind: 'tooBig' },
    { kind: 'dropped' },
  ]);
  // Offline: said so, nothing probed. http on this device is allowed from an https page.
  const off = env({}, { online: () => false });
  assert.deepEqual(await run(['https://a.test/s'], off.env), [{ url: 'https://a.test/s', failure: { kind: 'offline' } }]);
  const local = env({ 'http://localhost:8080/s.json': json({}) });
  assert.deepEqual(await run(['http://localhost:8080/s.json'], local.env), [{ url: 'http://localhost:8080/s.json', text: '{}' }]);
});

test('a slow server times out; stopping drops everything (null), at most the cap per call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hang = (init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const { env: e } = env({ 'https://slow.test/s': hang });
  const p = run(['https://slow.test/s'], e);
  await Promise.resolve();
  t.mock.timers.tick(20_000);
  assert.deepEqual(await p, [{ url: 'https://slow.test/s', failure: { kind: 'timeout' } }]);
  t.mock.timers.reset();
  const stop = new AbortController();
  const q = run(['https://slow.test/s'], env({ 'https://slow.test/s': hang }).env, stop.signal);
  stop.abort();
  assert.equal(await q, null);
  const many = Array.from({ length: 30 }, (_, i) => `https://a.test/${i}`);
  const all = env(Object.fromEntries(many.map((u) => [u, json({})])));
  assert.equal((await run(many, all.env))!.length, REMOTE_MAX_COUNT);
});

test('fetched schemas resolve as resources of the schema: their $id, embedded resources, their own draft', () => {
  const v = (schema: object, doc: unknown, resources: Record<string, string>) => validateTexts({ schema: JSON.stringify(schema), doc: JSON.stringify(doc), draft: null, formats: false, resources });
  // Not fetched: not fully checked, the URL offered (no fragment), a message that says it can be fetched.
  const before = v({ $ref: 'https://a.test/s.json#/$defs/n' }, 'x', {});
  assert.deepEqual([before.valid, before.complete, before.remote], [false, false, ['https://a.test/s.json']]);
  assert.match(problemText('unresolved', before.problems[0].params, EN), /isn't fetched yet\. Use Fetch referenced schemas/);
  // Fetched: resolved, by pointer, by anchor, through an embedded resource's $id, and its own $id.
  const doc = JSON.stringify({ $id: 'https://cdn.test/s.json', $defs: { n: { type: 'number' }, a: { $anchor: 'str', type: 'string' }, e: { $id: 'https://e.test/inner', type: 'boolean' } } });
  const res = { 'https://a.test/s.json': doc };
  assert.deepEqual([v({ $ref: 'https://a.test/s.json#/$defs/n' }, 1, res).valid, v({ $ref: 'https://a.test/s.json#/$defs/n' }, 'x', res).valid], [true, false]);
  assert.equal(v({ $ref: 'https://a.test/s.json#str' }, 'x', res).valid, true);
  assert.equal(v({ $ref: 'https://a.test/s.json', allOf: [{ $ref: 'https://e.test/inner' }] }, true, res).valid, true);
  assert.equal(v({ $ref: 'https://a.test/s.json', allOf: [{ $ref: 'https://cdn.test/s.json#/$defs/n' }] }, 1, res).remote, undefined);
  // A fetched schema's own $schema decides its draft (draft-04 reads the boolean exclusiveMaximum).
  const d4 = { 'https://a.test/d4.json': JSON.stringify({ $schema: 'http://json-schema.org/draft-04/schema#', maximum: 5, exclusiveMaximum: true }) };
  assert.equal(v({ $ref: 'https://a.test/d4.json' }, 5, d4).valid, false);
  // Draft-07: $ref with siblings ignored, in the referring schema; a fetched one in draft-07 too.
  const d7 = validateTexts({ schema: JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', properties: { a: { $ref: 'https://a.test/s.json#/$defs/n' } } }), doc: '{"a": "x"}', draft: null, formats: false, resources: res });
  assert.deepEqual([d7.valid, d7.errors.map((e) => e.pointer)], [false, ['/a']]);
  // What a fetched schema refers to in turn is offered next, never fetched with it.
  const chain = v({ $ref: 'https://a.test/c.json' }, 1, { 'https://a.test/c.json': JSON.stringify({ $ref: 'https://b.test/next.json' }) });
  assert.deepEqual([chain.complete, chain.remote], [false, ['https://b.test/next.json']]);
  // A problem in a fetched schema says where: its URL, no place in the schema text; its errors have no schema place.
  const broken = v({ $ref: 'https://a.test/b.json' }, 'x', { 'https://a.test/b.json': JSON.stringify({ type: 'number', minLength: -1 }) });
  assert.deepEqual(broken.problems.map((p) => [p.code, p.doc, p.loc]), [['badValue', 'https://a.test/b.json', null]]);
  assert.deepEqual(broken.errors.map((e) => [e.code, e.schemaLoc]), [['type', null]]);
  // A $ref to a name that isn't a web address isn't offered.
  const urn = v({ $ref: 'urn:example:thing' }, 1, {});
  assert.deepEqual([urn.remote, problemText('unresolved', urn.problems[0].params, EN)], [undefined, "Can't resolve $ref urn:example:thing: it isn't part of this schema. Add it under $defs with its $id."]);
});

test('the worker gets the fetched schemas once, then only when one more comes', () => {
  const sent: WorkerRequest[] = [];
  let port: Port;
  const client = new SchemaClient({
    create: () =>
      (port = {
        postMessage: (m) => void sent.push(m),
        onmessage: null,
        terminate() {},
      }),
  });
  const reply = () => port.onmessage!({ data: { id: sent[sent.length - 1].id, result: {} as ValidateResult } });
  const r1 = { 'https://a.test/s.json': '{}' };
  client.validate({ doc: '1', schema: '{}', draft: null, formats: false }, () => undefined);
  reply();
  client.validate({ doc: '1', schema: '{}', draft: null, formats: false, resources: r1 }, () => undefined);
  reply();
  client.validate({ doc: '2', schema: '{}', draft: null, formats: false, resources: r1 }, () => undefined);
  reply();
  const r2 = { ...r1, 'https://b.test/t.json': '{}' };
  client.validate({ doc: '2', schema: '{}', draft: null, formats: false, resources: r2 }, () => undefined);
  assert.deepEqual(sent.map((m) => m.resources && Object.keys(m.resources)), [[], ['https://a.test/s.json'], null, ['https://a.test/s.json', 'https://b.test/t.json']]);
  client.destroy();
});

test('one $id claimed by two schemas names neither: a fetched schema never stands in for a local one (review 2, finding 1)', () => {
  const v = (schema: object, doc: unknown, resources: Record<string, string>) => validateTexts({ schema: JSON.stringify(schema), doc: JSON.stringify(doc), draft: null, formats: false, resources });
  const say = (r: ValidateResult) => ({ valid: r.valid, complete: r.complete, total: r.total, problems: r.problems.map((p) => `${p.code}${p.params.why ? ':' + p.params.why : ''}${p.warn ? ' (warn)' : ''}${p.doc ? ' in ' + p.doc : ''}`) });
  const rule = { type: 'integer' };
  const main = { $id: 'https://a.test/main.json', allOf: [{ $ref: '#/$defs/rule' }, { $ref: 'https://a.test/other.json' }], $defs: { rule } };
  // other.json claims main.json's $id and puts `true` where its rule is: the local rule is never replaced, whatever
  // order the refs come in; the clash is an error and the refs to that URI aren't applied (not fully checked).
  const other = { 'https://a.test/other.json': JSON.stringify({ $id: 'https://a.test/main.json', $defs: { rule: true } }) };
  for (const schema of [main, { ...main, allOf: [...main.allOf].reverse() }]) {
    assert.deepEqual(say(v(schema, 'x', other)), { valid: false, complete: false, total: 0, problems: ['unresolved:duplicate', 'duplicateId in https://a.test/other.json'] });
  }
  const dup = v(main, 'x', other).problems.find((p) => p.params.why === 'duplicate')!;
  assert.equal(problemText('unresolved', dup.params, EN), "Can't resolve $ref #/$defs/rule: two schemas have the $id https://a.test/main.json");
  assert.equal(problemText('duplicateId', v(main, 'x', other).problems[1].params, EN), "Two schemas have the $id https://a.test/main.json: a $ref to it can't be resolved");
  // A fetched schema nothing refers to (one fetched for an earlier version of the schema) claims nothing.
  assert.deepEqual(say(v({ ...main, allOf: [{ $ref: '#/$defs/rule' }] }, 'x', other)), { valid: false, complete: true, total: 1, problems: [] });
  // Two of the schema's own resources with one $id: the same.
  const own = { $ref: 'https://a.test/x', $defs: { a: { $id: 'https://a.test/x', type: 'string' }, b: { $id: 'https://a.test/x', type: 'number' } } };
  assert.deepEqual(say(v(own, true, {})), { valid: false, complete: false, total: 0, problems: ['unresolved:duplicate', 'duplicateId'] });
});

test('a fetched schema is known by its $id whichever ref comes first (review 2, finding 1)', () => {
  const v = (schema: object, doc: unknown, resources: Record<string, string>) => validateTexts({ schema: JSON.stringify(schema), doc: JSON.stringify(doc), draft: null, formats: false, resources });
  const res = { 'https://a.test/r.json': JSON.stringify({ $id: 'https://a.test/canonical.json', $defs: { n: { type: 'number' } } }) };
  const refs = ['https://a.test/canonical.json#/$defs/n', 'https://a.test/r.json'];
  for (const list of [refs, [...refs].reverse()]) {
    const r = v({ allOf: list.map(($ref) => ({ $ref })) }, 'x', res);
    assert.deepEqual([r.valid, r.complete, r.errors.map((e) => e.code), r.remote, r.problems], [false, true, ['type'], undefined, []], list[0]);
  }
  // Referred to only by its $id, from the schema, but reached through another fetched schema: the same.
  const via = { ...res, 'https://a.test/hub.json': JSON.stringify({ $ref: 'https://a.test/r.json' }) };
  const r = v({ allOf: [{ $ref: 'https://a.test/canonical.json#/$defs/n' }, { $ref: 'https://a.test/hub.json' }] }, 'x', via);
  assert.deepEqual([r.complete, r.errors.map((e) => e.code)], [true, ['type']]);
});

test('a reply that is JSON but not one schema is a failure, offered again (review 2, finding 8)', async () => {
  const body = (text: string) => new Response(text, { status: 200 });
  const { env: e } = env({
    'https://a.test/lines': body('{"type": "string"}\n{"type": "number"}\n'),
    'https://a.test/array': body('[{"type": "string"}]'),
    'https://a.test/number': body('5'),
    'https://a.test/true': body('true'),
    'https://a.test/loose': body('{"type": "string", // a comment\n}'),
  });
  const got = await run(['https://a.test/lines', 'https://a.test/array', 'https://a.test/number', 'https://a.test/true', 'https://a.test/loose'], e);
  assert.deepEqual(got!.map((r) => ('failure' in r ? r.failure.kind : 'ok')), ['notSchema', 'notSchema', 'notSchema', 'ok', 'ok']);
});
