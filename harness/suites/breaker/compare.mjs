// Compare: the Changes list and the RFC 6902 JSON Patch are exact for tricky pairs (pointer escaping,
// lossless numbers, duplicate keys, key order, type changes, Unicode normalisation, inserts in arrays),
// the same in every engine. A patch applied to the original gives the modified document.
import { defaults, test } from '../../lib/api.mjs';
import { golden, load, until } from './_helpers.mjs';

// WebKit reports "ResizeObserver loop completed with undelivered notifications" on opening Compare (on
// main too, see features/context-menu-compare): page errors are checked here without it.
defaults({ engines: 'all', tags: ['breaker'], timeout: 120_000, width: 1280, height: 900, allowErrors: true });

const PAIRS = {
  basic: ['{"id":7,"name":"Ada","role":"admin","tags":["beta"],"meta":{"updatedAt":"2026-10-14T09:00:00Z"}}', '{"name":"Ada","id":7,"role":"editor","tags":["beta","staff"],"meta":{"updatedAt":"2026-10-15T08:30:00Z"}}'],
  pointer: ['{"a/b":{"c~d":1,"":{"~1":"x"}},"arr":[0]}', '{"a/b":{"c~d":2,"":{"~1":"y"}},"arr":[0,1]}'],
  numbers: ['[1e9007199254740992,9007199254740993,1.0,-0,100000000000000000000001]', '[1e9007199254740993,9007199254740992,1,0,100000000000000000000000]'],
  types: ['{"a":"1","b":null,"c":[],"d":{},"e":true}', '{"a":1,"b":false,"c":{},"d":[],"e":"true"}'],
  unicode: [JSON.stringify({ k: 'café', 'café': 1 }), JSON.stringify({ k: 'café', 'café': 1 })],
  dupes: ['{"a":1,"a":2,"b":1}', '{"a":2,"b":1}'],
  'array-insert': ['[{"id":1},{"id":2},{"id":3}]', '[{"id":1},{"id":9},{"id":2},{"id":3}]'],
  scalars: ['"text"', '["text"]'],
};

/** Opens Compare with `left` in the input and `right` in the second editor; waits for its result. */
async function compare(page, left, right) {
  await load(page, left);
  await page.keyboard.press('Alt+6');
  await until(page, () => !!window.__vis('.pane-cmp .ed-body') || null, null, { timeout: 15_000 });
  await page.evaluate((t) => {
    const ta = document.getElementById('input2');
    ta.focus();
    ta.value = t;
    ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
  }, right);
  // Done: the list shows rows, or the panel says the documents are the same / can't be compared.
  return until(page, () => {
    const c = window.__vis('.cmp');
    if (!c || c.classList.contains('stale')) return null;
    const rows = [...c.querySelectorAll('.cmp-list [data-i]')];
    const empty = c.querySelector('.cmp-empty');
    if (!rows.length && !empty) return null;
    return { rows: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()), empty: empty?.textContent.replace(/\s+/g, ' ').trim() ?? null };
  }, null, { timeout: 20_000 });
}

async function patch(page) {
  await page.evaluate(() => (window.__clip = null));
  await page.locator('.cmp:visible button[aria-label="Copy JSON Patch"]').click();
  return until(page, () => window.__clip, null, { timeout: 5000 });
}

/** JSON text with object keys sorted (Compare ignores key order by default). */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** Applies an RFC 6902 patch (add / remove / replace) to a JSON.parse'd value. */
function apply(doc, ops) {
  const root = { v: structuredClone(doc) };
  for (const op of ops) {
    const parts = op.path === '' ? [] : op.path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent = root;
    let key = 'v';
    for (const p of parts) {
      parent = parent[key];
      key = Array.isArray(parent) && p !== '-' ? Number(p) : p;
    }
    if (op.op === 'remove') Array.isArray(parent) ? parent.splice(key, 1) : delete parent[key];
    else if (op.op === 'add' && Array.isArray(parent)) parent.splice(key === '-' ? parent.length : key, 0, op.value);
    else parent[key] = op.value;
  }
  return root.v;
}

for (const [name, [left, right]] of Object.entries(PAIRS)) {
  test(`${name}: the Changes list and the JSON Patch are exact`, async (t) => {
    const { page } = t;
    await t.open('/');
    const result = await compare(page, left, right);
    t.assert(result, 'Compare shows a result', await page.evaluate(() => window.__vis('.cmp')?.textContent.slice(0, 200)));
    const p = result.rows.length ? await patch(page) : null;
    golden(t, `compare/${name}`, { ...result, patch: p }, `${name}: matches the golden file`);
    // Lossless pairs can't go through JSON.parse; the others must round-trip.
    if (p && !['numbers', 'dupes'].includes(name)) {
      const got = apply(JSON.parse(left), JSON.parse(p));
      t.check(canon(got) === canon(JSON.parse(right)), 'the patch turns the original into the modified document (key order aside)', JSON.stringify(got));
    }
    const errs = t.errors.filter((e) => !/ResizeObserver loop/.test(e));
    t.check(!errs.length, 'no page errors', errs.slice(0, 3));
  });
}

test('identical documents with different key order and whitespace: no differences', async (t) => {
  const { page } = t;
  await t.open('/');
  const result = await compare(page, '{"a":1,"b":[1,2]}', '{\n  "b": [1, 2],\n  "a": 1\n}');
  t.check(result && !result.rows.length && /no differences|identical|same/i.test(result.empty ?? ''), 'Compare says they are the same', result);
});
