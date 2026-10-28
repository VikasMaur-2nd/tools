import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Doc } from '../lib/engine/doc';
import { NO_VALUE, parse, type ParseResult } from '../lib/json/parser';
import { diffResults } from './oracle/compare';

/** A body's bytes, as File gives them (`stream`), from its text (a rejected text: the stream fails). */
const streamOf = (text: string | Promise<string>) => new ReadableStream<Uint8Array>({
  async start(c) {
    try {
      c.enqueue(new TextEncoder().encode(await text));
      c.close();
    } catch (e) {
      c.error(e);
    }
  },
});

const load = createRequire(__filename);

// Exercise the real Engine methods without its browser-only constructor. A fake task queue
// lets a layout commit land before its deferred onReady callback, exactly as in the browser.
function session() {
  const tasks = new Map<number, () => void>();
  let timer = 0;
  const defer = (fn: () => void) => { tasks.set(++timer, fn); return timer; };
  const state: Record<string, unknown> = { fileName: null };
  // The status bar as shown: what the store holds at the end of each task (see look).
  const seen: unknown[] = [];
  const look = () => { if (seen.at(-1) !== state.status) seen.push(state.status); };
  const errors: { error: unknown; source: string }[] = [];
  const workers: { terminated: boolean; messages: Record<string, unknown>[]; onerror?: (e: { preventDefault(): void }) => void; onmessage?: (e: { data: unknown }) => void; postMessage(data: unknown): void; terminate(): void }[] = [];
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
    exports, performance, URL, console, AbortController, queueMicrotask,
    setTimeout: defer, clearTimeout: (id: number) => tasks.delete(id), window: { setTimeout: defer },
    require: (name: string) => {
      if (name === './store') return { store: { get: () => state, set: (patch: object) => { Object.assign(state, patch); } } };
      if (name === './idle') return { soon: defer, idle: defer };
      if (name === '../analytics') return { reportError: (error: unknown, source: string) => errors.push({ error, source }) };
      if (name === '../analytics/load') return { noteLoad() {}, watchPastes() {} };
      if (name.startsWith('../json/') || name === './doc' || name === './rules' || name === './asks') return load(resolve(__dirname, '../lib/engine', name));
      return {};
    },
    Worker: class {
      terminated = false;
      messages: Record<string, unknown>[] = [];
      constructor() { workers.push(this); }
      postMessage(data: Record<string, unknown>) { this.messages.push(data); }
      terminate() { this.terminated = true; }
    },
  });
  const engine = new exports.Engine();
  engine.settings = { view: 'format', indent: '2', minify: false, escape: false, sortKeys: false };
  engine.ed = { version: Doc.of('{"a":1}'), text: '{"a":1}' };
  engine.fmt = { text: '', el: {}, snapshotText: () => () => '', setText: () => {}, inlineIndex: () => ({ close: new Int32Array(0), depth: new Int32Array(0) }) };
  const tick = () => { const first = tasks.entries().next().value; if (first) { tasks.delete(first[0]); first[1](); } look(); return !!first; };
  return { engine, workers, tick, errors, state, seen, look, tasks };
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
  // (Minified: the formatting worker makes the output. Pretty is read off the tape: see the test below.)
  engine.settings.minify = true;
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

