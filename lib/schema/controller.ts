/**
 * The Schema view's state, shared by its schema editor and its results panel (components/SchemaView.tsx): the
 * schema's text and file name (saved in this browser), the options, and when to validate and what to show.
 * No React and no DOM here: the view hands over the editor and what it needs of the page (`SchemaHost`).
 *
 * Each change (either text, an option, closing the view, a new document before its text arrives) starts a new
 * generation; a result is shown only if it belongs to the current one, so a worker reply for older texts never shows
 * as current, and the shown result is marked stale until the current one comes. The document's text comes with which
 * document it is (the engine's docId): it is checked, and its result shown, only while that is still the document,
 * whatever made it another one (an edit, a load, another input format or reading, huge mode).
 */
import type { Outcome } from './client';
import { REMOTE_MAX_COUNT, type FetchFailure, type Fetched } from './remote';
import { DRAFTS, DRAFT_NAME, type Draft } from './drafts';
import type { ValidateRequest, ValidateResult } from './index';

/**
 * Where the schema is saved: `doc`, one record of its text and file name (written whole or not at all); `text` and
 * `file`, the two keys before it, read when there is no record (and removed once one is written).
 */
export const SCHEMA_KEYS = { doc: 'jf:schema-doc', text: 'jf:schema', file: 'jf:schema-file', opts: 'jf:schema-opts' };
/** Texts longer than this aren't saved (as for the main document). */
const MAX_PERSIST = 2_500_000;

/** What the controller needs of the schema editor (the app's editor). */
export interface SchemaEditor {
  readonly text: string;
  readonly length: number;
  /** A new object after every change (compared by identity). */
  readonly version: object;
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
  /** Which document is there now (the engine's docId; -1: none the view can check, a huge file's). */
  docId(): number;
  read(key: string): string | null;
  /** True when stored (a full storage refuses: the key is then removed, see SchemaView's). */
  write(key: string, value: string | null): boolean;
  validator(): { validate(req: ValidateRequest, done: (o: Outcome) => void): void; destroy(): void };
  /** `on`: the document was valid (and the check complete); `level`: its errors. */
  track(feature: 'schema_validate', on: boolean, level: number): void;
  report(e: unknown): void;
  /** Fetches remote schemas (lib/schema/remote.ts fetchSchemas): only ever called when the visitor asks. */
  fetchSchemas(urls: string[], signal: AbortSignal, progress: (done: number) => void): Promise<Fetched[] | null>;
  /** One click's fetch ended: how many were asked for, fetched, and failed (analytics: counts, never URLs). */
  trackFetch(requested: number, fetched: number, failed: number): void;
}

/** Remote schemas (see fetchRemote): what is being fetched, and what couldn't be. */
export interface RemoteState {
  /** Fetching: how many of how many are done. */
  fetching: { done: number; count: number } | null;
  /** URLs that couldn't be fetched, and why (fetched again when asked again). */
  failed: Record<string, FetchFailure>;
  /** The list of URLs the visitor dismissed (joined by spaces): not offered again until another one comes. */
  dismissed: string | null;
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
  remote: RemoteState;
}

/** A schema handed over through the store (lib/engine/store.ts `schemaIn`). */
export interface SchemaIn {
  seq: number;
  text?: string;
  sample?: boolean;
  generate?: boolean;
  /** A link's schema (lib/link.ts): its file name (one fetched by URL), its draft by name and Check formats. */
  name?: string | null;
  draft?: string;
  formats?: boolean;
}

export class SchemaController {
  state: SchemaState;
  ed: SchemaEditor | null = null;
  private ls = new Set<() => void>();
  private host: SchemaHost;
  private client: ReturnType<SchemaHost['validator']> | null = null;
  private doc = '';
  /** The document can't be read as its format: nothing to validate, said so (ValidateRequest.unread). */
  private unread = false;
  /** Which document `doc` is (see SchemaHost.docId). */
  private docOf = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** The panel is open: validation runs (closed, nothing does). */
  private open = false;
  /** A page's sample: while the editor shows it (unnamed), it isn't saved over the visitor's own schema, Undo included. */
  private sample: string | null = null;
  /** The document was edited: a newer text is on its way (setDoc), the shown result is for an older one. */
  private docPending = false;
  private tracked = false;
  private inSeq = 0;
  /** Schemas fetched from the web when the visitor asked, for this tab only (never saved, never in links): URL → text. */
  private fetched = new Map<string, string>();
  /** The same, for requests (a new object only when one more is fetched: the worker isn't sent it again). */
  private resources: Record<string, string> | undefined;
  /** The fetch going on (see fetchRemote): stopped by any change. */
  private fetchStop: AbortController | null = null;
  /** Bumped by every change: a result of an older generation is dropped. */
  private gen = 0;
  /** Replacements of the schema asked for (see ask). */
  private asks = 0;
  /** What the shown result was asked for, and which document that was (see current). */
  private asked: { doc: string; schema: string; id: number } | null = null;

