/*
 * Where huge mode's Save writes (lib/huge/save-plan.ts): never through the save picker onto the opened file
 * unchecked (Chromium may empty a file picked there: UI-NOTES 17). Every way, with the browser faked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { editedName, planSave, readable, sameFile, saveRoute, type SaveChoice, type SaveEnv } from '../lib/huge/save-plan';

test('the route: in place with a handle, asked without one (Chromium), Save as a new file, else a download', () => {
  const r = (as: boolean, handle: boolean, pickers: boolean) => saveRoute({ as, handle, openPicker: pickers, savePicker: pickers });
  assert.equal(r(false, true, true), 'in_place');
  assert.equal(r(false, false, true), 'ask');
  assert.equal(r(true, true, true), 'new');
  assert.equal(r(true, false, true), 'new');
  assert.equal(r(false, false, false), 'download');
  assert.equal(r(true, false, false), 'download');
});

test('a new file is never suggested under the opened name', () => {
  assert.equal(editedName('big.json'), 'big (edited).json');
  assert.equal(editedName('logs.2026.jsonl'), 'logs.2026 (edited).jsonl');
  assert.equal(editedName('data'), 'data (edited)');
  assert.equal(editedName('.json'), '.json (edited)');
  const f = { name: 'big.json', size: 10, lastModified: 5 };
  assert.ok(sameFile(f, { ...f }));
  assert.ok(!sameFile(f, { ...f, size: 0 }), 'emptied');
  assert.ok(!sameFile(f, { ...f, lastModified: 6 }), 'changed');
  assert.ok(!sameFile(f, { ...f, name: 'other.json' }));
});

test('the opened file readable: its first and last bytes; a file that no longer reads, or ends early, is not', async () => {
  assert.equal(await readable(new Blob(['{"a": 1}'])), true);
  assert.equal(await readable(new Blob([])), true, 'an empty file opened empty');
  // (Chromium: a File whose file changed since it was opened throws NotReadableError when read.)
  const gone = { size: 100, slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('changed', 'NotReadableError')) }) } as unknown as Blob;
  assert.equal(await readable(gone), false);
  const short = { size: 100, slice: (a: number) => new Blob([a === 0 ? 'x'.repeat(64) : 'x'.repeat(10)]) } as unknown as Blob;
  assert.equal(await readable(short), false);
});

/** A file as the fake browser has it. */
interface H {
  name: string;
  size: number;
  lastModified: number;
}

const OPENED: H = { name: 'big.json', size: 1000, lastModified: 42 };

/** The browser and the page faked: what's picked, allowed, answered; what was called, in order. */
function env(o: Partial<SaveEnv<H>> & { picks?: { open?: H | null; save?: H | null }; answer?: SaveChoice; allow?: boolean; emptiedOnSavePick?: boolean } = {}) {
  const calls: string[] = [];
  let opened = { ...OPENED };
  const e: SaveEnv<H> = {
    as: false,
    name: OPENED.name,
    handle: null,
    openPicker: true,
    savePicker: true,
    writable: async (h) => (calls.push(`writable ${h.name}`), o.allow ?? true),
    ask: async () => (calls.push('ask'), o.answer ?? 'overwrite'),
    pickExisting: async () => (calls.push('open picker'), o.picks?.open === undefined ? { ...OPENED } : o.picks.open),
    pickSave: async (name) => {
      calls.push(`save picker ${name}`);
      const h = o.picks?.save === undefined ? { name, size: 0, lastModified: 99 } : o.picks.save;
      // (Chromium may empty what is picked there, at once.)
      if (h && o.emptiedOnSavePick && h.name === OPENED.name) opened = { ...opened, size: 0, lastModified: 100 };
      return h;
    },
    isOpened: async (h) => sameFile(h, opened) && sameFile(opened, OPENED),
    intact: async () => (calls.push('intact'), sameFile(opened, OPENED)),
    ...o,
  };
  return { e, calls };
}

test('Save with the opened file’s handle: in place (after write permission); refused: asked instead', async () => {
  const h = { ...OPENED };
  let { e, calls } = env({ handle: h });
  assert.deepEqual(await planSave(e), { how: 'in_place', handle: h });
  assert.deepEqual(calls, ['writable big.json']);
  ({ e, calls } = env({ handle: h, allow: false, answer: 'new' }));
  const p = await planSave(e);
  assert.equal('how' in p && p.how, 'save_as');
  assert.deepEqual(calls, ['writable big.json', 'ask', 'save picker big (edited).json', 'intact']);
});

test('Overwrite: the opened file picked with the open picker, checked, then permission; never the save picker', async () => {
  const { e, calls } = env({ answer: 'overwrite' });
  assert.deepEqual(await planSave(e), { how: 'in_place', handle: OPENED });
  assert.deepEqual(calls, ['ask', 'open picker', 'writable big.json']);
});

test('Overwrite with another file picked (or this one changed since): nothing written, no permission asked', async () => {
  for (const other of [
    { ...OPENED, name: 'other.json' },
    { ...OPENED, size: 999 },
    { ...OPENED, lastModified: 43 },
  ]) {
    const { e, calls } = env({ answer: 'overwrite', picks: { open: other } });
    assert.deepEqual(await planSave(e), { stop: 'not_opened' });
    assert.deepEqual(calls, ['ask', 'open picker']);
  }
  let { e } = env({ answer: 'overwrite', allow: false });
  assert.deepEqual(await planSave(e), { stop: 'not_allowed' });
  ({ e } = env({ answer: 'overwrite', picks: { open: null } }));
  assert.deepEqual(await planSave(e), { stop: 'cancel' }, 'the picker closed');
  ({ e } = env({ answer: 'cancel' }));
  assert.deepEqual(await planSave(e), { stop: 'cancel' });
});

test('A new file: the save picker with another name; the opened file checked after the pick, before writing', async () => {
  let { e, calls } = env({ answer: 'new' });
  assert.deepEqual(await planSave(e), { how: 'save_as', handle: { name: 'big (edited).json', size: 0, lastModified: 99 } });
  assert.deepEqual(calls, ['ask', 'save picker big (edited).json', 'intact']);
  // Save as (Ctrl+Shift+S): not asked.
  ({ e, calls } = env({ as: true, handle: { ...OPENED } }));
  assert.equal(((await planSave(e)) as { how: string }).how, 'save_as');
  assert.deepEqual(calls, ['save picker big (edited).json', 'intact']);
  // The opened file picked anyway, and emptied by the picker: stopped before anything is written.
  ({ e, calls } = env({ answer: 'new', picks: { save: { ...OPENED } }, emptiedOnSavePick: true }));
  assert.deepEqual(await planSave(e), { stop: 'changed' });
  assert.deepEqual(calls, ['ask', 'save picker big (edited).json', 'intact']);
  // Picked anyway and not emptied (other browsers' pickers, or Chromium not emptying it): that is saving in place.
  ({ e } = env({ answer: 'new', picks: { save: { ...OPENED } } }));
  assert.deepEqual(await planSave(e), { how: 'in_place', handle: OPENED });
  ({ e } = env({ answer: 'new', picks: { save: null } }));
  assert.deepEqual(await planSave(e), { stop: 'cancel' });
});

test('No pickers (Firefox, Safari): a download, nothing asked', async () => {
  for (const as of [false, true]) {
    const { e, calls } = env({ as, openPicker: false, savePicker: false });
    assert.deepEqual(await planSave(e), { how: 'download', handle: null });
    assert.deepEqual(calls, []);
  }
});
