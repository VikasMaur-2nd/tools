import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, fakeDocument, frames, installDom } from './dom';
import { Editor, loadSurface } from '../lib/engine/editor';

// A destroyed editor must not touch its element again: the page may have given it to a new editor
// (MiniEditor remounts, the engine re-initializing). Its own pending work (the big-document
// editor's module, the code font, a big document's fold scan) finishes after it is gone.
installDom();
let fontsReady!: () => void;
(fakeDocument as unknown as { fonts: unknown }).fonts = {
  ready: new Promise<void>((r) => (fontsReady = r)),
  addEventListener() {},
  removeEventListener() {},
};

const events = { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));
const big = (lines: number) => '[\n' + Array.from({ length: lines }, (_, i) => `  {\n    "k": ${i}\n  }`).join(',\n') + '\n]';

test("a destroyed editor doesn't switch to the big-document editor when its module arrives", async () => {
  const { el } = editorElement();
  const a = new Editor(el as unknown as HTMLElement, events);
  // Big enough for the big-document editor, whose module isn't here yet: it starts loading.
  a.setValue('[' + '1,'.repeat(150_000) + '1]');
  a.destroy();
  const b = new Editor(el as unknown as HTMLElement, events);
  b.init('{"small": true}');
  await loadSurface();
  await tick();
  assert.equal((a as unknown as { surface: unknown }).surface, null);
  assert.ok(!el.classList.contains('surface'), "the new editor's element is left alone");
});

test("a destroyed editor doesn't redraw when the code font arrives", async () => {
  const { el } = editorElement();
  const hl = el.querySelector('.ed-hl')!;
  const a = new Editor(el as unknown as HTMLElement, events);
  a.init('"old"');
  a.destroy();
  const b = new Editor(el as unknown as HTMLElement, events);
  b.init('"new"');
  b.destroy();
  hl.innerHTML = '';
  fontsReady();
  await tick();
  frames();
  assert.equal(hl.innerHTML, '', 'nothing drawn after both were destroyed');
});

test("a destroyed editor's fold scan stops", async () => {
  const { el } = editorElement();
  const hl = el.querySelector('.ed-hl')!;
  const a = new Editor(el as unknown as HTMLElement, events);
  // Enough lines that their folds are found in slices after the document shows.
  a.setValue(big(70_000), 0, true);
  const pending = () => (a as unknown as { foldsFor: unknown }).foldsFor !== null;
  assert.ok(pending(), 'the scan is pending');
  a.destroy();
  hl.innerHTML = '';
  for (let k = 0; k < 200 && pending(); k++) await tick();
  frames();
  assert.equal(hl.innerHTML, '', 'nothing drawn after it was destroyed');
});
