import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { readJwt } from '../lib/json/jwt';
import { jwtLine } from '../lib/engine/highlight';

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const H = b64u('{"alg":"HS256","typ":"JWT"}');
const P = b64u('{"sub":"u1","exp":1822348800}');
const TOKEN = `${H}.${P}.c2ln`;
/** 2026-10-13T12:00:00Z */
const NOW = Date.UTC(2026, 9, 13, 12);

describe('readJwt', () => {
  test('a pasted token becomes its decoded document with part offsets', () => {
    const j = readJwt(TOKEN, '  ', NOW);
    assert.ok(j);
    assert.equal(j.alg, 'HS256');
    assert.equal(j.exp, 1822348800);
    assert.deepEqual(JSON.parse(j.json).payload, { sub: 'u1', exp: 1822348800 });
    const [pre, h, p, s, end] = j.at;
    assert.deepEqual([pre, h], [0, 0]);
    assert.equal(TOKEN.slice(h, p - 1), H);
    assert.equal(TOKEN.slice(p, s - 1), P);
    assert.equal(TOKEN.slice(s, end), 'c2ln');
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
