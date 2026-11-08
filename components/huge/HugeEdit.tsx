'use client';

/*
 * Editing in huge mode (lib/huge/edits.ts, the session's "Editing"): the file bar's state and buttons (Undo, Redo,
 * Save, a save's progress), the offer to restore a kept session, asking before closing with unsaved edits, asking
 * where to save without the opened file's handle, the edit box (a value, a name, a value to insert), the edit menu, and a value open as text in the normal editor.
 * Everything here shows document data, inside `.view` or with PRIVATE of its own.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PRIVATE, PRIVATE_LABELS } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import { formatDoc } from '@/lib/json/format';
import { ARR, parse } from '@/lib/json/parser';
import { kit } from '@/lib/huge/kit';
import type { HugeSession } from '@/lib/huge/session';
import type { EditBox, HugeStore, HugeUI } from '@/lib/huge/state';
import type { ValueKind } from '@/lib/huge/edits';
import type { Editor } from '@/lib/engine/editor';
import { MHead, MItem, MSep, menuKeys, menuLetter } from '../menu';

function useHuge<T>(store: HugeStore, select: (s: HugeUI) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

const mac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** A shortcut as this platform writes it (mod+Z: Ctrl+Z, or ⌘Z on a Mac). */
const keyText = (k: string) => (mac() ? k.replace('mod+', '⌘').replace('Shift+', '⇧') : k.replace('mod+', 'Ctrl+'));

// (Drawn here: icons.tsx is on every page's first load.)
const Glyph = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const UNDO = 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11';
const REDO = 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13';
const TABS = 'M4 7h6l2-3h8v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7ZM4 7V5a1 1 0 0 1 1-1h5';
const SAVE = 'M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 4v5h7V4M8 20v-6h8v6';

// ── The file bar's part ─────────────────────────────────────────────────────

/** "Edited · 3 changes", Undo, Redo, Save (a save's progress and Stop while it runs). */
export function EditButtons({ s }: { s: HugeSession }) {
  const e = useHuge(s.ui, (u) => u.edit);
  const t = useT();
  if (!e) return null;
  if (e.saving) {
    const pct = e.saving.size ? Math.min(100, Math.floor((e.saving.written / e.saving.size) * 100)) : 0;
    return (
      <span className="hg-saving" role="status">
        <span className="hg-savebar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="nowrap">{t('Saving… {percent}', { percent: `${pct}%` })}</span>
        <button type="button" className="btn sm hg-txtbtn" onClick={() => s.stopSave()}>
          {t('Stop')}
        </button>
      </span>
    );
  }
  // Another tab has this file open: one tab keeps a file's edits at a time (said calmly; the tip says what it means).
  const name = s.meta.name;
  const keep =
    e.keeping === 'other-tab'
      ? { label: t('Open in another tab'), tip: t('Edits here aren’t kept while {name} is open in another tab', { name }) }
      : e.keeping === 'other-tab-kept'
        ? { label: t('Kept in another tab'), tip: t('Another tab kept its changes to {name}: edits here won’t be kept', { name }) }
        : null;
  return (
    <span className="hg-editbar">
      {keep && (
        <span className={`hg-keep ${PRIVATE_LABELS}`} tabIndex={0} role="note" data-tip={keep.tip} aria-label={keep.tip}>
          <Glyph d={TABS} />
          <span className="lbl">{keep.label}</span>
        </span>
      )}
      {e.edited && (
        <span className={`hg-edited ${PRIVATE}`} role="status">
          {e.busy ? t('Applying…') : t.n(e.steps, 'Edited · {n} change', 'Edited · {n} changes')}
        </span>
      )}
      <button type="button" className="btn icon" disabled={!e.canUndo || e.busy} aria-label={t('Undo')} data-tip={`${t('Undo')}${t(' · ')}${keyText('mod+Z')}`} onClick={() => s.undo('toolbar')}>
        <Glyph d={UNDO} />
      </button>
      <button type="button" className="btn icon" disabled={!e.canRedo || e.busy} aria-label={t('Redo')} data-tip={`${t('Redo')}${t(' · ')}${keyText('mod+Shift+Z')}`} onClick={() => s.redo('toolbar')}>
        <Glyph d={REDO} />
      </button>
      <button
        type="button"
        className={`btn${e.edited ? ' primary' : ''}`}
        disabled={!e.edited || e.busy}
        data-tip={`${e.inPlace ? t('Save to the file') : t('Save')}${t(' · ')}${keyText('mod+S')}`}
        onClick={() => void s.save(false)}
      >
        <Glyph d={SAVE} />
        <span className="lbl">{t('Save')}</span>
      </button>
    </span>
  );
}

