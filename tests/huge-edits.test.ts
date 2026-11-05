/*
 * Huge mode's edit model (lib/huge/edits.ts): what's typed checked before anything is sent, paths moved by edits,
 * and edits by path over the core (in this process), each one undo step, with what the views should select after.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { parse } from '../lib/json/tape-parser';
import { HugeEditing, adjustPath, boxText, editError, valueJson, type Effect, type EditOp } from '../lib/huge/edits';
import { NUM, STR } from '../lib/json/parser';
import type { HugeSource, IndexState, Seg } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const core = (text: string) => {
  const bytes = enc.encode(text);
  const blob = new Blob([bytes]);
  return new CoreSource(blob, 'a.json', (onProgress) => new HugeClient(blob, { name: 'a.json' }, onProgress, inProcess(bytes)));
};

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

test('what is typed: JSON of each kind, or why not', () => {
  assert.deepEqual(valueJson('string', 'Ada "the first"\n'), { json: '"Ada \\"the first\\"\\n"' });
  assert.deepEqual(valueJson('number', ' -3.5e2 '), { json: '-3.5e2' });
  for (const bad of ['12a', '01', '.5', '+1', 'NaN', '1e']) assert.ok('error' in valueJson('number', bad), bad);
  assert.match((valueJson('number', '') as { error: string }).error, /Type a number/);
  assert.deepEqual(valueJson('boolean', 'false'), { json: 'false' });
  assert.ok('error' in valueJson('boolean', 'yes'));
  assert.deepEqual(valueJson('null', 'anything'), { json: 'null' });
  assert.deepEqual(valueJson('json', '{"a": [1, 2]}'), { json: '{"a": [1, 2]}' });
  // Not strict JSON: the parser's message and where.
  const e = valueJson('json', '{"a": 1,}') as { error: string };
  assert.match(e.error, /^Trailing commas are not allowed \(at character 8\)$/);
  assert.match((valueJson('json', '  ') as { error: string }).error, /Type a JSON value/);
  // The box starts with a string's own text, unquoted (its whole JSON when it was cut).
  assert.equal(boxText({ t: STR, text: 'Ada' }, null), 'Ada');
  assert.equal(boxText({ t: STR, text: 'A…' }, '"Ada\\nLovelace"'), 'Ada\nLovelace');
  assert.equal(boxText({ t: NUM, text: '12' }, null), '12');
  assert.equal(editError(new Error('Not allowed')), "That can't be done here");
  assert.equal(editError(new Error('boom')), null);
});

test('paths after an edit: items shift, a removed value goes, a renamed member moves', () => {
  const ins: Effect = { shift: { parent: ['users'], index: 1, delta: 1 } };
  assert.deepEqual(adjustPath(['users', 0, 'name'], ins), ['users', 0, 'name']);
  assert.deepEqual(adjustPath(['users', 1, 'name'], ins), ['users', 2, 'name']);
  assert.deepEqual(adjustPath(['users'], ins), ['users']);
  assert.deepEqual(adjustPath(['other', 1], ins), ['other', 1]);
  const rm: Effect = { removed: ['users', 1], shift: { parent: ['users'], index: 2, delta: -1 } };
  assert.equal(adjustPath(['users', 1, 'name'], rm), null);
  assert.deepEqual(adjustPath(['users', 2], rm), ['users', 1]);
  assert.deepEqual(adjustPath(['users', 0], rm), ['users', 0]);
  const mv: Effect = { moved: { from: ['meta'], to: ['info'] } };
  assert.deepEqual(adjustPath(['meta', 'v'], mv), ['info', 'v']);
  assert.deepEqual(adjustPath(['metadata'], mv), ['metadata']);
});

test('edits by path over the core: each one undo step, the document as JSON.stringify writes the edited value', async () => {
  const value = { users: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }], meta: { v: 1 } };
  const src = core(JSON.stringify(value, null, 2));
  await ended(src);
  const seen: { fx: Effect; select: Seg[] | null }[] = [];
  const refused: string[] = [];
  let sel: Seg[] | null = null;
  const ed = new HugeEditing({
    src,
    selPath: () => sel,
    changed: async (fx, select) => {
      seen.push({ fx, select });
      sel = select;
    },
    refused: (m) => refused.push(m),
    failed: (e) => assert.fail(String(e)),
  });
  const text = async () => (await src.slice(await src.root())).text();
  const want = (v: unknown) => JSON.stringify(v, null, 2);
  const step = async (op: EditOp, v: unknown, select: Seg[] | null, fx: Effect = {}) => {
    assert.equal(await ed.run(op, 'tree'), true, JSON.stringify(op));
    assert.equal(await text(), want(v), JSON.stringify(op));
    const last = seen[seen.length - 1];
    assert.deepEqual(last.select, select, `${op.op}: select`);
    assert.deepEqual(last.fx, fx, `${op.op}: effect`);
  };
  const v1 = structuredClone(value);
  v1.users[1].name = 'Grace Hopper';
  await step({ op: 'set', path: ['users', 1, 'name'], json: '"Grace Hopper"' }, v1, ['users', 1, 'name']);
  const v2 = { users: v1.users, info: v1.meta };
  await step({ op: 'rename', path: ['meta'], name: 'info' }, v2, ['info'], { moved: { from: ['meta'], to: ['info'] } });
  const v3 = { users: [v1.users[0], { id: 3, name: 'Linus' }, v1.users[1]], info: v1.meta };
  await step({ op: 'insert', parent: ['users'], index: 1, json: '{"id": 3, "name": "Linus"}', name: null }, v3, ['users', 1], { shift: { parent: ['users'], index: 1, delta: 1 } });
  const v4 = { users: [v3.users[0], v3.users[1], v3.users[1], v3.users[2]], info: v1.meta };
  await step({ op: 'duplicate', path: ['users', 1] }, v4, ['users', 2], { shift: { parent: ['users'], index: 2, delta: 1 } });
  const v5 = { users: [v4.users[0], v4.users[2], v4.users[3]], info: v1.meta };
  await step({ op: 'remove', path: ['users', 1] }, v5, ['users', 1], { removed: ['users', 1], shift: { parent: ['users'], index: 2, delta: -1 } });
  const v6 = { ...v5, info: { v: 2, tags: ['a'] } };
  await step({ op: 'text', path: ['info'], text: '{\n"v": 2,   "tags": ["a"]}' }, v6, ['info']);
  // (A copy goes right after what it copies.)
  const v7 = { ...v6, info: { v: 2, 'v (copy)': 2, tags: ['a'] } };
  await step({ op: 'duplicate', path: ['info', 'v'] }, v7, ['info', 'v (copy)']);
  assert.equal(ed.steps, 7);
  // Undo goes back a step at a time; redo comes again.
  sel = ['users', 0];
  await step({ op: 'undo' }, v6, ['users', 0]);
  await step({ op: 'undo' }, v5, ['users', 0]);
  await step({ op: 'redo' }, v6, ['users', 0]);
  assert.equal(ed.steps, 6);
  assert.equal(src.state().edit?.edited, true);
  // Refused: said why, nothing changed, nothing counted.
  assert.equal(await ed.run({ op: 'remove', path: [] }, 'key'), false);
  assert.equal(await ed.run({ op: 'set', path: ['nope', 3], json: '1' }, 'key'), false);
  assert.equal(await ed.run({ op: 'rename', path: ['users', 0], name: 'x' }, 'key'), false);
  assert.deepEqual(refused, ["That can't be done here", 'That value is no longer there', "That can't be done here"]);
  assert.equal(await text(), want(v6));
  assert.equal(ed.steps, 6);
  // Edits asked together run one after another, each on the document the one before left.
  const a = ed.run({ op: 'insert', parent: ['users'], index: 0, json: '0', name: null }, 'key');
  const b = ed.run({ op: 'set', path: ['users', 0], json: '"first"' }, 'key');
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(await text(), want({ ...v6, users: ['first', ...v6.users] }));
  src.destroy();
});

test("a value's text for the editor, and the saved document (no handle: a Blob) equals the edited one", async () => {
  const value = Array.from({ length: 50 }, (_, i) => ({ id: i, tags: ['x', 'y'] }));
  const src = core(JSON.stringify(value, null, 2));
  await ended(src);
  const ed = new HugeEditing({ src, selPath: () => null, changed: async () => undefined, refused: (m) => assert.fail(m), failed: (e) => assert.fail(String(e)) });
  const node = (await src.resolve([7]))!.at(-1)!;
  const t = await src.edits!.nodeText(node);
  assert.deepEqual(JSON.parse(t), value[7]);
  assert.equal(await ed.run({ op: 'set', path: [7, 'tags', 1], json: '"z"' }, 'tree'), true);
  value[7].tags[1] = 'z';
  const r = src.edits!.save(null, false, () => undefined);
  const { blob } = await r.done;
  assert.equal(await blob!.text(), JSON.stringify(value, null, 2));
  src.destroy();
});