test('the analysis worker warmed up before a big document analyses it; a file picker or a drag replaces a used one, never one still analysing', async () => {
  const { engine, workers, tick } = session();
  const sent = (w: (typeof workers)[0]) => w.messages.map((m) => JSON.parse(JSON.stringify(m)));
  // Idle (twice): one worker, warming up.
  engine.warmAnalysis();
  engine.warmAnalysis();
  assert.equal(workers.length, 1);
  assert.deepEqual(sent(workers[0]), [{ id: -2, warmTape: true }]);
  // A new document comes: the warm worker holds nothing, so it stays, and analyses it.
  engine.releaseWorkerDocuments();
  assert.equal(workers[0].terminated, false);
  let trees = 0;
  engine.queueAnalysis(0, Doc.of('{"a":1}'), null, () => trees++, 0);
  tick();
  assert.equal(workers.length, 1, 'no other worker');
  assert.equal(workers[0].messages.at(-1)!.analysis, true);
  // Still analysing it: a file picker or a drag leaves it be.
  engine.warmAnalysis(true);
  assert.equal(workers.length, 1);
  workers[0].onmessage!({ data: { id: 0, tree: { nodes: { length: 1 }, head: {} }, metrics: { bytes: 7, min: 7, extra: 0, units: 0 } } });
  await engine.tapeCode();
  assert.equal(trees, 1);
  // Done: idle leaves it, a file picker or a drag makes a warm one in its place.
  engine.warmAnalysis();
  assert.equal(workers.length, 1);
  engine.warmAnalysis(true);
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(sent(workers[1]), [{ id: -2, warmTape: true }]);
  // Once it has had a document, a new one lets it go, as before.
  engine.queueAnalysis(0, Doc.of('{"b":2}'), null, () => trees++, 0);
  tick();
  engine.releaseWorkerDocuments();
  assert.equal(workers[1].terminated, true);
  assert.equal(engine.analysisWorker, null);
});

