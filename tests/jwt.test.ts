import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { duration, readJwt } from '../lib/json/jwt';
import { jwtLine } from '../lib/engine/highlight';

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const H = b64u('{"alg":"HS256","typ":"JWT"}');
const P = b64u('{"sub":"u1","iat":1790812800,"nbf":1790812800,"exp":1822348800}');
const TOKEN = `${H}.${P}.c2ln`;
/** 2026-10-13T12:00:00Z */
const NOW = Date.UTC(2026, 9, 13, 12);

describe('readJwt', () => {
  test('a pasted token becomes its decoded document with part offsets', () => {
    const j = readJwt(TOKEN, '  ', NOW);
    assert.ok(j);
    assert.equal(j.alg, 'HS256');
    assert.deepEqual([j.exp, j.iat, j.nbf], [1822348800, 1790812800, 1790812800]);
    assert.deepEqual(JSON.parse(j.json).payload, { sub: 'u1', iat: 1790812800, nbf: 1790812800, exp: 1822348800 });
    const [pre, h, p, s, end] = j.at;
    assert.deepEqual([pre, h], [0, 0]);
    assert.equal(TOKEN.slice(h, p - 1), H);
    assert.equal(TOKEN.slice(p, s - 1), P);
    assert.equal(TOKEN.slice(s, end), 'c2ln');
  });

  test('a payload too deep to pretty-print is shown compact', () => {
    const levels = 17_000; // pretty: about 2·levels² characters, past MAX_TEXT
    const payload = '['.repeat(levels) + ']'.repeat(levels);
    const j = readJwt(`${H}.${b64u(payload)}.c2ln`, '  ', NOW);
    assert.ok(j);
    assert.ok(j.json.startsWith('{\n  "header": {\n    "alg": "HS256",'));
    assert.ok(j.json.includes('"payload": ' + payload + ','));
  });

  test('offsets account for whitespace and a Bearer prefix', () => {
    const text = '\n  Bearer   ' + TOKEN + '\n';
    const j = readJwt(text, '  ', NOW);
    assert.ok(j);
    const [pre, h, p, s, end] = j.at;
    assert.equal(text.slice(pre, h), 'Bearer   ');
    assert.equal(text.slice(h, p - 1), H);
    assert.equal(text.slice(p, s - 1), P);
    assert.equal(text.slice(s, end), 'c2ln');
  });

  test('ordinary documents and broken tokens are not JWTs', () => {
    for (const t of ['{"a":1}', '[1,2]', 'eyJhbGciOiJ', `${H}.${P}`, `${H}.!!!.sig`, `${H}.${P}.s.x.y`, '']) assert.equal(readJwt(t, '  ', NOW), null, t);
  });
});

describe('jwtLine', () => {
  test('colors each part and mutes the dots and prefix', () => {
    const text = 'Bearer ' + TOKEN;
    const j = readJwt(text, '', NOW)!;
    const html = jwtLine(text, 0, text.length, j.at);
    assert.equal(
      html,
      `<span class="jw-b">Bearer </span><span class="jw-h">${H}</span><span class="jw-d">.</span><span class="jw-p">${P}</span><span class="jw-d">.</span><span class="jw-s">c2ln</span>`,
    );
  });

  test('renders a horizontal slice of a long token', () => {
    const j = readJwt(TOKEN, '', NOW)!;
    const a = 5;
    const b = j.at[2] + 3;
    assert.equal(jwtLine(TOKEN, a, b, j.at), `<span class="jw-h">${H.slice(a)}</span><span class="jw-d">.</span><span class="jw-p">${P.slice(0, 3)}</span>`);
  });

  test('escapes text when offsets lag an edit', () => {
    const j = readJwt(TOKEN, '', NOW)!;
    const edited = '<b>' + TOKEN.slice(3);
    assert.ok(!jwtLine(edited, 0, edited.length, j.at).includes('<b>'));
  });
});

describe('duration', () => {
  test('words with a second unit only while the first is small', () => {
    const cases: [number, string][] = [
      [0, '0 seconds'], [1, '1 second'], [45, '45 seconds'], [60, '1 minute'], [61, '1 minute 1 second'],
      [3599, '59 minutes'], [3600, '1 hour'], [3630, '1 hour'], [7140, '1 hour 59 minutes'], [90061, '1 day 1 hour'],
      [40 * 86400, '40 days'], [2 * 31536000 + 86400, '2 years 1 day'], [-5, '0 seconds'],
    ];
    for (const [sec, words] of cases) assert.equal(duration(sec), words, String(sec));
  });
});
