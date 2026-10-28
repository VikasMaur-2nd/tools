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

test('while a big text\'s rows are still counted: End then Enter on a wrapped emoji line breaks it between characters, and what is typed follows the break', async (t) => {
  const { page } = t;
  await t.open('/');
  const text = wrapDoc(30_000);
  t.assert(await load(page, text, 'wrap.json', { timeout: 180_000 * slow(t) }), 'the document loads');
  // At once: down to line 5 (the emoji line), the end of its first row, Enter, a letter.
  await page.locator('#input').focus();
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 30 && (await line(page)) < 5; i++) await page.keyboard.press('ArrowDown');
  const h0 = await height(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await pause(25_000 * slow(t));
  const counting = Math.abs((await height(page)) - h0) > 10_000;
  t.log(counting ? 'acted while the rows were counted' : 'the rows were in already: this run checks the real rows');
  const out = await copied(page, 'Copy input to clipboard', { timeout: 60_000 });
  const was = text.split('\n')[4];
  const [a, b] = (out ?? '').split('\n').slice(4, 6);
  const k = a?.length ?? -1;
  const breaks = new Set([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(was)].map((g) => g.index));
  const known = counting ? { known: 'bug (branch, since f1aa3bc): while the rows are counted, End can stop inside an emoji, and Enter breaks the line there while what is typed goes after the emoji (BREAKER-REPORT R9)' } : {};
  t.check(was.startsWith(a ?? '\u0000') && breaks.has(k), 'Enter breaks the line between characters', { at: k, end: [...(a ?? '')].slice(-3).join(''), next: [...(b ?? '')].slice(0, 6).join('') }, known);
  t.check(b === `\t\tx${was.slice(k)}`, 'the letter typed starts the new line, the rest of the line after it', [...(b ?? '')].slice(0, 6).join(''), known);
});
