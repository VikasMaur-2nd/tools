'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Engine, type EnginePreset } from '@/lib/engine/engine';
import { idle } from '@/lib/engine/idle';
import { act, getEngine, setEngine } from '@/lib/engine/instance';
import { store, useUI, type IndentId, type JwtInfo, type View } from '@/lib/engine/store';
import { TARGETS, targetInfo } from '@/lib/engine/targets';
import { useT } from '@/lib/i18n/react';
import { setRuntime, type T } from '@/lib/i18n/ui';
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
  const t = useT();
  return (
    <button
      type="button"
      className={`btn${variant ? ' ' + variant : ''}${hideLabel ? ' icon' : ''}`}
      onClick={onClick}
      aria-label={t(label)}
      data-tip={tip ? t(tip) : hideLabel ? t(label) : undefined}
      data-tip-up={up ? '' : undefined}
    >
      <Icon name={icon} />
      {!hideLabel && <span className="lbl">{t(label)}</span>}
    </button>
  );
}

// ── Editor pane ─────────────────────────────────────────────────────────────

/** Input side: only what concerns the input itself. Everything that transforms it lives on the right. */
const InputBar = memo(function InputBar() {
  const fileName = useUI((s) => s.fileName);
  const comparing = useUI((s) => s.settings.view === 'compare');
  const t = useT();
  return (
    <div className="toolbar" role="toolbar" aria-label={t('Input')}>
      <span className="fname" title={fileName ?? undefined}>
        {comparing && <b className="side-tag">{t('Original')}</b>}
        {fileName ? (
          <>
            <Icon name="file" size={14} />
            {fileName}
          </>
        ) : (
          !comparing && t('Input')
        )}
      </span>
      <span className="grow" />
      <Btn icon="share" label="Share" tip="Copy a link that contains this JSON (nothing is uploaded)" onClick={() => act((e) => e.share())} />
      <Menu label="Input options">
        {(close) => (
          <>
            <MItem label="Paste" keys="mod+V" onClick={() => act((e) => e.paste())} close={close} />
            <MItem label="Open file" keys="mod+O" onClick={() => act((e) => e.openFile())} close={close} />
            <MItem label="Load from URL" onClick={() => act((e) => e.openPalette('url'))} close={close} />
            <MItem label="Try a sample" onClick={() => act((e) => e.sample())} close={close} />
            <MSep />
            <EditorFoldItems which={1} close={close} />
            <WrapItem />
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
  const t = useT();
  if (!viewOnly) return null;
  return (
    <div className="ed-notice" role="status">
      <Icon name="lock" size={13} />
      <span>
        {bytes
          ? t('Large document ({size}) is read-only for speed. Everything on the right still works.', { size: t.bytes(bytes) })
          : t('Large document is read-only for speed. Everything on the right still works.')}
      </span>
      <button type="button" className="btn sm" onClick={() => act((e) => e.editAnyway())}>
        {t('Edit anyway')}
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
  const t = useT();
  return (
    <section className="pane pane-ed" aria-label={t('JSON input')}>
      <InputBar />
      <ViewNotice />
      <EditorDom edRef={edRef} id="input" label={t('JSON input')} placeholder={t("Looks like someone's got a JSON…")} autoFocus />
    </section>
  );
}

/** Compare mode: the second (modified) document gets its own full editor column. */
function ComparePane({ edRef }: { edRef: React.RefObject<HTMLDivElement | null> }) {
  const comparing = useUI((s) => s.settings.view === 'compare');
  const cmpFile = useUI((s) => s.cmpFile);
  const t = useT();
  return (
    <section className="pane pane-cmp" aria-label={t('Modified JSON')} hidden={!comparing}>
      <div className="toolbar" role="toolbar" aria-label={t('Modified document')}>
        <span className="fname" title={cmpFile ?? undefined}>
          <b className="side-tag">{t('Modified')}</b>
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
              <WrapItem />
              <MSep />
              <MItem label="Clear" onClick={() => act((e) => e.clearCompare())} close={close} />
            </>
          )}
        </Menu>
        <Btn icon="x" label="Close compare" hideLabel onClick={() => act((e) => e.closeCompare())} />
      </div>
      <EditorDom edRef={edRef} id="input2" label={t('Modified JSON')} placeholder={t('Paste the modified JSON to compare…')} />
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
  const name = useT()(label);

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
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : name}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={name} onKeyDown={onKey}>
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
      <span>{useT()(label)}</span>
      {keys && <Kbd k={keys} />}
    </button>
  );
}

function MCheck({ label, keys, checked, onClick }: { label: string; keys?: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="mi" onClick={onClick}>
      <span>{useT()(label)}</span>
      <span className="mi-end">
        {keys && <Kbd k={keys} />}
        <span className="mi-check">{checked && <Icon name="check" size={14} />}</span>
      </span>
    </button>
  );
}

/** Soft wrap: one setting for the editors and the code views. */
function WrapItem() {
  const wrap = useUI((s) => s.settings.wrap);
  return <MCheck label="Wrap lines" keys="Alt+Z" checked={wrap} onClick={() => act((e) => e.toggleWrap())} />;
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
  const t = useT();
  return (
    <div className="mi mi-row" role="group" aria-label={t(label)}>
      <span>{t(label)}</span>
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
            {t(o.label)}
          </button>
        ))}
      </span>
    </div>
  );
}

