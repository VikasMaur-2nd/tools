import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { LinkTooLarge, MAX_DOCUMENT, decodeDoc, linkReach, encodeDoc, linkHash, parseLink, readHandoff, type LinkSource } from '../lib/link';

import ts from 'typescript';
import { HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS, LINK_SNIPPET, LINK_SNIPPET_TS } from '../app/(en)/integrate/snippets';
import { FLAT_DEFAULTS } from '../lib/convert/flat';

/** The function /integrate tells other sites to paste: it must build exactly what the viewer reads. */
type LinkOptions = { compare?: unknown; schema?: unknown; view?: string; to?: string; sep?: string; arrays?: string; depth?: number; escape?: boolean; in?: string; delimiter?: string; header?: boolean; types?: boolean };
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
  assert.match(HANDOFF_SNIPPET, /postMessage\(\{\s*toolkumar: 'open', a, b, view: v, to, sep, arrays, depth, escape,\s*in: format, delimiter, header, types,\s*\}, origin\)/);
  assert.match(HANDOFF_SNIPPET, /const b = text\(schema === undefined \? compare : schema\);\n\s*const v = schema === undefined \? view : 'schema';/);
  assert.ok(readHandoff({ toolkumar: 'open', a: '[1]', b: undefined, view: 'table', to: undefined, sep: undefined, arrays: undefined, depth: undefined, escape: undefined, in: undefined, delimiter: undefined, header: undefined, types: undefined }));
});

/** Parsed library files (lib.dom.d.ts alone is ~2 MB), shared by every typeErrors call. */
const libFiles = new Map<string, ts.SourceFile | undefined>();

