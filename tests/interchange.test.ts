import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { cpuNow } from './timing';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { JNode, parse } from '../lib/json/parser';
import { records, tabulate, toCsv, toXlsx } from '../lib/convert/xlsx';
import { detectFormat, importToJson, sniffDelimiter, type CsvOptions, type ImportFormat } from '../lib/convert/import';

// ── helpers ──────────────────────────────────────────────────────────────

const root = (json: string): JNode => {
  const r = parse(json);
  assert.ok(r.root, r.error?.m);
  return r.root;
};

/** Converts and returns { text, value }; fails the test on conversion errors or invalid JSON. */
const conv = (text: string, fmt: ImportFormat, indent = '') => {
  const r = importToJson(text, fmt, indent);
  if ('error' in r) assert.fail(`unexpected error: ${r.error} at ${r.line}:${r.col}`);
  const p = parse(r.json);
  assert.ok(p.root && !p.error && p.issues.length === 0, `invalid JSON output: ${r.json.slice(0, 200)}`);
  return { text: r.json, value: JSON.parse(r.json) as unknown };
};
const val = (text: string, fmt: ImportFormat) => conv(text, fmt).value;
const err = (text: string, fmt: ImportFormat) => {
  const r = importToJson(text, fmt, '  ');
  if (!('error' in r)) return assert.fail(`expected an error, got ${r.json.slice(0, 200)}`);
  // (Its offset is the same place as its line and column: checked on its own below.)
  const rest = { ...r };
  delete rest.p;
  return rest;
};

interface ZipEntry {
  name: string;
  method: number;
  data: Buffer;
}
/** Independent ZIP reader: walks the central directory, checks local headers, sizes and CRC-32. */
function unzip(buf: Buffer): Map<string, ZipEntry> {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  assert.equal(p + cdSize, eocd, 'central directory placement');
  const out = new Map<string, ZipEntry>();
  for (let k = 0; k < count; k++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header signature');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    assert.equal(buf.readUInt32LE(off), 0x04034b50, 'local header signature');
    assert.equal(buf.readUInt32LE(off + 14), crc, 'local CRC matches central');
    assert.equal(buf.toString('utf8', off + 30, off + 30 + buf.readUInt16LE(off + 26)), name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.ok(method === 0 || method === 8, 'method');
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data) >>> 0, crc, `${name} CRC-32`);
    out.set(name, { name, method, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const xlsxParts = async (json: string, opts?: Parameters<typeof toXlsx>[1]) => {
  const blob = await toXlsx(root(json), opts);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const buf = Buffer.from(await blob.arrayBuffer());
  const parts = unzip(buf);
  const text = (n: string) => {
    const e = parts.get(n);
    assert.ok(e, `missing part ${n}`);
    return e.data.toString('utf8');
  };
  return { buf, parts, text, sheet: text('xl/worksheets/sheet1.xml') };
};

/** Every XML part must be well-formed (checked with our own XML reader). */
const wellFormed = (xml: string) => {
  const r = importToJson(xml, 'xml', '');
  assert.ok('json' in r, 'error' in r ? `${r.error} at ${r.line}:${r.col}` : '');
};

const hasPython = spawnSync('python3', ['-I', '-c', 'import zipfile, xml.dom.minidom']).status === 0;
const PY = `
import sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
for n in names:
    xml.dom.minidom.parseString(z.read(n))
print(len(names))
`;

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)] };
}
const NASTY = ['', ' lead', 'trail ', 'a"b', "it's", 'x\\y', 'tab\there', 'nl\nx', 'cr\r\n', '<&>', ']]>', '_x0041_', '\u0001\u001f', '\ud800', '\ud83d\ude00', 'caf\u00e9', '\u2028', '#hash', 'key: v', '- dash', '{[,]}', 'null', 'true', '007', '1e5', '-0'];
/** Random JSON text (numbers as exact text, including big ints). */
function randomJson(r: ReturnType<typeof prng>, d = 0): string {
  const k = d > 3 ? r.int(4) : r.int(7);
  switch (k) {
    case 0: return 'null';
    case 1: return r.next() < 0.5 ? 'true' : 'false';
    case 2: return r.pick(['0', '-1', '42', '3.25', '-0.5', '1e5', '2.5E-3', '12345678901234567890', String(r.int(1e6))]);
    case 3: return JSON.stringify(r.pick(NASTY) + (r.next() < 0.3 ? String(r.int(100)) : ''));
    case 4: {
      const n = r.int(4);
      const a: string[] = [];
      for (let j = 0; j < n; j++) a.push(randomJson(r, d + 1));
      return '[' + a.join(',') + ']';
    }
    default: {
      const n = r.int(5);
      const seen = new Set<string>();
      const a: string[] = [];
      for (let j = 0; j < n; j++) {
        const key = r.pick(NASTY) + j;
        if (seen.has(key)) continue;
        seen.add(key);
        a.push(JSON.stringify(key) + ':' + randomJson(r, d + 1));
      }
      return '{' + a.join(',') + '}';
    }
  }
}

// ── tabulate / CSV export ────────────────────────────────────────────────

