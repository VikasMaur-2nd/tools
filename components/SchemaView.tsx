'use client';

/**
 * The Schema view: the document in the main editor, its JSON Schema in a second editor (this module's SchemaPane)
 * and the validation in the viewer (the default export). Validation runs in a worker (lib/schema/client.ts) as
 * either text changes. Loaded only when the view opens: no other page or view pays for it.
 *
 * The schema editor is the app's own editor class, taken from the engine's editor (importing it would move it out
 * of the first load's chunks).
 */
import '@/app/schema.css';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { PRIVATE, PRIVATE_LABELS, reportError, track } from '@/lib/analytics';
import type { Editor } from '@/lib/engine/editor';
import { act, getEngine } from '@/lib/engine/instance';
import { store, useUI } from '@/lib/engine/store';
import { useLazyStrings } from '@/lib/i18n/lazy-strings';
import { useT } from '@/lib/i18n/react';
import type { T } from '@/lib/i18n/ui';
import { formatDoc } from '@/lib/json/format';
import { parse } from '@/lib/json/parser';
import { SchemaClient } from '@/lib/schema/client';
import { SchemaController, type SchemaState } from '@/lib/schema/controller';
import { DRAFTS, DRAFT_NAME, type Draft } from '@/lib/schema/drafts';
import type { InstanceError, Loc, Problem, ValidateResult } from '@/lib/schema/index';
import type { Portal } from '@/lib/huge/kit';
import { SAMPLE_DOC, SAMPLE_SCHEMA } from '@/lib/schema/sample';
import { Icon } from './icons';
import { LEVELS, MCheck, MChoice, MItem, MSep, Menu } from './menu';
import { errorText, problemText } from './schema-messages';

const ROW_H = 46;
const OVERSCAN = 6;
const UNITS = { '2': '  ', '4': '    ', tab: '\t' } as const;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
/** True when stored; a value the storage refuses (full) removes the key instead. */
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
    return true;
  } catch {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
    return false;
  }
};

/** The state shared by the schema editor and the panel (lib/schema/controller.ts), on this page. */
const ctl = new SchemaController({
  main: () => getEngine()?.ed ?? null,
  docIsJson: () => store.get().input.format === 'json',
  // (A huge file is no document this view checks.)
  docId: () => (store.get().huge ? -1 : (getEngine()?.docId ?? -1)),
  read,
  write,
  validator: () => new SchemaClient(),
  // (Whether the document was valid, the check complete, and its errors as a number rounded to two digits.)
  track: (feature, on, level) => track('feature_used', { feature, on, level }),
  report: (e) => reportError(e),
});
const toast = (msg: string, kind: 'ok' | 'err' | 'info') => act((e) => e.toast(msg, kind));
const useCtl = () => useSyncExternalStore(ctl.subscribe, ctl.get, ctl.get);
/** The schema editor (the app's editor class: ctl.ed is it). */
const schemaEd = () => ctl.ed as Editor | null;
/** This tool's results host (#view-schema), handed over by JsonTool: what keys move the focus to. */
let resultsHost: HTMLElement | null = null;

function jumpDoc(loc: Loc | null, focus: boolean) {
  const ed = getEngine()?.ed;
  if (!loc || !ed || !ctl.inDoc()) return false;
  if (focus) ed.select(loc.p, loc.e, true);
  else ed.point(loc.p);
  return true;
}

function jumpSchema(loc: Loc | null, focus: boolean) {
  const ed = schemaEd();
  if (!loc || !ed || !ctl.inSchema()) return false;
  if (focus) ed.select(loc.p, loc.e, true);
  else ed.point(loc.p);
  return true;
}

async function generate() {
  track('feature_used', { feature: 'schema_generate' });
  const e = getEngine();
  if (!e) return;
  // (The document now, and which one it is: a schema generated for it replaces nothing if either changes meanwhile.)
  const doc = e.leftDoc();
  if (!doc.text.trim()) return toast('Add a JSON document first', 'info');
  const r = parse(doc.text);
  if (!r.root || r.error) return toast("Can't generate a schema: fix the document's JSON first", 'info');
  const asked = ctl.ask();
  try {
    const { convert } = await import('@/lib/convert');
    if (!ctl.still(asked) || e.docId !== doc.id) return;
    ctl.load(convert(r.root, 'json-schema', { rootName: 'Root' }) + '\n', null);
    toast('Generated a schema from the document. Review it, then edit the rules.', 'ok');
  } catch (e) {
    reportError(e);
  }
}