/** Strict type errors in `code` as one browser script (DOM + ES2022 libraries, as a site would compile it). */
function typeErrors(code: string): string[] {
  const file = 'snippet.ts';
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (name, lang, ...rest) => {
    if (name === file) return ts.createSourceFile(file, code, lang);
    if (!libFiles.has(name)) libFiles.set(name, getSourceFile.call(host, name, lang, ...rest));
    return libFiles.get(name);
  };
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

// ── Flatten's options ─────────────────────────────────────────────────────────

const SEPARATORS = ['/', '_', '__', '->', '&', '=', '#', '%', '%%', '%FF', '+', ' ', '?', '&sep=x', '日本', '🔹', 'é', '"', '\'', '<&>'];

test('links to flatten and unflatten carry their options: only those that aren\'t the defaults, any separator', async () => {
  // (A link kept the target but not the separator, array indexes, depth or escapes.)
  const doc = { text: '{"a":{"b":1}}' };
  const flat = (f: Partial<typeof FLAT_DEFAULTS>) => ({ ...FLAT_DEFAULTS, ...f });
  for (const to of ['flatten', 'unflatten'] as const) {
    for (const sep of SEPARATORS) {
      const o = flat({ sep, arrays: 'dot', depth: 2, escape: false });
      const hash = await linkHash({ a: doc, view: 'convert', to, flat: o });
      const back = parseLink(hash);
      assert.ok(back && typeof back === 'object', hash);
      assert.deepEqual(back.flat, o, `${to} ${JSON.stringify(sep)}: ${hash}`);
      assert.equal(back.to, to);
      assert.equal(await decodeDoc(data(back.a)), doc.text, 'the document is untouched by the options after it');
    }
    // The defaults aren't written: a link with them is as short as before.
    const plain = await linkHash({ a: doc, view: 'convert', to, flat: FLAT_DEFAULTS });
    assert.equal(plain, await linkHash({ a: doc, view: 'convert', to }));
    assert.doesNotMatch(plain, /sep=|arrays=|depth=|escape=/);
    assert.deepEqual((parseLink(plain) as { flat?: unknown }).flat, FLAT_DEFAULTS, 'and it opens with the defaults');
    // Each option on its own.
    assert.match(await linkHash({ a: doc, view: 'convert', to, flat: flat({ arrays: 'keep' }) }), /&to=\w+&arrays=keep$/);
    assert.match(await linkHash({ a: doc, view: 'convert', to, flat: flat({ depth: 3 }) }), /&to=\w+&depth=3$/);
    assert.match(await linkHash({ a: doc, view: 'convert', to, flat: flat({ escape: false }) }), /&to=\w+&escape=0$/);
    assert.match(await linkHash({ a: doc, view: 'convert', to, flat: flat({ sep: '&' }) }), /&to=\w+&sep=%26$/);
  }
  // Other targets and views carry none, and links without them parse as before.
  for (const r of [{ view: 'convert', to: 'go' }, { view: 'tree', to: 'flatten' }] as const) {
    const hash = await linkHash({ a: doc, ...r, flat: flat({ sep: '/', depth: 1 }) });
    assert.doesNotMatch(hash, /sep=|depth=/);
    assert.equal('flat' in (parseLink(hash) as object), false);
  }
  assert.deepEqual(parseLink('#a=abc&view=convert&to=go&sep=%2F&depth=2'), { a: { data: 'abc' }, b: undefined, view: 'convert', to: 'go' });
  // A separator that can't be percent-encoded (a lone surrogate) is left out, never an error; so is one being typed ('').
  assert.doesNotMatch(await linkHash({ a: doc, view: 'convert', to: 'flatten', flat: flat({ sep: '\ud800' }) }), /sep=/);
  assert.doesNotMatch(await linkHash({ a: doc, view: 'convert', to: 'flatten', flat: flat({ sep: '' }) }), /sep=/);
});

test('flatten options in a link: invalid or unknown values are ignored, never an error', () => {
  const opts = (hash: string) => (parseLink('#a=abc&view=convert&to=flatten' + hash) as { flat: unknown }).flat;
  assert.deepEqual(opts(''), FLAT_DEFAULTS);
  for (const bad of ['&sep=', '&sep=%', '&sep=%E0%A4%A', '&sep=%ZZ', '&sep=a1', '&sep=%5B', '&sep=%5C', '&sep=123456789', '&sep=abcdefghi', '&arrays=Dot', '&arrays=none', '&depth=0', '&depth=4', '&depth=-1', '&depth=1.5', '&depth=02', '&depth=x', '&escape=false', '&escape=no', '&escape=1', '&escape=', '&nope=1']) {
    assert.deepEqual(opts(bad), FLAT_DEFAULTS, bad);
  }
  assert.deepEqual(opts('&sep=%2F&arrays=dot&depth=1&escape=0'), { sep: '/', arrays: 'dot', depth: 1, escape: false });
  // As written: "+" is a plus; the first of two is taken; a hand-written plain separator works.
  assert.deepEqual(opts('&sep=+'), { ...FLAT_DEFAULTS, sep: '+' });
  assert.deepEqual(opts('&sep=::&sep=/'), { ...FLAT_DEFAULTS, sep: '::' });
  assert.deepEqual(opts('&arrays=keep&arrays=dot'), { ...FLAT_DEFAULTS, arrays: 'keep' });
  // Order doesn't matter, and the options may come before the target.
  assert.deepEqual((parseLink('#depth=2&a=abc&sep=%2F&view=convert&to=unflatten') as { flat: unknown }).flat, { ...FLAT_DEFAULTS, sep: '/', depth: 2 });
});

test('the published link functions carry flatten\'s options as the viewer reads them', async () => {
  const js = ts.transpileModule(`${LINK_SNIPPET_TS}\nreturn toolKumarLink;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const tsLink = new Function(js)() as typeof toolKumarLink;
  for (const sep of SEPARATORS) {
    const o = { view: 'convert', to: 'flatten', sep, arrays: 'dot', depth: 2, escape: false };
    const url = await toolKumarLink('{"a":{"b":1}}', o);
    assert.equal(await tsLink('{"a":{"b":1}}', o), url);
    assert.deepEqual((parseLink(new URL(url).hash) as { flat: unknown }).flat, { sep, arrays: 'dot', depth: 2, escape: false }, sep);
  }
  assert.deepEqual(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'convert', to: 'flatten', sep: '/', arrays: 'keep', depth: 3, escape: false });`), []);
  assert.ok(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'convert', to: 'flatten', arrays: 'none' });`).length);
  assert.ok(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { view: 'convert', to: 'flatten', depth: 4 });`).length);
});

