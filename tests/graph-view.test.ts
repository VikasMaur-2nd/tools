import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { G, buildModel } from '../lib/graph/model';
import { layoutGraph, type GraphLayout } from '../lib/graph/layout';
import { LOD_SKEL, LOD_TEXT, MARGIN, ZOOM_MAX, bound, fitCam, fitScale, follow, initialCam, lerpCam, lodOf, minZoom, zoomAt, type Cam } from '../lib/graph/camera';
import { blockEnd, column, compactNum, paint, partAt, widest, type Paint } from '../lib/graph/render';
import { isDark, type GraphTheme } from '../lib/graph/theme';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('graph camera: zoom keeps the point under the cursor', () => {
  const c = { x: 100, y: -50, s: 0.5 };
  const z = zoomAt(c, 2, 300, 200, 0.02);
  near(z.s, 1);
  near(c.x + 300 / c.s, z.x + 300 / z.s);
  near(c.y + 200 / c.s, z.y + 200 / z.s);
  assert.equal(zoomAt(c, 100, 0, 0, 0.02).s, ZOOM_MAX);
  assert.equal(zoomAt(c, 1e-6, 0, 0, 0.02).s, 0.02);
});

test('graph camera: fit, initial view and min zoom', () => {
  // Small graph: fitted and centred, never above 100%.
  const f = fitCam(400, 200, 1000, 800, 0.02);
  assert.equal(f.s, 1);
  near(f.x + 1000 / 2, 200);
  near(f.y + 800 / 2, 100);
  // Tall graph: 100% from the top-left with a margin.
  const i = initialCam(400, 100_000, 1000, 800, 0.02);
  assert.deepEqual(i, { x: -24, y: -24, s: 1 });
  // A huge graph lowers the minimum zoom so it can be shown whole.
  const mz = minZoom(1e3, 1e6, 1000, 800);
  assert.ok(mz < 0.02);
  near(mz, fitScale(1e3, 1e6, 1000, 800));
  assert.equal(minZoom(100, 100, 1000, 800), 0.02);
});

test('graph camera: follow moves as little as needed', () => {
  const c = { x: 0, y: 0, s: 1 };
  assert.deepEqual(follow(c, 100, 100, 50, 20, 800, 600), c);
  const below = follow(c, 100, 1000, 50, 20, 800, 600);
  near(below.y, 1000 + 20 + 24 - 600);
  assert.equal(below.x, 0);
  const centred = follow(c, 100, 1000, 50, 20, 800, 600, true);
  near(centred.y + 300, 1010);
  near(centred.x + 400, 125);
});

test('graph camera: animation endpoints and level of detail', () => {
  const a = { x: 0, y: 0, s: 1 };
  const b = { x: 500, y: 300, s: 0.25 };
  assert.deepEqual(lerpCam(a, b, 0, 800, 600), a);
  const e = lerpCam(a, b, 1, 800, 600);
  near(e.x, b.x, 1e-6);
  near(e.y, b.y, 1e-6);
  near(e.s, b.s);
  assert.equal(lodOf(1), 0);
  assert.equal(lodOf(LOD_TEXT), 0);
  assert.equal(lodOf(LOD_TEXT - 0.01), 1);
  assert.equal(lodOf(LOD_SKEL), 1);
  assert.equal(lodOf(LOD_SKEL - 0.01), 2);
});

test('graph render: hit-test parts and compact numbers', () => {
  const r = parse('{"a":1,"b":{"c":2},"d":[1,2]}');
  const m = buildModel(r.root!, 7.2);
  const L = layoutGraph(m);
  const x = L.x[0];
  const y = L.y[0];
  assert.equal(partAt(L, 0, x + 1, y + 2), -2); // chevron zone of a card with children
  assert.equal(partAt(L, 0, x + 40, y + 2), -1); // header
  assert.equal(partAt(L, 0, x + 40, y + G.head + 1), m.rowStart[0]);
  assert.equal(partAt(L, 0, x + 40, y + G.head + G.row * 2 + 1), m.rowStart[0] + 2);
  assert.equal(partAt(L, 0, x + 40, y + G.head + G.row * 3 + 1), -1); // padding under the last row
  assert.equal(compactNum(999), '999');
  assert.equal(compactNum(1234), '1,234');
  assert.equal(compactNum(56_789), '57k');
  assert.equal(compactNum(1_200_000), '1.2M');
});

