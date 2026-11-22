import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_KEYS, SchemaController, readDoc, type SchemaEditor, type SchemaHost } from '../lib/schema/controller';
import type { Outcome } from '../lib/schema/client';
import type { Fetched } from '../lib/schema/remote';
import type { ValidateRequest, ValidateResult } from '../lib/schema/index';

// The Schema view's state (lib/schema/controller.ts): what is saved, and which results show (review round 1,
// findings 4 and 6; round 2, findings 2, 3, 4 and 11; round 3, findings 2 and 3).

class FakeEditor implements SchemaEditor {
  private t = '';
  /** A new object after every change, as the app's editor's. */
  version: object = {};
  get text() {
    return this.t;
  }
  set text(v: string) {
    // (The same text again is no change: the version stays, as the app's editor's.)
    if (v !== this.t) this.version = {};
    this.t = v;
  }
  diags: number[] = [];
  onChange: ((kind: 'input' | 'paste' | 'set') => void) | null = null;
  get length() {
    return this.text.length;
  }
  init(text: string) {
    this.text = text;
  }
  /** Steps of whole replacements, for undo: [text before, names before and after]. */
  steps: { before: string; names?: [string | null, string | null] }[] = [];
  onRenamed: ((name: string | null) => void) | null = null;
  setValue(next: string, _caret?: number, _load?: boolean, names?: [string | null, string | null]) {
    const same = next === this.text;
    this.steps.push({ before: this.text, names });
    this.text = next;
    if (!same) this.onChange?.('set');
  }
  /** Undo of the last whole replacement: the text before, and its file name told (as the app's editor does). */
  undo() {
    const step = this.steps.pop()!;
    this.text = step.before;
    this.onChange?.('set');
    if (step.names) this.onRenamed?.(step.names[0]);
  }
  type(next: string) {
    this.text = next;
    this.onChange?.('input');
  }
  setDiagnostics(list: { p: number }[]) {
    this.diags = list.map((d) => d.p);
  }
  destroy() {}
}

/** `quota`: the longest value the storage takes (a longer one is refused and its key removed, as SchemaView's wrapper does). */
function setup(stored: Record<string, string> = {}, quota = Infinity) {
  const storage = new Map(Object.entries(stored));
  const asked: { req: ValidateRequest; done: (o: Outcome) => void }[] = [];
  /** Fetches asked for (remote schemas), each answered by the test; and what analytics got. */
  const fetches: { urls: string[]; signal: AbortSignal; progress: (n: number) => void; answer: (r: Fetched[] | null) => void }[] = [];
  const tracked: number[][] = [];
  /** Which document is there (the engine's docId). */
  const doc = { id: 1 };
  const host: SchemaHost = {
    main: () => null,
    docIsJson: () => true,
    docId: () => doc.id,
    read: (k) => storage.get(k) ?? null,
    write: (k, v) => {
      if (v !== null && v.length > quota) {
        storage.delete(k);
        return false;
      }
      if (v === null) storage.delete(k);
      else storage.set(k, v);
      return true;
    },
    validator: () => ({ validate: (req, done) => void asked.push({ req, done }), destroy() {} }),
    track: () => undefined,
    report: () => undefined,
    fetchSchemas: (urls, signal, progress) => new Promise((answer) => void fetches.push({ urls, signal, progress, answer })),
    trackFetch: (...n) => void tracked.push(n),
  };
  const ctl = new SchemaController(host);
  const ed = new FakeEditor();
  ed.onChange = () => ctl.edited();
  ed.onRenamed = (name) => ctl.renamed(name);
  /** A new document (the engine's newDoc): told at once, its text later (setDoc). */
  const newDoc = () => {
    doc.id++;
    ctl.docEdited();
  };
  return { ctl, ed, storage, asked, doc, newDoc, fetches, tracked };
}

/** What is saved: the record's text and name (null: none). */
const saved = (storage: Map<string, string>) => {
  const rec = storage.get(SCHEMA_KEYS.doc);
  return rec ? (JSON.parse(rec) as { text: string; file: string | null }) : null;
};

