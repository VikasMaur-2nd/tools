// codebeautify.org/jsonviewer: an Ace input on the left, a result panel on the right, and a Beautify button.
import { shortcutShows } from './_checks.mjs';
export default {
  id: 'codebeautify',
  name: 'Code Beautify JSON Viewer',
  url: 'https://codebeautify.org/jsonviewer',
  input: { kind: 'ace', sel: '#inputJsonEditor .ace_editor', click: '#inputJsonEditor .ace_scroller', a11y: '#inputJsonEditor textarea.ace_text-input' },
  output: { kind: 'ace', sel: '#outputJsonEditor .ace_editor, #outputeditor .ace_editor' },
  format: 'button:has-text("Beautify")',
  error: ['#topMessage.is-danger'],
  features: {
    indent: 'select#indent',
    minify: 'button:has-text("Minify")',
    tree: 'button:has-text("Tree Viewer")',
    search: shortcutShows('#inputJsonEditor .ace_scroller', 'Control+F', '.ace_search'),
    sortKeys: 'button.jsoneditor-sort',
    copy: 'a#inputcopy, #outputdiv [title*="copy" i]',
    download: 'button:has-text("Download")',
    openFile: 'button:has-text("File")',
    loadUrl: 'button:has-text("URL")',
    darkMode: 'a:has-text("DarkMode")',
    repair: 'button.jsoneditor-repair',
    convert: 'button:has-text("to XML")',
  },
};