test('one analysis at a time: documents asked for while one is in flight wait, and only the newest is sent when it answers', async () => {
  const { engine, workers, tick } = session();
  const analyses = () => workers.flatMap((w) => w.messages.filter((m) => m.analysis).map((m) => m.id));
  let trees = 0;
  const ask = (k: number) => {
    engine.loadSeq = k;
    engine.queueAnalysis(k, Doc.of(`{"v":${k}}`), null, () => trees++, 0);
    tick();
  };
  ask(1);
  assert.deepEqual(analyses(), [1]);
  // Three more versions while the first is analysed (a burst of pastes): none is sent yet.
  ask(2);
  ask(3);
  ask(4);
  assert.deepEqual(analyses(), [1], 'nothing more while one is in flight');
  // The first answers that it stopped (a newer one came): the newest goes, the two between never.
  const w = workers[0];
  w.onmessage!({ data: { id: 1, dropped: true } });
  assert.deepEqual(analyses(), [1, 4]);
  w.onmessage!({ data: { id: 4, tree: { nodes: { length: 1 }, head: {} }, metrics: { bytes: 7, min: 7, extra: 0, units: 0 } } });
  await engine.tapeCode();
  assert.equal(trees, 1, 'only the newest result is used');
  // Idle again: the next one goes at once. A stale tree also ends the one in flight.
  ask(5);
  ask(6);
  assert.deepEqual(analyses(), [1, 4, 5]);
  w.onmessage!({ data: { id: 5, tree: { nodes: { length: 1 }, head: {} }, metrics: { bytes: 7, min: 7, extra: 0, units: 0 } } });
  await engine.tapeCode();
  assert.deepEqual(analyses(), [1, 4, 5, 6]);
  assert.equal(trees, 1, 'the stale one is not used');
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

/**
 * Times a parse in steps by a fake clock, the same on any machine: each reading moves it on by `by` ms
 * (0: it stands still, so a step never ends early).
 */
function clock(t: TestContext, by: number) {
  let now = 0;
  t.mock.method(performance, 'now', () => (now += by));
}

const big = JSON.stringify(Array.from({ length: 100_000 }, (_, k) => ({ id: k, name: 'Zoë ' + k, tags: ['a', 'b'], ok: k % 3 === 0, x: null })));

test('a big new document is parsed in steps, then analysed with the one-shot result and its byte size', (t) => {
  clock(t, 1);
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

test('an edit or another load drops a parse in steps at its next step', (t) => {
  clock(t, 1);
  const { engine, tick, analysed } = stepsSession(big);
  engine.analyzeInSteps();
  tick();
  engine.loadSeq++;
  for (let k = 0; k < 1000; k++) tick();
  assert.equal(analysed.length, 0);
  assert.equal(engine.steps, null);
});

test('a command finishes a parse in steps at once, from where it got to', (t) => {
  clock(t, 1);
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

test('a big document the first step parses is analysed at once, as in one go', (t) => {
  clock(t, 0);
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

// ── A document with no value ──

/** The real analyze() on `text`, with fakes for the views it updates. */
function analyzeSession(text: string) {
  const s = session();
  const { engine } = s;
  const diagnostics: unknown[][] = [];
  engine.ed = { version: Doc.of(text), length: text.length, text, ls: [0], blank: !/\S/.test(text), setDiagnostics: (d: unknown[]) => diagnostics.push(d), setScope() {}, setJwt() {} };
  engine.tree = { setRoot() {} };
  engine.table = { setNode() {} };
  engine.setGraphRoot = engine.measure = engine.syncTableState = engine.afterDoc = engine.releaseWorkerDocuments = () => {};
  engine.resetNext = true;
  engine.loadSeq = 3;
  return { ...s, diagnostics };
}

test('a blank document shows the empty state, not "No JSON value", whether analysed at once or parsed in steps', (t) => {
  clock(t, 1);
  for (const text of ['', ' \n\t', '\ufeff', '\u00a0\n', ' '.repeat(1_000_100), '\n'.repeat(1_000_100)]) {
    const { engine, state, tick } = analyzeSession(text);
    engine.analyzeInSteps();
    for (let k = 0; k < 100_000 && engine.steps; k++) tick();
    const label = `${text.length} chars`;
    assert.equal(engine.steps, null, label);
    assert.equal((state.status as { kind: string }).kind, 'empty', label);
    assert.equal(state.empty, true, label);
    assert.equal(engine.res, null, label);
  }
});

test('a document with only a comment is not blank: parsed in steps, its error is "No JSON value" at its end', (t) => {
  clock(t, 1);
  const text = '// ' + 'x'.repeat(1_000_100) + '\n';
  const { engine, tick, analysed } = stepsSession(text);
  engine.analyzeInSteps();
  for (let k = 0; k < 100_000 && !analysed.length; k++) tick();
  assert.deepEqual(analysed[0]!.error, { p: text.length, m: NO_VALUE });
  assert.equal(analysed[0]!.root, null);
});

// ── A big load's progress ("Parsing… N%", see Engine.progress) ──

type Shown = { kind: string; progress?: number } | undefined;
/** (Objects made in the engine's context have its own prototypes.) */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

/** A session whose editor takes a document as the browser's does: setting its text is a change. */
function loadSession() {
  const s = session();
  const { engine } = s;
  let version = Doc.of('');
  engine.ed = {
    get version() { return version; }, get length() { return version.length; }, get text() { return version.toString(); },
    blank: false, pasteFull: false, el: {}, setBrackets() {},
    setValue(text: string) { version = Doc.of(text); engine.onChange('set'); },
  };
  engine.persistSoon = () => {};
  engine.drawFormat = () => {};
  // (A change schedules a typed analysis much later, by then dropped: the fake queue has no time.)
  engine.analyzeTyped = () => {};
  engine.analyze = () => { s.state.status = { kind: 'valid', warnings: 0 }; };
  return s;
}

/** Statuses shown with a percent: from 0, never going back, short of 100, and then only the result. */
function checkShown(seen: unknown[]) {
  const shown = (seen as Shown[]).filter((st) => st !== undefined);
  const last = shown.findLastIndex((st) => st!.kind === 'parsing');
  const percents = shown.slice(0, last + 1).map((st) => st!.progress);
  assert.ok(percents.every((p) => p !== undefined), `a status without its percent: ${JSON.stringify(shown)}`);
  assert.equal(percents[0], 0);
  for (let k = 1; k < percents.length; k++) assert.ok(percents[k]! >= percents[k - 1]!, `went back: ${percents.join(', ')}`);
  assert.ok(percents.at(-1)! < 1);
  assert.equal(shown.at(-1)!.kind, 'valid');
  return percents as number[];
}

const bigArray = (n: number) => '[' + '1,'.repeat(n) + '1]';

test('a big load in the Format view shows its percent from the start, only growing, through both workers', async () => {
  const { engine, workers, tick, seen, look } = loadSession();
  // (Minified: the formatting worker makes the output. Pretty is read off the tape: see the test below.)
  engine.settings.minify = true;
  await engine.tapeCode();
  const text = bigArray(1_500_000);
  engine.load(text, 'big.json', false, true);
  look();
  assert.deepEqual(plain(seen), [{ kind: 'parsing', progress: 0 }], 'working from the start');
  // The text goes to the formatting worker in chunks, then it reports how far it got.
  while (tick());
  const [formatting] = workers;
  assert.equal(formatting.messages.find((m) => m.start)?.progress, true);
  // (Replies to the request being worked on: the editor taking the text is a change, so the analysis has a later id.)
  const send = (w: (typeof workers)[0], data: object) => { w.onmessage!({ data: { id: engine.loadSeq, ...data } }); look(); };
  send(formatting, { progress: 0.4 });
  send(formatting, { progress: 0.75 });
  send(formatting, { progress: 0.2 }); // (late and lower: ignored)
  const out = ' '.repeat(2_500_000);
  for (let i = 0; i < out.length; i += 256_000) send(formatting, { field: 'out', chunk: out.slice(i, i + 256_000), size: out.length });
  send(formatting, { out: null, chunkedOut: true, index: { starts: new Int32Array(1), close: new Int32Array(1), depth: new Int32Array(1), maxLen: 0 } });
  // Drawn: then the editor takes the text (its change doesn't show), and the analysis worker gets it.
  while (tick());
  const analysis = workers[1];
  assert.ok(analysis, 'the analysis worker started');
  assert.equal(analysis.messages.find((m) => m.start)?.progress, true);
  send(analysis, { progress: 0.3 });
  send(analysis, { progress: 0.75 });
  send(analysis, { tree: { nodes: { length: 1 }, head: {} }, metrics: { bytes: text.length, min: text.length, extra: 0, units: 0 } });
  const percents = [...new Set(checkShown(seen))];
  assert.ok(percents.length >= 12, `shown ${percents.join(', ')}`);
  // Each step's share, in order: sending, formatting, receiving, the editor, sending again, analysing.
  for (const p of [0.05, 0.32, 0.37, 0.5, 0.55, 0.88]) assert.ok(percents.includes(p), `${p} in ${percents.join(', ')}`);
});

test('a tape that arrives before its code loads waits for it, and messages after it keep their order', async () => {
  const { engine, workers, tick, seen, look } = loadSession();
  engine.settings.minify = true;
  const text = bigArray(1_500_000);
  engine.load(text, 'big.json', false, true);
  look();
  assert.deepEqual(plain(seen), [{ kind: 'parsing', progress: 0 }], 'working from the start');
  // The text goes to the formatting worker in chunks, then it reports how far it got.
  while (tick());
  const [formatting] = workers;
  assert.equal(formatting.messages.find((m) => m.start)?.progress, true);
  // (Replies to the request being worked on: the editor taking the text is a change, so the analysis has a later id.)
  const send = (w: (typeof workers)[0], data: object) => { w.onmessage!({ data: { id: engine.loadSeq, ...data } }); look(); };
  send(formatting, { progress: 0.4 });
  send(formatting, { progress: 0.75 });
  send(formatting, { progress: 0.2 }); // (late and lower: ignored)
  const out = ' '.repeat(2_500_000);
  for (let i = 0; i < out.length; i += 256_000) send(formatting, { field: 'out', chunk: out.slice(i, i + 256_000), size: out.length });
  send(formatting, { out: null, chunkedOut: true, index: { starts: new Int32Array(1), close: new Int32Array(1), depth: new Int32Array(1), maxLen: 0 } });
  // Drawn: then the editor takes the text (its change doesn't show), and the analysis worker gets it.
  while (tick());
  const analysis = workers[1];
  assert.ok(analysis, 'the analysis worker started');
  assert.equal(analysis.messages.find((m) => m.start)?.progress, true);
  send(analysis, { progress: 0.3 });
  send(analysis, { progress: 0.75 });
  send(analysis, { tree: { nodes: { length: 1 }, head: {} }, metrics: { bytes: text.length, min: text.length, extra: 0, units: 0 } });
  // (A late progress report after the tape: it must not be handled before it.)
  send(analysis, { progress: 0.9 });
  assert.equal((plain(seen).at(-1) as { kind: string }).kind, 'parsing', 'held until the code is here');
  await engine.tapeCode();
  await new Promise((r) => setTimeout(r, 0));
  look();
  checkShown(seen);
});


test('a big load in another view goes from reading the file to parsing it here in steps', async (t) => {
  clock(t, 5);
  const { engine, tick, seen, look } = loadSession();
  engine.settings.view = 'tree';
  engine.tree = { setRoot() {} };
  engine.table = { setNode() {} };
  engine.setGraphRoot = () => {};
  Object.assign(engine.ed, { setDiagnostics() {}, setScope() {} });
  engine.toast = () => {};
  const text = JSON.stringify(Array.from({ length: 60_000 }, (_, k) => ({ id: k, name: 'Zoë ' + k })));
  assert.ok(text.length > 1_000_000 && text.length < 2_000_000);
  const file = { name: 'big.json', size: text.length, text: () => Promise.resolve(text), stream: () => streamOf(Promise.resolve(text)) };
  const reading = engine.loadFile(file);
  look();
  assert.deepEqual(plain(seen), [{ kind: 'parsing', progress: 0 }], 'working while the file is read');
  await reading;
  look();
  while (tick());
  const percents = checkShown(seen);
  assert.ok(percents.at(-1)! >= 0.5, `shown ${percents.join(', ')}`);
});

test('a file that cannot be read leaves what was shown before', async () => {
  const { engine, state } = loadSession();
  engine.toast = () => {};
  const before = (state.status = { kind: 'valid', warnings: 0 });
  await engine.loadFile({ name: 'big.json', size: 5_000_000, text: () => Promise.reject(new Error('gone')), stream: () => streamOf(Promise.reject(new Error('gone'))) });
  assert.equal(state.status, before);
});

test('small loads, typing and edits show no percent', () => {
  const { engine, workers, tick, seen, look } = loadSession();
  // Under a million characters: as before, "Parsing…" once its output is drawn, then the result.
  engine.load(JSON.stringify({ padding: 'x'.repeat(500_000) }), null, false, true);
  look();
  while (tick());
  assert.deepEqual(plain(seen), [{ kind: 'parsing' }, { kind: 'valid', warnings: 0 }]);
  // Typing in a big document: no percent asked of the worker, none shown.
  const text = bigArray(1_500_000);
  engine.ed.setValue(text);
  look();
  engine.outputFirst(text, null, () => {}, true);
  while (tick());
  const typed = workers[0].messages.find((m) => m.start && m.id === engine.loadSeq);
  assert.equal(typed?.progress, false);
  workers[0].onmessage!({ data: { id: engine.loadSeq, progress: 0.5 } });
  look();
  assert.ok((seen as Shown[]).every((st) => st?.progress === undefined), JSON.stringify(seen));
});

test('an edit during a big load ends its percent', () => {
  const { engine, workers, tick, state } = loadSession();
  engine.settings.minify = true;
  engine.load(bigArray(1_500_000), 'big.json', false, true);
  while (tick());
  const formatting = workers[0];
  formatting.onmessage!({ data: { id: engine.loadSeq, progress: 0.4 } });
  assert.equal((state.status as Shown)?.progress, 0.15);
  formatting.onmessage!({ data: { id: engine.loadSeq, out: '[]' } });
  while (tick());
  const id = engine.loadSeq;
  assert.equal((state.status as Shown)?.progress, 0.55, 'drawn, in the editor, sent for analysis');
  engine.onChange('input');
  assert.deepEqual(plain(state.status), { kind: 'parsing' });
  // Nothing of the load brings it back.
  workers[1].onmessage!({ data: { id, progress: 0.9 } });
  engine.progress(0.9);
  assert.deepEqual(plain(state.status), { kind: 'parsing' });
});

test('a parse here in steps goes on from where a big load got to', (t) => {
  clock(t, 1);
  const { engine, tick, seen, look } = stepsSession(big);
  engine.startProgress();
  engine.progress(0.5);
  engine.analyzeInSteps();
  look();
  while (engine.steps) tick();
  const percents = (seen as Shown[]).map((st) => st!.progress!);
  assert.equal(percents[0], 0.5);
  assert.ok(percents.length > 2, percents.join(', '));
  for (let k = 1; k < percents.length; k++) assert.ok(percents[k] > percents[k - 1], percents.join(', '));
});

test('a big file loaded goes to the analysis worker as the file, not its text; after a reset, as its text', async () => {
  const { engine, workers, tick } = loadSession();
  await engine.tapeCode();
  const body = bigArray(1_200_000).replace(/,/g, ',\r\n');
  const file = new Blob([body]);
  engine.load(body, 'big.json', false, true, file);
  for (let k = 0; k < 1000 && tick(); k++);
  const text = body.replace(/\r\n/g, '\n');
  assert.equal(engine.ed.text, text);
  const analysis = workers.find((w) => w.messages.some((m) => m.analysis));
  assert.ok(analysis, 'the analysis worker got the document');
  const asked = analysis.messages.filter((m) => m.analysis);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].file, file);
  assert.equal(asked[0].size, text.length);
  assert.ok(!analysis.messages.some((m) => m.start || m.chunk !== undefined || m.text !== undefined), 'no text sent');
  // The worker couldn't read it as the page did (changed on disk since): then the page sends the text.
  analysis.onmessage!({ data: { id: engine.loadSeq, reset: true } });
  for (let k = 0; k < 1000 && tick(); k++);
  const now = workers.find((w) => w.messages.some((m) => m.start));
  assert.ok(now, 'the text goes after a reset');
  assert.equal(now.messages.filter((m) => m.chunk !== undefined).map((m) => m.chunk).join(''), text);
  assert.ok(!now.messages.some((m) => m.file && m !== asked[0]), 'the file is not sent again');
  // Text that came another way (pasted, a link): sent as text.
  const before = workers.map((w) => w.messages.length);
  engine.load(body, null, false, true);
  for (let k = 0; k < 1000 && tick(); k++);
  const after = workers.flatMap((w, i) => w.messages.slice(before[i] ?? 0));
  assert.ok(after.some((m) => m.analysis && m.start), 'the text goes');
  assert.ok(!after.some((m) => m.file), 'no file');
});

test('a big JSON Lines file with CRLF reaches the editor and the analysis worker with the same LF text', async () => {
  const { engine, workers, tick } = loadSession();
  await engine.tapeCode();
  const lines: string[] = [];
  for (let i = 0, size = 0; size < 2_600_000; i++) { const line = JSON.stringify({ i, s: 'é東😀'.repeat(1 + (i % 7)) }); lines.push(line); size += line.length + 2; }
  engine.load(lines.join('\r\n') + '\r\n', 'records.jsonl', false, true);
  for (let k = 0; k < 1000 && tick(); k++);
  const lf = lines.join('\n') + '\n';
  assert.equal(engine.ed.text, lf, 'the editor holds the text with LF line ends');
  const sent = workers.flatMap((w) => w.messages).map((m) => [m.text, m.chunk].find((t) => typeof t === 'string') as string | undefined).filter((t) => t !== undefined);
  assert.ok(sent.length > 0, 'the text went to a worker');
  assert.ok(sent.every((t) => !t.includes('\r')), 'no worker gets a CR: its offsets are the editor\'s');
  assert.equal(sent.join('').length >= lf.length, true);
});

test('a big document shown Pretty is read off its tape a line at a time, and Copy waits for its lines', async () => {
  const { engine, tick, state, tasks } = session();
  await engine.tapeCode();
  const { parse: parseTape } = load(resolve(__dirname, '../lib/json/tape-parser'));
  const { lazyResult } = load(resolve(__dirname, '../lib/json/lazy'));
  const { stringify } = load(resolve(__dirname, '../lib/json/format'));
  const text = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `Zoë ${i} 😀`, tags: ['a', i, {}], ok: i % 2 === 0, s: 'say "hi"\n' })));
  assert.ok(text.length >= 2_000_000);
  engine.settings.view = 'format';
  engine.good = lazyResult(parseTape(text), text);
  engine.goodText = text;
  engine.goodVer = {};
  engine.goodMetrics = { min: text.length, extra: 123, units: 10, bytes: text.length };
  state.fmt = {};
  type Lines = { slice(): string; length: number; index: { starts: Int32Array } };
  const view: { shown: Lines | null } = { shown: null };
  engine.fmt.setLines = (lines: Lines) => { view.shown = lines; };
  engine.fmt.setNotes = () => {};
  engine.runFormat();
  // Its lines are indexed in short steps: Copy and Download wait for them meanwhile.
  const waiting = engine.outputPending();
  assert.ok(waiting, 'Copy waits');
  // (Its time limit is the newest task: the fake queue has no time, so it would run before the steps.)
  tasks.delete(Math.max(...tasks.keys()));
  while (tick());
  const shown = view.shown;
  assert.ok(shown, 'drawn');
  const want = stringify(parse(text).root!, '  ');
  assert.equal(shown.length, want.length);
  assert.equal(shown.slice(), want);
  assert.equal(await waiting, want);
  assert.deepEqual(plain(state.fmt), { lines: shown.index.starts.length, pretty: text.length + 123 + 20, minified: text.length, escaped: 0 });
  // The engine keeps no text of it, and a second run draws nothing new.
  assert.equal(engine.fmtOut, '');
  assert.equal(engine.fmtText, '');
  engine.runFormat();
  while (tick());
  assert.equal(view.shown, shown);
  // Minified isn't read off the tape: the view gets a made text again.
  let made: string | null = null;
  engine.fmt.setText = (t: string) => { made = t; };
  engine.settings.minify = true;
  engine.runFormat();
  while (tick());
  assert.equal(made, JSON.stringify(JSON.parse(text)));
});

test('switching a big document to Minify formats it in the worker, not on the page', () => {
  const { engine, workers, tick } = session();
  const text = '[' + '1,'.repeat(1_100_000) + '1]';
  const ver = Doc.of(text);
  engine.settings.view = 'format';
  engine.settings.minify = true;
  engine.good = parse(text);
  engine.goodText = text;
  engine.goodVer = ver;
  engine.ed = { version: ver, length: ver.length, text };
  engine.fmtKey = 'falsefalsefalse  ';
  engine.fmt.setText = () => assert.fail('formatted on the page');
  engine.runFormat();
  while (tick());
  const sent = workers.flatMap((w) => w.messages).find((m) => m.start && m.fast);
  assert.ok(sent, 'the formatting worker got the document');
  assert.equal(sent.indent, '');
});
