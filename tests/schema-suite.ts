/**
 * Runs JSON-Schema-Test-Suite files (github.com/json-schema-org/JSON-Schema-Test-Suite, MIT) against lib/schema:
 * each test case once per draft it is compatible with, its external schemas as resources (the official meta-schemas
 * that come with the app as the fallback, as the Schema view has them), format-assertion cases with format assertion on.
 * Files are parsed with the app's own lossless parser.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BOOL, OBJ, STR, kids, parse, type JNode } from '../lib/json/parser';
import { Validator } from '../lib/schema/validator';
import type { Draft } from '../lib/schema/drafts';

export const SUITE_DRAFTS: Draft[] = [4, 6, 7, 2019, 2020];

/** The suite's compatibility rule (validation/README.md "Compatibility matching"). */
export function compatible(spec: string | undefined, version: number): boolean {
  if (!spec) return true;
  let ok = true;
  for (const c of spec.split(',')) {
    const m = /^(<=|=)?(\d+)$/.exec(c.trim());
    if (!m) return false;
    const v = Number(m[2]);
    ok = m[1] === '<=' ? version <= v : m[1] === '=' ? version === v : version >= v;
    if (version <= v) break;
  }
  return ok;
}

/** The official meta-schemas that come with the app (lib/schema/meta.ts), by their https and http URLs, as SchemaSession has them. */
export function bundledMeta(): Map<string, JNode> {
  const file = JSON.parse(readFileSync(join(process.cwd(), 'lib/schema/meta/meta-schemas.json'), 'utf8')) as { schemas: Record<string, unknown> };
  const out = new Map<string, JNode>();
  for (const [url, s] of Object.entries(file.schemas)) {
    const root = parse(JSON.stringify(s)).root!;
    out.set(url, root).set(url.replace(/^https:/, 'http:'), root);
  }
  return out;
}

const get = (n: JNode, k: string) => (n.t === OBJ ? kids(n).find((c) => c.key === k) : undefined);

export interface CaseResult {
  draft: Draft;
  file: string;
  /** optional/: not required by the specification; format: a format-assertion case (run with format assertion on). */
  kind: 'required' | 'format' | 'optional';
  case: string;
  test: string;
  expected: boolean;
  got: boolean | 'error';
  error?: string;
}

/** Every test of the `.json` files in `dir` (and its optional/ folder) for every draft. `meta`: the fallback schemas. */
export function runSuite(dir: string, drafts = SUITE_DRAFTS, meta: Map<string, JNode> = bundledMeta()): CaseResult[] {
  const out: CaseResult[] = [];
  const files: [string, boolean][] = [];
  for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) files.push([f, false]);
  if (existsSync(join(dir, 'optional'))) for (const f of readdirSync(join(dir, 'optional')).sort()) if (f.endsWith('.json')) files.push(['optional/' + f, true]);
  for (const [file, optional] of files) {
    const root = parse(readFileSync(join(dir, file), 'utf8')).root!;
    for (const tc of kids(get(root, 'tests')!)) {
      const compat = get(tc, 'compatibility');
      const tags = get(tc, 'tags');
      const tagList = tags ? kids(tags).map((t) => t.v as string) : [];
      const ext = get(tc, 'externalSchemas');
      const resources = new Map<string, JNode>();
      if (ext) for (const m of kids(ext)) resources.set(m.key as string, m);
      const schema = get(tc, 'schema')!;
      for (const draft of drafts) {
        if (!compatible(compat && compat.t === STR ? (compat.v as string) : undefined, draft)) continue;
        let v: Validator | null = null;
        let err = '';
        try {
          v = new Validator(schema, { draft, formats: tagList.includes('format-assertion'), resources, fallback: meta });
        } catch (e) {
          err = String(e);
        }
        for (const t of kids(get(tc, 'tests')!)) {
          const expected = get(t, 'valid')!;
          const kind = optional ? 'optional' : tagList.includes('format-assertion') ? 'format' : 'required';
          const r: CaseResult = { draft, file, kind, case: get(tc, 'description')!.v as string, test: get(t, 'description')!.v as string, expected: expected.t === BOOL && expected.v === true, got: 'error' };
          if (v) {
            try {
              // (Valid means complete as well: a part of the schema left unapplied is no pass.)
              const res = v.validate(get(t, 'data')!);
              r.got = res.valid && res.complete;
              // Tool Kumar's cases may say whether the check is complete too ("complete": false: not fully checked).
              const complete = get(t, 'complete');
              if (complete && complete.t === BOOL && complete.v !== res.complete) {
                r.got = 'error';
                r.error = `complete: ${res.complete}`;
              }
            } catch (e) {
              r.error = String(e);
            }
          } else r.error = err;
          out.push(r);
        }
      }
    }
  }
  return out;
}
