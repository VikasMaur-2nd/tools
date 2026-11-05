'use client';

/*
 * Huge mode's Shape panel: the schema of every record of a file too big for the editor, read in one streamed
 * pass (lib/huge/tasks.ts → lib/huge/stream/shape.ts): each path's types with counts, how often it is there
 * and null, ranges, distinct values, the most common ones, examples, and where each first occurs (click to go
 * there, "Next" for the next one, "Count" for how many). Everything it shows is the document's: PRIVATE.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import type { HugeSession } from '@/lib/huge/session';
import type { ShapeUI, TaskStore, TaskUI } from '@/lib/huge/tasks';
import { FORMATS, K_ARR, K_FALSE, K_NULL, K_NUM, K_OBJ, K_STR, K_TRUE, pathText, type ShapePath, type ShapeReport } from '@/lib/huge/stream/shape';
import type { Cond } from '@/lib/huge/stream/filter';

export function useTasks<T>(store: TaskStore, select: (s: TaskUI) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

/** Kinds as the panel names and colours them (the editor's token colours). */
const KIND_NAMES = ['null', 'false', 'true', 'number', 'string', 'array', 'object'];
const KIND_COLOR = ['var(--c-null)', 'var(--c-bool)', 'var(--c-bool)', 'var(--c-num)', 'var(--c-str)', 'var(--c-key)', 'var(--accent)'];
const FORMAT_NAMES: Record<(typeof FORMATS)[number], string> = { date: 'Date', email: 'Email', url: 'URL', uuid: 'UUID', numeric: 'Number as text', empty: 'Empty' };

/** A path's segments for a seek ('*' items); null for merged names (no single name to look for). */
export function segsOf(r: ShapeReport, p: ShapePath): (string | number)[] | null {
  const segs: (string | number)[] = [];
  for (let q: ShapePath | undefined = p; q && q.parent >= 0; q = r.paths[q.parent]) {
    if (q.other) return null;
    segs.push(q.item ? '*' : q.key!);
  }
  return segs.reverse();
}

const pathSegsEqual = (a: (string | number)[] | null, b: (string | number)[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

const pct = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);

function Pct({ v }: { v: number }) {
  const t = useT();
  const s = v >= 99.95 || v === 0 ? t.num(Math.round(v)) : v < 0.1 ? '<0.1' : String(Math.round(v * 10) / 10);
  return <>{s}%</>;
}

/** The kinds of a path as a thin stacked bar. */
function KindBar({ p }: { p: ShapePath }) {
  return (
    <span className="hs-kbar" aria-hidden="true">
      {p.kinds.map((n, k) => (n ? <i key={k} style={{ width: `${pct(n, p.n)}%`, background: KIND_COLOR[k] }} /> : null))}
    </span>
  );
}

/** The kinds as words: "string 98% · null 2%" (booleans together). */
function kindsText(p: ShapePath, t: ReturnType<typeof useT>): string {
  const parts: [string, number][] = [];
  const bool = p.kinds[K_TRUE] + p.kinds[K_FALSE];
  for (const k of [K_STR, K_NUM, K_OBJ, K_ARR, K_NULL]) if (p.kinds[k]) parts.push([t(KIND_NAMES[k]), p.kinds[k]]);
  if (bool) parts.push([t('boolean'), bool]);
  parts.sort((a, b) => b[1] - a[1]);
  if (parts.length === 1) return parts[0][0];
  return parts.map(([name, n]) => `${name} ${Math.round(pct(n, p.n))}%`).join(' · ');
}

/** Short ranges: numbers' min–max, strings' lengths, arrays' items. */
function rangeText(p: ShapePath, t: ReturnType<typeof useT>): string {
  const out: string[] = [];
  if (p.num) out.push(p.num.min === p.num.max ? p.num.minText : `${p.num.minText} … ${p.num.maxText}`);
  if (p.str) out.push(p.str.min === p.str.max ? t('{n} chars', { n: t.num(p.str.min) }) : t('{min}–{max} chars', { min: t.num(p.str.min), max: t.num(p.str.max) }));
  if (p.arr) out.push(p.arr.min === p.arr.max ? t.n(p.arr.min, '{n} item', '{n} items') : t('{min}–{max} items', { min: t.num(p.arr.min), max: t.num(p.arr.max) }));
  return out.join(' · ');
}

const compact = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : String(n));

