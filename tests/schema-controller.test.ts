import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_KEYS, SchemaController, type SchemaEditor, type SchemaHost } from '../lib/schema/controller';
import type { Outcome } from '../lib/schema/client';
import type { ValidateRequest, ValidateResult } from '../lib/schema/index';

// The Schema view's state (lib/schema/controller.ts): what is saved, and which results show (review round 1,
// findings 4 and 6; round 2, findings 2, 3, 4 and 11).

class FakeEditor implements SchemaEditor {
  text = '';
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
  const host: SchemaHost = {
    main: () => null,
    docIsJson: () => true,
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
  };
  const ctl = new SchemaController(host);
  const ed = new FakeEditor();
  ed.onChange = () => ctl.edited();
  ed.onRenamed = (name) => ctl.renamed(name);
  return { ctl, ed, storage, asked };
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
  const { ctl, ed, asked } = setup();
  ctl.attach(ed, null);
  ed.type('{"type": "object"}');
  ctl.setDoc('{}');
  ctl.setOpen(true);
  await tick();
  assert.equal(asked.length, 1);
  asked[0].done(result(true));
  assert.equal(ctl.state.result?.valid, true);
  assert.equal(ctl.state.stale, false);
  // The schema gains a rule; before the debounce sends it, a reply for the old texts comes back.
  ctl.setDoc('{"x": 1}');
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
  const { ctl, ed, asked } = setup();
  ctl.attach(ed, null);
  ed.type('{"required": ["id"]}');
  ctl.setDoc('{"id": 1}');
  ctl.setOpen(true);
  await tick();
  assert.equal(asked.length, 1);
  asked[0].done(result(true));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [true, false]);
  // A second check for the same texts (Check formats) is on its way when the document is edited to {}.
  ctl.setOpts({ formats: true });
  await tick();
  assert.equal(asked.length, 2);
  ctl.docEdited();
  assert.equal(ctl.state.stale, true, 'stale from the edit on, before the new text is read');
  // Its reply comes before the engine reads the new text: not shown as current.
  asked[1].done(result(true));
  assert.equal(ctl.state.stale, true);
  await tick(60);
  assert.equal(asked.length, 2, 'nothing is checked before the new text comes');
  // The new text comes: checked, and its result shows.
  ctl.setDoc('{}');
  await tick(60);
  assert.equal(asked.length, 3);
  assert.equal(asked[2].req.doc, '{}');
  asked[2].done(result(false));
  assert.deepEqual([ctl.state.result?.valid, ctl.state.stale], [false, false]);
  // An edit undone before it is read: the same text comes again, and is checked again.
  ctl.docEdited();
  ctl.setDoc('{}');
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
