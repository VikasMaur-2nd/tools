/*
 * Huge-file mode's view of a document: what its views (tree, lines, table, find) read, asynchronously and
 * a window at a time, from a JSON or JSON Lines file bigger than memory.
 *
 * The core implements it over a checkpoint index in a worker (docs/huge-files/API.md); SmallSource
 * (./small-source.ts) implements it over a normally parsed document, so every view can be driven by small
 * files in unit tests and browser checks (localStorage['tk:hugeMin'] forces huge mode, see ./min.ts).
 *
 * Positions are byte offsets in the file (UTF-8; SmallSource: UTF-16 units of its text), plain numbers
 * (beyond 2^31). A read takes an AbortSignal: views drop what scrolled away. Nothing here returns a list
 * proportional to the document: every list is a bounded window the caller asked for.
 */
import type { Kind } from '../json/parser';

export type Seg = string | number;

/** A value in the file. Identified by `at`, its first byte. */
export interface HugeNode {
  /** Offset of the value's first byte (for a member: of its value, not its key). */
  at: number;
  /** Offset just past the value (-1: not indexed that far yet). */
  end: number;
  t: Kind;
  /** Property name (object member), index (array item, JSON Lines record), undefined for the root. */
  key: Seg | undefined;
  /** Position among its parent's items (0 for the root). */
  i: number;
  /** Nesting depth: the root is 0 (for JSON Lines, the virtual list of records). */
  depth: number;
  /** Containers: how many items (so far, while `partial`). 0 for a scalar. */
  count: number;
  /** A container whose end the index hasn't reached yet: `count` is what it has so far. */
  partial?: boolean;
  /**
   * Scalars: the value as shown, a number or literal as written, a string decoded (at most PREVIEW chars,
   * `clipped` then). Containers: a short preview of its first items (`{id: 1, name: "Ada", …}`), or ''.
   */
  text: string;
  /** The text was cut: the whole value is `end - at` bytes. */
  clipped?: boolean;
}

/** Characters of a string a node carries at most (a row shows less). */
export const PREVIEW = 2000;
/** Characters of a table cell's string (all the table draws of it). */
export const CELL = 300;

/** About what holding node `n` costs (its text and name, as UTF-16, and the object): the caches' byte budgets. */
export const nodeBytes = (n: HugeNode) => 96 + 2 * (n.text.length + (typeof n.key === 'string' ? n.key.length : 0));

/** nodeBytes of a table row and its cells. */
export function rowBytes(r: HugeRow): number {
  let b = nodeBytes(r.node);
  if (r.cells) for (const c of r.cells.values()) b += nodeBytes(c) + 32;
  return b;
}

export type LineMode = 'raw' | 'pretty';

/** A line of text: as written in the file (raw) or of the document pretty-printed. */
export interface HugeLine {
  /** Its text, without its line break, at most the `cols` asked for. */
  text: string;
  /** Characters past `text` (cut off: a minified file's one line, a long string). */
  more: number;
  /** The value the line is about (pretty), or the offset the line starts at (raw): what selecting it selects. */
  at: number;
  /** It goes on past where the file is read so far (the indexing front, a stop, the error): more to come. */
  reading?: boolean;
}

export interface HugeError {
  /** The parser's message, as the normal path words it. */
  msg: string;
  /** Byte offset of the error, and its line and column (1-based, columns in characters). */
  at: number;
  line: number;
  col: number;
}

/**
 * The normal path's status: valid (maybe with duplicate-name warnings: `msg` is the first), fixable (the first
 * issue a repair fixes, such as several top-level values in a file that isn't JSON Lines) or an error.
 */
export interface HugeStatus {
  kind: 'valid' | 'fixable' | 'error';
  msg: string | null;
  at: number;
  line: number;
  col: number;
  warnings: number;
  more: boolean;
}

/** How far the index has got. Counts are final once `done`. */
export interface IndexState {
  /** Bytes indexed so far (of the source's `size`). */
  bytes: number;
  done: boolean;
  /** Stopped by `cancel()` at `bytes`: what was indexed can still be browsed. */
  cancelled: boolean;
  /** The first error (indexing stops there; `done` is set): where the readable part ends. */
  error: HugeError | null;
  /** What the normal path's status bar says of the whole document, once it is read (null until then). */
  status: HugeStatus | null;
  /** Several top-level values: shown as a list of them (may turn true while indexing, when a second appears). */
  multi: boolean;
  /** …each on its own line: JSON Lines. */
  jsonl: boolean;
  /** Values, deepest nesting, lines as written and pretty lines counted so far; JSON Lines records. */
  nodes: number;
  depth: number;
  lines: number;
  prettyLines: number;
  records: number;
  /** The document's bytes now (after a byte order mark; edits change it). */
  docSize?: number;
  /** Editing: null for a source that can't edit (see HugeSource.edits). */
  edit?: EditState | null;
}

/** What the document's edits are: as the source last said. */
export interface EditState {
  /** It differs from the file (undoing every edit makes it the file again). */
  edited: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped by each edit, undo, redo and in-place save. */
  version: number;
  /** Changes applied since opened or saved in place, as undo counts them (typing joined: one); the file bar's count. */
  steps: number;
  /** A kept session of this file that can be put back (restoreSession): its steps, bytes, when (ms since 1970). */
  session: { steps: number; bytes: number; time: number } | null;
  /** Edits' bytes held (the document's and its history's). */
  bytes: number;
}

