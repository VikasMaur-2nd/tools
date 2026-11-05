/*
 * Huge mode's streamed work, page side: the Shape panel's pass and the Convert view's commands (Pretty,
 * Minify, JSON Lines, JSON array, CSV, Split, Extract) over the open file, in the stream worker
 * (lib/huge/stream). Picks what a command reads (the whole file, the selected value, or for CSV the records
 * convert/xlsx.ts `records` would pick), where it writes (Chromium's save or folder picker; elsewhere an OPFS
 * file that is then downloaded, a zip for Split), and publishes progress for components/huge/HugeShape.tsx
 * and HugeCommands.tsx. One command at a time; the Shape pass runs alongside.
 */
import { kids, parse, type JNode } from '../json/parser';
import { records as recordsOf } from '../convert/xlsx';
import { formatPath } from '../json/path';
import { reportError, track } from '../analytics';
import type { Events } from '../analytics/events';
import { CoreSource } from './core-source';
import { PageNodes } from './page';
import { hugeSize, type HugeSession } from './session';
import { ARR, LIST, OBJ, type HugeNode as CoreNode, type HugeSummary } from './types';
import { StreamClient, StreamError, canPick, canPickFolder, freeSpace, hold, removeTemp, sweep, tempName } from './stream/client';
import type { CsvOptions } from './stream/csv';
import { condPath, formValue, type Cond, type Filter, type Op } from './stream/filter';
export { condPath, filterOf, parseCondPath } from './stream/filter';
import type { Job, JobFormat, Scope } from './stream/jobs';
import type { Out } from './stream/protocol';
import { K_OBJ, type ShapeReport } from './stream/shape';
import type { SeekTarget } from './stream/seek';
import { snapshot, SnapshotError, type Snapshot } from './stream/snapshot';

/** A command's scope in a snapshot: its bytes, its path (the selection's), its node and kind, its records. */
interface At {
  scope: Scope;
  path: (string | number)[];
  node: CoreNode | null;
  t: number;
  count: number;
}

export type CommandKind = 'pretty' | 'minify' | 'jsonl' | 'json' | 'csv' | 'split' | 'extract';
export type Target = 'file' | 'value';

export interface CommandSpec {
  kind: CommandKind;
  target: Target;
  /** Pretty, and JSON written by Split / Extract: the indent ('' minified). */
  indent: string;
  gzip: boolean;
  csv?: CsvOptions;
  split?: { by: 'records' | 'mb' | 'parts'; n: number; format: JobFormat };
  extract?: { filter: Filter | null; limit?: number; format: JobFormat | 'csv' };
}

type State = 'idle' | 'running' | 'done' | 'stopped' | 'error';

export interface ShapeUI {
  state: State;
  target: Target;
  /** What it reads: '$' or the selected value's path. */
  label: string;
  report: ShapeReport | null;
  read: number;
  total: number;
  rate: number;
  eta: number | null;
  ms: number;
  error: string | null;
  /** The path whose details show (id), -1: none. */
  sel: number;
  /** A "find next" or count running or done for the selected path. */
  seek: { key: string; busy: boolean; found: number; first: number; count: boolean } | null;
  /** The document's version the shape was read from (-1: none yet): an edit since makes it out of date. */
  version: number;
}

export interface CmdUI {
  state: State;
  /** Runs started (a check waits for its own). */
  seq: number;
  kind: CommandKind | null;
  name: string;
  read: number;
  total: number;
  rate: number;
  eta: number | null;
  ms: number;
  result: { name: string; bytes: number; records: number; parts: number; file: File | null; picked: boolean } | null;
  error: string | null;
  /** Split into a picked folder, stopped or failed: the finished parts it kept there. */
  kept: { parts: number; folder: string } | null;
}

/** A condition as the Extract form holds it (typed text). */
export interface CondUI {
  path: string;
  op: Op;
  value: string;
}

