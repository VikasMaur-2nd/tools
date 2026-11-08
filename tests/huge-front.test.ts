/**
 * Huge-file mode before the whole document is read (indexing, stopped, or broken): what's read is browsable as
 * the normal path would show it, children still being read are stubs with their children so far, nothing past
 * the front is read; the status bar as the normal path's; ancestor chains.
 */
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { lazyResult } from '../lib/json/lazy';
import { MAX_DEPTH, type JNode } from '../lib/json/parser';
import { formatPath, nodeAt, pathOf } from '../lib/json/path';
import { writeTape } from '../lib/json/pretty';
import { childCount, endOf, nextOf, startOf, type Tape } from '../lib/json/tape';
import { parse } from '../lib/json/tape-parser';
import { byteAfterUnits } from '../lib/huge/bytes';
import { HugeDoc } from '../lib/huge/doc';
import { PageNodes } from '../lib/huge/page';
import { LIST, type HugeNode } from '../lib/huge/types';
import { genStrict } from './oracle/tape';
import { rng, type Rng } from './oracle/compare';
import { enc, hugeMod, memSource, normalBar, pageText, tapeMod } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const show = (s: string) => JSON.stringify(s.length > 300 ? s.slice(0, 300) + '…' : s);

function docOf(r: Rng): { doc: string; name: string } {
  const rec = () => `{"id": ${r.int(1000)}, "v": "${'é'.repeat(r.chance(0.2) ? 60 + r.int(200) : r.int(5))}", "x": ${genStrict(r, 2).trim() || '0'}}`;
  const recs = Array.from({ length: 2 + r.int(20) }, rec);
  switch (r.int(4)) {
    case 0:
      return { doc: '{"meta": {"n": 1}, "records": [' + recs.join(',\n') + '], "tail": [' + recs.slice(0, 3).join(',') + ']}', name: 'a.json' };
    case 1:
      return { doc: recs.join('\n'), name: 'a.jsonl' };
    case 2:
      return { doc: '[\n' + recs.join(',\n') + '\n]', name: 'a.json' };
    default:
      return { doc: genStrict(r, 5), name: 'a.json' };
  }
}

const open = (bytes: Uint8Array, name: string, window = 64, every = 64, big = 64) => new HugeDoc(memSource(bytes), hugeMod, { wasm: tapeMod, parse }, { name, every, big }, { window, queryWindow: window, pageBytes: 400 });

/** Children of the normal tape's container `i`. */
const kidsOf = (t: Tape, i: number) => {
  const out: number[] = [];
  for (let c = i + 1, e = nextOf(t, i); c < e; c = nextOf(t, c)) out.push(c);
  return out;
};

