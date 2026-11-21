/**
 * A JSON Schema validator for draft-04, draft-06, draft-07, 2019-09 and 2020-12, written for this app (no library).
 *
 * It works on the lossless parser's trees (lib/json/parser.ts) for both the schema and the instance, so numbers are
 * compared exactly (./decimal.ts) and every error and schema problem knows where it is in its text.
 *
 * - Compiling scans the schema for resources (`$id`, `id`), anchors (`$anchor`, `$dynamicAnchor`, `$recursiveAnchor`,
 *   plain-name `$id`s before 2019-09), checks the value of every keyword it knows (the schema problems), resolves
 *   every `$ref` and compiles every subschema once. Remote references are never fetched: one that isn't a resource
 *   of this schema (or of `resources`, which only tests pass) is reported as unresolved.
 * - Validating walks the instance once per applicable subschema. Annotations for `unevaluatedProperties` and
 *   `unevaluatedItems` are tracked only when the schema uses them. Inside `anyOf`, `oneOf`, `not`, `if` and
 *   `contains` a branch is evaluated quietly (stopping at its first failure) unless its errors are wanted.
 * - A `$ref` cycle that comes back to the same schema for the same value is a schema problem, not a hang.
 */
import { ARR, BOOL, JNode, NUL, NUM, OBJ, STR, kids, type Kind } from '../json/parser';
import { cmp, dec, decKey, decText, isMultiple, isWhole, isZero, type Dec } from './decimal';
import { DRAFT_NAME, arraySchemaKeywords, draftOf, knownKeywords, mapSchemaKeywords, singleSchemaKeywords, type Draft } from './drafts';
import { checkFormat, knownFormat } from './formats';
import { decodeFragment, escapeToken, isAbsolute, normalizeUri, pointer, pointerTokens, resolveUri, splitFragment } from './uri';

export type Params = Record<string, string | number>;

/** A problem with the schema itself. `warn`: it doesn't stop the keyword from working (an unknown keyword, say). */
export interface SchemaIssue {
  code: string;
  params: Params;
  /** The schema node it is about (its keyword's value), and that keyword. */
  at: JNode | null;
  kw: string;
  warn: boolean;
}

/** An instance error. */
export interface Failure {
  code: string;
  params: Params;
  /** The instance value it is about. `key`: about that value's property name (propertyNames, additionalProperties…). */
  inst: JNode;
  key: boolean;
  kw: string;
  /** Keyword location: the path through the schema, `$ref`s included, as a JSON Pointer. */
  path: string;
  /** The keyword's value in the schema text (null: in a resource that isn't the schema's text). */
  at: JNode | null;
  /** For anyOf / oneOf that matched nothing: the errors of the branch that came closest. */
  sub?: Failure[];
}

export interface CompileOptions {
  /** The draft for a schema without `$schema` (default 2020-12). */
  draft?: Draft;
  /** Check `format` (by default it is an annotation). */
  formats?: boolean;
  /** Other schemas by URI (tests: the suite's external schemas). The app passes none: remote references aren't fetched. */
  resources?: Map<string, JNode>;
}

/** The base URI of a schema that doesn't name its own (refs relative to it stay inside this schema). */
export const DEFAULT_BASE = 'urn:tool-kumar:schema';

const TYPES = ['null', 'boolean', 'object', 'array', 'number', 'string', 'integer'] as const;
type TypeName = (typeof TYPES)[number];
const KIND_NAME: Record<Kind, TypeName> = { [NUL]: 'null', [BOOL]: 'boolean', [NUM]: 'number', [STR]: 'string', [ARR]: 'array', [OBJ]: 'object' } as Record<Kind, TypeName>;
const ANCHOR = /^[A-Za-z_][A-Za-z0-9._-]*$/;
/** Other drafts' keywords not worth a notice: annotations, and `$defs` (references into it work by JSON Pointer in any draft). */
const QUIET = new Set(['definitions', 'dependencies', '$comment', 'examples', 'readOnly', 'writeOnly', 'deprecated', 'contentMediaType', 'contentEncoding', '$defs']);
const MAX_DEPTH = 6000;
/** Schema problems that leave part of a schema unapplied (the others are warnings, or are reported where they bite). */
const BLOCKING = new Set(['badValue', 'badRegex', 'unresolved', 'refNotSchema', 'itemsArray2020']);
/** Keywords that apply to one kind of value only: a broken one doesn't make other kinds' validation incomplete. */
const ONLY: Record<string, Kind> = {
  minLength: STR, maxLength: STR, pattern: STR, format: STR,
  multipleOf: NUM, maximum: NUM, minimum: NUM, exclusiveMaximum: NUM, exclusiveMinimum: NUM,
  items: ARR, prefixItems: ARR, additionalItems: ARR, contains: ARR, minItems: ARR, maxItems: ARR, uniqueItems: ARR, minContains: ARR, maxContains: ARR, unevaluatedItems: ARR,
  properties: OBJ, patternProperties: OBJ, additionalProperties: OBJ, required: OBJ, dependentRequired: OBJ, dependentSchemas: OBJ, dependencies: OBJ, minProperties: OBJ, maxProperties: OBJ, propertyNames: OBJ, unevaluatedProperties: OBJ,
} as Record<string, Kind>;
const applies = (kw: string, t: Kind) => ONLY[kw] === undefined || ONLY[kw] === t;
/** Errors kept per anyOf / oneOf branch to pick the closest one and show its errors. */
const BRANCH_ERRORS = 20;

interface Resource {
  uri: string;
  root: JNode;
  draft: Draft;
  anchors: Map<string, JNode>;
  dynamic: Map<string, JNode>;
  recursive: boolean;
  /** The vocabularies its meta-schema enables (null: all of the draft's). */
  vocab: Set<string> | null;
}

interface Place {
  res: Resource;
  ptr: string;
  draft: Draft;
}

interface Ref {
  raw: string;
  /** The schema it resolves to (null: unresolved, reported). */
  target: S | null;
  at: JNode;
}

/** A compiled schema. */
interface S {
  node: JNode;
  bool: boolean | null;
  res: Resource;
  base: string;
  draft: Draft;
  /** Before 2019-09 a `$ref` makes its siblings ignored. */
  refOnly: boolean;
  /** keyword → its value node */
  kw: Map<string, JNode>;
  ref?: Ref;
  dynRef?: Ref & { anchor: string | null };
  recRef?: Ref;
  types?: TypeName[];
  enum?: { keys: Set<string>; values: JNode[] };
  constKey?: string;
  constNode?: JNode;
  multipleOf?: Dec;
  maximum?: Dec;
  minimum?: Dec;
  exMax?: Dec;
  exMin?: Dec;
  /** draft-04's boolean exclusiveMaximum / exclusiveMinimum. */
  exMaxFlag?: boolean;
  exMinFlag?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  patternText?: string;
  format?: string;
  prefix?: S[];
  items?: S;
  additionalItems?: S;
  contains?: S;
  minContains?: number;
  maxContains?: number;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  unevaluatedItems?: S;
  properties?: Map<string, S>;
  patternProperties?: { re: RegExp; src: string; s: S }[];
  additionalProperties?: S;
  propertyNames?: S;
  required?: string[];
  dependentRequired?: { key: string; deps: string[]; kw: string }[];
  dependentSchemas?: { key: string; s: S; kw: string }[];
  maxProperties?: number;
  minProperties?: number;
  unevaluatedProperties?: S;
  allOf?: S[];
  anyOf?: S[];
  oneOf?: S[];
  not?: S;
  if?: S;
  then?: S;
  else?: S;
  /** Cycle detection: the instances this schema is being applied to through a reference right now. */
  active?: JNode[];
  /** Problems that stop one of its keywords (`kw`, '' for all of it) from being applied: validating there is incomplete. */
  blocked?: { issue: SchemaIssue; kw: string }[];
}