function example() {
  const e = getEngine();
  if (!e || !ctl.ed) return;
  e.load(SAMPLE_DOC, 'user.json');
  ctl.load(SAMPLE_SCHEMA, 'user.schema.json');
}

function formatSchema() {
  const ed = ctl.ed;
  if (!ed) return;
  const text = ed.text;
  const r = parse(text);
  if (!r.root || r.error) return toast("Can't format it yet. Fix the error first.", 'err');
  const out = formatDoc(text, r, UNITS[store.get().settings.indent]);
  if (out !== text) ed.setValue(out);
}

// ── the schema editor's column ─────────────────────────────────────────────

function DraftPick() {
  const { draft, result } = useCtl();
  const t = useT();
  const fromSchema = result?.draftFrom === 'schema' && result.state !== 'schema-syntax' && result.state !== 'empty-schema';
  if (fromSchema) {
    return (
      <span className={`sch-draft ${PRIVATE}`} data-tip={t('Set by $schema in the schema')}>
        {DRAFT_NAME[result.draft]}
      </span>
    );
  }
  return (
    <label className="pick" data-tip={t('Draft for a schema without $schema')}>
      <span className="sr-only">{t('JSON Schema draft')}</span>
      <select
        value={draft ?? 'auto'}
        onChange={(e) => {
          ctl.setOpts({ draft: e.target.value === 'auto' ? null : (Number(e.target.value) as Draft) });
        }}
      >
        <option value="auto">{t('Auto ({draft})', { draft: '2020-12' })}</option>
        {DRAFTS.map((d) => (
          <option key={d} value={d}>
            {DRAFT_NAME[d]}
          </option>
        ))}
      </select>
      <Icon name="down" size={12} />
    </label>
  );
}

async function pasteSchema() {
  const asked = ctl.ask();
  try {
    const text = await navigator.clipboard.readText();
    if (!ctl.still(asked)) return;
    if (!text) return toast('Your clipboard is empty', 'info');
    ctl.load(text, null);
  } catch {
    schemaEd()?.focus();
    toast(`Press ${store.get().mac ? '⌘' : 'Ctrl+'}V to paste`, 'info');
  }
}

/** Picks a schema file (an input made for it: none waits in the page, where the main Open file's is the only one). */
function pickSchemaFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json,application/schema+json,text/plain';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void openSchemaFile(f);
  };
  input.click();
}

async function openSchemaFile(f: File) {
  const asked = ctl.ask();
  try {
    const text = await f.text();
    // (Read after another file asked for, or a change to the schema since: that one stays.)
    if (ctl.still(asked)) ctl.load(text, f.name);
  } catch {
    toast(`Couldn't read ${f.name}`, 'err');
  }
}

function downloadSchema() {
  const ed = ctl.ed;
  if (!ed) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ed.text], { type: 'application/schema+json' }));
  a.download = ctl.state.file ?? 'schema.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function closeSchema() {
  act((e) => {
    e.setView(store.get().settings.prevView);
    e.focusEditor();
  });
}

