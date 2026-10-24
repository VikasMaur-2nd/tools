/**
 * WebMCP tools (https://webmachinelearning.github.io/webmcp/): the JSON tool's functions,
 * described so that an AI agent in the browser (ChatGPT's, Gemini in Chrome…) can call
 * them by name instead of clicking through the page. Each works on the document open in
 * the editor and shows its result in the page, as the same command would (edits are
 * undoable); the answer is text for the agent. Nothing here touches the DOM: ./register.ts
 * connects the tools to the live engine, and tests run them against a fake page.
 */
import type { AgentToolName } from '../analytics/events';
import type { Change } from '../diff/diff';
import { jsonLines } from '../engine/rules';
import type { IndentId } from '../engine/store';
import { TARGETS } from '../engine/targets';
import { byteLength, copyText, formatBytes, formatDoc, preview, primText, tooLarge } from '../json/format';
import type { JwtInput } from '../json/jwt';
import { ARR, BOOL, kids, MAX_WALK_DEPTH, NUL, NUM, OBJ, STR, parse, tooDeep, type Issue, type JNode, type ParseResult } from '../json/parser';
import { formatPath, parsePath, type Seg } from '../json/path';

/** The open document as a command sees it. */
export interface Doc {
  /** The editor's text. */
  text: string;
  /** Its parse (of the decoded document, for a JWT); null while nothing has been parsed. */
  res: ParseResult | null;
  /** The text `res` was parsed from: the editor's, or a JWT's decoded document. */
  src: string;
  jwt: JwtInput | null;
}

export type AgentView = 'format' | 'tree' | 'table' | 'graph';
export type FormatStyle = 'pretty' | 'minified' | 'escaped';
export type ImportFrom = 'yaml' | 'xml' | 'csv' | 'tsv' | 'toml';

/** The page the tools act on (./register.ts: the live engine). */
export interface Page {
  /** The open document, its parse finished now if it was still on its way. */
  doc(): Doc;
  /** The indentation the page formats with. */
  indent(): string;
  /** Opens `text` in the editor in place of the current document (undoable). */
  open(text: string, name: string | null): void;
  show(view: AgentView): void;
  /** Shows the Format view with these options. */
  format(o: { style: FormatStyle; sortKeys: boolean; indent?: IndentId }): void;
  /** Shows the Convert view with these options. */
  convert(o: { target: string; rootName?: string; tsStyle?: 'interface' | 'type'; csharpLib?: 'stj' | 'newtonsoft' }): void;
  /** Repairs the document in place (undoable). */
  repair(): void;
  /** Replaces the document with JSON made from it (undoable); `from` names what it was. */
  imported(json: string, from: ImportFrom): void;
  /** Opens Compare with `modified` beside the document. */
  compare(modified: string): void;
}

export interface Result {
  text: string;
  /** The tool did what it was asked (false: bad input, nothing open, or a document it can't work on). */
  ok: boolean;
}

export interface AgentTool {
  name: AgentToolName;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  run(input: Record<string, unknown>, page: Page): Result | Promise<Result>;
}

/** The most text a tool returns: about 12,000 tokens. The page has the rest. */
export const MAX_RESULT = 50_000;
/** Issues, keys and differences listed at most. */
const MAX_LIST = 20;
const MAX_KEYS = 100;
const MAX_CHANGES = 200;

const VIEWS: AgentView[] = ['format', 'tree', 'table', 'graph'];
const STYLES: FormatStyle[] = ['pretty', 'minified', 'escaped'];
const INDENT_IDS: IndentId[] = ['2', '4', 'tab'];
const INDENT_TEXT: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };
const FROM: ImportFrom[] = ['yaml', 'xml', 'csv', 'tsv', 'toml'];
/** Convert targets an agent can ask for (Excel is a binary download; CSV has the same table). */
const TARGET_IDS = TARGETS.map((t) => t.id).filter((id) => id !== 'xlsx');
const CSHARP: Record<string, 'stj' | 'newtonsoft'> = { 'System.Text.Json': 'stj', 'Newtonsoft.Json': 'newtonsoft' };