test('handoff messages carry flatten\'s options too: a number for depth, a boolean for escape; invalid ones ignored', () => {
  const open = (extra: Record<string, unknown>, to = 'flatten') => readHandoff({ toolkumar: 'open', a: '[1]', view: 'convert', to, ...extra }) as { flat?: unknown };
  assert.deepEqual(open({ sep: '&=#%日本', arrays: 'keep', depth: 3, escape: false }).flat, { sep: '&=#%日本', arrays: 'keep', depth: 3, escape: false });
  assert.deepEqual(open({}).flat, FLAT_DEFAULTS);
  assert.deepEqual(open({ sep: 'a1', arrays: 'none', depth: '2', escape: 'false' }).flat, FLAT_DEFAULTS);
  assert.deepEqual(open({ sep: 7, depth: 2.5, escape: 0 }).flat, FLAT_DEFAULTS);
  assert.equal('flat' in open({ sep: '/' }, 'go'), false);
});

test('the first load knows a link when it sees one, and loads the code to read it only then', async () => {
  // (lib/link.ts was part of every page's first load, ~1.1 KB gzip of it; the engine now imports it when a link is
  // opened or made, and asks lib/engine/rules.ts linkIn whether there is one.)
  const { readFileSync } = await import('node:fs');
  const { linkIn, MAX_DOCUMENT: max } = await import('../lib/engine/rules');
  for (const h of ['', '#', '#how-it-works', '#handoff', '#handoff2', '#a=', '#a=abc', '#b=x', '#view=tree&a=x', '#xa=1', '#ab=1', 'a=abc', '#a', '#&b=1', '#c=1&b=2']) {
    assert.equal(linkIn(h), parseLink(h) !== null, h);
  }
  assert.equal(max, MAX_DOCUMENT);
  const src = (p: string) => readFileSync(p, 'utf8');
  const engine = src('lib/engine/engine.ts');
  assert.doesNotMatch(engine, /^import (?!type )[^;]*from '\.\.\/link';/m, 'the engine imports only types from lib/link.ts');
  assert.match(engine, /await import\('\.\.\/link'\)/);
  for (const f of ['components/JsonTool.tsx', 'lib/engine/commands.ts', 'lib/engine/store.ts', 'lib/engine/rules.ts', 'lib/engine/targets.ts', 'lib/huge/open.ts']) {
    assert.doesNotMatch(src(f), /from '(?:@\/lib|\.\.?)\/link'/, f);
  }
});

