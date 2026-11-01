// jsonbeautifier.org: two Ace editors; "Beautify >>" formats the left one into the right one.
import { menuHas, shortcutShows } from './_checks.mjs';
export default {
  id: 'jsonbeautifier-org',
  name: 'JSON Beautifier (jsonbeautifier.org)',
  url: 'https://jsonbeautifier.org/',
  input: { kind: 'ace', sel: '#jsoneditor .ace_editor', click: '#jsoneditor .ace_scroller', a11y: '#jsoneditor textarea.ace_text-input' },
  output: { kind: 'ace', sel: '#jsoneditor-right .ace_editor' },
  format: 'button:has-text("Beautify >>")',
  error: [],
  features: {
    indent: 'select#tab-value',
    minify: 'button#Minify',
    tree: menuHas('#jsoneditor-right button.jsoneditor-modes', /^Tree$/),
    search: shortcutShows('#jsoneditor-right .ace_scroller', 'Control+F', '.ace_search'),
    sortKeys: 'button.jsoneditor-sort',
    copy: 'button.jsoneditor-copy',
    download: 'button.jsoneditor-download',
    openFile: 'button.jsoneditor-open',
    loadUrl: 'button#myBtn',
    darkMode: '[title*="dark" i], [aria-label*="theme" i], [title*="theme" i]',
    repair: 'button.jsoneditor-repair',
    convert: 'button:has-text("Convert")',
  },
};