const done = (text: string): Result => ({ text, ok: true });
const fail = (text: string): Result => ({ text, ok: false });
const EMPTY = fail('The editor is empty. Open a document with open_json first.');

const num = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
const list = (items: readonly string[]) => items.map((s) => `"${s}"`).join(', ');

/** `text`, cut to MAX_RESULT characters with a note saying where the rest is. */
export function cap(text: string): string {
  if (text.length <= MAX_RESULT) return text;
  let end = MAX_RESULT;
  const c = text.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--; // (not between the halves of a surrogate pair)
  return `${text.slice(0, end)}\n…\n[Cut at ${num(end)} of ${num(text.length)} characters. The whole output is in the page, where the user can copy or download it.]`;
}

/**
 * `line 3, column 5` for offsets of `text`. Offsets in source order (as the parser lists issues) carry on
 * from the last one, so listing many in a big document reads it once.
 */
export function locator(text: string) {
  let p0 = 0;
  let line = 1;
  let start = 0;
  return (p: number) => {
    if (p < p0) [line, start] = [1, 0];
    for (let i = text.indexOf('\n', start); i !== -1 && i < p; i = text.indexOf('\n', i + 1)) {
      line++;
      start = i + 1;
    }
    p0 = p;
    return `line ${line}, column ${p - start + 1}`;
  };
}

const at = (text: string, p: number) => locator(text)(p);

/** `an object with 3 keys`, `an array of 2 items`, `a string`… */
function shape(n: JNode): string {
  switch (n.t) {
    case OBJ: return `an object with ${plural(kids(n).length, 'key')}`;
    case ARR: return `an array of ${plural(kids(n).length, 'item')}`;
    case STR: return 'a string';
    case NUM: return 'a number';
    case BOOL: return 'a boolean';
    default: return 'null';
  }
}

const TYPE: Record<number, string> = { [NUL]: 'null', [BOOL]: 'boolean', [NUM]: 'number', [STR]: 'string', [ARR]: 'array', [OBJ]: 'object' };

/** A value in one short line: `"Ada"`, `42`, `{id: 1, …}`. */
const short = (n: JNode) => (n.t >= ARR ? preview(n, 60) : primText(n, 60));

/** The document, or why a tool can't work on it (empty, or an error that has to be fixed by hand). */
function parsed(d: Doc): { res: ParseResult & { root: JNode } } | { result: Result } {
  if (!d.text.trim() || !d.res) return { result: EMPTY };
  const r = d.res;
  if (r.error || !r.root) {
    const e = r.error && !(r.issues[0] && r.issues[0].p < r.error.p) ? r.error : r.issues[0] ?? r.error!;
    return { result: fail(`The document isn't valid JSON: ${e.m} (${at(d.src, e.p)}). This has to be fixed by hand; repair_json can't fix it.`) };
  }
  return { res: r as ParseResult & { root: JNode } };
}

/** `- line 3, column 5: message` for each of the first issues. */
function issueList(src: string, issues: readonly Issue[]): string {
  const where = locator(src);
  const items = issues.slice(0, MAX_LIST).map((i) => `- ${where(i.p)}: ${i.m}`);
  if (issues.length > MAX_LIST) items.push(`- and ${plural(issues.length - MAX_LIST, 'more')}`);
  return items.join('\n');
}

/** Valid JSON Lines, shown as an array of its records: the wrapping isn't an issue (as in the page). */
const isLines = (d: Doc) => !d.jwt && !!d.res && jsonLines(d.src, d.res);

/** What check_json and open_json say about the document. */
export function describe(d: Doc): Result {
  if (!d.text.trim() || !d.res) return EMPTY;
  const r = d.res;
  if (d.jwt) {
    const alg = d.jwt.alg ? ` signed with ${d.jwt.alg}` : '';
    return done(`The document is a JWT${alg}. decode_jwt reads its header, payload and times.`);
  }
  const p = parsed(d);
  if ('result' in p) return { ...p.result, ok: true };
  const size = `${formatBytes(byteLength(d.text))}, ${plural(r.nodes, 'value')}, nesting depth ${r.depth}`;
  const lines = isLines(d);
  const what = lines ? `JSON Lines with ${plural(kids(p.res.root).length, 'record')}` : shape(p.res.root);
  if (r.issues.length && !lines) return done(`Not valid JSON yet: ${plural(r.issues.length, 'issue')}, all of which repair_json fixes. Repaired, it is ${what} (${size}).\n${issueList(d.src, r.issues)}`);
  let text = `Valid ${lines ? what : `JSON: ${what}`} (${size}).`;
  if (r.warnings.length) text += `\nWarnings:\n${issueList(d.src, r.warnings)}`;
  return done(text);
}

