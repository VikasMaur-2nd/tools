import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse, type JNode } from '../lib/json/parser';
import { EN } from '../lib/i18n/ui';

// The Table's exports as the engine runs them (Copy / Download CSV, Download Excel): what they write, from
// which node, under which names. convert/xlsx is the real one, behind a spy.

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

function session(view: string, fileName: string, doc: string, shown: (root: JNode) => JNode | null) {
  const calls: unknown[][] = [];
  const state: Dynamic = { settings: { view }, fileName };
  const xlsx = load(resolve(__dirname, '../lib/convert/xlsx'));
  const out: Dynamic = {};
  runInNewContext(js, {
    exports: out, performance, URL, Blob, Error, Promise,
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: (patch: Dynamic) => Object.assign(state, patch) } };
      if (name === '../analytics') return { track: () => {}, reportError: (...args: unknown[]) => calls.push(['error', ...args]) };
      if (name === '../i18n/ui') return { rt: EN };
      if (name === '../convert/xlsx') {
        return {
          ...xlsx,
          toXlsx: (n: JNode, opts: unknown) => (calls.push(['toXlsx', n, opts]), Promise.resolve(new Blob(['x']))),
          toCsv: (n: JNode) => (calls.push(['toCsv', n]), xlsx.toCsv(n)),
        };
      }
      if (name.startsWith('../json/')) return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
  });
  const res = parse(doc);
  const engine = new out.Engine();
  engine.settings = state.settings;
  engine.fresh = () => res;
  engine.table = { exportNode: () => shown(res.root!), exportOrder: () => null };
  engine.toast = (...args: unknown[]) => calls.push(['toast', ...args]);
  engine.saveBlob = (blob: Blob, name: string) => calls.push(['save', blob, name]);
  return { engine, calls, root: res.root! };
}

const DOC = '{"meta":{"n":1},"users":[{"name":"Ada","address":{"city":"Oslo"}},{"name":"Bo","address":{"city":"Rome"}}],"other":[{"a":1},{"a":2},{"a":3}]}';
const users = (root: JNode) => (root.v as JNode[])[1];
const flush = () => new Promise((r) => setTimeout(r, 0));

test('Download CSV and Download Excel write the table shown, the same way', async () => {
  const s = session('table', 'people.json', DOC, users);
  s.engine.downloadCSV();
  await flush();
  await s.engine.exportExcel();
  const csv = s.calls.find((c) => c[0] === 'toCsv')!;
  const x = s.calls.find((c) => c[0] === 'toXlsx')!;
  assert.equal(csv[1], users(s.root));
  assert.equal(x[1], users(s.root));
  const saved = s.calls.filter((c) => c[0] === 'save');
  assert.deepEqual(saved.map((c) => c[2]), ['people.csv', 'people.xlsx']);
  assert.equal(await (saved[0][1] as Blob).text(), 'name,address.city\r\nAda,Oslo\r\nBo,Rome\r\n');
  assert.equal((x[2] as { sheetName: string }).sheetName, 'people');
});

test('nothing open in the table: says so; Export to Excel elsewhere writes the main array of records', async () => {
  const s = session('table', 'a.json', DOC, () => null);
  s.engine.downloadCSV();
  s.engine.copyCSV();
  await flush();
  assert.deepEqual(s.calls.map((c) => c[0] + ' ' + c[1]), ['toast Open an array or object in the table first', 'toast Open an array or object in the table first']);
  const f = session('format', 'a.json', DOC, users);
  await f.engine.exportExcel();
  assert.equal(f.calls.find((c) => c[0] === 'toXlsx')![1], (f.root.v as JNode[])[2]);
});

test('the sheet name is the file name cut to 31 units, never half a character', async () => {
  for (const [file, sheet] of [
    ['a'.repeat(30) + '😀b.json', 'a'.repeat(30)],
    ['a'.repeat(29) + '😀b.json', 'a'.repeat(29) + '😀'],
    ['😀'.repeat(20) + '.json', '😀'.repeat(15)],
    ['.json', 'Sheet1'],
  ]) {
    const s = session('table', file, DOC, users);
    await s.engine.exportExcel();
    assert.equal((s.calls.find((c) => c[0] === 'toXlsx')![2] as { sheetName: string }).sheetName, sheet, file);
  }
});