// ── Restore, close ──────────────────────────────────────────────────────────

/** A kept session of this file: put its edits back, or drop them. */
export function RestoreBar({ s }: { s: HugeSession }) {
  const r = useHuge(s.ui, (u) => u.edit?.restore ?? null);
  const t = useT();
  if (!r) return null;
  const when = new Date(r.time);
  const today = new Date().toDateString() === when.toDateString();
  const at = today ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="banner hg-restore" role="status">
      <span className="b-msg">
        <span className={PRIVATE}>{t.n(r.steps, 'Restore {n} unsaved change from {time}?', 'Restore {n} unsaved changes from {time}?', { time: at })}</span>
        <span>{t('Editing first discards them.')}</span>
      </span>
      <button type="button" className="btn sm primary" onClick={() => void s.restoreEdits()}>
        {t('Restore')}
      </button>
      <button type="button" className="btn sm" onClick={() => void s.discardRestore()}>
        {t('Discard')}
      </button>
    </div>
  );
}

/** Closing with unsaved edits: save them, close without them, or stay. */
export function CloseConfirm({ s }: { s: HugeSession }) {
  const ask = useHuge(s.ui, (u) => !!u.edit?.confirm);
  const steps = useHuge(s.ui, (u) => u.edit?.steps ?? 0);
  const name = useHuge(s.ui, (u) => u.name);
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) first.current?.focus();
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="hg-modal" onKeyDown={(e) => e.key === 'Escape' && void s.answerClose('cancel')}>
      <div className="hg-dialog hg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hg-confirm-t" aria-describedby="hg-confirm-d">
        <h2 id="hg-confirm-t">{t('Save your changes?')}</h2>
        <p id="hg-confirm-d" className={PRIVATE}>
          {t.n(steps, '{name} has {n} unsaved change.', '{name} has {n} unsaved changes.', { name })}
        </p>
        <div className="hg-dlg-btns">
          <button type="button" className="btn primary" ref={first} onClick={() => void s.answerClose('save')}>
            {t('Save')}
          </button>
          <button type="button" className="btn" onClick={() => void s.answerClose('discard')}>
            {t('Close without saving')}
          </button>
          <button type="button" className="btn" onClick={() => void s.answerClose('cancel')}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Saving without the opened file's handle (Chromium): overwrite it (picked again with the open picker, which never
 * empties a file, and checked to be it), or save a new file (lib/huge/save-plan.ts).
 */
export function SaveAsk({ s }: { s: HugeSession }) {
  const ask = useHuge(s.ui, (u) => !!u.edit?.saveAsk);
  const name = useHuge(s.ui, (u) => u.name);
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) first.current?.focus();
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="hg-modal" onKeyDown={(e) => e.key === 'Escape' && s.answerSave('cancel')}>
      <div className="hg-dialog hg-confirm" role="dialog" aria-modal="true" aria-labelledby="hg-saveask-t" aria-describedby="hg-saveask-d">
        <h2 id="hg-saveask-t" className={PRIVATE}>
          {t('Save changes to {name}', { name })}
        </h2>
        <p id="hg-saveask-d" className={PRIVATE}>
          {t('To overwrite it, pick {name} again in the window that opens: it’s checked to be the file you opened before anything is written.', { name })}
        </p>
        <div className="hg-dlg-btns">
          <button type="button" className={`btn primary ${PRIVATE}`} ref={first} onClick={() => s.answerSave('overwrite')}>
            {t('Overwrite {name}…', { name })}
          </button>
          <button type="button" className="btn" onClick={() => s.answerSave('new')}>
            {t('Save as a new file…')}
          </button>
          <button type="button" className="btn" onClick={() => s.answerSave('cancel')}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The edit box ────────────────────────────────────────────────────────────

const KINDS: { v: ValueKind; label: string }[] = [
  { v: 'string', label: 'Text' },
  { v: 'number', label: 'Number' },
  { v: 'boolean', label: 'true / false' },
  { v: 'null', label: 'null' },
  { v: 'json', label: 'JSON' },
];

export function EditBoxView({ s }: { s: HugeSession }) {
  const b = useHuge(s.ui, (u) => u.box);
  if (!b) return null;
  return <Box key={`${b.mode}:${b.label}:${b.index}`} s={s} b={b} />;
}

