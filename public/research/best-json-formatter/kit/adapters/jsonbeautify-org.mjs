// jsonbeautify.org/en/json-formatter: an input text box and an output text box.
import { menuHas, repairOffered } from './_checks.mjs';
export default {
  id: 'jsonbeautify-org',
  name: 'JSON Beautifier (jsonbeautify.org)',
  url: 'https://www.jsonbeautify.org/en/json-formatter',
  input: { kind: 'textarea', sel: 'textarea[aria-label="Paste or type your JSON here..."]' },
  output: { kind: 'textarea', sel: 'textarea[aria-label="Formatted output will appear here..."]' },
  format: null,
  error: ['div.flex.flex-col.gap-1:has(span:text-is("Invalid JSON"))'],
  features: {
    indent: menuHas('button#indent', /^4 spaces$/),
    minify: 'button:has-text("Minify")',
    tree: 'button[role=tab]:has-text("Tree")',
    search: '[placeholder*="search" i]:visible, button[aria-label*="search" i]',
    sortKeys: 'button:has-text("Sort Keys")',
    copy: 'button:has-text("Copy")',
    download: 'button:has-text("Download")',
    openFile: 'button[aria-label="Upload JSON file"]',
    loadUrl: 'button:has-text("Load URL")',
    darkMode: 'button[aria-label="Toggle theme"]',
    repair: repairOffered('button:has-text("Auto-fix")'),
    convert: menuHas('button[aria-label="Output format"]', /^YAML$/),
  },
};
