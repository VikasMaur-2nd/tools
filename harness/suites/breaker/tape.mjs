// The Tree and the Table read off a tape (documents of 2,000,000 characters and more are parsed in the worker; on
// t3/optimize-json-memory-performance the views then list tape indexes and make a node only for a row drawn or used)
// against the same content parsed by the page (under 2,000,000 characters). Each check builds one document twice:
// as it is, and with a long string member "zpad" at the end that takes it past the limit. The same actions on both
// must give the same rows, set sizes, selections, paths, values, finds and CSV, apart from that one member. On main
// the same comparison holds between its worker's tree and the page's.
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { MOD, copied, firstDiff, load, tableRows, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker', 'tape'], width: 1280, height: 900, timeout: 600_000 });

const TAPE_PAD = 2_100_000;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUMS = ['0', '-0', '1', '-1', '1.5', '1.50', '1e400', '-1e400', '9007199254740993', '9007199254740992', '1e-400', '0.1', '3', '3.0', '12345678901234567890', '2', '10', '-2.5'];
const STRS = ['"a"', '"B"', '"b"', '"é"', '"Z"', '"10"', '"9"', '""', '"tab\\there"', '"quote\\"d"', '"日本"', '"😀"', '"a\\u0000b"', '"line\\nbreak"'];

/** `n` records: ragged keys, mixed types and lossless numbers in "num" (ties too), duplicate "name"s, nesting. */
function records(n, seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = [`"id":${i}`];
    const x = r();
    if (x < 0.7) m.push(`"num":${pick(NUMS)}`);
    else if (x < 0.8) m.push(`"num":${pick(STRS)}`);
    else if (x < 0.85) m.push('"num":null');
    else if (x < 0.9) m.push(`"num":${r() < 0.5 ? 'true' : 'false'}`);
    else if (x < 0.95) m.push('"num":{"o":1}');
    if (r() < 0.8) m.push(`"name":${pick(STRS)}`);
    if (r() < 0.3) m.push(`"tag${i % 7}":${i % 3}`);
    if (r() < 0.2) m.push(`"list":[${Array.from({ length: Math.floor(r() * 5) }, () => pick(NUMS)).join(',')}]`);
    if (r() < 0.1) m.push(`"nest":{"a":{"b":[${i},{"c":${pick(STRS)}}]}}`);
    if (r() < 0.05) m.push(`"name":"dup${i}"`);
    if (i === Math.floor(n * 0.77)) m.push('"needle":"TKNEEDLE-777"');
    out.push(`{${m.join(',')}}`);
  }
  return `[${out.join(',')}]`;
}

/** The document's members, then "zpad": a string of x as long as takes the whole past `pad` characters (16 at least). */
const padded = (members, pad) => {
  const head = `{${members.join(',')},"zpad":"`;
  return head + 'x'.repeat(Math.max(16, pad - head.length - 2)) + '"}';
};

/** 20,000 records (~1.1 MB), 30,000 numbers, 60 levels of nesting, duplicate keys, empty containers. */
const recordsDoc = (pad) =>
  padded(
    [
      `"data":${records(20_000, 7)}`,
      `"flat":[${Array.from({ length: 30_000 }, (_, i) => i).join(',')}]`,
      `"deep":${'{"d":'.repeat(60)}{"leaf":"TKDEEP"}${'}'.repeat(60)}`,
      '"dup":{"a":1,"b":{"a":2},"a":3}',
      '"empty":{"o":{},"a":[],"s":""}',
    ],
    pad,
  );

/** An object of 3,001 members (one a duplicate), and 4,000 records using 160 keys, 12 each. */
const wideDoc = (pad) => {
  const w = Array.from({ length: 3000 }, (_, i) => `"m${i}":${i}`);
  w.splice(1500, 0, '"m7":"dup-of-m7"');
  const r = Array.from({ length: 4000 }, (_, i) => `{${Array.from({ length: 12 }, (_, j) => `"k${(i * 7 + j * 13) % 160}":${(i * 31 + j) % 97}`).join(',')}}`);
  return padded([`"wide":{${w.join(',')}}`, `"ragged":[${r.join(',')}]`], pad);
};

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rows the tree draws: level/position/set size/expanded, then the row's text. */
const rows = (page) =>
  page.evaluate(() =>
    [...(window.__vis('#view-tree')?.querySelectorAll('.tv-rows [role=treeitem]') ?? [])].map(
      (r) => `${r.getAttribute('aria-level')}/${r.getAttribute('aria-posinset')}/${r.getAttribute('aria-setsize')}/${r.getAttribute('aria-expanded')} ${r.textContent}`,
    ),
  );