describe('tabulate', () => {
  test('array of objects: union of keys, dot paths, joined primitive arrays, JSON for the rest', () => {
    const t = tabulate(
      root(`[
        {"id": 1, "name": "Ada", "address": {"city": "London", "geo": {"lat": 51.5}}, "tags": ["a", "b"], "big": 12345678901234567890},
        {"id": 2, "email": "x@y.z", "address": {"zip": "007"}, "orders": [{"n": 1}], "empty": {}, "none": null}
      ]`),
    );
    assert.deepEqual(t.headers, ['id', 'name', 'address.city', 'address.geo.lat', 'tags', 'big', 'email', 'address.zip', 'orders', 'empty', 'none']);
    assert.deepEqual(t.rows[0], [1, 'Ada', 'London', 51.5, 'a, b', '12345678901234567890', null, null, null, null, null]);
    assert.deepEqual(t.rows[1], [2, null, null, null, null, null, 'x@y.z', '007', '[{"n":1}]', '{}', null]);
  });

  test("flatten: 'json' keeps nested values as minified JSON", () => {
    const t = tabulate(root('[{"a": {"b": 1}, "c": [1, 2]}]'), 'json');
    assert.deepEqual(t.headers, ['a', 'c']);
    assert.deepEqual(t.rows, [['{"b":1}', '[1,2]']]);
  });

  test('shapes: primitives, object of objects, single object, matrix, scalar, mixed', () => {
    assert.deepEqual(tabulate(root('[1, "x", true, null]')), { headers: ['value'], rows: [[1], ['x'], [true], [null]] });
    assert.deepEqual(tabulate(root('{"alice": {"age": 30}, "bob": {"age": 25, "admin": true}}')), {
      headers: ['key', 'age', 'admin'],
      rows: [
        ['alice', 30, null],
        ['bob', 25, true],
      ],
    });
    assert.deepEqual(tabulate(root('{"name": "x", "db": {"host": "h", "port": 5432}, "list": [1, 2]}')), {
      headers: ['key', 'value'],
      rows: [
        ['name', 'x'],
        ['db.host', 'h'],
        ['db.port', 5432],
        ['list', '1, 2'],
      ],
    });
    assert.deepEqual(tabulate(root('[["name", "age"], ["Ada", 36], ["Bob", 41]]')), {
      headers: ['name', 'age'],
      rows: [
        ['Ada', 36],
        ['Bob', 41],
      ],
    });
    assert.deepEqual(tabulate(root('[[1, 2], [3]]')), { headers: ['1', '2'], rows: [[1, 2], [3, null]] });
    assert.deepEqual(tabulate(root('"hi"')), { headers: ['value'], rows: [['hi']] });
    assert.deepEqual(tabulate(root('[{"a": 1}, 5, null]')), { headers: ['a', 'value'], rows: [[1, null], [null, 5], [null, null]] });
    assert.deepEqual(tabulate(root('[]')), { headers: [], rows: [] });
  });

  test('paths that would read alike keep their own columns', () => {
    // a dotted key and the same path through a nested object: escaped only because they clash
    assert.deepEqual(tabulate(root('[{"a.b": 1, "a": {"b": 2}}]')), { headers: ['a\\.b', 'a.b'], rows: [[1, 2]] });
    assert.deepEqual(tabulate(root('[{"a": {"b": 2}}, {"a.b": 1}]')), { headers: ['a.b', 'a\\.b'], rows: [[2, null], [null, 1]] });
    // escaping never makes a new clash
    assert.deepEqual(tabulate(root('[{"a.b": 1, "a": {"b": 2}, "a\\\\.b": 3}]')).headers, ['a\\.b', 'a.b', 'a\\\\\\.b']);
    assert.deepEqual(tabulate(root('[{"a\\\\": {"b": 1}, "a\\\\.b": 2}]')).headers, ['a\\\\.b', 'a\\\\\\.b']);
    // dotted keys that don't clash stay as they are
    assert.deepEqual(tabulate(root('[{"a.b": 1, "c\\\\d": {"e.f": 2}}]')).headers, ['a.b', 'c\\d.e.f']);
    // same depth, split differently
    assert.deepEqual(tabulate(root('[{"a.b": {"c": 1}}, {"a": {"b.c": 2}}]')).headers, ['a\\.b.c', 'a.b\\.c']);
    // 'json' flattening has no paths to confuse
    assert.deepEqual(tabulate(root('[{"a.b": 1, "a": {"b": 2}}]'), 'json').headers, ['a.b', 'a']);
    // key / value listing
    assert.deepEqual(tabulate(root('{"a.b": 1, "a": {"b": 2}, "c.d": 3}')), {
      headers: ['key', 'value'],
      rows: [
        ['a\\.b', 1],
        ['a.b', 2],
        ['c.d', 3],
      ],
    });
    assert.deepEqual(tabulate(root('{"a.b": 1, "x": {"y.z": 2}, "x.y": {"z": 3}}')).rows, [
      ['a.b', 1],
      ['x.y\\.z', 2],
      ['x\\.y.z', 3],
    ]);
    assert.deepEqual(tabulate(root('{"a.b": 1, "x": {"y": 2}, "a.b": 3}')).rows, [
      ['a.b', 1],
      ['x.y', 2],
      ['a.b', 3],
    ]);
  });

  test('the "key" and "value" columns it adds never take a name from the data', () => {
    assert.deepEqual(tabulate(root('[{"value": 1}, 2]')), { headers: ['value', '_value'], rows: [[1, null], [null, 2]] });
    assert.deepEqual(tabulate(root('[{"value": 1, "_value": 3}, 2]')).headers, ['value', '_value', '__value']);
    assert.deepEqual(tabulate(root('[{"value": 1}, 2]'), 'json').headers, ['value', '_value']);
    assert.deepEqual(tabulate(root('{"x": {"key": 1, "v": 2}, "y": {"v": 3}}')), {
      headers: ['_key', 'key', 'v'],
      rows: [
        ['x', 1, 2],
        ['y', null, 3],
      ],
    });
    assert.equal(toCsv(root('[{"value": 1}, 2]')), 'value,_value\r\n1,\r\n,2\r\n');
  });
});

describe('toCsv', () => {
  test('RFC 4180 quoting, CRLF, exact numbers, null vs empty string', () => {
    const csv = toCsv(root('[{"a": "x,y", "b": "say \\"hi\\"", "c": "multi\\nline", "d": 1.50, "e": null, "f": "", "g": 123456789012345678901}]'));
    assert.equal(csv, 'a,b,c,d,e,f,g\r\n"x,y","say ""hi""","multi\nline",1.50,,"",123456789012345678901\r\n');
  });

  test('text a spreadsheet would run as a formula gets a leading apostrophe; numbers stay numbers', () => {
    const csv = toCsv(root('[{"=k": "=HYPERLINK(\\"http://x.invalid\\",\\"click\\")", "a": "+1+1", "b": "-2+3", "c": "@SUM(A1)", "d": "\\t=1", "e": "\\r=1", "f": -5, "g": "-5", "h": "+1.5e3", "i": "a=b", "j": "-"}]'));
    assert.equal(csv, `'=k,a,b,c,d,e,f,g,h,i,j\r\n"'=HYPERLINK(""http://x.invalid"",""click"")",'+1+1,'-2+3,'@SUM(A1),'\t=1,"'\r=1",-5,-5,+1.5e3,a=b,'-\r\n`);
  });

  test('delimiters and BOM', () => {
    const r = root('[{"a": "1;2", "b": "t\\tab"}]');
    assert.equal(toCsv(r, { delimiter: ';' }), 'a;b\r\n"1;2";t\tab\r\n');
    assert.equal(toCsv(r, { delimiter: '\t', bom: true }), '\ufeffa\tb\r\n1;2\t"t\tab"\r\n');
  });

  test('records, objects, matrices, primitives and scalars', () => {
    const csv = (json: string) => toCsv(records(root(json)));
    assert.equal(
      csv('[{"id":1,"name":"Smith, J","q":"say \\"hi\\""},{"id":2,"tags":["a"],"name":null,"x":"l1\\nl2"}]'),
      'id,name,q,tags,x\r\n1,"Smith, J","say ""hi""",,\r\n2,,,a,"l1\nl2"\r\n',
    );
    assert.equal(csv('{"a":1,"b":{"c":true}}'), 'key,value\r\na,1\r\nb.c,true\r\n');
    assert.equal(csv('{"meta":{"n":2},"rows":[{"a":1},{"a":2,"b":[1,2]}]}'), 'a,b\r\n1,\r\n2,"1, 2"\r\n');
    assert.equal(csv('[[1,2],[3,4]]'), '1,2\r\n1,2\r\n3,4\r\n');
    assert.equal(csv('[1,"x"]'), 'value\r\n1\r\nx\r\n');
    assert.equal(csv('12345678901234567890'), 'value\r\n12345678901234567890\r\n');
  });

  test('round-trips through the CSV importer', () => {
    const src = '[{"id":1,"name":"Doe, \\"J\\"","note":"two\\nlines","ok":true,"n":null,"s":"","zip":"007","neg":-2.5}]';
    const back = conv(toCsv(root(src)), 'csv').value;
    assert.deepEqual(back, JSON.parse(src));
  });
});