test('CSV links carry how CSV reads: only with in=csv, only what isn\'t the default, invalid values ignored', async () => {
  // (Links kept in=csv but the reader's own separator, header and typing read the document.)
  const doc = { text: 'a;b\n1;2' };
  const csv = (c: Partial<{ delimiter: ',' | ';' | '\t' | '|' | 'auto'; header: boolean; types: boolean }>) => ({ delimiter: 'auto' as const, header: true, types: true, ...c });
  for (const [delimiter, name] of [[',', 'comma'], [';', 'semicolon'], ['\t', 'tab'], ['|', 'pipe']] as const) {
    const hash = await linkHash({ a: doc, in: 'csv', csv: csv({ delimiter, header: false, types: false }) });
    assert.match(hash, new RegExp(`&in=csv&delimiter=${name}&header=0&types=0$`));
    assert.deepEqual((parseLink(hash) as { csv: unknown }).csv, { delimiter, header: false, types: false });
  }
  const plain = await linkHash({ a: doc, in: 'csv', csv: csv({}) });
  assert.match(plain, /&in=csv$/);
  assert.deepEqual((parseLink(plain) as { csv: unknown }).csv, csv({}), 'a link without them reads with the defaults');
  assert.doesNotMatch(await linkHash({ a: doc, in: 'yaml', csv: csv({ header: false }) }), /header=/, 'only with in=csv');
  assert.equal('csv' in (parseLink('#a=abc&in=yaml&header=0') as object), false);
  assert.equal('csv' in (parseLink('#a=abc&header=0') as object), false);
  const read = (extra: string) => (parseLink('#a=abc&in=csv' + extra) as { csv: unknown }).csv;
  for (const bad of ['&delimiter=%3B', '&delimiter=;', '&delimiter=Comma', '&delimiter=auto', '&delimiter=toString', '&header=false', '&header=no', '&types=', '&types=1']) assert.deepEqual(read(bad), csv({}), bad);
  assert.deepEqual(read('&types=0&delimiter=tab'), csv({ delimiter: '\t', types: false }));
  // The handoff: the same names, header and types as booleans.
  const hand = (extra: Record<string, unknown>) => (readHandoff({ toolkumar: 'open', a: 'a;b', in: 'csv', ...extra }) as { csv?: unknown }).csv;
  assert.deepEqual(hand({ delimiter: 'pipe', header: false, types: false }), { delimiter: '|', header: false, types: false });
  assert.deepEqual(hand({ delimiter: ';', header: 'false', types: 0 }), csv({}));
  assert.equal(hand({}) !== undefined, true);
  assert.equal('csv' in (readHandoff({ toolkumar: 'open', a: 'x: 1', in: 'yaml', header: false }) as object), false);
});

test('the published functions carry in= and how CSV reads, as the viewer reads them (links and the handoff, JS and TS)', async () => {
  // (/integrate documented neither: the functions couldn't make a CSV, YAML, XML or TOML link.)
  const js = ts.transpileModule(`${LINK_SNIPPET_TS}\nreturn toolKumarLink;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const tsLink = new Function(js)() as typeof toolKumarLink;
  const sheet = 'name;n\nAda;1\n';
  for (const [delimiter, ch] of [['comma', ','], ['semicolon', ';'], ['tab', '\t'], ['pipe', '|']] as const) {
    const o = { in: 'csv', delimiter, header: false, types: false };
    const url = await toolKumarLink(sheet, o);
    assert.equal(await tsLink(sheet, o), url);
    const link = parseLink(new URL(url).hash) as { a: LinkSource; in?: string; csv?: unknown };
    assert.deepEqual([await decodeDoc(data(link.a)), link.in, link.csv], [sheet, 'csv', { delimiter: ch, header: false, types: false }], delimiter);
  }
  // The defaults aren't written; the other formats need only in.
  const plain = await toolKumarLink(sheet, { in: 'csv', header: true, types: true });
  assert.match(plain, /&in=csv$/);
  assert.deepEqual((parseLink(new URL(plain).hash) as { csv: unknown }).csv, { delimiter: 'auto', header: true, types: true });
  for (const format of ['yaml', 'xml', 'toml']) {
    const link = parseLink(new URL(await toolKumarLink('x: 1', { in: format, view: 'tree' })).hash) as { in?: string; csv?: unknown; view?: string };
    assert.deepEqual([link.in, link.view, 'csv' in link], [format, 'tree', false], format);
  }
  assert.equal((parseLink(new URL(await toolKumarLink([1])).hash) as { in?: string }).in, undefined, 'JSON: no in');
  // TypeScript: the options type-check, wrong values don't.
  assert.deepEqual(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink('a;b', { in: 'csv', delimiter: 'semicolon', header: false, types: false });`), []);
  assert.deepEqual(typeErrors(`${HANDOFF_SNIPPET_TS}\nvoid openInToolKumar('a: 1', { in: 'yaml', view: 'tree' });`), []);
  for (const bad of ["in: 'json'", "in: 'csv', delimiter: ';'", "in: 'csv', header: 0"]) assert.ok(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink('x', { ${bad} });`).length, bad);
  // The handoff, JS and TS: the same names, header and types as booleans.
  const tsHandoff = ts.transpileModule(`${HANDOFF_SNIPPET_TS}\nreturn openInToolKumar;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const source of [`${HANDOFF_SNIPPET}\nreturn openInToolKumar;`, tsHandoff]) {
    const sent: Record<string, unknown>[] = [];
    const listeners: ((e: unknown) => void)[] = [];
    const tab = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
    const open = new Function('window', 'addEventListener', 'removeEventListener', 'setTimeout', 'clearTimeout', source)(
      { open: () => tab },
      (_: string, f: (e: unknown) => void) => listeners.push(f),
      () => undefined,
      () => 0,
      () => undefined,
    );
    void open(sheet, { in: 'csv', delimiter: 'tab', header: false, types: false, view: 'table' });
    listeners[0]({ source: tab, origin: 'https://tools.vikasmaur.com', data: { toolkumar: 'ready', version: 1 } });
    assert.deepEqual([sent[0].in, sent[0].delimiter, sent[0].header, sent[0].types], ['csv', 'tab', false, false]);
    const r = readHandoff(sent[0]) as { a: { text: string }; in?: string; csv?: unknown; view?: string };
    assert.deepEqual([r.a.text, r.in, r.csv, r.view], [sheet, 'csv', { delimiter: '\t', header: false, types: false }, 'table']);
  }
});

