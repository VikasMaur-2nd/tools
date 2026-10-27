// The Format view of documents of 2 MB and more, shown Pretty: on t3/optimize-json-memory-performance its lines are
// read off the parser's tape when drawn, searched, folded or copied, and never made whole (lib/json/pretty.ts).
// Everything it shows must be what main shows, exactly: the drawn rows, find counts and the current match's line,
// folds and their line counts, indent and style switches, typing and Undo, a second document right after, and
// nesting too deep to pretty-print. Expected values come from the document's own values (JSON.stringify).
import { defaults, test } from '../../lib/api.mjs';
import { command, view } from '../../lib/app.mjs';
import { downloaded, inputText, loadAny, MOD, openBytes, settled, until } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker'], timeout: 300_000 });

const NAMES = ['Ada', 'Zoë', '東京タワー', 'مرحبا بالعالم', 'שלום', '👩🏽‍💻🇯🇵', 'áé', 'İstanbul', 'ß straße', 'Ω'];
const nest = (d) => (d ? { ['l' + d]: d % 2 ? [nest(d - 1)] : nest(d - 1) } : 'bottom');

/** Records of every hard kind of line: scripts, emoji, escapes, lone surrogates, long lines, deep nesting, empties. */
function records(seed, bytes) {
  const recs = [];
  for (let i = 0, size = 0; size < bytes; i++) {
    const r = { id: i, name: `${NAMES[(i + seed) % NAMES.length]} ${i}`, n: i * 1.5, ok: i % 2 === 0 };
    if (i % 3 === 0) r.tags = i % 9 === 0 ? [] : ['a', 'b' + i];
    if (i % 7 === 0) r.esc = 'q"uote\\back\nnl\ttab\u0001ctl';
    if (i % 11 === 0) r.lone = '\ud800' + i + '\udfff';
    if (i % 13 === 0) r.pair = '😀𝓐';
    if (i % 500 === 0) r.long = 'word '.repeat(400) + 'long-line-mark-' + i;
    if (i % 1500 === 0) r.nospace = 'Z'.repeat(5000);
    if (i % 1000 === 0) r.deep = nest(30);
    if (i % 17 === 0) r.empty = {};
    r.mark = `rec-${seed}-${i}-mark`;
    recs.push(r);
    size += JSON.stringify(r).length + 1;
  }
  return recs;
}
const A = records(0, 3_000_000);
const LINES = { '  ': JSON.stringify(A, null, 2).split('\n'), '    ': JSON.stringify(A, null, 4).split('\n'), '\t': JSON.stringify(A, null, '\t').split('\n') };

const hash = (t) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return `${t.length}:${(h >>> 0).toString(16)}`;
};
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/** Hash of Copy formatted output, hashed in the page; waits until it is `want` (the output may still be on its way). */
async function copyIs(page, want, timeout = 60_000) {
  let got = null;
  for (const end = Date.now() + timeout; got !== want && Date.now() < end; ) {
    await page.evaluate(() => (window.__clip = null));
    await command(page, 'Copy formatted output');
    got = await until(page, () => {
      const t = window.__clip;
      if (t == null) return null;
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
      return `${t.length}:${(h >>> 0).toString(16)}`;
    }, null, { timeout: 60_000, polling: 100 });
    if (got !== want) await page.waitForTimeout(1000);
  }
  return got;
}

/** The Format view's drawn rows on screen: [gutter number, text, folded, placeholder]. */
const rows = (page) =>
  page.evaluate(() => {
    const v = window.__vis('#view-format');
    const vb = v?.getBoundingClientRect();
    return [...(v?.querySelectorAll('.cv-l') ?? [])]
      .filter((r) => { const b = r.getBoundingClientRect(); return b.height && b.bottom > vb.top && b.top < vb.bottom; })
      .map((r) => [r.querySelector('.cv-n')?.textContent ?? '', r.querySelector('.cv-c')?.textContent ?? '', !!r.querySelector('.cv-f.c'), r.querySelector('.cv-ph')?.textContent ?? null]);
  });

/**
 * Rows (wrap off) that disagree with `lines`: each numbered row shows its line (a line past 1,000 characters may be
 * drawn in part: its start). Returns the first few disagreements, and how many numbered rows were seen.
 */
