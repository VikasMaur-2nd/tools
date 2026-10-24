'use client';

import '@/app/compare.css';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import { ARR, MAX_WALK_DEPTH, parse, tooDeep, type JNode, type ParseResult } from '@/lib/json/parser';
import { clip, copyText, preview, primText, tooLarge } from '@/lib/json/format';
import { formatPath } from '@/lib/json/path';
import { diff, parseIgnoreList, type Change, type DiffKind, type DiffResult } from '@/lib/diff/diff';
import { patchText, toPatch } from '@/lib/diff/patch';
import { LineMap, lineMarks } from '@/lib/diff/lines';
import { buildRows, canonLines, diffLines, pairLines, wordDiff, ROW_DEL, ROW_EQ, ROW_GAP, ROW_MOD, type Canon, type LineDiff, type Pairs, type Row as DRow } from '@/lib/diff/text';
import { highlightLine, type Mark } from '@/lib/engine/highlight';
import { setDiffMenu } from '@/lib/engine/instance';
import type { DiffAction, DiffMenu } from '@/lib/engine/store';
import { Icon } from './icons';
import { useT } from '@/lib/i18n/react';
import type { T } from '@/lib/i18n/ui';

export interface CompareViewProps {
  /** Original document (main editor). */
  leftText: string;
  /** Modified document (second editor). */
  rightText: string;
  /** The modified document as the engine parsed it, with the text it parsed: used instead of parsing `rightText` again when they match. */
  rightParsed?: { text: string; result: ParseResult } | null;
  /** Indent unit for the JSON Patch output ('  ' | '    ' | '\t'). */
  indent: string;
  /** Reveal a change in both editors: offsets of the change's node (or its parent container for added/removed items) in each document; undefined if that side has none. */
  onJump?: (left: number | undefined, right: number | undefined) => void;
  /** Per-line diff marks for the two editors (MARK_ADDED / MARK_REMOVED / MARK_CHANGED per line), or null when there is no valid diff. */
  onMarks?: (left: Uint8Array | null, right: Uint8Array | null) => void;
  /** Swap the two documents. */
  onSwap?: () => void;
}

type Filter = 'all' | 'added' | 'removed' | 'changed';
type Sub = 'changes' | 'diff';
type Layout = 'unified' | 'split';
interface Opts {
  keyOrder: boolean;
  arrayOrder: boolean;
  ci: boolean;
}
interface TextModel extends Pairs {
  a: Canon;
  b: Canon;
  d: LineDiff;
  /** Longest line (chars, capped) per side, line-number digits. */
  wa: number;
  wb: number;
  digits: number;
}
type RowKey = { k: number; a: number; b: number } | null;

const DEBOUNCE = 150;
const ROW_H = 46;
const OVERSCAN = 6;
const LINE_H = 20;
const LINE_OVERSCAN = 12;
/** Panel width from which the side-by-side layout is offered. */
const SPLIT_MIN = 820;
/** Characters of one line rendered in the Diff view. */
const MAX_SHOW = 5000;
const EMPTY: Change[] = [];
const NO_ROWS: DRow[] = [];
const NO_OPEN: ReadonlySet<number> = new Set();
const KIND_MARK: Record<DiffKind, string> = { added: '+', removed: '−', changed: '~', type: '≠' };
const KIND_LABEL: Record<DiffKind, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', type: 'Type changed' };
const TYPE_NAME = ['null', 'boolean', 'number', 'string', 'array', 'object'];

/** Survives tab switches (the host may unmount the panel); never persisted. */
const mem = {
  ignore: '',
  opts: { keyOrder: true, arrayOrder: false, ci: false } as Opts,
  sub: 'changes' as Sub,
  layout: 'unified' as Layout,
};

const TOO_DEEP = 'Nesting is too deep to compare';

/** The Diff view's model: both documents as canonical lines and their line diff. */
function textModel(l: JNode, r: JNode, sortKeys: boolean): TextModel | string {
  try {
    const a = canonLines(l, sortKeys);
    const b = canonLines(r, sortKeys);
    const d = diffLines(a.lines, b.lines);
    const width = (lines: string[]) => {
      let w = 0;
      for (const s of lines) if (s.length > w) w = s.length;
      return Math.min(w, MAX_SHOW + 30);
    };
    return { a, b, d, ...pairLines(a.lines, b.lines, d.hunks), wa: width(a.lines), wb: width(b.lines), digits: String(Math.max(a.lines.length, b.lines.length)).length };
  } catch (e) {
    if (!(e instanceof RangeError || tooDeep(e))) throw e;
    return TOO_DEEP;
  }
}

/** The engine's parse when it is of `text`. */
const parsedFor = (p: CompareViewProps['rightParsed'], text: string) => (p && p.text === text ? p.result : null);

const valueText = (n: JNode) => (n.t >= ARR ? preview(n, 90) : primText(n, 160));
/** A change's path as its row shows it (keys can be any length). */
const pathText = (c: Change) => clip(formatPath(c.path), 300);