const result = (valid: boolean): ValidateResult => ({ state: 'ok', draft: 2020, draftFrom: 'default', valid, complete: true, errors: [], total: valid ? 0 : 1, problems: [], ms: { parse: 0, compile: 0, validate: 0 } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('finding 4: a schema opened over the page\'s sample is saved, with its name', () => {
  const { ctl, ed, storage } = setup({ [SCHEMA_KEYS.text]: '{"old": true}', [SCHEMA_KEYS.file]: 'old.json' });
  ctl.attach(ed, { seq: 1, text: '{"sample": true}', sample: true });
  assert.equal(ed.text, '{"sample": true}');
  // The untouched sample isn't saved over the visitor's own schema.
  ctl.persistNow();
  assert.deepEqual([storage.get(SCHEMA_KEYS.text), storage.get(SCHEMA_KEYS.file), saved(storage)], ['{"old": true}', 'old.json', null]);
  // Opening a file replaces it without typing: text and name are saved together (one record; the old keys go).
  ctl.load('{"type": "object"}', 'orders.schema.json');
  assert.equal(ctl.state.file, 'orders.schema.json');
  ctl.persistNow();
  assert.deepEqual(saved(storage), { text: '{"type": "object"}', file: 'orders.schema.json' });
  assert.deepEqual([storage.has(SCHEMA_KEYS.text), storage.has(SCHEMA_KEYS.file)], [false, false]);
  // Leaving the page saves what is pending.
  ed.type('{"type": "array"}');
  ctl.detach();
  assert.equal(saved(storage)?.text, '{"type": "array"}');
  // Coming back: the saved schema, with its name (the sample was taken already).
  const ed2 = new FakeEditor();
  ctl.attach(ed2, { seq: 1, text: '{"sample": true}', sample: true });
  assert.deepEqual([ed2.text, ctl.state.file], ['{"type": "array"}', 'orders.schema.json']);
  ctl.detach();
});

test('finding 4: a name never goes with another text', () => {
  const { ctl, ed, storage } = setup();
  ctl.attach(ed, null);
  ctl.load('{"a": 1}', 'a.json');
  ctl.persistNow();
  ctl.load('{"b": 2}', null);
  ctl.persistNow();
  assert.deepEqual(saved(storage), { text: '{"b": 2}', file: null });
  ctl.renamed('a.json');
  ctl.persistNow();
  assert.equal(saved(storage)?.file, 'a.json');
  ctl.detach();
});

test('finding 6: a reply for older texts never shows as the current result', async () => {
  const { ctl, ed, asked, doc } = setup();
  ctl.attach(ed, null);
  ed.type('{"type": "object"}');
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  await tick();
  assert.equal(asked.length, 1);
  asked[0].done(result(true));
  assert.equal(ctl.state.result?.valid, true);
  assert.equal(ctl.state.stale, false);
  // The schema gains a rule; before the debounce sends it, a reply for the old texts comes back.
  ctl.setDoc('{"x": 1}', doc.id);
  await tick(60);
  assert.equal(asked.length, 2);
  ed.type('{"type": "object", "required": ["id"]}');
  assert.equal(ctl.state.stale, true);
  asked[1].done(result(true));
  assert.equal(ctl.state.stale, true, 'still stale: the reply was for the schema without required');
  // The request for the current texts publishes.
  await tick(200);
  assert.equal(asked.length, 3);
  assert.match(asked[2].req.schema, /required/);
  asked[2].done(result(false));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [false, false]);
  // An option change and closing the view outdate a pending reply too.
  ctl.setOpts({ formats: true });
  await tick();
  assert.equal(asked.length, 4);
  ctl.setOpen(false);
  asked[3].done(result(true));
  assert.equal(ctl.state.result?.valid, false);
  ctl.detach();
});

test('round 2, finding 2: an edit of the document makes the shown result stale at once; a reply for the text before never shows as current', async () => {
  const { ctl, ed, asked, doc, newDoc } = setup();
  ctl.attach(ed, null);
  ed.type('{"required": ["id"]}');
  ctl.setDoc('{"id": 1}', doc.id);
  ctl.setOpen(true);
  await tick();
  assert.equal(asked.length, 1);
  asked[0].done(result(true));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [true, false]);
  // A second check for the same texts (Check formats) is on its way when the document is edited to {}.
  ctl.setOpts({ formats: true });
  await tick();
  assert.equal(asked.length, 2);
  newDoc();
  assert.equal(ctl.state.stale, true, 'stale from the edit on, before the new text is read');
  // Its reply comes before the engine reads the new text: not shown as current.
  asked[1].done(result(true));
  assert.equal(ctl.state.stale, true);
  await tick(60);
  assert.equal(asked.length, 2, 'nothing is checked before the new text comes');
  // The new text comes: checked, and its result shows.
  ctl.setDoc('{}', doc.id);
  await tick(60);
  assert.equal(asked.length, 3);
  assert.equal(asked[2].req.doc, '{}');
  asked[2].done(result(false));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [false, false]);
  // An edit undone before it is read: the same text comes again, and is checked again.
  newDoc();
  ctl.setDoc('{}', doc.id);
  await tick(60);
  assert.equal(asked.length, 4);
  asked[3].done(result(false));
  assert.equal(ctl.state.stale, false);
  ctl.detach();
});

