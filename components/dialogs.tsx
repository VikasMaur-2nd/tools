'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { COMMANDS, fuzzy, keyLabel, type Command } from '@/lib/engine/commands';
import { store, useUI } from '@/lib/engine/store';
import { act } from '@/lib/engine/instance';
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
  return (
    <Modal open={!!mode} onClose={() => store.set({ palette: false })} className="palette" label="Command palette">
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

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.map((c) => ({ c, s: Math.max(fuzzy(needle, c.title) * 1.2, fuzzy(needle, `${c.group} ${c.terms ?? ''}`)) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q]);

  const active = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command) => {
    // Close the native dialog first so the browser restores focus (and the
    // editor's selection) before the command runs: commands may move focus.
    listRef.current?.closest('dialog')?.close();
    requestAnimationFrame(() => act(c.run));
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
          placeholder="Type a command…"
          aria-label="Search commands"
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
            <span className="pl-title">{c.title}</span>
            <span className="pl-group">{c.group}</span>
            {c.keys && (
              <span className="kbd">
                {keyLabel(c.keys, mac).map((k, j) => (
                  <kbd key={j}>{k}</kbd>
                ))}
              </span>
            )}
          </li>
        ))}
        {!list.length && <li className="pl-none">No matching commands</li>}
      </ul>
    </>
  );
}

function UrlPrompt() {
  const [url, setUrl] = useState('');
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
        autoFocus
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/data.json (press Enter to load)"
        aria-label="URL to load JSON from"
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
      ['Alt+4', 'Convert'],
      ['Alt+5', 'Compare'],
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
  return (
    <Modal open={open} onClose={() => store.set({ shortcuts: false })} className="sheet" label="Keyboard shortcuts">
      <header>
        <h2>
          <Icon name="keyboard" size={18} /> Keyboard shortcuts
        </h2>
        <button type="button" className="btn icon" aria-label="Close" onClick={() => store.set({ shortcuts: false })} autoFocus>
          <Icon name="x" />
        </button>
      </header>
      <div className="sheet-grid">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map(([k, label, macK]) => (
                <div key={k + label}>
                  <dt>
                    <Kbd k={mac && macK ? macK : k} />
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
