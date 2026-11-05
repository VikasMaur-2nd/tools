/**
 * The UI's round-5 notes (UI-NOTES-FOR-CORE.md 14–16):
 * 14. a kept session found after `ready` is said through the watch stream (onSummary), so nothing polls;
 * 15. replaceNode never repairs: strict JSON is re-indented, anything else goes in as typed;
 * 16. `steps`: the changes applied, as undo counts them (typing runs joined, steps the history let go of).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { BlockSource } from '../lib/huge/bytes';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import { keep, keptSteps, MemorySessionStore, sessionKey, type Kept } from '../lib/huge/session-store';
import type { HugeSummary } from '../lib/huge/types';
import { hugeMod, open, tapeMod } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();

function channel(): [Port, Port] {
  const a: Port = { onmessage: null, postMessage: (m) => setImmediate(() => b.onmessage?.({ data: m })) };
  const b: Port = { onmessage: null, postMessage: (m) => setImmediate(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

/** A session store whose look-ups take `delay` ms (IndexedDB opening late). */
class SlowStore extends MemorySessionStore {
  delay = 0;
  async get(key: string): Promise<Kept | null> {
    await new Promise((r) => setTimeout(r, this.delay));
    return super.get(key);
  }
}

function connect(file: Blob, store?: MemorySessionStore) {
  const [page, worker] = channel();
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), (f) => Object.assign(new BlockSource(f, 1 << 16, 8), { cached: true }), undefined, store);
  return new HugeClient(file, { name: (file as File).name }, undefined, page);
}

const docText = JSON.stringify({ meta: { n: 3 }, records: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }] }, null, 2);

test('notes 14: a kept session found after ready comes through onSummary; none: null; no store: null at ready', async () => {
  const file = new File([docText], 'a.json', { lastModified: 3 });
  const store = new SlowStore();
  // A session of this file: a space before it, two changes the history had let go of.
  await store.put(sessionKey('a.json', file.size, 3), { version: 1, pieces: [{ bytes: enc.encode(' ') }, { off: 0, len: file.size }], steps: [], applied: 0, dropped: 2, bytes: 1, time: 5 });
  store.delay = 300;
  const doc = connect(file, store);
  const pushed = new Promise<HugeSummary>((done) => (doc.onSummary = done));
  const s = await doc.ready;
  assert.equal(s.session, undefined, 'still looking at ready');
  const p = await pushed;
  assert.deepEqual(p.session, { steps: 2, bytes: 1, time: 5 }, 'pushed');
  assert.deepEqual((await doc.summary()).session, { steps: 2, bytes: 1, time: 5 });
  // Put back: its document, its count, nothing to undo; no longer offered.
  const r = await doc.restoreSession();
  assert.equal(r.steps, 2);
  assert.equal(r.canUndo, false);
  const after = await doc.summary();
  assert.equal(after.session, null);
  assert.equal(after.steps, 2);
  assert.equal(dec.decode(new Uint8Array(await (await doc.slice(0, after.size)).arrayBuffer())), ' ' + docText);
  doc.close();
  // None kept for this file: null, at ready or pushed after it.
  const other = connect(new File([docText], 'a.json', { lastModified: 4 }), store);
  const pushed2 = new Promise<HugeSummary>((done) => (other.onSummary = done));
  const s2 = await other.ready;
  assert.equal(s2.session === undefined ? (await pushed2).session : s2.session, null);
  other.close();
  // A quick look: in the ready summary if it ended first, else pushed (what the UI does: no polling).
  store.delay = 0;
  const quick = connect(new File([docText], 'a.json', { lastModified: 3 }), store);
  const pushed3 = new Promise<HugeSummary>((done) => (quick.onSummary = done));
  const s3 = await quick.ready;
  assert.deepEqual(s3.session !== undefined ? s3.session : (await pushed3).session, { steps: 2, bytes: 1, time: 5 }, 'quick');
  quick.close();
  // No store: nothing to look for.
  const none = connect(new File([docText], 'a.json', { lastModified: 3 }));
  assert.equal((await none.ready).session, null, 'no store');
  none.close();
});