function badRows(drawn, lines) {
  const bad = [];
  let seen = 0;
  for (const [n, text, , ph] of drawn) {
    if (!n || ph) continue;
    seen++;
    const want = lines[Number(n) - 1] ?? null;
    const ok = want !== null && (text === want || (want.length > 1000 && text.length > 0 && want.startsWith(text)));
    if (!ok) bad.push({ n, got: text.slice(0, 80), want: want?.slice(0, 80) });
  }
  return { bad: bad.slice(0, 3), seen };
}

/** Waits until the drawn rows satisfy `ok` (they are redrawn after a setting changes); returns the last reading. */
async function rowsWhen(page, ok, timeout = 60_000) {
  let r = await rows(page);
  for (const end = Date.now() + timeout; !ok(r) && Date.now() < end; ) {
    await page.waitForTimeout(250);
    r = await rows(page);
  }
  return r;
}

/** Find's matches as the view counts them: smart case (an upper-case letter matches exactly), İ as i, no overlaps. */
function findCount(text, q) {
  const cs = q !== q.toLowerCase();
  const fold = (t) => t.replace(/İ/g, 'i').toLowerCase();
  const hay = cs ? text : fold(text);
  const needle = cs ? q : fold(q);
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) n++;
  return n;
}

/**
 * Runs a find in the open view, then Next `nexts` times (each once the count shows the step before), and waits for
 * the count to read "k of N" (k ≥ 1; "0 of N" shows while it still searches) with N = `total`. Returns [count text,
 * the current match's row number].
 */
async function find(page, q, total, nexts = 0) {
  const box = page.locator('.findbar:visible input');
  if (!(await box.count())) await page.keyboard.press(`${MOD}+f`);
  await box.fill(q);
  // The typed query runs by itself 80–150 ms later. (Not Enter: before that it runs the query, after it it goes to
  // the next match, so which match is current would depend on the host's speed.)
  await page.waitForTimeout(300);
  const counted = (k) => until(page, ([src]) => { const c = window.__vis('.findbar .count')?.textContent ?? ''; return new RegExp(src).test(c) ? c : null; },
    [total ? `^${k === null ? '[1-9][\\d,]*' : k.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}$` : '^No results$'], { timeout: 60_000 }).catch(() => null);
  let count = await counted(null);
  for (let k = 0; k < nexts && count; k++) {
    const at = Number(count.split(' of ')[0].replace(/,/g, ''));
    await box.press('Enter');
    count = await counted(at + 1);
  }
  count ??= await page.evaluate(() => window.__vis('.findbar .count')?.textContent ?? null);
  if (!total) return [count, null];
  // The current match's row (a continuation row of a wrapped line has no number: its line's first row has).
  const line = await until(page, () => {
    const c = window.__vis('#view-format .cv-hit.cur');
    if (!c) return null;
    for (let r = c.closest('.cv-l'); r; r = r.previousElementSibling) { const n = r.querySelector('.cv-n')?.textContent; if (n) return n; }
    return null;
  }, null, { timeout: 10_000 }).catch(() => null);
  return [count, line];
}
const closeFind = async (page) => {
  if (await page.locator('.findbar:visible input').count()) await page.keyboard.press('Escape');
};
/** The view's wrap: off (rows compare whole). */
async function wrapOff(page) {
  const off = () => page.evaluate(() => !!window.__vis('#view-format')?.querySelector('.cv-nowrap') || !!window.__vis('#view-format.cv-nowrap, #view-format .cv.cv-nowrap'));
  if (await off()) return;
  await command(page, 'Wrap long lines');
  // (Searching while the view lays out again can throw: F21, checked on its own.)
  for (const end = Date.now() + 10_000; !(await off()) && Date.now() < end; ) await page.waitForTimeout(100);
  await page.waitForTimeout(1000);
}

async function open(t) {
  const { page } = t;
  await t.open('/');
  const st = await loadAny(page, Buffer.from(JSON.stringify(A)), 'records.json', { timeout: 120_000 });
  t.assert(st?.msg === 'Valid JSON', 'the 3 MB document is valid', st);
  await command(page, 'Indent with 2 spaces');
  await until(page, () => (window.__vis('#view-format .cv-l') ? true : null), null, { timeout: 60_000 });
  return page;
}

