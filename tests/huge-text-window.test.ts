/*
 * The Format view's editing window (lib/huge/text-window.ts): the change between two texts (never between a pair's
 * halves), a window of whole lines with its bytes, typing sent as joined replaces (one undo step per pause), what's
 * typed while the document is read again sent once it's ready.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HugeClient, type Port } from '../lib/huge/client';
import { serve } from '../lib/huge/serve';
import { CoreSource } from '../lib/huge/core-source';
import { parse } from '../lib/json/tape-parser';
import { LET_GO_MS, LINE_MAX, TextWindow, WINDOW_ABOVE, WINDOW_BYTES, diffText } from '../lib/huge/text-window';
import type { HugeNode, HugeSource, IndexState } from '../lib/huge/source';
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

const whole = async (src: HugeSource) => (await src.textAt(0, src.state().docSize ?? src.size, 1 << 30)).text;

test('the change between two texts: one replace, never between the halves of a pair', () => {
  assert.equal(diffText('abc', 'abc'), null);
  assert.deepEqual(diffText('"user 1"', '"user 12"'), { p: 7, del: 0, ins: '2' });
  assert.deepEqual(diffText('"user 12"', '"user 1"'), { p: 7, del: 1, ins: '' });
  assert.deepEqual(diffText('aXa', 'aYa'), { p: 1, del: 1, ins: 'Y' });
  // (Repeated letters: the earliest place.)
  assert.deepEqual(diffText('aaa', 'aaaa'), { p: 3, del: 0, ins: 'a' });
  // An emoji for another sharing its first half: the whole pair goes.
  assert.deepEqual(diffText('x😀y', 'x😁y'), { p: 1, del: 2, ins: '😁' });
  // One sharing its second half (😀 U+1F600 and 🙀 U+1F640 differ in the low half only… and 𝀀/𐀀 in the high): whole too.
  const d = diffText('x𝐀y', 'x𝀀y')!;
  assert.deepEqual(d, { p: 1, del: 2, ins: '𝀀' });
});

const lines = (n: number) => Array.from({ length: n }, (_, i) => `  {"id": ${i}, "name": "${i % 7 ? 'user' : 'usér 😀'} ${i}"}`);
const doc = (n: number) => '[\n' + lines(n).join(',\n') + '\n]\n';

test('a window of whole lines with its bytes; typing sent as one joined replace; undo takes it back at once', async () => {
  const text = doc(5000);
  const src = core(text);
  await ended(src);
  const sent: number[] = [];
  const w = new TextWindow(src, { sent: () => sent.push(1), failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(2000), true);
  assert.equal(w.line, 2000 - WINDOW_ABOVE);
  const all = text.split('\n');
  assert.equal(w.sent, all.slice(w.line, w.line + w.lines).join('\n') + '\n', 'the lines, as written');
  assert.equal(w.view, w.sent);
  assert.equal(w.start, enc.encode(all.slice(0, w.line).join('\n') + '\n').length, 'and where they start, in bytes');
  // Typing at the end of a name with accents and an emoji before it: each key a replace, joined by the core.
  const at = w.view.indexOf('usér 😀 2002"') + 'usér 😀 2002'.length;
  let now = w.view;
  let off = at;
  for (const ch of 'abc') {
    now = now.slice(0, off) + ch + now.slice(off);
    off++;
    w.edited(now);
    await w.flush();
  }
  assert.equal(sent.length, 3);
  assert.equal(w.view, now);
  const want = text.replace('"usér 😀 2002"', '"usér 😀 2002abc"');
  const got = await whole(src);
  let i = 0;
  while (i < got.length && got[i] === want[i]) i++;
  assert.equal(got.length, want.length, `the document has it, byte for byte (first difference at ${i}: ${JSON.stringify(got.slice(i - 20, i + 20))} vs ${JSON.stringify(want.slice(i - 20, i + 20))})`);
  assert.ok(got === want, `first difference at ${i}: ${JSON.stringify(got.slice(i - 30, i + 30))} vs ${JSON.stringify(want.slice(i - 30, i + 30))}`);
  assert.equal(src.state().status?.kind, 'valid');
  assert.equal(w.offsetOf(w.byteOf(at)), at, 'offsets and bytes map both ways');
  await src.edits!.undo();
  await ended(src);
  assert.equal(await whole(src), text, 'one undo: the typing joined into one step');
  // A change across lines (a line removed): one replace.
  assert.equal(await w.load(100), true);
  const gone = w.view.split('\n');
  gone.splice(3, 1);
  w.edited(gone.join('\n'));
  await w.flush();
  const rest = text.split('\n');
  rest.splice(w.line + 3, 1);
  assert.equal(await whole(src), rest.join('\n'));
  src.destroy();
});

test('a window stays within its bytes; a line longer than a window is refused', async () => {
  const long = '[\n  "' + 'x'.repeat(LINE_MAX + 10) + '",\n  1\n]\n';
  const src = core(long);
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(1, 0), 'long', 'a line over a window: not editable here');
  assert.equal(await w.load(2, 0), true);
  assert.equal(w.sent, '  1\n]\n');
  const many = core(doc(40_000));
  await ended(many);
  const v = new TextWindow(many, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await v.load(20_000), true);
  assert.ok(enc.encode(v.sent).length <= WINDOW_BYTES && v.lines <= 1000, `${v.lines} lines`);
  // A line longer than a window but within LINE_MAX: a window of its own.
  const one = core('[\n  "' + 'y'.repeat(WINDOW_BYTES * 2) + '"\n]\n');
  await ended(one);
  const u = new TextWindow(one, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await u.load(1, 0), true);
  assert.equal(u.lines, 1);
  one.destroy();
  src.destroy();
  many.destroy();
});

test("what's typed while the document is read again waits, then goes as one replace", async () => {
  // A fake document: its first replace answers 'Not ready' while it's read again.
  let text = '[\n  1,\n  2\n]\n';
  let done = true;
  const listeners = new Set<(s: IndexState) => void>();
  const state = () => ({ done, docSize: text.length }) as IndexState;
  const replaces: string[] = [];
  let busyOnce = true;
  const src = {
    lineCount: () => text.split('\n').length - 1,
    lines: async (_m: string, from: number, n: number) => {
      const ls = text.split('\n');
      const out = [];
      for (let k = from, at = ls.slice(0, from).join('\n').length + (from ? 1 : 0); k < Math.min(from + n, ls.length - 1); k++) {
        out.push({ text: ls[k].slice(0, 1), more: 0, at });
        at += ls[k].length + 1;
      }
      return out;
    },
    textAt: async (a: number, b: number) => ({ text: text.slice(a, b), cut: false }),
    state,
    size: text.length,
    onState: (f: (s: IndexState) => void) => (listeners.add(f), () => void listeners.delete(f)),
    edits: {
      replace: async (ops: { a: number; b: number; text: string }[]) => {
        if (busyOnce) {
          busyOnce = false;
          done = false;
          setTimeout(() => {
            done = true;
            for (const f of listeners) f(state());
          }, 20);
          throw new Error('Not ready');
        }
        for (const o of ops) text = text.slice(0, o.a) + o.text + text.slice(o.b);
        replaces.push(ops.map((o) => `${o.a}-${o.b}:${o.text}`).join());
        return { done: true, canUndo: true, canRedo: false };
      },
    },
  } as unknown as HugeSource;
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(0), true);
  w.edited('[\n  10,\n  2\n]\n');
  w.edited('[\n  10,\n  20\n]\n');
  await w.flush();
  assert.equal(text, '[\n  10,\n  20\n]\n');
  // (One replace for both, once the document was ready: each its own op, nothing between them written: REVIEW-3 B2.)
  assert.deepEqual(replaces, ['5-5:0,11-11:0'], 'one replace for both, once the document was ready');
});

test('a file with CR LF line ends: the editor shows \\n, the document keeps \\r\\n, a new line typed is \\r\\n', async () => {
  const text = doc(300).replace(/\n/g, '\r\n');
  const src = core(text);
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(100), true);
  assert.equal(w.view, w.sent.replace(/\r\n/g, '\n'));
  // A new line inserted after a record's comma, and a character typed on a later line.
  const at = w.view.indexOf('"user 102"},') + '"user 102"},'.length;
  let now = w.view.slice(0, at) + '\n  {"id": "new"},' + w.view.slice(at);
  const later = now.indexOf('"user 103"') + 5;
  now = now.slice(0, later) + 'X' + now.slice(later);
  w.edited(now);
  await w.flush();
  const want = text.replace('"user 102"},', '"user 102"},\r\n  {"id": "new"},').replace('"user 103"', '"userX 103"');
  const got = await whole(src);
  let i = 0;
  while (i < got.length && got[i] === want[i]) i++;
  assert.ok(got === want, `the document keeps CR LF, the new line too (first difference at ${i}: ${JSON.stringify(got.slice(i - 30, i + 30))} vs ${JSON.stringify(want.slice(i - 30, i + 30))})`);
  // Offsets and bytes map across the \r\n.
  const off = w.view.indexOf('"userX 103"');
  assert.equal(w.offsetOf(w.byteOf(off)), off);
  assert.equal((await src.textAt(w.byteOf(off), w.byteOf(off) + 11, 64)).text, '"userX 103"');
  // A lone CR: not editable here.
  const lone = core('[\n  1,\r  2\n]\n');
  await ended(lone);
  assert.equal(await new TextWindow(lone, { sent() {}, failed() {} }).load(0), 'cr');
  src.destroy();
  lone.destroy();
});

/** A file handle whose writes wait until `open()` (a save that takes a while). REVIEW-2's probe. */
class SlowHandle {
  name = 'copy.json';
  bytes: string | null = null;
  open: (() => void) | null = null;
  private released = false;
  async createWritable() {
    const parts: BlobPart[] = [];
    return {
      write: async (d: BlobPart) => {
        if (!this.released) await new Promise<void>((r) => (this.open = () => ((this.released = true), r())));
        parts.push(d);
      },
      close: async () => {
        this.bytes = await new Blob(parts).text();
      },
      abort: async () => undefined,
    };
  }
  async getFile() {
    return new File([this.bytes ?? ''], this.name);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('REVIEW-2 #5: typed during a Save as, sent once it ends; flush resolves (not left waiting for a state)', async () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}\n';
  const src = core(text);
  await ended(src);
  const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(0), true);
  w.edited(w.view.replace('1', '10'));
  await w.flush();
  const h = new SlowHandle();
  const run = src.edits!.save(h as unknown as FileSystemFileHandle, false, () => undefined);
  await sleep(30);
  // Typed while saving: the core answers 'Not ready'; the key waits.
  w.edited(w.view.replace('2', '20'));
  await sleep(30);
  h.open?.();
  await run.done;
  const flushed = await Promise.race([w.flush().then(() => 'flushed'), sleep(2000).then(() => 'still pending')]);
  assert.equal(flushed, 'flushed');
  assert.equal(h.bytes, '{\n  "a": 10,\n  "b": 2\n}\n', 'the copy is the document when saved');
  assert.equal(await whole(src), '{\n  "a": 10,\n  "b": 20\n}\n', 'the key typed meanwhile is in the document');
  assert.equal(w.pending, false);
  await src.destroy();
});

