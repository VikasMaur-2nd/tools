import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, NUM, OBJ, STR, parse } from '../lib/json/parser';
import { SmallSource } from '../lib/huge/small-source';
import { PREVIEW, type IndexState } from '../lib/huge/source';

const indexed = (src: SmallSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done || src.state().cancelled) return done(src.state());
    const stop = src.onState((s) => (s.done || s.cancelled) && (stop(), done(s)));
  });

const DOC = '{\n  "users": [\n    {"id": 1, "name": "Ada"},\n    {"id": 2, "name": "Grace", "tags": ["x", "y"]}\n  ],\n  "total": 2,\n  "note": "' + 'n'.repeat(PREVIEW + 10) + '"\n}\n';

test('children, paths and offsets: what the views read', async () => {
  const src = new SmallSource(DOC, 'a.json');
  const st = await indexed(src);
  assert.equal(st.error, null);
  assert.equal(st.jsonl, false);
  assert.equal(st.depth, 4);
  assert.equal(st.lines, DOC.split('\n').length);
  const root = await src.root();
  assert.equal(root.t, OBJ);
  assert.equal(root.count, 3);
  assert.equal(root.key, undefined);
  const top = await src.children(root, 0, 10);
  assert.deepEqual(top.map((n) => [n.key, n.i, n.t, n.depth]), [['users', 0, ARR, 1], ['total', 1, NUM, 1], ['note', 2, STR, 1]]);
  assert.equal(top[1].text, '2');
  assert.equal(top[2].clipped, true);
  assert.equal(top[2].text.length, PREVIEW);
  assert.equal(top[0].text, '[{…}, {…}]');
  // A window of a container.
  const users = await src.children(top[0], 1, 5);
  assert.equal(users.length, 1);
  assert.equal(users[0].i, 1);
  assert.equal(users[0].key, 1);
  // Paths, and the node at an offset.
  const chain = (await src.resolve(['users', 1, 'tags', 1]))!;
  assert.deepEqual(chain.map((n) => n.key), [undefined, 'users', 1, 'tags', 1]);
  assert.equal(DOC.slice(chain[4].at, chain[4].end), '"y"');
  assert.equal(await src.resolve(['users', 9]), null);
  assert.equal(await src.resolve(['nope']), null);
  const at = DOC.indexOf('Grace');
  const loc = await src.locate(at);
  assert.deepEqual(loc.map((n) => n.key), [undefined, 'users', 1, 'name']);
  // Raw text of a value, bounded.
  assert.equal(await src.raw(chain[2], 1000), '{"id": 2, "name": "Grace", "tags": ["x", "y"]}');
  assert.equal(await src.raw(root, 10), null);
  assert.equal(await src.blob(chain[4]).text(), '"y"');
  src.destroy();
});

test('lines as written and pretty, and the line of an offset', async () => {
  const src = new SmallSource('{"a":[1,2],"b":{"c":null},"e":[]}', 'min.json');
  const st = await indexed(src);
  assert.equal(st.lines, 1);
  assert.equal(st.prettyLines, 10);
  const raw = await src.lines('raw', 0, 5, 10, '  ');
  assert.deepEqual(raw.map((l) => [l.text, l.more]), [['{"a":[1,2]', 23]]);
  const pretty = await src.lines('pretty', 0, 20, 100, '  ');
  assert.deepEqual(pretty.map((l) => l.text), ['{', '  "a": [', '    1,', '    2', '  ],', '  "b": {', '    "c": null', '  },', '  "e": []', '}']);
  assert.equal(await src.lineOf('pretty', 15), 5, 'the line of "b"\'s value');
  assert.equal(await src.lineOf('pretty', 13), 5, 'a property name is its value\'s (as the editor\'s caret selects)');
  assert.equal(await src.lineOf('pretty', 21), 6, 'inside null');
  assert.equal(await src.lineOf('raw', 21), 0);
  const tab = await src.lines('pretty', 2, 1, 100, '\t');
  assert.equal(tab[0].text, '\t\t1,');
  src.destroy();
});

