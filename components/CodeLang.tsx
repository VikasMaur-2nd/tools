'use client';

import { useLayoutEffect, useSyncExternalStore, type KeyboardEvent } from 'react';
import CopyButton from './CopyButton';

/*
 * JavaScript or TypeScript for the published code on /integrate: one choice for
 * every block on the page, kept in localStorage and shared with other tabs.
 * The blocks show and hide through `<html data-code-lang>`, which CODE_LANG_SCRIPT
 * sets before the first paint, so a returning visitor never sees the other one.
 */
export type CodeLang = 'js' | 'ts';
const KEY = 'jf:codeLang';
/** Inline, ahead of the code blocks (React skips it on client navigations; the switch's layout effect covers those). */
export const CODE_LANG_SCRIPT = `try{document.documentElement.dataset.codeLang=localStorage.getItem('${KEY}')==='ts'?'ts':'js'}catch(e){}`;

const listeners = new Set<() => void>();
let current: CodeLang | null = null;

function read(): CodeLang {
  try {
    return localStorage.getItem(KEY) === 'ts' ? 'ts' : 'js';
  } catch {
    return 'js';
  }
}

const get = () => (current ??= read());

function set(lang: CodeLang, save = true) {
  current = lang;
  document.documentElement.dataset.codeLang = lang;
  if (save) {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // Private mode or storage off: the choice lasts for this page.
    }
  }
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) set(e.newValue === 'ts' ? 'ts' : 'js', false);
  };
  addEventListener('storage', onStorage);
  return () => {
    listeners.delete(f);
    removeEventListener('storage', onStorage);
  };
}

const LANGS: [CodeLang, string][] = [
  ['js', 'JavaScript'],
  ['ts', 'TypeScript'],
];

/** The bar over a published code block: the language switch and a Copy button for the code in that language. */
export default function CodeLangBar({ name, js, ts }: { name: string; js: string; ts: string }) {
  const lang = useSyncExternalStore(subscribe, get, () => 'js' as CodeLang);
  useLayoutEffect(() => {
    document.documentElement.dataset.codeLang = get();
  }, []);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = lang === 'js' ? 'ts' : 'js';
    set(next);
    (e.currentTarget.querySelector(`[data-lang='${next}']`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="ig-snippet-bar">
      <div className="code-langs" role="radiogroup" aria-label="Language" onKeyDown={move}>
        {LANGS.map(([id, label]) => (
          <button key={id} type="button" role="radio" data-lang={id} aria-checked={lang === id} tabIndex={lang === id ? 0 : -1} onClick={() => set(id)}>
            {label}
          </button>
        ))}
      </div>
      <CopyButton text={lang === 'ts' ? ts : js} label="Copy" name={`Copy ${name} (${lang === 'ts' ? 'TypeScript' : 'JavaScript'})`} className="ig-copy" />
    </div>
  );
}
