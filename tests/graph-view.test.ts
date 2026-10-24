import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type JNode } from '../lib/json/parser';
import { G, buildModel, locate } from '../lib/graph/model';
import { GraphView } from '../lib/graph/view';
import { layoutGraph, type GraphLayout } from '../lib/graph/layout';
import { LOD_SKEL, LOD_TEXT, MARGIN, ZOOM_MAX, bound, fitCam, fitScale, follow, initialCam, lerpCam, lodOf, minZoom, zoomAt, type Cam } from '../lib/graph/camera';
import { blockEnd, column, compactNum, paint, partAt, releasePaint, widest, type Paint } from '../lib/graph/render';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { isDark, type GraphTheme } from '../lib/graph/theme';
import { overview } from '../lib/graph/minimap';

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
    const list = L.levels.at(d);
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

test('graph minimap: a merged block is as wide as its widest card', () => {
  // A wide card between two narrow ones, so close on the minimap that all three are one block.
  const L = layoutGraph(buildModel(parse(JSON.stringify([{ a: 1 }, { ['k'.repeat(40)]: 'v'.repeat(30) }, { a: 1 }])).root!, 7.2));
  const list = L.levels.at(1);
  const widths = [...list].map((c) => L.m.w[c]);
  assert.equal(widths.length, 3);
  assert.ok(widths[1] > widths[0] && widths[1] > widths[2], widths.join(' '));
  const rects: number[][] = [];
  const ctx = Object.assign(Object.create(fakeCtx), { rect: (x: number, y: number, w: number, h: number) => void rects.push([x, y, w, h]) });
  // 1 px across per world px (widths read as they are), 1 px down per 1000.
  overview(ctx, L, fakeTheme, 1, 0.001, 0, 0);
  const col = rects.filter(([x]) => x === L.colX[1]);
  assert.equal(col.length, 1);
  assert.equal(col[0][2], Math.max(...widths));
  // Far enough apart, each card is its own block with its own width.
  rects.length = 0;
  overview(ctx, L, fakeTheme, 1, 1, 0, 0);
  assert.deepEqual(rects.filter(([x]) => x === L.colX[1]).map((r) => r[2]), widths);
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

test('graph view: effective collapsed roots and stale selection survive a rebuild by path', () => {
  const oldRoot = parse('{"a":{"b":{"c":1}},"other":{"x":2}}').root!;
  const nextRoot = parse('{"a":{"b":{"c":3}},"other":{"x":4}}').root!;
  const oldModel = buildModel(oldRoot, 7.2);
  const nextModel = buildModel(nextRoot, 7.2);
  const collapsed = new Uint8Array(oldModel.n);
  collapsed.fill(1);
  const obj = Object.create(GraphView.prototype) as Record<string, unknown>;
  Object.assign(obj, {
    m: oldModel,
    L: { m: oldModel, collapsed },
    keep: [],
    keepFor: null,
    root: oldRoot,
    reset: false,
    token: 0,
    building: false,
    matches: [],
    hitFor: null,
    editTimer: 0,
    dirty: true,
  });
  (obj.setRoot as (root: unknown, reset: boolean, nodes: number, active: boolean) => void)(nextRoot, false, 7, false);
  assert.equal((obj.keep as unknown[][]).length, 1, 'hidden descendants collapse into one saved root');
  const restored = (obj.restoreCollapsed as (m: typeof nextModel) => Uint8Array)(nextModel);
  assert.equal(restored[0], 1);
  assert.equal(restored.slice(1).some(Boolean), false);

  const stale = (oldRoot.v as JNode[])[0] as never;
  Object.assign(obj, {
    m: nextModel,
    L: { m: nextModel, collapsed: new Uint8Array(nextModel.n), shown: new Uint8Array(nextModel.n).fill(1) },
    root: nextRoot,
    card: -1,
    row: -1,
    building: false,
    dirty: false,
    pending: null,
    announce: () => {},
    redraw: () => {},
    reveal: () => {},
  });
  (obj.select as (n: never) => void)(stale);
  assert.ok((obj.card as number) >= 0, 'stale node resolves to the rebuilt card');
});

/** Whether nothing keeps `ref`'s target alive any more (after a full collection). */
async function collected(ref: WeakRef<object>) {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  // (A WeakRef keeps its target until the job that made it ends.)
  await new Promise((done) => setImmediate(done));
  gc();
  return ref.deref() === undefined;
}

test('graph render: a painted document is let go once painting is released', async () => {
  const paintOne = () => {
    const root = parse(JSON.stringify({ users: [{ name: 'Ada', roles: ['author'] }, { name: 'Grace', id: 7 }] })).root!;
    paint(fakeCtx, layoutGraph(buildModel(root, 7.2)), fakeTheme, { x: -MARGIN, y: -MARGIN, s: 1 }, 1200, 800, noSelection());
    return new WeakRef(root);
  };
  const kept = paintOne();
  assert.equal(await collected(kept), false, 'the texts of the last frame are kept for the next');
  releasePaint();
  assert.equal(await collected(kept), true);
  // And painting again after a release works as before.
  const L = features(20);
  const before = count(L, { x: -MARGIN, y: -MARGIN, s: 1 }, 4000, 4000).text;
  releasePaint();
  assert.equal(count(L, { x: -MARGIN, y: -MARGIN, s: 1 }, 4000, 4000).text, before);
});

test('graph view: an adopted layout lets go of the one collapsed cards were read from', () => {
  const root = parse('{"a":{"b":1},"c":{"d":2}}').root!;
  const m = buildModel(root, 7.2);
  const collapsed = new Uint8Array(m.n);
  collapsed[1] = 1;
  const L = layoutGraph(m, collapsed);
  const obj = Object.create(GraphView.prototype) as Record<string, unknown>;
  Object.assign(obj, { m, L, keep: [], keepFor: null, root, reset: false, token: 0, building: false, matches: [], hitFor: null, editTimer: 0, dirty: false });
  (obj.setRoot as (root: unknown, reset: boolean, nodes: number, active: boolean) => void)(parse('{"a":{"b":3},"c":{"d":2}}').root!, false, 5, false);
  assert.equal(obj.keepFor, L);
  assert.equal((obj.keep as unknown[]).length, 1);
  const next = layoutGraph(buildModel(obj.root as JNode, 7.2), (obj.restoreCollapsed as (m: unknown) => Uint8Array)(buildModel(obj.root as JNode, 7.2)));
  Object.assign(obj, { card: -1, row: -1, pending: null, q: '', camSet: true, vw: 800, vh: 600, redraw: () => {} });
  (obj.adopt as (L: unknown) => void)(next);
  assert.equal(obj.L, next);
  assert.equal(obj.keepFor, null);
  assert.deepEqual(obj.keep, []);
  // A different document forgets the old one's collapsed cards and layout at once.
  Object.assign(obj, { keepFor: next, keep: [['a']], mini: { release() {} } });
  (obj.setRoot as (root: unknown, reset: boolean, nodes: number, active: boolean) => void)(parse('[1]').root!, true, 2, false);
  assert.equal(obj.keepFor, null);
  assert.equal(obj.L, null);
});

test('graph model and view operations stay depth-safe at 100,000 levels', () => {
  const depth = 100_000;
  const text = '{"a":'.repeat(depth) + '0' + '}'.repeat(depth);
  const oldRoot = parse(text).root!;
  const nextRoot = parse(text).root!;
  const m = buildModel(oldRoot, 7.2, depth + 1);
  const next = buildModel(nextRoot, 7.2, depth + 1);
  const matches = m.node.filter((n) => n.key === 'a');
  const obj = Object.create(GraphView.prototype) as Record<string, unknown>;
  Object.assign(obj, {
    m,
    matches,
    hitFor: null,
    hitRow: null,
    hitCard: null,
  });
  (obj.ensureHits as () => void)();
  const hitCount = (obj.hitCard as Uint8Array).reduce((n, v) => n + v, 0) + (obj.hitRow as Uint8Array).reduce((n, v) => n + v, 0);
  assert.equal(hitCount, matches.length);
  Object.assign(obj, {
    L: { m, collapsed: new Uint8Array(m.n).fill(1) },
    keep: [],
    keepFor: null,
    root: oldRoot,
    reset: false,
    token: 0,
    building: false,
    editTimer: 0,
  });
  (obj.setRoot as (root: unknown, reset: boolean, nodes: number, active: boolean) => void)(nextRoot, false, depth + 1, false);
  const restored = (obj.restoreCollapsed as (model: typeof next) => Uint8Array)(next);
  assert.equal(restored[0], 1);
  assert.equal(restored.slice(1).some(Boolean), false);
  const foreign = parse(text).root!;
  assert.deepEqual(locate(m, foreign), { card: -1, row: -1 });
});