test('3 MB in the Format view: the rows drawn, find counts and where each lands, exactly', async (t) => {
  const page = await open(t);
  t.check((await copyIs(page, hash(LINES['  '].join('\n')))) === hash(LINES['  '].join('\n')), 'Copy formatted output is exact');
  await wrapOff(page);
  const top = await rowsWhen(page, (r) => badRows(r, LINES['  ']).bad.length === 0 && r.length > 10);
  const b = badRows(top, LINES['  ']);
  t.check(!b.bad.length && b.seen > 10 && top[0][0] === '1', 'the first rows are the pretty lines, numbered from 1', b);
  const text = LINES['  '].join('\n');
  // The line of the k-th match from the top (1-based), counted as the view counts them (see findCount).
  const lineOfMatch = (q, k) => {
    const cs = q !== q.toLowerCase();
    const fold = (t) => (cs ? t : t.replace(/İ/g, 'i').toLowerCase());
    const needle = fold(q);
    for (let n = 0, i = 0; i < LINES['  '].length; i++) {
      const hay = fold(LINES['  '][i]);
      for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) if (++n === k) return String(i + 1);
    }
    return null;
  };
  for (const [q, nexts] of [['zoë', 0], ['Zoë', 3], ['rec-0-15000-mark', 0], ['👩🏽‍💻', 0], ['مرحبا', 0], ['istanbul', 0], ['straße', 0], ['\\ud800', 0], ['long-line-mark-1000', 0], ['"l17": [', 0], ['rec-0-777-mark', 0]]) {
    const total = findCount(text, q);
    const [count, line] = await find(page, q, total, nexts);
    t.check(count?.endsWith(` of ${total.toLocaleString('en-US')}`), `find ${q}: ${total} matches`, count);
    // (Typing finds a match and Enter goes to the next, depending on how fast the search was: the match the
    // count names is the one that must be shown.)
    const k = Number(count?.split(' of ')[0].replace(/,/g, ''));
    const want = k ? lineOfMatch(q, k) : null;
    t.check(!!want && line === want, `find ${q}${nexts ? ` (+${nexts})` : ''}: the current match (${count}) is drawn on its line`, { line, want });
  }
  await closeFind(page);
  // Rows where the last find landed are the pretty lines too.
  const there = await rows(page);
  const bt = badRows(there, LINES['  ']);
  t.check(!bt.bad.length && bt.seen > 10, 'the rows around the current match are the pretty lines', bt);
});

test('3 MB in the Format view: folds, levels and the gutter, with exact line counts', async (t) => {
  const page = await open(t);
  await wrapOff(page);
  const L = LINES['  '];
  /** Line index (0-based) where the container opened on line `o` closes. */
  const closeOf = (o) => {
    let d = 0;
    for (let k = o; k < L.length; k++) {
      const s = L[k].trim();
      if (/[[{]$/.test(s)) d++;
      if (/^[\]}]/.test(s)) d--;
      if (d === 0) return k;
    }
    return -1;
  };
  const hidden = (o) => closeOf(o) - o - 1;
  await command(page, 'Collapse all');
  let r = await rowsWhen(page, (x) => x[1]?.[2] === true);
  t.check(r[0][0] === '1' && r[1][0] === '2' && r[1][2] && r[1][3] === `⋯ ${hidden(1)} lines`, `Collapse all: record 0 folds its ${hidden(1)} lines`, r.slice(0, 2));
  const second = String(closeOf(1) + 2);
  t.check(r[2]?.[0] === second && r[2][2], `the next folded record starts on line ${second}`, r[2]);
  await command(page, 'Expand to level 2');
  r = await rowsWhen(page, (x) => x[1]?.[2] === false && x.some((y) => y[2]));
  const deep = L.findIndex((l) => l.startsWith('    "deep": {'));
  const deepRow = r.find((x) => x[0] === String(deep + 1));
  t.check(r[1][0] === '2' && !r[1][2] && !!deepRow?.[2] && deepRow[3] === `⋯ ${hidden(deep)} lines`, `Expand to level 2: records open, record 0's "deep" (line ${deep + 1}) folded`, { row2: r[1], deepRow });
  await command(page, 'Expand all');
  r = await rowsWhen(page, (x) => !x.some((y) => y[2]));
  t.check(!badRows(r, L).bad.length, 'Expand all: every row is its line again', badRows(r, L));
  await page.locator('#view-format:visible .cv-f[data-f="1"]').first().click();
  r = await rowsWhen(page, (x) => x[1]?.[2] === true);
  t.check(r[1][2] && r[1][3] === `⋯ ${hidden(1)} lines` && r[2]?.[0] === second, 'a gutter click folds record 0, the next record follows', r.slice(1, 3));
  await page.locator('#view-format:visible .cv-f[data-f="1"]').first().click();
  r = await rowsWhen(page, (x) => x[1]?.[2] === false);
  t.check(!badRows(r, L).bad.length && r[2]?.[0] === '3', 'a second click unfolds it', r.slice(1, 3));
});