/** A row's label: its member name, "items" for an array's items, "other names" for a map's. */
function Label({ p }: { p: ShapePath }) {
  const t = useT();
  if (p.parent < 0) return <span className="hs-root">$</span>;
  if (p.item) return <span className="hs-items">[ ] {t('items')}</span>;
  if (p.other) return <span className="hs-items">{t('other names')}</span>;
  return <span className="hs-key">{p.key === '' ? '""' : p.key}</span>;
}

interface Row {
  p: ShapePath;
  kids: number;
}

/** The rows shown: the path tree in order, closed paths' children left out, or every path that matches `q`. */
function rowsOf(r: ShapeReport, closed: Set<number>, q: string): Row[] {
  const kids = new Map<number, number[]>();
  for (const p of r.paths) if (p.parent >= 0) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)!).push(p.id);
  const out: Row[] = [];
  const query = q.trim().toLowerCase();
  if (query) {
    for (const p of r.paths) if (pathText(r, p).toLowerCase().includes(query)) out.push({ p, kids: kids.get(p.id)?.length ?? 0 });
    return out;
  }
  const visit = (id: number) => {
    const p = r.paths[id];
    const k = kids.get(id) ?? [];
    out.push({ p, kids: k.length });
    if (!closed.has(id)) for (const c of k) visit(c);
  };
  visit(0);
  return out;
}

function Status({ sh, records }: { sh: ShapeUI; records: number }) {
  const t = useT();
  const paths = sh.report?.paths.length ?? 0;
  if (sh.state === 'running') {
    return (
      <span className={`hs-status ${PRIVATE}`} aria-live="polite">
        <i className="spin" />
        {t('Reading {done} of {size}', { done: t.bytes(sh.read), size: t.bytes(sh.total) })}
        {sh.rate > 0 && <span className="muted"> · {t('{rate}/s', { rate: t.bytes(sh.rate) })}</span>}
        {sh.eta !== null && sh.eta >= 1 && <span className="muted"> {t('· ~{time} left', { time: t.dur(Math.ceil(sh.eta)) })}</span>}
      </span>
    );
  }
  if (sh.state === 'error') {
    // (An error in the file: what was read before it stays shown.)
    if (sh.error === 'Invalid JSON' && sh.report) return <span className="hs-status warn">{t('The file has an error: the shape shows what comes before it')}</span>;
    return <span className="hs-status err">{t(sh.error ?? 'Something went wrong')}</span>;
  }
  if (!sh.report) return null;
  return (
    <span className={`hs-status ${PRIVATE}`} aria-live="polite">
      {records > 0 && <>{t.n(records, '{n} record', '{n} records')} · </>}
      {t.n(paths, '{n} path', '{n} paths')}
      {sh.state === 'stopped' && <span className="warn"> · {t('stopped at {done} of {size}', { done: t.bytes(sh.read), size: t.bytes(sh.total) })}</span>}
      {sh.state === 'done' && <span className="muted"> · {t('read in {time}', { time: t.dur(Math.max(1, Math.round(sh.ms / 1000))) })}</span>}
      {(sh.report.dropped > 0 || sh.report.paths.some((p) => p.manyKeys)) && <span className="muted"> · {t('some names merged')}</span>}
    </span>
  );
}