/** The Convert view's form. */
export interface FormUI {
  kind: CommandKind;
  target: Target;
  indent: string;
  gzip: boolean;
  csv: { delimiter: ',' | ';' | '\t'; flatten: 'dot' | 'json'; bom: boolean };
  split: { by: 'records' | 'mb' | 'parts'; n: string; format: JobFormat };
  extract: { conds: CondUI[]; any: boolean; limit: string; format: JobFormat | 'csv' };
}

export interface TaskUI {
  shape: ShapeUI;
  cmd: CmdUI;
  form: FormUI;
  /** The file's index is done and valid: commands may run. */
  ready: boolean;
  /** Chromium's pickers are here (else: downloads). */
  picker: boolean;
  folder: boolean;
}

type Listener = () => void;

export class TaskStore {
  private s: TaskUI;
  private ls = new Set<Listener>();
  constructor(s: TaskUI) {
    this.s = s;
  }
  get = () => this.s;
  subscribe = (f: Listener) => {
    this.ls.add(f);
    return () => void this.ls.delete(f);
  };
  set(patch: Partial<TaskUI>) {
    this.s = { ...this.s, ...patch };
    for (const f of this.ls) f();
  }
  form(patch: Partial<FormUI>) {
    this.set({ form: { ...this.s.form, ...patch } });
  }
  shape(patch: Partial<ShapeUI>) {
    this.set({ shape: { ...this.s.shape, ...patch } });
  }
  cmd(patch: Partial<CmdUI>) {
    this.set({ cmd: { ...this.s.cmd, ...patch } });
  }
}

/** Speed and time left from recent progress samples. */
class Pace {
  private samples: [number, number][] = [];
  rate = 0;
  eta: number | null = null;
  add(done: number, total: number) {
    const now = performance.now();
    this.samples.push([now, done]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 3000) this.samples.shift();
    const [t0, d0] = this.samples[0];
    this.rate = now > t0 + 300 ? ((done - d0) / (now - t0)) * 1000 : this.rate;
    this.eta = this.rate > 0 ? (total - done) / this.rate : null;
  }
}

const stemOf = (name: string) => name.replace(/\.gz$/i, '').replace(/\.(json|jsonl|ndjson|geojson|txt)$/i, '') || 'data';
const lastSeg = (path: (string | number)[]) => (path.length ? String(path[path.length - 1]).replace(/[^\w.-]+/g, '_').slice(0, 40) : '');

/** Output names, as the normal path names its downloads (base.json, base.min.json, base.jsonl, base.csv). */
function nameOf(spec: CommandSpec, file: string, path: (string | number)[]): { name: string; parts?: string } {
  const seg = spec.target === 'value' ? lastSeg(path) : '';
  const base = stemOf(file) + (seg ? '-' + seg : '');
  const gz = spec.gzip ? '.gz' : '';
  switch (spec.kind) {
    case 'pretty':
    case 'json':
      return { name: `${base}.json${gz}` };
    case 'minify':
      return { name: `${base}.min.json${gz}` };
    case 'jsonl':
      return { name: `${base}.jsonl${gz}` };
    case 'csv':
      return { name: `${base}.csv${gz}` };
    case 'extract':
      return { name: `${base}-extract.${spec.extract?.format === 'csv' ? 'csv' : spec.extract?.format === 'jsonl' ? 'jsonl' : 'json'}${gz}` };
    case 'split': {
      const ext = spec.split?.format === 'json' ? 'json' : 'jsonl';
      return { name: `${base}-parts.zip`, parts: `${base}-part-{n}.${ext}${gz}` };
    }
  }
}

const MIME: Record<string, string> = { json: 'application/json', jsonl: 'application/x-ndjson', csv: 'text/csv', zip: 'application/zip', gz: 'application/gzip' };