const MSep = () => <div className="mi-sep" role="separator" />;
const MHead = ({ children }: { children: string }) => <div className="mi-head">{useT()(children)}</div>;

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
  const csharpLib = useUI((s) => s.settings.csharpLib);
  const hasSel = useUI((s) => !!s.path);
  const info = targetInfo(target);
  const t = useT();
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
              <WrapItem />
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
                  <span>{t('Root type name')}</span>
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
              {info.id === 'csharp' && (
                <MChoice
                  label="Library"
                  value={csharpLib}
                  options={[
                    { v: 'stj', label: 'System.Text.Json' },
                    { v: 'newtonsoft', label: 'Newtonsoft' },
                  ]}
                  onPick={(v) => act((e) => e.setConvert({ csharpLib: v as 'stj' | 'newtonsoft' }))}
                />
              )}
              {info.group === 'Types' && <MSep />}
              <FoldItems close={close} />
              <WrapItem />
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
  const { open, q, total, index, note, seq } = useUI((s) => s.find);
  const view = useUI((s) => s.settings.view);
  if (!open || view === 'compare') return null;
  return <FindInput key={seq} initial={q} total={total} index={index} note={note} view={view} />;
}

function FindInput({ initial, total, index, note, view }: { initial: string; total: number; index: number; note?: string; view: View }) {
  const t = useT();
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
        placeholder={t(view === 'tree' ? 'Find, or $.path' : 'Find')}
        aria-label={t('Find in view')}
        spellCheck={false}
        autoComplete="off"
      />
      <span className="count" aria-live="polite" title={note && t.msg(note)}>
        {text ? (total ? t('{i} of {total}', { i: t.num(index + 1), total: total >= 100000 ? '100k+' : t.num(total) }) : t(note ? 'Concrete paths only' : 'No results')) : ''}
      </span>
      <button type="button" className="btn icon sm" aria-label={t('Previous match')} onClick={() => act((e) => e.findStep(-1))}>
        <Icon name="up" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label={t('Next match')} onClick={() => act((e) => e.findStep(1))}>
        <Icon name="down" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label={t('Close find')} onClick={() => act((e) => e.closeFind())}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Viewer toolbar: tabs · one main control · four fixed icons ──────────────

function Crumbs() {
  const { segs, rows, cols, ok } = useUI((s) => s.table);
  const t = useT();
  if (!ok) return <span className="muted sm">{t('Select an array or object')}</span>;
  return (
    <nav className="crumbs" aria-label={t('Table location')}>
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
        {t.num(rows)} × {t.num(cols - 1)}
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
            {t(v.label)}
          </button>
        ))}
      </div>
      <label className="pick tabs-pick">
        <span className="sr-only">{t('View')}</span>
        <select value={view} onChange={(e) => act((en) => en.setView(e.target.value as View))}>
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