test('round 2, finding 3: Undo back to the page\'s sample saves nothing over the visitor\'s own schema', () => {
  const mine = JSON.stringify({ text: '{"mine": true}', file: 'mine.json' });
  const { ctl, ed, storage } = setup({ [SCHEMA_KEYS.doc]: mine });
  ctl.attach(ed, { seq: 1, text: '{"sample": true}', sample: true });
  ctl.load('{"type": "object"}', 'orders.schema.json');
  // Undo before the save: the sample, unnamed, again.
  ed.undo();
  assert.deepEqual([ed.text, ctl.state.file], ['{"sample": true}', null]);
  ctl.persistNow();
  assert.equal(storage.get(SCHEMA_KEYS.doc), mine);
  // Typed over, then undone back to it: the same.
  ed.type('{"sample": false}');
  ed.type('{"sample": true}');
  ctl.persistNow();
  assert.equal(storage.get(SCHEMA_KEYS.doc), mine);
  // Redo: the file is the visitor's, saved with its name.
  ctl.load('{"type": "object"}', 'orders.schema.json');
  ctl.persistNow();
  assert.deepEqual(saved(storage), { text: '{"type": "object"}', file: 'orders.schema.json' });
  ctl.detach();
});

test('round 2, finding 4: Generate handed over before the view first opens is taken once, by attach', () => {
  const { ctl, ed } = setup({ [SCHEMA_KEYS.doc]: JSON.stringify({ text: '{"mine": true}', file: null }) });
  // The palette queued it and opened the view: the editor comes, with the saved schema, and generating is asked for.
  assert.equal(ctl.attach(ed, { seq: 7, generate: true }), true);
  assert.equal(ed.text, '{"mine": true}');
  // The view's effect sees the same hand-over: already taken.
  assert.equal(ctl.take({ seq: 7, generate: true }), false);
  // A later one is taken there.
  assert.equal(ctl.take({ seq: 8, generate: true }), true);
  ctl.detach();
});

test('round 2, finding 11: a storage too full for the text keeps no name without it; the keys from before are read', () => {
  // Saved before the record: the two keys are read.
  const old = setup({ [SCHEMA_KEYS.text]: '{"a": 1}', [SCHEMA_KEYS.file]: 'a.json' });
  old.ctl.attach(old.ed, null);
  assert.deepEqual([old.ed.text, old.ctl.state.file], ['{"a": 1}', 'a.json']);
  old.ctl.detach();
  // A text the storage refuses, with a short name it would take: neither is kept.
  const { ctl, ed, storage } = setup({ [SCHEMA_KEYS.doc]: JSON.stringify({ text: '{"b": 2}', file: 'b.json' }) }, 200);
  ctl.attach(ed, null);
  ctl.load(JSON.stringify({ description: 'x'.repeat(300) }), 'new.json');
  ctl.persistNow();
  assert.deepEqual([saved(storage), storage.get(SCHEMA_KEYS.file) ?? null, storage.get(SCHEMA_KEYS.text) ?? null], [null, null, null]);
  ctl.detach();
  const again = setup(Object.fromEntries(storage));
  again.ctl.attach(again.ed, null);
  assert.deepEqual([again.ed.text, again.ctl.state.file], ['', null]);
  again.ctl.detach();
});

