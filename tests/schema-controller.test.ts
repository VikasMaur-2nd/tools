import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_KEYS, SchemaController, type SchemaEditor, type SchemaHost } from '../lib/schema/controller';
import type { Outcome } from '../lib/schema/client';
import type { ValidateRequest, ValidateResult } from '../lib/schema/index';

// The Schema view's state (lib/schema/controller.ts): what is saved, and which results show (review round 1,
// findings 4 and 6).

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
  setValue(next: string) {
    const same = next === this.text;
    this.text = next;
    if (!same) this.onChange?.('set');
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

function setup(stored: Record<string, string> = {}) {
  const storage = new Map(Object.entries(stored));
  const asked: { req: ValidateRequest; done: (o: Outcome) => void }[] = [];
  const host: SchemaHost = {
    main: () => null,
    docIsJson: () => true,
    read: (k) => storage.get(k) ?? null,
    write: (k, v) => (v === null ? storage.delete(k) : storage.set(k, v)),
    validator: () => ({ validate: (req, done) => void asked.push({ req, done }), destroy() {} }),
    track: () => undefined,
    report: () => undefined,
  };
  const ctl = new SchemaController(host);
  const ed = new FakeEditor();
  ed.onChange = (kind) => ctl.edited(kind);
  return { ctl, ed, storage, asked };
}

const result = (valid: boolean): ValidateResult => ({ state: 'ok', draft: 2020, draftFrom: 'default', valid, complete: true, errors: [], total: valid ? 0 : 1, problems: [], ms: { parse: 0, compile: 0, validate: 0 } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('finding 4: a schema opened over the page\'s sample is saved, with its name', () => {
  const { ctl, ed, storage } = setup({ [SCHEMA_KEYS.text]: '{"old": true}', [SCHEMA_KEYS.file]: 'old.json' });
  ctl.attach(ed, { seq: 1, text: '{"sample": true}', sample: true });
  assert.equal(ed.text, '{"sample": true}');
  // The untouched sample isn't saved over the visitor's own schema.
  ctl.persistNow();
  assert.deepEqual([storage.get(SCHEMA_KEYS.text), storage.get(SCHEMA_KEYS.file)], ['{"old": true}', 'old.json']);
  // Opening a file replaces it without typing: text and name are saved together.
  ctl.load('{"type": "object"}', 'orders.schema.json');
  assert.equal(ctl.state.file, 'orders.schema.json');
  ctl.persistNow();
  assert.deepEqual([storage.get(SCHEMA_KEYS.text), storage.get(SCHEMA_KEYS.file)], ['{"type": "object"}', 'orders.schema.json']);
  // Leaving the page saves what is pending.
  ed.type('{"type": "array"}');
  ctl.detach();
  assert.equal(storage.get(SCHEMA_KEYS.text), '{"type": "array"}');
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
  assert.deepEqual([storage.get(SCHEMA_KEYS.text), storage.has(SCHEMA_KEYS.file)], ['{"b": 2}', false]);
  ctl.renamed('a.json');
  ctl.persistNow();
  assert.equal(storage.get(SCHEMA_KEYS.file), 'a.json');
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
