import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { LinkTooLarge, MAX_DOCUMENT, decodeDoc, linkReach, encodeDoc, linkHash, parseLink, readHandoff, type LinkSource } from '../lib/link';

import ts from 'typescript';
import { HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS, LINK_SNIPPET, LINK_SNIPPET_TS } from '../app/(en)/integrate/snippets';

/** The function /integrate tells other sites to paste: it must build exactly what the viewer reads. */
type LinkOptions = { compare?: unknown; view?: string; to?: string };
const toolKumarLink = new Function(`${LINK_SNIPPET}\nreturn toolKumarLink;`)() as (json: unknown, o?: LinkOptions) => Promise<string>;

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

test('the published link function builds links the viewer reads', async () => {
  const url = await toolKumarLink({ id: 1, tags: ['x'] }, { view: 'table' });
  assert.ok(url.startsWith('https://tools.vikasmaur.com/#'));
  const one = parseLink(new URL(url).hash);
  assert.ok(one && typeof one === 'object');
  assert.equal(await decodeDoc(data(one.a)), '{"id":1,"tags":["x"]}');
  assert.equal(one.view, 'table');

  const raw = '{ "kept": "as written", "big": 9007199254740993, "text": "日本語 👋" }';
  const cmp = parseLink(new URL(await toolKumarLink(raw, { compare: [1, 2] })).hash);
  assert.ok(cmp && typeof cmp === 'object');
  assert.equal(await decodeDoc(data(cmp.a)), raw);
  assert.equal(await decodeDoc(data(cmp.b)), '[1,2]');
  assert.equal(cmp.view, undefined);

  const conv = parseLink(new URL(await toolKumarLink('[]', { view: 'convert', to: 'go' })).hash);
  assert.ok(conv && typeof conv === 'object');
  assert.deepEqual([conv.view, conv.to], ['convert', 'go']);

  // Bigger than one String.fromCharCode batch (0x8000 bytes) once compressed.
  const big = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ i, r: Math.random() })));
  assert.equal(await decodeDoc(data((parseLink(new URL(await toolKumarLink(big)).hash) as { a: LinkSource }).a)), big);
});

test('the published handoff function is plain JavaScript that sends the documented message', () => {
  const openInToolKumar = new Function(`${HANDOFF_SNIPPET}\nreturn openInToolKumar;`)();
  assert.equal(typeof openInToolKumar, 'function');
  assert.match(HANDOFF_SNIPPET, /postMessage\(\{ toolkumar: 'open', a, b, view, to \}, origin\)/);
  assert.ok(readHandoff({ toolkumar: 'open', a: '[1]', b: undefined, view: 'table', to: undefined }));
});

/** Strict type errors in `code` as one browser script (DOM + ES2022 libraries, as a site would compile it). */
function typeErrors(code: string): string[] {
  const file = 'snippet.ts';
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (name, lang, ...rest) => (name === file ? ts.createSourceFile(file, code, lang) : getSourceFile.call(host, name, lang, ...rest));
  const program = ts.createProgram([file], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('the TypeScript versions type-check strictly, alone and pasted together', () => {
  assert.deepEqual(typeErrors(LINK_SNIPPET_TS), []);
  assert.deepEqual(typeErrors(HANDOFF_SNIPPET_TS), []);
  assert.deepEqual(typeErrors(`${LINK_SNIPPET_TS}\n\n${HANDOFF_SNIPPET_TS}`), [], 'both in one file: the options interface merges');
  // The options are checked: a misspelled view or target is a compile error.
  assert.ok(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'trees' });`).length);
  assert.ok(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'convert', to: 'cobol' });`).length);
  assert.deepEqual(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'convert', to: 'go' });`), []);
});

test('the TypeScript link function builds the same links as the JavaScript one', async () => {
  const js = ts.transpileModule(`${LINK_SNIPPET_TS}\nreturn toolKumarLink;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  // transpileModule leaves a top-level return alone; run it as a function body.
  const tsLink = new Function(js)() as typeof toolKumarLink;
  const doc = { id: 1, text: '日本語 👋', big: [1, 2, 3] };
  assert.equal(await tsLink(doc, { compare: [1], view: 'tree' }), await toolKumarLink(doc, { compare: [1], view: 'tree' }));
});

test('link reach follows the measured browser limits (warnings only)', () => {
  assert.equal(linkReach(2_000), 'all');
  assert.equal(linkReach(1024 * 1024), 'all', 'Firefox opens 1 MiB');
  assert.equal(linkReach(1024 * 1024 + 1), 'not-firefox');
  assert.equal(linkReach(2 * 1024 * 1024), 'not-firefox', 'Chrome and Safari open 2 MiB');
  assert.equal(linkReach(2 * 1024 * 1024 + 1), 'none');
});

test('handoff messages: only well-formed requests are accepted', () => {
  assert.equal(readHandoff(null), null);
  assert.equal(readHandoff('hello'), null);
  assert.equal(readHandoff({ type: 'something else' }), null, 'other postMessage traffic is ignored');
  assert.equal(readHandoff({ toolkumar: 'open' }), 'invalid');
  assert.equal(readHandoff({ toolkumar: 'open', a: { x: 1 } }), 'invalid');
  assert.deepEqual(readHandoff({ toolkumar: 'open', a: '[1]', b: '[2]', view: 'graph', to: 'nope' }), { a: { text: '[1]' }, b: { text: '[2]' }, view: 'graph', to: undefined });
  assert.equal(readHandoff({ toolkumar: 'open', a: { length: MAX_DOCUMENT + 1 } }), 'invalid');
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