/** Messages the UI shows for a stream error (fixed text; the i18n dictionary has them). */
export const COMMAND_MESSAGES: Record<string, string> = {
  'Invalid JSON': 'The file has an error: fix it first (see the status bar)',
  'Not enough storage space': 'Not enough free disk space for the result',
  'No storage': 'Your browser won’t let this page store the result (a private window?)',
  'Not ready': 'The file is being read again after an edit: try again once it is',
  Changed: 'The document changed as the command started: try again',
  Saving: 'Wait for the save to finish',
  'Nesting is too deep to format': 'Nesting is too deep to format',
  'A record is too large to convert': 'A record is too large to convert (over 32 MB)',
  'A value is too large to convert': 'A value is too large for a CSV cell',
  'Too many columns for a CSV file': 'Too many columns for a CSV file (over 20,000): pick an array of records',
  'Too many values with dotted names for a CSV file': 'Too many values with dotted names for a CSV file',
  'Split needs an array or JSON Lines': 'Split works on an array or JSON Lines: select one',
  'Pick records from an array or JSON Lines': 'Filters pick records from an array or JSON Lines: select one',
  'Read failed': "Couldn't read the file: it may have changed or moved",
  'Command failed': 'Something went wrong writing the result',
};

export class HugeTasks {
  readonly ui: TaskStore;
  private client: StreamClient | null = null;
  private shapeRun: { stop(): void } | null = null;
  private cmdRun: { stop(): void } | null = null;
  private seekRun: { stop(): void } | null = null;
  /** A command is taking its snapshot (not running yet), and a stop was asked meanwhile. */
  private starting = false;
  private stopAsked = false;
  /** OPFS outputs this tab made (deleted when the file closes, or replaced). */
  private temps = new Map<string, () => void>();
  private stopState: () => void;
  private dead = false;

  constructor(private readonly s: HugeSession) {
    const st = s.src.state();
    this.ui = new TaskStore({
      shape: { state: 'idle', target: 'file', label: '$', report: null, read: 0, total: 0, rate: 0, eta: null, ms: 0, error: null, sel: -1, seek: null, version: -1 },
      cmd: { state: 'idle', seq: 0, kind: null, name: '', read: 0, total: 0, rate: 0, eta: null, ms: 0, result: null, error: null, kept: null },
      form: {
        kind: 'pretty',
        target: 'file',
        indent: s.indent,
        gzip: false,
        csv: { delimiter: ',', flatten: 'dot', bom: false },
        split: { by: 'records', n: '1000000', format: 'jsonl' },
        extract: { conds: [{ path: '', op: 'eq', value: '' }], any: false, limit: '', format: 'jsonl' },
      },
      ready: st.done && !st.error,
      picker: canPick(),
      folder: canPickFolder(),
    });
    this.stopState = s.src.onState((x) => this.ui.get().ready !== (x.done && !x.error) && this.ui.set({ ready: x.done && !x.error }));
    // (Files a closed tab left behind.)
    void sweep();
  }

  /**
   * The Shape panel's "Extract records where…": the Convert form, filled in; `container` (a path) is
   * selected first when the records are an array inside the shape's scope.
   */
  async extractFrom(o: { conds: Cond[]; target: Target; container: (string | number)[] }) {
    let target = o.target;
    if (o.container.length) {
      const base = target === 'value' && this.s.selected ? this.s.selected.path : [];
      await this.s.gotoPath([...base, ...o.container]);
      target = 'value';
    }
    this.prefill({ kind: 'extract', conds: o.conds, target });
    this.s.setView('convert');
  }

  /** The Convert form filled in. */
  prefill(o: { kind: 'extract'; conds: Cond[]; target: Target }) {
    const f = this.ui.get().form;
    const conds = o.conds.map((c): CondUI => ({ path: condPath(c.path), op: c.op, value: formValue(c.value) }));
    this.ui.form({ kind: o.kind, target: o.target, extract: { ...f.extract, conds } });
  }

  /** Works only over the core (a real file). */
  get supported() {
    return this.s.src instanceof CoreSource;
  }

  private get core(): CoreSource {
    return this.s.src as CoreSource;
  }

