'use client';

import '@/app/compare.css';
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ARR, parse, type JNode } from '@/lib/json/parser';
import { formatDoc, preview, primText } from '@/lib/json/format';
import { formatPath } from '@/lib/json/path';
import { diff, leftOffset, parseIgnoreList, rightOffset, type Change, type DiffKind, type DiffResult } from '@/lib/diff/diff';
import { patchText, toPatch } from '@/lib/diff/patch';
import { LineMap } from '@/lib/diff/lines';
import { Icon } from './icons';

export interface CompareViewProps {
  /** The main editor's document: the original ("A") side. */
  leftText: string;
  /** Indent unit used by Format and the JSON Patch ('  ', '    ', '\t'; '' = minified). */
  indent: string;
  /** Reveals an offset of the main editor's document (selects / scrolls to it). */
  onJump?: (offset: number) => void;
}

type Filter = 'all' | 'added' | 'removed' | 'changed';
interface Opts {
  keyOrder: boolean;
  arrayOrder: boolean;
  ci: boolean;
}

const DEBOUNCE = 150;
const ROW_H = 46;
const OVERSCAN = 6;
const LINE_H = 20; // .cmp-ta line-height
const EMPTY: Change[] = [];
const KIND_MARK: Record<DiffKind, string> = { added: '+', removed: '−', changed: '~', type: '≠' };
const KIND_LABEL: Record<DiffKind, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', type: 'Type changed' };
const TYPE_NAME = ['null', 'boolean', 'number', 'string', 'array', 'object'];

/** Survives tab switches (the host may unmount the panel); never persisted. */
const mem = {
  right: '',
  fileName: '',
  ignore: '',
  opts: { keyOrder: true, arrayOrder: false, ci: false } as Opts,
  swapped: false,
  edPct: 38,
};

const valueText = (n: JNode) => (n.t >= ARR ? preview(n, 90) : primText(n, 160));

const describe = (c: Change) =>
  c.order
    ? `Key order differs at ${formatPath(c.path)}`
    : `${KIND_LABEL[c.kind]} ${formatPath(c.path)}${c.left ? ': ' + valueText(c.left) : ''}${c.right ? (c.left ? ' → ' : ': ') + valueText(c.right) : ''}`;

const matches = (c: Change, f: Filter) => f === 'all' || c.kind === f || (f === 'changed' && c.kind === 'type');

const Row = memo(function Row({ c, i, sel }: { c: Change; i: number; sel: boolean }) {
  const kind = c.kind;
  let vals;
  if (c.order) vals = <span className="cmp-note">key order differs</span>;
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
      aria-label={describe(c)}
    >
      <span className="cmp-mark" aria-hidden="true">
        {KIND_MARK[kind]}
      </span>
      <span className="cmp-body" aria-hidden="true">
        <span className="cmp-path">{formatPath(c.path)}</span>
        <span className="cmp-vals">{vals}</span>
      </span>
    </div>
  );
});

