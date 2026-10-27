// Files that are not plain JSON, opened through Open file: binaries (video, ELF, PNG, zip, random bytes),
// odd encodings (UTF-16 with a BOM, invalid UTF-8, BOMs, NUL padding), other formats (CSV, YAML, XML, TOML,
// HTML), JSON Lines variants and wrappers (JSONP, code fences, XSSI prefix). Each gives an exact status,
// toast, input text and (when it parses) Format output, the same in every engine, and no page errors.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { defaults, test } from '../../lib/api.mjs';
import { DIRS } from '../../lib/env.mjs';
import { bigFixture } from './_gen.mjs';
import { copied, golden, hash, loadAny, seenToasts, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000 });

/** A 3-second test-pattern MP4 made by ffmpeg when it is installed (else a fixed MP4-like header). */
function video() {
  const file = join(DIRS.fixtures, 'breaker-v1', 'video.mp4');
  try {
    return readFileSync(file);
  } catch {}
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-bitexact', '-map_metadata', '-1', file]);
  return r.status === 0 ? readFileSync(file) : null;
}

// [name, bytes or () => bytes, mime]
const FILES = [
  // An ELF header, then seeded random bytes (a real binary would differ per machine).
  ['elf.json', () => Buffer.concat([Buffer.from('7f454c4602010100000000000000000003003e0001000000', 'hex'), readFileSync(bigFixture('blob-1mb')).subarray(0, 200_000)])],
  ['img.png', () => Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex'), 'image/png'],
  ['a.zip', () => Buffer.from('504b0304140000000000000000000000000000000000000000000600000061' + '2e6a736f6e7b2261223a317d504b0506000000000000000000000000000000000000', 'hex'), 'application/zip'],
  ['random.json', () => readFileSync(bigFixture('blob-1mb'))],
  ['utf16-bom.json', () => readFileSync(bigFixture('utf16-bom'))],
  ['bad-utf8.json', () => readFileSync(bigFixture('bad-utf8'))],
  ['bom-twice.json', '﻿﻿{"a":1}'],
  ['nul-tail.json', '{"a":1}\u0000\u0000\u0000'],
  ['data.csv', 'id,name,note\n1,"Zoë, the ""great""",=cmd|"/c calc"!A0\n2,,\n3,東京,"multi\nline"\n', 'text/csv'],
  ['data.tsv', 'id\tname\n1\tAda\n2\tLin\n', 'text/tab-separated-values'],
  ['data.yaml', 'a: &x {b: 1}\nc: *x\nd: [1, 2, "3"]\ne: 0x1F\nf: .inf\ng: 2026-10-26\nh: yes\ni: ~\nj: |\n  two\n  lines\n'],
  ['data.xml', '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "boom">]><r a="1"><x>&e;</x><x>2</x><y/><z><![CDATA[<b>]]></z></r>'],
  ['data.toml', 'a = 1\n[b]\nc = "d"\n[[e]]\nf = 1979-05-27T07:32:00Z\n[[e]]\nf = 1.5e3\n'],
  ['page.html', '<!doctype html><html><body><h1>Hi</h1><script>window.__xss=1</script></body></html>', 'text/html'],
  ['crlf.jsonl', '{"a":1}\r\n{"a":2}\r\n\r\n{"a":3}'],
  ['one.jsonl', '{"a":1}'],
  ['broken.jsonl', '{"a":1}\n{"a":2,}\n{"a":\n'],
  ['jsonp.json', 'callback({"a":1});'],
  ['fence.json', '```json\n{"a":1}\n```'],
  ['xssi.json', ")]}',\n{\"a\":1}"],
  ['empty.json', ''],
  ['spaces.json', ' \n\t \n'],
];

for (const [name, data, mime] of FILES) {
  test(`${name}: exact status, toast, input and output`, async (t) => {
    const { page } = t;
    await t.open('/');
    await page.evaluate(() => (window.__xss = 0));
    const bytes = typeof data === 'function' ? data() : Buffer.from(data);
    // (Random bytes take WebKit ~45 s on a busy host: BREAKER-REPORT F3b.)
    const st = await loadAny(page, bytes, name, { mimeType: mime || 'application/json', ready: !bytes.toString().trim(), timeout: 150_000 });
    const out = { status: st };
    out.toasts = await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 3000 });
    const input = await copied(page, 'Copy input to clipboard', { timeout: 5000 });
    // Long inputs are compared by hash; short ones as text.
    out.input = input === null ? null : input.length > 2000 ? hash(input) : input;
    if (st?.kind === 'ok' || st?.kind === 'warn') {
      const f = await copied(page, 'Copy formatted output', { timeout: 10_000 });
      out.formatted = f === null ? null : f.length > 2000 ? hash(f) : f;
    }
    const known = name === 'utf16-bom.json' && t.engine === 'firefox' ? 'bug: Firefox opens a UTF-16 file with a BOM as garbage (BREAKER-REPORT F7)' : undefined;
    golden(t, `files/${name}`, out, `${name}: outputs match the golden file`, { known });
    t.check((await page.evaluate(() => window.__xss)) === 0, 'no markup from the file ran');
  });
}

test('video.mp4: a real video opens as text with a clear error, no page errors', async (t) => {
  const { page } = t;
  const bytes = video();
  if (!t.check(!!bytes, 'ffmpeg made a test video')) return;
  await t.open('/');
  const st = await loadAny(page, bytes, 'video.mp4', { mimeType: 'video/mp4' });
  t.check(st?.kind === 'err' && /^Ln 1, Col 1: Unexpected control character U\+0000/.test(st.msg), 'an error at the first byte', st);
  t.check((await seenToasts(page)).includes('Opened video.mp4'), 'Opened video.mp4', await seenToasts(page));
});

