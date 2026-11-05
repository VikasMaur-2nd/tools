/**
 * Re-reading with checkpoints close together near an edit (doc.ts `dense`, round 5) put checkpoints where an old
 * spacing never did, and three older gaps showed (huge-edit sweeps, seeds 210, 223, 231); each case here, fixed:
 * - re-synced right after a top-level number at an old checkpoint that was after a string (`"…"y` moved to `0y`):
 *   a fresh read fails at the `y` with no checkpoint there;
 * - duplicate names whose first name was before where reading again started, dropped by an edit made while
 *   reading again;
 * - locate at a top-level value's end answered the top level when a checkpoint was exactly there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piecesOf } from '../lib/huge/pieces';
import { dump, enc, open, type EditTune } from './huge-oracle';

const t64: EditTune = { every: 64, big: 1 << 20, window: 64, pageBytes: 1024 };

function same(d: ReturnType<typeof open>, bytes: Uint8Array, name: string, t: EditTune, at: number[]) {
  const a = dump(d, at).out;
  const b = dump(open(bytes, name, t), at).out;
  for (let j = 0; j < Math.max(a.length, b.length); j++) assert.equal(a[j], b[j], `line ${j} of the dump`);
}

/** Replays a HUGE_DUMP of huge-edit's "reading again" test (ops, edits read no further, all read), then compares. */
function replay(json: string, at: number[]) {
  const c = JSON.parse(json) as { doc: string; name: string; t: EditTune; acts: [string, ...unknown[]][] };
  let bytes = enc.encode(c.doc);
  const d = open(bytes, c.name, c.t);
  let ops: { a: number; b: number; put: ReturnType<typeof piecesOf> }[] = [];
  for (const a of c.acts) {
    if (a[0] === 'op') {
      const [, x, y, s] = a as [string, number, number, string];
      const ins = enc.encode(s);
      ops.push({ a: x, b: y, put: piecesOf(ins) });
      const nb = new Uint8Array(bytes.length - (y - x) + ins.length);
      nb.set(bytes.subarray(0, x));
      nb.set(ins, x);
      nb.set(bytes.subarray(y), x + ins.length);
      bytes = nb;
    } else if (a[0] === 'edit') {
      d.edit(ops, 0);
      ops = [];
    } else if (a[0] === 'ask') {
      // (Queries while reading again, as the test asked them.)
      const s = d.summary();
      if (s.root && s.root.kind >= 4) d.children(s.root, 0, 3);
      d.prettyLines(0, 5, '  ', 1 << 16);
      d.locate(a[1] as number);
      d.step(0);
    } else if (a[0] === 'done') {
      d.step(Infinity);
      same(d, bytes, c.name, c.t, at);
    }
  }
  return d;
}

test('re-sync: not right after a top-level number where the next byte doesn\'t end it (a checkpoint after a string moved there)', () => {
  // (Edits read again with close checkpoints leave one right after a string the document breaks at, `"…"y`; the
  // last edit makes that string `0`: `0y`.)
  replay(CASE231, [0, 1, 2, 5]);
});

test('duplicate names an edit made while reading again would have dropped (their first name before where it started)', () => {
  const d = replay(CASE223, [0, 1300, 1415, 1430]);
  assert.ok(d.summary().warnings.some((w) => w.pos === 1430), 'the duplicate before the edits is still there');
});

test('locate at a top-level value\'s end: the same whether a checkpoint is there or not', () => {
  // (Top-level values with a comma between them (a checkpoint at the comma), a line each, or none at all (`}{`:
  // the end of one is the next one's start).)
  for (const sep of [',\n', '\n', ',', '']) {
    const doc = Array.from({ length: 60 }, (_, i) => JSON.stringify({ id: i, v: 'x'.repeat(i % 7) })).join(sep);
    const bytes = enc.encode(doc);
    const close = open(bytes, 'a.json', t64);
    const far = open(bytes, 'a.json', { ...t64, every: 1 << 20 });
    let ends = 0;
    for (let p = 1; p < bytes.length; p++) {
      if (bytes[p - 1] !== 125) continue;
      ends++;
      assert.deepEqual(close.locate(p), far.locate(p), `locate(${p}), between values ${JSON.stringify(sep)}`);
    }
    assert.ok(ends >= 59, `value ends: ${ends}`);
  }
});

