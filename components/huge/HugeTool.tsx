'use client';

/*
 * Huge-file mode's viewer: shown instead of the editor and the normal viewer while a file too big for the
 * editor is open (lib/huge/session.ts). Loaded only then (JsonTool's HugeHost), with its styles
 * (app/huge.css), so the first load carries none of it.
 */
import '@/app/huge.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { act } from '@/lib/engine/instance';
import { useT } from '@/lib/i18n/react';
import { current, type HugeSession } from '@/lib/huge/session';
import type { HugeStore, HugeUI, HugeView } from '@/lib/huge/state';
import type { Portal } from '@/lib/huge/kit';
import { Icon, type IconName } from '../icons';
import { MHead, MItem, MSep, Menu } from '../menu';

function useHuge<T>(store: HugeStore, select: (s: HugeUI) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

const VIEWS: { id: HugeView; label: string }[] = [
  { id: 'format', label: 'Format' },
  { id: 'tree', label: 'Tree' },
  { id: 'table', label: 'Table' },
  { id: 'graph', label: 'Graph' },
  { id: 'convert', label: 'Convert' },
  { id: 'compare', label: 'Compare' },
];

function IconBtn({ icon, label, onClick, on, tip }: { icon: IconName; label: string; onClick: () => void; on?: boolean; tip?: string }) {
  const t = useT();
  return (
    <button type="button" className={`btn icon${on ? ' on' : ''}`} aria-label={t(label)} data-tip={tip ?? t(label)} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

// ── File bar and progress ───────────────────────────────────────────────────

function FileBar({ s }: { s: HugeSession }) {
  const name = useHuge(s.ui, (u) => u.name);
  const size = useHuge(s.ui, (u) => u.size);
  const t = useT();
  return (
    <div className="toolbar hg-file" role="toolbar" aria-label={t('File')}>
      <span className={`fname ${PRIVATE}`} title={name}>
        <Icon name="file" size={14} />
        {name}
        <span className="hg-bytes">{t.bytes(size)}</span>
      </span>
      <span className="hg-badge" data-tip={t('Read a window at a time, so files of any size open. Editing comes later.')}>
        {t('Large file')}
      </span>
      <span className="grow" />
      <button type="button" className="btn" onClick={() => act((e) => e.openFile())} data-tip={t('Open another file')}>
        <Icon name="open" />
        <span className="lbl">{t('Open file')}</span>
      </button>
      <IconBtn icon="x" label="Close file" tip={t('Close the file and go back to the editor')} onClick={() => s.close(true)} />
    </div>
  );
}

/** The index's progress: a thin bar under the file bar while it runs. */
function Progress({ s }: { s: HugeSession }) {
  const { bytes, done, cancelled } = useHuge(s.ui, (u) => u.index);
  const size = useHuge(s.ui, (u) => u.size);
  const t = useT();
  if (done || cancelled) return null;
  const pct = size ? Math.min(100, (bytes / size) * 100) : 0;
  return (
    <div className="hg-bar" role="progressbar" aria-label={t('Indexing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Viewer toolbar ──────────────────────────────────────────────────────────

function Tabs({ s }: { s: HugeSession }) {
  const view = useHuge(s.ui, (u) => u.view);
  const t = useT();
  return (
    <>
      <div
        className="tabs"
        role="tablist"
        aria-label={t('View')}
        onKeyDown={(e) => {
          const i = VIEWS.findIndex((v) => v.id === view);
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          const to = e.key === 'Home' ? 0 : e.key === 'End' ? VIEWS.length - 1 : d ? (i + d + VIEWS.length) % VIEWS.length : -1;
          if (to < 0) return;
          e.preventDefault();
          s.setView(VIEWS[to].id);
          (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
        }}
      >
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            tabIndex={view === v.id ? 0 : -1}
            aria-selected={view === v.id}
            aria-controls={`hg-${v.id}`}
            data-tip={`Alt+${i + 1}`}
            onClick={() => s.setView(v.id)}
          >
            {t(v.label)}
          </button>
        ))}
      </div>
      <label className="pick tabs-pick">
        <span className="sr-only">{t('View')}</span>
        <select value={view} onChange={(e) => s.setView(e.target.value as HugeView)}>
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              {t(v.label)}
            </option>
          ))}
        </select>
        <Icon name="down" size={13} />
      </label>
    </>
  );
}

function ModeSwitch({ s }: { s: HugeSession }) {
  const mode = useHuge(s.ui, (u) => u.mode);
  const t = useT();
  return (
    <div className="seg seg-sm" role="radiogroup" aria-label={t('Output style')}>
      <button type="button" role="radio" aria-checked={mode === 'pretty'} onClick={() => s.setMode('pretty')} data-tip={t('Indented and readable')}>
        {t('Pretty')}
      </button>
      <button type="button" role="radio" aria-checked={mode === 'raw'} onClick={() => s.setMode('raw')} data-tip={t('The file as it is written')}>
        {t('As written')}
      </button>
    </div>
  );
}

function SelPath({ s }: { s: HugeSession }) {
  const sel = useHuge(s.ui, (u) => u.sel);
  const t = useT();
  if (!sel) return <span className="muted sm nowrap">{t('Select a node')}</span>;
  return (
    <button type="button" className={`path ${PRIVATE}`} onClick={() => s.copyPath()} data-tip={t('Copy path')}>
      {sel.path.length > 300 ? sel.path.slice(0, 300) + '…' : sel.path}
    </button>
  );
}

function TableWhere({ s }: { s: HugeSession }) {
  const { path, rows, cols, ok } = useHuge(s.ui, (u) => u.table);
  const t = useT();
  if (!ok) return <span className="muted sm">{t('Select an array or object')}</span>;
  return (
    <nav className={`crumbs ${PRIVATE}`} aria-label={t('Table location')}>
      {s.tablePath.length > 0 && (
        <button type="button" onClick={() => void s.tableGoto([])}>
          $
        </button>
      )}
      <span className="hg-tpath" title={path}>
        {s.tablePath.length ? path.slice(1) : '$'}
      </span>
      <span className="muted sm dims">
        {t.num(rows)} × {t.num(cols)}
      </span>
    </nav>
  );
}

function ViewBar({ s }: { s: HugeSession }) {
  const view = useHuge(s.ui, (u) => u.view);
  const findOpen = useHuge(s.ui, (u) => u.find.open);
  const t = useT();
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  const browse = view === 'format' || view === 'tree' || view === 'table';
  return (
    <div className="toolbar vbar" role="toolbar" aria-label={t('Viewer')}>
      <Tabs s={s} />
      <span className="grow" />
      <div className="vmain">
        {view === 'format' && <ModeSwitch s={s} />}
        {view === 'tree' && <SelPath s={s} />}
        {view === 'table' && <TableWhere s={s} />}
      </div>
      {browse && (
        <div className="vicons">
          <IconBtn icon="search" label={`${t('Find')}${t(' · ')}${mod}F`} on={findOpen} onClick={() => (findOpen ? s.closeFind() : s.openFind())} />
          <IconBtn icon="copy" label="Copy value" onClick={() => void s.copyValue()} />
          <IconBtn icon="download" label="Save value as file" onClick={() => s.saveValue()} />
          <Menu label="More options">
            {(close) => (
              <>
                <MHead>Large file</MHead>
                <MItem label={view === 'format' ? 'Go to line…' : view === 'table' ? 'Go to row…' : 'Go to path…'} keys="mod+G" onClick={() => s.openAsk()} close={close} />
                {view !== 'format' && (
                  <>
                    <MItem label="Copy path" keys="P" onClick={() => s.copyPath()} close={close} />
                    <MItem label="Copy value" keys="C" onClick={() => void s.copyValue()} close={close} />
                  </>
                )}
                <MItem label="Save value as file" keys="mod+S" onClick={() => s.saveValue()} close={close} />
                <MSep />
                <MItem label="Open file" keys="mod+O" onClick={() => act((e) => e.openFile())} close={close} />
                <MItem label="Close file" onClick={() => s.close(true)} close={close} />
              </>
            )}
          </Menu>
        </div>
      )}
    </div>
  );
}

// ── Banner, Find and Go to ──────────────────────────────────────────────────

/** The normal path's banner: an error, or a fixable issue (several top-level values, for one), once known. */
function ErrorBanner({ s }: { s: HugeSession }) {
  useHuge(s.ui, (u) => u.index);
  const p = s.problem();
  const t = useT();
  if (!p || p.kind === 'warning') return null;
  const err = p.kind === 'error';
  return (
    <div className={`banner ${err ? 'err' : 'warn'}`} role="status" aria-live="polite">
      <Icon name="alert" size={15} />
      <button type="button" className="b-msg" onClick={() => void s.gotoError()}>
        <b>{err ? t('Invalid JSON') : t('Not strict JSON')}</b>
        <span>{t('Ln {line}, Col {col}: {msg}', { line: t.num(p.line), col: t.num(p.col), msg: t.msg(p.msg) })}</span>
      </button>
      <button type="button" className="btn sm" onClick={() => void s.gotoError()}>
        {t('Go to error')}
      </button>
    </div>
  );
}

/** Find in the file (Ctrl+F): each opening is a new bar, its query selected. */
function FindBar({ s }: { s: HugeSession }) {
  const open = useHuge(s.ui, (u) => u.find.open && (u.view === 'format' || u.view === 'tree' || u.view === 'table'));
  const seq = useHuge(s.ui, (u) => u.find.seq);
  return open ? <FindInput key={seq} s={s} /> : null;
}

function FindInput({ s }: { s: HugeSession }) {
  const f = useHuge(s.ui, (u) => u.find);
  const view = useHuge(s.ui, (u) => u.view);
  const t = useT();
  const [text, setText] = useState(f.q);
  const timer = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => window.clearTimeout(timer.current);
  }, []);
  const run = (v: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => s.runFind(v), v.length > 2 ? 150 : 250);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.clearTimeout(timer.current);
      if (text !== f.q) s.runFind(text);
      else s.findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      window.clearTimeout(timer.current);
      s.closeFind();
      document.querySelector<HTMLElement>(`#hg-${view} .hg-focus, #hg-${view}`)?.focus();
    }
  };
  const total = f.more ? t('{n}+', { n: t.num(f.total) }) : t.num(f.total);
  let count = '';
  if (text && text === f.q) {
    if (f.total) count = t('{i} of {total}', { i: f.index >= 0 ? t.num(f.index + 1) : '–', total: f.done ? total : t('{n}+', { n: t.num(f.total) }) });
    else count = f.done ? t('No results') : '';
  }
  return (
    <div className="findbar" role="search">
      <Icon name="search" size={14} />
      <input
        ref={input}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          run(e.target.value);
        }}
        onKeyDown={onKey}
        placeholder={t(view === 'tree' || view === 'table' ? 'Find, or $.path' : 'Find')}
        aria-label={t('Find in file')}
        spellCheck={false}
        autoComplete="off"
      />
      <span className={`count ${PRIVATE}`} aria-live="polite">
        {count}
        {text && text === f.q && !f.done && <span className="hg-searching"> {t('searching {percent}', { percent: Math.floor(f.read * 100) + '%' })}</span>}
      </span>
      <button type="button" className="btn icon sm" aria-label={t('Previous match')} onClick={() => s.findStep(-1)}>
        <Icon name="up" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label={t('Next match')} onClick={() => s.findStep(1)}>
        <Icon name="down" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label={t('Close find')} onClick={() => s.closeFind()}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function AskBar({ s }: { s: HugeSession }) {
  const ask = useHuge(s.ui, (u) => u.ask);
  const view = useHuge(s.ui, (u) => u.view);
  const t = useT();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  if (!ask) return null;
  const label =
    ask.kind === 'line'
      ? t('Go to line (1 to {max})', { max: t.num(ask.max) })
      : ask.kind === 'row'
        ? t('Go to row (0 to {max})', { max: t.num(Math.max(0, ask.max - 1)) })
        : ask.kind === 'index'
          ? t('Go to index (0 to {max})', { max: t.num(Math.max(0, ask.max - 1)) + (ask.partial ? '+' : '') })
          : t('Go to path, such as $.users[0].name');
  const close = () => {
    s.closeAsk();
    document.querySelector<HTMLElement>(`#hg-${view}`)?.focus();
  };
  return (
    <div className="findbar hg-ask" role="search">
      <Icon name="path" size={14} />
      <input
        autoFocus
        className={bad ? 'bad' : undefined}
        value={text}
        inputMode={ask.kind === 'path' ? 'text' : 'numeric'}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (s.answer(text)) close();
            else setBad(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        placeholder={label}
        aria-label={label}
        aria-invalid={bad}
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="btn icon sm" aria-label={t('Close')} onClick={close}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Views ───────────────────────────────────────────────────────────────────

/** Mounts a view on its element while the element exists. */
function useMount(mount: (el: HTMLElement) => () => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    return mount(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function FormatView({ s, hidden }: { s: HugeSession; hidden: boolean }) {
  const mode = useHuge(s.ui, (u) => u.mode);
  const t = useT();
  const ref = useMount((el) => s.mountLines(el), [mode]);
  return (
    <div id="hg-format" key={mode} className="cv hg-lines" ref={ref} hidden={hidden} tabIndex={0} aria-label={t(mode === 'pretty' ? 'Formatted output' : 'The file as it is written')}>
      <div className="cv-sizer">
        <div className="cv-rows" />
      </div>
    </div>
  );
}

/** Where the tree or the table would be when no value could be read (the error comes before any). */
function NoRoot({ hidden }: { hidden: boolean }) {
  const t = useT();
  return (
    <div className="hg-notyet" hidden={hidden}>
      <b>{t('No value could be read before the error')}</b>
      <p>{t('The Format view shows the file as it is written, with the error marked.')}</p>
    </div>
  );
}

function TreeView({ s, hidden }: { s: HugeSession; hidden: boolean }) {
  const t = useT();
  const noRoot = useHuge(s.ui, (u) => u.noRoot && u.index.done);
  const ref = useMount((el) => s.mountTree(el), []);
  if (noRoot) return <NoRoot hidden={hidden} />;
  return (
    <div id="hg-tree" className="tv" ref={ref} tabIndex={0} role="tree" aria-label={t('JSON tree')} hidden={hidden}>
      <div className="tv-sizer">
        <div className="tv-rows" />
        <div className="tv-acts" hidden>
          <button type="button" data-a="value" aria-label={t('Copy value')} data-tip={t('Copy value')}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" data-a="path" aria-label={t('Copy path')} data-tip={t('Copy path')}>
            <Icon name="path" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TableView({ s, hidden }: { s: HugeSession; hidden: boolean }) {
  const t = useT();
  const noRoot = useHuge(s.ui, (u) => u.noRoot && u.index.done);
  const ref = useMount((el) => s.mountTable(el), []);
  if (noRoot) return <NoRoot hidden={hidden} />;
  return (
    <div id="hg-table" className="tbl" ref={ref} hidden={hidden}>
      <div className="tb-head" role="row" aria-rowindex={1} />
      <div className="tb-sizer" role="none">
        <div className="tb-rows" role="none" />
      </div>
      <div className="tb-empty" hidden>
        {t('Select an array or object in the tree to see it as a table.')}
      </div>
    </div>
  );
}

/** Graph, Convert and Compare: not for files this big yet, said kindly, with where to go instead. */
function NotYet({ s, view }: { s: HugeSession; view: 'graph' | 'convert' | 'compare' }) {
  const t = useT();
  const copy = {
    graph: [t('The graph of a file this large is on its way'), t('It will draw the part you are exploring. Until then, the tree shows every value, a page at a time.')],
    convert: [t('Converting a file this large is on its way'), t('It will write the result straight to a file. Until then, select a value in the tree and copy or save it.')],
    compare: [t('Compare works with documents up to 300 MB'), t('To compare parts of this file, save a value as a file and open it in another tab.')],
  }[view];
  return (
    <div id={`hg-${view}`} className="hg-notyet" tabIndex={-1}>
      <Icon name={view === 'graph' ? 'tree' : view === 'convert' ? 'code' : 'diff'} size={22} />
      <b>{copy[0]}</b>
      <p>{copy[1]}</p>
      <button type="button" className="btn" onClick={() => s.setView('tree')}>
        <Icon name="tree" size={14} />
        <span className="lbl">{t('Open the tree')}</span>
      </button>
    </div>
  );
}

// ── Status bar ──────────────────────────────────────────────────────────────

function Status({ s }: { s: HugeSession }) {
  const st = useHuge(s.ui, (u) => u.index);
  const size = useHuge(s.ui, (u) => u.size);
  const eta = useHuge(s.ui, (u) => u.eta);
  const took = useHuge(s.ui, (u) => u.took);
  const t = useT();
  if (!st.done && !st.cancelled) {
    return (
      <span className="st muted hg-st">
        <i className="spin" />
        <span className="st-msg">
          {t('Indexing {done} of {size}', { done: t.bytes(st.bytes), size: t.bytes(size) })}
          {eta !== null && eta >= 1 && <span className="st-pct"> {t('· ~{time} left', { time: t.dur(Math.ceil(eta)) })}</span>}
        </span>
        <button type="button" className="st-link hg-cancel" onClick={() => s.cancel()} data-tip={s.canStop ? t('Stop indexing: what is read so far stays open') : t('Stop and close the file')} data-tip-up="">
          {t('Cancel')}
        </button>
      </span>
    );
  }
  const p = s.problem();
  if (p && p.kind !== 'warning') {
    return (
      <button type="button" className={`st st-link ${p.kind === 'error' ? 'err' : 'warn'}`} onClick={() => void s.gotoError()} title={t('Go to error')}>
        <i className="dot" />
        <span className="st-msg">{t('Ln {line}, Col {col}: {msg}', { line: t.num(p.line), col: t.num(p.col), msg: t.msg(p.msg) })}</span>
      </button>
    );
  }
  const stats = (
    <span className="stats muted" title={took !== null ? t('Indexed in {time}', { time: t.dur(Math.max(1, Math.round(took / 1000))) }) : undefined}>
      {t.n(st.lines, '{n} line', '{n} lines')} · {t.n(st.nodes, '{n} node', '{n} nodes')} · {t('depth {depth}', { depth: st.depth })}
    </span>
  );
  if (st.cancelled) {
    return (
      <>
        <span className="st warn">
          <i className="dot" />
          <span className="st-msg">{t('Indexing stopped at {done} of {size}', { done: t.bytes(st.bytes), size: t.bytes(size) })}</span>
        </span>
        {stats}
      </>
    );
  }
  return (
    <>
      <span className="st ok" title={st.jsonl ? t('One JSON value per line, shown as an array of records') : undefined}>
        <i className="dot" />
        <span className="st-msg">{st.jsonl ? t.n(st.records, 'JSON Lines · {n} record', 'JSON Lines · {n} records') : t('Valid JSON')}</span>
        {st.status && st.status.warnings > 0 && (
          <button type="button" className="st-link warn" onClick={() => void s.gotoError()} title={st.status.msg ? t.msg(st.status.msg) : undefined}>
            · {st.status.more ? t('{n}+ duplicate keys', { n: t.num(st.status.warnings) }) : t.n(st.status.warnings, '{n} duplicate key', '{n} duplicate keys')}
          </button>
        )}
      </span>
      <span className="sz sz-raw">
        {t.bytes(size)} <i>{t('raw')}</i>
      </span>
      {stats}
    </>
  );
}

/** The status, in the tool's own status bar (`bar`). */
function StatusPortal({ s, bar, portal }: { s: HugeSession; bar: HTMLElement | null; portal: Portal }) {
  return bar ? portal(<div className={`sb-l hg-sb ${PRIVATE}`}>{<Status s={s} />}</div>, bar) : null;
}

// ── Root ────────────────────────────────────────────────────────────────────

function HugePane({ s, paneRef }: { s: HugeSession; paneRef: (el: HTMLElement | null) => void }) {
  const view = useHuge(s.ui, (u) => u.view);
  const t = useT();
  // Views are made the first time they are shown, then kept (their place, what is open).
  const [seen, setSeen] = useState<Set<HugeView>>(() => new Set([view]));
  if (!seen.has(view)) setSeen(new Set(seen).add(view));
  return (
    <section className="pane hg" aria-label={t('Large file')} ref={paneRef}>
      <FileBar s={s} />
      <Progress s={s} />
      <ViewBar s={s} />
      <div className={`view ${PRIVATE}`}>
        <ErrorBanner s={s} />
        <FindBar s={s} />
        <AskBar s={s} />
        {seen.has('format') && <FormatView s={s} hidden={view !== 'format'} />}
        {seen.has('tree') && <TreeView s={s} hidden={view !== 'tree'} />}
        {seen.has('table') && <TableView s={s} hidden={view !== 'table'} />}
        {(view === 'graph' || view === 'convert' || view === 'compare') && <NotYet s={s} view={view} />}
      </div>
    </section>
  );
}

export default function HugeTool({ portal }: { portal: Portal }) {
  const [s] = useState(() => current);
  // The tool's own status bar (pages left keep theirs in the document, hidden).
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const paneRef = useCallback((el: HTMLElement | null) => {
    if (el) setBar(el.closest('.app')?.querySelector<HTMLElement>('.statusbar') ?? null);
  }, []);
  useLayoutEffect(() => {
    if (!s) return;
    document.documentElement.dataset.huge = '';
    // The open view takes the keys.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#hg-${s.ui.get().view}`)?.focus({ preventScroll: true }));
    return () => {
      delete document.documentElement.dataset.huge;
    };
  }, [s]);
  if (!s || s.closed) return null;
  return (
    <>
      <HugePane s={s} paneRef={paneRef} />
      <StatusPortal s={s} bar={bar} portal={portal} />
    </>
  );
}