const SchemaPane = memo(function SchemaPane({ hidden }: { hidden: boolean }) {
  const t = useT();
  const { file, formats } = useCtl();
  const edRef = useRef<HTMLDivElement>(null);
  const wrap = useUI((s) => s.settings.wrap);
  const indent = useUI((s) => s.settings.indent);
  const incoming = useUI((s) => s.schemaIn);
  // (The editor is made once this tool's engine runs: coming back to a page Next.js kept, this column's effects run
  // before JsonTool's, which makes the engine.)
  const ready = useUI((s) => s.ready);

  useEffect(() => {
    const engine = ready ? getEngine() : null;
    const el = edRef.current;
    if (!engine || !el) return;
    const Ed = Object.getPrototypeOf(engine.ed).constructor as typeof Editor;
    const ed = new Ed(el, {
      change: () => ctl.edited(),
      caret: () => undefined,
      nav: () => undefined,
      escape: () => resultsHost?.querySelector<HTMLElement>('.sch-list, .sch-empty')?.focus(),
      copyAll: () => void navigator.clipboard?.writeText(ed.text).catch(() => undefined),
      renamed: (name) => ctl.renamed(name),
      name: () => ctl.state.file,
    });
    const s = store.get().settings;
    ed.indentUnit = UNITS[s.indent];
    ed.setWrap(s.wrap);
    // (Every new document makes the shown result an older one's until its text is read.)
    const watch = (doc: { text: string; id: number } | null) => (doc ? ctl.setDoc(doc.text, doc.id) : ctl.docEdited());
    engine.docWatch = watch;
    if (ctl.attach(ed, store.get().schemaIn)) void generate();
    return () => {
      if (engine.docWatch === watch) engine.docWatch = null;
      ctl.detach();
    };
  }, [ready]);
  useEffect(() => schemaEd()?.setWrap(wrap), [wrap]);
  useEffect(() => {
    const ed = schemaEd();
    if (ed) ed.indentUnit = UNITS[indent];
  }, [indent]);
  useEffect(() => {
    if (incoming && ctl.take(incoming)) void generate();
  }, [incoming]);
  useEffect(() => {
    if (!hidden) requestAnimationFrame(() => schemaEd()?.render(true));
  }, [hidden]);

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') formatSchema();
    else if (k === 's') downloadSchema();
    else if (k === 'o') pickSchemaFile();
    else return;
    e.preventDefault();
  };

  return (
    <section
      className="pane pane-sch"
      aria-label={t('JSON Schema')}
      hidden={hidden}
      onKeyDown={onKey}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const f = e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        e.stopPropagation();
        store.set({ dragging: false });
        void openSchemaFile(f);
      }}
    >
      <div className="toolbar" role="toolbar" aria-label={t('Schema editor')}>
        <span className={`fname ${PRIVATE}`} title={file ?? undefined}>
          <b className="side-tag">{t('Schema')}</b>
          {file && (
            <>
              <Icon name="file" size={14} />
              {file}
            </>
          )}
        </span>
        <span className="grow" />
        <DraftPick />
        <Menu label="Schema options">
          {(close) => (
            <>
              <MItem label="Paste" onClick={() => void pasteSchema()} close={close} />
              <MItem label="Open file" keys="mod+O" onClick={pickSchemaFile} close={close} />
              <MItem label="Generate from the document" onClick={() => void generate()} close={close} />
              <MItem label="Try an example" onClick={example} close={close} />
              <MItem label="Format" keys="mod+Enter" onClick={formatSchema} close={close} />
              <MSep />
              <MCheck label="Check formats" checked={formats} onClick={() => toggleFormats()} close={close} />
              <MItem label="Collapse all" onClick={() => schemaEd()?.foldLevel(1)} close={close} />
              <MItem label="Expand all" onClick={() => schemaEd()?.unfoldAll()} close={close} />
              <MChoice label="Show levels" options={LEVELS} onPick={(l) => schemaEd()?.foldLevel(l)} close={close} />
              <MSep />
              <MItem label="Download schema" keys="mod+S" onClick={downloadSchema} close={close} />
              <MItem label="Clear" onClick={() => ctl.load('', null)} close={close} />
            </>
          )}
        </Menu>
        <button type="button" className="btn icon" aria-label={t('Close schema')} data-tip={t('Close schema')} onClick={closeSchema}>
          <Icon name="x" />
        </button>
      </div>
      <div className={`ed ${PRIVATE}`} ref={edRef}>
        <div className="ed-gut" aria-hidden="true">
          <div className="ed-gl" />
        </div>
        <div className="ed-body">
          <div className="ed-scope" />
          <div className="ed-cur" />
          <div className="ed-hl" aria-hidden="true" />
          <textarea id="schema-input" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" wrap="off" aria-label={t('JSON Schema')} placeholder={t('Paste a JSON Schema, or generate one from the document…')} />
        </div>
      </div>
    </section>
  );
});

function toggleFormats() {
  const on = !ctl.state.formats;
  track('feature_used', { feature: 'schema_formats', on });
  ctl.setOpts({ formats: on });
}

// ── the validation panel ───────────────────────────────────────────────────

type Row = { kind: 'head'; label: string; count: number } | { kind: 'problem'; p: Problem } | { kind: 'error'; e: InstanceError; depth: number };

