/*
 * REVIEW-3 B2: the Format view's typing window never rewrites bytes the user didn't touch. Its text shows each
 * invalid UTF-8 sequence as U+FFFD; a send that covered several changes (an indented selection, keys at two places
 * held while the document was read again) was one replace from the first change to the last, which wrote every
 * untouched invalid sequence between them back as EF BF BD. Checked against a byte-level model (units with their
 * bytes), not utf8.ts: the reviewer's probes (review3-window-rewrite.cjs, review3-window-fuzz.cjs with up to 3
 * changes per send), smaller.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { TextWindow } from '../lib/huge/text-window';
import { seqAt } from '../lib/huge/utf8';
import { parse } from '../lib/json/tape-parser';
import type { HugeNode, HugeSource, IndexState } from '../lib/huge/source';
import { enc, hugeMod, memSource, tapeMod } from './huge-oracle';

const dec = new TextDecoder();

function inProcess(bytes: Uint8Array): Port {
  const worker: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } = {
    postMessage: (m) => setTimeout(() => client.onmessage?.({ data: m })),
    onmessage: null,
  };
  const client: Port = { postMessage: (m) => setTimeout(() => worker.onmessage?.({ data: m })), onmessage: null, terminate() {} };
  serve(worker, async () => ({ huge: hugeMod, parsers: { wasm: tapeMod, parse } }), () => memSource(bytes));
  return client;
}

const open = (bytes: Uint8Array) => {
  const blob = new Blob([bytes as BlobPart]);
  return new CoreSource(blob, 'w.json', (p) => new HugeClient(blob, { name: 'w.json', every: 4096 }, p, inProcess(bytes)));
};

const ended = (src: HugeSource) =>
  new Promise<IndexState>((done) => {
    if (src.state().done) return done(src.state());
    const stop = src.onState((s) => s.done && (stop(), done(s)));
  });

/** The whole document's bytes (a node at -1 is all of it: core-source.ts slice). */
const docBytes = async (src: HugeSource) => new Uint8Array(await (await src.slice({ at: -1, end: -1 } as HugeNode)).arrayBuffer());

const cat = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// Latin-1 "café" / "naïve" (E9, EF): invalid bytes, shown as U+FFFD.
const latin = cat('[\n', '  {"name": "caf', [0xe9], '"},\n', '  {"name": "na', [0xef], 've"},\n', '  {"name": "x"}\n', ']\n');

test('REVIEW-3 B2: two lines indented with invalid bytes on them: only the spaces are written', async () => {
  const src = open(latin);
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(0), true);
  const lines = w.view.split('\n');
  lines[1] = '  ' + lines[1];
  lines[2] = '  ' + lines[2];
  w.edited(lines.join('\n'));
  await w.flush();
  const want = cat('[\n', '    {"name": "caf', [0xe9], '"},\n', '    {"name": "na', [0xef], 've"},\n', '  {"name": "x"}\n', ']\n');
  assert.ok(same(await docBytes(src), want), 'E9 and EF kept as they were');
  // Undone at once (one step), the file as it was.
  await src.edits!.undo();
  assert.ok(same(await docBytes(src), latin));
  await src.destroy();
});

test('of two U+FFFD side by side (FF FE), the one deleted is the one at the caret, not the one a text diff picks', async () => {
  const bytes = cat('{"s": "a', [0xff, 0xfe], 'b"}\n');
  for (const [first, want] of [
    [true, cat('{"s": "a', [0xfe], 'b"}\n')],
    [false, cat('{"s": "a', [0xff], 'b"}\n')],
  ] as const) {
    const src = open(bytes);
    await ended(src);
    const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
    await w.load(0);
    const p = w.view.indexOf('\uFFFD');
    // Backspace after the first (the caret then before what's left), or after the second.
    w.edited(w.view.slice(0, p) + '\uFFFD' + w.view.slice(p + 2), first ? p : p + 1);
    await w.flush();
    assert.ok(same(await docBytes(src), want), first ? 'FF deleted' : 'FE deleted');
    await src.destroy();
  }
});