/** Format: Pretty / Minify / String (escaped), each with its size. */
function OutputStyle() {
  const minify = useUI((s) => s.settings.minify);
  const escape = useUI((s) => s.settings.escape);
  const { pretty, minified, escaped } = useUI((s) => s.fmt);
  const saved = pretty > 0 ? Math.round((1 - minified / pretty) * 100) : 0;
  const t = useT();
  return (
    <div className="seg seg-sm" role="radiogroup" aria-label={t('Output style')}>
      <button type="button" role="radio" aria-checked={!minify && !escape} onClick={() => act((e) => e.setFormat({ minify: false, escape: false }))} data-tip={t('Indented and readable')}>
        {t('Pretty')}
        {pretty > 0 && <span className="seg-size">{t.bytes(pretty)}</span>}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={minify && !escape}
        onClick={() => act((e) => e.setFormat({ minify: true, escape: false }))}
        data-tip={saved > 0 ? t('{percent}% smaller', { percent: saved }) : t('One line, no whitespace')}
      >
        {t('Minify')}
        {minified > 0 && <span className="seg-size">{t.bytes(minified)}</span>}
      </button>
      <button type="button" role="radio" aria-checked={escape} onClick={() => act((e) => e.setFormat({ escape: true }))} data-tip={t('Minified, then escaped as one JSON string')}>
        {t('String')}
        {escaped > 0 && <span className="seg-size">{t.bytes(escaped)}</span>}
      </button>
    </div>
  );
}

/** Tree: the selected node's path (click to copy). */
function TreePath() {
  const path = useUI((s) => s.path);
  const t = useT();
  if (!path) return <span className="muted sm nowrap">{t('Select a node')}</span>;
  return (
    <button type="button" className="path" onClick={() => act((e) => e.copyPath())} data-tip={t('Copy path')}>
      {path}
    </button>
  );
}

/** Convert: the language picker. */
function TargetPick() {
  const target = useUI((s) => s.settings.target);
  const loading = useUI((s) => s.convert.loading);
  const info = targetInfo(target);
  const t = useT();
  return (
    <>
      {loading && <i className="spin muted" />}
      <label className="pick">
        <span className="sr-only">{t('Convert to')}</span>
        <select value={info.id} onChange={(e) => act((en) => en.setConvert({ target: e.target.value }))}>
          {(['Types', 'Data'] as const).map((g) => (
            <optgroup key={g} label={t(g === 'Types' ? 'Types & schemas' : 'Data formats')}>
              {TARGETS.filter((x) => x.group === g).map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.label)}
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
  const t = useT();
  return (
    <div className="toolbar vbar" role="toolbar" aria-label={t('Viewer')}>
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
            aria-label={`${t('Find')}${t(' · ')}${mod}F`}
            data-tip={`${t('Find')}${t(' · ')}${mod}F`}
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

/** The current time, re-read every `ms` while the component is shown. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** The status-bar label for a JWT, e.g. "expires in 59m": it ages, so it is recomputed as time passes. */
function jwtWhen(j: JwtInfo, nowMs: number, t: T) {
  const now = nowMs / 1000;
  if (j.exp !== undefined && j.exp <= now) return { warn: true, text: t('expired {duration} ago', { duration: t.dur(now - j.exp) }) };
  if (j.nbf !== undefined && j.nbf > now) return { warn: true, text: t('valid in {duration}', { duration: t.dur(j.nbf - now) }) };
  return { warn: false, text: j.exp !== undefined ? t('expires in {duration}', { duration: t.dur(j.exp - now) }) : t('no expiry') };
}

function JwtStatus({ jwt }: { jwt: JwtInfo }) {
  const t = useT();
  const w = jwtWhen(jwt, useNow(1000), t);
  return (
    <span className={`st ${w.warn ? 'warn' : 'ok'}`} title={t('Decoded in your browser. The signature is not verified.')}>
      <i className="dot" />
      {['JWT', jwt.alg, w.text].filter(Boolean).join(t(' · '))}
    </span>
  );
}

function Banner() {
  const status = useUI((s) => s.status);
  const hint = useUI((s) => s.hint);
  const t = useT();
  if (status.kind === 'valid' && hint === 'unescape') {
    return (
      <div className="banner info" role="status" aria-live="polite">
        <Icon name="braces" size={15} />
        <span className="b-msg">
          <b>{t('This is a JSON string that contains JSON')}</b>
          <span>{t('Unescape it to view and edit the inner document.')}</span>
        </span>
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.unescapeDoc())}>
          {t('Unescape JSON')}
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
        <b>{err ? t('Invalid JSON') : t.n(status.count, 'Not strict JSON · {n} fixable issue', 'Not strict JSON · {n} fixable issues')}</b>
        <span>{t('Ln {line}, Col {col}: {msg}', { line: status.line, col: status.col, msg: t.msg(status.msg) })}</span>
      </button>
      {hint === 'unescape' && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.unescapeDoc())}>
          {t('Unescape JSON')}
        </button>
      )}
      {(hint === 'yaml' || hint === 'xml' || hint === 'csv' || hint === 'toml') && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.importAs(hint))}>
          {t('{format} → JSON', { format: hint.toUpperCase() })}
        </button>
      )}
      {err ? (
        <button type="button" className="btn sm" onClick={() => act((e) => e.gotoError())}>
          {t('Go to error')}
        </button>
      ) : (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.repair())} data-tip={t('Replace the input with the repaired JSON')}>
          <Icon name="wand" size={14} /> {t('Repair input')}
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
    <div className="watermark" aria-hidden="true" />
  );
}