function rowsOf(r: ValidateResult | null, filter: string | null, t: T): Row[] {
  if (!r) return [];
  const out: Row[] = [];
  const errors = filter ? r.errors.filter((e) => e.kw === filter) : r.errors;
  if (r.problems.length) {
    out.push({ kind: 'head', label: t('Schema problems'), count: r.problems.length });
    for (const p of r.problems) out.push({ kind: 'problem', p });
  }
  if (errors.length && r.problems.length) out.push({ kind: 'head', label: t('Document errors'), count: filter ? errors.length : r.total });
  const add = (e: InstanceError, depth: number) => {
    out.push({ kind: 'error', e, depth });
    if (e.sub && depth < 3) for (const s of e.sub) add(s, depth + 1);
  };
  for (const e of errors) add(e, 0);
  return out;
}

/** Where an error is, as its second line says it. */
function whereText(e: InstanceError, t: T) {
  const parts: string[] = [];
  if (e.record) parts.push(t('Record {n}', { n: e.record }));
  parts.push(e.pointer || t('(root)'));
  if (e.key && e.code !== 'additionalProperties' && e.code !== 'unevaluatedProperties') parts.push(t('property name'));
  if (e.loc) parts.push(t('Ln {line}, Col {col}', { line: e.loc.line, col: e.loc.col }));
  return parts.join(t(' · '));
}

function describeRow(row: Row, t: T): string {
  if (row.kind === 'head') return `${row.label} (${row.count})`;
  if (row.kind === 'problem') return problemText(row.p.code, row.p.params, t);
  return `${errorText(row.e.code, row.e.params, t)}${t(' · ')}${whereText(row.e, t)}`;
}

const RowView = memo(function RowView({ row, i, sel }: { row: Row; i: number; sel: boolean }) {
  const t = useT();
  const style = { top: i * ROW_H };
  if (row.kind === 'head') {
    return (
      <div className="sch-row sch-headrow" role="presentation" style={style}>
        <b>{row.label}</b>
        <span className={`sch-count ${PRIVATE}`}>{t.num(row.count)}</span>
      </div>
    );
  }
  if (row.kind === 'problem') {
    const p = row.p;
    return (
      <div id={`sch-r${i}`} className={`sch-row${sel ? ' sel' : ''}`} role="option" aria-selected={sel} data-i={i} style={style}>
        <span className={`sch-mark ${p.warn ? 'w' : 'e'}`} aria-hidden="true">
          <Icon name="alert" size={14} />
        </span>
        <span className="sch-main">
          <span className={`sch-msg ${PRIVATE}`}>{problemText(p.code, p.params, t)}</span>
          <span className={`sch-at ${PRIVATE}`}>
            {t(p.warn ? 'Schema warning' : 'Schema error')}
            {p.reached && `${t(' · ')}${t('not applied to the document')}`}
            {p.loc && `${t(' · ')}${t('Ln {line}, Col {col}', { line: p.loc.line, col: p.loc.col })}`}
          </span>
        </span>
      </div>
    );
  }
  const e = row.e;
  return (
    <div id={`sch-r${i}`} className={`sch-row${sel ? ' sel' : ''}${row.depth ? ' sub' : ''}`} role="option" aria-selected={sel} data-i={i} style={{ ...style, paddingLeft: 10 + row.depth * 18 }}>
      <span className="sch-mark e" aria-hidden="true">
        <Icon name="x" size={14} />
      </span>
      <span className="sch-main">
        <span className={`sch-msg ${PRIVATE}`}>{errorText(e.code, e.params, t)}</span>
        <span className={`sch-at ${PRIVATE}`}>{whereText(e, t)}</span>
      </span>
      {e.schemaLoc && (
        <button type="button" className={`sch-kw ${PRIVATE_LABELS}`} data-s={i} tabIndex={-1} data-tip={t('Show in the schema')} aria-label={t('Show {keyword} in the schema', { keyword: e.kw })}>
          <span className={PRIVATE}>{e.kw}</span>
        </button>
      )}
    </div>
  );
});

function Empty({ icon, title, text, children, tone }: { icon: 'braces' | 'alert' | 'check' | 'file'; title: string; text?: ReactNode; children?: ReactNode; tone?: 'ok' | 'err' }) {
  return (
    <div tabIndex={0} className={`sch-empty${tone ? ' ' + tone : ''}`}>
      <Icon name={icon} size={22} />
      <p>
        <b>{title}</b>
        {text && (
          <>
            <br />
            {text}
          </>
        )}
      </p>
      {children}
    </div>
  );
}

