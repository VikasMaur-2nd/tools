'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Engine, type EnginePreset } from '@/lib/engine/engine';
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
  const comparing = useUI((s) => s.settings.view === 'compare');
  return (
    <div className="toolbar" role="toolbar" aria-label="Input">
      <span className="fname" title={fileName ?? undefined}>
        {comparing && <b className="side-tag">Original</b>}
        {fileName ? (
          <>
            <Icon name="file" size={14} />
            {fileName}
          </>
        ) : (
          !comparing && 'Input'
        )}
      </span>
      <span className="grow" />
      <Menu label="Input options">
        {(close) => (
          <>
            <MItem label="Paste" keys="mod+V" onClick={() => act((e) => e.paste())} close={close} />
            <MItem label="Open file" keys="mod+O" onClick={() => act((e) => e.openFile())} close={close} />
            <MItem label="Load from URL" onClick={() => act((e) => e.openPalette('url'))} close={close} />
            <MItem label="Try a sample" onClick={() => act((e) => e.sample())} close={close} />
            <MSep />
            <EditorFoldItems which={1} close={close} />
            <MSep />
            <MItem label="Download input" keys="mod+S" onClick={() => act((e) => e.download())} close={close} />
            <MItem label="Clear" onClick={() => act((e) => e.clear())} close={close} />
          </>
        )}
      </Menu>
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

/** Markup driven by lib/engine/editor.ts (highlighted, virtualized editor). */
function EditorDom({
  edRef,
  id,
  label,
  placeholder,
  autoFocus,
}: {
  edRef: React.RefObject<HTMLDivElement | null>;
  id: string;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="ed" ref={edRef}>
      <div className="ed-gut" aria-hidden="true">
        <div className="ed-gl" />
      </div>
      <div className="ed-body">
        <div className="ed-scope" />
        <div className="ed-cur" />
        <div className="ed-hl" aria-hidden="true" />
        <textarea
          id={id}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

function EditorPane({ edRef }: { edRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <section className="pane pane-ed" aria-label="JSON input">
      <InputBar />
      <ViewNotice />
      <EditorDom edRef={edRef} id="input" label="JSON input" placeholder="Looks like someone's got a JSON…" autoFocus />
    </section>
  );
}

/** Compare mode: the second (modified) document gets its own full editor column. */
function ComparePane({ edRef }: { edRef: React.RefObject<HTMLDivElement | null> }) {
  const comparing = useUI((s) => s.settings.view === 'compare');
  const cmpFile = useUI((s) => s.cmpFile);
  return (
    <section className="pane pane-cmp" aria-label="Modified JSON" hidden={!comparing}>
      <div className="toolbar" role="toolbar" aria-label="Modified document">
        <span className="fname" title={cmpFile ?? undefined}>
          <b className="side-tag">Modified</b>
          {cmpFile && (
            <>
              <Icon name="file" size={14} />
              {cmpFile}
            </>
          )}
        </span>
        <span className="grow" />
        <Menu label="Modified document options">
          {(close) => (
            <>
              <MItem label="Paste" onClick={() => act((e) => e.pasteCompare())} close={close} />
              <MItem label="Open file" onClick={() => act((e) => e.openFile(2))} close={close} />
              <MItem label="Format" keys="mod+Enter" onClick={() => act((e) => e.formatCompare())} close={close} />
              <MItem label="Swap with original" onClick={() => act((e) => e.swapCompare())} close={close} />
              <MSep />
              <EditorFoldItems which={2} close={close} />
              <MSep />
              <MItem label="Clear" onClick={() => act((e) => e.clearCompare())} close={close} />
            </>
          )}
        </Menu>
        <Btn icon="x" label="Close compare" hideLabel onClick={() => act((e) => e.closeCompare())} />
      </div>
      <EditorDom edRef={edRef} id="input2" label="Modified JSON" placeholder="Paste the modified JSON to compare…" />
    </section>
  );
}

// ── Viewer pane ─────────────────────────────────────────────────────────────

// ── Menus (⋯) ────────────────────────────────────────────────────────────────

/** A small popover menu anchored to an icon button. Keyboard: ↑ ↓ to move, Esc to close. */
function Menu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const pop = wrap.current?.querySelector<HTMLElement>('.menu');
    pop?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    document.getElementById(id)?.focus();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        id={id}
        type="button"
        className={`btn icon${open ? ' on' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MItem({ label, keys, onClick, close }: { label: string; keys?: string; onClick: () => void; close: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mi"
      onClick={() => {
        close();
        onClick();
      }}
    >
      <span>{label}</span>
      {keys && <Kbd k={keys} />}
    </button>
  );
}

function MCheck({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="mi" onClick={onClick}>
      <span>{label}</span>
      <span className="mi-check">{checked && <Icon name="check" size={14} />}</span>
    </button>
  );
}

/** A row with a few mutually exclusive options (indent 2 · 4 · Tab, levels 1 · 2 · 3). */
function MChoice<T extends string | number>({
  label,
  options,
  value,
  onPick,
  close,
}: {
  label: string;
  options: { v: T; label: string }[];
  value?: T;
  onPick: (v: T) => void;
  /** Close the menu after picking (actions); omit to keep it open (settings). */
  close?: () => void;
}) {
  return (
    <div className="mi mi-row" role="group" aria-label={label}>
      <span>{label}</span>
      <span className="mi-opts">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="menuitemradio"
            aria-checked={value === o.v}
            onClick={() => {
              close?.();
              onPick(o.v);
            }}
          >
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

const MSep = () => <div className="mi-sep" role="separator" />;
const MHead = ({ children }: { children: React.ReactNode }) => <div className="mi-head">{children}</div>;

const LEVELS = [
  { v: 1, label: '1' },
  { v: 2, label: '2' },
  { v: 3, label: '3' },
];

/** Folding for an editor (the gutter chevrons do the same per block). */
function EditorFoldItems({ which, close }: { which: 1 | 2; close: () => void }) {
  return (
    <>
      <MItem label="Collapse all" onClick={() => act((e) => e.foldEditor(which, 1))} close={close} />
      <MItem label="Expand all" onClick={() => act((e) => e.foldEditor(which, 0))} close={close} />
      <MChoice label="Show levels" options={LEVELS} onPick={(l) => act((e) => e.foldEditor(which, l))} close={close} />
    </>
  );
}

function FoldItems({ close }: { close: () => void }) {
  return (
    <>
      <MItem label="Collapse all" onClick={() => act((e) => e.collapseAll())} close={close} />
      <MItem label="Expand all" onClick={() => act((e) => e.expandAll())} close={close} />
      <MChoice label="Show levels" options={LEVELS} onPick={(l) => act((e) => e.expandTo(l))} close={close} />
    </>
  );
}

function ViewMenu() {
  const view = useUI((s) => s.settings.view);
  const indent = useUI((s) => s.settings.indent);
  const sortKeys = useUI((s) => s.settings.sortKeys);
  const target = useUI((s) => s.settings.target);
  const rootName = useUI((s) => s.settings.rootName);
  const tsStyle = useUI((s) => s.settings.tsStyle);
  const hasSel = useUI((s) => !!s.path);
  const info = targetInfo(target);
  return (
    <Menu label="More options">
      {(close) => (
        <>
          {view === 'format' && (
            <>
              <MHead>Format</MHead>
              <MChoice
                label="Indent"
                value={indent}
                options={[
                  { v: '2', label: '2' },
                  { v: '4', label: '4' },
                  { v: 'tab', label: 'Tab' },
                ]}
                onPick={(v) => act((e) => e.setIndent(v as IndentId))}
              />
              <MCheck label="Sort keys" checked={sortKeys} onClick={() => act((e) => e.setFormat({ sortKeys: !sortKeys }))} />
              <MItem label="Use as input" keys="mod+Enter" onClick={() => act((e) => e.useOutput())} close={close} />
              <MSep />
              <FoldItems close={close} />
            </>
          )}
          {view === 'tree' && (
            <>
              <MHead>Tree</MHead>
              <FoldItems close={close} />
              <MSep />
              <MItem label="Copy path" keys="P" onClick={() => act((e) => e.copyPath())} close={close} />
              <MItem label="Copy value" keys="C" onClick={() => act((e) => e.copyValue())} close={close} />
              {hasSel && <MItem label="Expand nested JSON string" onClick={() => act((e) => e.expandNested())} close={close} />}
            </>
          )}
          {view === 'table' && (
            <>
              <MHead>Table</MHead>
              <MItem label="Copy as CSV" onClick={() => act((e) => e.copyCSV())} close={close} />
              <MItem label="Download CSV" onClick={() => act((e) => e.downloadCSV())} close={close} />
              <MItem label="Download Excel (.xlsx)" onClick={() => act((e) => e.exportExcel())} close={close} />
            </>
          )}
          {view === 'convert' && (
            <>
              <MHead>{info.label}</MHead>
              {info.group === 'Types' && (
                <label className="mi mi-row">
                  <span>Root type name</span>
                  <input
                    className="mi-input"
                    value={rootName}
                    onChange={(e) => act((en) => en.setConvert({ rootName: e.target.value.replace(/[^\w$]/g, '') }))}
                    spellCheck={false}
                  />
                </label>
              )}
              {info.id === 'typescript' && (
                <MChoice
                  label="Declare as"
                  value={tsStyle}
                  options={[
                    { v: 'interface', label: 'interface' },
                    { v: 'type', label: 'type' },
                  ]}
                  onPick={(v) => act((e) => e.setConvert({ tsStyle: v as 'interface' | 'type' }))}
                />
              )}
              {info.group === 'Types' && <MSep />}
              <FoldItems close={close} />
            </>
          )}
        </>
      )}
    </Menu>
  );
}

// ── Find bar ────────────────────────────────────────────────────────────────

/** Floating find for the open view (Ctrl+F). Esc closes it. */
function FindBar() {
  const { open, q, total, index, seq } = useUI((s) => s.find);
  const view = useUI((s) => s.settings.view);
  if (!open || view === 'compare') return null;
  return <FindInput key={seq} initial={q} total={total} index={index} view={view} />;
}

function FindInput({ initial, total, index, view }: { initial: string; total: number; index: number; view: View }) {
  const [text, setText] = useState(initial);
  const timer = useRef(0);
  const run = (v: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => act((e) => e.find(v)), v.length > 2 ? 80 : 150);
  };
  const onKey = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      window.clearTimeout(timer.current);
      act((e) => e.findSubmit(text, ev.shiftKey ? -1 : 1));
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      window.clearTimeout(timer.current);
      act((e) => e.closeFind());
      document.querySelector<HTMLElement>(`#view-${view}`)?.focus();
    }
  };
  return (
    <div className="findbar" role="search">
      <Icon name="search" size={14} />
      <input
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          run(e.target.value);
        }}
        onKeyDown={onKey}
        placeholder={view === 'tree' ? 'Find, or $.path' : 'Find'}
        aria-label="Find in view"
        spellCheck={false}
        autoComplete="off"
      />
      <span className="count" aria-live="polite">
        {text ? (total ? `${index + 1} of ${total >= 100000 ? '100k+' : total.toLocaleString()}` : 'No results') : ''}
      </span>
      <button type="button" className="btn icon sm" aria-label="Previous match" onClick={() => act((e) => e.findStep(-1))}>
        <Icon name="up" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label="Next match" onClick={() => act((e) => e.findStep(1))}>
        <Icon name="down" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label="Close find" onClick={() => act((e) => e.closeFind())}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Viewer toolbar: tabs · one main control · four fixed icons ──────────────

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

const VIEWS: { id: View; label: string }[] = [
  { id: 'format', label: 'Format' },
  { id: 'tree', label: 'Tree' },
  { id: 'table', label: 'Table' },
  { id: 'convert', label: 'Convert' },
  { id: 'compare', label: 'Compare' },
];

/** Text tabs; on narrow panes a single dropdown instead. */
function ViewSwitch() {
  const view = useUI((s) => s.settings.view);
  return (
    <>
      <div
        className="tabs"
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
            data-tip={`Alt+${i + 1}`}
            onClick={() => act((e) => e.setView(v.id))}
          >
            {v.label}
          </button>
        ))}
      </div>
      <label className="pick tabs-pick">
        <span className="sr-only">View</span>
        <select value={view} onChange={(e) => act((en) => en.setView(e.target.value as View))}>
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <Icon name="down" size={13} />
      </label>
    </>
  );
}