test('round 3, finding 2: a reply is shown only while its document is still the one there, whatever made it another', async () => {
  const { ctl, ed, asked, doc } = setup();
  ctl.attach(ed, null);
  ed.type('{"type": "object"}');
  ctl.setDoc('{"id": 1}', doc.id);
  ctl.setOpen(true);
  await tick();
  assert.equal(asked.length, 1);
  // Another document without an edit the view was told of (another input format, a reading still loading, huge mode).
  doc.id = 7;
  asked[0].done(result(true));
  assert.deepEqual([ctl.state.result, ctl.state.stale], [null, false], 'nothing shown for the document before');
  // Its text with which document it is: checked, shown.
  ctl.setDoc('[{"id": "1"}]', 7);
  await tick(60);
  assert.equal(asked.length, 2);
  asked[1].done(result(false));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [false, false]);
  // A text of a document that isn't the one there (an older reading's): not checked.
  ctl.setDoc('{"old": true}', 6);
  await tick(60);
  assert.equal(asked.length, 2);
  assert.equal(ctl.state.stale, true);
  // A result shown, then the document becomes another: the reply on its way is dropped, the result is stale.
  ctl.setDoc('[]', 7);
  await tick(60);
  assert.equal(asked.length, 3);
  doc.id = 8;
  asked[2].done(result(true));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [false, true]);
  ctl.detach();
});

test('round 3, finding 3: a schema replacement that comes later applies only if it is the last asked for, over the same schema', () => {
  const { ctl, ed } = setup();
  ctl.attach(ed, null);
  // Generating asked for, then a file opened before it is ready: the file stays.
  const generating = ctl.ask();
  const file = ctl.ask();
  ctl.load('{"title": "file"}', 'file.json');
  assert.deepEqual([ctl.still(generating), ctl.still(file)], [false, false]);
  // Asked for, then the schema typed in: it stays.
  const pasting = ctl.ask();
  assert.equal(ctl.still(pasting), true);
  ed.type('{"title": "typed"}');
  assert.equal(ctl.still(pasting), false);
  ctl.detach();
});

test('round 3, finding 2: every new document or reading goes through the engine\'s newDoc, which tells the Schema view', () => {
  const src = readFileSync('lib/engine/engine.ts', 'utf8');
  /** A method's body (up to its closing brace at two spaces). */
  const body = (head: string) => {
    const at = src.indexOf(head);
    assert.ok(at >= 0, head);
    return src.slice(at, src.indexOf('\n  }\n', at));
  };
  // The document's identity (docId) moves in one place, which tells the view at once; unique across engines (round 4,
  // finding 4: a page Next.js keeps and shows again makes another engine).
  assert.equal(src.match(/this\.docGen = \+\+docs/g)?.length, 1);
  assert.match(src, /^let docs = 0;$/m);
  assert.match(src, /private docGen = \+\+docs;/);
  const newDoc = body('private newDoc()');
  assert.match(newDoc, /this\.docGen = \+\+docs/);
  assert.match(newDoc, /this\.docWatch\?\.\(null\)/);
  // An edit, a load (file, URL, share link, sample, a huge file's handover back), another input format, CSV options.
  for (const head of ['private onChange = ', 'load(text: string, name', 'private setInputFormat(', 'setCsv(patch']) assert.match(body(head), /this\.newDoc\(\)/, head);
  // The text the view gets comes with which document it is, once read; a JWT's decoded JSON for the Schema view only
  // (round 4, finding 6: Compare is main's, its offsets are the token's).
  const left = body('leftDoc(): {');
  assert.match(left, /this\.readGen !== this\.docGen/);
  assert.match(left, /if \(this\.jwt\) return \{ text: this\.jwt\.json, id: this\.docGen \}/);
  assert.doesNotMatch(body('private compareLeft()'), /jwt/);
  // Read as whatever it is (a blank editor, a reading that fails) once analysed: never left waiting (round 4, finding 3).
  assert.match(src, /if \(this\.waitForJwt\(\) \|\| this\.waitForSource\(\)\) return;\n\s*\/\/ [^\n]*\n\s*this\.readGen = this\.docGen;/);
});

