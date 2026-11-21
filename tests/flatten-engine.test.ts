import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse, type ParseResult } from '../lib/json/parser';
import { EN } from '../lib/i18n/ui';

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
function session(text: string) {
  const calls: unknown[][] = [];
  const state: Dynamic = { settings: { view: 'convert', target: 'flatten' }, convert: { error: null } };
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error, Promise,
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
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
  const res: ParseResult = parse(text);
  engine.fresh = () => res;
  engine.convLater = () => null;
  engine.convOutput = () => FLAT;
  engine.toast = (...args: unknown[]) => calls.push(['toast', ...args]);
  engine.replaceText = (...args: unknown[]) => calls.push(['replace', ...args]);
  engine.setConvert = (...args: unknown[]) => calls.push(['setConvert', ...args]);
  return { engine, calls, ed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The calls as plain data (objects made in the engine's context have its prototypes). */
const plain = (calls: unknown[][], skip = '') => JSON.parse(JSON.stringify(calls.filter((c) => c[0] !== skip)));

test('Use as input on Flat JSON: the current document\'s output replaces the input, then Unflatten shows', async () => {
  const s = session(GOOD);
  s.engine.useOutput();
  await flush();
  assert.deepEqual(plain(s.calls, 'track'), [['replace', FLAT, 'Flattened input'], ['setConvert', { target: 'unflatten' }]]);
  assert.deepEqual(plain(s.calls.filter((c) => c[0] === 'track')), [['track', 'feature_used', { feature: 'use_output', view: 'convert' }]]);
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