function ConvertNote() {
  const { error } = useUI((s) => s.convert);
  const t = useT();
  if (!error) return null;
  return <div className="cv-note">{t.msg(error)}</div>;
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
  const t = useT();
  return (
    <section className="pane pane-view" aria-label={t('JSON viewer')}>
      <ViewToolbar />
      <div className={`view${stale ? ' stale' : ''}`}>
        <Banner />
        <FindBar />
        <div id="view-format" className="cv cv-wrap" ref={fmtRef} hidden={view !== 'format' || empty} tabIndex={0} aria-label={t('Formatted output')}>
          <div className="cv-sizer">
            <div className="cv-rows" />
          </div>
        </div>
        <div id="view-tree" className="tv" ref={treeRef} tabIndex={0} role="tree" aria-label={t('JSON tree')} hidden={view !== 'tree' || empty}>
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
        <div id="view-table" className="tbl" ref={tableRef} hidden={view !== 'table' || empty}>
          <div className="tb-head" />
          <div className="tb-sizer">
            <div className="tb-rows" />
          </div>
          <div className="tb-empty" hidden>
            {t('Select an array or object in the tree to see it as a table.')}
          </div>
        </div>
        <div id="view-convert" className="cv" ref={codeRef} hidden={view !== 'convert' || empty} tabIndex={0} aria-label={t('Converted output')}>
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
  loading: function Loading() {
    return <div className="cv-note">{useT()('Loading compare…')}</div>;
  },
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
      aria-label={useT()('Resize panels')}
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
  const t = useT();
  switch (status.kind) {
    case 'empty':
      return <span className="st muted">{t('Ready')}</span>;
    case 'parsing':
      return (
        <span className="st muted">
          <i className="spin" /> {t('Parsing…')}
        </span>
      );
    case 'valid':
      if (status.jwt) return <JwtStatus jwt={status.jwt} />;
      return (
        <span className="st ok" title={status.jsonl ? t('One JSON value per line, shown as an array of records') : undefined}>
          <i className="dot" />
          {status.jsonl ? t.n(status.jsonl, 'JSON Lines · {n} record', 'JSON Lines · {n} records') : t('Valid JSON')}
          {status.warnings > 0 && (
            <button type="button" className="st-link warn" onClick={() => act((e) => e.gotoError())} title={status.msg && t.msg(status.msg)}>
              · {t.n(status.warnings, '{n} duplicate key', '{n} duplicate keys')}
            </button>
          )}
        </span>
      );
    default: {
      const err = status.kind === 'error';
      return (
        <button type="button" className={`st st-link ${err ? 'err' : 'warn'}`} onClick={() => act((e) => e.gotoError())} title={t('Go to error')}>
          <i className="dot" />
          <span className="st-msg">{t('Ln {line}, Col {col}: {msg}', { line: status.line, col: status.col, msg: t.msg(status.msg) })}</span>
        </button>
      );
    }
  }
}

const CODECS = [
  ['gzip', 'gzip'],
  ['brotli', 'brotli'],
  ['zstd', 'zstd'],
] as const;

/** What you have, what you'd ship, what goes over the wire: raw, minified and compressed sizes side by side. */
function Sizes() {
  const raw = useUI((s) => s.stats?.bytes);
  const sizes = useUI((s) => s.sizes);
  // A JWT input has no minified form of its own: just its raw size.
  const parsed = useUI((s) => (s.status.kind === 'valid' && !s.status.jwt) || s.status.kind === 'fixable');
  const t = useT();
  if (raw === undefined) return null;
  const less = (n: number) => (raw > n ? t(' · ') + t('{percent}% smaller than the input', { percent: Math.round((1 - n / raw) * 100) }) : '');
  return (
    <span className={sizes?.stale ? 'sizes stale' : 'sizes'}>
      <span className="sz sz-raw" data-tip={t('Input, as typed')} data-tip-up="">
        {t.bytes(raw)} <i>{t('raw')}</i>
      </span>
      {sizes ? (
        <>
          <span className="sz sz-min" data-tip={t('Minified') + less(sizes.min)} data-tip-up="">
            {t.bytes(sizes.min)} <i>{t('min')}</i>
          </span>
          {CODECS.map(([k, label]) => {
            const n = sizes[k];
            return n === undefined ? null : (
              <span key={k} className="sz" data-tip={t('Minified, then {codec}-compressed (what a server sends)', { codec: label }) + less(n)} data-tip-up="">
                {t.bytes(n)} <i>{label}</i>
              </span>
            );
          })}
        </>
      ) : (
        parsed && (
          <span className="sz" aria-hidden="true">
            … <i>{t('min')}</i>
          </span>
        )
      )}
    </span>
  );
}

function Stats() {
  const stats = useUI((s) => s.stats);
  const t = useT();
  if (!stats) return null;
  return (
    <span className="stats muted" title={t('Parsed in {ms} ms', { ms: t.lang ? t.num(Math.round(stats.ms * 10) / 10) : stats.ms.toFixed(1) })}>
      {t.n(stats.lines, '{n} line', '{n} lines')} · {t.n(stats.nodes, '{n} node', '{n} nodes')} · {t('depth {depth}', { depth: stats.depth })}
    </span>
  );
}

function Cursor() {
  const { line, col, sel } = useUI((s) => s.cursor);
  const t = useT();
  return (
    <span className="cursor muted">
      {t('Ln {line}, Col {col}', { line, col })}
      {sel > 0 && ' ' + t.n(sel, '({n} selected)', '({n} selected)')}
    </span>
  );
}

/** One quiet line: status and document stats on the left; caret, commands and theme on the right. */
function StatusBar({ langs }: { langs?: ReactNode }) {
  const theme = useUI((s) => s.settings.theme);
  const t = useT();
  const themeLabel = t(theme === 'light' ? 'Theme: light' : theme === 'dark' ? 'Theme: dark' : 'Theme: system');
  return (
    <footer className="statusbar">
      <div className="sb-l">
        <StatusMsg />
        <Sizes />
        <Stats />
      </div>
      <div className="sb-r">
        <Cursor />
        <Link className="sb-btn" href="/blogs" prefetch={false} hrefLang={t.lang ? 'en' : undefined}>
          {t('Blog')}
        </Link>
        {langs}
        <button type="button" className="sb-btn" onClick={() => act((e) => e.openPalette())} aria-label={t('All commands')} data-tip={t('All commands')} data-tip-up="">
          <span className="fine-only">
            <Kbd k="mod+K" />
          </span>
          <Icon name="command" size={14} className="coarse-only" />
        </button>
        <button
          type="button"
          className="sb-btn"
          onClick={() => act((e) => e.cycleTheme())}
          aria-label={themeLabel}
          data-tip={themeLabel}
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
  const t = useT();
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.kind === 'ok' && <Icon name="check" size={14} />}
          {toast.kind === 'err' && <Icon name="alert" size={14} />}
          {t.msg(toast.msg)}
          {toast.action && (
            <button
              type="button"
              className="toast-act"
              onClick={() => {
                store.set({ toast: null });
                toast.action?.run();
              }}
            >
              {t.msg(toast.action.label)}
            </button>
          )}
          {toast.action && (
            <button type="button" className="toast-x" aria-label={t('Dismiss')} onClick={() => store.set({ toast: null })}>
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
  const t = useT();
  if (!dragging) return null;
  return (
    <div className="drop">
      <div>
        <Icon name="open" size={28} />
        {t('Drop to open your JSON file')}
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export default function JsonTool({ preset, langs }: { preset?: EnginePreset; /** Language switcher (server-rendered links). */ langs?: ReactNode } = {}) {
  const t = useT();
  const tRef = useRef(t);
  const presetRef = useRef(preset);
  const edRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const fmtRef = useRef<HTMLDivElement>(null);
  const ed2Ref = useRef<HTMLDivElement>(null);
  const comparing = useUI((s) => s.settings.view === 'compare');
  const empty = useUI((s) => s.empty);

  useEffect(() => {
    const pagePreset = presetRef.current;
    // Engine DOM code (folds, tooltips, value hints) reads the page's strings from here.
    setRuntime(tRef.current);
    const e = new Engine({
      editor: edRef.current!,
      tree: treeRef.current!,
      table: tableRef.current!,
      file: fileRef.current!,
      code: codeRef.current!,
      fmt: fmtRef.current!,
      editor2: ed2Ref.current!,
    }, { preserveDocument: !!pagePreset?.initialText });
    setEngine(e);
    // A landing page's sample loads in the next task: hydration and the empty editor
    // paint first, and neither half is one long blocking task on a slow phone.
    const sample = pagePreset?.initialText ? window.setTimeout(() => e.applyPreset(pagePreset), 0) : 0;
    const warm = window.setTimeout(() => idle(() => void import('./CompareView')), 6000);
    return () => {
      window.clearTimeout(sample);
      window.clearTimeout(warm);
      e.destroy();
      if (getEngine() === e) setEngine(null);
      store.set({ ready: false });
    };
  }, []);

  return (
    <div className={`app${comparing ? ' comparing' : ''}${empty ? ' is-empty' : ''}`}>
      {!preset && (
        <>
          <h1 className="sr-only">{t('Tool Kumar: JSON Formatter & Viewer')}</h1>
          <p className="sr-only">{t('Format, validate, repair and explore JSON instantly. Tree, table, convert and compare views. No upload, no ads, works offline.')}</p>
        </>
      )}
      {/* The page supplies the main landmark (home: around the tool and its guide; landing pages: the content below). */}
      <div className="panes">
        <EditorPane edRef={edRef} />
        <ComparePane edRef={ed2Ref} />
        <Splitter />
        <Watermark />
        <ViewerPane treeRef={treeRef} tableRef={tableRef} codeRef={codeRef} fmtRef={fmtRef} />
      </div>
      <StatusBar langs={langs} />
      <ToastHost />
      <DropOverlay />
      <CommandPalette />
      <ShortcutsDialog />
      <input ref={fileRef} type="file" accept=".json,.geojson,.jsonl,.ndjson,.har,.map,.txt,.log,.csv,.tsv,.yaml,.yml,.xml,.toml,application/json,text/plain" hidden />
    </div>
  );
}
