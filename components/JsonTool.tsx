'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PRIVATE, PRIVATE_LABELS } from '@/lib/analytics';
import { Engine, type EnginePreset } from '@/lib/engine/engine';
import { idle } from '@/lib/engine/idle';
import { act, getEngine, setEngine } from '@/lib/engine/instance';
import { store, useUI, type CsvDelimiter, type IndentId, type JwtInfo, type SourceFormat, type View } from '@/lib/engine/store';
import { TARGETS, targetInfo } from '@/lib/engine/targets';
import { useT } from '@/lib/i18n/react';
import { parseLink } from '@/lib/link';
import { startAgentTools } from '@/lib/webmcp';
import { setRuntime, type T } from '@/lib/i18n/ui';
import { Icon, type IconName } from './icons';
import { Kbd } from './Kbd';
import { EditorFoldItems, FoldItems, MCheck, MChoice, MHead, MItem, MLink, MSep, Menu, WrapItem } from './menu';

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

/** Format names as the interface says them (never translated). */
const FORMATS: { v: SourceFormat; label: string }[] = [
  { v: 'json', label: 'JSON' },
  { v: 'yaml', label: 'YAML' },
  { v: 'csv', label: 'CSV' },
  { v: 'xml', label: 'XML' },
  { v: 'toml', label: 'TOML' },
];
const formatLabel = (f: SourceFormat) => FORMATS.find((x) => x.v === f)!.label;

/** What the input is read as: JSON, or a format whose JSON the views show (the input stays as it is). */
function FormatPick() {
  const format = useUI((s) => s.input.format);
  const t = useT();
  return (
    <label className="pick fmt-pick" data-tip={t('Read the input as JSON, YAML, CSV, XML or TOML')}>
      <span className="sr-only">{t('Input format')}</span>
      <select value={format} onChange={(e) => act((en) => en.setInput(e.target.value as SourceFormat))}>
        {FORMATS.map((f) => (
          <option key={f.v} value={f.v}>
            {f.label}
          </option>
        ))}
      </select>
      <Icon name="down" size={12} />
    </label>
  );
}

const SEPARATORS: { v: CsvDelimiter; label: string }[] = [
  { v: 'auto', label: 'Auto' },
  { v: ',', label: ',' },
  { v: ';', label: ';' },
  { v: '\t', label: 'Tab' },
  { v: '|', label: '|' },
];

/** CSV input: the separator, the header row and typed values. */
function CsvOptions() {
  const csv = useUI((s) => s.input.format === 'csv');
  const delimiter = useUI((s) => s.input.delimiter);
  const header = useUI((s) => s.settings.csvHeader);
  const types = useUI((s) => s.settings.csvTypes);
  if (!csv) return null;
  return (
    <Menu label="CSV options" icon="sliders" hideLabel start>
      {() => (
        <>
          <MHead>CSV</MHead>
          <MChoice label="Separator" value={delimiter} options={SEPARATORS} onPick={(v) => act((e) => e.setCsv({ delimiter: v }))} />
          <MCheck label="First row is the header" checked={header} onClick={() => act((e) => e.setCsv({ header: !header }))} />
          <MCheck label="Detect numbers and booleans" checked={types} onClick={() => act((e) => e.setCsv({ types: !types }))} />
        </>
      )}
    </Menu>
  );
}