/** Format: Pretty / Minify, each with its size. */
function OutputStyle() {
  const minify = useUI((s) => s.settings.minify);
  const { pretty, minified } = useUI((s) => s.fmt);
  const saved = pretty > 0 ? Math.round((1 - minified / pretty) * 100) : 0;
  return (
    <div className="seg seg-sm" role="radiogroup" aria-label="Output style">
      <button type="button" role="radio" aria-checked={!minify} onClick={() => act((e) => e.setFormat({ minify: false }))} data-tip="Indented and readable">
        Pretty
        {pretty > 0 && <span className="seg-size">{formatBytes(pretty)}</span>}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={minify}
        onClick={() => act((e) => e.setFormat({ minify: true }))}
        data-tip={saved > 0 ? `${saved}% smaller` : 'One line, no whitespace'}
      >
        Minify
        {minified > 0 && <span className="seg-size">{formatBytes(minified)}</span>}
      </button>
    </div>
  );
}

/** Tree: the selected node's path (click to copy). */
function TreePath() {
  const path = useUI((s) => s.path);
  if (!path) return <span className="muted sm nowrap">Select a node</span>;
  return (
    <button type="button" className="path" onClick={() => act((e) => e.copyPath())} data-tip="Copy path">
      {path}
    </button>
  );
}

