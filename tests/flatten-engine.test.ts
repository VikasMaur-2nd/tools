import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse, type ParseResult } from '../lib/json/parser';
import { EN } from '../lib/i18n/ui';
import { paired } from '../lib/engine/store';
import { jsonLines } from '../lib/engine/rules';
import * as converters from '../lib/convert';
import { cpuNow } from './timing';

// Use as input (Ctrl+Enter, or the menu) while Flatten or Unflatten shows, as the engine runs it: the output
// replaces the input only when it is the conversion of the text in the editor now. A broken edit keeps the last
// valid document's conversion on show (the engine holds on to that tree), which must never take its place.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = Record<string, any>;
const load = createRequire(__filename);
const source = readFileSync(resolve(__dirname, '../../lib/engine/engine.ts'), 'utf8').replaceAll('import.meta.url', '"file:///engine.js"');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [ctx => root => ts.visitNode(root, function visit(node: ts.Node): ts.VisitResult<ts.Node> | undefined {
    if (ts.isConstructorDeclaration(node)) return undefined;
    return ts.visitEachChild(node, visit, ctx);
  }) as ts.SourceFile] },
}).outputText;

const GOOD = '{"a":{"b":1}}';
const FLAT = '{\n  "a.b": 1\n}';

/**
 * An engine on Convert › Flat JSON whose last conversion is GOOD's (FLAT), its editor holding `text`: GOOD (the
 * conversion is current) or a broken edit of it (the conversion is of the tree kept from before).
 */
function session(text: string, view = 'convert') {
  const calls: unknown[][] = [];
  const state: Dynamic = { settings: { view, target: 'flatten' }, convert: { error: null } };
  const out: Dynamic = {};
  runInNewContext(js, {
    // (No timers: the wait's two-minute expiry never matters here.)
    exports: out, performance, URL, Blob, Error, Promise, setTimeout: () => 0,
    require: (name: string) => {
      if (name === './store') return { paired, store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
      if (name === '../analytics') return { track: (...args: unknown[]) => calls.push(['track', ...args]), reportError: () => {} };
      if (name === '../i18n/ui') return { rt: EN };
      if (name === './targets') return load(resolve(__dirname, '../lib/engine/targets'));
      if (name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const engine = new out.Engine();
  const good = { version: {} };
  const ed = { version: text === GOOD ? good.version : {}, text };
  engine.settings = state.settings;
  engine.ed = ed;
  engine.dead = false;
  // The tree kept from GOOD and its conversion, as analyze() and runConvert() leave them.
  engine.goodVer = good.version;
  engine.parsedVer = ed.version;
  // (As the engine parses: repairing what it can, each repair an issue; its status says valid, fixable or error.)
  const res: ParseResult = parse(text, { repair: true });
  state.status = { kind: res.root ? (res.issues.length ? 'fixable' : 'valid') : 'error' };
  engine.fresh = () => res;
  engine.convLater = () => null;
  engine.convOutput = () => FLAT;
  engine.toast = (...args: unknown[]) => calls.push(['toast', ...args]);
  engine.replaceText = (...args: unknown[]) => calls.push(['replace', ...args]);
  engine.setConvert = (...args: unknown[]) => calls.push(['setConvert', ...args]);
  engine.transform = (...args: unknown[]) => calls.push(['transform', args.length]);
  return { engine, calls, ed, state };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The calls as plain data (objects made in the engine's context have its prototypes). */
const plain = (calls: unknown[][], skip = '') => JSON.parse(JSON.stringify(calls.filter((c) => c[0] !== skip)));

test('Use as input on Flat JSON: the current document\'s output replaces the input, then Unflatten shows', async () => {
  const s = session(GOOD);
  s.engine.useOutput();
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), [['replace', FLAT, 'Flattened input'], ['setConvert', { target: 'unflatten' }]]);
  assert.deepEqual(plain(s.calls.filter((c) => c[0] === 'track')), [['track', 'feature_used', { feature: 'use_output' }]]);
});

test('Use as input after a broken edit: says to fix it, and keeps the edit (never the old document\'s output)', async () => {
  const s = session('{"a":{');
  s.engine.useOutput();
  await flush();
  assert.deepEqual(plain(s.calls), [['toast', "Can't do that yet. Fix the error first.", 'err']]);
});

test('Use as input when the editor changes before the conversion arrives: nothing replaced', async () => {
  const s = session(GOOD);
  let arrive!: (out: string) => void;
  s.engine.convLater = () => new Promise<string>((r) => (arrive = r));
  s.engine.useOutput();
  // (Typed meanwhile: a newer version, whatever its text.)
  s.ed.version = {};
  arrive(FLAT);
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), []);
});

/**
 * A session whose conversion is on its way when Use as input is pressed (the engine's own wait, see convLater):
 * `arrive` finishes a conversion for the settings and document as they are then, as runConvert does.
 */
function pending() {
  const s = session(GOOD);
  delete s.engine.convLater;
  s.engine.whenAnalysed = () => {};
  s.engine.convSeq = 2;
  s.engine.convDone = { seq: 1, out: '', ver: null, key: '' };
  s.engine.viewSeq = 7;
  s.engine.useOutput();
  return { ...s, arrive: (out: string) => s.engine.convFinished(s.engine.convSeq, out, s.engine.goodVer) };
}

test('Use as input while converting, then Format and back to Convert: the conversion made on return never replaces the input', async () => {
  // (Leaving Convert stopped the conversion the request waited for; the one made on coming back delivered to it.)
  const s = pending();
  s.engine.viewSeq += 2;
  s.arrive(FLAT);
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), []);
});

test('Use as input while converting, then other options or another target: nothing replaced', async () => {
  for (const change of [(e: Dynamic) => (e.settings.flat = { sep: '/', arrays: 'bracket', escape: true, depth: 0 }), (e: Dynamic) => (e.settings.target = 'unflatten')]) {
    const s = pending();
    change(s.engine);
    s.arrive(FLAT);
    await flush();
    assert.deepEqual(plain(s.calls, 'track'), []);
  }
  // Nothing changed meanwhile: it arrives and replaces the input.
  const s = pending();
  s.arrive(FLAT);
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), [['replace', FLAT, 'Flattened input'], ['setConvert', { target: 'unflatten' }]]);
});

