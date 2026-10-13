import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { JNode, NUM, STR, parse } from '../lib/json/parser';
import {
  decodeJwt,
  embeddedJson,
  escapeJsonString,
  isJwt,
  jwtToJson,
  unescapeJsonString,
  valueHints,
  type ValueHint,
} from '../lib/json/smart';

// ── helpers ──────────────────────────────────────────────────────────────

const b64u = (s: string | Buffer) => (typeof s === 'string' ? Buffer.from(s, 'utf8') : s).toString('base64url');
const jwt = (header: unknown, payload: unknown, sig = 'c2lnbmF0dXJl') =>
  b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(payload)) + '.' + sig;
const HS = { alg: 'HS256', typ: 'JWT' };

/** 2026-10-13T12:00:00Z */
const NOW = Date.UTC(2026, 9, 13, 12);
const NOW_S = NOW / 1000;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const rel = (v: number, unit: Intl.RelativeTimeFormatUnit) => rtf.format(v, unit);

const str = (s: string) => new JNode(STR, s, 0, 0, null, undefined);
const num = (raw: string) => new JNode(NUM, raw, 0, 0, null, undefined);
const hint = (n: JNode): ValueHint | undefined => {
  const hs = valueHints(n, NOW);
  assert.ok(hs.length <= 1, `at most one hint: ${JSON.stringify(hs)}`);
  return hs[0];
};
const kindOf = (s: string) => hint(str(s))?.kind;

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── JWT ──────────────────────────────────────────────────────────────────

describe('decodeJwt / isJwt', () => {
  test('the jwt.io sample token', () => {
    const t =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    assert.ok(isJwt(t));
    assert.deepEqual(decodeJwt(t, NOW), {
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      signature: 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      claims: { iat: '2018-01-18T01:30:22.000Z' },
    });
  });

  test('exp / nbf / iat claims and expiry against now', () => {
    const live = decodeJwt(jwt(HS, { exp: NOW_S + 7200, nbf: NOW_S - 60, iat: NOW_S - 60 }), NOW);
    assert.deepEqual(live?.claims, {
      exp: '2026-10-13T14:00:00.000Z',
      iat: '2026-10-13T11:59:00.000Z',
      nbf: '2026-10-13T11:59:00.000Z',
      expired: false,
    });
    assert.equal(decodeJwt(jwt(HS, { exp: NOW_S }), NOW)?.claims.expired, true, 'exp == now is expired');
    assert.equal(decodeJwt(jwt(HS, { exp: NOW_S - 1 }), NOW)?.claims.expired, true);
    assert.equal(decodeJwt(jwt(HS, { exp: 1.5 }), NOW)?.claims.exp, '1970-01-01T00:00:01.500Z', 'fractional NumericDate');
    // without `now`, compares against the real clock
    assert.equal(decodeJwt(jwt(HS, { exp: 1 }))?.claims.expired, true);
  });

  test('non-numeric or out-of-range claims are ignored', () => {
    const d = decodeJwt(jwt(HS, { exp: '1700000000', iat: 1e20, nbf: null }), NOW);
    assert.ok(d);
    assert.deepEqual(d.claims, {});
    assert.deepEqual(decodeJwt(jwt(HS, [1, 2]), NOW)?.claims, {}, 'non-object payload');
  });

  test('UTF-8 payloads decode correctly', () => {
    const payload = { name: 'Jos\u00e9 \u{1f600} \u65e5\u672c\u8a9e', nested: { emoji: '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}' } };
    const t = jwt({ alg: 'ES256', kid: 'cl\u00e9' }, payload);
    const d = decodeJwt(t, NOW);
    assert.deepEqual(d?.payload, payload);
    assert.deepEqual(d?.header, { alg: 'ES256', kid: 'cl\u00e9' });
  });

  test('every payload length (base64url remainder 0, 2, 3)', () => {
    for (let n = 0; n < 12; n++) {
      const payload = { s: 'x'.repeat(n) };
      assert.deepEqual(decodeJwt(jwt(HS, payload), NOW)?.payload, payload);
    }
  });

  test('whitespace, Bearer prefix and unsigned tokens', () => {
    const t = jwt(HS, { a: 1 });
    assert.deepEqual(decodeJwt('  ' + t + '\n', NOW)?.payload, { a: 1 });
    assert.deepEqual(decodeJwt('Bearer ' + t, NOW)?.payload, { a: 1 });
    assert.ok(isJwt('bearer  ' + t));
    const none = jwt({ alg: 'none' }, { a: 1 }, '');
    assert.ok(none.endsWith('.'));
    assert.equal(decodeJwt(none, NOW)?.signature, '');
  });

  test('malformed tokens', () => {
    const h = b64u(JSON.stringify(HS));
    const p = b64u('{"a":1}');
    const bad = [
      '',
      'abc',
      'eyJ',
      h,
      h + '.' + p, // 2 parts
      h + '.' + p + '.sig.x', // 4 parts
      h + '.' + p + '.a.b.c', // 5-part JWE shape
      h + '..sig', // empty payload
      h + '.' + p + '.si+g', // standard base64 alphabet
      h + '.' + p + '=.sig', // padding
      h + '.' + p + 'A.sig', // length % 4 == 1
      h + '.' + p + '.sigAA', // signature length % 4 == 1
      'e30.' + p + '.sig', // header {} does not start with eyJ
      b64u('{"alg":') + '.' + p + '.sig', // header not JSON
      h + '.' + b64u('not json') + '.sig',
      h + '.' + b64u(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])) + '.sig', // invalid UTF-8
      h + '.' + p + '.sig trailing',
      'x' + h + '.' + p + '.sig',
    ];
    for (const t of bad) assert.equal(decodeJwt(t, NOW), null, t);
    const jwe = h + '.' + p + '.a.b.c';
    assert.equal(isJwt(jwe), false);
    assert.equal(isJwt('eyJhbGciOiJ'), false);
    assert.equal(isJwt('hello.world.foo'), false);
  });
});