test('JSON Lines: a list of records, each shown pretty in turn', async () => {
  const text = '{"id":1}\n{"id":2,"x":[true]}\n\n{"id":3}\n';
  const src = new SmallSource(text, 'log.jsonl');
  const st = await indexed(src);
  assert.equal(st.jsonl, true);
  assert.equal(st.records, 3);
  const root = await src.root();
  assert.equal(root.at, -1, 'the virtual list has no offset of its own');
  assert.equal(root.t, ARR);
  assert.equal(root.count, 3);
  const recs = await src.children(root, 0, 10);
  assert.deepEqual(recs.map((r) => [r.at, r.key, r.depth]), [[0, 0, 1], [9, 1, 1], [30, 2, 1]]);
  const loc = await src.locate(text.indexOf('true'));
  assert.deepEqual(loc.map((n) => n.key), [undefined, 1, 'x', 0]);
  const pretty = await src.lines('pretty', 0, 4, 100, '  ');
  assert.deepEqual(pretty.map((l) => l.text), ['{', '  "id": 1', '}', '{']);
  src.destroy();
});

test('an index at a set speed: counts grow, an error stops it with its exact place', async () => {
  const items = Array.from({ length: 400 }, (_, i) => `{"i":${i}}`);
  const text = '[\n' + items.join(',\n') + ',\n]\n';
  const src = new SmallSource(text, 'bad.json', { speed: 20_000 });
  const seen: IndexState[] = [];
  src.onState((s) => seen.push(s));
  // Browse while indexing: the root is there at once, its count is what is indexed so far.
  await new Promise((r) => setTimeout(r, 120));
  const early = await src.root();
  assert.equal(early.partial, true);
  assert.ok(early.count > 0 && early.count < 400, `count so far ${early.count}`);
  const st = await indexed(src);
  assert.ok(seen.length >= 3, 'progress reported several times');
  assert.ok(seen.every((s, k) => !k || s.bytes >= seen[k - 1].bytes));
  assert.ok(st.done && st.error);
  // The same message and place as the normal path's parser.
  const issue = parse(text).issues[0] ?? parse(text).error!;
  assert.equal(st.error!.msg, issue.m);
  assert.equal(st.error!.at, issue.p);
  const before = text.slice(0, issue.p).split('\n');
  assert.equal(st.error!.line, before.length);
  assert.equal(st.error!.col, before[before.length - 1].length + 1);
  assert.match(st.error!.msg, /[Tt]railing comma/);
  assert.equal(st.bytes, st.error!.at);
  src.destroy();
});

test('cancel stops the index where it is; what was indexed can still be read', async () => {
  const text = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ i })));
  const src = new SmallSource(text, 'big.json', { speed: 50_000 });
  await new Promise((r) => setTimeout(r, 100));
  src.cancel();
  const st = await indexed(src);
  assert.equal(st.cancelled, true);
  assert.equal(st.done, false);
  const bytes = st.bytes;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(src.state().bytes, bytes, 'no more progress');
  const root = await src.root();
  const kids = await src.children(root, 0, 5000);
  assert.equal(kids.length, root.count);
  assert.ok(kids.length > 0 && kids.length < 3000);
  src.destroy();
});

test('reads answer asynchronously and honour their signal', async () => {
  const src = new SmallSource('[1,2,3]', 'a.json', { latency: 30 });
  await indexed(src);
  const root = await src.root();
  const c = new AbortController();
  const p = src.children(root, 0, 3, c.signal);
  c.abort();
  await assert.rejects(p, (e: Error) => e.name === 'AbortError');
  assert.deepEqual((await src.children(root, 0, 3)).map((n) => n.text), ['1', '2', '3']);
  src.destroy();
});

test('find streams every match in order, smart case', async () => {
  const text = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ name: i % 3 ? 'Ada' : 'ada' })));
  const src = new SmallSource(text, 'a.json');
  const found: number[] = [];
  let batches = 0;
  await src.find('ada', 0, (at) => (batches++, found.push(...at)), new AbortController().signal);
  assert.equal(found.length, 2000);
  assert.ok(batches > 3, 'in batches');
  assert.ok(found.every((x, k) => !k || x > found[k - 1]));
  const exact: number[] = [];
  await src.find('Ada', 0, (at) => exact.push(...at), new AbortController().signal);
  assert.equal(exact.length, 1333);
  src.destroy();
});