test('3 MB in the Format view: indent and style switches give exact output and rows', async (t) => {
  const page = await open(t);
  await wrapOff(page);
  for (const [cmd, indent] of [['Indent with 4 spaces', '    '], ['Indent with tabs', '\t'], ['Indent with 2 spaces', '  ']]) {
    await command(page, cmd);
    const want = hash(LINES[indent].join('\n'));
    t.check((await copyIs(page, want)) === want, `${cmd}: Copy is exact`);
    const r = await rowsWhen(page, (x) => !badRows(x, LINES[indent]).bad.length && x.length > 10);
    t.check(!badRows(r, LINES[indent]).bad.length, `${cmd}: the rows are its lines`, badRows(r, LINES[indent]));
  }
  const minified = JSON.stringify(A);
  for (const [cmd, want] of [
    ['Output: minified', hash(minified)],
    ['Output: sort keys', hash(JSON.stringify(sortKeys(A)))],
    ['Output: sort keys', hash(minified)],
    ['Output: escaped JSON string', hash(JSON.stringify(minified))],
    ['Output: pretty', hash(LINES['  '].join('\n'))],
  ]) {
    await command(page, cmd);
    t.check((await copyIs(page, want)) === want, `${cmd}: Copy is exact`);
  }
  const r = await rowsWhen(page, (x) => !badRows(x, LINES['  ']).bad.length && x.length > 10);
  t.check(!badRows(r, LINES['  ']).bad.length && r[0][0] === '1', 'back to Pretty: the rows are its lines', badRows(r, LINES['  ']));
});

test('3 MB in the Format view: typing shows in the view and Copy, and Undo brings it back', async (t) => {
  const page = await open(t);
  await wrapOff(page);
  await view(page, 'tree');
  await page.keyboard.press(`${MOD}+f`);
  const box = page.locator('.findbar:visible input');
  await box.fill('$[100].name');
  await box.press('Enter');
  await until(page, () => window.__vis('#view-tree .tv-rows [aria-selected=true]')?.textContent || null, null, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__vis('#view-tree').focus());
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.id === 'input' || null, null, { timeout: 10_000 });
  await page.keyboard.type('"EDITED-שלום-😀"');
  await view(page, 'format');
  const edited = JSON.stringify(A.map((r, i) => (i === 100 ? { ...r, name: 'EDITED-שלום-😀' } : r)), null, 2);
  t.check((await copyIs(page, hash(edited))) === hash(edited), 'Copy gives the edited document');
  const line = String(edited.split('\n').findIndex((l) => l.includes('EDITED-')) + 1);
  const [count, at] = await find(page, 'EDITED-', 1);
  t.check(count === '1 of 1' && at === line, `the view finds the edit on line ${line}`, { count, at });
  await closeFind(page);
  const r = await rows(page);
  t.check(!badRows(r, edited.split('\n')).bad.length, 'the rows there are the edited lines', badRows(r, edited.split('\n')));
  // (Typing over a selection is two Undo steps, BREAKER-REPORT F19, more when typing is slow on a busy host:
  // Undo until the input is back, not past the typing.)
  const source = JSON.stringify(A);
  let input = null;
  for (let k = 0; k < 12 && input !== source; k++) {
    await command(page, 'Undo');
    input = await inputText(page);
    if ((input?.length ?? 0) < source.length - 100) break;
  }
  t.check(input === source, 'Undo brings the input back');
  const want = hash(LINES['  '].join('\n'));
  t.check((await copyIs(page, want)) === want, 'Undo brings the output back');
});

