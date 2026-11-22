/**
 * Validates a document's text against a schema's text: what the Schema view's worker runs (./schema.worker.ts),
 * and the tool page's worked example on the server. Parsing is the app's lossless, tolerant parser; positions are
 * offsets into each text, with line and column (1-based, the editor's).
 */
import { ARR, kids, parse, tooDeep, type JNode, type ParseResult } from '../json/parser';
import { type Draft } from './drafts';
import { metaUrl } from './meta';
import { pointer } from './uri';
import { Validator, type Failure, type Params, type SchemaIssue } from './validator';

export type { Draft } from './drafts';
export type { Params } from './validator';

/** Fetched schemas (see ValidateRequest.resources). */
export type Resources = Record<string, string | { text: string; url: string }>;

export interface ValidateRequest {
  doc: string;
  schema: string;
  /** The draft for a schema without `$schema` (null: 2020-12). */
  draft: Draft | null;
  /** Assert `format`. */
  formats: boolean;
  /** Instance errors kept (the rest are only counted). */
  max?: number;
  /** The document can't be read as its format (another format's syntax error): nothing to validate yet. */
  unread?: boolean;
  /**
   * Schemas fetched from the web when the visitor asked (lib/schema/remote.ts): URL (no fragment) → text, or its
   * text and the URL it came from after redirects (the base of its relative refs). A `$ref` to one resolves to it, as
   * to a resource of this schema; one to any other URL stays unresolved.
   */
  resources?: Resources;
  /** The URL the schema came from (a link's schema by URL): the base of its relative refs, unless it has an $id. */
  base?: string;
}

/** A place in a text: [p, e) to select, and where p is. */
export interface Loc {
  p: number;
  e: number;
  line: number;
  col: number;
}

export interface Problem {
  code: string;
  params: Params;
  kw: string;
  warn: boolean;
  /** In the schema text. */
  loc: Loc | null;
  /** Validating met it: that part of the schema wasn't applied to the document (the result isn't complete). */
  reached?: boolean;
  /** In a fetched schema (ValidateRequest.resources): its URL (`loc` is then null: it isn't in the schema text). */
  doc?: string;
}

export interface InstanceError {
  code: string;
  params: Params;
  kw: string;
  /** About the property name at `pointer`, not its value. */
  key: boolean;
  /** JSON Pointer of the value (within its record, for JSON Lines). */
  pointer: string;
  /** JSON Lines: the record's number (1-based). */
  record?: number;
  /** In the document text. */
  loc: Loc | null;
  /** Keyword location (through $refs). */
  path: string;
  /** The keyword in the schema text. */
  schemaLoc: Loc | null;
  sub?: InstanceError[];
}

export interface SyntaxError {
  msg: string;
  loc: Loc;
}

export interface ValidateResult {
  /**
   * `empty-schema` / `empty-doc`: nothing to validate with or yet; `*-syntax`: that text isn't JSON; `doc-unread`: the
   * document can't be read as its format yet (ValidateRequest.unread); `too-deep`: nesting past the validator's stack.
   */
  state: 'ok' | 'empty-schema' | 'empty-doc' | 'schema-syntax' | 'doc-syntax' | 'doc-unread' | 'too-deep';
  draft: Draft;
  /** Where the draft came from. */
  draftFrom: 'schema' | 'picked' | 'default';
  schemaError?: SyntaxError;
  docError?: SyntaxError;
  /** The document isn't strict JSON (comments, trailing commas…): how many such issues; validated as repaired. */
  loose?: number;
  /** JSON Lines: records validated one by one. */
  records?: number;
  /** No errors, and every part of the schema that applies was applied. */
  valid: boolean;
  /**
   * Every part of the schema that applies to the document was applied. False: some couldn't be (an unresolved $ref,
   * a keyword with a broken value: the problems marked `reached`), so a document without errors isn't `valid`, only
   * not fully checked.
   */
  complete: boolean;
  errors: InstanceError[];
  /** All instance errors, including those past `max`. */
  total: number;
  problems: Problem[];
  /**
   * The http(s) URLs (no fragment) of remote `$ref`s that didn't resolve: what fetching could bring in (none: absent).
   * Never an official meta-schema's (./meta.ts): those come with the app.
   */
  remote?: string[];
  ms: { parse: number; compile: number; validate: number };
}