test('the window let go with a key not sent yet (another file replacing this one): the key still goes, flush resolves', async () => {
  const src = core('[1,\n2]\n');
  await ended(src);
  const w = new TextWindow(src, { sent: () => assert.fail('nothing is told once let go'), failed: (e) => assert.fail(String(e)) });
  await w.load(0);
  // The newest key, typed in the last frame: the editor's text given at once, then the window let go.
  w.edited(w.view.replace('2', '23'));
  const f = w.flush();
  w.destroy();
  assert.equal(await Promise.race([f.then(() => 'resolved'), sleep(1000).then(() => 'pending')]), 'resolved');
  assert.equal(await whole(src), '[1,\n23]\n');
  // While a save runs: sent once it ends.
  const h = new SlowHandle();
  const w2 = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  await w2.load(0);
  const run = src.edits!.save(h as unknown as FileSystemFileHandle, false, () => undefined);
  await sleep(20);
  w2.edited(w2.view.replace('1', '4'));
  const f2 = w2.flush();
  w2.destroy();
  h.open?.();
  await run.done;
  assert.equal(await Promise.race([f2.then(() => 'resolved'), sleep(2000).then(() => 'pending')]), 'resolved');
  assert.equal(await whole(src), '[4,\n23]\n');
  // Nothing typed: let go at once.
  const w3 = new TextWindow(src, { sent() {}, failed() {} });
  await w3.load(0);
  w3.destroy();
  assert.equal(await w3.load(0), 'none', 'nothing more is read');
  await src.destroy();
});