test('round 4, finding 3: a document that can\'t be read as its format is answered at once, never left on "Validating…"', async () => {
  const { ctl, ed, asked, doc } = setup();
  ctl.attach(ed, null);
  ed.type('{"type": "object"}');
  ctl.setDoc('{"a": 1}', doc.id);
  ctl.setOpen(true);
  await tick();
  asked[0].done(result(true));
  // Switched to XML, "<root>" typed: the reading fails. The view is told so, with the document there now.
  doc.id++;
  ctl.docEdited();
  ctl.setDoc(null, doc.id);
  await tick(60);
  assert.equal(asked.length, 2);
  assert.deepEqual([asked[1].req.unread, asked[1].req.doc], [true, '']);
  asked[1].done({ ...result(false), state: 'doc-unread' });
  assert.deepEqual([ctl.state.result?.state, ctl.state.stale, ctl.state.busy], ['doc-unread', false, false]);
  // Fixed: read again, validated again.
  doc.id++;
  ctl.docEdited();
  ctl.setDoc('{"root": null}', doc.id);
  await tick(60);
  assert.equal(asked.length, 3);
  assert.equal(asked[2].req.unread, undefined);
  ctl.detach();
});

test('round 4, finding 5: a replacement now, Clear over a blank schema too, outdates one asked for before', () => {
  const { ctl, ed } = setup();
  ctl.attach(ed, null);
  // Generate asked for over a blank schema, then Clear (the same text: the editor doesn't change).
  const generating = ctl.ask();
  ctl.load('', null);
  assert.equal(ctl.still(generating), false);
  ctl.detach();
});

test('round 5, finding 7: Generate waits for the document an edit is still being read into', async () => {
  // (leftDoc: id -1 while the analysis is on its way, then the document.)
  let calls = 0;
  const doc = () => (++calls < 3 ? { text: null, id: -1 } : { text: '{"a": 1}', id: 9 });
  assert.deepEqual(await readDoc(doc, 1), { text: '{"a": 1}', id: 9 });
  assert.equal(calls, 3);
  // Never read (a reader that never loads): as it is, after the tries.
  assert.deepEqual(await readDoc(() => ({ text: null, id: -1 }), 1, 3), { text: null, id: -1 });
  // SchemaView's Generate goes through it, asking before it waits (a schema loaded meanwhile wins).
  const view = readFileSync('components/SchemaView.tsx', 'utf8');
  assert.match(view, /const asked = ctl\.ask\(\);\n\s*const doc = await readDoc\(\(\) => e\.leftDoc\(\)\);/);
});

test('share links: a link\'s schema is loaded with its name and options (defaults where it names none); share() gives them back', () => {
  const { ctl, ed, storage } = setup({ [SCHEMA_KEYS.opts]: JSON.stringify({ draft: 2019, formats: true }) });
  ctl.attach(ed, null);
  assert.deepEqual(ctl.share(), { text: '', draft: '2019-09', formats: true });
  // A link with only a schema: the options it shows are the defaults (as the sharer had them).
  ctl.take({ seq: 1, text: '{"type": "object"}', name: null, formats: false });
  assert.deepEqual([ed.text, ctl.state.file, ctl.state.draft, ctl.state.formats], ['{"type": "object"}', null, null, false]);
  assert.deepEqual(ctl.share(), { text: '{"type": "object"}' });
  // A schema by URL keeps its file name; draft-07 and Check formats as the link says.
  ctl.take({ seq: 2, text: '{"minimum": 0}', name: 'n.schema.json', draft: 'draft-07', formats: true });
  assert.deepEqual([ctl.state.file, ctl.state.draft, ctl.state.formats], ['n.schema.json', 7, true]);
  assert.deepEqual(ctl.share(), { text: '{"minimum": 0}', draft: 'draft-07', formats: true });
  assert.deepEqual(JSON.parse(storage.get(SCHEMA_KEYS.opts)!), { draft: 7, formats: true });
  // A draft name the link misspells: the default (links pass names on as written: lib/link.ts).
  ctl.take({ seq: 4, text: '{"minimum": 1}', name: null, draft: 'draft-99', formats: false });
  assert.deepEqual([ctl.state.draft, ctl.state.formats], [null, false]);
  ctl.setOpts({ draft: 7, formats: true });
  // A schema handed over another way (the palette's, a page's) leaves the options alone.
  ctl.take({ seq: 3, text: '{}' });
  assert.deepEqual([ctl.state.draft, ctl.state.formats], [7, true]);
  // Undo gives the schema before back (the visitor's own one too).
  ed.undo();
  assert.equal(ed.text, '{"minimum": 1}');
  ctl.detach();
});

