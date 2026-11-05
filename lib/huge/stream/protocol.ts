/**
 * Messages between the page (client.ts) and the stream worker (stream.worker.ts): whole-document commands and
 * passes over a huge file, and decompressing a .gz file. Each request has an id; its replies carry it.
 */
import type { Job, JobResult } from './jobs';
import type { ShapeReport } from './shape';

/** Where a command's output goes. */
export type Out =
  | { kind: 'none' }
  /** A file the user picked (Chromium's save picker). */
  | { kind: 'file'; handle: FileSystemFileHandle; gzip: boolean }
  /** Split: the parts as files in a folder the user picked; `names`: the part's name with {n} for its number. */
  | { kind: 'dir'; handle: FileSystemDirectoryHandle; names: string; gzip: boolean }
  /** A file in OPFS (TEMP_DIR) the page downloads once written. */
  | { kind: 'opfs'; name: string; gzip: boolean }
  /** Split elsewhere: the parts in one zip (OPFS), each gzipped if asked. */
  | { kind: 'zip'; name: string; names: string; gzip: boolean };

export type StreamRequest =
  /** Runs `job` over `file` (its first `skip` bytes before the document: a byte order mark). */
  | { id: number; op: 'run'; file: Blob; skip: number; job: Job; out: Out }
  /** Stops request `target`. */
  | { id: number; op: 'stop'; target: number }
  /**
   * Decompresses a .gz file: kept in memory while at most `limit` bytes (`blob`), else written to OPFS as
   * `name` (`file`).
   */
  | { id: number; op: 'gunzip'; file: Blob; name: string; limit: number };

export type StreamReply =
  /** Bytes read so far of `total` (a gunzip: compressed bytes; `out`: decompressed so far). */
  | { id: number; type: 'progress'; done: number; total: number; out?: number }
  | { id: number; type: 'shape'; report: ShapeReport }
  /** `file`: the OPFS output (to download); a gunzip's `blob` (small) or `file` and its size. */
  | { id: number; type: 'done'; result: JobResult | null; file?: File; blob?: Blob; size?: number }
  /** A fixed message (never document content); `at`: the byte of an invalid document; `parts`: finished parts kept (Split into a folder). */
  | { id: number; type: 'error'; error: string; at: number; parts?: number };

/** Messages a stream error may carry (anything else is sent as 'Command failed'). */
export const KNOWN_ERRORS = new Set([
  'Invalid JSON',
  'Stopped',
  'Not enough storage space',
  'No storage',
  'Nesting is too deep to format',
  'A record is too large to convert',
  'A value is too large to convert',
  'Too many columns for a CSV file',
  'Too many values with dotted names for a CSV file',
  'Split needs an array or JSON Lines',
  'Pick records from an array or JSON Lines',
  'Not a gzip file',
  'Read failed',
  'No output',
]);