function Status({ r, stale, busy, outcome, rows }: { r: ValidateResult | null; stale: boolean; busy: boolean; outcome: SchemaState['outcome']; rows: number }) {
  const t = useT();
  if (outcome === 'timeout') return <span className="sch-state err">{t('Stopped: took too long')}</span>;
  // (The result shown is an older text's: never as the current verdict.)
  if (!r || stale) return <span className="sch-state muted">{busy || stale ? <i className="spin" /> : null}{t(busy || stale ? 'Validating…' : 'Validation')}</span>;
  const problems = r.problems.filter((p) => !p.warn).length;
  if (r.state !== 'ok') return <span className="sch-state muted">{busy && <i className="spin" />}{t('Validation')}</span>;
  // Valid only for a complete check; no errors past a part of the schema that couldn't be applied: not fully checked.
  const open = !r.valid && !r.total;
  return (
    <span className={`sch-state ${r.valid ? 'ok' : open ? 'warn' : 'err'} ${PRIVATE}`}>
      {busy ? <i className="spin" /> : <Icon name={r.valid ? 'check' : open ? 'alert' : 'x'} size={15} />}
      {r.valid ? t('Valid') : open ? t('Not fully checked') : t.n(r.total, '{n} error', '{n} errors')}
      {!open && !r.complete && <span className="sch-sub warn">{t(' · ')}{t('Not fully checked')}</span>}
      {(open || r.complete) && problems > 0 && <span className="sch-sub warn">{t(' · ')}{t.n(problems, '{n} schema problem', '{n} schema problems')}</span>}
      {!r.valid && r.errors.length < r.total && rows > 0 && <span className="sch-sub">{t(' · ')}{t('first {count}', { count: t.num(r.errors.length) })}</span>}
    </span>
  );
}

