import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './dom';
import { CodeView } from '../lib/engine/codeview';
import { codeRows, highlightCode } from '../lib/convert/highlight';

installDom();

const tick = () => new Promise((r) => setTimeout(r, 0));

function view(width = 800) {
  const el = new FakeElement();
  for (const c of ['cv-sizer', 'cv-rows']) el.appendChild(new FakeElement()).className = c;
  el.clientWidth = width;
  el.clientHeight = 600;
  const code = new CodeView(el as unknown as HTMLElement);
  const rows = el.querySelector('.cv-rows')!;
  return { code, rows, el };
}

/** The text of each drawn row's code, with its spans' classes: `[class]text` per token. */
const drawn = (html: string) =>
  [...html.matchAll(/<span class="cv-c">(.*?)<\/span><\/div>/g)].map((m) =>
    m[1].replace(/<span class="(t\w)">(.*?)<\/span>/g, '[$1]$2').replace(/<[^>]+>/g, ''),
  );

test('the output view colours a YAML block scalar as text, as the whole document does', async () => {
  const { code, rows } = view();
  const yaml = 'greeting: |\n  hello\n  world: yes\nnext: 1\n';
  const { hl, scanner } = codeRows('yaml');
  code.setText(yaml, hl, false, scanner);
  for (let k = 0; k < 20 && !rows.innerHTML; k++) await tick();
  const got = drawn(rows.innerHTML);
  assert.equal(got[2], '  [ts]world: yes', 'not a key');
  assert.deepEqual(got.slice(0, 4), highlightCode(yaml, 'yaml').split('\n').slice(0, 4).map((l) => l.replace(/<span class="(t\w)">(.*?)<\/span>/g, '[$1]$2')));
});