/** What a schema and its in-place subschemas evaluated of an instance (for the unevaluated* keywords). */
class Ann {
  props: Set<string> | null = null;
  allProps = false;
  items = 0;
  allItems = false;
  idx: Set<number> | null = null;
  prop(k: string) {
    (this.props ??= new Set()).add(k);
  }
  merge(o: Ann) {
    if (o.allProps) this.allProps = true;
    else if (o.props) for (const k of o.props) this.prop(k);
    if (o.allItems) this.allItems = true;
    if (o.items > this.items) this.items = o.items;
    if (o.idx) for (const i of o.idx) (this.idx ??= new Set()).add(i);
  }
}

// ── values ────────────────────────────────────────────────────────────────

/** An object's members, the last of duplicate keys winning (as JSON.parse does). */
function members(obj: JNode): JNode[] {
  const all = kids(obj);
  if (all.length < 2) return all;
  if (all.length <= 16) {
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].key === all[j].key) return dedupe(all);
    return all;
  }
  const seen = new Set<string>();
  for (const m of all) {
    if (seen.has(m.key as string)) return dedupe(all);
    seen.add(m.key as string);
  }
  return all;
}

function dedupe(all: JNode[]): JNode[] {
  const last = new Map<string, JNode>();
  for (const m of all) last.set(m.key as string, m);
  return all.filter((m) => last.get(m.key as string) === m);
}

/** Member `key` of an object (last wins), or undefined. */
function member(obj: JNode, key: string): JNode | undefined {
  const all = kids(obj);
  for (let i = all.length - 1; i >= 0; i--) if (all[i].key === key) return all[i];
  return undefined;
}

/** Length in code points (a surrogate pair is one character). */
function cpLength(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}

/** A canonical text for JSON equality: object member order doesn't matter, and equal numbers (1, 1.0) are equal. */
export function canon(n: JNode): string {
  switch (n.t) {
    case NUL:
      return 'n';
    case BOOL:
      return n.v ? 't' : 'f';
    case NUM: {
      const d = dec(n.v as string);
      return '#' + (d ? decKey(d) : (n.v as string));
    }
    case STR:
      return JSON.stringify(n.v);
    case ARR: {
      let s = '[';
      for (const c of kids(n)) s += canon(c) + ',';
      return s + ']';
    }
    default: {
      const m = members(n).map((c) => JSON.stringify(c.key) + ':' + canon(c));
      return '{' + m.sort().join(',') + '}';
    }
  }
}