// ── Encodings across read chunks ────────────────────────────────────────────────────────────────
// Files are read in chunks (64 KB and up): a character split between two chunks, a surrogate pair, a CRLF
// pair, a UTF-16 code unit split between bytes must all come out whole. ~1.5 MB of text dense in 1- to
// 4-byte characters, written with CRLF, in UTF-8 (with and without a BOM) and UTF-16 LE / BE with a BOM.

/** A seeded JSON array of strings packed with multi-byte characters, CRLF between items. */
function denseText() {
  const pieces = ['a', 'é', 'ß', 'Ж', '東', '京', '😀', '👨‍👩‍👧', '🚀', '\\n', '\\"', '\\u00e9', '\\ud83d\\ude00', ' ', 'z'];
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % pieces.length);
  const items = [];
  for (let size = 0; size < 1_500_000; ) {
    let s = '';
    for (let j = 0, n = 5 + (items.length % 61); j < n; j++) s += pieces[rnd()];
    items.push(`  "${s}"`);
    size += s.length * 2 + 4;
  }
  return '[\r\n' + items.join(',\r\n') + '\r\n]';
}

const ENCODINGS = [
  ['utf8', (t) => Buffer.from(t, 'utf8')],
  ['utf8-bom', (t) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(t, 'utf8')])],
  ['utf16le-bom', (t) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')])],
  ['utf16be-bom', (t) => {
    const le = Buffer.from(t, 'utf16le');
    for (let i = 0; i < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]];
    return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
  }],
];

for (const [enc, encode] of ENCODINGS) {
  test(`${enc}: 1.5 MB dense in multi-byte characters and CRLF comes out exact`, async (t) => {
    const { page } = t;
    await t.open('/');
    const text = denseText();
    const want = text.replace(/\r\n/g, '\n');
    const st = await loadAny(page, encode(text), `dense-${enc}.json`);
    const known = enc.startsWith('utf16') && t.engine === 'firefox' ? { known: 'bug (main): Firefox opens a UTF-16 file with a BOM as garbage (BREAKER-REPORT F7)' } : {};
    t.check(st?.kind === 'ok' && st.msg === 'Valid JSON', 'valid JSON', st, known);
    const got = await copied(page, 'Copy input to clipboard', { timeout: 30_000 });
    t.check(got !== null && hash(got) === hash(want), 'the editor holds exactly the text (LF line breaks)', got === null ? null : `${got.length} vs ${want.length} chars`, known);
  });
}

/**
 * A JSON array in which every 4,096-byte boundary of the file falls inside something: a 2-, 3- or 4-byte
 * UTF-8 character (at each split point), a CRLF between items, an escape or an escaped surrogate pair. Read
 * chunks are multiples of 4 KB, so every chunk boundary splits one. `utf16`: the same in UTF-16 LE with a
 * BOM, where boundaries split surrogate pairs.
 */
function boundaryFile(utf16) {
  const unit = utf16 ? 2 : 1;
  const bytes = (s) => (utf16 ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf8'));
  const specials = utf16
    ? [['😀', 1], ['🚀', 1], ['\r\n', 1]]
    : [['é', 1], ['東', 1], ['東', 2], ['😀', 1], ['😀', 2], ['😀', 3], ['\r\n', 1], ['\\u00e9', 3], ['\\ud83d\\ude00', 6]];
  const parts = [];
  let pos = utf16 ? 2 : 0;
  const put = (s) => {
    const b = bytes(s);
    parts.push(b);
    pos += b.length;
  };
  put('[');
  for (let i = 0; pos < 600_000; i++) {
    const [sp, split] = specials[i % specials.length];
    const boundary = Math.ceil((pos + 64) / 4096) * 4096;
    if (sp === '\r\n') {
      // Close the item, then spaces so the CR is the boundary's last byte.
      put('"x",' + ' '.repeat((boundary - split * unit - pos - 4 * unit) / unit));
      put('\r\n');
    } else {
      put('"');
      const at = boundary - split * unit; // where the special starts
      put('a'.repeat((at - pos) / unit));
      put(sp + '",');
    }
  }
  put('"end"]');
  const body = Buffer.concat(parts);
  const file = utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  const text = utf16 ? body.toString('utf16le') : body.toString('utf8');
  return { file, want: text.replace(/\r\n/g, '\n') };
}

for (const utf16 of [false, true]) {
  test(`${utf16 ? 'UTF-16 LE' : 'UTF-8'}: every 4 KB boundary splits a character, a pair or a CRLF, and the text comes out exact`, async (t) => {
    const { page } = t;
    await t.open('/');
    const { file, want } = boundaryFile(utf16);
    const st = await loadAny(page, file, `boundaries-${utf16 ? 'utf16' : 'utf8'}.json`);
    const known = utf16 && t.engine === 'firefox' ? { known: 'bug (main): Firefox opens a UTF-16 file with a BOM as garbage (BREAKER-REPORT F7)' } : {};
    t.check(st?.kind === 'ok' && st.msg === 'Valid JSON', 'valid JSON', st, known);
    const got = await copied(page, 'Copy input to clipboard', { timeout: 30_000 });
    let at = -1;
    if (got !== null && got !== want) for (at = 0; at < want.length && got[at] === want[at]; ) at++;
    t.check(got === want, 'the editor holds exactly the text', got === null ? null : { at, got: JSON.stringify(got.slice(Math.max(0, at - 10), at + 10)), want: JSON.stringify(want.slice(Math.max(0, at - 10), at + 10)) }, known);
  });
}