test('graph theme: dark detection reads minified and rgb colours', () => {
  assert.equal(isDark('#000'), true);
  assert.equal(isDark('#000000'), true);
  assert.equal(isDark('#fff'), false);
  assert.equal(isDark('#fafafa'), false);
  assert.equal(isDark('rgb(10, 10, 10)'), true);
  assert.equal(isDark('rgba(250,250,250,1)'), false);
  assert.equal(isDark('transparent'), false);
});

test('graph camera: bound keeps the graph in reach and lands exactly on edges', () => {
  // A tall graph (1000 × 100,000) in an 800 × 600 view at scale 1.
  const top = bound({ x: 0, y: -5000, s: 1 }, 1000, 100_000, 800, 600, 0);
  assert.equal(top.y, -MARGIN);
  const end = bound({ x: 0, y: 1e9, s: 1 }, 1000, 100_000, 800, 600, 0);
  assert.equal(end.y, 100_000 + MARGIN - 600);
  // Slack lets the view go half a view past an edge, no further.
  assert.equal(bound({ x: 0, y: -5000, s: 1 }, 1000, 100_000, 800, 600, 0.5).y, -MARGIN - 300);
  // A graph smaller than the view stays inside it.
  const small = bound({ x: 5000, y: -5000, s: 1 }, 200, 100, 800, 600, 0);
  assert.equal(small.x, -MARGIN);
  assert.equal(small.y, 100 + MARGIN - 600);
  // Scale counts: at 0.5 the view covers twice the world.
  assert.equal(bound({ x: 0, y: 1e9, s: 0.5 }, 1000, 100_000, 800, 600, 0).y, 100_000 + MARGIN - 1200);
  // In range: unchanged.
  assert.deepEqual(bound({ x: 10, y: 20, s: 1 }, 1000, 100_000, 800, 600, 0), { x: 10, y: 20, s: 1 });
});

// ── Painting cost (a recording 2D context; Node has no canvas) ──

const ops = { seg: 0, fill: 0, stroke: 0, text: 0, clip: 0, save: 0, rects: 0 };
const seg = () => void ops.seg++;
class FakePath {
  moveTo = seg;
  lineTo = seg;
  bezierCurveTo = seg;
  quadraticCurveTo = seg;
  arcTo = seg;
  arc = seg;
  rect = seg;
  roundRect = seg;
  closePath() {}
}
(globalThis as unknown as { Path2D: unknown }).Path2D ??= FakePath;
const fakeCtx = Object.assign(new FakePath(), {
  rect() {
    ops.seg++;
    ops.rects++;
  },
  setTransform() {},
  fillRect() {},
  strokeRect() {},
  clearRect() {},
  beginPath() {},
  fill: () => void ops.fill++,
  stroke: () => void ops.stroke++,
  fillText: () => void ops.text++,
  save: () => void ops.save++,
  restore() {},
  clip: () => void ops.clip++,
  measureText: () => ({ width: 7 }),
  drawImage() {},
  createPattern: () => null,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: '',
  textAlign: '',
  globalAlpha: 1,
}) as unknown as CanvasRenderingContext2D;
const fakeTheme = new Proxy({}, { get: (_, k) => (k === 'grid' ? undefined : k === 'font' ? '12px monospace' : '#888') }) as GraphTheme;
const noSelection = (): Paint => ({ card: -1, row: -1, hoverRow: -1, hoverCard: -1, hitRow: null, hitCard: null, curRow: -1, curCard: -1, dpr: 1 });

function count(L: GraphLayout, cam: Cam, vw: number, vh: number, p = noSelection()) {
  for (const k in ops) ops[k as keyof typeof ops] = 0;
  paint(fakeCtx, L, fakeTheme, cam, vw, vh, p);
  return { ...ops };
}

