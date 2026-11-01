// jsonchecker.com: one CodeMirror 5 editor and a Format button that reformats it in place.
import { shortcutShows, repairOffered } from './_checks.mjs';
export default {
  id: 'jsonchecker',
  name: 'JSON Checker',
  url: 'https://jsonchecker.com/',
  input: { kind: 'cm5', sel: '#editor-host .CodeMirror', click: '#editor-host .CodeMirror-scroll' },
  output: 'input',
  format: '#format-btn',
  error: ['#admonitions'],
  features: {
    indent: 'select:has(option:text-matches("space|tab", "i"))',
    minify: 'button:has-text("Minify"), button:has-text("Compact")',
    tree: 'button:has-text("Tree")',
    search: shortcutShows('#editor-host .CodeMirror-scroll', 'Control+F', '.CodeMirror-dialog'),
    sortKeys: 'button:has-text("Sort")',
    copy: 'button:has-text("Copy"), [aria-label*="copy" i]',
    download: 'button:has-text("Download")',
    openFile: 'button:has-text("Open"), button:has-text("Upload")',
    loadUrl: 'button:has-text("URL")',
    darkMode: '[aria-label*="theme" i], [title*="dark" i]',
    repair: repairOffered('button:has-text("Fix"), button:has-text("Repair")'),
    convert: 'button:has-text("Convert")',
  },
};