test('a second big document right after the first: nothing of the first shows or copies', async (t) => {
  const page = await open(t);
  await wrapOff(page);
  const B = records(5, 2_500_000);
  // Opened over the first (no Clear in between); settled once the raw size is the second's.
  await openBytes(page, 'second.json', JSON.stringify(B));
  const st = await settled(page, { raw: Buffer.byteLength(JSON.stringify(B)), timeout: 120_000 });
  t.check(st?.msg === 'Valid JSON', 'the second document is valid', st);
  const first = await rows(page);
  t.check(!first.some(([, text]) => text.includes('rec-0-')), 'no row of the first document is drawn', first.find(([, text]) => text.includes('rec-0-')));
  const want = hash(JSON.stringify(B, null, 2));
  await page.evaluate(() => (window.__clip = null));
  await command(page, 'Copy formatted output');
  const now = await until(page, () => window.__clip, null, { timeout: 60_000 });
  t.check(!now?.includes('rec-0-'), 'Copy right away gives nothing of the first document', now?.slice(0, 60));
  t.check((await copyIs(page, want)) === want, 'Copy gives the second document');
  const [count] = await find(page, 'rec-0-', 0);
  t.check(count === 'No results' || / of 0$/.test(count ?? ''), 'find sees nothing of the first document', count);
  const r = await rowsWhen(page, (x) => !badRows(x, JSON.stringify(B, null, 2).split('\n')).bad.length && x.length > 10);
  t.check(!badRows(r, JSON.stringify(B, null, 2).split('\n')).bad.length, 'the rows are the second document\'s lines', badRows(r, JSON.stringify(B, null, 2).split('\n')));
});

for (const depth of [3000, 5200]) {
  test(`2 MB nested ${depth.toLocaleString('en-US')} levels: Pretty ${depth > 5000 ? 'says it is too large' : 'is exact'}, Minify is exact`, async (t) => {
    const { page } = t;
    await t.open('/');
    // The padding sits beside the deep part: pretty-printing it costs its own lines, not depth × lines.
    const pad = JSON.stringify(Array.from({ length: 200_000 }, (_, i) => (i % 7 ? i : 'é' + i)));
    const doc = `[${'['.repeat(depth)}1${']'.repeat(depth)},${pad}]`;
    const st = await loadAny(page, Buffer.from(doc), `deep-${depth}.json`, { timeout: 120_000 });
    t.check(st?.msg === 'Valid JSON' && st.stats?.endsWith(`depth ${depth + 1}`), `valid, depth ${depth + 1}`, st);
    if (depth > 5000) {
      const shown = await until(page, () => window.__vis('#view-format')?.innerText.trim() || null, null, { timeout: 60_000 }).catch(() => null);
      t.check(/too large/i.test(shown ?? ''), 'the Format view says the result is too large', shown?.slice(0, 80) ?? 'blank', { known: 'bug (main): Format view blank and Copy silent past ~5,100 levels (BREAKER-REPORT F4)' });
    } else {
      const want = hash(JSON.stringify(JSON.parse(doc), null, 2));
      t.check((await copyIs(page, want)) === want, 'Copy formatted output is exact');
    }
    await command(page, 'Output: minified');
    t.check((await copyIs(page, hash(doc))) === hash(doc), 'Minify gives the document');
  });
}