/** Input side: only what concerns the input itself. Everything that transforms it lives on the right. */
const InputBar = memo(function InputBar() {
  const fileName = useUI((s) => s.fileName);
  const comparing = useUI((s) => s.settings.view === 'compare');
  const t = useT();
  return (
    <div className="toolbar" role="toolbar" aria-label={t('Input')}>
      <span className={`fname ${PRIVATE}`} title={fileName ?? undefined}>
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
      <FormatPick />
      <CsvOptions />
      <span className="grow" />
      {/* The link, or a "View in Tool Kumar" button around it as /integrate makes them (lib/badge.ts). */}
      <Menu label="Share" icon="share" tip={comparing ? 'Share both documents as a link or a button (nothing is uploaded)' : 'Share this JSON as a link or a button (nothing is uploaded)'}>
        {(close) => (
          <>
            <MItem label={comparing ? 'Copy comparison link' : 'Copy link'} onClick={() => act((e) => e.share())} close={close} />
            <MItem label="Copy Markdown button" onClick={() => act((e) => e.share('markdown'))} close={close} />
            <MItem label="Copy HTML button" onClick={() => act((e) => e.share('html'))} close={close} />
            <MSep />
            <MLink label="Make a button" href="/integrate#builder" close={close} />
            <MLink label="Handoff docs (JSON of any size)" href="/integrate#handoff" close={close} />
          </>
        )}
      </Menu>
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
    <div className={`ed ${PRIVATE}`} ref={edRef}>
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
  const format = useUI((s) => s.input.format);
  const t = useT();
  const json = format === 'json';
  const label = json ? t('JSON input') : t('{format} input', { format: formatLabel(format) });
  return (
    <section className="pane pane-ed" aria-label={label}>
      <InputBar />
      <EditorDom edRef={edRef} id="input" label={label} placeholder={json ? t("Looks like someone's got a JSON…") : t('Paste or type {format}…', { format: formatLabel(format) })} autoFocus />
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
        <span className={`fname ${PRIVATE}`} title={cmpFile ?? undefined}>
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
              <MItem label="Copy comparison link" onClick={() => act((e) => e.share())} close={close} />
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

// ── Menus (⋯): pieces in ./menu ──────────────────────────────────────────────

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
          {view === 'graph' && (
            <>
              <MHead>Graph</MHead>
              <MItem label="Fit to screen" keys="0" onClick={() => act((e) => e.fitGraph())} close={close} />
              <MItem label="Zoom in" keys="+" onClick={() => act((e) => e.zoomGraph(1.25))} close={close} />
              <MItem label="Zoom out" keys="-" onClick={() => act((e) => e.zoomGraph(0.8))} close={close} />
              <FoldItems close={close} />
              <MSep />
              <MItem label="Copy path" keys="P" onClick={() => act((e) => e.copyPath())} close={close} />
              <MItem label="Copy value" keys="C" onClick={() => act((e) => e.copyValue())} close={close} />
              <MItem label="Go to start" keys="Home" onClick={() => act((e) => e.graphJump('start'))} close={close} />
              <MItem label="Go to end" keys="End" onClick={() => act((e) => e.graphJump('end'))} close={close} />
              <MSep />
              <MItem label="Export image…" onClick={() => act((e) => e.openGraphExport())} close={close} />
              <MItem label="Copy image" onClick={() => act((e) => e.copyGraphImage())} close={close} />
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
  return <FindInput key={seq} initial={q} q={q} total={total} index={index} note={note} view={view} />;
}

/** `q`: the query `total` and `index` are for (the text typed may be newer, its search still to run). */
function FindInput({ initial, q, total, index, note, view }: { initial: string; q: string; total: number; index: number; note?: string; view: View }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const timer = useRef(0);
  const run = (v: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => act((e) => e.find(v)), v.length > 2 ? 80 : 150);
  };
  // A query still waiting when the bar closes (Compare, the tool closing) would open it again: dropped.
  useEffect(() => () => window.clearTimeout(timer.current), []);
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
        placeholder={t(view === 'tree' || view === 'graph' ? 'Find, or $.path' : 'Find')}
        aria-label={t('Find in view')}
        spellCheck={false}
        autoComplete="off"
      />
      <span className="count" aria-live="polite" title={note && t.msg(note)}>
        {text && text === q ? (total ? t('{i} of {total}', { i: t.num(index + 1), total: total >= 100000 ? '100k+' : t.num(total) }) : t(note ? 'Concrete paths only' : 'No results')) : ''}
      </span>
      <button type="button" className="btn icon sm" aria-label={t('Previous match')} onClick={() => act((e) => e.findStep(-1))}>
        <Icon name="up" size={14} />
      </button>
      <button type="button" className="btn icon sm" aria-label={t('Next match')} onClick={() => act((e) => e.findStep(1))}>
        <Icon name="down" size={14} />
      </button>
      <button
        type="button"
        className="btn icon sm"
        aria-label={t('Close find')}
        onClick={() => {
          window.clearTimeout(timer.current);
          act((e) => e.closeFind());
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Viewer toolbar: tabs · one main control · four fixed icons ──────────────

/** Breadcrumbs shown after `$`: a deeper location keeps its last ones, after "…" for the level above them. */
const CRUMBS = 12;
const crumb = (k: string | number) => (typeof k === 'number' ? `[${k}]` : k);

function Crumbs() {
  const { segs, rows, cols, ok } = useUI((s) => s.table);
  const t = useT();
  if (!ok) return <span className="muted sm">{t('Select an array or object')}</span>;
  const from = Math.max(0, segs.length - CRUMBS);
  return (
    <nav className={`crumbs ${PRIVATE}`} aria-label={t('Table location')}>
      <button type="button" onClick={() => act((e) => e.tableGoto([]))}>$</button>
      {from > 0 && (
        <span>
          <Icon name="down" size={12} className="sep" />
          <button type="button" aria-label={crumb(segs[from - 1])} onClick={() => act((e) => e.tableGoto(segs.slice(0, from)))}>
            …
          </button>
        </span>
      )}
      {segs.slice(from).map((k, j) => (
        <span key={from + j}>
          <Icon name="down" size={12} className="sep" />
          <button type="button" onClick={() => act((e) => e.tableGoto(segs.slice(0, from + j + 1)))}>
            {crumb(k)}
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
  { id: 'graph', label: 'Graph' },
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
        {pretty > 0 && <span className={`seg-size ${PRIVATE}`}>{t.bytes(pretty)}</span>}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={minify && !escape}
        className={PRIVATE_LABELS}
        onClick={() => act((e) => e.setFormat({ minify: true, escape: false }))}
        data-tip={saved > 0 ? t('{percent}% smaller', { percent: saved }) : t('One line, no whitespace')}
      >
        {t('Minify')}
        {minified > 0 && <span className={`seg-size ${PRIVATE}`}>{t.bytes(minified)}</span>}
      </button>
      <button type="button" role="radio" aria-checked={escape} onClick={() => act((e) => e.setFormat({ escape: true }))} data-tip={t('Minified, then escaped as one JSON string')}>
        {t('String')}
        {escaped > 0 && <span className={`seg-size ${PRIVATE}`}>{t.bytes(escaped)}</span>}
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
    <button type="button" className={`path ${PRIVATE}`} onClick={() => act((e) => e.copyPath())} data-tip={t('Copy path')}>
      {/* (Its start is what shows: a very deep node's path, hundreds of thousands of characters, isn't laid out whole.) */}
      {path.length > 300 ? path.slice(0, 300) + '…' : path}
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
        {(view === 'tree' || view === 'graph') && <TreePath />}
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
          <Btn icon="copy" label={view === 'tree' || view === 'graph' ? 'Copy (selected value or all)' : view === 'table' ? 'Copy as CSV' : 'Copy'} hideLabel onClick={() => act((e) => e.copyView())} />
          <Btn icon="download" label={view === 'graph' ? 'Export image' : view === 'table' ? 'Download CSV' : 'Download'} hideLabel onClick={() => act((e) => e.downloadView())} />
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
  // (An unsigned token, alg "none", is a warning as an expired one is: anyone can make it.)
  return (
    <span className={`st ${w.warn || jwt.unsigned ? 'warn' : 'ok'}`} title={jwt.unsigned ? t('Not signed: anyone can create or change this token.') : t('Decoded in your browser. The signature is not verified.')}>
      <i className="dot" />
      {['JWT', jwt.alg, jwt.unsigned && t('not signed'), w.text].filter(Boolean).join(t(' · '))}
    </span>
  );
}

function Banner() {
  const status = useUI((s) => s.status);
  const hint = useUI((s) => s.hint);
  const t = useT();
  // (Input read as another format that clearly is something else: CSV reads almost any text.)
  if (status.kind === 'valid' && status.src && hint && hint !== 'unescape') {
    return (
      <div className="banner info" role="status" aria-live="polite">
        <Icon name="braces" size={15} />
        <span className="b-msg">
          <b>{t('This looks like {format}', { format: formatLabel(hint) })}</b>
          <span>{t('It is read as {format} now.', { format: formatLabel(status.src) })}</span>
        </span>
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.setInput(hint))} data-tip={t('Keep the input as it is and show its JSON')}>
          {t('Read as {format}', { format: formatLabel(hint) })}
        </button>
      </div>
    );
  }
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
  // (Input in another format: its own error, in its own terms.)
  const src = status.kind === 'error' ? status.src : undefined;
  return (
    <div className={`banner ${err ? 'err' : 'warn'}`} role="status" aria-live="polite">
      <Icon name="alert" size={15} />
      <button type="button" className="b-msg" onClick={() => act((e) => e.gotoError())}>
        <b>{src ? t('Invalid {format}', { format: formatLabel(src) }) : err ? t('Invalid JSON') : t.n(status.count, 'Not strict JSON · {n} fixable issue', 'Not strict JSON · {n} fixable issues')}</b>
        <span>{t('Ln {line}, Col {col}: {msg}', { line: status.line, col: status.col, msg: t.msg(status.msg) })}</span>
      </button>
      {hint === 'unescape' && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.unescapeDoc())}>
          {t('Unescape JSON')}
        </button>
      )}
      {hint && hint !== 'unescape' && (
        <button type="button" className="btn sm accent" onClick={() => act((e) => e.setInput(hint))} data-tip={t('Keep the input as it is and show its JSON')}>
          {t('Read as {format}', { format: formatLabel(hint) })}
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

function FormatNote() {
  const tooLarge = useUI((s) => s.fmt.tooLarge);
  const t = useT();
  if (!tooLarge) return null;
  return <div className="cv-note">{t('The result is too large')}</div>;
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
  graphRef,
  codeRef,
  fmtRef,
  cmpRef,
}: {
  treeRef: React.RefObject<HTMLDivElement | null>;
  fmtRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  graphRef: React.RefObject<HTMLDivElement | null>;
  codeRef: React.RefObject<HTMLDivElement | null>;
  cmpRef: React.RefObject<HTMLDivElement | null>;
}) {
  const view = useUI((s) => s.settings.view);
  const stale = useUI((s) => s.stale);
  const empty = useUI((s) => s.empty);
  const t = useT();
  return (
    <section className="pane pane-view" aria-label={t('JSON viewer')}>
      <ViewToolbar />
      {/* Everything in here shows the document: session replay records it as an empty box. */}
      <div className={`view ${PRIVATE}${stale ? ' stale' : ''}`}>
        <Banner />
        <FindBar />
        <div id="view-format" className="cv cv-wrap" ref={fmtRef} hidden={view !== 'format' || empty} tabIndex={0} aria-label={t('Formatted output')}>
          <div className="cv-sizer">
            <div className="cv-rows" />
          </div>
          <FormatNote />
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
        {/* A grid while it shows an array or object: TableView sets its role, label and tab stop. */}
        <div id="view-table" className="tbl" ref={tableRef} hidden={view !== 'table' || empty}>
          <div className="tb-head" role="row" aria-rowindex={1} />
          <div className="tb-sizer" role="none">
            <div className="tb-rows" role="none" />
          </div>
          <div className="tb-empty" hidden>
            {t('Select an array or object in the tree to see it as a table.')}
          </div>
        </div>
        <div id="view-graph" className="gv" ref={graphRef} tabIndex={0} hidden={view !== 'graph' || empty} />
        <div id="view-convert" className="cv" ref={codeRef} hidden={view !== 'convert' || empty} tabIndex={0} aria-label={t('Converted output')}>
          <div className="cv-sizer">
            <div className="cv-rows" />
          </div>
          <ConvertNote />
        </div>
        <div id="view-compare" className="cmp-host" ref={cmpRef} hidden={view !== 'compare'}>
          {view === 'compare' && <CompareHost />}
        </div>
      </div>
    </section>
  );
}

// Opened by a key, a menu or a right click: loaded once the page is idle (not with its own loading), or at
// once if opened before. (The menu's portal is made here, so react-dom stays with the first load alone.)
const CommandPalette = dynamic(() => import('./dialogs').then((m) => m.CommandPalette), { ssr: false });
const ShortcutsDialog = dynamic(() => import('./dialogs').then((m) => m.ShortcutsDialog), { ssr: false });
const ContextMenuPopup = dynamic(() => import('./ContextMenu'), { ssr: false });

/** True once the page has been idle after it started. */
function useIdle() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let gone = false;
    idle(() => {
      if (!gone) setDone(true);
    });
    return () => {
      gone = true;
    };
  }, []);
  return done;
}

function Dialogs() {
  const open = useUI((s) => !!s.palette || s.shortcuts);
  const later = useIdle();
  return open || later ? (
    <>
      <CommandPalette />
      <ShortcutsDialog />
    </>
  ) : null;
}

function ContextMenu() {
  const open = useUI((s) => s.menu);
  return open ? createPortal(<ContextMenuPopup key={open.id} m={open} />, document.body) : null;
}

// The graph's export dialog is code-split too: it loads the first time it opens
// (and is prefetched with Compare, for offline use).
const GraphExportDialog = dynamic(() => import('./GraphExport'), { ssr: false });

function GraphExportHost() {
  const open = useUI((s) => s.graphExport);
  return open ? <GraphExportDialog /> : null;
}

// Compare is code-split: it loads the first time its tab opens (and is
// prefetched in the background shortly after startup for offline use).
const CompareView = dynamic(() => import('./CompareView'), {
  ssr: false,
  loading: function Loading() {
    return <div className="cv-note">{useT()('Loading compare…')}</div>;
  },
});
/**
 * Huge-file mode (a file too big for the editor, lib/huge): its own viewer, loaded with it only when one opens.
 * (Its status goes in the status bar through react-dom's portal, handed over: react-dom stays in the first load's chunks.)
 */
function HugeHost() {
  const viewer = useUI((s) => s.huge);
  return viewer ? viewer(createPortal) : null;
}

const UNITS: Record<IndentId, string> = { '2': '  ', '4': '    ', tab: '\t' };
const onJump = (l: number | undefined, r: number | undefined) => act((e) => e.compareJump(l, r));
const onMarks = (l: Uint8Array | null, r: Uint8Array | null) => act((e) => e.compareMarks(l, r));
const onSwap = () => act((e) => e.swapCompare());

function CompareHost() {
  const leftText = useUI((s) => s.docText);
  const rightText = useUI((s) => s.cmpText);
  const rightParsed = useUI((s) => s.cmpParsed);
  const indent = useUI((s) => s.settings.indent);
  return <CompareView leftText={leftText} rightText={rightText} rightParsed={rightParsed} indent={UNITS[indent]} onJump={onJump} onMarks={onMarks} onSwap={onSwap} />;
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

const percentFormats = new Map<string | undefined, Intl.NumberFormat>();
/** 0.42 → "42%" in the page's language (made on first use: number formats cost a cold phone). */
function percent(x: number, lang?: string) {
  let f = percentFormats.get(lang);
  if (!f) percentFormats.set(lang, (f = new Intl.NumberFormat(lang, { style: 'percent' })));
  return f.format(x);
}

function StatusMsg() {
  const status = useUI((s) => s.status);
  const t = useT();
  switch (status.kind) {
    case 'empty':
      return <span className="st muted">{t('Ready')}</span>;
    case 'parsing':
      return (
        <span className="st muted">
          <i className="spin" />
          <span className="st-msg">
            {t('Parsing…')}
            {status.progress !== undefined && <span className="st-pct"> {percent(status.progress, t.lang)}</span>}
          </span>
        </span>
      );
    case 'valid':
      if (status.jwt) return <JwtStatus jwt={status.jwt} />;
      return (
        <span className="st ok" title={status.jsonl ? t('One JSON value per line, shown as an array of records') : undefined}>
          <i className="dot" />
          <span className="st-msg">{status.src ? t('Valid {format}', { format: formatLabel(status.src) }) : status.jsonl ? t.n(status.jsonl, 'JSON Lines · {n} record', 'JSON Lines · {n} records') : t('Valid JSON')}</span>
          {status.warnings > 0 && (
            <button type="button" className="st-link warn" onClick={() => act((e) => e.gotoError())} title={status.msg && t.msg(status.msg)}>
              · {status.more ? t('{n}+ duplicate keys', { n: t.num(status.warnings) }) : t.n(status.warnings, '{n} duplicate key', '{n} duplicate keys')}
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
  // A JWT input has no minified form of its own: just its raw size (nor has another format: its JSON's are the Format view's).
  const parsed = useUI((s) => (s.status.kind === 'valid' && !s.status.jwt && !s.status.src) || s.status.kind === 'fixable');
  // (While a document loads, what is known is the one before's.)
  const loading = useUI((s) => s.status.kind === 'parsing');
  const t = useT();
  if (raw === undefined || loading) return null;
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
  const loading = useUI((s) => s.status.kind === 'parsing');
  const t = useT();
  if (!stats || loading) return null;
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
    <span className={`cursor muted ${PRIVATE}`}>
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
      {/* Status, sizes and counts all describe the document. */}
      <div className={`sb-l ${PRIVATE}`}>
        <StatusMsg />
        <Sizes />
        <Stats />
      </div>
      <div className="sb-r">
        <Cursor />
        {/* Narrow screens show an icon instead of the word (app/globals.css). */}
        <Link
          className="sb-btn sb-integrate"
          href="/integrate"
          prefetch={false}
          hrefLang={t.lang ? 'en' : undefined}
          aria-label={t('Integrate')}
          data-tip={t('Integrate')}
          data-tip-up=""
        >
          <span className="sb-integrate-word">{t('Integrate')}</span>
          <Icon name="code" size={14} className="sb-integrate-icon" />
        </Link>
        <Link className="sb-btn" href="/blogs" prefetch={false} hrefLang={t.lang ? 'en' : undefined}>
          {t('Blog')}
        </Link>
        <Link className="sb-btn sb-privacy" href="/privacy" prefetch={false} hrefLang={t.lang ? 'en' : undefined}>
          {t('Privacy')}
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
    <div className={`toasts ${PRIVATE}`} aria-live="polite" role="status">
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
  const graphRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const fmtRef = useRef<HTMLDivElement>(null);
  const ed2Ref = useRef<HTMLDivElement>(null);
  const cmpRef = useRef<HTMLDivElement>(null);
  const comparing = useUI((s) => s.settings.view === 'compare');
  const empty = useUI((s) => s.empty);

  // Every [data-tip] in the tool, shown above panes, dialogs and fullscreen views (loaded once the page is idle).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    idle(() =>
      void import('@/lib/tooltips').then((m) => {
        if (!gone) stop = m.startTooltips();
      }),
    );
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  // Stops the engine below, once. Leaving the page, Next.js keeps its DOM, hidden (an <Activity>): this layout
  // effect's cleanup runs as it hides, before the browser lays the hidden tool out. The effect cleanup below
  // comes after that frame, too late: the engine's observers would meanwhile rewrap a big document to no width.
  const stopRef = useRef<() => void>(null);
  useLayoutEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    // A link to a landing page opens the linked documents instead of the page's sample.
    const pagePreset = parseLink(location.hash) ? undefined : presetRef.current;
    // Engine DOM code (folds, tooltips, value hints) reads the page's strings from here.
    setRuntime(tRef.current);
    const e = new Engine({
      editor: edRef.current!,
      tree: treeRef.current!,
      table: tableRef.current!,
      graph: graphRef.current!,
      file: fileRef.current!,
      code: codeRef.current!,
      fmt: fmtRef.current!,
      editor2: ed2Ref.current!,
      compare: cmpRef.current!,
    }, { preserveDocument: !!pagePreset?.initialText });
    setEngine(e);
    // AI agents in browsers with WebMCP can use the tool through named functions (costs nothing elsewhere).
    const stopAgentTools = startAgentTools();
    // A landing page's sample loads in the next task: hydration and the empty editor
    // paint first, and neither half is one long blocking task on a slow phone.
    const sample = pagePreset?.initialText ? window.setTimeout(() => e.applyPreset(pagePreset), 0) : 0;
    // The context menu loads once the page is idle, before a right click needs it.
    idle(() => void import('./ContextMenu'));
    const warm = window.setTimeout(() => idle(() => {
      void import('./CompareView');
      void import('./GraphExport');
    }), 6000);
    const stop = () => {
      if (stopRef.current !== stop) return;
      stopRef.current = null;
      window.clearTimeout(sample);
      window.clearTimeout(warm);
      stopAgentTools();
      e.destroy();
      if (getEngine() === e) setEngine(null);
      store.set({ ready: false });
    };
    stopRef.current = stop;
    return stop;
  }, []);

  return (
    <div className={`app${comparing ? ' comparing' : ''}${empty ? ' is-empty' : ''}`}>
      {!preset && <h1 className="sr-only">{t('Tool Kumar: JSON Formatter & Viewer')}</h1>}
      {/* The page supplies the main landmark (home: around the tool and its guide; landing pages: the content below). */}
      <div className="panes">
        <EditorPane edRef={edRef} />
        <ComparePane edRef={ed2Ref} />
        <Splitter />
        <Watermark />
        <ViewerPane treeRef={treeRef} tableRef={tableRef} graphRef={graphRef} codeRef={codeRef} fmtRef={fmtRef} cmpRef={cmpRef} />
        <HugeHost />
      </div>
      <StatusBar langs={langs} />
      <ToastHost />
      <DropOverlay />
      <Dialogs />
      <ContextMenu />
      <GraphExportHost />
      <input ref={fileRef} className={PRIVATE} type="file" accept=".json,.geojson,.jsonl,.ndjson,.har,.map,.txt,.log,.csv,.tsv,.yaml,.yml,.xml,.toml,application/json,text/plain" hidden />
    </div>
  );
}
