import test from 'node:test';
import assert from 'node:assert/strict';
import { codeRows, highlightCode } from '../lib/convert/highlight';
import { highlightCode as frozen } from './oracle/highlight';
import { convert } from '../lib/convert';
import { TARGETS } from '../lib/engine/targets';
import { parse } from '../lib/json/parser';

// The output views colour converted code a row at a time (wrapped rows, the rows on screen), carrying the
// highlighter's state from row to row (see CodeView's scanner). Rows must colour exactly as the whole
// document does: a YAML block scalar's lines are strings, a TOML multi-line string stays one.

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/** Each character of highlighted HTML with its token class ('' for none). */
function classes(html: string) {
  const text: string[] = [];
  const cls: string[] = [];
  let cur = '';
  for (const m of html.matchAll(/<span class="([^"]+)">|<\/span>|&(?:amp|lt|gt|quot);|[^<&]/gsu)) {
    const t = m[0];
    if (t.startsWith('<span')) cur = m[1];
    else if (t === '</span>') cur = '';
    else
      for (const ch of ENT[t] ?? t) {
        text.push(ch);
        cls.push(ch === '\n' ? '' : cur);
      }
  }
  return { text: text.join(''), cls };
}

/** Colours `doc` row by row as CodeView does, the rows of each line cut at random places. */
function byRows(doc: string, lang: string, r: () => number) {
  const { hl, scanner } = codeRows(lang);
  assert.ok(scanner);
  const lines = doc.split('\n');
  const out: string[] = [];
  let state = scanner.start;
  let at = 0;
  for (const line of lines) {
    // (Layout scans the whole text, a line and its line break at a time.)
    const start = state;
    state = scanner.scan(doc, at, Math.min(doc.length, at + line.length + 1), state);
    const cuts = [0];
    for (let p = 1; p < line.length; p++) if (r() < 0.15) cuts.push(p);
    cuts.push(line.length);
    // Each row starts in the state the rows before it leave (see CodeView.stateAt), and is given the text around it.
    let st = start;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k];
      const b = cuts[k + 1];
      if (a === b && line.length) continue;
      out.push(...classes(hl(line.slice(a, b), false, false, st, doc, at + a)).cls);
      st = scanner.scan(doc, at + a, at + b, st);
    }
    out.push('');
    at += line.length + 1;
  }
  out.pop();
  return out;
}

function check(doc: string, lang: string, seed: number, what: string) {
  const whole = highlightCode(doc, lang);
  assert.equal(whole, frozen(doc, lang), `${what}: whole documents colour as before`);
  const want = classes(whole);
  assert.equal(want.text, doc);
  for (let k = 0; k < 3; k++) {
    const got = byRows(doc, lang, rng(seed * 7 + k));
    for (let i = 0; i < want.cls.length; i++) {
      if (got[i] !== want.cls[i]) {
        const ls = doc.lastIndexOf('\n', i - 1) + 1;
        const le = doc.indexOf('\n', i);
        assert.fail(`${what} (${lang}, cut seed ${seed * 7 + k}): character ${i - ls} of line ${JSON.stringify(doc.slice(ls, le < 0 ? undefined : le))} is "${got[i]}", not "${want.cls[i]}"`);
      }
    }
    assert.equal(got.length, want.cls.length);
  }
}

test('YAML rows colour as the whole document: block scalars are strings', () => {
  const docs = [
    'greeting: |\n  hello\n  world: yes\n  - not a list\n\n  # not a comment\nnext: 1\n',
    '- note: |-\n    a: 1\n    b\n  other: x\n- - |\n    deep: true\n  - plain\n',
    'k: >+\n  folded: text\n\n\nz: null\n"quoted: key": "v: w"\n\'single\': [] # x\n',
    'list:\n- a\n- - b\n  - "c\\" d": e\n# comment: here\nend: ~\n',
    'x: |\n\n  after a blank line: still text\ny: 1.5e+3\n',
  ];
  docs.forEach((d, i) => check(d, 'yaml', i + 1, `handwritten YAML ${i}`));
  const json = [
    '{"greeting":"hello\\nworld: yes\\n- item","n":1,"list":[{"text":"a: b\\nc: d\\n","x":true},"plain: text"],"empty":{},"nul":null}',
    '{"deep":[[{"s":"line one\\nline: two\\n\\n\\n"}]],"k: colon":"v","#hash":"# not\\ncomment"}',
  ];
  json.forEach((j, i) => check(convert(parse(j).root!, 'yaml', { rootName: 'Root' }), 'yaml', 10 + i, `converted YAML ${i}`));
});