  constructor(host: SchemaHost) {
    this.host = host;
    this.state = { result: null, stale: false, busy: false, outcome: 'ok', ...this.savedOpts(), file: null, blank: true, remote: { fetching: null, failed: {}, dismissed: null } };
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
   * Takes over a new schema editor: the saved schema, then a schema handed over that this controller hasn't had (a
   * page's sample, but not again when coming back from that page; see take). True: generate from the document now.
   */
  attach(ed: SchemaEditor, incoming: SchemaIn | null): boolean {
    this.ed = ed;
    const fresh = incoming && incoming.seq !== this.inSeq ? incoming : null;
    // (A text handed over replaces it; generating starts from it, so Undo gives it back.)
    if (fresh?.text === undefined && !ed.text) {
      const saved = this.saved();
      if (saved.text) ed.init(saved.text);
      this.set({ file: saved.file });
    }
    const generate = fresh ? this.take(fresh) : false;
    this.set({ blank: !ed.length });
    return generate;
  }

  /** The saved schema and its name: the record, else the keys from before it. */
  private saved(): { text: string | null; file: string | null } {
    try {
      const rec = JSON.parse(this.host.read(SCHEMA_KEYS.doc) ?? 'null') as { text?: unknown; file?: unknown } | null;
      if (rec && typeof rec.text === 'string') return { text: rec.text, file: typeof rec.file === 'string' ? rec.file : null };
    } catch {
      /* a broken record: the keys from before */
    }
    return { text: this.host.read(SCHEMA_KEYS.text), file: this.host.read(SCHEMA_KEYS.file) };
  }

  detach() {
    this.gen++;
    this.stopFetch();
    clearTimeout(this.timer);
    clearTimeout(this.busyTimer);
    if (this.persistTimer !== undefined) this.persistNow();
    this.client?.destroy();
    this.client = null;
    this.ed?.destroy();
    this.ed = null;
    this.set({ busy: false });
  }

  /**
   * A schema handed over through the store (a page's sample, one to load, or generating from the document), each one
   * once: the only place they are taken (attach and the view's effect both come here). True: generate now (the view
   * does that).
   */
  take(inc: SchemaIn): boolean {
    if (!this.ed || inc.seq === this.inSeq) return false;
    this.inSeq = inc.seq;
    if (inc.generate) return true;
    if (inc.text === undefined) return false;
    if (inc.sample) {
      this.asks++;
      this.ed.init(inc.text);
      this.sample = inc.text;
      this.set({ file: null, blank: !inc.text });
      this.changed();
    } else {
      this.load(inc.text, inc.name ?? null);
      // (A link says how the schema was checked: its options, the defaults where it names none.)
      if (inc.formats !== undefined) this.setOpts({ draft: DRAFTS.find((d) => DRAFT_NAME[d] === inc.draft) ?? null, formats: inc.formats });
    }
    return false;
  }

  /**
   * A replacement of the schema asked for now that comes later (a file read, the clipboard, generating): it applies
   * only if nothing else was asked for since and the schema wasn't changed meanwhile (see still).
   */
  ask(): { seq: number; ver: object | null } {
    return { seq: ++this.asks, ver: this.ed?.version ?? null };
  }

  /** Whether a replacement asked for (ask) still applies: the last one asked for, over the schema as it was then. */
  still(a: { seq: number; ver: object | null }): boolean {
    return a.seq === this.asks && !!this.ed && this.ed.version === a.ver;
  }

  /** Replaces the schema (one undoable step): a file opened, pasted, generated. It is the visitor's now, saved with its name. */
  load(text: string, name: string | null) {
    const ed = this.ed;
    if (!ed) return;
    // (A replacement now: one asked for before and still on its way no longer applies, even over the same text.)
    this.asks++;
    const before = this.state.file;
    this.set({ file: name });
    ed.setValue(text, 0, false, [before, name]);
    // (setValue reports the change, unless the text was the same: the name still changed.)
    this.changed();
  }

  /** The editor's text changed (typing, a paste, a load, Undo). */
  edited() {
    this.set({ blank: !(this.ed?.length ?? 0) });
    this.changed();
  }

  /** Undo or Redo went past a load: the file name of the text shown now. */
  renamed(name: string | null) {
    this.set({ file: name });
    this.changed();
  }

  /** The document was edited: its new text comes once it is read (setDoc). Until then nothing shows as current. */
  docEdited() {
    // (Closed, nothing shows: opening reads the document as it is then.)
    if (!this.open) return;
    this.docPending = true;
    this.schedule(-1);
  }

  /**
   * The document's text and which document it is, once read (the same text again too: an edit undone). Null text:
   * it can't be read as its format; id -1: not read yet (its text comes later).
   */
  setDoc(text: string | null, id: number) {
    if ((text ?? '') === this.doc && (text === null) === this.unread && id === this.docOf && !this.docPending) return;
    this.docPending = false;
    this.doc = text ?? '';
    this.unread = text === null;
    this.docOf = id;
    this.schedule(this.doc.length < 1_000_000 ? 40 : 150);
  }

  /** The text held is the document there now's (else another is on its way: nothing is checked or shown for it). */
  private docCurrent() {
    return this.docOf !== -1 && this.docOf === this.host.docId();
  }

  setOpen(on: boolean) {
    this.open = on;
    if (!on) this.docPending = false;
    if (on) {
      this.tracked = false;
      this.schedule(0);
    } else {
      this.gen++;
      this.stopFetch();
      clearTimeout(this.timer);
      clearTimeout(this.busyTimer);
      this.set({ busy: false });
      this.host.main()?.setLineMarks(null);
    }
  }

  /**
   * Fetches the remote schemas `urls` name (the result's `remote`), the visitor having asked: those not fetched
   * yet, at most REMOTE_MAX_COUNT, then validates again with them. Nothing of it counts if anything changes meanwhile
   * (the document, the schema, an option, the view closing): the fetch stops and its replies are dropped. What a
   * fetched schema refers to in turn is listed again (fetched when asked again); failures are kept to say why.
   */
  fetchRemote(urls: string[]) {
    const list = [...new Set(urls)].filter((u) => !this.fetched.has(u)).slice(0, REMOTE_MAX_COUNT);
    if (!list.length || !this.open) return;
    this.stopFetch();
    const stop = (this.fetchStop = new AbortController());
    const gen = this.gen;
    const remote = (p: Partial<RemoteState>) => this.set({ remote: { ...this.state.remote, ...p } });
    remote({ fetching: { done: 0, count: list.length } });
    const progress = (done: number) => this.fetchStop === stop && remote({ fetching: { done, count: list.length } });
    void this.host.fetchSchemas(list, stop.signal, progress).then(
      (got) => {
        // (Stopped, or anything changed since: for another schema or document, nothing of it applies.)
        if (this.fetchStop !== stop || gen !== this.gen || !got) return;
        this.fetchStop = null;
        const failed = { ...this.state.remote.failed };
        let ok = 0;
        for (const r of got) {
          if ('text' in r) {
            this.fetched.set(r.url, r.text);
            delete failed[r.url];
            ok++;
          } else failed[r.url] = r.failure;
        }
        this.host.trackFetch(list.length, ok, got.length - ok);
        if (ok) this.resources = Object.fromEntries(this.fetched);
        remote({ fetching: null, failed });
        if (ok) this.schedule(0);
      },
      (e) => {
        if (this.fetchStop !== stop) return;
        this.fetchStop = null;
        this.host.report(e);
        remote({ fetching: null });
      },
    );
  }

  /** Hides the offer to fetch `urls` (until other URLs come). */
  dismissRemote(urls: string[]) {
    this.set({ remote: { ...this.state.remote, dismissed: urls.join(' ') } });
  }

  /** Stops the fetch going on, if any: its replies are dropped. */
  private stopFetch() {
    if (!this.fetchStop) return;
    this.fetchStop.abort();
    this.fetchStop = null;
    this.set({ remote: { ...this.state.remote, fetching: null } });
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

  /**
   * Saves the schema with its file name, as one record: both or neither (a full storage refusing the text never
   * leaves the name with another one). The page's sample, unnamed, is never saved: Undo back to it saves nothing.
   */
  persistNow() {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const ed = this.ed;
    if (!ed) return;
    const text = ed.text;
    const file = this.state.file;
    if (this.sample !== null && text === this.sample && file === null) return;
    const keep = !!text && text.length <= MAX_PERSIST;
    const stored = keep && this.host.write(SCHEMA_KEYS.doc, JSON.stringify({ text, file }));
    // (Stored, or nothing to store: the keys from before go. Refused: they stay, the pair they were.)
    if (stored || !keep) {
      if (!keep) this.host.write(SCHEMA_KEYS.doc, null);
      this.host.write(SCHEMA_KEYS.text, null);
      this.host.write(SCHEMA_KEYS.file, null);
    }
  }

  /** A new generation (the shown result is stale from now on), checked after `ms` (-1: not yet, a text is on its way). */
  private schedule(ms: number) {
    this.gen++;
    this.stopFetch();
    if (this.state.result) this.set({ stale: true });
    clearTimeout(this.timer);
    if (!this.open || ms < 0 || this.docPending) return;
    this.timer = setTimeout(() => this.run(), ms);
  }

  run() {
    const ed = this.ed;
    if (!ed || !this.open || this.docPending) return;
    if (!this.docCurrent()) {
      this.docPending = true;
      return;
    }
    const gen = this.gen;
    const schema = ed.text;
    const doc = this.doc;
    const id = this.docOf;
    const client = (this.client ??= this.host.validator());
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => this.set({ busy: true }), 200);
    const req = { doc, schema, draft: this.state.draft, formats: this.state.formats, max: 1000, ...(this.unread && { unread: true }), ...(this.resources && { resources: this.resources }) };
    client.validate(req, (o: Outcome) => {
      // (Something changed since this was asked: the next run shows its own result. The document isn't the one
      // checked any more, whatever made it another: the new one's text comes, see setDoc.)
      if (gen !== this.gen) return;
      if (!this.docCurrent()) {
        clearTimeout(this.busyTimer);
        this.docPending = true;
        this.gen++;
        this.set({ busy: false, stale: !!this.state.result });
        return;
      }
      clearTimeout(this.busyTimer);
      if (o === 'timeout' || o === 'failed') {
        if (o === 'failed') this.host.report(new Error('Schema validation failed'));
        this.asked = null;
        this.set({ busy: false, stale: false, outcome: o, result: null });
        this.host.main()?.setLineMarks(null);
        ed.setDiagnostics([]);
        return;
      }
      this.asked = { doc, schema, id };
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

  /** The schema and its options for a share link (lib/link.ts): the draft and Check formats only when set. */
  share(): { text: string; draft?: string; formats?: boolean } {
    const { draft, formats } = this.state;
    return { text: this.ed?.text ?? '', ...(draft !== null && { draft: DRAFT_NAME[draft] }), ...(formats && { formats }) };
  }

  /** Whether the shown result is for the document there now (its places in another format: see SchemaView's). */
  current() {
    return !!this.asked && this.asked.id === this.host.docId();
  }

  /** Whether the shown result's locations are in the texts the editors hold now. */
  inDoc() {
    return !!this.asked && this.docMatches(this.asked.doc);
  }

  inSchema() {
    return !!this.asked && this.ed?.text === this.asked.schema;
  }
}

/**
 * The document once read: `doc()` again while its id is -1 (still being read: an edit's analysis on its way), every
 * `ms`, at most `tries` times (then as it is). Generating waits on it rather than call valid JSON unreadable.
 */
export async function readDoc(doc: () => { text: string | null; id: number }, ms = 50, tries = 200) {
  let d = doc();
  for (let i = 0; d.id === -1 && i < tries; i++) {
    await new Promise((r) => setTimeout(r, ms));
    d = doc();
  }
  return d;
}

function lineCount(text: string) {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return n;
}