const Panel = memo(function Panel() {
  const t = useT();
  const { result: r, stale, busy, outcome, formats, blank } = useCtl();
  const huge = useUI((s) => !!s.huge);
  const [filter, setFilter] = useState<string | null>(null);
  const [sel, setSel] = useState(-1);
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(400);
  const listRef = useRef<HTMLDivElement | null>(null);
  const resize = useRef<ResizeObserver | null>(null);
  // (The list comes and goes with the results: its height is watched while it is there.)
  const setList = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el;
    resize.current?.disconnect();
    resize.current = null;
    if (!el) return;
    resize.current = new ResizeObserver(() => setViewH(el.clientHeight || 400));
    resize.current.observe(el);
  }, []);

  useEffect(() => {
    ctl.setOpen(true);
    return () => {
      ctl.setOpen(false);
      resize.current?.disconnect();
    };
  }, []);
  // The document as it is now, with which one it is (then the engine tells of each new one: see SchemaPane). A huge
  // file opened is no document this view checks: what it shows is for the one before, until that comes back.
  useEffect(() => {
    if (huge) return ctl.docEdited();
    const doc = getEngine()?.leftDoc();
    if (doc) ctl.setDoc(doc.text, doc.id);
  }, [huge]);

  const rows = useMemo(() => rowsOf(r, filter, t), [r, filter, t]);
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of r?.errors ?? []) m.set(e.kw, (m.get(e.kw) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [r]);
  const live = r && sel >= 0 && rows[sel] ? describeRow(rows[sel], t) : '';
  // (A filter for a keyword the new result doesn't have is dropped.)
  if (filter && !kinds.some(([k]) => k === filter)) setFilter(null);
  if (sel >= rows.length) setSel(rows.length ? rows.length - 1 : -1);

  const selectable = (i: number) => rows[i] && rows[i].kind !== 'head';
  const select = (i: number, jump: boolean, toSchema = false) => {
    const row = rows[i];
    if (!row || row.kind === 'head') return;
    setSel(i);
    const el = listRef.current;
    if (el) {
      const top = i * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    if (row.kind === 'problem') {
      jumpSchema(row.p.loc, jump);
      return;
    }
    if (toSchema) {
      jumpSchema(row.e.schemaLoc, true);
      return;
    }
    if (!jumpDoc(row.e.loc, jump) && jump) toast('The document changed: wait for the next check', 'info');
  };
  const step = (from: number, d: number) => {
    let i = from;
    for (let k = 0; k < rows.length; k++) {
      i += d;
      if (i < 0 || i >= rows.length) return from;
      if (selectable(i)) return i;
    }
    return from;
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const page = Math.max(1, Math.floor(viewH / ROW_H) - 1);
    let to = -1;
    if (e.key === 'ArrowDown') to = step(sel, 1);
    else if (e.key === 'ArrowUp') to = sel < 0 ? step(-1, 1) : step(sel, -1);
    else if (e.key === 'PageDown') to = step(Math.min(rows.length - 1, Math.max(0, sel) + page) - 1, 1);
    else if (e.key === 'PageUp') to = step(Math.max(0, sel - page) + 1, -1);
    else if (e.key === 'Home') to = step(-1, 1);
    else if (e.key === 'End') to = step(rows.length, -1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (sel >= 0) select(sel, true, e.shiftKey);
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resultsHost?.closest('.pane-view')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
      return;
    }
    if (to < 0) return;
    e.preventDefault();
    select(to, false);
  };

  let empty: ReactNode = null;
  const actions = (
    <span className="sch-acts">
      <button type="button" className="btn sm" onClick={() => void generate()}>
        <Icon name="wand" size={14} />
        {t('Generate from the document')}
      </button>
      <button type="button" className="btn sm" onClick={example}>
        {t('Try an example')}
      </button>
    </span>
  );
  if (outcome === 'timeout') {
    empty = (
      <Empty icon="alert" tone="err" title={t('Validation took too long and was stopped')} text={t('A pattern in the schema may take exponential time on this document. Simplify it, then edit to check again.')}>
        <button type="button" className="btn sm" onClick={() => ctl.run()}>
          {t('Try again')}
        </button>
      </Empty>
    );
  } else if (outcome === 'failed') empty = <Empty icon="alert" tone="err" title={t('Validation failed')} text={t('Edit either document to try again.')} />;
  else if (blank || r?.state === 'empty-schema') {
    empty = (
      <Empty icon="braces" title={t('Validate JSON against a JSON Schema')} text={t('Paste a schema in the middle column. The document on the left is checked as you type.')}>
        <ul>
          <li>{t('Drafts 2020-12, 2019-09, 07, 06 and 04, picked by $schema')}</li>
          <li>{t('Each error with its JSON Pointer, line and column')}</li>
          <li>{t('Exact numbers: multipleOf 0.01 and big integers have no rounding error')}</li>
          <li>{t('Nothing is uploaded, and remote $ref URLs are never fetched')}</li>
        </ul>
        {actions}
      </Empty>
    );
  } else if (!r) empty = null;
  else if (r.state === 'schema-syntax' && r.schemaError) {
    const se = r.schemaError;
    empty = (
      <Empty icon="alert" tone="err" title={t('The schema is not valid JSON')} text={<span className={PRIVATE}>{t('Ln {line}, Col {col}: {msg}', { line: se.loc.line, col: se.loc.col, msg: t.msg(se.msg) })}</span>}>
        <button type="button" className="btn sm" onClick={() => jumpSchema(se.loc, true)}>
          {t('Go to error')}
        </button>
      </Empty>
    );
  } else if (r.state === 'empty-doc') empty = <Empty icon="file" title={t('Add the JSON document on the left to validate it.')} />;
  else if (r.state === 'doc-syntax' && r.docError) {
    const de = r.docError;
    empty = (
      <Empty icon="alert" tone="err" title={t('Fix the JSON document on the left')} text={<span className={PRIVATE}>{t('Ln {line}, Col {col}: {msg}', { line: de.loc.line, col: de.loc.col, msg: t.msg(de.msg) })}</span>}>
        <button type="button" className="btn sm" onClick={() => act((e) => e.gotoError())}>
          {t('Go to error')}
        </button>
      </Empty>
    );
  } else if (r.state === 'too-deep') empty = <Empty icon="alert" tone="err" title={t('Nesting is too deep to validate')} />;
  else if (r.valid && !r.errors.length && !r.problems.length) {
    empty = <Empty icon="check" tone="ok" title={t('Valid')} text={<span className={PRIVATE}>{t('The document matches the schema ({draft}).', { draft: DRAFT_NAME[r.draft] })}</span>} />;
  }

  const notes: string[] = [];
  if (r?.state === 'ok') {
    if (r.records) notes.push(t.n(r.records, 'JSON Lines: {n} record checked one by one', 'JSON Lines: {n} records checked one by one'));
    if (r.loose) notes.push(t('The document is not strict JSON: it was checked as repaired'));
    if (r.valid && r.problems.length) notes.push(t('The document matches the schema ({draft}).', { draft: DRAFT_NAME[r.draft] }));
    if (!r.complete) notes.push(t("Part of the schema couldn't be applied, so the document isn't confirmed valid: see the schema problems marked not applied to the document."));
  }

  const showList = !!r && !empty && rows.length > 0;
  const first = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll + viewH) / ROW_H) + OVERSCAN);
  const items: ReactNode[] = [];
  if (showList) for (let i = first; i < last; i++) items.push(<RowView key={i} row={rows[i]} i={i} sel={i === sel} />);
  const nav = (d: number) => {
    const to = sel < 0 ? step(d > 0 ? -1 : rows.length, d) : step(sel, d);
    select(to, false);
    listRef.current?.focus();
  };

  return (
    <div className={`sch${stale ? ' stale' : ''}`} role="region" aria-label={t('Validation')} aria-busy={stale}>
      <div className="sch-head">
        <Status r={r} stale={stale} busy={busy} outcome={outcome} rows={rows.length} />
        <span className="grow" />
        <button type="button" className="sch-opt sch-fmt" aria-pressed={formats} onClick={toggleFormats} data-tip={t('Check format (email, date-time, uri…): an annotation unless turned on')}>
          <Icon name="check" size={13} />
          {t('Check formats')}
        </button>
        <button type="button" className="btn sm icon" aria-label={t('Previous error')} data-tip={t('Previous')} disabled={!showList} onClick={() => nav(-1)}>
          <Icon name="up" size={15} />
        </button>
        <button type="button" className="btn sm icon" aria-label={t('Next error')} data-tip={t('Next')} disabled={!showList} onClick={() => nav(1)}>
          <Icon name="down" size={15} />
        </button>
      </div>
      {(kinds.length > 1 || notes.length > 0) && r?.state === 'ok' && (
        <div className="sch-opts" role="group" aria-label={t('Show errors by keyword')}>
          {kinds.length > 1 &&
            kinds.map(([kw, count]) => (
              <button key={kw} type="button" className={`sch-opt ${PRIVATE_LABELS}`} aria-pressed={filter === kw} onClick={() => setFilter(filter === kw ? null : kw)} data-tip={t('Show only {keyword} errors', { keyword: kw })}>
                <span className={PRIVATE}>
                  {kw} {t.num(count)}
                </span>
              </button>
            ))}
          {notes.map((n) => (
            <span key={n} className={`sch-note ${PRIVATE}`}>
              {n}
            </span>
          ))}
        </div>
      )}
      <div className="sch-lw">
        {showList && (
          <div
            ref={setList}
            className="sch-list"
            role="listbox"
            aria-label={t('Validation results')}
            aria-activedescendant={sel >= 0 && selectable(sel) ? `sch-r${sel}` : undefined}
            tabIndex={0}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            onKeyDown={onKey}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const kw = target.closest<HTMLElement>('[data-s]');
              const rowEl = target.closest<HTMLElement>('[data-i]');
              // (Text being selected in the list, to copy it, isn't a click on its row.)
              const picked = window.getSelection();
              if (!rowEl || (picked && !picked.isCollapsed && listRef.current?.contains(picked.anchorNode))) return;
              select(Number(rowEl.dataset.i), true, !!kw);
            }}
          >
            <div className="sch-sizer" style={{ height: rows.length * ROW_H }}>
              {items}
            </div>
          </div>
        )}
        {empty}
      </div>
      <div className={`sr-only ${PRIVATE}`} aria-live="polite">
        {live || (r?.state === 'ok' && !stale ? (r.valid ? t('Valid') : r.total ? t.n(r.total, '{n} error', '{n} errors') : t('Not fully checked')) : '')}
      </div>
    </div>
  );
});

/**
 * The view: the schema editor's column where JsonTool puts it, and while open, the results in the viewer's
 * #view-schema (through `portal`, react-dom's createPortal, handed over by JsonTool).
 */
export default function SchemaView({ hidden, portal, host }: { hidden: boolean; portal: Portal; host: RefObject<HTMLDivElement | null> }) {
  // (This tool's own host, by ref: a page Next.js keeps hidden has one too. Loaded after the viewer is on the page.)
  const el = host.current;
  // (A localized page's strings for this view come with it, not with the page: asked for while it is open.)
  useLazyStrings('schema', !hidden);
  useEffect(() => {
    resultsHost = el;
    return () => {
      if (resultsHost === el) resultsHost = null;
    };
  }, [el]);
  return (
    <>
      <SchemaPane hidden={hidden} />
      {!hidden && el && portal(<Panel />, el)}
    </>
  );
}
