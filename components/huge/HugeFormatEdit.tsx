'use client';

/*
 * The Format view's free-text editing (As written): a window of the document's lines (lib/huge/text-window.ts)
 * in the normal tool's editor (kit.Editor: the engine's own class, nothing imported), its keys, selection,
 * clipboard and screen reader as they are there, with its window options: lines numbered as the document's
 * (`lineBase`) and the big-document editor always (`alwaysBig`). Moved as the view nears its edge, the caret and
 * selection kept by byte; the document's error marked where it is in the window. What's typed goes to the core once
 * the frame is painted.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PRIVATE } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import { kit } from '@/lib/huge/kit';
import { PASTE_MAX, TextWindow, type WindowRefusal } from '@/lib/huge/text-window';
import type { HugeSession } from '@/lib/huge/session';
import type { HugeStore, HugeUI } from '@/lib/huge/state';
import type { Editor } from '@/lib/engine/editor';

function useHuge<T>(store: HugeStore, select: (s: HugeUI) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

/** Lines from a window's edge at which it moves. */
const MARGIN = 100;

export default function FormatEditView({ s }: { s: HugeSession }) {
  const fe = useHuge(s.ui, (u) => u.fe);
  if (!fe) return null;
  return <FormatEdit key={fe.id} s={s} at={fe.at} />;
}