function Box({ s, b }: { s: HugeSession; b: EditBox }) {
  const t = useT();
  const [kind, setKind] = useState<ValueKind>(b.kind);
  const [text, setText] = useState(b.kind === 'boolean' && b.text !== 'false' ? 'true' : b.text);
  const [name, setName] = useState(b.name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const el = useRef<HTMLFormElement>(null);
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);
  // On screen: within the view, under the row when there's room.
  useLayoutEffect(() => {
    const f = el.current;
    if (!f || !b.at) return;
    const r = f.getBoundingClientRect();
    const x = Math.max(8, Math.min(b.at.x, innerWidth - r.width - 8));
    const y = b.at.y + r.height + 8 > innerHeight ? Math.max(8, b.at.y - r.height + 26) : b.at.y;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
  }, [b.at, kind, err]);
  const commit = async () => {
    if (busy) return;
    setBusy(true);
    const e = await s.commitBox(kind, text, name);
    setBusy(false);
    setErr(e);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      s.closeBox();
    } else if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      void commit();
    }
  };
  const title = b.mode === 'rename' ? t('Rename') : b.mode === 'insert' ? t('Insert into') : t('Edit');
  const value = b.mode !== 'rename';
  const multi = kind === 'json' || (kind === 'string' && (text.includes('\n') || text.length > 60));
  return (
    <form
      ref={el}
      className={`hg-box ${PRIVATE}${b.at ? '' : ' top'}`}
      style={b.at ? { left: b.at.x, top: b.at.y, width: Math.min(b.at.w, 640) } : undefined}
      role="dialog"
      aria-label={`${title} ${b.label}`}
      onKeyDown={onKey}
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
    >
      <div className="hg-box-h">
        <b>{title}</b> <code>{b.label}</code>
      </div>
      {(b.mode === 'rename' || b.named) && (
        <input
          ref={b.mode === 'rename' || b.named ? first : undefined}
          className="hg-box-in"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('Name')}
          aria-label={t('Name')}
          spellCheck={false}
          autoComplete="off"
        />
      )}
      {value && (
        <div className="hg-box-row">
          <select className="hg-box-kind" value={kind} onChange={(e) => (setKind(e.target.value as ValueKind), setErr(null))} aria-label={t('Type')}>
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {t(k.label)}
              </option>
            ))}
          </select>
          {kind === 'boolean' ? (
            <select className="hg-box-in" value={text === 'false' ? 'false' : 'true'} onChange={(e) => setText(e.target.value)} aria-label={t('Value')}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : kind === 'null' ? (
            <span className="hg-box-null">null</span>
          ) : multi ? (
            <textarea
              ref={b.named ? undefined : first}
              className="hg-box-in mono"
              value={text}
              rows={Math.min(8, Math.max(2, text.split('\n').length))}
              onChange={(e) => (setText(e.target.value), setErr(null))}
              aria-label={t('Value')}
              aria-invalid={!!err}
              aria-describedby={err ? 'hg-box-err' : undefined}
              spellCheck={false}
            />
          ) : (
            <input
              ref={b.named ? undefined : first}
              className="hg-box-in mono"
              value={text}
              onChange={(e) => (setText(e.target.value), setErr(null))}
              aria-label={t('Value')}
              aria-invalid={!!err}
              aria-describedby={err ? 'hg-box-err' : undefined}
              inputMode={kind === 'number' ? 'decimal' : undefined}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </div>
      )}
      {err && (
        <p className="hg-box-err" id="hg-box-err" role="alert">
          {err}
        </p>
      )}
      <div className="hg-box-btns">
        <span className="hg-box-tip">{multi ? t('Enter saves · Shift+Enter: a new line') : t('Enter saves · Esc cancels')}</span>
        <button type="button" className="btn sm" onClick={() => s.closeBox()}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn sm primary" disabled={busy}>
          {b.mode === 'insert' ? t('Insert') : t('Save')}
        </button>
      </div>
    </form>
  );
}

// ── The edit menu ───────────────────────────────────────────────────────────

