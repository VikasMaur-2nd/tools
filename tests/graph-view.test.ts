import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/parser';
import { G, buildModel } from '../lib/graph/model';
import { layoutGraph } from '../lib/graph/layout';
import { LOD_SKEL, LOD_TEXT, ZOOM_MAX, fitCam, fitScale, follow, initialCam, lerpCam, lodOf, minZoom, zoomAt } from '../lib/graph/camera';
import { compactNum, partAt } from '../lib/graph/render';
import { isDark } from '../lib/graph/theme';

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
