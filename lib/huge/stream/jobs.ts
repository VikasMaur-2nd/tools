/**
 * Huge mode's whole-document commands, each one or two streamed passes (pass.ts) over a scope of the
 * document: Pretty / Minify, JSON Lines, CSV, Extract (records matching a filter, or the first N), Split, and
 * the Shape and Seek passes the Shape panel runs. Run in the stream worker (stream.worker.ts), or in process
 * by tests; output goes to sinks the caller makes (sinks.ts).
 */
import { stringify } from '../../json/format';
import type { JNode } from '../../json/parser';
import { CsvColumns, CsvError, CsvRows, CsvScan, Trees, type CsvOptions } from './csv';
import { matches, type Filter } from './filter';
import { Bytes, type Sink } from './out';
import { pass, type Source } from './pass';
import { Reformat } from './reformat';
import { Seek, type SeekTarget } from './seek';
import { Shape, type ShapeReport } from './shape';
import { ARR, Walker, WalkError, type Visitor } from './walk';

/** Bytes [start, end) of the document (after a byte order mark): one value, or (`multi`) a list of values. */
export interface Scope {
  start: number;
  end: number;
  multi: boolean;
}

export type JobFormat = 'json' | 'jsonl';

export type Job =
  /** Pretty (an indent) or Minify (''): the document, or a value of it, as the Format view writes it. */
  | { kind: 'format'; scope: Scope; indent: string }
  /** JSON Lines: an array's items a line each (toJSONL). */
  | { kind: 'lines'; scope: Scope }
  /** CSV of a container's records (toCsv); with a filter / limit, of the records picked (an array of them). */
  | { kind: 'csv'; scope: Scope; csv: CsvOptions; filter?: Filter | null; limit?: number }
  /** The records of a container (an array, or the list) that match, as a JSON array or JSON Lines. */
  | { kind: 'extract'; scope: Scope; filter: Filter | null; limit?: number; format: JobFormat; indent: string }
  /** The records of a container in parts: `per` records, or about `bytes` bytes, each. */
  | { kind: 'split'; scope: Scope; per?: number; bytes?: number; format: JobFormat; indent: string }
  | { kind: 'shape'; scope: Scope }
  /** Where `target` is from byte `from` on (or how often, `count`). */
  | { kind: 'seek'; scope: Scope; target: SeekTarget; from: number; count?: boolean };

export interface JobResult {
  /** Bytes written (all parts), records written (extract, split, csv rows), parts. */
  bytes: number;
  records: number;
  parts: number;
  shape?: ShapeReport;
  seek?: { found: number; first: number; some: number[] };
}

/** Where a job writes: its one output, or (split) part `k`'s. */
export interface Outputs {
  main(): Promise<Sink>;
  part(k: number): Promise<Sink>;
}

export interface JobHooks {
  /** Bytes read (of `total`: two passes read the scope twice). */
  progress?(done: number, total: number): void;
  /** The Shape panel's live report (about every 400 ms). */
  report?(r: ShapeReport): void;
  stopped?(): boolean;
  chunk?: number;
}

/** What a job can't do (a fixed message for the page: never document content). */
export class JobError extends Error {
  constructor(
    msg: string,
    readonly at = -1,
  ) {
    super(msg);
  }
}

const noSink = (): Outputs => ({
  main: () => Promise.reject(new JobError('No output')),
  part: () => Promise.reject(new JobError('No output')),
});

/** A Trees visitor whose records go through `filter` and `limit` (and are counted). */
class Picked {
  taken = 0;
  done = false;
  constructor(
    private readonly filter: Filter | null | undefined,
    private readonly limit: number | undefined,
    private readonly take: (n: JNode) => void,
  ) {}
  each = (n: JNode) => {
    if (this.limit !== undefined && this.taken >= this.limit) this.done = true;
    if (this.done || !matches(n, this.filter)) return;
    this.take(n);
    this.taken++;
    if (this.limit !== undefined && this.taken >= this.limit) this.done = true;
  };
}