/** A source over bytes (not text): invalid UTF-8 kept as it is. */
const coreBytes = (bytes: Uint8Array) => {
  const blob = new Blob([bytes as BlobPart]);
  return new CoreSource(blob, 'a.json', (onProgress) => new HugeClient(blob, { name: 'a.json' }, onProgress, inProcess(bytes)));
};
const cat = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(out);
};
// (The whole document: a node at -1 is all of it, core-source.ts slice.)
const bytesOf = async (src: HugeSource) => new Uint8Array(await (await src.slice({ at: -1, end: -1 } as HugeNode)).arrayBuffer());

test("REVIEW-2 #2: invalid UTF-8 in the window: its bytes are the document's; typing after it lands on the right bytes", async () => {
  // "café" in Latin-1 (é = E9: one invalid byte); a cut € (E2 82); FF FE.
  for (const bad of [[0xe9], [0xe2, 0x82], [0xff, 0xfe]]) {
    const bytes = cat('{\n  "name": "caf', bad, '",\n  "city": "Paris"\n}\n');
    const src = coreBytes(bytes);
    await ended(src);
    const w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
    assert.equal(await w.load(0), true);
    assert.equal(w.end - w.start, bytes.length, `the window's bytes (${bad})`);
    // Typed right before "Paris".
    const at = w.view.indexOf('Paris');
    assert.equal(w.byteOf(at), bytes.indexOf(0x50, 20), 'the byte of an offset after it');
    assert.equal(w.offsetOf(bytes.indexOf(0x50, 20)), at, 'and back');
    w.edited(w.view.slice(0, at) + 'X' + w.view.slice(at));
    await w.flush();
    assert.deepEqual(await bytesOf(src), cat('{\n  "name": "caf', bad, '",\n  "city": "XParis"\n}\n'), `X before Paris (${bad})`);
    // Deleting the invalid characters (one U+FFFD per invalid run: FF FE is two) takes out their bytes, all of them.
    const q = w.view.indexOf('caf') + 3;
    w.edited(w.view.slice(0, q) + w.view.slice(w.view.indexOf('"', q)));
    await w.flush();
    assert.deepEqual(await bytesOf(src), cat('{\n  "name": "caf",\n  "city": "XParis"\n}\n'), `the invalid bytes deleted (${bad})`);
    assert.equal(w.end - w.start, (await bytesOf(src)).length);
    await src.destroy();
  }
});