function CompareView({ leftText, indent, onJump }: CompareViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const noteTimer = useRef(0);

  const [right, setRight] = useState(mem.right);
  const [fileName, setFileName] = useState(mem.fileName);
  const [ignoreText, setIgnoreText] = useState(mem.ignore);
  const [opts, setOpts] = useState<Opts>(mem.opts);
  const [swapped, setSwapped] = useState(mem.swapped);
  const [edPct, setEdPct] = useState(mem.edPct);
  const [filter, setFilter] = useState<Filter>('all');
  const [selState, setSelState] = useState<{ list: Change[]; i: number }>({ list: EMPTY, i: -1 });
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [dropping, setDropping] = useState(false);
  const [note, setNote] = useState('');
  const [leftDeb, setLeftDeb] = useState(leftText);

  // Debounce the host document; heavy work below runs on deferred values so
  // typing and toggles stay responsive.
  useEffect(() => {
    if (leftText === leftDeb) return;
    const t = window.setTimeout(() => setLeftDeb(leftText), DEBOUNCE);
    return () => window.clearTimeout(t);
  }, [leftText, leftDeb]);

  useEffect(() => {
    const tm = timer;
    const nt = noteTimer;
    return () => {
      window.clearTimeout(tm.current);
      window.clearTimeout(nt.current);
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setViewH(entries[0].contentRect.height || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dLeft = useDeferredValue(leftDeb);
  const dRight = useDeferredValue(right);
  const dIgnore = useDeferredValue(ignoreText);
  const dOpts = useDeferredValue(opts);
  const dSwapped = useDeferredValue(swapped);
  const stale = dLeft !== leftText || dRight !== right || dIgnore !== ignoreText || dOpts !== opts || dSwapped !== swapped;

  const lp = useMemo(() => (dLeft.trim() ? parse(dLeft) : null), [dLeft]);
  const rp = useMemo(() => (dRight.trim() ? parse(dRight) : null), [dRight]);
  const rLines = useMemo(() => new LineMap(dRight), [dRight]);
  const ignoreKey = useMemo(() => parseIgnoreList(dIgnore).join('\n'), [dIgnore]);

  const result = useMemo<DiffResult | null>(() => {
    if (!lp?.root || !rp?.root) return null;
    const o = { ignoreKeyOrder: dOpts.keyOrder, ignoreArrayOrder: dOpts.arrayOrder, caseInsensitiveStrings: dOpts.ci, ignorePaths: ignoreKey ? ignoreKey.split('\n') : [] };
    return dSwapped ? diff(rp.root, lp.root, o) : diff(lp.root, rp.root, o);
  }, [lp, rp, dOpts, ignoreKey, dSwapped]);

  const sum = result?.summary;
  const changedCount = sum ? sum.changed + sum.type : 0;
  // a filter whose kind no longer occurs falls back to everything
  const eff: Filter = filter === 'all' || !sum ? 'all' : (filter === 'changed' ? changedCount : sum[filter]) ? filter : 'all';

  const shown = useMemo(() => {
    if (!result) return EMPTY;
    return eff === 'all' ? result.changes : result.changes.filter((c) => matches(c, eff));
  }, [result, eff]);

  const sel = selState.list === shown && selState.i < shown.length ? selState.i : -1;
  const n = shown.length;

  // ── actions ──

  /** The main editor's side of a change (it's the "right" side when swapped). */
  const mainOffset = (c: Change) => (dSwapped ? rightOffset(c) : leftOffset(c));

  const flash = (msg: string) => {
    window.clearTimeout(noteTimer.current);
    setNote(msg);
    noteTimer.current = window.setTimeout(() => setNote(''), 2600);
  };

  const revealInCompare = (c: Change) => {
    const ta = taRef.current;
    if (!ta || right !== dRight) return; // offsets would be stale
    const own = dSwapped ? c.left : c.right;
    const node = own ?? (dSwapped ? c.leftParent : c.rightParent);
    if (!node) return;
    const line = rLines.line(node.s);
    ta.scrollTop = Math.max(0, (line - 1) * LINE_H - ta.clientHeight / 3);
    ta.setSelectionRange(node.s, own ? node.e : node.s);
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
    revealInCompare(c);
    if (jump) onJump?.(mainOffset(c));
  };

  const commit = (text: string, name = '') => {
    window.clearTimeout(timer.current);
    const ta = taRef.current;
    if (ta && ta.value !== text) ta.value = text;
    mem.right = text;
    mem.fileName = name;
    setRight(text);
    setFileName(name);
  };

  const onInput = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const v = taRef.current?.value ?? '';
      mem.right = v;
      setRight(v);
    }, DEBOUNCE);
  };

  const loadFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then(
      (t) => commit(t, f.name),
      () => flash(`Couldn't read ${f.name}`),
    );
  };

  const format = () => {
    const text = taRef.current?.value ?? right;
    if (!text.trim()) return;
    const res = parse(text);
    if (!res.root) {
      flash('Fix the error first, then format');
      return;
    }
    commit(formatDoc(text, res, indent), fileName);
  };

  const paste = () => {
    const blocked = () => {
      flash('Clipboard access was blocked. Paste with Ctrl+V / ⌘V');
      taRef.current?.focus();
    };
    if (!navigator.clipboard?.readText) return blocked();
    navigator.clipboard.readText().then((t) => (t ? commit(t) : taRef.current?.focus()), blocked);
  };

  const gotoRightError = () => {
    const ta = taRef.current;
    if (!ta || !rp?.error) return;
    ta.focus();
    ta.setSelectionRange(rp.error.p, rp.error.p);
    ta.scrollTop = Math.max(0, (rLines.line(rp.error.p) - 1) * LINE_H - ta.clientHeight / 3);
  };

  const setOpt = (k: keyof Opts) => {
    const next = { ...opts, [k]: !opts[k] };
    mem.opts = next;
    setOpts(next);
  };

  const swap = () => {
    mem.swapped = !swapped;
    setSwapped(!swapped);
  };

  const copyPatch = () => {
    if (!result) return;
    const ops = toPatch(result.changes);
    const text = patchText(ops, indent);
    if (!navigator.clipboard?.writeText) return flash('Copy failed: clipboard access was blocked');
    navigator.clipboard.writeText(text).then(
      () => flash(result.truncated ? 'Copied, but incomplete: too many differences' : `JSON Patch copied (${ops.length.toLocaleString()} operation${ops.length === 1 ? '' : 's'})`),
      () => flash('Copy failed: clipboard access was blocked'),
    );
  };

  const toggleFilter = (f: Filter) => setFilter(eff === f ? 'all' : f);

  // ── list events (delegated: rows carry data-i) ──

  const rowAt = (e: ReactMouseEvent) => {
    const row = (e.target as HTMLElement).closest('[data-i]');
    return row ? Number(row.getAttribute('data-i')) : -1;
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const page = Math.max(1, Math.floor(viewH / ROW_H) - 1);
    let i: number;
    switch (e.key) {
      case 'ArrowDown':
        i = sel < 0 ? 0 : Math.min(n - 1, sel + 1);
        break;
      case 'ArrowUp':
        i = sel < 0 ? 0 : Math.max(0, sel - 1);
        break;
      case 'PageDown':
        i = Math.min(n - 1, Math.max(0, sel) + page);
        break;
      case 'PageUp':
        i = Math.max(0, sel - page);
        break;
      case 'Home':
        i = 0;
        break;
      case 'End':
        i = n - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (sel >= 0) select(sel, true);
        return;
      default:
        return;
    }
    e.preventDefault();
    select(i, false);
  };

  // ── drag & drop (kept away from the host's "open file" drop zone) ──

  const hasFiles = (e: ReactDragEvent) => e.dataTransfer.types.includes('Files');
  const onDrag = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragover') e.dataTransfer.dropEffect = 'copy';
    else if (e.type === 'dragenter') setDropping(true);
    else if (e.type === 'dragleave' && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    loadFile(e.dataTransfer.files[0]);
  };

  // ── editor / results split ──

  const setSplit = (pct: number) => {
    const v = Math.min(80, Math.max(12, pct));
    rootRef.current?.style.setProperty('--cmp-ed', `${v}%`);
    return v;
  };
  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const root = rootRef.current;
    if (!root) return;
    el.setPointerCapture(e.pointerId);
    const rect = root.getBoundingClientRect();
    let pct = edPct;
    const move = (ev: PointerEvent) => {
      pct = setSplit(((ev.clientY - rect.top) / rect.height) * 100);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      mem.edPct = pct;
      setEdPct(pct);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onSplitKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowUp' ? -4 : e.key === 'ArrowDown' ? 4 : 0;
    if (!d) return;
    e.preventDefault();
    const v = setSplit(edPct + d);
    mem.edPct = v;
    setEdPct(v);
  };

  // ── render ──

  const first = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
  const last = Math.min(n, Math.ceil((scroll + viewH) / ROW_H) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) rows.push(<Row key={i} c={shown[i]} i={i} sel={i === sel} />);

  const rErr = rp?.error ?? null;
  const lErr = lp?.error ?? null;
  const roleOfRight = dSwapped ? 'Original' : 'Modified';

  let empty: ReactNode = null;
  if (!right.trim()) {
    empty = (
      <div className="cmp-empty">
        <Icon name="diff" size={22} />
        <p>
          <b>Compare two JSON documents</b>
          <br />
          Paste, drop or open the second document above. It is compared with the JSON in the editor.
        </p>
        <ul>
          <li>Arrays are matched by content or by id, so an insertion is one change</li>
          <li>Ignore key order, array order, case or specific paths</li>
          <li>Copy the differences as a JSON Patch (RFC 6902)</li>
        </ul>
      </div>
    );
  } else if (!leftText.trim()) {
    empty = (
      <div className="cmp-empty">
        <Icon name="file" size={22} />
        <p>Add the original JSON in the editor to compare.</p>
      </div>
    );
  } else if (lErr) {
    const lm = new LineMap(dLeft);
    empty = (
      <div className="cmp-empty err">
        <Icon name="alert" size={22} />
        <p>
          The editor&apos;s JSON is invalid (Ln {lm.line(lErr.p)}, Col {lm.col(lErr.p)}): {lErr.m}
        </p>
        {onJump && (
          <button type="button" className="btn sm" onClick={() => onJump(lErr.p)}>
            Go to error
          </button>
        )}
      </div>
    );
  } else if (rErr) {
    empty = (
      <div className="cmp-empty err">
        <Icon name="alert" size={22} />
        <p>Fix the JSON above to see the differences.</p>
      </div>
    );
  } else if (result?.error) {
    empty = (
      <div className="cmp-empty err">
        <Icon name="alert" size={22} />
        <p>{result.error}</p>
      </div>
    );
  } else if (result && !result.changes.length) {
    empty = (
      <div className="cmp-empty ok">
        <Icon name="check" size={22} />
        <p>
          <b>No differences</b>
          <br />
          {dLeft === dRight
            ? 'The documents are identical.'
            : `The documents are equivalent${dOpts.arrayOrder || dOpts.ci || ignoreKey ? ' (with the ignore options above)' : ''}.`}
        </p>
      </div>
    );
  }

  const live = sel >= 0 ? `${sel + 1} of ${n}: ${describe(shown[sel])}` : sum ? `${sum.added} added, ${sum.removed} removed, ${changedCount} changed` : '';

  return (
    <div ref={rootRef} className="cmp" style={{ '--cmp-ed': `${edPct}%` } as CSSProperties}>
      <section
        className={`cmp-src${dropping ? ' drop' : ''}`}
        aria-label="JSON to compare"
        onDragEnter={onDrag}
        onDragOver={onDrag}
        onDragLeave={onDrag}
        onDrop={onDrop}
      >
        <div className="cmp-bar" role="toolbar" aria-label="Compared document">
          <span className={`cmp-role${dSwapped ? ' orig' : ''}`}>{roleOfRight}</span>
          {fileName && (
            <span className="cmp-fname" title={fileName}>
              {fileName}
            </span>
          )}
          <span className="grow" />
          <button type="button" className="btn sm icon" aria-label="Paste" data-tip="Paste" onClick={paste}>
            <Icon name="paste" size={15} />
          </button>
          <button type="button" className="btn sm icon" aria-label="Open file" data-tip="Open file" onClick={() => fileRef.current?.click()}>
            <Icon name="open" size={15} />
          </button>
          <button type="button" className="btn sm" data-tip="Beautify this document" onClick={format}>
            <Icon name="format" size={15} />
            <span className="cmp-lbl">Format</span>
          </button>
          <button type="button" className="btn sm icon" aria-label="Clear" data-tip="Clear" onClick={() => commit('')}>
            <Icon name="trash" size={15} />
          </button>
        </div>
        <textarea
          ref={taRef}
          className="cmp-ta"
          defaultValue={mem.right}
          onInput={onInput}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          aria-label="JSON to compare with the editor"
          aria-invalid={rErr ? true : undefined}
          placeholder={'Paste the JSON to compare with…'}
        />
        {rErr && (
          <button type="button" className="cmp-err" onClick={gotoRightError}>
            <Icon name="alert" size={14} />
            <b>Invalid JSON</b>
            <span>
              Ln {rLines.line(rErr.p)}, Col {rLines.col(rErr.p)}: {rErr.m}
            </span>
          </button>
        )}
        {!rErr && rp && rp.issues.length > 0 && (
          <div className="cmp-warn">
            <Icon name="wand" size={14} />
            Not strict JSON, compared as repaired ({rp.issues.length} issue{rp.issues.length > 1 ? 's' : ''})
          </div>
        )}
      </section>

      <div
        className="cmp-split"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize compared document"
        aria-valuenow={Math.round(edPct)}
        aria-valuemin={12}
        aria-valuemax={80}
        tabIndex={0}
        onPointerDown={onSplitDown}
        onKeyDown={onSplitKey}
      />

      <section className={`cmp-res${stale ? ' stale' : ''}`} aria-label="Differences">
        <div className="cmp-sum">
          {sum ? (
            <>
              <button
                type="button"
                className="cmp-chip cmp-k-added"
                aria-pressed={eff === 'added'}
                aria-label={`${sum.added} added: show only additions`}
                disabled={!sum.added}
                data-tip="Show only additions"
                onClick={() => toggleFilter('added')}
              >
                +{sum.added.toLocaleString()}
                <span className="cmp-lbl">added</span>
              </button>
              <button
                type="button"
                className="cmp-chip cmp-k-removed"
                aria-pressed={eff === 'removed'}
                aria-label={`${sum.removed} removed: show only removals`}
                disabled={!sum.removed}
                data-tip="Show only removals"
                onClick={() => toggleFilter('removed')}
              >
                {'\u2212'}
                {sum.removed.toLocaleString()}
                <span className="cmp-lbl">removed</span>
              </button>
              <button
                type="button"
                className="cmp-chip cmp-k-changed"
                aria-pressed={eff === 'changed'}
                aria-label={`${changedCount} changed: show only changes`}
                disabled={!changedCount}
                data-tip={sum.type ? `Show only changes (${sum.type} type change${sum.type > 1 ? 's' : ''})` : 'Show only changes'}
                onClick={() => toggleFilter('changed')}
              >
                ~{changedCount.toLocaleString()}
                <span className="cmp-lbl">changed</span>
              </button>
            </>
          ) : (
            <span className="cmp-title">Differences</span>
          )}
          {result?.truncated && <span className="cmp-trunc">first {result.changes.length.toLocaleString()}</span>}
          <span className="grow" />
          <button type="button" className="btn sm icon" aria-label="Previous difference" data-tip="Previous" disabled={!n} onClick={() => select(sel < 0 ? n - 1 : Math.max(0, sel - 1), true)}>
            <Icon name="up" size={15} />
          </button>
          <button type="button" className="btn sm icon" aria-label="Next difference" data-tip="Next" disabled={!n} onClick={() => select(sel < 0 ? 0 : Math.min(n - 1, sel + 1), true)}>
            <Icon name="down" size={15} />
          </button>
          <button type="button" className="btn sm icon" aria-label="Swap original and modified" data-tip="Swap original ⇄ modified" onClick={swap}>
            <Icon name="swap" size={15} />
          </button>
          <button type="button" className="btn sm" disabled={!result || !!result.error} data-tip="RFC 6902 patch: original → modified" onClick={copyPatch}>
            <Icon name="copy" size={15} />
            <span className="cmp-lbl">JSON Patch</span>
          </button>
        </div>

        <div className="cmp-opts" role="group" aria-label="Comparison options">
          <button type="button" className="cmp-opt" aria-pressed={opts.keyOrder} onClick={() => setOpt('keyOrder')}>
            <Icon name="check" size={13} />
            Ignore key order
          </button>
          <button type="button" className="cmp-opt" aria-pressed={opts.arrayOrder} onClick={() => setOpt('arrayOrder')}>
            <Icon name="check" size={13} />
            Ignore array order
          </button>
          <button type="button" className="cmp-opt" aria-pressed={opts.ci} onClick={() => setOpt('ci')}>
            <Icon name="check" size={13} />
            Ignore case
          </button>
          <input
            className="cmp-ign"
            type="text"
            value={ignoreText}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              mem.ignore = e.target.value;
              setIgnoreText(e.target.value);
            }}
            placeholder="Ignore paths: updatedAt, $.meta.etag, $.items[*].ts"
            aria-label="Paths to ignore, comma separated"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="cmp-lw">
        <div
          ref={listRef}
          className="cmp-list"
          role="list"
          aria-label={`Differences${n ? ` (${n.toLocaleString()})` : ''}`}
          tabIndex={n ? 0 : -1}
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          onKeyDown={onListKey}
          onClick={(e) => {
            const i = rowAt(e);
            if (i >= 0) select(i, true);
          }}
        >
          <div className="cmp-sizer" role="none" style={{ height: n * ROW_H }}>
            {rows}
          </div>
        </div>
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
      </section>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.geojson,.jsonl,.ndjson,.txt,application/json,text/plain"
        hidden
        onChange={(e) => {
          loadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default memo(CompareView);
