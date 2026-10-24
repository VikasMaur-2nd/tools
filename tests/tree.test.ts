import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeView, type TreeEvents } from '../lib/engine/tree';
import { ARR, MAX_DEPTH, type JNode, kids, parse } from '../lib/json/parser';
import { PRIVATE } from '../lib/analytics';
import { OldTreeView } from './oracle/tree';

// Run the real constructor and model with a hidden viewport. No browser globals or
// renderer are needed for expansion, selection, scrolling or edit restoration.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

class Viewport extends EventTarget {
  hidden = true;
  clientHeight = 480;
  scrollTop = 0;
  querySelector() { return { style: {} }; }
}

const events: TreeEvents = { select() {}, copy() {}, open() {}, escape() {}, nested() {} };
function view() {
  const el = new Viewport();
  return { el, tree: new TreeView(el as unknown as HTMLElement, events) };
}

function document(text: string) {
  const res = parse(text);
  assert.equal(res.error, null);
  assert.ok(res.root);
  const all: JNode[] = [];
  const stack = [res.root];
  while (stack.length) {
    const n = stack.pop()!;
    all.push(n);
    if (n.t >= ARR) for (let i = kids(n).length - 1; i >= 0; i--) stack.push(kids(n)[i]);
  }
  return { ...res, root: res.root, all };
}

const identity = (n: JNode | null) => n && [n.s, n.e, n.d, n.key, n.t, n.x];

test('Tree expansion matches the frozen path-string model through random actions and reparsed edits', () => {
  let seed = 0x7418b;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const names = ['', 'a', '0', '1', '__proto__', 'a.b', 'x/y', '~', '\u0001', 'a\u0001b', 'b', '🌳'];
  const generate = (depth = 0): string => {
    if (depth > 5 || random(4) === 0) return ['null', 'true', '2', '"leaf"'][random(4)];
    const object = random(2) === 0;
    const values = Array.from({ length: random(5) }, () => (object ? JSON.stringify(names[random(names.length)]) + ':' : '') + generate(depth + 1));
    return (object ? '{' : '[') + values.join(',') + (object ? '}' : ']');
  };
  const fixtures = [
    '{"a\\u0001b":{"v":{}},"a":{"b":{"v":{}}},"":{"":{}},"0":{},"0":{"dup":[]}}',
    '[[{"0":{},"a":[]},[]],{"0":[[]]}]',
    '0', '{}', '[]',
    ...Array.from({ length: 80 }, () => generate()),
  ];
  for (const initial of fixtures) {
    const { tree, el } = view();
    const sc = { top: 0, fit() {} };
    const old = new OldTreeView(el, sc);
    let text = initial;
    let current = document(text);
    let previous = document(text);
    const setRoot = (reset: boolean, active: boolean) => {
      current = document(text);
      previous = document(text);
      // Exercise all three initial expansion policies even with small fixtures.
      const nodes = [current.nodes, 50_001, 500_001][random(3)];
      tree.setRoot(current.root, reset, nodes, active);
      old.setRoot(previous.root, reset, nodes, active);
    };
    setRoot(true, true);
    for (let step = 0; step < 200; step++) {
      const which = random(current.all.length);
      const n = current.all[which];
      const p = previous.all[which];
      switch (random(12)) {
        case 0: case 1: case 2: {
          const open = !!random(2);
          const deep = !!random(2);
          tree.toggle(n, open, deep);
          old.toggle(p, open, deep);
          break;
        }
        case 3: tree.reveal(n); old.reveal(p); break;
        case 4: tree.expandAll(); old.expandAll(); break;
        case 5: tree.collapseAll(); old.collapseAll(); break;
        case 6: {
          const level = random(8);
          tree.expandTo(level); old.expandTo(level);
          break;
        }
        case 7: {
          const opts = { scroll: !!random(2), center: !!random(2) };
          tree.select(n, opts); old.select(p, opts);
          break;
        }
        case 8: case 9:
          // Reparse, change values, remove/reintroduce paths and change root types.
          text = [text, initial, generate(), text.replace(/leaf/g, 'edited')][random(4)];
          setRoot(random(8) === 0, !!random(2));
          break;
        case 10: tree.releaseRoot(); old.releaseRoot(); setRoot(false, false); break;
        case 11: tree.activate(); old.activate(); break;
      }
      assert.deepEqual(tree.rows.map(identity), old.rows.map(identity), `rows, fixture ${fixtures.indexOf(initial)}, step ${step}`);
      assert.deepEqual(current.all.map(n => n.x), previous.all.map(n => n.x), 'hidden expansion flags');
      assert.deepEqual(identity(tree.sel), identity(old.sel), 'selection');
      assert.equal(el.scrollTop, sc.top, 'scroll anchor');
    }
  }
});

test('Tree restores overrides through absent paths, duplicate keys and array/object edits', () => {
  const { tree } = view();
  const first = document('{"a\\u0001b":{},"a":{"b":{}},"a":{"b":{}},"0":{"child":{}}}');
  tree.setRoot(first.root, true, first.nodes);
  tree.toggle(first.all[1], false);
  tree.setRoot(document('{}').root, false);
  tree.setRoot(document('{"a\\u0001b":{"new":{}}}').root, false);
  assert.equal(tree.rows.at(-1)?.key, 'a\u0001b');
  assert.equal(tree.rows.at(-1)?.x, false, 'a collapsed key survives a reparse without it');
  tree.setRoot(document('{"a":{"b":{"new":{}}}}').root, false);
  assert.equal(tree.rows.at(-1)?.key, 'new');
  assert.equal(tree.rows.at(-2)?.x, true, 'a key holding the separator is not the path a.b');
  tree.setRoot(first.root, false);
  tree.toggle(first.all.find(n => n.key === '0')!, false);
  tree.setRoot(document('[{"new":{}}]').root, false);
  assert.equal(tree.rows.length, 2);
  assert.equal(tree.rows[1].x, false, 'numeric and string path segments retain their old identity');
});

