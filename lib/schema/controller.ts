/**
 * The Schema view's state, shared by its schema editor and its results panel (components/SchemaView.tsx): the
 * schema's text and file name (saved in this browser), the options, and when to validate and what to show.
 * No React and no DOM here: the view hands over the editor and what it needs of the page (`SchemaHost`).
 *
 * Each change (either text, an option, closing the view) starts a new generation; a result is shown only if it
 * belongs to the current one, so a worker reply for older texts never shows as current.
 */
import type { Outcome } from './client';
import { DRAFTS, type Draft } from './drafts';
import type { ValidateRequest, ValidateResult } from './index';

export const SCHEMA_KEYS = { text: 'jf:schema', file: 'jf:schema-file', opts: 'jf:schema-opts' };
/** Texts longer than this aren't saved (as for the main document). */
const MAX_PERSIST = 2_500_000;

/** What the controller needs of the schema editor (the app's editor). */
export interface SchemaEditor {
  readonly text: string;
  readonly length: number;
  init(text: string): void;
  setValue(next: string, caret?: number, load?: boolean, names?: [string | null, string | null]): void;
  setDiagnostics(list: { p: number; cls: 'me' | 'mw' }[]): void;
  destroy(): void;
}

/** What it needs of the page. */
export interface SchemaHost {
  /** The document editor's text and line tints, when it holds the JSON that was validated (not a converted YAML input). */
  main(): { readonly text: string; readonly length: number; setLineMarks(m: Uint8Array | null): void } | null;
  docIsJson(): boolean;
  read(key: string): string | null;
  write(key: string, value: string | null): void;
  validator(): { validate(req: ValidateRequest, done: (o: Outcome) => void): void; destroy(): void };
  /** `on`: the document was valid (and the check complete); `level`: its errors. */
  track(feature: 'schema_validate', on: boolean, level: number): void;
  report(e: unknown): void;
}

export interface SchemaState {
  result: ValidateResult | null;
  /** The texts and options the result is for no longer match (it shows dimmed until the next one). */
  stale: boolean;
  /** Validating for longer than a moment. */
  busy: boolean;
  outcome: 'ok' | 'timeout' | 'failed';
  /** The draft for a schema without $schema (null: automatic, 2020-12). */
  draft: Draft | null;
  formats: boolean;
  file: string | null;
  /** The schema editor holds no text. */
  blank: boolean;
}

/** A schema handed over through the store (lib/engine/store.ts `schemaIn`). */
export interface SchemaIn {
  seq: number;
  text?: string;
  sample?: boolean;
  generate?: boolean;
}

export class SchemaController {
  state: SchemaState;
  ed: SchemaEditor | null = null;
  private ls = new Set<() => void>();
  private host: SchemaHost;
  private client: ReturnType<SchemaHost['validator']> | null = null;
  private doc = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** The panel is open: validation runs (closed, nothing does). */
  private open = false;
  /** The text is a page's sample nobody replaced: it isn't saved over the visitor's own schema. */
  private sample = false;
  private tracked = false;
  private inSeq = 0;
  /** Bumped by every change: a result of an older generation is dropped. */
  private gen = 0;
  /** What the shown result was asked for. */
  private asked: { doc: string; schema: string } | null = null;

  constructor(host: SchemaHost) {
    this.host = host;
    this.state = { result: null, stale: false, busy: false, outcome: 'ok', ...this.savedOpts(), file: null, blank: true };
  }

  subscribe = (f: () => void) => {
    this.ls.add(f);
    return () => void this.ls.delete(f);
  };
  get = () => this.state;
  private set(p: Partial<SchemaState>) {
    this.state = { ...this.state, ...p };
    for (const f of this.ls) f();
  }

  private savedOpts(): Pick<SchemaState, 'draft' | 'formats'> {
    try {
      const o = JSON.parse(this.host.read(SCHEMA_KEYS.opts) ?? '{}') as { draft?: unknown; formats?: unknown };
      return { draft: DRAFTS.includes(o.draft as Draft) ? (o.draft as Draft) : null, formats: o.formats === true };
    } catch {
      return { draft: null, formats: false };
    }
  }

  /**
   * Takes over a new schema editor: a schema handed over that this controller hasn't had (a page's sample, but not
   * again when coming back from that page), else the saved schema.
   */
  attach(ed: SchemaEditor, incoming: SchemaIn | null) {
    this.ed = ed;
    if (incoming && incoming.seq !== this.inSeq) this.take(incoming);
    else if (!ed.text) {
      this.sample = false;
      const saved = this.host.read(SCHEMA_KEYS.text);
      if (saved) ed.init(saved);
      this.set({ file: this.host.read(SCHEMA_KEYS.file) });
    }
    this.set({ blank: !ed.length });
  }

  detach() {
    this.gen++;
    clearTimeout(this.timer);
    clearTimeout(this.busyTimer);
    if (this.persistTimer !== undefined) this.persistNow();
    this.client?.destroy();
    this.client = null;
    this.ed?.destroy();
    this.ed = null;
    this.set({ busy: false });
  }

  /** A schema handed over through the store: a page's sample, or one to load. True: it wants generating from the document (the view does that). */
  take(inc: SchemaIn): boolean {
    if (!this.ed || inc.seq === this.inSeq) return false;
    this.inSeq = inc.seq;
    if (inc.generate) return true;
    if (inc.text === undefined) return false;
    if (inc.sample) {
      this.ed.init(inc.text);
      this.sample = true;
      this.set({ file: null, blank: !inc.text });
      this.changed();
    } else this.load(inc.text, null);
    return false;
  }