/** Line starts of a text, made on first use. */
class Lines {
  private starts: number[] | null = null;
  constructor(private text: string) {}
  loc(p: number, e = p): Loc {
    const s = (this.starts ??= starts(this.text));
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= p) lo = mid;
      else hi = mid - 1;
    }
    return { p, e, line: lo + 1, col: p - s[lo] + 1 };
  }
}

function starts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/**
 * The property name before a member's value at `p` (its quotes included): back over whitespace, ':' and whitespace
 * to a closing quote, then to the opening quote that isn't escaped. Null when the text there isn't `"key": value`
 * (a repaired, unquoted key, say).
 */
export function keyBefore(text: string, p: number): [number, number] | null {
  let i = p - 1;
  const ws = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
  while (i >= 0 && ws(text.charCodeAt(i))) i--;
  if (text.charCodeAt(i) !== 58) return null;
  i--;
  while (i >= 0 && ws(text.charCodeAt(i))) i--;
  const q = text.charCodeAt(i);
  if (q !== 34 && q !== 39) return null;
  const end = i + 1;
  for (let j = i - 1; j >= 0; j--) {
    if (text.charCodeAt(j) !== q) continue;
    let k = j - 1;
    while (k >= 0 && text.charCodeAt(k) === 92) k--;
    if ((j - k - 1) % 2 === 0) return [j, end];
  }
  return null;
}

/** Where to select for a value: a primitive whole, a container's opening bracket, a property name with its quotes. */
function valueLoc(text: string, lines: Lines, n: JNode, key: boolean): Loc {
  if (key && typeof n.key === 'string') {
    const k = keyBefore(text, n.s);
    if (k) return lines.loc(k[0], k[1]);
  }
  return lines.loc(n.s, n.t >= ARR ? n.s + 1 : Math.max(n.e, n.s + 1));
}

function pathTokens(n: JNode, stop: JNode | null): (string | number)[] {
  const out: (string | number)[] = [];
  for (let x: JNode | null = n; x && x !== stop && x.u; x = x.u) out.push(x.key as string | number);
  return out.reverse();
}

const syntax = (r: ParseResult, lines: Lines): SyntaxError | undefined => {
  const e = r.error ?? null;
  if (!e) return undefined;
  return { msg: e.m, loc: lines.loc(e.p, e.p + 1) };
};

/**
 * Validates texts, keeping the last schema's compiled validator and the last document's parse: typing in one pane
 * doesn't parse or compile the other again (the worker keeps one session).
 */
export class SchemaSession {
  private schemaKey = '';
  private compiled: { sr: ParseResult; v: Validator | null; docs: Map<JNode, string> } | null = null;
  private docText: string | null = null;
  private docParse: ParseResult | null = null;
  /** The official meta-schemas (./meta.ts) once given (setMeta), parsed: URL → root. */
  private meta: Map<string, JNode> | null = null;

  run(req: ValidateRequest): ValidateResult {
    return run(req, this);
  }

  /** Gives the session the official meta-schemas: URL (META_URLS) → text. */
  setMeta(texts: Record<string, string>) {
    this.meta = new Map();
    for (const url in texts) {
      const root = parse(texts[url]).root;
      if (root) this.meta.set(url, root);
    }
  }

  /** The request's schemas name an official meta-schema the session hasn't been given (compiles the schema). */
  wantsMeta(req: ValidateRequest): boolean {
    if (this.meta || !req.schema.trim()) return false;
    const { v } = this.schema(req);
    return !!v?.issues.some((i) => (i.code === 'unknownSchema' || (i.code === 'unresolved' && i.params.why === 'remote')) && metaUrl(String(i.params.uri)));
  }

