// jsonviewer.stack.hu: a Text tab with a plain text box and a Format button that reformats it in place.
export default {
  id: 'jsonviewer-stack',
  name: 'Online JSON Viewer (jsonviewer.stack.hu)',
  url: 'https://jsonviewer.stack.hu/',
  input: { kind: 'textarea', sel: 'textarea#edit' },
  output: 'input',
  format: 'button:has-text("Format")',
  error: [],
  features: {
    indent: 'select:has(option:text-matches("space|tab", "i"))',
    minify: 'button:has-text("Remove white space")',
    tree: 'a:has-text("Viewer")',
    search: '[class*="search"] input:visible',
    sortKeys: 'button:has-text("Sort")',
    copy: 'button:has-text("Copy")',
    download: 'button:has-text("Download"), button:has-text("Save")',
    openFile: 'button:has-text("Open"), input[type=file]:visible',
    loadUrl: 'button:has-text("Load JSON data")',
    darkMode: '[title*="dark" i], [aria-label*="theme" i]',
    repair: 'button:has-text("Repair"), button:has-text("Fix")',
    convert: 'button:has-text("Convert")',
  },
};
