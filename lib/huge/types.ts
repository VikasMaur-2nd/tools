/**
 * What huge-file mode's worker (huge.worker.ts) and the page (client.ts) say to each other: the types of
 * docs/huge-files/API.md. No code here but constants: both sides import it.
 *
 * Positions are byte offsets in the document as stored (UTF-8), after a UTF-8 byte order mark if the file
 * has one (`HugeSummary.bom`): JS numbers, past 2^31 in big files. Lines and columns are as the normal path's
 * status shows them (1-based; UTF-16 units; \r\n, \r and \n each end a line).
 */
import type { SentTape } from '../json/tape';

/** A byte offset in the document. */
export type Bytes = number;

/** A path segment: a property name or an array index (as path.ts Seg). */
export type Seg = string | number;

// Kinds: tape.ts / parser.ts NUL BOOL NUM STR ARR OBJ (0–5), and the virtual list of top-level values.
export const NUL = 0;
export const BOOL = 1;
export const NUM = 2;
export const STR = 3;
export const ARR = 4;
export const OBJ = 5;
/** The top-level values of a JSON Lines document (or any with several), as one list: the normal path wraps them in an array. */
export const LIST = 6;

export interface HugeOptions {
  /** The file's name: `.jsonl` / `.ndjson` are read as JSON Lines, as the normal path reads them (it changes some error messages). */
  name?: string;
  /** Bytes between checkpoints (default 1 MiB): seeks parse at most about this much. */
  every?: number;
  /** Values of at least this many bytes are listed in the directory and paged on their own (default 256 KiB). */
  big?: number;
  /** Check property names for duplicates (default true; bounded: see API.md). */
  dups?: boolean;
}

export interface HugeProgress {
  /** Bytes read so far, of `size`. */
  bytes: Bytes;
  size: Bytes;
  nodes: number;
  /** Top-level values so far. */
  records: number;
  /** Line breaks so far. */
  lines: number;
  ms: number;
}

/** A problem in the document, placed as the normal path's status places it. */
export interface HugeProblem {
  msg: string;
  /** 1-based line and column (UTF-16 units). */
  line: number;
  col: number;
  pos: Bytes;
}

export interface HugeError extends HugeProblem {
  /** 'error': the parser stops there; 'fixable': the first thing a repair fixes (the normal path's status kinds). */
  kind: 'error' | 'fixable';
}

/** A value of the document, without its subtree. */
export interface HugeNode {
  /** NUL…OBJ, or LIST. */
  kind: number;
  /** Its text is [start, end) (LIST: the whole document). */
  start: Bytes;
  end: Bytes;
  /** The root is 0 (in a LIST the records are 0, the LIST is -1). */
  depth: number;
  /** Its name or index in its container; null for a root (and the LIST). */
  key: Seg | null;
  /**
   * Children of a container (0 for anything else). For one still being read (`partial`): the children read so
   * far (the last may be incomplete). null: not known (not read yet).
   */
  count: number | null;
  /** Still being read when this was answered (the indexing front is inside it): `count` is so far, `end` is -1. */
  partial?: boolean;
  /** Its first line in the pretty form (0-based), and how many lines it takes there (null: not known yet). */
  pretty: number;
  prettyLines: number | null;
  /** Its children come from children() (big: in the directory); a small container comes whole in its parent's page. */
  big: boolean;
  /**
   * For a big child in a page (a stub): what its row shows. A container: format.ts preview of its first children
   * (`{id: 1, name: "Ada", …}`); a string: its start, decoded (cut; a long one ends with `…`).
   */
  preview?: string;
}

/** The normal path's status bar for the document (Engine.statusOf, linesStatus), as far as huge mode can tell. */
export interface HugeStatus {
  /** 'valid' (maybe with warnings), 'fixable' (the first issue a repair fixes), 'error'. */
  kind: 'valid' | 'fixable' | 'error';
  /** The message it shows: the first problem, or a valid document's first warning; null if none. */
  msg: string | null;
  line: number;
  col: number;
  pos: Bytes;
  /** Valid: duplicate-name warnings (first 500; `more` past them). */
  warnings: number;
  more: boolean;
  /** Valid JSON Lines: the records (the status bar says "JSON Lines"); else null. */
  jsonl: number | null;
}

