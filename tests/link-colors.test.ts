import test from 'node:test';
import assert from 'node:assert/strict';
import { partsHtml, readLink, snippetParts, textParts, type Part } from '../lib/link-colors';
import { codeWithLinks } from '../lib/link-code';
import { highlightCode } from '../lib/convert/highlight';
import { LINK_SNIPPET, LINK_SNIPPET_TS, HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS } from '../app/(en)/integrate/snippets';

/** Each part as "class:text". */
const show = (s: string, parts: Part[]) => parts.map(([a, b, cls]) => `${cls}:${s.slice(a, b)}`);

test('a link splits into its parts', () => {
  const s = 'https://tools.vikasmaur.com/#a=BcE7_-x&b=https%3A%2F%2Fapi.example.com%2Fd.json&view=tree&to=go';
  const parts: Part[] = [];
  assert.equal(readLink(s, 0, s.length, parts), s.length);
  assert.deepEqual(show(s, parts), [
    'lk-o:https://tools.vikasmaur.com/', 'lk-h:#',
    'lk-k:a', 'lk-e:=', 'lk-d:BcE7_-x',
    'lk-s:&', 'lk-k:b', 'lk-e:=', 'lk-u:https%3A%2F%2Fapi.example.com%2Fd.json',
    'lk-s:&', 'lk-k:view', 'lk-e:=', 'lk-v:tree',
    'lk-s:&', 'lk-k:to', 'lk-e:=', 'lk-v:go',
  ]);
});

test('placeholders, handoff and links in text', () => {
  const s = 'see https://tools.vikasmaur.com/#a=<original>&b=<modified> and https://tools.vikasmaur.com/#handoff.';
  assert.deepEqual(show(s, textParts(s)), [
    'lk-o:https://tools.vikasmaur.com/', 'lk-h:#', 'lk-k:a', 'lk-e:=', 'lk-ph:<original>', 'lk-s:&', 'lk-k:b', 'lk-e:=', 'lk-ph:<modified>',
    'lk-o:https://tools.vikasmaur.com/', 'lk-h:#', 'lk-k:handoff',
  ]);
});

test('link parts in string literals: whole strings only', () => {
  for (const [lit, want] of [
    ["'a='", ['lk-k:a', 'lk-e:=']],
    ["'&view='", ['lk-s:&', 'lk-k:view', 'lk-e:=']],
    ["'https://tools.vikasmaur.com/#'", ['lk-o:https://tools.vikasmaur.com/', 'lk-h:#']],
    ["'/#handoff'", ['lk-o:/', 'lk-h:#', 'lk-k:handoff']],
    ["'https://tools.vikasmaur.com'", ['lk-o:https://tools.vikasmaur.com']],
    ["'deflate-raw'", []],
    ["'_blank'", []],
    ["'='", []],
    ["'tree'", []],
  ] as const) {
    const parts: Part[] = [];
    readLink(lit, 1, lit.length - 1, parts, true);
    assert.deepEqual(show(lit, parts), want, lit);
  }
});

test('the builder\'s Markdown, HTML and link', () => {
  const href = 'https://tools.vikasmaur.com/#a=QUJD&view=tree';
  const md = `[![View in Tool Kumar](https://tools.vikasmaur.com/badges/view-in-tool-kumar.svg)](${href})`;
  assert.deepEqual(show(md, snippetParts(md)), [
    'lk-p:[![', 'lk-t:View in Tool Kumar', 'lk-p:](', 'lk-o:https://tools.vikasmaur.com/badges/view-in-tool-kumar.svg', 'lk-p:)](',
    'lk-o:https://tools.vikasmaur.com/', 'lk-h:#', 'lk-k:a', 'lk-e:=', 'lk-d:QUJD', 'lk-s:&', 'lk-k:view', 'lk-e:=', 'lk-v:tree', 'lk-p:)',
  ]);
  const html = `<a href="${href.replace(/&/g, '&amp;')}"><img src="https://tools.vikasmaur.com/badges/view-in-tool-kumar.svg" alt="View in Tool Kumar" width="158" height="28"></a>`;
  const parts = show(html, snippetParts(html));
  assert.deepEqual(parts.slice(0, 13), [
    'lk-p:<', 'lk-n:a', 'lk-n:href', 'lk-p:="', 'lk-o:https://tools.vikasmaur.com/', 'lk-h:#', 'lk-k:a', 'lk-e:=', 'lk-d:QUJD', 'lk-s:&amp;', 'lk-k:view', 'lk-e:=', 'lk-v:tree',
  ]);
  assert.ok(parts.includes('lk-t:View in Tool Kumar'));
  assert.equal(parts[parts.length - 1], 'lk-p:>');
  assert.deepEqual(show(href, snippetParts(href)).slice(0, 3), ['lk-o:https://tools.vikasmaur.com/', 'lk-h:#', 'lk-k:a']);
});

