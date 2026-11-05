/**
 * The editor (editor.ts): undo/redo put the document back exactly (bytes, and every query as the same bytes
 * opened fresh); node edits write JSON as the document around them is written: a document written by
 * JSON.stringify(value, null, indent) (or minified, or as JSON Lines) stays exactly JSON.stringify of the edited
 * value, whatever is set, renamed, removed, inserted or duplicated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import { LIST, type HugeNode, type Seg } from '../lib/huge/types';
import { rng, type Rng } from './oracle/compare';
import { dump, enc, open } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const dec = new TextDecoder();

type J = null | boolean | number | string | J[] | { [k: string]: J };

/** A random value (names never look like array indexes: JS would reorder them; numbers are integers: they print as written). */
function valueOf(r: Rng, depth: number): J {
  const k = r.int(depth > 3 ? 4 : 7);
  if (k === 0) return r.int(100000) - 500;
  if (k === 1) return r.pick(['', 'a', 'hello world', 'é中😀', 'q"\\\n', 'x'.repeat(r.int(80))]);
  if (k === 2) return r.chance(0.5);
  if (k === 3) return null;
  if (k <= 4) return Array.from({ length: r.int(5) }, () => valueOf(r, depth + 1));
  const o: { [k: string]: J } = {};
  for (let i = 0, n = r.int(5); i < n; i++) o['k' + r.int(30) + (r.chance(0.2) ? ' sp' : '')] = valueOf(r, depth + 1);
  return o;
}

interface Doc {
  v: J;
  /** JSON Lines: `v` is the array of records. */
  lines: boolean;
  indent: string | number;
}

const write = (d: Doc) => (d.lines ? (d.v as J[]).map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(d.v, null, d.indent));

/** The node at `path` (null: the document's root) and its container (null: the top level). */
function nodeAt(ed: HugeEditor, path: Seg[]): { node: HugeNode; parent: HugeNode | null; index: number } {
  const s = ed.doc.summary();
  // (An empty document (every JSON Lines record removed): no root; null for insert.)
  if (!path.length) return { node: s.root as HugeNode, parent: null, index: 0 };
  const loc = ed.doc.resolve(path)!;
  if (!loc) {
    const text = new TextDecoder().decode(ed.doc.src.read(0, ed.doc.src.size));
    const f = open(enc.encode(text), 'a.json', TUNE!);
    assert.fail(`resolve ${JSON.stringify(path)}: null (fresh: ${!!f.resolve(path)}) in ${JSON.stringify(text)} tune ${JSON.stringify(TUNE)}`);
  }
  // (A JSON Lines record's container is the LIST.)
  return { node: loc.node, parent: loc.parent ?? (s.root && s.root.kind === LIST ? s.root : null), index: loc.index };
}

/** A random container in `v` (its path), or null. */
function containerIn(r: Rng, v: J, path: Seg[] = []): Seg[] | null {
  const all: Seg[][] = [];
  const walk = (x: J, p: Seg[]) => {
    if (x && typeof x === 'object') {
      all.push(p);
      if (Array.isArray(x)) x.forEach((y, i) => walk(y, [...p, i]));
      else for (const [k, y] of Object.entries(x)) walk(y, [...p, k]);
    }
  };
  walk(v, path);
  return all.length ? r.pick(all) : null;
}

/** (The tune of the document being edited, for messages.) */
let TUNE: import('./huge-oracle').EditTune | null = null;

const at = (v: J, path: Seg[]): J => path.reduce<J>((x, k) => (x as { [k: string]: J })[k as string], v);