// ── XLSX ─────────────────────────────────────────────────────────────────

describe('toXlsx', () => {
  test('package structure, typed cells, header style, frozen pane, autofilter, widths', async () => {
    const { parts, text, sheet, buf } = await xlsxParts(
      `[{"name": "Ada <&> \\"Lovelace\\"", "age": 36, "admin": true, "big": 12345678901234567890, "f": 1.5e3, "nested": {"x": " pad "}},
        {"name": "ctl\\u0001\\u0008x\\uffff", "age": -0.5, "admin": false, "big": 9007199254740993, "esc": "_x0041_", "nested": {"x": null}}]`,
      { sheetName: 'My: Data/2024?' },
    );
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(parts.has(n), n);
      wellFormed(text(n));
    }
    assert.equal([...parts.keys()][0], '[Content_Types].xml');
    assert.equal(parts.get('xl/worksheets/sheet1.xml')?.method, 8, 'worksheet is deflated');
    assert.match(text('xl/workbook.xml'), /<sheet name="My  Data 2024" sheetId="1" r:id="rId1"\/>/);
    assert.match(text('xl/workbook.xml'), /_xlnm\._FilterDatabase.*'My  Data 2024'!\$A\$1:\$G\$3/);
    assert.match(text('xl/styles.xml'), /<font><b\/>/);
    // header: bold inline strings
    assert.match(sheet, /<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>name<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="F1" t="inlineStr" s="1"><is><t>nested\.x<\/t><\/is><\/c>/);
    assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(sheet, /<autoFilter ref="A1:G3"\/>/);
    assert.match(sheet, /<dimension ref="A1:G3"\/>/);
    assert.match(sheet, /<col min="1" max="1" width="[\d.]+" customWidth="1"\/>/);
    // typed cells
    assert.match(sheet, /<c r="A2" t="inlineStr"><is><t>Ada &lt;&amp;&gt; "Lovelace"<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="B2"><v>36<\/v><\/c>/);
    assert.match(sheet, /<c r="C2" t="b"><v>1<\/v><\/c>/);
    assert.match(sheet, /<c r="D2" t="inlineStr"><is><t>12345678901234567890<\/t><\/is><\/c>/, '> 15 digits → text');
    assert.match(sheet, /<c r="E2"><v>1\.5e3<\/v><\/c>/);
    assert.match(sheet, /<c r="F2" t="inlineStr"><is><t xml:space="preserve"> pad <\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="A3" t="inlineStr"><is><t>ctlx<\/t><\/is><\/c>/, 'illegal XML chars stripped');
    assert.match(sheet, /<c r="B3"><v>-0\.5<\/v><\/c>/);
    assert.match(sheet, /<c r="C3" t="b"><v>0<\/v><\/c>/);
    assert.match(sheet, /<c r="D3" t="inlineStr"><is><t>9007199254740993<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="G3" t="inlineStr"><is><t>_x005F_x0041_<\/t><\/is><\/c>/, "Excel's _xHHHH_ escape protected");
    assert.doesNotMatch(sheet, /r="F3"/, 'null → no cell');
    if (hasPython) {
      const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
      try {
        const f = join(dir, 'out.xlsx');
        writeFileSync(f, buf);
        const r = spawnSync('python3', ['-I', '-c', PY, f], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), '6');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('numbers Excel cannot hold exactly are written as text', async () => {
    const numbers = ['0.123456789012345678901', '3.14159265358979323846', '0.10000000000000001', '1e-999', '1e999', '-1e-400', '1e308', '-1e-308', '10000000000000001e-1'];
    const kept = ['1.5e3', '0.1', '123456789012345', '1.23456789012345', '1.234567890123456', '0.30000000000000004', '123456789012345.5', '-0.000012345678901234', '9.99999999999999e307', '2.2251e-308', '-2.5e-300', '0', '-0', '0.000', '0e999', '1.50', '1.00000000000000000000'];
    const rows = [...numbers, ...kept].map((n) => `{"n": ${n}}`).join(',');
    const { sheet } = await xlsxParts(`[${rows}]`);
    numbers.forEach((n, i) => assert.match(sheet, new RegExp(`<c r="A${i + 2}" t="inlineStr"><is><t>${n.replace(/[.+]/g, '\\$&')}</t>`), n));
    kept.forEach((n, i) => assert.match(sheet, new RegExp(`<c r="A${numbers.length + i + 2}"><v>${n.replace(/[.+]/g, '\\$&')}</v>`), n));
  });

  test('empty and scalar inputs still produce valid workbooks', async () => {
    const e = await xlsxParts('[]');
    assert.match(e.sheet, /<dimension ref="A1"\/>.*<sheetData><\/sheetData><\/worksheet>$/s);
    assert.doesNotMatch(e.sheet, /autoFilter|pane/);
    assert.doesNotMatch(e.text('xl/workbook.xml'), /definedName/);
    const s = await xlsxParts('42');
    assert.match(s.sheet, /<c r="A2"><v>42<\/v><\/c>/);
  });

  test('wide sheets get correct column letters and long strings are capped', async () => {
    const obj: Record<string, string> = {};
    for (let k = 0; k < 30; k++) obj['k' + k] = 'v';
    obj.long = 'x'.repeat(40000);
    const { sheet } = await xlsxParts(JSON.stringify([obj]));
    assert.match(sheet, /<c r="Z1" t="inlineStr" s="1"><is><t>k25<\/t>/);
    assert.match(sheet, /<c r="AD1" t="inlineStr" s="1"><is><t>k29<\/t>/);
    assert.match(sheet, /<c r="AE2" t="inlineStr"><is><t>x{32767}<\/t>/);
    assert.match(sheet, /<col min="31" max="31" width="60\.0" customWidth="1"\/>/);
  });

  test('falls back to STORE without CompressionStream', async () => {
    const g = globalThis as { CompressionStream?: unknown };
    const saved = g.CompressionStream;
    g.CompressionStream = undefined;
    try {
      const { parts } = await xlsxParts('[{"a": 1}]');
      for (const e of parts.values()) assert.equal(e.method, 0);
    } finally {
      g.CompressionStream = saved;
    }
  });

  test('random documents always yield a valid package', async () => {
    const r = prng(7);
    for (let k = 0; k < 60; k++) {
      const json = '[' + Array.from({ length: 1 + r.int(4) }, () => randomJson(r)).join(',') + ']';
      const { parts, text } = await xlsxParts(r.next() < 0.5 ? json : randomJson(r), { flatten: r.next() < 0.5 ? 'dot' : 'json', sheetName: r.pick(NASTY) });
      for (const n of parts.keys()) wellFormed(text(n));
    }
  });

  // 10k rows by default; the full 100k with `pnpm test --slow` (about ten times as long).
  const N = process.env.TEST_SLOW ? 100_000 : 10_000;
  test(`${N / 1000}k rows × 20 columns in a couple of seconds`, async () => {
    const rows: string[] = [];
    for (let r = 0; r < N; r++) {
      let s = '{';
      for (let c = 0; c < 20; c++) s += (c ? ',' : '') + `"col${c}":` + (c % 4 === 0 ? r * c : c % 4 === 1 ? `"name ${r}-${c}"` : c % 4 === 2 ? (r % 2 ? 'true' : 'null') : r / 7);
      rows.push(s + '}');
    }
    const r = root('[' + rows.join(',') + ']');
    const t0 = cpuNow();
    const blob = await toXlsx(r);
    const ms = cpuNow() - t0;
    const parts = unzip(Buffer.from(await blob.arrayBuffer()));
    const sheet = parts.get('xl/worksheets/sheet1.xml')?.data.toString('utf8') ?? '';
    assert.match(sheet, new RegExp(`<autoFilter ref="A1:T${N + 1}"/>`));
    assert.match(sheet, new RegExp(`<row r="${N + 1}">`));
    console.log(`  toXlsx ${N / 1000}k×20: ${ms.toFixed(0)} ms CPU, ${(blob.size / 1e6).toFixed(1)} MB zipped, ${(sheet.length / 1e6).toFixed(0)} MB sheet XML`);
    assert.ok(ms < N / 5, `took ${ms.toFixed(0)} ms of CPU time`); // generous; typically ~1-3 s for 100k
    const t1 = performance.now();
    const csv = toCsv(r);
    console.log(`  toCsv ${N / 1000}k×20: ${(performance.now() - t1).toFixed(0)} ms`);
    const t2 = performance.now();
    const back = importToJson(csv, 'csv', '');
    console.log(`  CSV→JSON ${N / 1000}k×20: ${(performance.now() - t2).toFixed(0)} ms`);
    assert.ok('json' in back);
  });
});

// ── detection ────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  const cases: [string, string | undefined, string][] = [
    ['{"a": 1}', undefined, 'json'],
    ['[1, 2]', undefined, 'json'],
    ['[{"a": 1}]', undefined, 'json'],
    ['["a"]\n', undefined, 'json'],
    ['  42', undefined, 'json'],
    ['// c\n{}', undefined, 'json'],
    ['[package]\nname = "x"', undefined, 'toml'],
    ['# cfg\ntitle = "TOML"\n[owner]\n', undefined, 'toml'],
    ['<?xml version="1.0"?><a/>', undefined, 'xml'],
    ['\ufeff<rss></rss>', undefined, 'xml'],
    ['---\na: 1', undefined, 'yaml'],
    ['apiVersion: v1\nkind: Pod', undefined, 'yaml'],
    ['# comment\n- a\n- b', undefined, 'yaml'],
    ['"key": value', undefined, 'yaml'],
    ['id,name\n1,Ada\n2,"B, b"', undefined, 'csv'],
    ['a;b;c\n1;2;3', undefined, 'csv'],
    ['a|b\n1|2', undefined, 'csv'],
    ['a\tb\n1\t2', undefined, 'tsv'],
    ['hello world', undefined, 'unknown'],
    ['', undefined, 'unknown'],
    ['a: 1', 'data.csv', 'csv'],
    ['x', 'config.YML', 'yaml'],
    ['x', 'feed.rss', 'xml'],
    ['x', '/repo/Cargo.lock', 'toml'],
    ['{"a":1}', 'notes.txt', 'json'],
  ];
  for (const [text, name, want] of cases) test(`${JSON.stringify(text.slice(0, 24))} ${name ?? ''} → ${want}`, () => assert.equal(detectFormat(text, name), want));
});