/** Convert: the language picker. */
function TargetPick() {
  const target = useUI((s) => s.settings.target);
  const loading = useUI((s) => s.convert.loading);
  const info = targetInfo(target);
  return (
    <>
      {loading && <i className="spin muted" />}
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
    </>
  );
}

function ViewToolbar() {
  const view = useUI((s) => s.settings.view);
  const mac = useUI((s) => s.mac);
  const mod = mac ? '⌘' : 'Ctrl+';
  const findOpen = useUI((s) => s.find.open);
  return (
    <div className="toolbar vbar" role="toolbar" aria-label="Viewer">
      <ViewSwitch />
      <span className="grow" />
      <div className="vmain">
        {view === 'format' && <OutputStyle />}
        {view === 'tree' && <TreePath />}
        {view === 'table' && <Crumbs />}
        {view === 'convert' && <TargetPick />}
      </div>
      {view !== 'compare' && (
        <div className="vicons">
          <button
            type="button"
            className={`btn icon${findOpen ? ' on' : ''}`}
            aria-label={`Find · ${mod}F`}
            data-tip={`Find · ${mod}F`}
            onClick={() => act((e) => (store.get().find.open ? e.closeFind() : e.focusSearch()))}
          >
            <Icon name="search" />
          </button>
          <Btn icon="copy" label={view === 'tree' ? 'Copy (selected value or all)' : view === 'table' ? 'Copy as CSV' : 'Copy'} hideLabel onClick={() => act((e) => e.copyView())} />
          <Btn icon="download" label={view === 'table' ? 'Download CSV' : 'Download'} hideLabel onClick={() => act((e) => e.downloadView())} />
          <ViewMenu />
        </div>
      )}
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
}: {
  treeRef: React.RefObject<HTMLDivElement | null>;
  fmtRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  codeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const view = useUI((s) => s.settings.view);
  const stale = useUI((s) => s.stale);
  const empty = useUI((s) => s.empty);
  return (
    <section className="pane pane-view" aria-label="JSON viewer">
      <ViewToolbar />
      <div className={`view${stale ? ' stale' : ''}`}>
        <Banner />
        <FindBar />
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
const UNITS: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };
const onJump = (l: number | undefined, r: number | undefined) => act((e) => e.compareJump(l, r));
const onMarks = (l: Uint8Array | null, r: Uint8Array | null) => act((e) => e.compareMarks(l, r));
const onSwap = () => act((e) => e.swapCompare());

function CompareHost() {
  const leftText = useUI((s) => s.docText);
  const rightText = useUI((s) => s.cmpText);
  const indent = useUI((s) => s.settings.indent);
  return <CompareView leftText={leftText} rightText={rightText} indent={UNITS[indent]} onJump={onJump} onMarks={onMarks} onSwap={onSwap} />;
}

// ── Split handle ────────────────────────────────────────────────────────────

function Splitter() {
  const split = useUI((s) => s.settings.split);
  const splitCmp = useUI((s) => s.settings.splitCmp);
  const comparing = useUI((s) => s.settings.view === 'compare');
  const vertical = () => matchMedia('(max-width: 760px)').matches;
  // Normal: editor vs viewer. Compare: both editors vs the differences panel.
  const [lo, hi, cur, prop] = comparing ? [0.4, 0.85, splitCmp, '--split-c'] : [0.2, 0.8, split, '--split'];
  const clamp = (r: number) => Math.min(hi, Math.max(lo, r));
  const set = (r: number) => document.documentElement.style.setProperty(prop, `${(clamp(r) * 100).toFixed(2)}%`);
  const save = (r: number) => act((en) => (comparing ? en.setSplitCmp(clamp(r)) : en.setSplit(clamp(r))));

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const main = el.parentElement as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = main.getBoundingClientRect();
    const v = vertical();
    let ratio = cur;
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
      save(ratio);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.02 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.02 : 0;
    const def = comparing ? 0.66 : 0.5;
    const abs = e.key === 'Home' ? lo : e.key === 'End' ? hi : e.key === 'Enter' ? def : -1;
    if (!d && abs < 0) return;
    e.preventDefault();
    const r = abs >= 0 ? abs : clamp(cur + d);
    set(r);
    save(r);
  };
  return (
    <div
      className="split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuenow={Math.round(cur * 100)}
      aria-valuemin={lo * 100}
      aria-valuemax={hi * 100}
      tabIndex={0}
      onPointerDown={onDown}
      onKeyDown={onKey}
      onDoubleClick={() => {
        const def = comparing ? 0.66 : 0.5;
        set(def);
        save(def);
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

const CODECS = [
  ['gzip', 'gzip'],
  ['brotli', 'brotli'],
  ['zstd', 'zstd'],
] as const;

/** What you have, what you'd ship, what goes over the wire: raw, minified and compressed sizes side by side. */
function Sizes() {
  const raw = useUI((s) => s.stats?.bytes);
  const sizes = useUI((s) => s.sizes);
  const parsed = useUI((s) => s.status.kind === 'valid' || s.status.kind === 'fixable');
  if (raw === undefined) return null;
  const less = (n: number) => (raw > n ? ` · ${Math.round((1 - n / raw) * 100)}% smaller than the input` : '');
  return (
    <span className={sizes?.stale ? 'sizes stale' : 'sizes'}>
      <span className="sz sz-raw" data-tip="Input, as typed" data-tip-up="">
        {formatBytes(raw)} <i>raw</i>
      </span>
      {sizes ? (
        <>
          <span className="sz sz-min" data-tip={`Minified${less(sizes.min)}`} data-tip-up="">
            {formatBytes(sizes.min)} <i>min</i>
          </span>
          {CODECS.map(([k, label]) => {
            const n = sizes[k];
            return n === undefined ? null : (
              <span key={k} className="sz" data-tip={`Minified, then ${label}-compressed (what a server sends)${less(n)}`} data-tip-up="">
                {formatBytes(n)} <i>{label}</i>
              </span>
            );
          })}
        </>
      ) : (
        parsed && (
          <span className="sz" aria-hidden="true">
            … <i>min</i>
          </span>
        )
      )}
    </span>
  );
}

function Stats() {
  const stats = useUI((s) => s.stats);
  if (!stats) return null;
  return (
    <span className="stats muted" title={`Parsed in ${stats.ms.toFixed(1)} ms`}>
      {plural(stats.lines, 'line')} · {plural(stats.nodes, 'node')} · depth {stats.depth}
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
        <Sizes />
        <Stats />
      </div>
      <div className="sb-r">
        <Cursor />
        <Link className="sb-btn" href="/blogs" prefetch={false}>
          Blog
        </Link>
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

export default function JsonTool({ preset }: { preset?: EnginePreset } = {}) {
  const presetRef = useRef(preset);
  const edRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const fmtRef = useRef<HTMLDivElement>(null);
  const ed2Ref = useRef<HTMLDivElement>(null);
  const comparing = useUI((s) => s.settings.view === 'compare');

  useEffect(() => {
    const pagePreset = presetRef.current;
    const e = new Engine({
      editor: edRef.current!,
      tree: treeRef.current!,
      table: tableRef.current!,
      file: fileRef.current!,
      code: codeRef.current!,
      fmt: fmtRef.current!,
      editor2: ed2Ref.current!,
    });
    if (pagePreset?.initialText) {
      e.load(pagePreset.initialText, pagePreset.initialFileName ?? null);
      if (pagePreset.settings?.view === 'convert') {
        e.setConvert({ target: pagePreset.settings.target ?? 'typescript', rootName: pagePreset.settings.rootName ?? 'Root', tsStyle: pagePreset.settings.tsStyle ?? 'interface' });
      } else if (pagePreset.settings?.view) {
        e.setView(pagePreset.settings.view);
        if (pagePreset.settings.view === 'format' && (pagePreset.settings.minify !== undefined || pagePreset.settings.sortKeys !== undefined)) {
          e.setFormat({ minify: pagePreset.settings.minify, sortKeys: pagePreset.settings.sortKeys });
        }
      }
      if (pagePreset.decodeJwt) window.setTimeout(() => void e.decodeJwt(), 0);
      if (pagePreset.initialImport) window.setTimeout(() => void e.importAs(pagePreset.initialImport as 'yaml' | 'xml' | 'csv' | 'toml'), 0);
    }
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
    <div className={comparing ? 'app comparing' : 'app'}>
      <h1 className="sr-only">Tool Kumar: JSON Formatter &amp; Viewer</h1>
      <p className="sr-only">
        Format, validate, repair and explore JSON instantly. Tree, table, convert and compare views. No upload, no ads, works offline.
      </p>
      <main className="panes">
        <EditorPane edRef={edRef} />
        <ComparePane edRef={ed2Ref} />
        <Splitter />
        <Watermark />
        <ViewerPane treeRef={treeRef} tableRef={tableRef} codeRef={codeRef} fmtRef={fmtRef} />
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