/** The tree scrolled to `f` (0…1) of its height: the rows drawn there. */
async function rowsAt(page, f) {
  await page.evaluate((f) => {
    let s = window.__vis('#view-tree .tv-rows');
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (s) s.scrollTop = f * (s.scrollHeight - s.clientHeight);
  }, f);
  await frames(page);
  await pause(150);
  return rows(page);
}

/** Rows at six places down the tree, then back to the top. */
async function sweep(page) {
  const o = {};
  for (const f of [0, 0.25, 0.5, 0.77, 0.9, 1]) o[f] = await rowsAt(page, f);
  await rowsAt(page, 0);
  return o;
}

/**
 * Find in the open view: `q` typed, no Enter (the typed query runs by itself; Enter after it would step to the
 * next match). The count, and the selected tree row.
 */
async function find(page, q) {
  await page.keyboard.press(`${MOD}+f`);
  await page.locator('.findbar:visible input').fill(q);
  await pause(400);
  await frames(page);
  const r = await page.evaluate(() => ({ count: window.__vis('.findbar .count')?.textContent ?? null, row: window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent ?? null }));
  await page.keyboard.press('Escape');
  await frames(page);
  return r;
}

/** The selected row, and what Copy selected path and Copy selected value give. */
const selection = async (page) => ({
  row: await page.evaluate(() => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent ?? null),
  path: await copied(page, 'Copy selected path').catch(() => null),
  value: ((await copied(page, 'Copy selected value').catch(() => null)) ?? '').slice(0, 2000),
});

/** In Chromium (started with --expose-gc): a few garbage collections, so a node nothing holds is gone. */
const gc = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      window.gc?.();
      await new Promise((r) => setTimeout(r, 30));
    }
  });
const GC = { launch: { args: ['--js-flags=--expose-gc'] } };

/** The tree, everything closed. */
async function treeClosed(page) {
  await view(page, 'tree');
  await until(page, () => (window.__vis('#view-tree .tv-rows')?.childElementCount ?? 0) > 1 || null, null, { timeout: 30_000 });
  await command(page, 'Collapse all');
  await pause(300);
}

/** The table showing what `path` finds (selected in the tree first). */
async function tableOf(page, path, column) {
  await view(page, 'tree');
  await find(page, path);
  await view(page, 'table');
  return until(page, (c) => window.__vis('#view-table .tb-head')?.textContent.includes(c) || null, column, { timeout: 30_000 });
}

/** Clicks the header of `col` `clicks` times; the CSV then (Copy table as CSV). */
async function sortedCsv(page, col, clicks) {
  const th = page.locator('#view-table:visible [role=columnheader]', { hasText: new RegExp(`^${col}`) }).first();
  for (let i = 0; i < clicks; i++) await th.click();
  await pause(500);
  return copied(page, 'Copy table as CSV', { timeout: 60_000 });
}

/** The "zpad" string (16 x or more, clipped or not) as one word, in rows, values and CSV alike. */
const unpad = (x) => JSON.parse(JSON.stringify(x).replace(/x{16,}…?/g, 'PAD'));

/**
 * Loads `make(0)` (read by the page) and `make(TAPE_PAD)` (read off the tape), runs `steps(page)` on each, and
 * checks every key of what it returns is the same for both. Returns both (for checks of their own).
 */
async function both(t, make, steps) {
  const { page } = t;
  await t.open('/');
  const out = {};
  for (const [name, pad] of [['page', 0], ['tape', TAPE_PAD]]) {
    const text = make(pad);
    t.assert(await load(page, text, `${name}.json`, { timeout: 180_000 }), `the ${name} document loads (${text.length} characters)`);
    out[name] = unpad(await steps(page));
  }
  for (const k of Object.keys(out.page)) {
    const d = firstDiff(out.page[k], out.tape[k], k);
    t.check(!d, `${k}: off the tape as by the page`, d);
  }
  return out;
}

