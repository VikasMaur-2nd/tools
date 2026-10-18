/** Exception payloads are rebuilt, never redacted by matching fragments of a message. */
type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError',
  'DOMException', 'AbortError', 'ChunkLoadError', 'QuotaExceededError', 'SecurityError', 'NetworkError',
  'InvalidStateError', 'NotAllowedError', 'NotFoundError', 'TimeoutError', 'DataCloneError',
]);
export const ERROR_MESSAGE = 'Application error. Message removed for privacy.';
export const ERROR_SOURCES = ['unhandled_error', 'unhandled_rejection', 'react_boundary', 'conversion', 'import', 'export', 'worker', 'manual'] as const;
export type ErrorSource = typeof ERROR_SOURCES[number];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const position = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000;

/** Only actual, same-origin application scripts are eligible as stack locations. */
export function applicationScripts(): Set<string> {
  const scripts = new Set<string>();
  for (const el of document.scripts) {
    if (!el.src) continue;
    const url = new URL(el.src);
    if (url.origin === location.origin && url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js')) {
      scripts.add(url.origin + url.pathname);
    }
  }
  return scripts;
}

/**
 * Keep error categories and code coordinates, plus SDK transport/session IDs.
 * Drop every message, raw stack, function name, source context, local variable,
 * breadcrumb and arbitrary property, including any added by a future SDK.
 */
export function exceptionProps(input: RecordValue, scripts: ReadonlySet<string>): RecordValue | null {
  if (!Array.isArray(input.$exception_list) || !input.$exception_list.length) return null;
  const source = ERROR_SOURCES.find((s) => s === input.error_source) ?? 'manual';
  const unhandled = source === 'unhandled_error' || source === 'unhandled_rejection';
  const list = input.$exception_list.slice(0, 5).map((entry) => {
    const e = record(entry);
    const stack = record(e.stacktrace);
    const frames = (Array.isArray(stack.frames) ? stack.frames : []).slice(-50).flatMap((raw) => {
      const frame = record(raw);
      if (typeof frame.filename !== 'string') return [];
      // No query, fragment, eval source, external script, uploaded filename or made-up path.
      const filename = frame.filename.split(/[?#]/)[0];
      if (!scripts.has(filename)) return [];
      return [{
        platform: 'web:javascript', filename, in_app: true,
        ...(position(frame.lineno) ? { lineno: frame.lineno } : {}),
        ...(position(frame.colno) ? { colno: frame.colno } : {}),
        ...(typeof frame.chunk_id === 'string' && UUID.test(frame.chunk_id) ? { chunk_id: frame.chunk_id } : {}),
      }];
    });
    return {
      type: typeof e.type === 'string' && TYPES.has(e.type) ? e.type : 'Error',
      value: ERROR_MESSAGE,
      mechanism: { type: 'generic', handled: !unhandled },
      ...(frames.length ? { stacktrace: { type: 'raw', frames } } : {}),
    };
  });
  const out: RecordValue = { $exception_list: list, $exception_level: 'error', error_source: source, $lib: 'web', $process_person_profile: false };
  // Required for ingestion and for linking an issue to its anonymous session/replay.
  if (typeof input.token === 'string') out.token = input.token;
  for (const k of ['distinct_id', '$device_id', '$session_id', '$window_id', '$release_id']) {
    const v = input[k];
    if (typeof v === 'string' && UUID.test(v.replace(/^\$device:/, ''))) out[k] = v;
  }
  if (typeof input.$lib_version === 'string' && /^\d+\.\d+\.\d+$/.test(input.$lib_version)) out.$lib_version = input.$lib_version;
  return out;
}