  private stream(): StreamClient {
    return (this.client ??= new StreamClient());
  }

  destroy() {
    this.dead = true;
    this.stopState();
    this.shapeRun?.stop();
    this.cmdRun?.stop();
    this.seekRun?.stop();
    this.client?.close();
    // (A download may still be reading an output: they go a minute later, or with the tab.)
    const temps = [...this.temps.entries()];
    this.temps.clear();
    setTimeout(() => {
      for (const [name, release] of temps) {
        release();
        void removeTemp(name);
      }
    }, 60_000);
  }

  /** A command's scope: bytes of the snapshot, and what it is. */
  private async scopeIn(s: HugeSummary, target: Target): Promise<At | null> {
    if (target === 'value') {
      const sel = this.s.selected;
      if (sel && sel.path.length) {
        // (Found again by its path, in this version: the place the selection was found at may predate an edit.)
        const loc = await this.core.doc.resolve(sel.path);
        if (!loc) return null;
        const n = loc.node;
        return { scope: { start: n.start, end: n.end, multi: false }, path: sel.path, node: n, t: n.kind === LIST ? ARR : n.kind, count: n.count ?? 0 };
      }
    }
    if (!s.root) return null;
    const multi = s.root.kind === LIST;
    return { scope: { start: 0, end: Math.max(0, s.size - s.bom), multi }, path: [], node: s.root, t: multi ? ARR : s.root.kind, count: s.root.count ?? 0 };
  }

  /**
   * The document now (edited or not) and the command's scope on it, consistently (stream/snapshot.ts): what the
   * command reads. `records`: its scope is the records container (CSV, Extract, Split: as records() picks).
   */
  private take(target: Target, records = false): Promise<Snapshot<At | null>> {
    return snapshot(this.core.doc, async (s, blob) => {
      const at = await this.scopeIn(s, target);
      return at && records ? this.records(at, blob) : at;
    });
  }

  // ── The records CSV reads (xlsx.ts `records`) ─────────────────────────────

  /** Whether the big array `n` has an object among its items (its first page, else a streamed look at `blob`, the snapshot). */
  private async hasObject(n: CoreNode, blob: () => Promise<Blob>): Promise<boolean> {
    const page = await this.core.doc.children(n, 0, 200);
    const v = new PageNodes(page);
    for (const c of v.children) if (c.t === OBJ) return true;
    if (!page.more) return false;
    const run = this.stream().run(await blob(), 0, { kind: 'seek', scope: { start: n.start, end: n.end, multi: false }, target: { path: ['*'], kind: K_OBJ }, from: 0 }, { kind: 'none' });
    return (await run.done).result.seek!.found > 0;
  }

  /** The largest array of objects among `n`'s children and grandchildren (as `records`), or null. */
  private async bestArray(n: CoreNode, blob: () => Promise<Blob>): Promise<{ start: number; end: number; count: number } | null> {
    let best: { start: number; end: number; count: number } | null = null;
    const consider = async (j: JNode, v: PageNodes) => {
      if (j.t !== ARR) return;
      const stub = v.stub(j);
      const count = stub ? (stub.count ?? 0) : kids(j).length;
      if (!count) return;
      const has = stub ? await this.hasObject(stub, blob) : kids(j).some((c) => c.t === OBJ);
      if (!has || (best && count <= best.count)) return;
      const [start, end] = v.span(j);
      best = { start, end, count };
    };
    const pages = async (c: CoreNode, each: (j: JNode, v: PageNodes) => Promise<void>) => {
      for (let from = 0; ; ) {
        const page = await this.core.doc.children(c, from, 1000);
        const v = new PageNodes(page);
        for (const j of v.children) await each(j, v);
        from += page.count;
        if (!page.more || !page.count || this.dead) break;
      }
    };
    await pages(n, async (j, v) => {
      await consider(j, v);
      if (j.t !== OBJ) return;
      const stub = v.stub(j);
      if (stub) await pages(stub, consider);
      else for (const g of kids(j)) await consider(g, v);
    });
    return best;
  }