/** Right click (or the menu key) in the tree, table or graph: what can be done to the selected value. */
export function EditMenu({ s }: { s: HugeSession }) {
  const m = useHuge(s.ui, (u) => u.menu);
  const sel = useHuge(s.ui, (u) => u.sel);
  const ready = useHuge(s.ui, (u) => !!u.edit?.ready);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const d = el.current;
    if (!d || !m) return;
    const r = d.getBoundingClientRect();
    d.style.left = `${Math.max(8, Math.min(m.x, innerWidth - r.width - 8))}px`;
    d.style.top = `${m.y + r.height + 8 > innerHeight ? Math.max(8, m.y - r.height) : m.y}px`;
    d.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const away = (e: MouseEvent) => !el.current?.contains(e.target as Node) && s.closeMenu(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [m, s]);
  if (!m) return null;
  const close = () => s.closeMenu(false);
  const run = (id: string) => s.command(id, 'menu');
  const path = sel?.path ?? '$';
  const container = !!sel && sel.t >= ARR;
  const member = !!sel?.named;
  const root = !sel || sel.root;
  return (
    <div
      ref={el}
      className="menu hg-menu"
      role="menu"
      aria-label={path}
      style={{ left: m.x, top: m.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          s.closeMenu();
        } else if (!menuKeys(e)) menuLetter(e);
      }}
    >
      <div className={`mi-head hg-menu-path ${PRIVATE}`}>{path}</div>
      <MItem label="Edit value" keys="F2" onClick={() => run('huge-edit')} close={close} disabled={!ready} />
      <MItem label="Edit as text" keys="mod+E" onClick={() => run('huge-text')} close={close} disabled={!ready} />
      <MItem label="Rename" keys="Shift+F2" onClick={() => run('huge-rename')} close={close} disabled={!ready || !member} />
      <MSep />
      <MItem label="Insert after" keys="mod+Enter" onClick={() => run('huge-insert')} close={close} disabled={!ready || root} />
      <MItem label="Insert inside" keys="mod+Shift+Enter" onClick={() => run('huge-insert-inside')} close={close} disabled={!ready || !container} />
      <MItem label="Duplicate" keys="mod+D" onClick={() => run('huge-duplicate')} close={close} disabled={!ready || root} />
      <MItem label="Delete" keys="Delete" onClick={() => run('huge-delete')} close={close} disabled={!ready || root} />
      <MSep />
      <MHead>Value</MHead>
      <MItem label="Copy value" onClick={() => void s.copyValue()} close={close} />
      <MItem label="Copy path" onClick={() => void s.copyPath()} close={close} />
      <MItem label="Save value as file" onClick={() => void s.saveValue()} close={close} />
    </div>
  );
}

// ── Edit as text ────────────────────────────────────────────────────────────

/** A value open in the normal editor (its colours, folding, the normal tool's formatting), applied as one undo step. */
export function TextDialog({ s }: { s: HugeSession }) {
  const te = useHuge(s.ui, (u) => u.textEdit);
  if (!te) return null;
  return <TextEdit key={te.label} s={s} label={te.label} text={te.text} />;
}

/** What the text says when checked: valid, or its first problem (where, and why). */
type Check = { ok: true } | { ok: false; p: number; line: number; col: number; msg: string };

