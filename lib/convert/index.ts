/**
 * Convert: JSON -> types (TypeScript, Zod, JSON Schema, C#, Dart, Java, Python,
 * Go, Kotlin, Swift, PHP, Rust, Protocol Buffers) and data formats (YAML, XML, TOML, JSON Lines;
 * CSV and Excel are xlsx.ts). Zero dependencies; meant to be lazy-loaded. The
 * targets themselves (labels, extensions…) are lib/engine/targets.ts.
 */
import { tooDeep, type JNode } from '../json/parser';
import type { ConvertOptions } from './infer';
import { toJSONL, toTOML, toXML, toYAML } from './data';
import { toCSharp, toDart, toGo, toJava, toKotlin, toPHP, toPython, toRust, toSwift } from './langs';
import { toProto } from './proto';
import { toJSONSchema, toTypeScript, toZod } from './types';

export type { ConvertOptions } from './infer';
export { codeRows, CSV_START, csvLine, csvScan, highlightCode } from './highlight';

type Emitter = (root: JNode, o: ConvertOptions) => string;

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
  protobuf: toProto,
  yaml: toYAML,
  xml: (r, o) => toXML(r, o.rootName),
  toml: (r, o) => toTOML(r, o.rootName),
  jsonl: toJSONL,
};

const COMMENT: Record<string, string> = { python: '# ', yaml: '# ', toml: '# ', 'json-schema': '', jsonl: '' };

/** Converts a parsed document to `target` (a target id other than CSV and Excel: see xlsx.ts). */
export function convert(root: JNode, target: string, opts: ConvertOptions): string {
  // (Own keys only: "constructor" or "toString" would find Object.prototype's.)
  const f = Object.hasOwn(EMIT, target) ? EMIT[target] : undefined;
  if (!f) throw new Error(`Unknown conversion target "${target}"`);
  const rootName = (opts.rootName || '').trim() || 'Root';
  try {
    return f(root, { ...opts, rootName });
  } catch (e) {
    // Stack overflow (V8 reports it as a SyntaxError when it happens inside a RegExp, Firefox as an InternalError).
    if (!(e instanceof RangeError || tooDeep(e) || (e instanceof SyntaxError && /stack/i.test(e.message)))) throw e;
    const msg = 'The document is nested too deeply to convert.';
    return target === 'xml' ? `<!-- ${msg} -->\n` : `${COMMENT[target] ?? '// '}${msg}\n`;
  }
}