/** Splits a container's records into parts (each a Reformat of its own). */
class Split implements Visitor {
  cur: { out: Bytes; f: Reformat; k: number; n: number } | null = null;
  parts = 0;
  records = 0;
  /** The part that filled up waits to be ended (by the driver, between tokens). */
  ending = false;
  private d = 0;
  constructor(
    private readonly job: Extract<Job, { kind: 'split' }>,
    private readonly walker: () => Walker,
  ) {}

  private record() {
    if (this.cur) return;
    const out = new Bytes();
    const f = new Reformat(out, { indent: this.job.format === 'json' ? this.job.indent : '', lines: this.job.format === 'jsonl' });
    f.open(ARR);
    this.cur = { out, f, k: this.parts++, n: 0 };
  }

  private recorded() {
    const p = this.cur!;
    p.n++;
    this.records++;
    const full = this.job.per ? p.n >= this.job.per : p.out.written >= (this.job.bytes ?? Infinity);
    if (full) {
      this.ending = true;
      this.walker().pause = true;
    }
  }

  open(kind: number) {
    if (this.d++ === 0) {
      if (kind !== ARR) throw new JobError('Split needs an array or JSON Lines');
      return;
    }
    if (this.d === 2) this.record();
    this.cur!.f.open(kind);
  }
  close(kind: number) {
    if (--this.d === 0) return;
    this.cur!.f.close(kind);
    if (this.d === 1) this.recorded();
  }
  key(b: Uint8Array, a: number, e: number, flags: number) {
    this.cur!.f.key(b, a, e, flags);
  }
  part(b: Uint8Array, a: number, e: number, key: boolean) {
    if (this.d === 1 && !key) this.record();
    this.cur!.f.part(b, a, e, key);
  }
  private scalar(write: (f: Reformat) => void) {
    if (this.d === 0) throw new JobError('Split needs an array or JSON Lines');
    const top = this.d === 1;
    if (top) this.record();
    write(this.cur!.f);
    if (top) this.recorded();
  }
  str(b: Uint8Array, a: number, e: number, flags: number) {
    this.scalar((f) => f.str(b, a, e, flags));
  }
  num(b: Uint8Array, a: number, e: number) {
    this.scalar((f) => f.num(b, a, e));
  }
  lit(kind: number, v: boolean) {
    this.scalar((f) => f.lit(kind, v));
  }
}