describe('jwtToJson', () => {
  const t = jwt(HS, { sub: 'u1', exp: NOW_S + 3600, name: '\u65e5\u672c' }, 'abc_-0');

  test('pretty document with header, payload, signature and claims', () => {
    const out = jwtToJson(t, '  ');
    assert.ok(out);
    const v = JSON.parse(out) as { _claims: { exp: string; expired: boolean } };
    assert.deepEqual(Object.keys(v), ['header', 'payload', 'signature', '_claims']);
    assert.deepEqual(v, {
      header: HS,
      payload: { sub: 'u1', exp: NOW_S + 3600, name: '\u65e5\u672c' },
      signature: 'abc_-0',
      _claims: v._claims,
    });
    assert.equal(v._claims.exp, new Date((NOW_S + 3600) * 1000).toISOString());
    assert.equal(typeof v._claims.expired, 'boolean');
    // same layout as JSON.stringify with this indent
    assert.equal(out, JSON.stringify(v, null, '  '));
    const res = parse(out);
    assert.equal(res.issues.length, 0);
    assert.equal(res.error, null);
  });

  test('indent styles', () => {
    const min = jwtToJson(t, '');
    assert.ok(min);
    assert.ok(!min.includes('\n'));
    assert.equal(min, JSON.stringify(JSON.parse(min)));
    const tab = jwtToJson(t, '\t');
    assert.ok(tab);
    assert.equal(tab, JSON.stringify(JSON.parse(tab), null, '\t'));
  });

  test('lossless: big numbers and key order survive', () => {
    const p = '{"10":1,"id":12345678901234567890,"2":2,"f":1.10}';
    const tok = b64u(JSON.stringify(HS)) + '.' + b64u(p) + '.sig';
    const out = jwtToJson(tok, '  ');
    assert.ok(out);
    assert.ok(out.includes('"id": 12345678901234567890'));
    assert.ok(out.includes('"f": 1.10'));
    assert.ok(out.indexOf('"10"') < out.indexOf('"2"'));
  });

  test('no _claims without registered time claims; null for non-JWTs', () => {
    const out = jwtToJson(jwt(HS, { a: 1 }), '  ');
    assert.ok(out);
    assert.deepEqual(Object.keys(JSON.parse(out) as object), ['header', 'payload', 'signature']);
    assert.equal(jwtToJson('nope', '  '), null);
    assert.equal(jwtToJson(jwt(HS, { a: 1 }) + '.x.y', '  '), null);
  });
});