test('3 MB pasted with raw lone surrogates in its strings: Pretty and Minify write what JSON.stringify does', async (t) => {
  // (A file can't hold a lone surrogate, UTF-8 has none, but a paste can. The text is made in the page: the
  // protocol would replace them.)
  const { page } = t;
  await t.open('/');
  const want = await page.evaluate(() => {
    const recs = [];
    for (let i = 0, size = 0; size < 3_000_000; i++) {
      recs.push(`{"id":${i},"a":"x<HI>y","b":"<LO>z","c":"<HI><LO> pair","d":"end<HI>","k<HI>":${i}}`);
      size += 60;
    }
    const raw = ('[' + recs.join(',') + ']').replaceAll('<HI>', '\ud800').replaceAll('<LO>', '\udc00');
    const ta = window.__vis('#input');
    ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', raw);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
    if (ta.dispatchEvent(ev)) {
      ta.setRangeText(raw, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: raw, bubbles: true }));
    }
    const h = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193); return `${s.length}:${(x >>> 0).toString(16)}`; };
    const v = JSON.parse(raw);
    return { pretty: h(JSON.stringify(v, null, 2)), min: h(JSON.stringify(v)) };
  });
  t.assert(await until(page, () => /^Valid JSON/.test(window.__vis('.sb-l .st')?.textContent ?? '') || null, null, { timeout: 120_000 }), 'the paste is valid JSON');
  await command(page, 'Indent with 2 spaces');
  t.check((await copyIs(page, want.pretty)) === want.pretty, 'Pretty escapes each lone surrogate and keeps the pair');
  await command(page, 'Output: minified');
  t.check((await copyIs(page, want.min)) === want.min, 'Minify does the same');
});

test('3 MB of JSON Lines in the Format view: the rows and Copy are the records as one pretty array', async (t) => {
  const { page } = t;
  await t.open('/');
  const recs = records(3, 3_000_000);
  const st = await loadAny(page, Buffer.from(recs.map((r) => JSON.stringify(r)).join('\n') + '\n'), 'records.jsonl', { timeout: 120_000 });
  t.check(st?.msg === `JSON Lines · ${recs.length.toLocaleString('en-US')} records`, 'JSON Lines with every record', st);
  await command(page, 'Indent with 2 spaces');
  const lines = JSON.stringify(recs, null, 2).split('\n');
  t.check((await copyIs(page, hash(lines.join('\n')))) === hash(lines.join('\n')), 'Copy is the records as one pretty array');
  await wrapOff(page);
  const r = await rowsWhen(page, (x) => !badRows(x, lines).bad.length && x.length > 10);
  t.check(!badRows(r, lines).bad.length && r[0][0] === '1', 'the first rows are its lines', badRows(r, lines));
  const last = `rec-3-${recs.length - 1}-mark`;
  const [count, at] = await find(page, last, 1);
  t.check(count === '1 of 1' && at === String(lines.findIndex((l) => l.includes(last)) + 1), 'find lands on the last record\'s line', { count, at });
});

for (const mb of [0.9, 3]) {
  test(`find on long lines (${mb} MB): the highlight sits on the matched text, wrap on and off`, async (t) => {
    // Lines of 2,000 and 5,000 characters, each with a match at its end. On main the highlight drifted right
    // with the column: with wrap off 320 px at column 2,000, its text scrolled out of view (BREAKER-REPORT F20).
    // Wrap on, a 5,000-character line's rows made exact when idle moved the view back to its first row.
    const { page } = t;
    await t.open('/');
    const recs = [];
    for (let i = 0, s = 0; s < mb * 1_000_000; i++) {
      const r = { id: i, t: 'filler text ' + i, n: i };
      recs.push(r);
      s += JSON.stringify(r).length + 1;
    }
    recs[3] = { id: 3, mid: 'Q'.repeat(1990) + 'MARKA' };
    recs[5] = { id: 5, long: 'R'.repeat(4990) + 'MARKB' };
    t.assert((await loadAny(page, Buffer.from(JSON.stringify(recs)), 'long.json', { timeout: 120_000 }))?.msg === 'Valid JSON', 'the document is valid');
    await until(page, () => (window.__vis('#view-format .cv-l') ? true : null), null, { timeout: 60_000 });
    for (const wrap of ['on', 'off']) {
      if (wrap === 'off') {
        await command(page, 'Wrap long lines');
        // (Searching while the view lays out again can throw: F21, checked below on its own.)
        await until(page, () => !!window.__vis('#view-format')?.querySelector('.cv-nowrap') || !!window.__vis('#view-format.cv-nowrap') || null, null, { timeout: 10_000 }).catch(() => null);
        await page.waitForTimeout(1000);
      }
      for (const q of ['MARKA', 'MARKB']) {
        const [count] = await find(page, q, 1);
        // The current match's box vs the box of the first character it marks, in the same row.
        const at = await until(page, () => {
          const v = window.__vis('#view-format');
          const m = v?.querySelector('.cv-hit.cur');
          if (!m) return null;
          const c = m.closest('.cv-l').querySelector('.cv-c');
          const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
          // (The match may straddle two rows of a wrapped line: its first character, the line's only capital M, is in this one.)
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (n.parentElement.closest('.cv-hit, .cv-sp')) continue;
            const i = n.data.indexOf('M');
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const tb = r.getClientRects()[0];
            const vb = v.getBoundingClientRect();
            return { off: Math.round(m.getBoundingClientRect().left - tb.left), seen: tb.left >= vb.left && tb.right <= vb.right };
          }
          return { off: null, seen: false };
        }, null, { timeout: 10_000 }).catch(() => null);
        t.check(count === '1 of 1' && at !== null && at.off !== null && Math.abs(at.off) <= 2 && at.seen, `wrap ${wrap}, ${q}: the highlight is on the match, which is in view`, { count, ...at });
      }
    }
    await closeFind(page);
  });
}

