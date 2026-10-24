'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { act } from '@/lib/engine/instance';
import { useUI } from '@/lib/engine/store';
import { useT } from '@/lib/i18n/react';
import { Icon, type IconName } from './icons';
import { Kbd } from './Kbd';

/*
 * Menu pieces shared by the ⋯ menus (JsonTool) and the right-click menu
 * (ContextMenu): items, checkboxes, choice rows, separators, and their keys.
 */

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** ↑ ↓ (and Home End) move between a menu's enabled items. True if it was one of those keys. */
export function menuKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  // (Home and End stay with a text field in the menu.)
  if (!d && ((e.key !== 'Home' && e.key !== 'End') || e.target instanceof HTMLInputElement)) return false;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? (d > 0 ? 0 : items.length - 1) : (i + d + items.length) % items.length;
  items[to]?.focus();
  return true;
}

/** A typed letter moves to the next item whose label starts with it. */
export function menuLetter(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLocaleLowerCase();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = [...items.slice(i + 1), ...items.slice(0, i + 1)].find((b) => b.textContent?.trim().toLocaleLowerCase().startsWith(k));
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/**
 * A small popover menu anchored to a button: ⋯, or `icon` with the label shown (Share). Keyboard:
 * ↑ ↓ to move, Esc to close.
 */
export function Menu({ label, icon, tip, children }: { label: string; icon?: IconName; tip?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const t = useT();
  const name = t(label);

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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') menuKeys(e);
  };
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        id={id}
        type="button"
        className={`btn${icon ? '' : ' icon'}${open ? ' on' : ''}`}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : tip ? t(tip) : name}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon ?? 'more'} />
        {icon && <span className="lbl">{name}</span>}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={name} onKeyDown={onKey}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MItem({ label, keys, onClick, close, disabled }: { label: string; keys?: string; onClick: () => void; close: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mi"
      disabled={disabled}
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

/** An item that opens a page in a new tab. */
export function MLink({ label, href, close }: { label: string; href: string; close: () => void }) {
  return (
    <a role="menuitem" className="mi" href={href} target="_blank" rel="noopener" onClick={close}>
      <span>{useT()(label)}</span>
      <Icon name="external" size={14} />
    </a>
  );
}

/** `close`: close the menu when toggled (the right-click menu); omit to keep it open (settings). */
export function MCheck({ label, keys, checked, onClick, close }: { label: string; keys?: string; checked: boolean; onClick: () => void; close?: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="mi"
      onClick={() => {
        close?.();
        onClick();
      }}
    >
      <span>{useT()(label)}</span>
      <span className="mi-end">
        {keys && <Kbd k={keys} />}
        <span className="mi-check">{checked && <Icon name="check" size={14} />}</span>
      </span>
    </button>
  );
}

/** Soft wrap: one setting for the editors and the code views. */
export function WrapItem() {
  const wrap = useUI((s) => s.settings.wrap);
  return <MCheck label="Wrap lines" keys="Alt+Z" checked={wrap} onClick={() => act((e) => e.toggleWrap())} />;
}

/** A row with a few mutually exclusive options (indent 2 · 4 · Tab, levels 1 · 2 · 3). */
export function MChoice<T extends string | number>({
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

export const MSep = () => <div className="mi-sep" role="separator" />;
export const MHead = ({ children }: { children: string }) => <div className="mi-head">{useT()(children)}</div>;

export const LEVELS = [
  { v: 1, label: '1' },
  { v: 2, label: '2' },
  { v: 3, label: '3' },
];

/** Folding for an editor (the gutter chevrons do the same per block). */
export function EditorFoldItems({ which, close }: { which: 1 | 2; close: () => void }) {
  return (
    <>
      <MItem label="Collapse all" onClick={() => act((e) => e.foldEditor(which, 1))} close={close} />
      <MItem label="Expand all" onClick={() => act((e) => e.foldEditor(which, 0))} close={close} />
      <MChoice label="Show levels" options={LEVELS} onPick={(l) => act((e) => e.foldEditor(which, l))} close={close} />
    </>
  );
}

export function FoldItems({ close }: { close: () => void }) {
  return (
    <>
      <MItem label="Collapse all" onClick={() => act((e) => e.collapseAll())} close={close} />
      <MItem label="Expand all" onClick={() => act((e) => e.expandAll())} close={close} />
      <MChoice label="Show levels" options={LEVELS} onPick={(l) => act((e) => e.expandTo(l))} close={close} />
    </>
  );
}