/** `make()`, or the reason it can't be made (nesting too deep, or a result too large for the browser). */
function attempt(make: () => string): string | Result {
  try {
    return make();
  } catch (e) {
    if (tooDeep(e)) return fail('The document is nested too deeply for this.');
    if (tooLarge(e)) return fail('The result would be too large to make in the browser.');
    throw e;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
/** A value from `allowed`, undefined when left out, or null when it isn't one of them. */
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined | null =>
  v === undefined || v === null ? undefined : allowed.includes(v as T) ? (v as T) : null;

const NO_INPUT = { type: 'object', properties: {} };

export const TOOLS: AgentTool[] = [
  {
    name: 'open_json',
    title: 'Open a document',
    description:
      "Open a document in the page's editor, in place of the one there (the user can undo this). Takes JSON, JSON Lines (NDJSON) or a JWT, " +
      'or YAML, XML, CSV or TOML text to turn into JSON with import_to_json. The other tools work on the open document. ' +
      'Returns whether it is valid JSON, with its size and shape.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The document' },
        name: { type: 'string', description: 'A file name to show for it, such as orders.json. A name ending in .jsonl or .ndjson reads it as JSON Lines.' },
        view: { type: 'string', enum: VIEWS, description: 'The view to show it in (default: the one open now)' },
      },
      required: ['text'],
    },
    annotations: { untrustedContentHint: true },
    run(input, page) {
      const text = str(input.text);
      const view = oneOf(input.view, VIEWS);
      if (text === undefined) return fail('Error: give the document as text.');
      if (view === null) return fail(`Error: view must be one of ${list(VIEWS)}.`);
      const name = str(input.name)?.trim().slice(0, 200) || null;
      page.open(text, name);
      if (view) page.show(view);
      return describe(page.doc());
    },
  },
  {
    name: 'check_json',
    title: 'Check the document',
    description:
      'Check the document open in the page: whether it is valid JSON, where each error is (line and column) and whether repair_json can fix it, ' +
      'and its size, number of values and nesting depth. Also recognizes JSON Lines and JWTs.',
    inputSchema: NO_INPUT,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    run: (_, page) => describe(page.doc()),
  },
  {
    name: 'get_json_value',
    title: 'Read a value',
    description:
      'Read one value of the open document by its path, to explore a large document without reading all of it. ' +
      'For an object it also lists its keys and their types. Paths look like $.users[0].name, or the JSON Pointer /users/0/name; ' +
      'leave the path out for the whole document.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Where the value is, such as $.users[0] (default: $, the whole document)' } },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    run(input, page) {
      const d = page.doc();
      const p = parsed(d);
      if ('result' in p) return p.result;
      const q = str(input.path) ?? '$';
      const segs = parsePath(q);
      if (!segs) return fail(`Error: can't read the path ${JSON.stringify(q)}. Write it as $.users[0].name or /users/0/name.`);
      // Walks down as far as the path goes, to say where it stops.
      let n: JNode = p.res.root;
      for (let i = 0; i < segs.length; i++) {
        const next = child(n, segs[i]);
        if (!next) {
          const where = formatPath(segs.slice(0, i));
          const has = n.t === OBJ ? `It has the keys ${keyList(n)}.` : n.t === ARR ? `It has ${plural(kids(n).length, 'item')}.` : `It is ${shape(n)}.`;
          return fail(`Nothing at ${formatPath(segs)}: ${where} has no ${typeof segs[i] === 'number' ? `item ${segs[i]}` : `key ${JSON.stringify(segs[i])}`}. ${has}`);
        }
        n = next;
      }
      const value = attempt(() => copyText(n, page.indent()));
      if (typeof value !== 'string') return value;
      let text = `${formatPath(segs)} is ${shape(n)}`;
      if (n.t === OBJ && kids(n).length) {
        const ks = kids(n);
        const lines = ks.slice(0, MAX_KEYS).map((k) => `- ${JSON.stringify(k.key)}: ${TYPE[k.t]}`);
        if (ks.length > MAX_KEYS) lines.push(`- and ${plural(ks.length - MAX_KEYS, 'more key')}`);
        text += `:\n${lines.join('\n')}`;
      } else text += '.';
      return done(`${text}\n\nValue${n.t === STR ? ' (the string itself)' : ''}:\n${cap(value)}`);
    },
  },
  {
    name: 'repair_json',
    title: 'Repair JSON',
    description:
      'Fix the mistakes that keep the open document from being valid JSON: trailing commas, comments, single quotes, unquoted keys, ' +
      'Python and JavaScript values (True, None, NaN, undefined), missing commas and similar. Fixes the document in place (the user can undo this) ' +
      'and returns the repaired JSON with a list of what was fixed.',
    inputSchema: NO_INPUT,
    annotations: { untrustedContentHint: true },
    run(_, page) {
      const d = page.doc();
      const p = parsed(d);
      if ('result' in p) return p.result;
      if (d.jwt || !p.res.issues.length || isLines(d)) return done(`The document is already valid ${isLines(d) ? 'JSON Lines' : 'JSON'}; there is nothing to repair.`);
      const fixed = issueList(d.src, p.res.issues);
      page.repair();
      const after = page.doc().text;
      if (after === d.text) return fail('The document could not be repaired: the result would be too large to make in the browser.');
      return done(`Repaired ${plural(p.res.issues.length, 'issue')}:\n${fixed}\n\nThe document now reads:\n${cap(after)}`);
    },
  },
  {
    name: 'format_json',
    title: 'Format JSON',
    description:
      'Format the open document: pretty-printed, minified to one line, or escaped as one JSON string literal, with keys sorted A to Z if asked. ' +
      "Shows the result in the page's Format view and returns it. The open document itself stays as it is.",
    inputSchema: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: STYLES, description: 'pretty (default), minified, or escaped: minified JSON written as a string literal' },
        indent: { type: 'string', enum: INDENT_IDS, description: 'Pretty indentation: 2 spaces, 4 spaces or a tab (default: the page setting)' },
        sort_keys: { type: 'boolean', description: 'Sort the keys of every object A to Z (default false)' },
      },
    },
    annotations: { untrustedContentHint: true },
    run(input, page) {
      const style = oneOf(input.style, STYLES);
      const indent = oneOf(input.indent, INDENT_IDS);
      const sortKeys = bool(input.sort_keys) ?? false;
      if (style === null) return fail(`Error: style must be one of ${list(STYLES)}.`);
      if (indent === null) return fail(`Error: indent must be one of ${list(INDENT_IDS)}.`);
      const d = page.doc();
      const p = parsed(d);
      if ('result' in p) return p.result;
      const s = style ?? 'pretty';
      page.format({ style: s, sortKeys, indent: indent ?? undefined });
      const ind = s === 'pretty' ? (indent ? INDENT_TEXT[indent] : page.indent()) : '';
      const out = attempt(() => {
        const t = formatDoc(d.src, p.res, ind, sortKeys);
        return s === 'escaped' ? JSON.stringify(t) : t;
      });
      if (typeof out !== 'string') return out;
      const note = p.res.issues.length && !isLines(d) ? `The document has ${plural(p.res.issues.length, 'issue')}; this output fixes them (repair_json fixes the document itself).\n\n` : '';
      return done(note + cap(out));
    },
  },
  {
    name: 'convert_json',
    title: 'Convert JSON',
    description:
      'Generate code or data from the open document: types for a programming language (TypeScript, Zod, JSON Schema, C#, Dart, Java, ' +
      'Python Pydantic models, Go, Kotlin, Swift, PHP, Rust serde) inferred from its values, or the same data as CSV, YAML, XML, TOML or JSON Lines. ' +
      "Shows the result in the page's Convert view and returns it.",
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', enum: TARGET_IDS, description: 'What to make' },
        root_name: { type: 'string', description: 'Name of the top-level type, or the XML root element (default Root)' },
        typescript_style: { type: 'string', enum: ['interface', 'type'], description: 'TypeScript only: interface declarations or type aliases (default interface)' },
        csharp_library: { type: 'string', enum: Object.keys(CSHARP), description: 'C# only: the JSON library the attributes are for (default System.Text.Json)' },
      },
      required: ['to'],
    },
    annotations: { untrustedContentHint: true },
    async run(input, page) {
      const to = oneOf(input.to, TARGET_IDS);
      const ts = oneOf(input.typescript_style, ['interface', 'type'] as const);
      const cs = oneOf(input.csharp_library, Object.keys(CSHARP));
      if (!to) return fail(`Error: to must be one of ${list(TARGET_IDS)}.`);
      if (ts === null) return fail('Error: typescript_style must be "interface" or "type".');
      if (cs === null) return fail(`Error: csharp_library must be one of ${list(Object.keys(CSHARP))}.`);
      const rootName = str(input.root_name)?.trim().slice(0, 100) || undefined;
      const d = page.doc();
      const p = parsed(d);
      if ('result' in p) return p.result;
      if (p.res.depth > MAX_WALK_DEPTH) return fail('The document is nested too deeply to convert.');
      page.convert({ target: to, rootName, tsStyle: ts, csharpLib: cs ? CSHARP[cs] : undefined });
      const [mod, xlsx] = await Promise.all([import('../convert'), to === 'csv' ? import('../convert/xlsx') : null]);
      const out = attempt(() =>
        xlsx ? xlsx.toCsv(xlsx.records(p.res.root)) : mod.convert(p.res.root, to, { rootName: rootName ?? 'Root', tsStyle: ts ?? 'interface', csharpLib: cs ? CSHARP[cs] : 'stj' }),
      );
      if (typeof out !== 'string') return out;
      return done(cap(out));
    },
  },
  {
    name: 'import_to_json',
    title: 'Turn YAML, XML, CSV or TOML into JSON',
    description:
      'Turn the YAML, XML, CSV, TSV or TOML text open in the page into JSON, in place (the user can undo this), and return the JSON. ' +
      'Numbers keep all their digits.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', enum: FROM, description: 'The format the open text is in' } },
      required: ['from'],
    },
    annotations: { untrustedContentHint: true },
    async run(input, page) {
      const from = oneOf(input.from, FROM);
      if (!from) return fail(`Error: from must be one of ${list(FROM)}.`);
      const d = page.doc();
      if (!d.text.trim()) return EMPTY;
      if (d.res?.root && !d.res.error && !d.res.issues.length && !d.jwt) return fail('The open document is already valid JSON; there is nothing to turn into JSON.');
      const { importToJson } = await import('../convert/import');
      const r = importToJson(d.text, from, page.indent());
      const name = from.toUpperCase();
      if ('error' in r) return fail(`Couldn't read the document as ${name}: ${r.error}${r.line ? ` (line ${r.line}${r.col ? `, column ${r.col}` : ''})` : ''}.`);
      page.imported(r.json, from);
      return done(`Turned the ${name} into JSON:\n\n${cap(r.json)}`);
    },
  },
  {
    name: 'compare_json',
    title: 'Compare with another document',
    description:
      'Compare the open document with another JSON document: lists each value added, removed or changed, with its path, ' +
      'and a JSON Patch (RFC 6902) that turns the open document into the other one. Key order is ignored; array order counts. ' +
      "Shows both side by side in the page's Compare view.",
    inputSchema: {
      type: 'object',
      properties: { modified: { type: 'string', description: 'The JSON to compare the open document with (the newer version)' } },
      required: ['modified'],
    },
    annotations: { untrustedContentHint: true },
    async run(input, page) {
      const modified = str(input.modified);
      if (modified === undefined) return fail('Error: give the other document as text in modified.');
      const d = page.doc();
      const p = parsed(d);
      if ('result' in p) return p.result;
      const other = parse(modified);
      if (other.error || !other.root) {
        const e = other.error ?? other.issues[0];
        return fail(`The other document isn't valid JSON: ${e.m} (${at(modified, e.p)}).`);
      }
      page.compare(modified);
      const [{ diff }, { patchText, toPatch }] = await Promise.all([import('../diff/diff'), import('../diff/patch')]);
      const r = diff(p.res.root, other.root);
      if (r.error) return fail(`The documents couldn't be compared: ${r.error}.`);
      const { added, removed, changed, type } = r.summary;
      const total = added + removed + changed + type;
      if (!total) return done('The documents are the same (ignoring key order).');
      const lines = r.changes.slice(0, MAX_CHANGES).map(describeChange);
      if (r.changes.length > MAX_CHANGES) lines.push(`- and ${plural(r.changes.length - MAX_CHANGES, 'more difference')}`);
      const counts = [added && `${num(added)} added`, removed && `${num(removed)} removed`, changed + type && `${num(changed + type)} changed`].filter(Boolean).join(', ');
      const patch = attempt(() => patchText(toPatch(r.changes), '  '));
      return done(
        `${plural(total, 'difference')}${r.truncated ? ' at least' : ''}: ${counts}.\n${lines.join('\n')}` +
          (typeof patch === 'string' ? `\n\nJSON Patch:\n${cap(patch)}` : ''),
      );
    },
  },
  {
    name: 'decode_jwt',
    title: 'Decode the JWT',
    description:
      'Decode the JWT open in the page: its header, its payload, the times in it (issued, not before, expires) and whether it has expired. ' +
      'The signature is not verified.',
    inputSchema: NO_INPUT,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    run(_, page) {
      const d = page.doc();
      if (!d.text.trim()) return EMPTY;
      if (!d.jwt) return fail('The open document is not a JWT. Open one with open_json first.');
      return done(`The decoded JWT (its signature was not verified):\n${cap(d.jwt.json)}`);
    },
  },
  {
    name: 'show_view',
    title: 'Show a view',
    description:
      'Show the open document in one of the page\'s views, for the user to look at: format (the formatted text), tree (an expandable outline), ' +
      'table (rows and columns, for arrays of records) or graph (a diagram of connected objects and arrays).',
    inputSchema: {
      type: 'object',
      properties: { view: { type: 'string', enum: VIEWS, description: 'The view to show' } },
      required: ['view'],
    },
    annotations: { readOnlyHint: true },
    run(input, page) {
      const view = oneOf(input.view, VIEWS);
      if (!view) return fail(`Error: view must be one of ${list(VIEWS)}.`);
      page.show(view);
      return done(`Showing the ${view} view${page.doc().text.trim() ? '' : ' (the editor is empty)'}.`);
    },
  },
];

/** A child by key (the last one, as JSON.parse keeps it) or index. */
function child(n: JNode, k: Seg): JNode | null {
  if (n.t === ARR) return typeof k === 'number' ? kids(n)[k] ?? null : null;
  if (n.t !== OBJ) return null;
  const ks = kids(n);
  const key = String(k);
  for (let i = ks.length - 1; i >= 0; i--) if (ks[i].key === key) return ks[i];
  return null;
}

function keyList(n: JNode): string {
  const ks = kids(n);
  const shown = ks.slice(0, MAX_KEYS).map((k) => JSON.stringify(k.key)).join(', ');
  return ks.length > MAX_KEYS ? `${shown} and ${plural(ks.length - MAX_KEYS, 'more')}` : shown || 'none (it is empty)';
}

function describeChange(c: Change): string {
  const where = formatPath(c.path);
  if (c.order) return `- key order changed at ${where}`;
  if (c.kind === 'added') return `- added ${where}: ${c.right ? short(c.right) : ''}`;
  if (c.kind === 'removed') return `- removed ${where}: ${c.left ? short(c.left) : ''}`;
  return `- changed ${where}: ${c.left ? short(c.left) : ''} → ${c.right ? short(c.right) : ''}`;
}
