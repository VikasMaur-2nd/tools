/**
 * Messages between the page (client.ts) and huge.worker.ts. Every request has an id; its answer has the same
 * id: one reply, or for streamed requests (open, find) several, the last with `done`.
 */
import type { Bytes, FindBatch, FindOptions, HugeEdited, HugeLines, HugeLocation, HugeNode, HugeOptions, HugePage, HugeProgress, HugeSaved, HugeSummary, Seg } from './types';

export type Request =
  /** Starts indexing `file`: replies with progress (not done), then the summary (done). */
  | { id: number; op: 'open'; file: Blob; options: HugeOptions }
  | { id: number; op: 'summary' }
  | { id: number; op: 'children'; node: HugeNode; from: number; count: number }
  | { id: number; op: 'pretty'; from: number; count: number; indent: string; max: number }
  | { id: number; op: 'prettyClose'; line: number }
  | { id: number; op: 'raw'; from: number; count: number; max: number }
  | { id: number; op: 'locate'; pos: Bytes }
  | { id: number; op: 'resolve'; path: Seg[] }
  | { id: number; op: 'text'; start: Bytes; end: Bytes; max: number }
  /** Replies with batches (not done) until done. */
  | { id: number; op: 'find'; query: string; options: FindOptions }
  /** Stops request `target` (a find): it replies done. */
  | { id: number; op: 'cancel'; target: number }
  /** Stops indexing where it is: open replies done with the summary (stopped); queries see what was read. */
  | { id: number; op: 'stop' }
  /** Never done: the summary (and progress) each time the document is all read again after an edit. */
  | { id: number; op: 'watch' }
  /** Edits (editor.ts), each one undo step; reply: HugeEdited. */
  | { id: number; op: 'edit'; ops: { a: Bytes; b: Bytes; text: string }[]; typing: boolean }
  | { id: number; op: 'setValue'; node: HugeNode; json: string }
  | { id: number; op: 'rename'; parent: HugeNode; index: number; name: string }
  | { id: number; op: 'remove'; parent: HugeNode; index: number }
  | { id: number; op: 'insert'; parent: HugeNode | null; index: number; json: string; name: string | null }
  | { id: number; op: 'duplicate'; parent: HugeNode; index: number }
  | { id: number; op: 'replaceNode'; node: HugeNode; text: string }
  | { id: number; op: 'undo' }
  | { id: number; op: 'redo' }
  /** A node's text for the normal editor (at most `max` bytes, else 'Too big'). */
  | { id: number; op: 'nodeText'; node: HugeNode; max: number }
  /** Bytes [start, end) of the document as a Blob (the file's slices and edits' bytes: nothing copied). */
  | { id: number; op: 'slice'; start: Bytes; end: Bytes }
  /**
   * Writes the document: to `handle`'s file (File System Access: a writable, swapped in at the end; `inPlace`: it's
   * the opened file, which the document then reads), or (no handle) as a Blob to download. Replies with progress, then done.
   */
  | { id: number; op: 'save'; handle: FileSystemFileHandle | null; inPlace: boolean }
  /** Puts back the kept session of this file (summary.session), or drops it. */
  | { id: number; op: 'restoreSession' }
  | { id: number; op: 'dropSession' };

export type Answer = {
  open: HugeProgress | HugeSummary;
  summary: HugeSummary;
  children: HugePage;
  pretty: HugeLines;
  prettyClose: number;
  raw: HugeLines;
  locate: HugeLocation | null;
  resolve: HugeLocation | null;
  text: { text: string; cut: boolean };
  find: FindBatch;
  cancel: null;
  stop: null;
  watch: HugeProgress | HugeSummary;
  edit: HugeEdited;
  setValue: HugeEdited;
  rename: HugeEdited;
  remove: HugeEdited;
  insert: HugeEdited;
  duplicate: HugeEdited;
  replaceNode: HugeEdited;
  undo: HugeEdited;
  redo: HugeEdited;
  nodeText: string;
  slice: Blob;
  save: HugeSaved;
  restoreSession: HugeEdited;
  dropSession: null;
};

export type Reply =
  | { id: number; ok: true; value: Answer[keyof Answer]; done: boolean }
  /** An unexpected failure: `error` is a fixed message (never document content). */
  | { id: number; ok: false; error: string };