  /** CSV's container in scope `at`: as the normal path's `records(root)`. */
  private async records(at: At, blob: () => Promise<Blob>): Promise<At> {
    if (at.t !== OBJ) return at;
    // A small object: parsed here, as the normal path would.
    const { start, end } = at.scope;
    if (!at.scope.multi && end - start <= 16 << 20) {
      const { text, cut } = await this.core.doc.text(start, end, 16 << 20);
      const res = cut ? null : parse(text);
      if (!res?.root) return at;
      const rec = recordsOf(res.root);
      if (rec === res.root) return at;
      const enc = new TextEncoder();
      const byteOf = (s: number) => start + enc.encode(text.slice(0, s)).length;
      return { ...at, scope: { start: byteOf(rec.s), end: byteOf(rec.e), multi: false }, t: ARR, count: kids(rec).length };
    }
    if (!at.node) return at;
    const best = await this.bestArray(at.node, blob);
    return best ? { ...at, scope: { start: best.start, end: best.end, multi: false }, t: ARR, count: best.count } : at;
  }

  // ── Shape ─────────────────────────────────────────────────────────────────

  async startShape(target: Target = this.ui.get().shape.target) {
    if (!this.supported) return;
    this.shapeRun?.stop();
    this.seekRun?.stop();
    if (this.saving()) return this.ui.shape({ state: 'error', error: 'Saving', target });
    let snap: Snapshot<At | null>;
    try {
      snap = await this.take(target);
    } catch (e) {
      if (this.dead) return;
      return this.ui.shape({ state: 'error', error: e instanceof SnapshotError ? e.message : 'Command failed', target });
    }
    const at = snap.scope;
    if (this.dead) return;
    if (!at) {
      this.ui.shape({ state: 'error', error: 'Select a value that has been read', target });
      return;
    }
    const label = at.path.length ? formatPath(at.path) : '$';
    const total = at.scope.end - at.scope.start;
    this.ui.shape({ state: 'running', target, label, report: null, read: 0, total, rate: 0, eta: null, ms: 0, error: null, sel: -1, seek: null, version: snap.version });
    const pace = new Pace();
    const began = performance.now();
    const run = this.stream().run(snap.blob, 0, { kind: 'shape', scope: at.scope }, { kind: 'none' }, {
      progress: (done) => {
        pace.add(done, total);
        this.ui.shape({ read: done, rate: pace.rate, eta: pace.eta, ms: performance.now() - began });
      },
      shape: (report) => this.ui.shape({ report }),
    });
    this.shapeRun = run;
    const event = (outcome: Events['huge_shape']['outcome'], paths = 0) =>
      track('huge_shape', { target, outcome, size: hugeSize(this.s.src.size), ms: Math.round(performance.now() - began), paths: paths >= 1000 ? '1k-9.9k' : paths >= 100 ? '100-999' : paths >= 10 ? '10-99' : paths > 0 ? '1-9' : '0' });
    try {
      const { result } = await run.done;
      if (this.dead || this.shapeRun !== run) return;
      this.ui.shape({ state: 'done', report: result.shape!, read: total, ms: performance.now() - began, eta: null });
      event('done', result.shape!.paths.length);
    } catch (e) {
      if (this.dead || this.shapeRun !== run) return;
      const msg = e instanceof StreamError ? e.message : 'Command failed';
      this.ui.shape({ state: msg === 'Stopped' ? 'stopped' : 'error', error: msg === 'Stopped' ? null : msg, eta: null });
      event(msg === 'Stopped' ? 'stopped' : 'error');
      if (!(e instanceof StreamError)) reportError(e, 'huge');
    } finally {
      if (this.shapeRun === run) this.shapeRun = null;
    }
  }

  stopShape() {
    this.shapeRun?.stop();
  }