  /**
   * The schema's parse and validator, compiled again only when its text, options or fetched schemas changed (a URL's
   * text never changes: the URLs say which). `docs`: each fetched schema's root, by its URL.
   */
  schema(req: ValidateRequest): { sr: ParseResult; v: Validator | null; docs: Map<JNode, string>; ms: number } {
    const urls = Object.keys(req.resources ?? {});
    const from = (u: string) => (typeof req.resources![u] === 'string' ? '' : `>${(req.resources![u] as { url: string }).url}`);
    const key = `${req.draft ?? ''}|${req.formats ? 1 : 0}|${this.meta ? 'meta' : ''}|${req.base ?? ''}|${urls.sort().map((u) => u + from(u)).join(' ')}|${req.schema}`;
    if (this.compiled && key === this.schemaKey) return { ...this.compiled, ms: 0 };
    const t = performance.now();
    const sr = parse(req.schema);
    let v: Validator | null = null;
    const resources = new Map<string, JNode>();
    const docs = new Map<JNode, string>();
    for (const url of urls) {
      const got = req.resources![url];
      const root = parse(typeof got === 'string' ? got : got.text).root;
      if (!root) continue;
      // (Where it came from first: its base. Where it was asked for names it too.)
      if (typeof got !== 'string') resources.set(got.url, root);
      resources.set(url, root);
      docs.set(root, url);
    }
    // (For what nothing else names, by their https URLs and the http ones the older drafts' ids use.)
    const fallback = new Map<string, JNode>();
    for (const [url, root] of this.meta ?? []) {
      fallback.set(url, root).set(url.replace(/^https:/, 'http:'), root);
      docs.set(root, url);
    }
    if (sr.root && !sr.error) {
      try {
        v = new Validator(sr.root, { draft: req.draft ?? 2020, formats: req.formats, resources, fallback, ...(req.base && { base: req.base }) });
      } catch {
        v = null;
      }
    }
    this.schemaKey = key;
    this.compiled = { sr, v, docs };
    return { sr, v, docs, ms: performance.now() - t };
  }

  doc(text: string): { dr: ParseResult; ms: number } {
    if (this.docParse && text === this.docText) return { dr: this.docParse, ms: 0 };
    const t = performance.now();
    this.docParse = parse(text);
    this.docText = text;
    return { dr: this.docParse, ms: performance.now() - t };
  }
}

export function validateTexts(req: ValidateRequest): ValidateResult {
  return new SchemaSession().run(req);
}