/** The huge-edit "reading again" case of seed 223 (HUGE_DUMP): three edits before reading on, the last before the others. */
const CASE223 = "{\"doc\": \"{\\\"id\\\": 652, \\\"v\\\": \\\"s40\\\", \\\"x\\\": []}\\n{\\\"id\\\": 288, \\\"v\\\": \\\"s70\\\", \\\"x\\\": \\\"\u007f\\\"}\\n{\\\"id\\\": 805, \\\"v\\\": \\\"s35\\\", \\\"x\\\": -123456789012345}\\n{\\\"id\\\": 971, \\\"v\\\": \\\"s7\\\", \\\"x\\\": null}\\n{\\\"id\\\": 47, \\\"v\\\": \\\"s92\\\", \\\"x\\\": 1}\\n{\\\"id\\\": 313, \\\"v\\\": \\\"s2\\\", \\\"x\\\": {\\t\\\"\\\":false\\n  }}\\n{\\\"id\\\": 524, \\\"v\\\": \\\"s26\\\", \\\"x\\\": { \\n  \\\"k30\\\"\\r\\n:9007199254740993, \\\"name\\\"\\r\\n:[\\r\\n\\n  \\\"\u2028\\\"\\n  ]\\t,\\n\\\"q\\\\\\\"\\\"\\n:false,\\n\\\"k32\\\":[\\n\\\"\ud83d\ude00\\\"\\n] ,\\t\\\"k\\\\n\\\":\\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\"\\n  }}\\n{\\\"id\\\": 162, \\\"v\\\": \\\"s79\\\", \\\"x\\\": { \\\"\u4e2d\\\"\\n: \\\"\\\\uDFFF\\\",\\t\\\"\ud83d\ude00\\\":\\r\\n\\\"\\\\uD83D\\\\uDE00\\\\b\\\\f\\\\n\\\\r\\\\t\\\"\\n  ,\\\"value\\\"\\t: {\\n\\\"k\\\\n\\\":100\\n,\\n\\\"k\\\\n\\\"\\t:\\t0.1,\\r\\n\\\"k19\\\":\\r\\n\\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\"\\r\\n,\\\"x\\\":0.1\\r\\n,\\n\\\"0\\\": -0.0}\\r\\n, \\\"k34\\\"\\r\\n:[\\t\\r\\n\\\"\u007f\\\",\\t\\\"a\\\",\\\"\\\\\\\\\\\"]\\r\\n,\\\"\u4e2d\\\"\\r\\n:\\n\\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\"\\n  ,\\n  \\\"k34\\\"\\t:\\r\\n9007199254740993 , \\\"q\\\\\\\"\\\": []\\t,\\\"\\\\u0041b\\\"\\t:\\r\\n5e-324,\\n\\\"\\\\u0041b\\\":\\n\\\"\\\\ud800\\\",\\t\\\"k28\\\"\\n  :\\r\\ntrue\\t,\\\"type\\\":\\r\\n{\\\"\ud83d\ude00\\\":\\n  1.0, \\\"long key with spaces\\\" :\\t9007199254740993\\t,\\r\\n\\\"k20\\\":\\n  \\\"\u00e9\\\",\\\"value\\\"\\r\\n:1e400,\\\"x\\\"\\n  :\\\"\u4e2d\u6587\\\"\\n},\\n  \\\"k\\\\n\\\":[ \\n-12\\t,\\n\\\"hello world\\\"\\n,\\\"\ud83d\ude00\\\"\\n  ,0.1,5e-324\\t,-0\\t,1234567890123456,\\n  \\\"\u2028\\\",\\n  -0.0,\\n\\\"\\\\uD83D\\\\uDE00\\\"\\r\\n,\\n\\\"hello world\\\"\\r\\n,\\r\\n\\\"\\\\ud800\\\"\\t,\\n  false ,-0.0\\t,\\n123456789012345\\r\\n,0.000001, null,\\n  true\\n  ,\\\"a\\\"\\n,\\\"hello world\\\" ,\\r\\n\\\"\u2028\\\",\\n-2.5e+10\\r\\n,123456789012345\\r\\n, \\\"\\\\uDFFF\\\"\\t,\\t\\\"\\\\uDFFF\\\" ,\\\"hello world\\\",\\r\\nnull ,\\\"\\\"\\r\\n],\\\"\\\": -0.0\\r\\n,\\n  \\\"k39\\\" :\\\"\u2028\\\",\\\"01\\\":\\t\\\"\\\\uD83D\\\\uDE00\\\",\\\"\ud83d\ude00\\\" :\\\"\u00e9\\\",\\n  \\\"type\\\": \\\"\\\\uD83D\\\\uDE00\\\" ,\\n\\\"12\\\"\\r\\n:\\n-0.0\\t, \\\"\u4e2d\\\": \\\"\u00e9\\\"\\t,\\\"long key with spaces\\\"\\n: { \\\"k13\\\":\\n  3.5\\n  },\\t\\\"01\\\"\\t:\\n-0.0, \\\"k9\\\"\\t:\\r\\n0.0000001\\r\\n,\\n\\\"12345678901\\\"\\n: 123456789012345\\n  ,\\n  \\\"q\\\\\\\"\\\"\\n  :\\n-0\\t,\\n\\\"\u4e2d\\\"\\t:1E-7}}\\n{\\\"id\\\": 161, \\\"v\\\": \\\"s29\\\", \\\"x\\\": null}\\n{\\\"id\\\": 323, \\\"v\\\": \\\"s29\\\", \\\"x\\\": 0.0000001}\\n{\\\"id\\\": 376, \\\"v\\\": \\\"s98\\\", \\\"x\\\": {\\r\\n\\n  \\\"01\\\" : {\\r\\n}\\t,\\t\\\"value\\\": [ \\n  -123456789012345 ,\\n\\\"\u4e2d\u6587\\\"]\\t,\\t\\\"k28\\\":\\r\\n\\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\" ,\\\"k4\\\"\\t:\\r\\n[\\t]\\r\\n,\\n\\\"a\\\"\\t:\\r\\n{\\\"k14\\\"\\n:\\n  \\\"\\\\\\\"\\\",\\n  \\\"dup\\\" :\\t1234567890123456,\\\"a\\\":\\r\\n\\\"\u007f\\\"\\r\\n} ,\\\"4294967295\\\"\\r\\n:{\\n  \\\"long key with spaces\\\":true\\t,\\\"\\\\u0041b\\\"\\t:\\\"\\\\u0041\\\",\\t\\\"\u00e9\\\"\\t:\\r\\n\\\"\u00e9\\\"\\t,\\\"k10\\\":\\\"\u007f\\\",\\t\\\"k29\\\"\\n  :9007199254740993},\\r\\n\\\"id\\\" :\\n{},\\n\\\"k30\\\":\\\"\\\\/\\\",\\\"\\\\u0041b\\\" :{\\n},\\\"4294967295\\\"\\t: 0.0000001\\r\\n,\\t\\\"0\\\"\\t:\\t\\\"hello world\\\"\\n, \\\"k\\\\n\\\":\\r\\n[\\n   \\\"\\\" , false\\n]\\r\\n,\\r\\n\\\"k25\\\"\\n  :\\n  {\\n  \\n  \\\"\\\\u0041b\\\"\\n:\\\"\ud83d\ude00\\\",\\t\\\"\\\" :\\r\\n-2.5e+10,\\n\\\"\ud83d\ude00\\\":\\t-0\\t},\\\"\ud83d\ude00\\\" :\\\"\ud83d\ude00hello world\\\",\\\"name\\\":\\t[],\\\"12\\\"\\n:\\r\\nfalse\\n,\\\"k3\\\"\\t:\\n  5e-324,\\n  \\\"\u00e9\\\" :0.1,\\r\\n\\\"\u00e9\\\"\\n:\\n\\\"\\\\ud800\\\",\\r\\n\\\"k31\\\":\\r\\n[\\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\"\\t],\\\"k1\\\":{\\\"4294967295\\\" :\\n  false\\n, \\\"\\\\u0041b\\\":\\n0.0000001\\r\\n, \\\"12345678901\\\"\\n  :\\t-0.0 ,\\n\\\"\u4e2d\\\"\\n:\\r\\n\\\"\\\\uDFFF\\\",\\t\\\"4294967295\\\"\\n:5e-324,\\n\\\"k18\\\":\\\"\u00e9\\\"\\r\\n,\\n\\\"k2\\\":\\\"\\\\uDFFF\u4e2d\u6587\\\"\\r\\n,\\n\\\"4294967295\\\"\\t: 1e5\\n,\\t\\\"k12\\\"\\n:\\n  \\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\",\\\"12345678901\\\"\\t: -123456789012345\\n,\\\"k\\\\n\\\"\\t:\\\"\\\\\\\\\\\",\\\"b\\\"\\n:\\n  \\\"\\\\ud800\\\"\\t,\\\"name\\\" : \\\"a\\\",\\n  \\\"id\\\" : \\\"\\\\uDFFF\\\"\\r\\n, \\\"b\\\"\\t:\\t\\\"\\\\uDFFF\\\"\\n,\\n\\\"k29\\\" : false ,\\t\\\"k\\\\n\\\"\\n  :\\n1,\\n\\\"\u4e2d\\\" : \\\"\\\\ud800\\\", \\\"k24\\\":\\\"\u2028\\\"\\n  , \\\"name\\\"\\n  : \\\"\\\\\\\\\\\"\\r\\n,\\n  \\\"b\\\"\\n  :\\\"\\\\/\\\"\\r\\n,\\\"name\\\"\\n:\\\"a\\\"\\r\\n,\\n\\\"value\\\"\\n  :\\n123456789012345,\\\"\u4e2d\\\"\\n  :3.5\\n, \\\"\u00e9\\\":\\r\\n0.0000001\\r\\n,\\\"\\\\u0041b\\\" : 100,\\r\\n\\\"id\\\"\\r\\n:\\\"\\\\\\\"a\\\",\\n\\\"k4\\\":\\\"\u007f\\\"\\r\\n, \\\"k0\\\"\\n  :\\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\",\\\"0\\\"\\t: 100\\t,\\n  \\\"k24\\\"\\r\\n:\\t5e-324\\n  ,\\\"q\\\\\\\"\\\" :3.5,\\\"12\\\"\\n:5e-324 ,\\r\\n\\\"12345678901\\\":\\n  true,\\r\\n\\\"k36\\\": 0.000001}\\r\\n,\\\"\u00e9\\\"\\n:\\n  9007199254740993\\n  ,\\t\\\"name\\\"\\r\\n: 0 ,\\r\\n\\\"k1\\\"\\n:\\tfalse ,\\n\\\"k27\\\"\\t:5e-324 ,\\n  \\\"b\\\":\\n  \\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\"\\n,\\\"\ud83d\ude00\\\":[\\r\\n\\n  0.000001,\\n  -2.5e+10 ,\\\"\\\\u0041\\\"\\r\\n,\\n-2.5e+10\\r\\n, 123456789012345678901234567890 ,false,\\t\\\"\u2028\\\"\\n  ,\\n\\\"\\\\\\\"\\\"\\n, 1E-7\\r\\n,\\t\\\"\\\\/\\\"\\n,\\\"\\\\/\\\"\\r\\n,true\\r\\n,\\\"a\\\",\\n\\\"\\\\\\\"\\\" ,\\r\\n1\\n,\\\"\\\\ud800\\\",\\r\\n-0\\r\\n,\\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\", 1,\\n\\\"\u4e2d\u6587\\\" ,\\\"\\\\ud800\\\" ,\\\"\\\\/\\\" ,\\n  \\\"\u4e2d\u6587\\\"\\n,\\n1E-7\\n  ,\\\"hello world\\\",\\r\\n\\\"\\\\/\\\",\\\"\\\\uDFFF\\\"\\n  ,\\n  \\\"\ud83d\ude00\u007f\\\",\\n1e400,123456789012345\\t,\\r\\n\\\"\\\\/\\\" ,1e5 ,\\n\\\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\\",\\n-0, null\\r\\n,\\n  \\\"a\\\"\\n, \\\"\\\\\\\"\\\"\\n  ,\\\"\\\\uD83D\\\\uDE00\\\"\\n,\\\"\\\", \\\"\\\\uD83D\\\\uDE00\\\"\\n  ,\\t\\\"a\\\",\\t\\\"\\\\uDFFF\\\"\\r\\n,\\r\\n-123456789012345\\n,\\t-0.0\\r\\n,\\n\\\"a\\\"\\n  ,\\t\\\"\u4e2d\u6587\\\"\\t]\\n  ,\\n\\\"x\\\" :{\\n\\\"b\\\"\\t:\\n  -12\\r\\n,\\n  \\\"\\\": 1234567890123456, \\\"0\\\"\\r\\n:\\r\\n-123456789012345\\n  ,\\n\\\"k16\\\"\\n  :\\n  -12,\\n  \\\"k12\\\" :\\n  \\\"\\\\/\\\"\\n  ,\\r\\n\\\"k30\\\":\\r\\n1e400,\\n  \\\"k34\\\"\\n:\\t\\\"hello world\\\",\\r\\n\\\"\\\":\\r\\n123456789012345\\r\\n,\\n  \\\"\\\":true,\\\"\ud83d\ude00\\\" : \\\"\u2028\\\"\\n,\\n\\\"01\\\":\\\"\\\\uDFFF\\\"\\n,\\t\\\"k20\\\"\\t:\\n\\\"\\\\\\\\\u2028\\\"\\r\\n,\\n  \\\"k36\\\":\\t\\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\\u0041\\\"\\n,\\\"k15\\\" :false,\\\"\ud83d\ude00\\\":\\t\\\"\\\\\\\"\\\" ,\\\"\\\"\\n  :-12,\\n  \\\"name\\\":false, \\\"01\\\":\\\"\\\\\\\"\\\"\\r\\n,\\n  \\\"dup\\\" :\\n1e5\\n  ,\\r\\n\\\"k35\\\"\\n  :\\\"\u007f\\\",\\n  \\\"\\\\u0041b\\\"\\t: \\\"\\\\\\\"\\\\\\\\\\\" , \\\"x\\\"\\n  :\\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\"\\t,\\\"\u4e2d\\\"\\n  :false\\n  }\\n}}\\n{\\\"id\\\": 887, \\\"v\\\": \\\"\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\\\", \\\"x\\\": null}\\n{\\\"id\\\": 227, \\\"v\\\": \\\"s15\\\", \\\"x\\\": \\\"hello world\\\"}\\n{\\\"id\\\": 72, \\\"v\\\": \\\"s61\\\", \\\"x\\\": \\\"\ud83d\ude00\\\"}\\n{\\\"id\\\": 223, \\\"v\\\": \\\"s67\\\", \\\"x\\\": [  \\\"\u00e9\\\\\\\\\\\"\\n]}\\n{\\\"id\\\": 238, \\\"v\\\": \\\"s20\\\", \\\"x\\\": 3.5}\\n{\\\"id\\\": 935, \\\"v\\\": \\\"s49\\\", \\\"x\\\": 1e5}\\n{\\\"id\\\": 318, \\\"v\\\": \\\"\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\\\", \\\"x\\\": 1234567890123456}\\n{\\\"id\\\": 612, \\\"v\\\": \\\"s18\\\", \\\"x\\\": \\\"\\\\b\\\\f\\\\n\\\\r\\\\t\\\"}\\n{\\\"id\\\": 944, \\\"v\\\": \\\"s67\\\", \\\"x\\\": {\\n \\\"dup\\\":{\\r\\n\\t\\\"a\\\"\\r\\n:\\t\\\"\\\\ud800\\\",\\\"\u00e9\\\":\\n  1234567890123456\\t},\\\"k26\\\"\\n:\\n{ }}}\\n{\\\"id\\\": 695, \\\"v\\\": \\\"s83\\\", \\\"x\\\": true}\\n{\\\"id\\\": 211, \\\"v\\\": \\\"s23\\\", \\\"x\\\": 3.5}\\n{\\\"id\\\": 394, \\\"v\\\": \\\"s78\\\", \\\"x\\\": [\\r\\n \\\"\u00e9\\\"\\n  ,\\\"\\\\uDFFF\\\"\\n  ,[  \\\"\u007f\\\",\\r\\n3.5, 9007199254740993,\\\"\\\\uD83D\\\\uDE00\\\" ]\\r\\n]}\\n\", \"name\": \"a.json\", \"t\": {\"every\": 192, \"big\": 1048576, \"window\": 64, \"pageBytes\": 839}, \"acts\": [[\"op\", 2223, 2232, \"[[\"], [\"edit\"], [\"op\", 3321, 3327, \"1\"], [\"edit\"], [\"op\", 1521, 1529, \"{\\\"a\\\": 1}\"], [\"edit\"], [\"done\"]]}";

/** Seed 231's (HUGE_DUMP): a number, a long string over it, edits read again as they come. */
const CASE231 = "{\"doc\": \"-123456789012345\\r\\n\", \"name\": \"a.json\", \"t\": {\"every\": 192, \"big\": 1048576, \"window\": 64, \"pageBytes\": 1247}, \"acts\": [[\"op\", 2, 10, \"x\"], [\"edit\"], [\"done\"], [\"op\", 0, 2, \"\\\"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\\\"\"], [\"edit\"], [\"ask\", 48], [\"done\"], [\"op\", 111, 111, \"\"], [\"edit\"], [\"done\"], [\"op\", 104, 111, \"null\"], [\"edit\"], [\"ask\", 8], [\"done\"], [\"op\", 80, 83, \"\\\"\"], [\"edit\"], [\"ask\", 81], [\"done\"], [\"op\", 0, 81, \"0\"], [\"edit\"], [\"done\"]]}";
