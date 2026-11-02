// jsonlint.com: a Monaco editor (it may load only when the box is clicked); formats in place.
import { shortcutShows, repairOffered } from './_checks.mjs';
export default {
  id: 'jsonlint',
  name: 'JSONLint',
  url: 'https://jsonlint.com/',
  // JSONLint serves visitors different layouts (seen on the runners within minutes of each other): a Monaco editor
  // that may load only when the box is clicked, or another editor. ready() finds which one this visit got.
  async ready(page) {
    const kinds = [
      ['.editor-container .monaco-editor', { kind: 'monaco', sel: '.editor-container .monaco-editor', click: '.editor-container .monaco-editor .view-lines' }],
      ['.editor-container .cm-editor', { kind: 'cm6', sel: '.editor-container .cm-editor', click: '.editor-container .cm-content' }],
      ['.editor-container .CodeMirror', { kind: 'cm5', sel: '.editor-container .CodeMirror', click: '.editor-container .CodeMirror-scroll' }],
      ['.editor-container textarea:not(.ime-text-area):not(.inputarea)', { kind: 'textarea', sel: '.editor-container textarea:not(.ime-text-area):not(.inputarea)' }],
    ];
    // The editor loads only after its placeholder ("Click here to start editing JSON…") is clicked, and on a busy
    // machine it can take a while: click the placeholder, and again every few seconds while it still shows, for up to
    // 60 s. Nothing has been pasted yet, so this wait is not part of any timing.
    const editor = page.locator(kinds.map(([sel]) => sel).join(', ')).first();
    const placeholder = page.locator('div.editor-container div.cursor-text, div.editor-container :text("Click here to start editing")').first();
    for (let t = 0; t < 60_000; t += 5000) {
      if (await editor.isVisible().catch(() => false)) break;
      if (await placeholder.isVisible().catch(() => false)) await placeholder.click({ timeout: 5000 }).catch(() => {});
      await editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }
    await editor.waitFor({ state: 'visible', timeout: 1000 });
    for (const [sel, input] of kinds) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        this.input = input;
        break;
      }
    }
    if (this.input.kind === 'monaco') await page.waitForFunction(() => window.__fmt.io('monaco', '.editor-container .monaco-editor').lines() >= 1, null, { timeout: 30_000 }).catch(() => {});
  },
  input: { kind: 'monaco', sel: '.editor-container .monaco-editor', click: '.editor-container .monaco-editor .view-lines' },
  output: 'input',
  // Formatting is two steps on the current layout: the Prettify button appears once the input has been validated,
  // so a person presses Validate, then Prettify. (On the older layout, without Prettify, Validate also reformats.)
  // The timing starts at the first click.
  format: 'button:has-text("Prettify"), button:has-text("Validate")',
  async formatAction(page, { timeout = 10_000 } = {}) {
    const prettify = page.locator('button:has-text("Prettify")').first();
    const shown = () => prettify.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false);
    if (!(await shown())) {
      await page.locator('button:has-text("Validate")').first().click({ timeout }); // a big paste can keep the page busy
      await prettify.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    if (await prettify.isVisible().catch(() => false)) await prettify.click({ timeout });
  },
  keyboard: { shortcut: 'Control+Shift+F' },
  error: ['div.space-y-3.px-3.py-2:has(span:text-is("Invalid JSON"))'],
  features: {
    indent: '[aria-label*="indent" i], select:has(option:text-matches("space|tab", "i"))',
    minify: 'button:has-text("Compress")',
    tree: '.editor-container ~ * button:has-text("Tree")',
    search: shortcutShows('.editor-container .monaco-editor .view-lines', 'Control+F', '.find-widget.visible'),
    sortKeys: 'button:has-text("Sort Keys")',
    copy: 'button:has-text("Copy")',
    download: 'button:has-text("Download")',
    openFile: 'button:has-text("Upload"), button:has-text("Open file")',
    loadUrl: 'button:has-text("Load URL"), button:has-text("From URL")',
    darkMode: 'button[aria-label="Toggle theme"]',
    repair: repairOffered('button:has-text("Fix"), button:has-text("Repair")'),
    convert: '.editor-container ~ * button:has-text("to YAML"), .editor-container ~ * button:has-text("to CSV")',
  },
};