function FormatEdit({ s, at }: { s: HugeSession; at: number }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | WindowRefusal>('loading');

  useEffect(() => {
    let live = true;
    const el = box.current!;
    let ed: Editor | null = null;
    let lh = 20;
    let moving = false;
    let frame = 0;
    const E = kit.Editor;
    const tw = new TextWindow(s.src, {
      sent: () => s.formatTyped(),
      failed: (e) => {
        s.formatFailed(e);
        void move(true);
      },
    });
    const end = () => s.src.state().docSize ?? s.src.size;
    // What's typed goes once the frame is painted: the keystroke is drawn first.
    const changed = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTimeout(() => ed && live && tw.edited(ed.text, ed.caret));
      });
    };
    let shown = '';
    let later = 0;
    // (The view bar's "Ln, Col" after the key is painted: a store update re-renders React before it otherwise.)
    const infoSoon = () => {
      if (later) return;
      later = requestAnimationFrame(() => {
        later = 0;
        setTimeout(info);
      });
    };
    const info = () => {
      if (!ed) return;
      const { line, col } = ed.lineCol(ed.caret);
      const key = `${tw.line}:${tw.lines}:${line}:${col}`;
      if (key === shown) return;
      shown = key;
      s.formatInfo({ line: tw.line + line, col, first: tw.line + 1, last: tw.line + tw.lines });
    };
    // The document's error, marked where it is in the window (each state: only when it moved).
    let marked = -2;
    const mark = () => {
      const st = s.src.state().status;
      const p = ed && st && st.kind !== 'valid' ? tw.offsetOf(st.at) : -1;
      if (p === marked || !ed) return;
      marked = p;
      ed.setDiagnostics(p >= 0 ? [{ p, cls: 'me' }] : []);
    };
    const near = () => {
      if (!ed) return false;
      const top = ed.topLine();
      const rows = Math.ceil(ed.sc.height / lh);
      return (top < MARGIN && tw.line > 0) || (top + rows > tw.lines - MARGIN && tw.end < end());
    };
    /** The window read again around the view (`again`: from its own first line, after undo or a failure). */
    const move = async (again = false) => {
      if (!ed || moving) return;
      moving = true;
      try {
        if (ed) tw.edited(ed.text, ed.caret);
        await tw.flush();
        const e = ed;
        const topRel = e.topLine();
        const offset = e.sc.top - topRel * lh;
        const topAbs = tw.line + topRel;
        const [a, b] = e.selection;
        const ba = tw.byteOf(a);
        const bb = tw.byteOf(b);
        tw.broken = false;
        const r = again ? await tw.load(tw.line, 0) : await tw.load(topAbs);
        if (r !== true || !live || ed !== e) return;
        e.lineBase = tw.line;
        e.init(tw.view);
        e.takeOver();
        marked = -2;
        e.sc.top = Math.max(0, (topAbs - tw.line) * lh + offset);
        e.render(true);
        const oa = tw.offsetOf(ba);
        const ob = tw.offsetOf(bb);
        if (oa >= 0) e.select(oa, ob >= 0 ? ob : oa, false);
        mark();
        info();
      } finally {
        moving = false;
      }
    };
    /** Byte `byte` in view, the caret there (the window read for it when it's outside). */
    const goto = async (byte: number) => {
      if (!ed) return;
      let off = tw.offsetOf(byte);
      if (off < 0) {
        tw.edited(ed.text, ed.caret);
        await tw.flush();
        const line = await s.src.lineOf('raw', byte);
        if ((await tw.load(line)) !== true || !live || !ed) return;
        ed.lineBase = tw.line;
        ed.init(tw.view);
        ed.takeOver();
        marked = -2;
        off = tw.offsetOf(byte);
      }
      ed.select(Math.max(0, off), Math.max(0, off), true);
      ed.focus();
      mark();
      info();
    };
    const onScroll = () => {
      if (!moving && near()) void move();
    };
    // A paste is bounded: past it, said why (the window's editor would hold it, and the core's history keep it).
    const onPaste = (e: ClipboardEvent) => {
      const n = e.clipboardData?.getData('text/plain').length ?? 0;
      if (n <= PASTE_MAX) return;
      e.preventDefault();
      e.stopPropagation();
      s.pasteTooBig(n);
    };
    const unbind = s.bindFormatEdit({
      // (What was typed since the last paint too: a save or undo right after a key has it.)
      flush: () => {
        if (ed && live) tw.edited(ed.text, ed.caret);
        return tw.flush();
      },
      caretByte: () => (ed ? tw.byteOf(ed.caret) : -1),
      reload: () => move(true),
      goto,
    });
    const stopState = s.src.onState(mark);
    void (async () => {
      const line = await s.src.lineOf('raw', at);
      const r = await tw.load(line);
      if (!live) return;
      if (r !== true) return setState(r);
      const made = new E(el, {
        change: changed,
        caret: () => {
          infoSoon();
          if (!moving && near()) void move();
        },
        nav() {},
        escape: () => void s.exitFormatEdit(),
        copyAll: () => void navigator.clipboard?.writeText(made.text).catch(() => undefined),
      });
      made.lineBase = tw.line;
      made.alwaysBig = true;
      made.init(tw.view);
      made.takeOver();
      ed = made;
      lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      made.setCaret(Math.max(0, tw.offsetOf(at)));
      made.focus();
      el.addEventListener('scroll', onScroll, { passive: true });
      el.addEventListener('paste', onPaste, true);
      setState('ready');
      mark();
      info();
    })();
    return () => {
      // (The newest key, typed since the last frame, still goes: the window sends what's left once let go.)
      if (ed && live) tw.edited(ed.text, ed.caret);
      live = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(later);
      unbind();
      stopState();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('paste', onPaste, true);
      tw.destroy();
      ed?.destroy();
      ed = null;
    };
  }, [s, at]);

  const label =
    state === 'long'
      ? t('This line is too long to edit here: edit its values from the tree, or as text')
      : state === 'cr'
        ? t('This part of the file has line ends this editor can’t keep (a lone CR): edit it from the tree')
        : state === 'bytes'
          ? t('This part of the file can’t be edited here: edit it from the tree')
          : state === 'none'
            ? t('Nothing to edit here')
            : null;
  return (
    <div className="hg-fe">
      <div className={`ed ${PRIVATE}`} ref={box} hidden={state !== 'ready' && state !== 'loading'}>
        <div className="ed-gut" aria-hidden="true">
          <div className="ed-gl" />
        </div>
        <div className="ed-body">
          <div className="ed-scope" />
          <div className="ed-cur" />
          <div className="ed-hl" aria-hidden="true" />
          <textarea spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" wrap="off" aria-label={t('The file as it is written, editable')} />
        </div>
      </div>
      {label && (
        <div className="hg-notyet" role="status">
          <b>{label}</b>
          <button type="button" className="btn" onClick={() => void s.exitFormatEdit()}>
            {t('Back to the view')}
          </button>
        </div>
      )}
    </div>
  );
}