/** A short preview of a value for messages (strings quoted, long values cut). */
export function preview(n: JNode, max = 60): string {
  let s: string;
  if (n.t === STR) s = JSON.stringify(n.v);
  else if (n.t === NUM) s = n.v as string;
  else if (n.t === NUL) s = 'null';
  else if (n.t === BOOL) s = String(n.v);
  else s = n.t === ARR ? `[…${kids(n).length}]` : `{…${kids(n).length}}`;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function isInteger(text: string, draft: Draft): boolean {
  // draft-04: "A JSON number without a fraction or exponent part"; later drafts: any whole number (1.0 too).
  if (draft === 4) return !/[.eE]/.test(text);
  const d = dec(text);
  return !!d && isWhole(d);
}

function typeOf(n: JNode, draft: Draft): TypeName {
  return n.t === NUM && isInteger(n.v as string, draft) ? 'integer' : KIND_NAME[n.t];
}

const hasType = (n: JNode, t: TypeName, draft: Draft) => (t === 'integer' ? n.t === NUM && isInteger(n.v as string, draft) : KIND_NAME[n.t] === t);

// ── the compiler ──────────────────────────────────────────────────────────

export class Validator {
  readonly issues: SchemaIssue[] = [];
  readonly draft: Draft;
  readonly root: S;
  /** Draft-specified keywords seen nowhere the schema's draft reads them, by name (reported once each). */
  private reported = new Set<string>();
  private resources = new Map<string, Resource>();
  private places = new Map<JNode, Place>();
  private compiled = new Map<JNode, S>();
  private external: Map<string, JNode>;
  private formats: boolean;
  /** Some schema uses unevaluatedProperties / unevaluatedItems: annotations are tracked. */
  private needAnn = false;
  private pending: S[] = [];
  /** The schema whose keywords are being read (its blocking problems are kept with it). */
  private filling: S | null = null;
  private rootRes: Resource;

  constructor(schema: JNode, opts: CompileOptions = {}) {
    this.formats = !!opts.formats;
    this.external = opts.resources ?? new Map();
    let draft: Draft = opts.draft ?? 2020;
    const sch = schema.t === OBJ ? member(schema, '$schema') : undefined;
    let vocab: Set<string> | null = null;
    if (sch && sch.t === STR) {
      const d = draftOf(sch.v as string);
      if (d === 3) this.issue('draft3', {}, sch, '$schema', true);
      else if (d) draft = d;
      else {
        // A custom meta-schema this schema includes (or a test supplies): its own `$schema` and `$vocabulary` decide.
        const meta = this.metaSchema(sch.v as string);
        if (meta) {
          draft = meta.draft;
          vocab = meta.vocab;
        } else this.issue('unknownSchema', { uri: sch.v as string, draft: DRAFT_NAME[draft] }, sch, '$schema', true);
      }
    }
    this.draft = draft;
    const res = (this.rootRes = this.newResource(DEFAULT_BASE, schema, draft));
    res.vocab = vocab;
    this.scan(schema, res, '', draft, true);
    this.root = this.compile(schema);
    this.drain();
  }

  /** The draft and vocabularies of a meta-schema named by URI, if this schema or the resources include it. */
  private metaSchema(uri: string): { draft: Draft; vocab: Set<string> | null } | null {
    const key = normalizeUri(splitFragment(uri)[0]);
    const node = [...this.external].find(([u]) => normalizeUri(splitFragment(u)[0]) === key)?.[1];
    if (!node || node.t !== OBJ) return null;
    const own = member(node, '$schema');
    const d = own && own.t === STR ? draftOf(own.v as string) : null;
    const draft: Draft = d && d !== 3 ? d : 2020;
    const v = member(node, '$vocabulary');
    let vocab: Set<string> | null = null;
    if (v && v.t === OBJ) {
      vocab = new Set();
      // (false only says a validator that doesn't know the vocabulary may go on: one that knows it uses it.)
      for (const m of members(v)) if (m.t === BOOL) vocab.add(String(m.key).replace(/.*\/vocab\//, ''));
    }
    return { draft, vocab };
  }

  private issue(code: string, params: Params, at: JNode | null, kw: string, warn = false): SchemaIssue {
    const i: SchemaIssue = { code, params, at, kw, warn };
    this.issues.push(i);
    // (A keyword that can't be applied, met while reading a schema: validating there can't be complete.)
    if (!warn && this.filling && BLOCKING.has(code)) (this.filling.blocked ??= []).push({ issue: i, kw });
    return i;
  }

  private newResource(uri: string, root: JNode, draft: Draft): Resource {
    const r: Resource = { uri, root, draft, anchors: new Map(), dynamic: new Map(), recursive: false, vocab: null };
    const had = this.resources.get(uri);
    if (had && had.root !== root) {
      const id = root.t === OBJ ? member(root, draft === 4 ? 'id' : '$id') ?? null : null;
      this.issue('duplicateId', { id: uri }, id, '$id', true);
    } else this.resources.set(uri, r);
    return had && had.root !== root ? had : r;
  }

  /** Registers the resources and anchors in and under schema `node`. */
  private scan(node: JNode, parent: Resource, ptr: string, draft: Draft, isRoot = false) {
    if (this.places.has(node)) return;
    if (node.t !== OBJ) {
      this.places.set(node, { res: parent, ptr, draft });
      return;
    }
    let res = parent;
    const idKw = draft === 4 ? 'id' : '$id';
    const id = member(node, idKw);
    const refSibling = draft <= 7 && !!member(node, '$ref');
    if (id && id.t === STR && !refSibling) {
      const raw = id.v as string;
      if (draft <= 7 && raw.startsWith('#')) {
        const name = decodeFragment(raw.slice(1)) ?? '';
        if (ANCHOR.test(name)) res.anchors.set(name, node);
      } else {
        const [uri, frag] = splitFragment(resolveUri(parent.uri, raw));
        if (frag && draft >= 2019) this.issue('idFragment', { id: raw }, id, idKw, true);
        if (!isRoot || uri !== DEFAULT_BASE) {
          // An embedded resource may name its own draft.
          const sch = member(node, '$schema');
          const d = sch && sch.t === STR ? draftOf(sch.v as string) : null;
          if (d && d !== 3) draft = d;
          const key = normalizeUri(uri);
          // (A root keeps the URI it was found by too: the default base, or an external schema's retrieval URI.)
          if (isRoot) {
            parent.uri = key;
            parent.draft = draft;
            this.resources.set(key, parent);
          } else res = this.newResource(key, node, draft);
          ptr = '';
        }
        const name = decodeFragment(frag) ?? '';
        if (name && draft <= 7 && ANCHOR.test(name)) res.anchors.set(name, node);
      }
    }
    if (draft >= 2019) {
      const a = member(node, '$anchor');
      if (a && a.t === STR && !refSibling) {
        if (ANCHOR.test(a.v as string)) res.anchors.set(a.v as string, node);
        else this.issue('badAnchor', { kw: '$anchor', name: a.v as string }, a, '$anchor');
      }
    }
    if (draft === 2020) {
      const a = member(node, '$dynamicAnchor');
      if (a && a.t === STR) {
        if (ANCHOR.test(a.v as string)) {
          res.anchors.set(a.v as string, node);
          res.dynamic.set(a.v as string, node);
        } else this.issue('badAnchor', { kw: '$dynamicAnchor', name: a.v as string }, a, '$dynamicAnchor');
      }
    }
    if (draft === 2019) {
      const a = member(node, '$recursiveAnchor');
      if (a && a.t === BOOL && a.v === true && res.root === node) res.recursive = true;
    }
    this.places.set(node, { res, ptr, draft });
    for (const m of members(node)) {
      const k = m.key as string;
      const p = ptr + '/' + escapeToken(k);
      if (singleSchemaKeywords(draft).includes(k) || (k === 'items' && m.t !== ARR)) this.scan(m, res, p, draft);
      else if (arraySchemaKeywords(draft).includes(k) || (k === 'items' && m.t === ARR && draft <= 2019)) {
        if (m.t === ARR) kids(m).forEach((c, i) => this.scan(c, res, p + '/' + i, draft));
      } else if (mapSchemaKeywords(draft).includes(k) || k === 'dependencies') {
        if (m.t === OBJ) for (const c of members(m)) if (k !== 'dependencies' || c.t !== ARR) this.scan(c, res, p + '/' + escapeToken(c.key as string), draft);
      }
    }
  }

  /** Where a node is: scanned, or (reached by a JSON Pointer into a place nothing scanned) its nearest scanned ancestor's resource. */
  private placeOf(node: JNode): Place {
    const p = this.places.get(node);
    if (p) return p;
    const path: (string | number)[] = [];
    let n: JNode | null = node;
    while (n && !this.places.has(n)) {
      path.push(n.key as string | number);
      n = n.u;
    }
    const base = n ? this.places.get(n)! : { res: this.rootRes, ptr: '', draft: this.draft };
    const place: Place = { res: base.res, ptr: base.ptr + pointer(path.reverse()), draft: base.draft };
    this.scan(node, place.res, place.ptr, place.draft);
    return this.places.get(node) ?? place;
  }

  /** The compiled schema for `node` (compiled once; its subschemas are compiled after it, see drain). */
  private compile(node: JNode): S {
    const had = this.compiled.get(node);
    if (had) return had;
    const place = this.placeOf(node);
    const s: S = { node, bool: null, res: place.res, base: place.res.uri, draft: place.draft, refOnly: false, kw: new Map() };
    this.compiled.set(node, s);
    if (node.t === BOOL) {
      s.bool = node.v as boolean;
      if (s.draft === 4 && !this.reported.has('bool4')) {
        this.reported.add('bool4');
        this.issue('boolSchema4', {}, node, '', true);
      }
      return s;
    }
    if (node.t !== OBJ) {
      s.blocked = [{ issue: this.issue('notSchema', { type: KIND_NAME[node.t] }, node, ''), kw: '' }];
      s.bool = true;
      return s;
    }
    const seen = new Set<string>();
    for (const m of kids(node)) {
      if (seen.has(m.key as string)) this.issue('duplicateKeyword', { kw: m.key as string }, m, m.key as string, true);
      seen.add(m.key as string);
      s.kw.set(m.key as string, m);
    }
    this.pending.push(s);
    return s;
  }

  private drain() {
    while (this.pending.length) {
      const s = this.pending.pop()!;
      this.filling = s;
      try {
        this.fill(s);
      } finally {
        this.filling = null;
      }
    }
  }

  /** A subschema keyword's value, compiled (or an issue when it isn't a schema). */
  private sub(v: JNode, kw: string): S | undefined {
    if (v.t === OBJ || v.t === BOOL) return this.compile(v);
    this.bad(kw, 'schema', v);
    return undefined;
  }

  private bad(kw: string, expected: string, at: JNode) {
    this.issue('badValue', { kw, expected }, at, kw);
  }

  private count(kw: string, v: JNode): number | undefined {
    const d = v.t === NUM ? dec(v.v as string) : null;
    if (!d || d.neg || !isWhole(d) || (this.placeDraft(v) === 4 && /[.eE]/.test(v.v as string))) {
      this.bad(kw, 'nonNegativeInteger', v);
      return undefined;
    }
    return Number(decText(d));
  }

  private placeDraft(v: JNode): Draft {
    return v.u ? this.compiled.get(v.u)?.draft ?? this.draft : this.draft;
  }

  private num(kw: string, v: JNode): Dec | undefined {
    const d = v.t === NUM ? dec(v.v as string) : null;
    if (!d) this.bad(kw, 'number', v);
    return d ?? undefined;
  }

  private regex(kw: string, src: string, at: JNode): RegExp | undefined {
    try {
      return new RegExp(src, 'u');
    } catch (e) {
      this.issue('badRegex', { kw, pattern: src, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : '' }, at, kw);
      return undefined;
    }
  }

  private strings(kw: string, v: JNode, unique: boolean): string[] | undefined {
    if (v.t !== ARR || !kids(v).every((c) => c.t === STR)) {
      this.bad(kw, 'stringArray', v);
      return undefined;
    }
    const out = kids(v).map((c) => c.v as string);
    if (unique && new Set(out).size !== out.length) this.issue('notUnique', { kw }, v, kw, true);
    return out;
  }

  private schemas(kw: string, v: JNode, nonEmpty: boolean): S[] | undefined {
    if (v.t !== ARR || (nonEmpty && !kids(v).length)) {
      this.bad(kw, nonEmpty ? 'schemaArrayNonEmpty' : 'schemaArray', v);
      return undefined;
    }
    const out: S[] = [];
    for (const c of kids(v)) {
      const s = this.sub(c, kw);
      if (s) out.push(s);
    }
    return out;
  }

  private vocabOn(s: S, name: string): boolean {
    const v = s.res.vocab;
    return !v || [...v].some((x) => x === name || x.endsWith('/' + name));
  }

  /** Reads every keyword of compiled schema `s`. */
  private fill(s: S) {
    const d = s.draft;
    const kw = s.kw;
    const known = knownKeywords(d);
    const get = (k: string) => kw.get(k);
    if (d <= 7 && get('$ref')) s.refOnly = true;

    const validation = this.vocabOn(s, 'validation');
    const applicator = this.vocabOn(s, 'applicator');

    for (const [k, v] of kw) {
      if (known.has(k)) continue;
      this.unknown(k, v, d);
    }

    const ref = get('$ref');
    if (ref) {
      if (ref.t !== STR) this.bad('$ref', 'string', ref);
      else s.ref = { raw: ref.v as string, target: this.resolve(s, ref.v as string, ref, '$ref'), at: ref };
    }
    if (s.refOnly) {
      // (Its siblings are ignored, but still checked: a broken one is a problem when the draft changes.)
      return;
    }
    if (d === 2020) {
      const dr = get('$dynamicRef');
      if (dr) {
        if (dr.t !== STR) this.bad('$dynamicRef', 'string', dr);
        else {
          const target = this.resolve(s, dr.v as string, dr, '$dynamicRef');
          // (The fragment as resolution reads it, percent-decoded: #%6Eode names the dynamic anchor "node" too.)
          const frag = decodeFragment(splitFragment(dr.v as string)[1]) ?? '';
          const anchor = frag && ANCHOR.test(frag) && target && target.node.t === OBJ && (member(target.node, '$dynamicAnchor')?.v as string | undefined) === frag ? frag : null;
          s.dynRef = { raw: dr.v as string, target, at: dr, anchor };
        }
      }
    }
    if (d === 2019) {
      const rr = get('$recursiveRef');
      if (rr) {
        if (rr.t !== STR) this.bad('$recursiveRef', 'string', rr);
        else s.recRef = { raw: rr.v as string, target: this.resolve(s, rr.v as string, rr, '$recursiveRef'), at: rr };
      }
    }

    for (const k of ['$id', 'id', '$schema', '$comment', 'title', 'description', '$anchor', '$dynamicAnchor', 'contentMediaType', 'contentEncoding']) {
      const v = get(k);
      if (v && known.has(k) && v.t !== STR) this.bad(k, 'string', v);
    }
    for (const k of ['readOnly', 'writeOnly', 'deprecated', '$recursiveAnchor']) {
      const v = get(k);
      if (v && known.has(k) && v.t !== BOOL) this.bad(k, 'boolean', v);
    }
    const examples = get('examples');
    if (examples && known.has('examples') && examples.t !== ARR) this.bad('examples', 'array', examples);
    const cs = get('contentSchema');
    if (cs && known.has('contentSchema')) this.sub(cs, 'contentSchema');

    if (validation) this.fillValidation(s, get, d);
    if (applicator) this.fillApplicator(s, get, d);
    if (d >= 2019 && (d === 2020 ? this.vocabOn(s, 'unevaluated') : applicator)) {
      const ui = get('unevaluatedItems');
      if (ui) s.unevaluatedItems = this.sub(ui, 'unevaluatedItems');
      const up = get('unevaluatedProperties');
      if (up) s.unevaluatedProperties = this.sub(up, 'unevaluatedProperties');
      if (s.unevaluatedItems || s.unevaluatedProperties) this.needAnn = true;
    }
    const f = get('format');
    if (f) {
      if (f.t !== STR) this.bad('format', 'string', f);
      else if (this.formats || !!s.res.vocab?.has('format-assertion')) {
        s.format = f.v as string;
        if (!knownFormat(s.format) && !this.reported.has('fmt:' + s.format)) {
          this.reported.add('fmt:' + s.format);
          this.issue('unknownFormat', { format: s.format }, f, 'format', true);
        }
      }
    }
  }

  private fillValidation(s: S, get: (k: string) => JNode | undefined, d: Draft) {
    const type = get('type');
    if (type) {
      const list = type.t === STR ? [type] : type.t === ARR ? kids(type) : null;
      if (!list || !list.every((t) => t.t === STR && (TYPES as readonly string[]).includes(t.v as string))) this.bad('type', 'type', type);
      else {
        s.types = list.map((t) => t.v as TypeName);
        if (new Set(s.types).size !== s.types.length) this.issue('notUnique', { kw: 'type' }, type, 'type', true);
      }
    }
    const en = get('enum');
    if (en) {
      if (en.t !== ARR) this.bad('enum', 'array', en);
      else s.enum = { keys: new Set(kids(en).map(canon)), values: kids(en) };
    }
    const c = d >= 6 ? get('const') : undefined;
    if (c) {
      s.constKey = canon(c);
      s.constNode = c;
    }
    const mo = get('multipleOf');
    if (mo) {
      const v = this.num('multipleOf', mo);
      if (v && (isZero(v) || v.neg)) this.bad('multipleOf', 'positive', mo);
      else s.multipleOf = v;
    }
    const max = get('maximum');
    if (max) s.maximum = this.num('maximum', max);
    const min = get('minimum');
    if (min) s.minimum = this.num('minimum', min);
    const exMax = get('exclusiveMaximum');
    const exMin = get('exclusiveMinimum');
    if (d === 4) {
      if (exMax) {
        if (exMax.t !== BOOL) this.bad('exclusiveMaximum', 'boolean', exMax);
        else s.exMaxFlag = exMax.v as boolean;
      }
      if (exMin) {
        if (exMin.t !== BOOL) this.bad('exclusiveMinimum', 'boolean', exMin);
        else s.exMinFlag = exMin.v as boolean;
      }
    } else {
      if (exMax) s.exMax = this.num('exclusiveMaximum', exMax);
      if (exMin) s.exMin = this.num('exclusiveMinimum', exMin);
    }
    const counts: [keyof S, string][] = [['maxLength', 'maxLength'], ['minLength', 'minLength'], ['maxItems', 'maxItems'], ['minItems', 'minItems'], ['maxProperties', 'maxProperties'], ['minProperties', 'minProperties']];
    if (d >= 2019) counts.push(['minContains', 'minContains'], ['maxContains', 'maxContains']);
    for (const [field, k] of counts) {
      const v = get(k);
      if (v) (s as unknown as Record<string, number | undefined>)[field] = this.count(k, v);
    }
    const pat = get('pattern');
    if (pat) {
      if (pat.t !== STR) this.bad('pattern', 'string', pat);
      else {
        s.pattern = this.regex('pattern', pat.v as string, pat);
        s.patternText = pat.v as string;
      }
    }
    const ui = get('uniqueItems');
    if (ui) {
      if (ui.t !== BOOL) this.bad('uniqueItems', 'boolean', ui);
      else s.uniqueItems = ui.v as boolean;
    }
    const req = get('required');
    if (req) {
      // (draft-03's boolean `required` inside a property isn't supported: draft-04 made it an array.)
      s.required = this.strings('required', req, true);
    }
    const dr = d >= 2019 ? get('dependentRequired') : undefined;
    if (dr) {
      if (dr.t !== OBJ) this.bad('dependentRequired', 'object', dr);
      else {
        s.dependentRequired = [];
        for (const m of members(dr)) {
          const deps = this.strings('dependentRequired', m, true);
          if (deps) s.dependentRequired.push({ key: m.key as string, deps, kw: 'dependentRequired' });
        }
      }
    }
  }

  private fillApplicator(s: S, get: (k: string) => JNode | undefined, d: Draft) {
    for (const k of ['allOf', 'anyOf', 'oneOf'] as const) {
      const v = get(k);
      if (v) s[k] = this.schemas(k, v, true);
    }
    const not = get('not');
    if (not) s.not = this.sub(not, 'not');
    if (d >= 7) {
      const i = get('if');
      if (i) s.if = this.sub(i, 'if');
      const t = get('then');
      if (t) s.then = this.sub(t, 'then');
      const e = get('else');
      if (e) s.else = this.sub(e, 'else');
    }
    // Arrays
    const items = get('items');
    if (d === 2020) {
      const pre = get('prefixItems');
      if (pre) s.prefix = this.schemas('prefixItems', pre, true);
      if (items) {
        if (items.t === ARR) {
          // 2019-09's array form: read as prefixItems (with a problem saying so) rather than dropped.
          this.issue('itemsArray2020', {}, items, 'items');
          if (!pre) s.prefix = this.schemas('items', items, false);
        } else s.items = this.sub(items, 'items');
      }
    } else if (items) {
      if (items.t === ARR) {
        s.prefix = this.schemas('items', items, false);
        const ai = get('additionalItems');
        if (ai) s.additionalItems = this.sub(ai, 'additionalItems');
      } else s.items = this.sub(items, 'items');
    } else if (get('additionalItems')) this.sub(get('additionalItems')!, 'additionalItems');
    if (d >= 6) {
      const c = get('contains');
      if (c) s.contains = this.sub(c, 'contains');
      const pn = get('propertyNames');
      if (pn) s.propertyNames = this.sub(pn, 'propertyNames');
    }
    // Objects
    const props = get('properties');
    if (props) {
      if (props.t !== OBJ) this.bad('properties', 'schemaObject', props);
      else {
        s.properties = new Map();
        for (const m of members(props)) {
          const x = this.sub(m, 'properties');
          if (x) s.properties.set(m.key as string, x);
        }
      }
    }
    const pp = get('patternProperties');
    if (pp) {
      if (pp.t !== OBJ) this.bad('patternProperties', 'schemaObject', pp);
      else {
        s.patternProperties = [];
        for (const m of members(pp)) {
          const re = this.regex('patternProperties', m.key as string, m);
          const x = this.sub(m, 'patternProperties');
          if (re && x) s.patternProperties.push({ re, src: m.key as string, s: x });
        }
      }
    }
    const ap = get('additionalProperties');
    if (ap) s.additionalProperties = this.sub(ap, 'additionalProperties');
    for (const k of mapSchemaKeywords(d)) {
      if (k !== 'definitions' && k !== '$defs') continue;
      const v = get(k);
      if (!v) continue;
      if (v.t !== OBJ) this.bad(k, 'schemaObject', v);
      else for (const m of members(v)) this.sub(m, k);
    }
    const ds = d >= 2019 ? get('dependentSchemas') : undefined;
    if (ds) {
      if (ds.t !== OBJ) this.bad('dependentSchemas', 'schemaObject', ds);
      else {
        s.dependentSchemas = [];
        for (const m of members(ds)) {
          const x = this.sub(m, 'dependentSchemas');
          if (x) s.dependentSchemas.push({ key: m.key as string, s: x, kw: 'dependentSchemas' });
        }
      }
    }
    const dep = get('dependencies');
    if (dep) {
      if (dep.t !== OBJ) this.bad('dependencies', 'object', dep);
      else
        for (const m of members(dep)) {
          if (m.t === ARR) {
            const deps = this.strings('dependencies', m, true);
            if (deps) (s.dependentRequired ??= []).push({ key: m.key as string, deps, kw: 'dependencies' });
          } else {
            const x = this.sub(m, 'dependencies');
            if (x) (s.dependentSchemas ??= []).push({ key: m.key as string, s: x, kw: 'dependencies' });
          }
        }
    }
  }

  /** A keyword the draft doesn't define: another draft's (named), OpenAPI's `nullable`, or unknown (ignored, as specified). */
  private unknown(k: string, v: JNode, d: Draft) {
    if (k === 'nullable') return this.issue('nullable', {}, v, k, true);
    // (Named by the draft that introduced it, or for a keyword since dropped, the last draft that had it.)
    const has = ([4, 6, 7, 2019, 2020] as Draft[]).filter((x) => x !== d && knownKeywords(x).has(k));
    const other = has.find((x) => x > d) ?? has.reverse().find((x) => x < d);
    if (other) {
      // (Annotations and containers that work as well without being read: no notice.)
      if (QUIET.has(k) || (k === 'id' && d >= 6) || (k === '$id' && d === 4)) return;
      if (k === 'additionalItems' && d === 2020) return this.issue('additionalItems2020', {}, v, k, true);
      return this.issue('otherDraft', { kw: k, draft: DRAFT_NAME[other], current: DRAFT_NAME[d] }, v, k, true);
    }
    if (k.startsWith('x-') || k.startsWith('$')) return;
    if (this.reported.has('kw:' + k)) return;
    this.reported.add('kw:' + k);
    this.issue('unknownKeyword', { kw: k }, v, k, true);
  }

  /** Resolves a reference from schema `s` (null: unresolved, with an issue). */
  private resolve(s: S, raw: string, at: JNode, kw: string): S | null {
    const abs = resolveUri(s.base, raw);
    const [uri, frag] = splitFragment(abs);
    const key = normalizeUri(uri);
    let res = this.resources.get(key);
    if (!res) {
      const ext = [...this.external].find(([u]) => normalizeUri(splitFragment(u)[0]) === key)?.[1];
      if (ext) {
        // (It is read in the draft its own `$schema` names, else in the referring schema's.)
        const own = ext.t === OBJ ? member(ext, '$schema') : undefined;
        const d = own && own.t === STR ? draftOf(own.v as string) : null;
        const draft: Draft = d && d !== 3 ? d : s.draft;
        res = this.newResource(key, ext, draft);
        this.scan(ext, res, '', draft, true);
        // (Its own `$id`, if any, named it again: the retrieval URI keeps working.)
        res = this.resources.get(key) ?? res;
      }
    }
    if (!res) {
      // A JSON Pointer or anchor in another resource of this schema, named by its $id plus a fragment, still resolves above.
      this.issue('unresolved', { ref: raw, uri: isAbsolute(raw) || key !== DEFAULT_BASE ? key : raw, why: 'remote' }, at, kw);
      return null;
    }
    const f = decodeFragment(frag);
    let node: JNode | undefined;
    if (f === null) node = undefined;
    else if (f === '') node = res.root;
    else if (f.startsWith('/')) {
      const tokens = pointerTokens(f);
      node = tokens ? this.walk(res.root, tokens) : undefined;
    } else node = res.anchors.get(f);
    if (!node) {
      this.issue('unresolved', { ref: raw, uri: frag, why: f !== null && f.startsWith('/') ? 'pointer' : 'anchor' }, at, kw);
      return null;
    }
    if (node.t !== OBJ && node.t !== BOOL) {
      this.issue('refNotSchema', { ref: raw, type: KIND_NAME[node.t] }, at, kw);
      return null;
    }
    return this.compile(node);
  }

  private walk(root: JNode, tokens: string[]): JNode | undefined {
    let n: JNode | undefined = root;
    for (const t of tokens) {
      if (!n) return undefined;
      if (n.t === OBJ) n = member(n, t);
      else if (n.t === ARR && /^(?:0|[1-9]\d*)$/.test(t)) n = kids(n)[Number(t)];
      else return undefined;
    }
    return n;
  }

  // ── validation ──────────────────────────────────────────────────────────
  //
  // A part of the schema that can't be applied (an unresolved $ref, a keyword with a broken value, a $ref loop)
  // is skipped as if it passed, and `unk` notes it: the result can't then be "valid", only "not fully checked".
  // Where a pass decides against the instance (not, if, oneOf, contains counts, unevaluated*), a pass that met such
  // a part is no evidence either way: it fails nothing and leaves the result incomplete. A failure is always real.

  private errs: Failure[] = [];
  /** The list validate() returns (errors past its cap are counted). */
  private main: Failure[] = [];
  private cap = Infinity;
  /** Record errors (else: quiet, stop at the first failure). */
  private collect = true;
  /** Errors past the main list's cap: counted, not kept. */
  private overflow = 0;
  private kp: (string | number)[] = [];
  private scope: Resource[] = [];
  private depth = 0;
  /** Synthetic string nodes for property names (propertyNames): name node → its member. */
  private keyNodes = new WeakMap<JNode, JNode>();
  /** A $ref loop's problem, by the schema it loops on (reported once). */
  private loops = new Map<S, SchemaIssue>();
  /** multipleOf values too far in scale from a number to work out, by schema (reported once). */
  private ranges = new Map<S, SchemaIssue>();
  /** The evaluation in progress met a part of the schema it couldn't apply. */
  private unk = false;
  /** The blocking problems met while validating (what "not fully checked" is about). */
  private reached = new Set<SchemaIssue>();
  /** Big objects' members by name (last wins), made once per validation: `required` on 20,000 keys stays linear. */
  private byName = new WeakMap<JNode, Map<string, JNode>>();

  /**
   * Validates `inst`. Returns the errors (at most `max` kept, `total` counting all), whether it is valid, and whether
   * the check was complete (`reached`: the schema problems that left part of it unapplied). Throws a RangeError for
   * an instance nested too deeply.
   */
  validate(inst: JNode, max = 1000): { valid: boolean; complete: boolean; reached: SchemaIssue[]; errors: Failure[]; total: number } {
    this.errs = this.main = [];
    this.cap = max;
    this.collect = true;
    this.overflow = 0;
    this.kp = [];
    this.scope = [];
    this.depth = 0;
    this.unk = false;
    this.reached = new Set();
    this.byName = new WeakMap();
    const valid = this.ev(this.root, inst, this.needAnn ? new Ann() : null);
    const errors = this.errs;
    this.errs = [];
    return { valid, complete: !this.unk, reached: [...this.reached], errors, total: errors.length + this.overflow };
  }

  /** Member `key` of instance object `obj` (last wins): a scan for small objects, a map made once for big ones. */
  private get(obj: JNode, key: string): JNode | undefined {
    const all = kids(obj);
    if (all.length <= 16) return member(obj, key);
    let map = this.byName.get(obj);
    if (!map) {
      map = new Map();
      for (const m of all) map.set(m.key as string, m);
      this.byName.set(obj, map);
    }
    return map.get(key);
  }

  private skip(issue?: SchemaIssue) {
    this.unk = true;
    if (issue) this.reached.add(issue);
  }

  /** Runs `f` with an unknown flag of its own: its result, and whether it met a part it couldn't apply (the outer flag stays as it was). */
  private alone<T>(f: () => T): [T, boolean] {
    const was = this.unk;
    this.unk = false;
    try {
      const r = f();
      return [r, this.unk];
    } finally {
      this.unk = was;
    }
  }

  /** `here`: the error is about the schema at the keyword path itself (a false subschema), not a keyword in it. */
  private fail(code: string, params: Params, inst: JNode, kw: string, at: JNode | null | undefined, extra?: { key?: boolean; sub?: Failure[]; here?: boolean }) {
    if (!this.collect) return;
    if (this.errs.length >= this.cap) {
      if (this.errs === this.main) this.overflow++;
      else this.collect = false; // a branch's list is full: the rest of the branch is evaluated quietly
      return;
    }
    const keyOf = this.keyNodes.get(inst);
    this.errs.push({
      code,
      params,
      inst: keyOf ?? inst,
      key: !!keyOf || !!extra?.key,
      kw,
      path: pointer(kw && !extra?.here ? [...this.kp, kw] : this.kp),
      at: at ?? null,
      ...(extra?.sub && { sub: extra.sub }),
    });
  }

  /** Runs `f` quietly: its errors aren't recorded and it stops at the first failure. */
  private quiet<T>(f: () => T): T {
    const was = this.collect;
    this.collect = false;
    try {
      return f();
    } finally {
      this.collect = was;
    }
  }

  /** Runs `f` collecting at most BRANCH_ERRORS errors of its own (null when quiet). */
  private branch(f: () => boolean): { ok: boolean; errs: Failure[] | null } {
    if (!this.collect) return { ok: f(), errs: null };
    const saved = { errs: this.errs, cap: this.cap, overflow: this.overflow };
    this.errs = [];
    this.cap = BRANCH_ERRORS;
    try {
      const ok = f();
      return { ok, errs: this.errs };
    } finally {
      this.errs = saved.errs;
      this.cap = saved.cap;
      this.overflow = saved.overflow;
      this.collect = true;
    }
  }

  /** Applies `s` (pushing `token`s onto the keyword path); its annotations join `ann` only when it passes. */
  private apply(s: S, inst: JNode, ann: Ann | null, tokens: (string | number)[]): boolean {
    for (const t of tokens) this.kp.push(t);
    // (Every evaluation has its own annotations when they are tracked: its unevaluated* keywords read them.)
    const child = this.needAnn ? new Ann() : null;
    const ok = this.ev(s, inst, child);
    if (ann && child && ok) ann.merge(child);
    this.kp.length -= tokens.length;
    return ok;
  }

  private ev(s: S, inst: JNode, ann: Ann | null): boolean {
    if (s.bool !== null) {
      if (s.blocked) this.skip(s.blocked[0].issue);
      if (!s.bool) this.fail('false', {}, inst, '', s.node);
      return s.bool;
    }
    if (++this.depth > MAX_DEPTH) throw new RangeError('Maximum call stack size exceeded (schema recursion)');
    const entered = this.scope[this.scope.length - 1] !== s.res;
    if (entered) this.scope.push(s.res);
    // (This schema's own flag: its unevaluated* keywords can't trust annotations where a part was skipped.)
    const outer = this.unk;
    this.unk = false;
    try {
      if (s.blocked) for (const b of s.blocked) if (applies(b.kw, inst.t)) this.skip(b.issue);
      return this.evObject(s, inst, ann);
    } finally {
      this.unk = outer || this.unk;
      if (entered) this.scope.pop();
      this.depth--;
    }
  }

  private follow(ref: Ref, target: S, inst: JNode, ann: Ann | null, kw: string): boolean {
    const active = (target.active ??= []);
    if (active.includes(inst)) {
      let issue = this.loops.get(target);
      if (!issue) this.loops.set(target, (issue = this.issue('loop', { ref: ref.raw }, ref.at, kw)));
      this.skip(issue);
      return true;
    }
    active.push(inst);
    try {
      return this.apply(target, inst, ann, [kw]);
    } finally {
      active.pop();
    }
  }

  private evObject(s: S, inst: JNode, ann: Ann | null): boolean {
    let ok = true;
    const q = () => !ok && !this.collect;
    if (s.ref?.target) {
      ok = this.follow(s.ref, s.ref.target, inst, ann, '$ref') && ok;
      if (s.refOnly || q()) return ok;
    }
    if (s.refOnly) return ok;
    if (s.dynRef?.target) {
      let target = s.dynRef.target;
      if (s.dynRef.anchor) {
        for (const r of this.scope) {
          const n = r.dynamic.get(s.dynRef.anchor);
          if (n) {
            target = this.compile(n);
            this.drain();
            break;
          }
        }
      }
      ok = this.follow(s.dynRef, target, inst, ann, '$dynamicRef') && ok;
      if (q()) return ok;
    }
    if (s.recRef?.target) {
      let target = s.recRef.target;
      if (target.res.recursive && target.node === target.res.root) {
        for (let i = this.scope.length - 1; i >= 0; i--) {
          const r = this.scope[i];
          if (!r.recursive) break;
          target = this.compile(r.root);
        }
        this.drain();
      }
      ok = this.follow(s.recRef, target, inst, ann, '$recursiveRef') && ok;
      if (q()) return ok;
    }
    const d = s.draft;
    const at = (k: string) => s.kw.get(k);

    if (s.types && !s.types.some((t) => hasType(inst, t, d))) {
      ok = false;
      this.fail('type', { expected: s.types.join(', '), actual: typeOf(inst, d) }, inst, 'type', at('type'));
      if (q()) return ok;
    }
    if (s.enum && !s.enum.keys.has(canon(inst))) {
      ok = false;
      this.fail('enum', { values: s.enum.values.slice(0, 8).map((v) => preview(v, 40)).join(', ') + (s.enum.values.length > 8 ? ', …' : ''), count: s.enum.values.length }, inst, 'enum', at('enum'));
      if (q()) return ok;
    }
    if (s.constKey !== undefined && canon(inst) !== s.constKey) {
      ok = false;
      this.fail('const', { value: preview(s.constNode!) }, inst, 'const', at('const'));
      if (q()) return ok;
    }

    switch (inst.t) {
      case NUM:
        ok = this.evNumber(s, inst) && ok;
        break;
      case STR:
        ok = this.evString(s, inst) && ok;
        break;
      case ARR:
        ok = this.evArray(s, inst, ann) && ok;
        break;
      case OBJ:
        ok = this.evObjectKeywords(s, inst, ann) && ok;
        break;
    }
    if (q()) return ok;

    if (s.allOf) {
      for (let i = 0; i < s.allOf.length; i++) {
        if (!this.apply(s.allOf[i], inst, ann, ['allOf', i])) {
          ok = false;
          if (q()) return ok;
        }
      }
    }
    if (s.anyOf) {
      ok = this.evAny(s, s.anyOf, inst, ann) && ok;
      if (q()) return ok;
    }
    if (s.oneOf) {
      ok = this.evOne(s, s.oneOf, inst, ann) && ok;
      if (q()) return ok;
    }
    if (s.not) {
      const [matched, unk] = this.alone(() => this.quiet(() => this.apply(s.not!, inst, null, ['not'])));
      if (matched && unk) this.unk = true;
      else if (matched) {
        ok = false;
        this.fail('not', {}, inst, 'not', at('not'));
        if (q()) return ok;
      }
    }
    if (s.if && (s.then || s.else || ann)) {
      const ifAnn = ann ? new Ann() : null;
      const [passed, unk] = this.alone(() => this.quiet(() => this.apply(s.if!, inst, ifAnn, ['if'])));
      // (An `if` that passed only past a skipped part may not have: which branch applies isn't known, neither is checked.)
      if (passed && unk) this.unk = true;
      else {
        if (passed && ifAnn && ann) ann.merge(ifAnn);
        const branch = passed ? s.then : s.else;
        if (branch && !this.apply(branch, inst, ann, [passed ? 'then' : 'else'])) {
          ok = false;
          if (q()) return ok;
        }
      }
    }
    if (inst.t === OBJ && s.dependentSchemas) {
      for (const dsc of s.dependentSchemas) {
        if (this.get(inst, dsc.key) === undefined) continue;
        if (!this.apply(dsc.s, inst, ann, [dsc.kw, dsc.key])) {
          ok = false;
          if (q()) return ok;
        }
      }
    }
    // Last: they see what everything else evaluated (not past a skipped part, whose annotations are missing).
    if (inst.t === OBJ && s.unevaluatedProperties && ann) {
      if (!this.unk) {
        for (const m of members(inst)) {
          const k = m.key as string;
          if (ann.allProps || ann.props?.has(k)) continue;
          if (!this.child(s.unevaluatedProperties, m, ['unevaluatedProperties'], 'unevaluatedProperties')) {
            ok = false;
            if (q()) return ok;
          }
        }
      }
      ann.allProps = true;
    }
    if (inst.t === ARR && s.unevaluatedItems && ann) {
      if (!this.unk) {
        const items = kids(inst);
        for (let i = 0; i < items.length; i++) {
          if (ann.allItems || i < ann.items || ann.idx?.has(i)) continue;
          if (!this.child(s.unevaluatedItems, items[i], ['unevaluatedItems'], 'unevaluatedItems', items.length)) {
            ok = false;
            if (q()) return ok;
          }
        }
      }
      ann.allItems = true;
    }
    return ok;
  }

  /**
   * Applies `sub` to child value `c` of the instance. A `false` subschema gets its keyword's own message ("Property
   * x is not allowed") instead of the generic one, located at the subschema itself (/properties/x).
   */
  private child(sub: S, c: JNode, tokens: (string | number)[], kw: string, len?: number): boolean {
    if (sub.bool === false) {
      for (const t of tokens) this.kp.push(t);
      const isProp = typeof c.key === 'string';
      if (kw === 'additionalProperties' || kw === 'unevaluatedProperties') this.fail(kw, { name: String(c.key) }, c, kw, sub.node, { key: true, here: true });
      else if (kw === 'additionalItems' || kw === 'items' || kw === 'unevaluatedItems') this.fail(kw === 'unevaluatedItems' ? kw : 'additionalItems', { index: Number(c.key), count: len ?? 0 }, c, kw, sub.node, { here: true });
      else this.fail('false', {}, c, kw, sub.node, { key: isProp && kw === 'propertyNames', here: true });
      this.kp.length -= tokens.length;
      return false;
    }
    return this.apply(sub, c, null, tokens);
  }

  private evNumber(s: S, inst: JNode): boolean {
    let ok = true;
    const x = dec(inst.v as string);
    // (The parser only makes JSON numbers: never, but not a silent pass either.)
    if (!x) {
      this.skip();
      return true;
    }
    const at = (k: string) => s.kw.get(k);
    const check = (bad: boolean, code: string, limit: Dec, kw: string) => {
      if (!bad) return;
      ok = false;
      this.fail(code, { limit: decText(limit), value: decText(x) }, inst, kw, at(kw));
    };
    if (s.maximum) check(s.exMaxFlag ? cmp(x, s.maximum) >= 0 : cmp(x, s.maximum) > 0, s.exMaxFlag ? 'exclusiveMaximum' : 'maximum', s.maximum, 'maximum');
    if (!ok && !this.collect) return ok;
    if (s.minimum) check(s.exMinFlag ? cmp(x, s.minimum) <= 0 : cmp(x, s.minimum) < 0, s.exMinFlag ? 'exclusiveMinimum' : 'minimum', s.minimum, 'minimum');
    if (!ok && !this.collect) return ok;
    if (s.exMax) check(cmp(x, s.exMax) >= 0, 'exclusiveMaximum', s.exMax, 'exclusiveMaximum');
    if (!ok && !this.collect) return ok;
    if (s.exMin) check(cmp(x, s.exMin) <= 0, 'exclusiveMinimum', s.exMin, 'exclusiveMinimum');
    if (!ok && !this.collect) return ok;
    if (s.multipleOf) {
      const m = isMultiple(x, s.multipleOf);
      if (m === null) {
        // (A gap of more than 10^30,000 in scale: said so, rather than passed.)
        let issue = this.ranges.get(s);
        if (!issue) this.ranges.set(s, (issue = this.issue('multipleOfRange', { limit: decText(s.multipleOf), value: decText(x) }, at('multipleOf') ?? null, 'multipleOf')));
        this.skip(issue);
      } else if (!m) {
        ok = false;
        this.fail('multipleOf', { limit: decText(s.multipleOf), value: decText(x) }, inst, 'multipleOf', at('multipleOf'));
      }
    }
    return ok;
  }

  private evString(s: S, inst: JNode): boolean {
    let ok = true;
    const v = inst.v as string;
    const at = (k: string) => s.kw.get(k);
    if (s.maxLength !== undefined || s.minLength !== undefined) {
      const n = cpLength(v);
      if (s.maxLength !== undefined && n > s.maxLength) {
        ok = false;
        this.fail('maxLength', { limit: s.maxLength, count: n }, inst, 'maxLength', at('maxLength'));
        if (!this.collect) return ok;
      }
      if (s.minLength !== undefined && n < s.minLength) {
        ok = false;
        this.fail('minLength', { limit: s.minLength, count: n }, inst, 'minLength', at('minLength'));
        if (!this.collect) return ok;
      }
    }
    if (s.pattern && !s.pattern.test(v)) {
      ok = false;
      this.fail('pattern', { pattern: s.patternText! }, inst, 'pattern', at('pattern'));
      if (!this.collect) return ok;
    }
    if (s.format && !checkFormat(s.format, v, s.draft)) {
      ok = false;
      this.fail('format', { format: s.format }, inst, 'format', at('format'));
    }
    return ok;
  }

  private evArray(s: S, inst: JNode, ann: Ann | null): boolean {
    let ok = true;
    const items = kids(inst);
    const len = items.length;
    const at = (k: string) => s.kw.get(k);
    const q = () => !ok && !this.collect;
    /** An item a subschema evaluated successfully (annotations come from successful applications only). */
    const evaluated = (i: number) => ann && (ann.idx ??= new Set()).add(i);
    if (s.maxItems !== undefined && len > s.maxItems) {
      ok = false;
      this.fail('maxItems', { limit: s.maxItems, count: len }, inst, 'maxItems', at('maxItems'));
      if (q()) return ok;
    }
    if (s.minItems !== undefined && len < s.minItems) {
      ok = false;
      this.fail('minItems', { limit: s.minItems, count: len }, inst, 'minItems', at('minItems'));
      if (q()) return ok;
    }
    let done = 0;
    if (s.prefix) {
      const kw = s.draft === 2020 && s.kw.has('prefixItems') ? 'prefixItems' : 'items';
      const n = Math.min(len, s.prefix.length);
      let all = true;
      for (let i = 0; i < n; i++) {
        if (this.child(s.prefix[i], items[i], [kw, i], kw, len)) evaluated(i);
        else {
          ok = all = false;
          if (q()) return ok;
        }
      }
      done = n;
      if (ann && all && n > ann.items) ann.items = n;
    }
    const rest = s.items && (s.draft === 2020 || !s.prefix) ? s.items : s.prefix && s.draft <= 2019 ? s.additionalItems : undefined;
    if (rest) {
      const kw = rest === s.items ? 'items' : 'additionalItems';
      let all = true;
      for (let i = done; i < len; i++) {
        if (this.child(rest, items[i], [kw], kw, s.prefix?.length ?? 0)) evaluated(i);
        else {
          ok = all = false;
          if (q()) return ok;
        }
      }
      if (ann && all) ann.allItems = true;
    }
    if (s.uniqueItems && len > 1) {
      const seen = new Map<string, number>();
      for (let i = 0; i < len; i++) {
        const k = canon(items[i]);
        const j = seen.get(k);
        if (j !== undefined) {
          ok = false;
          this.fail('uniqueItems', { a: j, b: i }, inst, 'uniqueItems', at('uniqueItems'));
          break;
        }
        seen.set(k, i);
      }
      if (q()) return ok;
    }
    if (s.contains) {
      // Matches for sure, and matches only past a skipped part (which may or may not be matches).
      let sure = 0;
      let maybe = 0;
      const idx = ann && s.draft === 2020 ? new Set<number>() : null;
      const max = s.draft >= 2019 ? s.maxContains : undefined;
      const min = s.draft >= 2019 ? s.minContains ?? 1 : 1;
      for (let i = 0; i < len; i++) {
        const sub = ann && s.draft === 2020 ? new Ann() : null;
        const [hit, unk] = this.alone(() => this.quiet(() => this.apply(s.contains!, items[i], sub, ['contains'])));
        if (!hit) continue;
        if (unk) maybe++;
        else {
          sure++;
          idx?.add(i);
        }
        // (Without annotations to collect, counting can stop once the answer is known.)
        if (!idx && sure >= min && max === undefined) break;
      }
      let passed = true;
      if (sure + maybe < min) {
        ok = passed = false;
        if (min === 1 && !s.kw.has('minContains')) this.fail('contains', {}, inst, 'contains', at('contains'));
        else this.fail('minContains', { limit: min, count: sure }, inst, 'minContains', at('minContains') ?? at('contains'));
        if (q()) return ok;
      } else if (sure < min) this.unk = true;
      if (max !== undefined) {
        if (sure > max) {
          ok = passed = false;
          this.fail('maxContains', { limit: max, count: sure }, inst, 'maxContains', at('maxContains'));
          if (q()) return ok;
        } else if (sure + maybe > max) this.unk = true;
      }
      if (passed && idx && ann) for (const i of idx) (ann.idx ??= new Set()).add(i);
      if (maybe && ann) this.unk = true;
    }
    return ok;
  }

  private evObjectKeywords(s: S, inst: JNode, ann: Ann | null): boolean {
    let ok = true;
    const at = (k: string) => s.kw.get(k);
    const q = () => !ok && !this.collect;
    const all = members(inst);
    if (s.maxProperties !== undefined && all.length > s.maxProperties) {
      ok = false;
      this.fail('maxProperties', { limit: s.maxProperties, count: all.length }, inst, 'maxProperties', at('maxProperties'));
      if (q()) return ok;
    }
    if (s.minProperties !== undefined && all.length < s.minProperties) {
      ok = false;
      this.fail('minProperties', { limit: s.minProperties, count: all.length }, inst, 'minProperties', at('minProperties'));
      if (q()) return ok;
    }
    if (s.required) {
      for (const k of s.required) {
        if (this.get(inst, k) !== undefined) continue;
        ok = false;
        this.fail('required', { name: k }, inst, 'required', at('required'));
        if (q()) return ok;
      }
    }
    if (s.dependentRequired) {
      for (const dr of s.dependentRequired) {
        if (this.get(inst, dr.key) === undefined) continue;
        for (const k of dr.deps) {
          if (this.get(inst, k) !== undefined) continue;
          ok = false;
          this.fail('dependentRequired', { name: k, dep: dr.key }, inst, dr.kw, at(dr.kw));
          if (q()) return ok;
        }
      }
    }
    if (s.properties || s.patternProperties || s.additionalProperties) {
      for (const m of all) {
        const k = m.key as string;
        let matched = false;
        const p = s.properties?.get(k);
        // (A property counts as evaluated only where a subschema validated it.)
        if (p) {
          matched = true;
          if (this.child(p, m, ['properties', k], 'properties')) ann?.prop(k);
          else {
            ok = false;
            if (q()) return ok;
          }
        }
        if (s.patternProperties) {
          for (const pp of s.patternProperties) {
            if (!pp.re.test(k)) continue;
            matched = true;
            if (this.child(pp.s, m, ['patternProperties', pp.src], 'patternProperties')) ann?.prop(k);
            else {
              ok = false;
              if (q()) return ok;
            }
          }
        }
        if (!matched && s.additionalProperties) {
          if (this.child(s.additionalProperties, m, ['additionalProperties'], 'additionalProperties')) ann?.prop(k);
          else {
            ok = false;
            if (q()) return ok;
          }
        }
      }
    }
    if (s.propertyNames) {
      for (const m of all) {
        const name = new JNode(STR, m.key as string, m.s, m.d, inst, m.key);
        name.e = m.s;
        this.keyNodes.set(name, m);
        if (!this.child(s.propertyNames, name, ['propertyNames'], 'propertyNames')) {
          ok = false;
          if (q()) return ok;
        }
      }
    }
    return ok;
  }

  /** Scores a failing branch: errors at the value itself about its type or kind count as far off. */
  private score(errs: Failure[], inst: JNode): number {
    let n = 0;
    for (const e of errs) n += e.inst === inst && (e.code === 'type' || e.code === 'const' || e.code === 'enum' || e.code === 'false') ? 100 : 1;
    return n;
  }

  private evAny(s: S, list: S[], inst: JNode, ann: Ann | null): boolean {
    // A branch that passes for sure decides; one that passes only past a skipped part leaves the result open.
    let sure = false;
    let maybe = false;
    let best: { errs: Failure[]; score: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      const child = ann ? new Ann() : null;
      const [r, unk] = this.alone(() => this.branch(() => this.apply(list[i], inst, child, ['anyOf', i])));
      if (r.ok && !unk) {
        sure = true;
        if (ann && child) ann.merge(child);
        if (!this.needAnn) break;
      } else if (r.ok) maybe = true;
      else if (!sure && !maybe && r.errs) {
        const score = this.score(r.errs, inst);
        if (!best || score < best.score) best = { errs: r.errs, score };
      }
    }
    // (A maybe-branch's annotations are unknown: the unevaluated* keywords around it can't be trusted.)
    if (maybe && (!sure || ann)) this.unk = true;
    if (sure || maybe) return true;
    this.fail('anyOf', { count: list.length }, inst, 'anyOf', s.kw.get('anyOf'), { sub: best?.errs });
    return false;
  }

  private evOne(s: S, list: S[], inst: JNode, ann: Ann | null): boolean {
    const sure: number[] = [];
    let maybe = 0;
    let match: Ann | null = null;
    let best: { errs: Failure[]; score: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      const child = ann ? new Ann() : null;
      const run = () => this.apply(list[i], inst, child, ['oneOf', i]);
      const [r, unk] = this.alone(() => (sure.length || maybe ? { ok: this.quiet(run), errs: null } : this.branch(run)));
      if (r.ok && !unk) {
        sure.push(i);
        match = child;
        if (sure.length > 1) break;
      } else if (r.ok) maybe++;
      else if (r.errs) {
        const score = this.score(r.errs, inst);
        if (!best || score < best.score) best = { errs: r.errs, score };
      }
    }
    if (sure.length > 1) {
      this.fail('oneOfMany', { a: sure[0], b: sure[1] }, inst, 'oneOf', s.kw.get('oneOf'));
      return false;
    }
    if (!sure.length && !maybe) {
      this.fail('oneOf', { count: list.length }, inst, 'oneOf', s.kw.get('oneOf'), { sub: best?.errs });
      return false;
    }
    if (maybe) this.unk = true;
    else if (ann && match) ann.merge(match);
    return true;
  }
}
