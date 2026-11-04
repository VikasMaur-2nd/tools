/**
 * Messages between the page (client.ts) and huge.worker.ts. Every request has an id; its answer has the same
 * id: one reply, or for streamed requests (open, find) several, the last with `done`.
 */
import type { Bytes, FindBatch, FindOptions, HugeLines, HugeLocation, HugeNode, HugeOptions, HugePage, HugeProgress, HugeSummary, Seg } from './types';

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
  | { id: number; op: 'cancel'; target: number };

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
};

export type Reply =
  | { id: number; ok: true; value: Answer[keyof Answer]; done: boolean }
  /** An unexpected failure: `error` is a fixed message (never document content). */
  | { id: number; ok: false; error: string };
