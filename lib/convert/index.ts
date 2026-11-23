/**
 * Convert: JSON -> types (TypeScript, Zod, JSON Schema, C#, Dart, Java, Python,
 * Go, Kotlin, Swift, PHP, Rust, Protocol Buffers) and data formats (YAML, XML, TOML, JSON Lines,
 * flat and nested JSON; CSV and Excel are xlsx.ts). Zero dependencies; meant to be lazy-loaded. The
 * targets themselves (labels, extensions…) are lib/engine/targets.ts.
 */
import { tooDeep, type JNode } from '../json/parser';
import type { ConvertOptions } from './infer';
import { toJSONL, toTOML, toXML, toYAML } from './data';
import { flatten, flattenSteps, unflatten, unflattenSteps, type FlatResult } from './flat';
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
  flatten: (r, o) => flat(flatten(r, o.flat, o.lines), o),
  unflatten: (r, o) => flat(unflatten(r, o.flat, o.lines), o),
};

/** Flatten and unflatten say more than their output (a note, or an error instead of it): handed to `o.report`. */
function flat({ text, ...note }: FlatResult, o: ConvertOptions) {
  o.report?.(note);
  return text;
}

const COMMENT: Record<string, string> = { python: '# ', yaml: '# ', toml: '# ', 'json-schema': '', jsonl: '', flatten: '', unflatten: '' };

/** A new task right away (no timer clamping): the page handles input before the next slice. */
const nextTask = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });

/** Main-thread time per slice of a long conversion (ms): short enough that typing stays smooth. */
const SLICE = 8;

/** The page's options: `live`, asked between slices of a long conversion, false once its result isn't wanted. */
type Sliced = ConvertOptions & { live: () => boolean };

/** Flatten and unflatten in slices of about 8 ms with the page free in between; '' once not `live` any more. */
async function sliced(root: JNode, target: string, opts: Sliced): Promise<string> {
  const steps = (target === 'flatten' ? flattenSteps : unflattenSteps)(root, opts.flat, opts.lines);
  let until = performance.now() + SLICE;
  for (;;) {
    const r = steps.next();
    if (r.done) return flat(r.value, opts);
    if (performance.now() < until) continue;
    await nextTask();
    if (!opts.live()) return '';
    until = performance.now() + SLICE;
  }
}

/**
 * Converts a parsed document to `target` (a target id other than CSV and Excel: see xlsx.ts). With `live` (the
 * page), flatten and unflatten run in slices so a big document converts without holding up typing: a promise.
 */
export function convert(root: JNode, target: string, opts: Sliced): string | Promise<string>;
export function convert(root: JNode, target: string, opts: ConvertOptions): string;
export function convert(root: JNode, target: string, opts: ConvertOptions | Sliced): string | Promise<string> {
  if ('live' in opts && (target === 'flatten' || target === 'unflatten')) return sliced(root, target, opts);
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
