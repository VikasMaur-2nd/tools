/**
 * Convert: JSON -> types (TypeScript, Zod, JSON Schema, C#, Dart, Java, Python,
 * Go, Kotlin, Swift, PHP, Rust) and data formats (CSV, YAML, XML, TOML).
 * Zero dependencies; meant to be lazy-loaded.
 */
import type { JNode } from '../json/parser';
import type { ConvertOptions } from './infer';
import { toCSV, toTOML, toXML, toYAML } from './data';
import { toCSharp, toDart, toGo, toJava, toKotlin, toPHP, toPython, toRust, toSwift } from './langs';
import { toJSONSchema, toTypeScript, toZod } from './types';

export type { ConvertOptions } from './infer';
export { highlightCode } from './highlight';

export interface Target {
  id: string;
  label: string;
  group: 'Types' | 'Data';
  ext: string;
  /** Highlighter language for `highlightCode`. */
  lang: string;
}

type Emitter = (root: JNode, o: ConvertOptions) => string;

const T = (id: string, label: string, group: Target['group'], ext: string, lang = id): Target => ({ id, label, group, ext, lang });

export const TARGETS: Target[] = [
  T('typescript', 'TypeScript', 'Types', 'ts'),
  T('zod', 'Zod', 'Types', 'ts', 'typescript'),
  T('json-schema', 'JSON Schema', 'Types', 'json', 'json'),
  T('csharp', 'C#', 'Types', 'cs'),
  T('dart', 'Dart', 'Types', 'dart'),
  T('java', 'Java', 'Types', 'java'),
  T('python', 'Python', 'Types', 'py'),
  T('go', 'Go', 'Types', 'go'),
  T('kotlin', 'Kotlin', 'Types', 'kt'),
  T('swift', 'Swift', 'Types', 'swift'),
  T('php', 'PHP', 'Types', 'php'),
  T('rust', 'Rust', 'Types', 'rs'),
  T('csv', 'CSV', 'Data', 'csv'),
  T('yaml', 'YAML', 'Data', 'yaml'),
  T('xml', 'XML', 'Data', 'xml'),
  T('toml', 'TOML', 'Data', 'toml'),
];

const EMIT: Record<string, Emitter> = {
  typescript: toTypeScript,
  zod: toZod,
  'json-schema': toJSONSchema,
  csharp: toCSharp,
  dart: toDart,
  java: toJava,
  python: toPython,
  go: toGo,
  kotlin: toKotlin,
  swift: toSwift,
  php: toPHP,
  rust: toRust,
  csv: toCSV,
  yaml: toYAML,
  xml: (r, o) => toXML(r, o.rootName),
  toml: (r, o) => toTOML(r, o.rootName),
};

const COMMENT: Record<string, string> = { python: '# ', yaml: '# ', toml: '# ', csv: '', 'json-schema': '' };

/** Converts a parsed document to `target` (a `Target.id`). */
export function convert(root: JNode, target: string, opts: ConvertOptions): string {
  const f = EMIT[target];
  if (!f) throw new Error(`Unknown conversion target "${target}"`);
  const rootName = (opts.rootName || '').trim() || 'Root';
  try {
    return f(root, { ...opts, rootName });
  } catch (e) {
    // Stack overflow (V8 reports it as a SyntaxError when it happens inside a RegExp).
    if (!(e instanceof RangeError || (e instanceof SyntaxError && /stack/i.test(e.message)))) throw e;
    const msg = 'The document is nested too deeply to convert.';
    return target === 'xml' ? `<!-- ${msg} -->\n` : `${COMMENT[target] ?? '// '}${msg}\n`;
  }
}
