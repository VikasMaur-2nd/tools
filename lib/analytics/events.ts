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
export type InputSource = 'paste' | 'paste_button' | 'file' | 'drop' | 'launch' | 'url' | 'link' | 'link_url' | 'handoff' | 'sample';
export type FileKind = 'json' | 'jsonl' | 'geojson' | 'har' | 'map' | 'txt' | 'log' | 'csv' | 'tsv' | 'yaml' | 'xml' | 'toml' | 'other' | 'none';
export type Validity = 'valid' | 'fixable' | 'invalid' | 'unknown';
export type ViewId = 'format' | 'tree' | 'table' | 'graph' | 'convert' | 'compare';
/** `context_menu`: an item of the right-click menu (components/ContextMenu.tsx); `agent`: an AI agent's WebMCP tool (lib/webmcp). */
export type Via = 'pointer' | 'keyboard' | 'palette' | 'context_menu' | 'agent' | 'other';

/** The JSON tool's functions an AI agent in the browser can call through WebMCP (lib/webmcp/tools.ts). */
export type AgentToolName =
  | 'open_json' | 'check_json' | 'get_json_value' | 'repair_json' | 'format_json'
  | 'convert_json' | 'import_to_json' | 'compare_json' | 'decode_jwt' | 'download_file' | 'share_link' | 'show_view';

/** Discrete actions, reported as `feature_used { feature }`. */
export type Feature =
  | 'copy_input' | 'copy_output' | 'copy_convert' | 'copy_value' | 'copy_path' | 'copy_csv'
  | 'download_input' | 'download_output' | 'download_convert' | 'download_csv' | 'export_xlsx'
  | 'graph_fit' | 'graph_zoom_in' | 'graph_zoom_out' | 'graph_export_png' | 'graph_export_jpeg' | 'graph_export_svg' | 'graph_copy_image' | 'graph_jump'
  | 'share_link' | 'share_compare' | 'repair' | 'unescape' | 'escape' | 'decode_jwt' | 'expand_nested' | 'use_output'
  | 'format_input' | 'minify_input' | 'sort_input' | 'clear'
  | 'import_yaml' | 'import_xml' | 'import_csv' | 'import_toml'
  | 'find' | 'expand_all' | 'collapse_all' | 'expand_level' | 'fold_input'
  | 'compare_swap' | 'compare_format' | 'compare_close'
  | 'wrap' | 'auto_format' | 'theme' | 'shortcuts' | 'palette' | 'load_url_dialog' | 'context_menu';

/** Event name → its properties. Optional properties may be left out. */
export interface Events {
  /** A document arrived in an editor. Sent once its first check finishes. */
  json_loaded: {
    source: InputSource;
    /** 1 = the input editor, 2 = Compare's modified document. */
    editor: 1 | 2;
    file_kind: FileKind;
    size: string;
    size_kb: number;
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
}

export type EventName = keyof Events;

/** Allowed properties per event, checked at runtime too (see `clean`). */
export const EVENT_PROPS: { [K in EventName]: readonly (keyof Events[K])[] } = {
  json_loaded: ['source', 'editor', 'file_kind', 'size', 'size_kb', 'validity', 'error_kind', 'issues', 'nodes', 'depth', 'parse_ms', 'jsonl', 'jwt'],
  view_opened: ['view', 'via', 'target'],
  convert_target_selected: ['target', 'group', 'via'],
  convert_option_changed: ['option', 'value'],
  format_option_changed: ['option', 'value'],
  feature_used: ['feature', 'via', 'view', 'level', 'on', 'value', 'jsonpath'],
  command_run: ['command'],
  agent_tool_used: ['tool', 'ok'],
};

/** A token from a fixed list: short, no spaces, nothing that could be a sentence or a path. */
const TOKEN = /^[a-z0-9][a-z0-9_.+#-]{0,39}$/i;

/**
 * Drops any property that isn't on the event's list or isn't a plain token,
 * finite number or boolean. Returns null for an unknown event.
 */
export function clean(event: string, props: Record<string, unknown>): Record<string, string | number | boolean> | null {
  const allowed = (EVENT_PROPS as Record<string, readonly string[]>)[event];
  if (!allowed) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const k of allowed) {
    const v = props[k];
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && TOKEN.test(v)) out[k] = v;
  }
  return out;
}

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
  [/^Duplicate key/, 'duplicate_key'],
  [/^Unexpected .*: expected a value$/, 'unexpected_token'],
];

export function errorKind(msg: string | undefined): string | undefined {
  if (!msg) return undefined;
  for (const [re, kind] of ERROR_KINDS) if (re.test(msg)) return kind;
  return 'other';
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
  bytes: number;
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
    size: sizeBucket(r.bytes),
    size_kb: sizeKb(r.bytes),
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
