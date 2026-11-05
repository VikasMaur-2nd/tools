/**
 * What a streamed command reads: the document as it is when the command starts, edited or not, as one Blob (the
 * core's `slice`: the file's slices and the edits' bytes, nothing copied), and the command's scope worked out on
 * that same version. A Blob doesn't change, so edits made while the command runs leave it alone: it writes the
 * version it started on.
 *
 * The version is read before the scope is worked out and again after the document is sliced; if an edit landed
 * in between, it starts over (a few times; then 'Changed').
 */
import type { HugeSummary } from '../types';

/** What a snapshot needs of the core (HugeClient). */
export interface SnapshotCore {
  summary(): Promise<HugeSummary>;
  slice(start: number, end: number): Promise<Blob>;
}

/** A snapshot that can't be taken: a fixed message (see tasks.ts COMMAND_MESSAGES). */
export class SnapshotError extends Error {}

export interface Snapshot<T> {
  /** The document's bytes (after its byte order mark): positions in it are the scope's. */
  blob: Blob;
  summary: HugeSummary;
  version: number;
  scope: T;
}

const versionOf = (s: HugeSummary) => s.version ?? 0;

/**
 * The document now, consistently. `scopeOf(summary, blob)` works out the command's scope on this version (queries
 * to the core it makes are of this version too, unless an edit lands: then all is done again); `blob()` gives
 * the document's bytes early when the scope needs to read them (a streamed look), the same Blob the snapshot keeps.
 */
export async function snapshot<T>(core: SnapshotCore, scopeOf: (s: HugeSummary, blob: () => Promise<Blob>) => Promise<T>, tries = 4): Promise<Snapshot<T>> {
  for (let k = 0; k < tries; k++) {
    const s0 = await core.summary();
    // (Read again after an edit, or still opening: what it is isn't known yet.)
    if (!s0.done) throw new SnapshotError('Not ready');
    if (s0.error) throw new SnapshotError('Invalid JSON');
    const size = Math.max(0, s0.size - s0.bom);
    let taken: Promise<Blob> | null = null;
    const blob = () => (taken ??= core.slice(0, size));
    const scope = await scopeOf(s0, blob);
    const b = await blob();
    const s1 = await core.summary();
    if (versionOf(s1) === versionOf(s0) && s1.done && b.size === size) return { blob: b, summary: s0, version: versionOf(s0), scope };
  }
  throw new SnapshotError('Changed');
}
