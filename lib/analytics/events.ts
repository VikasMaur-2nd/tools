/**
 * Every product-analytics event the site sends, and the only properties each
 * may carry. Nothing here can hold document text: values are feature names,
 * settings from fixed lists, booleans and rounded numbers. `clean` enforces the
 * same rule at runtime, so a careless call site still can't send free text.
 *
 * Not measured on purpose (would expose documents or their owners): document
 * text, keys, values and paths; search and JSONPath queries; file names; URLs
 * typed into Load from URL or named by a link; share links (they contain the
 * document); the site that handed a document over; the root type name; parser
 * messages (they quote the input); exact sizes and counts.
 */

/** `link`: a link carrying the document; `link_url`: a link naming a URL to fetch it from; `handoff`: sent by the page that opened the tab (lib/link.ts). */
const INPUT_SOURCES = ['paste', 'paste_button', 'file', 'drop', 'launch', 'url', 'link', 'link_url', 'handoff', 'sample'] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];
const FILE_KIND_LIST = ['json', 'jsonl', 'geojson', 'har', 'map', 'txt', 'log', 'csv', 'tsv', 'yaml', 'xml', 'toml', 'other', 'none'] as const;
export type FileKind = (typeof FILE_KIND_LIST)[number];
const VALIDITIES = ['valid', 'fixable', 'invalid', 'unknown'] as const;
type Validity = (typeof VALIDITIES)[number];
/** `shape`: huge-file mode's Shape panel. */
const VIEW_IDS = ['format', 'tree', 'table', 'graph', 'convert', 'compare', 'shape'] as const;
export type ViewId = (typeof VIEW_IDS)[number];
/** `context_menu`: an item of the right-click menu (components/ContextMenu.tsx); `agent`: an AI agent's WebMCP tool (lib/webmcp). */
const VIAS = ['pointer', 'keyboard', 'palette', 'context_menu', 'agent', 'other'] as const;
export type Via = (typeof VIAS)[number];

/** The JSON tool's functions an AI agent in the browser can call through WebMCP (lib/webmcp/tools.ts). */
const AGENT_TOOLS = [
  'open_json', 'check_json', 'get_json_value', 'repair_json', 'format_json',
  'convert_json', 'import_to_json', 'compare_json', 'decode_jwt', 'download_file', 'share_link', 'show_view',
] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

/** Huge-file mode (lib/huge): the file's size range (from 300 MB; smaller only when forced for testing), and how its indexing ended. */
const HUGE_SIZE_LIST = ['0-300MB', '300MB-1GB', '1-10GB', '10-100GB', '100GB+'] as const;
const HUGE_OUTCOMES = ['done', 'error', 'cancelled', 'replaced'] as const;
/** Huge mode's streamed commands (lib/huge/tasks.ts), what they read, how they ended and where they wrote. */
const HUGE_COMMANDS = ['pretty', 'minify', 'jsonl', 'json', 'csv', 'split', 'extract'] as const;
const HUGE_TARGETS = ['file', 'value'] as const;
const HUGE_RUN_OUTCOMES = ['done', 'error', 'stopped'] as const;
/** `picker`: the browser's save dialog; `folder`: a folder picked for Split's parts; `download`: written in the browser's storage, then downloaded; `zip`: Split's parts in one downloaded zip. */
const HUGE_SINKS = ['picker', 'folder', 'download', 'zip'] as const;
/** A .gz file: opened in the editor (small), in huge mode, or not (error, stopped, no space). */
const HUGE_GZ_OUTCOMES = ['editor', 'huge', 'error', 'stopped', 'space'] as const;
/** Huge mode's edits (lib/huge/edits.ts), and where they were asked from. */
const HUGE_EDIT_OPS = ['set', 'rename', 'remove', 'insert', 'duplicate', 'text', 'undo', 'redo', 'restore'] as const;
const HUGE_EDIT_FROM = ['tree', 'table', 'graph', 'menu', 'key', 'toolbar', 'palette', 'banner'] as const;
/** How a huge document was saved (in place, as another file, downloaded), and how it ended. */
const HUGE_SAVE_HOW = ['in_place', 'save_as', 'download'] as const;
const HUGE_SAVE_OUTCOMES = ['done', 'stopped', 'failed'] as const;

