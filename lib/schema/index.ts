/**
 * Validates a document's text against a schema's text: what the Schema view's worker runs (./schema.worker.ts),
 * and the tool page's worked example on the server. Parsing is the app's lossless, tolerant parser; positions are
 * offsets into each text, with line and column (1-based, the editor's).
 */
import { ARR, OBJ, kids, parse, tooDeep, type JNode, type ParseResult } from '../json/parser';
import { DRAFT_NAME, draftOf, type Draft } from './drafts';
import { pointer } from './uri';
import { Validator, type Failure, type Params, type SchemaIssue } from './validator';

export type { Draft } from './drafts';
export type { Params } from './validator';

export interface ValidateRequest {
  doc: string;
  schema: string;
  /** The draft for a schema without `$schema` (null: 2020-12). */
  draft: Draft | null;
  /** Assert `format`. */
  formats: boolean;
  /** Instance errors kept (the rest are only counted). */
  max?: number;
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
  /** `empty-schema` / `empty-doc`: nothing to validate with or yet; `*-syntax`: that text isn't JSON; `too-deep`: nesting past the validator's stack. */
  state: 'ok' | 'empty-schema' | 'empty-doc' | 'schema-syntax' | 'doc-syntax' | 'too-deep';
  draft: Draft;
  /** Where the draft came from. */
  draftFrom: 'schema' | 'picked' | 'default';
  schemaError?: SyntaxError;
  docError?: SyntaxError;
  /** The document isn't strict JSON (comments, trailing commas…): how many such issues; validated as repaired. */
  loose?: number;
  /** JSON Lines: records validated one by one. */
  records?: number;
  valid: boolean;
  errors: InstanceError[];
  /** All instance errors, including those past `max`. */
  total: number;
  problems: Problem[];
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
  private compiled: { sr: ParseResult; v: Validator | null } | null = null;
  private docText: string | null = null;
  private docParse: ParseResult | null = null;

  run(req: ValidateRequest): ValidateResult {
    return run(req, this);
  }

  /** The schema's parse and validator, compiled again only when its text or options changed. */
  schema(req: ValidateRequest): { sr: ParseResult; v: Validator | null; ms: number } {
    const key = `${req.draft ?? ''}|${req.formats ? 1 : 0}|${req.schema}`;
    if (this.compiled && key === this.schemaKey) return { ...this.compiled, ms: 0 };
    const t = performance.now();
    const sr = parse(req.schema);
    let v: Validator | null = null;
    if (sr.root && !sr.error) {
      try {
        v = new Validator(sr.root, { draft: req.draft ?? 2020, formats: req.formats });
      } catch {
        v = null;
      }
    }
    this.schemaKey = key;
    this.compiled = { sr, v };
    return { sr, v, ms: performance.now() - t };
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
  const out: ValidateResult = { state: 'ok', draft: req.draft ?? 2020, draftFrom: req.draft ? 'picked' : 'default', valid: false, errors: [], total: 0, problems: [], ms: { parse: 0, compile: 0, validate: 0 } };
  const schemaLines = new Lines(req.schema);
  const docLines = new Lines(req.doc);
  if (!req.schema.trim()) {
    out.state = 'empty-schema';
    return out;
  }
  const { sr, v, ms } = session.schema(req);
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
  const sch = sr.root.t === OBJ ? kids(sr.root).find((m) => m.key === '$schema') : undefined;
  if (sch && typeof sch.v === 'string' && draftOf(sch.v) !== null && draftOf(sch.v) !== 3) out.draftFrom = 'schema';
  // (In the order they are in the schema's text.)
  const problems = () => {
    if (sr.issues.length) out.problems.push({ code: 'schemaLoose', params: {}, kw: '', warn: true, loc: schemaLines.loc(sr.issues[0].p, sr.issues[0].p + 1) });
    const list = v.issues.map((i: SchemaIssue) => ({ code: i.code, params: i.params, kw: i.kw, warn: i.warn, loc: i.at ? schemaKeyLoc(req.schema, schemaLines, i.at) : null }));
    out.problems.push(...list.sort((a, b) => (a.loc?.p ?? -1) - (b.loc?.p ?? -1)));
  };

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
  try {
    for (let i = 0; i < roots.length; i++) {
      const res = v.validate(roots[i], Math.max(0, max - out.errors.length));
      if (!res.valid) valid = false;
      const conv = (f: Failure): InstanceError => ({
        code: f.code,
        params: f.params,
        kw: f.kw,
        key: f.key,
        pointer: pointer(pathTokens(f.inst, dr.multi ? roots[i] : null)),
        ...(dr.multi && { record: i + 1 }),
        loc: valueLoc(req.doc, docLines, f.inst, f.key),
        path: f.path,
        schemaLoc: f.at ? schemaKeyLoc(req.schema, schemaLines, f.at) : null,
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
  out.valid = valid;
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

export const draftName = (d: Draft) => DRAFT_NAME[d];
