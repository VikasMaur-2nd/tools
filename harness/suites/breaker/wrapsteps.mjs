// The input editor's wrap of a big text, counted in steps (t3/optimize-json-memory-performance f1aa3bc: a text laid
// out afresh of 200,000 rows or more first takes each line's rows from its length as ASCII, then the real rows
// replace them in one go). Keys used while the rows are still being counted must act on the text as they would
// once they are in. The document: 30,000 records over 240,000 lines (12.7 MB), a third of its lines CJK, emoji
// (skin tones, ZWJ families, flags) and RTL, tabs in a third of the records.
import { defaults, test } from '../../lib/api.mjs';
import { MOD, copied, load, slow } from './_helpers.mjs';

defaults({ engines: 'all', tags: ['breaker', 'wrap'], width: 1280, height: 860, timeout: 300_000 });

function wrapDoc(records) {
  const cjk = '漢字かなカナ한국어中文字符'.repeat(4);
  const emoji = '😀👍🏽👨‍👩‍👧‍👦🇮🇳'.repeat(6);
  const rtl = 'مرحبا بالعالم שלום עולם'.repeat(3);
  const lines = ['['];
  for (let i = 0; i < records; i++) {
    const t = i % 3 === 0 ? '\t' : '  ';
    lines.push(`${t}{`, `${t}${t}"id": ${i},`, `${t}${t}"cjk": "${cjk}${i}",`, `${t}${t}"emoji": "${emoji}",`, `${t}${t}"rtl": "${rtl}",`);
    lines.push(`${t}${t}"plain": "record ${i} ${'abcdefghij'.repeat(i % 13)}",`);
    if (i % 5000 === 7) lines.push(`${t}${t}"long": "${'L'.repeat(6000)}${i}END",`);
    lines.push(`${t}${t}"last": ${i % 7}`, `${t}}${i + 1 < records ? ',' : ''}`);
  }
  lines.push(']');
  return lines.join('\n');
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (page) => page.evaluate(() => Number(window.__vis('.sb-r')?.textContent?.match(/Ln ([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0));
/** The editor's scroll height: the guessed rows and the real ones differ by far more than a few rows here. */
const height = (page) =>
  page.evaluate(() => {
    let el = document.getElementById('input');
    let best = null;
    for (; el && el !== document.body; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 4 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    return best?.scrollHeight ?? 0;
  });

/**
 * On a fresh load of the wrap document: if `after`, once the rows are in. Down to line 5 (the emoji line), `row` rows
 * more, End, then Enter x Enter y. Whether the break fell between characters and the letters where typed; and
 * whether the rows were still being counted then.
 */
async function endEnter(t, row, after) {
  const { page } = t;
  await t.open('/');
  const text = wrapDoc(30_000);
  t.assert(await load(page, text, 'wrap.json', { timeout: 180_000 * slow(t) }), 'the document loads');
  if (after) await pause(25_000 * slow(t));
  await page.locator('#input').focus();
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 30 && (await line(page)) < 5; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  // (A line of fewer rows: past it, nothing of this row to check.)
  if ((await line(page)) !== 5) return { row: row + 1, skipped: true };
  const h0 = await height(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await page.keyboard.type('y');
  if (!after) await pause(25_000 * slow(t));
  const counting = !after && Math.abs((await height(page)) - h0) > 10_000;
  const out = await copied(page, 'Copy input to clipboard', { timeout: 60_000 });
  const was = text.split('\n')[4];
  const [a, b, c] = (out ?? '').split('\n').slice(4, 7);
  const k = a?.length ?? -1;
  const breaks = new Set([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(was)].map((g) => g.index));
  breaks.add(was.length);
  return {
    row: row + 1,
    counting,
    split: !(was.startsWith(a ?? '\u0000') && breaks.has(k)),
    misplaced: !(b === '\t\tx' && c === `\t\ty${was.slice(k)}`),
    at: `${[...(a ?? '')].slice(-2).join('')}|${[...(b ?? '')].slice(0, 4).join('')}|${[...(c ?? '')].slice(0, 5).join('')}`,
  };
}

test('while a big text\'s rows are still counted: End then Enter on each row of a wrapped emoji line breaks it between characters, and what is typed goes where typed', async (t) => {
  const rows = [];
  for (const row of [0, 1, 2]) rows.push(await endEnter(t, row, false));
  t.log(rows);
  const bad = rows.filter((r) => !r.skipped && (r.split || r.misplaced));
  // (On main nothing is counted in steps: there this checks the rows as laid out, F25 only.)
  t.check(!bad.length, 'no row\'s End and Enter break a character or misplace the letters typed after', bad, {
    known: 'bug (branch, since f1aa3bc): while the rows are counted, End can stop at a guessed row end inside an emoji (👍|🏽); Enter breaks it there and the next Enter lands a character later (BREAKER-REPORT R9; main and branch also F25)',
  });
});

test('once a big text\'s rows are in: End then Enter on each row of a wrapped emoji line breaks it between characters, and what is typed goes where typed', async (t) => {
  const rows = [];
  for (const row of [0, 1, 2]) rows.push(await endEnter(t, row, true));
  t.log(rows);
  const bad = rows.filter((r) => !r.skipped && (r.split || r.misplaced));
  t.check(!bad.length, 'no row\'s End and Enter break a character or misplace the letters typed after', bad, {
    known: 'bug (main and branch): a wrapped row can end inside a ZWJ emoji (👨‍👩‍👧‍|👦), End stops there and Enter splits it (BREAKER-REPORT F25)',
  });
});