test('a TOML multi-line string stays a string on wrapped rows', async () => {
  // Narrow: the long line wraps onto several rows.
  const { code, rows } = view(400);
  const toml = 'title = """\n' + 'key = "not a key" '.repeat(8) + '\n"""\nnext = 1\n';
  const { hl, scanner } = codeRows('toml');
  code.setText(toml, hl, false, scanner);
  for (let k = 0; k < 20 && !rows.innerHTML; k++) await tick();
  const got = drawn(rows.innerHTML);
  assert.ok(got.length > 5, `wrapped (${got.length} rows)`);
  for (const row of got.slice(1, -3)) assert.match(row, /^\[ts\][^[]*$/, row);
  assert.equal(got.at(-2), '[tk]next [tp]= [tn]1');
});

test('find reports each match by line and column', async () => {
  const { code, rows } = view();
  code.setText('ab\ncab\n\nxab ab', (t) => t);
  for (let k = 0; k < 20 && !rows.innerHTML; k++) await tick();
  assert.deepEqual(code.find('ab'), { total: 4, index: 0 });
  assert.deepEqual((code as unknown as { hits: number[] }).hits, [0, 0, 1, 1, 3, 1, 3, 4]);
});

test('lines read one at a time wrap, draw and are found exactly as the same text given whole', async () => {
  const { parse } = await import('../lib/json/parser');
  const { stringify } = await import('../lib/json/format');
  const { tapeOf } = await import('../lib/json/tape-send');
  const { PrettyText, prettyIndexer } = await import('../lib/json/pretty');
  // (Lines past ASCII short enough not to be measured, which needs a browser: see Wrapper.rows.)
  const doc = JSON.stringify({
    short: 1, long: 'word '.repeat(40), w: '東京', e: '😀',
    list: Array.from({ length: 30 }, (_, i) => ({ i, s: i % 3 ? 'ascii text '.repeat(i) : 'é' + 'x'.repeat(i % 5) })),
  });
  const res = parse(doc);
  const text = stringify(res.root!, '  ');
  const tape = tapeOf(res, doc);
  const lines = new PrettyText(tape, doc, '  ', prettyIndexer(tape, doc, '  ')(Infinity)!);
  for (const width of [800, 1400]) {
    const a = view(width);
    const b = view(width);
    a.code.setText(text, (t) => t, true);
    b.code.setLines(lines, (t) => t, true);
    for (let k = 0; k < 50 && (!a.rows.innerHTML || !b.rows.innerHTML); k++) await tick();
    const inner = (v: CodeView) => v as unknown as { vis: Int32Array; rowStart: Int32Array; odd: Uint8Array; ls: Int32Array };
    assert.deepEqual(Array.from(inner(b.code).vis), Array.from(inner(a.code).vis), `vis at ${width}`);
    assert.deepEqual(Array.from(inner(b.code).rowStart), Array.from(inner(a.code).rowStart), `rows at ${width}`);
    assert.deepEqual(Array.from(inner(b.code).odd), Array.from(inner(a.code).odd), `odd at ${width}`);
    assert.equal(b.rows.innerHTML, a.rows.innerHTML, `drawn at ${width}`);
    for (const q of ['word', 'ascii', '"i": 2']) {
      assert.deepEqual(b.code.find(q), a.code.find(q), q);
      assert.deepEqual((b.code as unknown as { hits: number[] }).hits, (a.code as unknown as { hits: number[] }).hits, q);
    }
  }
});

test('wrap turned off and on over a big document draws the rows on screen until the new ones are laid out (F21)', async () => {
  const { code, rows, el } = view(400);
  // Over 2 MB: every layout runs in steps.
  const text = Array.from({ length: 2000 }, () => '"' + 'word '.repeat(240) + '"').join('\n');
  const inner = code as unknown as { vis: Int32Array; rowStart: Int32Array };
  const total = () => inner.rowStart[inner.vis.length];
  code.setText(text, (t) => t);
  for (let k = 0; k < 500 && !(inner.vis.length === 2000 && rows.innerHTML); k++) await tick();
  const wrapped = total();
  assert.ok(wrapped > 4000, `wrapped (${wrapped} rows)`);
  const now = performance.now;
  let t = now.call(performance);
  // Each layout step finds its time spent: the new layout takes many steps.
  performance.now = () => (t += 10);
  try {
    code.setWrap(false);
    assert.equal(total(), wrapped, 'the wrapped rows are still on screen');
    assert.equal(el.classList.contains('cv-nowrap'), false);
    // (Find draws the rows on screen: their wrapper was gone, "this.wrapper is null".)
    assert.ok(code.find('word').total > 0);
    assert.ok(rows.innerHTML.includes('cv-hit'));
    for (let k = 0; k < 2000 && total() !== 2000; k++) await tick();
    assert.equal(total(), 2000, 'one row per line');
    assert.equal(el.classList.contains('cv-nowrap'), true);
    code.find('word');
    // On, off and on again before any layout is done: the last one wins, with the rows wrapped as before.
    code.setWrap(true);
    code.setWrap(false);
    code.setWrap(true);
    code.find('word');
    for (let k = 0; k < 2000 && total() !== wrapped; k++) await tick();
    assert.equal(total(), wrapped);
    assert.equal(el.classList.contains('cv-nowrap'), false);
    code.find('word');
    assert.equal(el.querySelectorAll('.wrap-box').length, 1, 'old wrappers are let go');
  } finally {
    performance.now = now;
  }
});

test('laid out again inside a long wrapped line, the view keeps its text and the current match (F20)', async () => {
  const { code, rows, el } = view(400);
  const text = ['{', '  "a": 1,', `  "long": "MARKA${'R'.repeat(4990)}MARKB",`, ...Array.from({ length: 200 }, (_, i) => `  "k${i}": ${i},`), '  "z": 0', '}'].join('\n');
  code.setText(text, (t) => t, true);
  for (let k = 0; k < 50 && !rows.innerHTML; k++) await tick();
  type Inner = { sc: { top: number }; rowStart: Int32Array; hi: number; rFirst: number; wrapper: { reset(): void }; reflow(keep: boolean): void };
  const inner = code as unknown as Inner;
  const RH = 20;
  // The current match is drawn in the 600 px view (rows are drawn in order from rFirst).
  const inView = () => {
    const k = rows.innerHTML.split('<div class="cv-l').findIndex((r) => r.includes('cv-hit cur')) - 1;
    const y = (inner.rFirst + k) * RH;
    return k >= 0 && y >= inner.sc.top && y + RH <= inner.sc.top + 600;
  };
  // One match, at the end of the long line; then two, the current one the second.
  for (const [q, total] of [['markb', 1], ['mark', 2]] as const) {
    assert.deepEqual(code.find(q), { total, index: 0 });
    if (total === 2) assert.deepEqual(code.step(1), { total, index: 1 });
    assert.ok(inner.rowStart[3] - inner.rowStart[2] > 60, 'the long line takes many rows');
    assert.ok(inView(), `${q}: MARKB, at the end of the long line, in view`);
    for (const width of [500, 400, 300, 'font', 400] as const) {
      // (A width, a font, or a long line measured when idle: the view is laid out again. A font arriving resets
      // the wrapper's measurements before the layout: see onFonts.)
      if (width === 'font') inner.wrapper.reset();
      else el.clientWidth = width;
      inner.reflow(true);
      assert.equal(inner.hi, total - 1, `${q}, ${width}: MARKB is still the current match`);
      assert.ok(inView(), `${q}, ${width}: and still in view`);
    }
  }
});

test('Find going to a match while a big document is laid out again lands on it in the new rows (F21)', async () => {
  const { code, rows, el } = view(400);
  // Over 2 MB: layouts and searches run in steps. One match, far down.
  const text = Array.from({ length: 2000 }, (_, i) => '"' + 'x'.repeat(1200) + (i === 1500 ? 'MARKB' : '') + '"').join('\n');
  type Inner = { vis: Int32Array; rowStart: Int32Array; sc: { top: number }; rFirst: number; hi: number };
  const inner = code as unknown as Inner;
  const total = () => inner.rowStart[inner.vis.length];
  const inView = () => {
    const k = rows.innerHTML.split('<div class="cv-l').findIndex((r) => r.includes('cv-hit cur')) - 1;
    const y = (inner.rFirst + k) * 20;
    return k >= 0 && y >= inner.sc.top && y + 20 <= inner.sc.top + el.clientHeight;
  };
  code.setText(text, (t) => t);
  for (let k = 0; k < 500 && !(inner.vis.length === 2000 && rows.innerHTML); k++) await tick();
  const wrapped = total();
  code.setWrap(false);
  for (let k = 0; k < 500 && total() !== 2000; k++) await tick();
  const now = performance.now;
  let t = now.call(performance);
  // Each step finds its time spent: the search ends long before the layout.
  performance.now = () => (t += 10);
  try {
    // Wrap on again: a new wrapper, fitted to the width, while Find goes to MARKB in the rows still on screen.
    code.setWrap(true);
    code.find('markb');
    for (let k = 0; k < 2000 && !(total() === wrapped && inner.hi === 0); k++) await tick();
    assert.equal(total(), wrapped, 'wrapped again');
    assert.ok(inView(), 'MARKB is in view');
  } finally {
    performance.now = now;
  }
});