test('editor: node edits keep the document written as JSON.stringify of the edited value', () => {
  const r = rng(SEED + 71);
  for (let k = 0; k < 120 * SCALE; k++) {
    const lines = r.chance(0.25);
    const doc: Doc = { v: lines ? Array.from({ length: 1 + r.int(6) }, () => ({ id: r.int(99), v: valueOf(r, 2) })) : { root: valueOf(r, 0), list: Array.from({ length: r.int(4) }, () => valueOf(r, 2)) }, lines, indent: r.pick([2, 4, '\t', '']) };
    const name = lines ? 'a.jsonl' : 'a.json';
    const t = { every: 64 * (1 + r.int(3)), big: r.chance(0.5) ? 1 << 20 : 60 + r.int(200), window: 64 * (1 + r.int(2)), pageBytes: 200 + r.int(2000) };
    TUNE = t;
    const d = open(enc.encode(write(doc)), name, t);
    const ed = new HugeEditor(d);
    const log: string[] = [];
    for (let e = 0; e < 8; e++) {
      const path = containerIn(r, doc.v);
      if (!path) break;
      const c = at(doc.v, path) as J[] | { [k: string]: J };
      const isArr = Array.isArray(c);
      const keys = isArr ? null : Object.keys(c);
      const n = isArr ? c.length : keys!.length;
      const { node } = nodeAt(ed, path);
      const op = r.int(5);
      const fresh = (base: string) => {
        let name2 = base;
        while (!isArr && name2 in c) name2 += '_';
        return name2;
      };
      if (op === 0 && n) {
        // Set a child's value.
        const i = r.int(n);
        const key: Seg = isArr ? i : keys![i];
        const val = valueOf(r, 2);
        log.push(`set ${JSON.stringify([...path, key])}`);
        ed.setValue(nodeAt(ed, [...path, key]).node, JSON.stringify(val));
        (c as { [k: string]: J })[key as string] = val;
      } else if (op === 1 && n && !isArr) {
        const i = r.int(n);
        const to = fresh('renamed' + r.int(9));
        log.push(`rename ${JSON.stringify([...path, keys![i]])} ${to}`);
        ed.rename(node, i, to);
        // (In place: the same order.)
        const entries = Object.entries(c).map(([kk, vv], j) => [j === i ? to : kk, vv] as const);
        for (const kk of Object.keys(c)) delete (c as { [k: string]: J })[kk];
        for (const [kk, vv] of entries) (c as { [k: string]: J })[kk] = vv;
      } else if (op === 2 && n) {
        const i = r.int(n);
        log.push(`remove ${JSON.stringify(path)} ${i}`);
        ed.remove(node, i);
        if (isArr) c.splice(i, 1);
        else delete (c as { [k: string]: J })[keys![i]];
      } else if (op === 3) {
        const i = isArr ? r.int(n + 1) : n;
        const val = valueOf(r, 2);
        const to = isArr ? null : fresh('new' + r.int(9));
        log.push(`insert ${JSON.stringify(path)} ${i} ${to}`);
        // (An object's new member goes last: JS keeps names in insertion order.)
        ed.insert(node, i, JSON.stringify(val), to);
        if (isArr) c.splice(i, 0, val);
        else (c as { [k: string]: J })[to!] = val;
      } else if (n && (isArr || !(keys![n - 1] + ' (copy)' in c))) {
        // Duplicate (an object's last member: its copy comes right after it, last).
        const i = isArr ? r.int(n) : n - 1;
        log.push(`duplicate ${JSON.stringify(path)} ${i}`);
        ed.duplicate(node, i);
        if (isArr) c.splice(i + 1, 0, JSON.parse(JSON.stringify(c[i])));
        else (c as { [k: string]: J })[keys![i] + ' (copy)'] = JSON.parse(JSON.stringify((c as { [k: string]: J })[keys![i]]));
      } else continue;
      const want = write(doc);
      const where = `\nindent ${JSON.stringify(doc.indent)} lines ${lines} tune ${JSON.stringify(t)}\nops ${log.join('; ')}`;
      assert.equal(dec.decode(d.src.read(0, d.src.size)), want, `text${where}`);
      // And it answers as the same bytes opened fresh.
      const bytes = enc.encode(want);
      const a = dump(d, [0, 9, 40]).out;
      const b = dump(open(bytes, name, t), [0, 9, 40]).out;
      for (let j = 0; j < Math.max(a.length, b.length); j++) assert.equal(a[j], b[j], `dump line ${j}${where}`);
    }
  }
});

