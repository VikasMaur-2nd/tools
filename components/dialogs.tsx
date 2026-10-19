'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { COMMANDS, fuzzy, keyLabel, type Command } from '@/lib/engine/commands';
import { store, useUI } from '@/lib/engine/store';
import { act, getEngine } from '@/lib/engine/instance';
import type { ExportPreview, GraphExport } from '@/lib/graph/types';
import { PRIVATE, track, withVia } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import { Kbd } from './Kbd';
import { Icon } from './icons';

/** A native <dialog> opened/closed from store state (focus trap + Esc for free). */
function Modal({ open, onClose, className, label, children }: { open: boolean; onClose: () => void; className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      {open && children}
    </dialog>
  );
}

export function CommandPalette() {
  const mode = useUI((s) => s.palette);
  const t = useT();
  return (
    <Modal open={!!mode} onClose={() => store.set({ palette: false })} className="palette" label={t('Command palette')}>
      {mode === 'url' ? <UrlPrompt /> : <Commands />}
    </Modal>
  );
}

function Commands() {
  const settings = useUI((s) => s.settings);
  const mac = useUI((s) => s.mac);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const t = useT();
  // Titles and search terms in the page's language; the English ones stay searchable.
  const names = useMemo(() => {
    const m = new Map<Command, { title: string; group: string; hay: string }>();
    for (const c of COMMANDS) {
      const terms = `${c.group} ${c.terms ?? ''}`;
      const hay = t.lang ? `${t(c.group)} ${c.terms ? t(c.terms) : ''} ${c.id.startsWith('to-') ? t('convert') : ''} ${terms} ${c.title}` : terms;
      m.set(c, { title: t.msg(c.title), group: t(c.group), hay });
    }
    return m;
  }, [t]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.map((c) => ({ c, s: Math.max(fuzzy(needle, names.get(c)!.title) * 1.2, fuzzy(needle, names.get(c)!.hay)) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q, names]);

  const active = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command) => {
    // Close the native dialog first so the browser restores focus (and the
    // editor's selection) before the command runs: commands may move focus.
    listRef.current?.closest('dialog')?.close();
    track('command_run', { command: c.id });
    requestAnimationFrame(() => act((e) => withVia('palette', () => c.run(e))));
  };

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setSel((active + 1) % Math.max(1, list.length));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setSel((active - 1 + list.length) % Math.max(1, list.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (list[active]) run(list[active]);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.currentTarget.closest('dialog')?.close();
    }
  };

  const state = { ...store.get(), settings };
  return (
    <>
      <div className="pl-input">
        <Icon name="command" size={16} />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder={t('Type a command…')}
          aria-label={t('Search commands')}
          role="combobox"
          aria-expanded="true"
          aria-controls="pl-list"
          aria-activedescendant={list[active] ? `pl-${list[active].id}` : undefined}
          spellCheck={false}
        />
      </div>
      <ul className="pl-list" id="pl-list" role="listbox" ref={listRef}>
        {list.map((c, i) => (
          <li
            key={c.id}
            id={`pl-${c.id}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'on' : undefined}
            onMouseMove={() => i !== active && setSel(i)}
            onClick={() => run(c)}
          >
            <span className="pl-check">{c.active?.(state) && <Icon name="check" size={14} />}</span>
            <span className="pl-title">{names.get(c)!.title}</span>
            <span className="pl-group">{names.get(c)!.group}</span>
            {c.keys && (
              <span className="kbd">
                {keyLabel(c.keys, mac).map((k, j) => (
                  <kbd key={j}>{k}</kbd>
                ))}
              </span>
            )}
          </li>
        ))}
        {!list.length && <li className="pl-none">{t('No matching commands')}</li>}
      </ul>
    </>
  );
}

function UrlPrompt() {
  const [url, setUrl] = useState('');
  const t = useT();
  return (
    <form
      className="pl-input"
      onSubmit={(e) => {
        e.preventDefault();
        e.currentTarget.closest('dialog')?.close();
        act((en) => en.fetchUrl(url));
      }}
    >
      <Icon name="globe" size={16} />
      <input
        className={PRIVATE}
        autoFocus
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t('https://api.example.com/data.json (press Enter to load)')}
        aria-label={t('URL to load JSON from')}
        spellCheck={false}
      />
    </form>
  );
}

/** [keys, what it does, keys on macOS if different] */
const SHORTCUTS: { title: string; items: [string, string, string?][] }[] = [
  {
    title: 'General',
    items: [
      ['mod+K', 'Command palette'],
      ['mod+O', 'Open file'],
      ['mod+S', 'Download JSON'],
      ['mod+F', 'Find in the open view'],
      ['Alt+1', 'Format view'],
      ['Alt+2', 'Tree view'],
      ['Alt+3', 'Table view'],
      ['Alt+4', 'Graph view'],
      ['Alt+5', 'Convert'],
      ['Alt+6', 'Compare'],
      ['Alt+Z', 'Wrap long lines on or off'],
      ['?', 'This help'],
    ],
  },
  {
    title: 'Editor',
    items: [
      ['mod+Enter', 'Use output as input'],
      ['mod+Shift+Enter', 'Minify input'],
      ['Shift+Alt+F', 'Format input in place'],
      ['Tab', 'Indent · Shift+Tab outdent'],
      ['mod+Shift+[', 'Fold block at caret', 'Alt+mod+['],
      ['mod+Shift+]', 'Unfold block at caret', 'Alt+mod+]'],
      ['mod+C', 'Copy all (nothing selected)'],
      ['mod+Z', 'Undo any change'],
      ['Esc', 'Jump to tree'],
    ],
  },
  {
    title: 'Tree',
    items: [
      ['↑+↓', 'Move selection'],
      ['←+→', 'Collapse / expand'],
      ['Space', 'Toggle · Shift for all'],
      ['*', 'Expand everything below'],
      ['Enter', 'Show in editor'],
      ['C', 'Copy value'],
      ['P', 'Copy path'],
      ['Esc', 'Back to editor'],
    ],
  },
  {
    title: 'Graph',
    items: [
      ['↑+↓+←+→', 'Move selection'],
      ['Enter', 'Show in editor'],
      ['Space', 'Collapse / expand'],
      ['+ / -', 'Zoom in / out'],
      ['0', 'Fit to screen'],
      ['F', 'Full screen'],
      ['Home', 'Go to start'],
      ['End', 'Go to end'],
      ['PgUp+PgDn', 'Scroll a screen'],
      ['Drag', 'Pan graph'],
      ['mod+Wheel', 'Zoom graph'],
      ['C', 'Copy value'],
      ['P', 'Copy path'],
      ['Esc', 'Back to editor'],
    ],
  },
  {
    title: 'Search',
    items: [
      ['Enter', 'Next match'],
      ['Shift+Enter', 'Previous match'],
      ['$', 'Start with $ for a JSONPath'],
      ['Esc', 'Clear search'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcuts);
  const mac = useUI((s) => s.mac);
  const t = useT();
  useEffect(() => {
    if (open) track('feature_used', { feature: 'shortcuts' });
  }, [open]);
  return (
    <Modal open={open} onClose={() => store.set({ shortcuts: false })} className="sheet" label={t('Keyboard shortcuts')}>
      <header>
        <h2>
          <Icon name="keyboard" size={18} /> {t('Keyboard shortcuts')}
        </h2>
        <button type="button" className="btn icon" aria-label={t('Close')} onClick={() => store.set({ shortcuts: false })} autoFocus>
          <Icon name="x" />
        </button>
      </header>
      <div className="sheet-grid">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3>{t(g.title)}</h3>
            <dl>
              {g.items.map(([k, label, macK]) => (
                <div key={k + label}>
                  <dt>
                    <Kbd k={mac && macK ? macK : k} />
                  </dt>
                  <dd>{t(label)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

// ── Graph image export ──────────────────────────────────────────────────────

type ExportPrefs = Omit<GraphExport, 'background'> & { bg: 'theme' | 'white' | 'transparent' | 'custom'; color: string };
const EXPORT_PREFS = 'jf:graph-export';
const DEFAULT_EXPORT: ExportPrefs = { format: 'png', area: 'all', bg: 'theme', color: '#ffffff', scale: 2 };

function loadExportPrefs(): ExportPrefs {
  try {
    const v = { ...DEFAULT_EXPORT, ...JSON.parse(localStorage.getItem(EXPORT_PREFS) ?? '{}') } as ExportPrefs;
    // Stored values are only trusted from the known sets.
    if (!['png', 'jpeg', 'svg'].includes(v.format)) v.format = 'png';
    if (!['all', 'view', 'branch'].includes(v.area)) v.area = 'all';
    if (!['theme', 'white', 'transparent', 'custom'].includes(v.bg)) v.bg = 'theme';
    if (!/^#[0-9a-f]{6}$/i.test(v.color)) v.color = '#ffffff';
    if (![1, 2, 3].includes(v.scale)) v.scale = 2;
    return v;
  } catch {
    return DEFAULT_EXPORT;
  }
}

/** The last export choices, as export options (the menu's Copy image uses them too). */
export function savedGraphExport(): GraphExport {
  const p = loadExportPrefs();
  return { format: p.format, area: p.area, background: p.bg === 'white' ? '#ffffff' : p.bg === 'custom' ? p.color : p.format === 'jpeg' && p.bg === 'transparent' ? 'theme' : p.bg, scale: p.scale };
}

/** A row of mutually exclusive choices (the toolbar's segmented look). */
function Choice<V extends string | number>({ label, value, options, onPick }: { label: string; value: V; options: { v: V; label: string; disabled?: boolean }[]; onPick: (v: V) => void }) {
  const t = useT();
  return (
    <div className="gx-row">
      <span className="gx-label">{t(label)}</span>
      <div className="seg seg-sm" role="radiogroup" aria-label={t(label)}>
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} disabled={o.disabled} onClick={() => onPick(o.v)}>
            {t(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GraphExportDialog() {
  const open = useUI((s) => s.graphExport);
  const t = useT();
  return (
    <Modal open={open} onClose={() => store.set({ graphExport: false })} className="sheet gx" label={t('Export image')}>
      <ExportForm />
    </Modal>
  );
}

function ExportForm() {
  const t = useT();
  const fileName = useUI((s) => s.fileName);
  const [p, setP] = useState<ExportPrefs>(loadExportPrefs);
  const [name, setName] = useState(() => (fileName || 'data.json').replace(/\.[a-z0-9]+$/i, '') || 'graph');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const set = (patch: Partial<ExportPrefs>) => setP((old) => ({ ...old, ...patch }));
  // JPEG has no transparency: it falls back to the theme's colour.
  const bg = p.format === 'jpeg' && p.bg === 'transparent' ? 'theme' : p.bg;
  const opts: GraphExport = {
    format: p.format,
    area: p.area === 'branch' && preview && !preview.branch ? 'all' : p.area,
    background: bg === 'white' ? '#ffffff' : bg === 'custom' ? p.color : bg,
    scale: p.scale,
  };
  const key = JSON.stringify(opts);
  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_PREFS, JSON.stringify(p));
    } catch {}
  }, [p]);
  useEffect(() => {
    let live = true;
    void getEngine()?.graphExportPreview(JSON.parse(key) as GraphExport).then((r) => live && setPreview(r), () => {});
    return () => {
      live = false;
    };
  }, [key]);
  const close = () => store.set({ graphExport: false });
  const ext = p.format === 'jpeg' ? 'jpg' : p.format;
  const download = () => {
    act((e) => e.downloadGraph(opts, name));
    close();
  };
  return (
    <form
      className="gx-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!preview?.error) download();
      }}
    >
      <header>
        <h2>
          <Icon name="download" size={18} /> {t('Export image')}
        </h2>
        <button type="button" className="btn icon" aria-label={t('Close')} onClick={close}>
          <Icon name="x" />
        </button>
      </header>
      <div className="gx-body">
        <Choice label="File type" value={p.format} onPick={(format) => set({ format })} options={[{ v: 'png', label: 'PNG' }, { v: 'jpeg', label: 'JPEG' }, { v: 'svg', label: 'SVG' }]} />
        <Choice
          label="Area"
          value={opts.area}
          onPick={(area) => set({ area })}
          options={[{ v: 'all', label: 'Whole graph' }, { v: 'view', label: 'Visible area' }, { v: 'branch', label: 'Selected branch', disabled: !preview?.branch }]}
        />
        <div className="gx-row">
          <span className="gx-label">{t('Background')}</span>
          <div className="seg seg-sm" role="radiogroup" aria-label={t('Background')}>
            {(['theme', 'white', 'transparent'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={bg === v} disabled={v === 'transparent' && p.format === 'jpeg'} onClick={() => set({ bg: v })}>
                {t(v === 'theme' ? 'Theme' : v === 'white' ? 'White' : 'Transparent')}
              </button>
            ))}
            <label className={`gx-color${bg === 'custom' ? ' on' : ''}`} data-tip={t('Any colour')}>
              <input type="color" value={p.color} aria-label={t('Any colour')} onChange={(e) => set({ bg: 'custom', color: e.target.value })} onClick={() => set({ bg: 'custom' })} />
            </label>
          </div>
        </div>
        <Choice label="Size" value={p.scale} onPick={(scale) => set({ scale })} options={[1, 2, 3].map((v) => ({ v, label: `${v}×`, disabled: p.format === 'svg' }))} />
        <label className="gx-row">
          <span className="gx-label">{t('File name')}</span>
          <span className="gx-name">
            <input className={`mi-input ${PRIVATE}`} value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} spellCheck={false} autoComplete="off" />
            <span className="muted">.{ext}</span>
          </span>
        </label>
        <p className="gx-info" aria-live="polite">
          {preview?.error
            ? t.msg(preview.error)
            : preview
              ? `${t('{width} × {height} px', { width: t.num(preview.width), height: t.num(preview.height) })}${t(' · ')}${t.n(preview.cards, '{n} card', '{n} cards')}${preview.reduced ? t(' · ') + t('reduced to fit') : ''}`
              : ''}
        </p>
      </div>
      <footer className="gx-foot">
        <button type="button" className="btn" disabled={!!preview?.error} onClick={() => {
          act((e) => e.copyGraphImage(opts));
          close();
        }}>
          <Icon name="copy" size={15} /> {t('Copy image')}
        </button>
        <button type="submit" className="btn primary" disabled={!!preview?.error} autoFocus>
          <Icon name="download" size={15} /> {t('Download')}
        </button>
      </footer>
    </form>
  );
}