/** After an edit: whether the document is all read again (else it is read on: states follow, then one `done`). */
export interface Edited {
  done: boolean;
  canUndo: boolean;
  canRedo: boolean;
  steps: number;
}

/**
 * Editing (the core's: docs/huge-files/API.md "Editing", "Saving", "Sessions"). Each edit is one undo step; nodes
 * are the views' (from before the edit: re-read after it, positions move). Errors are the core's fixed words:
 * 'Not ready', 'Invalid JSON', 'Not allowed', 'Out of range', 'Too big', 'Save failed', 'Cancelled'.
 */
export interface HugeEdits {
  setValue(node: HugeNode, json: string): Promise<Edited>;
  rename(parent: HugeNode, index: number, name: string): Promise<Edited>;
  remove(parent: HugeNode, index: number): Promise<Edited>;
  /** `parent` null: an empty document's value. An object's child needs `name`. */
  insert(parent: HugeNode | null, index: number, json: string, name: string | null): Promise<Edited>;
  duplicate(parent: HugeNode, index: number): Promise<Edited>;
  /** Bytes [a, b) of the document replaced by `text`; `typing`: joins the last step if it goes on from it. */
  replace(ops: { a: number; b: number; text: string }[], typing: boolean): Promise<Edited>;
  /** A value's text for the normal editor (at most `max` bytes: 'Too big' past it). */
  nodeText(node: HugeNode, max?: number): Promise<string>;
  replaceNode(node: HugeNode, text: string): Promise<Edited>;
  undo(): Promise<Edited>;
  redo(): Promise<Edited>;
  /**
   * Writes the document: into `handle` (`inPlace`: the opened file's own, which the document then reads: no
   * edits, no history), or with no handle as a Blob to download.
   */
  save(handle: FileSystemFileHandle | null, inPlace: boolean, progress: (written: number, size: number) => void): { done: Promise<{ blob: Blob | null }>; stop(): void };
  restoreSession(): Promise<Edited>;
  dropSession(): Promise<void>;
}

/** A table row: an item of an array, and its members if it is an object. */
export interface HugeRow {
  node: HugeNode;
  /** Its first members by name (null: not an object, its value is the row's one cell). */
  cells: Map<string, HugeNode> | null;
}

export interface HugeSource {
  readonly name: string;
  readonly size: number;

  /** The index as it is now. */
  state(): IndexState;
  /** Called as the index advances (a few times a second) and when it ends. Returns an unsubscribe. */
  onState(f: (s: IndexState) => void): () => void;
  /** Stops indexing (browsing what was indexed still works). Absent: indexing can't be stopped, only the file closed. */
  cancel?(): void;
  /** Releases everything (the worker, caches). Resolves once unsaved edits are kept (the core's close). */
  destroy(): Promise<void>;

  /** The root: the document's top value, or for JSON Lines the list of records. Ready once the first window is read. */
  root(signal?: AbortSignal): Promise<HugeNode>;
  /** Items [from, from + n) of container `c` (fewer past its end, or past what is indexed so far). */
  children(c: HugeNode, from: number, n: number, signal?: AbortSignal): Promise<HugeNode[]>;
  /** The nodes from the root down to the one at `path` (null: no such node). */
  resolve(path: Seg[], signal?: AbortSignal): Promise<HugeNode[] | null>;
  /** The nodes from the root down to the innermost value holding offset `at`. */
  locate(at: number, signal?: AbortSignal): Promise<HugeNode[]>;
  /** Items [from, from + n) of array `c` as table rows (each with at most `cols` members). */
  rows(c: HugeNode, from: number, n: number, cols: number, signal?: AbortSignal): Promise<HugeRow[]>;

  /** How many lines there are in `mode` (so far, while indexing). */
  lineCount(mode: LineMode): number;
  /** Lines [from, from + n) in `mode`, each cut to `cols` characters; pretty lines indented with `indent`. */
  lines(mode: LineMode, from: number, n: number, cols: number, indent: string, signal?: AbortSignal): Promise<HugeLine[]>;
  /** The line (0-based) in `mode` that shows offset `at`. */
  lineOf(mode: LineMode, at: number, signal?: AbortSignal): Promise<number>;
  /** The column (string index in its text) of offset `at` on raw line `line`, -1 if not on it (default: `at - line.at`). */
  colOf?(line: HugeLine, at: number): number;
  /** The offset of column `col` on raw line `line` (default: `line.at + col`). */
  atOf?(line: HugeLine, col: number): number;

  /**
   * Streams the offsets where `q` occurs in the file's text, in order, from offset `from`: `hits` gets them
   * in batches, with how far the search has read. Smart case: a query without capitals matches any case.
   * Resolves when the whole file is read or `signal` aborts.
   */
  find(q: string, from: number, hits: (at: number[], read: number) => void, signal: AbortSignal): Promise<void>;

  /** The value's JSON text as written, or null when it is longer than `max` bytes (save it as a file instead). */
  raw(n: HugeNode, max: number, signal?: AbortSignal): Promise<string | null>;
  /** The document's text [a, b) (bytes), at most `max` bytes of it (`cut`: there was more). */
  textAt(a: number, b: number, max: number, signal?: AbortSignal): Promise<{ text: string; cut: boolean }>;
  /** The value's bytes as the document has them (its edits too), for saving it as a file. */
  slice(n: HugeNode): Promise<Blob>;
  /** Editing, if the source can (null: read-only). */
  readonly edits: HugeEdits | null;
}