test('notes 15: replaceNode puts strict JSON re-indented, anything else as typed (never repaired); node edits refuse it', () => {
  const bytes = enc.encode(docText);
  for (const typed of ['nul', 'tru', '{"x": 1,}', '{"x": 1', '[1 2]', "'s'", '1 2', '// c\n1', 'NaN', '"open']) {
    const d = open(bytes, 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
    const ed = new HugeEditor(d);
    const node = d.resolve(['meta'])!.node;
    ed.replaceNode(node, typed);
    const want = docText.replace('{\n    "n": 3\n  }', typed);
    assert.equal(dec.decode(d.src.read(0, d.src.size)), want, `as typed: ${JSON.stringify(typed)}`);
    assert.ok(d.summary().error, `the document says where it's wrong: ${JSON.stringify(typed)}`);
    // Its error is the normal path's for the same text.
    assert.equal(d.summary().error!.msg, parse(want).head.error?.message ?? d.summary().error!.msg);
    ed.undo();
    assert.equal(dec.decode(d.src.read(0, d.src.size)), docText);
    assert.equal(d.summary().error, null);
    // Node edits take strict JSON only.
    assert.throws(() => ed.setValue(d.resolve(['meta', 'n'])!.node, typed), /Invalid JSON/);
    assert.throws(() => ed.insert(d.resolve(['records'])!.node, 0, typed), /Invalid JSON/);
  }
  // Strict JSON: written as the document is.
  const d = open(bytes, 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  new HugeEditor(d).replaceNode(d.resolve(['meta'])!.node, '{"n":4,"m":[1,2]}');
  assert.equal(dec.decode(d.src.read(0, d.src.size)), docText.replace('{\n    "n": 3\n  }', '{\n    "n": 4,\n    "m": [\n      1,\n      2\n    ]\n  }'));
  assert.equal(d.summary().error, null);
});

test('notes 16: steps: +1 an edit or redo, -1 an undo, a typing run one, dropped steps still count, kept with a session', async () => {
  const doc = connect(new File([docText], 'a.json', { lastModified: 1 }));
  await doc.ready;
  let e = await doc.setValue((await doc.resolve(['meta', 'n']))!.node, '4');
  assert.equal(e.steps, 1);
  // A typing run: one step.
  const at = docText.indexOf('"a"') + 2;
  for (let i = 0; i < 3; i++) e = await doc.replace([{ a: at + i, b: at + i, text: 'x' }], true);
  assert.equal(e.steps, 2);
  e = (await doc.undo())!;
  assert.equal(e.steps, 1);
  e = (await doc.redo())!;
  assert.equal(e.steps, 2);
  e = await doc.replace([{ a: 0, b: 0, text: ' ' }]);
  assert.equal(e.steps, 3);
  assert.equal((await doc.summary()).steps, 3);
  for (let i = 0; i < 3; i++) e = (await doc.undo())!;
  assert.equal(e.steps, 0);
  doc.close();
  // The history letting its oldest steps go (past its bytes): still counted, and undo stops where it starts.
  const d = open(enc.encode(docText), 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const ed = new HugeEditor(d, 100);
  for (let i = 0; i < 5; i++) ed.apply([{ a: 0, b: 0, put: piecesOf(enc.encode(' '.repeat(40))) }]);
  assert.equal(ed.applied, 5);
  assert.ok(ed.droppedSteps >= 3, `dropped: ${ed.droppedSteps}`);
  let undone = 0;
  while (ed.undo()) undone++;
  assert.equal(ed.applied, ed.droppedSteps);
  assert.equal(undone, 5 - ed.droppedSteps);
  // Kept as a session: what didn't fit counts as dropped too.
  const k = keep(d.src.list, ed.history.steps, ed.history.applied, 1 << 20, ed.droppedSteps)!;
  assert.equal(keptSteps(k), ed.applied);
  ed.redo();
  const tight = keep(d.src.list, ed.history.steps, ed.history.applied, d.src.editBytes, ed.droppedSteps)!;
  assert.equal(tight.steps.length, 0, 'the history did not fit');
  assert.equal(keptSteps(tight), ed.applied);
});
