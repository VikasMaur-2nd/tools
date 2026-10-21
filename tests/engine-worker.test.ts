import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Doc } from '../lib/engine/doc';
import { parse, type ParseResult } from '../lib/json/parser';
import { diffResults } from './oracle/compare';

const load = createRequire(__filename);

// Exercise the real Engine methods without its browser-only constructor. A fake task queue
// lets a layout commit land before its deferred onReady callback, exactly as in the browser.
function session() {
  const tasks = new Map<number, () => void>();
  let timer = 0;
  const defer = (fn: () => void) => { tasks.set(++timer, fn); return timer; };
  const state = { fileName: null };
  const errors: { error: unknown; source: string }[] = [];
  const workers: { terminated: boolean; onerror?: (e: { preventDefault(): void }) => void; postMessage(data: unknown): void; terminate(): void }[] = [];
  const exports: Record<string, new () => Record<string, any>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = readFileSync(resolve(__dirname, '../../lib/engine/engine.ts'), 'utf8').replaceAll('import.meta.url', '"file:///engine.js"');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [ctx => root => ts.visitNode(root, function visit(node: ts.Node): ts.VisitResult<ts.Node> | undefined {
      if (ts.isConstructorDeclaration(node)) return undefined;
      return ts.visitEachChild(node, visit, ctx);
    }) as ts.SourceFile] },
  }).outputText;
  runInNewContext(js, {
    exports, performance, URL, console,
    setTimeout: defer, clearTimeout: (id: number) => tasks.delete(id), window: { setTimeout: defer },
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: () => {} } };
      if (name === './idle') return { soon: defer, idle: defer };
      if (name === '../analytics') return { reportError: (error: unknown, source: string) => errors.push({ error, source }) };
      if (name.startsWith('../json/') || name === './doc' || name === './rules') return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
    Worker: class {
      terminated = false;
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    },
  });
  const engine = new exports.Engine();
  engine.settings = { view: 'format', indent: '2', minify: false, escape: false, sortKeys: false };
  engine.ed = { version: Doc.of('{"a":1}'), text: '{"a":1}' };
  engine.fmt = { text: '', el: {}, snapshotText: () => () => '', setText: () => {}, inlineIndex: () => ({ close: new Int32Array(0), depth: new Int32Array(0) }) };
  const tick = () => { const first = tasks.entries().next().value; if (first) { tasks.delete(first[0]); first[1](); } };
  return { engine, workers, tick, errors };
}

test('worker patch uses the displayed text when layout commits before onReady', () => {
  const { engine } = session();
  const text = '{"a":1,"padding":"' + 'x'.repeat(200_000) + '"}';
  const messages: unknown[] = [];
  engine.worker = { postMessage: (m: unknown) => messages.push(m) };
  engine.workerWarm = true;
  engine.workerDoc = Doc.of(text);
  engine.fmt.text = 'older output';
  engine.fmtWorkerId = 7;
  engine.fmtWorkerText = engine.fmt.text;
  engine.outputFirst(text, null, () => {}, true);
  const job = engine.reindentJob;
  // A different layout finishes, but onReady has not acknowledged it yet.
  engine.fmt.text = 'newer output';
  let args: unknown[] = [];
  engine.drawFormat = (...got: unknown[]) => { args = got; };
  job.done('correct full output', undefined, undefined, undefined, undefined, { base: 7, prefix: 1, suffix: 1 }, 'patch', true);
  assert.equal(args[4], undefined, 'a change against old text must not patch the new model');
  assert.equal(args[5], undefined);
  assert.equal(args[6], false);
});

test('worker requests omit an unacknowledged layout base', () => {
  const { engine } = session();
  engine.worker = { postMessage: () => {} };
  engine.workerWarm = true;
  engine.fmtWorkerId = 7;
  engine.fmtWorkerText = 'old';
  engine.fmt.text = 'new';
  let base: unknown;
  engine.postDocument = (_w: unknown, request: { base?: number }) => { base = request.base; };
  engine.outputFirst(' '.repeat(200_000), null, () => {}, true);
  assert.equal(base, 0);
});