/** Discrete actions, reported as `feature_used { feature }`. */
const FEATURES = [
  'copy_input', 'copy_output', 'copy_convert', 'copy_value', 'copy_path', 'copy_csv',
  'download_input', 'download_output', 'download_convert', 'download_csv', 'export_xlsx',
  'graph_fit', 'graph_zoom_in', 'graph_zoom_out', 'graph_export_png', 'graph_export_jpeg', 'graph_export_svg', 'graph_copy_image', 'graph_jump',
  'share_link', 'share_compare', 'repair', 'unescape', 'escape', 'decode_jwt', 'expand_nested', 'use_output',
  'format_input', 'minify_input', 'sort_input', 'clear',
  'import_yaml', 'import_xml', 'import_csv', 'import_toml',
  'find', 'expand_all', 'collapse_all', 'expand_level', 'fold_input',
  'compare_swap', 'compare_format', 'compare_close',
  'wrap', 'auto_format', 'theme', 'shortcuts', 'palette', 'load_url_dialog', 'context_menu',
  'shape_go', 'shape_next', 'shape_count',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Event name → its properties. Optional properties may be left out. */
export interface Events {
  /** A document arrived in an editor. Sent once its first check finishes. */
  json_loaded: {
    source: InputSource;
    /** 1 = the input editor, 2 = Compare's modified document. */
    editor: 1 | 2;
    file_kind: FileKind;
    /** (Left out for a document replaced before it was checked.) */
    size?: string;
    size_kb?: number;
    validity: Validity;
    error_kind?: string;
    issues?: string;
    nodes?: string;
    depth?: number;
    parse_ms?: number;
    jsonl?: boolean;
    jwt?: boolean;
  };
  /** `target`: the Convert language active when the Convert view opens. */
  view_opened: { view: ViewId; via: Via; target?: string };
  convert_target_selected: { target: string; group: 'types' | 'data'; via: Via };
  convert_option_changed: { option: 'ts_style' | 'csharp_lib'; value: string };
  format_option_changed: { option: 'style' | 'sort_keys' | 'indent'; value: string };
  feature_used: { feature: Feature; via: Via; view?: ViewId; level?: number; on?: boolean; value?: string; jsonpath?: boolean };
  command_run: { command: string };
  /** An AI agent called one of the tool's functions (`ok`: it did what was asked). What it sent and got back is never included. */
  agent_tool_used: { tool: AgentToolName; ok: boolean };
  /**
   * A file too big for the editor opened in huge-file mode. Sent once its indexing ends (finished, stopped at an
   * error, cancelled) or when another document replaces it first. `forced`: huge mode was forced for testing.
   */
  huge_opened: {
    source: InputSource;
    file_kind: FileKind;
    size: (typeof HUGE_SIZE_LIST)[number];
    outcome: (typeof HUGE_OUTCOMES)[number];
    jsonl: boolean;
    index_ms: number;
    forced: boolean;
  };
  /** A streamed command over a huge file ended (Convert view). `filtered`: Extract with conditions. */
  huge_command: {
    command: (typeof HUGE_COMMANDS)[number];
    target: (typeof HUGE_TARGETS)[number];
    outcome: (typeof HUGE_RUN_OUTCOMES)[number];
    sink: (typeof HUGE_SINKS)[number];
    gzip: boolean;
    size: (typeof HUGE_SIZE_LIST)[number];
    ms: number;
    filtered: boolean;
  };
  /** The Shape panel's pass over a huge file ended. `paths`: how many paths it found, as a range. */
  huge_shape: {
    target: (typeof HUGE_TARGETS)[number];
    outcome: (typeof HUGE_RUN_OUTCOMES)[number];
    size: (typeof HUGE_SIZE_LIST)[number];
    ms: number;
    paths: string;
  };
  /** A .gz file was opened (decompressed in the browser). `size`: the compressed file's range. */
  huge_gz: {
    outcome: (typeof HUGE_GZ_OUTCOMES)[number];
    size: (typeof HUGE_SIZE_LIST)[number];
    ms: number;
  };
  /** An edit in huge mode was made: its kind and where it was asked from (never what it changed). */
  huge_edit: {
    op: (typeof HUGE_EDIT_OPS)[number];
    from: (typeof HUGE_EDIT_FROM)[number];
  };
  /** A huge document was saved: how, how it ended, the document's size range. */
  huge_save: {
    how: (typeof HUGE_SAVE_HOW)[number];
    outcome: (typeof HUGE_SAVE_OUTCOMES)[number];
    size: (typeof HUGE_SIZE_LIST)[number];
    ms: number;
  };
}

export type EventName = keyof Events;

// ── Rounding: shapes and sizes, never exact values ───────────────────────────

/** 1234567 → 1200000: two significant digits, enough for charts and percentiles. */
export function round2(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

const SIZE_EDGES: [number, string][] = [
  [1024, '0-1KB'],
  [10 * 1024, '1-10KB'],
  [100 * 1024, '10-100KB'],
  [1024 * 1024, '100KB-1MB'],
  [10 * 1024 * 1024, '1-10MB'],
  [100 * 1024 * 1024, '10-100MB'],
];

/** Document size as a range label. */
export function sizeBucket(bytes: number): string {
  for (const [edge, label] of SIZE_EDGES) if (bytes < edge) return label;
  return '100MB+';
}

/** Size in KB rounded to two significant digits (0 for under 1 KB). */
export const sizeKb = (bytes: number) => (bytes < 1024 ? 0 : round2(bytes / 1024));

/** A count as a power-of-ten range: 0, 1-9, 10-99, 100-999, 1k-9.9k … 1M+. */
export function countBucket(n: number): string {
  if (!(n > 0)) return '0';
  if (n < 10) return '1-9';
  if (n < 100) return '10-99';
  if (n < 1000) return '100-999';
  if (n < 10_000) return '1k-9.9k';
  if (n < 100_000) return '10k-99k';
  if (n < 1_000_000) return '100k-999k';
  return '1M+';
}

const FILE_KINDS: Record<string, FileKind> = {
  json: 'json', jsonl: 'jsonl', ndjson: 'jsonl', geojson: 'geojson', har: 'har', map: 'map', txt: 'txt', log: 'log',
  csv: 'csv', tsv: 'tsv', yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml',
};

/** The kind of file from its extension only; the name itself is never kept. */
export function fileKind(name: string | null | undefined): FileKind {
  if (!name) return 'none';
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return (m && FILE_KINDS[m[1].toLowerCase()]) || 'other';
}

/**
 * The parser's message reduced to a fixed category. Messages can quote the
 * input (`Unexpected 'abc…'`, `Duplicate key "password"`), so only the category
 * is sent. Order matters: the first match wins.
 */
const ERROR_KINDS: [RegExp, string][] = [
  [/^Unterminated string/, 'unterminated_string'],
  [/^Unexpected end of input/, 'unexpected_end'],
  [/^Comments are not allowed/, 'comments'],
  [/^Trailing commas/, 'trailing_comma'],
  [/^Unexpected (extra )?comma/, 'extra_comma'],
  [/^Missing value in array/, 'missing_value'],
  [/^Expected ',' (or|between)/, 'missing_comma'],
  [/^Expected ':'/, 'missing_colon'],
  [/^Expected '[}\]]' to close/, 'mismatched_bracket'],
  [/^Expected a property name|^Property names must be wrapped/, 'unquoted_key'],
  [/must use (straight )?double quotes/, 'single_quotes'],
  [/strings must be wrapped in double quotes/, 'unquoted_string'],
  [/^Invalid (unicode )?escape|^Line continuations/, 'invalid_escape'],
  [/^Control characters|^Line breaks inside strings|^Invalid whitespace character/, 'control_character'],
  [/^Invalid number|^Invalid hexadecimal|^Hexadecimal numbers|^Numbers |^Expected a digit/, 'number_format'],
  [/^Use lowercase|^Use null instead/, 'literal_case'],
  [/Did you mean (true|false|null)\?$/, 'literal_typo'],
  [/is not valid JSON \(replaced with null\)$/, 'nan_infinity'],
  [/\(…\) is not valid JSON|^Expected '\)'/, 'function_call'],
  [/byte order mark/, 'bom'],
  [/after the JSON value$/, 'trailing_content'],
  [/^Multiple top-level values/, 'multiple_values'],
  [/code fence/, 'code_fence'],
  [/^Nesting is too deep/, 'too_deep'],
  [/^No JSON value$/, 'no_value'],
  [/^Duplicate key/, 'duplicate_key'],
  [/^Unexpected .*: expected a value$/, 'unexpected_token'],
];

export function errorKind(msg: string | undefined): string | undefined {
  if (!msg) return undefined;
  for (const [re, kind] of ERROR_KINDS) if (re.test(msg)) return kind;
  return 'other';
}

// ── What each property may hold ──────────────────────────────────────────────

/** Convert targets (lib/engine/targets.ts) and the palette's commands (lib/engine/commands.ts): tests/analytics.test.ts checks every one passes. */
const TARGET_IDS = ['typescript', 'zod', 'json-schema', 'csharp', 'dart', 'java', 'python', 'go', 'kotlin', 'swift', 'php', 'rust', 'csv', 'xlsx', 'yaml', 'xml', 'toml', 'jsonl'];
const COMMAND_IDS = [
  'undo', 'redo', 'use-output', 'format', 'minify', 'sort', 'out-pretty', 'out-minify', 'out-string', 'out-sort', 'copy-output', 'download-output',
  'repair', 'escape', 'unescape', 'error', 'jwt', 'from-yaml', 'from-xml', 'from-csv', 'from-toml', 'copy', 'download', 'open', 'paste', 'url',
  'share', 'share-markdown', 'share-html', 'sample', 'clear', 'format-view', 'tree', 'table', 'graph', 'graph-fit', 'graph-start', 'graph-end',
  'graph-export', 'graph-copy', 'graph-png', 'graph-svg', 'convert', 'compare', 'excel', 'copy-convert', 'download-convert', 'search', 'expand',
  'collapse', 'level1', 'level2', 'level3', 'fold-input', 'unfold-input', 'close-compare', 'focus-tree', 'focus-editor', 'nested', 'copy-value',
  'copy-path', 'csv', 'csv-download', 'indent-2', 'indent-4', 'indent-tab', 'theme-system', 'theme-light', 'theme-dark', 'autoformat', 'wrap',
  'privacy-mode', 'integrate', 'handoff', 'shortcuts', 'shape', 'huge-undo', 'huge-redo', 'huge-save', 'huge-save-as', 'huge-edit', 'huge-text', 'huge-rename', 'huge-insert', 'huge-insert-inside', 'huge-duplicate', 'huge-delete', ...TARGET_IDS.map((t) => `to-${t}`),
];
const SIZES = [...SIZE_EDGES.map(([, label]) => label), '100MB+'];
const ERROR_KIND_LIST = [...ERROR_KINDS.map(([, kind]) => kind), 'other'];
const COUNTS = ['0', '1-9', '10-99', '100-999', '1k-9.9k', '10k-99k', '100k-999k', '1M+'];

/** What a property may hold: a value from a fixed list, a boolean ('flag'), or a number (sent rounded to two significant digits). */
type Rule = readonly (string | number)[] | 'flag' | 'number';

/** Every event's properties and what each may hold, enforced at runtime by `clean`. */
const RULES: { [K in EventName]: { readonly [P in keyof Events[K]]-?: Rule } } = {
  json_loaded: {
    source: INPUT_SOURCES, editor: [1, 2], file_kind: FILE_KIND_LIST, size: SIZES, size_kb: 'number', validity: VALIDITIES, error_kind: ERROR_KIND_LIST,
    issues: COUNTS, nodes: COUNTS, depth: 'number', parse_ms: 'number', jsonl: 'flag', jwt: 'flag',
  },
  view_opened: { view: VIEW_IDS, via: VIAS, target: TARGET_IDS },
  convert_target_selected: { target: TARGET_IDS, group: ['types', 'data'], via: VIAS },
  convert_option_changed: { option: ['ts_style', 'csharp_lib'], value: ['interface', 'type', 'stj', 'newtonsoft'] },
  format_option_changed: { option: ['style', 'sort_keys', 'indent'], value: ['pretty', 'minify', 'string', 'true', 'false', '2', '4', 'tab'] },
  feature_used: {
    feature: FEATURES, via: VIAS, view: VIEW_IDS, level: 'number', on: 'flag', jsonpath: 'flag',
    // Share formats, themes, and the right-click menu's areas.
    value: ['link', 'markdown', 'html', 'system', 'light', 'dark', 'input', 'compare', 'format', 'convert', 'tree', 'table', 'graph', 'diff'],
  },
  command_run: { command: COMMAND_IDS },
  agent_tool_used: { tool: AGENT_TOOLS, ok: 'flag' },
  huge_opened: { source: INPUT_SOURCES, file_kind: FILE_KIND_LIST, size: HUGE_SIZE_LIST, outcome: HUGE_OUTCOMES, jsonl: 'flag', index_ms: 'number', forced: 'flag' },
  huge_command: { command: HUGE_COMMANDS, target: HUGE_TARGETS, outcome: HUGE_RUN_OUTCOMES, sink: HUGE_SINKS, gzip: 'flag', size: HUGE_SIZE_LIST, ms: 'number', filtered: 'flag' },
  huge_shape: { target: HUGE_TARGETS, outcome: HUGE_RUN_OUTCOMES, size: HUGE_SIZE_LIST, ms: 'number', paths: COUNTS },
  huge_gz: { outcome: HUGE_GZ_OUTCOMES, size: HUGE_SIZE_LIST, ms: 'number' },
  huge_edit: { op: HUGE_EDIT_OPS, from: HUGE_EDIT_FROM },
  huge_save: { how: HUGE_SAVE_HOW, outcome: HUGE_SAVE_OUTCOMES, size: HUGE_SIZE_LIST, ms: 'number' },
};

/** Allowed properties per event (see `clean`). */
export const EVENT_PROPS = Object.fromEntries(Object.entries(RULES).map(([e, r]) => [e, Object.keys(r)])) as unknown as { [K in EventName]: readonly (keyof Events[K])[] };

/**
 * Keeps the event's listed properties that hold what their rule allows: a value
 * from the property's fixed list, a boolean, or a finite number (rounded to two
 * significant digits). Drops everything else. Returns null for an unknown event.
 */
export function clean(event: string, props: Record<string, unknown>): Record<string, string | number | boolean> | null {
  const rules = (RULES as Record<string, Record<string, Rule>>)[event];
  if (!rules) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const k in rules) {
    const rule = rules[k];
    const v = props[k];
    if (rule === 'flag') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (rule === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = round2(v);
    } else if ((typeof v === 'string' || typeof v === 'number') && rule.includes(v)) out[k] = v;
  }
  return out;
}

/**
 * What the page knows when a document has arrived (lib/analytics/index.ts).
 * It holds the file name and the parser's message, so it is never sent as is:
 * `loadedProps` keeps the extension's kind, ranges and the error category.
 */
export interface RawLoad {
  source: InputSource;
  editor: 1 | 2;
  file: string | null;
  /** (Unknown for a document replaced before it was checked.) */
  bytes?: number;
  status: string;
  msg?: string;
  count?: number;
  warnings?: number;
  stats?: { nodes: number; depth: number; ms: number };
  jsonl?: boolean;
  jwt?: boolean;
}

export function loadedProps(r: RawLoad): Events['json_loaded'] {
  const st = r.status;
  const s = r.stats;
  return {
    source: r.source,
    editor: r.editor,
    file_kind: fileKind(r.file),
    size: r.bytes === undefined ? undefined : sizeBucket(r.bytes),
    size_kb: r.bytes === undefined ? undefined : sizeKb(r.bytes),
    validity: st === 'valid' ? 'valid' : st === 'fixable' ? 'fixable' : st === 'error' ? 'invalid' : 'unknown',
    error_kind: st === 'error' || st === 'fixable' || (st === 'valid' && r.warnings) ? errorKind(r.msg) : undefined,
    issues: r.count !== undefined ? countBucket(r.count) : undefined,
    nodes: s ? countBucket(s.nodes) : undefined,
    depth: s ? Math.min(s.depth, 50) : undefined,
    parse_ms: s ? round2(s.ms) : undefined,
    jsonl: r.jsonl,
    jwt: r.jwt,
  };
}
