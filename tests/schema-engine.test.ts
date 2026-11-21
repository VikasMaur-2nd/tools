import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { paired } from '../lib/engine/store';

// The engine's side of the Schema view (review round 5, finding 3): a document whose reader can't load is
// finished, as one that can't be read, never left waiting.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = Record<string, any>;
const source = readFileSync(resolve(__dirname, '../../lib/engine/engine.ts'), 'utf8').replaceAll('import.meta.url', '"file:///engine.js"');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [(ctx) => (root) => ts.visitNode(root, function visit(node: ts.Node): ts.VisitResult<ts.Node> | undefined {
    if (ts.isConstructorDeclaration(node)) return undefined;
    return ts.visitEachChild(node, visit, ctx);
  }) as ts.SourceFile] },
}).outputText;

test('round 5, finding 3: an input format whose reader fails to load: "Conversion failed", and the Schema view told it can\'t be read', async () => {
  const state: Dynamic = { settings: { view: 'schema' }, status: { kind: 'valid' } };
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error, Promise, queueMicrotask, setTimeout: () => 0, clearTimeout: () => undefined,
    require: (name: string) => {
      if (name === './store') return { paired, store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
      if (name === '../analytics') return { track: () => undefined, reportError: () => undefined };
      return {};
    },
  });
  const engine = new out.Engine();
  engine.settings = state.settings;
  engine.dead = false;
  engine.inFmt = 'xml';
  engine.ed = { blank: false, text: '<root>', version: {} };
  // (The reading before was a JWT's: nothing of it may stay.)
  engine.jwt = { json: '{"old": true}' };
  engine.loadSource = () => Promise.reject(new Error('offline'));
  const told: unknown[] = [];
  engine.docWatch = (doc: unknown) => told.push(doc);
  assert.equal(engine.waitForSource(), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.status.kind, 'error');
  assert.deepEqual(JSON.parse(JSON.stringify(told)), [{ text: null, id: engine.docId }]);
  assert.deepEqual(JSON.parse(JSON.stringify(engine.leftDoc())), { text: null, id: engine.docId });
});
