// Tool Kumar (the publisher's tool): a text box on the left; the Format view on the right updates on paste, so
// there is no format click. The view draws only the rows on screen, so "complete" means the end of the document
// shows when the view is scrolled to its end, and the full result is read with its Copy button.
import { copyOut, verifyText } from '../lib/harness.mjs';
import { menuHas, repairOffered } from './_checks.mjs';

export default {
  id: 'tool-kumar',
  name: 'Tool Kumar',
  url: 'https://tools.vikasmaur.com/',
  publisher: true,
  input: { kind: 'textarea', sel: 'textarea#input' },
  output: { kind: 'view', sel: '#view-format' },
  format: null,
  done: { fn: "const s = document.querySelector('#view-format'); if (!s) return false; s.scrollTop = s.scrollHeight; return s.innerText.includes(marker);" },
  readOutput: (page) => copyOut(page, 'section.pane-view button[aria-label="Copy"], section.pane-view button[title^="Copy"]'),
  verify: async (page) => verifyText(await copyOut(page, 'section.pane-view button[aria-label="Copy"], section.pane-view button[title^="Copy"]')),
  error: ['.pane-view .banner', 'footer.statusbar .st-msg'],
  features: {
    indent: menuHas('section.pane-view button[aria-label="More options"]', /^Indent$/),
    minify: 'section.pane-view button:has-text("Minify")',
    tree: 'button[role=tab]:has-text("Tree")',
    search: 'section.pane-view button[aria-label^="Find"], section.pane-view button[title^="Find"], section.pane-view button:has-text("Find")',
    sortKeys: menuHas('section.pane-view button[aria-label="More options"]', /^Sort keys$/),
    copy: 'section.pane-view button[aria-label="Copy"]',
    download: 'section.pane-view button[aria-label="Download"]',
    openFile: menuHas('button[aria-label="Input options"]', /^Open file$/),
    loadUrl: menuHas('button[aria-label="Input options"]', /^Load from URL$/),
    darkMode: 'button[aria-label^="Theme"], button[title^="Theme"], button:has-text("Theme")',
    repair: repairOffered('button:has-text("Repair input")'),
    convert: 'button[role=tab]:has-text("Convert")',
  },
};