test('Use as input on input the parser repaired: says to fix it (Format still applies its repair)', async () => {
  // ({"b": parses as {"b":null} with repairs: it replaced the text with the flattened repair.)
  for (const text of ['{"b":', '{"a":1,}', "{a:'x'}"]) {
    const s = session(text);
    s.engine.useOutput();
    await flush();
    assert.deepEqual(plain(s.calls), [['toast', "Can't do that yet. Fix the error first.", 'err']], text);
  }
  const f = session('{"b":', 'format');
  f.engine.useOutput();
  assert.deepEqual(plain(f.calls, 'track'), [['transform', 2]]);
});

test('Use as input after pasting JSONP while the JWT reader loads: the repaired parse that arrives is never applied', async () => {
  // (fresh() gave the earlier, valid text's parse while the reader loaded; the new text's parse, repaired, came after.)
  const s = pending();
  const jsonp = 'example({"a":{"b":1}})';
  s.ed.text = jsonp;
  s.ed.version = {};
  // The conversion was asked for this version (as useOutput would at its click): redo the request on it.
  s.calls.length = 0;
  s.engine.viewSeq = 9;
  s.engine.useOutput();
  // The reader came: the text is analysed, with a repair, and converted.
  s.engine.res = parse(jsonp, { repair: true });
  s.engine.goodVer = s.ed.version;
  s.engine.parsedVer = s.ed.version;
  s.state.status = { kind: 'fixable' };
  s.arrive(FLAT);
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), []);
});

test('Use as input on JSON Lines (read as records, not repaired): it applies', async () => {
  // (Its parse has the "several top-level values" issue; the engine reads it as JSON Lines, valid.)
  assert.equal(await pressUseAsInput('{"a":{"b":1}}\n{"a":{"b":2}}\n', null, 'flatten'), '{"a.b":1}\n{"a.b":2}\n');
});

/** The engine's reading of `text` (analyze): JSON Lines by a .jsonl or .ndjson name or by its layout, and its status. */
function read(text: string, name: string | null) {
  const res = parse(text, { lines: /\.(jsonl|ndjson)$/i.test(name ?? ''), repair: true });
  const status = jsonLines(text, res) ? { kind: 'valid', warnings: 0, jsonl: (res.root!.v as unknown[]).length } : { kind: res.root ? (res.issues.length ? 'fixable' : 'valid') : 'error' };
  return { res, status };
}

/** An engine on Convert › `target` with `text` in the editor (from a file named `name`), its conversion made by runConvert. */
async function converted(text: string, name: string | null, target: 'flatten' | 'unflatten') {
  const s = session(GOOD);
  const { res, status } = read(text, name);
  s.engine.settings.target = target;
  Object.assign(s.state, { status, fileName: name });
  s.engine.fresh = () => res;
  // As analyze() leaves the document (its tree, this version's), then the engine's own conversion of it.
  s.engine.good = res;
  s.engine.goodVer = s.ed.version;
  s.engine.parsedVer = s.ed.version;
  s.engine.code = { setText: () => {}, text: '' };
  s.engine.loadConverters = async () => (s.engine.conv = converters);
  s.engine.convSeq = 0;
  s.engine.convDone = { seq: 0, out: '', ver: null, key: '' };
  delete s.engine.convLater;
  delete s.engine.convOutput;
  await s.engine.runConvert();
  return s;
}

