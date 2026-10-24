import test from 'node:test';
import assert from 'node:assert/strict';
import { editorElement, fakeDocument, FakeElement, installDom, observing } from './dom';
import { Editor } from '../lib/engine/editor';
import { TreeView } from '../lib/engine/tree';
import { TableView } from '../lib/engine/table';
import { CodeView } from '../lib/engine/codeview';
import { parse } from '../lib/json/parser';

// Every view lets go of its element when destroyed (the engine starts again on the same page, the mini
// editor remounts): no listeners left on it or the document, no observer still watching it.
installDom();

/** An element with children of these classes, as the views' markup has them. */
function host(...classes: string[]) {
  const el = new FakeElement();
  for (const c of classes) el.appendChild(new FakeElement()).className = c;
  return el;
}

const left = (...els: FakeElement[]) => els.reduce((n, e) => n + e.listening, 0) + fakeDocument.listening;

test('a destroyed editor leaves no listeners or observers', () => {
  const { el, ta } = editorElement();
  const ed = new Editor(el as unknown as HTMLElement, { change() {}, caret() {}, nav() {}, escape() {}, copyAll() {} });
  ed.init('[' + '1,'.repeat(9) + '1]');
  ed.destroy();
  assert.equal(left(el, ta, el.querySelector('.ed-gut')!), 0);
  assert.equal(observing.size, 0);
});

test('a destroyed tree leaves no listeners or observers', () => {
  const el = host('tv-sizer', 'tv-rows', 'tv-acts');
  const tree = new TreeView(el as unknown as HTMLElement, { select() {}, copy() {}, open() {}, escape() {}, nested() {} });
  tree.setRoot(parse('{"a":[1,2]}').root, true, 4);
  tree.destroy();
  assert.equal(left(el), 0);
  assert.equal(observing.size, 0);
});

test('a destroyed table leaves no listeners or observers', () => {
  const el = host('tb-head', 'tb-sizer', 'tb-rows', 'tb-empty');
  const table = new TableView(el as unknown as HTMLElement, { select() {}, drill() {} });
  table.setNode(parse('[{"a":1},{"a":2}]').root);
  table.destroy();
  assert.equal(left(el), 0);
  assert.equal(observing.size, 0);
});

test('a destroyed code view leaves no listeners or observers', () => {
  const el = host('cv-sizer', 'cv-rows');
  const code = new CodeView(el as unknown as HTMLElement);
  code.setText('a\nb', (t) => t);
  code.destroy();
  assert.equal(left(el), 0);
  assert.equal(observing.size, 0);
});
