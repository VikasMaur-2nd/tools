import test from 'node:test';
import assert from 'node:assert/strict';
import { ARR, OBJ, kids, type JNode } from '../lib/json/parser';
import { buildModel, rowValueText, setValueNotes, valueText } from '../lib/graph/model';
import { Explored, LEVELS, MAX_NODES, PAGE, ROOT_PAGE } from '../lib/huge/graph';
import { SmallSource } from '../lib/huge/small-source';
import type { IndexState } from '../lib/huge/source';

const indexed = (src: SmallSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `user ${i}`, tags: ['a', 'b'], address: { city: `c${i}`, geo: { lat: i, lng: -i } } }));

async function part(doc: unknown, path: (string | number)[] = []) {
  const src = new SmallSource(JSON.stringify(doc), 'a.json');
  await indexed(src);
  const chain = path.length ? (await src.resolve(path))! : [await src.root()];
  return { src, part: new Explored(src, chain[chain.length - 1], path) };
}

/** Every JNode under `j`. */
const all = (j: JNode): JNode[] => [j, ...(j.t >= ARR ? kids(j).flatMap(all) : [])];

test('the first levels: a page per container, four levels of containers, the rest stood for', async () => {
  const { src, part: p } = await part({ meta: { v: 1 }, records: records(500) });
  await p.expand();
  const recs = p.root.kids![1];
  assert.equal(recs.h.key, 'records');
  assert.equal(recs.kids!.length, PAGE, 'a page of the big array');
  assert.equal(recs.more, 500 - PAGE);
  const rec = recs.kids![0];
  assert.deepEqual(rec.kids!.map((k) => k.h.key), ['id', 'name', 'tags', 'address'], 'level 2 read');
  const address = rec.kids![3];
  assert.ok(address.kids, 'level 4 read');
  assert.equal(address.kids![1].h.key, 'geo');
  assert.equal(address.kids![1].kids, null, 'past the levels: not read');
  assert.equal(LEVELS, 4);
  assert.ok(p.size <= MAX_NODES);
  // As JNodes: "+480 more" stands for the rest; a container not read shows its size.
  const b = p.build();
  const rj = b.root;
  const list = kids(kids(rj)[1]);
  assert.equal(list.length, PAGE + 1);
  const stand = list[PAGE];
  assert.equal(stand.t, ARR);
  assert.equal(stand.key, PAGE, 'keyed by the first index it stands for');
  assert.equal(b.notes.get(stand), '+480 more');
  assert.equal(b.more.get(stand), recs);
  const geo = address.kids![1].j!;
  assert.equal(b.notes.get(geo), '{2}');
  assert.equal(b.of.get(geo), address.kids![1]);
  // Paths: the document's, from the part's root.
  assert.deepEqual(p.pathOf(address.kids![1]), ['records', 0, 'address', 'geo']);
  assert.equal(p.find(['records', 0, 'address', 'geo']), address.kids![1]);
  assert.equal(p.find(['records', '3']), recs.kids![3], 'an index as text finds it too');
  assert.equal(p.find(['records', 400]), null, 'not read: not found');
  src.destroy();
});

test('"+N more" reads the next page; the whole part stays within MAX_NODES', async () => {
  const { src, part: p } = await part(Array.from({ length: 100_000 }, (_, i) => i));
  await p.expand();
  assert.equal(p.root.kids!.length, ROOT_PAGE);
  let n = await p.more(p.root);
  assert.equal(n, ROOT_PAGE, 'the root reads its items a page of 50 at a time');
  assert.equal(p.root.kids!.length, 2 * ROOT_PAGE);
  assert.equal(p.root.kids![ROOT_PAGE].h.key, ROOT_PAGE, 'in order, from where it stopped');
  for (let k = 0; k < 200 && n; k++) n = await p.more(p.root, 500);
  assert.equal(p.size, MAX_NODES, 'stops at the limit');
  assert.equal(await p.more(p.root), 0, 'and reads no more');
  assert.equal(all(p.build().root).length, MAX_NODES + 1, 'every value, and one row standing for the rest');
  src.destroy();
});

test('a part rooted inside the file has the document\'s paths; a part read again goes as far as before', async () => {
  const { src, part: p } = await part({ data: { list: records(300) } }, ['data', 'list']);
  await p.expand();
  await p.more(p.root);
  // (Items read by "+N more" show their size until opened.)
  assert.equal(p.root.kids![60].kids, null);
  await p.expand(p.root.kids![60], 3);
  const deep = p.root.kids![60].kids![3].kids![1];
  assert.deepEqual(p.pathOf(deep), ['data', 'list', 60, 'address', 'geo']);
  const again = new Explored(src, p.root.h, p.path);
  await again.replay(p);
  assert.equal(again.root.kids!.length, 2 * ROOT_PAGE);
  assert.ok(again.find([60, 'address', 'geo'])?.kids, 'what was opened is open again');
  assert.equal(again.size, p.size);
  src.destroy();
});

test('the graph model shows the stand-ins\' notes; without notes nothing changes', async () => {
  const { src, part: p } = await part({ records: records(100), n: 1 });
  await p.expand();
  const b = p.build();
  const plain = buildModel(b.root, 7.8);
  const stand = [...b.more.keys()][0];
  setValueNotes(b.notes);
  try {
    const m = buildModel(b.root, 7.8);
    let found = -1;
    for (let r = 0; r < m.rows; r++) if (m.rowNode[r] === stand) found = r;
    assert.ok(found >= 0, 'a row for "+N more"');
    assert.equal(rowValueText(m, found), `+${100 - PAGE} more`);
    assert.ok(m.w.every((w, c) => w >= plain.w[c]), 'cards as wide as their notes need');
  } finally {
    setValueNotes(null);
  }
  // (Notes off: the same node shows as what it is, an empty array.)
  assert.equal(valueText(stand), '[]');
  assert.equal(valueText(b.root.v[1] as JNode), '1');
  assert.equal(b.root.t, OBJ);
  src.destroy();
});
