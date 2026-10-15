import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_H, TallScroll } from '../lib/engine/tall';

/** A scroller whose scrollTop is clamped and rounded like a browser's. */
function scroller(clientHeight = 800) {
  const listeners = new Map<string, EventListener>();
  let st = 0;
  const spacer = { style: { height: '' } } as unknown as HTMLElement;
  const el = {
    clientHeight,
    get scrollTop() {
      return st;
    },
    set scrollTop(v: number) {
      const max = Math.max(0, parseFloat(spacer.style.height || '0') - clientHeight);
      st = Math.round(Math.max(0, Math.min(max, v)));
    },
    scrolls: 0,
    addEventListener: (t: string, f: EventListener) => listeners.set(t, f),
    removeEventListener: (t: string) => listeners.delete(t),
    dispatchEvent() {
      el.scrolls++;
      return true;
    },
    listeners,
  };
  return { el, spacer, sc: new TallScroll(el as unknown as HTMLElement) };
}

test('short content scrolls 1:1 with no listeners', () => {
  const { el, spacer, sc } = scroller();
  sc.fit(100_000, spacer);
  assert.equal(spacer.style.height, '100000px');
  sc.top = 5000;
  assert.equal(el.scrollTop, 5000);
  assert.equal(sc.top, 5000);
  assert.equal(sc.shift, 0);
  assert.equal(el.listeners.size, 0);
});

test('tall content caps the spacer and maps the whole range', () => {
  const { el, spacer, sc } = scroller();
  const h = 80_000_000;
  sc.fit(h, spacer);
  assert.equal(spacer.style.height, MAX_H + 'px');
  assert.ok(el.listeners.has('wheel') && el.listeners.has('keydown'));
  // Set positions are exact, though scrollTop is rounded.
  sc.top = 12_345_677;
  assert.equal(sc.top, 12_345_677);
  // Content y is drawn where the viewport is: y - top + scrollTop.
  assert.equal(sc.top + sc.shift, el.scrollTop);
  // The end of the content is reachable.
  sc.top = h;
  assert.equal(sc.top, h - el.clientHeight);
  assert.equal(el.scrollTop, MAX_H - el.clientHeight);
  // Dragging the scrollbar halfway shows the middle of the content.
  el.scrollTop = (MAX_H - el.clientHeight) / 2;
  assert.ok(Math.abs(sc.top - (h - el.clientHeight) / 2) < 10);
});

test('the wheel moves tall content pixel for pixel', () => {
  const { el, spacer, sc } = scroller();
  sc.fit(80_000_000, spacer);
  sc.top = 1_000_000;
  const wheel = el.listeners.get('wheel')!;
  let prevented = false;
  wheel({ deltaY: 3, deltaX: 0, deltaMode: 0, preventDefault: () => (prevented = true) } as unknown as Event);
  assert.ok(prevented);
  assert.equal(sc.top, 1_000_003);
  // scrollTop didn't change for a 3px move, so the view is told to redraw.
  assert.equal(el.scrolls, 1);
});

test('the content offset survives height changes in and out of scaling', () => {
  const { el, spacer, sc } = scroller();
  sc.fit(10_000_000, spacer);
  sc.top = 9_000_000;
  sc.fit(40_000_000, spacer);
  assert.equal(sc.top, 9_000_000);
  sc.top = 12_000_000;
  sc.fit(14_000_000, spacer);
  assert.equal(el.scrollTop, 12_000_000);
  assert.equal(sc.top, 12_000_000);
  assert.equal(el.listeners.size, 0);
});