/** A result whose schema refers to remote schemas it couldn't resolve. */
const withRemote = (remote: string[] | undefined, valid = false): ValidateResult => ({ ...result(valid), complete: !remote, ...(remote && { remote }) });

test('remote $refs: nothing is fetched until asked; then once, and validated again with what came; failures said and kept', async () => {
  const { ctl, ed, asked, doc, fetches, tracked } = setup();
  ctl.attach(ed, null);
  ed.type('{"$ref": "https://a.test/s.json"}');
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  await tick();
  asked[0].done(withRemote(['https://a.test/s.json', 'https://b.test/t.json']));
  // Results with remote refs don't fetch anything by themselves, however often they come.
  ctl.setOpts({ formats: true });
  await tick();
  asked[1].done(withRemote(['https://a.test/s.json', 'https://b.test/t.json']));
  assert.equal(fetches.length, 0);
  assert.equal(asked[1].req.resources, undefined);
  // Asked: both, once each.
  ctl.fetchRemote(['https://a.test/s.json', 'https://b.test/t.json', 'https://a.test/s.json']);
  assert.deepEqual(fetches[0].urls, ['https://a.test/s.json', 'https://b.test/t.json']);
  fetches[0].progress(1);
  assert.deepEqual(ctl.state.remote.fetching, { done: 1, count: 2 });
  fetches[0].answer([{ url: 'https://a.test/s.json', text: '{"type": "object"}' }, { url: 'https://b.test/t.json', failure: { kind: 'cors' } }]);
  await tick();
  assert.deepEqual([ctl.state.remote.fetching, ctl.state.remote.failed], [null, { 'https://b.test/t.json': { kind: 'cors' } }]);
  assert.deepEqual(tracked, [[2, 1, 1]]);
  // Validated again, with the one that came (the failed one stays unresolved: not fully checked, never valid).
  assert.equal(asked.length, 3);
  assert.deepEqual(asked[2].req.resources, { 'https://a.test/s.json': '{"type": "object"}' });
  asked[2].done(withRemote(['https://b.test/t.json']));
  // What came is kept for the tab: the next check needs no fetch; a retry asks only for the failed one.
  ctl.setOpts({ formats: false });
  await tick();
  assert.deepEqual(asked[3].req.resources, { 'https://a.test/s.json': '{"type": "object"}' });
  assert.equal(asked[3].req.resources, asked[2].req.resources, 'the same object: the worker isn\'t sent it again');
  ctl.fetchRemote(['https://a.test/s.json', 'https://b.test/t.json'], true);
  assert.deepEqual(fetches[1].urls, ['https://b.test/t.json']);
  fetches[1].answer([{ url: 'https://b.test/t.json', text: '{}' }]);
  await tick();
  assert.deepEqual(ctl.state.remote.failed, {});
  ctl.detach();
});

test('remote $refs: a change while fetching stops it and nothing it brings applies; closing the view too', async () => {
  const { ctl, ed, asked, doc, fetches } = setup();
  ctl.attach(ed, null);
  ed.type('{"$ref": "https://a.test/s.json"}');
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  await tick();
  asked[0].done(withRemote(['https://a.test/s.json']));
  // The schema changes while the fetch is on its way: stopped; its late reply is dropped, never kept for later.
  ctl.fetchRemote(['https://a.test/s.json']);
  ed.type('{"$ref": "https://a.test/s.json", "type": "object"}');
  assert.equal(fetches[0].signal.aborted, true);
  assert.equal(ctl.state.remote.fetching, null);
  fetches[0].answer([{ url: 'https://a.test/s.json', text: '{"old": true}' }]);
  await tick(200);
  assert.equal(asked[asked.length - 1].req.resources, undefined, 'the late reply was not kept');
  // The document changes: the same.
  ctl.fetchRemote(['https://a.test/s.json']);
  ctl.setDoc('{"x": 1}', doc.id);
  assert.equal(fetches[1].signal.aborted, true);
  // The view closes: the same.
  ctl.fetchRemote(['https://a.test/s.json']);
  ctl.setOpen(false);
  assert.equal(fetches[2].signal.aborted, true);
  // Closed, nothing is fetched.
  ctl.fetchRemote(['https://a.test/s.json']);
  assert.equal(fetches.length, 3);
  ctl.detach();
});