test('REVIEW-3 B2: two changes in one send, with invalid bytes between them: those bytes are left alone', async () => {
  const src = open(latin);
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  await w.load(0);
  let v = w.view;
  const p1 = v.indexOf('caf');
  v = v.slice(0, p1) + 'Z' + v.slice(p1);
  const p2 = v.indexOf('"x"') + 1;
  v = v.slice(0, p2) + 'Y' + v.slice(p2);
  // On one line too: before and after the invalid unit.
  const p3 = v.indexOf('"na\uFFFD') + 3;
  v = v.slice(0, p3) + 'Q' + v.slice(p3, p3 + 1) + 'R' + v.slice(p3 + 1);
  w.edited(v);
  await w.flush();
  const want = cat('[\n', '  {"name": "Zcaf', [0xe9], '"},\n', '  {"name": "naQ', [0xef], 'Rve"},\n', '  {"name": "Yx"}\n', ']\n');
  assert.ok(same(await docBytes(src), want), dec.decode(await docBytes(src)));
  await src.destroy();
});

/** A seeded random number generator: [0, n). */
const rng = (seed: number) => (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};

const KINDS = [[0xe9], [0xff, 0xfe], [0x80], [0xc0, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98], [0xf5, 0x80], [0xef, 0xbf, 0xbd]];