test('the Tree on a tape and by the page: Expand all, levels, Collapse all, reveals from Find, keys, Copy path and value', async (t) => {
  const { page } = t;
  const { tape } = await both(t, recordsDoc, async () => {
    const o = {};
    await treeClosed(page);
    o.closed = await rows(page);
    await command(page, 'Expand all');
    await pause(1500);
    o.expandAll = await sweep(page);
    await command(page, 'Collapse all');
    await command(page, 'Expand to level 3');
    await pause(800);
    o.level3 = await sweep(page);
    await command(page, 'Collapse all');
    await pause(300);
    for (const q of ['TKNEEDLE-777', 'TKDEEP', '$.data[15000].name', 'dup1', '$.flat[29999]', '$.data[3].list[2]', '$["dup"].a', '$.dup', '$.data[36]', '$.empty']) {
      o[`find ${q}`] = { ...(await find(page, q)), ...(await selection(page)) };
    }
    o.rowsAfterFinds = await rows(page);
    // Reveal after Expand all and Collapse all (every ancestor opens).
    await command(page, 'Expand all');
    await pause(1000);
    await command(page, 'Collapse all');
    await pause(300);
    o.revealDeep = { ...(await find(page, 'TKDEEP')), ...(await selection(page)) };
    // Keys from the root.
    await treeClosed(page);
    await page.locator('#view-tree:visible .tv-rows [role=treeitem]').first().click();
    o.keys = [];
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'End', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'End', 'Home', 'ArrowDown', ' ', 'ArrowDown']) {
      await page.keyboard.press(k);
      await frames(page);
      o.keys.push(`${k}: ${await page.evaluate(() => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent ?? null)}`);
    }
    o.keysEnd = { rows: await rows(page), ...(await selection(page)) };
    return o;
  });
  // And what they should be.
  t.check(tape['find TKNEEDLE-777']?.path === '$.data[15400].needle', 'Find reveals the needle at $.data[15400].needle', tape['find TKNEEDLE-777']);
  t.check(tape['find TKDEEP']?.path === `$.deep${'.d'.repeat(60)}.leaf`, 'Find reveals the deepest leaf', tape['find TKDEEP']?.path);
  t.check(tape.revealDeep?.path === `$.deep${'.d'.repeat(60)}.leaf` && /leaf:"TKDEEP"$/.test(tape.revealDeep.row ?? ''), 'after Expand all and Collapse all, Find reveals the deepest leaf and its row shows', tape.revealDeep, {
    known: 'bug (main; fixed on t3/optimize-json-memory-performance at 1d6f20a): after Expand all then Collapse all, Find selects a deep match but leaves it hidden (BREAKER-REPORT F24)',
  });
  t.check(tape['find $.dup']?.value === '{\n  "a": 1,\n  "b": {\n    "a": 2\n  },\n  "a": 3\n}', 'Copy selected value keeps both duplicate keys, in order', tape['find $.dup']?.value);
  t.check(tape['find $.flat[29999]']?.path === '$.flat[29999]', 'a path query to the last of 30,000 items selects it', tape['find $.flat[29999]']);
});

test('the Table on a tape and by the page: CSV sorted by each column both ways, find, a flat array, ragged columns', async (t) => {
  const { page } = t;
  const { tape } = await both(t, recordsDoc, async () => {
    const o = {};
    await tableOf(page, '$.data', 'num');
    o.head = (await tableRows(page)).head;
    o.csv = await copied(page, 'Copy table as CSV', { timeout: 60_000 });
    o['num ascending'] = await sortedCsv(page, 'num', 1);
    o['num descending'] = await sortedCsv(page, 'num', 1);
    o['name ascending'] = await sortedCsv(page, 'name', 1);
    o['id descending'] = await sortedCsv(page, 'id', 2);
    for (const q of ['dup1', 'TKNEEDLE', '1e400', '日本']) {
      await page.keyboard.press(`${MOD}+f`);
      await page.locator('.findbar:visible input').fill(q);
      await pause(500);
      o[`find ${q}`] = await page.evaluate(() => ({
        count: window.__vis('.findbar .count')?.textContent ?? null,
        first: [...(window.__vis('#view-table .tb-rows')?.querySelectorAll('[role=row]') ?? [])].slice(0, 3).map((r) => r.textContent.slice(0, 120)),
      }));
      await page.keyboard.press('Escape');
    }
    await tableOf(page, '$.flat', '#');
    o.flatDescending = (await sortedCsv(page, 'value', 2))?.slice(0, 400) ?? null;
    return o;
  });
  t.check(/^id,num,name,/.test(tape.csv ?? ''), 'the CSV starts with its columns', tape.csv?.slice(0, 60));
  t.check(/^id,num,name,/.test(tape['id descending'] ?? '') && /\n19999,/.test(tape['id descending'] ?? ''), 'sorted by id descending, the CSV starts at record 19999', tape['id descending']?.slice(0, 120));
});

