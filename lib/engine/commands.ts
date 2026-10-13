import type { Engine } from './engine';
import { store, type UIState } from './store';

export interface Command {
  id: string;
  title: string;
  group: 'Edit' | 'File' | 'View' | 'Selection' | 'Settings' | 'Help';
  /** Shortcut, `mod` = ⌘ on macOS / Ctrl elsewhere. */
  keys?: string;
  /** Extra search terms. */
  terms?: string;
  active?: (s: UIState) => boolean;
  run: (e: Engine) => void;
}

export const COMMANDS: Command[] = [
  { id: 'format', group: 'Edit', title: 'Format / beautify JSON', keys: 'mod+Enter', terms: 'pretty print indent', run: (e) => e.format() },
  { id: 'minify', group: 'Edit', title: 'Minify / compact JSON', keys: 'mod+Shift+Enter', terms: 'compress uglify one line', run: (e) => e.minify() },
  { id: 'sort', group: 'Edit', title: 'Sort keys A → Z', terms: 'order alphabetical', run: (e) => e.sortKeys() },
  { id: 'repair', group: 'Edit', title: 'Repair JSON', terms: 'fix trailing comma quotes comments python', run: (e) => e.repair() },
  { id: 'escape', group: 'Edit', title: 'Escape — convert to a JSON string', terms: 'stringify quote', run: (e) => e.stringifyDoc() },
  { id: 'unescape', group: 'Edit', title: 'Unescape — parse stringified JSON', terms: 'parse string decode', run: (e) => e.unescapeDoc() },
  { id: 'error', group: 'Edit', title: 'Go to error', run: (e) => e.gotoError() },
  { id: 'jwt', group: 'Edit', title: 'Decode JWT', terms: 'token jsonwebtoken bearer', run: (e) => void e.decodeJwt() },
  { id: 'from-yaml', group: 'Edit', title: 'Convert YAML to JSON', terms: 'import yml', run: (e) => void e.importAs('yaml') },
  { id: 'from-xml', group: 'Edit', title: 'Convert XML to JSON', terms: 'import', run: (e) => void e.importAs('xml') },
  { id: 'from-csv', group: 'Edit', title: 'Convert CSV to JSON', terms: 'import spreadsheet tsv', run: (e) => void e.importAs('csv') },
  { id: 'from-toml', group: 'Edit', title: 'Convert TOML to JSON', terms: 'import', run: (e) => void e.importAs('toml') },
  { id: 'edit-anyway', group: 'Edit', title: 'Make large document editable', terms: 'read-only view mode', active: (s) => !s.viewOnly, run: (e) => e.editAnyway() },

  { id: 'copy', group: 'File', title: 'Copy JSON to clipboard', run: (e) => void e.copyAll() },
  { id: 'download', group: 'File', title: 'Download .json file', keys: 'mod+S', terms: 'save export', run: (e) => e.download() },
  { id: 'open', group: 'File', title: 'Open file…', keys: 'mod+O', terms: 'upload load import', run: (e) => e.openFile() },
  { id: 'paste', group: 'File', title: 'Paste from clipboard', run: (e) => void e.paste() },
  { id: 'url', group: 'File', title: 'Load JSON from URL…', terms: 'fetch api http', run: (e) => e.openPalette('url') },
  { id: 'share', group: 'File', title: 'Copy share link', terms: 'url link send', run: (e) => void e.share() },
  { id: 'sample', group: 'File', title: 'Load sample JSON', terms: 'example demo', run: (e) => e.sample() },
  { id: 'clear', group: 'File', title: 'Clear editor', terms: 'reset empty new', run: (e) => e.clear() },

  { id: 'tree', group: 'View', title: 'Tree view', keys: 'Alt+1', active: (s) => s.settings.view === 'tree', run: (e) => e.setView('tree') },
  { id: 'table', group: 'View', title: 'Table view', keys: 'Alt+2', terms: 'grid csv', active: (s) => s.settings.view === 'table', run: (e) => e.setView('table') },
  { id: 'convert', group: 'View', title: 'Convert to TypeScript, Zod, Go, YAML, CSV…', keys: 'Alt+3', terms: 'json to typescript interface type schema code generate class struct', active: (s) => s.settings.view === 'convert', run: (e) => e.setView('convert') },
  { id: 'compare', group: 'View', title: 'Compare / diff two JSON documents', keys: 'Alt+4', terms: 'diff compare difference', active: (s) => s.settings.view === 'compare', run: (e) => e.setView('compare') },
  { id: 'excel', group: 'File', title: 'Export to Excel (.xlsx)', terms: 'xlsx spreadsheet download', run: (e) => { e.setConvert({ target: 'xlsx' }); void e.downloadConvert(); } },
  { id: 'search', group: 'View', title: 'Search keys & values', keys: 'mod+F', terms: 'find filter jsonpath', run: (e) => e.focusSearch() },
  { id: 'expand', group: 'View', title: 'Expand all', run: (e) => e.expandAll() },
  { id: 'collapse', group: 'View', title: 'Collapse all', terms: 'fold', run: (e) => e.collapseAll() },
  { id: 'level1', group: 'View', title: 'Expand to level 1', run: (e) => e.expandTo(1) },
  { id: 'level2', group: 'View', title: 'Expand to level 2', run: (e) => e.expandTo(2) },
  { id: 'level3', group: 'View', title: 'Expand to level 3', run: (e) => e.expandTo(3) },
  { id: 'focus-tree', group: 'View', title: 'Focus tree', keys: 'Esc', run: (e) => e.focusTree() },
  { id: 'focus-editor', group: 'View', title: 'Focus editor', run: (e) => e.focusEditor() },

  { id: 'nested', group: 'Selection', title: 'Expand nested JSON string', terms: 'stringified embedded parse', run: (e) => void e.expandNested() },
  { id: 'copy-value', group: 'Selection', title: 'Copy selected value', run: (e) => e.copyValue() },
  { id: 'copy-path', group: 'Selection', title: 'Copy selected path', terms: 'jsonpath', run: (e) => e.copyPath() },
  { id: 'csv', group: 'Selection', title: 'Copy table as CSV', terms: 'excel spreadsheet', run: (e) => e.copyCSV() },
  { id: 'csv-download', group: 'Selection', title: 'Download table as CSV', terms: 'excel spreadsheet export', run: (e) => e.downloadCSV() },

  { id: 'indent-2', group: 'Settings', title: 'Indent with 2 spaces', active: (s) => s.settings.indent === '2', run: (e) => e.setIndent('2') },
  { id: 'indent-4', group: 'Settings', title: 'Indent with 4 spaces', active: (s) => s.settings.indent === '4', run: (e) => e.setIndent('4') },
  { id: 'indent-tab', group: 'Settings', title: 'Indent with tabs', active: (s) => s.settings.indent === 'tab', run: (e) => e.setIndent('tab') },
  { id: 'theme-system', group: 'Settings', title: 'Theme: match system', terms: 'auto appearance', active: (s) => s.settings.theme === 'system', run: (e) => e.setTheme('system') },
  { id: 'theme-light', group: 'Settings', title: 'Theme: light', terms: 'appearance', active: (s) => s.settings.theme === 'light', run: (e) => e.setTheme('light') },
  { id: 'theme-dark', group: 'Settings', title: 'Theme: dark', terms: 'appearance night', active: (s) => s.settings.theme === 'dark', run: (e) => e.setTheme('dark') },
  { id: 'autoformat', group: 'Settings', title: 'Auto-format on paste', active: (s) => s.settings.autoFormat, run: (e) => e.toggleAutoFormat() },

  { id: 'shortcuts', group: 'Help', title: 'Keyboard shortcuts', keys: '?', terms: 'help keys', run: () => store.set({ shortcuts: true }) },
];

/** Formats a shortcut for display. */
export function keyLabel(keys: string, mac: boolean): string[] {
  return keys.split('+').map((k) => {
    if (k === 'mod') return mac ? '⌘' : 'Ctrl';
    if (k === 'Shift') return mac ? '⇧' : 'Shift';
    if (k === 'Alt') return mac ? '⌥' : 'Alt';
    if (k === 'Enter') return '↵';
    return k;
  });
}

/** Subsequence fuzzy match score (higher is better), or -1. */
export function fuzzy(q: string, text: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct - (t.length - q.length) * 0.1 + (direct === 0 || t[direct - 1] === ' ' ? 200 : 0);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    streak = at === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (at - ti);
    ti = at + 1;
  }
  return score;
}