// ── embedded JSON ────────────────────────────────────────────────────────

describe('embeddedJson', () => {
  test('objects and arrays, trimmed', () => {
    assert.equal(embeddedJson('{"a":1}'), '{"a":1}');
    assert.equal(embeddedJson('[1,2,3]'), '[1,2,3]');
    assert.equal(embeddedJson('  \n\t{"a":[1,{"b":null}]}\r\n '), '{"a":[1,{"b":null}]}');
    assert.equal(embeddedJson('{}'), '{}');
    assert.equal(embeddedJson('[ ]'), '[ ]');
  });

  test('escaped content inside the embedded document', () => {
    const inner = '{"q":"say \\"hi\\" } ]","p":"C:\\\\x","u":"\\u00e9"}';
    assert.equal(embeddedJson(inner), inner);
    // as it arrives from a parsed document: the decoded string value
    const root = parse(JSON.stringify({ payload: inner })).root;
    assert.ok(root);
    const v = (root.v as JNode[])[0].v as string;
    assert.equal(v, inner);
    assert.equal(embeddedJson(v), inner);
  });

  test('double-encoded JSON string literal', () => {
    assert.equal(embeddedJson('"{\\"a\\":1}"'), '{"a":1}');
    assert.equal(embeddedJson(JSON.stringify(JSON.stringify([1, { b: 2 }]))), '[1,{"b":2}]');
    assert.equal(embeddedJson('"hello"'), null);
    assert.equal(embeddedJson('"{hello}"'), null);
    assert.equal(embeddedJson('"{\\"a\\":1}'), null);
  });

  test('not JSON', () => {
    for (const s of ['', ' ', '{', '}', '{hello}', '[1,2', '{"a":1]', '[1}', '{"a":1} x', 'x {"a":1}', '123', 'true', 'null', '"x"', "{'a':1}", '{a:1}', '[1,]', '{"a":1,}'])
      assert.equal(embeddedJson(s), null, s);
  });

  test('5 MB cap', () => {
    const big = '[' + '0,'.repeat(2621440) + '0]';
    assert.ok(big.length > 5 * 1024 * 1024);
    assert.equal(embeddedJson(big), null);
    const ok = '[' + '0,'.repeat(2621000) + '0]';
    assert.ok(ok.length < 5 * 1024 * 1024);
    assert.equal(embeddedJson(ok), ok);
  });
});

// ── value hints ──────────────────────────────────────────────────────────