test('TOML rows colour as the whole document: multi-line strings stay strings', () => {
  const docs = [
    'title = """\nline one\nkey = "not a key"\n[not.a.table]\n"""\nnext = 1\n',
    "lit = '''\nraw \\ text = 1\n'''\n[table] # comment\nn = -12_000\nd = 1979-05-27T07:32:00Z\n[[arr.of]]\nx = \"q\\\"uote\"\n",
    'end = """ends with quotes""""\nafter = true\nmore = """\n\\""""\nz = [1, 2]\n',
  ];
  docs.forEach((d, i) => check(d, 'toml', i + 20, `handwritten TOML ${i}`));
  const json = '{"title":"a\\nb = 1\\n[c]","n":{"inner":{"x":"y\\n\\"z\\""}},"arr":[{"a":1},{"a":2}],"nul":null,"big":12345678901234567890}';
  check(convert(parse(json).root!, 'toml', { rootName: 'Root' }), 'toml', 30, 'converted TOML');
});

test('code rows colour as the whole document in every converter language', () => {
  const json = '{"id":1,"user_name":"x","tags":["a","b"],"nested":{"when":"2024-01-01T00:00:00Z","ok":true,"n":null,"f":-1.5e-3},"list":[{"a":1},{"a":2,"b":"c"}]}';
  const root = parse(json).root!;
  for (const t of TARGETS) {
    if (t.lang === 'csv' || t.lang === 'xml') continue;
    check(convert(root, t.id, { rootName: 'Root' }), t.lang, 40, t.id);
  }
  const extra: [string, string][] = [
    ['typescript', 'const a = `multi\nline ${x} \\` still`;\n/* block\n comment */ let b = -1;\n// line\nexport interface X { "q-k": string; y?: number }\n'],
    ['go', 'type A struct {\n\tB string `json:"b"`\n}\nvar s = `raw\nstring`\n/* c */\n'],
    ['python', 'class A(BaseModel):\n    x: str = """doc\nstring: here"""\n    y: int = -3  # note\n'],
    ['java', 'String s = """\n  text "with" quotes\n  """;\n/* a\n*/ int x = 0x1F;\n'],
    ['csharp', 'public class A\n{\n    public string B { get; set; }\n}\n'],
    ['php', '<?php\n$a = \'x\'; // c\n# hash\n/** @var int */\n'],
    ['proto', 'syntax = "proto3";\n/* block\n comment */\nmessage A {\n  optional string b = 1 [json_name = "b-\\"c\\""]; // note\n  map<string, google.protobuf.Value> m = 2;\n  repeated int64 r = 3 [json_name = \'r\'];\n}\n'],
    ['swift', 'struct A: Codable {\n    let b: String\n}\nlet s = """\nmulti\n"""\n'],
    ['json', '{\n  "a": [1, -2.5e3, true, null],\n  "b": {"c": "d\\"e"}\n}\n'],
  ];
  extra.forEach(([lang, d], i) => check(d, lang, 50 + i, `handwritten ${lang}`));
});

test('rows colour as the whole document for any text (fuzz)', () => {
  const r = rng(99);
  const alphabet = ['\n', '\n', ' ', ' ', '\t', '"', '"', "'", '`', '/', '*', '#', '[', ']', '{', '}', '(', ')', ':', ': ', '=', ',', '-', '- ', '\\', 'a', 'b', 'Ab', 'true', 'null', '1', '2.5', 'e', '.', '|', '>', '"""', "'''", '/*', '*/', '//'];
  for (const lang of ['yaml', 'toml', 'typescript', 'go', 'python', 'java', 'csharp', 'kotlin', 'swift', 'dart', 'php', 'rust', 'proto', 'json']) {
    for (let k = 0; k < 60; k++) {
      let d = '';
      const n = Math.floor(r() * 120);
      for (let i = 0; i < n; i++) d += alphabet[Math.floor(r() * alphabet.length)];
      check(d, lang, 1000 + k, `fuzz ${k}`);
    }
  }
});

test('a long multi-line string is scanned in linear time', () => {
  // A TOML string of 50,000 lines: each line's scan must not look for the closing quotes all over again.
  const doc = 'text = """\n' + 'some words = and more words\n'.repeat(50_000) + '"""\nafter = 1\n';
  const { scanner, hl } = codeRows('toml');
  assert.ok(scanner);
  const t0 = performance.now();
  let st = scanner.start;
  for (let at = 0; at < doc.length; ) {
    const e = doc.indexOf('\n', at);
    st = scanner.scan(doc, at, e + 1, st);
    // A row drawn on the way: inside the string.
    if (at > 1000 && at < 1100) assert.match(hl(doc.slice(at, e), false, false, st, doc, at), /^<span class="ts">/);
    at = e + 1;
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});
