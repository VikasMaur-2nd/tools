/**
 * Invalid UTF-8 (REVIEW-2 item 2): one rule everywhere bytes and UTF-16 offsets are mapped, the one TextDecoder
 * decodes by (an invalid sequence is one U+FFFD per maximal invalid subsequence). Before, a U+FFFD counted 3 bytes
 * back, so every position after an invalid byte moved: resolve, locate, pages, pretty positions, and the bytes node
 * edits changed (`{"a":"caf<E9>","b":…}`: `b` at 18, not 16; setValue wrote into `"xyz"`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HugeDoc } from '../lib/huge/doc';
import { HugeEditor } from '../lib/huge/editor';
import { PageNodes } from '../lib/huge/page';
import { badUnits, byteAtUnits, seqAt, utf16Of, utf16Units, utf8Bytes } from '../lib/huge/utf8';
import { rng } from './oracle/compare';
import { parse } from '../lib/json/tape-parser';
import { hugeMod, memSource, open, tapeMod, type EditTune } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();
const cat = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(out);
};
const indexOf = (b: Uint8Array, s: string) => Buffer.from(b).indexOf(s);

/** Invalid sequences of each kind (and a real U+FFFD, valid: 3 bytes). */
const KINDS: number[][] = [
  [0xe9], // Latin-1 é: a lead byte, then a byte that can't follow it
  [0xff, 0xfe], // never in UTF-8
  [0x80], // a lone continuation byte
  [0xc0, 0x80], // overlong: two
  [0xe2, 0x82], // a 3-byte character cut short: one
  [0xed, 0xa0, 0x80], // a surrogate: three
  [0xf0, 0x9f, 0x98], // a 4-byte character cut short: one
  [0xf5, 0x80], // past U+10FFFF
  [0xef, 0xbf, 0xbd], // U+FFFD itself
];

test('invalid UTF-8: the reviewer\'s case and every kind: positions are the bytes\', node edits change the bytes meant', () => {
  for (const bad of KINDS) {
    const bytes = cat('{"a":"caf', bad, '","b":"xyz","c":[1,2]}');
    const where = ` (${bad.map((x) => x.toString(16)).join(' ')})`;
    const d = new HugeDoc(memSource(bytes), hugeMod, { wasm: tapeMod, parse }, {}, { previewMs: Infinity });
    d.step(Infinity);
    const b = indexOf(bytes, '"xyz"');
    assert.deepEqual([d.resolve(['b'])!.node.start, d.resolve(['b'])!.node.end], [b, b + 5], 'resolve' + where);
    assert.equal(d.locate(b + 1)!.node.start, b, 'locate' + where);
    const view = new PageNodes(d.children(d.summary().root!, 0, 3));
    assert.deepEqual(view.span(view.children[1]), [b, b + 5], 'page span' + where);
    assert.ok(Array.from(d.prettyLines(0, 5, '  ', 1000).pos).includes(b), 'pretty position' + where);
    new HugeEditor(d).setValue(d.resolve(['b'])!.node, '"NEW"');
    assert.deepEqual(d.src.read(0, d.src.size), cat('{"a":"caf', bad, '","b":"NEW","c":[1,2]}'), 'set' + where);
  }
});

test('utf8.ts against TextDecoder: units, the invalid ones and their bytes, offsets both ways, on random bytes', () => {
  const r = rng(77);
  const pool = [0x41, 0x22, 0x0a, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xed, 0xa0, 0xbf, 0xc0, 0xf5, 0xff, 0xef, 0xbd];
  for (let k = 0; k < 3000; k++) {
    const b = Uint8Array.from({ length: 1 + r.int(24) }, () => pool[r.int(pool.length)]);
    const text = dec.decode(b);
    assert.equal(utf16Units(b), text.length, `units of ${Array.from(b)}`);
    const bad = badUnits(b);
    // Every U+FFFD is either invalid bytes (in `bad`) or the character itself.
    let real = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) real++;
    assert.equal(real - (bad ? bad.length / 2 : 0), (Buffer.from(b).toString('latin1').match(/\xef\xbf\xbd/g) ?? []).length, `U+FFFDs of ${Array.from(b)}`);
    // Offsets both ways, at every unit not inside a pair.
    for (let u = 0; u <= text.length; u++) {
      if (u > 0 && u < text.length && (text.charCodeAt(u) & 0xfc00) === 0xdc00) continue;
      const byte = byteAtUnits(b, 0, b.length, u);
      assert.equal(utf8Bytes(text, 0, u, bad), byte, `bytes of ${u} units of ${Array.from(b)}`);
      assert.equal(utf16Of(text, byte, bad), u, `units of ${byte} bytes of ${Array.from(b)}`);
      assert.equal(dec.decode(b.subarray(0, byte)), text.slice(0, u), `the prefix of ${Array.from(b)}`);
    }
    for (let i = 0; i < b.length; ) i += Math.abs(seqAt(b, i, b.length));
  }
});