for (const text of ['', '{"small":true}', ' '.repeat(2_000_000)]) {
  test(`new loads release retained workers and document bases at ${text.length} characters`, () => {
    const { engine } = session();
    let clears = 0;
    let stops = 0;
    engine.worker = { postMessage: (data: { clear?: boolean }) => { if (data.clear) clears++; } };
    engine.analysisWorker = { terminate: () => { stops++; } };
    engine.workerDoc = engine.analysisDoc = Doc.of('x'.repeat(2_000_000));
    engine.reindentJob = {};
    engine.workerParse = {};
    engine.outputFirst = () => false;
    engine.finishLoad = () => {};
    engine.load(text, null, false);
    assert.equal(clears, 1);
    assert.equal(stops, 1);
    assert.equal(engine.workerDoc, null);
    assert.equal(engine.analysisDoc, null);
    assert.equal(engine.reindentJob, null);
    assert.equal(engine.workerParse, null);
  });
}

test('analysis worker stops after three failures without a synchronous whole-document fallback', () => {
  const { engine, workers, tick, errors } = session();
  let fallbacks = 0;
  for (let i = 0; i < 5; i++) {
    engine.queueAnalysis(0, Doc.of('{}'), null, () => { fallbacks++; });
    tick();
    workers.at(-1)?.onerror?.({ preventDefault() {} });
  }
  assert.equal(workers.length, 3);
  assert.equal(fallbacks, 0);
  assert.equal(errors.length, 3, 'each active worker failure is reported once');
  assert.ok(errors.every((e) => e.source === 'worker'));
});

test('settings reformat retained output before its analysis is ready', () => {
  const { engine } = session();
  engine.fmtSrcVer = Doc.of('{"a":1}');
  engine.pendingFmtWorkerId = 7;
  engine.fmtKey = 'old settings';
  let called = 0;
  engine.outputFirst = () => { called++; return true; };
  engine.runFormat();
  assert.equal(called, 1);
});

for (const kind of ['blank', 'paste', 'shrink']) {
  test(`${kind} changes release retained worker documents`, () => {
    const { engine } = session();
    let clears = 0;
    let stops = 0;
    engine.worker = { postMessage: (data: { clear?: boolean }) => { if (data.clear) clears++; } };
    engine.analysisWorker = { postMessage() {}, terminate: () => { stops++; } };
    engine.workerDoc = engine.analysisDoc = Doc.of('x'.repeat(2_000_000));
    Object.assign(engine.ed, { blank: kind === 'blank', pasteFull: kind === 'paste', length: 1000, setBrackets() {} });
    engine.analyze = () => {};
    engine.outputFirst = () => false;
    engine.onChange(kind === 'paste' ? 'paste' : 'input');
    assert.equal(clears, 1);
    assert.equal(stops, 1);
    assert.equal(engine.workerDoc, null);
    assert.equal(engine.analysisDoc, null);
  });
}

test('large typed requests send bounded edits without flattening the document on the page', () => {
  const { engine } = session();
  const before = Doc.of('{"a":"' + 'x'.repeat(2_000_000) + '"}');
  const document = before.edit(6, 6, 'typed');
  document.toString = () => { throw new Error('flattened the full document while typing'); };
  engine.ed = { version: document, length: document.length, get text() { return document.toString(); } };
  let edit: unknown;
  engine.worker = { postMessage: (data: { edit?: unknown }) => { edit = data.edit; } };
  engine.workerDoc = before;
  engine.analyzeTyped();
  assert.deepEqual(edit, { a: 6, b: 6, ins: 'typed' });
});

