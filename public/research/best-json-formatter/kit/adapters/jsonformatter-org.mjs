// jsonformatter.org: two Ace editors (left input, right output) and a "Format / Beautify" button.
import { menuHas, shortcutShows } from './_checks.mjs';
export default {
  id: 'jsonformatter-org',
  name: 'JSON Formatter (jsonformatter.org)',
  url: 'https://jsonformatter.org/',
  input: { kind: 'ace', sel: '#inputeditor .ace_editor', click: '#inputeditor .ace_scroller', a11y: '#inputeditor textarea.ace_text-input' },
  output: { kind: 'ace', sel: '#outputeditor .ace_editor' },
  format: '#defaultaction',
  error: ['#msgDiv .alert-danger', '#outputeditor textarea:not(.ace_text-input)'],
  features: {
    indent: 'select#sel1',
    minify: 'button:has-text("Minify / Compact")',
    tree: menuHas('#outputeditor button.jsoneditor-modes', /^Tree$/),
    search: shortcutShows('#outputeditor .ace_scroller', 'Control+F', '.ace_search'),
    sortKeys: 'button.jsoneditor-sort',
    copy: '[title*="copy" i], [aria-label*="copy" i], button:has-text("Copy")',
    download: 'button:has-text("Download")',
    openFile: menuHas('button:has-text("Upload Data")', /^Upload File$/),
    loadUrl: menuHas('button:has-text("Upload Data")', /^Load URL$/),
    darkMode: '[title*="dark" i], [aria-label*="theme" i], [title*="theme" i]',
    repair: 'button.jsoneditor-repair',
    convert: 'button:has-text("Convert JSON to")',
  },
};