test('invalid UTF-8 across windows, strides, checkpoints and pages: every node, line, text and edit where the bytes are', () => {
  const r = rng(78);
  for (const t of [
    { every: 64, big: 1 << 20, window: 64, pageBytes: 300 },
    { every: 192, big: 120, window: 128, pageBytes: 1500 },
  ] as EditTune[]) {
    // Records whose names have invalid bytes at every offset (so they fall on every edge), their places known.
    const parts: (string | number[])[] = ['[\n'];
    const want: { start: number; end: number; name: [number, number] }[] = [];
    let at = 2;
    for (let i = 0; i < 400; i++) {
      const bad = KINDS[i % KINDS.length];
      const pad = 'n'.repeat(i % 37);
      const head = `  {"id": ${i}, "name": "`;
      const name0 = at + enc.encode(head).length - 1;
      const body = [...enc.encode(pad), ...bad, ...enc.encode('é' + 'x'.repeat(i % 5))];
      const tail = `"}${i < 399 ? ',' : ''}\n`;
      parts.push(head, body, tail);
      const len = enc.encode(head).length + body.length + enc.encode(tail).length - (i < 399 ? 2 : 1);
      want.push({ start: at + 2, end: at + len, name: [name0, name0 + 2 + body.length] });
      at += enc.encode(head).length + body.length + enc.encode(tail).length;
    }
    parts.push(']\n');
    const bytes = cat(...parts);
    const d = open(bytes, 'a.json', t);
    assert.equal(d.summary().error, null);
    assert.equal(d.summary().root!.count, 400);
    for (const [i, w] of want.entries()) {
      const rec = d.resolve([i])!.node;
      assert.deepEqual([rec.start, rec.end], [w.start, w.end], `record ${i}`);
      const name = d.resolve([i, 'name'])!.node;
      assert.deepEqual([name.start, name.end], w.name, `name ${i}`);
      assert.equal(d.locate(w.name[1] - 1)!.node.start, w.name[0], `locate in name ${i}`);
    }
    // Pages, all of them.
    for (let from = 0; from < 400; ) {
      const page = d.children(d.summary().root!, from, 37);
      const view = new PageNodes(page);
      view.children.forEach((c, j) => assert.deepEqual(view.span(c), [want[from + j].start, want[from + j].end], `page span ${from + j}`));
      from += page.count;
    }
    // Pretty lines: each record's line at its byte.
    const pos = new Set<number>();
    for (let from = 0; from < d.summary().prettyLines; from += 200) for (const p of d.prettyLines(from, 200, '  ', 1 << 16).pos) pos.add(p);
    for (const w of want) assert.ok(pos.has(w.start), `pretty line at ${w.start}`);
    // Raw lines: where each starts, and columns ↔ bytes with `bad`.
    const raw = d.rawLines(1, 400, 1 << 16);
    for (let j = 0; j < 400; j++) {
      assert.equal(raw.pos[j], want[j].start - 2, `raw line ${j + 1}`);
      const text = raw.text[j];
      const bad = raw.bad?.[j] ?? null;
      const col = text.indexOf('"name"') + 8;
      assert.equal(raw.pos[j] + utf8Bytes(text, 0, col, bad), want[j].name[0], `the name's column on line ${j + 1}`);
      assert.equal(utf16Of(text, want[j].end - raw.pos[j], bad), text.lastIndexOf('}') + 1, `the record's end column on line ${j + 1}`);
    }
    // text() over a stretch: offsets ↔ bytes with `bad`, at every record.
    const s0 = want[50].start;
    const got = d.text(s0, want[120].end, 1 << 20);
    assert.ok(got.bad && got.bad.length > 0);
    for (let j = 50; j <= 120; j++) {
      const u = utf16Of(got.text, want[j].start - s0, got.bad);
      assert.equal(utf8Bytes(got.text, 0, u, got.bad), want[j].start - s0, `text offset of record ${j}`);
      assert.equal(got.text.slice(u, u + 7), '{"id": ', `text at record ${j}`);
    }
    // Node edits at records after many invalid bytes: the bytes meant.
    const ed = new HugeEditor(d);
    let doc = bytes;
    for (let e = 0; e < 12; e++) {
      const i = 30 + r.int(360);
      const node = d.resolve([i, 'id'])!.node;
      ed.setValue(node, String(9000 + e));
      const at0 = node.start;
      const out = new Uint8Array(doc.length - (node.end - node.start) + String(9000 + e).length);
      out.set(doc.subarray(0, at0));
      out.set(enc.encode(String(9000 + e)), at0);
      out.set(doc.subarray(node.end), at0 + String(9000 + e).length);
      doc = out;
      assert.deepEqual(d.src.read(0, d.src.size), doc, `edit ${e} at record ${i}`);
    }
    ed.remove(d.summary().root!, 200);
    assert.equal(d.resolve([200, 'id'])!.node.start > 0, true);
    assert.equal(d.summary().root!.count, 399);
  }
});