test('wide objects and records with more columns than the Table shows: the same rows, set sizes, End and *, columns and CSV', async (t) => {
  const { page } = t;
  const { tape } = await both(t, wideDoc, async () => {
    const o = {};
    await treeClosed(page);
    o.closed = await rows(page);
    o.findM1499 = { ...(await find(page, '$.wide.m1499')), rows: await rows(page) };
    await page.keyboard.press('End');
    await frames(page);
    o.end = { rows: await rows(page), ...(await selection(page)) };
    await find(page, '$.wide');
    await page.keyboard.press('*');
    await pause(800);
    o.star = await sweep(page);
    o.m7 = { ...(await find(page, 'dup-of-m7')), ...(await selection(page)) };
    await tableOf(page, '$.ragged', 'k0');
    o.raggedHead = (await tableRows(page)).head;
    o.raggedCsv = await copied(page, 'Copy table as CSV', { timeout: 60_000 });
    o.raggedByK5 = await sortedCsv(page, 'k5', 1);
    await tableOf(page, '$.wide', 'key');
    o.wideCsv = await copied(page, 'Copy table as CSV', { timeout: 60_000 });
    return o;
  });
  t.check(tape.m7?.path === '$.wide.m7', 'the duplicate m7 is found, its path $.wide.m7', tape.m7);
});

/**
 * Select, scroll away, collapse, other views, edits: the selection is the same node throughout. In Chromium the page
 * collects garbage on demand there (rows scrolled past lose their nodes; the views compare nodes with ===).
 */
async function keptSelection(t) {
  const { page } = t;
  const out = await both(t, recordsDoc, async () => {
    const o = {};
    await treeClosed(page);
    o.found = await find(page, 'TKNEEDLE-777');
    await gc(page);
    for (const f of [0, 1, 0.3]) await rowsAt(page, f);
    await gc(page);
    o.afterScroll = await selection(page);
    await command(page, 'Collapse all');
    await gc(page);
    o.foundAgain = { ...(await find(page, 'TKNEEDLE-777')), ...(await selection(page)) };
    await view(page, 'table');
    await pause(500);
    o.table = await tableRows(page).then((r) => r && { head: r.head, rows: r.rows.slice(0, 5) });
    await gc(page);
    await view(page, 'graph');
    await pause(1500);
    await gc(page);
    await view(page, 'tree');
    await pause(500);
    o.back = { ...(await selection(page)), rows: await rows(page) };
    // Edits: Format in place (the whole input), then a member typed before the last }.
    await page.locator('#input').focus();
    await page.keyboard.press('Shift+Alt+F');
    await until(page, () => /^Valid JSON/.test(window.__vis('.sb-l .st')?.textContent ?? '') || null, null, { timeout: 120_000 });
    await pause(1500);
    o.afterFormat = await selection(page);
    await page.locator('#input').focus();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(',"added":[1,2]');
    await until(page, () => /^Valid JSON/.test(window.__vis('.sb-l .st')?.textContent ?? '') || null, null, { timeout: 120_000 });
    await until(page, () => window.__vis('#view-tree')?.textContent.includes('added') || null, null, { timeout: 30_000 });
    await pause(1000);
    o.added = { ...(await find(page, '$.added[1]')), ...(await selection(page)) };
    return o;
  });
  for (const [name, o] of Object.entries(out)) {
    t.check(o.afterScroll?.path === '$.data[15400].needle' && o.back?.path === '$.data[15400].needle' && o.afterFormat?.path === '$.data[15400].needle', `${name}: the needle stays selected (scrolled away, collapsed, other views, Format in place)`, [o.afterScroll?.path, o.back?.path, o.afterFormat?.path]);
    t.check(o.added?.path === '$.added[1]', `${name}: a path query to a member just typed selects it`, o.added);
  }
}

test('a selection kept across scrolling, collapsing, other views and edits (forced garbage collection)', { engines: ['chromium'], ...GC }, keptSelection);
test('a selection kept across scrolling, collapsing, other views and edits', { engines: ['firefox', 'webkit'] }, keptSelection);