test('the published link functions leave out a separator they can\'t encode instead of failing', async () => {
  // (Half an emoji made encodeURIComponent throw: the whole link was rejected.)
  const half = '🙂'.slice(0, 1);
  const js = ts.transpileModule(`${LINK_SNIPPET_TS}\nreturn toolKumarLink;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const tsLink = new Function(js)() as typeof toolKumarLink;
  for (const make of [toolKumarLink, tsLink]) {
    const url = await make('{"a":{"b":1}}', { view: 'convert', to: 'flatten', sep: half, arrays: 'dot' });
    assert.doesNotMatch(url, /sep=/);
    assert.deepEqual((parseLink(new URL(url).hash) as { flat: unknown }).flat, { ...FLAT_DEFAULTS, arrays: 'dot' });
  }
});

test('link reach follows the measured browser limits (warnings only)', () => {
  assert.equal(linkReach(2_000), 'all');
  assert.equal(linkReach(512_000), 'all', "Chrome's and Edge's address bar keeps 512,000 pasted characters");
  assert.equal(linkReach(512_001), 'click', 'longer: it opens when clicked, not pasted');
  assert.equal(linkReach(1024 * 1024), 'click', 'Firefox opens 1 MiB');
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

test('schema links: b is the schema with view=schema, its draft and Check formats passed on; old links unchanged', async () => {
  // Old links: b without a view (or with another) is Compare's, and carries no schema options.
  assert.deepEqual(parseLink('#a=abc&b=def'), { a: { data: 'abc' }, b: { data: 'def' }, view: undefined, to: undefined });
  assert.deepEqual(parseLink('#a=abc&b=def&view=tree&draft=draft-07&formats=1'), { a: { data: 'abc' }, b: { data: 'def' }, view: 'tree', to: undefined });
  // The Schema view: its options as written (the Schema view reads them: lib/schema/controller.ts take).
  assert.deepEqual(parseLink('#a=abc&b=def&view=schema'), { a: { data: 'abc' }, b: { data: 'def' }, view: 'schema', to: undefined, draft: null, formats: null });
  assert.deepEqual(parseLink('#a=abc&b=def&view=schema&draft=draft-07&formats=1'), { a: { data: 'abc' }, b: { data: 'def' }, view: 'schema', to: undefined, draft: 'draft-07', formats: '1' });
  // A schema by URL, fetched as a's are.
  assert.deepEqual(parseLink(`#a=abc&b=${encodeURIComponent('https://x.test/user.schema.json')}&view=schema`), { a: { data: 'abc' }, b: { url: 'https://x.test/user.schema.json' }, view: 'schema', to: undefined, draft: null, formats: null });
  // Round trip: the view is kept (it says what b is), the options only when set.
  const h = await linkHash({ a: { text: '{"a":1}' }, b: { text: '{"type":"object"}' }, view: 'schema', draft: '2019-09', formats: true });
  assert.match(h, /&view=schema&draft=2019-09&formats=1$/);
  const back = parseLink(h);
  assert.ok(back && typeof back === 'object');
  assert.deepEqual([await decodeDoc(data(back.b)), back.view, back.draft, back.formats], ['{"type":"object"}', 'schema', '2019-09', '1']);
  assert.match(await linkHash({ a: { text: '1' }, b: { text: '{}' }, view: 'schema' }), /&view=schema$/);
  assert.doesNotMatch(await linkHash({ a: { text: '1' }, b: { text: '{}' }, view: 'compare', draft: 'draft-07', formats: true }), /draft|formats|view/);
  assert.doesNotMatch(await linkHash({ a: { text: '1' }, view: 'schema', draft: 'draft-07', formats: true }), /draft|formats/, 'no schema: no options');
  // Handoff: the Schema view with b as its schema.
  assert.deepEqual(readHandoff({ toolkumar: 'open', a: '[1]', b: '{}', view: 'schema' }), { a: { text: '[1]' }, b: { text: '{}' }, view: 'schema', to: undefined });
});

test('the published functions open the Schema view with a schema option', async () => {
  const one = parseLink(new URL(await toolKumarLink({ id: 1 }, { schema: { type: 'object' }, view: 'tree' })).hash);
  assert.ok(one && typeof one === 'object');
  assert.deepEqual([await decodeDoc(data(one.a)), await decodeDoc(data(one.b)), one.view], ['{"id":1}', '{"type":"object"}', 'schema']);
  // Compare as before; schema wins when both are given (b is one document).
  const cmp = parseLink(new URL(await toolKumarLink(1, { compare: 2, view: 'tree' })).hash) as { b: LinkSource; view?: string };
  assert.deepEqual([await decodeDoc(data(cmp.b)), cmp.view], ['2', 'tree']);
  const both = parseLink(new URL(await toolKumarLink(1, { compare: 2, schema: { type: 'number' } })).hash) as { b: LinkSource; view?: string };
  assert.deepEqual([await decodeDoc(data(both.b)), both.view], ['{"type":"number"}', 'schema']);
  // TypeScript: the same links, and the option type-checks.
  const js = ts.transpileModule(`${LINK_SNIPPET_TS}\nreturn toolKumarLink;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const tsLink = new Function(js)() as typeof toolKumarLink;
  assert.equal(await tsLink([1], { schema: { items: { type: 'number' } } }), await toolKumarLink([1], { schema: { items: { type: 'number' } } }));
  assert.deepEqual(typeErrors(`${LINK_SNIPPET_TS}\nvoid toolKumarLink({}, { schema: { type: 'object' }, view: 'schema' });`), []);
  // The handoff sends b as the schema and view 'schema'.
  const sent: unknown[] = [];
  const listeners: ((e: unknown) => void)[] = [];
  const tab = { postMessage: (m: unknown) => sent.push(m) };
  const fn = new Function('window', 'addEventListener', 'removeEventListener', `${HANDOFF_SNIPPET}\nreturn openInToolKumar;`)(
    { open: () => tab },
    (_: string, f: (e: unknown) => void) => listeners.push(f),
    () => undefined,
  );
  void fn({ id: 1 }, { schema: { required: ['id'] } });
  listeners[0]({ source: tab, origin: 'https://tools.vikasmaur.com', data: { toolkumar: 'ready', version: 1 } });
  assert.deepEqual(sent, [{ toolkumar: 'open', a: '{"id":1}', b: '{"required":["id"]}', view: 'schema', to: undefined, sep: undefined, arrays: undefined, depth: undefined, escape: undefined, in: undefined, delimiter: undefined, header: undefined, types: undefined }]);
  assert.ok(readHandoff(sent[0]) && typeof readHandoff(sent[0]) === 'object');
  listeners[0]({ source: tab, origin: 'https://tools.vikasmaur.com', data: { toolkumar: 'opened' } });
});
