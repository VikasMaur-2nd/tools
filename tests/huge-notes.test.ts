/**
 * The UI's round-5 notes (UI-NOTES-FOR-CORE.md 14–16):
 * 14. a kept session found after `ready` is said through the watch stream (onSummary), so nothing polls;
 * 15. replaceNode never repairs: strict JSON is re-indented, anything else goes in as typed;
 * 16. `steps`: the changes applied, as undo counts them (typing runs joined, steps the history let go of).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/json/tape-parser';
import { HugeEditor } from '../lib/huge/editor';
import { open } from './huge-oracle';

const enc = new TextEncoder();
const dec = new TextDecoder();

const docText = JSON.stringify({ meta: { n: 3 }, records: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }] }, null, 2);

test('notes 15: replaceNode puts strict JSON re-indented, anything else as typed (never repaired); node edits refuse it', () => {
  const bytes = enc.encode(docText);
  for (const typed of ['nul', 'tru', '{"x": 1,}', '{"x": 1', '[1 2]', "'s'", '1 2', '// c\n1', 'NaN', '"open']) {
    const d = open(bytes, 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
    const ed = new HugeEditor(d);
    const node = d.resolve(['meta'])!.node;
    ed.replaceNode(node, typed);
    const want = docText.replace('{\n    "n": 3\n  }', typed);
    assert.equal(dec.decode(d.src.read(0, d.src.size)), want, `as typed: ${JSON.stringify(typed)}`);
    assert.ok(d.summary().error, `the document says where it's wrong: ${JSON.stringify(typed)}`);
    // Its error is the normal path's for the same text.
    assert.equal(d.summary().error!.msg, parse(want).head.error?.message ?? d.summary().error!.msg);
    ed.undo();
    assert.equal(dec.decode(d.src.read(0, d.src.size)), docText);
    assert.equal(d.summary().error, null);
    // Node edits take strict JSON only.
    assert.throws(() => ed.setValue(d.resolve(['meta', 'n'])!.node, typed), /Invalid JSON/);
    assert.throws(() => ed.insert(d.resolve(['records'])!.node, 0, typed), /Invalid JSON/);
  }
  // Strict JSON: written as the document is.
  const d = open(bytes, 'a.json', { every: 64, big: 1 << 12, window: 64, pageBytes: 1 << 16 });
  new HugeEditor(d).replaceNode(d.resolve(['meta'])!.node, '{"n":4,"m":[1,2]}');
  assert.equal(dec.decode(d.src.read(0, d.src.size)), docText.replace('{\n    "n": 3\n  }', '{\n    "n": 4,\n    "m": [\n      1,\n      2\n    ]\n  }'));
  assert.equal(d.summary().error, null);
});
