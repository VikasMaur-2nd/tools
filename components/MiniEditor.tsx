'use client';

import { useEffect, useRef, useState } from 'react';
import { PRIVATE } from '@/lib/analytics';
import type { Colors, Diagnostic, Editor } from '@/lib/engine/editor';

/*
 * The viewer's editor (lib/engine/editor.ts) on its own, for /integrate: syntax colours,
 * line numbers, folding, and documents of any size. Its code loads when the box comes into
 * view; until then the box is a plain textarea that already works (the editor adopts what it holds).
 */

/** A paste over the whole box from this size opens like a file, caret at the top (as in the viewer: Engine.load). */
const LOAD_PASTE = 200_000;

export interface MiniEditorProps {
  id: string;
  /** The box's accessible name when no <label htmlFor> names it. */
  label?: string;
  /** The first document (the box keeps what the user does to it). */
  defaultValue?: string;
  /** The document, set by the page (a read-only box shows what it is given). */
  value?: string;
  readOnly?: boolean;
  wrap?: boolean;
  /** Colours for a document that isn't JSON (see Editor.setColors). */
  colors?: Colors | null;
  /** Marks at document offsets (errors, warnings). */
  diagnostics?: Diagnostic[];
  /** The document changed; read `ed.text` when needed (a big one is built when read). */
  onChange?: (ed: Editor) => void;
  /** The editor took over the box (null: it went away). */
  onEditor?: (ed: Editor | null) => void;
  className?: string;
}

export default function MiniEditor({ id, label, defaultValue, value, readOnly = false, wrap = false, colors = null, diagnostics, onChange, onEditor, className = '' }: MiniEditorProps) {
  const el = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [ed, setEd] = useState<Editor | null>(null);
  // The callbacks change with every render; the editor calls the latest.
  const changed = useRef(onChange);
  // What the box held when the page drew it.
  const [first] = useState(defaultValue ?? value ?? '');
  const told = useRef(onEditor);
  useEffect(() => {
    changed.current = onChange;
    told.current = onEditor;
  });

  useEffect(() => {
    let live = true;
    let made: Editor | null = null;
    const box = el.current!;
    // The editor's code comes when the box shows or takes focus: nothing of it while the page loads (the builder is below the fold).
    const load = () => {
      seen.disconnect();
      box.removeEventListener('focusin', load);
      import('@/lib/engine/editor').then(
        ({ Editor, loadSurface }) => {
          if (!live) return;
          made = new Editor(box, {
            change: () => changed.current?.(made!),
            caret() {},
            nav() {},
            escape() {},
            copyAll: () => void navigator.clipboard?.writeText(made!.text).catch(() => undefined),
            // (At its end, a wrapped one-line document is laid out row by row first: 27 MB froze the page for
            // 0.7 s in Chromium and 1.5 s in Firefox, against 0.3 s for the same paste opened at the top.)
            fullPaste: (text) => {
              if (text.length < LOAD_PASTE) return false;
              made!.setValue(text, 0, true);
              return true;
            },
          });
          setEd(made);
          told.current?.(made);
          // Typed into the plain box before the editor arrived: that's a change too.
          if (made.text !== first) changed.current?.(made);
          // The big-document editor's module (a few KB) when the page is idle: a big paste, or a long link in the
          // code box, then doesn't wait for it.
          (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(() => void loadSurface());
        },
        // (Offline before the chunk was cached: the plain textarea keeps working.)
        () => undefined,
      );
    };
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load());
    seen.observe(box);
    box.addEventListener('focusin', load);
    return () => {
      live = false;
      seen.disconnect();
      box.removeEventListener('focusin', load);
      made?.destroy();
      told.current?.(null);
    };
  }, [first]);

  useEffect(() => ed?.setWrap(wrap), [ed, wrap]);
  useEffect(() => ed?.setReadOnly(readOnly), [ed, readOnly]);
  useEffect(() => {
    if (value === undefined) return;
    if (ed) {
      if (value !== ed.text) ed.init(value);
    } else if (ta.current) ta.current.value = value;
  }, [ed, value]);
  // (After the document: colours are for the text they were made from.)
  useEffect(() => ed?.setColors(colors), [ed, colors, value]);
  useEffect(() => ed?.setDiagnostics(diagnostics ?? []), [ed, diagnostics]);

  return (
    <div className="mini-ed">
      <div className={`ed ${PRIVATE} ${className}`} ref={el}>
        <div className="ed-gut" aria-hidden="true">
          <div className="ed-gl" />
        </div>
        <div className="ed-body">
          <div className="ed-scope" />
          <div className="ed-cur" />
          <div className="ed-hl" aria-hidden="true" />
          <textarea
            ref={ta}
            id={id}
            // (Only the first: rewriting a big document into the DOM on every render would cost seconds.)
            defaultValue={first}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            // (The editor sets this too, once it takes over the box: see Editor.setWrap.)
            wrap={wrap ? 'soft' : 'off'}
            aria-label={label}
          />
        </div>
      </div>
    </div>
  );
}
