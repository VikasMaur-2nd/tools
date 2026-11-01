// jsonlint.com: a Monaco editor (it may load only when the box is clicked); formats in place.
import { shortcutShows, repairOffered } from './_checks.mjs';
export default {
  id: 'jsonlint',
  name: 'JSONLint',
  url: 'https://jsonlint.com/',
  async ready(page) {
    const box = page.locator('div.editor-container div.rounded-lg.cursor-text').first();
    if (await box.isVisible().catch(() => false)) await box.click();
    await page.locator('.editor-container .monaco-editor').first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length > 0, null, { timeout: 20_000 });
  },
  input: { kind: 'monaco', sel: '.editor-container .monaco-editor', click: '.editor-container .monaco-editor .view-lines' },
  output: 'input',
  // Some visitors get a Prettify button (Validate then only validates); others a layout where Validate also
  // reformats. Prettify is used when it is there (protocol 5: the control labelled Format / Beautify / Pretty print).
  format: async (page) => {
    const prettify = page.locator('button:text-is("Prettify")').first();
    return (await prettify.isVisible().catch(() => false)) ? prettify : page.locator('button:has-text("Validate")').first();
  },
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
