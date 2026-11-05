'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { COMMANDS, fuzzy, type Command } from '@/lib/engine/commands';
import { store, useUI } from '@/lib/engine/store';
import { act, getEngine } from '@/lib/engine/instance';
import type { HeldKey } from '@/lib/engine/engine';
import { PRIVATE, track, withVia } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import { Kbd, keyLabel } from './Kbd';
import { Icon } from './icons';

/** A native <dialog> opened/closed from store state (focus trap + Esc for free). */
export function Modal({ open, onClose, className, label, children }: { open: boolean; onClose: () => void; className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // (Shown before paint: the keys held for it while it loaded go to its field, see heldKeys.)
  useLayoutEffect(() => {
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

/**
 * The keys held while what is shown loaded (see Engine.holdKeys), for `use` as it shows (before paint: after
 * that, keys come to it); held again once it goes.
 */
function useHeldKeys(use: (keys: HeldKey[]) => void) {
  useLayoutEffect(() => {
    use(getEngine()?.takeKeys() ?? []);
    return () => getEngine()?.releaseKeys();
    // (Once: as it shows.)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Taken as a field would take it: a character or Backspace. */
const typed = (k: HeldKey) => !k.ctrlKey && !k.metaKey && !k.altKey && (k.key.length === 1 || k.key === 'Backspace');

/** `text` with typed key `k` applied. */
const typeKey = (text: string, k: HeldKey) => (k.key === 'Backspace' ? text.slice(0, -1) : text + k.key);

/** The keys of a dialog with no field (the shortcuts): it has them as it shows. */
function HeldKeys() {
  useHeldKeys(() => {});
  return null;
}

/**
 * Huge-file mode (a file too big for the editor is open): the commands that still mean something. The rest
 * act on the editor's document, hidden meanwhile.
 */
/** Huge mode's Shape view: Alt+7, after the views the normal tool numbers 1 to 6. */
const SHAPE: Command = {
  id: 'shape',
  group: 'View',
  title: 'Shape view (paths, types and counts)',
  keys: 'Alt+7',
  terms: 'schema fields structure statistics distinct',
  run: (e) => e.setView('shape' as unknown as Parameters<typeof e.setView>[0]),
};

const HUGE_COMMANDS = new Set([
  'open', 'url', 'paste', 'sample', 'format-view', 'tree', 'table', 'graph', 'convert', 'compare', 'search',
  'theme-system', 'theme-light', 'theme-dark', 'privacy-mode', 'integrate', 'handoff', 'shortcuts',
]);

function Commands() {
  const settings = useUI((s) => s.settings);
  const huge = useUI((s) => !!s.huge);
  const commands = huge ? [...COMMANDS.filter((c) => HUGE_COMMANDS.has(c.id)), SHAPE] : COMMANDS;
  const mac = useUI((s) => s.mac);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const t = useT();
  const router = useRouter();
  // Titles and search terms in the page's language; the English ones stay searchable.
  const names = useMemo(() => {
    const m = new Map<Command, { title: string; group: string; hay: string }>();
    // (Every command a list can show: the normal ones and huge mode's Shape.)
    for (const c of [...COMMANDS, SHAPE]) {
      const terms = `${c.group} ${c.terms ?? ''}`;
      const hay = t.lang ? `${t(c.group)} ${c.terms ? t(c.terms) : ''} ${c.id.startsWith('to-') ? t('convert') : ''} ${terms} ${c.title}` : terms;
      m.set(c, { title: t.msg(c.title), group: t(c.group), hay });
    }
    return m;
  }, [t]);

  /** The commands `query` finds, best first. */
  const matching = (query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.map((c) => ({ c, s: Math.max(fuzzy(needle, names.get(c)!.title) * 1.2, fuzzy(needle, names.get(c)!.hay)) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  };
  const list = useMemo(() => matching(q), [q, names, huge]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);


  const run = (c: Command) => {
    track('command_run', { command: c.id });
    const { href, run } = c;
    const go = () => {
      if (href) router.push(href);
      else if (run) requestAnimationFrame(() => act((e) => withVia('palette', () => run(e))));
    };
    // Close the native dialog first so the browser restores focus (and the
    // editor's selection) before the command runs: commands may move focus.
    // Wait for its close event too: a command may open the palette again (Load
    // from URL), and Firefox and Safari can fire it after the next frame, closing that.
    const d = listRef.current?.closest('dialog');
    if (d?.open) {
      d.addEventListener('close', go, { once: true });
      d.close();
    } else go();
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

  // Keys pressed while the palette loaded: what was typed, then the keys after the last one typed (one typed
  // puts the choice back on the first command, so those before it changed nothing). Enter and Mod+K wait a
  // frame, for the dialog to be open as they close it.
  useHeldKeys((keys) => {
    let text = '';
    let last = -1;
    keys.forEach((k, i) => {
      if (!typed(k)) return;
      text = typeKey(text, k);
      last = i;
    });
    if (text) setQ(text);
    const found = matching(text);
    let s = 0;
    for (const k of keys.slice(last + 1)) {
      if (k.key === 'ArrowDown' || (k.ctrlKey && k.key === 'n')) s = (s + 1) % Math.max(1, found.length);
      else if (k.key === 'ArrowUp' || (k.ctrlKey && k.key === 'p')) s = (s - 1 + found.length) % Math.max(1, found.length);
      else if (k.key === 'Enter' && found[s]) return void requestAnimationFrame(() => run(found[s]));
      else if ((k.metaKey || k.ctrlKey) && k.key.toLowerCase() === 'k') return void requestAnimationFrame(() => listRef.current?.closest('dialog')?.close());
    }
    setSel(s);
  });

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
  const form = useRef<HTMLFormElement>(null);
  /** Enter was pressed while it loaded: it loads the URL typed, once that is in the field. */
  const [enter, setEnter] = useState(false);
  useHeldKeys((keys) => {
    let text = '';
    for (const k of keys) {
      if (k.key === 'Enter') {
        setEnter(true);
        break;
      }
      if (typed(k)) text = typeKey(text, k);
    }
    if (text) setUrl(text);
  });
  useEffect(() => {
    if (enter) form.current?.requestSubmit();
  }, [enter]);
  return (
    <form
      ref={form}
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
      ['Shift+F10', 'Right-click menu'],
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
      <HeldKeys />
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