const describe = (c: Change, tr: T) =>
  c.order
    ? tr('Key order differs at {path}', { path: pathText(c) })
    : `${tr(KIND_LABEL[c.kind])} ${pathText(c)}${c.left ? ': ' + valueText(c.left) : ''}${c.right ? (c.left ? ' → ' : ': ') + valueText(c.right) : ''}`;

const matches = (c: Change, f: Filter) => f === 'all' || c.kind === f || (f === 'changed' && c.kind === 'type');

const Row = memo(function Row({ c, i, sel }: { c: Change; i: number; sel: boolean }) {
  const tr = useT();
  const kind = c.kind;
  let vals;
  if (c.order) vals = <span className="cmp-note">{tr('key order differs')}</span>;
  else if (kind === 'added') vals = <span className="cmp-new">{valueText(c.right as JNode)}</span>;
  else if (kind === 'removed') vals = <span className="cmp-old">{valueText(c.left as JNode)}</span>;
  else {
    const l = c.left as JNode;
    const r = c.right as JNode;
    vals = (
      <>
        {kind === 'type' && <span className="cmp-tn">{TYPE_NAME[l.t]}</span>}
        <span className="cmp-old">{valueText(l)}</span>
        <span className="cmp-arrow" aria-hidden="true">
          {'→'}
        </span>
        {kind === 'type' && <span className="cmp-tn">{TYPE_NAME[r.t]}</span>}
        <span className="cmp-new">{valueText(r)}</span>
      </>
    );
  }
  return (
    <div
      role="listitem"
      data-i={i}
      className={`cmp-row cmp-k-${kind}${sel ? ' sel' : ''}`}
      style={{ transform: `translateY(${i * ROW_H}px)` }}
      aria-current={sel || undefined}
      aria-label={describe(c, tr)}
    >
      <span className="cmp-mark" aria-hidden="true">
        {KIND_MARK[kind]}
      </span>
      <span className="cmp-body" aria-hidden="true">
        <span className="cmp-path">{pathText(c)}</span>
        <span className="cmp-vals">{vals}</span>
      </span>
    </div>
  );
});

/**
 * One row of the line diff. `side`: 0 = unified, 1 = left pane, 2 = right
 * pane of the side-by-side layout.
 */