  selectPath(id: number) {
    this.seekRun?.stop();
    this.ui.shape({ sel: id, seek: null });
  }

  /** The document's version now. */
  private version() {
    return this.s.src.state().edit?.version ?? 0;
  }

  /** Goes to byte `at` of the document (from the shape: not once edited since, when it would be another value's). */
  goto(at: number) {
    const v = this.ui.get().shape.version;
    if (at < 0 || (v >= 0 && v !== this.version())) return;
    track('feature_used', { feature: 'shape_go' });
    void this.s.revealAt(at);
  }

  /**
   * The next place (after the selection, or from `from`) where the selected path has a value of `kind`, or
   * (missing) where an object lacks it; `count`: how many there are in all.
   */
  async seek(target: SeekTarget, count: boolean, from = -1) {
    const sh = this.ui.get().shape;
    if (!sh.report || !this.supported) return;
    this.seekRun?.stop();
    const key = JSON.stringify([target, count]);
    // From just after the selected value (or the last match), so "Next" moves on.
    const start = from >= 0 ? from : (this.s.selected?.node.at ?? -1) + 1;
    let snap: Snapshot<{ at: At; scope: Scope } | null>;
    try {
      snap = await snapshot(this.core.doc, async (s) => {
        const at = await this.scopeIn(s, sh.target);
        if (!at) return null;
        // "Next" in a list of records starts at the record holding the selection (nothing before it is read again).
        let scope = at.scope;
        if (!count && start > scope.start && at.t === ARR) {
          const loc = await this.core.doc.locate(start).catch(() => null);
          const k = loc ? loc.chain.findIndex((c) => (scope.multi ? c.node.kind === LIST : c.node.kind === ARR && c.node.start === scope.start)) : -1;
          const rec = k >= 0 ? (loc!.chain[k + 1]?.node ?? loc!.node) : null;
          if (rec && rec.start > scope.start) scope = { start: rec.start, end: scope.multi ? scope.end : scope.end - 1, multi: true };
        }
        return { at, scope };
      });
    } catch {
      return;
    }
    if (!snap.scope || this.dead) return;
    const { at, scope } = snap.scope;
    this.ui.shape({ seek: { key, busy: true, found: 0, first: -1, count } });
    track('feature_used', { feature: count ? 'shape_count' : 'shape_next' });
    const run = this.stream().run(snap.blob, 0, { kind: 'seek', scope, target, from: count ? 0 : Math.max(0, start), count }, { kind: 'none' });
    this.seekRun = run;
    try {
      const { result } = await run.done;
      if (this.dead || this.seekRun !== run) return;
      let r = result.seek!;
      // (Nothing after it: from the start again.)
      if (!count && r.first < 0 && start > 0) r = (await this.stream().run(snap.blob, 0, { kind: 'seek', scope: at.scope, target, from: 0 }, { kind: 'none' }).done).result.seek!;
      if (this.dead || this.seekRun !== run) return;
      this.ui.shape({ seek: { key, busy: false, found: r.found, first: r.first, count } });
      // (Found in the version the seek read: not shown if an edit landed since.)
      if (!count && r.first >= 0 && snap.version === this.version()) void this.s.revealAt(r.first);
    } catch (e) {
      if (this.dead || this.seekRun !== run) return;
      this.ui.shape({ seek: null });
      if (!(e instanceof StreamError)) reportError(e, 'huge');
    } finally {
      if (this.seekRun === run) this.seekRun = null;
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  /** Where `name` goes: Chromium's picker (asked now, in the click), else an OPFS file to download. */
  private async outFor(spec: CommandSpec, name: string, parts: string | undefined): Promise<{ out: Out; sink: Events['huge_command']['sink']; temp?: string } | null> {
    if (spec.kind === 'split') {
      if (canPickFolder()) {
        const handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: 'tk-huge-split', mode: 'readwrite' });
        return { out: { kind: 'dir', handle, names: parts!, gzip: spec.gzip }, sink: 'folder' };
      }
      const temp = tempName(name.replace(/\.zip$/, ''), 'zip');
      return { out: { kind: 'zip', name: temp, names: parts!, gzip: spec.gzip }, sink: 'zip', temp };
    }
    if (canPick()) {
      const ext = name.split('.').pop()!;
      const handle = await (window as unknown as { showSaveFilePicker(o: object): Promise<FileSystemFileHandle> }).showSaveFilePicker({
        id: 'tk-huge-save',
        suggestedName: name,
        types: [{ description: ext.toUpperCase(), accept: { [MIME[ext] ?? 'application/octet-stream']: ['.' + ext] } }],
      });
      return { out: { kind: 'file', handle, gzip: spec.gzip }, sink: 'picker' };
    }
    const temp = tempName(name, 'tmp');
    return { out: { kind: 'opfs', name: temp, gzip: spec.gzip }, sink: 'download', temp };
  }

