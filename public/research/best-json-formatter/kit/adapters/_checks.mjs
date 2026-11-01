// Feature checks shared by the adapters (protocol 5.9). Each returns an async (page, adapter) => boolean that the
// features run calls on the live page. A plain selector string in an adapter means "this control is visible".
import { ERROR_CASES } from '../cases.mjs';
import { focusInput, pasteSmall, stage } from '../lib/harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (page, sel, timeout = 2000) => page.locator(sel).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);

/** Opening `button` shows an item whose text matches `item`. */
export const menuHas = (button, item) => async (page) => {
  await page.locator(button).first().click({ timeout: 8000 });
  try {
    return await page.getByText(item).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false);
  } finally {
    await page.keyboard.press('Escape');
    await sleep(300);
  }
};

/** A select (or a menu) offers an option whose text matches. */
export const selectHas = (select, option) => async (page) =>
  page.locator(select).first().evaluate((s, src) => [...s.options].some((o) => new RegExp(src, 'i').test(o.text)), option.source);

/** Focusing the editor and pressing `keys` shows `shown` (e.g. Ctrl+F opens the editor's search box). */
export const shortcutShows = (focus, keys, shown) => async (page) => {
  await page.locator(focus).first().click({ timeout: 8000 });
  await page.keyboard.press(keys);
  try {
    return await visible(page, shown);
  } finally {
    await page.keyboard.press('Escape');
  }
};

/** After pasting invalid JSON (a trailing comma) and formatting, a repair control is offered. */
export const repairOffered = (sel) => async (page, adapter) => {
  await stage(page, adapter, ERROR_CASES[0].text);
  await pasteSmall(page, adapter, { text: ERROR_CASES[0].text, timeoutMs: 5000 });
  return visible(page, sel);
};

export { visible, focusInput };
