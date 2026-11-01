// jsoneditoronline.org: two panels; the left one opens in text mode (CodeMirror 6) and its Format button
// reformats the text in place.
import { menuHas, repairOffered } from './_checks.mjs';
export default {
  id: 'jsoneditoronline',
  name: 'JSON Editor Online',
  url: 'https://jsoneditoronline.org/',
  input: { kind: 'cm6', sel: '.jse-text-mode .cm-editor', click: '.jse-text-mode .cm-content' },
  output: 'input',
  format: '.jse-text-mode button.jse-format',
  error: ['.jse-text-mode .jse-message.jse-error'],
  features: {
    indent: menuHas('button:has-text("Settings")', /indent/i),
    minify: '.jse-text-mode button.jse-compact',
    tree: 'button.jse-group-button:has-text("tree")',
    search: '.jse-text-mode button.jse-search',
    sortKeys: '.jse-text-mode button.jse-sort',
    copy: 'button.menu-button:has-text("Copy")',
    download: menuHas('button.menu-button:has-text("Save")', /^Save to disk$/),
    openFile: menuHas('button.menu-button:has-text("Open")', /^Open from disk$/),
    loadUrl: menuHas('button.menu-button:has-text("Open")', /^Open from url$/),
    darkMode: menuHas('button:has-text("Settings")', /^Dark$/),
    repair: repairOffered('button:has-text("Auto repair")'),
    convert: menuHas('button.menu-button:has-text("Save")', /^Export to CSV$/),
  },
};