test('editor: undo and redo put back the document exactly, the history bounded', () => {
  const r = rng(SEED + 72);
  for (let k = 0; k < 60 * SCALE; k++) {
    const doc = JSON.stringify({ root: valueOf(r, 0), list: Array.from({ length: 1 + r.int(5) }, () => valueOf(r, 2)) }, null, r.pick([2, '']));
    const t = { every: 64, big: 80 + r.int(200), window: 64, pageBytes: 500 };
    const d = open(enc.encode(doc), 'a.json', t);
    const ed = new HugeEditor(d, r.chance(0.3) ? 64 : undefined);
    // Versions: the text after each step applied.
    const texts = [doc];
    let cur = 0;
    for (let e = 0; e < 14; e++) {
      const text = texts[cur];
      const u = r.int(10);
      if (u < 2 && ed.canUndo) {
        ed.undo();
        cur--;
      } else if (u < 4 && ed.canRedo) {
        ed.redo();
        cur++;
      } else {
        const a = r.int(text.length + 1);
        const b = Math.min(text.length, a + r.int(8));
        const ins = r.pick(['', 'x', '1', ',', '"q"', ' ', '\n', '{"a": [1]}']);
        // (ASCII documents: a byte is a character, so cuts are anywhere.)
        if (/[^\x00-\x7f]/.test(text)) continue;
        ed.apply([{ a, b, put: piecesOf(enc.encode(ins)) }], Infinity, r.chance(0.3));
        texts.length = cur + 1;
        texts.push(text.slice(0, a) + ins + text.slice(b));
        cur++;
      }
      // A capped history may have forgotten the oldest: undo stops there.
      const got = dec.decode(d.src.read(0, d.src.size));
      assert.ok(texts.includes(got), `a version${'\n' + doc}`);
      cur = texts.lastIndexOf(got) >= 0 && texts[cur] !== got ? texts.lastIndexOf(got) : cur;
      assert.equal(got, texts[cur], `version ${cur}`);
    }
    // All the way back (as far as the history goes), then forward again.
    while (ed.canUndo) ed.undo();
    const back = dec.decode(d.src.read(0, d.src.size));
    assert.ok(texts.includes(back), 'undone to a version');
    const a = dump(d, [0, 5, 30]).out;
    const b = dump(open(enc.encode(back), 'a.json', t), [0, 5, 30]).out;
    for (let j = 0; j < Math.max(a.length, b.length); j++) assert.equal(a[j], b[j], `after undo all: dump line ${j}`);
    if (!ed.historyBytes) assert.equal(back, doc);
    while (ed.canRedo) ed.redo();
    assert.ok(texts.includes(dec.decode(d.src.read(0, d.src.size))), 'redone to a version');
  }
});

test('editor: a node for the normal editor and back (no change when nothing changed); too big for it', () => {
  const r = rng(SEED + 73);
  for (let k = 0; k < 60 * SCALE; k++) {
    const v = { root: valueOf(r, 0), list: Array.from({ length: 1 + r.int(4) }, () => valueOf(r, 1)) };
    const indent = r.pick([2, 4, '\t', '']);
    const text = JSON.stringify(v, null, indent);
    const d = open(enc.encode(text), 'a.json', { every: 64, big: 1 << 20, window: 64, pageBytes: 500 });
    const ed = new HugeEditor(d);
    const path = containerIn(r, v) ?? [];
    const { node } = nodeAt(ed, path);
    const got = ed.nodeText(node);
    assert.equal(JSON.stringify(JSON.parse(got)), JSON.stringify(at(v, path)), 'its text');
    ed.replaceNode(node, got);
    assert.equal(dec.decode(d.src.read(0, d.src.size)), text, `the same document (indent ${JSON.stringify(indent)})`);
    // From the normal editor (written its own way): put back written as the document is.
    const p2 = containerIn(r, v) ?? [];
    const n2 = nodeAt(ed, p2).node;
    ed.replaceNode(n2, JSON.stringify(at(v, p2)));
    assert.equal(dec.decode(d.src.read(0, d.src.size)), text, `re-indented (indent ${JSON.stringify(indent)})`);
    assert.throws(() => ed.nodeText(node, 1), /Too big/);
  }
});