// ── CSV / TSV import ─────────────────────────────────────────────────────

describe('CSV import', () => {
  test('quotes, escaped quotes, embedded newlines, semicolon auto-detection', () => {
    assert.deepEqual(val('name;age;city\n"Doe; John";42;"New\nYork"\nAnn;-3.5;\n', 'csv'), [
      { name: 'Doe; John', age: 42, city: 'New\nYork' },
      { name: 'Ann', age: -3.5, city: null },
    ]);
    assert.deepEqual(val('a,b\r\n1,"x""y"\r\n\r\n2,"line1\r\nline2"\r\n', 'csv'), [
      { a: 1, b: 'x"y' },
      { a: 2, b: 'line1\r\nline2' },
    ]);
  });

  test('type inference keeps identifiers as strings and exact digits', () => {
    const { text, value } = conv('id,zip,card,neg,dec,flag,no,empty,qempty,str,exp,plus\n1,007,4111111111111111,-12,0.50,TRUE,false,,"",hello,1e3,+5\n', 'csv');
    assert.deepEqual(value, [{ id: 1, zip: '007', card: '4111111111111111', neg: -12, dec: 0.5, flag: true, no: false, empty: null, qempty: '', str: 'hello', exp: 1000, plus: '+5' }]);
    assert.match(text, /"dec":0\.50,/);
    assert.match(text, /"exp":1e3,/);
  });

  test('quoted numbers stay strings unless every field is quoted', () => {
    assert.deepEqual(val('a,b\n"1",2\n', 'csv'), [{ a: '1', b: 2 }]);
    assert.deepEqual(val('"a","b"\n"1","x"\n"2",""\n', 'csv'), [
      { a: 1, b: 'x' },
      { a: 2, b: '' },
    ]);
  });

  test('headers: duplicates, blanks, trimming, ragged rows, sep= hint, BOM, pipes', () => {
    assert.deepEqual(val('a, a ,,b\n1,2,3,4,5\n6\n', 'csv'), [
      { a: 1, a_2: 2, column_3: 3, b: 4, column_5: 5 },
      { a: 6, a_2: null, column_3: null, b: null, column_5: null },
    ]);
    assert.deepEqual(val('sep=;\na;b\n1,5;2\n', 'csv'), [{ a: '1,5', b: 2 }]);
    assert.deepEqual(val('\ufeffx|y\n1|2', 'csv'), [{ x: 1, y: 2 }]);
    assert.deepEqual(val('only,header\n', 'csv'), []);
    assert.deepEqual(val('', 'csv'), []);
  });

  test('TSV', () => {
    assert.deepEqual(val('name\tnote\nAda\t"a, b"\nBob\tx\n', 'tsv'), [
      { name: 'Ada', note: 'a, b' },
      { name: 'Bob', note: 'x' },
    ]);
  });

  test('indent option', () => {
    assert.equal(conv('a,b\n1,x\n', 'csv', '  ').text, '[\n  {\n    "a": 1,\n    "b": "x"\n  }\n]');
  });

  test('unterminated quote reports line and column', () => {
    assert.deepEqual(err('a,b\n1,"oops\n2,3', 'csv'), { error: 'Unterminated quoted field: missing closing "', line: 2, col: 3 });
  });

  test('options: a separator chosen wins over detection, rows as arrays without a header, every value a string untyped', () => {
    const json = (text: string, o: CsvOptions) => {
      const r = importToJson(text, 'csv', '', o);
      if ('error' in r) return assert.fail(r.error);
      return JSON.parse(r.json) as unknown;
    };
    const text = 'a;b;c\n1;2,5;3\n';
    assert.deepEqual(json(text, {}), [{ a: 1, b: '2,5', c: 3 }]);
    assert.deepEqual(json(text, { delimiter: ',' }), [{ 'a;b;c': '1;2', column_2: '5;3' }]);
    assert.deepEqual(json('sep=;\na,b\n1,2\n', { delimiter: ',' }), [{ a: 1, b: 2 }], 'the sep= line is the file\'s, not data');
    assert.deepEqual(json('id,ok,none\n007,true,\n', { header: false }), [['id', 'ok', 'none'], ['007', true, null]]);
    // A file that quotes every field (Excel's) still gets its numbers and booleans, with or without a header row.
    assert.deepEqual(json('"id","n"\n"1","true"\n', {}), [{ id: 1, n: true }]);
    assert.deepEqual(json('"id","n"\n"1","true"\n', { header: false }), [['id', 'n'], [1, true]]);
    assert.deepEqual(json('"id","n"\n"1","true"\n', { header: false, types: false }), [['id', 'n'], ['1', 'true']]);
    assert.deepEqual(json('id,ok,none,q\n7,true,,""\n8\n', { types: false }), [{ id: '7', ok: 'true', none: '', q: '' }, { id: '8', ok: '', none: '', q: '' }]);
    assert.deepEqual(json('a\tb\n1\t2\n', { delimiter: '\t', header: false, types: false }), [['a', 'b'], ['1', '2']]);
    const r = importToJson('a,b\n1,2\n', 'csv', '  ', { header: false });
    assert.ok('json' in r);
    assert.equal(r.json, '[\n  [\n    "a",\n    "b"\n  ],\n  [\n    1,\n    2\n  ]\n]');
  });

  test('sniffDelimiter: the sep= line, else the most consistent separator', () => {
    assert.equal(sniffDelimiter('sep=|\na,b\n'), '|');
    assert.equal(sniffDelimiter('a;b;c\n1;2;3\n'), ';');
    assert.equal(sniffDelimiter('\ufeffa\tb\n1\t2\n'), '\t');
    assert.equal(sniffDelimiter('one column\n'), ',');
  });
});