for (const shape of ['array', 'object', 'mixed'] as const) {
  test(`Tree expansion stays depth-safe at ${MAX_DEPTH} levels of ${shape}`, t => {
    const depth = MAX_DEPTH;
    const text = shape === 'array' ? '['.repeat(depth) + '0' + ']'.repeat(depth)
      : shape === 'object' ? '{"a":'.repeat(depth) + '0' + '}'.repeat(depth)
        : '[{"a":'.repeat(depth / 2) + '0' + '}]'.repeat(depth / 2);
    let res = document(text);
    let leaf = res.all.at(-1)!;
    const { tree, el } = view();
    tree.setRoot(res.root, true, res.nodes);
    const timed = (name: string, fn: () => void) => {
      const start = performance.now();
      fn();
      const ms = performance.now() - start;
      t.diagnostic(`${name}: ${ms.toFixed(1)} ms`);
      assert.ok(ms < 2000, `${name} took ${ms.toFixed(1)} ms`);
    };
    timed('flatten / expand all', () => tree.expandAll());
    assert.equal(tree.rows.length, depth + 1);
    timed('single collapse', () => tree.toggle(leaf.u!, false));
    assert.equal(tree.rows.length, depth);
    timed('single expand', () => tree.toggle(leaf.u!, true));
    assert.equal(tree.rows.length, depth + 1);
    timed('deep collapse', () => tree.toggle(res.root, false, true));
    assert.equal(tree.rows.length, 1);
    timed('deep expand', () => tree.toggle(res.root, true, true));
    assert.equal(tree.rows.length, depth + 1);
    timed('expand to level', () => tree.expandTo(3));
    assert.equal(tree.rows.length, 4);
    // As after an edit, hidden descendants start with x=false. The old model
    // deliberately leaves x untouched below collapsed rows; differential tests
    // above also cover reveal with those retained flags.
    res = document(text);
    leaf = res.all.at(-1)!;
    tree.setRoot(res.root, false);
    timed('reveal', () => tree.reveal(leaf));
    assert.equal(tree.rows.length, depth + 1);
    tree.select(leaf);
    assert.equal(tree.sel, leaf);
    assert.equal(el.scrollTop, depth * 24 - el.clientHeight + 24);
    const reparsed = document(text);
    timed('restore after edit', () => tree.setRoot(reparsed.root, false));
    assert.equal(tree.rows.length, depth + 1);
    timed('collapse all', () => tree.collapseAll());
    assert.equal(tree.rows.length, 2);
    // F51: selecting from Table or Graph must also be safe with the Tree hidden.
    const hidden = document(text);
    tree.setRoot(hidden.root, false);
    timed('hidden Tree selection', () => tree.select(hidden.all.at(-1)!));
    assert.equal(tree.rows.length, depth + 1);
    tree.releaseRoot();
    tree.setRoot(res.root, false, res.nodes, false);
    tree.select(leaf);
    assert.equal(tree.rows.length, 0, 'inactive Tree defers flattening');
    timed('activate pending selection', () => tree.activate());
    assert.equal(tree.sel, leaf);
    assert.equal(tree.rows.length, depth + 1);
  });
}

test('Tree row indentation is unchanged through depth 30 and deeper rows expose their true depth', () => {
  const res = document('['.repeat(100) + '0' + ']'.repeat(100));
  const { tree } = view();
  const render = tree as unknown as { row(n: JNode, i: number): string };
  for (const n of res.all) {
    const html = render.row(n, n.d);
    assert.ok(html.includes(`aria-level="${n.d + 1}"`));
    if (n.d <= 30) {
      assert.ok(html.includes(`padding-left:${n.d * 16 + 6}px`));
      assert.ok(!html.includes('tv-depth'));
    } else {
      assert.ok(html.includes('var(--tv-indent)'));
      assert.ok(html.includes(`class="tv-depth ${PRIVATE}" aria-hidden="true">↳${n.d}</span>`));
    }
  }
});

test('A key holding the path separator is one key, not a nested path', () => {
  const text = '{"a\\u0001b":{"x":{}},"a":{"b":{"y":{}}}}';
  const find = (all: JNode[], ...path: string[]) => all.find((n) => {
    let p: JNode | null = n;
    for (let i = path.length - 1; i >= 0; i--, p = p.u) if (!p || p.key !== path[i]) return false;
    return !!p && !p.u;
  })!;
  for (const [collapse, other] of [[['a\u0001b'], ['a', 'b']], [['a', 'b'], ['a\u0001b']]]) {
    const { tree } = view();
    const first = document(text);
    tree.setRoot(first.root, true, first.nodes);
    tree.toggle(find(first.all, ...collapse), false);
    const next = document(text);
    tree.setRoot(next.root, false);
    assert.equal(find(next.all, ...collapse).x, false, `${collapse.join('.')} stays collapsed`);
    assert.equal(find(next.all, ...other).x, true, `${other.join('.')} stays open`);
  }
});