/** A GeoJSON-like FeatureCollection of `n` squares: deep, narrow cards, one per few pixels far out. */
function features(n: number) {
  const f = [];
  for (let i = 0; i < n; i++) {
    const x = (i * 7.31) % 300;
    const y = (i * 3.17) % 120;
    f.push({ type: 'Feature', id: i, properties: { name: `area ${i}`, active: !!(i % 2) }, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] } });
  }
  return layoutGraph(buildModel(parse(JSON.stringify({ type: 'FeatureCollection', features: f })).root!, 7.2));
}

test('graph render: zoomed far out, a frame costs what the screen shows, not what the graph holds', () => {
  for (const n of [3000, 12000]) {
    const L = features(n);
    const vw = 1280;
    const vh = 720;
    const s = minZoom(L.width, L.height, vw, vh);
    const c = count(L, fitCam(L.width, L.height, vw, vh, s), vw, vh);
    // Columns under a pixel wide: blocks, and the one bus trunk that spans the graph; no per-card edges.
    assert.ok(c.seg < 120, `${n} features: ${c.seg} path segments`);
    assert.ok(c.rects >= 5, `${n} features: ${c.rects} blocks`);
  }
});

test('graph render: merged blocks end where card-by-card merging ends', () => {
  // Records of uneven sizes, so columns have gaps of every size.
  const rows = Array.from({ length: 400 }, (_, i) => {
    const o: Record<string, unknown> = { id: i };
    for (let k = 0; k < (i * 7) % 11; k++) o['f' + k] = k;
    if (i % 3) o.nested = { a: i, b: [{ c: i }] };
    if (i % 5 === 0) o.big = Object.fromEntries(Array.from({ length: (i % 9) + 1 }, (_, k) => ['k' + k, { v: k }]));
    return o;
  });
  const L = layoutGraph(buildModel(parse(JSON.stringify(rows)).root!, 7.2));
  const { m, y } = L;
  const bottom = (c: number) => y[c] + m.h[c];
  for (let d = 0; d < L.levels.length; d++) {
    const list = L.levels[d];
    const col = column(L, d);
    for (const t of [0.7, 5.3, 31.1, 260.9, 4100.3, 1e7]) {
      for (let i = 0; i < list.length; i++) {
        // Card by card: absorb every card that starts within t of the block's bottom.
        let bot = bottom(list[i]);
        let j = i + 1;
        while (j < list.length && y[list[j]] <= bot + t) bot = Math.max(bot, bottom(list[j++]));
        assert.equal(blockEnd(col, i, list.length, t), j, `column ${d}, card ${i}, t ${t}`);
        let w = 0;
        for (let k = i; k < j; k++) w = Math.max(w, m.w[list[k]]);
        assert.equal(widest(m, col, list, i, j), w);
      }
    }
  }
});

test('graph render: cards paint a layer at a time, a fill per colour whatever their number', () => {
  const L = features(60);
  const vw = 4000;
  const vh = 20000;
  const fills = [];
  for (const s of [0.3, 1]) {
    const cam = { x: -MARGIN, y: -MARGIN, s };
    const plain = count(L, cam, vw, vh);
    // Find hits on every other card and row, a selected row and a hovered header.
    const p = noSelection();
    p.hitCard = new Uint8Array(L.m.n).map((_, i) => i % 2);
    p.hitRow = new Uint8Array(L.m.rowStart[L.m.n]).map((_, i) => i % 2);
    p.curCard = 3;
    p.curRow = 5;
    p.card = 2;
    p.row = L.m.rowStart[2];
    p.hoverCard = 4;
    const busy = count(L, cam, vw, vh, p);
    for (const c of [plain, busy]) {
      assert.equal(c.clip, 0);
      assert.equal(c.save, 0);
      assert.ok(c.fill <= 24, `scale ${s}: ${c.fill} fills`);
    }
    fills.push(plain.fill);
    if (s === 1) {
      // Every row's label and value, every header and size badge.
      let texts = 0;
      for (let c = 0; c < L.m.n; c++) if (L.shown[c]) texts += (L.m.rowStart[c + 1] - L.m.rowStart[c]) * (L.m.labelW[c] ? 2 : 1) + 2;
      assert.equal(plain.text, texts);
    }
  }
  assert.ok(L.m.n > 300, `${L.m.n} cards`);
});