  /** Replaces the schema (one undoable step): a file opened, pasted, generated. It is the visitor's now, saved with its name. */
  load(text: string, name: string | null) {
    const ed = this.ed;
    if (!ed) return;
    const before = this.state.file;
    this.sample = false;
    this.set({ file: name });
    ed.setValue(text, 0, false, [before, name]);
    // (setValue reports the change, unless the text was the same: the name still changed.)
    this.changed();
  }

  /** The editor's text changed: `kind` 'set' is a whole replacement (load, undo), anything else typing or a paste. */
  edited(kind: 'input' | 'paste' | 'set') {
    if (kind !== 'set') this.sample = false;
    this.set({ blank: !(this.ed?.length ?? 0) });
    this.changed();
  }

  /** Undo or Redo went past a load: the file name of the text shown now. */
  renamed(name: string | null) {
    this.set({ file: name });
    this.changed();
  }

  setDoc(text: string) {
    if (text === this.doc) return;
    this.doc = text;
    this.schedule(text.length < 1_000_000 ? 40 : 150);
  }

  setOpen(on: boolean) {
    this.open = on;
    if (on) {
      this.tracked = false;
      this.schedule(0);
    } else {
      this.gen++;
      clearTimeout(this.timer);
      clearTimeout(this.busyTimer);
      this.set({ busy: false });
      this.host.main()?.setLineMarks(null);
    }
  }

  setOpts(p: Partial<Pick<SchemaState, 'draft' | 'formats'>>) {
    this.set(p);
    this.host.write(SCHEMA_KEYS.opts, JSON.stringify({ draft: this.state.draft, formats: this.state.formats }));
    this.schedule(0);
  }

  private changed() {
    const len = this.ed?.length ?? 0;
    this.schedule(len < 100_000 ? 120 : len < 1_000_000 ? 250 : 500);
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), 400);
  }

  /** Saves the schema with its file name (both or neither: the name never goes with another text). */
  persistNow() {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const ed = this.ed;
    if (!ed || this.sample) return;
    const text = ed.text;
    const keep = !!text && text.length <= MAX_PERSIST;
    this.host.write(SCHEMA_KEYS.text, keep ? text : null);
    this.host.write(SCHEMA_KEYS.file, keep ? this.state.file : null);
  }

  private schedule(ms: number) {
    this.gen++;
    if (this.state.result) this.set({ stale: true });
    clearTimeout(this.timer);
    if (!this.open) return;
    this.timer = setTimeout(() => this.run(), ms);
  }

  run() {
    const ed = this.ed;
    if (!ed || !this.open) return;
    const gen = this.gen;
    const schema = ed.text;
    const doc = this.doc;
    const client = (this.client ??= this.host.validator());
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => this.set({ busy: true }), 200);
    const req = { doc, schema, draft: this.state.draft, formats: this.state.formats, max: 1000 };
    client.validate(req, (o: Outcome) => {
      // (Something changed since this was asked: the next run shows its own result.)
      if (gen !== this.gen) return;
      clearTimeout(this.busyTimer);
      if (o === 'timeout' || o === 'failed') {
        if (o === 'failed') this.host.report(new Error('Schema validation failed'));
        this.asked = null;
        this.set({ busy: false, stale: false, outcome: o, result: null });
        this.host.main()?.setLineMarks(null);
        ed.setDiagnostics([]);
        return;
      }
      this.asked = { doc, schema };
      this.set({ result: o, busy: false, stale: false, outcome: 'ok' });
      this.decorate(o, doc, schema);
      if (!this.tracked && o.state === 'ok') {
        this.tracked = true;
        this.host.track('schema_validate', o.valid, o.total);
      }
    });
  }

  /** Squiggles for the schema's problems; the document's lines with errors tinted. */
  private decorate(r: ValidateResult, doc: string, schema: string) {
    const ed = this.ed;
    if (ed && ed.text === schema) {
      const diags: { p: number; cls: 'me' | 'mw' }[] = [];
      if (r.schemaError) diags.push({ p: r.schemaError.loc.p, cls: 'me' });
      for (const p of r.problems.slice(0, 300)) if (p.loc) diags.push({ p: p.loc.p, cls: p.warn ? 'mw' : 'me' });
      ed.setDiagnostics(diags);
    }
    const main = this.host.main();
    if (!main) return;
    if (!r.errors.length || !this.docMatches(doc)) return main.setLineMarks(null);
    const marks = new Uint8Array(lineCount(doc));
    for (const e of r.errors) if (e.loc) marks[e.loc.line - 1] = 2;
    main.setLineMarks(marks);
  }

  /** The main editor holds this text (positions in the document are its positions). */
  private docMatches(doc: string) {
    const main = this.host.main();
    return !!main && this.host.docIsJson() && main.length === doc.length && main.text === doc;
  }

  /** Whether the shown result's locations are in the texts the editors hold now. */
  inDoc() {
    return !!this.asked && this.docMatches(this.asked.doc);
  }

  inSchema() {
    return !!this.asked && this.ed?.text === this.asked.schema;
  }
}

function lineCount(text: string) {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return n;
}