  /** The job for `spec` over its scope. */
  private async jobOf(spec: CommandSpec, scope: Scope, total: number): Promise<Job> {
    switch (spec.kind) {
      case 'pretty':
      case 'json':
        return { kind: 'format', scope, indent: spec.indent || '  ' };
      case 'minify':
        return { kind: 'format', scope, indent: '' };
      case 'jsonl':
        return { kind: 'lines', scope };
      case 'csv':
        return { kind: 'csv', scope, csv: spec.csv ?? {} };
      case 'split': {
        const sp = spec.split!;
        const job: Job = { kind: 'split', scope, format: sp.format, indent: spec.indent };
        if (sp.by === 'records') job.per = Math.max(1, Math.floor(sp.n));
        else if (sp.by === 'mb') job.bytes = Math.max(1, sp.n) * 1024 * 1024;
        else job.per = Math.max(1, Math.ceil(total / Math.max(1, Math.floor(sp.n))));
        return job;
      }
      case 'extract': {
        const ex = spec.extract!;
        if (ex.format === 'csv') return { kind: 'csv', scope, csv: spec.csv ?? {}, filter: ex.filter, limit: ex.limit };
        return { kind: 'extract', scope, filter: ex.filter, limit: ex.limit, format: ex.format, indent: spec.indent };
      }
    }
  }

