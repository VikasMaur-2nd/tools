/**
 * Duplicate member names (REVIEW-2 item 7): an edit asked by path named a member by its name, so with `{"a": 1, "a":
 * 2}` and the second selected, set, remove and rename changed the first. Edits now say which member they mean (the
 * selected node's index, `i`, or every segment's, `at`), resolved by index with the name checked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { SmallSource } from '../lib/huge/small-source';
import { HugeEditing, type EditOp } from '../lib/huge/edits';
import { hugeMod, memSource, open, tapeMod } from './huge-oracle';

const enc = new TextEncoder();

function inProcess(bytes: Uint8Array): Port {
  const worker: Port = { postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })), onmessage: null };
  const client: Port & { terminate(): void } = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const ended = (src: CoreSource | SmallSource) =>
  new Promise<void>((done) => {
    if (src.state().done) return done();
    const stop = src.onState((s) => {
      if (s.done) {
        stop();
        done();
      }
    });
  });

test('duplicate names: an edit on the second "a" (the reviewer\'s case) changes the second, set, remove and rename', async () => {
  const text = '{"a": 1, "a": 2}';
  const cases: [EditOp, string][] = [
    [{ op: 'set', path: ['a'], i: 1, json: '99' }, '{"a": 1, "a": 99}'],
    [{ op: 'remove', path: ['a'], i: 1 }, '{"a": 1}'],
    [{ op: 'rename', path: ['a'], i: 1, name: 'z' }, '{"a": 1, "z": 2}'],
    [{ op: 'duplicate', path: ['a'], i: 1 }, '{"a": 1, "a": 2, "a (copy)": 2}'],
    [{ op: 'text', path: ['a'], i: 1, text: '[2]' }, '{"a": 1, "a": [2]}'],
    // (Without which: by name, the first, as a path means.)
    [{ op: 'set', path: ['a'], json: '99' }, '{"a": 99, "a": 2}'],
  ];
  for (const [op, want] of cases) {
    const bytes = enc.encode(text);
    const blob = new Blob([bytes as BlobPart]);
    const src = new CoreSource(blob, 'a.json', (p) => new HugeClient(blob, { name: 'a.json' }, p, inProcess(bytes)));
    await ended(src);
    const kids = await src.children((await src.root())!, 0, 2);
    assert.equal(kids[1].i, 1, 'the selected node says its index');
    let failed: unknown = null;
    const ed = new HugeEditing({ src, selPath: () => ['a'], changed: async () => {}, refused: (m) => (failed = m), failed: (e) => (failed = e) });
    assert.equal(await ed.run(op, 'menu'), true, `${op.op}: ${String(failed)}`);
    assert.equal((await src.textAt(0, src.state().docSize!, 1000)).text, want, op.op);
    await src.destroy();
  }
});

test('duplicate names: resolve by index, the name checked, at any depth (core and small source)', async () => {
  const text = '{"a": {"b": 1}, "x": 0, "a": {"b": 2, "b": 3}}';
  const d = open(enc.encode(text), 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  const at = (path: (string | number)[], idx?: number[]) => {
    const l = d.resolve(path, idx);
    return l ? text.slice(l.node.start, l.node.end) : null;
  };
  assert.equal(at(['a', 'b']), '1');
  assert.equal(at(['a', 'b'], [2, -1]), '2');
  assert.equal(at(['a', 'b'], [2, 1]), '3');
  assert.equal(at(['a'], [1]), null, 'index 1 is "x": not "a"');
  assert.equal(at(['a'], [7]), null, 'no member 7');
  const small = new SmallSource(text, 'a.json');
  await ended(small);
  const chain = await small.resolve(['a', 'b'], undefined, [2, 1]);
  assert.equal(chain && text.slice(chain[chain.length - 1].at, chain[chain.length - 1].end), '3');
  assert.equal(await small.resolve(['a'], undefined, [1]), null);
});
