import test from 'node:test';
import assert from 'node:assert/strict';
import { radioKeys, tabStop } from '../lib/radio';

test('radio groups: the chosen option is the one Tab stop, or the first that can be chosen', () => {
  assert.equal(tabStop([{ checked: false }, { checked: true }, { checked: false }]), 1);
  assert.equal(tabStop([{ checked: false, disabled: true }, { checked: false }, { checked: false }]), 1);
  assert.equal(tabStop([{ checked: true, disabled: true }, { checked: false }]), 1);
  assert.equal(tabStop([{ checked: false, disabled: true }, { checked: false, disabled: true }]), -1);
});

test('radio groups: arrow keys choose and focus the next option that is not disabled, wrapping round', () => {
  let focused = -1;
  const radios = [0, 1, 2, 3].map((i) => ({ disabled: i === 2, focus: () => void (focused = i), closest() { return this; } }));
  const group = { querySelectorAll: () => radios };
  const press = (key: string, from: number, target: unknown = radios[from]) => {
    let picked = -1;
    let prevented = false;
    focused = -1;
    radioKeys({ key, target: target as EventTarget, currentTarget: group as unknown as EventTarget, preventDefault: () => void (prevented = true) }, (i) => (picked = i));
    return [picked, focused, prevented];
  };
  assert.deepEqual(press('ArrowRight', 1), [3, 3, true], 'skips the disabled option');
  assert.deepEqual(press('ArrowDown', 3), [0, 0, true], 'wraps round');
  assert.deepEqual(press('ArrowLeft', 0), [3, 3, true]);
  assert.deepEqual(press('ArrowUp', 3), [1, 1, true]);
  assert.deepEqual(press('Enter', 1), [-1, -1, false], 'other keys are left alone');
  // A key on something in the group that isn't one of its radios (a colour field) keeps its own meaning.
  assert.deepEqual(press('ArrowRight', 1, { closest: () => null }), [-1, -1, false]);
  // Nothing else can be chosen: the choice stays.
  const only = [{ disabled: false, focus() {}, closest() { return this; } }, { disabled: true, focus() {}, closest() { return this; } }];
  let picked = -1;
  radioKeys({ key: 'ArrowRight', target: only[0] as unknown as EventTarget, currentTarget: { querySelectorAll: () => only } as unknown as EventTarget, preventDefault() {} }, (i) => (picked = i));
  assert.equal(picked, -1);
});