  /** Runs `spec` (from a click: Chromium's picker opens first). */
  async run(spec: CommandSpec) {
    if (!this.supported || this.cmdRun || this.starting) return;
    const ui = this.ui.get();
    if (!ui.ready) return;
    if (this.saving()) {
      this.ui.cmd({ state: 'error', seq: ui.cmd.seq + 1, kind: spec.kind, name: '', result: null, error: 'Saving' });
      return;
    }
    const sel = this.s.selected;
    const { name, parts } = nameOf(spec, this.s.meta.name, spec.target === 'value' && sel ? sel.path : []);
    let where: Awaited<ReturnType<HugeTasks['outFor']>>;
    try {
      where = await this.outFor(spec, name, parts);
    } catch (e) {
      // (The picker closed: nothing to do. Refused, or no storage: said so.)
      if (e instanceof DOMException && e.name === 'AbortError') return;
      this.ui.cmd({ state: 'error', seq: this.ui.get().cmd.seq + 1, kind: spec.kind, name, result: null, error: 'No storage' });
      return;
    }
    if (!where) return;
    const began = performance.now();
    this.ui.cmd({ state: 'running', seq: this.ui.get().cmd.seq + 1, kind: spec.kind, name, read: 0, total: 0, rate: 0, eta: null, ms: 0, result: null, error: null, kept: null });
    const pace = new Pace();
    const event = (outcome: Events['huge_command']['outcome']) =>
      track('huge_command', {
        command: spec.kind,
        target: spec.target,
        outcome,
        sink: where!.sink,
        gzip: spec.gzip,
        size: hugeSize(this.s.src.size),
        ms: Math.round(performance.now() - began),
        filtered: !!spec.extract?.filter?.conds.length,
      });
    const release = where.temp ? hold(where.temp) : null;
    this.starting = true;
    try {
      // The document as it is now: the command writes this version, whatever is edited while it runs.
      // (CSV, Extract and Split read records: of the container records() picks, as the normal path's CSV.)
      const snap = await this.take(spec.target, spec.kind === 'csv' || spec.kind === 'extract' || spec.kind === 'split');
      const at = snap.scope;
      if (!at) throw new StreamError('Select a value that has been read');
      const size = at.scope.end - at.scope.start;
      // Room for an OPFS result: about the size it reads (Pretty: twice), compressed a tenth.
      if (where.temp) {
        const free = await freeSpace();
        const need = (spec.kind === 'pretty' || spec.kind === 'json' ? 2 : 1) * size * (spec.gzip ? 0.15 : 1);
        if (free !== null && free < need) throw new StreamError('Not enough storage space');
      }
      const count = spec.kind === 'split' && spec.split?.by === 'parts' ? at.count : 0;
      const job = await this.jobOf(spec, at.scope, count);
      if (this.stopAsked) throw new StreamError('Stopped');
      const run = this.stream().run(snap.blob, 0, job, where.out, {
        progress: (done, total) => {
          pace.add(done, total);
          this.ui.cmd({ read: done, total, rate: pace.rate, eta: pace.eta, ms: performance.now() - began });
        },
      });
      this.cmdRun = run;
      this.starting = false;
      const { result, file } = await run.done;
      if (this.dead) return;
      let shown: File | null = null;
      if (file && where.temp) {
        // Downloaded from OPFS: the file stays (for "Download again") until the next one or until this closes.
        for (const [n, r] of this.temps) {
          r();
          void removeTemp(n);
        }
        this.temps.clear();
        this.temps.set(where.temp, release!);
        shown = file;
        this.download(file, name);
      } else release?.();
      // (Parts in a folder: named after the first one.)
      const shownName = where.sink === 'folder' && parts ? `${parts.replace('{n}', '0001')} …` : name;
      this.ui.cmd({ state: 'done', ms: performance.now() - began, eta: null, result: { name: shownName, bytes: result.bytes, records: result.records, parts: result.parts, file: shown, picked: !where.temp } });
      event('done');
    } catch (e) {
      release?.();
      if (where.temp) void removeTemp(where.temp);
      if (this.dead) return;
      const msg = e instanceof StreamError || e instanceof SnapshotError ? e.message : 'Command failed';
      // (Split into a picked folder keeps its finished parts: said with the outcome.)
      const kept = where.sink === 'folder' && e instanceof StreamError && e.parts > 0 ? { parts: e.parts, folder: (where.out as { handle?: FileSystemDirectoryHandle }).handle?.name ?? '' } : null;
      this.ui.cmd({ state: msg === 'Stopped' ? 'stopped' : 'error', error: msg === 'Stopped' ? null : msg, eta: null, kept });
      event(msg === 'Stopped' ? 'stopped' : 'error');
      if (!(e instanceof StreamError) && !(e instanceof SnapshotError)) reportError(e, 'huge');
    } finally {
      this.cmdRun = null;
      this.starting = false;
      this.stopAsked = false;
    }
  }

  /** A save is under way: commands wait (a command reads the opened file, which an in-place save replaces). */
  private saving() {
    return !!this.s.ui.get().edit?.saving;
  }

  /** A command or the Shape pass is reading the document (an in-place save waits for it). */
  get busy() {
    return this.starting || !!this.cmdRun || !!this.shapeRun || !!this.seekRun;
  }

  stopCommand() {
    if (this.starting) this.stopAsked = true;
    this.cmdRun?.stop();
  }

  /** Downloads an OPFS result (a disk-backed File: never read into memory). */
  download(file: File, name: string) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // (The download holds the file once it starts; the link can go a while later.)
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
