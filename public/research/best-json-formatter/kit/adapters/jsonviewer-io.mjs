// jsonviewer.io: one Monaco editor (no global API) with a "format" button that reformats it in place.
// Monaco sizes its scroll content to the line count, so the result is complete when that reaches the formatted
// document's length; the full result is read with the site's copy button.
import { copyOut, verifyText } from '../lib/harness.mjs';
import { shortcutShows, repairOffered } from './_checks.mjs';

export default {
  id: 'jsonviewer-io',
  name: 'JSON Viewer (jsonviewer.io)',
  url: 'https://jsonviewer.io/',
  input: { kind: 'monaco', sel: '.monaco-editor', click: '.monaco-editor .view-lines' },
  output: 'input',
  format: 'button:has-text("format")',
  readOutput: (page) => copyOut(page, 'button:has-text("copy")'),
  verify: async (page) => verifyText(await copyOut(page, 'button:has-text("copy")')),
  error: ['.notification .notification-message'],
  features: {
    indent: '[aria-label*="indent" i], select:has(option:text-matches("space|tab", "i"))',
    minify: 'button:has-text("minimize")',
    tree: 'button.view-switcher-button:has-text("View")',
    search: shortcutShows('.monaco-editor .view-lines', 'Control+F', '.find-widget.visible'),
    sortKeys: 'button:has-text("sort")',
    copy: 'button:has-text("copy")',
    download: 'button:has-text("download")',
    openFile: 'button:has-text("upload")',
    loadUrl: 'button:has-text("url")',
    darkMode: 'button[title*="theme" i]',
    repair: repairOffered('button:has-text("repair"), button:has-text("fix")'),
    convert: 'button:has-text("convert")',
  },
};