describe('import errors', () => {
  test('say where they are as an offset into the text given, a BOM included', () => {
    for (const [text, fmt] of [
      ['a,b\n1,"oops\n2,3', 'csv'],
      ['a: 1\nb: [1, 2\n', 'yaml'],
      ['\ufeffa: 1\n  b: 2\n c: 3\n', 'yaml'],
      ['<a><b></a>', 'xml'],
      ['x = 1\nx = 2\n', 'toml'],
    ] as const) {
      const r = importToJson(text, fmt, '');
      assert.ok('error' in r && r.p !== undefined && r.line !== undefined && r.col !== undefined, `${fmt}: ${JSON.stringify(text)}`);
      const lines = text.slice(0, r.p).split('\n');
      assert.deepEqual([lines.length, lines[lines.length - 1].replace(/^\ufeff/, '').length + 1], [r.line, r.col], `${fmt}: ${JSON.stringify(text)}`);
    }
  });
});

// ── YAML import ──────────────────────────────────────────────────────────

const K8S = `# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels: {app: web, tier: "frontend"}
  annotations:
    description: >-
      A long
      description
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: nginx
        image: "nginx:1.25"
        ports:
        - containerPort: 80
          protocol: TCP
        env:
          - name: MODE
            value: 'production'
          - name: EMPTY
            value:
        args: ["--port", "80"]
        command:
          - /bin/sh
          - -c
          - |
            echo hello
            exec nginx
---
apiVersion: v1
kind: Service
metadata: {name: web}
spec:
  ports: [{port: 80, targetPort: 8080}]
...
`;

const COMPOSE = `version: "3.8"
x-common: &common
  restart: unless-stopped
  environment:
    TZ: UTC
services:
  web:
    <<: *common
    image: nginx
    ports:
      - "8080:80"
      - 443:443
    restart: always
  db:
    <<: *common
    image: postgres:16
    volumes: [db:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
volumes:
  db:
`;