test('worker patch uses pinned fold arrays when the viewer changes before the reply', () => {
  const { engine } = session();
  const close = new Int32Array([-1, 3, -1, -1]);
  const depth = new Int32Array([0, 1, 0, 0]);
  engine.fmt.inlineIndex = () => ({ close, depth });
  engine.fmt.text = engine.fmtWorkerText = 'old';
  engine.fmtWorkerId = 7;
  const worker = engine.reindentWorker();
  engine.outputFirst(' '.repeat(200_000), null, () => {}, true);
  const job = engine.reindentJob;
  let index: { close: Int32Array; depth: Int32Array } | undefined;
  job.done = (_out: unknown, _tree: unknown, _metrics: unknown, got: typeof index) => { index = got; };
  engine.fmt.text = 'new';
  engine.fmt.inlineIndex = () => { throw new Error('fold arrays were taken from the changed viewer'); };
  worker.onmessage({ data: { id: engine.loadSeq, out: 'result', indexReuse: true, index: { starts: new Int32Array([0, 1, 2, 3]), maxLen: 1 } } });
  assert.equal(index?.close, close);
  assert.equal(index?.depth, depth);
});

// ── A new big document parsed in steps (analyzeInSteps) ──

function stepsSession(text: string) {
  const s = session();
  const { engine } = s;
  const version = Doc.of(text);
  engine.ed = { version, length: text.length, text, setDiagnostics() {}, setScope() {} };
  engine.tree = { setRoot() {} };
  engine.table = { setNode() {} };
  engine.resetNext = true;
  engine.loadSeq = 3;
  const analysed: (ParseResult | undefined)[] = [];
  engine.analyze = (res?: ParseResult) => {
    analysed.push(res);
    engine.parsed = text;
    engine.res = res;
  };
  return { ...s, analysed };
}

const big = JSON.stringify(Array.from({ length: 100_000 }, (_, k) => ({ id: k, name: 'Zoë ' + k, tags: ['a', 'b'], ok: k % 3 === 0, x: null })));

test('a big new document is parsed in steps, then analysed with the one-shot result and its byte size', () => {
  const { engine, tick, analysed } = stepsSession(big);
  engine.analyzeInSteps();
  assert.equal(analysed.length, 0, 'the first step, at once, does not finish it');
  let steps = 0;
  while (!analysed.length && steps < 100_000) {
    tick();
    steps++;
  }
  assert.ok(steps > 1, `parsed in ${steps} steps`);
  assert.equal(diffResults(parse(big), analysed[0]!), null);
  assert.equal(engine.steps, null);
  assert.equal(engine.counted.bytes, Buffer.byteLength(big));
});

test('an edit or another load drops a parse in steps at its next step', () => {
  const { engine, tick, analysed } = stepsSession(big);
  engine.analyzeInSteps();
  tick();
  engine.loadSeq++;
  for (let k = 0; k < 1000; k++) tick();
  assert.equal(analysed.length, 0);
  assert.equal(engine.steps, null);
});

test('a command finishes a parse in steps at once, from where it got to', () => {
  const { engine, tick, analysed } = stepsSession(big);
  engine.analyzeInSteps();
  tick();
  const res = engine.fresh();
  assert.equal(analysed.length, 1);
  assert.equal(res, analysed[0]);
  assert.equal(diffResults(parse(big), analysed[0]!), null);
  for (let k = 0; k < 1000; k++) tick();
  assert.equal(analysed.length, 1, 'the dropped steps do nothing more');
});

test('a big document the first step parses is analysed at once, as in one go', () => {
  const text = big.slice(0, 1_200_000).replace(/,\{[^{}]*$/, ']');
  const { engine, analysed } = stepsSession(text);
  engine.analyzeInSteps();
  assert.equal(analysed.length, 1);
  assert.equal(diffResults(parse(text), analysed[0]!), null);
});

test('small documents and edits are analysed at once', () => {
  for (const [text, reset] of [['{"a":1}', true], [big, false]] as const) {
    const { engine, analysed } = stepsSession(text);
    engine.resetNext = reset;
    engine.analyzeInSteps();
    assert.deepEqual(analysed, [undefined]);
    assert.equal(engine.steps, null);
  }
});