const DiffLine = memo(function DiffLine({ r, i, side, sel, m }: { r: DRow; i: number; side: number; sel: boolean; m: TextModel }) {
  const tr = useT();
  const style = { top: i * LINE_H };
  if (r.k === ROW_GAP) {
    return (
      <div role="listitem" data-r={i} className={`cmp-dl gap${sel ? ' sel' : ''}`} style={style} aria-current={sel || undefined}>
        <button type="button" className="cmp-gapb" aria-label={tr.n(r.n, 'Show {n} unchanged line', 'Show {n} unchanged lines')}>
          {'⋯ '}
          {tr.n(r.n, '{n} unchanged line', '{n} unchanged lines')}
        </button>
      </div>
    );
  }
  let la = -1;
  let lb = -1;
  let cls = '';
  let sign = ' ';
  let text = '';
  let emph: number[] | null = null;
  if (r.k === ROW_EQ) {
    la = r.a;
    lb = r.b;
    text = side === 2 ? m.b.lines[r.b] : m.a.lines[r.a];
  } else if (side === 0 ? r.k === ROW_DEL : side === 1) {
    // removed line (unified) or left half of a changed row
    if (r.a < 0) cls = ' fill';
    else {
      la = r.a;
      cls = ' del';
      sign = '−';
      text = m.a.lines[r.a];
      const p = m.pa[r.a];
      if (p >= 0 && (side === 0 || p === r.b)) emph = wordDiff(text, m.b.lines[p])[0];
    }
  } else if (r.b < 0) cls = ' fill';
  else {
    lb = r.b;
    cls = ' add';
    sign = '+';
    text = m.b.lines[r.b];
    const p = m.pb[r.b];
    if (p >= 0 && (side === 0 || p === r.a)) emph = wordDiff(m.a.lines[p], text)[1];
  }

  const shown = text.length > MAX_SHOW ? text.slice(0, MAX_SHOW) : text;
  let marks: Mark[] | null = null;
  if (emph?.length) {
    const wcls = cls === ' del' ? 'cmp-del-w' : 'cmp-add-w';
    marks = [];
    for (let k = 0; k < emph.length; k += 2) {
      const e = Math.min(emph[k + 1], shown.length);
      if (emph[k] < e) marks.push({ a: emph[k], b: e, cls: wcls });
    }
  }
  let html = highlightLine(shown, 0, shown.length, marks, false);
  if (shown !== text) html += `<span class="cmp-more"> … ${tr.n(text.length - shown.length, '{n} more character', '{n} more characters')}</span>`;
  const label =
    cls === ' fill'
      ? tr('Blank')
      : tr(cls === ' del' ? 'Removed, line {line}: {text}' : cls === ' add' ? 'Added, line {line}: {text}' : 'Unchanged, line {line}: {text}', { line: (la >= 0 ? la : lb) + 1, text: text.slice(0, 160) });

  return (
    <div role="listitem" data-r={i} className={`cmp-dl${cls}${sel ? ' sel' : ''}`} style={style} aria-current={sel || undefined} aria-label={label}>
      <span className="cmp-dg" aria-hidden="true">
        {side !== 2 && <span className="cmp-dn">{la >= 0 ? la + 1 : ''}</span>}
        {side !== 1 && <span className="cmp-dn">{lb >= 0 ? lb + 1 : ''}</span>}
        <span className="cmp-dsg">{sign}</span>
      </span>
      <span className="cmp-dc" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

function CompareView({ leftText, rightText, rightParsed, indent, onJump, onMarks, onSwap }: CompareViewProps) {
  const tr = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const lwRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const leftPane = useRef<HTMLDivElement | null>(null);
  const rightPane = useRef<HTMLDivElement | null>(null);
  const marksRef = useRef(onMarks);
  const noteTimer = useRef(0);

  const [deb, setDeb] = useState(() => ({ l: leftText, r: rightText, rp: parsedFor(rightParsed, rightText) }));
  const [ignoreText, setIgnoreText] = useState(mem.ignore);
  const [opts, setOpts] = useState<Opts>(mem.opts);
  const [sub, setSub] = useState<Sub>(mem.sub);
  const [layout, setLayout] = useState<Layout>(mem.layout);
  const [filter, setFilter] = useState<Filter>('all');
  const [selState, setSelState] = useState<{ list: Change[]; i: number }>({ list: EMPTY, i: -1 });
  const [dsel, setDSel] = useState<RowKey>(null);
  const [openState, setOpenState] = useState<{ m: TextModel | null; set: ReadonlySet<number> }>({ m: null, set: NO_OPEN });
  const [keptFor, setKeptFor] = useState<{ l: JNode; r: JNode; k: boolean } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [dscroll, setDScroll] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [wide, setWide] = useState(false);
  const [note, setNote] = useState('');

  // Debounce both documents; heavy work below runs on deferred values so
  // typing and toggles stay responsive.
  useEffect(() => {
    if (leftText === deb.l && rightText === deb.r) return;
    const t = window.setTimeout(() => setDeb({ l: leftText, r: rightText, rp: parsedFor(rightParsed, rightText) }), DEBOUNCE);
    return () => window.clearTimeout(t);
  }, [leftText, rightText, rightParsed, deb]);

  useEffect(() => {
    const nt = noteTimer;
    return () => window.clearTimeout(nt.current);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const lw = lwRef.current;
    if (!root || !lw) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        if (en.target === lw) setViewH(en.contentRect.height || 600);
        else setWide(en.contentRect.width >= SPLIT_MIN);
      }
    });
    ro.observe(root);
    ro.observe(lw);
    return () => ro.disconnect();
  }, []);

  const d = useDeferredValue(deb);
  const dIgnore = useDeferredValue(ignoreText);
  const dOpts = useDeferredValue(opts);
  const view = useDeferredValue(sub);
  const stale = d !== deb || deb.l !== leftText || deb.r !== rightText || dIgnore !== ignoreText || dOpts !== opts || view !== sub;

  const lp = useMemo(() => (d.l.trim() ? parse(d.l) : null), [d.l]);
  // (the engine parsed the modified document already, for its squiggles)
  const rp = useMemo(() => (d.r.trim() ? (d.rp ?? parse(d.r)) : null), [d.r, d.rp]);
  const ignoreKey = useMemo(() => parseIgnoreList(dIgnore).join('\n'), [dIgnore]);

  // Nesting deeper than Compare walks (see MAX_WALK_DEPTH) is refused at once.
  const deep = !!lp && !!rp && (lp.depth > MAX_WALK_DEPTH || rp.depth > MAX_WALK_DEPTH);
  const result = useMemo<DiffResult | null>(() => {
    if (!lp?.root || !rp?.root) return null;
    if (deep) return { changes: [], summary: { added: 0, removed: 0, changed: 0, type: 0, total: 0 }, truncated: false, error: TOO_DEEP };
    const o = { ignoreKeyOrder: dOpts.keyOrder, ignoreArrayOrder: dOpts.arrayOrder, caseInsensitiveStrings: dOpts.ci, ignorePaths: ignoreKey ? ignoreKey.split('\n') : [] };
    return diff(lp.root, rp.root, o);
  }, [lp, rp, deep, dOpts, ignoreKey]);

  // Line marks for both editors after every diff (nulls when there is none).
  useEffect(() => {
    marksRef.current = onMarks;
  });
  useEffect(() => {
    const f = marksRef.current;
    if (!f) return;
    if (!result || result.error) f(null, null);
    else f(lineMarks(result.changes, 'left', new LineMap(d.l)), lineMarks(result.changes, 'right', new LineMap(d.r)));
  }, [result, d]);
  useEffect(() => {
    const ref = marksRef;
    return () => ref.current?.(null, null);
  }, []);

  const sum = result?.summary;
  const changedCount = sum ? sum.changed + sum.type : 0;
  // a filter whose kind no longer occurs falls back to everything
  const eff: Filter = filter === 'all' || !sum ? 'all' : (filter === 'changed' ? changedCount : sum[filter]) ? filter : 'all';

  const shown = useMemo(() => {
    if (!result) return EMPTY;
    return eff === 'all' ? result.changes : result.changes.filter((c) => matches(c, eff));
  }, [result, eff]);

  // (a selection in an older list goes: it holds the documents it was made in)
  if (selState.list !== EMPTY && selState.list !== shown) setSelState({ list: EMPTY, i: -1 });
  const sel = selState.list === shown && selState.i < shown.length ? selState.i : -1;
  const n = shown.length;

  // ── Diff view model ──

  // Made when the Diff view shows and kept while its documents and key order stay, so switching
  // Changes ⇄ Diff doesn't redo the line diff; other or emptied documents (or closing) let it go.
  const keyOrder = dOpts.keyOrder;
  const lr = lp?.root;
  const rr = rp?.root;
  const kept = !!keptFor && keptFor.l === lr && keptFor.r === rr && keptFor.k === keyOrder;
  if (view === 'diff' && lr && rr) {
    if (!kept) setKeptFor({ l: lr, r: rr, k: keyOrder });
  } else if (keptFor && !kept) setKeptFor(null);
  const want = view === 'diff' || kept;
  const model = useMemo(() => (want && lr && rr ? (deep ? TOO_DEEP : textModel(lr, rr, keyOrder)) : null), [want, lr, rr, deep, keyOrder]);
  const tm = model && typeof model !== 'string' ? model : null;
  if (openState.m && openState.m !== tm) setOpenState({ m: null, set: NO_OPEN });
  const open = openState.m === tm ? openState.set : NO_OPEN;
  const split = layout === 'split' && wide;
  const rows = useMemo(() => (tm ? buildRows(tm.d, tm.a.lines.length, tm.b.lines.length, tm, open, split) : NO_ROWS), [tm, open, split]);
  const selRow = useMemo(() => (dsel ? rows.findIndex((r) => r.k === dsel.k && r.a === dsel.a && r.b === dsel.b) : -1), [rows, dsel]);
  const starts = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const k = rows[i].k;
      const prev = i ? rows[i - 1].k : ROW_EQ;
      if (k !== ROW_EQ && k !== ROW_GAP && (prev === ROW_EQ || prev === ROW_GAP)) out.push(i);
    }
    return out;
  }, [rows]);

  // ── actions ──

  const isDiff = view === 'diff';
  const navN = isDiff ? starts.length : n;

  const flash = (msg: string) => {
    window.clearTimeout(noteTimer.current);
    setNote(msg);
    noteTimer.current = window.setTimeout(() => setNote(''), 2600);
  };

  const select = (i: number, jump: boolean) => {
    if (i < 0 || i >= n) return;
    setSelState({ list: shown, i });
    const el = listRef.current;
    if (el) {
      const top = i * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    const c = shown[i];
    if (jump) onJump?.((c.left ?? c.leftParent)?.s, (c.right ?? c.rightParent)?.s);
  };

  const revealRow = (i: number, center: boolean) => {
    const el = leftPane.current;
    if (!el) return;
    const top = i * LINE_H;
    if (center) el.scrollTop = Math.max(0, top - Math.floor(el.clientHeight / 3));
    else if (top < el.scrollTop) el.scrollTop = top;
    else if (top + LINE_H > el.scrollTop + el.clientHeight) el.scrollTop = top + LINE_H - el.clientHeight;
  };

  const selectRow = (i: number, jump: boolean, center = false) => {
    const r = rows[i];
    if (!r || !tm) return;
    setDSel({ k: r.k, a: r.a, b: r.b });
    revealRow(i, center);
    if (jump && r.k !== ROW_GAP) onJump?.(tm.a.offs[r.ja], tm.b.offs[r.jb]);
  };

  const expand = (i: number) => {
    const r = rows[i];
    if (r?.k !== ROW_GAP || !tm) return;
    setOpenState({ m: tm, set: new Set(open).add(r.a) });
    setDSel({ k: ROW_EQ, a: r.a, b: r.b });
    leftPane.current?.focus({ preventScroll: true });
  };

  const goHunk = (dir: number) => {
    if (!starts.length) return;
    let t = -1;
    if (dir > 0) t = starts.find((s) => s > selRow) ?? starts[starts.length - 1];
    else {
      for (const s of starts) if (s < selRow) t = s;
      if (t < 0) t = selRow < 0 ? starts[starts.length - 1] : starts[0];
    }
    selectRow(t, true, true);
  };

  const gotoError = (side: 'l' | 'r') => {
    const p = (side === 'l' ? lp : rp)?.error?.p;
    if (p !== undefined) onJump?.(side === 'l' ? p : undefined, side === 'r' ? p : undefined);
  };

  const setOpt = (k: keyof Opts) => {
    const next = { ...opts, [k]: !opts[k] };
    mem.opts = next;
    setOpts(next);
  };

  const pickSub = (s: Sub) => {
    if (s === sub) return;
    mem.sub = s;
    setSub(s);
    if (s === 'diff') setDScroll(0);
    else setScroll(0);
  };

  const pickLayout = (l: Layout) => {
    mem.layout = l;
    setLayout(l);
  };

  const copyPatch = () => {
    if (!result) return;
    const ops = toPatch(result.changes);
    let text: string;
    try {
      text = patchText(ops, indent);
    } catch (e) {
      // A replaced subtree nested too deep to pretty-print (see MAX_TEXT).
      if (!tooLarge(e)) throw e;
      return flash(tr('The result is too large'));
    }
    if (!navigator.clipboard?.writeText) return flash(tr('Copy failed: clipboard access was blocked'));
    navigator.clipboard.writeText(text).then(
      () => flash(result.truncated ? tr('Copied, but incomplete: too many differences') : tr.n(ops.length, 'JSON Patch copied ({n} operation)', 'JSON Patch copied ({n} operations)')),
      () => flash(tr('Copy failed: clipboard access was blocked')),
    );
  };

  const toggleFilter = (f: Filter) => setFilter(eff === f ? 'all' : f);

  const prev = () => (isDiff ? goHunk(-1) : select(sel < 0 ? n - 1 : Math.max(0, sel - 1), true));
  const next = () => (isDiff ? goHunk(1) : select(sel < 0 ? 0 : Math.min(n - 1, sel + 1), true));

  // The right-click menu's part (Engine.openMenu): the row at `el` is selected first, as a click selects it
  // (without moving the editors); from the keyboard, the selected row. Its items run with the panel as it
  // is then (`menuAct`, updated after every render), on the row it opened on.
  const menuAct = useRef<(a: DiffAction, arg: string | undefined, c: Change | undefined, ri: number) => void>(() => {});
  useEffect(() => {
    const copy = (get: () => string, msg: string) => {
      let text: string;
      try {
        text = get();
      } catch (e) {
        if (!tooLarge(e)) throw e;
        return flash(tr('The result is too large'));
      }
      navigator.clipboard.writeText(text).then(
        () => flash(tr(msg)),
        () => flash(tr('Copy failed: clipboard access was blocked')),
      );
    };
    menuAct.current = (a, arg, c, ri) => {
      const r = rows[ri];
      if (a === 'copyPath' && c) copy(() => formatPath(c.path), 'Copied path');
      else if (a === 'copyLeft' && c?.left) copy(() => copyText(c.left as JNode, indent), 'Copied value');
      else if (a === 'copyRight' && c?.right) copy(() => copyText(c.right as JNode, indent), 'Copied value');
      else if (a === 'show' && c) onJump?.((c.left ?? c.leftParent)?.s, (c.right ?? c.rightParent)?.s);
      else if (a === 'show' && r && tm) onJump?.(tm.a.offs[r.ja], tm.b.offs[r.jb]);
      else if (a === 'expand') expand(ri);
      else if (a === 'sub') pickSub(arg as Sub);
      else if (a === 'layout') pickLayout(arg as Layout);
      else if (a === 'opt') setOpt(arg as keyof Opts);
      else if (a === 'prev') prev();
      else if (a === 'next') next();
      else if (a === 'patch') copyPatch();
    };
    setDiffMenu((el): DiffMenu => {
      let c: Change | undefined;
      let ri = -1;
      let rowEl: Element | null | undefined;
      let row: DiffMenu['row'] = null;
      if (view === 'changes') {
        rowEl = el?.closest('[data-i]');
        const i = rowEl ? Number(rowEl.getAttribute('data-i')) : sel;
        if (rowEl) select(i, false);
        else rowEl = listRef.current?.querySelector(`[data-i="${i}"]`);
        c = shown[i];
        if (c) row = { kind: 'change', left: !!c.left, right: !!c.right };
      } else if (tm) {
        rowEl = el?.closest('[data-r]');
        ri = rowEl ? Number(rowEl.getAttribute('data-r')) : selRow;
        const r = rows[ri];
        if (r && rowEl && r.k !== ROW_GAP) selectRow(ri, false);
        if (!rowEl) rowEl = leftPane.current?.querySelector(`[data-r="${ri}"]`);
        if (r) row = { kind: r.k === ROW_GAP ? 'gap' : 'line' };
      }
      return {
        row,
        box: rowEl?.getBoundingClientRect() ?? null,
        sub: view,
        wide,
        layout,
        opts,
        ok: navN > 0,
        patch: !!result && !result.error,
        run: (a, arg) => menuAct.current(a, arg, c, ri),
        focus: () => (view === 'changes' ? listRef.current : leftPane.current)?.focus({ preventScroll: true }),
      };
    });
  });
  useEffect(() => () => setDiffMenu(null), []);

  // ── list events (delegated: rows carry data-i / data-r) ──

  const rowAt = (e: ReactMouseEvent, attr: string) => {
    const row = (e.target as HTMLElement).closest(`[${attr}]`);
    return row ? Number(row.getAttribute(attr)) : -1;
  };

  /** Arrow / page / home / end target from `cur` in a list of `count` rows, or -1. */
  const step = (key: string, cur: number, count: number, rowH: number, first: number) => {
    const page = Math.max(1, Math.floor(viewH / rowH) - 1);
    switch (key) {
      case 'ArrowDown':
        return cur < 0 ? first : Math.min(count - 1, cur + 1);
      case 'ArrowUp':
        return cur < 0 ? first : Math.max(0, cur - 1);
      case 'PageDown':
        return Math.min(count - 1, Math.max(0, cur) + page);
      case 'PageUp':
        return Math.max(0, cur - page);
      case 'Home':
        return 0;
      case 'End':
        return count - 1;
    }
    return -1;
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (sel >= 0) select(sel, true);
      return;
    }
    const i = step(e.key, sel, n, ROW_H, 0);
    if (i < 0) return;
    e.preventDefault();
    select(i, false);
  };

  const onDiffKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !rows.length) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selRow >= 0) {
        if (rows[selRow].k === ROW_GAP) expand(selRow);
        else selectRow(selRow, true);
      }
      return;
    }
    const i = step(e.key, selRow, rows.length, LINE_H, Math.min(rows.length - 1, Math.ceil(dscroll / LINE_H)));
    if (i < 0) return;
    e.preventDefault();
    selectRow(i, false);
  };

  const onDiffClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const i = rowAt(e, 'data-r');
    if (i < 0) return;
    if (rows[i]?.k === ROW_GAP) expand(i);
    else if (!window.getSelection()?.toString()) selectRow(i, true);
  };

  // the two panes of the side-by-side layout scroll together
  const onDiffScroll = (e: UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget.scrollTop;
    const other = e.currentTarget === leftPane.current ? rightPane.current : leftPane.current;
    if (other && other.scrollTop !== t) other.scrollTop = t;
    setDScroll(t);
  };
  const setLeftPane = useCallback((el: HTMLDivElement | null) => {
    leftPane.current = el;
  }, []);
  const setRightPane = useCallback((el: HTMLDivElement | null) => {
    rightPane.current = el;
    if (el && leftPane.current) el.scrollTop = leftPane.current.scrollTop;
  }, []);

  // ── render ──

  const lErr = lp?.error ?? null;
  const rErr = rp?.error ?? null;
  const errBox = (title: string, src: string, err: { p: number; m: string }, side: 'l' | 'r') => {
    const lm = new LineMap(src);
    return (
      <div tabIndex={0} className="cmp-empty err">
        <Icon name="alert" size={22} />
        <p>
          <b>{tr(title)}</b>
          <br />
          {tr('Ln {line}, Col {col}: {msg}', { line: lm.line(err.p), col: lm.col(err.p), msg: tr.msg(err.m) })}
        </p>
        {onJump && (
          <button type="button" className="btn sm" onClick={() => gotoError(side)}>
            {tr('Go to error')}
          </button>
        )}
      </div>
    );
  };
  const same = (identical: boolean, msg: string) => (
    <div tabIndex={0} className="cmp-empty ok">
      <Icon name="check" size={22} />
      <p>
        <b>{tr('No differences')}</b>
        <br />
        {tr(identical ? 'The documents are identical.' : msg)}
      </p>
    </div>
  );

  let empty: ReactNode = null;
  if (!rightText.trim()) {
    empty = (
      <div tabIndex={0} className="cmp-empty">
        <Icon name="diff" size={22} />
        <p>
          <b>{tr('Compare two JSON documents')}</b>
          <br />
          {tr('Paste the modified JSON in the middle column. It is compared with the original on the left.')}
        </p>
        <ul>
          <li>{tr('Arrays are matched by content or by id, so an insertion is one change')}</li>
          <li>{tr('Ignore key order, array order, case or specific paths')}</li>
          <li>{tr('Line by line Diff view with word-level highlights')}</li>
          <li>{tr('Copy the differences as a JSON Patch (RFC 6902)')}</li>
        </ul>
      </div>
    );
  } else if (!leftText.trim()) {
    empty = (
      <div tabIndex={0} className="cmp-empty">
        <Icon name="file" size={22} />
        <p>{tr('Add the original JSON on the left to compare.')}</p>
      </div>
    );
  } else if (lErr) empty = errBox('Fix the original JSON on the left', d.l, lErr, 'l');
  else if (rErr) empty = errBox('Fix the modified JSON in the middle', d.r, rErr, 'r');
  else if (view === 'changes') {
    if (result?.error)
      empty = (
        <div tabIndex={0} className="cmp-empty err">
          <Icon name="alert" size={22} />
          <p>{tr.msg(result.error)}</p>
        </div>
      );
    else if (result && !result.changes.length)
      empty = same(d.l === d.r, dOpts.arrayOrder || dOpts.ci || ignoreKey ? 'The documents are equivalent (with the ignore options above).' : 'The documents are equivalent.');
  } else if (typeof model === 'string')
    empty = (
      <div tabIndex={0} className="cmp-empty err">
        <Icon name="alert" size={22} />
        <p>{tr.msg(model)}</p>
      </div>
    );
  else if (tm && !tm.d.hunks.length) empty = same(d.l === d.r, keyOrder ? 'Same data: only the formatting or key order differs.' : 'Same data: only the formatting differs.');

  let body: ReactNode;
  let live = '';
  if (view === 'changes') {
    const first = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
    const last = Math.min(n, Math.ceil((scroll + viewH) / ROW_H) + OVERSCAN);
    const items = [];
    for (let i = first; i < last; i++) items.push(<Row key={i} c={shown[i]} i={i} sel={i === sel} />);
    live = sel >= 0 ? `${tr('{i} of {total}', { i: sel + 1, total: n })}: ${describe(shown[sel], tr)}` : sum ? tr('{added} added, {removed} removed, {changed} changed', { added: sum.added, removed: sum.removed, changed: changedCount }) : '';
    body = (
      <div
        ref={listRef}
        className="cmp-list"
        role="list"
        aria-label={n ? tr('Differences ({count})', { count: tr.num(n) }) : tr('Differences')}
        tabIndex={n ? 0 : -1}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        onKeyDown={onListKey}
        onClick={(e) => {
          const i = rowAt(e, 'data-i');
          if (i >= 0) select(i, true);
        }}
      >
        <div className="cmp-sizer" role="none" style={{ height: n * ROW_H }}>
          {items}
        </div>
      </div>
    );
  } else if (tm && rows.length && !empty) {
    const first = Math.max(0, Math.floor(dscroll / LINE_H) - LINE_OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((dscroll + viewH) / LINE_H) + LINE_OVERSCAN);
    const pane = (side: number) => {
      const items = [];
      for (let i = first; i < last; i++) items.push(<DiffLine key={i} r={rows[i]} i={i} side={side} sel={i === selRow} m={tm} />);
      const cols = side ? 1 : 2;
      const w = side === 1 ? tm.wa : side === 2 ? tm.wb : Math.max(tm.wa, tm.wb);
      return (
        <div
          key={side === 2 ? 'r' : 'l'}
          ref={side === 2 ? setRightPane : setLeftPane}
          className="cmp-ds"
          role="list"
          aria-label={tr(side === 1 ? 'Original lines' : side === 2 ? 'Modified lines' : 'Line differences')}
          tabIndex={0}
          style={{ '--cmp-nw': tm.digits } as CSSProperties}
          onScroll={onDiffScroll}
          onKeyDown={onDiffKey}
          onClick={onDiffClick}
        >
          <div className="cmp-dz" role="none" style={{ height: rows.length * LINE_H, width: `calc(${w + 2 + cols * tm.digits}ch + ${cols * 14 + 22}px)` }}>
            {items}
          </div>
        </div>
      );
    };
    const r = selRow >= 0 ? rows[selRow] : null;
    live = !r
      ? tr('{added} lines added, {removed} removed', { added: tm.d.added, removed: tm.d.removed })
      : r.k === ROW_GAP
        ? tr.n(r.n, '{n} unchanged line, press Enter to show it', '{n} unchanged lines, press Enter to show them')
        : r.k === ROW_EQ
          ? tr('Unchanged line {line}', { line: r.a + 1 })
          : r.a >= 0 && (r.k !== ROW_MOD || r.b < 0)
            ? tr('Removed line {line}', { line: r.a + 1 })
            : r.a >= 0
              ? tr('Changed line {from} to line {to}', { from: r.a + 1, to: r.b + 1 })
              : tr('Added line {line}', { line: r.b + 1 });
    body = <div className={`cmp-dv${split ? ' split' : ''}`}>{split ? [pane(1), pane(2)] : pane(0)}</div>;
  }


  return (
    <div ref={rootRef} className={`cmp${stale ? ' stale' : ''}`} role="region" aria-label={tr('Differences')}>
      <div className="cmp-head">
        <div className="seg seg-sm" role="radiogroup" aria-label={tr('Show differences as')}>
          <button type="button" role="radio" aria-checked={sub === 'changes'} onClick={() => pickSub('changes')} data-tip={tr('Structural changes by JSON path')}>
            {tr('Changes')}
          </button>
          <button type="button" role="radio" aria-checked={sub === 'diff'} onClick={() => pickSub('diff')} data-tip={tr('Line by line diff of the formatted documents')}>
            {tr('Diff')}
          </button>
        </div>
        <span className="grow" />
        <button type="button" className="btn sm icon" aria-label={tr('Swap original and modified')} data-tip={tr('Swap original ⇄ modified')} disabled={!onSwap} onClick={() => onSwap?.()}>
          <Icon name="swap" size={15} />
        </button>
        <button type="button" className="btn sm" aria-label={tr('Copy JSON Patch')} disabled={!result || !!result.error} data-tip={tr('RFC 6902 patch: original → modified')} onClick={copyPatch}>
          <Icon name="copy" size={15} />
          <span className="cmp-lbl">JSON Patch</span>
        </button>
      </div>

      <div className="cmp-sum">
        {isDiff ? (
          tm ? (
            <span className="cmp-stat" data-tip={tr('Both sides re-formatted the same way: only data changes show')}>
              <b className="cmp-plus">+{tr.num(tm.d.added)}</b>
              <b className="cmp-minus">
                {'−'}
                {tr.num(tm.d.removed)}
              </b>
              <span className="cmp-lbl">{tr('lines')}</span>
            </span>
          ) : (
            <span className="cmp-title">{tr('Line diff')}</span>
          )
        ) : sum ? (
          <>
            <button
              type="button"
              className="cmp-chip cmp-k-added"
              aria-pressed={eff === 'added'}
              aria-label={tr('{count} added: show only additions', { count: sum.added })}
              disabled={!sum.added}
              data-tip={tr('Show only additions')}
              onClick={() => toggleFilter('added')}
            >
              +{tr.num(sum.added)}
              <span className="cmp-lbl">{tr.n(sum.added, 'added', 'added')}</span>
            </button>
            <button
              type="button"
              className="cmp-chip cmp-k-removed"
              aria-pressed={eff === 'removed'}
              aria-label={tr('{count} removed: show only removals', { count: sum.removed })}
              disabled={!sum.removed}
              data-tip={tr('Show only removals')}
              onClick={() => toggleFilter('removed')}
            >
              {'−'}
              {tr.num(sum.removed)}
              <span className="cmp-lbl">{tr.n(sum.removed, 'removed', 'removed')}</span>
            </button>
            <button
              type="button"
              className="cmp-chip cmp-k-changed"
              aria-pressed={eff === 'changed'}
              aria-label={tr('{count} changed: show only changes', { count: changedCount })}
              disabled={!changedCount}
              data-tip={sum.type ? tr.n(sum.type, 'Show only changes ({n} type change)', 'Show only changes ({n} type changes)') : tr('Show only changes')}
              onClick={() => toggleFilter('changed')}
            >
              ~{tr.num(changedCount)}
              <span className="cmp-lbl">{tr.n(changedCount, 'changed', 'changed')}</span>
            </button>
          </>
        ) : (
          <span className="cmp-title">{tr('Differences')}</span>
        )}
        {!isDiff && result?.truncated && <span className="cmp-trunc">{tr('first {count}', { count: tr.num(result.changes.length) })}</span>}
        <span className="grow" />
        {isDiff && wide && (
          <div className="seg seg-sm" role="radiogroup" aria-label={tr('Diff layout')}>
            <button type="button" role="radio" aria-checked={layout === 'unified'} onClick={() => pickLayout('unified')}>
              {tr('Unified')}
            </button>
            <button type="button" role="radio" aria-checked={layout === 'split'} onClick={() => pickLayout('split')}>
              {tr('Split')}
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn sm icon"
          aria-label={tr(isDiff ? 'Previous change' : 'Previous difference')}
          data-tip={tr('Previous')}
          disabled={!navN}
          onClick={prev}
        >
          <Icon name="up" size={15} />
        </button>
        <button
          type="button"
          className="btn sm icon"
          aria-label={tr(isDiff ? 'Next change' : 'Next difference')}
          data-tip={tr('Next')}
          disabled={!navN}
          onClick={next}
        >
          <Icon name="down" size={15} />
        </button>
      </div>

      <div className="cmp-opts" role="group" aria-label={tr('Comparison options')}>
        <button type="button" className="cmp-opt" aria-pressed={opts.keyOrder} onClick={() => setOpt('keyOrder')}>
          <Icon name="check" size={13} />
          {tr('Ignore key order')}
        </button>
        {!isDiff && (
          <>
            <button type="button" className="cmp-opt" aria-pressed={opts.arrayOrder} onClick={() => setOpt('arrayOrder')}>
              <Icon name="check" size={13} />
              {tr('Ignore array order')}
            </button>
            <button type="button" className="cmp-opt" aria-pressed={opts.ci} onClick={() => setOpt('ci')}>
              <Icon name="check" size={13} />
              {tr('Ignore case')}
            </button>
            <input
              className="cmp-ign"
              type="text"
              value={ignoreText}
              onChange={(e) => {
                mem.ignore = e.target.value;
                setIgnoreText(e.target.value);
              }}
              placeholder={tr('Ignore paths: updatedAt, $.meta.etag, $.items[*].ts')}
              aria-label={tr('Paths to ignore, comma separated')}
              spellCheck={false}
              autoComplete="off"
            />
          </>
        )}
      </div>

      <div ref={lwRef} className="cmp-lw">
        {body}
        {empty}
      </div>
      <div className="sr-only" aria-live="polite">
        {note || live}
      </div>
      {note && (
        <div className="cmp-note-toast" role="status">
          {note}
        </div>
      )}
    </div>
  );
}

export default memo(CompareView);