test('toggling wrap while a find is open on long lines: no page errors, and the find still lands', { allowErrors: true }, async (t) => {
  // Firefox and WebKit on main: "this.wrapper is null" (subStart in render) when the view lays out again under an
  // open find (BREAKER-REPORT F21): drawing read the new wrapper while the rows on screen were the old one's.
  const { page } = t;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await t.open('/');
  const recs = [];
  for (let i = 0, s = 0; s < 3_000_000; i++) {
    const r = { id: i, t: 'filler text ' + i, n: i };
    recs.push(r);
    s += JSON.stringify(r).length + 1;
  }
  recs[3] = { id: 3, mid: 'Q'.repeat(1990) + 'MARKA' };
  recs[5] = { id: 5, long: 'R'.repeat(4990) + 'MARKB' };
  t.assert((await loadAny(page, Buffer.from(JSON.stringify(recs)), 'long.json', { timeout: 120_000 }))?.msg === 'Valid JSON', 'the document is valid');
  await until(page, () => (window.__vis('#view-format .cv-l') ? true : null), null, { timeout: 60_000 });
  const box = page.locator('.findbar:visible input');
  let last = null;
  for (let round = 0; round < 4; round++) {
    for (const q of ['MARKA', 'MARKB']) {
      await command(page, 'Wrap long lines');
      if (!(await box.count())) await page.keyboard.press(`${MOD}+f`);
      await box.fill(q);
      await box.press('Enter');
    }
  }
  last = await until(page, () => (window.__vis('.findbar .count')?.textContent === '1 of 1' && window.__vis('#view-format .cv-hit.cur') ? 'ok' : null), null, { timeout: 15_000 }).catch(() => null);
  t.check(!errors.length, 'no page errors', errors.slice(0, 2));
  t.check(last === 'ok', 'the last find shows 1 of 1 with its highlight', await page.evaluate(() => window.__vis('.findbar .count')?.textContent));
});

test('3 MB in the Format view: Download formatted output saves the exact UTF-8 bytes, indent 2 and tabs', async (t) => {
  // (The branch makes a big Pretty output in ~1M-character parts, fc1ac96: emoji and astral characters on every
  // part's lines must come out whole.)
  const page = await open(t);
  for (const [cmd, indent] of [['Indent with 2 spaces', '  '], ['Indent with tabs', '\t']]) {
    await command(page, cmd);
    const want = Buffer.from(LINES[indent].join('\n'), 'utf8');
    await copyIs(page, hash(LINES[indent].join('\n')));
    const file = await downloaded(page, () => command(page, 'Download formatted output'), { timeout: 120_000 });
    t.check(!!file?.bytes && file.bytes.equals(want), `${cmd}: the file is the pretty text in UTF-8`, file && { name: file.name, size: file.bytes?.length, want: want.length });
  }
});
