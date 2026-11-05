/**
 * Free-text typing in the Format view (UI-REPORT round 5 §3): keystrokes are `replace([{a, b, text}], typing)` at
 * a cursor, often leaving the document invalid until the next one, often before the last one is all read again.
 * - An error typing makes is the normal path's (message, line, column), placed from a few KiB before it, not
 *   from the checkpoint before (a megabyte or two of the JS parser per keystroke).
 * - A typing session (letters, quotes, brackets, commas, backspaces at a cursor; undo and redo; reading on in
 *   steps between keys, or not at all) leaves a document that answers every query as the same bytes opened fresh,
 *   with every checkpoint the parser's state at its byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeDoc } from '../lib/huge/doc';
import { HugeEditor } from '../lib/huge/editor';
import { piecesOf } from '../lib/huge/pieces';
import { Skeleton, type State } from '../lib/huge/skeleton';
import { Wait } from '../lib/huge/wait';
import { rng, type Rng } from './oracle/compare';
import { dump, enc, hugeMod, memSource, normalStatus, open, tapeMod, type EditTune } from './huge-oracle';

const SEED = Number(process.env.FUZZ_SEED) || 0;
const SCALE = (Number(process.env.FUZZ_SCALE) || 1) * (process.env.TEST_SLOW ? 20 : 1);
const dec = new TextDecoder();

const records = (n: number, r: Rng) =>
  '{"meta": {"n": ' + n + '}, "records": [\n' + Array.from({ length: n }, (_, i) => JSON.stringify({ id: i, name: 'item ' + i + 'x'.repeat(r.int(30)), tags: ['a', 'b'], v: r.int(1000) / 8 })).join(',\n') + '\n]}\n';

test('typing errors: the normal path\'s, placed from a few KiB before them (not a checkpoint or two back)', () => {
  const r = rng(SEED + 501);
  let bytes = enc.encode(records(20000, r));
  // (The JS parser's texts while placing errors.)
  let most = 0;
  const counting = (text: string, o?: Parameters<typeof parse>[1]) => ((most = Math.max(most, text.length)), parse(text, o));
  const d = new HugeDoc(memSource(bytes), hugeMod, { wasm: tapeMod, parse: counting }, { name: 'a.json' }, {});
  d.step(Infinity);
  assert.ok(d.index.n > 1, 'checkpoints: ' + d.index.n);
  const ed = new HugeEditor(d);
  const text = () => dec.decode(d.src.read(0, d.src.size));
  for (let s = 0; s < 4 * SCALE; s++) {
    const k = 100 + r.int(19000);
    const rec = d.resolve(['records', k])!.node;
    const v = d.resolve(['records', k, 'v'])!.node;
    const name = d.resolve(['records', k, 'name'])!.node;
    // Typed one at a time: a member after the last (invalid until its value), a closing quote taken out, a word.
    const keys: [number, number, string][] = [];
    let at = v.end;
    for (const c of ', "w": tr') keys.push([at, at++, c]);
    keys.push([name.end - 1, name.end, '']);
    keys.push([rec.start + 1, rec.start + 1, 'x']);
    for (const [a, b, c] of keys) {
      most = 0;
      ed.apply([{ a, b, put: piecesOf(enc.encode(c)) }], Infinity, true);
      bytes = enc.encode(text());
      const want = normalStatus(bytes, 'a.json');
      const got = d.summary().error;
      if (!want) assert.equal(got, null);
      else assert.deepEqual(got && { msg: got.msg, line: got.line, col: got.col }, { msg: want.msg, line: want.line, col: want.col }, `after ${JSON.stringify(c)} at ${a}`);
      if (got) assert.ok(most <= 16 << 10, `placed from ${most} characters`);
    }
    while (ed.canUndo) ed.undo();
    assert.equal(d.summary().error, null);
  }
});

function truth(d: HugeDoc, bytes: Uint8Array, where: string) {
  const ix = d.index;
  const strip = (x: State) => JSON.stringify([x.pos, x.state, x.nodes, x.closers, x.lines, x.u16, x.lineU16, x.top, x.frames.map((f) => [f.kind, f.count, f.start, f.key, f.nodes, f.closers])]);
  for (let k = 1; k < ix.n; k++) {
    const want = ix.state(k);
    const q = new Skeleton(hugeMod);
    q.start(memSource(bytes), { window: 64 });
    q.target(-1);
    q.stopAfter(want.pos);
    q.go();
    assert.equal(strip(want), strip(q.snapshot()), `checkpoint ${k} of ${ix.n}${where}`);
  }
}

test('a typing session at a cursor: every query the fresh document\'s, while reading again or after', () => {
  const r = rng(SEED + 502);
  const KEYS = ['a', 'b', ' ', '"', '"', ',', ':', '[', ']', '{', '}', '1', 'é', '\n'];
  for (let s = 0; s < 12 * SCALE; s++) {
    const t: EditTune = { every: 64 * (1 + r.int(4)), big: r.chance(0.5) ? 40 + r.int(200) : 1 << 20, window: 64, pageBytes: 64 + r.int(1500) };
    let bytes = enc.encode(records(40 + r.int(80), r));
    const d = open(bytes, 'a.json', t);
    const ed = new HugeEditor(d);
    const log: string[] = [];
    const doc = () => dec.decode(d.src.read(0, d.src.size));
    // A cursor at a character start, moved now and then.
    const cursorAt = () => {
      const s0 = doc();
      return enc.encode(s0.slice(0, r.int(s0.length))).length;
    };
    let cur = cursorAt();
    for (let key = 0; key < 40; key++) {
      const until = r.chance(0.5) ? Infinity : r.chance(0.5) ? 0 : performance.now() + r.int(2);
      const roll = r.int(20);
      if (roll === 0 && ed.canUndo) {
        ed.undo(until);
        log.push('undo');
        cur = cursorAt();
      } else if (roll === 1 && ed.canRedo) {
        ed.redo(until);
        log.push('redo');
        cur = cursorAt();
      } else if (roll === 2) {
        cur = cursorAt();
        log.push('move ' + cur);
      } else if (roll < 6 && cur > 0) {
        // Backspace: the character before (back over its continuation bytes).
        let a = cur - 1;
        while (a > 0 && (d.src.read(a, 1)[0] & 0xc0) === 0x80) a--;
        ed.apply([{ a, b: cur, put: [] }], until, true);
        log.push(`bs ${a}-${cur}`);
        cur = a;
      } else {
        const c = KEYS[r.int(KEYS.length)];
        ed.apply([{ a: cur, b: cur, put: piecesOf(enc.encode(c)) }], until, true);
        log.push(`type ${cur} ${JSON.stringify(c)}`);
        cur += enc.encode(c).length;
      }
      // Reading on between keys: some, all, or none.
      const steps = r.int(4);
      for (let j = 0; j < steps && !d.done; j++) {
        try {
          d.step(performance.now() + r.int(2));
        } catch (e) {
          if (!(e instanceof Wait)) throw e;
        }
      }
      if (key % 10 === 9 || key === 39) {
        d.step(Infinity);
        bytes = d.src.read(0, d.src.size).slice();
        const where = `\nsession ${s} tune ${JSON.stringify(t)}\nkeys ${log.join(' | ')}`;
        const fresh = open(bytes, 'a.json', t);
        const at = Array.from({ length: 8 }, () => r.int(bytes.length + 1));
        const a = dump(d, at);
        const b = dump(fresh, at);
        for (let j = 0; j < Math.max(a.out.length, b.out.length); j++) assert.equal(a.out[j], b.out[j], `line ${j} of the dump${where}`);
        truth(d, bytes, where);
      }
    }
  }
});