test('the parts cover the text in order, without overlaps', () => {
  const big = 'https://tools.vikasmaur.com/#a=' + 'Ab9_-'.repeat(400_000) + '&view=graph';
  for (const s of [big, `[![x](y)](${big})`, `<a href="${big.replace('&', '&amp;')}">x</a>`]) {
    const parts = snippetParts(s);
    for (let k = 1; k < parts.length; k++) assert.ok(parts[k][0] >= parts[k - 1][1]);
    assert.ok(parts.length < 40);
  }
});

test('partsHtml draws any slice, escaped', () => {
  const s = '<a href="https://tools.vikasmaur.com/#a=QUJD&amp;view=tree">';
  const parts = snippetParts(s);
  const whole = partsHtml(parts, s, 0, s.length);
  assert.equal(whole.replace(/<span class="[^"]+">|<\/span>/g, ''), s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  // A window into the text, as the editor passes one: offset 10, slice 5..20.
  const t = s.slice(10, 40);
  const strip = (h: string) => h.replace(/<span class="[^"]+">|<\/span>/g, '');
  assert.equal(strip(partsHtml(parts, t, 5, 20, 10)), s.slice(15, 30).replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
  assert.match(partsHtml(parts, t, 5, 20, 10), /<span class="lk-o">/);
});

test('code keeps its colours; links in it are coloured as links', () => {
  // No link: exactly what highlightCode makes.
  const plain = "const x = 'tree';\n// a comment\nfoo(1, \"two\");";
  assert.equal(codeWithLinks(plain, 'javascript'), highlightCode(plain, 'javascript'));
  const node = "const link = 'https://tools.vikasmaur.com/#a=' + deflateRawSync(data).toString('base64url');";
  const html = codeWithLinks(node, 'javascript');
  assert.match(html, /<span class="ts">'<\/span><span class="lk-o">https:\/\/tools\.vikasmaur\.com\/<\/span><span class="lk-h">#<\/span><span class="lk-k">a<\/span><span class="lk-e">=<\/span><span class="ts">'<\/span>/);
  assert.match(html, /<span class="ts">'base64url'<\/span>/);
  const py = 'link = "https://tools.vikasmaur.com/#a=" + base64.urlsafe_b64encode(raw).decode().rstrip("=")';
  assert.match(codeWithLinks(py, 'python'), /<span class="lk-k">a<\/span><span class="lk-e">=<\/span><span class="ts">&quot;<\/span>/);
  assert.match(codeWithLinks(py, 'python'), /<span class="ts">&quot;=&quot;<\/span>/);
  // Every span stays on its line.
  for (const src of [LINK_SNIPPET, LINK_SNIPPET_TS, HANDOFF_SNIPPET, HANDOFF_SNIPPET_TS]) {
    const out = codeWithLinks(src, 'typescript');
    for (const line of out.split('\n')) assert.equal((line.match(/<span/g) ?? []).length, (line.match(/<\/span>/g) ?? []).length);
    assert.equal(out.replace(/<span class="[^"]+">|<\/span>/g, ''), highlightCode(src, 'typescript').replace(/<span class="[^"]+">|<\/span>/g, ''));
    assert.match(out, /lk-k/);
  }
});