/** Waits till the raw line count is `n` (a broken document's lines past the error are counted after `done`). */
async function counted(src: HugeSource, n: number) {
  for (let k = 0; k < 500 && src.lineCount('raw') < n; k++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(src.lineCount('raw'), n, 'all lines counted');
}

test('REVIEW-2 #6: a broken document all read: the window holds the error\'s line and the lines after it', async () => {
  // Part 1: opened on a broken file (a missing comma on line 22): the window at the error has it, and more.
  const recs = Array.from({ length: 5000 }, (_, i) => `  {"id": ${i}, "name": "user ${i}"}`);
  recs[20] = '  {"id": 20 "name": "user 20"}';
  const text = '[\n' + recs.join(',\n') + '\n]\n';
  let src = core(text);
  let st = await ended(src);
  assert.ok(st.error, 'broken');
  await counted(src, text.split('\n').length);
  const errLine = st.error!.line - 1;
  assert.equal(await src.lineOf('raw', st.error!.at), errLine, 'the error\'s line (not 0)');
  let w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  assert.equal(await w.load(errLine), true);
  assert.ok(w.offsetOf(st.error!.at) >= 0, 'the error is in the window');
  assert.ok(w.line + w.lines - 1 > errLine + 100, `lines after it too (window ${w.line}–${w.line + w.lines - 1}, error ${errLine})`);
  assert.equal(w.view, text.split('\n').slice(w.line, w.line + w.lines).join('\n') + '\n', 'its text, line for line');
  // Fixed by typing there: valid again.
  const at = w.view.indexOf('{"id": 20 ') + '{"id": 20'.length;
  w.edited(w.view.slice(0, at) + ',' + w.view.slice(at));
  await w.flush();
  st = await ended(src);
  assert.equal(st.status?.kind, 'valid', 'fixed by typing');
  await src.destroy();

  // Part 2: valid, a window at line 2000; a comma deleted there; the window read again keeps the broken line.
  const good = '[\n' + Array.from({ length: 5000 }, (_, i) => `  {"id": ${i}, "name": "user ${i}"}`).join(',\n') + '\n]\n';
  src = core(good);
  await ended(src);
  w = new TextWindow(src, { sent() {}, failed: (e) => assert.fail(String(e)) });
  await w.load(2000);
  const c = w.view.indexOf('{"id": 2000,') + '{"id": 2000'.length;
  w.edited(w.view.slice(0, c) + w.view.slice(c + 1));
  await w.flush();
  st = await ended(src);
  // (The core doesn't count the lines past an error an edit made yet: UI-NOTES 24. The window reads them itself.)
  const broken = st.error!.line - 1;
  const before = [w.line, w.line + w.lines - 1];
  assert.equal(await w.load(w.line, 0), true);
  assert.deepEqual([w.line, w.line + w.lines - 1], before, 'read again: the same lines');
  assert.ok(broken >= w.line && broken < w.line + w.lines, 'the broken line still in it');
  await src.destroy();
});

test('REVIEW-3 C7: a window let go with keys held (the document read again) stops trying once its time is up', async () => {
  let asked = 0;
  // A source whose document is being read again (an unbalanced quote in a big file), then closed.
  const src = {
    state: () => {
      asked++;
      return { done: false };
    },
    onState: () => () => undefined,
    edits: { replace: async () => ({}) },
  } as unknown as HugeSource;
  const w = new TextWindow(src, { sent() {}, failed() {} });
  w.view = w.sent = 'abc';
  w.edited('abcd');
  const f = w.flush();
  w.destroy();
  await sleep(LET_GO_MS + 400);
  assert.equal(await Promise.race([f.then(() => 'resolved'), sleep(50).then(() => 'pending')]), 'resolved', 'flush resolves');
  const before = asked;
  await sleep(1000);
  assert.equal(asked, before, 'no more polling');
});