test('browse while indexing: every step, pages hold what is read (the child being read a stub with its count so far)', () => {
  const r = rng(SEED + 31);
  for (let k = 0; k < 60 * SCALE; k++) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(doc);
    const text = pageText(bytes);
    const t = parse(text, { lines: /jsonl$/.test(name), maxDepth: MAX_DEPTH });
    const byte = (p: number) => byteAfterUnits(bytes, 0, bytes.length, p);
    const d = open(bytes, name);
    const where = `\ndoc: ${show(doc)} ${name}`;
    if (process.env.HUGE_DUMP) writeFileSync(process.env.HUGE_DUMP, JSON.stringify({ doc, name }));
    for (let steps = 0; !d.step(0) && steps < 10_000; steps++) {
      if (r.chance(0.7)) continue;
      const front = d.progress().bytes;
      const s = d.summary();
      if (!s.root) continue;
      // The container the root stands for in the normal tape (the wrapper of several values is node 0 too).
      const rootKids = kidsOf(t, 0);
      if (s.root.kind !== LIST) assert.equal(s.root.start, byte(startOf(t, 0)), `root start${where}`);
      // Its children so far: those whose value has begun.
      assert.ok(s.root.partial, `root partial while reading${where}`);
      const begun = rootKids.filter((c) => byte(startOf(t, c)) < front).length;
      assert.equal(s.root.count, begun, `root count so far at ${front}${where}`);
      // A page of everything: complete children as the normal path parses them, then maybe the one being read.
      const got: import('../lib/json/parser').JNode[] = [];
      const views: PageNodes[] = [];
      for (let from = 0; ; ) {
        const page = d.children(s.root, from, 1 + r.int(8));
        assert.ok(page.text.length <= 2000, `page text bounded: ${page.text.length}${where}`);
        const v = new PageNodes(page);
        for (const c of v.children) {
          got.push(c);
          views.push(v);
        }
        if (!page.more || !page.count) break;
        from += page.count;
      }
      const viewOf = (j: number) => views[j];
      const whole = rootKids.filter((c) => byte(endOf(t, c)) < front).length;
      for (let j = 0; j < got.length; j++) {
        const view = viewOf(j);
        const stub = view.stub(got[j]);
        const w = rootKids[j];
        if (stub?.partial) {
          assert.equal(j, got.length - 1, `the stub being read is last${where}`);
          assert.equal(stub.start, byte(startOf(t, w)), `stub start${where}`);
          assert.ok((stub.count ?? 0) <= childCount(t, w), `stub count so far${where}`);
          continue;
        }
        assert.deepEqual(view.span(got[j]), [byte(startOf(t, w)), byte(endOf(t, w))], `child ${j} span at front ${front}${where}`);
        if (!stub) assert.equal(writeTape(view.tape, view.page.text, got[j].zi!, ''), writeTape(t, text, w, ''), `child ${j} value${where}`);
      }
      const complete = got.filter((g, j) => !viewOf(j).stub(g)?.partial).length;
      assert.ok(complete >= whole && complete <= rootKids.filter((c) => byte(endOf(t, c)) <= front).length, `complete children ${complete} (${whole} whole) at front ${front}${where}`);
      // Locate at random bytes read: the normal path's node (or, inside what's being read, one of its containers).
      const root = lazyResult(t, text).root!;
      for (let q = 0; q < 5; q++) {
        const p = r.int(text.length);
        if (byte(p) >= front) continue;
        const want = nodeAt(root, p, text);
        const loc = d.locate(byte(p));
        if (!want || !want.u) continue;
        assert.ok(loc, `nothing at ${byte(p)} (front ${front}): want ${formatPath(pathOf(want))}${where}`);
        const wp = formatPath(pathOf(want));
        const gp = formatPath(loc!.path);
        // (Its next token read: it's whole, so found exactly.)
        let nx = want.e;
        while (nx < text.length && /\s/.test(text[nx])) nx++;
        if (byte(nx) < front) assert.equal(gp, wp, `locate ${byte(p)} at front ${front}${where}`);
        else assert.ok(wp.startsWith(gp), `locate ${byte(p)}: ${gp} not above ${wp} at front ${front}${where}`);
        assert.equal(loc!.chain.length, loc!.path.length, `chain length ${gp}${where}`);
      }
    }
  }
});

test('stop: indexing ends where it is, what is read stays browsable, the summary says stopped', () => {
  const r = rng(SEED + 32);
  for (let k = 0; k < 40 * SCALE; k++) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(doc);
    const d = open(bytes, name);
    const n = 1 + r.int(Math.max(1, Math.floor(bytes.length / 64)));
    for (let i = 0; i < n && !d.step(0); i++);
    if (d.done) continue;
    d.stop();
    const at = d.progress().bytes;
    assert.equal(d.step(Infinity), true);
    assert.equal(d.progress().bytes, at, 'nothing more read');
    const s = d.summary();
    assert.ok(s.stopped && !s.done && s.status === null, 'stopped');
    if (s.root) {
      let n = 0;
      for (let from = 0; ; ) {
        const page = d.children(s.root, from, 50);
        n += page.count;
        if (!page.more || !page.count) break;
        from += page.count;
      }
      assert.ok(n <= (s.root.count ?? 0), `children ${n} of ${s.root.count} so far: ${show(doc)}`);
    }
  }
});

/** n records, pretty-printed (the shape of note 1). */
const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `user ${i}`, tags: ['a', 'b'], ok: i % 2 === 0 }));

test('broken inside the root: the root and its children before the error are browsable (UI note 1)', () => {
  const good = JSON.stringify(records(50), null, 2);
  for (const [from, to] of [
    ['"id": 31,', '"id": 31,,'],
    ['"id": 45,', '"id": 45 "x",'],
    ['"name": "user 7"', '"name": "user 7'],
  ]) {
    const bad = good.replace(from, to);
    const bytes = enc.encode(bad);
    for (const window of [64, 1 << 16]) {
      const d = open(bytes, 'a.json', window, 256, 512);
      d.step(Infinity);
      const s = d.summary();
      assert.ok(s.error, 'an error');
      assert.ok(s.root && s.root.partial, `a root, partial: ${JSON.stringify(s.root)}`);
      const broken = Number(/\d+/.exec(from)![0]);
      assert.equal(s.root!.count, broken + 1);
      // (All of its pages.)
      const kids: import('../lib/json/parser').JNode[] = [];
      const views: PageNodes[] = [];
      for (let from = 0; ; ) {
        const v = new PageNodes(d.children(s.root!, from, 100));
        for (const c of v.children) {
          kids.push(c);
          views.push(v);
        }
        if (!v.page.more || !v.page.count) break;
        from += v.page.count;
      }
      const view = { stub: (c: import('../lib/json/parser').JNode) => views[kids.indexOf(c)].stub(c) };
      // Every record before the broken one, as the valid document has it; the broken one last, being read.
      const t = parse(good, {});
      const want = kidsOf(t, 0);
      for (let j = 0; j < broken; j++) assert.equal(writeTape(views[j].tape, views[j].page.text, kids[j].zi!, ''), writeTape(t, good, want[j], ''), `record ${j}`);
      assert.equal(kids.length, broken + 1);
      assert.ok(view.stub(kids[broken])?.partial);
      // Its pretty lines up to the error are the valid document's.
      const lines = d.prettyLines(0, 100_000, '  ', 1 << 16);
      const gl = good.split('\n');
      assert.ok(lines.text.length > 0);
      for (let j = 0; j < lines.text.length - 1; j++) assert.equal(lines.text[j], gl[j], `pretty line ${j}`);
      // Located before the error.
      assert.deepEqual(d.locate(good.indexOf('"user 3"'))?.path, [3, 'name']);
    }
  }
});

