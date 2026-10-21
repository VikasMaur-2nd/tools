import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { LinkTooLarge, MAX_HANDOFF_TEXT, decodeDoc, encodeDoc, linkHash, parseLink, readHandoff, type LinkSource } from '../lib/link';

/** public/toolkumar.js, the helper other sites copy: it must build exactly what the viewer reads. */
const helper = createRequire(join(process.cwd(), 'package.json'))('./public/toolkumar.js') as {
  origin: string;
  link(o: Record<string, unknown>): Promise<string>;
};

const data = (s: LinkSource | undefined) => (s && 'data' in s ? s.data : assert.fail('expected encoded data'));

test('link documents decode losslessly, from our encoder and from other zlib implementations', async () => {
  const text = '{"hello":"日本語 👋","n":9007199254740993}';
  // A fixed vector: links already published must keep opening.
  assert.equal(await decodeDoc('q1bKSM3JyVeyUno2femzOWterJqn8GH-xG4lHaU8JStLAwNzQ0tLI1MTcxMDS0vjWgA'), text);
  const large = text.repeat(10_000);
  const encoded = await encodeDoc(large);
  assert.match(encoded, /^[\w-]+$/);
  assert.equal(await decodeDoc(encoded), large);
  // What the documentation tells Node and Python users to do.
  assert.equal(await decodeDoc(deflateRawSync(text).toString('base64url')), text);
  await assert.rejects(decodeDoc('invalid!'));
});

test('a link that inflates past the cap is refused while it decompresses', async () => {
  const bomb = await encodeDoc(' '.repeat(5_000_000));
  assert.ok(bomb.length < 10_000);
  await assert.rejects(decodeDoc(bomb, 1_000_000), LinkTooLarge);
  assert.equal((await decodeDoc(bomb)).length, 5_000_000);
});

test('fragments: documents, URLs, views and targets', () => {
  assert.equal(parseLink(''), null);
  assert.equal(parseLink('#how-it-works'), null, 'ordinary anchors are not links');
  assert.equal(parseLink('#handoff'), 'handoff');
  assert.equal(parseLink('#a=not base64!'), 'broken');
  assert.equal(parseLink('#a='), 'broken');
  assert.deepEqual(parseLink('#a=abc'), { a: { data: 'abc' }, b: undefined, view: undefined, to: undefined });
  assert.deepEqual(parseLink('#a=abc&b=def&view=compare'), { a: { data: 'abc' }, b: { data: 'def' }, view: 'compare', to: undefined });
  assert.deepEqual(parseLink('#b=def'), { a: undefined, b: { data: 'def' }, view: undefined, to: undefined });
  assert.deepEqual(parseLink(`#a=${encodeURIComponent('https://api.example.com/x.json?a=1&b=2')}&view=graph`), {
    a: { url: 'https://api.example.com/x.json?a=1&b=2' },
    b: undefined,
    view: 'graph',
    to: undefined,
  });
  // Unknown views and targets are dropped, never passed on.
  assert.deepEqual(parseLink('#a=abc&view=nope&to=cobol'), { a: { data: 'abc' }, b: undefined, view: undefined, to: undefined });
  assert.deepEqual(parseLink('#a=abc&view=convert&to=go'), { a: { data: 'abc' }, b: undefined, view: 'convert', to: 'go' });
  assert.equal(parseLink('#a=javascript%3Aalert(1)'), 'broken');
});

test('our links round-trip: view, compare and convert', async () => {
  const one = parseLink(await linkHash({ a: { text: '{"a":1}' }, view: 'tree', to: 'go' }));
  assert.ok(one && typeof one === 'object');
  assert.equal(await decodeDoc(data(one.a)), '{"a":1}');
  assert.equal(one.view, 'tree');
  assert.equal(one.to, undefined, 'a target only travels with Convert');

  const cmp = parseLink(await linkHash({ a: { text: '[1]' }, b: { text: '[2]' }, view: 'compare' }));
  assert.ok(cmp && typeof cmp === 'object');
  assert.equal(await decodeDoc(data(cmp.b)), '[2]');
  assert.equal(cmp.view, undefined, 'two documents open Compare by themselves');

  const conv = parseLink(await linkHash({ a: { url: 'https://x.test/a.json' }, view: 'convert', to: 'zod' }));
  assert.deepEqual(conv, { a: { url: 'https://x.test/a.json' }, b: undefined, view: 'convert', to: 'zod' });
});

test('toolkumar.js builds links the viewer reads', async () => {
  const url = await helper.link({ json: { id: 1, tags: ['x'] }, view: 'table' });
  assert.ok(url.startsWith('https://tools.vikasmaur.com/#'));
  const one = parseLink(new URL(url).hash);
  assert.ok(one && typeof one === 'object');
  assert.equal(await decodeDoc(data(one.a)), '{"id":1,"tags":["x"]}');
  assert.equal(one.view, 'table');

  const raw = '{ "kept": "as written" }';
  const cmp = parseLink(new URL(await helper.link({ json: raw, compare: [1, 2] })).hash);
  assert.ok(cmp && typeof cmp === 'object');
  assert.equal(await decodeDoc(data(cmp.a)), raw);
  assert.equal(await decodeDoc(data(cmp.b)), '[1,2]');

  const remote = parseLink(new URL(await helper.link({ url: 'https://api.example.com/v1?x=1&y=2', compareUrl: 'https://api.example.com/v2', view: 'convert', to: 'go' })).hash);
  assert.deepEqual(remote, { a: { url: 'https://api.example.com/v1?x=1&y=2' }, b: { url: 'https://api.example.com/v2' }, view: 'convert', to: 'go' });

  await assert.rejects(helper.link({}), TypeError);
  await assert.rejects(helper.link({ json: 1, view: 'nope' }), TypeError);
  await assert.rejects(helper.link({ url: 'file:///etc/passwd' }), TypeError);
  await assert.rejects(helper.link({ json: undefined, url: '' }), TypeError);
});

test('handoff messages: only well-formed requests are accepted', () => {
  assert.equal(readHandoff(null), null);
  assert.equal(readHandoff('hello'), null);
  assert.equal(readHandoff({ type: 'something else' }), null, 'other postMessage traffic is ignored');
  assert.equal(readHandoff({ toolkumar: 'open' }), 'invalid');
  assert.equal(readHandoff({ toolkumar: 'open', a: { x: 1 } }), 'invalid');
  assert.deepEqual(readHandoff({ toolkumar: 'open', a: '[1]', b: '[2]', view: 'graph', to: 'nope' }), { a: { text: '[1]' }, b: { text: '[2]' }, view: 'graph', to: undefined });
  assert.equal(readHandoff({ toolkumar: 'open', a: { length: MAX_HANDOFF_TEXT + 1 } }), 'invalid');
});

test('the example links on /integrate still open their documents', async () => {
  const { SAMPLE_VIEW_LINK, SAMPLE_COMPARE_LINK } = await import('../app/(en)/integrate/samples');
  const one = parseLink(new URL(SAMPLE_VIEW_LINK).hash);
  assert.ok(one && typeof one === 'object');
  assert.deepEqual(JSON.parse(await decodeDoc(data(one.a))), { id: 42, name: 'Ada Lovelace', roles: ['author', 'mathematician'], active: true });
  assert.equal(one.view, 'tree');
  const cmp = parseLink(new URL(SAMPLE_COMPARE_LINK).hash);
  assert.ok(cmp && typeof cmp === 'object');
  assert.deepEqual(JSON.parse(await decodeDoc(data(cmp.b))), { id: 42, name: 'Ada King', roles: ['author', 'mathematician', 'translator'], active: true });
});
