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
    const st = await loadAny(page, bytes, name, { mimeType: mime || 'application/json', ready: !bytes.toString().trim() });
    const out = { status: st };
    out.toasts = await until(page, () => (window.__toasts?.length ? window.__toasts : null), null, { timeout: 3000 });
    const input = await copied(page, 'Copy input to clipboard', { timeout: 5000 });
    // Long inputs are compared by hash; short ones as text.
    out.input = input === null ? null : input.length > 2000 ? hash(input) : input;
    if (st?.kind === 'ok' || st?.kind === 'warn') {
      const f = await copied(page, 'Copy formatted output', { timeout: 10_000 });
      out.formatted = f === null ? null : f.length > 2000 ? hash(f) : f;
    }
    const known = name === 'utf16-bom.json' && t.engine === 'firefox' ? 'bug: Firefox opens a UTF-16 file with a BOM as garbage (BREAKER-REPORT F3)' : undefined;
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