describe('valueHints', () => {
  test('only strings and numbers', () => {
    for (const src of ['{}', '[]', 'true', 'null', '{"a":"#fff"}']) {
      const root = parse(src).root;
      assert.ok(root);
      assert.deepEqual(valueHints(root, NOW), []);
    }
    for (const s of ['', 'hello', 'a b c', '#', 'http', '2026', '42', 'e', 'data:'])
      assert.deepEqual(valueHints(str(s), NOW), [], s);
    for (const raw of ['0', '42', '-1', '3.14', '1e10', '12345678901234567890']) assert.deepEqual(valueHints(num(raw), NOW), [], raw);
  });

  test('ISO-8601 dates', () => {
    const h = hint(str('2026-10-10T12:00:00Z'));
    assert.equal(h?.kind, 'date');
    assert.ok(h?.label.endsWith(' · ' + rel(-3, 'day')), h?.label);
    assert.ok(h?.label.includes('2026'));
    // offsets are applied: 17:30+05:30 is exactly now
    assert.ok(hint(str('2026-10-13T17:30:00+05:30'))?.label.endsWith(' · ' + rel(0, 'second')));
    assert.ok(hint(str('2026-10-13T06:00:00.123456-0600'))?.label.endsWith(' · ' + rel(0, 'second')));
    assert.ok(hint(str('2026-10-13t14:00z'))?.label.endsWith(' · ' + rel(2, 'hour')));
    // date-only: a calendar day, relative in whole days or larger
    const d = hint(str('2024-10-13'));
    assert.equal(d?.kind, 'date');
    assert.ok(d?.label.endsWith(' · ' + rel(-2, 'year')), d?.label);
    // space separator (SQL), local time, and Go's zero time
    for (const s of ['2026-10-13 10:15:00', '2026-10-13T10:15', '0001-01-01T00:00:00Z', '2024-02-29'])
      assert.equal(kindOf(s), 'date', s);
    for (const s of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-10T24:00:00Z', '2026-10-10T10:60Z', '2026-10-10T10:00:00+25:00', '2026-10-10T', '2026-1-1', '2026-10-10Z', '20261010'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('epoch seconds / milliseconds', () => {
    assert.deepEqual(valueHints(num('1760356800'), NOW), [
      { kind: 'epoch-s', label: '2025-10-13T12:00:00Z · ' + rel(-1, 'year') },
    ]);
    assert.deepEqual(valueHints(num('1760356800000'), NOW), [
      { kind: 'epoch-ms', label: '2025-10-13T12:00:00.000Z · ' + rel(-1, 'year') },
    ]);
    assert.equal(hint(num('1760364000.5'))?.label, '2025-10-13T14:00:00.500Z · ' + rel(-1, 'year'));
    assert.equal(hint(num(String(NOW_S + 7200)))?.label, '2026-10-13T14:00:00Z · ' + rel(2, 'hour'));
    // relative-time units switch early instead of "60 minutes ago" / "12 months ago"
    const relOf = (sec: number) => hint(num(String(NOW_S + sec)))?.label.split(' \u00b7 ')[1];
    assert.equal(relOf(-3576), rel(-1, 'hour'));
    assert.equal(relOf(-29 * 86400), rel(-1, 'month'));
    assert.equal(relOf(-364 * 86400), rel(-1, 'year'));
    assert.equal(relOf(-6 * 86400), rel(-6, 'day'));
    assert.equal(relOf(-14 * 86400), rel(-2, 'week'));
    assert.equal(relOf(30), rel(30, 'second'));
    assert.equal(kindOf('1760356800'), 'epoch-s', 'numeric strings too');
    assert.equal(kindOf('1760356800000'), 'epoch-ms');
    // outside 10/13 digits or outside 2001–2099
    for (const raw of ['999999999', '4102444800', '17603568000', '176035680000', '4102444800000', '17603568000000', '-1760356800', '1.76e9', '1760356800.'])
      assert.equal(hint(num(raw)), undefined, raw);
    assert.equal(hint(num('1000000000'))?.kind, 'epoch-s');
    assert.equal(hint(num('4102444799999'))?.kind, 'epoch-ms');
  });

  test('CSS colors', () => {
    const label = (s: string) => {
      const h = hint(str(s));
      assert.equal(h?.kind, 'color', s);
      return h?.label;
    };
    assert.equal(label('#fff'), 'Color · rgb(255, 255, 255)');
    assert.equal(label('#FF8800'), 'Color · rgb(255, 136, 0)');
    assert.equal(label('#ff880080'), 'Color · rgba(255, 136, 0, 0.5)');
    assert.equal(label('#ff8800ff'), 'Color · rgb(255, 136, 0)');
    assert.equal(label('rgb(255, 136, 0)'), 'Color · #ff8800');
    assert.equal(label('RGBA(255,136,0,0.5)'), 'Color · #ff880080');
    assert.equal(label('rgb(255 136 0 / 50%)'), 'Color · #ff880080');
    assert.equal(label('rgb(100%, 0%, 50%)'), 'Color · #ff0080');
    assert.equal(label('rgb(300, -5, 0)'), 'Color · #ff0000');
    assert.equal(label('hsl(120, 100%, 50%)'), 'Color · #00ff00');
    assert.equal(label('hsl(240deg 100% 25%)'), 'Color · #000080');
    assert.equal(label('hsla(0, 100%, 50%, .5)'), 'Color · #ff000080');
    assert.equal(label('hsl(-120, 100%, 50%)'), 'Color · #0000ff');
    for (const s of ['#ggg', '#12345', '#1234', '#1234567', 'fff', 'rgb(1,2)', 'rgb(1,2,3,4,5)', 'rgb(a,b,c)', 'rgb(1deg,2,3)', 'hsl(50%,1%,1%)', 'rgb(1,,2)', 'rgb()', 'red', 'hello', 'rgb(1,2,3'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('URLs', () => {
    assert.deepEqual(hint(str('https://Example.com/path?q=1#x')), { kind: 'url', label: 'Link · example.com' });
    assert.equal(hint(str('http://user:pw@[::1]:8080/'))?.label, 'Link · [::1]');
    assert.equal(hint(str('HTTP://localhost:3000'))?.label, 'Link · localhost');
    for (const s of ['https://', 'https://exa mple.com', 'ftp://example.com', 'https:/x.com', 'https://x.com/a b', 'https://x.com:123456'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('emails', () => {
    assert.deepEqual(hint(str('ada.lovelace+tag@mail.example.co.uk')), { kind: 'email', label: 'Email address' });
    for (const s of ['not an@email.com', 'a@b', '@x.com', 'a@x.c', 'a@@x.com', 'a@-x.com', 'a@x..com', 'x'.repeat(65) + '@x.com'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('UUIDs', () => {
    assert.deepEqual(hint(str('123e4567-e89b-42d3-a456-426614174000')), { kind: 'uuid', label: 'UUID v4' });
    assert.equal(hint(str('886313E1-3B8A-5372-9B90-0C9AEE199E5D'))?.label, 'UUID v5');
    assert.equal(hint(str('00000000-0000-0000-0000-000000000000'))?.label, 'UUID (nil)');
    assert.equal(hint(str('ffffffff-ffff-ffff-ffff-ffffffffffff'))?.label, 'UUID (max)');
    // RFC 9562 test vectors: all three encode 2022-02-22T19:22:22Z
    const ago = rel(Math.round((Date.UTC(2022, 1, 22, 19, 22, 22) - NOW) / 1000 / 31536000), 'year');
    assert.equal(hint(str('C232AB00-9414-11EC-B3C8-9F6BDECED846'))?.label, 'UUID v1 · ' + ago);
    assert.equal(hint(str('1EC9414C-232A-6B00-B3C8-9F6BDECED846'))?.label, 'UUID v6 · ' + ago);
    assert.equal(hint(str('017F22E2-79B0-7CC3-98C4-DC0C0C07398F'))?.label, 'UUID v7 · ' + ago);
    // a v7 minted two days ago
    const ts = (NOW - 2 * 86400000).toString(16).padStart(12, '0');
    assert.equal(hint(str(`${ts.slice(0, 8)}-${ts.slice(8)}-7abc-8def-0123456789ab`))?.label, 'UUID v7 · ' + rel(-2, 'day'));
    for (const s of ['123e4567-e89b-42d3-c456-426614174000', '123e4567-e89b-02d3-a456-426614174000', '123e4567-e89b-92d3-a456-426614174000', '123e4567e89b42d3a456426614174000', '123e4567-e89b-42d3-a456-42661417400g'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('JWTs', () => {
    assert.deepEqual(hint(str(jwt(HS, { exp: NOW_S + 7200 }))), { kind: 'jwt', label: 'JWT · expires in 2h' });
    assert.equal(hint(str(jwt(HS, { exp: NOW_S + 7199 })))?.label, 'JWT · expires in 1h');
    assert.equal(hint(str(jwt(HS, { exp: NOW_S + 90 })))?.label, 'JWT · expires in 1m');
    assert.equal(hint(str(jwt(HS, { exp: NOW_S + 400 * 86400 })))?.label, 'JWT · expires in 1y');
    assert.equal(hint(str(jwt(HS, { exp: NOW_S - 3 * 86400 })))?.label, 'JWT · expired 3d ago');
    assert.equal(hint(str(jwt(HS, { exp: NOW_S })))?.label, 'JWT · expired 0s ago');
    assert.equal(hint(str(jwt(HS, { sub: 'x' })))?.label, 'JWT');
    assert.equal(hint(str('Bearer ' + jwt(HS, { sub: 'x' })))?.kind, 'jwt');
    assert.equal(kindOf('eyJhbGciOiJIUzI1NiJ9.e30.x.y.z'), undefined);
  });

  test('base64 images', () => {
    assert.deepEqual(hint(str('data:image/png;base64,iVBORw0KGgo=')), { kind: 'base64-image', label: 'PNG image · 8 B' });
    const svg = 'data:image/svg+xml;charset=utf-8;base64,' + Buffer.alloc(3000).toString('base64');
    assert.equal(hint(str(svg))?.label, 'SVG image · 2.9 KB');
    assert.equal(hint(str('DATA:image/jpeg;base64,/9j/4AAQ'))?.label, 'JPEG image · 6 B');
    for (const s of ['data:text/plain;base64,aGk=', 'data:image/png,raw', 'data:image/png;base64'])
      assert.equal(kindOf(s), undefined, s);
  });

  test('embedded JSON', () => {
    assert.deepEqual(hint(str('{"a":1}')), { kind: 'json', label: 'JSON string (7 chars)' });
    assert.equal(hint(str(' [1, 2] '))?.label, 'JSON string (8 chars)');
    assert.equal(kindOf('"{\\"a\\":1}"'), 'json');
    assert.equal(kindOf('{hello}'), undefined);
    assert.equal(kindOf('[link](x)'), undefined);
  });

  test('big embedded JSON: verdict is cached per node and string', () => {
    const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i })));
    assert.ok(big.length > 65536);
    const n = str(big);
    assert.equal(hint(n)?.kind, 'json');
    assert.equal(hint(n)?.kind, 'json');
    n.v = big.slice(0, -1) + '}'; // edited in place: not JSON any more
    assert.equal(hint(n), undefined);
  });

  test('relative time falls back without Intl.RelativeTimeFormat', () => {
    const intl = Intl as unknown as { RelativeTimeFormat: unknown };
    const saved = intl.RelativeTimeFormat;
    const id = require.resolve('../lib/json/smart');
    delete require.cache[id];
    intl.RelativeTimeFormat = undefined;
    try {
      // Re-require so the module re-reads Intl without RelativeTimeFormat.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../lib/json/smart') as typeof import('../lib/json/smart');
      const relOf = (n: JNode) => fresh.valueHints(n, NOW)[0]?.label.split(' \u00b7 ')[1];
      assert.equal(relOf(num(String(NOW_S - 3 * 86400))), '3 days ago');
      assert.equal(relOf(num(String(NOW_S + 7200))), 'in 2 hours');
      assert.equal(relOf(num(String(NOW_S + 1))), 'in 1 second');
      assert.equal(relOf(num(String(NOW_S))), 'now');
      const t = new Date(NOW); // the viewer's local calendar day
      const p2 = (x: number) => String(x).padStart(2, '0');
      assert.equal(relOf(str(`${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`)), 'today');
    } finally {
      intl.RelativeTimeFormat = saved;
      delete require.cache[id];
    }
  });

  test('works on nodes from the parser', () => {
    const res = parse('{"at":"2026-10-12T12:00:00Z","ts":1760356800,"c":"#000","id":"123e4567-e89b-42d3-a456-426614174000"}');
    assert.ok(res.root);
    const kinds = (res.root.v as JNode[]).map((n) => valueHints(n, NOW)[0]?.kind);
    assert.deepEqual(kinds, ['date', 'epoch-s', 'color', 'uuid']);
  });
});

// ── escape / unescape ────────────────────────────────────────────────────

describe('escapeJsonString / unescapeJsonString', () => {
  let ctl = '';
  for (let i = 0; i < 32; i++) ctl += String.fromCharCode(i);
  const samples = [
    '',
    'plain',
    'quote " backslash \\ slash /',
    'line\nbreak\r\ntab\tfeed\fback\b',
    ctl,
    '\u007f del',
    'emoji \u{1f600}\u{1f468}\u200d\u{1f469}\u200d\u{1f467} flag \u{1f1ee}\u{1f1f3}',
    'accents caf\u00e9 \u65e5\u672c\u8a9e \u0645\u0631\u062d\u0628\u0627',
    'separators \u2028 \u2029',
    'lone \ud800 and \udfff surrogates',
    '\\u0041 looks like an escape',
    '"already quoted"',
  ];

  test('escape output is a valid JSON string body', () => {
    for (const s of samples) {
      for (const ascii of [false, true]) {
        const e = escapeJsonString(s, ascii);
        assert.equal(JSON.parse('"' + e + '"'), s);
        assert.ok(!/[\u0000-\u001f\u2028\u2029]/.test(e), 'no raw control chars or separators');
        if (ascii) assert.ok(/^[\u0020-\u007e]*$/.test(e), 'ascii mode is printable ASCII');
      }
    }
  });

  test('escape specifics', () => {
    assert.equal(escapeJsonString('a"b\\c\n\t\u0001'), 'a\\"b\\\\c\\n\\t\\u0001');
    assert.equal(escapeJsonString('x\u2028y\u2029'), 'x\\u2028y\\u2029');
    assert.equal(escapeJsonString('\u{1f600}\u00e9'), '\u{1f600}\u00e9');
    assert.equal(escapeJsonString('\u{1f600}\u00e9', true), '\\ud83d\\ude00\\u00e9');
    assert.equal(escapeJsonString('\ud800'), '\\ud800');
  });

  test('round trips, with and without quotes', () => {
    for (const s of samples) {
      for (const ascii of [false, true]) {
        const e = escapeJsonString(s, ascii);
        assert.equal(unescapeJsonString(e), s, JSON.stringify(e));
        assert.equal(unescapeJsonString('"' + e + '"'), s);
        assert.equal(unescapeJsonString('  "' + e + '"\n'), s, 'pasted with surrounding whitespace');
      }
    }
  });

  test('fuzz: random UTF-16 round trips', () => {
    const rnd = prng(0x5eed);
    const pool = [0, 9, 10, 13, 31, 34, 47, 92, 117, 127, 0xe9, 0x2028, 0x2029, 0xd83d, 0xde00, 0xd800, 0xdfff, 0xfeff, 0xffff];
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const n = (rnd() * 24) | 0;
      for (let j = 0; j < n; j++) s += String.fromCharCode(rnd() < 0.5 ? pool[(rnd() * pool.length) | 0] : (rnd() * 0x10000) | 0);
      const e = escapeJsonString(s, rnd() < 0.5);
      assert.equal(unescapeJsonString(e), s);
      assert.equal(unescapeJsonString('"' + e + '"'), s);
      assert.equal(unescapeJsonString('"' + e + '"'), JSON.parse('"' + e + '"'));
    }
  });

  test('unescape specifics', () => {
    assert.equal(unescapeJsonString('caf\\u00e9 \\u00E9'), 'caf\u00e9 \u00e9');
    assert.equal(unescapeJsonString('\\ud83d\\ude00'), '\u{1f600}');
    assert.equal(unescapeJsonString('\\/\\b\\f'), '/\b\f');
    assert.equal(unescapeJsonString('He said \\"hi\\"'), 'He said "hi"');
    assert.equal(unescapeJsonString('"a\\nb"\n'), 'a\nb');
    assert.equal(unescapeJsonString('""'), '');
    assert.equal(unescapeJsonString('"\\""'), '"');
    assert.equal(unescapeJsonString('"'), '"');
    // closing quote is escaped → not a quoted literal; quotes stay as content
    assert.equal(unescapeJsonString('"abc\\"'), '"abc"');
    assert.equal(unescapeJsonString('"abc\\\\"'), 'abc\\');
    // raw characters pass through (lenient), only escapes are validated
    assert.equal(unescapeJsonString('say "hi" \\u00e9\\n'), 'say "hi" \u00e9\n');
    assert.equal(unescapeJsonString('tab\there \\t'), 'tab\there \t');
    assert.equal(unescapeJsonString('raw " then bad \\x'), null);
    assert.equal(unescapeJsonString('multi\nline "raw"'), 'multi\nline "raw"');
    assert.equal(unescapeJsonString('  padded  '), '  padded  ');
    for (const s of ['\\x41', '\\u12G4', '\\u12', '\\u', 'end\\', '\\a', '\\U0041', '"\\q"', '\\\\\\'])
      assert.equal(unescapeJsonString(s), null, s);
  });
});