/** The reviewer's fuzz: keys typed and deleted next to invalid units, 1–3 of them before each flush, windows moved. */
async function fuzz(seed: number, crlf: boolean, lineCount: number, rounds: number) {
  const rnd = rng(seed);
  const NL = crlf ? '\r\n' : '\n';
  // The model: the document's units as sent (TextDecoder's view, CR kept), each with its bytes.
  const units: { u: string; b: number[] }[] = [];
  const pushText = (s: string) => {
    for (const ch of s) units.push({ u: ch, b: [...enc.encode(ch)] });
  };
  const pushBad = (bytes: number[]) => {
    // (Each maximal invalid subsequence one U+FFFD; EF BF BD is the character itself.)
    for (let i = 0; i < bytes.length; ) {
      const b = Uint8Array.from(bytes);
      const l = seqAt(b, i, b.length);
      const n = Math.abs(l);
      units.push({ u: l > 0 ? dec.decode(b.subarray(i, i + n)) : '�', b: bytes.slice(i, i + n) });
      i += n;
    }
  };
  pushText('[' + NL);
  for (let i = 0; i < lineCount; i++) {
    pushText(`  {"id": ${i}, "s": "${'n'.repeat(i % 37)}`);
    pushBad(KINDS[i % KINDS.length]);
    pushText('é' + (i % 7 === 0 ? '😀' : '') + 'x'.repeat(i % 5));
    pushBad(KINDS[(i + 3) % KINDS.length]);
    pushText(`"}${i < lineCount - 1 ? ',' : ''}${NL}`);
  }
  pushText(']' + NL);
  const bytesOf = () => Uint8Array.from(units.flatMap((x) => x.b));
  assert.equal(dec.decode(bytesOf()), units.map((x) => x.u).join(''), 'the model is TextDecoder’s');
  const src = open(bytesOf());
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  const unitAt = (b: number) => {
    let n = 0;
    for (let k = 0; k < units.length; k++) {
      if (n === b) return k;
      n += units[k].b.length;
    }
    return n === b ? units.length : -1;
  };
  let wrong = 0;
  let ambiguous = 0;
  let resyncs = 0;
  const resync = (whole: Uint8Array) => {
    resyncs++;
    units.length = 0;
    for (let i = 0; i < whole.length; ) {
      const l = seqAt(whole, i, whole.length);
      const n = Math.abs(l);
      units.push({ u: l > 0 ? dec.decode(whole.subarray(i, i + n)) : '�', b: [...whole.subarray(i, i + n)] });
      i += n;
    }
    assert.ok(resyncs < rounds, 'not every round');
  };
  for (let round = 0; round < rounds; round++) {
    assert.equal(await w.load(rnd(lineCount + 2)), true);
    const k0 = unitAt(w.start);
    const k1 = unitAt(w.end);
    assert.ok(k0 >= 0 && k1 >= 0, 'the window on whole units');
    const vu: number[] = [];
    for (let k = k0; k < k1; k++) if (!(units[k].u === '\r' && units[k + 1]?.u === '\n')) vu.push(k);
    if (w.view !== vu.map((k) => units[k].u).join('')) {
      // (A unit deleted between invalid bytes can make them decode as one sequence (ED A0 80 without A0: ED 80, one
      // U+FFFD): the bytes are right, the model's units are read again from them.)
      resync(await docBytes(src));
      round--;
      continue;
    }
    let view = w.view;
    const keys = 1 + rnd(3);
    for (let j = 0; j < keys; j++) {
      const bads: number[] = [];
      for (let q = 0; q < vu.length; q++) if (units[vu[q]].u === '�') bads.push(q);
      const p = bads.length && rnd(2) ? bads[rnd(bads.length)] + rnd(2) : rnd(vu.length);
      let off = 0;
      for (let q = 0; q < p; q++) off += units[vu[q]].u.length;
      let caret = off;
      if (rnd(4) === 0 && p < vu.length && units[vu[p]].u !== '\n' && units[vu[p]].u !== '\r') {
        const k = vu[p];
        view = view.slice(0, off) + view.slice(off + units[k].u.length);
        units.splice(k, 1);
        vu.splice(p, 1);
        for (let q = p; q < vu.length; q++) vu[q]--;
      } else {
        const ch = ['X', 'é', '😀', '€'][rnd(4)];
        view = view.slice(0, off) + ch + view.slice(off);
        const k = p < vu.length ? vu[p] : vu.length ? vu[vu.length - 1] + 1 : k0;
        const at = p < vu.length && units[k].u === '\n' && units[k - 1]?.u === '\r' ? k - 1 : k;
        units.splice(at, 0, { u: ch, b: [...enc.encode(ch)] });
        for (let q = p; q < vu.length; q++) vu[q]++;
        vu.splice(p, 0, at);
        caret = off + ch.length;
      }
      // (Each key told apart, before the last one is sent: they go together, as when a replace is in flight. The
      // caret after it, as the editor has it: which of a run of U+FFFD was deleted.)
      w.edited(view, caret);
    }
    await w.flush();
    const whole = await docBytes(src);
    const want = bytesOf();
    if (same(whole, want)) continue;
    // (An invalid unit deleted next to an identical one: the same text, the diff can't tell which: the model is
    // read again from the document. Not a rewrite: no EF BF BD more.)
    const fffd = (b: Uint8Array) => (Buffer.from(b).toString('hex').match(/efbfbd/g) || []).length;
    if (dec.decode(whole) === dec.decode(want) && fffd(whole) === fffd(want) && whole.length === want.length) {
      ambiguous++;
      resync(whole);
      continue;
    }
    wrong++;
    break;
  }
  await src.destroy();
  return { wrong, ambiguous };
}

test('REVIEW-3 B2 fuzz: 1–3 changes a send next to invalid units, LF and CR LF: no untouched byte changed', async () => {
  for (const crlf of [false, true]) {
    for (const seed of [1, 4, 6]) {
      const r = await fuzz(seed, crlf, 800, 30);
      assert.equal(r.wrong, 0, `seed ${seed}${crlf ? ' CR LF' : ''}: bytes the user didn't touch changed`);
      assert.equal(r.ambiguous, 0, `seed ${seed}${crlf ? ' CR LF' : ''}: the unit deleted is the one at the caret`);
    }
  }
});