describe('YAML import', () => {
  test('Kubernetes multi-document manifest', () => {
    assert.deepEqual(val(K8S, 'yaml'), [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'web', labels: { app: 'web', tier: 'frontend' }, annotations: { description: 'A long description' } },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'web' } },
          template: {
            metadata: { labels: { app: 'web' } },
            spec: {
              containers: [
                {
                  name: 'nginx',
                  image: 'nginx:1.25',
                  ports: [{ containerPort: 80, protocol: 'TCP' }],
                  env: [
                    { name: 'MODE', value: 'production' },
                    { name: 'EMPTY', value: null },
                  ],
                  args: ['--port', '80'],
                  command: ['/bin/sh', '-c', 'echo hello\nexec nginx\n'],
                },
              ],
            },
          },
        },
      },
      { apiVersion: 'v1', kind: 'Service', metadata: { name: 'web' }, spec: { ports: [{ port: 80, targetPort: 8080 }] } },
    ]);
  });

  test('docker-compose with anchors and merge keys', () => {
    const v = val(COMPOSE, 'yaml') as { services: { web: object; db: object } };
    assert.deepEqual(v, {
      version: '3.8',
      'x-common': { restart: 'unless-stopped', environment: { TZ: 'UTC' } },
      services: {
        web: { restart: 'always', environment: { TZ: 'UTC' }, image: 'nginx', ports: ['8080:80', '443:443'] },
        db: {
          restart: 'unless-stopped',
          environment: { TZ: 'UTC' },
          image: 'postgres:16',
          volumes: ['db:/var/lib/postgresql/data'],
          healthcheck: { test: ['CMD', 'pg_isready'], interval: '10s' },
        },
      },
      volumes: { db: null },
    });
    assert.deepEqual(Object.keys(v.services.web), ['restart', 'environment', 'image', 'ports']);
    assert.deepEqual(val('a: &a {x: 1}\nb: &b {x: 2, y: 2}\nc:\n  <<: [*a, *b]\n  z: 3\n', 'yaml'), {
      a: { x: 1 },
      b: { x: 2, y: 2 },
      c: { x: 1, y: 2, z: 3 },
    });
  });

  test('merge keys in flow mappings', () => {
    assert.equal(conv('default: &a {x: 1, y: 2}\nresult: {<<: *a, x: 3}\n', 'yaml').text, '{"default":{"x":1,"y":2},"result":{"x":3,"y":2}}');
    assert.deepEqual(val('a: &a {x: 1}\nb: &b {x: 2, y: 2}\nc: {z: 3, <<: [*a, *b]}\nd: {"<<": 1}\n', 'yaml'), {
      a: { x: 1 },
      b: { x: 2, y: 2 },
      c: { z: 3, x: 1, y: 2 },
      d: { '<<': 1 },
    });
    assert.match(err('a: {<<: 1}', 'yaml').error, /merge key/);
    assert.match(err('a: &a {x: 1}\nb: {x: 2, x: 3, <<: *a}', 'yaml').error, /Duplicate key "x"/);
  });

  test('YAML 1.2 core schema scalars, exact big integers', () => {
    const src = String.raw`n1: ~
n2: null
n3:
b1: true
b2: False
s1: yes
s2: on
i1: 42
i2: -17
i3: 0x1F
i4: 0o17
i5: 007
i6: 12345678901234567890123
f1: 3.14
f2: .5
f3: +1e3
f4: -.inf
f5: .NaN
s3: 1.2.3
s4: '0x1F'
s5: !!str 123
d1: 2024-01-01
q1: "tab\there \u00e9 \x41 \U0001F600 \"q\" \\"
q2: 'it''s'
q3: "line1
  line2

  line3"
q4: "joined\
   here"
url: http://example.com:8080/path
win: C:\path
time: 12:30:45
hash: a#b # real comment
'quoted key': 1
"200": ok
404: missing
`;
    const { text, value } = conv(src, 'yaml');
    assert.deepEqual(value, {
      n1: null, n2: null, n3: null, b1: true, b2: false, s1: 'yes', s2: 'on',
      i1: 42, i2: -17, i3: 31, i4: 15, i5: '007', i6: 12345678901234567890123,
      f1: 3.14, f2: 0.5, f3: 1000, f4: null, f5: null, s3: '1.2.3', s4: '0x1F', s5: '123', d1: '2024-01-01',
      q1: 'tab\there \u00e9 A \u{1F600} "q" \\', q2: "it's", q3: 'line1 line2\nline3', q4: 'joinedhere',
      url: 'http://example.com:8080/path', win: 'C:\\path', time: '12:30:45', hash: 'a#b', 'quoted key': 1, '200': 'ok', '404': 'missing',
    });
    assert.match(text, /"i6":12345678901234567890123,/);
    assert.match(text, /"f2":0\.5,"f3":1e3,/);
  });

  test('any JSON document is valid YAML (flow style) with the same value', () => {
    const r = prng(11);
    for (let k = 0; k < 400; k++) {
      const json = randomJson(r);
      const pretty = r.next() < 0.5 ? JSON.stringify(JSON.parse(json), null, 2) : json;
      const { text } = conv(pretty, 'yaml');
      assert.deepEqual(JSON.parse(text), JSON.parse(json), pretty);
      if (pretty.includes('12345678901234567890')) assert.ok(text.includes('12345678901234567890'), 'big int kept exactly');
    }
  });

  test('block scalars with chomping and indentation indicators', () => {
    const src = 'a: |\n  line1\n   indented\n\n  line3\nb: >\n  folded\n  text\n\n  para\n  \n    more\n  back\nc: |-\n  strip\n\nd: >+\n  keep\n\ne: |2\n    two extra\nf: >\n\n  leading blank\ng: |\nh: last\n';
    assert.deepEqual(val(src, 'yaml'), {
      a: 'line1\n indented\n\nline3\n',
      b: 'folded text\npara\n\n  more\nback\n',
      c: 'strip',
      d: 'keep\n\n',
      e: '  two extra\n',
      f: '\nleading blank\n',
      g: '',
      h: 'last',
    });
  });

  test('flow collections, plain multi-line scalars, comments, nested sequences', () => {
    const src = `# top
list: [a, 'b c', "d", {e: 1, "f": [2, 3]}, [x, y], k: v, ]
map: { a: 1, b: , c }
json: {"x":1,"y":[true,null]}
multi: this is
  a folded
  plain scalar   # comment
seqs:
- - a
  - b
- - c
-
  key: v
- last
`;
    assert.match(err('? complex\n: key\n', 'yaml').error, /Complex mapping keys/);
    assert.deepEqual(val(src, 'yaml'), {
      list: ['a', 'b c', 'd', { e: 1, f: [2, 3] }, ['x', 'y'], { k: 'v' }],
      map: { a: 1, b: null, c: null },
      json: { x: 1, y: [true, null] },
      multi: 'this is a folded plain scalar',
      seqs: [['a', 'b'], ['c'], { key: 'v' }, 'last'],
    });
  });

  test('documents, directives, empty input, CRLF, tags', () => {
    assert.equal(conv('', 'yaml').text, 'null');
    assert.equal(conv('# only a comment\n', 'yaml').text, 'null');
    assert.deepEqual(val('%YAML 1.2\n---\na: 1\n...\n---\n- 2\n', 'yaml'), [{ a: 1 }, [2]]);
    assert.deepEqual(val('--- text\n', 'yaml'), 'text');
    assert.deepEqual(val('a: 1\r\nb:\r\n  - x\r\n', 'yaml'), { a: 1, b: ['x'] });
    assert.deepEqual(val('Resources:\n  B:\n    Type: !Ref Bucket\n    Arn: !GetAtt [B, Arn]\n', 'yaml'), { Resources: { B: { Type: 'Bucket', Arn: ['B', 'Arn'] } } });
    assert.deepEqual(val('- &x 1\n- *x\n- &obj\n  a: 1\n- *obj\n', 'yaml'), [1, 1, { a: 1 }, { a: 1 }]);
    // anchors belong to their document
    assert.deepEqual(val('---\na: &x 1\nb: *x\n---\nc: &x 2\nd: *x\n', 'yaml'), [{ a: 1, b: 1 }, { c: 2, d: 2 }]);
  });

  test('aliases that repeat too much data fail at once instead of hanging', () => {
    // each level refers to the previous one twice: 2^40 copies of [x, y]
    let bomb = 'a0: &a0 [x, y]\n';
    for (let i = 1; i <= 40; i++) bomb += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
    const t0 = performance.now();
    const e = err(bomb, 'yaml');
    assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
    assert.equal(e.error, 'YAML aliases repeat too much data: the result would be too large');
    assert.ok(e.line! > 1 && e.line! <= 41, `at line ${e.line}`);
    // one long string repeated
    const big = 'x'.repeat(1e6);
    assert.match(err(`s: &s ${big}\nl: [${'*s, '.repeat(20)}*s]\n`, 'yaml').error, /aliases repeat too much data/);
    // ordinary reuse converts, also many times over
    let ok = 'defaults: &d {image: node, retries: 2, tags: [a, b]}\n';
    for (let i = 0; i < 2000; i++) ok += `job${i}:\n  <<: *d\n  name: j${i}\n  base: *d\n`;
    const v = val(ok, 'yaml') as Record<string, { image: string; base: { retries: number } }>;
    assert.equal(v.job1999.image, 'node');
    assert.equal(v.job1999.base.retries, 2);
  });

  test('errors carry line and column', () => {
    const cases: [string, RegExp, number, number][] = [
      ['a: 1\n  b: 2\n', /Bad indentation of a mapping entry/, 2, 3],
      ['a:\n\tb: 1\n', /Tabs are not allowed/, 2, 2],
      ['a: *nope\n', /Unknown alias \*nope/, 1, 4],
      ['---\na: &x 1\n---\nb: *x\n', /Unknown alias \*x/, 4, 4],
      ['a: &x 1\n...\nb: [*x]\n', /Unknown alias \*x/, 3, 5],
      ['a: 1\nb: 2\na: 3\n', /Duplicate key "a"/, 3, 1],
      ['a: "unterminated\n', /Unterminated quoted string/, 1, 4],
      ['a: b: c\n', /Mapping values are not allowed here/, 1, 5],
      ['key: [a, b\n', /Unterminated flow sequence/, 1, 6],
      ['a: - b\n', /sequence cannot start on the same line/, 1, 4],
      ['a:\n  - x\n - y\n', /Bad indentation/, 3, 2],
      ['a: "x" y\n', /Unexpected content after the value/, 1, 8],
      ['a: "\\q"\n', /Invalid escape sequence \\q/, 1, 5],
      ['a: @x\n', /cannot start with '@'/, 1, 4],
      ['a: |x\n', /Invalid block scalar header/, 1, 5],
      ['- a\nb: 1\n', /Unexpected content after the document/, 2, 1],
    ];
    for (const [src, re, line, col] of cases) {
      const e = err(src, 'yaml');
      assert.match(e.error, re, src);
      assert.deepEqual([e.line, e.col], [line, col], `${JSON.stringify(src)}: ${e.error}`);
    }
  });
});