test('status: the normal path\'s status bar, with "Multiple top-level values" for several values not named .jsonl', () => {
  const r = rng(SEED + 33);
  for (let k = 0; k < 400 * SCALE; k++) {
    const vals = Array.from({ length: 1 + r.int(4) }, () => genStrict(r, 3).trim() || '1');
    const sep = r.pick(['\n', '\n\n', ' ', '\r\n', '\n  ']);
    let doc = vals.join(sep);
    if (r.chance(0.3)) {
      const p = r.int(doc.length);
      doc = doc.slice(0, p) + r.pick([',', '}', 'x', '"']) + doc.slice(p);
    }
    const name = r.chance(0.2) ? 'a.jsonl' : 'a.json';
    const bytes = enc.encode(doc);
    const want = normalBar(bytes, name);
    const d = open(bytes, name);
    d.step(Infinity);
    const got = d.summary().status!;
    const where = `\ndoc: ${show(doc)} ${name}`;
    // (.jsonl files: valid JSON Lines in huge mode whatever their layout: compared only when the normal path agrees.)
    // (.jsonl files: JSON Lines in huge mode whatever their layout, with their real first problem; the normal
    // path lists "Multiple top-level values" first there: compared only where it doesn't.)
    if (name.endsWith('.jsonl') && (want.msg === 'Multiple top-level values (wrapped in an array)' || (want.kind !== 'error' && want.jsonl === null))) continue;
    assert.equal(got.kind, want.kind, `kind: got ${JSON.stringify(got)} want ${JSON.stringify(want)}${where}`);
    assert.equal(got.msg, want.msg, `msg${where}`);
    if (want.msg !== null) assert.deepEqual([got.line, got.col], [want.line, want.col], `place${where}`);
    assert.equal(got.jsonl, want.jsonl, `jsonl${where}`);
  }
});

test('chains: locate and resolve give the containers above, with their keys, indexes and counts', () => {
  const r = rng(SEED + 34);
  for (let k = 0; k < 150 * SCALE; k++) {
    const { doc, name } = docOf(r);
    const bytes = enc.encode(doc);
    const text = pageText(bytes);
    const t = parse(text, { lines: /jsonl$/.test(name), maxDepth: MAX_DEPTH });
    const byte = (p: number) => byteAfterUnits(bytes, 0, bytes.length, p);
    const d = open(bytes, name);
    d.step(Infinity);
    const multi = d.summary().multi;
    const root = lazyResult(t, text).root!;
    for (let q = 0; q < 10; q++) {
      const want = nodeAt(root, r.int(text.length), text);
      if (!want || !want.u) continue;
      const loc = d.locate(byte(want.s))!;
      const up: JNode[] = [];
      for (let n: JNode | null = want.u; n; n = n.u) up.unshift(n);
      // (The normal tree's root is the LIST's array when several values: it's the chain's first too.)
      assert.equal(loc.chain.length, up.length, `chain of ${formatPath(pathOf(want))}`);
      for (let j = 0; j < up.length; j++) {
        const c = loc.chain[j];
        const n = up[j];
        if (j === 0 && multi) assert.equal(c.node.kind, LIST);
        else {
          assert.equal(c.node.start, byte(n.s), `chain ${j} start`);
          assert.equal(c.node.kind, n.t);
          if (c.node.count !== null) assert.equal(c.node.count, childCount(t, n.zi!), `chain ${j} count`);
        }
        const idx = j === 0 ? 0 : (up[j - 1].v as JNode[]).indexOf(n);
        assert.equal(c.index, idx, `chain ${j} index`);
      }
      const back = d.resolve(pathOf(want));
      if (back) assert.equal(back.chain.length, up.length);
    }
  }
});

/** (Unused helper kept for symmetry with huge-query.) */
export type { HugeNode };
