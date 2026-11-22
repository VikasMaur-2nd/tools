import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { paired } from '../lib/engine/store';
import { decodeDoc, parseLink } from '../lib/link';

// Share links and the Schema view, as the engine runs them: Share from the Schema view carries the schema (b,
// view=schema, its options), and a link with view=schema hands b to the schema editor, not to Compare.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = Record<string, any>;
const load = createRequire(__filename);
const source = readFileSync(resolve(__dirname, '../../lib/engine/engine.ts'), 'utf8').replaceAll('import.meta.url', '"file:///engine.js"');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [(ctx) => (root) => ts.visitNode(root, function visit(node: ts.Node): ts.VisitResult<ts.Node> | undefined {
    if (ts.isConstructorDeclaration(node)) return undefined;
    return ts.visitEachChild(node, visit, ctx);
  }) as ts.SourceFile] },
}).outputText;

function engine(view: string) {
  const state: Dynamic = { settings: { view, target: 'typescript', indent: '2' }, schemaIn: null };
  const calls: unknown[][] = [];
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error, Promise, queueMicrotask, setTimeout: () => 0, clearTimeout: () => undefined, location: { origin: 'https://tools.example' },
    CompressionStream, DecompressionStream, Response, TextDecoder, btoa, atob, Uint8Array, String,
    require: (name: string) => {
      if (name === './store') return { paired, store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
      if (name === '../analytics') return { track: () => undefined, reportError: () => undefined };
      if (name === '../analytics/load') return { noteLoad: (...a: unknown[]) => calls.push(['noteLoad', ...a]) };
      if (name === '../link' || name.startsWith('../json/') || name === './targets' || name === './rules') return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const e = new out.Engine();
  e.settings = state.settings;
  e.dead = false;
  e.inFmt = 'json';
  e.jwt = null;
  e.flushLoad = () => undefined;
  e.unlessTooLarge = (f: () => string) => f();
  e.load = (...a: unknown[]) => calls.push(['load', a[0]]);
  e.loadCompare = (...a: unknown[]) => calls.push(['loadCompare', a[0]]);
  e.setView = (v: string) => calls.push(['setView', v]);
  e.toast = (...a: unknown[]) => calls.push(['toast', a[0]]);
  e.ed = { text: '{\n  "id": 1\n}' };
  e.ed2 = { text: '' };
  return { e, state, calls };
}

test('Share from the Schema view: b is the schema (minified when valid, as typed otherwise), with view=schema and its options', async () => {
  const { e } = engine('schema');
  e.fresh = () => ({ root: {}, error: null, issues: [] });
  e.schemaShare = () => ({ text: '{\n  "type": "object",\n  "required": ["id"]\n}\n', draft: 'draft-07', formats: true });
  const { url, comparing } = await e.shareUrl();
  assert.equal(comparing, false);
  const link = parseLink(new URL(url).hash);
  assert.ok(link && typeof link === 'object' && link.b && 'data' in link.b);
  assert.deepEqual([await decodeDoc(link.b.data), link.view, link.draft, link.formats], ['{"type":"object","required":["id"]}', 'schema', 'draft-07', true]);
  // A schema that isn't strict JSON travels as typed; a blank one not at all.
  e.schemaShare = () => ({ text: '{ "type": "object", // note\n}' });
  const loose = parseLink(new URL((await e.shareUrl()).url).hash) as { b: { data: string }; view: string };
  assert.equal(await decodeDoc(loose.b.data), '{ "type": "object", // note\n}');
  e.schemaShare = () => ({ text: '  ' });
  const none = parseLink(new URL((await e.shareUrl()).url).hash) as Dynamic;
  assert.deepEqual([none.b, none.view], [undefined, 'schema']);
  // Another view: no schema (Compare's b as before).
  const other = engine('tree').e;
  other.fresh = () => ({ root: {}, error: null, issues: [] });
  other.schemaShare = () => ({ text: '{}' });
  assert.equal((parseLink(new URL((await other.shareUrl()).url).hash) as Dynamic).b, undefined);
});

test('opening a link: with view=schema, b goes to the schema editor; without, to Compare as before', async () => {
  const signal = new AbortController().signal;
  const s = engine('format');
  await s.e.openRequest({ a: { text: '{"id":1}' }, b: { text: '{"type":"object"}' }, view: 'schema', draft: 'draft-06', formats: true }, signal);
  assert.ok(!s.calls.some((c) => c[0] === 'loadCompare' || c[0] === 'noteLoad' && c[2] === 2));
  assert.deepEqual({ ...s.state.schemaIn, seq: 0 }, { seq: 0, text: '{\n  "type": "object"\n}', name: null, draft: 'draft-06', formats: true });
  assert.deepEqual(s.calls.find((c) => c[0] === 'setView'), ['setView', 'schema']);
  assert.match(String(s.calls.find((c) => c[0] === 'toast')![1]), /^Loaded shared JSON and its schema/);
  // Only a schema.
  const only = engine('format');
  await only.e.openRequest({ b: { text: '{}' }, view: 'schema' }, signal);
  assert.deepEqual([only.state.schemaIn.formats, only.calls.find((c) => c[0] === 'toast')![1]], [false, 'Loaded the shared schema']);
  // An old link: b and no view is Compare.
  const old = engine('format');
  await old.e.openRequest({ a: { text: '1' }, b: { text: '2' } }, signal);
  assert.deepEqual([old.state.schemaIn, old.calls.find((c) => c[0] === 'loadCompare'), old.calls.find((c) => c[0] === 'setView')], [null, ['loadCompare', '2'], ['setView', 'compare']]);
});