// ── XML import ───────────────────────────────────────────────────────────

describe('XML import', () => {
  test('pom.xml-like document: attributes, repeated elements, CDATA, entities, namespaces', () => {
    const src = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE project [ <!ENTITY x "y"> <!-- ] > --> ]>
<!-- comment -->
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <name>Tom &amp; Jerry &lt;3 &#169; &#x1F600; &unknown;</name>
  <description><![CDATA[<b>raw</b> & stuff]]></description>
  <dependencies>
    <dependency scope="test">
      <groupId>junit</groupId>
      <version>4.13.2</version>
    </dependency>
    <dependency>
      <groupId>org.slf4j</groupId>
      <optional/>
    </dependency>
  </dependencies>
  <xsi:note lang='en' title="a&quot;b
c">hello</xsi:note>
  <mixed>text <b>bold</b> tail</mixed>
  <?pi ignored?>
</project>
`;
    assert.deepEqual(val(src, 'xml'), {
      project: {
        '@xmlns': 'http://maven.apache.org/POM/4.0.0',
        '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        modelVersion: '4.0.0',
        name: 'Tom & Jerry <3 \u00a9 \u{1F600} &unknown;',
        description: '<b>raw</b> & stuff',
        dependencies: {
          dependency: [
            { '@scope': 'test', groupId: 'junit', version: '4.13.2' },
            { groupId: 'org.slf4j', optional: null },
          ],
        },
        'xsi:note': { '@lang': 'en', '@title': 'a"b c', '#text': 'hello' },
        mixed: { b: 'bold', '#text': 'text  tail' },
      },
    });
  });

  test('packages.config-style lockfile and RSS', () => {
    assert.deepEqual(
      val('<packages>\n  <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net48" />\n  <package id="NUnit" version="3.13.3" />\n</packages>', 'xml'),
      {
        packages: {
          package: [
            { '@id': 'Newtonsoft.Json', '@version': '13.0.3', '@targetFramework': 'net48' },
            { '@id': 'NUnit', '@version': '3.13.3' },
          ],
        },
      },
    );
    const rss = val('<rss version="2.0"><channel><title>T</title><item><title>A</title></item><item><title>B</title></item><item><title>C</title></item></channel></rss>', 'xml');
    assert.deepEqual(rss, { rss: { '@version': '2.0', channel: { title: 'T', item: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] } } });
    assert.equal(conv('<a><b>1</b></a>', 'xml', '  ').text, '{\n  "a": {\n    "b": "1"\n  }\n}');
  });

  test('errors carry line and column', () => {
    const cases: [string, RegExp, number, number][] = [
      ['<a>\n  <b></a>', /Mismatched closing tag <\/a>: expected <\/b>/, 2, 6],
      ['<a>\n<b>', /Unclosed element <b>/, 2, 1],
      ['<a/>\n<b/>', /Only one root element/, 2, 1],
      ['<a x=1/>', /Attribute values must be quoted/, 1, 6],
      ['<a x="1" x="2"/>', /Duplicate attribute x/, 1, 10],
      ['text <a/>', /before the root element/, 1, 1],
      ['<a/> tail', /after the root element/, 1, 6],
      ['<a>1 < 2</a>', /Invalid character after '<'/, 1, 6],
      ['<a><!-- x</a>', /Unterminated comment/, 1, 4],
      ['</a>', /Unexpected closing tag/, 1, 1],
      ['', /No root element/, 1, 1],
    ];
    for (const [src, re, line, col] of cases) {
      const e = err(src, 'xml');
      assert.match(e.error, re, src);
      assert.deepEqual([e.line, e.col], [line, col], `${JSON.stringify(src)}: ${e.error}`);
    }
  });

  test('deep nesting: converts thousands of levels, fails cleanly beyond the stack', () => {
    const deep = (d: number) => '<a>'.repeat(d) + 'x' + '</a>'.repeat(d);
    assert.ok(conv(deep(2000), 'xml').text.startsWith('{"a":{"a":'));
    assert.deepEqual(err(deep(200000), 'xml'), { error: 'Nesting is too deep to convert' });
  });
});

// ── TOML import ──────────────────────────────────────────────────────────

describe('TOML import', () => {
  test('Cargo.toml', () => {
    const src = `[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"
authors = ["A <a@x.com>", 'B']
description = """
A multi-line \\
  description."""

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"], optional = true }
regex = "1.10"

[dev-dependencies.criterion]
version = "0.5"

[[bin]]
name = "a"
path = "src/a.rs"

[[bin]]
name = "b"

[profile.release]
lto = true
opt-level = 3
`;
    assert.deepEqual(val(src, 'toml'), {
      package: { name: 'my-crate', version: '0.1.0', edition: '2021', authors: ['A <a@x.com>', 'B'], description: 'A multi-line description.' },
      dependencies: {
        serde: { version: '1.0', features: ['derive'] },
        tokio: { version: '1', features: ['full'], optional: true },
        regex: '1.10',
      },
      'dev-dependencies': { criterion: { version: '0.5' } },
      bin: [{ name: 'a', path: 'src/a.rs' }, { name: 'b' }],
      profile: { release: { lto: true, 'opt-level': 3 } },
    });
  });

  test('TOML 1.0 value types', () => {
    const src = String.raw`int1 = +99
int2 = 1_000
hex = 0xDEAD_BEEF
oct = 0o755
bin = 0b1101
big = 9223372036854775807
flt = 6.626e-34
flt2 = -0.01
flt3 = 224_617.445_991
flt4 = 3.0
inf1 = inf
nan1 = -nan
odt = 1979-05-27T07:32:00Z
odt2 = 1979-05-27 07:32:00.999-07:00
ldt = 1979-05-27t07:32:00
ld = 1979-05-27
lt = 07:32:00
str1 = "tab\tand \u00e9 \U0001F600 \"q\""
lit = 'C:\Users\path'
ml_lit = '''
raw \n text'''
ml_quotes = """a "quoted" word"""""
a.b.c = 1
a . d = 2
"quoted key" = true
'' = "empty key"
points = [ { x = 1, y = 2 }, { x = 3, y = 4 } ]
nested = [[1, 2], ["a", "b"]]
multi = [
  1, # comment
  2,
]
`;
    const { text, value } = conv(src, 'toml');
    assert.deepEqual(value, {
      int1: 99, int2: 1000, hex: 3735928559, oct: 493, bin: 13, big: 9223372036854775807,
      flt: 6.626e-34, flt2: -0.01, flt3: 224617.445991, flt4: 3, inf1: null, nan1: null,
      odt: '1979-05-27T07:32:00Z', odt2: '1979-05-27T07:32:00.999-07:00', ldt: '1979-05-27T07:32:00', ld: '1979-05-27', lt: '07:32:00',
      str1: 'tab\tand \u00e9 \u{1F600} "q"', lit: 'C:\\Users\\path', ml_lit: 'raw \\n text', ml_quotes: 'a "quoted" word""',
      a: { b: { c: 1 }, d: 2 }, 'quoted key': true, '': 'empty key',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], nested: [[1, 2], ['a', 'b']], multi: [1, 2],
    });
    assert.match(text, /"big":9223372036854775807,/);
    assert.match(text, /"flt4":3\.0,/);
  });

  test('table rules: implicit super-tables, sub-tables of dotted keys, arrays of tables with sub-tables', () => {
    assert.deepEqual(val('[x.y.z]\na = 1\n[x]\nb = 2\n', 'toml'), { x: { y: { z: { a: 1 } }, b: 2 } });
    assert.deepEqual(val('[fruit]\napple.color = "red"\n[fruit.apple.texture]\nsmooth = true\n', 'toml'), {
      fruit: { apple: { color: 'red', texture: { smooth: true } } },
    });
    assert.deepEqual(val('[[fruits]]\nname = "apple"\n[fruits.physical]\ncolor = "red"\n[[fruits.varieties]]\nname = "x"\n[[fruits]]\nname = "banana"\n', 'toml'), {
      fruits: [{ name: 'apple', physical: { color: 'red' }, varieties: [{ name: 'x' }] }, { name: 'banana' }],
    });
  });

  test('errors carry line and column', () => {
    const cases: [string, RegExp, number, number][] = [
      ['a = 1\na = 2\n', /Duplicate key "a"/, 2, 1],
      ['[t]\nx = 1\n[t]\n', /Table \[t\] is defined more than once/, 3, 1],
      ['name = hello\n', /Invalid value 'hello': strings must be quoted/, 1, 8],
      ['s = "open\n', /Unterminated string/, 1, 5],
      ['a = 1 b = 2\n', /expected a new line after the value/, 1, 7],
      ['a = { b = 1 }\n[a]\n', /defined more than once/, 2, 1],
      ['a = [1]\n[[a]]\n', /not an array of tables/, 2, 1],
      ['[fruit]\napple.color = "red"\n[fruit.apple]\n', /defined more than once/, 3, 1],
      ['a = 1\na.b = 2\n', /Cannot add keys to "a"/, 2, 1],
      ['n = 012\n', /Invalid number '012'/, 1, 5],
      ['s = "\\q"\n', /Invalid escape sequence \\q/, 1, 6],
      ['arr = [1, 2\n', /Expected ',' or '\]' in array/, 2, 1],
      ['= 1\n', /Expected a key|Invalid character/, 1, 1],
      ['a =\n', /Expected a value/, 1, 4],
    ];
    for (const [src, re, line, col] of cases) {
      const e = err(src, 'toml');
      assert.match(e.error, re, src);
      assert.deepEqual([e.line, e.col], [line, col], `${JSON.stringify(src)}: ${e.error}`);
    }
  });
});

// ── Audit regressions (CSV / Excel export) ───────────────────────────────

describe('spreadsheet export audit', () => {
  test('CSV: a one-column row with nothing in it is "", so readers keep it', () => {
    // CSV readers (this importer, Python's csv.DictReader, pandas) skip a blank line: [1,null,3] read back as two rows.
    const csv = toCsv(root('[1,null,3]'));
    assert.equal(csv, 'value\r\n1\r\n""\r\n3\r\n');
    // (CSV has no null: it reads back as an empty string)
    assert.deepEqual(val(csv, 'csv'), [{ value: 1 }, { value: '' }, { value: 3 }]);
    assert.equal(toCsv(root('[{"":1},{"":null}]')), '""\r\n1\r\n""\r\n');
    // rows with a delimiter are never blank: empty fields stay empty (null)
    assert.equal(toCsv(root('[{"a":null,"b":null}]')), 'a,b\r\n,\r\n');
    assert.deepEqual(val(toCsv(root('[{"a":null,"b":null}]')), 'csv'), [{ a: null, b: null }]);
  });
});