/** Use as input on Convert › `target`, with `text` in the editor (from a file named `name`): the text it puts there. */
async function pressUseAsInput(text: string, name: string | null, target: 'flatten' | 'unflatten', time?: (ms: number) => void) {
  const s = await converted(text, name, target);
  const t = cpuNow();
  s.engine.useOutput();
  await flush();
  time?.(cpuNow() - t);
  return s.calls.find((c) => c[0] === 'replace')?.[1] as string | undefined;
}

test('JSON Lines (a .jsonl or .ndjson file, or pasted lines): Flatten, Use as input, Unflatten, Use as input gives it back exactly', async () => {
  // (Written as one array, a .jsonl file read the flat records as a single one: Unflatten gave [[...]].)
  for (const name of ['records.jsonl', 'records.ndjson', null]) {
    for (const text of ['{"a":{"b":1}}\n{"a":{"b":2}}\n', '{"id":9007199254740993,"a":{"b":[1,{"c":null}]}}\n{"x":{}}\n{"y":[]}\n']) {
      const flat = await pressUseAsInput(text, name, 'flatten');
      assert.ok(flat !== undefined, `${name}: flattened`);
      assert.equal(read(flat, name).status.jsonl, read(text, name).status.jsonl, `${name}: the same records, as JSON Lines`);
      assert.equal(await pressUseAsInput(flat, name, 'unflatten'), text, `${name}: back exactly`);
    }
  }
  assert.equal(await pressUseAsInput('{"a":{"b":1}}\n{"a":{"b":2}}\n', 'records.jsonl', 'flatten'), '{"a.b":1}\n{"a.b":2}\n');
  // One record in a .jsonl file is still JSON Lines.
  assert.equal(await pressUseAsInput('{"a":{"b":1}}\n', 'one.jsonl', 'flatten'), '{"a.b":1}\n');
  assert.equal(await pressUseAsInput('{"a.b":1}\n', 'one.jsonl', 'unflatten'), '{"a":{"b":1}}\n');
  // A JSON array is not JSON Lines: it stays a formatted array.
  assert.equal(await pressUseAsInput('[{"a":{"b":1}},{"a":{"b":2}}]', 'records.json', 'flatten'), '[\n  {\n    "a.b": 1\n  },\n  {\n    "a.b": 2\n  }\n]');
});

test('Use as input on JSON Lines whose records grow big: no parse or rewrite on the main thread when it applies', async () => {
  // (32 bytes of NDJSON unflatten to 3 MB: rewriting the preview as lines took ~130 ms in one go. The conversion now
  // writes the lines, in steps.)
  const text = '{"x[250000]":1}\n{"y.z":2}\n';
  let ms = Infinity;
  const back = await pressUseAsInput(text, 'big.ndjson', 'unflatten', (t) => (ms = t));
  assert.equal(back, `{"x":[${'null,'.repeat(250000)}1]}\n{"y":{"z":2}}\n`);
  assert.ok(ms < 30, `applying took ${ms.toFixed(1)} ms of CPU time`);
});

test('Download on Flatten and Unflatten: JSON Lines in, a .jsonl file of type application/x-ndjson out', async () => {
  // (The output was JSON Lines, but the file was named .flat.json / .nested.json and typed as JSON.)
  const download = async (text: string, name: string | null, target: 'flatten' | 'unflatten') => {
    const s = await converted(text, name, target);
    const saved: string[][] = [];
    s.engine.save = (out: string, file: string, type: string) => saved.push([out, file, type]);
    await s.engine.downloadConvert();
    await flush();
    return saved;
  };
  const lines = '{"a":{"b":1}}\n{"a":{"b":2}}\n';
  for (const name of ['events.jsonl', 'events.ndjson', null]) {
    const base = name ? 'events' : 'data';
    assert.deepEqual(await download(lines, name, 'flatten'), [['{"a.b":1}\n{"a.b":2}\n', `${base}.flat.jsonl`, 'application/x-ndjson']], String(name));
    assert.deepEqual(await download('{"a.b":1}\n{"a.b":2}\n', name, 'unflatten'), [[lines, `${base}.nested.jsonl`, 'application/x-ndjson']], String(name));
  }
  // Not JSON Lines: JSON, named and typed as before.
  assert.deepEqual(await download('[{"a":{"b":1}}]', 'events.json', 'flatten'), [['[\n  {\n    "a.b": 1\n  }\n]', 'events.flat.json', 'application/json']]);
  assert.deepEqual(await download('{"a":{"b":1}}', null, 'flatten'), [['{\n  "a.b": 1\n}', 'data.flat.json', 'application/json']]);
});