/** Runs `job` over `src`; output to `outs`. */
export async function runJob(src: Source, job: Job, outs: Outputs = noSink(), hooks: JobHooks = {}): Promise<JobResult> {
  const { scope } = job;
  const size = scope.end - scope.start;
  const result: JobResult = { bytes: 0, records: 0, parts: 0 };
  const opts = (k: number, of: number) => ({
    chunk: hooks.chunk,
    stopped: hooks.stopped,
    progress: (done: number) => hooks.progress?.(k * size + done, of * size),
  });
  const walk = async (v: Visitor, k = 0, of = 1, flush?: () => Promise<void>, done?: () => boolean, parts = false, w?: (w: Walker) => void) => {
    const walker = new Walker(v, { multi: scope.multi, parts });
    w?.(walker);
    try {
      await pass(src, scope.start, scope.end, walker, { ...opts(k, of), flush, done });
    } catch (e) {
      if (e instanceof WalkError) throw new JobError('Invalid JSON', e.at);
      if (e instanceof CsvError) throw new JobError(e.message);
      if (e instanceof RangeError && /too deep/.test(e.message)) throw new JobError('Nesting is too deep to format');
      throw e;
    }
    return walker;
  };
  /** One output: written as the pass goes, committed at the end, dropped on failure. */
  const single = async (run: (out: Bytes, flush: () => Promise<void>) => Promise<void>) => {
    const sink = await outs.main();
    const out = new Bytes();
    const flush = () => out.drain(sink);
    try {
      await run(out, flush);
      await flush();
      await sink.close();
    } catch (e) {
      await sink.abort().catch(() => {});
      throw e;
    }
    result.bytes = out.total;
    result.parts = 1;
  };

  switch (job.kind) {
    case 'format':
    case 'lines':
      await single(async (out, flush) => {
        const f = new Reformat(out, job.kind === 'lines' ? { indent: '', lines: true } : { indent: job.indent });
        const walker = await walk(f, 0, 1, flush, undefined, true);
        f.finish();
        // (Records: a list's values, or an array's items.)
        result.records = scope.multi ? walker.records : walker.rootKind === ARR ? walker.items : 0;
      });
      return result;

    case 'csv':
      await single(async (out, flush) => {
        const scan = new CsvScan(job.csv.flatten);
        const picked = !!job.filter?.conds.length || job.limit !== undefined;
        let plan;
        if (picked) {
          // (Records a filter picks are read whole: the filter looks at them.)
          const p1 = new Picked(job.filter, job.limit, (n) => scan.record(n, ARR));
          const t1 = new Trees(p1.each);
          await walk(t1, 0, 2, undefined, () => p1.done);
          if (t1.rootKind !== ARR) throw new JobError('Pick records from an array or JSON Lines');
          plan = scan.plan(ARR);
        } else {
          // (Every record: its columns from the tokens, no records made.)
          const cols = new CsvColumns(scan);
          await walk(cols, 0, 2);
          plan = scan.plan(scan.rootKind);
        }
        const rows = new CsvRows(plan, out, job.csv);
        const p2 = new Picked(job.filter, job.limit, (n) => rows.record(n));
        await walk(new Trees(p2.each), 1, 2, flush, () => p2.done);
        result.records = rows.rows;
      });
      return result;

    case 'extract':
      await single(async (out, flush) => {
        const pretty = job.format === 'json' && job.indent.length > 0;
        const ind = job.indent;
        if (job.format === 'json') out.byte(91);
        const p = new Picked(job.filter, job.limit, (n) => {
          if (job.format === 'jsonl') {
            out.text(stringify(n, '') + '\n');
            return;
          }
          if (p.taken) out.byte(44);
          if (pretty) out.text('\n' + ind + stringify(n, ind).replace(/\n/g, '\n' + ind));
          else out.text(stringify(n, ''));
        });
        const t = new Trees(p.each);
        await walk(t, 0, 1, flush, () => p.done);
        if (t.rootKind !== ARR) throw new JobError('Pick records from an array or JSON Lines');
        if (job.format === 'json') {
          if (pretty && p.taken) out.byte(10);
          out.byte(93);
        }
        result.records = p.taken;
      });
      return result;

    case 'split': {
      let walker: Walker | null = null;
      const split = new Split(job, () => walker!);
      const sinks = new Map<number, Sink>();
      let written = 0;
      const drain = async (end: boolean) => {
        const p = split.cur;
        if (!p) return;
        let sink = sinks.get(p.k);
        if (!sink) sinks.set(p.k, (sink = await outs.part(p.k)));
        if (end) {
          p.f.close(ARR);
          p.f.finish();
        }
        await p.out.drain(sink);
        if (end) {
          written += p.out.total;
          await sink.close();
          sinks.delete(p.k);
          split.cur = null;
        }
      };
      const flush = async () => {
        await drain(split.ending);
        split.ending = false;
      };
      try {
        await walk(split, 0, 1, flush, undefined, true, (w) => (walker = w));
        await drain(true);
      } catch (e) {
        for (const s of sinks.values()) await s.abort().catch(() => {});
        throw e;
      }
      result.bytes = written;
      result.records = split.records;
      result.parts = split.parts;
      return result;
    }

    case 'shape': {
      const shape = new Shape();
      let walker: Walker | null = null;
      shape.longBytes = () => walker?.longBytes ?? 0;
      let last = 0;
      let read = 0;
      const prog = hooks.progress;
      hooks = {
        ...hooks,
        progress: (done, total) => {
          read = done;
          prog?.(done, total);
          const now = Date.now();
          if (hooks.report && now - last > 400) {
            last = now;
            hooks.report(shape.report(read, size, false));
          }
        },
      };
      await walk(shape, 0, 1, undefined, undefined, false, (w) => (walker = w));
      result.shape = shape.report(size, size, true);
      result.records = result.shape.records;
      return result;
    }

    case 'seek': {
      const seek = new Seek(job.target, job.from, !!job.count);
      await walk(seek, 0, 1, undefined, () => seek.stop, false, (w) => (seek.onStop = () => (w.pause = true)));
      result.seek = { found: seek.found, first: seek.first, some: seek.some };
      return result;
    }
  }
}
