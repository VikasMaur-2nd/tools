'use client';

import dynamic from 'next/dynamic';
import { memo, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Engine } from '@/lib/engine/engine';
import { act, getEngine, setEngine } from '@/lib/engine/instance';
import { store, useUI, type IndentId, type View } from '@/lib/engine/store';
import { TARGETS, targetInfo } from '@/lib/engine/targets';
import { formatBytes } from '@/lib/json/format';
import { Icon, type IconName } from './icons';
import { Kbd } from './Kbd';
import { CommandPalette, ShortcutsDialog } from './dialogs';

function Btn({
  icon,
  label,
  tip,
  onClick,
  variant,
  hideLabel,
  up,
}: {
  icon: IconName;
  label: string;
  tip?: string;
  onClick: () => void;
  variant?: 'primary' | 'accent';
  hideLabel?: boolean;
  up?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn${variant ? ' ' + variant : ''}${hideLabel ? ' icon' : ''}`}
      onClick={onClick}
      aria-label={hideLabel ? label : undefined}
      data-tip={tip ?? (hideLabel ? label : undefined)}
      data-tip-up={up ? '' : undefined}
    >
      <Icon name={icon} />
      {!hideLabel && <span className="lbl">{label}</span>}
    </button>
  );
}

// ── Editor pane ─────────────────────────────────────────────────────────────

/** Input side: only what concerns the input itself. Everything that transforms it lives on the right. */
const InputBar = memo(function InputBar() {
  const fileName = useUI((s) => s.fileName);
  const mac = useUI((s) => s.mac);
  const mod = mac ? '⌘' : 'Ctrl+';
  return (
    <div className="toolbar" role="toolbar" aria-label="Input">
      <span className="fname" title={fileName ?? undefined}>
        {fileName ? (
          <>
            <Icon name="file" size={14} />
            {fileName}
          </>
        ) : (
          'Input'
        )}
      </span>
      <span className="grow" />
      <Btn icon="paste" label="Paste" hideLabel onClick={() => act((e) => e.paste())} />
      <Btn icon="open" label={`Open file · ${mod}O`} hideLabel onClick={() => act((e) => e.openFile())} />
      <Btn icon="trash" label="Clear" hideLabel onClick={() => act((e) => e.clear())} />
    </div>
  );
});

function ViewNotice() {
  const viewOnly = useUI((s) => s.viewOnly);
  const bytes = useUI((s) => s.stats?.bytes ?? 0);
  if (!viewOnly) return null;
  return (
    <div className="ed-notice" role="status">
      <Icon name="lock" size={13} />
      <span>
        Large document{bytes ? ` (${formatBytes(bytes)})` : ''} is read-only for speed. Everything on the right still works.
      </span>
      <button type="button" className="btn sm" onClick={() => act((e) => e.editAnyway())}>
        Edit anyway
      </button>
    </div>
  );
}

function EditorPane({ edRef }: { edRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <section className="pane pane-ed" aria-label="JSON input">
      <InputBar />
      <ViewNotice />
      <div className="ed" ref={edRef}>
        <div className="ed-gut" aria-hidden="true">
          <div className="ed-gl" />
        </div>
        <div className="ed-body">
          <div className="ed-scope" />
          <div className="ed-cur" />
          <div className="ed-hl" aria-hidden="true" />
          <textarea
            id="input"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            wrap="off"
            autoFocus
            aria-label="JSON input"
            placeholder="Looks like someone's got a JSON…"
          />
        </div>
      </div>
    </section>
  );
}

// ── Viewer pane ─────────────────────────────────────────────────────────────

function SearchBox({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { q, total, index } = useUI((s) => s.search);
  const timer = useRef(0);

  const onInput = () => {
    window.clearTimeout(timer.current);
    const v = inputRef.current?.value ?? '';
    timer.current = window.setTimeout(() => act((e) => e.search(v)), v.length > 2 ? 90 : 160);
  };
  const onKey = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      window.clearTimeout(timer.current);
      const v = ev.currentTarget.value;
      act((e) => e.searchSubmit(v, ev.shiftKey ? -1 : 1));
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      window.clearTimeout(timer.current);
      const el = ev.currentTarget;
      if (el.value) {
        el.value = '';
        act((e) => e.search(''));
      } else act((e) => e.focusTree());
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      act((e) => e.focusTree());
    }
  };
  return (
    <div className="search">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search keys, values or $.path"
        aria-label="Search keys and values"
        onInput={onInput}
        onKeyDown={onKey}
        spellCheck={false}
        autoComplete="off"
      />
      {q ? (
        <>
          <span className="count" aria-live="polite">
            {total ? `${index + 1}/${total >= 100000 ? '100k+' : total}` : 'No matches'}
          </span>
          <button type="button" className="btn icon sm" aria-label="Previous match" onClick={() => act((e) => e.searchStep(-1))}>
            <Icon name="up" size={14} />
          </button>
          <button type="button" className="btn icon sm" aria-label="Next match" onClick={() => act((e) => e.searchStep(1))}>
            <Icon name="down" size={14} />
          </button>
        </>
      ) : (
        <Kbd k="/" />
      )}
    </div>
  );
}

function Crumbs() {
  const { segs, rows, cols, ok } = useUI((s) => s.table);
  if (!ok) return <span className="muted sm">Select an array or object</span>;
  return (
    <nav className="crumbs" aria-label="Table location">
      <button type="button" onClick={() => act((e) => e.tableGoto([]))}>$</button>
      {segs.map((k, i) => (
        <span key={i}>
          <Icon name="down" size={12} className="sep" />
          <button type="button" onClick={() => act((e) => e.tableGoto(segs.slice(0, i + 1)))}>
            {typeof k === 'number' ? `[${k}]` : k}
          </button>
        </span>
      ))}
      <span className="muted sm dims">
        {rows.toLocaleString()} × {cols - 1}
      </span>
    </nav>
  );
}

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'format', label: 'Format', icon: 'braces' },
  { id: 'tree', label: 'Tree', icon: 'tree' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'convert', label: 'Convert', icon: 'code' },
  { id: 'compare', label: 'Compare', icon: 'diff' },
];

/** Format view controls: the output's shape, plus getting it out. */
function FormatBar() {
  const minify = useUI((s) => s.settings.minify);
  const sortKeys = useUI((s) => s.settings.sortKeys);
  const indent = useUI((s) => s.settings.indent);
  const { pretty, minified } = useUI((s) => s.fmt);
  const mac = useUI((s) => s.mac);
  const mod = mac ? '⌘' : 'Ctrl+';
  // Both sizes are always visible: what the whitespace costs is the point.
  const saved = pretty > 0 ? Math.round((1 - minified / pretty) * 100) : 0;
  return (
    <>
      <div className="seg seg-sm" role="radiogroup" aria-label="Output style">
        <button
          type="button"
          role="radio"
          aria-checked={!minify}
          onClick={() => act((e) => e.setFormat({ minify: false }))}
          data-tip="Pretty: indented and readable"
        >
          Pretty
          {pretty > 0 && <span className="seg-size">{formatBytes(pretty)}</span>}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={minify}
          onClick={() => act((e) => e.setFormat({ minify: true }))}
          data-tip={saved > 0 ? `Minified is ${saved}% smaller` : 'Minify: one line, no whitespace'}
        >
          Minify
          {minified > 0 && <span className="seg-size">{formatBytes(minified)}</span>}
        </button>
      </div>
      {!minify && (
        <label className="pick pick-sm" data-tip="Indentation">
          <span className="sr-only">Indentation</span>
          <Icon name="format" size={13} className="pick-ico" />
          <select value={indent} onChange={(e) => act((en) => en.setIndent(e.target.value as IndentId))}>
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="tab">Tab</option>
          </select>
          <Icon name="down" size={13} />
        </label>
      )}
      <button
        type="button"
        className={`btn toggle${sortKeys ? ' on' : ''}`}
        aria-pressed={sortKeys}
        onClick={() => act((e) => e.setFormat({ sortKeys: !sortKeys }))}
        data-tip="Sort object keys A to Z"
      >
        <Icon name="sort" size={14} />
        <span className="lbl">Sort keys</span>
      </button>
      <span className="grow" />
      <Btn icon="apply" label={`Use as input · ${mod}↵`} hideLabel onClick={() => act((e) => e.useOutput())} />
      <Btn icon="copy" label="Copy output" hideLabel onClick={() => act((e) => e.copyOutput())} />
      <Btn icon="download" label="Download .json" hideLabel onClick={() => act((e) => e.downloadOutput())} />
    </>
  );
}

function ConvertBar() {
  const target = useUI((s) => s.settings.target);
  const rootName = useUI((s) => s.settings.rootName);
  const tsStyle = useUI((s) => s.settings.tsStyle);
  const { lines, loading } = useUI((s) => s.convert);
  const info = targetInfo(target);
  return (
    <>
      <label className="pick">
        <span className="sr-only">Convert to</span>
        <select value={info.id} onChange={(e) => act((en) => en.setConvert({ target: e.target.value }))}>
          {(['Types', 'Data'] as const).map((g) => (
            <optgroup key={g} label={g === 'Types' ? 'Types & schemas' : 'Data formats'}>
              {TARGETS.filter((t) => t.group === g).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Icon name="down" size={13} />
      </label>
      {info.group === 'Types' && (
        <input
          className="root-name"
          value={rootName}
          onChange={(e) => act((en) => en.setConvert({ rootName: e.target.value.replace(/[^\w$]/g, '') }))}
          aria-label="Root type name"
          data-tip="Root type name"
          spellCheck={false}
        />
      )}
      {info.id === 'typescript' && (
        <label className="pick">
          <span className="sr-only">TypeScript style</span>
          <select value={tsStyle} onChange={(e) => act((en) => en.setConvert({ tsStyle: e.target.value as 'interface' | 'type' }))}>
            <option value="interface">interface</option>
            <option value="type">type</option>
          </select>
          <Icon name="down" size={13} />
        </label>
      )}
      <span className="grow" />
      {loading ? <i className="spin muted" /> : lines > 0 && <span className="muted sm nowrap">{lines.toLocaleString()} lines</span>}
      <Btn icon="copy" label={`Copy ${info.label}`} hideLabel onClick={() => act((e) => e.copyConvert())} />
      <Btn icon="download" label={`Download .${info.ext}`} hideLabel onClick={() => act((e) => e.downloadConvert())} />
    </>
  );
}

function ViewToolbar({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const view = useUI((s) => s.settings.view);
  return (
    <div className="toolbar" role="toolbar" aria-label="Viewer">
      <div
        className="seg"
        role="tablist"
        aria-label="View"
        onKeyDown={(e) => {
          const i = VIEWS.findIndex((v) => v.id === view);
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          const to = e.key === 'Home' ? 0 : e.key === 'End' ? VIEWS.length - 1 : d ? (i + d + VIEWS.length) % VIEWS.length : -1;
          if (to < 0) return;
          e.preventDefault();
          act((en) => en.setView(VIEWS[to].id));
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
            aria-controls={`view-${v.id}`}
            aria-label={v.label}
            data-tip={`${v.label} · Alt+${i + 1}`}
            onClick={() => act((e) => e.setView(v.id))}
          >
            <Icon name={v.icon} size={14} />
            <span className="lbl">{v.label}</span>
          </button>
        ))}
      </div>
      <div className="vt-format" hidden={view !== 'format'}>
        <FormatBar />
      </div>
      <div className="vt-tree" hidden={view !== 'tree'}>
        <SearchBox inputRef={searchRef} />
        <Btn icon="expand" label="Expand all" hideLabel onClick={() => act((e) => e.expandAll())} />
        <Btn icon="collapse" label="Collapse all" hideLabel onClick={() => act((e) => e.collapseAll())} />
      </div>
      <div className="vt-table" hidden={view !== 'table'}>
        <Crumbs />
        <span className="grow" />
        <Btn icon="copy" label="Copy CSV" hideLabel onClick={() => act((e) => e.copyCSV())} />
        <Btn icon="download" label="Download CSV" hideLabel onClick={() => act((e) => e.downloadCSV())} />
      </div>
      <div className="vt-convert" hidden={view !== 'convert'}>
        <ConvertBar />
      </div>
      <div className="vt-compare" hidden={view !== 'compare'}>
        <span className="muted sm">Compare your document with another JSON</span>
      </div>
    </div>
  );
}

function Banner() {
  const status = useUI((s) => s.status);
  const hint = useUI((s) => s.hint);
  if (status.kind === 'valid' && hint === 'unescape') {
    return (
      <div className="banner info" role="status" aria-live="polite">
        <Icon name="braces" size={15} />
        <span className="b-msg">
          <b>This is a JSON string that contains JSON</b>
          <span>Unescape it to view and edit the inner document.</span>
        </span>
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.unescapeDoc())}>
          Unescape JSON
        </button>
      </div>
    );
  }
  if (status.kind !== 'error' && status.kind !== 'fixable') return null;
  const err = status.kind === 'error';
  return (
    <div className={`banner ${err ? 'err' : 'warn'}`} role="status" aria-live="polite">
      <Icon name="alert" size={15} />
      <button type="button" className="b-msg" onClick={() => act((e) => e.gotoError())}>
        <b>{err ? 'Invalid JSON' : `Not strict JSON · ${status.count} fixable issue${status.count > 1 ? 's' : ''}`}</b>
        <span>
          Ln {status.line}, Col {status.col}: {status.msg}
        </span>
      </button>
      {hint === 'unescape' && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.unescapeDoc())}>
          Unescape JSON
        </button>
      )}
      {hint === 'jwt' && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.decodeJwt())}>
          Decode JWT
        </button>
      )}
      {(hint === 'yaml' || hint === 'xml' || hint === 'csv' || hint === 'toml') && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.importAs(hint))}>
          {hint.toUpperCase()} → JSON
        </button>
      )}
      {err ? (
        <button type="button" className="btn sm" onClick={() => act((e) => e.gotoError())}>
          Go to error
        </button>
      ) : (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.repair())} data-tip="Replace the input with the repaired JSON">
          <Icon name="wand" size={14} /> Repair input
        </button>
      )}
    </div>
  );
}

/** Raw state (nothing typed or pasted yet): the name, centered on the divider. */
function Watermark() {
  const empty = useUI((s) => s.empty);
  const view = useUI((s) => s.settings.view);
  if (!empty || view === 'compare') return null;
  return (
    <div className="watermark" aria-hidden="true">
      Tool Kumar
    </div>
  );
}

function ConvertNote() {
  const { error } = useUI((s) => s.convert);
  if (!error) return null;
  return <div className="cv-note">{error}</div>;
}

function ViewerPane({
  treeRef,
  tableRef,
  codeRef,
  fmtRef,
  searchRef,
}: {
  treeRef: React.RefObject<HTMLDivElement | null>;
  fmtRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  codeRef: React.RefObject<HTMLDivElement | null>;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const view = useUI((s) => s.settings.view);
  const stale = useUI((s) => s.stale);
  const empty = useUI((s) => s.empty);
  return (
    <section className="pane pane-view" aria-label="JSON viewer">
      <ViewToolbar searchRef={searchRef} />
      <div className={`view${stale ? ' stale' : ''}`}>
        <Banner />
        <div id="view-format" className="cv cv-wrap" ref={fmtRef} hidden={view !== 'format' || empty} tabIndex={0} aria-label="Formatted output">
          <div className="cv-sizer">
            <div className="cv-rows" />
          </div>
        </div>
        <div id="view-tree" className="tv" ref={treeRef} tabIndex={0} role="tree" aria-label="JSON tree" hidden={view !== 'tree' || empty}>
          <div className="tv-sizer">
            <div className="tv-rows" />
            <div className="tv-acts" hidden>
              <button type="button" data-a="value" aria-label="Copy value" data-tip="Copy value">
                <Icon name="copy" size={14} />
              </button>
              <button type="button" data-a="path" aria-label="Copy path" data-tip="Copy path">
                <Icon name="path" size={14} />
              </button>
            </div>
          </div>
        </div>
        <div id="view-table" className="tbl" ref={tableRef} hidden={view !== 'table' || empty}>
          <div className="tb-head" />
          <div className="tb-sizer">
            <div className="tb-rows" />
          </div>
          <div className="tb-empty" hidden>
            Select an array or object in the tree to see it as a table.
          </div>
        </div>
        <div id="view-convert" className="cv" ref={codeRef} hidden={view !== 'convert' || empty} tabIndex={0} aria-label="Converted output">
          <div className="cv-sizer">
            <div className="cv-rows" />
          </div>
          <ConvertNote />
        </div>
        <div id="view-compare" className="cmp-host" hidden={view !== 'compare'}>
          {view === 'compare' && <CompareHost />}
        </div>
      </div>
    </section>
  );
}

// Compare is code-split: it loads the first time its tab opens (and is
// prefetched in the background shortly after startup for offline use).
const CompareView = dynamic(() => import('./CompareView'), {
  ssr: false,
  loading: () => <div className="cv-note">Loading compare…</div>,
});
const jumpTo = (off: number) => act((e) => e.jumpTo(off));
const UNITS: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };

function CompareHost() {
  const leftText = useUI((s) => s.docText);
  const indent = useUI((s) => s.settings.indent);
  return <CompareView leftText={leftText} indent={UNITS[indent]} onJump={jumpTo} />;
}

// ── Split handle ────────────────────────────────────────────────────────────

function Splitter() {
  const split = useUI((s) => s.settings.split);
  const vertical = () => matchMedia('(max-width: 760px)').matches;
  const set = (r: number) => document.documentElement.style.setProperty('--split', `${(Math.min(0.8, Math.max(0.2, r)) * 100).toFixed(2)}%`);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const main = el.parentElement as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = main.getBoundingClientRect();
    const v = vertical();
    let ratio = split;
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      ratio = v ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width;
      set(ratio);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      act((en) => en.setSplit(ratio));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.02 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.02 : 0;
    const abs = e.key === 'Home' ? 0.2 : e.key === 'End' ? 0.8 : e.key === 'Enter' ? 0.5 : -1;
    if (!d && abs < 0) return;
    e.preventDefault();
    const r = abs >= 0 ? abs : Math.min(0.8, Math.max(0.2, split + d));
    set(r);
    act((en) => en.setSplit(r));
  };
  return (
    <div
      className="split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      onPointerDown={onDown}
      onKeyDown={onKey}
      onDoubleClick={() => {
        set(0.5);
        act((en) => en.setSplit(0.5));
      }}
    />
  );
}

// ── Status bar ──────────────────────────────────────────────────────────────

function StatusMsg() {
  const status = useUI((s) => s.status);
  switch (status.kind) {
    case 'empty':
      return <span className="st muted">Ready</span>;
    case 'parsing':
      return (
        <span className="st muted">
          <i className="spin" /> Parsing…
        </span>
      );
    case 'valid':
      return (
        <span className="st ok">
          <i className="dot" />
          Valid JSON
          {status.warnings > 0 && (
            <button type="button" className="st-link warn" onClick={() => act((e) => e.gotoError())} title={status.msg}>
              · {plural(status.warnings, 'duplicate key')}
            </button>
          )}
        </span>
      );
    default: {
      const err = status.kind === 'error';
      return (
        <button type="button" className={`st st-link ${err ? 'err' : 'warn'}`} onClick={() => act((e) => e.gotoError())} title="Go to error">
          <i className="dot" />
          <span className="st-msg">
            Ln {status.line}, Col {status.col}: {status.msg}
          </span>
        </button>
      );
    }
  }
}

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

function Stats() {
  const stats = useUI((s) => s.stats);
  if (!stats) return null;
  return (
    <span className="stats muted" title={`Parsed in ${stats.ms.toFixed(1)} ms`}>
      {formatBytes(stats.bytes)} · {plural(stats.lines, 'line')} · {plural(stats.nodes, 'node')} · depth {stats.depth}
    </span>
  );
}

function Cursor() {
  const { line, col, sel } = useUI((s) => s.cursor);
  return (
    <span className="cursor muted">
      Ln {line}, Col {col}
      {sel > 0 && ` (${sel.toLocaleString()} selected)`}
    </span>
  );
}

/** One quiet line: status and document stats on the left; caret, commands and theme on the right. */
function StatusBar() {
  const theme = useUI((s) => s.settings.theme);
  return (
    <footer className="statusbar">
      <div className="sb-l">
        <StatusMsg />
        <Stats />
      </div>
      <div className="sb-r">
        <Cursor />
        <button type="button" className="sb-btn" onClick={() => act((e) => e.openPalette())} aria-label="All commands" data-tip="All commands" data-tip-up="">
          <span className="fine-only">
            <Kbd k="mod+K" />
          </span>
          <Icon name="command" size={14} className="coarse-only" />
        </button>
        <button
          type="button"
          className="sb-btn"
          onClick={() => act((e) => e.cycleTheme())}
          aria-label={`Theme: ${theme}`}
          data-tip={`Theme: ${theme}`}
          data-tip-up=""
        >
          <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system'} size={14} />
        </button>
      </div>
    </footer>
  );
}

function ToastHost() {
  const toast = useUI((s) => s.toast);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.kind === 'ok' && <Icon name="check" size={14} />}
          {toast.kind === 'err' && <Icon name="alert" size={14} />}
          {toast.msg}
          {toast.action && (
            <button
              type="button"
              className="toast-act"
              onClick={() => {
                store.set({ toast: null });
                toast.action?.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.action && (
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => store.set({ toast: null })}>
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DropOverlay() {
  const dragging = useUI((s) => s.dragging);
  if (!dragging) return null;
  return (
    <div className="drop">
      <div>
        <Icon name="open" size={28} />
        Drop to open your JSON file
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export default function JsonTool() {
  const edRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const fmtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const e = new Engine({
      editor: edRef.current!,
      tree: treeRef.current!,
      table: tableRef.current!,
      file: fileRef.current!,
      search: searchRef.current!,
      code: codeRef.current!,
      fmt: fmtRef.current!,
    });
    setEngine(e);
    const warm = window.setTimeout(() => void import('./CompareView'), 5000);
    return () => {
      window.clearTimeout(warm);
      e.destroy();
      if (getEngine() === e) setEngine(null);
      store.set({ ready: false });
    };
  }, []);

  return (
    <div className="app">
      <h1 className="sr-only">Tool Kumar: JSON Formatter &amp; Viewer</h1>
      <p className="sr-only">
        Format, validate, repair and explore JSON instantly. Tree, table, convert and compare views. No upload, no ads, works offline.
      </p>
      <main className="panes">
        <EditorPane edRef={edRef} />
        <Splitter />
        <Watermark />
        <ViewerPane treeRef={treeRef} tableRef={tableRef} codeRef={codeRef} fmtRef={fmtRef} searchRef={searchRef} />
      </main>
      <StatusBar />
      <ToastHost />
      <DropOverlay />
      <CommandPalette />
      <ShortcutsDialog />
      <input ref={fileRef} type="file" accept=".json,.geojson,.jsonl,.ndjson,.har,.map,.txt,.log,.csv,.tsv,.yaml,.yml,.xml,.toml,application/json,text/plain" hidden />
    </div>
  );
}