function TextEdit({ s, label, text }: { s: HugeSession; label: string; text: string | null }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const ed = useRef<Editor | null>(null);
  const [check, setCheck] = useState<Check>({ ok: true });
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ i: number; n: number } | null>(null);
  const timer = useRef(0);

  const validate = () => {
    const e = ed.current;
    if (!e) return;
    const src = e.text;
    const r = parse(src);
    const bad = r.error ?? r.issues[0];
    if (!bad) {
      e.setDiagnostics([]);
      setCheck({ ok: true });
    } else {
      e.setDiagnostics([{ p: bad.p, cls: 'me' }]);
      const { line, col } = e.lineCol(bad.p);
      setCheck({ ok: false, p: bad.p, line, col, msg: bad.m });
    }
    setAnyway(false);
  };

  useEffect(() => {
    if (text === null || !box.current) return;
    const Ed = kit.Editor;
    const made = new Ed(box.current, {
      change: () => {
        clearTimeout(timer.current);
        const n = made.length;
        timer.current = window.setTimeout(validate, n < 100_000 ? 120 : n < 4_000_000 ? 400 : 1200);
      },
      caret() {},
      nav() {},
      escape: () => s.closeText(),
      copyAll: () => void navigator.clipboard?.writeText(made.text).catch(() => undefined),
    });
    made.init(text);
    ed.current = made;
    validate();
    made.focus();
    return () => {
      clearTimeout(timer.current);
      made.destroy();
      ed.current = null;
    };
    // (Made once, for the text read.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const format = () => {
    const e = ed.current;
    if (!e) return;
    const src = e.text;
    const r = parse(src);
    if (r.error || r.issues.length) return validate();
    e.replace(0, src.length, formatDoc(src, r, s.indent));
    e.focus();
  };

  const find = (dir: 1 | -1, query = q) => {
    const e = ed.current;
    if (!e || !query) return setFound(null);
    const src = e.text;
    const cs = query !== query.toLowerCase();
    const hay = cs ? src : src.toLowerCase();
    const needle = cs ? query : query.toLowerCase();
    let n = 0;
    for (let k = hay.indexOf(needle); k >= 0 && n < 100_000; k = hay.indexOf(needle, k + needle.length)) n++;
    if (!n) return setFound({ i: 0, n: 0 });
    const [a] = e.selection;
    let at = dir > 0 ? hay.indexOf(needle, a + (e.selectedText() ? 1 : 0)) : hay.lastIndexOf(needle, Math.max(0, a - 1));
    if (at < 0) at = dir > 0 ? hay.indexOf(needle) : hay.lastIndexOf(needle);
    e.select(at, at + needle.length);
    let i = 0;
    for (let k = hay.indexOf(needle); k >= 0 && k < at; k = hay.indexOf(needle, k + needle.length)) i++;
    setFound({ i: i + 1, n });
  };

  const apply = async () => {
    const e = ed.current;
    if (!e || busy) return;
    if (!check.ok && !anyway) return setAnyway(true);
    setBusy(true);
    await s.applyText(e.text);
    setBusy(false);
  };
  // (Ctrl+Enter, Ctrl+F: the engine sees keys first; huge mode passes the dialog's to it.)
  const keys = useRef(apply);
  useLayoutEffect(() => {
    keys.current = apply;
  });
  useEffect(
    () =>
      s.takeKeys((e) => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
        if (e.key === 'Enter') void keys.current();
        else if (e.key.toLowerCase() === 'f' && !e.shiftKey) document.getElementById('hg-te-find')?.focus();
        else return false;
        e.preventDefault();
        return true;
      }),
    [s],
  );

  return (
    <div
      className="hg-modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          s.closeText();
        }
      }}
    >
      <div className="hg-dialog hg-te" role="dialog" aria-modal="true" aria-labelledby="hg-te-t">
        <div className="hg-te-h">
          <h2 id="hg-te-t">{t('Edit as text')}</h2>
          <code className={`hg-te-path ${PRIVATE}`}>{label}</code>
          <span className="grow" />
          <input
            id="hg-te-find"
            className="hg-te-find"
            value={q}
            placeholder={t('Find')}
            aria-label={t('Find in the text')}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => (setQ(e.target.value), find(1, e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                find(e.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className={`hg-te-count ${PRIVATE}`} aria-live="polite">
            {found ? (found.n ? t('{i} of {total}', { i: t.num(found.i), total: t.num(found.n) }) : t('No results')) : ''}
          </span>
          <button type="button" className="btn sm hg-txtbtn" onClick={format} disabled={text === null}>
            {t('Format')}
          </button>
        </div>
        {text === null ? (
          <div className="hg-te-wait">{t('Loading…')}</div>
        ) : (
          <div className="mini-ed hg-te-ed">
            <div className={`ed ${PRIVATE}`} ref={box}>
              <div className="ed-gut" aria-hidden="true">
                <div className="ed-gl" />
              </div>
              <div className="ed-body">
                <div className="ed-scope" />
                <div className="ed-cur" />
                <div className="ed-hl" aria-hidden="true" />
                <textarea defaultValue={text} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" wrap="off" aria-label={t('{path} as text', { path: label })} />
              </div>
            </div>
          </div>
        )}
        <div className="hg-te-f">
          <span className={`hg-te-check${check.ok ? ' ok' : ' err'} ${PRIVATE}`} role="status">
            {check.ok ? t('Valid JSON') : t('Ln {line}, Col {col}: {msg}', { line: t.num(check.line), col: t.num(check.col), msg: t.msg(check.msg) })}
          </span>
          {!check.ok && (
            <button type="button" className="btn sm hg-txtbtn" onClick={() => ed.current?.select(check.p, check.p + 1)}>
              {t('Go to error')}
            </button>
          )}
          <span className="grow" />
          {anyway && <span className="hg-te-warn">{t('Apply anyway? The file will be invalid until it is fixed.')}</span>}
          <button type="button" className="btn" onClick={() => s.closeText()}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void apply()} disabled={busy || text === null} data-tip={keyText('mod+Enter')}>
            {anyway ? t('Apply anyway') : t('Apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