function run(req: ValidateRequest, session: SchemaSession): ValidateResult {
  const out: ValidateResult = { state: 'ok', draft: req.draft ?? 2020, draftFrom: req.draft ? 'picked' : 'default', valid: false, complete: false, errors: [], total: 0, problems: [], ms: { parse: 0, compile: 0, validate: 0 } };
  const schemaLines = new Lines(req.schema);
  const docLines = new Lines(req.doc);
  if (!req.schema.trim()) {
    out.state = 'empty-schema';
    return out;
  }
  const { sr, v, docs, ms } = session.schema(req);
  /** The fetched schema a schema node is in (null: the schema text's). */
  const docOf = (n: JNode): string | null => {
    let r = n;
    while (r.u) r = r.u;
    return r === sr.root ? null : (docs.get(r) ?? '');
  };
  /** Where a schema node is in the schema text (null: in a fetched schema, which isn't). */
  const keyLoc = (n: JNode | null) => (n && docOf(n) === null ? schemaKeyLoc(req.schema, schemaLines, n) : null);
  out.ms.compile = ms;
  if (!sr.root || sr.error) {
    out.state = 'schema-syntax';
    out.schemaError = syntax(sr, schemaLines) ?? { msg: 'No JSON value', loc: schemaLines.loc(0, 1) };
    return out;
  }
  // (A schema nested past the stack: the compiler recurses into subschemas.)
  if (!v) {
    out.state = 'too-deep';
    return out;
  }
  out.draft = v.draft;
  if (v.fromSchema) out.draftFrom = 'schema';
  // (In the order they are in the schema's text.)
  const reached = new Set<SchemaIssue>();
  const problems = () => {
    if (sr.issues.length) out.problems.push({ code: 'schemaLoose', params: {}, kw: '', warn: true, loc: schemaLines.loc(sr.issues[0].p, sr.issues[0].p + 1) });
    // (The schema's own problems, then this check's: a $ref loop depends on the document, so it is never kept for the next one.)
    const own = new Set(v.issues);
    const list = [...v.issues, ...[...reached].filter((i) => !own.has(i))].map((i: SchemaIssue): Problem => {
      const doc = i.at ? docOf(i.at) : null;
      // (An official meta-schema unresolved: its copy didn't load, see ./schema.worker.ts. It isn't offered for fetching.)
      const params = i.code === 'unresolved' && i.params.why === 'remote' && metaUrl(String(i.params.uri)) ? { ...i.params, why: 'meta' } : i.params;
      return { code: i.code, params, kw: i.kw, warn: i.warn, loc: keyLoc(i.at), ...(reached.has(i) && { reached: true }), ...(doc && { doc }) };
    });
    // (The schema text's in its order, then the fetched schemas'.)
    const at = (x: Problem) => (x.doc ? Infinity : (x.loc?.p ?? -1));
    out.problems.push(...list.sort((a, b) => at(a) - at(b)));
    // What fetching could bring in: the http(s) URLs of remote refs that didn't resolve.
    const remote = new Set<string>();
    for (const i of v.issues) if (i.code === 'unresolved' && i.params.why === 'remote' && /^https?:\/\//i.test(String(i.params.uri)) && !metaUrl(String(i.params.uri))) remote.add(String(i.params.uri));
    if (remote.size) out.remote = [...remote];
  };

  if (req.unread) {
    out.state = 'doc-unread';
    problems();
    return out;
  }
  if (!req.doc.trim()) {
    out.state = 'empty-doc';
    problems();
    return out;
  }
  const { dr, ms: parseMs } = session.doc(req.doc);
  out.ms.parse = parseMs;
  if (!dr.root || dr.error) {
    out.state = 'doc-syntax';
    out.docError = syntax(dr, docLines) ?? { msg: 'No JSON value', loc: docLines.loc(0, 1) };
    problems();
    return out;
  }
  if (dr.issues.length) out.loose = dr.issues.length;
  const t3 = performance.now();
  const max = req.max ?? 1000;
  const roots = dr.multi ? kids(dr.root) : [dr.root];
  if (dr.multi) out.records = roots.length;
  let valid = true;
  let complete = true;
  try {
    for (let i = 0; i < roots.length; i++) {
      // (The records are one check: a problem met in several of them is listed once.)
      const res = v.validate(roots[i], Math.max(0, max - out.errors.length), i > 0);
      if (!res.valid) valid = false;
      if (!res.complete) complete = false;
      for (const r of res.reached) reached.add(r);
      const conv = (f: Failure): InstanceError => ({
        code: f.code,
        params: f.params,
        kw: f.kw,
        key: f.key,
        pointer: pointer(pathTokens(f.inst, dr.multi ? roots[i] : null)),
        ...(dr.multi && { record: i + 1 }),
        loc: valueLoc(req.doc, docLines, f.inst, f.key),
        path: f.path,
        schemaLoc: keyLoc(f.at),
        ...(f.sub && { sub: f.sub.map(conv) }),
      });
      for (const f of res.errors) out.errors.push(conv(f));
      out.total += res.total;
    }
  } catch (e) {
    if (!(e instanceof RangeError || tooDeep(e))) throw e;
    out.state = 'too-deep';
    out.errors = [];
    out.total = 0;
    out.ms.validate = performance.now() - t3;
    problems();
    return out;
  }
  // (Valid only when nothing was skipped: an unresolved $ref passes nothing.)
  out.complete = complete;
  out.valid = valid && complete;
  out.ms.validate = performance.now() - t3;
  // (After validating: a $ref loop is found while applying the schema.)
  problems();
  return out;
}

/** Where a schema keyword is: its name in quotes when the value is a member, else the value. */
function schemaKeyLoc(text: string, lines: Lines, at: JNode): Loc {
  if (typeof at.key === 'string') {
    const k = keyBefore(text, at.s);
    if (k) return lines.loc(k[0], k[1]);
  }
  return lines.loc(at.s, at.t >= ARR ? at.s + 1 : Math.max(at.e, at.s + 1));
}
