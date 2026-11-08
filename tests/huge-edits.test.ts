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
import { HugeEditing, adjustPath, boxText, dedent, editError, valueJson, type Effect, type EditOp } from '../lib/huge/edits';
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
  // A value's text without the indent of where it is (for the editor).
  assert.equal(dedent('{\n      "id": 3,\n      "t": [\n\n        1\n      ]\n    }'), '{\n  "id": 3,\n  "t": [\n\n    1\n  ]\n}');
  assert.equal(dedent('"one line"'), '"one line"');
  assert.equal(dedent('{\n"a": 1\n  }'), '{\n"a": 1\n  }', 'a line less indented: as it is');
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
  assert.equal(src.state().edit?.steps, 7, 'the core counts the changes');
  // Undo goes back a step at a time; redo comes again.
  sel = ['users', 0];
  await step({ op: 'undo' }, v6, ['users', 0]);
  await step({ op: 'undo' }, v5, ['users', 0]);
  await step({ op: 'redo' }, v6, ['users', 0]);
  assert.equal(src.state().edit?.steps, 6);
  assert.equal(src.state().edit?.edited, true);
  // Refused: said why, nothing changed, nothing counted.
  assert.equal(await ed.run({ op: 'remove', path: [] }, 'key'), false);
  assert.equal(await ed.run({ op: 'set', path: ['nope', 3], json: '1' }, 'key'), false);
  assert.equal(await ed.run({ op: 'rename', path: ['users', 0], name: 'x' }, 'key'), false);
  assert.deepEqual(refused, ["That can't be done here", 'That value is no longer there', "That can't be done here"]);
  assert.equal(await text(), want(v6));
  assert.equal(src.state().edit?.steps, 6);
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

test('text that isn\'t JSON goes in as typed: the document is invalid, its status says where; undo fixes it', async () => {
  const value = { meta: { version: 1 }, users: [{ id: 0 }] };
  const src = core(JSON.stringify(value, null, 2));
  await ended(src);
  const ed = new HugeEditing({ src, selPath: () => null, changed: async () => undefined, refused: (m) => assert.fail(m), failed: (e) => assert.fail(String(e)) });
  assert.equal(await ed.run({ op: 'text', path: ['meta'], text: 'nul' }, 'tree'), true);
  await ended(src);
  // The normal path's status bar: where, and what (a repair would fix this one: "fixable").
  const st = src.state().status;
  assert.deepEqual([st?.kind, st?.msg, st?.line, st?.col], ['fixable', "Unexpected 'nul'. Did you mean null?", 2, 11]);
  assert.equal(await ed.run({ op: 'undo' }, 'key'), true);
  await ended(src);
  assert.equal(src.state().status?.kind, 'valid');
  // (replaceNode never repairs either (UI-NOTES 15, core round 5): text that isn't strict JSON goes in as typed.)
  assert.equal(await ed.run({ op: 'text', path: ['meta'], text: 'nul' }, 'tree'), true);
  await ended(src);
  assert.equal(src.state().status?.kind, 'fixable');
  src.destroy();
});

test('REVIEW-3 D1: settled() resolves once the edits asked so far are made and the views told (the Format window waits for it)', async () => {
  const src = core(JSON.stringify({ a: 1, b: [1, 2, 3] }, null, 2));
  await ended(src);
  const order: string[] = [];
  const ed = new HugeEditing({
    src,
    selPath: () => null,
    changed: async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('views read again');
    },
    refused: (m) => assert.fail(m),
    failed: (e) => assert.fail(String(e)),
  });
  assert.equal(ed.busy, false);
  void ed.run({ op: 'set', path: ['a'], json: '2' }, 'tree');
  void ed.run({ op: 'remove', path: ['b', 0] }, 'tree');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ed.busy, true, 'busy while an edit runs');
  await ed.settled();
  order.push('settled');
  assert.deepEqual(order, ['views read again', 'views read again', 'settled']);
  assert.equal(ed.busy, false);
  assert.equal((await src.textAt(0, src.state().docSize!, 1 << 20)).text, JSON.stringify({ a: 2, b: [2, 3] }, null, 2), 'both edits in');
  await src.destroy();
});

test('REVIEW-3 B3: duplicate names: insert, set, remove and the selection after them go by index path', async () => {
  const run = async (text: string, op: EditOp) => {
    const src = core(text);
    await ended(src);
    let after: { select: Seg[] | null; at: number[] | null } | null = null;
    const ed = new HugeEditing({
      src,
      selPath: () => null,
      changed: async (_fx, select, selectAt) => {
        after = { select, at: selectAt ?? null };
      },
      refused: (m) => assert.fail(m),
      failed: (e) => assert.fail(String(e)),
    });
    assert.equal(await ed.run(op, 'menu'), true, JSON.stringify(op));
    const doc = (await src.textAt(0, src.state().docSize!, 1 << 20)).text;
    // What the session selects after it: by the index path the edit gives.
    const a = after as { select: Seg[] | null; at: number[] | null } | null;
    const chain = a?.select && a.at ? await src.resolve(a.select, undefined, a.at) : null;
    const sel = chain ? doc.slice(chain.at(-1)!.at, chain.at(-1)!.end) : null;
    await src.destroy();
    return { doc, sel };
  };
  // Insert inside the second "a" (an object), and after its "y".
  assert.deepEqual(await run('{"a": {"x": 1}, "a": {"y": 2}}', { op: 'insert', parent: ['a'], parentAt: [1], index: 1, json: '3', name: 'n' }), { doc: '{"a": {"x": 1}, "a": {"y": 2, "n": 3}}', sel: '3' });
  // Into the second "a" (an array) at its end.
  assert.deepEqual(await run('{"a": [1], "a": [2, 3]}', { op: 'insert', parent: ['a'], parentAt: [1], index: 2, json: '9', name: null }), { doc: '{"a": [1], "a": [2, 3, 9]}', sel: '9' });
  // The second a.v (reached by Find, the Shape panel, the table, the graph: their chain's index path).
  assert.deepEqual(await run('{"a": {"v": 1}, "a": {"v": 2}}', { op: 'set', path: ['a', 'v'], i: 0, at: [1, 0], json: '99' }), { doc: '{"a": {"v": 1}, "a": {"v": 99}}', sel: '99' });
  assert.deepEqual((await run('{"a": {"v": 1}, "a": {"v": 2}}', { op: 'remove', path: ['a', 'v'], i: 0, at: [1, 0] })).doc, '{"a": {"v": 1}, "a": {}}');
  // After an edit on the second "a", the selection is the second "a" (not the first, by name).
  assert.deepEqual(await run('{"a": 1, "a": 2}', { op: 'set', path: ['a'], i: 1, at: [1], json: '99' }), { doc: '{"a": 1, "a": 99}', sel: '99' });
  // Several levels: the second a's second b.
  assert.deepEqual(await run('{"a": {"b": 1}, "x": 0, "a": {"b": 2, "b": 3}}', { op: 'set', path: ['a', 'b'], at: [2, 1], json: '99' }), { doc: '{"a": {"b": 1}, "x": 0, "a": {"b": 2, "b": 99}}', sel: '99' });
  // Duplicate in the second "a": the copy selected.
  assert.deepEqual(await run('{"a": [1], "a": [2]}', { op: 'duplicate', path: ['a', 0], at: [1, 0] }), { doc: '{"a": [1], "a": [2,2]}', sel: '2' });
});