export interface HugeSummary {
  size: Bytes;
  /** 3 if the file starts with a UTF-8 byte order mark (positions start after it), else 0. */
  bom: number;
  /** The whole document has been read. Until then, counts are so far and queries see what's read. */
  done: boolean;
  /** Indexing was stopped (stop()): `done` stays false, queries see what was read before. */
  stopped: boolean;
  /** The only top-level value, or the LIST of them (null: none, e.g. an empty file or an error before any). */
  root: HugeNode | null;
  /** Top-level values. */
  records: number;
  /** The top-level values are viewed as an array of them (`root` is the LIST), as the normal path views them: several, or a `.jsonl` / `.ndjson` file. */
  multi: boolean;
  /** JSON Lines: several top-level values, each on lines of its own with only whitespace between (rules.ts jsonLines). */
  jsonl: boolean;
  nodes: number;
  /** Deepest nesting (the root's children are 1). */
  depth: number;
  /** Raw lines (line breaks + 1). */
  lines: number;
  /** Lines of the pretty form (whatever the indent). */
  prettyLines: number;
  /** The first problem (the document is valid up to it; views show what comes before). */
  error: HugeError | null;
  /**
   * What the normal path's status bar would say: the error, or "Multiple top-level values (wrapped in an array)"
   * (fixable, at the second value) for several top-level values in a file not named .jsonl that aren't JSON
   * Lines, or valid (warnings, JSON Lines). null while indexing (not known yet).
   */
  status: HugeStatus | null;
  /** Duplicate property names (first 500). */
  warnings: HugeProblem[];
  moreWarnings: boolean;
  /** Property names the duplicate check couldn't look at (see API.md bounds). */
  unchecked: number;
  ms: number;
  /** Memory the index takes (bytes). */
  indexBytes: number;
  /** Edits (editor.ts): whether the document differs from the file, the edit count (bumped by each edit, undo and redo), whether undo and redo can go, and edits' bytes held (the document's and its history's). */
  edited?: boolean;
  version?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Changes applied since the file was opened or saved in place, as undo counts them (see HugeEdited.steps). */
  steps?: number;
  editBytes?: number;
  /**
   * A kept session of this file (the same name, size, last modified) that can be put back: restoreSession().
   * undefined while it's looked for, null if there's none. The look ends soon after opening; if after `ready`, a
   * summary saying what it found comes through HugeClient.onSummary.
   */
  session?: HugeSession | null;
}

/** A kept session: the changes it puts back (as HugeEdited.steps counts them), edits' bytes, when it was kept (ms since 1970). */
export interface HugeSession {
  steps: number;
  bytes: number;
  time: number;
}

/**
 * After an edit (or undo, redo): the edit count, and whether the document is all read again (`summary` then);
 * if not, reading goes on (progress, then the summary, through HugeClient's `onSummary`).
 */
export interface HugeEdited {
  version: number;
  done: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Changes applied since the file was opened (or saved in place), as undo counts them: +1 an edit or redo, -1 an
   * undo, a typing run joined into one step is one, steps the history let go of (past its bytes) still count; a
   * restored session's own; 0 after saving in place. The file bar's "N changes".
   */
  steps: number;
  summary: HugeSummary | null;
}

/** Saving: bytes written so far (progress), or done (`file`: the file saved in place, now the document's). */
export interface HugeSaved {
  written: Bytes;
  size: Bytes;
  done: boolean;
  /** Downloads (no handle given): the document as a Blob of the file's slices and the edits (nothing copied). */
  blob?: Blob;
}

/**
 * Children [from, from + count) of a container, parsed: a page of the tree, the table or the graph. Small
 * children come whole (their subtrees too); big ones are stubs (see `stubs`), paged on their own.
 */
export interface HugePage {
  container: HugeNode;
  from: number;
  count: number;
  /** More children follow (the page ended at its count or its byte budget). */
  more: boolean;
  /**
   * The children as a tape (tape.ts) over `text`: node 0 is a container of `container`'s kind (an array for
   * the LIST) holding them in order. page.ts makes JNodes of it with the right keys and positions.
   */
  tape: SentTape;
  text: string;
  /** Local node index of a stub (an empty container or string standing for a big child) → that child. */
  stubs: [number, HugeNode][];
  /** Runs of `text` copied from the document: [UTF-16 offset in text, byte, …] pairs (see page.ts byteOf). */
  map: Float64Array;
}

/** Lines of the pretty form or of the text as stored. */
export interface HugeLines {
  from: number;
  /**
   * Each line's text, without its break; one longer than `max` is cut (cut[k] = 1). Raw only: a line that goes on
   * past what's read (the indexing front, a stop, an error) ends there (cut[k] = 2; its length so far), and no line
   * after it is given.
   */
  text: string[];
  cut: Uint8Array;
  /** Full length of each line: UTF-16 units (pretty) or bytes (raw). */
  length: Float64Array;
  /** Pretty: the byte where each line's node starts (a closing line: its container's end - 1). Raw: where each line starts. */
  pos: Float64Array;
  /** Pretty only: nesting depth per line, and per line 0 (a value), 1 (opens a container with children), 2 (closes one). */
  depth?: Int32Array;
  kind?: Uint8Array;
  /** Pretty only: the closing line of each opening line, or -1 (not known here: ask prettyClose). */
  close?: Float64Array;
  /** Lines in all. */
  total: number;
}

export interface HugeLocation {
  path: Seg[];
  node: HugeNode;
  /** Its container (null for a root) and its index there, to page the tree to it. */
  parent: HugeNode | null;
  index: number;
  /** The containers above it, the root (or the LIST) first, its container last, each with its index in its own container (the root: 0). */
  chain: { node: HugeNode; index: number }[];
  /** 1-based line and column of its start (as the status bar shows them). */
  line: number;
  col: number;
}

export interface FindOptions {
  /** Where to start (default 0, or the end when backward). */
  from?: Bytes;
  backward?: boolean;
  /** Letters A–Z match either case unless this (default false). */
  caseSensitive?: boolean;
  /** Stop after this many matches (default 10,000). */
  limit?: number;
}

export interface FindBatch {
  /** Byte offsets of matches (in search order), each `length` bytes long. */
  matches: Float64Array;
  length: number;
  /** Bytes searched so far. */
  scanned: Bytes;
  done: boolean;
}