test('remote $refs: at most 20 a click, the rest on the next; dismissing hides only the list dismissed', async () => {
  const { ctl, ed, asked, doc, fetches } = setup();
  ctl.attach(ed, null);
  ed.type('{}');
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  await tick();
  const urls = Array.from({ length: 25 }, (_, i) => `https://a.test/${i}.json`);
  asked[0].done(withRemote(urls));
  ctl.fetchRemote(urls);
  assert.equal(fetches[0].urls.length, 20);
  fetches[0].answer(fetches[0].urls.map((url) => ({ url, text: '{}' })));
  await tick();
  ctl.fetchRemote(urls);
  assert.deepEqual(fetches[1].urls, urls.slice(20));
  ctl.dismissRemote(['https://x.test/a']);
  assert.equal(ctl.state.remote.dismissed, 'https://x.test/a');
  ctl.detach();
});

test('remote $refs: twenty that fail never hold back the rest; failures are tried again only when asked (review 2, finding 3)', async () => {
  const { ctl, ed, asked, doc, fetches } = setup();
  ctl.attach(ed, null);
  ed.type('{}');
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  await tick();
  const urls = Array.from({ length: 21 }, (_, i) => `https://a.test/${i}.json`);
  asked[0].done(withRemote(urls));
  // The first twenty all 404.
  ctl.fetchRemote(urls);
  assert.deepEqual(fetches[0].urls, urls.slice(0, 20));
  fetches[0].answer(fetches[0].urls.map((url) => ({ url, failure: { kind: 'status' as const, status: 404, statusText: 'Not Found' } })));
  await tick();
  assert.equal(Object.keys(ctl.state.remote.failed).length, 20);
  // Asked again: the 21st, never tried, not the twenty that failed.
  ctl.fetchRemote(urls);
  assert.deepEqual(fetches[1].urls, [urls[20]]);
  fetches[1].answer([{ url: urls[20], text: '{}' }]);
  await tick();
  // Nothing new left: the plain fetch asks for nothing; trying the failed ones again asks for them, twenty at a time.
  const n = fetches.length;
  ctl.fetchRemote(urls);
  assert.equal(fetches.length, n);
  ctl.fetchRemote(urls, true);
  assert.deepEqual(fetches[n].urls, urls.slice(0, 20));
  ctl.detach();
});

test('a link\'s schema by URL is validated with that URL as its base: through edits, saved with it, back with Undo (review 2, finding 5)', async () => {
  const { ctl, ed, asked, doc, storage } = setup();
  ctl.attach(ed, null);
  ctl.setDoc('{}', doc.id);
  ctl.setOpen(true);
  ctl.take({ seq: 7, text: '{"$ref": "types.json"}', name: 'main.json', url: 'https://example.com/schemas/main.json' });
  await tick(200);
  assert.equal(asked.at(-1)!.req.base, 'https://example.com/schemas/main.json');
  ed.type('{"$ref": "types.json", "type": "object"}');
  await tick(200);
  assert.equal(asked.at(-1)!.req.base, 'https://example.com/schemas/main.json', 'kept through an edit');
  ctl.persistNow();
  assert.equal(JSON.parse(storage.get('jf:schema-doc')!).url, 'https://example.com/schemas/main.json');
  // Another schema loaded (a file): none. Undo back past that load: the URL again.
  ctl.load('{"$ref": "types.json"}', 'other.json');
  await tick(200);
  assert.equal(asked.at(-1)!.req.base, undefined);
  ctl.renamed('main.json');
  await tick(200);
  assert.equal(asked.at(-1)!.req.base, 'https://example.com/schemas/main.json');
  // A file of the same name loaded later forgets it.
  ctl.load('{}', 'main.json');
  ctl.renamed('main.json');
  await tick(200);
  assert.equal(asked.at(-1)!.req.base, undefined);
  ctl.detach();
  // Saved with it: a new page's controller reads it back.
  const next = setup({ 'jf:schema-doc': JSON.stringify({ text: '{"$ref": "types.json"}', file: 'main.json', url: 'https://example.com/schemas/main.json' }) });
  next.ctl.attach(next.ed, null);
  next.ctl.setDoc('{}', next.doc.id);
  next.ctl.setOpen(true);
  await tick(200);
  assert.equal(next.asked.at(-1)!.req.base, 'https://example.com/schemas/main.json');
  next.ctl.detach();
});