export default function ShapeView({ s, hidden }: { s: HugeSession; hidden: boolean }) {
  const tasks = s.tasks;
  const sh = useTasks(tasks.ui, (u) => u.shape);
  const hasSel = useSyncExternalStore(s.ui.subscribe, () => (s.ui.get().sel?.t ?? 0) >= 4, () => false);
  const t = useT();
  const [closed, setClosed] = useState<Set<number>>(() => new Set());
  const [q, setQ] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  // (Read once the panel first shows: what it is for.)
  useEffect(() => {
    if (!hidden && sh.state === 'idle' && tasks.supported) void tasks.startShape('file');
  }, [hidden, sh.state, tasks]);
  const report = sh.report;
  const rows = useMemo(() => (report ? rowsOf(report, closed, q) : []), [report, closed, q]);
  const sel = report && sh.sel >= 0 ? report.paths[sh.sel] : null;
  const toggle = (id: number) => {
    const next = new Set(closed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setClosed(next);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((r) => r.p.id === sh.sel));
    let to = -1;
    if (e.key === 'ArrowDown') to = Math.min(rows.length - 1, sh.sel < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = rows.length - 1;
    else if (e.key === 'PageDown') to = Math.min(rows.length - 1, i + 15);
    else if (e.key === 'PageUp') to = Math.max(0, i - 15);
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel) {
      const row = rows[i];
      if (row.kids && closed.has(sel.id) === (e.key === 'ArrowRight')) toggle(sel.id);
      else if (e.key === 'ArrowLeft' && sel.parent >= 0) tasks.selectPath(sel.parent);
      e.preventDefault();
      return;
    }
    if (to < 0) return;
    e.preventDefault();
    tasks.selectPath(rows[to].p.id);
    grid.current?.querySelector(`[data-id="${rows[to].p.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  if (!tasks.supported) {
    return (
      <div id="hg-shape" className="hg-notyet" tabIndex={-1} hidden={hidden}>
        <b>{t('The shape needs the file itself')}</b>
      </div>
    );
  }
  const running = sh.state === 'running';
  return (
    <div id="hg-shape" className="hs" hidden={hidden}>
      <div className="toolbar hs-bar" role="toolbar" aria-label={t('Shape')}>
        <div className="seg seg-sm" role="radiogroup" aria-label={t('Read')}>
          <button type="button" role="radio" aria-checked={sh.target === 'file'} onClick={() => void tasks.startShape('file')} data-tip={t('Every value of the file')}>
            {t('Whole file')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sh.target === 'value'}
            disabled={!hasSel}
            onClick={() => void tasks.startShape('value')}
            data-tip={hasSel ? t('The value selected in the tree') : t('Select an array or object in the tree first')}
          >
            {t('Selected value')}
          </button>
        </div>
        {sh.target === 'value' && <span className={`hs-scope ${PRIVATE}`}>{sh.label}</span>}
        <Status sh={sh} records={report?.records ?? 0} />
        <span className="grow" />
        {report && report.paths.length > 12 && (
          <input className="hs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter paths')} aria-label={t('Filter paths')} spellCheck={false} autoComplete="off" />
        )}
        {running ? (
          <button type="button" className="btn sm" onClick={() => tasks.stopShape()}>
            {t('Stop')}
          </button>
        ) : (
          sh.state !== 'idle' && (
            <button type="button" className="btn sm" onClick={() => void tasks.startShape()}>
              {t('Read again')}
            </button>
          )
        )}
      </div>
      {running && sh.total > 0 && (
        <div className="hg-bar" role="progressbar" aria-label={t('Reading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct(sh.read, sh.total))}>
          <i style={{ width: `${pct(sh.read, sh.total)}%` }} />
        </div>
      )}
      {!report ? (
        <div className="hg-notyet">
          {running ? <i className="spin" /> : null}
          <b>{running ? t('Reading every record…') : t('The shape of every record')}</b>
          <p>{t('One pass over the file: each path’s types, how often it is there, ranges, distinct values and examples. Live as it reads.')}</p>
        </div>
      ) : (
        <div className="hs-main">
          <div
            className={`hs-grid ${PRIVATE}`}
            role="treegrid"
            aria-label={t('Paths')}
            aria-rowcount={rows.length + 1}
            tabIndex={0}
            ref={grid}
            onKeyDown={onKey}
            aria-activedescendant={sel ? `hs-r${sel.id}` : undefined}
          >
            <div className="hs-row hs-head" role="row">
              <span role="columnheader">{t('Path')}</span>
              <span role="columnheader">{t('Types')}</span>
              <span role="columnheader" className="hs-n">{t('Present')}</span>
              <span role="columnheader" className="hs-n hs-wide">{t('Null')}</span>
              <span role="columnheader" className="hs-n hs-wide">{t('Distinct')}</span>
              <span role="columnheader" className="hs-wide">{t('Range')}</span>
              <span role="columnheader" className="hs-wide hs-ex">{t('Example')}</span>
            </div>
            {rows.map(({ p, kids }) => {
              const parent = p.parent >= 0 ? report.paths[p.parent] : null;
              const member = parent && !p.item && !p.other;
              const present = member ? pct(p.present, parent!.kinds[K_OBJ]) : 100;
              const scal = p.kinds[K_NULL] + p.kinds[K_FALSE] + p.kinds[K_TRUE] + p.kinds[K_NUM] + p.kinds[K_STR];
              return (
                <div
                  key={p.id}
                  id={`hs-r${p.id}`}
                  data-id={p.id}
                  className={`hs-row${p.id === sh.sel ? ' on' : ''}`}
                  role="row"
                  aria-level={p.depth + 1}
                  aria-expanded={kids ? !closed.has(p.id) : undefined}
                  aria-selected={p.id === sh.sel}
                  onClick={() => tasks.selectPath(p.id)}
                >
                  <span role="gridcell" className="hs-path" style={{ paddingLeft: `${Math.min(p.depth, 12) * 14 + 4}px` }}>
                    {kids && !q ? (
                      <button
                        type="button"
                        className={`hs-tw${closed.has(p.id) ? '' : ' open'}`}
                        tabIndex={-1}
                        aria-label={closed.has(p.id) ? t('Expand') : t('Collapse')}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(p.id);
                        }}
                      />
                    ) : (
                      <i className="hs-tw-sp" />
                    )}
                    {q ? <span className="hs-key">{pathText(report, p)}</span> : <Label p={p} />}
                  </span>
                  <span role="gridcell" className="hs-kinds" title={kindsText(p, t)}>
                    <KindBar p={p} />
                    <span className="hs-kt">{kindsText(p, t)}</span>
                  </span>
                  <span role="gridcell" className={`hs-n${member && present < 100 ? (present < 50 ? ' warn' : '') : ' muted'}`}>{member ? <Pct v={present} /> : '—'}</span>
                  <span role="gridcell" className="hs-n hs-wide">{p.kinds[K_NULL] ? <Pct v={pct(p.kinds[K_NULL], p.n)} /> : <span className="muted">—</span>}</span>
                  <span role="gridcell" className="hs-n hs-wide">{scal ? (p.exact ? t.num(p.distinct) : '~' + compact(p.distinct)) : <span className="muted">—</span>}</span>
                  <span role="gridcell" className="hs-wide hs-range">{rangeText(p, t)}</span>
                  <span role="gridcell" className="hs-wide hs-ex">{p.examples[0]?.[0] ?? ''}</span>
                </div>
              );
            })}
          </div>
          {sel && <Detail s={s} r={report} p={sel} />}
        </div>
      )}
    </div>
  );
}

/** A count with its share: "12,345 · 98.2%". */
function Count({ n, of }: { n: number; of: number }) {
  const t = useT();
  return (
    <span className="hs-c">
      {t.num(n)} <span className="muted">· <Pct v={pct(n, of)} /></span>
    </span>
  );
}

/** First, Next and Count for one kind of a path's values (or the objects missing it). */
function Places({ s, segs, kind, missing: m, first }: { s: HugeSession; segs: (string | number)[] | null; kind?: number; missing?: boolean; first: number }) {
  const tasks = s.tasks;
  const seek = useTasks(tasks.ui, (u) => u.shape.seek);
  const t = useT();
  const tgt = segs ? (m ? { path: segs, missing: true } : { path: segs, kind }) : null;
  const keyOf = (count: boolean) => JSON.stringify([tgt, count]);
  const counted = seek && !seek.busy && seek.key === keyOf(true) ? seek.found : null;
  const busy = !!seek?.busy && (seek.key === keyOf(true) || seek.key === keyOf(false));
  return (
    <span className="hs-acts">
      <button type="button" className="hs-link" disabled={first < 0} onClick={() => tasks.goto(first)}>
        {t('First')}
      </button>
      {tgt && (
        <>
          <button type="button" className="hs-link" onClick={() => void tasks.seek(tgt, false)} data-tip={t('After the value selected in the tree')}>
            {t('Next')}
          </button>
          <button type="button" className="hs-link" onClick={() => void tasks.seek(tgt, true)}>
            {counted !== null ? t.num(counted) : t('Count')}
          </button>
        </>
      )}
      {busy && <i className="spin" aria-label={t('Searching')} />}
    </span>
  );
}

function Detail({ s, r, p }: { s: HugeSession; r: ShapeReport; p: ShapePath }) {
  const tasks = s.tasks;
  const target = useTasks(tasks.ui, (u) => u.shape.target);
  const t = useT();
  const segs = segsOf(r, p);
  const parent = p.parent >= 0 ? r.paths[p.parent] : null;
  const member = !!parent && !p.item && !p.other;
  const objs = parent ? parent.kinds[K_OBJ] : 0;
  const missing = member ? objs - p.present : 0;
  const path = pathText(r, p);
  // Conditions on records, for Extract: the records are the items of the first array on the path (its
  // container selected for it when it isn't the shape's own scope).
  const star = segs ? segs.indexOf('*') : -1;
  const container = segs && star >= 0 ? segs.slice(0, star) : null;
  const holder = container ? r.paths.find((q) => q.kinds[K_ARR] > 0 && pathSegsEqual(segsOf(r, q), container)) : undefined;
  const recordPath = segs && holder ? segs.slice(star + 1) : null;
  const extract = (cond: Cond) => void tasks.extractFrom({ conds: [cond], target, container: container ?? [] });
  const kinds = p.kinds.map((n, k) => [k, n] as const).filter(([, n]) => n > 0);
  return (
    <aside className={`hs-detail ${PRIVATE}`} aria-label={t('Path details')}>
      <div className="hs-dhead">
        <code className="hs-dpath" title={path}>
          {path}
        </code>
        <button type="button" className="btn icon sm" aria-label={t('Copy path')} data-tip={t('Copy path')} onClick={() => void navigator.clipboard?.writeText(path)}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 9h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 21H9.5A1.5 1.5 0 0 1 8 19.5V10a1 1 0 0 1 1-1ZM16 9V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
          </svg>
        </button>
      </div>
      <p className="hs-sum">
        {t.n(p.n, '{n} value', '{n} values')}
        {member && (
          <>
            {' · '}
            {t('in {share} of objects', { share: `${pct(p.present, objs) >= 99.95 ? 100 : pct(p.present, objs).toFixed(1)}%` })}
          </>
        )}
      </p>
      <h4>{t('Types')}</h4>
      <ul className="hs-list">
        {kinds.map(([k, n]) => (
          <li key={k}>
            <i className="hs-dot" style={{ background: KIND_COLOR[k] }} />
            <span className="hs-lk">{t(KIND_NAMES[k])}</span>
            <Count n={n} of={p.n} />
            <Places s={s} segs={segs} kind={k} first={p.first[k]} />
          </li>
        ))}
        {member && missing > 0 && (
          <li>
            <i className="hs-dot hs-miss" />
            <span className="hs-lk">{t('missing')}</span>
            <Count n={missing} of={objs} />
            <Places s={s} segs={segs} missing first={p.missAt} />
          </li>
        )}
      </ul>
      {recordPath && (member || p.kinds[K_NULL] > 0) && (
        <div className="hs-xs">
          {member && missing > 0 && (
            <button type="button" className="btn sm" onClick={() => extract({ path: recordPath, op: 'missing' })}>
              {t('Extract records without it')}
            </button>
          )}
          {p.kinds[K_NULL] > 0 && (
            <button type="button" className="btn sm" onClick={() => extract({ path: recordPath, op: 'eq', value: null })}>
              {t('Extract records where it is null')}
            </button>
          )}
        </div>
      )}
      {p.num && (
        <>
          <h4>{t('Numbers')}</h4>
          <dl className="hs-dl">
            <dt>{t('Smallest')}</dt>
            <dd className="mono">{p.num.minText}</dd>
            <dt>{t('Largest')}</dt>
            <dd className="mono">{p.num.maxText}</dd>
            <dt>{t('Mean')}</dt>
            <dd className="mono">{Number.isFinite(p.num.mean) ? +p.num.mean.toPrecision(6) : '—'}</dd>
            <dt>{t('Whole numbers')}</dt>
            <dd>
              <Pct v={pct(p.num.ints, p.kinds[K_NUM])} />
            </dd>
          </dl>
        </>
      )}
      {p.str && (
        <>
          <h4>{t('Text')}</h4>
          <dl className="hs-dl">
            <dt>{t('Length')}</dt>
            <dd>{p.str.min === p.str.max ? t.num(p.str.min) : `${t.num(p.str.min)} – ${t.num(p.str.max)}`}</dd>
            <dt>{t('Mean length')}</dt>
            <dd>{t.num(Math.round(p.str.mean))}</dd>
            {p.str.formats.map((n, k) =>
              n > 0 ? (
                <span key={k} className="hs-fmt">
                  <dt>{t(FORMAT_NAMES[FORMATS[k]])}</dt>
                  <dd>
                    <Pct v={pct(n, p.kinds[K_STR])} />
                  </dd>
                </span>
              ) : null,
            )}
          </dl>
        </>
      )}
      {(p.arr || p.obj) && (
        <>
          <h4>{p.arr ? t('Arrays') : t('Objects')}</h4>
          <dl className="hs-dl">
            {p.arr && (
              <>
                <dt>{t('Items')}</dt>
                <dd>{p.arr.min === p.arr.max ? t.num(p.arr.min) : `${t.num(p.arr.min)} – ${t.num(p.arr.max)}`}</dd>
                <dt>{t('Mean items')}</dt>
                <dd>{+p.arr.mean.toFixed(1)}</dd>
              </>
            )}
            {p.obj && (
              <>
                <dt>{t('Members')}</dt>
                <dd>{p.obj.min === p.obj.max ? t.num(p.obj.min) : `${t.num(p.obj.min)} – ${t.num(p.obj.max)}`}</dd>
              </>
            )}
          </dl>
        </>
      )}
      {p.distinct > 0 && (
        <>
          <h4>{p.exact ? t('Distinct values: {n}', { n: t.num(p.distinct) }) : t('Distinct values: about {n}', { n: t.num(p.distinct) })}</h4>
          {p.top && p.top.length > 0 && (
            <ul className="hs-top">
              {p.top.map(([text, n, at]) => (
                <li key={text}>
                  <button type="button" className="hs-val mono" onClick={() => tasks.goto(at)} title={text}>
                    {text}
                  </button>
                  <span className="hs-tbar" aria-hidden="true">
                    <i style={{ width: `${pct(n, p.n)}%` }} />
                  </span>
                  <Count n={n} of={p.n} />
                  {recordPath && !text.endsWith('…"') && (
                    <button type="button" className="hs-link" onClick={() => extract({ path: recordPath, op: 'eq', value: JSON.parse(text) as string })}>
                      {t('Extract')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!p.exact && (
            <>
              <h4>{t('Examples')}</h4>
              <ul className="hs-top">
                {p.examples.map(([text, at], k) => (
                  <li key={k}>
                    <button type="button" className="hs-val mono" onClick={() => tasks.goto(at)} title={text}>
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </aside>
  );
}
