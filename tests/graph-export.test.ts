import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { buildModel, G, headText, labelText, valueText } from '../lib/graph/model';
import { layoutGraph } from '../lib/graph/layout';
import { EXPORT_LIMITS, exportSize, fitRaster, pngScale, toPNG, toSVG } from '../lib/graph/export';
import type { GraphTheme } from '../lib/graph/theme';

const theme: GraphTheme = {
  bg: '#ffffff', card: '#ffffff', head: '#fafafa', border: '#dcdcdc', edge: '#a3a3a3',
  fg: '#0a0a0a', muted: '#6a6a6a', faint: '#a3a3a3', key: '#1d4ed8', str: '#047857',
  num: '#b45309', bool: '#7c3aed', nul: '#be123c', accent: '#0a0a0a',
  rowHover: 'rgba(0,0,0,0.035)', rowSel: 'rgba(0,0,0,0.07)', hit: '#ffff00', hitCur: '#ff8800',
  font: '12px monospace', family: "'Test Mono', monospace", dark: false,
};

function model(value: unknown) {
  const parsed = parse(JSON.stringify(value));
  assert.equal(parsed.error, null);
  return buildModel(parsed.root!, 7.2);
}

/** Small XML token validator: balanced tags, quoted attributes and only legal entities. */
function wellFormed(svg: string): string[] {
  const tags: string[] = [];
  const text: string[] = [];
  let pos = 0;
  const entities = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi;
  const safe = (s: string) => assert.doesNotMatch(s.replace(entities, ''), /[&<>\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u);
  for (const match of svg.matchAll(/<\/?([\w:-]+)(?:\s+[\w:-]+="[^"]*")*\s*\/?>/g)) {
    const between = svg.slice(pos, match.index);
    safe(between);
    if (tags.at(-1) === 'text') text.push(between);
    safe(match[0].slice(1, -1).replace(/^\//, '').replace(/\/$/, ''));
    if (match[0].startsWith('</')) assert.equal(tags.pop(), match[1]);
    else if (!match[0].endsWith('/>')) tags.push(match[1]);
    pos = match.index! + match[0].length;
  }
  assert.equal(svg.slice(pos), '');
  assert.deepEqual(tags, []);
  return text;
}

test('graph export: standalone SVG escapes document text and preserves the model display strings', () => {
  const key = 'key&<>"\'';
  const m = model({ [key]: 'value & < > " \'', number: 42, boolean: true, nothing: null, empty: {}, array: [] });
  const L = layoutGraph(m);
  const svg = toSVG(L, theme, { selected: 0 });
  const texts = wellFormed(svg);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<style>/);
  assert.match(svg, /font-size:12px/);
  assert.match(svg, /font-family:&apos;Test Mono&apos;, monospace/);
  assert.match(svg, /class="selected"/);
  assert.match(svg, /class="key ph-no-capture"/);
  assert.ok(texts.includes('root'));
  assert.ok(texts.includes('{6}'));
  assert.ok(texts.includes('key&amp;&lt;&gt;&quot;&apos;'));
  assert.ok(texts.includes('&quot;value &amp; &lt; &gt; \\&quot; &apos;&quot;'));
  for (const expected of ['42', 'true', 'null', '{}', '[]']) assert.ok(texts.includes(expected), expected);
  assert.match(svg, new RegExp(`width="${L.width + 48}" height="${L.height + 48}"`));
  // The 24 px margin: the root card starts at (24, 24).
  assert.match(svg, /<rect class="card" x="24" y="24"/);
  assert.equal(labelText(m.rowNode[0]), key);
});

test('graph export: XML-invalid characters become replacement characters and valid emoji survive', () => {
  const m = model({ ['bad\ud800\ufffe\uffff😀']: 1, normal: '\u0000\u0007\u000b\n😀' });
  const svg = toSVG(layoutGraph(m), { ...theme, family: 'mono\u0000\u0001\u0008\u000b\u000c\u000e\u001fspace' });
  wellFormed(svg);
  assert.match(svg, /bad\ufffd\ufffd\ufffd😀/u);
  assert.match(svg, /mono\ufffd{7}space/u);
  // String display helpers retain JSON escapes, so controls never become literal XML text.
  assert.match(svg, /\\u0000\\u0007\\u000b\\n😀/u);
  assert.doesNotMatch(svg, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u);
});

test('graph export: headers and rows use the shared truncated CJK and emoji text', () => {
  const m = model({ ['日本語😀'.repeat(20)]: { ['長いキー'.repeat(20)]: '😀中文'.repeat(40) } });
  const svg = toSVG(layoutGraph(m), theme);
  const texts = wellFormed(svg);
  assert.ok(texts.includes(headText(m.node[1])));
  assert.ok(texts.includes(labelText(m.rowNode[1])));
  assert.ok(texts.includes(valueText(m.rowNode[1]).replaceAll('"', '&quot;')));
  assert.match(svg, /…/u);
});

test('graph export: collapse hides descendants, retains port dots and includes a pill within the margin', () => {
  const m = model({ branch: { secretHeader: { deeper: { hiddenValue: 'invisible' } } } });
  const collapsed = new Uint8Array(m.n);
  collapsed[1] = 1;
  const L = layoutGraph(m, collapsed);
  const svg = toSVG(L, theme, { selected: 2 });
  wellFormed(svg);
  assert.match(svg, />\+2<\/text>/);
  assert.doesNotMatch(svg, /hiddenValue|invisible|>deeper<|class="selected"/);
  assert.equal((svg.match(/class="card"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="dot"/g) ?? []).length, 2);
  const width = Number(/<svg[^>]* width="([\d.]+)"/.exec(svg)![1]);
  const pillEnd = L.x[1] + m.w[1] + 8 + 2 * m.charW + 12;
  assert.ok(width - 48 >= pillEnd - 0.25);
});

test('graph export: port curves and rounded bus trunks use the layout anchors', () => {
  const m = model({ list: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  const L = layoutGraph(m);
  const svg = toSVG(L, theme);
  wellFormed(svg);
  assert.match(svg, /class="edge" d="M[^"]*C/);
  const trunk = Math.round((L.colX[2] - G.colGap / 2) * 2) / 2;
  assert.ok(svg.includes(`Q${trunk + 24} `));
  assert.equal((svg.match(/class="card"/g) ?? []).length, L.shownCount);
  for (const match of svg.matchAll(/\s(?:x|y|width|height)="([\d.-]+)"/g)) {
    assert.ok(Number(match[1]) * 2 % 1 === 0);
  }
});

test('graph export: rejects too many shown SVG cards, but permits their collapsed graph', () => {
  const m = model(Array.from({ length: EXPORT_LIMITS.svgCards }, (_, id) => ({ id })));
  const expanded = layoutGraph(m);
  assert.equal(expanded.shownCount, EXPORT_LIMITS.svgCards + 1);
  assert.throws(() => toSVG(expanded, theme), /The graph is too large for SVG\. Collapse some branches or export PNG\./);
  const collapsed = new Uint8Array(m.n);
  collapsed[0] = 1;
  const svg = toSVG(layoutGraph(m, collapsed), theme);
  assert.match(svg, />\+20k<\/text>/);
  assert.equal((svg.match(/class="card"/g) ?? []).length, 1);
});

test('graph export: 5k cards export in less than 300 ms', () => {
  const L = layoutGraph(model(Array.from({ length: 4999 }, (_, id) => ({ id }))));
  assert.equal(L.shownCount, 5000);
  let elapsed = Infinity;
  let svg = '';
  // A busy shared host can deschedule this process. Allow at most three attempts.
  for (let attempt = 0; attempt < 3 && elapsed >= 300; attempt++) {
    const t0 = performance.now();
    svg = toSVG(L, theme);
    elapsed = Math.min(elapsed, performance.now() - t0);
  }
  assert.equal((svg.match(/class="card"/g) ?? []).length, 5000);
  assert.ok(elapsed < 300, `SVG took ${elapsed.toFixed(1)} ms`);
  console.log(`  graph export: 5000 cards in ${elapsed.toFixed(1)} ms, ${(svg.length / 1e6).toFixed(2)} MB SVG`);
});

test('graph export: PNG sizing respects integer sides, area, requested scale and minimum readability', () => {
  assert.equal(pngScale(640, 480), 2);
  assert.equal(pngScale(640, 480, 3), 3);
  assert.equal(pngScale(640, 480, 0.1), 0.25);
  assert.equal(pngScale(65536, 64), 0.25);
  for (const [w, h] of [[10000.1, 10000.7], [16000, 16000], [12345, 23456], [64, 65536]]) {
    const scale = pngScale(w, h, 4);
    const width = Math.ceil(w * scale);
    const height = Math.ceil(h * scale);
    assert.ok(scale >= 0.25 && scale <= 4);
    assert.ok(width <= EXPORT_LIMITS.pngSide && height <= EXPORT_LIMITS.pngSide);
    assert.ok(width * height <= EXPORT_LIMITS.pngPixels, `${width} × ${height}`);
  }
  for (const [w, h] of [[1e8, 100], [100, 1e8], [65537, 64], [50000, 50000]]) {
    assert.throws(() => pngScale(w, h), /The graph is too large for PNG\./);
  }
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.throws(() => pngScale(bad, 100), /invalid dimensions/);
    assert.throws(() => pngScale(100, bad), /invalid dimensions/);
    assert.throws(() => pngScale(100, 100, bad), /positive PNG scale/);
  }
});

test('graph export: PNG validates huge coordinates before attempting canvas allocation', async () => {
  const L = layoutGraph(model({ value: 1 }));
  await assert.rejects(toPNG({ ...L, height: 1e8 }, theme), /The graph is too large for PNG\./);
  assert.throws(() => toSVG({ ...L, width: NaN }, theme), /invalid dimensions/);
});

test('graph export: matches the screen header weight, bus badge offset, bus dot and bordered pill', () => {
  const m = model(Array.from({ length: 3 }, (_, id) => ({ id })));
  const svg = toSVG(layoutGraph(m), theme);
  assert.match(svg, /<text class="strong [^"]*"[^>]*>root<\/text>/);
  assert.match(svg, /\.strong\{font-weight:600\}/);
  const w = m.w[0];
  assert.ok(m.bus[0]);
  assert.ok(svg.includes(`<text class="muted end ${'ph-no-capture'}" x="${w - G.padX - G.port + 24}"`));
  assert.ok(svg.includes(`<rect class="dot" x="${w - 3 + 24}" y="${G.head / 2 - 3 + 24}"`));
  const collapsed = new Uint8Array(m.n);
  collapsed[0] = 1;
  const folded = toSVG(layoutGraph(m, collapsed), theme);
  assert.match(folded, /<rect class="pill"[^>]*rx="9"\/><text class="muted ph-no-capture"[^>]*>\+3<\/text>/);
  assert.match(folded, /<path class="chevron"/);
});

test('graph export: colour values get a swatch, with the text after it', () => {
  const m = model({ primary: '#2563eb', name: 'Ocean' });
  const svg = toSVG(layoutGraph(m), theme);
  wellFormed(svg);
  assert.match(svg, /<rect class="border" style="fill:#2563eb"/);
  assert.equal((svg.match(/class="border" style="fill:/g) ?? []).length, 1);
});

test('graph export: a branch, a view rectangle, and background choices', () => {
  const m = model({ a: { b: { c: 1 }, d: [{ e: 2 }, { e: 3 }] }, f: { g: 4 } });
  const L = layoutGraph(m);
  // Branch "a": its card and descendants only, with the 24 px margin.
  const a = 1;
  const branch = exportSize(L, { kind: 'branch', card: a });
  assert.equal(branch.cards, m.end[a] - a);
  const bsvg = toSVG(L, theme, { area: { kind: 'branch', card: a } });
  wellFormed(bsvg);
  assert.equal((bsvg.match(/class="card"/g) ?? []).length, branch.cards);
  assert.doesNotMatch(bsvg, />root</);
  assert.match(bsvg, new RegExp(`<rect class="card" x="24" y="24"`));
  assert.ok(branch.width < exportSize(L).width);
  // A view rectangle: exactly that size, no margin, coordinates relative to it.
  const view = exportSize(L, { kind: 'rect', x: L.x[a] - 10, y: L.y[a] - 10, w: 300, h: 200 });
  assert.equal(view.width, 300);
  assert.equal(view.height, 200);
  const vsvg = toSVG(L, theme, { area: { kind: 'rect', x: L.x[a] - 10, y: L.y[a] - 10, w: 300, h: 200 } });
  assert.match(vsvg, /width="300" height="200"/);
  assert.match(vsvg, /<rect class="card" x="10" y="10"/);
  // Backgrounds: the theme's by default, a custom colour, or none.
  assert.match(toSVG(L, theme), /<rect style="fill:#ffffff"/);
  assert.match(toSVG(L, theme, { background: '#123456' }), /<rect style="fill:#123456"/);
  assert.doesNotMatch(toSVG(L, theme, { background: null }), /<rect style="fill:/);
});

test('graph export: images shrink to the canvas a device really allows (iPhone and iPad limits)', () => {
  // WebKit's CanvasBase::maxCanvasArea: iOS 4096² before Safari 18, 8192² since; desktop WebKit and Chromium 16384².
  const area = (max: number) => (w: number, h: number) => w * h <= max;
  const IOS_17 = 4096 * 4096;
  const IOS_18 = 8192 * 8192;
  const DESKTOP = 16384 * 16384;
  // A tall graph: our own limits allow 1092 × 16384 px (17.9M px).
  const planned = pngScale(2000, 30_000, 2);
  assert.ok(Math.ceil(2000 * planned) * Math.ceil(30_000 * planned) > IOS_17);
  // Desktop and iOS 18: the planned size works.
  assert.equal(fitRaster(2000, 30_000, planned, area(DESKTOP)), planned);
  assert.equal(fitRaster(2000, 30_000, planned, area(IOS_18)), planned);
  // iOS 17 and older: halved area until it fits, never above the device's limit.
  const s17 = fitRaster(2000, 30_000, planned, area(IOS_17));
  assert.ok(s17 < planned);
  assert.ok(Math.ceil(2000 * s17) * Math.ceil(30_000 * s17) <= IOS_17);
  assert.ok(s17 > planned / 2, 'shrinks by halving the area, not more than needed');
  // Every attempt is checked by the callback, largest first.
  const tried: number[] = [];
  fitRaster(10_000, 10_000, 1, (w, h) => (tried.push(w * h), w * h <= IOS_18));
  assert.equal(tried[0], 100_000_000);
  assert.ok(tried.at(-1)! <= IOS_18);
  assert.ok(tried.every((a, i) => i === 0 || a < tried[i - 1]));
  // Nothing works down to a quarter size: a clear, toast-ready message.
  assert.throws(() => fitRaster(2000, 30_000, planned, () => false), /too large for an image on this device\. Export the visible area or a branch, or try SVG\./);
});
